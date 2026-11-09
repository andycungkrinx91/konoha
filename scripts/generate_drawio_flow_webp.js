#!/usr/bin/env node
'use strict';

/**
 * scripts/generate_drawio_flow_webp.js
 *
 * Ports every drawio tab (page) into an animated WebP diagram. The drawio architecture
 * files remain the single source of truth: boxes, colours, labels and orthogonal
 * connectors are read from `mxCell` geometry, and the animation only adds a staged
 * reveal plus a travelling pulse along each already-rounded path.
 *
 * Union of tabs across both drawio files = 19 diagrams (the production file re-states
 * the same 18 pages with one extra security box and adds page 19 for the local Web UI
 * ingress topology, so only that page is rendered additionally).
 *
 * Usage:
 *   node scripts/generate_drawio_flow_webp.js            # render all 19 tabs
 *   node scripts/generate_drawio_flow_webp.js --only=13  # render matching tabs only
 *   node scripts/generate_drawio_flow_webp.js --list     # print the manifest, no render
 *   node scripts/generate_drawio_flow_webp.js --probe=13 # geometry probe, no encode
 */

const fs = require('fs');
const path = require('path');
const playwright = require('playwright');

const { loadDrawioCorpus } = require('./lib/drawio_pages');
const { pageHtml, assetNameFor, CANVAS } = require('./lib/drawio_flow_svg');
const { renderAndExportWebP } = require('./generate_tokubetsu_flow_webp');

const ROOT_DIR = path.resolve(__dirname, '..');
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
const VERSION = require('../package.json').version;
const FRAMES = 24;
const FPS = 12;
const WEB_INGRESS_PAGE = '19 Authenticated Local Web UI & Ingress Queue';
const TOKUBETSU_OWNED_ASSETS = new Set([
  'konoha-orchestration-flow.webp',
  'konoha-jonin-flow.webp',
  'konoha-kage-gate.webp',
  'konoha-qa-flow.webp',
  'konoha-telegram-flow.webp',
  'konoha-akatsuki-flow.webp',
  'konoha-anbu-flow.webp'
]);

fs.mkdirSync(ASSETS_DIR, { recursive: true });

function buildManifest() {
  const corpus = loadDrawioCorpus();
  const byName = new Map();
  for (const page of corpus.architecture) byName.set(page.name, { page, source: 'konoha-architecture.drawio' });
  for (const page of corpus.production) {
    if (page.name === WEB_INGRESS_PAGE) byName.set(page.name, { page, source: 'konoha-infrastructure-architecture.drawio' });
  }
  return [...byName.values()].map((entry) => ({
    ...entry,
    asset: assetNameFor(entry.page)
  }));
}

function filterTargets(manifest, argv) {
  const argvText = argv.join(' ');
  if (argvText.includes('--list')) return { list: manifest, targets: [] };
  const probe = (argv.find((a) => a.startsWith('--probe')) || '').split('=')[1];
  if (probe) return { list: [], targets: manifest.filter((m) => m.page.name.startsWith(probe) || m.asset.includes(probe)) };
  const only = (argv.find((a) => a.startsWith('--only')) || '').split('=')[1];
  if (!only) return { list: [], targets: manifest.filter((m) => !TOKUBETSU_OWNED_ASSETS.has(m.asset)) };
  return { list: [], targets: manifest.filter((m) => m.page.name.startsWith(only) || m.asset.includes(only)) };
}

/** Runs inside the page: reports text clipping, agent tags, canvas overflow and reveal state. */
function measureFrame() {
  const clipped = [...document.querySelectorAll('foreignObject > div')]
    .filter((div) => div.scrollHeight > div.clientHeight + 1 || div.scrollWidth > div.clientWidth + 1)
    .map((div) => ({
      text: div.textContent.slice(0, 60),
      scrollH: div.scrollHeight,
      clientH: div.clientHeight,
      scrollW: div.scrollWidth,
      clientW: div.clientWidth
    }));
  const agents = [...document.querySelectorAll('.card-agent')].map((el) => el.dataset.agent);
  const svgRect = document.querySelector('svg').getBoundingClientRect();
  const overflowing = svgRect.width > window.innerWidth + 1 || svgRect.height > window.innerHeight + 1;
  const reveals = [...document.querySelectorAll('.reveal')];
  return {
    clipped,
    agents,
    overflow: overflowing
      ? { svgW: Math.round(svgRect.width), svgH: Math.round(svgRect.height), viewW: window.innerWidth, viewH: window.innerHeight }
      : null,
    emptyOpacity: reveals.filter((el) => Number(getComputedStyle(el).opacity) < 0.99).length,
    reveals: reveals.length
  };
}

