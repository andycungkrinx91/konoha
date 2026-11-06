#!/usr/bin/env node
/**
 * Style lock for the drawio-derived `konoha-*.webp` workflow diagrams.
 *
 * The diagrams are generated from `docs/diagrams/*.drawio` by
 * `scripts/generate_drawio_flow_webp.js` via `scripts/lib/drawio_flow_svg.js`.
 * The drawio files own the topology (boxes, routing, colours); the renderer only
 * projects them onto one fixed visual grammar:
 *
 *   · 1250x850 page at scale 0.96 -> 1200x816 CSS -> 2400x1632 device pixels
 *   · vector-only shapes (no raster embeds), one reveal group per drawio cell
 *   · labels condensed for readability but never above the character cap
 *   · orthogonal connectors with rounded turns
 *   · exactly one `◈ <agent>` tag per process card that owns an agent
 *
 * Future work may change a page's CONTENT (drawio is the source of truth) but never
 * this DESIGN, and may never drop a drawio cell from the projection. If this test
 * fails, revert the style change — do not relax the assertion.
 */
'use strict';

const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  CANVAS,
  CANVAS_SCALE_1250,
  CANONICAL_NAMES,
  assetNameFor,
  fitScale,
  svgForPage
} = require('../scripts/lib/drawio_flow_svg.js');
const { loadDrawioCorpus } = require('../scripts/lib/drawio_pages.js');

console.log('Running test_flow_diagram_style_lock.js...');

// ── 1. Frozen grammar constants ──────────────────────────────────────────
const STYLE_LOCK = Object.freeze({
  canvas: Object.freeze({ width: 1200, height: 816 }),
  // The QA-idiom pages are authored on a 1250x850 drawio page and project at exactly 0.96;
  // the broader corpus has 1600x1000 / 1169x827 / 1200x850 pages that fit by scale.
  page: Object.freeze({ width: 1250, height: 850 }),
  uniformScale: 0.9216,
  deviceScale: 2,
  maxLabelChars: 118,
  maxEdgeLabelChars: 24,
  minSharpSegmentPx: 3,
  pages: 19,
  // Names that published docs and README captions already point at.
  stableAssets: Object.freeze([
    'konoha-akatsuki-flow.webp',
    'konoha-jonin-flow.webp',
    'konoha-kage-gate.webp',
    'konoha-langgraph-flow.webp',
    'konoha-orchestration-flow.webp',
    'konoha-qa-flow.webp',
    'konoha-telegram-flow.webp',
    'konoha-web-ingress-flow.webp',
    'konoha-yamanaka-3d-flow.webp'
  ])
});

assert.deepStrictEqual(
  { width: CANVAS.width, height: CANVAS.height },
  { width: STYLE_LOCK.canvas.width, height: STYLE_LOCK.canvas.height },
  'CANVAS must stay 1200x816 CSS pixels'
);
assert.strictEqual(CANVAS_SCALE_1250, STYLE_LOCK.uniformScale, 'the legacy 1250x850 projection scale must stay 0.9216 (0.96 canvas fit less the 4% margin)');
assert.strictEqual(fitScale(STYLE_LOCK.page, CANVAS), STYLE_LOCK.uniformScale,
  'a 1250x850 page must still fit the canvas at exactly 0.9216 (no resize of the published seven)');
console.log(`  ✓ Frozen canvas: ${STYLE_LOCK.canvas.width}x${STYLE_LOCK.canvas.height} CSS -> `
  + `${STYLE_LOCK.canvas.width * STYLE_LOCK.deviceScale}x${STYLE_LOCK.canvas.height * STYLE_LOCK.deviceScale} device; `
  + `legacy ${STYLE_LOCK.page.width}x${STYLE_LOCK.page.height} page at ${STYLE_LOCK.uniformScale}.`);

// ── 2. One asset per drawio tab, stable names preserved ──────────────────
const corpus = loadDrawioCorpus();
const pages = [...corpus.architecture];
const ingress = corpus.enterprise.find((p) => p.name === '19 Authenticated Local Web UI & Ingress Queue');
assert.ok(ingress, 'enterprise drawio must still carry the local web ingress page');
pages.push(ingress);
assert.strictEqual(corpus.architecture.length, 18, 'architecture drawio must have 18 pages');
assert.strictEqual(corpus.enterprise.length, 18, 'enterprise drawio must have 18 pages');
assert.strictEqual(pages.length, STYLE_LOCK.pages, `union of drawio tabs must be ${STYLE_LOCK.pages} diagrams, found ${pages.length}`);

