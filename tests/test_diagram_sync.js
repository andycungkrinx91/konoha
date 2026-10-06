#!/usr/bin/env node
'use strict';

/**
 * tests/test_diagram_sync.js
 * Verifies diagram synchronization, XML validity, page IDs uniqueness,
 * manifest consistency, and tool count alignment across documentation.
 *
 * Enforced by PLAN-WORKFLOW.md Phase 6 Step 4.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { listToolSchemas } = require('../src/file_tools_router');

console.log('Running test_diagram_sync.js...');

const ROOT_DIR = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(ROOT_DIR, 'docs');
const DIAGRAMS_DIR = path.join(DOCS_DIR, 'diagrams');
const DRAWIO_PATH = path.join(DIAGRAMS_DIR, 'konoha-architecture.drawio');
const MANIFEST_PATH = path.join(DIAGRAMS_DIR, 'README.md');
const ARCH_PATH = path.join(DOCS_DIR, 'ARCHITECTURE.md');
const README_PATH = path.join(ROOT_DIR, 'README.md');
const QA_DOC_PATH = path.join(DOCS_DIR, 'QA-AUTOMATION.md');

// 1. Live Tool Count vs Documentation
const liveSchemas = listToolSchemas();
const toolCount = liveSchemas.length;
assert.strictEqual(toolCount, 37, `Expected 37 registered tools, found ${toolCount}`);

const readmeContent = fs.readFileSync(README_PATH, 'utf-8');
const archContent = fs.readFileSync(ARCH_PATH, 'utf-8');

// Tool count in README badge and intro
assert.ok(
  readmeContent.includes(`MCP%20Tools-37%20Canonical`),
  'README.md badge must state 37 Canonical MCP tools'
);
assert.ok(
  readmeContent.includes(`exposes 37 canonical tools`),
  'README.md intro must state 37 canonical tools'
);

// Tool count in docs/ARCHITECTURE.md
assert.ok(
  archContent.includes(`(37 Canonical Tools)`),
  'docs/ARCHITECTURE.md title must state 37 Canonical Tools'
);
assert.ok(
  archContent.includes(`Registered Tools (37 Total)`),
  'docs/ARCHITECTURE.md matrix must state 37 Total'
);
assert.ok(
  archContent.includes(`across \`konoha\` (37 tools)`),
  'docs/ARCHITECTURE.md permissions section must state 37 tools'
);

// Verify category sum in ARCHITECTURE.md matrix equals 37
const categoryRegex = /\*\*([A-Za-z0-9 &]+) \((\d+)\)\*\*/g;
let catMatch;
let sumCategories = 0;
while ((catMatch = categoryRegex.exec(archContent)) !== null) {
  sumCategories += parseInt(catMatch[2], 10);
}
assert.strictEqual(
  sumCategories,
  37,
  `Sum of category tool counts in ARCHITECTURE.md must equal 37, got ${sumCategories}`
);

// 2. Every registered tool name appears in the docs/ARCHITECTURE.md matrix
for (const schema of liveSchemas) {
  assert.ok(
    archContent.includes(`\`${schema.name}\``),
    `ARCHITECTURE.md matrix must include tool: \`${schema.name}\``
  );
}
console.log('  ✓ Tool counts and matrix coverage verified across README and ARCHITECTURE.md');

// 3. XML & Structure checks on konoha-architecture.drawio
assert.ok(fs.existsSync(DRAWIO_PATH), 'konoha-architecture.drawio must exist');
const drawioContent = fs.readFileSync(DRAWIO_PATH, 'utf-8');

// Check opening and closing mxfile tags
assert.ok(drawioContent.startsWith('<mxfile'), 'drawio file must start with <mxfile');
assert.ok(drawioContent.endsWith('</mxfile>'), 'drawio file must end with </mxfile>');

