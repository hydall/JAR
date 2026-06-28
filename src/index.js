'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');

const store = require('./captureStore');
const {
  separate, extractCard, extractCharName, extractScenario, extractExample, extractFirstMessage,
} = require('./separate');
const { extract, buildExtractionMessages } = require('./extract');
const {
  BrowserManager, openLogin, requireLogin, getStatus, getAvatarUrl, downloadAvatar,
} = require('./capture');
const {
  sendMessage, parseCharacterId, createChat, deleteChat, fetchCharacter, authedFetch,
} = require('./autotrigger');
const { fetchPublicLorebooks, publicEntryContents } = require('./publiclore');
const { enterExtractionMode, restoreProfile } = require('./profile');
const { ensureUserMacroPersona, deletePersona } = require('./personas');

const PORT = Number(process.env.PORT) || 4577;
const SETTINGS_FILE = path.join(__dirname, '..', 'settings.local.json');

// ---- extraction LLM settings (set via the web UI, persisted locally) ----
function loadSettings() {
  const base = {
    baseUrl: '',
    apiKey: '',
    model: '',
  };
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      Object.assign(base, JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')));
    }
  } catch (_) { /* ignore */ }
  return base;
}
function saveSettings(s) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2), 'utf8');
}

// ---- live capture notifications (SSE) ----
const sseClients = new Set();
function broadcast(event, data) {
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(line);
}

// ---- capture waiters (used by auto-trigger to await the next generateAlpha) ----
// When the auto-trigger sends its "." probe, the resulting capture is only used
// to read the character card — it is NOT saved to the captures list.
let suppressNextCapture = false;
// When set, the next NON-suppressed generateAlpha capture is attached to this
// existing (inspected) record instead of creating a brand-new one — keeps the
// on-demand extract on the same record/context the user is looking at.
let pendingCaptureId = null;
const captureWaiters = [];
function waitNextCapture(timeout) {
  return new Promise((resolve, reject) => {
    const w = { resolve };
    w.timer = setTimeout(() => {
      const i = captureWaiters.indexOf(w);
      if (i >= 0) captureWaiters.splice(i, 1);
      reject(new Error('timed out waiting for a generateAlpha capture'));
    }, timeout);
    captureWaiters.push(w);
  });
}
function resolveWaiters(stored) {
  while (captureWaiters.length) {
    const w = captureWaiters.shift();
    clearTimeout(w.timer);
    w.resolve(stored);
  }
}

// ---- capture browser (open only during an operation, à la GlazeFlutter) ----
// The browser is NOT launched at boot, and never kept warm. It opens only for a
// login (visible window) or an extraction (real window pushed off-screen) and
// closes right after. Both are headful so Cloudflare clears. Extraction runs in
// the background by default; set EXTRACTION_BACKGROUND=false to watch it on-screen.
const extractionMode = 'background';
const browser = new BrowserManager({
  userDataDir: './user-data',
  onCapture: (rec) => {
    if (suppressNextCapture) {
      suppressNextCapture = false;
      console.log(`[capture] ${rec.source} (probe — not saved)`);
      resolveWaiters({ id: null, payload: rec.payload, source: rec.source, ts: Date.now() });
      return;
    }
    if (pendingCaptureId) {
      const stored = store.attachPayload(pendingCaptureId, rec.payload, rec.source);
      pendingCaptureId = null;
      if (stored) {
        console.log(`[capture] ${stored.source} ${stored.id} (attached to inspection)`);
        broadcast('capture', { id: stored.id });
        resolveWaiters(stored);
        return;
      }
      // record vanished — fall through to a normal save
    }
    const stored = store.save(rec);
    console.log(`[capture] ${stored.source} ${stored.id} (${stored.payload.model || '?'})`);
    broadcast('capture', { id: stored.id });
    resolveWaiters(stored);
  },
});

function composerOpts() {
  return {
    inputSelector: undefined,
    sendSelector: undefined,
  };
}

