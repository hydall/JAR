'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { pickChatPage, authedFetch, checkLogin } = require('./autotrigger');

const ORIGIN = 'https://janitorai.com';

/**
 * Pick the page to drive: prefer an open JanitorAI chat tab, then any
 * JanitorAI tab, then the first page (opening one if the context is empty).
 */
async function pickPage(context) {
  const chat = await pickChatPage(context);
  if (chat) return chat;
  return context.pages()[0] || (await context.newPage());
}

/** Readiness + whether a JanitorAI session is actually authenticated. */
async function getStatus(context) {
  if (!context) return { ready: false, loggedIn: false };
  const page = await pickPage(context);
  return { ready: true, loggedIn: await checkLogin(page) };
}

/**
 * Open the JanitorAI login page so the user can sign in interactively in the
 * real browser window — handling email/password, Google sign-in, Cloudflare
 * Turnstile etc. themselves. We don't automate credentials; instead, mirroring
 * GlazeFlutter's login sheet (which auto-closes once a session token appears),
 * we **poll [checkLogin] ourselves** for up to [waitMs] and resolve as soon as
 * the session is detected (or time out — the caller can just retry / run).
 */
async function openLogin(context, waitMs = 180000) {
  const page = await pickPage(context);
  if (await checkLogin(page)) return { ready: true, loggedIn: true };
  await page.goto(ORIGIN + '/login', { waitUntil: 'domcontentloaded' }).catch(() => {});
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1500);
    if (await checkLogin(page)) return { ready: true, loggedIn: true };
  }
  return { ready: true, loggedIn: false };
}

/** Throw a clear error if no JanitorAI session is active (à la Glaze's capture). */
async function requireLogin(context) {
  const page = await pickPage(context);
  // A freshly-relaunched window may still be on about:blank / mid-navigation,
  // where janitorai.com cookies + localStorage (and thus the session token)
  // aren't readable yet. Make sure we're actually on the origin and loaded
  // before deciding, and give the token a moment to become readable.
  if (!page.url().includes('janitorai.com')) {
    await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' }).catch(() => {});
  }
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  for (let i = 0; i < 4; i += 1) {
    if (await checkLogin(page)) return;
    await page.waitForTimeout(800);
  }
  throw new Error('Not logged into JanitorAI — open the JanitorAI session panel and Log in first.');
}

/** Best-effort find the character avatar URL in the chat DOM. */
async function getAvatarUrl(page) {
  try {
    return await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      const a = imgs.find((img) =>
        img.src.includes('ella.janitorai.com')
        && (img.src.includes('/bot-avatars/') || img.src.includes('/chats/')));
      return a ? a.src : null;
    });
  } catch (_) { return null; }
}

/** Download an avatar (in-page fetch → data URL, sharing the cookie jar). */
async function downloadAvatar(page, url) {
  if (!url) return '';
  try {
    const data = await page.evaluate(async (u) => {
      const r = await fetch(u);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const blob = await r.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }, url);
    if (data && data.startsWith('data:image/')) return data;
  } catch (_) { /* ignore */ }
  return '';
}

/**
 * Rewrite a `/generateAlpha` REQUEST body so it carries `persona` as the active
 * user persona. JanitorAI substitutes the `{{user}}` macro with the persona's
 * name server-side while assembling the prompt; forcing a persona literally named
 * `{{user}}` makes that substitution a no-op, so the macro survives in the
 * captured RESPONSE. Mirrors the shape the real client sends (see the
 * generateAlpha request: `personas[]`, `profiles[]`, `chat.persona_id`).
 * @returns {boolean} whether anything was changed
 */
function applyPersonaOverride(body, persona) {
  if (!body || !persona || !persona.id) return false;
  const appearance = persona.appearance || '';
  body.personas = [{
    appearance, id: persona.id, name: persona.name, user_id: persona.user_id,
  }];
  body.profiles = [{
    appearance, id: persona.id, name: persona.name, type: 'persona',
  }];
  if (body.chat && typeof body.chat === 'object') body.chat.persona_id = persona.id;
  return true;
}

/** Looks like an assembled generation payload we can extract a lorebook from. */
function looksLikePayload(obj) {
  return obj && Array.isArray(obj.messages)
    && obj.messages.some((m) => m && m.role === 'system' && typeof m.content === 'string');
}