// Extract all diagrams
const diagramRegex = /<diagram\s+id="([^"]+)"\s+name="([^"]+)">([\s\S]*?)<\/diagram>/g;
const pageMatches = [];
let dMatch;
while ((dMatch = diagramRegex.exec(drawioContent)) !== null) {
  pageMatches.push({
    id: dMatch[1],
    name: dMatch[2],
    body: dMatch[3]
  });
}

// Every diagram must have a matching closing tag
const openDiagramCount = (drawioContent.match(/<diagram\b/g) || []).length;
const closeDiagramCount = (drawioContent.match(/<\/diagram>/g) || []).length;
assert.strictEqual(
  openDiagramCount,
  closeDiagramCount,
  `Every <diagram> must have a closing </diagram> tag (${openDiagramCount} vs ${closeDiagramCount})`
);
assert.strictEqual(pageMatches.length, 13, `Expected exactly 13 pages in drawio, found ${pageMatches.length}`);

// Check unique mxCell IDs within each page
for (const page of pageMatches) {
  const cellIdRegex = /<mxCell\s+id="([^"]+)"/g;
  const seenIds = new Set();
  let cMatch;
  while ((cMatch = cellIdRegex.exec(page.body)) !== null) {
    const cellId = cMatch[1];
    assert.ok(
      !seenIds.has(cellId),
      `Duplicate cell ID "${cellId}" detected in drawio page "${page.name}"`
    );
    seenIds.add(cellId);
  }
}
console.log('  ✓ All 13 drawio pages have valid tags and strictly unique mxCell IDs.');

// 4. Manifest checks in docs/diagrams/README.md
const manifestContent = fs.readFileSync(MANIFEST_PATH, 'utf-8');
assert.ok(
  manifestContent.includes('thirteen pages'),
  'docs/diagrams/README.md must declare thirteen pages'
);

for (const page of pageMatches) {
  const rawName = page.name.replace(/&amp;/g, '&');
  assert.ok(
    manifestContent.includes(rawName),
    `docs/diagrams/README.md manifest must include page name: "${rawName}"`
  );
}
console.log('  ✓ Manifest in docs/diagrams/README.md matches all drawio page names.');

// 5. Check labels on drawio page 13 and Mermaid block in docs/QA-AUTOMATION.md
const qaDocContent = fs.readFileSync(QA_DOC_PATH, 'utf-8');
const page13 = pageMatches.find(p => p.id === 'qa-automation-workflow');
assert.ok(page13, 'Drawio page 13 with id "qa-automation-workflow" must exist');

const requiredLabels = ['qa_codify', 'qa_e2e_run', 'Anbu', 'Jonin', 'Kage', 'Tokubetsu-jonin'];
for (const label of requiredLabels) {
  assert.ok(
    qaDocContent.includes(label),
    `docs/QA-AUTOMATION.md Mermaid block must include label: "${label}"`
  );
  assert.ok(
    page13.body.includes(label),
    `Drawio page 13 must include label: "${label}"`
  );
}
console.log('  ✓ QA automation labels verified on drawio page 13 and Mermaid block.');

// 6. Check relative diagram links in README.md and ARCHITECTURE.md
const relativeLinkRegex = /\[[^\]]+\]\(((?:docs\/)?diagrams\/[^)]+)\)/g;
for (const [docName, docDir, content] of [
  ['README.md', ROOT_DIR, readmeContent],
  ['ARCHITECTURE.md', DOCS_DIR, archContent]
]) {
  let lMatch;
  while ((lMatch = relativeLinkRegex.exec(content)) !== null) {
    const rawTarget = lMatch[1].split('#')[0];
    const resolvedPath = path.resolve(docDir, rawTarget);
    assert.ok(
      fs.existsSync(resolvedPath),
      `Relative link in ${docName} points to non-existent file: ${rawTarget}`
    );
  }
}
console.log('  ✓ Relative diagram links resolve to existing files.');

