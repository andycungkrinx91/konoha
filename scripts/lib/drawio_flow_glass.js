'use strict';

/**
 * Glassmorphism + neon design tokens for the animated diagram family.
 *
 * Every hue here is the ORIGINAL drawio role colour, pulled from the committed
 * `.drawio` sources rather than invented. Slate is the one exception: its border
 * stays #475569 but the glow layer is lifted to #94A3B8 so the neon accent clears
 * the 3:1 non-text minimum against the navy backdrop.
 */

/** Original role hues (border/edge colours as authored in drawio). */
const ROLE_HUES = {
  violet: { hue: '#7C3AED', glow: '#8B5CF6' }, // orchestration / agents
  azure: { hue: '#2563EB', glow: '#3B82F6' }, // info / clients / routing
  emerald: { hue: '#059669', glow: '#10B981' }, // success / QA / tooling
  crimson: { hue: '#DC2626', glow: '#EF4444' }, // alert / security
  amber: { hue: '#D97706', glow: '#F59E0B' }, // warning / build
  orange: { hue: '#EA580C', glow: '#F97316' }, // secondary build accent
  teal: { hue: '#0F766E', glow: '#14B8A6' }, // storage / persistence
  slate: { hue: '#475569', glow: '#94A3B8' }, // neutral
  gray: { hue: '#64748B', glow: '#94A3B8' } // neutral alt
};

const GLASS = {
  bgTop: '#0B1020',
  bgBottom: '#111833',
  panelRadius: 15,
  groupRadius: 20,
  border: 1.5,
  headerStrip: 4,
  fillWhite: 0.10,
  fillTint: 0.10,
  blobOpacity: 0.20,
  dotDash: '0.1 9',
  dotPeriod: 9.1,
  edgeCore: 2,
  edgeGlow: 8,
  // Text tokens: identical hierarchy on every node, in every diagram.
  titleSize: 15,
  descSize: 12,
  tagSize: 11,
  titleWeight: 700,
  descWeight: 400,
  tagWeight: 600,
  inkTitle: '#F8FAFC',
  inkDesc: '#C7D2E4',
  inkTag: '#AFC3DC'
};

/** Layout rules from Step 4. */
const SPACE = {
  padX: 20,
  gapX: 32,
  gapY: 40,
  gapGroup: 48,
  groupPad: 24,
  margin: 40,
  captionGap: 24,
  captionBottom: 40,
  tagRowHeight: 18,
  titleMaxChars: 28,
  descMaxChars: 40,
  landscapeMaxAspect: 1.6,
  landscapeMaxWidth: 1600
};

const FONT_NODE = "'Inter', 'Sora', 'Outfit', system-ui, sans-serif";
const FONT_DISPLAY = "'Sora', 'Outfit', 'Space Grotesk', 'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', 'DejaVu Sans Mono', monospace";

function num(v) {
  return String(Math.round(v * 100) / 100);
}

function esc(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Map any authored drawio colour onto a role hub key. */
function roleOf(hex) {
  const key = String(hex || '').toUpperCase();
  const direct = Object.keys(ROLE_HUES).find((k) => ROLE_HUES[k].hue.toUpperCase() === key || ROLE_HUES[k].glow.toUpperCase() === key);
  if (direct) return direct;
  // Drawio files also carry near-miss shades of the same families; snap to nearest.
  const rgb = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!rgb) return 'violet';
  const target = parseInt(rgb[1], 16);
  const t = { r: (target >> 16) & 255, g: (target >> 8) & 255, b: target & 255 };
  let best = 'violet';
  let bestD = Infinity;
  for (const [k, v] of Object.entries(ROLE_HUES)) {
    const cand = parseInt(v.hue.slice(1), 16);
    const c = { r: (cand >> 16) & 255, g: (cand >> 8) & 255, b: cand & 255 };
    const d = (c.r - t.r) ** 2 + (c.g - t.g) ** 2 + (c.b - t.b) ** 2;
    if (d < bestD) { bestD = d; best = k; }
  }
  return best;
}

function paintId(role) { return `glass-${role}`; }
function glowId(role) { return `neon-${role}`; }
function arrowId(role) { return `arrow-${role}`; }

/** Shared defs: background gradient, blobs, glass gradients, edge glow, arrowheads. */
function glassDefs() {
  const gradients = Object.entries(ROLE_HUES).map(([role, v]) =>
    `<linearGradient id="${paintId(role)}" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.45"/>`
    + `<stop offset="100%" stop-color="${v.hue}" stop-opacity="0.30"/></linearGradient>`
    + `<linearGradient id="${paintId(role)}-fill" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.16"/>`
    + `<stop offset="100%" stop-color="#FFFFFF" stop-opacity="0.06"/></linearGradient>`
    + `<linearGradient id="${glowId(role)}" x1="0" y1="0" x2="1" y2="0">`
    + `<stop offset="0%" stop-color="${v.glow}" stop-opacity="0"/>`
    + `<stop offset="50%" stop-color="${v.glow}" stop-opacity="0.85"/>`
    + `<stop offset="100%" stop-color="${v.glow}" stop-opacity="0"/></linearGradient>`
  ).join('');

  // Identical geometry for every hue; only fill differs.
  const arrows = Object.entries(ROLE_HUES).map(([role, v]) =>
    `<marker id="${arrowId(role)}" viewBox="0 0 10 8" refX="9" refY="4" markerUnits="userSpaceOnUse"`
    + ` markerWidth="10" markerHeight="8" orient="auto">`
    + `<path d="M 0 0.8 L 9 4 L 0 7.2 L 1.6 4 Z" fill="${v.glow}"/></marker>`
  ).join('');

  const glows = Object.entries(ROLE_HUES).map(([role, v]) =>
    `<filter id="${glowId(role)}-blur" x="-50%" y="-50%" width="200%" height="200%">`
    + `<feGaussianBlur stdDeviation="4"/></filter>`
    + `<filter id="${glowId(role)}-text" x="-20%" y="-20%" width="140%" height="140%">`
    + `<feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="${v.glow}" flood-opacity="0.35"/></filter>`
  ).join('');

  return `<linearGradient id="glass-bg" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0%" stop-color="${GLASS.bgTop}"/><stop offset="100%" stop-color="${GLASS.bgBottom}"/></linearGradient>`
    + gradients + arrows + glows;
}

