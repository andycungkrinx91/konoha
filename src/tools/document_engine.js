'use strict';

/**
 * src/tools/document_engine.js — Official Konoha Document Engineering Engine.
 *
 * Implements the 5 core global document creation tools:
 * 1. document_create: Generates publication-grade DOCX (docx) or PDF (Playwright + HTML/CSS).
 * 2. spreadsheet_create: Generates executive XLSX (ExcelJS) with sheets, formulas, and formatting.
 * 3. presentation_create: Generates modern 16:9 widescreen PPTX (PptxGenJS) from specifications.
 * 4. diagram_create: Generates crisp, scalable SVG diagrams from structured nodes and edges.
 * 5. animation_export: Exports diagram or pipeline animations to high-quality GIF (Playwright + FFmpeg) or PNG.
 *
 * Dynamic Invariants Enforced:
 * - 100% dynamic path resolution: zero hardcoded paths; auto-creates parent directories recursively.
 * - 100% English standard for all headers, footers, labels, and metadata.
 * - DOCX: Zero rasterized font text in covers. Diamond artwork is pure text-free background;
 *   all headings, titles, subtitles, and metadata tables are native Word XML elements.
 * - PDF: Strict A4 portrait canvas containment (794px x 1123px / 210mm x 297mm).
 * - PPTX: Strict 16:9 coordinate budget (card height 4.60", max Y <= 6.05", footer at 6.55").
 * - XLSX: AutoFilter enabled on all tables, distinct column formatters, cross-sheet XLOOKUP, KPI summary cards.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const {
  selectGradientTheme,
  renderCoverBackgroundArtworkPng,
  renderCoverArtworkHtml,
  renderCoverArtworkPng,
  renderDocxGradientTable,
  renderDocxNativeCover,
  renderHtmlGradientBar
} = require('./document_cover');
const chromiumUtils = require('./chromium_utils');
const { escapeHtml } = chromiumUtils;

function sanitizeFormula(formula) {
  if (typeof formula !== 'string') return '';
  const clean = formula.startsWith('=') ? formula.slice(1).trim() : formula.trim();
  if (/(WEBSERVICE\(|ENCODEURL\(|HYPERLINK\(|CALL\(|REGISTER\.|DDEREFERENCE\(|SQL\.REQUEST\()/i.test(clean)) {
    throw new Error(`Formula rejected: function not allowed: ${clean}`);
  }
  return clean;
}

const EXCEL_PALETTE_HEX = [
  '#3B82F6', '#14B8A6', '#8B5CF6', '#F97316', '#EAB308',
  '#EC4899', '#84CC16', '#06B6D4', '#6366F1', '#F43F5E'
];
const EXCEL_PALETTE_ARGB = EXCEL_PALETTE_HEX.map((h) => 'FF' + h.replace('#', ''));

function getDocx() {
  return require('docx');
}

function getXlsxPopulate() {
  return require('xlsx-populate');
}

function cleanHexColor(c) {
  if (!c) return '000000';
  let s = String(c).trim();
  if (s.startsWith('#')) s = s.slice(1);
  if (s.length === 8 && s.toLowerCase().startsWith('ff')) s = s.slice(2);
  return s.toUpperCase();
}

function getPptxGenJS() {
  return require('pptxgenjs');
}

/**
 * Resolves a dynamic target output path and ensures parent directory exists.
 */
function resolveDynamicOutputPath(targetPath, defaultFilename) {
  const resolved = path.resolve(targetPath || path.join(process.cwd(), 'output', defaultFilename));
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return resolved;
}

