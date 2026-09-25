#!/usr/bin/env node
'use strict';

/**
 * tests/test_docs_currency.js — verifies all konoha documentation is up to date with current source code.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DOC_DIR = path.join(ROOT_DIR, 'docs');
const SRC_DIR = path.join(ROOT_DIR, 'src');

const REQUIRED_DOCS = [
  'README.md',
  'docs/ARCHITECTURE.md',
  'docs/BENCHMARK.md',
  'docs/LLM-BRIDGE-GATEWAY.md',
  'docs/SETUP-IDE.md',
  'docs/SETUP-CLI.md',
  'docs/SETUP-CURSOR.md',
  'docs/SETUP-MCP-CLIENTS.md',
  'docs/ADDING-SKILLS.md',
  'docs/TROUBLESHOOTING.md',
  'docs/diagrams/README.md',
  'docs/diagrams/konoha-architecture.drawio',
  'docs/SecurityCompliance/security_compliance_report_google_policy_2.0.0_2026-08-27.md',
  'docs/SecurityCompliance/security_compliance_report_google_policy_2.0.1_2026-09-25.md'
];

function checkLocalLinks() {
  const failures = [];
  const mdFiles = [path.join(ROOT_DIR, 'README.md')];

  function collectMd(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) collectMd(full);
      else if (e.name.endsWith('.md')) mdFiles.push(full);
    }
  }
  collectMd(DOC_DIR);

  const pattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
  for (const source of mdFiles) {
    const content = fs.readFileSync(source, 'utf-8');
    let m;
    while ((m = pattern.exec(content)) !== null) {
      let raw = m[1].trim();
      if (!raw || /^(?:https?:|mailto:|tel:|data:|#)/i.test(raw)) continue;
      let resolved;
      if (raw.toLowerCase().startsWith('file://')) {
        const u = new URL(raw);
        resolved = path.resolve(decodeURIComponent(u.pathname));
      } else {
        const target = raw.split('#')[0].split('?')[0];
        resolved = path.resolve(path.dirname(source), target);
      }
      if (!fs.existsSync(resolved)) {
        failures.push(`${path.relative(ROOT_DIR, source)} -> ${raw}`);
      }
    }
  }
  return failures;
}

function parseToolsList() {
  const manifestPath = path.join(SRC_DIR, 'mcp_tool_manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  return (manifest.tools || []).map(t => t.name);
}

function parseToolNamesFromRouter(routerPath) {
  const content = fs.readFileSync(routerPath, 'utf-8');
  const start = content.indexOf('const TOOL_HANDLERS = {');
  const end = content.indexOf('};', start);
  const block = content.slice(start, end);
  const matches = [];
  const re = /^\s{2}([a-z_]+):/gm;
  let m;
  while ((m = re.exec(block)) !== null) {
    matches.push(m[1]);
  }
  return matches;
}

async function run() {
  console.log('Running test_docs_currency tests...');

  const serverJsPath = path.join(SRC_DIR, 'server.js');
  const routerPath = path.join(SRC_DIR, 'file_tools_router.js');

  const actualTools = parseToolsList();
  const actualFileTools = parseToolNamesFromRouter(routerPath);

  assert.strictEqual(actualTools.length, 44, `Expected 44 manifest-backed tools, found ${actualTools.length}`);
  assert.deepStrictEqual(
    new Set(actualTools),
    new Set(actualFileTools),
    'Manifest tools and router tools must match'
  );

  const serverContent = fs.readFileSync(serverJsPath, 'utf-8');
  assert.ok(serverContent.includes('review'), 'Workflow review gate must be in server.js');
  assert.ok(!actualFileTools.includes('search_file'), 'search_file must not be in file tools router');

  // Check required docs
  const missingDocs = REQUIRED_DOCS.filter(d => !fs.existsSync(path.join(ROOT_DIR, d)));
  assert.strictEqual(missingDocs.length, 0, `Missing required docs: ${missingDocs.join(', ')}`);

  // Check local links
  const brokenLinks = checkLocalLinks();
  assert.strictEqual(brokenLinks.length, 0, `Broken local links found: ${brokenLinks.join(', ')}`);

  // Check README.md
  const readme = fs.readFileSync(path.join(ROOT_DIR, 'README.md'), 'utf-8');
  assert.ok(
    readme.includes('andycungkrinx91.konoha-bridge-master-universal'),
    'README must document master extension path'
  );
  assert.ok(
    !/(?:mirrors?|synced from).*\.cursor\/skills|\.cursor\/skills.*(?:mirrored|synced)/i.test(readme),
    'README must not advertise a Cursor skill mirror'
  );

  // Check ARCHITECTURE.md
  const archContent = fs.readFileSync(path.join(DOC_DIR, 'ARCHITECTURE.md'), 'utf-8');
  const expectedTools = [
    'find_skill', 'list_skills', 'get_skill', 'optimize_report',
    'build_with_image_design', 'build_from_source', 'build_from_text', 'web_search',
    'website_ai_detector',
    'sannin', 'kage', 'jonin', 'anbu', 'chunin', 'tokubetsu_jonin', 'genin'
  ];
  for (const t of expectedTools) {
    assert.ok(archContent.includes(t), `ARCHITECTURE.md missing tool: ${t}`);
  }

  const expectedAgents = ['kage', 'jonin', 'anbu', 'chunin', 'tokubetsu-jonin', 'genin', 'sannin'];
  for (const a of expectedAgents) {
    assert.ok(archContent.toLowerCase().includes(a), `ARCHITECTURE.md missing agent: ${a}`);
  }

  // Check BENCHMARK.md
  const benchContent = fs.readFileSync(path.join(DOC_DIR, 'BENCHMARK.md'), 'utf-8');
  assert.ok(benchContent.length >= 500, 'BENCHMARK.md seems too short');

  // Check TROUBLESHOOTING.md
  const troubleContent = fs.readFileSync(path.join(DOC_DIR, 'TROUBLESHOOTING.md'), 'utf-8');
  const knownSections = ['database', 'bridge', 'indexing', 'skill', 'agent'];
  for (const s of knownSections) {
    assert.ok(troubleContent.toLowerCase().includes(s), `TROUBLESHOOTING.md missing section: ${s}`);
  }

  // Check SETUP-IDE.md & SETUP-CURSOR.md
  for (const f of ['SETUP-IDE.md', 'SETUP-CURSOR.md']) {
    const content = fs.readFileSync(path.join(DOC_DIR, f), 'utf-8');
    for (const t of ['read_file_head', 'read_file_range', 'file_info', 'token_efficient_grep']) {
      assert.ok(content.includes(t), `${f} missing tool: ${t}`);
    }
  }

  console.log('✓ All documentation is consistent with source code.');
}

if (require.main === module) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run };
