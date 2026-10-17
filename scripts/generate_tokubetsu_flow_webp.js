#!/usr/bin/env node
'use strict';

/**
 * scripts/generate_tokubetsu_flow_webp.js
 * Generates the 5 canonical animated workflow diagrams embedded in the README and documentation
 * using the Tokubetsu-Jonin Light Design Standard:
 *   - Pure light canvas (#FFFFFF to #FAFBFD), slate dot matrix, subtle brand glow.
 *   - Base Theme 01 4-color gradient accents: Azure (#3B82F6), Teal (#14B8A6), Violet (#8B5CF6), Amber (#F97316).
 *   - White card nodes (#FFFFFF) with elevation shadows, colored accent top bars, and bold slate typography (#0F172A).
 *   - Animated marching dashed lines, flowing ambient tracks, and traveling pulse particles.
 *   - High-fidelity Playwright Chromium capture (deviceScaleFactor: 2) + FFmpeg libwebp_anim (-q:v 90).
 *   - Pure Node.js binary structural validation via validateAnimatedWebP.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const playwright = require('playwright');
const { validateAnimatedWebP } = require('../src/tools/document_engine');

const ROOT_DIR = path.resolve(__dirname, '..');
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
fs.mkdirSync(ASSETS_DIR, { recursive: true });

const PKG_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')).version || '2.1.18';
  } catch (_) {
    return '2.1.18';
  }
})();

// Canonical Base Theme (Theme 01) Colors
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

// Common base HTML/SVG shell
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
    <!-- Drop Shadow Filter -->
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
    <!-- Dot Matrix Pattern -->
    <pattern id="dotGrid" width="24" height="24" patternUnits="userSpaceOnUse">
      <circle cx="12" cy="12" r="1.1" fill="#94A3B8" opacity="0.18" />
    </pattern>
    <!-- Brand Radial Wash -->
    <radialGradient id="brandWash" cx="50%" cy="35%" r="65%">
      <stop offset="0%" stop-color="#3B82F6" stop-opacity="0.04" />
      <stop offset="100%" stop-color="#3B82F6" stop-opacity="0" />
    </radialGradient>
    <!-- Theme Gradients -->
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
    <!-- Arrowheads -->
    <marker id="arrow-azure" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
      <path d="M 1 1.5 L 6 4 L 1 6.5 Z" fill="#3B82F6" />
    </marker>
    <marker id="arrow-violet" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
      <path d="M 1 1.5 L 6 4 L 1 6.5 Z" fill="#8B5CF6" />
    </marker>
    <marker id="arrow-teal" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
      <path d="M 1 1.5 L 6 4 L 1 6.5 Z" fill="#14B8A6" />
    </marker>
    <marker id="arrow-amber" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
      <path d="M 1 1.5 L 6 4 L 1 6.5 Z" fill="#F97316" />
    </marker>
    <marker id="arrow-emerald" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
      <path d="M 1 1.5 L 6 4 L 1 6.5 Z" fill="#10B981" />
    </marker>
    <marker id="arrow-crimson" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
      <path d="M 1 1.5 L 6 4 L 1 6.5 Z" fill="#EF4444" />
    </marker>
  </defs>

  <!-- Canvas Background -->
  <rect width="100%" height="100%" fill="#FAFBFD" />
  <rect width="100%" height="100%" fill="url(#dotGrid)" />
  <rect width="100%" height="100%" fill="url(#brandWash)" />

  ${contentSvg}
</svg>
</body>
</html>`;
}

// Renders a card node in Tokubetsu-Jonin standard
function renderCard(x, y, w, h, col, title, detail, chips = [], _badge = null) {
  let chipHtml = '';
  if (chips && chips.length > 0) {
    const chipW = 60;
    const gap = 8;
    const totalW = chips.length * chipW + (chips.length - 1) * gap;
    let startX = x + (w - totalW) / 2;
    chips.forEach((c) => {
      chipHtml += `
        <rect x="${startX}" y="${y + h - 22}" width="${chipW}" height="16" rx="8" fill="${col}" fill-opacity="0.10" stroke="${col}" stroke-width="1" stroke-opacity="0.35" />
        <text x="${startX + chipW / 2}" y="${y + h - 10}" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="9" font-weight="700" fill="${col}">${c}</text>
      `;
      startX += chipW + gap;
    });
  }

  return `
    <g class="flow-card" transform="translate(0, 0)">
      <!-- Main Card Surface -->
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="#FFFFFF" stroke="${col}" stroke-width="2" filter="url(#cardShadow)" />
      <!-- Top 4-Color Gradient Accent Bar -->
      <rect x="${x}" y="${y}" width="${w}" height="5" rx="2.5" fill="${col}" />
      <!-- Card Title -->
      <text x="${x + w / 2}" y="${y + (chips.length > 0 ? 24 : detail ? 26 : h / 2 + 5)}" text-anchor="middle" font-family="'Inter', sans-serif" font-size="13" font-weight="700" fill="#0F172A">${title}</text>
      <!-- Detail / Sublabel -->
      ${detail ? `<text x="${x + w / 2}" y="${y + (chips.length > 0 ? 40 : 44)}" text-anchor="middle" font-family="'Inter', sans-serif" font-size="11" font-weight="500" fill="#475569">${detail}</text>` : ''}
      ${chipHtml}
    </g>
  `;
}

// Renders header chrome
function renderHeader(width, title, subtitle, badgeText = '83–98% TOKEN SAVINGS', badgeCol = '#3B82F6') {
  return `
    <!-- Header Title -->
    <text x="${width / 2}" y="38" text-anchor="middle" font-family="'Inter', sans-serif" font-size="22" font-weight="800" fill="#0F172A" letter-spacing="0.5">${title}</text>
    <!-- Subtitle -->
    <text x="${width / 2}" y="60" text-anchor="middle" font-family="'Inter', sans-serif" font-size="12" font-weight="500" fill="#475569">${subtitle}</text>
    <!-- Top Right Badge -->
    <g transform="translate(${width - 230}, 18)">
      <rect width="200" height="26" rx="13" fill="#FFFFFF" stroke="${badgeCol}" stroke-width="1.5" filter="url(#cardShadow)" />
      <circle cx="16" cy="13" r="4" fill="${badgeCol}" />
      <text x="28" y="17" font-family="'JetBrains Mono', monospace" font-size="10" font-weight="700" fill="#0F172A">${badgeText}</text>
    </g>
  `;
}

// Renders footer text
function renderFooter(width, height, text) {
  return `
    <text x="${width / 2}" y="${height - 14}" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="10" font-weight="500" fill="#64748B">${text}</text>
  `;
}

/* ================================================================== *
 * Scene 1: Konoha MCP Orchestration & Execution Flow
 * ================================================================== */
