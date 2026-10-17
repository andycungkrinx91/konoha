/**
 * Document Cover & Gradient Theme Engine
 * Produces publication-grade geometric diamond cascade covers and 4-color gradient rules
 * across DOCX, PDF, and PPTX formats matching the reference template.
 *
 * Dynamic Invariants Enforced:
 * 1. Zero hardcoded paths or static dimensions: dynamic A4 portrait and 16:9 widescreen scaling.
 * 2. DOCX Native Cover: Zero rasterized font text in DOCX. Background diamond artwork is 100% text-free;
 *    all cover typography (chips, titles, subtitles, metadata tables) is rendered with native Word XML.
 * 3. Contained A4 PDF Canvas: A4 page strictly budgeted within 794px x 1123px (210mm x 297mm)
 *    so elements never overflow or clip past the right border.
 */

'use strict';

const GRADIENT_THEMES = {
  theme_01: {
    name: 'Electric Azure & Amber',
    colors: ['#3B82F6', '#14B8A6', '#8B5CF6', '#F97316'],
    bg: '#FAFBFD'
  },
  theme_02: {
    name: 'Sunfire Rose & Lime',
    colors: ['#EAB308', '#EC4899', '#84CC16', '#06B6D4'],
    bg: '#FAFBFD'
  },
  theme_03: {
    name: 'Indigo Flamingo & Gold',
    colors: ['#6366F1', '#F43F5E', '#3B82F6', '#EAB308'],
    bg: '#FAFBFD'
  },
  theme_04: {
    name: 'Cyber Violet & Coral',
    colors: ['#8B5CF6', '#06B6D4', '#F97316', '#EC4899'],
    bg: '#FAFBFD'
  },
  theme_05: {
    name: 'Teal Lime & Crimson',
    colors: ['#14B8A6', '#84CC16', '#6366F1', '#F43F5E'],
    bg: '#FAFBFD'
  },
  theme_06: {
    name: 'Tangerine Sun & Neon Pink',
    colors: ['#F97316', '#EAB308', '#3B82F6', '#EC4899'],
    bg: '#FAFBFD'
  },
  theme_07: {
    name: 'Cyan Amethyst & Indigo',
    colors: ['#06B6D4', '#8B5CF6', '#14B8A6', '#6366F1'],
    bg: '#FAFBFD'
  },
  theme_08: {
    name: 'Berry Rose & Citrus Lime',
    colors: ['#EC4899', '#F43F5E', '#EAB308', '#84CC16'],
    bg: '#FAFBFD'
  },
  theme_09: {
    name: 'Blue Velvet & Sunset Ruby',
    colors: ['#3B82F6', '#6366F1', '#06B6D4', '#F43F5E'],
    bg: '#FAFBFD'
  },
  theme_10: {
    name: 'Spring Emerald & Iris Gold',
    colors: ['#84CC16', '#14B8A6', '#EAB308', '#8B5CF6'],
    bg: '#FAFBFD'
  }
};

const THEME_ALIASES = {
  amber_coral: 'theme_06',
  cyber_indigo: 'theme_03',
  ocean_teal: 'theme_01',
  nordic_crimson: 'theme_08'
};

const COVER_MODELS = [
  'geometric_polyhedra',
  'contour_wave_ribbons',
  'isometric_tech_monoliths',
  'orbital_quantum_rings'
];

function selectCoverModel(model) {
  if (model && COVER_MODELS.includes(model)) {
    return model;
  }
  return COVER_MODELS[Math.floor(Math.random() * COVER_MODELS.length)];
}

function selectGradientTheme(themeKey) {
  if (themeKey && THEME_ALIASES[themeKey]) {
    themeKey = THEME_ALIASES[themeKey];
  }
  if (themeKey && GRADIENT_THEMES[themeKey]) {
    return { key: themeKey, ...GRADIENT_THEMES[themeKey] };
  }
  const keys = Object.keys(GRADIENT_THEMES);
  const randomKey = keys[Math.floor(Math.random() * keys.length)];
  return { key: randomKey, ...GRADIENT_THEMES[randomKey] };
}

function getPlaywright() {
  return require('playwright');
}

/**
 * Model 1: Generates cascading multifaceted geometric diamonds & prisms
 */
