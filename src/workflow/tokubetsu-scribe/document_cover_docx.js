'use strict';

function renderDocxGradientTable(docxModule, colors) {
  const { Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, Paragraph } = docxModule;
  const borderNone = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };

  const cells = colors.map(colHex => {
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

function buildChipTable(docxModule, primaryColor, chipCategory) {
  const { Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, Paragraph, TextRun } = docxModule;
  const borderNone = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  return new Table({
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
                  new TextRun({ text: chipCategory, bold: true, size: 18, color: 'FFFFFF', font: 'Georgia' })
                ]
              })
            ]
          })
        ]
      })
    ]
  });
}

function buildMetaCell(docxModule, borderSubtle, label, value) {
  const { TableCell, WidthType, ShadingType, BorderStyle, Paragraph, TextRun } = docxModule;
  const borderNone = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
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

function buildMetadataTable(docxModule, primaryColor, metadata) {
  const { Table, TableRow, WidthType, BorderStyle } = docxModule;
  const borderLeft = { style: BorderStyle.SINGLE, size: 28, color: primaryColor };
  const borderSubtle = { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' };

  const author = metadata.author || 'Andy Setiyawan | Principal Infrastructure Architect';
  const classification = metadata.classification || 'Enterprise Standard (v1.0.0)';
  const dateStr = metadata.date || new Date().toISOString().split('T')[0];
  const compliance = metadata.compliance || 'Production Verified — Zero AI Artifacts';

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [4500, 4500],
    borders: {
      top: borderSubtle, bottom: borderSubtle, left: borderLeft, right: borderSubtle,
      insideH: borderSubtle, insideV: borderSubtle
    },
    rows: [
      new TableRow({
        children: [buildMetaCell(docxModule, borderSubtle, 'Author', author), buildMetaCell(docxModule, borderSubtle, 'Classification', classification)]
      }),
      new TableRow({
        children: [buildMetaCell(docxModule, borderSubtle, 'Date', dateStr), buildMetaCell(docxModule, borderSubtle, 'Status', compliance)]
      })
    ]
  });
}

function renderDocxNativeCover(docxModule, theme, metadata = {}) {
  const { Paragraph, TextRun, HeadingLevel } = docxModule;
  const primaryColor = theme.colors[0].replace('#', '');
  const elements = [];

  elements.push(new Paragraph({ text: '', spacing: { before: 7200 } }));

  const chipCategory = metadata.category || 'ENTERPRISE TECHNICAL STANDARD';
  elements.push(buildChipTable(docxModule, primaryColor, chipCategory));
  elements.push(new Paragraph({ text: '', spacing: { after: 200 } }));

  const title = metadata.title || 'Technical Architecture Specification';
  elements.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [
        new TextRun({ text: title, bold: true, size: 52, color: '0F172A', font: 'Georgia' })
      ],
      spacing: { before: 180, after: 120 }
    })
  );

  if (metadata.subtitle) {
    elements.push(
      new Paragraph({
        children: [
          new TextRun({ text: metadata.subtitle, italics: true, size: 24, color: '475569', font: 'Calibri' })
        ],
        spacing: { after: 240 }
      })
    );
  }

  elements.push(renderDocxGradientTable(docxModule, theme.colors));
  elements.push(new Paragraph({ text: '', spacing: { after: 320 } }));
  elements.push(buildMetadataTable(docxModule, primaryColor, metadata));
  elements.push(new Paragraph({ text: '', spacing: { after: 480 } }));

  return elements;
}

module.exports = {
  renderDocxGradientTable,
  buildChipTable,
  buildMetaCell,
  buildMetadataTable,
  renderDocxNativeCover
};