/**
 * Send "." to read the card (probe, not saved), then send a keyword-dense message
 * so the closed lorebook fires on as many keys as possible. We stuff the card
 * (and any [extraTriggerText], e.g. the bot's first message) into a single latest
 * user turn so every keyword is within scan depth regardless of JanitorAI's
 * server-side scan rules (which scan recent messages by depth, not by author).
 * Returns the card (for extraction context) and the second ("full") saved capture.
 * Caller resets suppressNextCapture in finally.
 */
async function runAutoTrigger(page, extraTriggerText = '') {
  const opts = composerOpts();
  const settleMs = 1500;

  suppressNextCapture = true;
  const dotWait = waitNextCapture(60000);
  await sendMessage(page, '.', opts);
  const dotCap = await dotWait;

  const card = extractCard(dotCap.payload);
  if (!card) throw new Error('could not find the character card in the capture');

  const triggerText = extraTriggerText
    ? `${card}\n\n${extraTriggerText}`
    : card;

  await page.waitForTimeout(settleMs);
  const fullWait = waitNextCapture(120000);
  await sendMessage(page, triggerText, opts);
  const fullCap = await fullWait;

  return { card, fullCap };
}

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/version', (_req, res) => {
  const pkg = require('../package.json');
  res.json({ version: pkg.version });
});

app.get('/api/captures', (req, res) => res.json(store.list()));

app.get('/api/captures/:id', (req, res) => {
  const rec = store.get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'not found' });
  res.json(rec);
});

app.delete('/api/captures/:id', (req, res) => {
  res.json({ ok: store.remove(req.params.id) });
});

app.post('/api/separate', (req, res) => {
  const rec = store.get(req.body.id);
  if (!rec) return res.status(404).json({ error: 'not found' });
  const publicContents = publicEntryContents(rec.publicLorebooks);
  res.json(separate(rec.payload, req.body.knownCard || '', publicContents));
});

/**
 * Resolve the raw lorebook text and the per-source context the build LLM should
 * receive, from the request body + stored record. Shared by /api/extract (which
 * calls the model) and /api/extract-preview (which only shows the prompt).
 * @returns {{lorebookText:string, opts:object}}
 */
function resolveExtractInputs(req) {
  const rec = req.body.id ? store.get(req.body.id) : null;
  let lorebookText = req.body.lorebookText;
  if (!lorebookText) {
    if (!rec || !rec.payload) {
      throw Object.assign(new Error('not found'), { status: 404 });
    }
    const publicContents = publicEntryContents(rec.publicLorebooks);
    lorebookText = separate(rec.payload, req.body.knownCard || '', publicContents).lorebookText;
  }
  // Context sources for key inference — each independently selectable from the
  // UI. Custom text is an extra opt-in source. First message(s) default OFF
  // (they can be large); the rest default ON when present.
  const useCard = req.body.useCard !== false;
  const useCatalog = req.body.useCatalog !== false;
  const useScenario = req.body.useScenario !== false;
  const useGreetings = req.body.useGreetings === true;
  const useLorebookDescs = req.body.useLorebookDescs !== false;
  // Stored structured context, with a fallback for older captures that only
  // have the legacy combined `catalog` string.
  const ctx = (rec && rec.context)
    || (rec && rec.catalog ? { description: rec.catalog } : {})
    || {};
  const card = useCard
    ? ((rec && rec.payload ? extractCard(rec.payload) : '') || req.body.knownCard || '')
    : '';
  const opts = {
    card,
    catalog: useCatalog ? (ctx.description || '') : '',
    scenario: useScenario ? (ctx.scenario || '') : '',
    greetings: useGreetings ? (ctx.greetings || '') : '',
    lorebookDescs: useLorebookDescs ? (ctx.lorebooks || '') : '',
    extra: String(req.body.extraContext || '').trim(),
  };
  return { lorebookText, opts };
}

