'use strict';

const fs = require('fs');
const chromiumUtils = require('./chromium_utils');
const { escapeHtml } = chromiumUtils;
const {
  renderCoverArtworkHtml,
  renderHtmlGradientBar
} = require('./document_cover');

async function createPdfDocument(options, context) {
  const {
    outputPath, title, subtitle, author, classification,
    dateStr, compliance, sections, theme, includeCover
  } = context;

  // PDF format via Playwright + HTML/CSS
  const browser = await chromiumUtils.launchChromium();

  const page = await browser.newPage({
    viewport: { width: 794, height: 1123 },
    deviceScaleFactor: 1
  });
  await chromiumUtils.setupOfflineInterception(page);

  // Build clean publication pages
  let pagesHtml = '';

  // Page 1: Contained A4 Cover Page
  if (includeCover) {
    const coverHtmlInner = renderCoverArtworkHtml(theme, {
      title, subtitle, author, classification, date: dateStr, compliance,
      cover_model: options.cover_model
    }, false);

    // Extract style and body content from cover HTML
    const styleMatch = coverHtmlInner.match(/<style>([\s\S]*?)<\/style>/i);
    const coverStyles = styleMatch ? styleMatch[1] : '';
    const match = coverHtmlInner.match(/<body>([\s\S]*?)<\/body>/i);
    const coverContent = match ? match[1] : coverHtmlInner;

    pagesHtml += `<div class="cover-page page">${coverStyles ? `<style>${coverStyles}</style>` : ''}${coverContent}</div>`;
  }

  // Body Pages
  for (let sIdx = 0; sIdx < sections.length; sIdx++) {
    const sec = sections[sIdx];
    const pageNum = sIdx + 2;

    pagesHtml += `
    <div class="content-page page">
      <div class="page-running-head">
        <span>${escapeHtml(title)}</span>
        <span>SECTION 0${sIdx + 1}</span>
      </div>
      ${renderHtmlGradientBar(theme.colors, 3)}

      <h2 class="section-h2">${escapeHtml(sec.title)}</h2>
    `;

    if (sec.paragraphs) {
      for (const p of sec.paragraphs) {
        pagesHtml += `<p class="body-p">${escapeHtml(p)}</p>`;
      }
    }

    if (sec.callout) {
      pagesHtml += `
      <div class="callout-card" style="border-left-color: ${theme.colors[0]};">
        <div class="callout-title" style="color: ${theme.colors[0]};">${escapeHtml(sec.callout.title || 'ARCHITECTURAL DIRECTIVE')}</div>
        <div class="callout-text">${escapeHtml(sec.callout.text)}</div>
      </div>`;
    }

    if (sec.table && sec.table.headers && sec.table.rows) {
      pagesHtml += `<table class="exec-table"><thead><tr>`;
      for (const h of sec.table.headers) pagesHtml += `<th>${escapeHtml(h)}</th>`;
      pagesHtml += `</tr></thead><tbody>`;
      for (const row of sec.table.rows) {
        pagesHtml += `<tr>`;
        for (const cell of row) pagesHtml += `<td>${escapeHtml(cell)}</td>`;
        pagesHtml += `</tr>`;
      }
      pagesHtml += `</tbody></table>`;
    }

    if (sec.code && sec.code.snippet) {
      pagesHtml += `
      <div class="code-wrapper">
        <div class="code-lang">${escapeHtml((sec.code.language || 'YAML').toUpperCase())} CONFIGURATION</div>
        <pre><code>${sec.code.snippet.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
      </div>`;
    }

    pagesHtml += `
      <div style="flex-grow: 1;"></div>
      ${renderHtmlGradientBar(theme.colors, 3)}
      <div class="page-running-foot">
        <span>${escapeHtml(classification)}</span>
        <span>Page ${pageNum} of ${sections.length + 1}</span>
      </div>
    </div>`;
  }

  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #FFFFFF;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #1E293B;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    width: 210mm;
    height: 297mm;
    page-break-after: always;
    overflow: hidden;
    position: relative;
    background: #FAFBFD;
  }
  .page:last-child { page-break-after: avoid; }
  .content-page {
    padding: 20mm 20mm 18mm 20mm;
    display: flex;
    flex-direction: column;
    background: #FFFFFF;
  }
  .cover-page {
    position: relative;
    width: 210mm;
    height: 297mm;
    background: #FAFBFD;
    overflow: hidden;
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
    top: 700px;
    left: 60px;
    width: 674px;
    z-index: 10;
  }
  .chip {
    display: inline-block;
    padding: 5px 12px;
    background: ${theme.colors[0]};
    color: #FFFFFF;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    border-radius: 4px;
    margin-bottom: 14px;
  }
  .cover-title {
    font-size: 32px;
    font-weight: 900;
    line-height: 1.12;
    letter-spacing: -0.02em;
    color: #0F172A;
    text-transform: uppercase;
    margin-bottom: 12px;
  }
  .cover-title-line2 {
    color: ${theme.colors[0]};
    display: block;
    font-size: 26px;
    margin-top: 4px;
  }
  .cover-subtitle {
    font-size: 14.5px;
    line-height: 1.45;
    color: #475569;
    font-weight: 400;
    margin-bottom: 18px;
    max-width: 95%;
  }
  .grad-bar {
    display: flex;
    width: 260px;
    height: 4px;
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 20px;
  }
  .grad-seg { flex: 1; height: 100%; }
  .meta-card {
    background: rgba(255, 255, 255, 0.96);
    backdrop-filter: blur(8px);
    border: 1px solid #E2E8F0;
    border-left: 4px solid ${theme.colors[0]};
    border-radius: 8px;
    padding: 14px 20px;
    box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.05);
  }
  .meta-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px 20px;
  }
  .meta-item { display: flex; flex-direction: column; }
  .meta-label {
    font-size: 9.5px;
    font-weight: 700;
    color: #64748B;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 2px;
  }
  .meta-value {
    font-size: 11.5px;
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
  /* Running Header & Footer */
  .page-running-head {
    display: flex;
    justify-content: space-between;
    font-size: 8pt;
    font-weight: 600;
    color: #94A3B8;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 2px;
  }
  .page-running-foot {
    display: flex;
    justify-content: space-between;
    font-size: 8pt;
    color: #94A3B8;
    padding-top: 4px;
  }
  .section-h2 {
    font-size: 16pt;
    font-weight: 700;
    color: #0F172A;
    margin: 14px 0 14px 0;
    letter-spacing: -0.01em;
  }
  .body-p {
    font-size: 9.5pt;
    line-height: 1.55;
    color: #334155;
    margin: 0 0 11px 0;
    text-align: justify;
  }
  .callout-card {
    background: #F8FAFC;
    border-left: 4px solid #4F46E5;
    border-radius: 6px;
    padding: 12px 16px;
    margin: 12px 0;
  }
  .callout-title {
    font-size: 8.5pt;
    font-weight: 700;
    letter-spacing: 0.04em;
    margin-bottom: 4px;
  }
  .callout-text {
    font-size: 9pt;
    color: #334155;
    line-height: 1.45;
  }
  .exec-table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0;
    font-size: 8.5pt;
  }
  .exec-table th {
    background: #F1F5F9;
    color: #1E293B;
    font-weight: 700;
    text-align: left;
    padding: 8px 10px;
    border: 1px solid #E2E8F0;
  }
  .exec-table td {
    padding: 7px 10px;
    border: 1px solid #E2E8F0;
    color: #334155;
  }
  .exec-table tr:nth-child(even) td { background: #F8FAFC; }
  .code-wrapper {
    background: #F8FAFC;
    border: 1px solid #E2E8F0;
    border-radius: 6px;
    margin: 12px 0;
    overflow: hidden;
  }
  .code-lang {
    background: #F1F5F9;
    font-size: 7.5pt;
    font-weight: 700;
    color: #64748B;
    padding: 4px 10px;
    letter-spacing: 0.05em;
    border-bottom: 1px solid #E2E8F0;
  }
  pre {
    margin: 0;
    padding: 10px 12px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 8pt;
    line-height: 1.45;
    color: #0F172A;
  }
</style>
</head>
<body>
  ${pagesHtml}
</body>
</html>`;

  await page.setContent(fullHtml, { waitUntil: 'networkidle' });
  const pdfBuffer = await page.pdf({
    format: 'A4',
    printBackground: true
  });

  await browser.close();
  fs.writeFileSync(outputPath, pdfBuffer);

  return {
    success: true,
    file_path: outputPath,
    format: 'pdf',
    pages_count: sections.length + 1,
    bytes: pdfBuffer.length
  };
}

module.exports = {
  createPdfDocument
};
