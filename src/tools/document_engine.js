'use strict';

/**
 * src/tools/document_engine.js — Official Konoha Document Engineering Engine.
 *
 * Implements the 5 core document creation tools:
 * 1. document_create: Generates publication-grade DOCX (docx) or PDF (Playwright + HTML/CSS).
 * 2. spreadsheet_create: Generates executive XLSX (ExcelJS) with sheets, formulas, and formatting.
 * 3. presentation_create: Generates modern 16:9 widescreen PPTX (PptxGenJS) from specifications.
 * 4. diagram_create: Generates crisp, scalable SVG diagrams from structured nodes and edges.
 * 5. animation_export: Exports diagram or pipeline animations to high-quality GIF (Playwright + FFmpeg) or PNG.
 *
 * Pure Light Mode, Zero Watermarks, and Zero AI Slop invariants enforced throughout.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

// Optional lazy require helpers
function getDocx() {
  return require('docx');
}

function getExcelJS() {
  return require('exceljs');
}

function getPptxGenJS() {
  return require('pptxgenjs');
}

function getPlaywright() {
  return require('playwright');
}

/**
 * 1. document_create — Generates DOCX or PDF from structured content
 */
async function documentCreate(options = {}) {
  const outputPath = path.resolve(options.output_path || 'document.docx');
  const ext = path.extname(outputPath).toLowerCase();
  const format = (options.format || (ext === '.pdf' ? 'pdf' : 'docx')).toLowerCase();
  if (!['docx', 'pdf'].includes(format)) {
    return { success: false, error: `Unsupported document format '${format}'. Supported formats: 'docx', 'pdf'` };
  }
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const title = options.title || 'Executive Technical Report';
  const subtitle = options.subtitle || 'Architecture & Operational Framework';
  const author = options.author || 'Andy Setiyawan | Principal Architect';
  const classification = options.classification || 'Enterprise Technical Standard';
  const dateStr = options.date || new Date().toISOString().split('T')[0];
  const sections = options.sections || [];

  if (format === 'docx') {
    const {
      Document, Packer, Paragraph, TextRun, HeadingLevel, Table,
      TableRow, TableCell, WidthType, BorderStyle, ShadingType,
      Header, Footer, PageNumber
    } = getDocx();

    const children = [];

    // Title Block
    children.push(
      new Paragraph({
        text: title,
        heading: HeadingLevel.TITLE,
        spacing: { before: 240, after: 120 }
      })
    );

    if (subtitle) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: subtitle, italics: true, color: '64748B', size: 24 })
          ],
          spacing: { after: 240 }
        })
      );
    }

    // Metadata Card
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: 'Author: ', bold: true, color: '4F46E5', size: 20 }),
          new TextRun({ text: `${author}   |   `, size: 20, color: '334155' }),
          new TextRun({ text: 'Date: ', bold: true, color: '4F46E5', size: 20 }),
          new TextRun({ text: `${dateStr}   |   `, size: 20, color: '334155' }),
          new TextRun({ text: 'Classification: ', bold: true, color: '4F46E5', size: 20 }),
          new TextRun({ text: classification, size: 20, color: '334155' })
        ],
        spacing: { after: 360 }
      })
    );

    // Render Sections
    for (const sec of sections) {
      let hl = HeadingLevel.HEADING_1;
      if (sec.level === 2) hl = HeadingLevel.HEADING_2;
      if (sec.level === 3) hl = HeadingLevel.HEADING_3;

      children.push(
        new Paragraph({
          text: sec.title,
          heading: hl,
          spacing: { before: 360, after: 180 }
        })
      );

      // Paragraphs
      if (sec.paragraphs && Array.isArray(sec.paragraphs)) {
        for (const pText of sec.paragraphs) {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: pText, size: 22, color: '1E293B' })],
              spacing: { line: 276, before: 100, after: 140 }
            })
          );
        }
      }

      // Callout card
      if (sec.callout) {
        const borderLeft = { style: BorderStyle.SINGLE, size: 24, color: '4F46E5' };
        const borderNone = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            columnWidths: [9000],
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: 9000, type: WidthType.DXA },
                    shading: { type: ShadingType.CLEAR, fill: 'F8FAFC' },
                    borders: { left: borderLeft, top: borderNone, right: borderNone, bottom: borderNone },
                    margins: { top: 140, bottom: 140, left: 200, right: 200 },
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({ text: sec.callout.title || 'NOTE', bold: true, color: '4F46E5', size: 20 }),
                          new TextRun({ text: ` — ${sec.callout.text}`, size: 20, color: '334155' })
                        ]
                      })
                    ]
                  })
                ]
              })
            ]
          })
        );
        children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
      }

      // Table
      if (sec.table && sec.table.headers && sec.table.rows) {
        const colCount = sec.table.headers.length;
        const colWidthDxa = Math.floor(9000 / colCount);
        const colWidths = Array.from({ length: colCount }, () => colWidthDxa);

        const tableBorder = { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' };
        const tableBorders = { top: tableBorder, bottom: tableBorder, left: tableBorder, right: tableBorder, insideH: tableBorder, insideV: tableBorder };

        const headerRow = new TableRow({
          children: sec.table.headers.map((h) =>
            new TableCell({
              width: { size: colWidthDxa, type: WidthType.DXA },
              shading: { type: ShadingType.CLEAR, fill: 'F1F5F9' },
              margins: { top: 100, bottom: 100, left: 120, right: 120 },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: h, bold: true, size: 20, color: '1E293B' })]
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
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: String(cellText), size: 20, color: '334155' })]
                  })
                ]
              })
            )
          });
        });

        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            columnWidths: colWidths,
            borders: tableBorders,
            rows: [headerRow, ...dataRows]
          })
        );
        children.push(new Paragraph({ text: '', spacing: { after: 180 } }));
      }

      // Code Block
      if (sec.code && sec.code.snippet) {
        const codeLines = sec.code.snippet.split('\n');
        for (const cLine of codeLines) {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: cLine, font: 'JetBrains Mono', size: 18, color: '1E293B' })],
              spacing: { line: 240, before: 20, after: 20 }
            })
          );
        }
        children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
      }
    }

    const doc = new Document({
      creator: author,
      title,
      description: subtitle,
      styles: {
        default: {
          document: {
            run: { font: 'Inter', size: 22, color: '1E293B' }
          }
        }
      },
      sections: [
        {
          properties: {
            page: {
              margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 }
            }
          },
          headers: {
            default: new Header({
              children: [
                new Paragraph({
                  children: [new TextRun({ text: title, size: 16, color: '94A3B8' })],
                  alignment: 'right'
                })
              ]
            })
          },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: `${classification}   |   Page `, size: 16, color: '94A3B8' }),
                    new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '94A3B8' }),
                    new TextRun({ text: ' of ', size: 16, color: '94A3B8' }),
                    new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '94A3B8' })
                  ],
                  alignment: 'center'
                })
              ]
            })
          },
          children
        }
      ]
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

  // format === 'pdf' via Playwright + HTML/CSS
  const playwright = getPlaywright();
  const browser = await playwright.chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Build clean executive HTML
  let htmlSections = '';
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    let secContent = `<div class="section-block"><h2>${sec.title}</h2>`;

    if (sec.paragraphs) {
      for (const p of sec.paragraphs) {
        secContent += `<p>${p}</p>`;
      }
    }

    if (sec.callout) {
      secContent += `
        <div class="callout callout-${sec.callout.type || 'note'}">
          <strong>${sec.callout.title || 'NOTE'}</strong>
          <span>${sec.callout.text}</span>
        </div>`;
    }

    if (sec.table && sec.table.headers && sec.table.rows) {
      secContent += `<table class="data-table"><thead><tr>`;
      for (const h of sec.table.headers) secContent += `<th>${h}</th>`;
      secContent += `</tr></thead><tbody>`;
      for (const row of sec.table.rows) {
        secContent += `<tr>`;
        for (const cell of row) secContent += `<td>${cell}</td>`;
        secContent += `</tr>`;
      }
      secContent += `</tbody></table>`;
    }

    if (sec.code && sec.code.snippet) {
      secContent += `<pre><code>${sec.code.snippet.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
    }

    secContent += `</div>`;
    htmlSections += secContent;
  }

  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
  @page {
    size: A4;
    margin: 20mm 15mm 20mm 15mm;
    @top-right {
      content: "${title}";
      font-family: 'Inter', sans-serif;
      font-size: 8pt;
      color: #94A3B8;
    }
    @bottom-center {
      content: "${classification} | Page " counter(page) " of " counter(pages);
      font-family: 'Inter', sans-serif;
      font-size: 8pt;
      color: #94A3B8;
    }
  }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    color: #1E293B;
    background: #FFFFFF;
    line-height: 1.6;
    font-size: 10.5pt;
    margin: 0;
    padding: 0;
  }
  .cover-card {
    background: linear-gradient(135deg, #DBCCD0 0%, #C2C0D6 25%, #AAC2D8 50%, #B0D5D8 75%, #C5D7C2 100%);
    border-radius: 16px;
    padding: 40px;
    margin-bottom: 30px;
    border: 1px solid rgba(255,255,255,0.6);
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05);
  }
  .cover-badge {
    display: inline-block;
    background: #4F46E5;
    color: #FFFFFF;
    font-weight: 700;
    font-size: 8pt;
    padding: 4px 12px;
    border-radius: 20px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 16px;
  }
  .cover-title {
    font-size: 26pt;
    font-weight: 800;
    color: #1E293B;
    line-height: 1.2;
    margin: 0 0 12px 0;
  }
  .cover-subtitle {
    font-size: 13pt;
    color: #475569;
    margin: 0 0 24px 0;
    font-weight: 500;
  }
  .cover-meta {
    display: flex;
    gap: 20px;
    font-size: 9pt;
    color: #475569;
    border-top: 1px solid rgba(255,255,255,0.7);
    padding-top: 16px;
  }
  h2 {
    font-size: 15pt;
    font-weight: 700;
    color: #1E293B;
    border-bottom: 2px solid #EEF2FF;
    padding-bottom: 6px;
    margin-top: 28px;
    margin-bottom: 14px;
    page-break-after: avoid;
  }
  p {
    margin: 0 0 12px 0;
    color: #334155;
    text-align: justify;
  }
  .callout {
    background: #F8FAFC;
    border-left: 4px solid #4F46E5;
    padding: 12px 16px;
    border-radius: 4px;
    margin: 16px 0;
    font-size: 9.5pt;
  }
  .callout strong {
    color: #4F46E5;
    display: block;
    margin-bottom: 4px;
  }
  table.data-table {
    width: 100%;
    border-collapse: collapse;
    margin: 18px 0;
    font-size: 9pt;
  }
  table.data-table th {
    background: #F1F5F9;
    color: #1E293B;
    font-weight: 700;
    text-align: left;
    padding: 8px 12px;
    border: 1px solid #E2E8F0;
  }
  table.data-table td {
    padding: 7px 12px;
    border: 1px solid #E2E8F0;
    color: #334155;
  }
  table.data-table tr:nth-child(even) td {
    background: #F8FAFC;
  }
  pre {
    background: #F8FAFC;
    border: 1px solid #E2E8F0;
    border-radius: 6px;
    padding: 12px;
    overflow-x: auto;
    font-family: 'JetBrains Mono', monospace;
    font-size: 8.5pt;
    line-height: 1.45;
    margin: 14px 0;
    color: #0F172A;
  }
</style>
</head>
<body>
  <div class="cover-card">
    <div class="cover-badge">${classification}</div>
    <h1 class="cover-title">${title}</h1>
    <div class="cover-subtitle">${subtitle}</div>
    <div class="cover-meta">
      <div><strong>Author:</strong> ${author}</div>
      <div><strong>Date:</strong> ${dateStr}</div>
      <div><strong>Status:</strong> Verified Production Standard</div>
    </div>
  </div>
  ${htmlSections}
</body>
</html>`;

  await page.setContent(fullHtml, { waitUntil: 'networkidle' });
  const pdfBuffer = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' }
  });

  await browser.close();
  fs.writeFileSync(outputPath, pdfBuffer);

  return {
    success: true,
    file_path: outputPath,
    format: 'pdf',
    bytes: pdfBuffer.length
  };
}

