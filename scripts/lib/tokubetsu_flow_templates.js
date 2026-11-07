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
  const chipW = chips.length > 7 ? 56 : 60;
  const gap = chips.length > 7 ? 6 : 8;
  let chipHtml = '';
  let curX = startX;
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
  const chipW = chips.length > 7 ? 56 : 60;
  const gap = chips.length > 7 ? 6 : 8;
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

function generateOrchestrationHtml() {
  const W = 1200;
  const H = 675;

  const header = renderHeader(W, 'KONOHA MCP ORCHESTRATION & EXECUTION FLOW', `LangGraph.js StateGraph Engine · Per-Turn Token Budget Governor & Circuit Breaker · v${PKG_VERSION}`, { text: '83–98% TOKEN SAVINGS', col: C.azure });
  const footer = renderFooter(W, H, '50 canonical MCP tools · 9 specialist ninjas · LangGraph.js Cyclic StateGraph · Turn Budget Governor · Gate 1 & Gate 2 HITL Pickers');

  const cards = [
    renderCard([40, 95, 180, 56], C.azure, 'USER PROMPT', 'user · resume prompt'),
    renderCard([260, 88, 245, 70], C.violet, 'PRIMARY ORCHESTRATOR', 'LangGraph.js StateGraph · 8 clients'),
    renderCard([40, 195, 270, 56], C.teal, '1. PROJECT MEMORY & CONTEXT', 'stack detect · auto-inject invariants'),
    renderCard([340, 195, 280, 56], C.azure, '2. DISCOVER SKILL & HYGIENE', 'find_skill · semble.search · npx aislop'),
    renderCard([650, 190, 270, 66], C.amber, 'GATE 1: PLAN APPROVAL', 'pending_plan_approval · 3-option HITL'),
    renderCard([320, 295, 345, 58], C.violet, '3. LANGGRAPH STATE DISPATCH', 'PLAN → BRIEF → TODO · Turn Budget (8k)'),
    renderCard([230, 390, 700, 76], C.violet, '4. SPECIALIST NINJA AGENTS', { detail: 'single-thread persona adoption · 9 ninjas', chips: ['genin', 'kage', 'jonin', 'anbu', 'chunin', 'tokubetsu', 'akatsuki', 'yamanaka'] }),
    renderCard([15, 510, 140, 64], C.teal, '5. TASK REPORT', 'report_from_agent'),
    renderCard([170, 510, 210, 64], C.crimson, '6. AKATSUKI BLUE GATE', 'SAST · Socket CLI · secret scan'),
    renderCard([395, 510, 200, 64], C.amber, '7. KAGE REVIEW GATE', 'LangGraph review_node · 0 slop'),
    renderCard([610, 510, 220, 64], C.amber, 'GATE 2: SIGN-OFF', 'pending_human_signoff · @advisor'),
    renderCard([845, 515, 160, 54], C.violet, '8. SYNTHESIZE', 'sannin final report'),
    renderCard([1020, 515, 145, 54], C.azure, 'RESPONSE', 'deliver to user')
  ].join('\n');

  const paths = `
    <path class="bg-track" d="M 220 123 L 260 123" stroke="${C.azure}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 220 123 L 260 123" stroke="${C.azure}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-azure)" />
    <path class="bg-track" d="M 340 158 C 340 180, 175 175, 175 195" stroke="${C.teal}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 340 158 C 340 180, 175 175, 175 195" stroke="${C.teal}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-teal)" />
    <path class="bg-track" d="M 420 158 C 420 180, 480 175, 480 195" stroke="${C.azure}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 420 158 C 420 180, 480 175, 480 195" stroke="${C.azure}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-azure)" />
    <path class="bg-track" d="M 620 223 L 650 223" stroke="${C.amber}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 620 223 L 650 223" stroke="${C.amber}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-amber)" />
    <path class="bg-track" d="M 785 256 C 785 285, 660 295, 660 324" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 785 256 C 785 285, 660 295, 660 324" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />
    <path class="bg-track" d="M 490 353 L 490 390" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 490 353 L 490 390" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />
    <path class="bg-track" d="M 230 428 C 120 428, 85 460, 85 510" stroke="${C.teal}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 230 428 C 120 428, 85 460, 85 510" stroke="${C.teal}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-teal)" />
    <path class="bg-track" d="M 155 542 L 170 542" stroke="${C.teal}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 155 542 L 170 542" stroke="${C.teal}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-teal)" />
    <path class="bg-track" d="M 380 542 L 395 542" stroke="${C.crimson}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 380 542 L 395 542" stroke="${C.crimson}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-crimson)" />
    <path class="bg-track" d="M 595 542 L 610 542" stroke="${C.amber}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 595 542 L 610 542" stroke="${C.amber}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-amber)" />
    <path class="bg-track" d="M 830 542 L 845 542" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 830 542 L 845 542" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />
    <path class="bg-track" d="M 1005 542 L 1020 542" stroke="${C.azure}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 1005 542 L 1020 542" stroke="${C.azure}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-azure)" />
    <path d="M 275 510 C 230 450, 230 360, 320 324" stroke="${C.crimson}" stroke-width="2" stroke-linecap="round" stroke-dasharray="5 5" fill="none" marker-end="url(#arrow-crimson)" opacity="0.85" />
    <text x="175" y="420" font-family="'JetBrains Mono', monospace" font-size="10" font-weight="700" fill="${C.crimson}">REMEDIATION LOOP</text>
  `;

  return buildHtmlPage(W, H, `${header}\n${paths}\n${cards}\n${footer}`);
}

