/**
 * Document Cover & Gradient Theme Engine
 * Produces publication-grade geometric diamond cascade covers and 4-color gradient rules
 * across DOCX, PDF, and PPTX formats matching the reference template.
 */


const GRADIENT_THEMES = {
  amber_coral: {
    name: 'Amber Coral',
    colors: ['#D95338', '#EA580C', '#D97706', '#8B5CF6'],
    bg: '#FAFBFD'
  },
  cyber_indigo: {
    name: 'Cyber Indigo',
    colors: ['#4F46E5', '#7C3AED', '#9333EA', '#06B6D4'],
    bg: '#FAFBFD'
  },
  ocean_teal: {
    name: 'Oceanic Teal',
    colors: ['#0F766E', '#0D9488', '#10B981', '#3B82F6'],
    bg: '#FAFBFD'
  },
  nordic_crimson: {
    name: 'Nordic Crimson',
    colors: ['#BE123C', '#E11D48', '#6366F1', '#0EA5E9'],
    bg: '#FAFBFD'
  }
};

function selectGradientTheme(themeKey) {
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
 * Builds the geometric diamond cascade HTML/SVG template
 */
function renderCoverArtworkHtml(theme, options = {}, isWidescreen = false) {
  const [c1, c2, c3, c4] = theme.colors;
  const title = options.title || 'DevOps Engineering';
  const subtitle = options.subtitle || 'Principles, Automated Delivery Pipelines & Site Reliability Engineering';
  const author = options.author || 'Andy Setiyawan | Principal Infrastructure Architect';
  const classification = options.classification || 'Enterprise Standard (v1.0.0)';
  const dateStr = options.date || 'October 2026';
  const compliance = options.compliance || 'Production Verified — Zero AI Artifacts';

  const width = isWidescreen ? 1920 : 1240;
  const height = isWidescreen ? 1080 : 1754;

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

  const diamondGroupX = isWidescreen ? 280 : 180;
  const diamondGroupY = isWidescreen ? 540 : 860;
  const textLeft = isWidescreen ? '920px' : '540px';
  const textTop = isWidescreen ? '180px' : '260px';
  const textWidth = isWidescreen ? '880px' : '620px';

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
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    position: relative;
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
    padding: 6px 16px;
    background: ${c1};
    color: #FFFFFF;
    font-size: ${isWidescreen ? '14px' : '13px'};
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    border-radius: 4px;
    margin-bottom: 28px;
  }
  .cover-title {
    font-size: ${isWidescreen ? '60px' : '50px'};
    font-weight: 900;
    line-height: 1.05;
    letter-spacing: -0.02em;
    color: #0F172A;
    text-transform: uppercase;
    margin-bottom: 20px;
  }
  .cover-title-line2 {
    color: ${c1};
    display: block;
  }
  .cover-subtitle {
    font-size: ${isWidescreen ? '21px' : '18px'};
    line-height: 1.45;
    color: #475569;
    font-weight: 400;
    margin-bottom: 28px;
    max-width: 92%;
  }
  .grad-bar {
    display: flex;
    width: 280px;
    height: 6px;
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 36px;
  }
  .grad-seg { flex: 1; height: 100%; }
  .meta-card {
    background: rgba(255, 255, 255, 0.94);
    backdrop-filter: blur(8px);
    border: 1px solid #E2E8F0;
    border-left: 4px solid ${c1};
    border-radius: 8px;
    padding: ${isWidescreen ? '24px 28px' : '20px 24px'};
    box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.05);
  }
  .meta-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px 24px;
  }
  .meta-item { display: flex; flex-direction: column; }
  .meta-label {
    font-size: 11px;
    font-weight: 700;
    color: #64748B;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 4px;
  }
  .meta-value {
    font-size: 13.5px;
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
  }
</style>
</head>
<body>

<svg class="diamond-canvas" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}" />
      <stop offset="100%" stop-color="${c2}" />
    </linearGradient>
    <linearGradient id="grad2" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c2}" />
      <stop offset="100%" stop-color="${c3}" />
    </linearGradient>
    <linearGradient id="grad3" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c3}" />
      <stop offset="100%" stop-color="${c4}" />
    </linearGradient>
  </defs>

  <!-- Cascading Geometric Diamonds -->
  <g transform="translate(${diamondGroupX}, ${diamondGroupY})">
    <rect x="-380" y="-380" width="760" height="760" rx="36" transform="rotate(45)"
          fill="none" stroke="${c2}" stroke-width="2" stroke-opacity="0.18" stroke-dasharray="8 6" />

    <rect x="-320" y="-320" width="640" height="640" rx="28" transform="rotate(45)"
          fill="${c1}" fill-opacity="0.08" stroke="${c1}" stroke-width="2.5" stroke-opacity="0.35" />

    <rect x="-350" y="-460" width="460" height="460" rx="20" transform="rotate(45)"
          fill="${c2}" fill-opacity="0.12" stroke="${c2}" stroke-width="2" stroke-opacity="0.4" />

    <rect x="-240" y="-240" width="480" height="480" rx="24" transform="rotate(45)"
          fill="url(#grad1)" fill-opacity="0.92" />

    <rect x="-170" y="-170" width="340" height="340" rx="16" transform="rotate(45)"
          fill="${c1}" fill-opacity="0.95" />

    <rect x="-40" y="40" width="320" height="320" rx="16" transform="rotate(45)"
          fill="url(#grad2)" fill-opacity="0.85" />

    <rect x="-290" y="20" width="220" height="220" rx="12" transform="rotate(45)"
          fill="${c4}" fill-opacity="0.88" />

    <rect x="-90" y="-280" width="260" height="260" rx="14" transform="rotate(45)"
          fill="${c3}" fill-opacity="0.80" />

    <rect x="-120" y="-120" width="240" height="240" rx="10" transform="rotate(45)"
          fill="none" stroke="#FFFFFF" stroke-width="3" stroke-opacity="0.85" />

    <rect x="-30" y="-30" width="60" height="60" rx="6" transform="rotate(45)"
          fill="#FFFFFF" fill-opacity="0.9" />

    <rect x="180" y="-180" width="160" height="160" rx="10" transform="rotate(45)"
          fill="none" stroke="${c1}" stroke-width="2.5" stroke-opacity="0.5" />
    <rect x="220" y="80" width="120" height="120" rx="8" transform="rotate(45)"
          fill="${c2}" fill-opacity="0.2" stroke="${c2}" stroke-width="2" stroke-opacity="0.4" />
  </g>
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
</div>

</body>
</html>`;
}

/**
 * Renders high-DPI cover image PNG via Playwright Chromium
 */
async function renderCoverArtworkPng(theme, options = {}, isWidescreen = false) {
  const playwright = getPlaywright();
  const browser = await playwright.chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const width = isWidescreen ? 1920 : 1240;
  const height = isWidescreen ? 1080 : 1754;

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
  selectGradientTheme,
  renderCoverArtworkHtml,
  renderCoverArtworkPng,
  renderDocxGradientTable,
  renderHtmlGradientBar
};