app.post('/api/extract', async (req, res) => {
  try {
    const { lorebookText, opts } = resolveExtractInputs(req);
    const cfg = loadSettings();
    const result = await extract(lorebookText, cfg, opts);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e) });
  }
});

// Build the exact prompt the build LLM would receive, WITHOUT calling it — lets
// the UI preview what's being sent.
app.post('/api/extract-preview', (req, res) => {
  try {
    const { lorebookText, opts } = resolveExtractInputs(req);
    res.json({ messages: buildExtractionMessages(lorebookText, opts) });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e) });
  }
});

function htmlToText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
}

/**
 * Build the separately-toggleable key-inference context parts from character
 * catalog metadata. Each part is independently opt-in/out from the UI, so they
 * are kept apart rather than pre-concatenated:
 *   - description: the public catalog card description (name, tags, blurb)
 *   - scenario:    the roleplay scenario/setup
 *   - greetings:   every opening message (joined; all of them when there are many)
 *   - lorebooks:   PUBLIC titles + descriptions of attached lorebooks (the
 *                  lorebook *contents* stay hidden — only their public descriptions)
 */
function buildContextParts(meta) {
  const empty = { description: '', scenario: '', greetings: '', lorebooks: '' };
  if (!meta) return empty;
  const descParts = [];
  if (meta.name) descParts.push(`Name: ${meta.name}`);
  if (Array.isArray(meta.custom_tags) && meta.custom_tags.length) {
    descParts.push(`Tags: ${meta.custom_tags.join(', ')}`);
  }
  const desc = htmlToText(meta.description);
  if (desc) descParts.push(`Card description:\n${desc}`);

  const greetings = collectGreetings(meta, '');

  let lorebooks = '';
  if (Array.isArray(meta.scripts)) {
    // Only items whose description is publicly exposed in the catalog metadata —
    // never the lorebook script/contents themselves.
    const books = meta.scripts
      .filter((s) => s && s.type === 'lorebook')
      .map((s) => {
        const title = String(s.title || '').trim();
        const d = htmlToText(s.description);
        if (!title && !d) return '';
        return `- ${title}${d ? `: ${d}` : ''}`;
      })
      .filter(Boolean);
    if (books.length) lorebooks = books.join('\n');
  }

  return {
    description: descParts.join('\n\n'),
    scenario: htmlToText(meta.scenario),
    greetings: greetings.join('\n\n---\n\n'),
    lorebooks,
  };
}

/** Flatten context parts into a single string (legacy combined `catalog` field). */
function combineContext(ctx) {
  if (!ctx) return '';
  const parts = [];
  if (ctx.description) parts.push(ctx.description);
  if (ctx.scenario) parts.push(`Scenario:\n${ctx.scenario}`);
  if (ctx.greetings) parts.push(`Opening message(s):\n${ctx.greetings}`);
  if (ctx.lorebooks) {
    parts.push(`Attached lorebooks (public descriptions only — contents hidden):\n${ctx.lorebooks}`);
  }
  return parts.join('\n\n');
}

/**
 * Collect every opening message a character ships with, de-duplicated and in
 * order. JanitorAI exposes multiple greetings as `first_messages` (array);
 * older/single-greeting cards only have `first_message`. The captured prompt's
 * greeting is used as a fallback when metadata is unavailable.
 * @returns {string[]} greetings — index 0 is the primary, the rest are alternates.
 */
function collectGreetings(meta, capturedFirst) {
  const out = [];
  const push = (v) => {
    const s = String(v == null ? '' : v).trim();
    if (s && !out.includes(s)) out.push(s);
  };
  if (meta) {
    if (Array.isArray(meta.first_messages)) meta.first_messages.forEach(push);
    push(meta.first_message);
    if (Array.isArray(meta.alternate_greetings)) meta.alternate_greetings.forEach(push);
  }
  if (!out.length) push(capturedFirst);
  return out;
}

