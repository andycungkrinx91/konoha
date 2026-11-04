'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const { roundCorners } = require('./flow_path_geometry');

const PKG_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')).version || '2.2.18';
  } catch (_) {
    return '2.2.18';
  }
})();

const C = {
  azure: '#3B82F6',
  teal: '#14B8A6',
  violet: '#8B5CF6',
  amber: '#F97316',
  emerald: '#10B981',
  crimson: '#EF4444',
  slateDark: '#0F172A',
  slateMed: '#475569',
  slateMuted: '#64748B',
  borderLight: '#E2E8F0',
  cardBg: '#FFFFFF',
  containerBg: '#F8FAFC'
};

function buildHtmlPage(width, height, contentSvg, extraCss = '') {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    background: #FFFFFF;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .svg-canvas {
    width: ${width}px;
    height: ${height}px;
    display: block;
  }
  ${extraCss}
</style>
</head>
<body>
<svg class="svg-canvas" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="cardShadow" x="-10%" y="-10%" width="130%" height="130%">
      <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#0F172A" flood-opacity="0.06" />
    </filter>
    <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="3" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
    <pattern id="dotGrid" width="24" height="24" patternUnits="userSpaceOnUse">
      <circle cx="12" cy="12" r="1.1" fill="#94A3B8" opacity="0.18" />
    </pattern>
    <radialGradient id="brandWash" cx="50%" cy="35%" r="65%">
      <stop offset="0%" stop-color="#3B82F6" stop-opacity="0.04" />
      <stop offset="100%" stop-color="#3B82F6" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="gAzureViolet" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#3B82F6" />
      <stop offset="100%" stop-color="#8B5CF6" />
    </linearGradient>
    <linearGradient id="gTealAmber" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#14B8A6" />
      <stop offset="100%" stop-color="#F97316" />
    </linearGradient>
    <linearGradient id="gGauge" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#3B82F6" />
      <stop offset="50%" stop-color="#8B5CF6" />
      <stop offset="100%" stop-color="#10B981" />
    </linearGradient>
    <marker id="arrow-azure" viewBox="0 0 10 8" refX="8" refY="4" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="7.2" orient="auto">
      <path d="M 0 1 L 8 4 L 0 7 L 1.5 4 Z" fill="#3B82F6" />
    </marker>
    <marker id="arrow-violet" viewBox="0 0 10 8" refX="8" refY="4" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="7.2" orient="auto">
      <path d="M 0 1 L 8 4 L 0 7 L 1.5 4 Z" fill="#8B5CF6" />
    </marker>
    <marker id="arrow-teal" viewBox="0 0 10 8" refX="8" refY="4" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="7.2" orient="auto">
      <path d="M 0 1 L 8 4 L 0 7 L 1.5 4 Z" fill="#14B8A6" />
    </marker>
    <marker id="arrow-amber" viewBox="0 0 10 8" refX="8" refY="4" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="7.2" orient="auto">
      <path d="M 0 1 L 8 4 L 0 7 L 1.5 4 Z" fill="#F97316" />
    </marker>
    <marker id="arrow-emerald" viewBox="0 0 10 8" refX="8" refY="4" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="7.2" orient="auto">
      <path d="M 0 1 L 8 4 L 0 7 L 1.5 4 Z" fill="#10B981" />
    </marker>
    <marker id="arrow-crimson" viewBox="0 0 10 8" refX="8" refY="4" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="7.2" orient="auto">
      <path d="M 0 1 L 8 4 L 0 7 L 1.5 4 Z" fill="#EF4444" />
    </marker>
  </defs>

  <rect width="100%" height="100%" fill="#FAFBFD" />
  <rect width="100%" height="100%" fill="url(#dotGrid)" />
  <rect width="100%" height="100%" fill="url(#brandWash)" />

  ${contentSvg}
