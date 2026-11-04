'use strict';

/**
 * Rounded-path geometry for the flow diagrams.
 *
 * Every connector in every Konoha workflow is emitted by `stdLink`, which funnels
 * the raw `d` string through `roundCorners`. Interior right angles are replaced by
 * quadratic corners so no link ever renders as a hard elbow.
 */

/** Round every interior corner of a polyline path so links never show a hard elbow. */
function _roundedNum(v) {
  const r = Math.round(v * 100) / 100;
  return String(r);
}

function _cornerPoints(chain, radius, emit, open) {
  const len = chain.length;
  if (len === 1) { if (!open) emit(`M ${_roundedNum(chain[0][0])} ${_roundedNum(chain[0][1])}`); return; }
  const head = `M ${_roundedNum(chain[0][0])} ${_roundedNum(chain[0][1])}`;
  let d = open ? `L ${_roundedNum(chain[1][0])} ${_roundedNum(chain[1][1])}` : head;
  for (let k = open ? 2 : 1; k < len; k += 1) {
    const prev = chain[k - 1];
    const pt = chain[k];
    const next = chain[k + 1];
    const inLen = Math.hypot(pt[0] - prev[0], pt[1] - prev[1]);
    const outLen = next ? Math.hypot(next[0] - pt[0], next[1] - pt[1]) : 0;
    const cross = next
      ? (pt[0] - prev[0]) * (next[1] - pt[1]) - (pt[1] - prev[1]) * (next[0] - pt[0])
      : 0;
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (!next || Math.abs(cross) < 0.5 || r < 1.5) {
      d += ` L ${_roundedNum(pt[0])} ${_roundedNum(pt[1])}`;
      continue;
    }
    const a = [pt[0] + ((prev[0] - pt[0]) * r) / inLen, pt[1] + ((prev[1] - pt[1]) * r) / inLen];
    const b = [pt[0] + ((next[0] - pt[0]) * r) / outLen, pt[1] + ((next[1] - pt[1]) * r) / outLen];
    d += ` L ${_roundedNum(a[0])} ${_roundedNum(a[1])} Q ${_roundedNum(pt[0])} ${_roundedNum(pt[1])} ${_roundedNum(b[0])} ${_roundedNum(b[1])}`;
  }
  emit(d);
}

function roundCorners(d, radius = 16) {
  const tokens = String(d).match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)/g) || [];
  const parts = [];
  let chain = null;
  let openChain = false;
  const flush = () => {
    if (chain && chain.length) _cornerPoints(chain, radius, (s) => parts.push(s), openChain);
    chain = null;
    openChain = false;
  };
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (!/[A-Za-z]/.test(tok)) { i += 1; continue; }
    const cmd = tok.toUpperCase();
    if (cmd === 'M' || cmd === 'L') {
      const pt = [Number(tokens[i + 1]), Number(tokens[i + 2])];
      if (cmd === 'M') {
        flush();
        chain = [pt];
      } else if (chain) {
        chain.push(pt);
      } else {
        chain = [pt];
        openChain = parts.length > 0;
      }
      i += 3;
    } else if (cmd === 'C') {
      const c = tokens.slice(i + 1, i + 7).map(Number);
      flush();
      parts.push(`C ${c.map(_roundedNum).join(' ')}`.replace(/^C (\S+) (\S+) (\S+) (\S+) (\S+) (\S+)$/, 'C $1 $2, $3 $4, $5 $6'));
      chain = [[c[4], c[5]]];
      openChain = true;
      i += 7;
    } else if (cmd === 'Z') {
      flush();
      parts.push('Z');
      i += 1;
    } else {
      i += 1;
    }
  }
  flush();
  return parts.join(' ');
}

module.exports = { roundCorners };
