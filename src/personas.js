'use strict';

/**
 * Ensure a JanitorAI persona literally named `{{user}}` exists (and is selectable)
 * for a run.
 *
 * Why: when JanitorAI assembles the `/generateAlpha` prompt it substitutes the
 * `{{user}}` macro with the ACTIVE persona's name (falling back to the account
 * display name, e.g. "Andrew"). Closed-lorebook entries frequently reference
 * `{{user}}`; if the substitution bakes in a real name, the extracted World Info
 * is no longer portable. By selecting a persona whose name is the literal string
 * `{{user}}`, the substitution is a no-op and the macro survives in the capture.
 *
 * This module owns the create/lookup half. Selection (binding the persona to the
 * chat so `generateAlpha` carries it) is wired in by the caller — see
 * {@link createChat} in ./autotrigger, which accepts the persona id.
 */

const { authedFetch } = require('./autotrigger');

const PERSONAS_URL = 'https://janitorai.com/hampter/personas';

// The macro we want left untouched. JanitorAI substitutes a persona's `name`
// verbatim, so a persona named exactly this makes `{{user}}` -> `{{user}}`.
const USER_MACRO_NAME = '{{user}}';

/** Coerce the personas endpoint's response into a plain array of persona objects. */
function asPersonaList(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.personas)) return parsed.personas;
  if (parsed && Array.isArray(parsed.data)) return parsed.data;
  return [];
}

/** GET the caller's personas. Returns [] if the list can't be read. */
async function listPersonas(page) {
  const r = await authedFetch(page, PERSONAS_URL);
  if (r.status >= 400) throw new Error(`list personas failed: HTTP ${r.status}`);
  try { return asPersonaList(JSON.parse(r.body)); } catch (e) {
    throw new Error('list personas: response was not JSON');
  }
}

/**
 * Create a persona. Payload mirrors the JanitorAI web client's POST body exactly
 * (empty appearance/avatar, null group/pronouns) so the server accepts it.
 * @returns {Promise<object>} the created persona (with its `id`)
 */
async function createPersona(page, name) {
  const r = await authedFetch(page, PERSONAS_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      appearance: '', avatar: '', groupId: null, name, pronouns: null,
    }),
  });
  if (r.status >= 400) {
    throw new Error(`create persona failed: HTTP ${r.status} ${r.body.slice(0, 200)}`);
  }
  try { return JSON.parse(r.body); } catch (e) {
    throw new Error('create persona: response was not JSON');
  }
}

/**
 * Find an existing persona named exactly `{{user}}`, or create one. Idempotent:
 * re-runs reuse the same persona instead of piling up duplicates.
 * @returns {Promise<object>} the `{{user}}` persona (with its `id`)
 */
async function ensureUserMacroPersona(page) {
  let existing = [];
  try { existing = await listPersonas(page); } catch (e) {
    // A failed list is non-fatal — fall through and create one.
    console.warn('[persona] could not list personas:', e.message);
  }
  const found = existing.find((p) => p && p.name === USER_MACRO_NAME);
  if (found) {
    console.log(`[persona] reusing existing "${USER_MACRO_NAME}" persona ${found.id}`);
    return found;
  }
  const created = await createPersona(page, USER_MACRO_NAME);
  console.log(`[persona] created "${USER_MACRO_NAME}" persona ${created.id}`);
  return created;
}

/**
 * Delete a persona by id. Used to clean up the throwaway `{{user}}` persona after
 * a run so it doesn't clutter the account. Best-effort: a failed delete is logged,
 * not thrown.
 */
async function deletePersona(page, personaId) {
  if (!personaId) return false;
  const r = await authedFetch(page, `${PERSONAS_URL}/${personaId}`, { method: 'DELETE' });
  if (r.status >= 400) {
    console.warn(`[persona] delete failed: HTTP ${r.status} ${r.body.slice(0, 200)}`);
    return false;
  }
  console.log(`[persona] deleted persona ${personaId}`);
  return true;
}

module.exports = {
  listPersonas, createPersona, ensureUserMacroPersona, deletePersona,
  PERSONAS_URL, USER_MACRO_NAME,
};
