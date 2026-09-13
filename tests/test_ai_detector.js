#!/usr/bin/env node
// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

/**
 * tests/test_ai_detector.js — Verifies the website AI-fingerprint detector
 * (src/ai_detector.js): scoring on AI-scaffolded fixtures, clean human-built
 * fixtures, URL mode against a local HTTP server, error handling, and the
 * MCP wrapper contract.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const assert = require('assert');

const { detectWebsiteAi, detectWebsiteAiAsync, evaluateRules, classify } = require('../src/ai_detector');

let passed = 0;
let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function write(fp, content) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, 'utf-8');
}

function buildAiSite(dir) {
  write(path.join(dir, 'package.json'), JSON.stringify({
    name: 'ai-site', dependencies: { 'lucide-react': '^1.16.0', clsx: '^2.1.0', 'tailwind-merge': '^2.0.0' }
  }, null, 2));
  write(path.join(dir, 'components', 'ui', 'button.tsx'),
    'import { cn } from "@/lib/utils";\nexport function Button({ className }) { return <button className={cn("px-4", className)} /> }');
  write(path.join(dir, 'app', 'page.tsx'),
    'import { Palette } from "lucide-react";\nimport { Button } from "@/components/ui/button";\nexport default function Page() { return <main><Palette /><Button>Hi</Button></main>; }');
  write(path.join(dir, 'app', 'layout.tsx'),
    '<meta name="generator" content="Next.js" />');
  write(path.join(dir, 'public', 'og-image.png'), 'fake');
  write(path.join(dir, '.vercel', 'project.json'), '{}');
}

function buildHumanSite(dir) {
  write(path.join(dir, 'index.html'), `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Atelier Greyson — Furniture Studio</title>
  <link rel="stylesheet" href="/assets/atelier-greyson-main.css">
  <link rel="icon" href="/assets/favicon-atelier.svg">
  <meta property="og:image" content="/assets/social-preview-copenhagen.jpg">
</head>
<body>
  <header><a href="/" class="brand-mark">Atelier Greyson</a></header>
  <main><h1>Furniture, built slowly.</h1><p>Workshop notes from Copenhagen.</p></main>
</body>
</html>`);
  write(path.join(dir, 'assets', 'atelier-greyson-main.css'), '.brand-mark { font-family: Georgia, serif; }');
  write(path.join(dir, 'assets', 'favicon-atelier.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
}

(async () => {
  console.log('Website AI detector tests\n=========================\n');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-ai-detector-'));

  // T1: AI-scaffolded site scores high with the expected findings.
  const aiSite = path.join(tmp, 'ai-site');
  buildAiSite(aiSite);
  const r1 = detectWebsiteAi(aiSite);
  check('T1 returns result object', !r1.error, JSON.stringify(r1.error || ''));
  const rules1 = r1.findings.map((f) => f.rule);
  check('T1 score in AI band', r1.score > 40, `score=${r1.score}`);
  check('T1 GEN-01 generator tag detected', rules1.includes('GEN-01'));
  check('T1 ICON-01 lucide dependency detected', rules1.includes('ICON-01'));
  check('T1 UI-01 shadcn shape detected', rules1.includes('UI-01'));
  check('T1 HOST-01 vercel signal detected', rules1.includes('HOST-01'));
  check('T1 ASSET-01 generic og-image.png detected', rules1.includes('ASSET-01'));
  check('T1 stats populated', r1.stats.files_scanned >= 4 && r1.stats.elapsed_ms >= 0);
  check('T1 label matches score band', r1.label === classify(r1.score));

  // T2: hand-built site stays in the Human-Built band.
  const humanSite = path.join(tmp, 'human-site');
  buildHumanSite(humanSite);
  const r2 = detectWebsiteAi(humanSite);
  check('T2 no error', !r2.error);
  check('T2 score within Human-Built band', r2.score <= 20, `score=${r2.score} findings=${JSON.stringify(r2.findings)}`);
  check('T2 verdict PASS', r2.verdict.startsWith('PASS'));
  check('T2 zero findings', r2.findings.length === 0, JSON.stringify(r2.findings.map((f) => f.rule)));

  // T3: error handling.
  const r3a = detectWebsiteAi(path.join(tmp, 'does-not-exist'));
  check('T3 missing target errors', typeof r3a.error === 'string');
  const r3b = detectWebsiteAi('');
  check('T3 empty target errors', typeof r3b.error === 'string');
  const r3c = detectWebsiteAi('https://example.com');
  check('T3 sync URL target rejected (use async)', typeof r3c.error === 'string');

  // T4: URL mode against a local server serving an AI-fingerprinted page.
  const servedHtml = `<!doctype html><html><head>
    <meta name="generator" content="v0.dev">
    <title>Create Next App</title>
    <script src="/_next/static/chunks/main.js"></script>
  </head><body><i data-lucide="palette"></i><!-- Built with v0 --></body></html>`;
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.setHeader('x-vercel-id', 'iad1::test');
    res.end(servedHtml);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const r4 = await detectWebsiteAiAsync(`http://127.0.0.1:${port}/`);
  server.close();
  check('T4 url mode returns result', !r4.error, JSON.stringify(r4.error || ''));
  check('T4 url mode mode=url', r4.mode === 'url');
  const rules4 = r4.findings.map((f) => f.rule);
  check('T4 GEN-01 via url', rules4.includes('GEN-01'));
  check('T4 ATTR-01 attribution comment via url', rules4.includes('ATTR-01'));
  check('T4 ICON-01 data-lucide via url', rules4.includes('ICON-01'));
  check('T4 HOST-01 vercel header via url', rules4.includes('HOST-01'));
  check('T4 score high', r4.score > 40, `score=${r4.score}`);

  // T5: URL fetch failure is a clean error.
  const r5 = await detectWebsiteAiAsync('http://127.0.0.1:1/nope');
  check('T5 url failure errors cleanly', typeof r5.error === 'string' && r5.error.includes('URL scan failed'));

  // T6: evaluateRules is pure and bounded.
  const r6 = evaluateRules({ html: [], sources: [], packageJsons: [], assets: [], componentUiDirs: [], vercelDir: null });
  check('T6 empty context scores 0', r6.score === 0 && r6.findings.length === 0);

  // T7: classify bands.
  check('T7 classify 0', classify(0) === 'Human-Built');
  check('T7 classify 20', classify(20) === 'Human-Built');
  check('T7 classify 21', classify(21) === 'Likely Human-Built');
  check('T7 classify 41', classify(41) === 'AI-Assisted Build');
  check('T7 classify 100', classify(100) === 'AI-Generated');

  // T8: MCP wrapper contract (via tool_dispatch path used by clients).
  const { _executeToolInternal } = require('../src/mcp/tool_dispatch');
  const r8 = JSON.parse(_executeToolInternal('website_ai_detector', { target: aiSite }, 'kage'));
  check('T8 MCP dispatch returns detector result', r8.score !== undefined && Array.isArray(r8.findings));
  check('T8 MCP dispatch scores AI site high', r8.score > 40, `score=${r8.score}`);
  const r8b = JSON.parse(_executeToolInternal('website_ai_detector', {}, 'kage'));
  check('T8 MCP dispatch validates missing target', typeof r8b.error === 'string');

  // T9: directory scan skips node_modules.
  write(path.join(aiSite, 'node_modules', 'lucide-react', 'package.json'), '{"name":"lucide-react"}');
  const r9 = detectWebsiteAi(aiSite);
  check('T9 node_modules skipped (no duplicate findings)', r9.findings.filter((f) => f.rule === 'ICON-01').length === 1);

  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
