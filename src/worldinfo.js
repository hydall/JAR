'use strict';

/**
 * Normalize loosely-shaped entries (as produced by the extraction LLM) into a
 * valid SillyTavern World Info book that imports directly via
 * "World Info / Lorebook -> Import".
 */

function asArray(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string') {
    return v.split(',').map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

function buildEntry(raw, uid) {
  const key = asArray(raw.key || raw.keys || raw.keywords);
  const keysecondary = asArray(raw.keysecondary || raw.secondary_keys || raw.keySecondary);
  const content = String(raw.content || raw.text || '').trim();
  const comment = String(
    raw.comment || raw.title || raw.name || raw.category || `Entry ${uid}`,
  ).trim();
  const order = Number.isFinite(raw.order) ? raw.order
    : Number.isFinite(raw.priority) ? raw.priority
      : Number.isFinite(raw.insertion_order) ? raw.insertion_order : 100;
  const constant = raw.constant === true;
  // SillyTavern stores probability on a 0-100 scale; tolerate a 0-1 fraction.
  const probability = raw.probability === undefined ? 100
    : (raw.probability <= 1 ? raw.probability * 100 : raw.probability);

  // Schema mirrors hydall/LorebookConverter (script.js) — a known-good importer
  // for current SillyTavern World Info, so output imports without warnings.
  return {
    uid,
    key,
    keysecondary,
    comment,
    content,
    constant,
    selective: !constant,
    order,
    position: Number.isFinite(raw.position) ? raw.position : 0,
    disable: raw.enabled === false,
    displayIndex: uid,
    addMemo: true,
    group: '',
    groupOverride: false,
    groupWeight: Number.isFinite(raw.groupWeight) ? raw.groupWeight : 100,
    sticky: 0,
    cooldown: 0,
    delay: 0,
    probability,
    depth: 4,
    useProbability: true,
    role: null,
    vectorized: false,
    excludeRecursion: false,
    preventRecursion: false,
    delayUntilRecursion: false,
    scanDepth: null,
    caseSensitive: raw.case_sensitive !== undefined ? raw.case_sensitive : null,
    matchWholeWords: raw.matchWholeWords !== undefined ? raw.matchWholeWords : null,
    useGroupScoring: null,
    automationId: '',
    selectiveLogic: Number.isFinite(raw.selectiveLogic) ? raw.selectiveLogic : 0,
    ignoreBudget: false,
    matchPersonaDescription: false,
    matchCharacterDescription: false,
    matchCharacterPersonality: false,
    matchCharacterDepthPrompt: false,
    matchScenario: false,
    matchCreatorNotes: false,
    outletName: '',
    triggers: [],
    characterFilter: { isExclude: false, names: [], tags: [] },
  };
}

/**
 * @param {Array<object>} rawEntries
 * @returns {{entries: Object<string, object>}}
 */
function buildWorldInfo(rawEntries) {
  const entries = {};
  let uid = 0;
  for (const raw of rawEntries) {
    if (!raw) continue;
    const entry = buildEntry(raw, uid);
    if (!entry.content) continue; // skip empty
    entries[String(uid)] = entry;
    uid += 1;
  }
  return { entries };
}

/** Coerce whatever the LLM returned into an array of raw entry objects. */
function coerceEntries(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.entries)) return parsed.entries;
  if (parsed && parsed.entries && typeof parsed.entries === 'object') {
    return Object.values(parsed.entries);
  }
  if (parsed && Array.isArray(parsed.lorebook)) return parsed.lorebook;
  return [];
}

module.exports = { buildWorldInfo, buildEntry, coerceEntries };
