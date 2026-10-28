'use strict';

const { resolveDynamicOutputPath } = require('./document_engine_common');
const { selectGradientTheme, renderCoverArtworkPng } = require('./document_cover');

function getPptxGenJS() {
  return require('pptxgenjs');
}

async function _renderCoverSlide(slide, sDef, options, theme, pptx) {
  try {
    const coverBuffer = await renderCoverArtworkPng(theme, {
      title: sDef.title || pptx.title,
      subtitle: sDef.subtitle || pptx.subject,
      author: options.author || pptx.author,
      classification: options.classification || 'Enterprise Technical Standard',
      date: options.date || new Date().toISOString().split('T')[0],
      cover_model: options.cover_model
    }, true);

    slide.addImage({ data: 'image/png;base64,' + coverBuffer.toString('base64'), x: 0, y: 0, w: 13.33, h: 7.5 });
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
}

function _renderHeaderAndFooter(slide, sDef, slideInfo, themeColors, pptx) {
  const { sIdx, totalSlides } = slideInfo;
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

  themeColors.forEach((col, idx) => {
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.8 + idx * 2.925, y: 6.55, w: 2.925, h: 0.04,
      fill: { color: col }, line: { color: col, width: 0 }
    });
  });

  slide.addText(`Enterprise Operational Standards   |   Slide ${sIdx + 1} of ${totalSlides}   |   Classification: Production Verified`, {
    x: 0.8, y: 6.68, w: 11.7, h: 0.25,
    fontSize: 9, color: '94A3B8', fontFace: 'Arial'
  });
}

function _renderSingleCard(slide, card, cIdx, cfg, themeColors) {
  const curX = 0.8 + cIdx * (cfg.cardW + cfg.gap);
  slide.addShape(cfg.pptx.ShapeType.roundRect, {
    x: curX, y: cfg.cardY, w: cfg.cardW, h: cfg.cardH,
    rectRadius: 0.15, fill: { color: 'F8FAFC' }, line: { color: 'E2E8F0', width: 1 }
  });

  if (card.tag) {
    slide.addText(card.tag.toUpperCase(), {
      x: curX + 0.25, y: 1.65, w: cfg.cardW - 0.5, h: 0.25,
      fontSize: 9, bold: true, color: themeColors[0], fontFace: 'Arial'
    });
  }

  slide.addText(card.title, {
    x: curX + 0.25, y: 1.95, w: cfg.cardW - 0.5, h: 0.45,
    fontSize: cfg.cardCount === 4 ? 13 : 14, bold: true, color: '1E293B', fontFace: 'Arial'
  });

  if (card.metric) {
    slide.addText(card.metric, {
      x: curX + 0.25, y: 2.45, w: cfg.cardW - 0.5, h: 0.50,
      fontSize: cfg.cardCount === 4 ? 22 : 24, bold: true, color: themeColors[0], fontFace: 'Arial'
    });
  }

  if (card.body) {
    slide.addText(card.body, {
      x: curX + 0.25, y: card.metric ? 3.05 : 2.50, w: cfg.cardW - 0.5, h: 2.70,
      fontSize: cfg.cardCount === 4 ? 10 : 10.5, color: '334155', fontFace: 'Arial', lineSpacing: 13
    });
  }
}

function _renderCardsLayout(slide, sDef, themeColors, pptx) {
  const cardCount = sDef.cards.length;
  const cardW = cardCount <= 2 ? 5.65 : cardCount === 3 ? 3.65 : 2.70;
  const gap = cardCount <= 2 ? 0.40 : cardCount === 3 ? 0.38 : 0.30;
  const cfg = { cardCount, cardW, gap, cardY: 1.45, cardH: 4.60, pptx };

  sDef.cards.forEach((card, cIdx) => _renderSingleCard(slide, card, cIdx, cfg, themeColors));
}

function _renderColumnsLayout(slide, sDef, pptx) {
  const colW = 5.65;
  const colGap = 0.40;

  sDef.columns.forEach((colData, cIdx) => {
    const curX = 0.8 + cIdx * (colW + colGap);
    slide.addShape(pptx.ShapeType.roundRect, {
      x: curX, y: 1.45, w: colW, h: 4.60,
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

function _renderChecklistColumn(slide, col, isWhiteBg, pptx) {
  const { title, items, posX } = col;
  slide.addShape(pptx.ShapeType.roundRect, {
    x: posX, y: 1.45, w: 5.65, h: 4.60,
    rectRadius: 0.15, fill: { color: isWhiteBg ? 'FFFFFF' : 'F8FAFC' }, line: { color: isWhiteBg ? 'E2E8F0' : 'CBD5E1', width: 1.5 }
  });

  slide.addText(title, {
    x: posX + 0.30, y: 1.70, w: 5.05, h: 0.40,
    fontSize: 15, bold: true, color: '1E293B', fontFace: 'Arial'
  });

  if (items) {
    slide.addText(items.join('\n\n'), {
      x: posX + 0.30, y: 2.20, w: 5.05, h: isWhiteBg ? 2.00 : 3.60,
      fontSize: 10.5, color: '334155', fontFace: 'Arial', lineSpacing: 15
    });
  }
}

function _renderChecklistLayout(slide, sDef, themeColors, pptx) {
  const ch = sDef.checklist;
  _renderChecklistColumn(slide, { title: ch.left_title || 'Pre-Deployment Verification Gates', items: ch.left_items, posX: 0.8 }, false, pptx);
  _renderChecklistColumn(slide, { title: ch.right_title || 'Runtime Verification & Sign-Off', items: ch.right_items, posX: 6.85 }, true, pptx);

  if (ch.signoff) {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 7.15, y: 4.50, w: 5.05, h: 1.35,
      rectRadius: 0.10, fill: { color: 'F1F5F9' }, line: { color: 'CBD5E1', width: 1 }
    });
    slide.addText('PRODUCTION RELEASE SIGN-OFF', {
      x: 7.35, y: 4.65, w: 4.65, h: 0.25,
      fontSize: 9, bold: true, color: themeColors[0], fontFace: 'Arial'
    });
    slide.addText(ch.signoff, {
      x: 7.35, y: 4.95, w: 4.65, h: 0.80,
      fontSize: 9.5, color: '475569', fontFace: 'Arial', lineSpacing: 14
    });
  }
}

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

    if (sDef.layout === 'title' || (sIdx === 0 && !sDef.layout)) {
      await _renderCoverSlide(slide, sDef, options, theme, pptx);
      continue;
    }

    _renderHeaderAndFooter(slide, sDef, { sIdx, totalSlides: slides.length }, themeColors, pptx);

    if (sDef.layout === 'cards' && sDef.cards) _renderCardsLayout(slide, sDef, themeColors, pptx);
    if (sDef.layout === 'columns' && sDef.columns) _renderColumnsLayout(slide, sDef, pptx);
    if (sDef.layout === 'checklist' && sDef.checklist) _renderChecklistLayout(slide, sDef, themeColors, pptx);
  }

  await pptx.writeFile({ fileName: outputPath });
  return {
    success: true,
    file_path: outputPath,
    slide_count: slides.length
  };
}

module.exports = {
  presentationCreate
};