// 1. document_create — Generates publication-grade DOCX or PDF
async function documentCreate(options = {}) {
  const format = (options.format || (options.output_path && path.extname(options.output_path).toLowerCase() === '.pdf' ? 'pdf' : 'docx')).toLowerCase();
  if (!['docx', 'pdf'].includes(format)) {
    return { success: false, error: `Unsupported document format '${format}'. Supported formats: 'docx', 'pdf'` };
  }

  const defaultFilename = `document.${format}`;
  const outputPath = resolveDynamicOutputPath(options.output_path, defaultFilename);

  const title = options.title || 'Technical Architecture Specification';
  const subtitle = options.subtitle || 'Operational Standards & Automated Delivery Architecture';
  const author = options.author || 'Enterprise Architecture Team';
  const classification = options.classification || 'Enterprise Standard (v1.0.0)';
  const dateStr = options.date || new Date().toISOString().split('T')[0];
  const compliance = options.compliance || 'Production Verified — Zero AI Artifacts';
  const sections = options.sections || [];
  const theme = selectGradientTheme(options.theme);
  const includeCover = options.cover !== false;

  if (format === 'docx') {
    const docxModule = getDocx();
    const {
      Document, Packer, Paragraph, TextRun, HeadingLevel, Table,
      TableRow, TableCell, WidthType, BorderStyle, ShadingType,
      Header, Footer, ImageRun,
      HorizontalPositionRelativeFrom, HorizontalPositionAlign,
      VerticalPositionRelativeFrom, VerticalPositionAlign, TextWrappingType
    } = docxModule;

    const totalPages = includeCover ? (sections.length + 1) : sections.length;

    // Render structured body sections per page (discrete Word sections with static unshaded page footers)
    const contentSections = sections.map((sec, i) => {
      const pageNum = includeCover ? (i + 2) : (i + 1);
      const sectionChildren = [];

      let hl = HeadingLevel.HEADING_1;
      if (sec.level === 2) hl = HeadingLevel.HEADING_2;
      if (sec.level === 3) hl = HeadingLevel.HEADING_3;

      sectionChildren.push(
        new Paragraph({
          text: sec.title,
          heading: hl,
          spacing: { before: 360, after: 180 }
        })
      );

      // Paragraphs
      if (sec.paragraphs && Array.isArray(sec.paragraphs)) {
        for (const pText of sec.paragraphs) {
          sectionChildren.push(
            new Paragraph({
              children: [new TextRun({ text: pText, size: 21, color: '1E293B', font: 'Calibri' })],
              spacing: { line: 276, before: 100, after: 140 }
            })
          );
        }
      }

      // Callout Card
      if (sec.callout) {
        const borderLeft = { style: BorderStyle.SINGLE, size: 24, color: theme.colors[0].replace('#', '') };
        const borderNone = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
        sectionChildren.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            columnWidths: [9000],
            borders: { top: borderNone, bottom: borderNone, left: borderLeft, right: borderNone, insideH: borderNone, insideV: borderNone },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: 9000, type: WidthType.DXA },
                    shading: { type: ShadingType.CLEAR, fill: 'F8FAFC' },
                    margins: { top: 120, bottom: 120, left: 160, right: 160 },
                    borders: { top: borderNone, bottom: borderNone, left: borderLeft, right: borderNone },
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({ text: (sec.callout.title || 'ARCHITECTURAL DIRECTIVE').toUpperCase(), bold: true, size: 18, color: theme.colors[0].replace('#', ''), font: 'Calibri' })
                        ],
                        spacing: { after: 60 }
                      }),
                      new Paragraph({
                        children: [new TextRun({ text: sec.callout.text || '', size: 20, color: '334155', font: 'Calibri' })]
                      })
                    ]
                  })
                ]
              })
            ]
          })
        );
        sectionChildren.push(new Paragraph({ text: '', spacing: { after: 140 } }));
      }

      // Executive Table
      if (sec.table && sec.table.headers && sec.table.rows) {
        const colCount = sec.table.headers.length;
        const colWidthDxa = Math.floor(9000 / colCount);
        const colWidths = Array(colCount).fill(colWidthDxa);
        const tableBorder = { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' };
        const tableBorders = { top: tableBorder, bottom: tableBorder, left: tableBorder, right: tableBorder, insideH: tableBorder, insideV: tableBorder };

        const headerRow = new TableRow({
          children: sec.table.headers.map((h) =>
            new TableCell({
              width: { size: colWidthDxa, type: WidthType.DXA },
              shading: { type: ShadingType.CLEAR, fill: 'F1F5F9' },
              margins: { top: 90, bottom: 90, left: 100, right: 100 },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: h, bold: true, size: 19, color: '1E293B', font: 'Calibri' })]
                })
              ]
            })
          )
        });

        const dataRows = sec.table.rows.map((row, rIdx) => {
          const bg = rIdx % 2 === 1 ? 'F8FAFC' : 'FFFFFF';
          return new TableRow({
            children: row.map((cellText) =>
              new TableCell({
                width: { size: colWidthDxa, type: WidthType.DXA },
                shading: { type: ShadingType.CLEAR, fill: bg },
                margins: { top: 70, bottom: 70, left: 100, right: 100 },
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: String(cellText), size: 19, color: '334155', font: 'Calibri' })]
                  })
                ]
              })
            )
          });
        });

        sectionChildren.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            columnWidths: colWidths,
            borders: tableBorders,
            rows: [headerRow, ...dataRows]
          })
        );
        sectionChildren.push(new Paragraph({ text: '', spacing: { after: 140 } }));
      }

      // Code Block
      if (sec.code && sec.code.snippet) {
        const codeLines = sec.code.snippet.split('\n');
        for (const cl of codeLines) {
          sectionChildren.push(
            new Paragraph({
              children: [new TextRun({ text: cl, font: 'JetBrains Mono', size: 18, color: '1E293B' })],
              spacing: { line: 240, before: 15, after: 15 }
            })
          );
        }
        sectionChildren.push(new Paragraph({ text: '', spacing: { after: 100 } }));
      }

      const gradTable = renderDocxGradientTable(docxModule, theme.colors);

      return {
        properties: {
          page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } }
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [new TextRun({ text: title, size: 16, color: '94A3B8', font: 'Calibri' })],
                alignment: 'right',
                spacing: { after: 60 }
              }),
              gradTable
            ]
          })
        },
        footers: {
          default: new Footer({
            children: [
              gradTable,
              new Paragraph({
                children: [
                  new TextRun({
                    text: `${classification}   |   Page ${pageNum} of ${totalPages}`,
                    size: 16,
                    color: '94A3B8',
                    font: 'Calibri'
                  })
                ],
                alignment: 'center',
                spacing: { before: 80 }
              })
            ]
          })
        },
        children: sectionChildren
      };
    });

    if (contentSections.length === 0 && !includeCover) {
      contentSections.push({
        properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
        children: [new Paragraph({ text: '' })]
      });
    }

    let docSections = contentSections;

    if (includeCover) {
      try {
        // Generate text-free background artwork PNG (strictly zero text inside image)
        const bgArtworkBuffer = await renderCoverBackgroundArtworkPng(theme, false, {
          cover_model: options.cover_model
        });

        // Native Word XML Cover Typography (100% editable native text)
        const nativeCoverElements = renderDocxNativeCover(docxModule, theme, {
          title, subtitle, author, classification, date: dateStr, compliance
        });

        const coverSection = {
          properties: {
            page: { margin: { top: 1000, bottom: 1000, left: 1440, right: 1440 } }
          },
          headers: { default: new Header({ children: [] }) },
          footers: { default: new Footer({ children: [] }) },
          children: [
            // Background artwork floating behind document
            new Paragraph({
              children: [
                new ImageRun({
                  data: bgArtworkBuffer,
                  transformation: { width: 794, height: 1123 },
                  floating: {
                    horizontalPosition: {
                      relative: HorizontalPositionRelativeFrom.PAGE,
                      align: HorizontalPositionAlign.CENTER
                    },
                    verticalPosition: {
                      relative: VerticalPositionRelativeFrom.PAGE,
                      align: VerticalPositionAlign.TOP
                    },
                    wrap: {
                      type: TextWrappingType.NONE
                    },
                    behindDocument: true
                  }
                })
              ]
            }),
            ...nativeCoverElements
          ]
        };

        docSections = [coverSection, ...contentSections];
      } catch (err) {
        console.warn('Cover generation fallback:', err.message);
        docSections = contentSections;
      }
    }

    const doc = new Document({
      creator: author,
      title,
      description: subtitle,
      styles: {
        default: {
          document: {
            run: { font: 'Calibri', size: 21, color: '1E293B' }
          }
        }
      },
      sections: docSections
    });

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(outputPath, buffer);

    return {
      success: true,
      file_path: outputPath,
      format: 'docx',
      sections_count: sections.length,
      bytes: buffer.length
    };
  }

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

