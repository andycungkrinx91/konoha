'use strict';

const fs = require('fs');
const {
  renderCoverBackgroundArtworkPng,
  renderDocxGradientTable,
  renderDocxNativeCover
} = require('./document_cover');

function getDocx() {
  return require('docx');
}

async function createDocxDocument(options, context) {
  const {
    outputPath, title, subtitle, author, classification,
    dateStr, compliance, sections, theme, includeCover
  } = context;

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

module.exports = {
  createDocxDocument
};