/**
 * Launch Playwright's bundled Chromium (persistent profile) and capture the
 * JanitorAI `/generateAlpha` RESPONSE — the assembled prompt for the turn (with
 * `<...Persona>` wrappers intact). Whatever the client sends downstream to the
 * configured proxy is deliberately ignored. The browser is **always headful** so
 * Cloudflare's managed Turnstile challenge clears (headless is detected and
 * blocked). [mode] controls window placement:
 *  - 'visible'    — a normal on-screen window (used for login).
 *  - 'background' — a real window pushed far off-screen, so it stays out of the
 *    way (used for extraction). Background-throttling is disabled so the capture
 *    timing isn't slowed while the window isn't focused.
 *
 * @param {object} opts
 * @param {string} opts.userDataDir  persistent profile dir (login + CF clearance)
 * @param {'visible'|'background'} opts.mode
 * @param {(rec:{url:string,payload:object,source:string})=>void} opts.onCapture
 * @param {() => (object|null)} [opts.getPersonaOverride] returns the persona to
 *        force into the outgoing `/generateAlpha` REQUEST (or null for none) —
 *        see {@link installPersonaOverride}.
 * @returns {Promise<import('playwright').BrowserContext>}
 */
async function startCapture({
  userDataDir, mode = 'background', onCapture, getPersonaOverride,
}) {
  const dir = path.resolve(userDataDir || './user-data');
  // Closing then immediately relaunching (e.g. switching visible→background
  // after login) can leave stale singleton locks that block the new launch.
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try { fs.rmSync(path.join(dir, f), { force: true }); } catch (_) { /* */ }
  }
  const args = ['--disable-blink-features=AutomationControlled'];
  if (mode === 'background') {
    args.push(
      '--window-position=-32000,-32000', // off-screen, so it never grabs focus
      '--window-size=1280,800',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    );
  } else {
    // Visible (login) window: force an on-screen position so it can never come
    // up off-screen or jammed against an edge (Chromium otherwise restores the
    // last-saved position, which may be stale or off the current monitor).
    args.push(
      '--window-position=80,60',
      '--window-size=1100,820',
    );
  }
  const context = await chromium.launchPersistentContext(dir, {
    headless: false, // headful always — headless fails Cloudflare
    viewport: null,
    args,
  });
  console.log(`[browser] launched (${mode === 'background' ? 'background / off-screen' : 'visible'})`);

  // Dedupe consecutive identical bodies (a retried request can fire twice).
  const recent = new Map(); // hash -> ts
  const seen = (str) => {
    const now = Date.now();
    for (const [h, t] of recent) if (now - t > 15000) recent.delete(h);
    let hash = 0;
    for (let i = 0; i < str.length; i += 1) hash = (hash * 31 + str.charCodeAt(i)) | 0;
    const key = `${str.length}:${hash}`;
    if (recent.has(key)) return true;
    recent.set(key, now);
    return false;
  };

  const deliver = (url, payload, source) => {
    try {
      const str = JSON.stringify(payload);
      if (seen(str)) return;
      onCapture({ url, payload, source });
    } catch (_) { /* ignore */ }
  };

  // Rewrite the outgoing `/generateAlpha` REQUEST to force our `{{user}}` persona
  // (when one is set for the run). JanitorAI has no separate "set chat persona"
  // endpoint — the persona id simply rides along in this request body — so we edit
  // it in flight. Every matching request MUST be continued, override or not.
  await context.route('**/generateAlpha', async (route) => {
    const persona = getPersonaOverride ? getPersonaOverride() : null;
    const req = route.request();
    if (!persona || req.method() !== 'POST') return route.continue();
    try {
      const raw = req.postData();
      if (!raw) return route.continue();
      const body = JSON.parse(raw);
      if (!applyPersonaOverride(body, persona)) return route.continue();
      return route.continue({ postData: JSON.stringify(body) });
    } catch (_) {
      return route.continue();
    }
  });

  // The ONLY thing we care about is the `/generateAlpha` RESPONSE: it is the prompt
  // JanitorAI assembled for this turn, with `<...Persona>` / `<Scenario>` wrappers
  // intact — exactly what separate() strips. What the JanitorAI client does with it
  // afterwards (reformat via pygmalion mode, POST it to the configured proxy, etc.)
  // is irrelevant and is NOT captured: that downstream body is reordered and has the
  // wrappers dropped, which is precisely what we must avoid.
  context.on('response', async (response) => {
    const url = response.url();
    if (!url.includes('/generateAlpha')) return;
    // Brotli-encoded JSON (Playwright decompresses for us). The request sets
    // accept: text/event-stream, so be defensive: if .json() can't parse it, read
    // raw text and pull the JSON object out before giving up.
    let body = null;
    try {
      body = await response.json();
    } catch (_) {
      try {
        const txt = await response.text();
        const i = txt.indexOf('{');
        const j = txt.lastIndexOf('}');
        if (i >= 0 && j > i) body = JSON.parse(txt.slice(i, j + 1));
      } catch (e) {
        console.warn('[capture] generateAlpha response body unavailable:', e.message);
        return;
      }
    }
    if (looksLikePayload(body)) deliver(url, body, 'generateAlpha');
  });

  const page = context.pages()[0] || (await context.newPage());
  // Await the initial load so the session (cookies + localStorage on the
  // janitorai.com origin) is readable as soon as the caller acts on it.
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' }).catch(() => { });

  return context;
}