const assets = pages.map((page) => assetNameFor(page));
const uniqueAssets = new Set(assets);
assert.strictEqual(uniqueAssets.size, assets.length, `every drawio tab needs its own asset name, found duplicates in: ${assets.join(', ')}`);
for (const name of assets) assert.ok(/^konoha-[a-z0-9-]+\.webp$/.test(name), `asset name must be a konoha-*.webp file, got ${name}`);
assert.ok(!assets.some((name) => name.endsWith('.gif')), 'animated GIF is forbidden — WebP only');
for (const stable of STYLE_LOCK.stableAssets) assert.ok(uniqueAssets.has(stable), `stable asset name drifted: ${stable}`);
assert.strictEqual(Object.keys(CANONICAL_NAMES).length, STYLE_LOCK.stableAssets.length,
  'CANONICAL_NAMES must map exactly the documented stable assets');
console.log(`  ✓ ${pages.length} drawio tabs -> ${assets.length} unique konoha-*.webp names; ${STYLE_LOCK.stableAssets.length} documented names stable.`);

// ── 3. Per-page projection grammar ──────────────────────────────────────
const count = (svg, re) => (svg.match(re) || []).length;
const decodeText = (value) => value
  .replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');

/**
 * A path whose direction changes between two *visible* straight runs must have been rounded
 * with a quadratic join. Connector jogs shorter than `minSharpSegmentPx` (drawio endpoints that
 * differ by 1-2 units along one axis) cannot carry a radius and are invisible at output scale,
 * so they are exempt instead of being forced through a fake curve.
 */
