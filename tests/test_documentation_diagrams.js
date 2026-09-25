#!/usr/bin/env node
'use strict';

/**
 * tests/test_documentation_diagrams.js — Validates drawio diagrams, Mermaid companions, and documentation references.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIAGRAM = path.join(ROOT, 'docs', 'diagrams', 'konoha-architecture.drawio');
const MANIFEST = path.join(ROOT, 'docs', 'diagrams', 'README.md');

const MERMAID_OWNERS = [
  { file: path.join(ROOT, 'README.md'), count: 2, required: ['genin-skill', 'sannin', 'Konoha MCP', 'Semble MCP', 'SQLite FTS5'] },
  { file: path.join(ROOT, 'docs', 'ARCHITECTURE.md'), count: 2, required: ['genin-skill', 'sannin', 'Konoha MCP', 'Semble MCP', 'SQLite FTS5'] },
  { file: path.join(ROOT, 'docs', 'LLM-BRIDGE-GATEWAY.md'), count: 1, required: ['Konoha Bridge Router', 'SQLite', 'Antigravity Sidecar'] },
  { file: path.join(ROOT, 'docs', 'SETUP-SEARXNG.md'), count: 1, required: ['SearXNG', 'DuckDuckGo', 'Startpage', 'Wikipedia'] },
  { file: path.join(ROOT, 'docs', 'ADDING-SKILLS.md'), count: 1, required: ['skills.sh', 'konoha migrate', 'SQLite', 'find_skill', 'get_skill'] }
];

const HIGH_RISK_EDGES = new Set([
  'p2-e12',
  'p3-e8',
  'p3-e9',
  'p4-e2',
  'p4-e3',
  'p8-e9'
]);

async function run() {
  console.log('Running test_documentation_diagrams tests...');

  // 1. DrawIO pages have valid cells and edges
  const drawioContent = fs.readFileSync(DIAGRAM, 'utf-8');
  const diagramRegex = /<diagram\s+[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/diagram>/g;
  const pages = [];
  let dMatch;
  while ((dMatch = diagramRegex.exec(drawioContent)) !== null) {
    const rawName = dMatch[1];
    const unescapedName = rawName.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    pages.push({ name: unescapedName, content: dMatch[2] });
  }

  assert.strictEqual(pages.length, 12);
  const expectedPageNames = new Set([
    '01 System Architecture',
    '02 Runtime Query Lifecycle',
    '03 MCP Tool and Skill Routing',
    '04 LLM Bridge Gateway',
    '05 Search Fallback Chain',
    '06 Skill Registry Installation',
    '07 Token Footprint Comparison',
    '08 Orchestrator Task Artifact Flow',
    '09 Jonin Taste-Skill Frontend Engine',
    '10 Persistent Project Context & Auto-Compaction',
    '11 Kage Pre-Delivery Reviewer Workflow Gate',
    '12 CLI Upgrade & Progress Engine'
  ]);
  assert.deepStrictEqual(new Set(pages.map(p => p.name)), expectedPageNames);

  for (const page of pages) {
    // Parse mxCell tags
    const cellRegex = /<mxCell\s+([^>]+?)(?:\/>|>([\s\S]*?)<\/mxCell>)/g;
    const cells = [];
    let cMatch;
    while ((cMatch = cellRegex.exec(page.content)) !== null) {
      const attrsStr = cMatch[1];
      const inner = cMatch[2] || '';
      function getAttr(name) {
        const m = new RegExp(`${name}="([^"]*)"`).exec(attrsStr);
        return m ? m[1] : null;
      }
      cells.push({
        id: getAttr('id'),
        edge: getAttr('edge'),
        source: getAttr('source'),
        target: getAttr('target'),
        style: getAttr('style') || '',
        inner
      });
    }

    const ids = new Set(cells.map(c => c.id).filter(Boolean));
    assert.ok(ids.has('0'), `Page ${page.name} missing cell 0`);
    assert.ok(ids.has('1'), `Page ${page.name} missing cell 1`);
    assert.ok(cells.length > 3, `Page ${page.name} should have > 3 cells`);

    for (const cell of cells) {
      if (cell.edge === '1') {
        assert.ok(ids.has(cell.source), `Source ${cell.source} not in ids on page ${page.name}`);
        assert.ok(ids.has(cell.target), `Target ${cell.target} not in ids on page ${page.name}`);
        assert.ok(cell.inner.includes('mxGeometry'), `Edge ${cell.id} missing mxGeometry`);

        if (HIGH_RISK_EDGES.has(cell.id)) {
          const hasExit = cell.style.includes('exitX=') && cell.style.includes('exitY=');
          const hasArray = cell.inner.includes('<Array');
          assert.ok(hasExit || hasArray, `High risk edge ${cell.id} missing exit points or array points`);
        }
      }
    }
  }
  console.log('✓ DrawIO pages have valid cells and edges passed');

  // 2. Markdown has professional Mermaid companions
  for (const item of MERMAID_OWNERS) {
    const content = fs.readFileSync(item.file, 'utf-8');
    const rel = path.relative(ROOT, item.file);
    const blocks = [];
    const mermaidRegex = /```mermaid\n([\s\S]*?)```/g;
    let m;
    while ((m = mermaidRegex.exec(content)) !== null) {
      blocks.push(m[1]);
    }

    assert.strictEqual(blocks.length, item.count, `${rel} expected ${item.count} mermaid blocks, found ${blocks.length}`);
    assert.ok(!content.includes('deep-code-explorer'), `${rel} must not contain deep-code-explorer`);

    for (const label of item.required) {
      assert.ok(content.includes(label), `${rel} missing required label: ${label}`);
    }

    for (const block of blocks) {
      assert.ok(block.includes('theme: base'), `${rel} mermaid block missing theme: base`);
      assert.ok(block.includes('fontFamily:'), `${rel} mermaid block missing fontFamily:`);
      if (block.includes('flowchart')) {
        assert.ok(/wrappingWidth:\s*(?:3[2-9][0-9]|[4-9][0-9]{2})/.test(block), `${rel} flowchart missing wrappingWidth`);
      }
      for (const line of block.split('\n')) {
        const labelSafe = line.replace(/\|[^|\n]*\|/g, '');
        assert.ok(!labelSafe.includes('|'), `${rel} invalid unescaped pipe in mermaid line: ${line}`);
      }
    }
  }
  console.log('✓ Markdown Mermaid companions passed');

  // 3. Documentation links point to canonical source
  const owners = {
    [path.join(ROOT, 'README.md')]: 'docs/diagrams/konoha-architecture.drawio',
    [path.join(ROOT, 'docs', 'ARCHITECTURE.md')]: 'diagrams/konoha-architecture.drawio',
    [path.join(ROOT, 'docs', 'LLM-BRIDGE-GATEWAY.md')]: 'diagrams/konoha-architecture.drawio',
    [path.join(ROOT, 'docs', 'SETUP-SEARXNG.md')]: 'diagrams/konoha-architecture.drawio',
    [path.join(ROOT, 'docs', 'ADDING-SKILLS.md')]: 'diagrams/konoha-architecture.drawio'
  };
  for (const [file, link] of Object.entries(owners)) {
    const content = fs.readFileSync(file, 'utf-8');
    assert.ok(content.includes(link), `${path.relative(ROOT, file)} missing link: ${link}`);
  }

  const manifest = fs.readFileSync(MANIFEST, 'utf-8');
  assert.ok(manifest.includes('canonical editable source'));
  assert.ok(manifest.includes('synchronized Mermaid companion'));
  console.log('✓ Documentation links point to canonical source passed');

  // 4. Current bridge contract is documented
  const docs = [
    'README.md',
    'docs/LLM-BRIDGE-GATEWAY.md',
    'docs/SETUP-MCP-CLIENTS.md',
    'docs/TROUBLESHOOTING.md'
  ].map(rel => fs.readFileSync(path.join(ROOT, rel), 'utf-8')).join('\n');

  assert.ok(docs.includes('127.0.0.1:1313'));
  assert.ok(docs.includes('127.0.0.1:19999'));
  assert.ok(docs.includes('antigravity-extension'));
  assert.ok(docs.includes('does not perform gateway-level round-robin'));
  assert.ok(docs.includes('andycungkrinx91.konoha-bridge-master-universal'));
  assert.ok(!docs.includes('pinned to `v1.2.0`'));
  assert.ok(!docs.includes('automatically rotates to the next eligible bridge'));
  assert.ok(!docs.includes('WebSocket-based sidecar communication for the bridge router (port `19999`)'));
  console.log('✓ Current bridge contract is documented passed');

  console.log('\nAll test_documentation_diagrams tests passed!');
}

if (require.main === module) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run };