function generateJoninHtml() {
  const W = 1200;
  const H = 760;

  const header = renderHeader(W, 'JONIN TASTE-SKILL PREMIUM UI BUILD PIPELINE', `LangGraph execute_node · Zero-AI-Slop & Akatsuki Security-Gated Frontend Engineering · v${PKG_VERSION}`, { text: 'TASTE-SKILL ENFORCED', col: C.violet });
  const roster = stdRoster('jonin', C.teal);
  const footer = renderFooter(W, H, 'LangGraph execute_node · Taste Dials (8/7/6) · Mandatory layout invariants · Three.js 3D viewport · 100% exact mockup fidelity · 0 errors 0 warnings');

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
      <text x="35" y="338" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">Fixed Left Sidebar &amp; 3D Viewport</text>
      <text x="35" y="356" font-family="'Inter', sans-serif" font-size="10" fill="${C.slateMed}">Dashboard sidebar · Three.js GLB/PNG preview</text>
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
      <text x="35" y="242" font-family="'Inter', sans-serif" font-size="11" font-weight="700" fill="${C.slateDark}">Three.js / WebGL</text>
      <text x="165" y="242" font-family="'JetBrains Mono', monospace" font-size="9" fill="${C.slateMed}">PMREM IBL · GLB / PNG</text>
    </g>
  `;

  const cards = [
    renderCard([50, 95, 340, 68], C.azure, 'USER UI SPECIFICATION', 'build_from_source · build_from_text · Taste Dials', 'host'),
    renderCard([430, 220, 340, 84], C.violet, '♦ JONIN BUILDER ENGINE', { detail: 'Tailwind CSS v4 · Motion 12 · Taste Dials 8/7/6', chips: ['Next.js', 'Nuxt', 'Svelte', 'Angular'] }, 'jonin'),
    renderCard([810, 140, 340, 68], C.teal, 'FRAMEWORK CLI GATES', 'pnpm build (0 errors) · pnpm lint (0 warnings)', 'anbu'),
    renderCard([810, 240, 340, 68], C.crimson, 'AKATSUKI BLUE SECURITY GATE', 'CSP, XSS audit, zero-script injection, 0 CVEs', 'akatsuki'),
    renderCard([810, 340, 340, 68], C.amber, 'TWO-STEP ZERO-AI-SLOP GATE', 'npx aislop 100/100 · antislop 0 findings', 'tokubetsu'),
    renderCard([810, 440, 340, 68], C.emerald, 'GATE 2 & PRODUCTION DELIVERY', 'pending_human_signoff · @advisor & Kage ≥98%', 'kage'),
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

  const header = renderHeader(W, 'KAGE REVIEWER 98% CONFIDENCE & DELIVERY GATE PIPELINE', `LangGraph.js review_node & remediate_node · Circuit Breaker Cap ≤ 7 · v${PKG_VERSION}`, { text: '98% MINIMUM CONFIDENCE', col: C.emerald });
  const roster = stdRoster('kage', C.emerald);
  const footer = renderFooter(W, H, 'Step 1: npx aislop scan (100/100) · Step 2: antislop (0 findings) · Socket CLI 0 alerts · @advisor review · Gate 2 (pending_human_signoff)');

  const cards = [
    renderCard([40, 125, 200, 68], C.azure, '1. TASK ARTIFACTS', 'PLAN.md · status.json · git diff', 'kage'),
    renderCard([270, 125, 215, 68], C.crimson, '2. AKATSUKI BLUE GATE', 'SAST · secrets · 0 CVEs', 'akatsuki'),
    renderCard([515, 125, 215, 68], C.amber, '3. TWO-STEP ZERO-SLOP', 'npx aislop 100/100 · 0 slop', 'tokubetsu'),
    renderCard([760, 125, 205, 68], C.violet, '4. SUPPLY CHAIN GATE', 'Socket CLI 0 alerts · pnpm audit', 'anbu'),
    renderCard([995, 125, 165, 68], C.emerald, '5. CONFIDENCE EVAL', '5 categories · @advisor', 'kage'),
    renderCard([890, 285, 270, 64], C.violet, 'AUTONOMOUS REMEDIATION', 'LangGraph remediate_node · cap ≤ 7', 'sannin'),
    renderCard([540, 300, 290, 64], C.crimson, 'BACKEND / CVE FIX (♠ ANBU)', 'remediates code, DB, CVEs, or logic', 'anbu'),
    renderCard([540, 395, 290, 64], C.azure, 'UI / 3D CRAFT FIX (♦ JONIN / ❖)', 'cleans styling, contrast, or 3D mesh', 'jonin'),
    renderCard([60, 550, 320, 72], C.teal, '6. CONFIDENCE APPROVED', { detail: '≥98.0% score · 0 findings · @advisor OK', chips: ['≥98.0%', 'PASS'] }, 'kage'),
    renderCard([420, 550, 340, 72], C.amber, '7. GATE 2: SIGN-OFF', { detail: 'pending_human_signoff · 3-option HITL', chips: ['HITL GATE', 'APPROVED'] }, 'host'),
    renderCard([800, 550, 340, 72], C.emerald, '8. SANNIN SYNTHESIS & RELEASE', { detail: 'final_report.md · release to host', chips: ['RELEASE', 'VERIFIED'] }, 'sannin')
  ].join('\n');

  const paths = `
    <path class="bg-track" d="M 240 159 L 270 159" stroke="${C.crimson}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 240 159 L 270 159" stroke="${C.crimson}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-crimson)" />
    <path class="bg-track" d="M 485 159 L 515 159" stroke="${C.amber}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 485 159 L 515 159" stroke="${C.amber}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-amber)" />
    <path class="bg-track" d="M 730 159 L 760 159" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 730 159 L 760 159" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />
    <path class="bg-track" d="M 965 159 L 995 159" stroke="${C.emerald}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 965 159 L 995 159" stroke="${C.emerald}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-emerald)" />
    <path class="bg-track" d="M 1075 193 L 1025 285" stroke="${C.crimson}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 1075 193 L 1025 285" stroke="${C.crimson}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-crimson)" />
    <path class="bg-track" d="M 890 317 C 865 317, 855 332, 830 332" stroke="${C.crimson}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 890 317 C 865 317, 855 332, 830 332" stroke="${C.crimson}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-crimson)" />
    <path class="bg-track" d="M 890 317 C 865 317, 855 427, 830 427" stroke="${C.azure}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 890 317 C 865 317, 855 427, 830 427" stroke="${C.azure}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-azure)" />
    <path d="M 540 332 C 450 332, 450 245, 622 193" stroke="${C.teal}" stroke-width="2" stroke-dasharray="5 5" fill="none" marker-end="url(#arrow-teal)" opacity="0.8" />
    <text x="440" y="265" font-family="'JetBrains Mono', monospace" font-size="9" font-weight="700" fill="${C.teal}">RE-EVALUATE</text>
    <path class="bg-track" d="M 685 459 C 685 510, 220 510, 220 550" stroke="${C.teal}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 685 459 C 685 510, 220 510, 220 550" stroke="${C.teal}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-teal)" />
    <path class="bg-track" d="M 380 586 L 420 586" stroke="${C.amber}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 380 586 L 420 586" stroke="${C.amber}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-amber)" />
    <path class="bg-track" d="M 760 586 L 800 586" stroke="${C.emerald}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 760 586 L 800 586" stroke="${C.emerald}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-emerald)" />
  `;

  return buildHtmlPage(W, H, `${header}\n${paths}\n${cards}\n${roster}\n${footer}`);
}

function generateQaHtml() {
  const W = 1200;
  const H = 760;

  const header = renderHeader(W, 'TOKEN-PRESERVING QA AUTOMATION WORKFLOW', `LangGraph execute_node · Deterministic Codification, E2E & DB Recovery Verification · v${PKG_VERSION}`, { text: 'TOKEN PRESERVATION', col: C.azure });
  const roster = stdRoster('anbu', C.amber);
  const footer = renderFooter(W, H, 'LangGraph execute_node · agent-browser + Playwright E2E · 3D viewport & GLB/PNG checks · konoha db check/restore · npx aislop 100/100 · ≤20 runs');

  const cards = [
    renderCard([50, 125, 190, 68], C.azure, '1. EXPLORE', 'agent-browser · Genin recon', 'genin'),
    renderCard([280, 125, 190, 68], C.teal, '2. FLOW FILE', 'declarative command JSON', 'anbu'),
    renderCard([510, 125, 190, 68], C.violet, '3. CODIFY', 'qa_codify (0 LLM tokens)', 'anbu'),
    renderCard([740, 125, 200, 68], C.amber, '4. HEADLESS EXEC', 'qa_e2e_run · 3D & DB check', 'anbu'),
    renderCard([980, 125, 170, 68], C.crimson, '5. RED / GREEN', 'verify test & aislop 100%', 'kage'),
    renderCard([890, 285, 260, 64], C.violet, 'AUTONOMOUS TRIAGE', 'src/sdlc_manager.js · cap ≤ 7', 'sannin'),
    renderCard([540, 300, 280, 64], C.violet, 'BACKEND / DB FIX (♠ ANBU)', 're-run qa_e2e_run & db check', 'anbu'),
    renderCard([540, 395, 280, 64], C.azure, 'UI / 3D BUG FIX (♦ JONIN / ❖)', 'Tailwind CSS / Three.js / GLB fix', 'jonin'),
    renderCard([50, 550, 330, 72], C.teal, '6. EVIDENCE & PRUNE', 'Save run_id to sdlc_tasks · retain ≤20 runs', 'anbu'),
    renderCard([420, 550, 340, 72], C.crimson, '7. AKATSUKI BLUE GATE', 'SAST scan · Socket CLI · 0 secrets', 'akatsuki'),
    renderCard([800, 550, 350, 72], C.emerald, '8. LANGGRAPH REVIEW & RELEASE', 'pending_human_signoff · Kage ≥98% confidence', 'kage')
  ].join('\n');

  const paths = `
    <path class="bg-track" d="M 240 159 L 280 159" stroke="${C.teal}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 240 159 L 280 159" stroke="${C.teal}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-teal)" />
    <path class="bg-track" d="M 470 159 L 510 159" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 470 159 L 510 159" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />
    <path class="bg-track" d="M 700 159 L 740 159" stroke="${C.amber}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 700 159 L 740 159" stroke="${C.amber}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-amber)" />
    <path class="bg-track" d="M 940 159 L 980 159" stroke="${C.crimson}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 940 159 L 980 159" stroke="${C.crimson}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-crimson)" />
    <path class="bg-track" d="M 1065 193 L 1020 285" stroke="${C.crimson}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 1065 193 L 1020 285" stroke="${C.crimson}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-crimson)" />
    <path class="bg-track" d="M 890 317 C 860 317, 850 332, 820 332" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 890 317 C 860 317, 850 332, 820 332" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />
    <path class="bg-track" d="M 890 317 C 860 317, 850 427, 820 427" stroke="${C.azure}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 890 317 C 860 317, 850 427, 820 427" stroke="${C.azure}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-azure)" />
    <path d="M 540 332 C 450 332, 450 245, 780 193" stroke="${C.teal}" stroke-width="2" stroke-dasharray="5 5" fill="none" marker-end="url(#arrow-teal)" opacity="0.8" />
    <path class="bg-track" d="M 680 459 C 680 510, 215 510, 215 550" stroke="${C.teal}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 680 459 C 680 510, 215 510, 215 550" stroke="${C.teal}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-teal)" />
    <path class="bg-track" d="M 380 586 L 420 586" stroke="${C.crimson}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 380 586 L 420 586" stroke="${C.crimson}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-crimson)" />
    <path class="bg-track" d="M 760 586 L 800 586" stroke="${C.emerald}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 760 586 L 800 586" stroke="${C.emerald}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-emerald)" />
    <path d="M 590 550 C 590 480, 700 470, 700 364" stroke="${C.crimson}" stroke-width="2" stroke-linecap="round" stroke-dasharray="5 5" fill="none" marker-end="url(#arrow-crimson)" opacity="0.85" />
    <text x="610" y="460" font-family="'JetBrains Mono', monospace" font-size="9" font-weight="700" fill="${C.crimson}">SECURITY LOOP</text>
  `;

  return buildHtmlPage(W, H, `${header}\n${paths}\n${cards}\n${roster}\n${footer}`);
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
  generateTelegramHtml: () => require('./tokubetsu_flow_anbu').generateTelegramHtml(),
  generateAkatsukiHtml: () => require('./tokubetsu_flow_anbu').generateAkatsukiHtml(),
  generateYamanakaHtml: () => require('./tokubetsu_flow_anbu').generateYamanakaHtml(),
  generateAnbuHtml: () => require('./tokubetsu_flow_anbu').generateAnbuHtml()
};