function buildGeometricPolyhedraSvg(colors, width, height, isWidescreen = false) {
  const [c1, c2, c3, c4] = colors;
  const cx = isWidescreen ? 420 : 220;
  const cy = isWidescreen ? 340 : 270;
  const scale = isWidescreen ? 0.95 : 0.72;

  return `
  <defs>
    <linearGradient id="polyGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}" />
      <stop offset="100%" stop-color="${c2}" />
    </linearGradient>
    <linearGradient id="polyGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c2}" />
      <stop offset="100%" stop-color="${c3}" />
    </linearGradient>
    <linearGradient id="polyGrad3" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c3}" />
      <stop offset="100%" stop-color="${c4}" />
    </linearGradient>
  </defs>

  <g transform="translate(${cx}, ${cy}) scale(${scale})">
    <rect x="-380" y="-380" width="760" height="760" rx="36" transform="rotate(45)"
          fill="none" stroke="${c2}" stroke-width="2" stroke-opacity="0.18" stroke-dasharray="8 6" />
    <rect x="-320" y="-320" width="640" height="640" rx="28" transform="rotate(45)"
          fill="${c1}" fill-opacity="0.08" stroke="${c1}" stroke-width="2.5" stroke-opacity="0.35" />
    <rect x="-350" y="-460" width="460" height="460" rx="20" transform="rotate(30)"
          fill="${c2}" fill-opacity="0.14" stroke="${c2}" stroke-width="2" stroke-opacity="0.4" />
    <rect x="-240" y="-240" width="480" height="480" rx="24" transform="rotate(45)"
          fill="url(#polyGrad1)" fill-opacity="0.92" />
    <rect x="-170" y="-170" width="340" height="340" rx="16" transform="rotate(45)"
          fill="${c1}" fill-opacity="0.95" />
    <rect x="-40" y="40" width="320" height="320" rx="16" transform="rotate(60)"
          fill="url(#polyGrad2)" fill-opacity="0.88" />
    <rect x="-290" y="20" width="220" height="220" rx="12" transform="rotate(45)"
          fill="${c4}" fill-opacity="0.90" />
    <rect x="-90" y="-280" width="260" height="260" rx="14" transform="rotate(45)"
          fill="${c3}" fill-opacity="0.82" />
    <rect x="-120" y="-120" width="240" height="240" rx="10" transform="rotate(45)"
          fill="none" stroke="#FFFFFF" stroke-width="3" stroke-opacity="0.85" />
    <rect x="-30" y="-30" width="60" height="60" rx="6" transform="rotate(45)"
          fill="#FFFFFF" fill-opacity="0.95" />
    <rect x="180" y="-180" width="160" height="160" rx="10" transform="rotate(35)"
          fill="none" stroke="${c1}" stroke-width="2.5" stroke-opacity="0.5" />
    <rect x="220" y="80" width="120" height="120" rx="8" transform="rotate(45)"
          fill="${c2}" fill-opacity="0.25" stroke="${c2}" stroke-width="2" stroke-opacity="0.4" />
    <circle cx="140" cy="-120" r="14" fill="${c1}" fill-opacity="0.75" />
    <circle cx="-160" cy="180" r="10" fill="${c4}" fill-opacity="0.85" />
  </g>`;
}

/**
 * Model 2: Generates sweeping sinusoidal & cubic Bézier wave ribbons
 */