function hasUnroundedTurn(d, minSharpSegmentPx = STYLE_LOCK.minSharpSegmentPx) {
  const tokens = d.match(/[MLQC][^MLQC]*/g) || [];
  let previous = null;
  let turning = false;
  for (const token of tokens) {
    const nums = (token.slice(1).match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    if (token[0] === 'M' || token[0] === 'L') {
      const point = { x: nums[0], y: nums[1] };
      if (previous) {
        const dx = Math.sign(Math.round(point.x - previous.x));
        const dy = Math.sign(Math.round(point.y - previous.y));
        const segment = Math.hypot(point.x - previous.x, point.y - previous.y);
        const visible = previous.segment === undefined || Math.min(segment, previous.segment) >= minSharpSegmentPx;
        if (previous.dir && (previous.dir.x !== dx || previous.dir.y !== dy) && visible) turning = true;
        previous = { ...point, dir: { x: dx, y: dy }, segment };
      } else {
        previous = { ...point, dir: null };
      }
    } else if (token[0] === 'Q' || token[0] === 'C') {
      previous = null;
    }
  }
  return turning && !d.includes('Q');
}

/** Text of each rendered line inside one label div (entities decoded, <br/> split). */
function labelLines(value) {
  return value.split(/<br\s*\/?>/).map((line) => decodeText(line));
}

let totalCells = 0;
let totalRoundedPaths = 0;
for (const page of pages) {
  const { svg, steps } = svgForPage(page, {
    width: CANVAS.width,
    height: CANVAS.height,
    version: 'style-lock'
  });

  // The projection is the drawio page itself, fitted into the frozen canvas.
  const pageScale = fitScale(page, CANVAS);
  assert.ok(svg.includes(`viewBox="0 0 ${page.pageWidth} ${page.pageHeight}"`),
    `${page.name}: viewBox must frame the whole drawio page (${page.pageWidth}x${page.pageHeight})`);
  const [, svgW, svgH] = (svg.match(/<svg width="([\d.]+)" height="([\d.]+)"/) || []).map(Number);
  assert.ok(Math.abs(svgW - page.pageWidth * pageScale) <= 1 && Math.abs(svgH - page.pageHeight * pageScale) <= 1,
    `${page.name}: projection ${svgW}x${svgH} must equal page ${page.pageWidth}x${page.pageHeight} at ${pageScale.toFixed(3)}`);
  assert.ok(svgW <= CANVAS.width + 1 && svgH <= CANVAS.height + 1,
    `${page.name}: projection ${svgW}x${svgH} spills outside the ${CANVAS.width}x${CANVAS.height} canvas`);
  assert.strictEqual(count(svg, /<image/g), 0, `${page.name}: no raster embeds — geometry is vector only`);
  assert.ok(steps > 1, `${page.name}: reveal timeline must be multi-step`);

  // Every drawio cell that draws something must appear exactly once.
  const cellIds = [...svg.matchAll(/data-cell="([^"]+)"/g)].map((m) => m[1]);
  assert.strictEqual(new Set(cellIds).size, cellIds.length, `${page.name}: duplicate data-cell ids in the projection`);
  assert.ok(cellIds.length >= page.vertices.length, `${page.name}: projection dropped drawio vertices (${cellIds.length} < ${page.vertices.length})`);
  totalCells += cellIds.length;

  // Condensed labels only: no rendered line may exceed the sentence cap that simplifyLabel enforces.
  const divTexts = [...svg.matchAll(/<div[^>]*>([\s\S]*?)<\/div>/g)].map((m) => m[1]);
  assert.ok(divTexts.length >= 1, `${page.name}: every page must label its cards`);
  let longestLine = 0;
  for (const raw of divTexts) {
    for (const text of labelLines(raw)) {
      assert.ok(text.length <= STYLE_LOCK.maxLabelChars,
        `${page.name}: label line exceeds ${STYLE_LOCK.maxLabelChars} chars (${text.length}): ${text.slice(0, 60)}...`);
      assert.ok(!/&(?:#\d+|[a-z]+);/i.test(text), `${page.name}: undecoded entity in a label: ${text.slice(0, 60)}`);
      longestLine = Math.max(longestLine, text.length);
    }
  }
  assert.ok(/font-family:'Inter'/.test(svg), `${page.name}: card labels must use the Inter type stack`);

  // Connectors: orthogonal, rounded turns, no dead paths.
  const paths = [...svg.matchAll(/<path class="flow-path" d="([^"]+)"[^>]*marker-end="url\(#([^)]+)\)"/g)];
  assert.strictEqual(paths.length, (svg.match(/class="flow-path"/g) || []).length,
    `${page.name}: every connector needs a d attribute and an arrow marker`);
  for (const [, d] of paths) {
    assert.ok(d.length > 6, `${page.name}: connector path is empty`);
    assert.ok(!hasUnroundedTurn(d), `${page.name}: connector turns must be rounded with a quadratic join: ${d.slice(0, 80)}`);
  }
  totalRoundedPaths += paths.length;

  // Edge labels stay short enough to sit on their pill.
  const edgeLabels = [...svg.matchAll(/data-cell="[^"]+" data-kind="edge">[\s\S]*?<text[^>]*font-size="9.5"[^>]*>([^<]*)<\/text>/g)]
    .map((m) => decodeText(m[1]));
  for (const label of edgeLabels) {
    assert.ok(label.length <= STYLE_LOCK.maxEdgeLabelChars,
      `${page.name}: edge label exceeds ${STYLE_LOCK.maxEdgeLabelChars} chars: ${label}`);
  }

  // Exactly one agent tag per tagged card, and titles never carry one.
  const agentTags = [...svg.matchAll(/<text class="card-agent" data-agent="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(agentTags.length >= 1, `${page.name}: no agent tag — every page must name its owning ninja`);
  for (const agent of agentTags) assert.ok(/^[a-z-]+$/.test(agent), `${page.name}: agent tag must be a roster slug, got ${agent}`);
  const groupOf = (id) => {
    const start = svg.indexOf(`data-cell="${id}"`);
    if (start < 0) return '';
    const next = svg.indexOf('data-cell="', start + 1);
    return svg.slice(start, next < 0 ? undefined : next);
  };
  for (const vertex of page.vertices.filter((v) => v.style.text !== undefined)) {
    assert.ok(!/class="card-agent"/.test(groupOf(vertex.id)),
      `${page.name}: annotation cell ${vertex.id} must not own an agent tag`);
  }

  console.log(`  ✓ ${page.name}: ${cellIds.length} cells, ${paths.length} rounded connectors, ${agentTags.length} agent tags.`);
}

console.log(`  ✓ Grammar intact across all ${pages.length} pages (${totalCells} projected cells, ${totalRoundedPaths} rounded connectors).`);

// ── 4. Topology equality with drawio (rendered ids vs source ids) ────────
const generator = path.join(__dirname, '..', 'scripts', 'generate_drawio_flow_webp.js');
const coverage = execFileSync(process.execPath, [generator, '--coverage'], { encoding: 'utf8', timeout: 900000 });
assert.ok(coverage.includes(`coverage: ${pages.length}/${pages.length} pages topology-faithful`),
  `rendered data-cell ids must match the drawio topology exactly:\n${coverage.slice(-1200)}`);
assert.ok(!/MISSING/.test(coverage), `rendered projection is missing drawio cells:\n${coverage.slice(-1200)}`);
console.log(`  ✓ Topology equality: all ${pages.length} pages render every drawio cell (vertices + resolvable connectors).`);

console.log('✓ All tests in test_flow_diagram_style_lock.js passed cleanly!');
