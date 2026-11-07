'use strict';

/**
 * Projection layout maths: type scale per card and the page-to-canvas fit.
 * Pure functions over plain geometry, kept apart from the SVG string builder.
 */

/** Pages authored at 1600x1000 (and the 1650/1169 variants) fit by height, so they get a
 *  tighter margin and a reserved band under the drawing for the caption. */
const WIDE_PAGE_MIN_WIDTH = 1300;
/** Wide pages are projected at 0.72: their type is drawn 0.93 the size so labels keep a
 *  width budget, which nets out to ~0.67 of the authored font on the output raster. */
const WIDE_TYPE_SCALE = 0.93;

function isWidePage(page) {
  return (page.pageWidth || page.width) >= WIDE_PAGE_MIN_WIDTH;
}

/**
 * Per-page projection frame: the canvas margin, the padding added to the drawing width
 * before fitting, the band reserved under the drawing for the caption, and the type scale.
 * The 1250x850 pages keep `{0.04, 48, 0, 1}`, which is the frozen 0.9216 projection.
 */
function projectionInsets(page) {
  if (isWidePage(page)) return { inset: 0.015, widthPad: 32, bottomCaption: 64, typeScale: WIDE_TYPE_SCALE };
  return { inset: 0.04, widthPad: 48, bottomCaption: 0, typeScale: 1 };
}

/** Kit type scale, kept small so dense pages never collide with their canvas. */
function cardType(box, id, typeScale = 1) {
  const roomy = box.h >= 76 && box.w >= 190;
  const medium = box.h >= 48;
  const base = (roomy ? 18 : medium ? 16.5 : 15) * typeScale;
  const detail = (roomy ? 15 : medium ? 14 : 13.5) * typeScale;
  const cap = Math.max(13, Math.min(box.h * 0.38, box.w * 0.14));
  // Narrow cells and fixed-label diamonds are width-bound: their type follows the
  // box width rather than the roomy height, so the label never overflows.
  const tight = /(?:check|router|gate|decision|cond)/i.test(String(id || '')) || box.w < 150;
  const title = tight ? Math.min(base, Math.max(13, Math.min(15, box.w / 6.2))) : Math.min(base, cap);
  return { title, detail: Math.min(detail, Math.max(13, cap - 1)) };
}

/** Uniform scale that fits a drawio page inside the output canvas (no clipping, no stretch). */
function fitScale(page, canvas, helpers) {
  const base = helpers.baseCanvas;
  const contentBoundsOf = helpers.contentBounds;
  const cw = canvas.width || base.width;
  const ch = canvas.height || base.height;
  const pw = page.pageWidth || page.width;
  const ph = page.pageHeight || page.height;
  const insets = projectionInsets(page);
  // The canvas margin keeps page edges (and the footer) off the canvas border; on wide
  // pages the caption band is reserved under the drawing instead.
  const inset = canvas.margin === undefined ? insets.inset : canvas.margin;
  const heightBudget = ch * (1 - inset) - insets.bottomCaption;
  // Cells may overhang the declared page width; the floor guarantees the drawing
  // still fits the canvas instead of bleeding off the right edge.
  const bounds = contentBoundsOf(page, helpers);
  const scale = Math.min((cw * (1 - inset)) / pw, heightBudget / ph);
  if (!bounds) return scale;
  return Math.min(scale, (cw * (1 - inset)) / (bounds.maxX - bounds.minX + insets.widthPad));
}

/**
 * Union of every cell box. Draw.io pages declare 1600x1000 but cells are often
 * authored wider (page 02 reaches x=1667), so fitting and centring must use the
 * drawing's own extents, not the nominal page frame.
 */
function contentBounds(page, helpers) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const pageHeight = page.pageHeight || page.height || 0;
  const vertices = page.vertices || [];
  const headingBottom = Math.max(0, ...vertices
    .filter((v) => v.box && helpers.isPageHeading(v, pageHeight))
    .map((v) => v.box.y + v.box.h));
  for (const vertex of vertices) {
    const box = vertex.box;
    if (!box) continue;
    // Cell fixtures without a label never pass the text-box test; skip heading checks safely.
    // Suppressed headings paint nothing, so they must not drag the centre.
    if (helpers.isPageHeading(vertex, pageHeight) || helpers.isPageSubheading(vertex, pageHeight, headingBottom)) continue;
    minX = Math.min(minX, box.x); minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.w); maxY = Math.max(maxY, box.y + box.h);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}


module.exports = {
  cardType,
  fitScale,
  contentBounds,
  projectionInsets,
  isWidePage,
  WIDE_PAGE_MIN_WIDTH,
  WIDE_TYPE_SCALE
};