function generateOrchestrationHtml() {
  const W = 1200;
  const H = 675;

  const header = renderHeader(W, 'KONOHA MCP ORCHESTRATION & EXECUTION FLOW', `Single-Thread Persona Adoption via MCP Tools · v${PKG_VERSION}`, '83–98% TOKEN SAVINGS', C.azure);
  const footer = renderFooter(W, H, '45 canonical MCP tools · 7 coding clients · zero process cold-start · transparent contracts');

  const cards = [
    renderCard(50, 100, 190, 56, C.azure, 'USER PROMPT', 'user · resume prompt'),
    renderCard(320, 92, 260, 72, C.violet, 'PRIMARY ORCHESTRATOR', 'main agent · 7 coding clients'),
    renderCard(50, 215, 350, 60, C.teal, '1. PROJECT MEMORY & CONTEXT', 'stack detect · auto-inject invariants'),
    renderCard(490, 215, 360, 60, C.azure, '2. DISCOVER SKILL & HYGIENE', 'find_skill · semble.search · aislop_scan'),
    renderCard(320, 325, 360, 60, C.violet, '3. STRUCTURED MCP DELEGATION', 'jonin / anbu / kage dispatch'),
    renderCard(330, 435, 530, 76, C.violet, '4. SPECIALIST NINJA AGENTS', 'single-thread persona adoption', ['genin', 'kage', 'jonin', 'anbu', 'chunin', 'tokubetsu']),
    renderCard(50, 560, 180, 54, C.teal, '5. REPORT', 'report_from_agent'),
    renderCard(290, 550, 240, 64, C.amber, '6. KAGE REVIEW GATE', 'zero-AI-slop · ≥98% conf'),
    renderCard(590, 560, 180, 54, C.violet, '7. SYNTHESIZE', 'sannin final report'),
    renderCard(830, 560, 170, 54, C.azure, 'RESPONSE', 'deliver to user')
  ].join('\n');

  const paths = `
    <!-- Path Tracks -->
    <path class="bg-track" d="M 240 128 L 320 128" stroke="${C.azure}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 240 128 L 320 128" stroke="${C.azure}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-azure)" />

    <path class="bg-track" d="M 400 164 C 400 190, 225 185, 225 215" stroke="${C.teal}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 400 164 C 400 190, 225 185, 225 215" stroke="${C.teal}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-teal)" />

    <path class="bg-track" d="M 500 164 C 500 190, 670 185, 670 215" stroke="${C.azure}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 500 164 C 500 190, 670 185, 670 215" stroke="${C.azure}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-azure)" />

    <path class="bg-track" d="M 225 275 C 225 305, 420 300, 420 325" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 225 275 C 225 305, 420 300, 420 325" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />

    <path class="bg-track" d="M 670 275 C 670 305, 580 300, 580 325" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 670 275 C 670 305, 580 300, 580 325" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />

    <path class="bg-track" d="M 500 385 L 500 435" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 500 385 L 500 435" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />

    <path class="bg-track" d="M 400 511 C 400 535, 140 535, 140 560" stroke="${C.teal}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 400 511 C 400 535, 140 535, 140 560" stroke="${C.teal}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-teal)" />

    <path class="bg-track" d="M 230 585 L 290 585" stroke="${C.amber}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 230 585 L 290 585" stroke="${C.amber}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-amber)" />

    <path class="bg-track" d="M 530 585 L 590 585" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 530 585 L 590 585" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />

    <path class="bg-track" d="M 770 585 L 830 585" stroke="${C.azure}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 770 585 L 830 585" stroke="${C.azure}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-azure)" />

    <!-- Remediation Loop -->
    <path d="M 370 550 C 300 480, 300 400, 370 355" stroke="${C.crimson}" stroke-width="2" stroke-linecap="round" stroke-dasharray="5 5" fill="none" marker-end="url(#arrow-crimson)" opacity="0.85" />
    <text x="245" y="445" font-family="'JetBrains Mono', monospace" font-size="10" font-weight="700" fill="${C.crimson}">REMEDIATION LOOP</text>
  `;

  return buildHtmlPage(W, H, `${header}\n${paths}\n${cards}\n${footer}`);
}