/**
 * Whether the creator left the definition PUBLIC (`showdefinition`). When true,
 * JanitorAI's own /hampter/characters/:id returns the real card fields, so the
 * card can be taken verbatim with NO generateAlpha extraction needed.
 */
function isCardPublic(meta) {
  return !!(meta && meta.showdefinition
    && (String(meta.personality || '').trim() || String(meta.scenario || '').trim()));
}

/**
 * Build the character card straight from public catalog metadata — exact and
 * lossless, no reconstruction. Used when {@link isCardPublic} is true (both at
 * inspection time and in the capture result).
 */
function buildPublicCharacter(meta, avatarBase64) {
  const greetings = collectGreetings(meta, '');
  return {
    name: (meta && meta.name) || '',
    avatarBase64: avatarBase64 || '',
    description: String((meta && meta.personality) || '').trim(),
    personality: '',
    scenario: String((meta && meta.scenario) || '').trim(),
    firstMessage: greetings[0] || '',
    alternateGreetings: greetings.slice(1),
    exampleMessages: String((meta && meta.example_dialogs) || '').trim(),
    creatorNotes: (meta && meta.description) || '',
    tags: (meta && meta.custom_tags) || [],
    definitionSource: 'janitor',
  };
}

/**
 * Assemble the capture result: isolated lorebook text and the extracted
 * character card. Does NOT auto-build with LLM — user triggers that manually.
 */
function assembleResult(fullCap, card, ctx, meta, avatarBase64, publicContents) {
  const sep = separate(fullCap.payload, '', publicContents);

  const payload = fullCap.payload;
  const greetings = collectGreetings(meta, extractFirstMessage(payload));

  // Public definition → take the real fields verbatim; otherwise reconstruct the
  // card from the leaked generateAlpha prompt. `definitionSource` tells the UI.
  const character = isCardPublic(meta) ? buildPublicCharacter(meta, avatarBase64) : {
    name: extractCharName(payload) || (meta && meta.name) || '',
    avatarBase64: avatarBase64 || '',
    description: extractCard(payload) || card || '',
    personality: '',
    scenario: extractScenario(payload) || (meta && meta.scenario) || '',
    firstMessage: greetings[0] || '',
    alternateGreetings: greetings.slice(1),
    exampleMessages: extractExample(payload) || '',
    creatorNotes: (meta && meta.description) || '',
    tags: (meta && meta.custom_tags) || [],
    definitionSource: 'reconstructed',
  };

  return {
    lorebookText: sep.lorebookText,
    card,
    catalog: combineContext(ctx),
    character,
  };
}

