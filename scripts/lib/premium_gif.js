'use strict';

/**
 * Premium diagram-GIF toolkit for Konoha asset generation.
 *
 * Dark "mission control" theme: ink gradient canvas with a faint dot grid,
 * frosted-glass node cards with soft elevation shadows, gradient connectors
 * with animated marching dashes, glow pulses, ring gauges and verdict stamps.
 * Built on the shared @napi-rs/canvas + gifenc helpers (scripts/lib/shared.js).
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { saveGif } = require('./shared');

/* ------------------------------------------------------------------ *
 * Fonts — DejaVu family (guaranteed present on the asset-build host)
 * ------------------------------------------------------------------ */

const FONTS = [
  ['/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf', 'KonohaTitle'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 'KonohaBold'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'KonohaSans'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 'KonohaMono'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf', 'KonohaMonoBold'],
];
let fontsReady = false;
function registerPremiumFonts() {
  if (fontsReady) return;
  for (const [p, name] of FONTS) {
    if (fs.existsSync(p) && !GlobalFonts.has(name)) GlobalFonts.registerFromPath(p, name);
  }
  fontsReady = true;
}

/** Font string by role: title | bold | sans | mono | monobold. */
function font(role, size) {
  registerPremiumFonts();
  const map = {
    title: 'KonohaTitle',
    bold: 'KonohaBold',
    sans: 'KonohaSans',
    mono: 'KonohaMono',
    monobold: 'KonohaMonoBold',
  };
  return `${size}px "${map[role] || 'KonohaSans'}"`;
}

/* ------------------------------------------------------------------ *
 * Theme
 * ------------------------------------------------------------------ */

const THEME = {
  inkTop: '#0B1020',
  inkBottom: '#141B36',
  dot: 'rgba(148,163,184,0.09)',
  titleText: '#E7ECF8',
  subtitleText: '#7C8DB0',
  footerText: '#5B6B8C',
  cardFill: 'rgba(255,255,255,0.045)',
  cardEdge: 'rgba(255,255,255,0.16)',
  cardEdgeSoft: 'rgba(255,255,255,0.09)',
  nodeTitle: '#EDF2FB',
  nodeDetail: '#8DA2BD',
  chipText: '#C7D2E8',
  violet: [124, 58, 237],
  blue: [59, 130, 246],
  cyan: [34, 211, 238],
  emerald: [52, 211, 153],
  amber: [245, 158, 11],
  red: [248, 113, 113],
  slate: [148, 163, 184],
};

/** rgba() string from an [r,g,b] tuple. */
function rgba(rgb, a = 1) {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
}

/* ------------------------------------------------------------------ *
 * Canvas primitives
 * ------------------------------------------------------------------ */

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Base background: ink gradient + faint dot grid + center brand wash. */
function baseCanvas(W, H) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, THEME.inkTop);
  g.addColorStop(1, THEME.inkBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = THEME.dot;
  for (let y = 18; y < H; y += 26) {
    for (let x = 18; x < W; x += 26) {
      ctx.beginPath();
      ctx.arc(x, y, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const wash = ctx.createRadialGradient(W / 2, H * 0.32, 60, W / 2, H * 0.5, W * 0.72);
  wash.addColorStop(0, 'rgba(124,58,237,0.07)');
  wash.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);
  return canvas;
}

/**
 * Frosted-glass node card.
 * node: { x, y, w, h, accent, title, detail?, chips? }
 * opts: { alpha, glow }
 */
function glassCard(ctx, node, opts = {}) {
  const { x, y, w, h, accent, title, detail, chips } = node;
  const alpha = opts.alpha ?? 1;
  const glow = opts.glow ?? false;
  ctx.save();
  ctx.globalAlpha = alpha;

  ctx.shadowColor = 'rgba(2,6,23,0.65)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 5;
  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = THEME.cardFill;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  roundRect(ctx, x + 1, y + 1, w - 2, h - 2, 11);
  ctx.strokeStyle = THEME.cardEdgeSoft;
  ctx.lineWidth = 1;
  ctx.stroke();

  roundRect(ctx, x, y, w, h, 12);
  if (glow) {
    ctx.strokeStyle = rgba(accent, 0.95);
    ctx.lineWidth = 2;
    ctx.shadowColor = rgba(accent, 0.55);
    ctx.shadowBlur = 16;
    ctx.stroke();
    ctx.shadowBlur = 0;
  } else {
    ctx.strokeStyle = THEME.cardEdge;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  roundRect(ctx, x, y + 10, 3.5, h - 20, 2);
  ctx.fillStyle = rgba(accent, glow ? 1 : 0.7);
  ctx.fill();

  ctx.textAlign = 'center';
  const titleY = chips ? y + 21 : detail ? y + 22 : y + h / 2 + 5;
  ctx.font = font('title', 14);
  ctx.fillStyle = glow ? '#FFFFFF' : THEME.nodeTitle;
  ctx.fillText(title, x + w / 2, titleY);
  if (detail) {
    ctx.font = font('mono', 10);
    ctx.fillStyle = glow ? '#C9D6EE' : THEME.nodeDetail;
    ctx.fillText(detail, x + w / 2, chips ? y + 37 : y + 39);
  }
  if (chips) drawChips(ctx, chips, x + w / 2, y + h - 17, accent, alpha);
  ctx.restore();
}

/** Centered row of small tag chips inside a card. */
function drawChips(ctx, chips, cx, cy, accent, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = font('mono', 9);
  const padX = 9;
  const gap = 6;
  const widths = chips.map((c) => ctx.measureText(c).width + padX * 2);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (chips.length - 1);
  let x = cx - total / 2;
  chips.forEach((c, i) => {
    roundRect(ctx, x, cy - 8, widths[i], 16, 8);
    ctx.fillStyle = rgba(accent, 0.14);
    ctx.fill();
    ctx.strokeStyle = rgba(accent, 0.45);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = THEME.chipText;
    ctx.textAlign = 'left';
    ctx.fillText(c, x + padX, cy + 3.5);
    x += widths[i] + gap;
  });
  ctx.restore();
}

/** Numbered step badge (circle) on the flow spine. */
function stepBadge(ctx, cx, cy, n, accent, alpha = 1, glow = false) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(cx, cy, 13, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(15,20,40,0.9)';
  ctx.fill();
  ctx.strokeStyle = rgba(accent, glow ? 1 : 0.7);
  ctx.lineWidth = glow ? 2 : 1.4;
  if (glow) {
    ctx.shadowColor = rgba(accent, 0.6);
    ctx.shadowBlur = 10;
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.font = font('monobold', 12);
  ctx.fillStyle = glow ? '#FFFFFF' : rgba(accent, 0.95);
  ctx.textAlign = 'center';
  ctx.fillText(String(n), cx, cy + 4);
  ctx.restore();
}

/**
 * Gradient connector along a polyline, with optional marching dashes and
 * an arrowhead at the end. opts: { from, to, alpha, dash, dashOffset,
 * dashed, width, arrow }
 */
function connector(ctx, pts, opts = {}) {
  const { from = THEME.violet, to = THEME.cyan, alpha = 0.9, width = 1.8 } = opts;
  if (alpha <= 0 || pts.length < 2) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const g = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
  g.addColorStop(0, rgba(from, 0.95));
  g.addColorStop(1, rgba(to, 0.95));
  ctx.strokeStyle = g;
  ctx.lineWidth = width;
  if (opts.dashed || opts.dash) {
    ctx.setLineDash(opts.dash || [6, 5]);
    ctx.lineDashOffset = opts.dashOffset || 0;
  }
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
  ctx.setLineDash([]);
  if (opts.arrow !== false) arrowhead(ctx, pts[pts.length - 2], b, to);
  ctx.restore();
}

/** Dashed quadratic curve connector (for loop-back edges). */
function curveConnector(ctx, start, control, end, accent, opts = {}) {
  const alpha = opts.alpha ?? 0.85;
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = rgba(accent, 0.9);
  ctx.lineWidth = opts.width ?? 1.6;
  ctx.setLineDash(opts.dash || [5, 5]);
  ctx.lineDashOffset = opts.dashOffset || 0;
  ctx.beginPath();
  ctx.moveTo(start[0], start[1]);
  ctx.quadraticCurveTo(control[0], control[1], end[0], end[1]);
  ctx.stroke();
  ctx.setLineDash([]);
  // Arrowhead oriented along the curve tangent at the end.
  const t = 1;
  const dx = 2 * (1 - t) * (control[0] - start[0]) + 2 * t * (end[0] - control[0]);
  const dy = 2 * (1 - t) * (control[1] - start[1]) + 2 * t * (end[1] - control[1]);
  const ang = Math.atan2(dy, dx);
  const s = 7;
  ctx.fillStyle = rgba(accent, 0.95);
  ctx.beginPath();
  ctx.moveTo(end[0], end[1]);
  ctx.lineTo(end[0] - s * Math.cos(ang - 0.45), end[1] - s * Math.sin(ang - 0.45));
  ctx.lineTo(end[0] - s * Math.cos(ang + 0.45), end[1] - s * Math.sin(ang + 0.45));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function arrowhead(ctx, from, to, color) {
  const ang = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const s = 7;
  ctx.fillStyle = rgba(color, 0.95);
  ctx.beginPath();
  ctx.moveTo(to[0], to[1]);
  ctx.lineTo(to[0] - s * Math.cos(ang - 0.45), to[1] - s * Math.sin(ang - 0.45));
  ctx.lineTo(to[0] - s * Math.cos(ang + 0.45), to[1] - s * Math.sin(ang + 0.45));
  ctx.closePath();
  ctx.fill();
}

/** Glowing pulse dot traveling a flow path. */
function pulse(ctx, x, y, color) {
  ctx.save();
  ctx.shadowColor = rgba(color, 0.9);
  ctx.shadowBlur = 14;
  ctx.fillStyle = rgba(color, 0.35);
  ctx.beginPath();
  ctx.arc(x, y, 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(x, y, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Point at fraction t (0..1) along a polyline, by arc length. */
function pathPoint(pts, t) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    segs.push(l);
    total += l;
  }
  let d = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < segs.length; i++) {
    if (d <= segs[i] || i === segs.length - 1) {
      const k = segs[i] ? d / segs[i] : 0;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k];
    }
    d -= segs[i];
  }
  return pts[pts.length - 1];
}

/** True when (x,y) is inside node rect (with margin). */
function insideNode(node, x, y, margin = 6) {
  return (
    x >= node.x - margin && x <= node.x + node.w + margin &&
    y >= node.y - margin && y <= node.y + node.h + margin
  );
}

/* ------------------------------------------------------------------ *
 * Chrome: header / footer / pills / stamps
 * ------------------------------------------------------------------ */

function drawChrome(ctx, W, H, spec) {
  const { title, subtitle, badge, badgeAccent = THEME.violet, footer } = spec;
  const g = ctx.createLinearGradient(W / 2 - 300, 0, W / 2 + 300, 0);
  g.addColorStop(0, '#A78BFA');
  g.addColorStop(0.5, '#E7ECF8');
  g.addColorStop(1, '#67E8F9');
  ctx.font = font('title', 24);
  ctx.textAlign = 'center';
  ctx.fillStyle = g;
  ctx.fillText(title, W / 2, 42);
  ctx.font = font('sans', 12);
  ctx.fillStyle = THEME.subtitleText;
  ctx.fillText(subtitle, W / 2, 63);
  if (badge) {
    ctx.textAlign = 'left';
    drawPill(ctx, W - 26 - measurePill(ctx, badge), 20, badge, badgeAccent);
  }
  if (footer) {
    ctx.font = font('mono', 10);
    ctx.textAlign = 'center';
    ctx.fillStyle = THEME.footerText;
    ctx.fillText(footer, W / 2, H - 14);
  }
  ctx.textAlign = 'left';
}

function measurePill(ctx, text) {
  ctx.font = font('monobold', 11);
  return ctx.measureText(text).width + 34;
}

/** Accent pill with status dot; (x, y) is the top-left corner. */
function drawPill(ctx, x, y, text, accent) {
  ctx.save();
  ctx.font = font('monobold', 11);
  const w = ctx.measureText(text).width + 34;
  const h = 24;
  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = rgba(accent, 0.16);
  ctx.fill();
  ctx.strokeStyle = rgba(accent, 0.55);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = rgba(accent, 1);
  ctx.beginPath();
  ctx.arc(x + 13, y + h / 2, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#EDE9FE';
  ctx.fillText(text, x + 22, y + 16);
  ctx.restore();
  return w;
}

/** Rotated verdict stamp (e.g. DELIVERY APPROVED). */
function stamp(ctx, cx, cy, text, accent, alpha = 1, angle = -0.07) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.font = font('title', 17);
  const w = ctx.measureText(text).width + 36;
  const h = 38;
  roundRect(ctx, -w / 2, -h / 2, w, h, 8);
  ctx.strokeStyle = rgba(accent, 0.95);
  ctx.lineWidth = 2.4;
  ctx.shadowColor = rgba(accent, 0.5);
  ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.shadowBlur = 0;
  roundRect(ctx, -w / 2 + 4, -h / 2 + 4, w - 8, h - 8, 6);
  ctx.strokeStyle = rgba(accent, 0.4);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = rgba(accent, 1);
  ctx.textAlign = 'center';
  ctx.fillText(text, 0, 6);
  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * Gauges & bars
 * ------------------------------------------------------------------ */

/** 270-degree ring gauge with a threshold tick. pct in 0..100. */
function ringGauge(ctx, cx, cy, r, pct, opts = {}) {
  const start = Math.PI * 0.75;
  const sweep = Math.PI * 1.5;
  const threshold = opts.threshold ?? 97;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = 13;
  ctx.strokeStyle = 'rgba(148,163,184,0.14)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, start + sweep);
  ctx.stroke();

  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, '#A78BFA');
  g.addColorStop(0.55, '#22D3EE');
  g.addColorStop(1, '#34D399');
  const passed = pct >= threshold;
  ctx.strokeStyle = g;
  if (passed) {
    ctx.shadowColor = 'rgba(52,211,153,0.55)';
    ctx.shadowBlur = 16;
  }
  if (pct > 0.5) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, start + sweep * (Math.min(pct, 100) / 100));
    ctx.stroke();
  }
  ctx.shadowBlur = 0;

  const ta = start + sweep * (threshold / 100);
  ctx.strokeStyle = 'rgba(245,158,11,0.9)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(cx + (r - 11) * Math.cos(ta), cy + (r - 11) * Math.sin(ta));
  ctx.lineTo(cx + (r + 11) * Math.cos(ta), cy + (r + 11) * Math.sin(ta));
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.font = font('title', 44);
  ctx.fillStyle = passed ? '#6EE7B7' : '#E7ECF8';
  ctx.fillText(String(Math.round(pct)) + '%', cx, cy + 8);
  ctx.font = font('mono', 10);
  ctx.fillStyle = THEME.nodeDetail;
  ctx.fillText(opts.label || 'CONFIDENCE', cx, cy + 32);
  ctx.font = font('mono', 9);
  ctx.fillStyle = 'rgba(245,158,11,0.85)';
  ctx.fillText('min ' + threshold + '%', cx, cy + r + 24);
  ctx.restore();
}

/** Horizontal metric bar with label and value. */
function metricBar(ctx, x, y, w, label, val, accent, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = font('mono', 10);
  ctx.fillStyle = THEME.nodeDetail;
  ctx.textAlign = 'left';
  ctx.fillText(label, x, y + 9);
  ctx.textAlign = 'right';
  ctx.fillStyle = rgba(accent, 0.95);
  ctx.fillText(String(val), x + w, y + 9);
  roundRect(ctx, x, y + 15, w, 7, 3.5);
  ctx.fillStyle = 'rgba(148,163,184,0.13)';
  ctx.fill();
  if (val > 0) {
    roundRect(ctx, x, y + 15, Math.max(7, (w * val) / 100), 7, 3.5);
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, rgba(accent, 0.65));
    g.addColorStop(1, rgba(accent, 1));
    ctx.fillStyle = g;
    ctx.fill();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * Output
 * ------------------------------------------------------------------ */

function saveAsset(frames, name) {
  const out = path.join(__dirname, '..', '..', 'assets', name);
  saveGif(frames, out);
  return out;
}

module.exports = {
  THEME,
  rgba,
  font,
  roundRect,
  baseCanvas,
  glassCard,
  drawChips,
  stepBadge,
  connector,
  curveConnector,
  pulse,
  pathPoint,
  insideNode,
  drawChrome,
  drawPill,
  measurePill,
  stamp,
  ringGauge,
  metricBar,
  saveAsset,
};