/* ================================================================== *
 * Scene 2: Jonin Taste-Skill Premium UI Build Pipeline
 * ================================================================== */
function generateJoninHtml() {
  const W = 1200;
  const H = 760;

  const header = renderHeader(W, 'JONIN TASTE-SKILL PREMIUM UI BUILD PIPELINE', `Zero-AI-Slop Frontend Engineering across 4 Supported Frameworks · v${PKG_VERSION}`, 'TASTE-SKILL ENFORCED', C.violet);
  const footer = renderFooter(W, H, 'Mandatory layout invariants · pure light mode · 100% exact mockup fidelity · 0 errors 0 warnings');

  const containerInvariants = `
    <!-- Invariants Panel -->
    <g transform="translate(50, 210)">
      <rect width="340" height="420" rx="14" fill="${C.containerBg}" stroke="${C.teal}" stroke-width="1.5" />
      <text x="170" y="28" text-anchor="middle" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">MANDATORY KONOHA LAYOUT INVARIANTS</text>
      
      <!-- Invariant 1 -->
      <rect x="20" y="46" width="300" height="60" rx="8" fill="#FFFFFF" stroke="${C.borderLight}" stroke-width="1" />
      <text x="35" y="70" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">Far-Left Brand Logo</text>
      <text x="35" y="88" font-family="'Inter', sans-serif" font-size="10" fill="${C.slateMed}">Never centered · 0 mobile hamburger menu toggle</text>

      <!-- Invariant 2 -->
      <rect x="20" y="118" width="300" height="60" rx="8" fill="#FFFFFF" stroke="${C.borderLight}" stroke-width="1" />
      <text x="35" y="142" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">Archetype-Adaptive Mobile Dock</text>
      <text x="35" y="160" font-family="'Inter', sans-serif" font-size="10" fill="${C.slateMed}">Fixed bottom dock (lg:hidden) · one-tap quick links</text>

      <!-- Invariant 3 -->
      <rect x="20" y="190" width="300" height="60" rx="8" fill="#FFFFFF" stroke="${C.borderLight}" stroke-width="1" />
      <text x="35" y="214" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">Bottom-Left 10-Theme Switcher</text>
      <text x="35" y="232" font-family="'Inter', sans-serif" font-size="10" fill="${C.slateMed}">Fixed bottom-left FAB · pure light mode fidelity</text>

      <!-- Invariant 4 -->
      <rect x="20" y="262" width="300" height="60" rx="8" fill="#FFFFFF" stroke="${C.borderLight}" stroke-width="1" />
      <text x="35" y="286" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">4-Slide Hero Banner Carousel</text>
      <text x="35" y="304" font-family="'Inter', sans-serif" font-size="10" fill="${C.slateMed}">5000ms autoplay · hover pause · dot indicators</text>

      <!-- Invariant 5 -->
      <rect x="20" y="334" width="300" height="60" rx="8" fill="#FFFFFF" stroke="${C.borderLight}" stroke-width="1" />
      <text x="35" y="358" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">Fixed Left Sidebar (Desktop)</text>
      <text x="35" y="376" font-family="'Inter', sans-serif" font-size="10" fill="${C.slateMed}">Dashboard & Admin builds · seamlessly collapses</text>
    </g>
  `;

  const containerFrameworks = `
    <!-- Frameworks Panel -->
    <g transform="translate(440, 390)">
      <rect width="320" height="240" rx="14" fill="${C.containerBg}" stroke="${C.violet}" stroke-width="1.5" />
      <text x="160" y="28" text-anchor="middle" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">4 OFFICIAL SUPPORTED FRAMEWORKS</text>
      
      <rect x="20" y="44" width="280" height="38" rx="8" fill="#FFFFFF" stroke="${C.borderLight}" stroke-width="1" />
      <text x="35" y="68" font-family="'Inter', sans-serif" font-size="11" font-weight="700" fill="${C.slateDark}">Next.js 16</text>
      <text x="140" y="68" font-family="'JetBrains Mono', monospace" font-size="9" fill="${C.slateMed}">pnpm create next-app@latest</text>

      <rect x="20" y="90" width="280" height="38" rx="8" fill="#FFFFFF" stroke="${C.borderLight}" stroke-width="1" />
      <text x="35" y="114" font-family="'Inter', sans-serif" font-size="11" font-weight="700" fill="${C.slateDark}">Nuxt 3</text>
      <text x="140" y="114" font-family="'JetBrains Mono', monospace" font-size="9" fill="${C.slateMed}">pnpm dlx nuxi@latest init</text>

      <rect x="20" y="136" width="280" height="38" rx="8" fill="#FFFFFF" stroke="${C.borderLight}" stroke-width="1" />
      <text x="35" y="160" font-family="'Inter', sans-serif" font-size="11" font-weight="700" fill="${C.slateDark}">SvelteKit 2</text>
      <text x="140" y="160" font-family="'JetBrains Mono', monospace" font-size="9" fill="${C.slateMed}">pnpm dlx sv create</text>

      <rect x="20" y="182" width="280" height="38" rx="8" fill="#FFFFFF" stroke="${C.borderLight}" stroke-width="1" />
      <text x="35" y="206" font-family="'Inter', sans-serif" font-size="11" font-weight="700" fill="${C.slateDark}">Angular 19+</text>
      <text x="140" y="206" font-family="'JetBrains Mono', monospace" font-size="9" fill="${C.slateMed}">pnpm dlx @angular/cli@latest</text>
    </g>
  `;

  const cards = [
    renderCard(50, 100, 340, 68, C.azure, 'USER UI SPECIFICATION', 'build_from_source · build_from_text'),
    renderCard(440, 240, 320, 84, C.violet, '♦ JONIN BUILDER ENGINE', 'Tailwind CSS v4 · Framer Motion · Pure Light', ['Next.js', 'Nuxt', 'Svelte', 'Angular']),
    renderCard(820, 210, 330, 72, C.emerald, 'FRAMEWORK CLI GATES', 'pnpm build (0 errors) · pnpm lint (0 warnings)'),
    renderCard(820, 340, 330, 72, C.amber, 'TWO-STEP ZERO-AI-SLOP GATE', '100/100 mechanical scan · antislop verified'),
    renderCard(820, 470, 330, 72, C.emerald, 'PRODUCTION DELIVERABLE', 'High-fidelity accessible web application')
  ].join('\n');

  const paths = `
    <!-- Top to Invariants -->
    <path class="bg-track" d="M 220 168 L 220 210" stroke="${C.teal}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 220 168 L 220 210" stroke="${C.teal}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-teal)" />

    <!-- Invariants to Jonin Engine -->
    <path class="bg-track" d="M 390 282 L 440 282" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 390 282 L 440 282" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />

    <!-- Jonin Engine to Frameworks -->
    <path class="bg-track" d="M 600 324 L 600 390" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 600 324 L 600 390" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />

    <!-- Jonin to Framework Gates -->
    <path class="bg-track" d="M 760 282 C 790 282, 790 246, 820 246" stroke="${C.emerald}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 760 282 C 790 282, 790 246, 820 246" stroke="${C.emerald}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-emerald)" />

    <!-- Framework Gates to Slop Gate -->
    <path class="bg-track" d="M 985 282 L 985 340" stroke="${C.amber}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 985 282 L 985 340" stroke="${C.amber}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-amber)" />

    <!-- Slop Gate to Deliverable -->
    <path class="bg-track" d="M 985 412 L 985 470" stroke="${C.emerald}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 985 412 L 985 470" stroke="${C.emerald}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-emerald)" />
  `;

  return buildHtmlPage(W, H, `${header}\n${containerInvariants}\n${containerFrameworks}\n${paths}\n${cards}\n${footer}`);
}