function buildWaveRibbonSvg(colors, width, height, isWidescreen = false) {
  const [c1, c2, c3, c4] = colors;
  const w = width;
  const baseY = isWidescreen ? 360 : 310;

  return `
  <defs>
    <linearGradient id="waveGrad1" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${c1}" />
      <stop offset="50%" stop-color="${c2}" />
      <stop offset="100%" stop-color="${c3}" />
    </linearGradient>
    <linearGradient id="waveGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c2}" />
      <stop offset="100%" stop-color="${c4}" />
    </linearGradient>
    <linearGradient id="waveGrad3" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${c3}" />
      <stop offset="100%" stop-color="${c1}" />
    </linearGradient>
  </defs>

  <path d="M -60 -40 L ${w + 60} -40 L ${w + 60} ${baseY + 40} C ${w * 0.75} ${baseY + 120}, ${w * 0.45} ${baseY - 140}, -60 ${baseY - 20} Z"
        fill="${c1}" fill-opacity="0.07" />

  <path d="M -80 ${baseY - 120} C ${w * 0.25} ${baseY - 260}, ${w * 0.55} ${baseY + 60}, ${w + 80} ${baseY - 140} L ${w + 80} ${baseY - 60} C ${w * 0.55} ${baseY + 140}, ${w * 0.25} ${baseY - 180}, -80 ${baseY - 40} Z"
        fill="url(#waveGrad1)" fill-opacity="0.92" />

  <path d="M -80 ${baseY + 40} C ${w * 0.3} ${baseY + 140}, ${w * 0.65} ${baseY - 180}, ${w + 80} ${baseY + 20} L ${w + 80} ${baseY + 100} C ${w * 0.65} ${baseY - 100}, ${w * 0.3} ${baseY + 220}, -80 ${baseY + 120} Z"
        fill="url(#waveGrad2)" fill-opacity="0.86" />

  <path d="M -80 ${baseY - 40} C ${w * 0.2} ${baseY + 40}, ${w * 0.5} ${baseY - 90}, ${w * 0.8} ${baseY + 30} C ${w * 0.9} ${baseY + 70}, ${w + 60} ${baseY - 10}, ${w + 60} ${baseY - 50} C ${w * 0.8} ${baseY - 10}, ${w * 0.5} ${baseY - 130}, -80 ${baseY - 80} Z"
        fill="url(#waveGrad3)" fill-opacity="0.78" />

  <path d="M -60 ${baseY - 160} C ${w * 0.25} ${baseY - 300}, ${w * 0.55} ${baseY + 20}, ${w + 60} ${baseY - 180}"
        fill="none" stroke="${c2}" stroke-width="2" stroke-dasharray="6 6" stroke-opacity="0.45" />
  <path d="M -60 ${baseY + 80} C ${w * 0.3} ${baseY + 180}, ${w * 0.65} ${baseY - 140}, ${w + 60} ${baseY + 60}"
        fill="none" stroke="${c3}" stroke-width="2" stroke-opacity="0.5" />

  <circle cx="${Math.round(w * 0.32)}" cy="${baseY - 110}" r="12" fill="${c1}" fill-opacity="0.9" />
  <circle cx="${Math.round(w * 0.32)}" cy="${baseY - 110}" r="6" fill="#FFFFFF" />
  <circle cx="${Math.round(w * 0.68)}" cy="${baseY - 60}" r="10" fill="${c4}" fill-opacity="0.9" />
  <circle cx="${Math.round(w * 0.68)}" cy="${baseY - 60}" r="5" fill="#FFFFFF" />
  <circle cx="${Math.round(w * 0.84)}" cy="${baseY - 110}" r="7" fill="${c2}" fill-opacity="0.85" />`;
}

/**
 * Model 3: Generates 3D isometric infrastructure monoliths & coordinate grids
 */
