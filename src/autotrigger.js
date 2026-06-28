'use strict';

/**
 * Drive the JanitorAI chat UI from Playwright: pick the open chat tab and send a
 * message. Used to auto-trigger the closed lorebook (send ".", read the card from
 * the capture, then send the card text so as many entries as possible fire).
 *
 * JanitorAI's DOM is not stable across releases, so selectors are best-effort.
 */

const INPUT_CANDIDATES = [
  'textarea[placeholder]',
  'form textarea',
  'textarea',
  'div[contenteditable="true"]',
];

/** Choose the page that has a JanitorAI chat open (prefer a /chats/ URL). */
async function pickChatPage(context) {
  let fallback = null;
  for (const p of context.pages()) {
    const url = p.url();
    if (!url.includes('janitorai.com')) continue;
    if (/\/chats?\//i.test(url)) return p;
    fallback = fallback || p;
  }
  return fallback;
}

async function findInput(page, override, timeout = 12000) {
  const candidates = override ? [override] : INPUT_CANDIDATES;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const sel of candidates) {
      const loc = page.locator(sel).last();
      if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
        return { loc, sel };
      }
    }
    await page.waitForTimeout(300);
  }
  return null;
}

/** Extract a character UUID from a JanitorAI character URL (or a bare UUID). */
function parseCharacterId(input) {
  const s = String(input || '').trim();
  const m = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (!m) throw new Error('no character id found in: ' + s);
  return m[0];
}

/**
 * Run a fetch INSIDE the page so it shares the logged-in cookie jar, Cloudflare
 * clearance and TLS fingerprint, attaching the Supabase bearer token (found in
 * cookies / localStorage). Returns the raw status + text body.
 */
async function authedFetch(page, url, init = {}) {
  return page.evaluate(async ({ u, i }) => {
    function findToken() {
      const b64 = (s) => {
        try { return atob(s); } catch (e) { /* */ }
        try { return atob(s.replace(/-/g, '+').replace(/_/g, '/')); } catch (e) { /* */ }
        return null;
      };
      const extract = (rawIn) => {
        let raw = rawIn;
        if (!raw) return null;
        try { raw = decodeURIComponent(raw); } catch (e) { /* */ }
        if (raw.indexOf('base64-') === 0) raw = raw.slice(7);
        if (raw.indexOf('eyJ') === 0 && raw.split('.').length === 3) return raw;
        for (const s of [b64(raw), raw]) {
          if (!s) continue;
          const mm = s.match(/"access_token":"(eyJ[^"]+)"/);
          if (mm) return mm[1];
          try {
            const o = JSON.parse(s);
            const c = o && (o.access_token || o.accessToken || o.token
              || (o.currentSession && o.currentSession.access_token));
            if (typeof c === 'string' && c.indexOf('eyJ') === 0) return c;
          } catch (e) { /* */ }
        }
        return null;
      };
      try {
        const parts = {};
        for (const c of (document.cookie || '').split('; ')) {
          const eq = c.indexOf('=');
          if (eq < 0) continue;
          const mm = c.slice(0, eq).match(/^(sb-.*-auth-token)(?:\.(\d+))?$/);
          if (!mm) continue;
          const base = mm[1];
          const idx = mm[2] ? parseInt(mm[2], 10) : 0;
          (parts[base] = parts[base] || {})[idx] = c.slice(eq + 1);
        }
        for (const base in parts) {
          const idxs = Object.keys(parts[base]).map(Number).sort((a, b) => a - b);
          let joined = '';
          for (const j of idxs) joined += parts[base][j];
          const t = extract(joined);
          if (t) return t;
        }
      } catch (e) { /* */ }
      try {
        for (let k = 0; k < localStorage.length; k += 1) {
          const t = extract(localStorage.getItem(localStorage.key(k)));
          if (t) return t;
        }
      } catch (e) { /* */ }
      return null;
    }

    const token = findToken();
    const headers = Object.assign(
      { accept: 'application/json, text/plain, */*' },
      (i && i.headers) || {},
    );
    if (token) headers.authorization = 'Bearer ' + token;
    const r = await fetch(u, Object.assign({ credentials: 'include' }, i, { headers }));
    return { status: r.status, body: await r.text() };
  }, { u: url, i: init });
}

/**
 * Create a new chat for a character via JanitorAI's API. The chat inherits the
 * account's DEFAULT persona automatically (the create payload is just the
 * character id), so persona selection is done separately — see ./personas.
 * @returns {Promise<string>} the new chat id
 */
async function createChat(page, characterId) {
  const result = await authedFetch(page, 'https://janitorai.com/hampter/chats', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ character_id: characterId }),
  });
  if (result.status >= 400) {
    throw new Error(`create chat failed: HTTP ${result.status} ${result.body.slice(0, 200)}`);
  }
  let data;
  try { data = JSON.parse(result.body); } catch (e) {
    throw new Error('create chat: response was not JSON');
  }
  if (!data || data.id == null) throw new Error('create chat: no id in response');
  return String(data.id);
}

/** Fetch full character metadata from the catalog API (description, scenario…). */
async function fetchCharacter(page, characterId) {
  const result = await authedFetch(page, `https://janitorai.com/hampter/characters/${characterId}`);
  if (result.status >= 400) throw new Error(`fetch character failed: HTTP ${result.status}`);
  try { return JSON.parse(result.body); } catch (e) {
    throw new Error('fetch character: response was not JSON');
  }
}

/**
 * Type `text` into the chat composer and send it.
 * @param {import('playwright').Page} page
 * @param {string} text
 * @param {{inputSelector?:string, sendSelector?:string}} [opts]
 */
async function sendMessage(page, text, opts = {}) {
  const found = await findInput(page, opts.inputSelector);
  if (!found) {
    throw new Error('chat input not found');
  }
  const { loc, sel } = found;
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await loc.click();

  if (sel.includes('contenteditable')) {
    await loc.evaluate((el) => { el.textContent = ''; });
    await page.keyboard.insertText(text);
  } else {
    await loc.fill(text); // sets multi-line value in one shot (no premature send)
  }

  if (opts.sendSelector) {
    await page.locator(opts.sendSelector).first().click();
  } else {
    await loc.press('Enter');
  }
}

/**
 * Delete a chat by id via JanitorAI's API.
 * @returns {Promise<boolean>} true if deleted (HTTP 200)
 */
async function deleteChat(page, chatId) {
  if (!chatId) return false;
  const result = await authedFetch(page, `https://janitorai.com/hampter/chats/${chatId}`, {
    method: 'DELETE',
  });
  if (result.status >= 400) {
    console.warn(`[chat] delete chat ${chatId} failed: HTTP ${result.status}`);
    return false;
  }
  console.log(`[chat] deleted chat ${chatId}`);
  return true;
}

/** Probe whether the in-browser session is really authenticated (cookies + CF). */
async function checkLogin(page) {
  try {
    const r = await authedFetch(page, 'https://janitorai.com/hampter/profiles/mine');
    return r.status === 200;
  } catch (_) { return false; }
}

module.exports = {
  sendMessage, pickChatPage, parseCharacterId, createChat, deleteChat, fetchCharacter,
  authedFetch, checkLogin,
};