/* ================================================================== *
 * Scene 3: Kage Pre-Delivery Review & Confidence Gate
 * ================================================================== */
function generateKageHtml() {
  const W = 1200;
  const H = 675;

  const header = renderHeader(W, 'KAGE PRE-DELIVERY REVIEW & CONFIDENCE GATE', `Two-Step Zero-AI-Slop Pre-Gate & 98% Minimum Confidence Verification · v${PKG_VERSION}`, '98% CONFIDENCE GATE', C.amber);
  const footer = renderFooter(W, H, 'Step 1: aislop_scan (100/100) · Step 2: antislop audit (0 findings) · Socket CI (0 High/Med) · Hard stop <98%');

  const leftPanel = `
    <!-- 5-Category Matrix Panel -->
    <g transform="translate(60, 110)">
      <rect width="530" height="480" rx="14" fill="${C.containerBg}" stroke="${C.borderLight}" stroke-width="1.5" />
      <text x="265" y="32" text-anchor="middle" font-family="'Inter', sans-serif" font-size="13" font-weight="700" fill="${C.slateDark}">5-CATEGORY VERIFICATION MATRIX</text>
      
      <!-- Metric 1 -->
      <g transform="translate(30, 56)">
        <text x="0" y="16" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">1. Task Verification (Weight: 20%)</text>
        <text x="470" y="16" text-anchor="end" font-family="'JetBrains Mono', monospace" font-size="12" font-weight="700" fill="${C.azure}">100.0%</text>
        <rect y="26" width="470" height="10" rx="5" fill="#E2E8F0" />
        <rect class="bar-fill" y="26" width="470" height="10" rx="5" fill="${C.azure}" />
      </g>

      <!-- Metric 2 -->
      <g transform="translate(30, 126)">
        <text x="0" y="16" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">2. Validation Evidence (Weight: 25%)</text>
        <text x="470" y="16" text-anchor="end" font-family="'JetBrains Mono', monospace" font-size="12" font-weight="700" fill="${C.teal}">100.0%</text>
        <rect y="26" width="470" height="10" rx="5" fill="#E2E8F0" />
        <rect class="bar-fill" y="26" width="470" height="10" rx="5" fill="${C.teal}" />
      </g>

      <!-- Metric 3 -->
      <g transform="translate(30, 196)">
        <text x="0" y="16" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">3. Security & Supply Chain (Weight: 20%)</text>
        <text x="470" y="16" text-anchor="end" font-family="'JetBrains Mono', monospace" font-size="12" font-weight="700" fill="${C.violet}">100.0%</text>
        <rect y="26" width="470" height="10" rx="5" fill="#E2E8F0" />
        <rect class="bar-fill" y="26" width="470" height="10" rx="5" fill="${C.violet}" />
      </g>

      <!-- Metric 4 -->
      <g transform="translate(30, 266)">
        <text x="0" y="16" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">4. Zero-AI-Slop Pre-Gate (Weight: 20%)</text>
        <text x="470" y="16" text-anchor="end" font-family="'JetBrains Mono', monospace" font-size="12" font-weight="700" fill="${C.amber}">100.0%</text>
        <rect y="26" width="470" height="10" rx="5" fill="#E2E8F0" />
        <rect class="bar-fill" y="26" width="470" height="10" rx="5" fill="${C.amber}" />
      </g>

      <!-- Metric 5 -->
      <g transform="translate(30, 336)">
        <text x="0" y="16" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">5. Invariant Compliance (Weight: 15%)</text>
        <text x="470" y="16" text-anchor="end" font-family="'JetBrains Mono', monospace" font-size="12" font-weight="700" fill="${C.emerald}">100.0%</text>
        <rect y="26" width="470" height="10" rx="5" fill="#E2E8F0" />
        <rect class="bar-fill" y="26" width="470" height="10" rx="5" fill="${C.emerald}" />
      </g>

      <!-- Summary Pill -->
      <rect x="30" y="415" width="470" height="38" rx="8" fill="#FFFFFF" stroke="${C.emerald}" stroke-width="1.5" />
      <text x="45" y="439" font-family="'Inter', sans-serif" font-size="11" font-weight="700" fill="${C.emerald}">AUDIT VERDICT:</text>
      <text x="145" y="439" font-family="'Inter', sans-serif" font-size="11" font-weight="600" fill="${C.slateDark}">Zero findings, clean exit codes, 100% tests verified</text>
    </g>
  `;

  const rightPanel = `
    <!-- Gauge & Verdict Panel -->
    <g transform="translate(630, 110)">
      <rect width="510" height="480" rx="14" fill="#FFFFFF" stroke="${C.borderLight}" stroke-width="1.5" filter="url(#cardShadow)" />
      
      <!-- Circular Gauge -->
      <g transform="translate(255, 175)">
        <!-- Gauge Background Arc -->
        <circle cx="0" cy="0" r="110" fill="none" stroke="#F1F5F9" stroke-width="18" stroke-dasharray="520" stroke-dashoffset="130" stroke-linecap="round" transform="rotate(135)" />
        <!-- Gauge Gradient Progress Arc -->
        <circle class="gauge-arc" cx="0" cy="0" r="110" fill="none" stroke="url(#gGauge)" stroke-width="18" stroke-dasharray="520" stroke-dashoffset="130" stroke-linecap="round" transform="rotate(135)" filter="url(#softGlow)" />
        
        <!-- Center Text -->
        <text x="0" y="8" text-anchor="middle" font-family="'Inter', sans-serif" font-size="44" font-weight="800" fill="${C.slateDark}">100.0%</text>
        <text x="0" y="32" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="11" font-weight="700" fill="${C.emerald}">CONFIDENCE SCORE</text>
        <text x="0" y="52" text-anchor="middle" font-family="'Inter', sans-serif" font-size="11" fill="${C.slateMed}">Target Threshold: ≥ 98.0%</text>
      </g>

      <!-- Status Card -->
      <g transform="translate(55, 330)">
        <rect width="400" height="42" rx="8" fill="#F0FDF4" stroke="${C.emerald}" stroke-width="1.5" />
        <circle cx="24" cy="21" r="5" fill="${C.emerald}" />
        <text x="38" y="26" font-family="'Inter', sans-serif" font-size="13" font-weight="700" fill="${C.emerald}">EVALUATION: PASS (100.0% CONFIDENCE)</text>
      </g>

      <!-- Verdict Stamp -->
      <g class="verdict-stamp" transform="translate(255, 420) rotate(-4)">
        <rect x="-170" y="-22" width="340" height="44" rx="8" fill="#F0FDF4" stroke="${C.emerald}" stroke-width="2.5" />
        <rect x="-165" y="-17" width="330" height="34" rx="6" fill="none" stroke="${C.emerald}" stroke-width="1" stroke-opacity="0.5" />
        <text x="0" y="6" text-anchor="middle" font-family="'Inter', sans-serif" font-size="14" font-weight="800" fill="${C.emerald}" letter-spacing="1">DELIVERY APPROVED · 100% CONFIDENCE</text>
      </g>
    </g>
  `;

  return buildHtmlPage(W, H, `${header}\n${leftPanel}\n${rightPanel}\n${footer}`);
}