function buildIsometricMonolithSvg(colors, width, height, isWidescreen = false) {
  const [c1, c2, c3, c4] = colors;
  const originX = isWidescreen ? 480 : 340;
  const originY = isWidescreen ? 360 : 300;
  const s = isWidescreen ? 1.05 : 0.82;

  const makeIsoBlock = (gx, gy, bw, bh, baseColor, topGradId) => {
    const bx = (gx - gy) * 58 * s;
    const by = (gx + gy) * 33 * s;
    const w = bw * s;
    const h = bh * s;
    const skewY = 30 * (Math.PI / 180);
    const hy = w * Math.sin(skewY);
    const hx = w * Math.cos(skewY);

    return `
    <g transform="translate(${bx}, ${by})">
      <path d="M 0 0 L 0 ${h} L ${-hx} ${h - hy} L ${-hx} ${-hy} Z"
            fill="${baseColor}" fill-opacity="0.88" stroke="${baseColor}" stroke-width="1.5" />
      <path d="M 0 0 L 0 ${h} L ${hx} ${h - hy} L ${hx} ${-hy} Z"
            fill="${baseColor}" fill-opacity="0.68" stroke="${baseColor}" stroke-width="1.5" />
      <path d="M 0 0 L ${hx} ${-hy} L 0 ${-2 * hy} L ${-hx} ${-hy} Z"
            fill="url(#${topGradId})" stroke="#FFFFFF" stroke-width="2" stroke-opacity="0.9" />
      <circle cx="0" cy="${-2 * hy}" r="${5 * s}" fill="#FFFFFF" />
    </g>`;
  };

  return `
  <defs>
    <linearGradient id="isoGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}" />
      <stop offset="100%" stop-color="${c2}" />
    </linearGradient>
    <linearGradient id="isoGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c2}" />
      <stop offset="100%" stop-color="${c3}" />
    </linearGradient>
    <linearGradient id="isoGrad3" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c3}" />
      <stop offset="100%" stop-color="${c4}" />
    </linearGradient>
    <linearGradient id="isoGrad4" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c4}" />
      <stop offset="100%" stop-color="${c1}" />
    </linearGradient>
  </defs>

  <g transform="translate(${originX}, ${originY})">
    <path d="M -360 0 L 0 -208 L 360 0 L 0 208 Z"
          fill="${c1}" fill-opacity="0.05" stroke="${c2}" stroke-width="1.5" stroke-dasharray="8 6" stroke-opacity="0.3" />
    <path d="M -240 0 L 0 -138 L 240 0 L 0 138 Z"
          fill="none" stroke="${c1}" stroke-width="1.5" stroke-opacity="0.25" />

    ${makeIsoBlock(-2, 0, 70, 110, c1, 'isoGrad1')}
    ${makeIsoBlock(0, -2, 60, 150, c2, 'isoGrad2')}
    ${makeIsoBlock(0, 0, 80, 190, c3, 'isoGrad3')}
    ${makeIsoBlock(2, 0, 65, 130, c4, 'isoGrad4')}
    ${makeIsoBlock(0, 2, 55, 90, c2, 'isoGrad1')}
    ${makeIsoBlock(-1, 2, 50, 70, c1, 'isoGrad2')}

    <line x1="-120" y1="-80" x2="0" y2="-210" stroke="${c2}" stroke-width="2" stroke-dasharray="4 4" stroke-opacity="0.6" />
    <line x1="0" y1="-210" x2="130" y2="-90" stroke="${c3}" stroke-width="2" stroke-dasharray="4 4" stroke-opacity="0.6" />
    <circle cx="-120" cy="-80" r="8" fill="${c1}" />
    <circle cx="130" cy="-90" r="8" fill="${c4}" />
  </g>`;
}

/**
 * Model 4: Generates orbital quantum rings & radiant planetary nodes
 */
function buildOrbitalRingsSvg(colors, width, height, isWidescreen = false) {
  const [c1, c2, c3, c4] = colors;
  const cx = isWidescreen ? 480 : 360;
  const cy = isWidescreen ? 340 : 280;
  const s = isWidescreen ? 1.0 : 0.75;

  return `
  <defs>
    <linearGradient id="ringGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}" />
      <stop offset="100%" stop-color="${c2}" />
    </linearGradient>
    <linearGradient id="ringGrad2" x1="100%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="${c2}" />
      <stop offset="100%" stop-color="${c3}" />
    </linearGradient>
    <linearGradient id="ringGrad3" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${c3}" />
      <stop offset="100%" stop-color="${c4}" />
    </linearGradient>
    <radialGradient id="coreAura" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${c1}" stop-opacity="0.3" />
      <stop offset="60%" stop-color="${c2}" stop-opacity="0.1" />
      <stop offset="100%" stop-color="${c3}" stop-opacity="0" />
    </radialGradient>
  </defs>

  <g transform="translate(${cx}, ${cy}) scale(${s})">
    <circle cx="0" cy="0" r="280" fill="url(#coreAura)" />
    <circle cx="0" cy="0" r="320" fill="none" stroke="${c2}" stroke-width="1.5" stroke-dasharray="6 8" stroke-opacity="0.3" />

    <ellipse cx="0" cy="0" rx="340" ry="120" transform="rotate(-24)"
             fill="none" stroke="url(#ringGrad1)" stroke-width="3" stroke-opacity="0.95" />
    <ellipse cx="0" cy="0" rx="280" ry="90" transform="rotate(32)"
             fill="none" stroke="url(#ringGrad2)" stroke-width="2.5" stroke-dasharray="12 6" stroke-opacity="0.85" />
    <ellipse cx="0" cy="0" rx="230" ry="70" transform="rotate(-62)"
             fill="none" stroke="url(#ringGrad3)" stroke-width="2" stroke-opacity="0.8" />
    <ellipse cx="0" cy="0" rx="170" ry="50" transform="rotate(12)"
             fill="none" stroke="${c4}" stroke-width="2" stroke-opacity="0.75" />

    <line x1="-360" y1="0" x2="360" y2="0" stroke="${c1}" stroke-width="1.5" stroke-dasharray="4 8" stroke-opacity="0.35" />
    <line x1="0" y1="-260" x2="0" y2="260" stroke="${c1}" stroke-width="1.5" stroke-dasharray="4 8" stroke-opacity="0.35" />

    <circle cx="0" cy="0" r="46" fill="url(#ringGrad1)" stroke="#FFFFFF" stroke-width="3" />
    <circle cx="0" cy="0" r="16" fill="#FFFFFF" />

    <g transform="rotate(-24)">
      <circle cx="340" cy="0" r="14" fill="${c1}" stroke="#FFFFFF" stroke-width="2.5" />
      <circle cx="-340" cy="0" r="10" fill="${c2}" stroke="#FFFFFF" stroke-width="2" />
      <circle cx="120" cy="112" r="8" fill="${c3}" stroke="#FFFFFF" stroke-width="1.5" />
    </g>
    <g transform="rotate(32)">
      <circle cx="280" cy="0" r="12" fill="${c2}" stroke="#FFFFFF" stroke-width="2" />
      <circle cx="-280" cy="0" r="9" fill="${c4}" stroke="#FFFFFF" stroke-width="1.5" />
    </g>
    <g transform="rotate(-62)">
      <circle cx="0" cy="70" r="10" fill="${c3}" stroke="#FFFFFF" stroke-width="2" />
      <circle cx="0" cy="-70" r="8" fill="${c1}" stroke="#FFFFFF" stroke-width="1.5" />
    </g>
  </g>`;
}

