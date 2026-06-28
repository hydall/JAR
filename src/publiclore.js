'use strict';

/**
 * Public lorebooks.
 *
 * A JanitorAI character can have **public** lorebooks attached to it (the
 * `scripts` array in the catalog/character metadata, items of `type:"lorebook"`
 * or the newer `type:"advanced"`).
 * Unlike a *closed* lorebook — which only ever surfaces as triggered text inside a
 * `generateAlpha` response and must be rebuilt by an LLM — a public lorebook can be
 * downloaded whole, in its original structured form, from:
 *
 *   GET https://janitorai.com/hampter/script/<scriptId>
 *
 * whose JSON has a `script` field (a JSON **string**) holding the array of entries
 * in JanitorAI's native shape (`key`/`keysRaw`, `content`, `selectiveLogic`,
 * `insertion_order`, …). That array maps 1:1 onto a SillyTavern World Info book via
 * {@link module:worldinfo.buildWorldInfo} (the same field mapping the standalone
 * hydall/LorebookConverter uses).
 *
 * Because both the public and the closed lorebooks of a character are injected into
 * the SAME `generateAlpha` system message, the extracted text would otherwise contain
 * the public entries too. {@link publicEntryContents} feeds their verbatim content to
 * `separate()`, which cuts it back out so only the genuinely closed entries remain.
 */

const { authedFetch } = require('./autotrigger');
const { buildWorldInfo } = require('./worldinfo');

const ORIGIN = 'https://janitorai.com';

/** Lorebook script references ({id,title,isPublic}) attached to a character. */
function lorebookScriptRefs(meta) {
  if (!meta || !Array.isArray(meta.scripts)) return [];
  return meta.scripts
    .filter((s) => s && (s.type === 'lorebook' || s.type === 'advanced') && (s.id != null))
    .map((s) => ({
      id: String(s.id),
      title: s.title || '',
      isPublic: s.is_public !== false,
    }));
}

/**
 * The raw JavaScript source of a `/hampter/script/<id>` record when its `script`
 * field is JS rather than a JSON entries array (a JanitorAI "advanced" / Nine API
 * lorebook). Returns '' when the script is JSON, empty, or absent.
 */
function jsScriptSource(rec) {
  if (!rec) return '';
  const raw = rec.script;
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  if (!s) return '';
  try {
    const a = JSON.parse(s);
    if (Array.isArray(a)) return ''; // structured (non-JS) shape
  } catch (_) {
    // Not JSON → treat as JS source.
  }
  return s;
}

/**
 * The lorebook's human-readable description shown on its public page
 * (`/scripts/<id>`). JanitorAI does NOT expose this through the `/hampter` API
 * (its `description` there is usually empty) — it lives in the page's embedded
 * store as `scriptPublishedContent.content` (with `script.description` as a
 * fallback). The page embeds the store as escaped JSON inside a
 * `window.mbxM.push(JSON.parse("…"))` call, so it is double-decoded here.
 * Returns '' when the page is closed/unavailable or carries no content.
 */
function parsePublishedContent(html) {
  const re = /JSON\.parse\("((?:[^"\\]|\\.)*)"\)/g;
  let m;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(html))) {
    let obj;
    try { obj = JSON.parse(JSON.parse(`"${m[1]}"`)); } catch (_) { continue; }
    if (!obj || typeof obj !== 'object') continue;
    for (const v of Object.values(obj)) {
      const c = v && v.scriptPublishedContent && v.scriptPublishedContent.content;
      if (typeof c === 'string' && c.trim()) return c;
      const d = v && v.script && v.script.description;
      if (typeof d === 'string' && d.trim()) return d;
    }
  }
  return '';
}

/**
 * Fetch the lorebook's public page and pull out its description content. Never
 * throws — returns '' when the page can't be read (e.g. a closed page).
 */
async function fetchScriptDescription(page, scriptId) {
  try {
    const res = await authedFetch(page, `${ORIGIN}/scripts/${scriptId}`);
    if (!res || res.status >= 400) return '';
    return parsePublishedContent(res.body || '');
  } catch (_) {
    return '';
  }
}

