'use strict';

const { buildWorldInfo, coerceEntries } = require('./worldinfo');

const SYSTEM_PROMPT = `You reconstruct a SillyTavern World Info (lorebook) from raw text.

You are given text that was extracted from an LLM chat prompt. It contains one or more
lorebook entries that a roleplay platform injected into the prompt because their trigger
keywords matched. The character card and user persona have already been removed; what
remains is lorebook entry bodies concatenated together (often separated by blank lines).

Your job:
1. Split the text into discrete, self-contained World Info entries. Each coherent block
   about one topic (a person, place, faction, item, rule, lore fact) is one entry. Do NOT
   merge unrelated topics; do NOT split a single topic across entries.
2. For each entry, write:
   - "content": the entry body, cleaned up but faithful to the source (keep the facts).
   - "key": an array of primary trigger keywords/phrases a chat would mention to surface
     this entry (names, aliases, places, distinctive nouns). Infer them from the content,
     and from the character card if one is provided as context.
   - "keysecondary": optional array of secondary keywords (leave [] if not needed).
   - "comment": a short title for the entry (the topic name).
   - "order": optional integer insertion order (lower = inserted earlier); default 100.
3. Output ONLY a JSON object of the form:
   { "entries": [ { "comment": "...", "key": ["..."], "keysecondary": [], "content": "...", "order": 100 }, ... ] }
No markdown, no prose, no code fences — JSON only.`;

// System prompt for the JS-source path: a JanitorAI "advanced" / Nine API
// lorebook is shipped as JavaScript (e.g. `const loreEntries = [ ... ]`) rather
// than a JSON entries array, so the model recovers the entries from the source.
const SYSTEM_PROMPT_JS = `You reconstruct a SillyTavern World Info (lorebook) from JavaScript source.

You are given the JavaScript source of a JanitorAI "advanced" / Nine API lorebook script. It
typically defines an array of lore entries (often \`const loreEntries = [ ... ]\`), where each
entry is an object with fields such as \`keywords\`/\`keys\`/\`keysRaw\`, \`content\`, \`personality\`,
\`scenario\`, \`name\`/\`title\`/\`category\`, \`constant\`, \`priority\`/\`insertion_order\`, and an
optional \`filters.notWith\` (secondary "not with" keywords). Some scripts assemble entries with
code; recover the resulting lore regardless.

You may also be given the character card and a catalog/world description as CONTEXT — use those
ONLY to infer better keys, never output them as entries.

Your job:
1. Recover every distinct lore entry the script defines. Do NOT invent entries the script does
   not contain; do NOT merge unrelated entries or split a single entry.
2. For each entry, write:
   - "content": the entry body. If an entry has no \`content\` but has \`personality\` and/or
     \`scenario\`, combine those into the content.
   - "key": an array of primary trigger keywords (from \`keywords\`/\`keys\`/\`keysRaw\`).
   - "keysecondary": secondary keywords (e.g. from \`filters.notWith\`), else [].
   - "comment": a short title (from \`name\`/\`title\`/\`category\`).
   - "order": optional integer insertion order (from \`priority\`/\`insertion_order\`); default 100.
3. Output ONLY a JSON object of the form:
   { "entries": [ { "comment": "...", "key": ["..."], "keysecondary": [], "content": "...", "order": 100 }, ... ] }
No markdown, no prose, no code fences — JSON only.`;

// System prompt for the RAW-prompt path: used when the character has an
// "advanced" / Nine API lorebook, whose injected entries the heuristic separator
// cannot reliably isolate. Instead of pre-separating, the model is handed the
// FULL assembled generateAlpha system prompt plus the clean (dot-probed) card and
// scenario as context, and isolates + keys the lore itself.
const SYSTEM_PROMPT_RAW = `You reconstruct a SillyTavern World Info (lorebook) from a roleplay platform's full assembled system prompt.

You are given the COMPLETE system prompt that JanitorAI assembled and sent to its model. It interleaves, in no guaranteed order or markup: a jailbreak / system instruction prefix, the character card (the character's persona), the user's persona, the scenario, example dialogue, AND the lorebook entries that were injected because their trigger keywords matched. The lorebook entries are the ONLY thing you want.

You are SEPARATELY given, as CONTEXT, the clean character card and (when available) the scenario and other material. Use that context to recognize and EXCLUDE the card / persona / scenario / examples / system instructions precisely — whatever genuine lore remains is what you output.

Your job:
1. Isolate ONLY the injected lorebook entries. Exclude the character card and user persona, the scenario, example dialogue, and any jailbreak / system / formatting instructions. When in doubt, keep self-contained world/lore/NPC/rules/setting facts and drop second-person roleplay instructions and anything that merely restates the provided card or scenario.
2. Split the isolated lore into discrete World Info entries — one coherent topic each (a person, place, faction, item, rule, lore fact). Do NOT merge unrelated topics; do NOT split a single topic across entries.
3. For each entry, write:
   - "content": the entry body, cleaned up but faithful to the source (keep the facts).
   - "key": an array of primary trigger keywords/phrases a chat would mention to surface this entry (names, aliases, places, distinctive nouns). Infer them from the content and from the character card context.
   - "keysecondary": optional array of secondary keywords (leave [] if not needed).
   - "comment": a short title for the entry (the topic name).
   - "order": optional integer insertion order (lower = inserted earlier); default 100.
4. Output ONLY a JSON object of the form:
   { "entries": [ { "comment": "...", "key": ["..."], "keysecondary": [], "content": "...", "order": 100 }, ... ] }
No markdown, no prose, no code fences — JSON only.`;

