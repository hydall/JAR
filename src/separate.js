'use strict';

/**
 * Isolate the injected closed-lorebook text from a captured JanitorAI
 * `generateAlpha` payload's system message.
 *
 * JanitorAI assembles `messages[0].content` (role: system) as:
 *   [ jailbreak / system prefix ]            <- leading bracketed block(s)
 *   <{{char}}'s Persona> ... </...Persona>   <- character card
 *   <UserPersona> ... </UserPersona>         <- user persona
 *   <triggered lorebook entries ...>         <- everything else (what we want)
 *
 * We strip the known wrappers (tag-aware) and optionally subtract a
 * user-pasted known card to remove card text that wasn't tag-wrapped.
 */

function norm(s) {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

function getSystemContent(payload) {
  const msgs = payload && Array.isArray(payload.messages) ? payload.messages : [];
  const sys = msgs.find((m) => m && m.role === 'system');
  return (sys && typeof sys.content === 'string') ? sys.content : '';
}

/** Remove leading bracketed jailbreak/system prefix and `<...Persona>` blocks. */
function stripWrappers(text) {
  const removed = [];
  let out = text;

  // Leading bracketed jailbreak prefix(es) at the very start of the prompt.
  out = out.replace(/^\s*(?:\[[^\]]*\]\s*)+/, (m) => {
    const t = m.trim();
    if (t) removed.push({ label: 'jailbreak', text: t });
    return '';
  });

  // Persona-style tag blocks: <Char's Persona>...</...Persona> and
  // <UserPersona>...</UserPersona>. Lazy match stops at the first matching close.
  out = out.replace(/<[^<>\n]*?Persona>[\s\S]*?<\/[^<>\n]*?Persona>/gi, (m) => {
    const label = /^<\s*userpersona/i.test(m) ? 'userPersona' : 'card';
    removed.push({ label, text: m });
    return '\n';
  });

  // Other JanitorAI scaffolding wrappers that are not lorebook content:
  // <Scenario>...</Scenario>, <Example dialogs>...</...>, etc.
  out = out.replace(/<Scenario>[\s\S]*?<\/Scenario>/gi, (m) => {
    removed.push({ label: 'scenario', text: m });
    return '\n';
  });
  out = out.replace(/<Example[^<>\n]*>[\s\S]*?<\/Example[^<>\n]*>/gi, (m) => {
    removed.push({ label: 'example', text: m });
    return '\n';
  });

  return { out, removed };
}

/** Drop lines from `text` that also appear (whitespace-normalized) in knownCard. */
function subtractKnownCard(text, knownCard) {
  if (!knownCard || !knownCard.trim()) return { out: text, removed: [] };
  const known = new Set();
  for (const line of knownCard.split('\n')) {
    const n = norm(line);
    if (n.length >= 12) known.add(n);
  }
  const removed = [];
  const kept = [];
  for (const line of text.split('\n')) {
    const n = norm(line);
    if (n.length >= 12 && known.has(n)) removed.push(line);
    else kept.push(line);
  }
  return { out: kept.join('\n'), removed };
}

/**
 * Build a whitespace/punctuation-tolerant regex source from a verbatim string.
 *
 * The public-entry content is injected into `generateAlpha` verbatim, but the
 * server (and our own tidying) can change *whitespace* (collapse runs, swap
 * newlines for spaces, trim) and *glyphs* (straight vs. curly quotes/apostrophes,
 * hyphen vs. en/em dash). We match literally except that:
 *  - any whitespace run matches any other whitespace run (`\s+`),
 *  - quote/apostrophe/dash variants match each other.
 * Everything else (including regex metacharacters) is escaped to a literal.
 */