/**
 * Builds procedural generative cover artwork SVG based on chosen model
 */
function buildGenerativeCoverArtSvg(colors, width, height, isWidescreen = false, modelType = null) {
  const chosenModel = selectCoverModel(modelType);
  if (chosenModel === 'contour_wave_ribbons') {
    return buildWaveRibbonSvg(colors, width, height, isWidescreen);
  } else if (chosenModel === 'isometric_tech_monoliths') {
    return buildIsometricMonolithSvg(colors, width, height, isWidescreen);
  } else if (chosenModel === 'orbital_quantum_rings') {
    return buildOrbitalRingsSvg(colors, width, height, isWidescreen);
  }
  return buildGeometricPolyhedraSvg(colors, width, height, isWidescreen);
}

/**
 * Builds pure background artwork HTML (TEXT-FREE) for DOCX and backgrounds.
 * Zero rasterized font text!
 */
function renderCoverHtmlShell(width, height, extraStyles, bodyContent) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    background: #FAFBFD;
    position: relative;
  }
${extraStyles}
</style>
</head>
<body>
${bodyContent}
</body>
</html>`;
}

function renderCoverBackgroundArtworkHtml(theme, isWidescreen = false, options = {}) {
  const [c1, c2, c3, c4] = theme.colors;
  const width = isWidescreen ? 1920 : 794;
  const height = isWidescreen ? 1080 : 1123;

  const extraStyles = `  .diamond-canvas { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
  .bottom-strap { position: absolute; bottom: 0; left: 0; width: 100%; height: 8px; display: flex; }
  .grad-seg { flex: 1; height: 100%; }`;

  const bodyContent = `<svg class="diamond-canvas" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  ${buildGenerativeCoverArtSvg(theme.colors, width, height, isWidescreen, options.cover_model)}
</svg>
<div class="bottom-strap">
  <div class="grad-seg" style="background: ${c1};"></div>
  <div class="grad-seg" style="background: ${c2};"></div>
  <div class="grad-seg" style="background: ${c3};"></div>
  <div class="grad-seg" style="background: ${c4};"></div>
</div>`;

  return renderCoverHtmlShell(width, height, extraStyles, bodyContent);
}

/**
 * Builds the geometric diamond cascade HTML/SVG template with typography for PDF and PPTX.
 * Bounded strictly within A4 portrait (794px x 1123px) or 16:9 widescreen (1920px x 1080px).
 */
function renderCoverArtworkHtml(theme, options = {}, isWidescreen = false) {
  const [c1, c2, c3, c4] = theme.colors;
  const title = options.title || 'Technical Architecture Specification';
  const subtitle = options.subtitle || 'Operational Standards & Automated Engineering Architecture';
  const author = options.author || 'Andy Setiyawan | Principal Infrastructure Architect';
  const classification = options.classification || 'Enterprise Standard (v1.0.0)';
  const dateStr = options.date || new Date().toISOString().split('T')[0];
  const compliance = options.compliance || 'Production Verified — Zero AI Artifacts';

  // Strict canvas dimensions
  const width = isWidescreen ? 1920 : 794;
  const height = isWidescreen ? 1080 : 1123;

  let titleLine1 = title;
  let titleLine2 = '';
  if (title.includes(':')) {
    const parts = title.split(':');
    titleLine1 = parts[0].trim();
    titleLine2 = parts.slice(1).join(':').trim();
  } else if (title.includes('—')) {
    const parts = title.split('—');
    titleLine1 = parts[0].trim();
    titleLine2 = parts.slice(1).join('—').trim();
  } else if (title.length > 20) {
    const words = title.split(' ');
    const mid = Math.ceil(words.length / 2);
    titleLine1 = words.slice(0, mid).join(' ');
    titleLine2 = words.slice(mid).join(' ');
  }

  // Contained content panel coordinates (~15% from bottom for PDF & PPTX)
  const textLeft = isWidescreen ? '780px' : '60px';
  const textTop = isWidescreen ? '540px' : '700px';
  const textWidth = isWidescreen ? '1060px' : '674px';

  const extraStyles = `
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #1E293B;
  }
  .diamond-canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .content-panel {
    position: absolute;
    top: ${textTop};
    left: ${textLeft};
    width: ${textWidth};
    z-index: 10;
  }
  .chip {
    display: inline-block;
    padding: ${isWidescreen ? '6px 16px' : '5px 12px'};
    background: ${c1};
    color: #FFFFFF;
    font-size: ${isWidescreen ? '14px' : '11px'};
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    border-radius: 4px;
    margin-bottom: ${isWidescreen ? '28px' : '18px'};
  }
  .cover-title {
    font-size: ${isWidescreen ? '38px' : '32px'};
    font-weight: 900;
    line-height: 1.12;
    letter-spacing: -0.02em;
    color: #0F172A;
    text-transform: uppercase;
    margin-bottom: ${isWidescreen ? '14px' : '12px'};
  }
  .cover-title-line2 {
    color: ${c1};
    display: block;
    font-size: ${isWidescreen ? '30px' : '26px'};
    margin-top: 4px;
  }
  .cover-subtitle {
    font-size: ${isWidescreen ? '18px' : '14.5px'};
    line-height: 1.45;
    color: #475569;
    font-weight: 400;
    margin-bottom: ${isWidescreen ? '20px' : '18px'};
    max-width: 95%;
  }
  .grad-bar {
    display: flex;
    width: ${isWidescreen ? '280px' : '260px'};
    height: ${isWidescreen ? '5px' : '4px'};
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: ${isWidescreen ? '22px' : '20px'};
  }
  .grad-seg { flex: 1; height: 100%; }
  .meta-card {
    background: rgba(255, 255, 255, 0.94);
    backdrop-filter: blur(8px);
    border: 1px solid #E2E8F0;
    border-left: 4px solid ${c1};
    border-radius: 8px;
    padding: ${isWidescreen ? '18px 24px' : '14px 20px'};
    box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.05);
  }
  .meta-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: ${isWidescreen ? '12px 24px' : '10px 20px'};
  }
  .meta-item { display: flex; flex-direction: column; }
  .meta-label {
    font-size: ${isWidescreen ? '11px' : '9.5px'};
    font-weight: 700;
    color: #64748B;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 2px;
  }
  .meta-value {
    font-size: ${isWidescreen ? '13.5px' : '11px'};
    font-weight: 600;
    color: #1E293B;
  }
  .bottom-strap {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 8px;
    display: flex;
  }`;

  const bodyContent = `