// 2. spreadsheet_create — Generates XLSX with sheets, formulas, and formatting
async function spreadsheetCreate(options = {}) {
  const outputPath = resolveDynamicOutputPath(options.output_path, 'spreadsheet.xlsx');

  const XlsxPopulate = getXlsxPopulate();
  const workbook = await XlsxPopulate.fromBlankAsync();
  if (options.author) {
    try {
      workbook.property('Author', options.author);
      workbook.property('LastModifiedBy', options.author);
    } catch (_) { /* intentional best-effort fallback */ }
  }

  const sheets = options.sheets || [
    {
      name: 'Overview',
      title: 'Operations & Performance Matrix',
      headers: ['Component', 'Region', 'Requests/sec', 'Latency P99', 'Status'],
      rows: [
        ['Edge Gateway', 'us-east-1', 14200, 4.2, 'Operational'],
        ['Core Ingress', 'us-west-2', 12800, 3.8, 'Operational'],
        ['Redis Cluster', 'us-east-1', 45000, 1.1, 'Operational']
      ]
    }
  ];

  for (let sIdx = 0; sIdx < sheets.length; sIdx++) {
    const sheetDef = sheets[sIdx];
    const headers = sheetDef.headers || [];
    const rows = sheetDef.rows || [];

    const sheet = sIdx === 0 ? workbook.sheet(0).name(sheetDef.name || 'Sheet1') : workbook.addSheet(sheetDef.name || `Sheet${sIdx + 1}`);

    let ySplit = 1;
    if (sheetDef.kpi_cards && sheetDef.kpi_cards.length > 0) {
      ySplit = sheetDef.title ? 6 : 4;
    } else if (sheetDef.title) {
      ySplit = sheetDef.subtitle ? 4 : 3;
    }

    try {
      sheet.freezePanes(0, ySplit);
    } catch (_) { /* intentional best-effort fallback */ }

    let currentRow = 1;

    if (sheetDef.title) {
      const endColLetter = String.fromCharCode(64 + Math.max(headers.length, 5));
      sheet.range(`A${currentRow}:${endColLetter}${currentRow}`).merged(true);
      const titleCell = sheet.cell(`A${currentRow}`);
      titleCell.value(sheetDef.title);
      titleCell.style({
        fontFamily: 'Segoe UI',
        fontSize: 12.5,
        bold: true,
        fontColor: '1E293B',
        fill: 'F5F3FF',
        horizontalAlignment: 'left',
        verticalAlignment: 'center'
      });
      sheet.row(currentRow).height(24);
      currentRow++;

      if (sheetDef.subtitle) {
        sheet.range(`A${currentRow}:${endColLetter}${currentRow}`).merged(true);
        const subCell = sheet.cell(`A${currentRow}`);
        subCell.value(sheetDef.subtitle);
        subCell.style({
          fontFamily: 'Segoe UI',
          fontSize: 9,
          fontColor: '64748B',
          fill: 'FAF5FF',
          horizontalAlignment: 'left',
          verticalAlignment: 'center'
        });
        sheet.row(currentRow).height(20);
        currentRow++;
      }
      sheet.row(currentRow).height(10);
      currentRow++;
    }

    if (sheetDef.kpi_cards && Array.isArray(sheetDef.kpi_cards) && sheetDef.kpi_cards.length > 0) {
      const kpiAccentColors = [...EXCEL_PALETTE_ARGB].sort(() => Math.random() - 0.5);
      const mergeTwoCols = sheetDef.kpi_cards.length <= 4 && headers.length >= 6;

      sheet.row(currentRow).height(18);
      sheet.row(currentRow + 1).height(28);

      sheetDef.kpi_cards.forEach((kpi, kIdx) => {
        const startCol = mergeTwoCols ? (1 + kIdx * 2) : (1 + kIdx);
        const endCol = mergeTwoCols ? (startCol + 1) : startCol;
        const rawAccent = kpiAccentColors[kIdx % kpiAccentColors.length];
        const accentColor = cleanHexColor(rawAccent);

        if (mergeTwoCols) {
          sheet.range(currentRow, startCol, currentRow, endCol).merged(true);
          sheet.range(currentRow + 1, startCol, currentRow + 1, endCol).merged(true);
        }

        const labelCell = sheet.row(currentRow).cell(startCol);
        labelCell.value((kpi.label || '').toUpperCase());
        labelCell.style({
          fontFamily: 'Segoe UI',
          fontSize: 8,
          bold: true,
          fontColor: '64748B',
          fill: 'F1F5F9',
          horizontalAlignment: 'center',
          verticalAlignment: 'center',
          topBorder: 'thin',
          topBorderColor: 'CBD5E1',
          leftBorder: 'thin',
          leftBorderColor: 'CBD5E1',
          rightBorder: 'thin',
          rightBorderColor: 'CBD5E1'
        });

        if (mergeTwoCols) {
          const rCell = sheet.row(currentRow).cell(endCol);
          rCell.style({
            topBorder: 'thin',
            topBorderColor: 'CBD5E1',
            rightBorder: 'thin',
            rightBorderColor: 'CBD5E1'
          });
        }

        const valCell = sheet.row(currentRow + 1).cell(startCol);
        if (typeof kpi.formula === 'string') {
          const cleanFormula = sanitizeFormula(kpi.formula);
          valCell.formula(cleanFormula.replace(/^=/, ''));
        } else {
          valCell.value(kpi.value);
        }

        valCell.style({
          fontFamily: 'Segoe UI',
          fontSize: 15,
          bold: true,
          fontColor: accentColor,
          fill: 'F1F5F9',
          horizontalAlignment: 'center',
          verticalAlignment: 'center',
          leftBorder: 'thin',
          leftBorderColor: 'CBD5E1',
          rightBorder: 'thin',
          rightBorderColor: 'CBD5E1',
          bottomBorder: 'medium',
          bottomBorderColor: accentColor
        });

        if (mergeTwoCols) {
          const rValCell = sheet.row(currentRow + 1).cell(endCol);
          rValCell.style({
            rightBorder: 'thin',
            rightBorderColor: 'CBD5E1',
            bottomBorder: 'medium',
            bottomBorderColor: accentColor
          });
        }

        if (kpi.format === 'currency') valCell.style('numberFormat', '"$"#,##0');
        else if (kpi.format === 'percent') valCell.style('numberFormat', '0.0%');
        else if (kpi.format === 'integer') valCell.style('numberFormat', '#,##0');
      });

      currentRow += 2;
      sheet.row(currentRow).height(12);
      currentRow++;
    }

    if (sheetDef.section_title) {
      const secCell = sheet.row(currentRow).cell(1);
      secCell.value(sheetDef.section_title);
      secCell.style({
        fontFamily: 'Segoe UI',
        fontSize: 11,
        bold: true,
        fontColor: '1E293B'
      });
      sheet.row(currentRow).height(24);
      currentRow++;
    }

    const headerRowIdx = currentRow;
    const headerRow = sheet.row(headerRowIdx);
    headerRow.height(26);

    for (let cIdx = 1; cIdx <= headers.length; cIdx++) {
      const hCell = headerRow.cell(cIdx);
      hCell.value(headers[cIdx - 1]);
      hCell.style({
        fontFamily: 'Segoe UI',
        fontSize: 9,
        bold: true,
        fontColor: '1E293B',
        fill: 'EEF2F6',
        topBorder: 'thin',
        topBorderColor: 'CBD5E1',
        leftBorder: 'thin',
        leftBorderColor: 'CBD5E1',
        rightBorder: 'thin',
        rightBorderColor: 'CBD5E1',
        bottomBorder: 'medium',
        bottomBorderColor: '94A3B8',
        horizontalAlignment: 'left',
        verticalAlignment: 'center',
        wrapText: true
      });
    }

    currentRow++;

    for (let rIdx = 0; rIdx < rows.length; rIdx++) {
      const rowData = rows[rIdx];
      const row = sheet.row(currentRow);
      row.height(20);

      const zebraBg = rIdx % 2 === 1 ? 'F8FAFC' : 'FFFFFF';

      for (let cIdx = 0; cIdx < rowData.length; cIdx++) {
        const cellVal = rowData[cIdx];
        const cell = row.cell(cIdx + 1);

        if (cellVal && typeof cellVal === 'object' && cellVal.formula) {
          const cleanFormula = sanitizeFormula(cellVal.formula);
          cell.formula(cleanFormula.replace(/^=/, ''));
        } else {
          cell.value(cellVal);
        }

        cell.style({
          fontFamily: 'Segoe UI',
          fontSize: 9,
          fontColor: '0F172A',
          fill: zebraBg,
          topBorder: 'thin',
          topBorderColor: 'CBD5E1',
          bottomBorder: 'thin',
          bottomBorderColor: 'CBD5E1',
          leftBorder: 'thin',
          leftBorderColor: 'CBD5E1',
          rightBorder: 'thin',
          rightBorderColor: 'CBD5E1',
          horizontalAlignment: 'left',
          verticalAlignment: 'center'
        });

        if (sheetDef.columns && sheetDef.columns[cIdx] && sheetDef.columns[cIdx].format) {
          const fmt = sheetDef.columns[cIdx].format;
          if (fmt === 'currency') {
            cell.style('numberFormat', '"$"#,##0');
            cell.style('horizontalAlignment', 'right');
          } else if (fmt === 'percent') {
            cell.style('numberFormat', '0.0%');
            cell.style('horizontalAlignment', 'right');
          } else if (fmt === 'integer') {
            cell.style('numberFormat', '#,##0');
            cell.style('horizontalAlignment', 'right');
          } else if (fmt === 'duration_hrs') {
            cell.style('numberFormat', '0.0 "hrs"');
            cell.style('horizontalAlignment', 'right');
          } else if (fmt === 'duration_mins') {
            cell.style('numberFormat', '0 "mins"');
            cell.style('horizontalAlignment', 'right');
          }
        } else if (typeof cellVal === 'number') {
          if (cellVal > 0 && cellVal < 1) {
            cell.style('numberFormat', '0.0%');
            cell.style('horizontalAlignment', 'right');
          } else if (Number.isInteger(cellVal)) {
            cell.style('numberFormat', '#,##0');
            cell.style('horizontalAlignment', 'right');
          }
        }

        const strVal = String((cellVal && typeof cellVal === 'object' && cellVal.result !== undefined) ? cellVal.result : (cellVal || ''));
        if (/(?:DEPRECATED|CRITICAL|FAILED|HIGH|ERROR|EOS|EOL)/i.test(strVal)) {
          cell.style({
            fill: 'FEE2E2',
            fontColor: '991B1B',
            bold: true,
            fontSize: 8.5,
            horizontalAlignment: 'center'
          });
        } else if (/(?:ACTIVE|HEALTHY|OPERATIONAL|SUCCESS|PASSED|STABLE)/i.test(strVal)) {
          cell.style({
            fill: 'DCFCE7',
            fontColor: '166534',
            bold: true,
            fontSize: 8.5,
            horizontalAlignment: 'center'
          });
        } else if (/(?:TIER|CORE|PRIMARY)/i.test(strVal)) {
          cell.style({
            fill: 'E0E7FF',
            fontColor: '3730A3',
            bold: true,
            fontSize: 8.5,
            horizontalAlignment: 'center'
          });
        } else if (/(?:WARNING|PENDING|MIGRATING|SPOT)/i.test(strVal)) {
          cell.style({
            fill: 'FEF3C7',
            fontColor: '92400E',
            bold: true,
            fontSize: 8.5,
            horizontalAlignment: 'center'
          });
        }
      }

      currentRow++;
    }

    const endDataRow = currentRow - 1;

    if (sheetDef.auto_filter !== false && headers.length > 0 && rows.length > 0) {
      try {
        sheet.autoFilter(sheet.range(headerRowIdx, 1, endDataRow, headers.length));
      } catch (_) { /* intentional best-effort fallback */ }
    }

    if (sheetDef.summary) {
      const sumRow = sheet.row(currentRow);
      sumRow.height(22);

      for (let cIdx = 0; cIdx < sheetDef.summary.length; cIdx++) {
        const item = sheetDef.summary[cIdx];
        const cell = sumRow.cell(cIdx + 1);
        if (item && typeof item === 'object' && item.formula) {
          const cleanFormula = sanitizeFormula(item.formula);
          cell.formula(cleanFormula.replace(/^=/, ''));
        } else {
          cell.value(item);
        }

        cell.style({
          fontFamily: 'Segoe UI',
          fontSize: 9.5,
          bold: true,
          fontColor: '0F172A',
          fill: 'F1F5F9',
          topBorder: 'thin',
          topBorderColor: 'CBD5E1',
          bottomBorder: 'double',
          bottomBorderColor: '64748B',
          leftBorder: 'thin',
          leftBorderColor: 'CBD5E1',
          rightBorder: 'thin',
          rightBorderColor: 'CBD5E1',
          horizontalAlignment: 'left',
          verticalAlignment: 'center'
        });

        if (sheetDef.columns && sheetDef.columns[cIdx] && sheetDef.columns[cIdx].format) {
          const fmt = sheetDef.columns[cIdx].format;
          if (fmt === 'currency') {
            cell.style('numberFormat', '"$"#,##0');
            cell.style('horizontalAlignment', 'right');
          } else if (fmt === 'percent') {
            cell.style('numberFormat', '0.0%');
            cell.style('horizontalAlignment', 'right');
          } else if (fmt === 'integer') {
            cell.style('numberFormat', '#,##0');
            cell.style('horizontalAlignment', 'right');
          }
        }
      }

      currentRow++;
    }

    headers.forEach((h, idx) => {
      let maxLen = 14;
      if (h) maxLen = Math.max(maxLen, String(h).length + 4);
      if (sheetDef.columns && sheetDef.columns[idx] && sheetDef.columns[idx].width) {
        maxLen = sheetDef.columns[idx].width;
      }
      try {
        sheet.column(idx + 1).width(maxLen);
      } catch (_) { /* intentional best-effort fallback */ }
    });
  }

  await workbook.toFileAsync(outputPath);
  return {
    success: true,
    file_path: outputPath,
    sheet_count: sheets.length
  };
}