/**
 * Background: navy gradient plus 3-5 large blurred role-hued blobs in empty space,
 * so the glass panels have something to refract.
 */
function glassBackground(width, height, roles) {
  const stops = [
    [0.20, 0.16, 0.46], [0.80, 0.22, 0.42],
    [0.30, 0.82, 0.40], [0.86, 0.72, 0.36], [0.54, 0.50, 0.30]
  ];
  const blobs = stops.map(([cx, cy, r], i) => {
    const role = roles[i % roles.length] || 'violet';
    const v = ROLE_HUES[role];
    return `<circle cx="${num(width * cx)}" cy="${num(height * cy)}" r="${num(Math.max(width, height) * r * 0.55)}"`
      + ` fill="${v.glow}" opacity="${GLASS.blobOpacity}" filter="url(#${glowId(role)}-blur)"/>`;
  }).join('');
  return `<rect width="${num(width)}" height="${num(height)}" fill="url(#glass-bg)"/>${blobs}`;
}

/**
 * Glass panel: layered because SVG has no backdrop-filter.
 * Order matters — fill, tint, header strip, border, top highlight, bottom glow, then text.
 */
function glassPanel(box, role, options = {}) {
  const v = ROLE_HUES[role] || ROLE_HUES.violet;
  const r = options.radius === undefined ? GLASS.panelRadius : options.radius;
  const fill = options.group
    ? `<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" rx="${r}"`
      + ` fill="${v.hue}" fill-opacity="0.06"/>`
      + `<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" rx="${r}"`
      + ` fill="none" stroke="${v.hue}" stroke-opacity="0.40" stroke-width="1" stroke-dasharray="6 5"/>`
    : `<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" rx="${r}"`
      + ` fill="url(#${paintId(role)}-fill)"/>`
      + `<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" rx="${r}"`
      + ` fill="${v.hue}" fill-opacity="${GLASS.fillTint}"/>`
      + `<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${GLASS.headerStrip}" rx="${GLASS.headerStrip / 2}"`
      + ` fill="${v.glow}" fill-opacity="0.85"/>`
      + `<rect x="${num(box.x + 0.75)}" y="${num(box.y + 0.75)}" width="${num(box.w - 1.5)}" height="${num(box.h - 1.5)}" rx="${num(r - 0.75)}"`
      + ` fill="none" stroke="url(#${paintId(role)})" stroke-width="${GLASS.border}"/>`
      + `<rect x="${num(box.x + 6)}" y="${num(box.y + 1.5)}" width="${num(Math.max(4, box.w - 12))}" height="1"`
      + ` fill="#FFFFFF" fill-opacity="0.55"/>`
      + `<rect x="${num(box.x + 6)}" y="${num(box.y + box.h - 7)}" width="${num(Math.max(4, box.w - 12))}" height="2"`
      + ` fill="${v.glow}" fill-opacity="0.22"/>`;
  return `<g class="glass-panel" data-role="${role}">${fill}</g>`;
}

/** Neon edge: blurred glow copy underneath, dotted bright core on top. */
function neonEdge(d, role, phase) {
  const v = ROLE_HUES[role] || ROLE_HUES.violet;
  return `<path class="edge-glow" d="${d}" fill="none" stroke="${v.glow}" stroke-width="${GLASS.edgeGlow}"`
    + ` stroke-opacity="0.22" stroke-linecap="round" stroke-linejoin="round" filter="url(#${glowId(role)}-blur)"/>`
    + `<path class="edge-core" d="${d}" fill="none" stroke="${v.glow}" stroke-width="${GLASS.edgeCore}"`
    + ` stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${GLASS.dotDash}"`
    + ` data-period="${GLASS.dotPeriod}" marker-end="url(#${arrowId(role)})"/>`
    + `<path class="edge-pulse" data-phase="${phase}" d="${d}" fill="none" stroke="#FFFFFF" stroke-width="2"`
    + ` stroke-opacity="0.0" stroke-linecap="round"/>`;
}

/** Small glass pill for edge labels and agent tags. */
function glassPill(x, y, w, h, role) {
  const v = ROLE_HUES[role] || ROLE_HUES.violet;
  const r = h / 2;
  return `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${num(r)}"`
    + ` fill="#0E1526" fill-opacity="0.88" stroke="${v.glow}" stroke-opacity="0.65" stroke-width="1"/>`
    + `<rect x="${num(x + 3)}" y="${num(y + 1)}" width="${num(Math.max(2, w - 6))}" height="1"`
    + ` fill="#FFFFFF" fill-opacity="0.28"/>`;
}

module.exports = {
  ROLE_HUES,
  GLASS,
  SPACE,
  FONT_NODE,
  FONT_DISPLAY,
  FONT_MONO,
  num,
  esc,
  roleOf,
  paintId,
  glowId,
  arrowId,
  glassDefs,
  glassBackground,
  glassPanel,
  neonEdge,
  glassPill
};