/**
 * 2. spreadsheet_create — Generates XLSX with sheets, formulas, and styling
 */
async function spreadsheetCreate(options = {}) {
  const outputPath = path.resolve(options.output_path || 'spreadsheet.xlsx');
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const ExcelJS = getExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = options.author || 'Andy Setiyawan | Principal Architect';
  workbook.lastModifiedBy = options.author || 'Andy Setiyawan | Principal Architect';
  workbook.created = new Date();
  workbook.modified = new Date();

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

  for (const sheetDef of sheets) {
    const sheet = workbook.addWorksheet(sheetDef.name, {
      views: [{ showGridLines: true, state: 'frozen', ySplit: sheetDef.title ? 4 : 1 }]
    });

    let currentRow = 1;

    // Optional Title Banner
    if (sheetDef.title) {
      sheet.mergeCells(`A${currentRow}:E${currentRow}`);
      const titleCell = sheet.getCell(`A${currentRow}`);
      titleCell.value = sheetDef.title;
      titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF1E293B' } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      currentRow++;

      if (sheetDef.subtitle) {
        sheet.mergeCells(`A${currentRow}:E${currentRow}`);
        const subCell = sheet.getCell(`A${currentRow}`);
        subCell.value = sheetDef.subtitle;
        subCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF64748B' } };
        currentRow++;
      }
      currentRow++; // blank row
    }

    // Headers
    const headerRowIdx = currentRow;
    const headers = sheetDef.headers || [];
    const headerRow = sheet.getRow(headerRowIdx);
    headerRow.values = headers;
    headerRow.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1E293B' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    headerRow.height = 24;

    currentRow++;

    // Data Rows
    const rows = sheetDef.rows || [];
    for (let rIdx = 0; rIdx < rows.length; rIdx++) {
      const rowData = rows[rIdx];
      const row = sheet.getRow(currentRow);
      row.values = rowData;
      row.font = { name: 'Calibri', size: 11, color: { argb: 'FF334155' } };

      // Zebra stripes
      if (rIdx % 2 === 1) {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      }
      row.height = 20;
      currentRow++;
    }

    // Summary Row with uppercase formulas
    if (sheetDef.summary) {
      const sumRow = sheet.getRow(currentRow);
      sumRow.values = sheetDef.summary;
      sumRow.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1E293B' } };
      sumRow.border = {
        top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'double', color: { argb: 'FF64748B' } }
      };
      currentRow++;
    }

    // Auto-fit column widths
    sheet.columns.forEach((col, idx) => {
      let maxLen = 14;
      if (headers[idx]) maxLen = Math.max(maxLen, String(headers[idx]).length + 4);
      col.width = maxLen;
    });
  }

  await workbook.xlsx.writeFile(outputPath);
  return {
    success: true,
    file_path: outputPath,
    sheet_count: sheets.length
  };
}