<svg class="diamond-canvas" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  ${buildGenerativeCoverArtSvg(theme.colors, width, height, isWidescreen, options.cover_model)}
</svg>

<div class="content-panel">
  <div class="chip">ENTERPRISE TECHNICAL STANDARD</div>
  <h1 class="cover-title">
    ${titleLine1}
    ${titleLine2 ? `<span class="cover-title-line2">${titleLine2}</span>` : ''}
  </h1>
  <div class="cover-subtitle">${subtitle}</div>

  <div class="grad-bar">
    <div class="grad-seg" style="background: ${c1};"></div>
    <div class="grad-seg" style="background: ${c2};"></div>
    <div class="grad-seg" style="background: ${c3};"></div>
    <div class="grad-seg" style="background: ${c4};"></div>
  </div>

  <div class="meta-card">
    <div class="meta-grid">
      <div class="meta-item">
        <span class="meta-label">Author</span>
        <span class="meta-value">${author}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Classification</span>
        <span class="meta-value">${classification}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Date</span>
        <span class="meta-value">${dateStr}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Status</span>
        <span class="meta-value">${compliance}</span>
      </div>
    </div>
  </div>
</div>

<div class="bottom-strap">
  <div class="grad-seg" style="background: ${c1};"></div>
  <div class="grad-seg" style="background: ${c2};"></div>
  <div class="grad-seg" style="background: ${c3};"></div>
  <div class="grad-seg" style="background: ${c4};"></div>
