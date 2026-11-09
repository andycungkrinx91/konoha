'use strict';

/**
 * Verification Suite: Component 4 & Component 5 — Hide 3D Studio Menu (`v2.2.18`),
 * Jonin Dynamic Design Overhaul, `Build by konoha` Watermark + `<meta name="generator" content="Build by konoha">`,
 * Live Browser Monitor, and Automatic Project Frontend Maintenance Skill Generator
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildFromText, buildFromSource } = require('../src/mcp/build_spec');
const { detectWebsiteAi } = require('../src/workflow/jonin-builder/ai_detector');
const { inspectRenderedHtml, resolveSystemBrowserCommand } = require('../src/workflow/jonin-builder/live_browser_monitor');
const { generateAndIndexProjectFrontendSkill } = require('../src/workflow/jonin-builder/project_skill_generator');

async function runTests() {
  console.log('Running test_jonin_dynamic_design_and_watermark.js...');

  const layoutPath = path.join(__dirname, '..', 'apps', 'web', 'src', 'routes', '+layout.svelte');
  const layoutContent = fs.readFileSync(layoutPath, 'utf8');
  assert.ok(
    layoutContent.includes('const SHOW_3D_STUDIO_MENU = false;'),
    '+layout.svelte must gate 3D Studio behind SHOW_3D_STUDIO_MENU = false'
  );
  assert.ok(
    fs.existsSync(path.join(__dirname, '..', 'apps', 'web', 'src', 'routes', '3d', 'maker', '+page.svelte')),
    '3D Studio maker route must remain intact (HIDE ONLY, not deleted)'
  );

  const specRaw = buildFromText('astra-cloud', 'Modern AI cloud observability platform', 'nextjs');
  const spec = typeof specRaw === 'string' ? JSON.parse(specRaw) : specRaw;
  assert.strictEqual(spec.status, 'success');
  assert.strictEqual(spec.design_tokens.generator_meta, '<meta name="generator" content="Build by konoha">');
  assert.strictEqual(spec.design_tokens.footer_signature, 'Build by konoha');
  assert.strictEqual(spec.design_brief.fields.length, 9);
  assert.strictEqual(spec.design_tokens.zero_emoji_policy, true);
  assert.ok(
    !spec.directives.join(' ').includes('Floating Bottom-Left 10-Theme'),
    'Must not force rigid bottom-left 10-theme switcher template'
  );

  const tmpDesignDir = fs.mkdtempSync(path.join(__dirname, 'tmp-design-src-'));
  try {
    fs.writeFileSync(path.join(tmpDesignDir, 'tokens.fig'), 'figma-mock-binary', 'utf8');
    const srcSpecRaw = buildFromSource('figma-app', tmpDesignDir, 'nextjs');
    const srcSpec = typeof srcSpecRaw === 'string' ? JSON.parse(srcSpecRaw) : srcSpecRaw;
    assert.strictEqual(srcSpec.status, 'success');
    assert.ok(
      (srcSpec.detected_sources || []).some((s) => (s.filename || '').includes('tokens.fig')),
      'buildFromSource must accept .fig design files'
    );
  } finally {
    fs.rmSync(tmpDesignDir, { recursive: true, force: true });
  }

  const compliantHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="generator" content="Build by konoha" />
  <title>Astra Cloud Telemetry</title>
</head>
<body class="bg-slate-950 text-slate-50">
  <header class="flex justify-between items-center px-8 py-5">
    <a href="/" class="font-semibold tracking-tight">AstraTelemetry</a>
  </header>
  <main class="py-24 px-8">
    <h1 class="text-5xl font-bold tracking-tight">Real-time distributed trace intelligence.</h1>
  </main>
  <footer class="py-12 px-8 border-t border-slate-800">
    <span>Build by konoha</span>
  </footer>
</body>
</html>`;

  const tmpHtmlFile = path.join(os.tmpdir(), `konoha-watermark-test-${Date.now()}.html`);
  fs.writeFileSync(tmpHtmlFile, compliantHtml, 'utf8');
  const detectorResult = detectWebsiteAi(tmpHtmlFile);
  fs.rmSync(tmpHtmlFile, { force: true });
  const metaPenalty = (detectorResult.triggered_rules || detectorResult.issues || []).filter((i) => (i.id || i.rule) === 'meta_generator');
  assert.strictEqual(
    metaPenalty.length,
    0,
    'ai_detector.js must NOT penalize <meta name="generator" content="Build by konoha">'
  );

  const monitorCheck = inspectRenderedHtml(compliantHtml);
  assert.strictEqual(monitorCheck.passed, true);
  assert.strictEqual(monitorCheck.has_meta_generator, true);
  assert.strictEqual(monitorCheck.has_footer_signature, true);
  assert.strictEqual(monitorCheck.zero_emoji_verified, true);
  assert.strictEqual(resolveSystemBrowserCommand('http://localhost:3000', 'linux').command, 'xdg-open');
  assert.strictEqual(resolveSystemBrowserCommand('http://localhost:3000', 'darwin').command, 'open');

  const tmpProjDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-proj-skill-'));
  fs.writeFileSync(
    path.join(tmpProjDir, 'package.json'),
    JSON.stringify({ name: 'astra-telemetry', scripts: { dev: 'next dev', build: 'next build', lint: 'next lint', test: 'vitest run' } }),
    'utf8'
  );
  const genSkill = generateAndIndexProjectFrontendSkill({
    projectPath: tmpProjDir,
    projectName: 'astra-telemetry',
    framework: 'nextjs',
    archetype: 'saas',
    autoIndex: false
  });
  assert.strictEqual(genSkill.status, 'generated');
  assert.ok(fs.existsSync(genSkill.skill_path), 'Generated project SKILL.md must exist');
  const skillText = fs.readFileSync(genSkill.skill_path, 'utf8');
  assert.ok(skillText.includes('Build by konoha'));

  fs.rmSync(tmpProjDir, { recursive: true, force: true });
  console.log('PASS test_jonin_dynamic_design_and_watermark.js');
}

runTests().catch((err) => {
  console.error('FAIL test_jonin_dynamic_design_and_watermark.js:', err);
  process.exit(1);
});