// INSPECT a character from its URL — read-only. Pulls metadata, avatar, public
// lorebooks and key-inference context WITHOUT running the generateAlpha
// extraction. Anything public (the card when `showdefinition` is set, downloadable
// lorebooks) is returned right away; closed lorebooks / a private card require a
// follow-up /api/capture, triggered explicitly by the user.
app.post('/api/inspect', async (req, res) => {
  try {
    const characterId = parseCharacterId(req.body.url);
    const charUrl = /^https?:\/\//i.test(req.body.url)
      ? req.body.url
      : `https://janitorai.com/characters/${characterId}`;
    const out = await browser.withBrowser(async (ctx) => {
      await requireLogin(ctx);
      const pages = ctx.pages();
      const page = pages.find((p) => p.url().includes('janitorai.com')) || pages[0]
        || (await ctx.newPage());
      await page.goto(charUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});

      const meta = await fetchCharacter(page, characterId).catch(() => null);
      const ctxParts = buildContextParts(meta);

      let publicLorebooks = [];
      try {
        publicLorebooks = await fetchPublicLorebooks(page, meta);
        const ok = publicLorebooks.filter((b) => b.accessible).length;
        console.log(`[publiclore] ${publicLorebooks.length} attached, ${ok} downloadable`);
      } catch (e) {
        console.warn('[publiclore] fetch failed:', e.message);
      }

      let avatarUrl = await getAvatarUrl(page);
      if (!avatarUrl && meta) {
        const av = meta.avatar || meta.profile_image || '';
        if (av) avatarUrl = /^https?:\/\//i.test(av) ? av : `https://ella.janitorai.com/bot-avatars/${av}?width=1200`;
      }
      const avatarBase64 = avatarUrl ? await downloadAvatar(page, avatarUrl) : '';

      return { meta, ctxParts, publicLorebooks, avatarBase64 };
    }, { mode: extractionMode });

    const cardPublic = isCardPublic(out.meta);
    const character = cardPublic
      ? buildPublicCharacter(out.meta, out.avatarBase64)
      : {
        name: (out.meta && out.meta.name) || '',
        avatarBase64: out.avatarBase64 || '',
        definitionSource: 'pending',
      };

    const rec = store.saveInspection({
      url: charUrl,
      characterId,
      characterName: (out.meta && out.meta.name) || '',
      meta: out.meta,
      context: out.ctxParts,
      publicLorebooks: out.publicLorebooks,
      avatarBase64: out.avatarBase64,
      character,
      cardPublic,
    });
    broadcast('capture', { id: rec.id });

    res.json({
      id: rec.id,
      characterName: rec.characterName,
      cardPublic,
      character,
      publicLorebooks: out.publicLorebooks,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// EXTRACT on demand — runs the generateAlpha capture for an already-inspected
// character (create chat, "." probe → card, then card-as-message → closed
// lorebook). The capture is attached to the SAME record. Shared by the card and
// lorebook "extract" buttons; if the record is already captured it is reused
// (a single capture yields both the reconstructed card and the raw lorebook).
app.post('/api/capture', async (req, res) => {
  try {
    const rec = req.body.id ? store.get(req.body.id) : null;
    if (!rec) return res.status(404).json({ error: 'not found' });

    const meta = rec.meta || null;
    const publicContents = publicEntryContents(rec.publicLorebooks);
    const avatarBase64 = (rec.character && rec.character.avatarBase64) || '';

    // Already captured → reuse the stored payload, no second browser run.
    if (rec.payload) {
      const built = assembleResult(rec, '', rec.context, meta, avatarBase64, publicContents);
      return res.json({
        id: rec.id, lorebookText: built.lorebookText, character: built.character, reused: true,
      });
    }

    const characterId = rec.characterId || parseCharacterId(rec.url);
    const built = await browser.withBrowser(async (ctx) => {
      await requireLogin(ctx);
      const pages = ctx.pages();
      const page = pages.find((p) => p.url().includes('janitorai.com')) || pages[0]
        || (await ctx.newPage());

      let profileSnapshot = null;
      try {
        profileSnapshot = await enterExtractionMode(page);
      } catch (e) {
        console.warn('[profile] could not enter extraction mode:', e.message);
      }

      let personaId = null;
      let chatId = null;
      try {
        await page.goto(rec.url || `https://janitorai.com/characters/${characterId}`,
          { waitUntil: 'domcontentloaded' }).catch(() => {});

        try {
          const persona = await ensureUserMacroPersona(page);
          personaId = persona.id;
          browser.setPersonaOverride(persona);
        } catch (e) {
          console.warn('[persona] could not ensure {{user}} persona:', e.message);
        }

        // Reuse an existing chat when available, otherwise create a new one.
        // If the saved chat is no longer accessible (deleted externally), fall
        // back to creating a fresh chat.
        if (rec.chatId) {
          chatId = rec.chatId;
          try {
            const probe = await authedFetch(page, `https://janitorai.com/hampter/chats/${chatId}`);
            if (probe.status >= 400) {
              console.log(`[chat] saved chat ${chatId} is gone, creating new one`);
              chatId = null;
            }
          } catch (_) {
            chatId = null;
          }
        }
        if (!chatId) {
          chatId = await createChat(page, characterId);
          store.attachChatId(rec.id, chatId);
        } else {
          console.log(`[chat] reusing existing chat ${chatId}`);
        }
        await page.goto(`https://janitorai.com/chats/${chatId}`, { waitUntil: 'domcontentloaded' });

        const firstMessage = meta && meta.first_message ? String(meta.first_message) : '';
        // Attach the upcoming generateAlpha capture to THIS inspected record.
        pendingCaptureId = rec.id;
        const { card, fullCap } = await runAutoTrigger(page, firstMessage);

        const result = assembleResult(fullCap, card, rec.context, meta, avatarBase64, publicContents);
        store.attachCardData(fullCap.id, result.character);

        // If closed lorebook content was extracted → the chat served its purpose,
        // clean it up. Otherwise keep it so the user can retry with different
        // messages (or the next auto-trigger variant).
        if (result.lorebookText && result.lorebookText.trim()) {
          try {
            await deleteChat(page, chatId);
            store.clearChatId(rec.id);
          } catch (e) {
            console.warn('[chat] delete failed (chat kept):', e.message);
          }
        } else {
          console.log(`[chat] no closed content extracted, keeping chat ${chatId} for retry`);
        }

        return result;
      } finally {
        pendingCaptureId = null;
        browser.setPersonaOverride(null);
        if (personaId) {
          await deletePersona(page, personaId)
            .catch((e) => console.warn('[persona] delete failed:', e.message));
        }
        if (profileSnapshot) {
          await restoreProfile(page, profileSnapshot)
            .catch((e) => console.warn('[profile] restore failed:', e.message));
        }
      }
    }, { mode: extractionMode });

    res.json({ id: rec.id, lorebookText: built.lorebookText, character: built.character });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    suppressNextCapture = false;
    pendingCaptureId = null;
  }
});

// Download the PUBLIC lorebooks attached to a character, by URL/id. Lighter than
// /api/run (no chat creation / auto-trigger): just opens the browser, reads the
// character metadata and pulls each attached public lorebook script.
app.post('/api/public-lorebooks', async (req, res) => {
  try {
    const characterId = parseCharacterId(req.body.url);
    const books = await browser.withBrowser(async (ctx) => {
      await requireLogin(ctx);
      const pages = ctx.pages();
      const page = pages.find((p) => p.url().includes('janitorai.com')) || pages[0]
        || (await ctx.newPage());
      const meta = await fetchCharacter(page, characterId).catch(() => null);
      if (!meta) throw new Error('could not read character metadata');
      return fetchPublicLorebooks(page, meta);
    }, { mode: extractionMode });
    res.json({ publicLorebooks: books });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Check login status (opens browser briefly in background, closes after).
app.get('/api/status', async (req, res) => {
  try {
    const data = await browser.withBrowser((ctx) => getStatus(ctx),
      { mode: 'background' });
    res.json(data);
  } catch (e) {
    res.json({ ready: false, loggedIn: false });
  }
});

// ---- JanitorAI login (interactive in the real browser; self-checked) --------
// Opens janitorai.com/login in a VISIBLE window; the user signs in there
// (email/password, Google, Cloudflare). The server auto-detects the session
// itself (polls the authed endpoint, like GlazeFlutter's login sheet). Once
// logged in we CLOSE the browser — the session persists in user-data/ and
// extraction reopens it off-screen on demand. If sign-in hasn't completed within
// the window, we leave it open so the user can finish.
app.post('/api/login', async (req, res) => {
  try {
    const data = await browser.withBrowser((ctx) => openLogin(ctx),
      { mode: 'visible', keepOpen: true });
    if (data.loggedIn) await browser.dispose();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ---- save outputs to disk (the standalone's stand-in for ST's import) ----
const OUTPUT_DIR = path.join(__dirname, '..', 'output');
function ensureOutput(sub) {
  const dir = sub ? path.join(OUTPUT_DIR, sub) : OUTPUT_DIR;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function safeName(name, fallback) {
  return (String(name || '').trim() || fallback).replace(/[^\w.\- ]+/g, '_').slice(0, 80);
}

// Save a built World Info book as importable SillyTavern JSON.
app.post('/api/save-world', (req, res) => {
  try {
    const { worldInfo, name } = req.body || {};
    if (!worldInfo || !worldInfo.entries) return res.status(400).json({ error: 'missing worldInfo' });
    const dir = ensureOutput('worlds');
    const file = path.join(dir, `${safeName(name, 'Janitor Lorebook')}.json`);
    fs.writeFileSync(file, JSON.stringify(worldInfo, null, 2), 'utf8');
    res.json({ ok: true, path: file, entries: Object.keys(worldInfo.entries).length });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Save a character as a SillyTavern v2 character card (JSON) + avatar PNG.
app.post('/api/save-character', (req, res) => {
  try {
    const c = req.body || {};
    if (!c.name) return res.status(400).json({ error: 'character name is required' });
    const dir = ensureOutput('characters');
    const base = safeName(c.name, 'character');
    const tags = Array.isArray(c.tags) ? c.tags
      : String(c.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
    const alternateGreetings = (Array.isArray(c.alternateGreetings) ? c.alternateGreetings
      : []).map((g) => String(g || '').trim()).filter(Boolean);

    const data = {
      name: c.name,
      description: c.description || '',
      personality: c.personality || '',
      scenario: c.scenario || '',
      first_mes: c.firstMessage || '',
      mes_example: c.exampleMessages || '',
      creator_notes: c.creatorNotes || '',
      tags,
      alternate_greetings: alternateGreetings,
      talkativeness: '0.5',
      fav: false,
      creator: 'janitor-lorebook-extractor',
      character_version: '1.0',
    };
    const card = { spec: 'chara_card_v2', spec_version: '2.0', data };
    const jsonFile = path.join(dir, `${base}.json`);
    fs.writeFileSync(jsonFile, JSON.stringify(card, null, 2), 'utf8');

    let avatarFile = '';
    if (typeof c.avatarBase64 === 'string' && c.avatarBase64.startsWith('data:image/')) {
      const b64 = c.avatarBase64.split(',')[1] || '';
      avatarFile = path.join(dir, `${base}.png`);
      fs.writeFileSync(avatarFile, Buffer.from(b64, 'base64'));
    }
    res.json({ ok: true, path: jsonFile, avatar: avatarFile || null });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/settings', (req, res) => res.json(loadSettings()));
app.post('/api/settings', (req, res) => {
  const cur = loadSettings();
  const next = {
    baseUrl: req.body.baseUrl ?? cur.baseUrl,
    apiKey: req.body.apiKey ?? cur.apiKey,
    model: req.body.model ?? cur.model,
  };
  saveSettings(next);
  res.json(next);
});

app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  res.write(': connected\n\n');
  sseClients.add(res);
  req.on('close', () => {
    sseClients.delete(res);
    // Safety net: if the UI is fully closed and the browser somehow lingers
    // (e.g. a login window left open), close it. Never interrupts a live run.
    if (sseClients.size === 0 && !browser.busy) browser.dispose();
  });
});

/** Open the UI in the user's default browser. */
function openInDefaultBrowser(url) {
  const { spawn } = require('child_process');
  try {
    if (process.platform === 'win32') {
      // `start` is a cmd builtin; the empty "" is the window title arg.
      spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (_) { /* non-fatal: the URL is printed below anyway */ }
}

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`[JAR]  ${url}`);
  console.log('[JAR]  browser opens only for login (visible) / extraction (off-screen), closes after.');
  openInDefaultBrowser(url);
});

// Tear the browser down cleanly on exit.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { browser.dispose().finally(() => process.exit(0)); });
}
