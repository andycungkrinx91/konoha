'use strict';

/**
 * Middle-preserving context slicing and extraction helpers ("Lost-in-the-Middle" guard).
 * Every agent and supervisor prompt, plan compaction, skill truncation, and bridge payload
 * cap routes through these primitives so beginning, middle anchors, and tail survive together.
 */

const ANCHOR_LINE_RE = /^(?:#{1,4}\s+|[-*]\s+|\d+\.\s+|>\s*\[!)|\b(?:MUST|NEVER|ALWAYS|CRITICAL|ERROR|TODO|CONFLICT|worktree|owned_files|decision|Constraint|Invariant|Requirement)\b/i;

function _snapCutStart(text, idx) {
  const nl = text.lastIndexOf('\n', idx);
  const dot = text.lastIndexOf('. ', idx);
  const best = Math.max(nl, dot >= 0 ? dot + 1 : -1);
  if (best >= Math.floor(idx * 0.55)) return best;
  return idx;
}

function _snapCutEnd(text, idx) {
  const nl = text.indexOf('\n', idx);
  const limit = idx + Math.min(80, Math.floor((text.length - idx) * 0.25));
  if (nl !== -1 && nl <= limit) return nl + 1;
  return idx;
}

/**
 * Extract evenly distributed high-signal lines across the middle region [startOffset..endOffset].
 */
function extractKeyMiddleAnchors(text, maxChars = 600, range = {}) {
  const src = typeof text === 'string' ? text : '';
  if (!src || maxChars <= 0) return '';
  const start = Math.max(0, Number.isFinite(range.start) ? range.start : Math.floor(src.length * 0.2));
  const end = Math.min(src.length, Number.isFinite(range.end) ? range.end : Math.floor(src.length * 0.8));
  if (end <= start) return '';

  const middleSlice = src.slice(start, end);
  if (middleSlice.length <= maxChars) return middleSlice.trim();

  const lines = middleSlice.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const priority = lines.filter((l) => ANCHOR_LINE_RE.test(l));
  const pool = priority.length > 0 ? priority : lines;
  if (pool.length === 0) return middleSlice.slice(0, maxChars).trim();

  // Sample evenly from early-middle, center-middle, and late-middle
  const picked = [];
  let used = 0;
  const targetCount = Math.min(pool.length, Math.max(3, Math.floor(maxChars / 60)));
  const step = pool.length / targetCount;
  const seen = new Set();

  for (let i = 0; i < targetCount; i++) {
    const idx = Math.min(pool.length - 1, Math.floor(i * step));
    if (seen.has(idx)) continue;
    seen.add(idx);
    const raw = pool[idx];
    const lineBudget = Math.min(160, maxChars);
    const line = raw.length > lineBudget ? `${raw.slice(0, Math.max(1, lineBudget - 3))}...` : raw;
    const addLen = line.length + (picked.length > 0 ? 1 : 0);
    if (used + addLen > maxChars) break;
    picked.push(line);
    used += addLen;
  }

  if (picked.length === 0) {
    if (priority.length > 0 && maxChars >= 12) {
      return `${priority[0].slice(0, maxChars - 3)}...`;
    }
    return middleSlice.slice(Math.floor((middleSlice.length - maxChars) / 2), Math.floor((middleSlice.length + maxChars) / 2)).trim();
  }
  return picked.join('\n');
}

/**
 * Slice a string to at most `maxChars` while preserving Head (~40%), Middle (~22%), and Tail (~38%).
 */
function slicePreservingHeadMiddleTail(text, maxChars, options = {}) {
  const s = typeof text === 'string' ? text : String(text || '');
  if (!Number.isFinite(maxChars) || maxChars <= 0) return '';
  if (s.length <= maxChars) return s;

  const label = options.markerLabel || 'compacted';
  const compactMarker = ` ...[${label}]... `;
  if (maxChars < 120) {
    if (maxChars <= 16) return s.slice(0, maxChars);
    const keep = maxChars - 3;
    return `${s.slice(0, keep).trimEnd()}...`.slice(0, maxChars);
  }

  const midMarker = options.midMarker || `\n...[${label}:middle-anchor]...\n`;
  const tailMarker = options.tailMarker || `\n...[${label}:tail-anchor]...\n`;
  const markerCost = midMarker.length + tailMarker.length;
  const budget = maxChars - markerCost;
  if (budget <= 60) {
    const keep = Math.max(0, maxChars - compactMarker.length);
    const half = Math.floor(keep / 2);
    return `${s.slice(0, half)}${compactMarker}${s.slice(s.length - (keep - half))}`;
  }

  const headBudget = Math.floor(budget * 0.40);
  const midBudget = Math.floor(budget * 0.22);
  const tailBudget = budget - headBudget - midBudget;

  const headEnd = _snapCutStart(s, headBudget);
  const tailStart = _snapCutEnd(s, Math.max(headEnd, s.length - tailBudget));

  const headStr = s.slice(0, headEnd).trimEnd();
  const tailStr = s.slice(tailStart).trimStart();
  const midRaw = extractKeyMiddleAnchors(s, midBudget, { start: headEnd, end: tailStart });
  const midStr = midRaw || s.slice(
    Math.floor((headEnd + tailStart - midBudget) / 2),
    Math.floor((headEnd + tailStart + midBudget) / 2)
  ).trim();

  if (!midStr) {
    return `${headStr}${tailMarker}${tailStr}`.slice(0, maxChars);
  }
  const combined = `${headStr}${midMarker}${midStr}${tailMarker}${tailStr}`;
  if (combined.length <= maxChars) return combined;

  // Hard converge within maxChars without cutting off tail
  const excess = combined.length - maxChars;
  const trimmedMidLen = Math.max(0, midStr.length - excess);
  const narrowed = trimmedMidLen > 24
    ? `${headStr}${midMarker}${midStr.slice(0, trimmedMidLen)}${tailMarker}${tailStr}`
    : `${headStr.slice(0, Math.max(0, maxChars - tailMarker.length - tailStr.length))}${tailMarker}${tailStr}`;
  return narrowed.slice(0, maxChars);
}

/**
 * UTF-8 byte-accurate counterpart of slicePreservingHeadMiddleTail.
 * Guarantees Buffer.byteLength(result, 'utf8') <= maxBytes while preserving Head + Middle + Tail.
 */
function sliceBytesPreservingHeadMiddleTail(text, maxBytes, options = {}) {
  const s = typeof text === 'string' ? text : String(text || '');
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return '';
  if (Buffer.byteLength(s, 'utf8') <= maxBytes) return s;

  let estChars = Math.min(s.length, maxBytes);
  let out = slicePreservingHeadMiddleTail(s, estChars, options);
  let over = Buffer.byteLength(out, 'utf8') - maxBytes;
  while (over > 0 && estChars > 1) {
    estChars = Math.max(1, estChars - Math.ceil(over / 2) - 1);
    out = slicePreservingHeadMiddleTail(s, estChars, options);
    over = Buffer.byteLength(out, 'utf8') - maxBytes;
  }
  while (Buffer.byteLength(out, 'utf8') > maxBytes && out.length > 0) {
    out = out.slice(0, out.length - 1);
  }
  return out;
}

module.exports = {
  ANCHOR_LINE_RE,
  extractKeyMiddleAnchors,
  slicePreservingHeadMiddleTail,
  sliceBytesPreservingHeadMiddleTail
};
