'use strict';

/**
 * Pre-provider compression for web-derived tool output.
 *
 * Research agents pull documentation and reference pages whose payload is
 * mostly markup, scripts, and navigation chrome. Sending raw HTML upstream
 * bills the same boilerplate on every turn, so pages are reduced to their
 * readable text before the bridge forwards them. Anchors keep their absolute
 * URL next to the link text so citations survive the reduction.
 */

const MIN_HTML_LENGTH = 1200;
const MIN_TAG_COUNT = 20;
const STRUCTURAL_MARKER = /<(?:!doctype\s+html|html|head|body)\b/i;
const TAG_PATTERN = /<[a-zA-Z][^>]{0,400}>/g;

const RAW_TEXT_ELEMENTS = /<(script|style|noscript|svg|iframe|template|canvas|object|embed)\b[\s\S]*?<\/\1\s*>/gi;
const HEAD_ELEMENT = /<head\b[\s\S]*?<\/head\s*>/gi;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const ANCHOR_ELEMENT = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi;
const ANY_TAG = /<[^>]*>/g;

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  rsquo: '\u2019',
  lsquo: '\u2018',
  ldquo: '\u201c',
  rdquo: '\u201d'
};

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name) => {
      const value = NAMED_ENTITIES[name.toLowerCase()];
      return value === undefined ? match : value;
    });
}

/**
 * A payload counts as HTML only when it is long enough to be a page, opens
 * with a structural tag, and carries a real amount of markup. JSON responses
 * and source code embed angle brackets without meeting all three conditions.
 */
function looksLikeHtml(text) {
  if (typeof text !== 'string' || text.length < MIN_HTML_LENGTH) return false;
  const head = text.slice(0, 4000);
  if (!STRUCTURAL_MARKER.test(head)) return false;
  const tags = text.match(TAG_PATTERN);
  return Array.isArray(tags) && tags.length >= MIN_TAG_COUNT;
}

function normaliseWhitespace(text) {
  const lines = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/[ \t\u00a0]+/g, ' ').trim();
    if (line === '') {
      if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
      continue;
    }
    lines.push(line);
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

/**
 * Reduce an HTML document to readable text. Link targets are preserved as
 * `text (url)` so a research claim can still be cited after compression.
 */
function htmlToText(html) {
  if (typeof html !== 'string' || html === '') return '';
  const withoutComments = html.replace(HTML_COMMENT, ' ');
  const withoutHead = withoutComments.replace(HEAD_ELEMENT, ' ');
  const withoutRawText = withoutHead.replace(RAW_TEXT_ELEMENTS, ' ');
  const withCitations = withoutRawText.replace(ANCHOR_ELEMENT, (match, href, inner) => {
    const label = inner.replace(ANY_TAG, ' ').replace(/\s+/g, ' ').trim();
    const target = String(href).trim();
    if (!/^https?:\/\//i.test(target)) return label ? ` ${label} ` : ' ';
    if (label === '') return ` (${target}) `;
    if (label === target) return ` ${target} `;
    return ` ${label} (${target}) `;
  });
  const blockBreaks = withCitations.replace(/<\/(?:p|div|li|tr|h[1-6]|section|article|pre|blockquote|td|th)\s*>/gi, '\n');
  const lineBreaks = blockBreaks.replace(/<br\s*\/?>/gi, '\n');
  const plain = decodeEntities(lineBreaks.replace(ANY_TAG, ' '));
  return normaliseWhitespace(plain);
}

/**
 * Compress one tool-result string when it is markup. Returns the original
 * value untouched for plain text, JSON, and code so nothing unrelated is
 * rewritten in transit.
 */
function compressWebOutput(content) {
  if (!looksLikeHtml(content)) return { text: content, changed: false, kind: 'passthrough' };
  const text = htmlToText(content);
  if (text === '' || text.length >= content.length) {
    return { text: content, changed: false, kind: 'passthrough' };
  }
  return { text, changed: true, kind: 'html' };
}

module.exports = {
  MIN_HTML_LENGTH,
  MIN_TAG_COUNT,
  looksLikeHtml,
  htmlToText,
  compressWebOutput,
  decodeEntities
};