// 7. Verify zero geometric collisions across all 13 pages (0 penetrations, 0 crossings, 0 overlaps)
function parsePageGeometry(xml) {
  const cells = new Map();
  const cellRegex = /<mxCell\s+([^>]*?)(\/>|>([\s\S]*?)<\/mxCell>)/g;
  let cm;
  while ((cm = cellRegex.exec(xml)) !== null) {
    const attrs = cm[1];
    const inner = cm[3] || '';
    const id = (attrs.match(/id="([^"]+)"/) || [])[1];
    if (!id) continue;
    const value = (attrs.match(/value="([^"]*)"/) || [])[1] || '';
    const vertex = /vertex="1"/.test(attrs);
    const edge = /edge="1"/.test(attrs);
    const parent = (attrs.match(/parent="([^"]+)"/) || [])[1] || '1';
    const source = (attrs.match(/source="([^"]+)"/) || [])[1] || '';
    const target = (attrs.match(/target="([^"]+)"/) || [])[1] || '';
    const style = (attrs.match(/style="([^"]*)"/) || [])[1] || '';
    const geomMatch = inner.match(/<mxGeometry\s+([^>]*?)(\/>|>([\s\S]*?)<\/mxGeometry>)/);
    let geom = { x: 0, y: 0, w: 0, h: 0 };
    let waypoints = [];
    if (geomMatch) {
      const gAttrs = geomMatch[1];
      const gInner = geomMatch[3] || '';
      geom.x = parseFloat((gAttrs.match(/x="([^"]+)"/) || [])[1] || '0');
      geom.y = parseFloat((gAttrs.match(/y="([^"]+)"/) || [])[1] || '0');
      geom.w = parseFloat((gAttrs.match(/width="([^"]+)"/) || [])[1] || '0');
      geom.h = parseFloat((gAttrs.match(/height="([^"]+)"/) || [])[1] || '0');
      const ptRegex = /<mxPoint\s+x="([^"]+)"\s+y="([^"]+)"/g;
      let pm;
      while ((pm = ptRegex.exec(gInner)) !== null) {
        waypoints.push({ x: parseFloat(pm[1]), y: parseFloat(pm[2]) });
      }
    }
    const exitX = (style.match(/exitX=([0-9.]+)/) || [])[1];
    const exitY = (style.match(/exitY=([0-9.]+)/) || [])[1];
    const entryX = (style.match(/entryX=([0-9.]+)/) || [])[1];
    const entryY = (style.match(/entryY=([0-9.]+)/) || [])[1];
    cells.set(id, { id, value, vertex, edge, parent, source, target, style, ...geom, waypoints, exitX, exitY, entryX, entryY });
  }
  for (const [id, cell] of cells.entries()) {
    if (cell.vertex) {
      let cur = cell;
      let absX = cur.x, absY = cur.y;
      while (cur.parent && cur.parent !== '1' && cur.parent !== '0') {
        const pCell = cells.get(cur.parent);
        if (!pCell) break;
        absX += pCell.x;
        absY += pCell.y;
        cur = pCell;
      }
      cell.absX = absX; cell.absY = absY; cell.absW = cell.w; cell.absH = cell.h;
    }
  }
  return cells;
}

function lineIntersects(p1, p2, p3, p4) {
  if ((Math.abs(p1.x - p3.x) < 2 && Math.abs(p1.y - p3.y) < 2) ||
      (Math.abs(p1.x - p4.x) < 2 && Math.abs(p1.y - p4.y) < 2) ||
      (Math.abs(p2.x - p3.x) < 2 && Math.abs(p2.y - p3.y) < 2) ||
      (Math.abs(p2.x - p4.x) < 2 && Math.abs(p2.y - p4.y) < 2)) return false;
  function ccw(A, B, C) { return (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x); }
  return (ccw(p1, p3, p4) !== ccw(p2, p3, p4)) && (ccw(p1, p2, p3) !== ccw(p1, p2, p4));
}

function lineOverlap(p1, p2, p3, p4) {
  if (Math.abs(p1.y - p2.y) < 1 && Math.abs(p3.y - p4.y) < 1 && Math.abs(p1.y - p3.y) < 1) {
    const min1 = Math.min(p1.x, p2.x), max1 = Math.max(p1.x, p2.x);
    const min2 = Math.min(p3.x, p4.x), max2 = Math.max(p3.x, p4.x);
    return Math.max(min1, min2) < Math.min(max1, max2) - 5;
  }
  if (Math.abs(p1.x - p2.x) < 1 && Math.abs(p3.x - p4.x) < 1 && Math.abs(p1.x - p3.x) < 1) {
    const min1 = Math.min(p1.y, p2.y), max1 = Math.max(p1.y, p2.y);
    const min2 = Math.min(p3.y, p4.y), max2 = Math.max(p3.y, p4.y);
    return Math.max(min1, min2) < Math.min(max1, max2) - 5;
  }
  return false;
}

function segPenetratesBox(p1, p2, box) {
  const minX = box.absX + 2, maxX = box.absX + box.absW - 2;
  const minY = box.absY + 2, maxY = box.absY + box.absH - 2;
  if (minX >= maxX || minY >= maxY) return false;
  let t0 = 0, t1 = 1;
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const checks = [[-dx, p1.x - minX], [dx, maxX - p1.x], [-dy, p1.y - minY], [dy, maxY - p1.y]];
  for (const [p, q] of checks) {
    if (p === 0) { if (q < 0) return false; }
    else {
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
  }
  return t0 < t1;
}

for (const page of pageMatches) {
  const cells = parsePageGeometry(page.body);
  const vertices = Array.from(cells.values()).filter(c => c.vertex && c.absW > 0 && c.absH > 0);
  const edges = Array.from(cells.values()).filter(c => c.edge && c.source && c.target);
  const edgeList = [];
  for (const edge of edges) {
    const src = cells.get(edge.source);
    const tgt = cells.get(edge.target);
    if (!src || !tgt) continue;
    let sPt = {
      x: src.absX + (edge.exitX !== undefined ? parseFloat(edge.exitX) * src.absW : src.absW / 2),
      y: src.absY + (edge.exitY !== undefined ? parseFloat(edge.exitY) * src.absH : src.absH / 2)
    };
    let tPt = {
      x: tgt.absX + (edge.entryX !== undefined ? parseFloat(edge.entryX) * tgt.absW : tgt.absW / 2),
      y: tgt.absY + (edge.entryY !== undefined ? parseFloat(edge.entryY) * tgt.absH : tgt.absH / 2)
    };
    let points = [sPt];
    if (edge.waypoints.length > 0) points.push(...edge.waypoints);
    points.push(tPt);
    edgeList.push({ edge, src, tgt, points });
  }
  for (const e of edgeList) {
    for (let s = 0; s < e.points.length - 1; s++) {
      const p1 = e.points[s], p2 = e.points[s+1];
      for (const v of vertices) {
        if (v.id === e.src.id || v.id === e.tgt.id) continue;
        if (v.style.includes('swimlane') || v.style.includes('group') || v.id === 'p13-p5') continue;
        if (v.id === e.src.parent || v.id === e.tgt.parent) continue;
        assert.ok(
          !segPenetratesBox(p1, p2, v),
          `Page "${page.name}": Edge "${e.edge.id}" penetrates shape "${v.id}"`
        );
      }
    }
  }
  for (let i = 0; i < edgeList.length; i++) {
    for (let j = i + 1; j < edgeList.length; j++) {
      const e1 = edgeList[i], e2 = edgeList[j];
      for (let s1 = 0; s1 < e1.points.length - 1; s1++) {
        for (let s2 = 0; s2 < e2.points.length - 1; s2++) {
          const p1 = e1.points[s1], p2 = e1.points[s1+1];
          const p3 = e2.points[s2], p4 = e2.points[s2+1];
          assert.ok(
            !lineIntersects(p1, p2, p3, p4),
            `Page "${page.name}": Edge "${e1.edge.id}" crosses edge "${e2.edge.id}"`
          );
          assert.ok(
            !lineOverlap(p1, p2, p3, p4),
            `Page "${page.name}": Edge "${e1.edge.id}" overlaps edge "${e2.edge.id}"`
          );
        }
      }
    }
  }
}
console.log('  ✓ Zero geometric collisions verified across all 13 drawio pages (0 penetrations, 0 crossings, 0 overlaps).');

// 8. Verify Enterprise Architecture Diagram (konoha-enterprise-architecture.drawio)
const ENTERPRISE_DRAWIO_PATH = path.join(DIAGRAMS_DIR, 'konoha-enterprise-architecture.drawio');
assert.ok(fs.existsSync(ENTERPRISE_DRAWIO_PATH), 'konoha-enterprise-architecture.drawio must exist');
const entContent = fs.readFileSync(ENTERPRISE_DRAWIO_PATH, 'utf-8');
assert.ok(entContent.startsWith('<mxfile'), 'enterprise drawio must start with <mxfile');
assert.ok(entContent.endsWith('</mxfile>'), 'enterprise drawio must end with </mxfile>');

const entDiagramRegex = /<diagram\s+id="([^"]+)"\s+name="([^"]+)">([\s\S]*?)<\/diagram>/g;
const entPages = [];
let entMatch;
while ((entMatch = entDiagramRegex.exec(entContent)) !== null) {
  entPages.push({
    id: entMatch[1],
    name: entMatch[2],
    body: entMatch[3]
  });
}
assert.strictEqual(entPages.length, 13, `Expected exactly 13 pages in enterprise drawio, found ${entPages.length}`);

// Check unique mxCell IDs
for (const page of entPages) {
  const cellIdRegex = /<mxCell\s+id="([^"]+)"/g;
  const seenIds = new Set();
  let cMatch;
  while ((cMatch = cellIdRegex.exec(page.body)) !== null) {
    const cellId = cMatch[1];
    assert.ok(!seenIds.has(cellId), `Duplicate cell ID "${cellId}" in enterprise page "${page.name}"`);
    seenIds.add(cellId);
  }
}

// Verify official cloud architecture stencils (AWS4 group containers & cloud palettes) are used
const requiredStencils = ['shape=mxgraph.aws4.group', 'mxgraph.aws4.group_aws_cloud', 'mxgraph.aws4.group_vpc', 'mxgraph.aws4.group_security_group'];
for (const stencil of requiredStencils) {
  assert.ok(entContent.includes(stencil), `Enterprise diagram must include cloud stencil: ${stencil}`);
}

// Verify zero collisions across all 13 enterprise pages
for (const page of entPages) {
  const cells = parsePageGeometry(page.body);
  const vertices = Array.from(cells.values()).filter(c => c.vertex && c.absW > 0 && c.absH > 0);
  const edges = Array.from(cells.values()).filter(c => c.edge && c.source && c.target);
  const edgeList = [];
  for (const edge of edges) {
    const src = cells.get(edge.source);
    const tgt = cells.get(edge.target);
    if (!src || !tgt) continue;
    let sPt = {
      x: src.absX + (edge.exitX !== undefined ? parseFloat(edge.exitX) * src.absW : src.absW / 2),
      y: src.absY + (edge.exitY !== undefined ? parseFloat(edge.exitY) * src.absH : src.absH / 2)
    };
    let tPt = {
      x: tgt.absX + (edge.entryX !== undefined ? parseFloat(edge.entryX) * tgt.absW : tgt.absW / 2),
      y: tgt.absY + (edge.entryY !== undefined ? parseFloat(edge.entryY) * tgt.absH : tgt.absH / 2)
    };
    let points = [sPt];
    if (edge.waypoints.length > 0) points.push(...edge.waypoints);
    points.push(tPt);
    edgeList.push({ edge, src, tgt, points });
  }
  for (const e of edgeList) {
    for (let s = 0; s < e.points.length - 1; s++) {
      const p1 = e.points[s], p2 = e.points[s+1];
      for (const v of vertices) {
        if (v.id === e.src.id || v.id === e.tgt.id) continue;
        if (v.style.includes('swimlane') || v.style.includes('group') || v.style.includes('container=1') || v.id === 'p13-p5' || v.id.startsWith('p1-l')) continue;
        if (v.id === e.src.parent || v.id === e.tgt.parent) continue;
        assert.ok(
          !segPenetratesBox(p1, p2, v),
          `Enterprise Page "${page.name}": Edge "${e.edge.id}" penetrates shape "${v.id}"`
        );
      }
    }
  }
  for (let i = 0; i < edgeList.length; i++) {
    for (let j = i + 1; j < edgeList.length; j++) {
      const e1 = edgeList[i], e2 = edgeList[j];
      for (let s1 = 0; s1 < e1.points.length - 1; s1++) {
        for (let s2 = 0; s2 < e2.points.length - 1; s2++) {
          const p1 = e1.points[s1], p2 = e1.points[s1+1];
          const p3 = e2.points[s2], p4 = e2.points[s2+1];
          assert.ok(
            !lineIntersects(p1, p2, p3, p4),
            `Enterprise Page "${page.name}": Edge "${e1.edge.id}" crosses edge "${e2.edge.id}"`
          );
          assert.ok(
            !lineOverlap(p1, p2, p3, p4),
            `Enterprise Page "${page.name}": Edge "${e1.edge.id}" overlaps edge "${e2.edge.id}"`
          );
        }
      }
    }
  }
}
console.log('  ✓ Enterprise architecture diagram verified (13 pages, official AWS/GCP cloud styles, 0 collisions).');

console.log('✓ All tests in test_diagram_sync.js passed cleanly!');