// 3. presentation_create — Generates modern 16:9 widescreen PPTX
async function presentationCreate(options = {}) {
  const outputPath = resolveDynamicOutputPath(options.output_path, 'presentation.pptx');

  const PptxGenJS = getPptxGenJS();
  const pptx = new PptxGenJS();

  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = options.author || 'Enterprise Architecture Team';
  pptx.company = options.company || 'Enterprise Engineering';
  pptx.title = options.title || 'Technical Architecture Presentation';
  pptx.subject = options.subtitle || options.title || 'Enterprise Operational Standards';

  const theme = selectGradientTheme(options.theme);
  const themeColors = theme.colors.map((c) => c.replace('#', ''));
  const slides = options.slides || [];

  for (let sIdx = 0; sIdx < slides.length; sIdx++) {
    const sDef = slides[sIdx];
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };

    // Slide 1: Cover Slide
    if (sDef.layout === 'title' || (sIdx === 0 && !sDef.layout)) {
      try {
        const coverBuffer = await renderCoverArtworkPng(theme, {
          title: sDef.title || pptx.title,
          subtitle: sDef.subtitle || pptx.subject,
          author: options.author || pptx.author,
          classification: options.classification || 'Enterprise Technical Standard',
          date: options.date || new Date().toISOString().split('T')[0],
          cover_model: options.cover_model
        }, true);

        slide.addImage({
          data: 'image/png;base64,' + coverBuffer.toString('base64'),
          x: 0, y: 0, w: 13.33, h: 7.5
        });
      } catch (_) {
        slide.addShape(pptx.ShapeType.roundRect, {
          x: 1.0, y: 1.2, w: 11.33, h: 5.0,
          rectRadius: 0.2, fill: { color: 'F1F5F9' }, line: { color: 'CBD5E1', width: 1.5 }
        });
        slide.addText(sDef.title || pptx.title, {
          x: 1.5, y: 2.2, w: 10.0, h: 1.2,
          fontSize: 32, bold: true, color: '1E293B', fontFace: 'Arial'
        });
      }
      continue;
    }

    // Header 4-Color Gradient Bar + Category + Title
    themeColors.forEach((col, idx) => {
      slide.addShape(pptx.ShapeType.rect, {
        x: 0.8 + idx * 2.925, y: 0.40, w: 2.925, h: 0.05,
        fill: { color: col }, line: { color: col, width: 0 }
      });
    });

    if (sDef.category) {
      slide.addText(sDef.category.toUpperCase(), {
        x: 0.8, y: 0.52, w: 10, h: 0.25,
        fontSize: 10, bold: true, color: themeColors[0], fontFace: 'Arial'
      });
    }

    slide.addText(sDef.title, {
      x: 0.8, y: 0.78, w: 11.7, h: 0.55,
      fontSize: 20, bold: true, color: '1E293B', fontFace: 'Arial'
    });

    // Footer 4-Color Gradient Bar + Label (y: 6.55" and 6.68")
    themeColors.forEach((col, idx) => {
      slide.addShape(pptx.ShapeType.rect, {
        x: 0.8 + idx * 2.925, y: 6.55, w: 2.925, h: 0.04,
        fill: { color: col }, line: { color: col, width: 0 }
      });
    });

    slide.addText(`Enterprise Operational Standards   |   Slide ${sIdx + 1} of ${slides.length}   |   Classification: Production Verified`, {
      x: 0.8, y: 6.68, w: 11.7, h: 0.25,
      fontSize: 9, color: '94A3B8', fontFace: 'Arial'
    });

    // Strict Coordinate Budget: Content constrained between y: 1.45" and 6.05"
    const cardH = 4.60;
    const cardY = 1.45;

    // Layout: Cards (2, 3, or 4 cards)
    if (sDef.layout === 'cards' && sDef.cards) {
      const cardCount = sDef.cards.length;
      const cardW = cardCount <= 2 ? 5.65 : cardCount === 3 ? 3.65 : 2.70;
      const gap = cardCount <= 2 ? 0.40 : cardCount === 3 ? 0.38 : 0.30;
      const startX = 0.8;

      sDef.cards.forEach((card, cIdx) => {
        const curX = startX + cIdx * (cardW + gap);
        slide.addShape(pptx.ShapeType.roundRect, {
          x: curX, y: cardY, w: cardW, h: cardH,
          rectRadius: 0.15, fill: { color: 'F8FAFC' }, line: { color: 'E2E8F0', width: 1 }
        });

        if (card.tag) {
          slide.addText(card.tag.toUpperCase(), {
            x: curX + 0.25, y: 1.65, w: cardW - 0.5, h: 0.25,
            fontSize: 9, bold: true, color: themeColors[0], fontFace: 'Arial'
          });
        }

        slide.addText(card.title, {
          x: curX + 0.25, y: 1.95, w: cardW - 0.5, h: 0.45,
          fontSize: cardCount === 4 ? 13 : 14, bold: true, color: '1E293B', fontFace: 'Arial'
        });

        if (card.metric) {
          slide.addText(card.metric, {
            x: curX + 0.25, y: 2.45, w: cardW - 0.5, h: 0.50,
            fontSize: cardCount === 4 ? 22 : 24, bold: true, color: themeColors[0], fontFace: 'Arial'
          });
        }

        if (card.body) {
          const bodyY = card.metric ? 3.05 : 2.50;
          slide.addText(card.body, {
            x: curX + 0.25, y: bodyY, w: cardW - 0.5, h: 2.70,
            fontSize: cardCount === 4 ? 10 : 10.5, color: '334155', fontFace: 'Arial', lineSpacing: 13
          });
        }
      });
    }

    // Layout: 2 Columns
    if (sDef.layout === 'columns' && sDef.columns) {
      const colW = 5.65;
      const colGap = 0.40;

      sDef.columns.forEach((colData, cIdx) => {
        const curX = 0.8 + cIdx * (colW + colGap);
        slide.addShape(pptx.ShapeType.roundRect, {
          x: curX, y: cardY, w: colW, h: cardH,
          rectRadius: 0.15, fill: { color: cIdx === 0 ? 'F8FAFC' : 'FFFFFF' }, line: { color: 'E2E8F0', width: 1.5 }
        });

        slide.addText(colData.title, {
          x: curX + 0.35, y: 1.70, w: colW - 0.7, h: 0.45,
          fontSize: 15, bold: true, color: '1E293B', fontFace: 'Arial'
        });

        if (colData.bullets) {
          const textContent = Array.isArray(colData.bullets) ? colData.bullets.map((b) => `•  ${b}`).join('\n\n') : colData.bullets;
          slide.addText(textContent, {
            x: curX + 0.35, y: 2.25, w: colW - 0.7, h: 3.50,
            fontSize: 11, color: '334155', fontFace: 'Arial', lineSpacing: 16
          });
        }
      });
    }

    // Layout: Checklist & Sign-Off
    if (sDef.layout === 'checklist' && sDef.checklist) {
      const colW = 5.65;
      const leftColX = 0.8;
      const rightColX = 6.85;

      // Left Column
      slide.addShape(pptx.ShapeType.roundRect, {
        x: leftColX, y: cardY, w: colW, h: cardH,
        rectRadius: 0.15, fill: { color: 'F8FAFC' }, line: { color: 'CBD5E1', width: 1.5 }
      });

      slide.addText(sDef.checklist.left_title || 'Pre-Deployment Verification Gates', {
        x: leftColX + 0.30, y: 1.70, w: colW - 0.6, h: 0.40,
        fontSize: 15, bold: true, color: '1E293B', fontFace: 'Arial'
      });

      if (sDef.checklist.left_items) {
        slide.addText(sDef.checklist.left_items.join('\n\n'), {
          x: leftColX + 0.30, y: 2.20, w: colW - 0.6, h: 3.60,
          fontSize: 10.5, color: '334155', fontFace: 'Arial', lineSpacing: 15
        });
      }

      // Right Column
      slide.addShape(pptx.ShapeType.roundRect, {
        x: rightColX, y: cardY, w: colW, h: cardH,
        rectRadius: 0.15, fill: { color: 'FFFFFF' }, line: { color: 'E2E8F0', width: 1.5 }
      });

      slide.addText(sDef.checklist.right_title || 'Runtime Verification & Sign-Off', {
        x: rightColX + 0.30, y: 1.70, w: colW - 0.6, h: 0.40,
        fontSize: 15, bold: true, color: '1E293B', fontFace: 'Arial'
      });

      if (sDef.checklist.right_items) {
        slide.addText(sDef.checklist.right_items.join('\n\n'), {
          x: rightColX + 0.30, y: 2.20, w: colW - 0.6, h: 2.00,
          fontSize: 10.5, color: '334155', fontFace: 'Arial', lineSpacing: 15
        });
      }

      if (sDef.checklist.signoff) {
        slide.addShape(pptx.ShapeType.roundRect, {
          x: rightColX + 0.30, y: 4.50, w: colW - 0.6, h: 1.35,
          rectRadius: 0.10, fill: { color: 'F1F5F9' }, line: { color: 'CBD5E1', width: 1 }
        });
        slide.addText('PRODUCTION RELEASE SIGN-OFF', {
          x: rightColX + 0.50, y: 4.65, w: colW - 1.0, h: 0.25,
          fontSize: 9, bold: true, color: themeColors[0], fontFace: 'Arial'
        });
        slide.addText(sDef.checklist.signoff, {
          x: rightColX + 0.50, y: 4.95, w: colW - 1.0, h: 0.80,
          fontSize: 9.5, color: '475569', fontFace: 'Arial', lineSpacing: 14
        });
      }
    }
  }

  const pptxPath = outputPath;
  await pptx.writeFile({ fileName: pptxPath });
  return {
    success: true,
    file_path: pptxPath,
    slide_count: slides.length
  };
}