function loosePattern(needle) {
  return needle
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')                         // escape metachars
    .replace(/\s+/g, '\\s+')                                        // any whitespace run
    .replace(/['‘’ʼ]/g, "['\\u2018\\u2019\\u02BC]")  // ' ' ' ʼ
    .replace(/["“”]/g, '["\\u201C\\u201D]')              // " " "
    .replace(/[-–—]/g, '[-\\u2013\\u2014]');             // - – —
}

/**
 * Remove PUBLIC-lorebook entry text from the isolated lorebook text.
 *
 * A character's public and closed lorebooks are injected into the SAME
 * `generateAlpha` system message, so the extracted text contains both. The public
 * entries' `content` is injected **verbatim**, so we just cut it back out — no
 * fuzzy matching, only the whitespace/glyph tolerance of {@link loosePattern}.
 * Entries that never triggered simply aren't found and are skipped.
 *
 * @param {string} text
 * @param {string[]} publicContents  verbatim entry contents from public lorebooks
 * @returns {{out:string, removed:string[]}}
 */
function stripPublicEntries(text, publicContents) {
  if (!Array.isArray(publicContents) || !publicContents.length) {
    return { out: text, removed: [] };
  }
  let out = text;
  const removed = [];
  for (const content of publicContents) {
    const needle = String(content || '').trim();
    if (needle.length < 12) continue;
    let re;
    try { re = new RegExp(loosePattern(needle), 'gi'); } catch (_) { continue; }
    out = out.replace(re, (m) => { removed.push(m); return '\n'; });
  }
  return { out, removed };
}

function tidy(text) {
  return text
    .replace(/[ \t]+\n/g, '\n')   // trailing spaces
    .replace(/\n{3,}/g, '\n\n')   // collapse big gaps
    .trim();
}

/** Split lorebook text into candidate entry blocks (blank-line separated). */
function splitEntries(text) {
  return text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

/**
 * Pull the character-card text (inner of `<{{char}}'s Persona>…</…>`, NOT the
 * user persona) out of a captured payload. Used by auto-trigger to re-send the
 * card as a chat message so the closed lorebook fires on as many keys as possible.
 * @returns {string} card text, or '' if none found
 */
function extractCard(payload) {
  const sys = getSystemContent(payload);
  const re = /<([^<>\n]*?)Persona>([\s\S]*?)<\/[^<>\n]*?Persona>/gi;
  let m;
  while ((m = re.exec(sys))) {
    if (/^\s*user/i.test(m[1])) continue; // skip <UserPersona>
    return m[2].trim();
  }
  return '';
}

/** The character name encoded in the `<{{char}}'s Persona>` opening tag. */
function extractCharName(payload) {
  const sys = getSystemContent(payload);
  const m = sys.match(/<([^<>\n]*?)Persona>/i);
  if (m) {
    const name = m[1].replace(/['’]s\s*$/i, '').trim();
    if (name.toLowerCase() !== 'user') return name;
  }
  return '';
}

/** Inner text of `<Scenario>…</Scenario>` if JanitorAI injected one. */
function extractScenario(payload) {
  const sys = getSystemContent(payload);
  const m = sys.match(/<Scenario>([\s\S]*?)<\/Scenario>/i);
  return m ? m[1].trim() : '';
}

/** Inner text of `<Example…>…</Example…>` (example dialogue) if present. */
function extractExample(payload) {
  const sys = getSystemContent(payload);
  const m = sys.match(/<Example[^<>\n]*?>([\s\S]*?)<\/Example[^<>\n]*?>/i);
  return m ? m[1].trim() : '';
}

/** The bot's first message — the first assistant turn in the captured payload. */
function extractFirstMessage(payload) {
  const msgs = payload && Array.isArray(payload.messages) ? payload.messages : [];
  const assistant = msgs.find((m) => m && m.role === 'assistant');
  return assistant && typeof assistant.content === 'string' ? assistant.content.trim() : '';
}

/**
 * @param {object} payload - captured generateAlpha body (or {messages})
 * @param {string} [knownCard] - optional pasted character-card text to subtract
 * @param {string[]} [publicContents] - verbatim entry contents of the character's
 *   PUBLIC lorebooks, always subtracted so they don't leak into the closed book
 * @returns {{lorebookText:string, removed:object[], entries:string[], systemContent:string}}
 */
function separate(payload, knownCard, publicContents) {
  const systemContent = getSystemContent(payload);
  const a = stripWrappers(systemContent);
  const b = subtractKnownCard(a.out, knownCard);
  const c = stripPublicEntries(b.out, publicContents);
  const lorebookText = tidy(c.out);
  const removed = a.removed.concat(
    b.removed.length
      ? [{ label: 'knownCard', text: b.removed.join('\n') }]
      : [],
    c.removed.length
      ? [{ label: 'publicLorebook', text: c.removed.join('\n\n') }]
      : [],
  );
  return {
    systemContent,
    lorebookText,
    removed,
    entries: splitEntries(lorebookText),
  };
}

module.exports = {
  separate,
  splitEntries,
  getSystemContent,
  extractCard,
  extractCharName,
  extractScenario,
  extractExample,
  extractFirstMessage,
};