/**
 * 3. presentation_create — Generates PPTX from outline & slide specifications
 */
async function presentationCreate(options = {}) {
  const outputPath = path.resolve(options.output_path || 'presentation.pptx');
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const PptxGenJS = getPptxGenJS();
  const pptx = new PptxGenJS();

  // 16:9 widescreen layout
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = options.author || 'Andy Setiyawan | Principal Architect';
  pptx.company = 'Enterprise Engineering';
  pptx.title = options.title || 'DevOps Basic Fundamentals';
  pptx.subject = options.subtitle || options.title || 'Technical Architecture Presentation';

  const slides = options.slides || [];

  for (const sDef of slides) {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };

    // Header banner on every slide except title layout
    if (sDef.layout !== 'title') {
      slide.addShape(pptx.ShapeType.rect, {
        x: 0.8, y: 0.5, w: 11.7, h: 0.05, fill: { color: '4F46E5' }
      });

      if (sDef.category) {
        slide.addText(sDef.category.toUpperCase(), {
          x: 0.8, y: 0.65, w: 10, h: 0.3,
          fontSize: 10, bold: true, color: '4F46E5', fontFace: 'Arial'
        });
      }

      slide.addText(sDef.title, {
        x: 0.8, y: 0.9, w: 11.7, h: 0.6,
        fontSize: 22, bold: true, color: '1E293B', fontFace: 'Arial'
      });
    }

    if (sDef.layout === 'title') {
      // Hero Card with pastel gradient simulation
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 1.0, y: 1.2, w: 11.33, h: 5.0,
        rectRadius: 0.2,
        fill: { color: 'F1F5F9' },
        line: { color: 'CBD5E1', width: 1.5 }
      });

      slide.addShape(pptx.ShapeType.roundRect, {
        x: 1.5, y: 1.8, w: 2.2, h: 0.4,
        rectRadius: 0.1,
        fill: { color: '4F46E5' }
      });

      slide.addText(sDef.category || 'ENTERPRISE STANDARD', {
        x: 1.5, y: 1.8, w: 2.2, h: 0.4,
        fontSize: 10, bold: true, color: 'FFFFFF', align: 'center', fontFace: 'Arial'
      });

      slide.addText(sDef.title, {
        x: 1.5, y: 2.4, w: 10.0, h: 1.2,
        fontSize: 32, bold: true, color: '1E293B', fontFace: 'Arial'
      });

      if (sDef.subtitle) {
        slide.addText(sDef.subtitle, {
          x: 1.5, y: 3.7, w: 10.0, h: 0.6,
          fontSize: 16, color: '475569', fontFace: 'Arial'
        });
      }

      slide.addText(`Author: ${options.author || 'Andy Setiyawan'}   |   Version 1.0.0   |   Production Verified`, {
        x: 1.5, y: 5.2, w: 10.0, h: 0.4,
        fontSize: 11, color: '64748B', fontFace: 'Arial'
      });
    } else if (sDef.layout === 'cards' && sDef.cards) {
      const cardCount = sDef.cards.length;
      const cardW = cardCount <= 2 ? 5.5 : cardCount === 3 ? 3.6 : 2.7;
      const startX = 0.8;
      const gap = 0.3;

      sDef.cards.forEach((card, cIdx) => {
        const curX = startX + cIdx * (cardW + gap);
        slide.addShape(pptx.ShapeType.roundRect, {
          x: curX, y: 1.8, w: cardW, h: 4.8,
          rectRadius: 0.15,
          fill: { color: 'F8FAFC' },
          line: { color: 'E2E8F0', width: 1 }
        });

        if (card.tag) {
          slide.addText(card.tag.toUpperCase(), {
            x: curX + 0.3, y: 2.1, w: cardW - 0.6, h: 0.3,
            fontSize: 9, bold: true, color: '4F46E5', fontFace: 'Arial'
          });
        }

        slide.addText(card.title, {
          x: curX + 0.3, y: 2.4, w: cardW - 0.6, h: 0.6,
          fontSize: 15, bold: true, color: '1E293B', fontFace: 'Arial'
        });

        if (card.metric) {
          slide.addText(card.metric, {
            x: curX + 0.3, y: 3.1, w: cardW - 0.6, h: 0.7,
            fontSize: 26, bold: true, color: '4F46E5', fontFace: 'Arial'
          });
        }

        slide.addText(card.body, {
          x: curX + 0.3, y: card.metric ? 3.9 : 3.2, w: cardW - 0.6, h: 2.4,
          fontSize: 11, color: '334155', fontFace: 'Arial', lineSpacing: 18
        });
      });
    } else if (sDef.layout === 'comparison' && sDef.columns) {
      const colW = 5.6;
      sDef.columns.forEach((col, cIdx) => {
        const curX = 0.8 + cIdx * (colW + 0.5);
        slide.addShape(pptx.ShapeType.roundRect, {
          x: curX, y: 1.8, w: colW, h: 4.8,
          rectRadius: 0.15,
          fill: { color: cIdx === 0 ? 'F8FAFC' : 'FFFFFF' },
          line: { color: cIdx === 0 ? 'CBD5E1' : 'E2E8F0', width: 1.5 }
        });

        slide.addText(col.title, {
          x: curX + 0.4, y: 2.1, w: colW - 0.8, h: 0.5,
          fontSize: 16, bold: true, color: '1E293B', fontFace: 'Arial'
        });

        const itemsText = (col.items || []).map((it) => `•  ${it}`).join('\n\n');
        slide.addText(itemsText, {
          x: curX + 0.4, y: 2.8, w: colW - 0.8, h: 3.5,
          fontSize: 12, color: '334155', fontFace: 'Arial', lineSpacing: 22
        });
      });
    }
  }

  await pptx.writeFile({ fileName: outputPath });
  return {
    success: true,
    file_path: outputPath,
    slide_count: slides.length
  };
}