</svg>
</body>
</html>`;
}

function renderChips(pos, col, chips) {
  const [startX, y, h] = pos;
  let chipHtml = '';
  let curX = startX;
  const chipW = 60;
  const gap = 8;
  chips.forEach((c) => {
    chipHtml += `
      <rect x="${curX}" y="${y + h - 22}" width="${chipW}" height="16" rx="8" fill="${col}" fill-opacity="0.10" stroke="${col}" stroke-width="1" stroke-opacity="0.35" />
      <text x="${curX + chipW / 2}" y="${y + h - 10}" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="9" font-weight="700" fill="${col}">${c}</text>
    `;
    curX += chipW + gap;
  });
  return chipHtml;
}

function renderCard(box, col, title, opt = '', agent = '') {
  const [x, y, w, h] = box;
  const detail = typeof opt === 'string' ? opt : (opt?.detail || '');
  const chips = Array.isArray(opt) ? opt : (opt?.chips || []);
  const compact = h < 70;
  const chipW = 60;
  const gap = 8;
  const totalW = chips.length > 0 ? chips.length * chipW + (chips.length - 1) * gap : 0;
  const startX = agent && chips.length > 0 ? x + w - 16 - totalW : x + (w - totalW) / 2;
  const chipHtml = chips.length > 0 ? renderChips([startX, y, h], col, chips) : '';
  const titleOffset = compact
    ? (detail ? 24 : (agent ? h / 2 - 2 : h / 2 + 5))
    : (chips.length > 0 ? 24 : (detail ? 26 : h / 2 + 5));
  const detailOffset = compact ? 38 : (chips.length > 0 ? 40 : 44);
  const agentHtml = agent
    ? `<text class="card-agent" data-agent="${agent}" x="${x + 16}" y="${y + h - 9}" text-anchor="start" font-family="'JetBrains Mono', monospace" font-size="8.5" font-weight="700" letter-spacing="0.6" fill="${col}">\u25c8 ${agent}</text>`
    : '';

  return `
    <g class="flow-card" transform="translate(0, 0)">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="#FFFFFF" stroke="${col}" stroke-width="2" filter="url(#cardShadow)" />
      <rect x="${x}" y="${y}" width="${w}" height="5" rx="2.5" fill="${col}" />
      <text x="${x + w / 2}" y="${y + titleOffset}" text-anchor="middle" font-family="'Inter', sans-serif" font-size="13" font-weight="700" fill="#0F172A">${title}</text>
      ${detail ? `<text x="${x + w / 2}" y="${y + detailOffset}" text-anchor="middle" font-family="'Inter', sans-serif" font-size="11" font-weight="500" fill="#475569">${detail}</text>` : ''}
      ${chipHtml}
      ${agentHtml}
    </g>
  `;
}


function renderHeader(width, title, subtitle, badge = {}) {
  const badgeText = badge.text || '83–98% TOKEN SAVINGS';
  const badgeCol = badge.col || '#3B82F6';
  return `
    <text x="${width / 2}" y="38" text-anchor="middle" font-family="'Inter', sans-serif" font-size="22" font-weight="800" fill="#0F172A" letter-spacing="0.5">${title}</text>
    <text x="${width / 2}" y="60" text-anchor="middle" font-family="'Inter', sans-serif" font-size="12" font-weight="500" fill="#475569">${subtitle}</text>
    <g transform="translate(${width - 230}, 18)">
      <rect width="200" height="26" rx="13" fill="#FFFFFF" stroke="${badgeCol}" stroke-width="1.5" filter="url(#cardShadow)" />
      <circle cx="16" cy="13" r="4" fill="${badgeCol}" />
      <text x="28" y="17" font-family="'JetBrains Mono', monospace" font-size="10" font-weight="700" fill="#0F172A">${badgeText}</text>
    </g>
  `;
}

function renderFooter(width, height, text) {
  return `
    <text x="${width / 2}" y="${height - 14}" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="10" font-weight="500" fill="#64748B">${text}</text>
  `;
}

// ── Jonin-standard visual grammar kit ────────────────────────────────────
// Shared by every flow diagram: canvas, palette, type scale, card and panel
// primitives, dashed connectors with per-hue arrow markers.
//   1200x760 canvas, white background
//   light container panels (#F8FAFC, 1.5px coloured stroke, rx 14) whose body is
//   a stack of white 300x48 rows (12px/700 title + 10px/500 detail, slate text)
//   white 340px cards with a 5px hue bar, 13px/700 title + 11px/500 detail
//   dashed 2.5px connectors riding a 6px 15%-opacity track
// STYLE IS FROZEN. Every canvas uses this one grammar — same canvas, card size,
// type scale, connector treatment, verdict slot at y540, roster ribbon and footer.
// Topology differs only by CONTENT and EDGE ROUTING (two-column snake, closed
// loop, funnel-and-fork, dual lanes); never by restyling. Enforced by
// tests/test_flow_diagram_style_lock.js.
const STD_CARD_W = 340;
const STD_ROW_H = 48;
const STD_ROW_GAP = 6;

const STD_MARKERS = {
  [C.azure]: 'arrow-azure',
  [C.violet]: 'arrow-violet',
  [C.teal]: 'arrow-teal',
  [C.amber]: 'arrow-amber',
  [C.emerald]: 'arrow-emerald',
  [C.crimson]: 'arrow-crimson'
};

function stdPanelHeight(rowCount) {
  return 42 + rowCount * (STD_ROW_H + STD_ROW_GAP) + 8;
}

function stdPanel({ x, y, w = STD_CARD_W, h, title, col = C.violet, rows = [] }) {
  const height = h || stdPanelHeight(rows.length);
  const rowHtml = rows.map((row, i) => {
    const ry = 42 + i * (STD_ROW_H + STD_ROW_GAP);
    return `
      <rect x="20" y="${ry}" width="${w - 40}" height="${STD_ROW_H}" rx="8" fill="#FFFFFF" stroke="${C.borderLight}" stroke-width="1" />
      <text x="35" y="${ry + 22}" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">${row.title}</text>
      <text x="35" y="${ry + 39}" font-family="'Inter', sans-serif" font-size="10" font-weight="500" fill="${C.slateMed}">${row.detail || ''}</text>`;
  }).join('');
  return `
    <g transform="translate(${x}, ${y})">
      <rect width="${w}" height="${height}" rx="14" fill="${C.containerBg}" stroke="${col}" stroke-width="1.5" />
      <text x="${w / 2}" y="26" text-anchor="middle" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">${title}</text>${rowHtml}
    </g>
  `;
}

function stdLink(d, col) {
  const marker = STD_MARKERS[col] || 'arrow-violet';
  const g = roundCorners(d);
  return `<path class="bg-track" d="${g}" stroke="${col}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="${g}" stroke="${col}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="8 6" fill="none" marker-end="url(#${marker})" />`;
}


function stdNote(x, y, text, col = C.slateMuted, size = 9) {
  return `<text x="${x}" y="${y}" font-family="'JetBrains Mono', monospace" font-size="${size}" font-weight="700" fill="${col}">${text}</text>`;
}

function stdDiamond({ cx, cy, r, col, label, sub }) {
  const pts = [
    `${cx},${cy - r}`,
    `${cx + r},${cy}`,
    `${cx},${cy + r}`,
    `${cx - r},${cy}`
  ].join(' ');
  return `
    <polygon points="${pts}" fill="#FFFFFF" stroke="${col}" stroke-width="2" stroke-linejoin="round" />
    <text x="${cx}" y="${cy - 1}" text-anchor="middle" font-family="'Inter', sans-serif" font-size="11" font-weight="700" fill="${C.slateDark}">${label}</text>
    <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="9" font-weight="700" fill="${col}">${sub}</text>`;
}


// The nine village specialists. Every diagram carries this roster bar so the
// persona that owns the workflow is visible at a glance; the owning chip is
// filled, the other eight stay outlined.
const NINJA_AGENTS = ['genin', 'chunin', 'jonin', 'anbu', 'tokubetsu', 'kage', 'akatsuki', 'sannin', 'yamanaka'];

function stdRoster(active, col = C.violet) {
  const y = 712;
  const h = 16;
  const chipW = 74;
  const gap = 6;
  const chips = NINJA_AGENTS.map((name, i) => {
    const x = 50 + i * (chipW + gap);
    const on = name === active;
    return `
      <rect x="${x}" y="${y}" width="${chipW}" height="${h}" rx="8" fill="${on ? col : '#FFFFFF'}" stroke="${col}" stroke-width="${on ? 1.5 : 1}" stroke-opacity="${on ? 1 : 0.35}" />
      <text x="${x + chipW / 2}" y="${y + 11}" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="9" font-weight="700" fill="${on ? '#FFFFFF' : C.slateMed}">${name}</text>`;
  }).join('');
  const nextX = 50 + NINJA_AGENTS.length * (chipW + gap) + 8;
  return `
    <text x="50" y="${y - 8}" font-family="'JetBrains Mono', monospace" font-size="8" font-weight="700" fill="${C.slateMuted}">NINJA ROSTER · OWNER</text>${chips}
    <text x="${nextX}" y="${y + 11}" font-family="'JetBrains Mono', monospace" font-size="9" font-weight="700" fill="${col}">${(active || 'n/a').toUpperCase()}</text>`;
}

function generateYamanakaHtml() {
  const W = 1200;
  const H = 760;

  const header = renderHeader(W, 'YAMANAKA 3D ASSET BUILD PIPELINE', `text · image · DSL ingress → spec synthesis → procedural manifold build → GLB → Blender LTS → preview · v${PKG_VERSION}`, { text: 'WATERTIGHT MANIFOLD', col: C.violet });
  const roster = stdRoster('yamanaka', C.violet);
  const footer = renderFooter(W, H, 'Density dials: low 3k / normal 12k / high 35k / ultra 85k polygons · honest source labels · measured geometry, no model-parity claims');

  // TOPOLOGY: three ingress modalities FAN IN to one synthesis node, then the
  // four dial positions FAN IN again on the density ladder.
  const ingress = [
    renderCard([50, 150, 340, 76], C.azure, 'TEXT PROMPT', 'natural language asset request', 'host'),
    renderCard([430, 150, 340, 76], C.teal, 'IMAGE / SCREENSHOT', 'reference plate · vision spec', 'host'),
    renderCard([810, 150, 340, 76], C.violet, 'DSL SCENE SPEC', 'explicit primitives · materials', 'host')
  ].join('\n');

  const fanIn = [
    stdLink('M 220 226 C 220 272, 495 272, 495 300', C.azure),
    stdLink('M 600 226 L 600 300', C.teal),
    stdLink('M 980 226 C 980 272, 705 272, 705 300', C.violet)
  ].join('\n');

  const synthesis = renderCard([430, 300, 340, 84], C.violet, 'SPEC SYNTHESIS', 'validateSceneSpec + richness floor', 'yamanaka');

  const archetype = renderCard([810, 300, 340, 84], C.azure, 'ARCHETYPE ROUTING', 'prompt-aware · 16 domain builders', 'yamanaka');

  const geometry = renderCard([430, 470, 340, 84], C.teal, 'GEOMETRY FINALIZE', 'weld · world-scale UV · smooth normals', 'yamanaka');

  // Density ladder: four dial positions converging into one geometry node.
  const ladder = [
    renderCard([50, 470, 220, 48], C.emerald, 'LOW · 3,000', 'yamanaka'),
    renderCard([50, 530, 220, 48], C.azure, 'NORMAL · 12,000', 'yamanaka'),
    renderCard([50, 590, 220, 48], C.amber, 'HIGH · 35,000', 'yamanaka'),
    renderCard([50, 650, 220, 48], C.crimson, 'ULTRA · 85,000', 'yamanaka')
  ].join('\n');

  const ladderIn = [
    stdLink('M 270 494 C 348 494, 356 494, 430 494', C.emerald),
    stdLink('M 270 554 C 348 554, 356 508, 430 508', C.azure),
    stdLink('M 270 614 C 348 614, 356 522, 430 522', C.amber),
    stdLink('M 270 674 C 348 674, 356 536, 430 536', C.crimson)
  ].join('\n');

  const ship = renderCard([810, 470, 340, 84], C.amber, 'GLB → BLENDER → PREVIEW', 'header check · watertight · PMREM rig', 'yamanaka');
  const store = renderCard([810, 580, 340, 84], C.emerald, 'STORED ASSET', 'assets table · mesh_count · triangles', 'yamanaka');

  const flow = [
    stdLink('M 770 342 L 810 342', C.azure),
    stdLink('M 600 384 L 600 470', C.teal),
    stdLink('M 770 512 L 810 512', C.amber),
    stdLink('M 980 554 L 980 580', C.emerald)
  ].join('\n');

  const notes = [
    stdNote(50, 452, 'DENSITY = sqrt(polyFactor) · CLAMPED [0.8, 12]', C.slateMuted)
  ].join('\n');

  return buildHtmlPage(W, H, `${header}\n${ingress}\n${fanIn}\n${synthesis}\n${archetype}\n${geometry}\n${ladder}\n${ladderIn}\n${ship}\n${store}\n${flow}\n${notes}\n${roster}\n${footer}`);
}

function generateOrchestrationHtml() {
  const W = 1200;
  const H = 760;

  const header = renderHeader(W, 'KONOHA MCP ORCHESTRATION & EXECUTION FLOW', `sannin prelude → dispatch → execute → review → sign-off → synthesis · loop edge returns to the prelude · v${PKG_VERSION}`, { text: 'CLOSED LOOP', col: C.violet });
  const roster = stdRoster('sannin', C.violet);
  const footer = renderFooter(W, H, 'every lane emits evidence · the loop edge is the only way back to planning · nothing ships from a partial ring');

  // TOPOLOGY: a CLOSED LOOP. Six numbered stations run down the left column and
  // back up nothing — the sequence crosses to the right column, lands in one
  // delivery card, and a single loop edge returns to station 1.
  const lanes = [
    stdNote(150, 152, 'PLAN & EXECUTE', C.slateMuted),
    stdNote(710, 152, 'REVIEW & SYNTHESIS', C.slateMuted)
  ].join('\n');

  const left = [
    renderCard([150, 160, 340, 84], C.azure, '1 · PLAN & ROUTE', 'sannin prelude · intent → task graph', 'sannin'),
    renderCard([150, 280, 340, 84], C.teal, '2 · SPECIALIST DISPATCH', 'nine lanes · bounded tool grants', 'sannin'),
    renderCard([150, 400, 340, 84], C.violet, '3 · EXECUTE & EVIDENCE', 'phase output · validation rows', 'anbu')
  ].join('\n');

  const right = [
    renderCard([710, 160, 340, 84], C.amber, '4 · REVIEW & GATE', 'kage · diff + slop audit', 'kage'),
    renderCard([710, 280, 340, 84], C.emerald, '5 · HUMAN SIGN-OFF', 'plan approval · release sign-off', 'host'),
    renderCard([710, 400, 340, 84], C.azure, '6 · SANNIN SYNTHESIS', 'merge lanes · one answer', 'sannin')
  ].join('\n');

  const links = [
    stdLink('M 320 244 L 320 280', C.azure),
    stdLink('M 320 364 L 320 400', C.teal),
    stdLink('M 490 442 C 600 442, 600 202, 710 202', C.violet),
    stdLink('M 880 244 L 880 280', C.amber),
    stdLink('M 880 364 L 880 400', C.emerald),
    stdLink('M 880 484 L 880 512 L 700 512 L 700 540', C.azure),
    stdLink('M 430 582 L 110 582 L 110 202 L 150 202', C.violet)
  ].join('\n');

  const delivery = renderCard([430, 540, 340, 84], C.violet, 'DELIVERY', 'all lanes green → ship · else re-dispatch', 'sannin');
  const notes = stdNote(118, 600, 'LOOP', C.violet);

  return buildHtmlPage(W, H, `${header}\n${lanes}\n${left}\n${right}\n${links}\n${delivery}\n${notes}\n${roster}\n${footer}`);
}

function generateJoninHtml() {
  const W = 1200;
  const H = 760;

  const header = renderHeader(W, 'JONIN TASTE-SKILL PREMIUM UI BUILD PIPELINE', `LangGraph execute_node · Zero-AI-Slop & Akatsuki Security-Gated Frontend Engineering · v${PKG_VERSION}`, { text: 'TASTE-SKILL ENFORCED', col: C.violet });
  const roster = stdRoster('jonin', C.teal);
  const footer = renderFooter(W, H, 'LangGraph execute_node · per-turn budget exhausted -> next turn resumes at node_execute · Mandatory layout invariants · pure light mode · 100% exact mockup fidelity · 0 errors 0 warnings');

  const containerInvariants = `
    <g transform="translate(50, 195)">
      <rect width="340" height="435" rx="14" fill="${C.containerBg}" stroke="${C.teal}" stroke-width="1.5" />
      <text x="170" y="26" text-anchor="middle" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">MANDATORY KONOHA LAYOUT INVARIANTS</text>
      <rect x="20" y="42" width="300" height="58" rx="8" fill="#FFFFFF" stroke="${C.borderLight}" stroke-width="1" />
      <text x="35" y="66" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">Far-Left Brand Logo</text>
      <text x="35" y="84" font-family="'Inter', sans-serif" font-size="10" fill="${C.slateMed}">Never centered · 0 mobile hamburger menu toggle</text>
      <rect x="20" y="110" width="300" height="58" rx="8" fill="#FFFFFF" stroke="${C.borderLight}" stroke-width="1" />
      <text x="35" y="134" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">Archetype-Adaptive Mobile Dock</text>
      <text x="35" y="152" font-family="'Inter', sans-serif" font-size="10" fill="${C.slateMed}">Fixed bottom dock (lg:hidden) · one-tap quick links</text>
      <rect x="20" y="178" width="300" height="58" rx="8" fill="#FFFFFF" stroke="${C.borderLight}" stroke-width="1" />
      <text x="35" y="202" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">Bottom-Left 10-Theme Switcher</text>
      <text x="35" y="220" font-family="'Inter', sans-serif" font-size="10" fill="${C.slateMed}">Fixed bottom-left FAB · pure light mode fidelity</text>
      <rect x="20" y="246" width="300" height="58" rx="8" fill="#FFFFFF" stroke="${C.borderLight}" stroke-width="1" />
      <text x="35" y="270" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">4-Slide Hero Banner Carousel</text>
      <text x="35" y="288" font-family="'Inter', sans-serif" font-size="10" fill="${C.slateMed}">5000ms autoplay · hover pause · dot indicators</text>
      <rect x="20" y="314" width="300" height="58" rx="8" fill="#FFFFFF" stroke="${C.borderLight}" stroke-width="1" />
      <text x="35" y="338" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">Fixed Left Sidebar (Desktop)</text>
      <text x="35" y="356" font-family="'Inter', sans-serif" font-size="10" fill="${C.slateMed}">Dashboard & Admin builds · seamlessly collapses</text>
    </g>
  `;

  const containerFrameworks = `
    <g transform="translate(430, 360)">
      <rect width="340" height="270" rx="14" fill="${C.containerBg}" stroke="${C.violet}" stroke-width="1.5" />
      <text x="170" y="26" text-anchor="middle" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">UNIVERSAL POLYGLOT FRAMEWORKS</text>
      <rect x="20" y="42" width="300" height="38" rx="8" fill="#FFFFFF" stroke="${C.borderLight}" stroke-width="1" />
      <text x="35" y="66" font-family="'Inter', sans-serif" font-size="11" font-weight="700" fill="${C.slateDark}">Next.js 16</text>
      <text x="130" y="66" font-family="'JetBrains Mono', monospace" font-size="9" fill="${C.slateMed}">pnpm create next-app@latest</text>
      <rect x="20" y="86" width="300" height="38" rx="8" fill="#FFFFFF" stroke="${C.borderLight}" stroke-width="1" />
      <text x="35" y="110" font-family="'Inter', sans-serif" font-size="11" font-weight="700" fill="${C.slateDark}">Nuxt 3</text>
      <text x="130" y="110" font-family="'JetBrains Mono', monospace" font-size="9" fill="${C.slateMed}">pnpm dlx nuxi@latest init</text>
      <rect x="20" y="130" width="300" height="38" rx="8" fill="#FFFFFF" stroke="${C.borderLight}" stroke-width="1" />
      <text x="35" y="154" font-family="'Inter', sans-serif" font-size="11" font-weight="700" fill="${C.slateDark}">SvelteKit 2</text>
      <text x="130" y="154" font-family="'JetBrains Mono', monospace" font-size="9" fill="${C.slateMed}">pnpm dlx sv create</text>
      <rect x="20" y="174" width="300" height="38" rx="8" fill="#FFFFFF" stroke="${C.borderLight}" stroke-width="1" />
      <text x="35" y="198" font-family="'Inter', sans-serif" font-size="11" font-weight="700" fill="${C.slateDark}">Angular 19+</text>
      <text x="130" y="198" font-family="'JetBrains Mono', monospace" font-size="9" fill="${C.slateMed}">pnpm dlx @angular/cli@latest</text>
      <rect x="20" y="218" width="300" height="38" rx="8" fill="#FFFFFF" stroke="${C.borderLight}" stroke-width="1" />
      <text x="35" y="242" font-family="'Inter', sans-serif" font-size="11" font-weight="700" fill="${C.slateDark}">Astro / Remix / Vue</text>
      <text x="175" y="242" font-family="'JetBrains Mono', monospace" font-size="9" fill="${C.slateMed}">extensible polyglot engine</text>
    </g>
  `;

  const cards = [
    renderCard([50, 95, 340, 68], C.azure, 'USER UI SPECIFICATION', 'build_from_source · build_from_text', 'host'),
    renderCard([430, 220, 340, 84], C.violet, '♦ JONIN BUILDER ENGINE', { detail: 'Tailwind CSS v4 · Framer Motion · Pure Light', chips: ['Next.js', 'Nuxt', 'Svelte', 'Angular'] }, 'jonin'),
    renderCard([810, 140, 340, 68], C.teal, 'FRAMEWORK CLI GATES', 'pnpm build (0 errors) · pnpm lint (0 warnings)', 'anbu'),
    renderCard([810, 240, 340, 68], C.crimson, 'AKATSUKI BLUE SECURITY GATE', '🛡️ CSP, XSS audit, zero-script injection, 0 CVEs', 'akatsuki'),
    renderCard([810, 340, 340, 68], C.amber, 'TWO-STEP ZERO-AI-SLOP GATE', '100/100 mechanical scan · antislop verified', 'tokubetsu'),
    renderCard([810, 440, 340, 68], C.emerald, 'GATE 2 & PRODUCTION DELIVERY', 'pending_human_signoff · 100% exact fidelity', 'kage'),
    renderCard([810, 540, 340, 62], C.azure, 'DELIVERY REPORT TO HOST', 'clean release deliverable to orchestrator', 'jonin')
  ].join('\n');

  const paths = [
    stdLink('M 220 163 L 220 195', C.teal),
    stdLink('M 390 262 L 430 262', C.violet),
    stdLink('M 600 304 L 600 360', C.violet),
    stdLink('M 770 262 C 790 262, 790 174, 810 174', C.teal),
    stdLink('M 980 208 L 980 240', C.crimson),
    stdLink('M 980 308 L 980 340', C.amber),
    stdLink('M 980 408 L 980 440', C.emerald),
    stdLink('M 980 508 L 980 540', C.azure)
  ].join('\n');

  return buildHtmlPage(W, H, `${header}\n${containerInvariants}\n${containerFrameworks}\n${paths}\n${cards}\n${roster}\n${footer}`);
}

function generateKageHtml() {
  const W = 1200;
  const H = 760;

  const header = renderHeader(W, 'KAGE REVIEW GATE & REMEDIATION ROUTING', `four evaluation columns → one confidence number · ≥ 98% releases, below remediates · v${PKG_VERSION}`, { text: 'PASS · SIGN-OFF · RELEASE', col: C.emerald });
  const roster = stdRoster('kage', C.emerald);
  const footer = renderFooter(W, H, 'the gate scores four columns, not one · remediation returns to plan approval, never straight to release');

  // TOPOLOGY: a FUNNEL. Six review stations feed one scoring card, which forks
  // into exactly two terminal cards — a release or a remediation round trip.
  const lanes = [
    stdNote(150, 152, 'EVALUATION COLUMNS', C.slateMuted),
    stdNote(710, 152, 'DELIVERY ROUTE', C.slateMuted)
  ].join('\n');

  const left = [
    renderCard([150, 160, 340, 84], C.azure, '1 · PLAN CONFIDENCE', 'plan approval · scope + risk rows', 'kage'),
    renderCard([150, 280, 340, 84], C.teal, '2 · VALIDATION MATRIX', 'tests · diffs · evidence rows', 'anbu'),
    renderCard([150, 400, 340, 84], C.violet, '3 · SECURITY & ROLLBACK', 'secret scan · rollback plan', 'akatsuki')
  ].join('\n');

  const right = [
    renderCard([710, 160, 340, 84], C.amber, '4 · SLOP + DIFF AUDIT', 'changed files only · 0 errors', 'kage'),
    renderCard([710, 280, 340, 84], C.teal, '5 · EVIDENCE PACKET', 'sign-off sheet · owner rows', 'tokubetsu'),
    renderCard([710, 400, 340, 84], C.violet, '6 · GATE SCORING', 'four columns → one number', 'kage')
  ].join('\n');

  const links = [
    stdLink('M 320 244 L 320 280', C.azure),
    stdLink('M 320 364 L 320 400', C.teal),
    stdLink('M 490 442 C 600 442, 600 202, 710 202', C.violet),
    stdLink('M 880 244 L 880 280', C.amber),
    stdLink('M 880 364 L 880 400', C.teal),
    stdLink('M 880 484 L 880 500 L 400 500 L 400 540', C.emerald),
    stdLink('M 880 484 L 880 516 L 800 516 L 800 540', C.crimson)
  ].join('\n');

  const pass = renderCard([230, 540, 340, 84], C.emerald, 'PASS ≥ 98% · SIGN-OFF', 'release cut approved', 'kage');
  const fail = renderCard([630, 540, 340, 84], C.crimson, 'BELOW 98% · REMEDIATE', 're-dispatch · rerun the gate', 'sannin');
  const notes = stdNote(230, 656, 'REMEDIATION LOOPS BACK TO PLAN APPROVAL, NEVER STRAIGHT TO RELEASE', C.slateMuted);

  return buildHtmlPage(W, H, `${header}\n${lanes}\n${left}\n${right}\n${links}\n${pass}\n${fail}\n${notes}\n${roster}\n${footer}`);
}

function generateQaHtml() {
  const W = 1200;
  const H = 760;

  const header = renderHeader(W, 'QA DETERMINISTIC CHAIN & TRIAGE', `zod schema → unit → bounded e2e → a11y → perf → slop · red result routes to triage fix · v${PKG_VERSION}`, { text: 'DETERMINISTIC ONLY', col: C.teal });
  const roster = stdRoster('anbu', C.amber);
  const footer = renderFooter(W, H, 'Every stage emits an explicit exit code · green means all six stages passed · red returns to triage, never to the retest stage');

  // TOPOLOGY: a SNAKE. Steps 1-3 run down the left column, the sequence
  // crosses over, and steps 4-6 run down the right column into one verdict.
  const left = [
    renderCard([150, 160, 340, 84], C.azure, '1 · SCHEMA & JSON LINT', 'zod parse · manifest shape', 'anbu'),
    renderCard([150, 280, 340, 84], C.teal, '2 · UNIT + INTEGRATION', 'focused suites · isolated HOME', 'anbu'),
    renderCard([150, 400, 340, 84], C.violet, '3 · BOUNDED E2E', 'playwright · real DOM assertions', 'anbu')
  ].join('\n');

  const right = [
    renderCard([710, 160, 340, 84], C.amber, '4 · ACCESSIBILITY AUDIT', 'landmarks · labels · contrast', 'jonin'),
    renderCard([710, 280, 340, 84], C.emerald, '5 · PERFORMANCE BUDGET', 'bundle · paint · query cost', 'jonin'),
    renderCard([710, 400, 340, 84], C.crimson, '6 · SLOP SCAN', '0 errors · 0 warnings · 0 fixable', 'tokubetsu')
  ].join('\n');

  const snake = [
    stdLink('M 320 244 L 320 280', C.azure),
    stdLink('M 320 364 L 320 400', C.teal),
    stdLink('M 490 442 C 600 442, 600 202, 710 202', C.violet),
    stdLink('M 880 244 L 880 280', C.amber),
    stdLink('M 880 364 L 880 400', C.emerald),
    stdLink('M 880 484 L 880 512 L 700 512 L 700 540', C.crimson)
  ].join('\n');

  const verdict = renderCard([430, 540, 340, 84], C.emerald, 'QA VERDICT', 'all six green → release · else triage', 'anbu');

  const notes = [
    stdNote(430, 656, 'RED RESULT → TRIAGE FIX → RERUN, NEVER A BLIND RETEST', C.slateMuted)
  ].join('\n');

  return buildHtmlPage(W, H, `${header}\n${left}\n${right}\n${snake}\n${verdict}\n${notes}\n${roster}\n${footer}`);
}

function generateTelegramHtml() {
  const W = 1200;
  const H = 760;

  const header = renderHeader(W, 'TELEGRAM BRIDGE · OUTBOUND & INBOUND', `task status reporter and long-polling intent daemon meeting at one two-stage HITL gate · v${PKG_VERSION}`, { text: 'TWO-STAGE HITL', col: C.azure });
  const roster = stdRoster('kage', C.azure);
  const footer = renderFooter(W, H, 'Outbound is proactive status push · inbound is long polling · both converge on the same HITL gate before any task mutation');

  // TOPOLOGY: two PARALLEL RAILS travelling in opposite directions, joined by
  // a single HITL gate in the middle of the canvas.
  const outbound = [
    renderCard([50, 170, 260, 76], C.azure, 'POLL TASK STATUS', 'status.json · route_mode', 'anbu'),
    renderCard([330, 170, 260, 76], C.teal, 'FORMAT REPORT', 'chips · ≤ 4096 chars', 'tokubetsu'),
    renderCard([610, 170, 260, 76], C.violet, 'SEND MESSAGE', 'bot api · retry budget', 'anbu'),
    renderCard([890, 170, 260, 76], C.emerald, 'DELIVERED', 'message_id recorded', 'anbu')
  ].join('\n');

  const inbound = [
    renderCard([50, 470, 260, 76], C.azure, 'LONG POLL', 'getUpdates · offset cursor', 'anbu'),
    renderCard([330, 470, 260, 76], C.teal, 'PARSE UPDATE', 'text · command · reply', 'anbu'),
    renderCard([610, 470, 260, 76], C.violet, 'ROUTE INTENT', 'classify → workflow', 'sannin'),
    renderCard([890, 470, 260, 76], C.emerald, 'ACK REPLY', 'confirm to sender', 'anbu')
  ].join('\n');

  const rails = [
    stdLink('M 310 208 L 330 208', C.azure),
    stdLink('M 590 208 L 610 208', C.teal),
    stdLink('M 870 208 L 890 208', C.violet),
    stdLink('M 310 508 L 330 508', C.azure),
    stdLink('M 590 508 L 610 508', C.teal),
    stdLink('M 870 508 L 890 508', C.violet)
  ].join('\n');

  const gate = renderCard([470, 300, 340, 84], C.emerald, 'TWO-STAGE HITL GATE', 'plan approval · destructive confirm', 'host');

  const cross = [
    stdLink('M 475 246 C 475 280, 540 280, 540 300', C.amber),
    stdLink('M 660 384 C 660 430, 475 430, 475 470', C.crimson)
  ].join('\n');

  const labels = [
    stdNote(50, 156, 'OUTBOUND · PROACTIVE STATUS PUSH', C.azure),
    stdNote(50, 456, 'INBOUND · LONG POLLING DAEMON', C.teal)
  ].join('\n');

  const notes = stdNote(470, 660, 'NO TASK MUTATION WITHOUT GATE 2 CONFIRMATION', C.crimson);

  return buildHtmlPage(W, H, `${header}\n${labels}\n${outbound}\n${inbound}\n${rails}\n${gate}\n${cross}\n${notes}\n${roster}\n${footer}`);
}

function generateAkatsukiHtml() {
  const W = 1200;
  const H = 760;

  const header = renderHeader(W, 'AKATSUKI BLUE-TEAM TRACK & RED-MODE LAB', `blue-team defence left, red-mode lab right · sanitized evidence crosses once · v${PKG_VERSION}`, { text: 'LAB CONTAINED', col: C.crimson });
  const roster = stdRoster('akatsuki', C.crimson);
  const footer = renderFooter(W, H, 'red-mode runs only inside the lab · evidence is sanitized before it crosses · zero critical, zero secrets');

  // TOPOLOGY: TWO LANES. Defence runs top-down on the left; the lab runs top-down
  // on the right; a single crimson crossing carries sanitized findings across.
  const lanes = [
    stdNote(150, 152, 'BLUE TEAM · DEFENCE', C.slateMuted),
    stdNote(710, 152, 'RED MODE · LAB ONLY', C.crimson)
  ].join('\n');

  const left = [
    renderCard([150, 160, 340, 84], C.azure, '1 · SCOPE & THREAT MODEL', 'attack surface · data flows', 'akatsuki'),
    renderCard([150, 280, 340, 84], C.teal, '2 · CVE + SECRET SCAN', '0 critical · 0 leaked keys', 'akatsuki'),
    renderCard([150, 400, 340, 84], C.violet, '3 · SANDBOX PROBE', 'isolated lab · no prod writes', 'akatsuki')
  ].join('\n');

  const right = [
    renderCard([710, 160, 340, 84], C.crimson, '4 · RED-MODE EXPLOIT', 'lab only · authorized scope', 'akatsuki'),
    renderCard([710, 280, 340, 84], C.amber, '5 · SANITIZED EVIDENCE', 'strip payloads · keep proof', 'akatsuki'),
    renderCard([710, 400, 340, 84], C.emerald, '6 · HARDENING PATCH', 'fix → re-probe → close', 'anbu')
  ].join('\n');

  const links = [
    stdLink('M 320 244 L 320 280', C.azure),
    stdLink('M 320 364 L 320 400', C.teal),
    stdLink('M 490 442 C 600 442, 600 202, 710 202', C.crimson),
    stdLink('M 880 244 L 880 280', C.amber),
    stdLink('M 880 364 L 880 400', C.emerald),
    stdLink('M 880 484 L 880 512 L 700 512 L 700 540', C.emerald)
  ].join('\n');

  const verdict = renderCard([430, 540, 340, 84], C.emerald, 'ZERO CRITICAL · ZERO SECRETS', 'all findings closed or accepted', 'akatsuki');
  const notes = stdNote(430, 656, 'ACCEPTED FINDINGS CARRY AN OWNER AND A DATE', C.slateMuted);

  return buildHtmlPage(W, H, `${header}\n${lanes}\n${left}\n${right}\n${links}\n${verdict}\n${notes}\n${roster}\n${footer}`);
}

module.exports = {
  C,
  PKG_VERSION,
  stdDiamond,
  stdRoster,
  NINJA_AGENTS,
  STD_CARD_W,
  stdPanel,
  stdPanelHeight,
  stdLink,
  stdNote,
  buildHtmlPage,
  renderCard,
  renderHeader,
  renderFooter,
  generateOrchestrationHtml,
  generateJoninHtml,
  generateKageHtml,
  generateQaHtml,
  generateTelegramHtml,
  generateAkatsukiHtml,
  generateYamanakaHtml
};