function stripFences(text) {
  let t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) t = fence[1].trim();
  // Fall back to the outermost JSON object/array if there's surrounding chatter.
  const first = t.search(/[[{]/);
  const lastObj = t.lastIndexOf('}');
  const lastArr = t.lastIndexOf(']');
  const last = Math.max(lastObj, lastArr);
  if (first >= 0 && last > first) t = t.slice(first, last + 1);
  return t;
}

/**
 * Call an OpenAI-compatible /chat/completions endpoint to rebuild a lorebook.
 * @param {string} lorebookText
 * @param {{baseUrl:string, apiKey:string, model:string}} cfg
 * @param {{card?:string, catalog?:string, scenario?:string, greetings?:string,
 *        lorebookDescs?:string, extra?:string}} [opts] - context the model may use
 *        ONLY to infer better trigger keys (NONE is treated as lorebook content):
 *        the character card, the public catalog card description, the scenario, the
 *        opening message(s), the public lorebook descriptions, and any custom text.
 * @returns {Promise<{worldInfo:object, rawEntries:Array, modelResponse:string}>}
 */
/**
 * Assemble the exact chat messages sent to the build LLM (system + a single user
 * message that bundles every selected context block followed by the raw lorebook
 * text). Exposed separately so the UI can PREVIEW the prompt without spending a
 * call. Mirrors the opts accepted by {@link extract}.
 */
function buildExtractionMessages(lorebookText, opts = {}) {
  const card = (opts.card || '').trim();
  const catalog = (opts.catalog || '').trim();
  const scenario = (opts.scenario || '').trim();
  const greetings = (opts.greetings || '').trim();
  const lorebookDescs = (opts.lorebookDescs || '').trim();
  const extra = (opts.extra || '').trim();
  const userParts = [];
  if (card) {
    userParts.push(
      'CONTEXT — the character card these entries accompany. Use it ONLY to infer '
      + 'better trigger keys and resolve names/aliases. Do NOT output any of this card '
      + 'text as entries:\n\n' + card,
    );
  }
  if (catalog) {
    userParts.push(
      'CONTEXT — the public catalog description for this character as shown on the '
      + 'site (setting, place and faction names). Use it ONLY to infer better trigger '
      + 'keys. Do NOT output any of this as entries:\n\n' + catalog,
    );
  }
  if (scenario) {
    userParts.push(
      'CONTEXT — the scenario / setup for this roleplay. Use it ONLY to infer better '
      + 'trigger keys (names, places, situations). Do NOT output any of this as '
      + 'entries:\n\n' + scenario,
    );
  }
  if (greetings) {
    userParts.push(
      'CONTEXT — the character\'s opening message(s) / greeting(s). Use them ONLY to '
      + 'infer better trigger keys (names, places, items mentioned). Do NOT output any '
      + 'of this as entries:\n\n' + greetings,
    );
  }
  if (lorebookDescs) {
    userParts.push(
      'CONTEXT — the public descriptions of lorebooks attached to this character '
      + '(titles and descriptions only — the lorebook contents themselves are NOT '
      + 'included here). Use them ONLY to infer better trigger keys. Do NOT output any '
      + 'of this as entries:\n\n' + lorebookDescs,
    );
  }
  if (extra) {
    userParts.push(
      'CONTEXT — additional notes provided by the user (names, aliases, setting '
      + 'details). Use it ONLY to infer better trigger keys. Do NOT output any of '
      + 'this as entries:\n\n' + extra,
    );
  }
  let source;
  let systemPrompt;
  if (opts.fromRaw) {
    source = `Full assembled system prompt — isolate the lorebook entries from it:\n\n${lorebookText}`;
    systemPrompt = SYSTEM_PROMPT_RAW;
  } else if (opts.fromJs) {
    source = `JavaScript lorebook source to convert into entries:\n\n${lorebookText}`;
    systemPrompt = SYSTEM_PROMPT_JS;
  } else {
    source = `Raw lorebook text to convert into entries:\n\n${lorebookText}`;
    systemPrompt = SYSTEM_PROMPT;
  }
  userParts.push(source);
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userParts.join('\n\n---\n\n') },
  ];
}

async function extract(lorebookText, cfg, opts = {}) {
  if (!lorebookText || !lorebookText.trim()) {
    throw new Error('No lorebook text to extract from.');
  }
  if (!cfg || !cfg.baseUrl || !cfg.model) {
    throw new Error('Extraction LLM is not configured (set EXTRACT_BASE_URL / EXTRACT_MODEL).');
  }

  const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

  const messages = buildExtractionMessages(lorebookText, opts);

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.2,
      messages,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Extraction LLM HTTP ${res.status}: ${body.slice(0, 400)}`);
  }

  const data = await res.json();
  const modelResponse = data?.choices?.[0]?.message?.content ?? '';
  if (!modelResponse) throw new Error('Extraction LLM returned an empty response.');

  let parsed;
  try {
    parsed = JSON.parse(stripFences(modelResponse));
  } catch (e) {
    throw new Error(`Could not parse JSON from the model. Raw response:\n${modelResponse.slice(0, 800)}`);
  }

  const rawEntries = coerceEntries(parsed);
  if (!rawEntries.length) {
    throw new Error('The model produced no entries.');
  }

  return {
    worldInfo: buildWorldInfo(rawEntries), rawEntries, modelResponse, messages,
  };
}

module.exports = { extract, buildExtractionMessages, SYSTEM_PROMPT };