/* ================================================================== *
 * Scene 4: Token-Efficient QA Automation Workflow
 * ================================================================== */
function generateQaHtml() {
  const W = 1200;
  const H = 760;

  const header = renderHeader(W, 'TOKEN-PRESERVING QA AUTOMATION WORKFLOW', `Deterministic Codification & Headless E2E Verification (♠ Anbu Owner) · v${PKG_VERSION}`, 'TOKEN PRESERVATION', C.azure);
  const footer = renderFooter(W, H, 'Zero LLM tokens during test runs · <2,000 chars capped evidence · autonomous fix loops');

  const cards = [
    renderCard(50, 130, 190, 68, C.azure, '1. EXPLORE', 'agent-browser scoped'),
    renderCard(280, 130, 190, 68, C.teal, '2. FLOW FILE', 'declarative command JSON'),
    renderCard(510, 130, 190, 68, C.violet, '3. CODIFY', 'qa_codify (0 LLM tokens)'),
    renderCard(740, 130, 200, 68, C.amber, '4. HEADLESS EXEC', 'qa_e2e_run (Playwright)'),
    renderCard(980, 130, 170, 68, C.crimson, '5. RED / GREEN', 'verify test outcome'),

    renderCard(890, 290, 260, 64, C.violet, 'AUTONOMOUS TRIAGE', 'src/sdlc_manager.js'),
    renderCard(540, 310, 280, 64, C.violet, 'BACKEND BUG FIX (♠ ANBU)', 're-run qa_e2e_run = GREEN'),
    renderCard(540, 410, 280, 64, C.azure, 'UI BUG FIX (♦ JONIN)', 'Tailwind CSS / responsive fix'),

    renderCard(140, 560, 380, 72, C.teal, '6. EVIDENCE PERSISTENCE', 'Save run_id to SQLite sdlc_tasks & report'),
    renderCard(660, 560, 380, 72, C.emerald, '7. KAGE VERIFICATION GATE', '100% clean evidence & delivery sign-off')
  ].join('\n');

  const paths = `
    <!-- Top Horizontal Sequence -->
    <path class="bg-track" d="M 240 164 L 280 164" stroke="${C.teal}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 240 164 L 280 164" stroke="${C.teal}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-teal)" />

    <path class="bg-track" d="M 470 164 L 510 164" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 470 164 L 510 164" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />

    <path class="bg-track" d="M 700 164 L 740 164" stroke="${C.amber}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 700 164 L 740 164" stroke="${C.amber}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-amber)" />

    <path class="bg-track" d="M 940 164 L 980 164" stroke="${C.crimson}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 940 164 L 980 164" stroke="${C.crimson}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-crimson)" />

    <!-- Failure Down to Triage -->
    <path class="bg-track" d="M 1065 198 L 1020 290" stroke="${C.crimson}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 1065 198 L 1020 290" stroke="${C.crimson}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-crimson)" />

    <!-- Triage to Anbu Fix -->
    <path class="bg-track" d="M 890 322 C 860 322, 850 342, 820 342" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 890 322 C 860 322, 850 342, 820 342" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />

    <!-- Triage to Jonin Fix -->
    <path class="bg-track" d="M 890 322 C 860 322, 850 442, 820 442" stroke="${C.azure}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 890 322 C 860 322, 850 442, 820 442" stroke="${C.azure}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-azure)" />

    <!-- Fixes Re-enter Headless Exec -->
    <path d="M 540 342 C 450 342, 450 250, 780 198" stroke="${C.teal}" stroke-width="2" stroke-dasharray="5 5" fill="none" marker-end="url(#arrow-teal)" opacity="0.8" />

    <!-- Success Down to Evidence -->
    <path class="bg-track" d="M 680 474 C 680 520, 330 520, 330 560" stroke="${C.teal}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 680 474 C 680 520, 330 520, 330 560" stroke="${C.teal}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-teal)" />

    <!-- Evidence to Kage Sign-off -->
    <path class="bg-track" d="M 520 596 L 660 596" stroke="${C.emerald}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 520 596 L 660 596" stroke="${C.emerald}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-emerald)" />
  `;

  return buildHtmlPage(W, H, `${header}\n${paths}\n${cards}\n${footer}`);
}

