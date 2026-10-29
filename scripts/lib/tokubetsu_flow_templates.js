'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

const PKG_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')).version || '2.2.13';
  } catch (_) {
    return '2.2.13';
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

function renderCard(box, col, title, opt = '') {
  const [x, y, w, h] = box;
  const detail = typeof opt === 'string' ? opt : (opt?.detail || '');
  const chips = Array.isArray(opt) ? opt : (opt?.chips || []);

  let chipHtml = '';
  if (chips.length > 0) {
    const chipW = 60;
    const gap = 8;
    const totalW = chips.length * chipW + (chips.length - 1) * gap;
    const startX = x + (w - totalW) / 2;
    chipHtml = renderChips([startX, y, h], col, chips);
  }

  return `
    <g class="flow-card" transform="translate(0, 0)">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="#FFFFFF" stroke="${col}" stroke-width="2" filter="url(#cardShadow)" />
      <rect x="${x}" y="${y}" width="${w}" height="5" rx="2.5" fill="${col}" />
      <text x="${x + w / 2}" y="${y + (chips.length > 0 ? 24 : detail ? 26 : h / 2 + 5)}" text-anchor="middle" font-family="'Inter', sans-serif" font-size="13" font-weight="700" fill="#0F172A">${title}</text>
      ${detail ? `<text x="${x + w / 2}" y="${y + (chips.length > 0 ? 40 : 44)}" text-anchor="middle" font-family="'Inter', sans-serif" font-size="11" font-weight="500" fill="#475569">${detail}</text>` : ''}
      ${chipHtml}
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

function generateOrchestrationHtml() {
  const W = 1200;
  const H = 675;

  const header = renderHeader(W, 'KONOHA MCP ORCHESTRATION & EXECUTION FLOW', `Two-Stage HITL Gates (Gate 1 & Gate 2) & Single-Thread Persona Adoption · v${PKG_VERSION}`, { text: '83–98% TOKEN SAVINGS', col: C.azure });
  const footer = renderFooter(W, H, '47 canonical MCP tools · 8 coding clients · Gate 1 (pending_plan_approval) · Gate 2 (pending_human_signoff)');

  const cards = [
    renderCard([40, 95, 180, 56], C.azure, 'USER PROMPT', 'user · resume prompt'),
    renderCard([260, 88, 240, 70], C.violet, 'PRIMARY ORCHESTRATOR', 'main agent · 8 coding clients'),
    renderCard([40, 195, 270, 56], C.teal, '1. PROJECT MEMORY & CONTEXT', 'stack detect · auto-inject invariants'),
    renderCard([340, 195, 280, 56], C.azure, '2. DISCOVER SKILL & HYGIENE', 'find_skill · semble.search · aislop_scan'),
    renderCard([650, 190, 270, 66], C.amber, 'GATE 1: PLAN APPROVAL', 'pending_plan_approval · IDE / Telegram'),
    renderCard([320, 295, 340, 58], C.violet, '3. STRUCTURED MCP DELEGATION', 'task, context, constraints, skills'),
    renderCard([230, 390, 700, 76], C.violet, '4. SPECIALIST NINJA AGENTS', { detail: 'single-thread persona adoption', chips: ['genin', 'kage', 'jonin', 'anbu', 'chunin', 'tokubetsu', 'akatsuki'] }),
    renderCard([15, 510, 140, 64], C.teal, '5. TASK REPORT', 'report_from_agent'),
    renderCard([170, 510, 210, 64], C.crimson, '6. AKATSUKI BLUE GATE', 'SAST · 0 CVEs · secret scan'),
    renderCard([395, 510, 200, 64], C.amber, '7. KAGE REVIEW GATE', 'zero-AI-slop · ≥98% conf'),
    renderCard([610, 510, 220, 64], C.amber, 'GATE 2: SIGN-OFF', 'pending_human_signoff · HITL'),
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

  const header = renderHeader(W, 'JONIN TASTE-SKILL PREMIUM UI BUILD PIPELINE', `Zero-AI-Slop & Akatsuki Security-Gated Frontend Engineering across All Modern Frameworks · v${PKG_VERSION}`, { text: 'TASTE-SKILL ENFORCED', col: C.violet });
  const footer = renderFooter(W, H, 'Mandatory layout invariants · pure light mode · 100% exact mockup fidelity · 0 errors 0 warnings');

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
    renderCard([50, 95, 340, 68], C.azure, 'USER UI SPECIFICATION', 'build_from_source · build_from_text'),
    renderCard([430, 220, 340, 84], C.violet, '♦ JONIN BUILDER ENGINE', { detail: 'Tailwind CSS v4 · Framer Motion · Pure Light', chips: ['Next.js', 'Nuxt', 'Svelte', 'Angular'] }),
    renderCard([810, 140, 340, 68], C.teal, 'FRAMEWORK CLI GATES', 'pnpm build (0 errors) · pnpm lint (0 warnings)'),
    renderCard([810, 240, 340, 68], C.crimson, 'AKATSUKI BLUE SECURITY GATE', '🛡️ CSP, XSS audit, zero-script injection, 0 CVEs'),
    renderCard([810, 340, 340, 68], C.amber, 'TWO-STEP ZERO-AI-SLOP GATE', '100/100 mechanical scan · antislop verified'),
    renderCard([810, 440, 340, 68], C.emerald, 'GATE 2 & PRODUCTION DELIVERY', 'pending_human_signoff · 100% exact fidelity'),
    renderCard([810, 540, 340, 62], C.azure, 'DELIVERY REPORT TO HOST', 'clean release deliverable to orchestrator')
  ].join('\n');

  const paths = `
    <path class="bg-track" d="M 220 163 L 220 195" stroke="${C.teal}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 220 163 L 220 195" stroke="${C.teal}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-teal)" />
    <path class="bg-track" d="M 390 262 L 430 262" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 390 262 L 430 262" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />
    <path class="bg-track" d="M 600 304 L 600 360" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 600 304 L 600 360" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />
    <path class="bg-track" d="M 770 262 C 790 262, 790 174, 810 174" stroke="${C.teal}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 770 262 C 790 262, 790 174, 810 174" stroke="${C.teal}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-teal)" />
    <path class="bg-track" d="M 980 208 L 980 240" stroke="${C.crimson}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 980 208 L 980 240" stroke="${C.crimson}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-crimson)" />
    <path class="bg-track" d="M 980 308 L 980 340" stroke="${C.amber}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 980 308 L 980 340" stroke="${C.amber}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-amber)" />
    <path class="bg-track" d="M 980 408 L 980 440" stroke="${C.emerald}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 980 408 L 980 440" stroke="${C.emerald}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-emerald)" />
    <path class="bg-track" d="M 980 508 L 980 540" stroke="${C.azure}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 980 508 L 980 540" stroke="${C.azure}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-azure)" />
  `;

  return buildHtmlPage(W, H, `${header}\n${containerInvariants}\n${containerFrameworks}\n${paths}\n${cards}\n${footer}`);
}

function generateKageHtml() {
  const W = 1200;
  const H = 760;

  const header = renderHeader(W, 'KAGE REVIEWER 98% CONFIDENCE & DELIVERY GATE PIPELINE', `Two-Step Zero-AI-Slop Pre-Gate, Socket Supply Chain & Autonomous Remediation Loop · v${PKG_VERSION}`, { text: '98% MINIMUM CONFIDENCE', col: C.emerald });
  const footer = renderFooter(W, H, 'Step 1: aislop_scan (100/100) · Step 2: antislop (0 findings) · Akatsuki Blue Gate cleared · Gate 2 (pending_human_signoff)');

  const cards = [
    renderCard([40, 130, 200, 68], C.azure, '1. TASK ARTIFACTS', 'plan.md, status.json, git diff'),
    renderCard([270, 130, 215, 68], C.crimson, '2. AKATSUKI BLUE GATE', '🛡️ SAST, secrets, 0 CVEs'),
    renderCard([515, 130, 215, 68], C.amber, '3. TWO-STEP ZERO-SLOP', '100/100 score · 0 slop rules'),
    renderCard([760, 130, 205, 68], C.violet, '4. SUPPLY CHAIN GATE', 'Socket 0 alerts · license audit'),
    renderCard([995, 130, 165, 68], C.emerald, '5. CONFIDENCE EVAL', 'weighted 5 categories'),
    renderCard([890, 290, 270, 64], C.violet, 'AUTONOMOUS KAGE TRIAGE', 'src/sdlc_manager.js · circuit breaker'),
    renderCard([540, 310, 290, 64], C.crimson, 'BACKEND / CVE FIX (♠ ANBU)', 'remediates code, CVEs, or logic'),
    renderCard([540, 410, 290, 64], C.azure, 'UI / CRAFT FIX (♦ JONIN)', 'cleans styling, contrast, or slop'),
    renderCard([60, 560, 320, 72], C.teal, '6. CONFIDENCE APPROVED', { detail: '≥98.0% score · 0 findings · advisor OK', chips: ['≥98.0%', 'PASS'] }),
    renderCard([420, 560, 340, 72], C.amber, '7. GATE 2: SIGN-OFF', { detail: 'pending_human_signoff · HITL verdict', chips: ['HITL GATE', 'APPROVED'] }),
    renderCard([800, 560, 340, 72], C.emerald, '8. SANNIN SYNTHESIS & RELEASE', { detail: 'final_report.md · release to host', chips: ['RELEASE', 'VERIFIED'] })
  ].join('\n');

  const paths = `
    <path class="bg-track" d="M 240 164 L 270 164" stroke="${C.crimson}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 240 164 L 270 164" stroke="${C.crimson}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-crimson)" />
    <path class="bg-track" d="M 485 164 L 515 164" stroke="${C.amber}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 485 164 L 515 164" stroke="${C.amber}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-amber)" />
    <path class="bg-track" d="M 730 164 L 760 164" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 730 164 L 760 164" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />
    <path class="bg-track" d="M 965 164 L 995 164" stroke="${C.emerald}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 965 164 L 995 164" stroke="${C.emerald}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-emerald)" />
    <path class="bg-track" d="M 1075 198 L 1025 290" stroke="${C.crimson}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 1075 198 L 1025 290" stroke="${C.crimson}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-crimson)" />
    <path class="bg-track" d="M 890 322 C 865 322, 855 342, 830 342" stroke="${C.crimson}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 890 322 C 865 322, 855 342, 830 342" stroke="${C.crimson}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-crimson)" />
    <path class="bg-track" d="M 890 322 C 865 322, 855 442, 830 442" stroke="${C.azure}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 890 322 C 865 322, 855 442, 830 442" stroke="${C.azure}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-azure)" />
    <path d="M 540 342 C 450 342, 450 250, 622 198" stroke="${C.teal}" stroke-width="2" stroke-dasharray="5 5" fill="none" marker-end="url(#arrow-teal)" opacity="0.8" />
    <text x="440" y="270" font-family="'JetBrains Mono', monospace" font-size="9" font-weight="700" fill="${C.teal}">RE-EVALUATE</text>
    <path class="bg-track" d="M 685 474 C 685 520, 220 520, 220 560" stroke="${C.teal}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 685 474 C 685 520, 220 520, 220 560" stroke="${C.teal}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-teal)" />
    <path class="bg-track" d="M 380 596 L 420 596" stroke="${C.amber}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 380 596 L 420 596" stroke="${C.amber}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-amber)" />
    <path class="bg-track" d="M 760 596 L 800 596" stroke="${C.emerald}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 760 596 L 800 596" stroke="${C.emerald}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-emerald)" />
  `;

  return buildHtmlPage(W, H, `${header}\n${paths}\n${cards}\n${footer}`);
}

function generateQaHtml() {
  const W = 1200;
  const H = 760;

  const header = renderHeader(W, 'TOKEN-PRESERVING QA AUTOMATION WORKFLOW', `Deterministic Codification & Headless E2E Verification (♠ Anbu Owner) · v${PKG_VERSION}`, { text: 'TOKEN PRESERVATION', col: C.azure });
  const footer = renderFooter(W, H, 'Zero LLM tokens during test runs · <2,000 chars capped evidence · autonomous fix loops');

  const cards = [
    renderCard([50, 130, 190, 68], C.azure, '1. EXPLORE', 'agent-browser scoped'),
    renderCard([280, 130, 190, 68], C.teal, '2. FLOW FILE', 'declarative command JSON'),
    renderCard([510, 130, 190, 68], C.violet, '3. CODIFY', 'qa_codify (0 LLM tokens)'),
    renderCard([740, 130, 200, 68], C.amber, '4. HEADLESS EXEC', 'qa_e2e_run (Playwright)'),
    renderCard([980, 130, 170, 68], C.crimson, '5. RED / GREEN', 'verify test outcome'),
    renderCard([890, 290, 260, 64], C.violet, 'AUTONOMOUS TRIAGE', 'src/sdlc_manager.js'),
    renderCard([540, 310, 280, 64], C.violet, 'BACKEND BUG FIX (♠ ANBU)', 're-run qa_e2e_run = GREEN'),
    renderCard([540, 410, 280, 64], C.azure, 'UI BUG FIX (♦ JONIN)', 'Tailwind CSS / responsive fix'),
    renderCard([50, 560, 330, 72], C.teal, '6. EVIDENCE PERSISTENCE', 'Save run_id to SQLite sdlc_tasks & report'),
    renderCard([420, 560, 340, 72], C.crimson, '7. AKATSUKI BLUE GATE', '🛡️ SAST scan, dependency CVEs & secrets audit'),
    renderCard([800, 560, 350, 72], C.emerald, '8. KAGE GATE 2 & DELIVERY', 'pending_human_signoff · Kage ≥98% confidence')
  ].join('\n');

  const paths = `
    <path class="bg-track" d="M 240 164 L 280 164" stroke="${C.teal}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 240 164 L 280 164" stroke="${C.teal}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-teal)" />
    <path class="bg-track" d="M 470 164 L 510 164" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 470 164 L 510 164" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />
    <path class="bg-track" d="M 700 164 L 740 164" stroke="${C.amber}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 700 164 L 740 164" stroke="${C.amber}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-amber)" />
    <path class="bg-track" d="M 940 164 L 980 164" stroke="${C.crimson}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 940 164 L 980 164" stroke="${C.crimson}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-crimson)" />
    <path class="bg-track" d="M 1065 198 L 1020 290" stroke="${C.crimson}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 1065 198 L 1020 290" stroke="${C.crimson}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-crimson)" />
    <path class="bg-track" d="M 890 322 C 860 322, 850 342, 820 342" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 890 322 C 860 322, 850 342, 820 342" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />
    <path class="bg-track" d="M 890 322 C 860 322, 850 442, 820 442" stroke="${C.azure}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 890 322 C 860 322, 850 442, 820 442" stroke="${C.azure}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-azure)" />
    <path d="M 540 342 C 450 342, 450 250, 780 198" stroke="${C.teal}" stroke-width="2" stroke-dasharray="5 5" fill="none" marker-end="url(#arrow-teal)" opacity="0.8" />
    <path class="bg-track" d="M 680 474 C 680 520, 215 520, 215 560" stroke="${C.teal}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 680 474 C 680 520, 215 520, 215 560" stroke="${C.teal}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-teal)" />
    <path class="bg-track" d="M 380 596 L 420 596" stroke="${C.crimson}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 380 596 L 420 596" stroke="${C.crimson}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-crimson)" />
    <path class="bg-track" d="M 760 596 L 800 596" stroke="${C.emerald}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 760 596 L 800 596" stroke="${C.emerald}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-emerald)" />
    <path d="M 590 560 C 590 490, 700 480, 700 374" stroke="${C.crimson}" stroke-width="2" stroke-linecap="round" stroke-dasharray="5 5" fill="none" marker-end="url(#arrow-crimson)" opacity="0.85" />
    <text x="610" y="470" font-family="'JetBrains Mono', monospace" font-size="9" font-weight="700" fill="${C.crimson}">SECURITY LOOP</text>
  `;

  return buildHtmlPage(W, H, `${header}\n${paths}\n${cards}\n${footer}`);
}

function generateTelegramHtml() {
  const W = 1200;
  const H = 760;

  const header = renderHeader(W, 'TELEGRAM REMOTE AUTOMATION & TWO-STAGE HITL GATES', `Interactive Gate 1 & Gate 2 Inline Keyboards, Encrypted HTTPS & Zero-Port Ingress · v${PKG_VERSION}`, { text: 'HITL GATES ENABLED', col: C.azure });
  const footer = renderFooter(W, H, 'Interactive [Approve] / [Reject] callbacks · /approval list · /doctor diagnostics · /session switcher');

  const topTrackContainer = `
    <g transform="translate(50, 120)">
      <rect width="1100" height="230" rx="14" fill="${C.containerBg}" stroke="${C.azure}" stroke-width="1.5" />
      <text x="24" y="28" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">OUTBOUND TASK STATUS REPORTER (src/telegram/notifier.js)</text>
    </g>
  `;

  const bottomTrackContainer = `
    <g transform="translate(50, 420)">
      <rect width="1100" height="270" rx="14" fill="${C.containerBg}" stroke="${C.violet}" stroke-width="1.5" />
      <text x="24" y="28" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">INBOUND LONG POLLING DAEMON & LOCAL EVENT INGRESS (src/telegram/poller.js)</text>
    </g>
  `;

  const securityBanner = `
    <g transform="translate(50, 362)">
      <rect width="1100" height="46" rx="8" fill="#FFFFFF" stroke="${C.emerald}" stroke-width="1.5" filter="url(#cardShadow)" />
      <circle cx="24" cy="23" r="5" fill="${C.emerald}" />
      <text x="38" y="28" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">SECURITY GUARDRAILS:</text>
      <text x="195" y="28" font-family="'Inter', sans-serif" font-size="11" fill="${C.slateMed}">Zero Open Inbound Ports · Chat ID Whitelist · Two-Stage HITL Verification · Mode A SSO / Mode B PIN Auth (x-konoha-pin)</text>
    </g>
  `;

  const cards = [
    renderCard([80, 180, 220, 68], C.azure, 'SDLC TASK EVENT', 'task queued / running / sign-off'),
    renderCard([350, 180, 230, 68], C.teal, 'TWO-STAGE HITL NOTIFIER', 'Gate 1 & Gate 2 inline buttons'),
    renderCard([630, 180, 230, 68], C.violet, 'HTTPS TELEGRAM API', 'POST /sendMessage & callbacks'),
    renderCard([910, 180, 210, 68], C.emerald, 'AUTHORIZED USER', 'one-tap [Approve] / [Reject] buttons'),
    renderCard([80, 480, 220, 72], C.azure, 'USER COMMANDS & ACTIONS', '/approval, /doctor, /session, /sh, /run'),
    renderCard([350, 480, 230, 72], C.violet, 'WHITELISTED POLLER', 'long polling timeout=30 · callbacks'),
    renderCard([630, 480, 230, 72], C.amber, 'TWO-STAGE HITL RESOLUTION', 'pending_plan_approval & sign-off'),
    renderCard([910, 480, 210, 72], C.emerald, 'AUTONOMOUS WORKER', 'resumes SDLC execution DAG')
  ].join('\n');

  const paths = `
    <path class="bg-track" d="M 300 214 L 350 214" stroke="${C.teal}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 300 214 L 350 214" stroke="${C.teal}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-teal)" />
    <path class="bg-track" d="M 580 214 L 630 214" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 580 214 L 630 214" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />
    <path class="bg-track" d="M 860 214 L 910 214" stroke="${C.emerald}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 860 214 L 910 214" stroke="${C.emerald}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-emerald)" />
    <path class="bg-track" d="M 300 516 L 350 516" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 300 516 L 350 516" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />
    <path class="bg-track" d="M 580 516 L 630 516" stroke="${C.amber}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 580 516 L 630 516" stroke="${C.amber}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-amber)" />
    <path class="bg-track" d="M 860 516 L 910 516" stroke="${C.emerald}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 860 516 L 910 516" stroke="${C.emerald}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-emerald)" />
  `;

  return buildHtmlPage(W, H, `${header}\n${topTrackContainer}\n${bottomTrackContainer}\n${securityBanner}\n${paths}\n${cards}\n${footer}`);
}

function generateAkatsukiHtml() {
  const W = 1200;
  const H = 760;

  const header = renderHeader(W, 'AKATSUKI SECURITY CONTROLS & DUAL-MODE LAB LIFECYCLE', `Dual-Mode Isolation (Blue SAST vs Red Pentest) · Container Sandboxing · Fail-Closed Invariants · v${PKG_VERSION}`, { text: 'SECURITY GUARDIAN', col: C.crimson });
  const footer = renderFooter(W, H, 'mode: blue (defensive host default) · mode: red (automated isolated lab setup) · env: docker (default) | lxc · RoE gating');

  const topTrackContainer = `
    <g transform="translate(40, 85)">
      <rect width="1120" height="115" rx="12" fill="${C.containerBg}" stroke="${C.azure}" stroke-width="1.5" />
      <text x="20" y="22" font-family="'Inter', sans-serif" font-size="11" font-weight="800" fill="${C.slateDark}" letter-spacing="0.5">BLUE-TEAM DEFENSIVE SECURITY TRACK (Default Mode: blue · Direct Host SAST &amp; Secrets Audit)</text>
    </g>
  `;

  const middleRoeContainer = `
    <g transform="translate(40, 215)">
      <rect width="1120" height="110" rx="12" fill="${C.containerBg}" stroke="${C.amber}" stroke-width="1.5" />
      <text x="20" y="22" font-family="'Inter', sans-serif" font-size="11" font-weight="800" fill="${C.slateDark}" letter-spacing="0.5">MODE: RED AUTHORIZATION FIREWALL &amp; RULES OF ENGAGEMENT (RoE GATING)</text>
    </g>
  `;

  const sandboxContainer = `
    <g transform="translate(40, 340)">
      <rect width="740" height="375" rx="14" fill="${C.containerBg}" stroke="${C.crimson}" stroke-width="1.5" />
      <text x="20" y="24" font-family="'Inter', sans-serif" font-size="12" font-weight="800" fill="${C.slateDark}" letter-spacing="0.5">ISOLATED CONTAINER SANDBOX (akatsuki-lab · Zero Host Network &amp; Zero Host Mounts)</text>
      <g transform="translate(20, 318)">
        <rect width="700" height="42" rx="8" fill="#FFFFFF" stroke="${C.crimson}" stroke-width="1.5" filter="url(#cardShadow)" />
        <circle cx="20" cy="21" r="5" fill="${C.crimson}" />
        <text x="36" y="25" font-family="'Inter', sans-serif" font-size="11" font-weight="700" fill="${C.slateDark}">CONTAINER SAFETY INVARIANT: <tspan fill="${C.crimson}">Direct host execution strictly prohibited</tspan> · Dropped Capabilities (--cap-drop=ALL)</text>
      </g>
    </g>
  `;

  const rightGatePanel = `
    <g transform="translate(800, 340)">
      <rect width="360" height="375" rx="14" fill="${C.containerBg}" stroke="${C.teal}" stroke-width="1.5" />
      <text x="180" y="24" text-anchor="middle" font-family="'Inter', sans-serif" font-size="12" font-weight="800" fill="${C.slateDark}" letter-spacing="0.5">PERSONA BOUNDARY &amp; KAGE GATE</text>
    </g>
  `;

  const cards = [
    renderCard([60, 118, 180, 66], C.azure, '1. CLI INGRESS', 'konoha akatsuki [mode|env]'),
    renderCard([280, 118, 210, 66], C.violet, '2. BLUE DISPATCH', 'direct host static analysis'),
    renderCard([530, 118, 200, 66], C.teal, '3. SAST & SECRETS', 'pnpm/pip audit, .env scan'),
    renderCard([770, 118, 190, 66], C.violet, '4. SKILL GUARDIAN', 'fail-closed AST review'),
    renderCard([1000, 118, 140, 66], C.emerald, '5. BLUE GATE', '0 CVEs · lab stopped'),
    renderCard([60, 248, 220, 64], C.crimson, '6. MODE: RED INGRESS', 'konoha akatsuki mode red'),
    renderCard([310, 248, 260, 64], C.emerald, '7. STANDING AUTHORIZATION', 'operator authorized · zero decline'),
    renderCard([600, 248, 270, 64], C.amber, '8. AUTO-PROVISION (akatsuki_init)', 'docker | lxc auto-detect · dual setup'),
    renderCard([900, 248, 240, 64], C.violet, '9. CHUNIN RECON', 'passive OSINT & ATT&CK intel'),
    renderCard([60, 378, 210, 66], C.amber, '10. MULTI-ENGINE SANDBOX', 'akatsuki-lab on docker | lxc'),
    renderCard([300, 378, 230, 66], C.crimson, '11. UNRESTRICTED TOOLS', '20 curated tools · 3600s cap'),
    renderCard([560, 378, 200, 66], C.teal, '12. EVIDENCE HARVEST', 'non-destructive PoC probes'),
    renderCard([120, 480, 290, 66], C.emerald, '13. DIAGNOSTIC CLEANUP', 'purge transient probes upon exit'),
    renderCard([440, 480, 280, 66], C.azure, '14. TOKUBETSU-JONIN PDF REPORT', 'publication-grade 8-section report'),
    renderCard([820, 378, 320, 66], C.teal, 'STRICT PERSONA BOUNDARY', 'offensive skills restricted to @akatsuki'),
    renderCard([820, 480, 320, 66], C.crimson, 'REMEDIATION LOOP (♠ ANBU)', 'synthesizes patches for findings'),
    renderCard([820, 580, 320, 78], C.emerald, '15. KAGE DELIVERY GATE', { detail: 'confidence ≥98% · 0 unhandled CVEs', chips: ['0 CRIT/HIGH', 'FAIL-CLOSED'] })
  ].join('\n');

  const paths = `
    <path class="bg-track" d="M 240 151 L 280 151" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 240 151 L 280 151" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />
    <path class="bg-track" d="M 490 151 L 530 151" stroke="${C.teal}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 490 151 L 530 151" stroke="${C.teal}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-teal)" />
    <path class="bg-track" d="M 730 151 L 770 151" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 730 151 L 770 151" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />
    <path class="bg-track" d="M 960 151 L 1000 151" stroke="${C.emerald}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 960 151 L 1000 151" stroke="${C.emerald}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-emerald)" />
    <path class="bg-track" d="M 150 184 L 150 248" stroke="${C.crimson}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 150 184 L 150 248" stroke="${C.crimson}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-crimson)" />
    <path class="bg-track" d="M 280 280 L 310 280" stroke="${C.emerald}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 280 280 L 310 280" stroke="${C.emerald}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-emerald)" />
    <path class="bg-track" d="M 570 280 L 600 280" stroke="${C.amber}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 570 280 L 600 280" stroke="${C.amber}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-amber)" />
    <path class="bg-track" d="M 870 280 L 900 280" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 870 280 L 900 280" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />
    <path class="bg-track" d="M 1020 312 C 1020 350, 165 340, 165 378" stroke="${C.amber}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 1020 312 C 1020 350, 165 340, 165 378" stroke="${C.amber}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-amber)" />
    <path class="bg-track" d="M 270 411 L 300 411" stroke="${C.crimson}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 270 411 L 300 411" stroke="${C.crimson}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-crimson)" />
    <path class="bg-track" d="M 530 411 L 560 411" stroke="${C.teal}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 530 411 L 560 411" stroke="${C.teal}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-teal)" />
    <path class="bg-track" d="M 660 444 C 660 465, 265 460, 265 480" stroke="${C.emerald}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 660 444 C 660 465, 265 460, 265 480" stroke="${C.emerald}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-emerald)" />
    <path class="bg-track" d="M 410 513 L 440 513" stroke="${C.azure}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 410 513 L 440 513" stroke="${C.azure}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-azure)" />
    <path d="M 265 546 C 265 570, 820 540, 820 513" stroke="${C.crimson}" stroke-width="2" stroke-linecap="round" stroke-dasharray="5 5" fill="none" marker-end="url(#arrow-crimson)" opacity="0.85" />
    <text x="540" y="565" font-family="'JetBrains Mono', monospace" font-size="10" font-weight="700" fill="${C.crimson}">REMEDIATION LOOP (♠ ANBU)</text>
    <path class="bg-track" d="M 720 513 C 760 513, 760 619, 820 619" stroke="${C.emerald}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 720 513 C 760 513, 760 619, 820 619" stroke="${C.emerald}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-emerald)" />
  `;

  return buildHtmlPage(W, H, `${header}\n${topTrackContainer}\n${middleRoeContainer}\n${sandboxContainer}\n${rightGatePanel}\n${paths}\n${cards}\n${footer}`);
}

module.exports = {
  C,
  PKG_VERSION,
  buildHtmlPage,
  renderCard,
  renderHeader,
  renderFooter,
  generateOrchestrationHtml,
  generateJoninHtml,
  generateKageHtml,
  generateQaHtml,
  generateTelegramHtml,
  generateAkatsukiHtml
};