/**
 * Owns the capture browser's lifecycle, mirroring GlazeFlutter's
 * `JanitorWebViewProxy`: the browser is **never kept warm**. It is opened only
 * for the duration of one operation and closed right after — so it's open only
 * during login or extraction. Login opens a **visible** window (so the user can
 * sign in); extraction opens a **background** (off-screen) window, out of the
 * way. Both are headful so Cloudflare clears. The persistent profile in
 * `user-data/` keeps the session between launches.
 */
class BrowserManager {
  constructor(opts = {}) {
    this.opts = opts; // { userDataDir, onCapture }
    this.context = null;
    this.modeActive = null; // window mode of the currently-open context
    this.starting = null;
    this.busy = false;
    // Persona forced into the outgoing /generateAlpha request for the current
    // run (set by the caller before triggering, cleared after). Read live by the
    // request-rewrite route, so it can be set after the context is already open.
    this.personaOverride = null;
  }

  isReady() { return this.context != null; }

  /** Force (or clear, with null) the persona injected into /generateAlpha. */
  setPersonaOverride(persona) { this.personaOverride = persona || null; }

  /**
   * Ensure a context is up in the requested [mode] ('visible' | 'background').
   * If one is already open in a different mode it is closed and relaunched (a
   * persistent context can only be one window mode at a time).
   */
  async ensureStarted(mode = 'background') {
    if (this.context && this.modeActive === mode) return this.context;
    if (this.context) await this.dispose();
    if (this.starting) return this.starting;
    this.starting = startCapture({
      userDataDir: this.opts.userDataDir,
      mode,
      onCapture: this.opts.onCapture,
      getPersonaOverride: () => this.personaOverride,
    })
      .then((ctx) => {
        ctx.on('close', () => {
          if (this.context === ctx) { this.context = null; this.modeActive = null; }
        });
        this.context = ctx;
        this.modeActive = mode;
        this.starting = null;
        return ctx;
      })
      .catch((e) => { this.starting = null; throw e; });
    return this.starting;
  }

  /**
   * Open the browser (in [mode]), run [fn], then close it — unless [keepOpen] is
   * set (used by login so the window can stay up if sign-in hasn't completed
   * yet). One operation at a time: concurrent calls are rejected.
   */
  async withBrowser(fn, { mode = 'background', keepOpen = false } = {}) {
    if (this.busy) {
      throw new Error('the capture browser is busy (a login or extraction is already running)');
    }
    this.busy = true;
    try {
      const ctx = await this.ensureStarted(mode);
      return await fn(ctx);
    } finally {
      this.busy = false;
      if (!keepOpen) await this.dispose();
    }
  }

  async dispose() {
    const ctx = this.context;
    this.context = null;
    this.modeActive = null;
    this.starting = null;
    try { await ctx?.close(); } catch (_) { /* */ }
  }
}

module.exports = {
  startCapture,
  BrowserManager,
  pickPage,
  getStatus,
  openLogin,
  requireLogin,
  getAvatarUrl,
  downloadAvatar,
};