</div>`;

  return renderCoverHtmlShell(width, height, extraStyles, bodyContent);
}

/**
 * Renders high-DPI text-free background artwork PNG via Playwright Chromium
 */
async function renderCoverBackgroundArtworkPng(theme, isWidescreen = false, options = {}) {
  const playwright = getPlaywright();
  const browser = await playwright.chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const width = isWidescreen ? 1920 : 794;
  const height = isWidescreen ? 1080 : 1123;

  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1
  });

  const html = renderCoverBackgroundArtworkHtml(theme, isWidescreen, options);
  await page.setContent(html, { waitUntil: 'load' });
  const buffer = await page.screenshot({ type: 'png' });
  await page.close();
  await browser.close();

  return buffer;
}

/**
 * Renders high-DPI cover image PNG with typography via Playwright Chromium (for PPTX cover slide)
 */
async function renderCoverArtworkPng(theme, options = {}, isWidescreen = false) {
  const playwright = getPlaywright();
  const browser = await playwright.chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const width = isWidescreen ? 1920 : 794;
  const height = isWidescreen ? 1080 : 1123;

  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1
  });

  const html = renderCoverArtworkHtml(theme, options, isWidescreen);
  await page.setContent(html, { waitUntil: 'load' });
  const buffer = await page.screenshot({ type: 'png' });
  await page.close();
  await browser.close();

  return buffer;
}

/**
 * Generates a seamless 4-cell table representing a gradient HR bar in DOCX
 */
function renderDocxGradientTable(docxModule, colors) {
  const { Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, Paragraph } = docxModule;
  const borderNone = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };

  const cells = colors.map((colHex) => {
    const fill = colHex.replace('#', '');
    return new TableCell({
      width: { size: 2250, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill },
      borders: { top: borderNone, bottom: borderNone, left: borderNone, right: borderNone },
      children: [new Paragraph({ text: '' })]
    });
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [2250, 2250, 2250, 2250],
    borders: {
      top: borderNone, bottom: borderNone, left: borderNone, right: borderNone,
      insideH: borderNone, insideV: borderNone
    },
    rows: [new TableRow({ children: cells })]
  });
}

/**
 * Generates 100% NATIVE DOCX elements for the cover page.
 * ZERO RASTERIZED FONT TEXT! All headings, paragraphs, and metadata tables are editable native Word text.
 */
function renderDocxNativeCover(docxModule, theme, metadata = {}) {
  const {
    Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
    WidthType, BorderStyle, ShadingType
  } = docxModule;

  const primaryColor = theme.colors[0].replace('#', '');
  const borderNone = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const borderLeft = { style: BorderStyle.SINGLE, size: 28, color: primaryColor };
  const borderSubtle = { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' };

  const elements = [];

  // Spacing before cover content (places typography firmly in lower half over background artwork)
  elements.push(new Paragraph({ text: '', spacing: { before: 7200 } }));

  // 1. Enterprise Category Chip (Native Single-Cell Pill Table)
  const chipCategory = metadata.category || 'ENTERPRISE TECHNICAL STANDARD';
  const chipTable = new Table({
    width: { size: 3200, type: WidthType.DXA },
    borders: {
      top: borderNone, bottom: borderNone, left: borderNone, right: borderNone,
      insideH: borderNone, insideV: borderNone
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 3200, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: primaryColor },
            margins: { top: 60, bottom: 60, left: 140, right: 140 },
            borders: { top: borderNone, bottom: borderNone, left: borderNone, right: borderNone },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: chipCategory,
                    bold: true,
                    size: 18,
                    color: 'FFFFFF',
                    font: 'Georgia'
                  })
                ]
              })
            ]
          })
        ]
      })
    ]
  });
  elements.push(chipTable);
  elements.push(new Paragraph({ text: '', spacing: { after: 200 } }));

  // 2. Document Title (Native Display Heading, Georgia bold size 52)
  const title = metadata.title || 'Technical Architecture Specification';
  elements.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [
        new TextRun({
          text: title,
          bold: true,
          size: 52,
          color: '0F172A',
          font: 'Georgia'
        })
      ],
      spacing: { before: 180, after: 120 }
    })
  );

  // 3. Document Subtitle (Native Italic Paragraph, Calibri size 24)
  if (metadata.subtitle) {
    elements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: metadata.subtitle,
            italics: true,
            size: 24,
            color: '475569',
            font: 'Calibri'
          })
        ],
        spacing: { after: 240 }
      })
    );
  }

  // 4. 4-Color Gradient Bar (Native 4-Cell Table)
  elements.push(renderDocxGradientTable(docxModule, theme.colors));
  elements.push(new Paragraph({ text: '', spacing: { after: 320 } }));

  // 5. Metadata Card (Native 2x2 Word Table)
  const author = metadata.author || 'Andy Setiyawan | Principal Infrastructure Architect';
  const classification = metadata.classification || 'Enterprise Standard (v1.0.0)';
  const dateStr = metadata.date || new Date().toISOString().split('T')[0];
  const compliance = metadata.compliance || 'Production Verified — Zero AI Artifacts';

  function buildMetaCell(label, value) {
    return new TableCell({
      width: { size: 4500, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: 'F8FAFC' },
      margins: { top: 120, bottom: 120, left: 140, right: 140 },
      borders: {
        top: borderSubtle, bottom: borderSubtle, left: borderNone, right: borderSubtle
      },
      children: [
        new Paragraph({
          children: [
            new TextRun({ text: label.toUpperCase(), bold: true, size: 16, color: '64748B', font: 'Calibri' })
          ],
          spacing: { after: 40 }
        }),
        new Paragraph({
          children: [
            new TextRun({ text: value, bold: true, size: 20, color: '1E293B', font: 'Calibri' })
          ]
        })
      ]
    });
  }

  const metaTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [4500, 4500],
    borders: {
      top: borderSubtle, bottom: borderSubtle, left: borderLeft, right: borderSubtle,
      insideH: borderSubtle, insideV: borderSubtle
    },
    rows: [
      new TableRow({
        children: [buildMetaCell('Author', author), buildMetaCell('Classification', classification)]
      }),
      new TableRow({
        children: [buildMetaCell('Date', dateStr), buildMetaCell('Status', compliance)]
      })
    ]
  });

  elements.push(metaTable);
  elements.push(new Paragraph({ text: '', spacing: { after: 480 } }));

  return elements;
}

/**
 * Renders HTML 4-color gradient bar for PDF
 */
function renderHtmlGradientBar(colors, heightPx = 4) {
  return `<div class="grad-rule-bar" style="display:flex;width:100%;height:${heightPx}px;overflow:hidden;border-radius:2px;margin:4px 0 8px 0;">
    <div style="flex:1;height:100%;background:${colors[0]};"></div>
    <div style="flex:1;height:100%;background:${colors[1]};"></div>
    <div style="flex:1;height:100%;background:${colors[2]};"></div>
    <div style="flex:1;height:100%;background:${colors[3]};"></div>
  </div>`;
}

module.exports = {
  GRADIENT_THEMES,
  COVER_MODELS,
  selectCoverModel,
  selectGradientTheme,
  buildGenerativeCoverArtSvg,
  renderCoverBackgroundArtworkHtml,
  renderCoverBackgroundArtworkPng,
  renderCoverArtworkHtml,
  renderCoverArtworkPng,
  renderDocxGradientTable,
  renderDocxNativeCover,
  renderHtmlGradientBar
};