/** Renders one page in Chromium and reports text clipping / out-of-canvas boxes. */
async function probePage(entry) {
  const html = pageHtml(entry.page, { width: CANVAS.width, height: CANVAS.height, version: VERSION });
  const browser = await playwright.chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  try {
    const page = await browser.newPage({ viewport: { width: CANVAS.width, height: CANVAS.height }, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.evaluate(() => window.updateFrame(23, 24));
    const report = await page.evaluate(measureFrame);
    try {
      await page.screenshot({ path: `/tmp/qa3/probe_page.png`, type: 'png' });
    } catch (_) {
      // Non-fatal if probe screenshot write fails under headless load
    }
    return report;
  } finally {
    await browser.close();
  }
}

/**
 * Verifies the port is *topology-faithful*: every drawio cell that carries geometry must
 * appear exactly once in the rendered SVG (`data-cell`), and the SVG must not invent cells.
 * Orphan connectors (a drawio edge with no resolvable endpoints) are the only allowed gap.
 */
function coverageReport(entry) {
  const html = pageHtml(entry.page, { width: CANVAS.width, height: CANVAS.height, version: VERSION });
  const rendered = new Set([...html.matchAll(/data-cell="([^"]+)"/g)].map((m) => m[1]));
  const expected = new Set(entry.page.vertices.map((v) => v.id));
  const byId = new Map(entry.page.vertices.map((v) => [v.id, v]));
  const orphans = [];
  for (const edge of entry.page.edges) {
    const resolvable = edge.points.length > 0
      || (byId.has(edge.source) && byId.has(edge.target))
      || (edge.sourcePoint && (byId.has(edge.target) || edge.targetPoint))
      || (edge.targetPoint && (byId.has(edge.source) || edge.sourcePoint));
    if (!resolvable) { orphans.push(edge.id); continue; }
    expected.add(edge.id);
  }
  const missing = [...expected].filter((id) => !rendered.has(id));
  const extra = [...rendered].filter((id) => !expected.has(id));
  return { expected: expected.size, rendered: rendered.size, missing, extra, orphans };
}

async function main() {
  const argv = process.argv.slice(2);
  const manifest = buildManifest();
  const { list, targets } = filterTargets(manifest, argv);

  if (list.length) {
    for (const m of list) {
      console.log(`${m.page.name.padEnd(52)} -> ${m.asset.padEnd(46)} ${m.page.vertices.length}v/${m.page.edges.length}e  [${m.source}]`);
    }
    console.log(`\n${list.length} tabs`);
    return;
  }

  if (argv.join(' ').includes('--coverage')) {
    let failures = 0;
    for (const t of manifest) {
      const rep = coverageReport(t);
      const ok = rep.missing.length === 0 && rep.extra.length === 0;
      if (!ok) failures += 1;
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${t.page.name.padEnd(50)} cells ${rep.rendered}/${rep.expected}`
        + (rep.missing.length ? ` missing[${rep.missing.join(',')}]` : '')
        + (rep.extra.length ? ` extra[${rep.extra.join(',')}]` : '')
        + (rep.orphans.length ? ` orphan[${rep.orphans.join(',')}]` : ''));
    }
    console.log(`\ncoverage: ${manifest.length - failures}/${manifest.length} pages topology-faithful`);
    if (failures) process.exitCode = 1;
    return;
  }

  if (argv.join(' ').includes('--probe')) {
    for (const t of targets) {
      const report = await probePage(t);
      console.log(`\n${t.page.name}: reveals=${report.reveals} stillHidden=${report.emptyOpacity} agentTags=${report.agents.length}`
        + (report.overflow ? ` OVERFLOW=${JSON.stringify(report.overflow)}` : ' fitsCanvas'));
      console.log('  agents:', report.agents.join(' ') || '(none)');
      if (report.clipped.length) {
        console.log(`  CLIPPED ${report.clipped.length}:`);
        for (const c of report.clipped) console.log('   -', JSON.stringify(c).slice(0, 160));
      } else console.log('  no clipped labels');
    }
    return;
  }

  console.log('='.repeat(64));
  console.log(`DRAWIO -> ANIMATED WEBP PORT (${targets.length} tabs, ${CANVAS.width}x${CANVAS.height} @2x)`);
  console.log('='.repeat(64));

  const results = [];
  for (const t of targets) {
    const html = pageHtml(t.page, { width: CANVAS.width, height: CANVAS.height, version: VERSION });
    const outPath = path.join(ASSETS_DIR, t.asset);
    const tmpPath = `${outPath}.tmp.webp`;
    results.push(await renderAndExportWebP(html, tmpPath, {
      width: CANVAS.width, height: CANVAS.height, totalFrames: FRAMES, fps: FPS, injectHooks: false
    }));
    // Publish atomically: a half-written .webp reads as a corrupt/broken image in editors.
    fs.renameSync(tmpPath, outPath);
  }

  const totalKb = results.reduce((sum, r) => sum + Number(r.sizeKb), 0);
  console.log(`\n✓ ${results.length} animated WebP tabs rendered, ${totalKb.toFixed(1)} KB total`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { buildManifest, probePage };