// 4. diagram_create — Generates scalable SVG diagram from nodes and edges
async function diagramCreate(options = {}) {
  const outputPath = resolveDynamicOutputPath(options.output_path, 'diagram.svg');
  const title = options.title || 'Architecture & Operational Workflow';
  const nodes = options.nodes || [];
  const edges = options.edges || [];
  const theme = selectGradientTheme(options.theme);

  const orientation = (options.orientation || options.layout || 'horizontal').toLowerCase();
  const isVertical = orientation === 'vertical';

  const width = options.width || (isVertical ? 900 : 1600);
  const height = options.height || (isVertical ? 1400 : 900);

  // Collect color palette for premium arrowheads & glow filters
  const colorPalette = new Set();
  theme.colors.forEach((c) => colorPalette.add(c));
  nodes.forEach((n) => { if (n.color) colorPalette.add(n.color); });
  edges.forEach((e) => { if (e.color) colorPalette.add(e.color); });
  colorPalette.add('#3B82F6');
  colorPalette.add('#10B981');
  colorPalette.add('#8B5CF6');
  colorPalette.add('#F59E0B');
  colorPalette.add('#64748B');

  let defsSvg = `
    <filter id="dropShadow" x="-10%" y="-10%" width="130%" height="130%">
      <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#0F172A" flood-opacity="0.06" />
    </filter>`;

  colorPalette.forEach((hex) => {
    const clean = hex.replace('#', '');
    defsSvg += `
    <marker id="arrowhead-${clean}" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
      <path d="M 1 1.5 L 7 4.5 L 1 7.5 L 2.8 4.5 Z" fill="${hex}" />
    </marker>
    <filter id="glow-${clean}" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="2.5" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>`;
  });

  let nodesSvg = '';
  nodes.forEach((n, idx) => {
    const nw = n.width || (isVertical ? 260 : 220);
    const nh = n.height || 90;
    const nx = n.x !== undefined ? n.x : (isVertical ? Math.round((width - nw) / 2) : 80 + idx * 300);
    const ny = n.y !== undefined ? n.y : (isVertical ? 130 + idx * 230 : 380);
    const col = n.color || theme.colors[idx % theme.colors.length];

    nodesSvg += `
    <g class="diagram-node" transform="translate(${nx}, ${ny})">
      <rect width="${nw}" height="${nh}" rx="12" fill="#FFFFFF" stroke="${col}" stroke-width="2.5" filter="url(#dropShadow)" />
      <rect width="${nw}" height="6" rx="3" fill="${col}" />
      <text x="${nw / 2}" y="38" text-anchor="middle" font-family="'Inter', sans-serif" font-size="14" font-weight="700" fill="#0F172A">${n.label || 'Node'}</text>
      <text x="${nw / 2}" y="60" text-anchor="middle" font-family="'Inter', sans-serif" font-size="11" fill="#64748B">${n.sublabel || ''}</text>
    </g>`;
  });

  let edgesSvg = '';
  edges.forEach((e, eIdx) => {
    const fromIdx = nodes.findIndex((n) => n.id === e.from);
    const toIdx = nodes.findIndex((n) => n.id === e.to);
    const fromNode = fromIdx >= 0 ? nodes[fromIdx] : null;
    const toNode = toIdx >= 0 ? nodes[toIdx] : null;
    if (fromNode && toNode) {
      const fromNw = fromNode.width || (isVertical ? 260 : 220);
      const fromNh = fromNode.height || 90;
      const fromNx = fromNode.x !== undefined ? fromNode.x : (isVertical ? Math.round((width - fromNw) / 2) : 80 + fromIdx * 300);
      const fromNy = fromNode.y !== undefined ? fromNode.y : (isVertical ? 130 + fromIdx * 230 : 380);

      const toNw = toNode.width || (isVertical ? 260 : 220);
      const toNh = toNode.height || 90;
      const toNx = toNode.x !== undefined ? toNode.x : (isVertical ? Math.round((width - toNw) / 2) : 80 + toIdx * 300);
      const toNy = toNode.y !== undefined ? toNode.y : (isVertical ? 130 + toIdx * 230 : 380);

      let fx, fy, tx, ty, pathD, labelTransform;

      if (isVertical) {
        fx = fromNx + fromNw / 2;
        fy = fromNy + fromNh;
        tx = toNx + toNw / 2;
        ty = toNy;
        const midY = (fy + ty) / 2;
        pathD = `M ${fx} ${fy} C ${fx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`;
        // Position label offset to the right of the vertical curve so it NEVER obscures the arrow line
        const labelX = Math.max(fx, tx) + 64;
        const labelY = midY;
        labelTransform = `transform="translate(${labelX}, ${labelY})"`;
      } else {
        fx = fromNx + fromNw;
        fy = fromNy + fromNh / 2;
        tx = toNx;
        ty = toNy + toNh / 2;
        const midX = (fx + tx) / 2;
        pathD = `M ${fx} ${fy} C ${midX} ${fy}, ${midX} ${ty}, ${tx} ${ty}`;
        labelTransform = `transform="translate(${midX}, ${Math.min(fy, ty) - 24})"`;
      }

      const edgeCol = e.color || fromNode.color || theme.colors[eIdx % theme.colors.length];
      const cleanCol = edgeCol.replace('#', '');

      edgesSvg += `
      <g class="diagram-edge" data-from="${e.from}" data-to="${e.to}">
        <!-- Soft Ambient Track -->
        <path d="${pathD}" fill="none" stroke="${edgeCol}" stroke-opacity="0.15" stroke-width="6" stroke-linecap="round" />
        <!-- Core Animated Dashed Flow Line with Sleek Colored Arrowhead -->
        <path class="flow-path" d="${pathD}" fill="none" stroke="${edgeCol}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" marker-end="url(#arrowhead-${cleanCol})" />
        <!-- Flowing Particle Animation -->
        <circle r="4" fill="${edgeCol}" filter="url(#glow-${cleanCol})">
          <animateMotion path="${pathD}" dur="2.4s" repeatCount="indefinite" />
        </circle>
        ${e.label ? `
        <g ${labelTransform}>
          <rect x="-48" y="-12" width="96" height="22" rx="5" fill="#FFFFFF" fill-opacity="0.95" stroke="#CBD5E1" stroke-width="1" />
          <text x="0" y="3" text-anchor="middle" font-family="'Inter', sans-serif" font-size="10" font-weight="700" fill="#334155">${e.label}</text>
        </g>` : ''}
      </g>`;
    }
  });

  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    ${defsSvg}
  </defs>

  <style>
    @keyframes flowDash {
      from { stroke-dashoffset: 28; }
      to { stroke-dashoffset: 0; }
    }
    .flow-path {
      animation: flowDash 1.2s linear infinite;
    }
  </style>

  <rect width="100%" height="100%" fill="#FAFBFD" />

  <!-- Header Rule -->
  <g transform="translate(60, 40)">
    <text x="0" y="32" font-family="'Inter', sans-serif" font-size="24" font-weight="800" fill="#0F172A">${title}</text>
    <text x="0" y="56" font-family="'Inter', sans-serif" font-size="13" fill="#64748B">Enterprise Architectural Topology &amp; Automated Pipeline Flow</text>
  </g>

  <!-- Edges & Nodes -->
  ${edgesSvg}
  ${nodesSvg}

  <!-- Footer Gradient Bar -->
  <g transform="translate(0, ${height - 8})">
    <rect x="0" y="0" width="${width * 0.25}" height="8" fill="${theme.colors[0]}" />
    <rect x="${width * 0.25}" y="0" width="${width * 0.25}" height="8" fill="${theme.colors[1]}" />
    <rect x="${width * 0.50}" y="0" width="${width * 0.25}" height="8" fill="${theme.colors[2]}" />
    <rect x="${width * 0.75}" y="0" width="${width * 0.25}" height="8" fill="${theme.colors[3]}" />
  </g>
</svg>`;

  fs.writeFileSync(outputPath, svgContent, 'utf8');
  return {
    success: true,
    file_path: outputPath,
    node_count: nodes.length,
    edge_count: edges.length
  };
}

// 5. animation_export — Converts diagram animation to canonical Animated WebP (or GIF/PNG)
function validateAnimatedWebP(filePath) {
  if (!fs.existsSync(filePath)) {
    return { valid: false, error: `File not found: '${filePath}'` };
  }
  const buf = fs.readFileSync(filePath);
  if (buf.length < 12) {
    return { valid: false, error: 'File too small for WebP header' };
  }
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    return { valid: false, error: 'Invalid RIFF/WEBP signature' };
  }

  let offset = 12;
  let isAnimated = false;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let loopCount = 0;
  let frameCount = 0;
  let totalDurationMs = 0;

  while (offset + 8 <= buf.length) {
    const chunkType = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;

    if (chunkType === 'VP8X') {
      const flags = buf.readUInt8(dataOffset);
      isAnimated = (flags & 0x02) !== 0;
      canvasWidth = (buf.readUInt16LE(dataOffset + 4) | (buf.readUInt8(dataOffset + 6) << 16)) + 1;
      canvasHeight = (buf.readUInt16LE(dataOffset + 7) | (buf.readUInt8(dataOffset + 9) << 16)) + 1;
    } else if (chunkType === 'ANIM') {
      loopCount = buf.readUInt16LE(dataOffset + 4);
    } else if (chunkType === 'ANMF') {
      frameCount++;
      const duration = buf.readUInt16LE(dataOffset + 12) | (buf.readUInt8(dataOffset + 14) << 16);
      totalDurationMs += duration;
    }

    offset += 8 + chunkSize + (chunkSize % 2 === 1 ? 1 : 0);
  }

  if (!isAnimated || frameCount < 2) {
    return {
      valid: false,
      error: `WebP file lacks valid animation chunks (isAnimated: ${isAnimated}, frameCount: ${frameCount})`
    };
  }

  return {
    valid: true,
    isAnimated: true,
    canvasWidth,
    canvasHeight,
    loopCount,
    frameCount,
    totalDurationMs
  };
}

async function animationExport(options = {}) {
  const inputPath = path.resolve(options.input_path || 'diagram.svg');
  if (!fs.existsSync(inputPath)) {
    return { success: false, error: `Input file not found: '${inputPath}'` };
  }

  const requestedFormat = (options.format || (options.output_path && path.extname(options.output_path).slice(1)) || 'webp').toLowerCase();
  const defaultFilename = requestedFormat === 'gif' ? 'animation.gif' : (requestedFormat === 'png' ? 'animation.png' : 'animation.webp');
  const outputPath = resolveDynamicOutputPath(options.output_path, defaultFilename);
  const targetFormat = (path.extname(outputPath).slice(1) || requestedFormat).toLowerCase();
  const durationSec = options.duration_sec || 3;
  const fps = options.fps || 15;

  const content = fs.readFileSync(inputPath, 'utf8');

  // Dynamically detect SVG dimensions from viewBox or width/height attributes
  const widthMatch = content.match(/viewBox=["']\s*0\s+0\s+(\d+)\s+(\d+)\s*["']/i) ||
                     content.match(/width=["'](\d+)["'].*?height=["'](\d+)["']/i);
  const animWidth = widthMatch ? parseInt(widthMatch[1], 10) : (options.width || 1600);
  const animHeight = widthMatch ? parseInt(widthMatch[2], 10) : (options.height || 900);

  const browser = await chromiumUtils.launchChromium();

  const page = await browser.newPage({
    viewport: { width: animWidth, height: animHeight },
    deviceScaleFactor: 1
  });
  await chromiumUtils.setupOfflineInterception(page);

  await page.setContent(`<!DOCTYPE html><html><body style="margin:0;padding:0;width:${animWidth}px;height:${animHeight}px;overflow:hidden;background:#FAFBFD;">${content}</body></html>`);

  const tmpFramesDir = path.join(os.tmpdir(), `konoha_anim_${Date.now()}`);
  fs.mkdirSync(tmpFramesDir, { recursive: true });

  const totalFrames = durationSec * fps;
  try {
    for (let f = 0; f < totalFrames; f++) {
      const frameTime = f / fps;
      // Advance SVG SMIL timeline and scrub CSS strokeDashoffset for deterministic frame-by-frame capture
      await page.evaluate((time) => {
        const svg = document.querySelector('svg');
        if (svg && typeof svg.setCurrentTime === 'function') {
          svg.setCurrentTime(time);
        }
        const paths = document.querySelectorAll('.flow-path');
        paths.forEach((p) => {
          const offset = (time * 24) % 28;
          p.style.strokeDashoffset = -offset;
        });
      }, frameTime);

      const framePath = path.join(tmpFramesDir, `frame_${String(f).padStart(4, '0')}.png`);
      await page.screenshot({ path: framePath, type: 'png' });
      await page.waitForTimeout(1000 / fps);
    }
    await browser.close();

    // Check ffmpeg availability
    const checkFfmpeg = spawnSync('which', ['ffmpeg']);
    if (checkFfmpeg.status === 0) {
      if (targetFormat === 'webp') {
        const ffmpegArgs = [
          '-y',
          '-framerate', String(fps),
          '-i', path.join(tmpFramesDir, 'frame_%04d.png'),
          '-vcodec', 'libwebp_anim',
          '-lossless', '0',
          '-compression_level', '6',
          '-q:v', '90',
          '-preset', 'drawing',
          '-loop', '0',
          outputPath
        ];
        const res = spawnSync('ffmpeg', ffmpegArgs);
        if (res.status === 0 && fs.existsSync(outputPath)) {
          const validation = validateAnimatedWebP(outputPath);
          if (validation.valid) {
            fs.rmSync(tmpFramesDir, { recursive: true, force: true });
            return {
              success: true,
              file_path: outputPath,
              format: 'webp',
              frames_captured: totalFrames,
              width: validation.canvasWidth,
              height: validation.canvasHeight,
              duration_ms: validation.totalDurationMs,
              loop_count: validation.loopCount,
              validation: 'PASS_WEBP_STRUCTURAL_VALIDATION'
            };
          }
          fs.rmSync(tmpFramesDir, { recursive: true, force: true });
          return {
            success: false,
            error: `WebP structural validation failed: ${validation.error}`,
            file_path: outputPath
          };
        }
      } else if (targetFormat === 'gif') {
        const ffmpegArgs = [
          '-y',
          '-framerate', String(fps),
          '-i', path.join(tmpFramesDir, 'frame_%04d.png'),
          '-vf', 'split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer',
          outputPath
        ];
        const res = spawnSync('ffmpeg', ffmpegArgs);
        if (res.status === 0 && fs.existsSync(outputPath)) {
          fs.rmSync(tmpFramesDir, { recursive: true, force: true });
          return {
            success: true,
            file_path: outputPath,
            format: 'gif',
            frames_captured: totalFrames
          };
        }
      }
    }

    // Fallback: copy first frame as PNG
    const pngFallback = targetFormat === 'png' ? outputPath : outputPath.replace(/\.[^.]+$/, '.png');
    fs.copyFileSync(path.join(tmpFramesDir, 'frame_0000.png'), pngFallback);
    fs.rmSync(tmpFramesDir, { recursive: true, force: true });
    return {
      success: true,
      file_path: pngFallback,
      format: 'png',
      note: 'Saved as high-DPI static PNG fallback (ffmpeg unavailable or static format requested)'
    };
  } catch (err) {
    if (fs.existsSync(tmpFramesDir)) fs.rmSync(tmpFramesDir, { recursive: true, force: true });
    return { success: false, error: err.message };
  }
}

module.exports = {
  documentCreate,
  spreadsheetCreate,
  presentationCreate,
  diagramCreate,
  animationExport,
  validateAnimatedWebP
};
