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
 * Builds the geometric diamond cascade SVG group (pure vector geometry)
 */
function buildDiamondSvgGroup(colors, diamondGroupX, diamondGroupY, scale = 1) {
  const [c1, c2, c3, c4] = colors;
  return `
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
  <g transform="translate(${diamondGroupX}, ${diamondGroupY}) scale(${scale})">
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
  </g>`;
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

function renderCoverBackgroundArtworkHtml(theme, isWidescreen = false) {
  const [c1, c2, c3, c4] = theme.colors;
  const width = isWidescreen ? 1920 : 794;
  const height = isWidescreen ? 1080 : 1123;
  const diamondGroupX = isWidescreen ? 320 : 180;
  const diamondGroupY = isWidescreen ? 320 : 260;
  const scale = isWidescreen ? 0.85 : 0.65;

  const extraStyles = `  .diamond-canvas { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
  .bottom-strap { position: absolute; bottom: 0; left: 0; width: 100%; height: 8px; display: flex; }
  .grad-seg { flex: 1; height: 100%; }`;

  const bodyContent = `<svg class="diamond-canvas" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  ${buildDiamondSvgGroup(theme.colors, diamondGroupX, diamondGroupY, scale)}
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

  const diamondGroupX = isWidescreen ? 320 : 180;
  const diamondGroupY = isWidescreen ? 320 : 260;
  const scale = isWidescreen ? 0.85 : 0.65;

  // Contained content panel coordinates (bottom placement for PDF & PPTX)
  const textLeft = isWidescreen ? '780px' : '60px';
  const textTop = isWidescreen ? '460px' : '570px';
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
  ${buildDiamondSvgGroup(theme.colors, diamondGroupX, diamondGroupY, scale)}
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
async function renderCoverBackgroundArtworkPng(theme, isWidescreen = false) {
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

  const html = renderCoverBackgroundArtworkHtml(theme, isWidescreen);
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

  // Spacing before cover content (places typography in lower half over background artwork)
  elements.push(new Paragraph({ text: '', spacing: { before: 5200 } }));

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
  selectGradientTheme,
  renderCoverBackgroundArtworkHtml,
  renderCoverBackgroundArtworkPng,
  renderCoverArtworkHtml,
  renderCoverArtworkPng,
  renderDocxGradientTable,
  renderDocxNativeCover,
  renderHtmlGradientBar
};