/* ================================================================== *
 * Scene 5: Telegram Remote Automation & Cloudflare Tunnel
 * ================================================================== */
function generateTelegramHtml() {
  const W = 1200;
  const H = 760;

  const header = renderHeader(W, 'TELEGRAM REMOTE AUTOMATION & CLOUDFLARE TUNNEL', `Zero-Port Ingress, Whitelisted Poller, and Real-Time Execution Notifier · v${PKG_VERSION}`, 'DUAL-MODE INGRESS', C.azure);
  const footer = renderFooter(W, H, 'Zero-emoji concise reporting · interactive shell execution · secure background task daemon');

  const topTrackContainer = `
    <!-- Track A: Outbound Reporter -->
    <g transform="translate(50, 120)">
      <rect width="1100" height="230" rx="14" fill="${C.containerBg}" stroke="${C.azure}" stroke-width="1.5" />
      <text x="24" y="28" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">OUTBOUND TASK STATUS REPORTER (src/telegram/notifier.js)</text>
    </g>
  `;

  const bottomTrackContainer = `
    <!-- Track B: Inbound Long Poller -->
    <g transform="translate(50, 420)">
      <rect width="1100" height="270" rx="14" fill="${C.containerBg}" stroke="${C.violet}" stroke-width="1.5" />
      <text x="24" y="28" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">INBOUND LONG POLLING DAEMON & CLOUDFLARE INGRESS (src/telegram/poller.js)</text>
    </g>
  `;

  const securityBanner = `
    <!-- Middle Security Guardrail Banner -->
    <g transform="translate(50, 362)">
      <rect width="1100" height="46" rx="8" fill="#FFFFFF" stroke="${C.emerald}" stroke-width="1.5" filter="url(#cardShadow)" />
      <circle cx="24" cy="23" r="5" fill="${C.emerald}" />
      <text x="38" y="28" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">SECURITY GUARDRAILS:</text>
      <text x="195" y="28" font-family="'Inter', sans-serif" font-size="11" fill="${C.slateMed}">Zero Open Inbound Ports · Chat ID Whitelist · isDangerousCommand Guard · Mode A SSO / Mode B PIN Auth (x-konoha-pin)</text>
    </g>
  `;

  const cards = [
    // Top Track Cards
    renderCard(80, 180, 220, 68, C.azure, 'SDLC TASK EVENT', 'task queued / running / done'),
    renderCard(350, 180, 230, 68, C.teal, 'ZERO-EMOJI NOTIFIER', 'src/telegram/notifier.js'),
    renderCard(630, 180, 230, 68, C.violet, 'HTTPS TELEGRAM API', 'POST /sendMessage'),
    renderCard(910, 180, 210, 68, C.emerald, 'AUTHORIZED USER', 'chat_id whitelist delivery'),

    // Bottom Track Cards
    renderCard(80, 480, 220, 72, C.azure, 'USER MOBILE COMMAND', '/run, /status, /sh, /kage...'),
    renderCard(350, 480, 230, 72, C.violet, 'WHITELISTED POLLER', 'long polling timeout=30'),
    renderCard(630, 480, 230, 72, C.amber, 'SUBAGENT DISPATCH', 'direct enqueue prompt_queue'),
    renderCard(910, 480, 210, 72, C.emerald, 'AUTONOMOUS WORKER', 'worker.js execution loop')
  ].join('\n');

  const paths = `
    <!-- Top Flow Path -->
    <path class="bg-track" d="M 300 214 L 350 214" stroke="${C.teal}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 300 214 L 350 214" stroke="${C.teal}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-teal)" />

    <path class="bg-track" d="M 580 214 L 630 214" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 580 214 L 630 214" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />

    <path class="bg-track" d="M 860 214 L 910 214" stroke="${C.emerald}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 860 214 L 910 214" stroke="${C.emerald}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-emerald)" />

    <!-- Bottom Flow Path -->
    <path class="bg-track" d="M 300 516 L 350 516" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 300 516 L 350 516" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />

    <path class="bg-track" d="M 580 516 L 630 516" stroke="${C.amber}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 580 516 L 630 516" stroke="${C.amber}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-amber)" />

    <path class="bg-track" d="M 860 516 L 910 516" stroke="${C.emerald}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 860 516 L 910 516" stroke="${C.emerald}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-emerald)" />
  `;

  return buildHtmlPage(W, H, `${header}\n${topTrackContainer}\n${bottomTrackContainer}\n${securityBanner}\n${paths}\n${cards}\n${footer}`);
}

