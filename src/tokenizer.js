'use strict';

// Token counting that mirrors GlazeFlutter's tokenizer: OpenAI o200k_base BPE,
// with a small in-process cache and a ~4-chars/token fallback if encoding fails.
// Base64-encoded images / data URIs are stripped before counting (they inflate
// char/byte counts but are not what the LLM tokenizes).

// eslint-disable-next-line import/no-unresolved
const { encode } = require('gpt-tokenizer/encoding/o200k_base');

const _cache = new Map();

/** Approximate token count: ~1 token per 4 characters (rough English estimate). */
function approxTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Strip base64 images / data URIs before counting — they bloat the char count
 * but are not sent to the LLM as text. Mirrors Glaze's _stripBase64Media.
 */
function stripBase64Media(text) {
  if (text.length < 256) return text;
  return text
    .replace(/<img\s+src="data:image\/[^"]{256,}?"\s*\/?>/g, '')
    .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]{256,}/g, '');
}

/**
 * Estimate o200k_base token count for [text], with persistent in-process caching.
 * @param {string} text
 * @returns {number}
 */
function countTokens(text) {
  if (!text) return 0;
  const cleaned = stripBase64Media(String(text));
  if (!cleaned) return 0;

  const cached = _cache.get(cleaned);
  if (cached !== undefined) return cached;

  let count;
  try {
    count = encode(cleaned).length;
  } catch (_) {
    count = approxTokens(cleaned);
  }
  _cache.set(cleaned, count);
  return count;
}

module.exports = { countTokens };