/** Parse the entries array out of a `/hampter/script/<id>` record. */
function parseScriptEntries(rec) {
  if (!rec) return [];
  const raw = rec.script;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const a = JSON.parse(raw);
      return Array.isArray(a) ? a : [];
    } catch (_) { return []; }
  }
  return [];
}

/**
 * Fetch a single public lorebook by script id and convert it to a SillyTavern
 * World Info book. Never throws — on any failure it returns a record with
 * `accessible:false` so the caller can flag it as "private / download-blocked"
 * (those have to go through the closed-lorebook LLM path instead).
 *
 * @param {import('playwright').Page} page  logged-in JanitorAI page (shared cookies)
 * @param {string} scriptId
 * @param {{title?:string}} [ref]
 */
async function fetchPublicLorebook(page, scriptId, ref = {}) {
  const base = { id: String(scriptId), title: ref.title || '', accessible: false };
  let res;
  try {
    res = await authedFetch(page, `${ORIGIN}/hampter/script/${scriptId}`);
  } catch (e) {
    return { ...base, error: String(e.message || e) };
  }
  if (!res || res.status >= 400) {
    return { ...base, status: res ? res.status : 0 };
  }
  let rec;
  try { rec = JSON.parse(res.body); } catch (_) {
    return { ...base, error: 'response was not JSON' };
  }
  const entries = parseScriptEntries(rec);
  const worldInfo = buildWorldInfo(entries);
  const entryCount = Object.keys(worldInfo.entries).length;
  // A JanitorAI "advanced" / Nine API lorebook ships its `script` as JavaScript
  // source, not a JSON entries array — so it yields no entries even though the
  // script IS public. Surface it as a JS book (rebuilt via the LLM with
  // `fromJs`) instead of letting it fall through as a private/closed lorebook.
  const scriptSource = entryCount === 0 ? jsScriptSource(rec) : '';
  // The real description lives on the lorebook's public /scripts page, not in
  // the /hampter record (whose `description` is usually empty). A closed page
  // falls back to the (often empty) hampter description.
  const pageDesc = await fetchScriptDescription(page, scriptId);
  const common = {
    id: String(rec.id || scriptId),
    title: rec.title || ref.title || '',
    description: pageDesc || rec.description || '',
    isPublic: rec.is_public === true,
    isCodePublic: rec.is_code_public === true,
  };
  if (scriptSource) {
    return { ...common, isJs: true, scriptSource, accessible: false, entryCount: 0, worldInfo };
  }
  return {
    ...common,
    // Downloadable only if the code is public AND it actually yielded entries.
    accessible: entryCount > 0,
    entryCount,
    worldInfo,
  };
}

/**
 * Fetch every public lorebook attached to a character (from its metadata).
 * @returns {Promise<Array<object>>} one record per attached lorebook script
 */
async function fetchPublicLorebooks(page, meta) {
  const refs = lorebookScriptRefs(meta);
  const out = [];
  for (const ref of refs) {
    // eslint-disable-next-line no-await-in-loop
    out.push(await fetchPublicLorebook(page, ref.id, ref));
  }
  return out;
}

/**
 * Flatten the verbatim entry contents of a character's downloadable public
 * lorebooks. These are subtracted from the closed-lorebook extraction (see
 * {@link module:separate.separate}) so public content never leaks into it.
 * @param {Array<object>} publicLorebooks  records from {@link fetchPublicLorebooks}
 * @returns {string[]}
 */
function publicEntryContents(publicLorebooks) {
  const out = [];
  for (const b of publicLorebooks || []) {
    if (!b || !b.accessible || !b.worldInfo || !b.worldInfo.entries) continue;
    for (const e of Object.values(b.worldInfo.entries)) {
      if (e && typeof e.content === 'string' && e.content.trim()) out.push(e.content);
    }
  }
  return out;
}

module.exports = {
  lorebookScriptRefs,
  jsScriptSource,
  parseScriptEntries,
  fetchPublicLorebook,
  fetchPublicLorebooks,
  publicEntryContents,
};