/* ================================================================== *
 * Animation Engine: Playwright Headless + FFmpeg libwebp_anim
 * ================================================================== */
async function renderAndExportWebP(htmlContent, outputPath, width, height, totalFrames = 24, fps = 12) {
  console.log(`\nRendering ${path.basename(outputPath)} (${width}x${height}, ${totalFrames} frames @ ${fps} fps)...`);
  const tmpFramesDir = fs.mkdtempSync(path.join(os.tmpdir(), `tokubetsu_flow_${Date.now()}_`));

  const browser = await playwright.chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 2 // High-DPI 2x retina rendering for crisp text and graphics
  });

  await page.setContent(htmlContent, { waitUntil: 'networkidle' });

  // Add dynamic animated styles for frame capture
  await page.evaluate(() => {
    window.updateFrame = function(frameIdx, total) {
      const progress = frameIdx / total;
      
      // Animate marching dashes
      const paths = document.querySelectorAll('.flow-path');
      paths.forEach((p) => {
        p.style.strokeDashoffset = -progress * 48;
      });

      // Animate gauge arc if present
      const gauge = document.querySelector('.gauge-arc');
      if (gauge) {
        // Dasharray 520, sweep 390
        const sweep = 390;
        const currentOffset = 520 - (progress * sweep);
        gauge.style.strokeDashoffset = currentOffset;
      }

      // Animate metric bars if present
      const bars = document.querySelectorAll('.bar-fill');
      bars.forEach((b) => {
        const fullW = 470;
        b.setAttribute('width', Math.max(10, fullW * Math.min(1, progress * 1.15)));
      });

      // Animate verdict stamp opacity & scale
      const stamp = document.querySelector('.verdict-stamp');
      if (stamp) {
        const stampAlpha = progress > 0.4 ? Math.min(1, (progress - 0.4) * 2.5) : 0;
        stamp.style.opacity = stampAlpha;
      }
    };
  });

  try {
    for (let f = 0; f < totalFrames; f++) {
      await page.evaluate(({ f, totalFrames }) => {
        window.updateFrame(f, totalFrames);
      }, { f, totalFrames });

      const framePath = path.join(tmpFramesDir, `frame_${String(f).padStart(4, '0')}.png`);
      await page.screenshot({ path: framePath, type: 'png' });
    }
  } finally {
    await browser.close();
  }

  // Compile frames with FFmpeg using high-quality libwebp_anim (-q:v 90)
  console.log(`Compiling frames with FFmpeg libwebp_anim at High Quality (-q:v 90)...`);
  const ffmpegArgs = [
    '-y',
    '-framerate', String(fps),
    '-i', path.join(tmpFramesDir, 'frame_%04d.png'),
    '-vcodec', 'libwebp_anim',
    '-lossless', '0',
    '-compression_level', '6',
    '-q:v', '90', // High-fidelity visual quality
    '-preset', 'drawing',
    '-loop', '0',
    outputPath
  ];

  const res = spawnSync('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  if (res.status !== 0) {
    throw new Error(`FFmpeg failed: ${res.stderr ? res.stderr.toString() : 'unknown'}`);
  }

  // Clean up temporary frame PNGs
  try {
    fs.rmSync(tmpFramesDir, { recursive: true, force: true });
  } catch (_err) {
    /* ignore cleanup failure */
  }

  // Validate resulting WebP binary
  const validation = validateAnimatedWebP(outputPath);
  if (!validation.valid) {
    throw new Error(`Validation failed for ${outputPath}: ${validation.error}`);
  }

  const stat = fs.statSync(outputPath);
  console.log(`✓ Generated ${path.basename(outputPath)} (${validation.canvasWidth}x${validation.canvasHeight}, ${validation.frameCount} frames, ${(stat.size / 1024).toFixed(1)} KB)`);
  return { success: true, path: outputPath, sizeKb: (stat.size / 1024).toFixed(1) };
}