/**
 * 4. diagram_create — Generates crisp SVG from structured nodes and edges
 */
async function diagramCreate(options = {}) {
  const outputPath = path.resolve(options.output_path || 'diagram.svg');
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const width = options.width || 1600;
  const height = options.height || 900;
  const title = options.title || 'DevOps Architecture Lifecycle';
  const nodes = options.nodes || [];
  const edges = options.edges || [];
  const groups = options.groups || [];

  let groupsSvg = '';
  for (const g of groups) {
    groupsSvg += `
      <g class="diagram-group">
        <rect x="${g.x}" y="${g.y}" width="${g.width}" height="${g.height}" rx="12" fill="#F8FAFC" stroke="#E2E8F0" stroke-width="1.5" stroke-dasharray="6,4" />
        <text x="${g.x + 20}" y="${g.y + 30}" font-family="Inter, sans-serif" font-size="13" font-weight="700" fill="#64748B" letter-spacing="0.05em">${g.label.toUpperCase()}</text>
      </g>`;
  }

  let edgesSvg = '';
  for (const e of edges) {
    const fromNode = nodes.find((n) => n.id === e.from);
    const toNode = nodes.find((n) => n.id === e.to);
    if (fromNode && toNode) {
      const x1 = fromNode.x + (fromNode.width || 180) / 2;
      const y1 = fromNode.y + (fromNode.height || 80) / 2;
      const x2 = toNode.x + (toNode.width || 180) / 2;
      const y2 = toNode.y + (toNode.height || 80) / 2;

      edgesSvg += `
        <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#94A3B8" stroke-width="2" marker-end="url(#arrow)" ${e.style === 'dashed' ? 'stroke-dasharray="6,4"' : ''} />`;
      if (e.label) {
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2 - 8;
        edgesSvg += `
          <text x="${mx}" y="${my}" font-family="Inter, sans-serif" font-size="11" fill="#64748B" text-anchor="middle" background="#FFFFFF">${e.label}</text>`;
      }
    }
  }

  let nodesSvg = '';
  for (const n of nodes) {
    const nw = n.width || 200;
    const nh = n.height || 85;
    const color = n.color || '#4F46E5';

    nodesSvg += `
      <g class="diagram-node" transform="translate(${n.x}, ${n.y})">
        <rect width="${nw}" height="${nh}" rx="10" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="1.5" filter="url(#shadow)" />
        <rect x="0" y="0" width="6" height="${nh}" rx="3" fill="${color}" />
        <text x="20" y="32" font-family="Inter, sans-serif" font-size="14" font-weight="700" fill="#1E293B">${n.label}</text>
        ${n.sublabel ? `<text x="20" y="54" font-family="Inter, sans-serif" font-size="11" fill="#64748B">${n.sublabel}</text>` : ''}
      </g>`;
  }

  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <filter id="shadow" x="-5%" y="-5%" width="115%" height="115%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000000" flood-opacity="0.04" />
    </filter>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="#94A3B8" />
    </marker>
  </defs>
  <rect width="100%" height="100%" fill="#FFFFFF" />
  
  <!-- Header Banner -->
  <text x="50" y="65" font-family="Inter, sans-serif" font-size="24" font-weight="800" fill="#1E293B">${title}</text>
  <text x="50" y="92" font-family="Inter, sans-serif" font-size="13" fill="#64748B">Enterprise Production Engineering Architecture Specification</text>
  <line x1="50" y1="115" x2="${width - 50}" y2="115" stroke="#E2E8F0" stroke-width="1.5" />

  <!-- Groups -->
  ${groupsSvg}

  <!-- Edges -->
  ${edgesSvg}

  <!-- Nodes -->
  ${nodesSvg}
</svg>`;

  fs.writeFileSync(outputPath, svgContent, 'utf8');
  return {
    success: true,
    file_path: outputPath,
    node_count: nodes.length,
    edge_count: edges.length
  };
}

/**
 * 5. animation_export — Exports diagram or pipeline animation to GIF or PNG
 */
async function animationExport(options = {}) {
  const outputPath = path.resolve(options.output_path || 'animation.gif');
  const ext = path.extname(outputPath).toLowerCase();
  const format = (options.format || (ext === '.png' ? 'png' : 'gif')).toLowerCase();
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const width = options.width || 1200;
  const height = options.height || 675;
  const durationMs = options.duration_ms || 3000;
  const fps = options.fps || 15;
  const totalFrames = Math.round((durationMs / 1000) * fps);

  let htmlContent = options.html_content;
  if (!htmlContent && options.input_path) {
    const inputPath = path.resolve(options.input_path);
    if (!fs.existsSync(inputPath)) {
      return { success: false, error: `Input file not found: ${options.input_path}` };
    }
    const raw = fs.readFileSync(inputPath, 'utf8');
    if (inputPath.endsWith('.svg')) {
      htmlContent = `<!DOCTYPE html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#FFFFFF;">${raw}</body></html>`;
    } else {
      htmlContent = raw;
    }
  }

  const playwright = getPlaywright();
  const browser = await playwright.chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage({ viewport: { width, height } });

  if (!htmlContent) {
    htmlContent = `
<!DOCTYPE html>
<html>
<head>
<style>
  body { margin: 0; background: #FFFFFF; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; }
  .box { width: 100px; height: 100px; background: #4F46E5; border-radius: 12px; }
</style>
</head>
<body>
  <div class="box" id="box"></div>
  <script>
    window.setFrame = (progress) => {
      const box = document.getElementById('box');
      box.style.transform = 'translateX(' + (progress * 400 - 200) + 'px) rotate(' + (progress * 360) + 'deg)';
    };
  </script>
</body>
</html>`;
  }

  await page.setContent(htmlContent);

  if (format === 'png') {
    await page.screenshot({ path: outputPath });
    await browser.close();
    return { success: true, file_path: outputPath, format: 'png' };
  }

  // format === 'gif': capture frames and encode with ffmpeg
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-anim-'));

  try {
    for (let f = 0; f < totalFrames; f++) {
      const progress = f / Math.max(1, totalFrames - 1);
      await page.evaluate((prog) => {
        if (typeof window.setFrame === 'function') {
          window.setFrame(prog);
        }
      }, progress);

      const framePath = path.join(tmpDir, `frame_${String(f).padStart(3, '0')}.png`);
      await page.screenshot({ path: framePath });
    }
    await browser.close();

    // Call ffmpeg with 2-pass palette generation for ultra-clean GIF
    const ffmpegRes = spawnSync('ffmpeg', [
      '-framerate', String(fps),
      '-i', path.join(tmpDir, 'frame_%03d.png'),
      '-filter_complex', '[0:v] split [a][b];[a] palettegen=stats_mode=single [p];[b][p] paletteuse=dither=bayer',
      '-y', outputPath
    ], { encoding: 'utf8' });

    if (ffmpegRes.status !== 0) {
      throw new Error(`FFmpeg failed: ${ffmpegRes.stderr}`);
    }

    return {
      success: true,
      file_path: outputPath,
      format: 'gif',
      frames: totalFrames,
      bytes: fs.statSync(outputPath).size
    };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {
      /* intentional best-effort directory cleanup */
    }
  }
}

module.exports = {
  documentCreate,
  spreadsheetCreate,
  presentationCreate,
  diagramCreate,
  animationExport
};
