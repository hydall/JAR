'use strict';

/**
 * Public lorebooks.
 *
 * A JanitorAI character can have **public** lorebooks attached to it (the
 * `scripts` array in the catalog/character metadata, items of `type:"lorebook"`).
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
    .filter((s) => s && s.type === 'lorebook' && (s.id != null))
    .map((s) => ({
      id: String(s.id),
      title: s.title || '',
      isPublic: s.is_public !== false,
    }));
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
  return {
    id: String(rec.id || scriptId),
    title: rec.title || ref.title || '',
    description: rec.description || '',
    isPublic: rec.is_public === true,
    isCodePublic: rec.is_code_public === true,
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
  parseScriptEntries,
  fetchPublicLorebook,
  fetchPublicLorebooks,
  publicEntryContents,
};