/* ================================================================== *
 * Main Execution
 * ================================================================== */
async function main() {
  console.log('================================================================');
  console.log('TOKUBETSU-JONIN ANIMATED WEBP GENERATOR (PURE LIGHT MODE STANDARD)');
  console.log('================================================================');

  const targets = [
    {
      name: 'konoha-orchestration-flow.webp',
      html: generateOrchestrationHtml(),
      w: 1200, h: 675, frames: 24, fps: 12
    },
    {
      name: 'konoha-jonin-flow.webp',
      html: generateJoninHtml(),
      w: 1200, h: 760, frames: 24, fps: 12
    },
    {
      name: 'konoha-kage-gate.webp',
      html: generateKageHtml(),
      w: 1200, h: 675, frames: 24, fps: 12
    },
    {
      name: 'konoha-qa-flow.webp',
      html: generateQaHtml(),
      w: 1200, h: 760, frames: 24, fps: 12
    },
    {
      name: 'konoha-telegram-flow.webp',
      html: generateTelegramHtml(),
      w: 1200, h: 760, frames: 24, fps: 12
    }
  ];

  for (const t of targets) {
    const outPath = path.join(ASSETS_DIR, t.name);
    await renderAndExportWebP(t.html, outPath, t.w, t.h, t.frames, t.fps);
  }

  console.log('\n================================================================');
  console.log('✓ All 5 Tokubetsu-Jonin Animated Flow Diagrams Generated Cleanly!');
  console.log('================================================================\n');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = {
  renderAndExportWebP,
  generateOrchestrationHtml,
  generateJoninHtml,
  generateKageHtml,
  generateQaHtml,
  generateTelegramHtml
};
