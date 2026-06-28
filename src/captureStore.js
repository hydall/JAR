'use strict';

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'captures');

function ensureDir() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
}

function fileFor(id) {
  return path.join(DIR, `${id}.json`);
}

/** Short, sortable, collision-resistant id (timestamp + random suffix). */
function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Persist a captured generateAlpha payload.
 * @param {{url:string, payload:object, source?:string}} record
 * @returns {object} the stored record (with id + ts)
 */
function save(record) {
  ensureDir();
  const id = newId();
  const stored = {
    id,
    ts: Date.now(),
    url: record.url || '',
    source: record.source || 'generateAlpha',
    characterId: record.characterId || '',
    characterName: record.characterName || '',
    payload: record.payload,
  };
  fs.writeFileSync(fileFor(id), JSON.stringify(stored, null, 2), 'utf8');
  return stored;
}

/**
 * Persist an INSPECTION record — character metadata, public lorebooks, avatar and
 * key-inference context gathered WITHOUT running the generateAlpha extraction. The
 * `payload` is left null until the user explicitly extracts (see {@link attachPayload}).
 * @param {object} record
 * @returns {object} the stored record (with id + ts)
 */
function saveInspection(record) {
  ensureDir();
  const id = newId();
  const stored = {
    id,
    ts: Date.now(),
    url: record.url || '',
    source: 'inspect',
    characterId: record.characterId || '',
    characterName: record.characterName || '',
    meta: record.meta || null,
    context: record.context || null,
    publicLorebooks: record.publicLorebooks || [],
    avatarBase64: record.avatarBase64 || '',
    character: record.character || null,
    cardPublic: !!record.cardPublic,
    payload: null,
  };
  fs.writeFileSync(fileFor(id), JSON.stringify(stored, null, 2), 'utf8');
  return stored;
}

/**
 * Attach a captured generateAlpha payload to an existing (inspected) record, in
 * place — used by the on-demand "extract" so the capture keeps the same id/context
 * instead of spawning a fresh record.
 * @returns {object|null} the updated record, or null if the id is unknown
 */
function attachPayload(id, payload, source) {
  const rec = get(id);
  if (!rec) return null;
  rec.payload = payload;
  if (source) rec.source = source;
  rec.capturedAt = Date.now();
  fs.writeFileSync(fileFor(id), JSON.stringify(rec, null, 2), 'utf8');
  return rec;
}

function systemContent(payload) {
  const msgs = payload && Array.isArray(payload.messages) ? payload.messages : [];
  const sys = msgs.find((m) => m && m.role === 'system');
  return (sys && typeof sys.content === 'string') ? sys.content : '';
}

/** Lightweight list view (no full payload) for the sidebar. */
function list() {
  ensureDir();
  const out = [];
  for (const name of fs.readdirSync(DIR)) {
    if (!name.endsWith('.json')) continue;
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));
      const sys = systemContent(rec.payload);
      out.push({
        id: rec.id,
        ts: rec.ts,
        source: rec.source,
        model: rec.payload && rec.payload.model ? rec.payload.model : '',
        characterName: rec.characterName || '',
        messageCount: rec.payload && Array.isArray(rec.payload.messages)
          ? rec.payload.messages.length : 0,
        preview: sys.slice(0, 140).replace(/\s+/g, ' ').trim(),
      });
    } catch (_) {
      // skip corrupt files
    }
  }
  out.sort((a, b) => b.ts - a.ts);
  return out;
}

function get(id) {
  const f = fileFor(id);
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (_) {
    return null;
  }
}

function remove(id) {
  const f = fileFor(id);
  if (fs.existsSync(f)) {
    fs.unlinkSync(f);
    return true;
  }
  return false;
}

/**
 * Attach structured key-inference context to a stored capture. `context` is the
 * `{ description, scenario, greetings, lorebooks }` object from buildContextParts;
 * each part is independently toggleable when building with the LLM.
 */
function attachCatalog(id, context) {
  const rec = get(id);
  if (!rec) return false;
  rec.context = context;
  fs.writeFileSync(fileFor(id), JSON.stringify(rec, null, 2), 'utf8');
  return true;
}

function attachCharacter(id, characterId, characterName) {
  const rec = get(id);
  if (!rec) return false;
  rec.characterId = characterId;
  rec.characterName = characterName;
  fs.writeFileSync(fileFor(id), JSON.stringify(rec, null, 2), 'utf8');
  return true;
}

function attachCardData(id, character) {
  const rec = get(id);
  if (!rec) return false;
  rec.character = character;
  fs.writeFileSync(fileFor(id), JSON.stringify(rec, null, 2), 'utf8');
  return true;
}

/** Attach downloaded public lorebooks (converted World Info books) to a capture. */
function attachPublicLorebooks(id, publicLorebooks) {
  const rec = get(id);
  if (!rec) return false;
  rec.publicLorebooks = publicLorebooks;
  fs.writeFileSync(fileFor(id), JSON.stringify(rec, null, 2), 'utf8');
  return true;
}

/**
 * Save the JanitorAI chat id associated with a capture record, so future
 * extractions can reuse the same chat instead of creating a new one.
 */
function attachChatId(id, chatId) {
  const rec = get(id);
  if (!rec) return false;
  rec.chatId = chatId;
  fs.writeFileSync(fileFor(id), JSON.stringify(rec, null, 2), 'utf8');
  return true;
}

/** Remove the chat id from a record (after the chat was deleted). */
function clearChatId(id) {
  const rec = get(id);
  if (!rec) return false;
  delete rec.chatId;
  fs.writeFileSync(fileFor(id), JSON.stringify(rec, null, 2), 'utf8');
  return true;
}

module.exports = {
  save, saveInspection, attachPayload, list, get, remove,
  attachCatalog, attachCharacter, attachCardData,
  attachPublicLorebooks, attachChatId, clearChatId,
  systemContent, DIR,
};
