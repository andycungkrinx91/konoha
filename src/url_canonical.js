'use strict';

/**
 * src/url_canonical.js — URL canonicalization shared by web search and the
 * Chunin knowledge store.
 *
 * Kept in its own module so `web_search.js` can dedupe without pulling in the
 * database or the embedding pipeline.
 */

// Tracking parameters that never change which page is served.
const TRACKING_PARAM_RE = /^(utm_[a-z_]+|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|source|igshid|yclid|_ga)$/i;

/**
 * Canonicalizes a URL for dedupe: forces https, lowercases the host, drops
 * tracking parameters, sorts the rest, and removes a trailing slash, an
 * index page or a fragment. Two spellings of the same page collapse to one key.
 *
 * @param {string} rawUrl
 * @returns {string} canonical form, or '' when the input is not an http(s) URL
 */
function canonicalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (_) {
    return '';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';

  parsed.protocol = 'https:';
  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.hash = '';

  const keep = [];
  for (const [key, value] of parsed.searchParams.entries()) {
    if (TRACKING_PARAM_RE.test(key)) continue;
    keep.push([key, value]);
  }
  keep.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  parsed.search = '';
  for (const [key, value] of keep) parsed.searchParams.append(key, value);

  let out = parsed.toString();
  // 'https://a.com' renders as 'https://a.com/'. Strip a trailing slash from a
  // non-root path whether or not a query is present, so '/a/?b=2' and '/a?b=2'
  // are the same page.
  if (parsed.pathname && parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    out = parsed.toString();
  }
  if (parsed.pathname === '/' && !parsed.search) out = out.replace(/\/$/, '');
  out = out.replace(/\/index\.html?$/i, '');
  return out;
}

module.exports = { canonicalizeUrl, TRACKING_PARAM_RE };
