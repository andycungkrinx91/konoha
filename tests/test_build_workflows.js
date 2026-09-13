#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
require('./helpers/isolate_db');
const server = require('../src/server');

async function run() {
  console.log('Running test_build_workflows tests...');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_bw_'));
  const prevRoot = server.WORKSPACE_ROOT;
  server.WORKSPACE_ROOT = tmp;

  try {
    // 1. Text contract covers all frameworks
    for (const framework of ['nextjs', 'nuxt', 'sveltekit', 'angular']) {
      const result = JSON.parse(server.buildFromText('demo-app', 'Premium dashboard', framework, null, { design_variance: 9, motion_intensity: 8, visual_density: 4 }));
      assert.strictEqual(result.status, 'success');
      assert.strictEqual(result.framework, framework);
      assert.strictEqual(result.archetype, 'dashboard');
      assert.deepStrictEqual(result.taste_dials, { design_variance: 9, motion_intensity: 8, visual_density: 4 });
      assert.strictEqual(result.design_tokens.hero_autoplay, '6000ms');
      assert.ok(result.taste_skill_audits.includes('em_dash'));
      assert.ok(result.embedded_skill_content);
      assert.ok(result.validation_commands);
      assert.ok(result.directives.some(d => d.includes('pnpm')));
    }
    console.log('✓ Text contract covers all frameworks passed');

    // 2. Text build only adds commerce features for commerce
    const landing = JSON.parse(server.buildFromText('landing', 'A one-page marketing landing page', 'nextjs'));
    assert.strictEqual(landing.archetype, 'landing');
    const landingDirectives = landing.directives.join(' ');
    assert.strictEqual(landingDirectives.includes('50-item production catalog'), false);

    const commerce = JSON.parse(server.buildFromText('store', 'An e-commerce online store with checkout', 'nextjs'));
    assert.strictEqual(commerce.archetype, 'commerce');
    assert.ok(commerce.directives.join(' ').includes('50-item production catalog'));
    console.log('✓ Text build archetype directives passed');

    // 3. Source contract detects framework files without writing
    const source = path.join(tmp, 'source');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'page.vue'), "<script setup>definePageMeta({ layout: 'default' })</script><template><main /></template>", 'utf8');
    fs.writeFileSync(path.join(source, 'page.svelte'), "<script>import { goto } from '$app/navigation';</script><main>hello</main>", 'utf8');
    fs.writeFileSync(path.join(source, 'page.tsx'), "export default function Page() { return <main aria-label='page' /> }", 'utf8');
    fs.writeFileSync(path.join(source, 'app.component.ts'), "@Component({ standalone: true }) export class AppComponent { value = signal(1); }", 'utf8');

    const before = fs.readdirSync(source);
    const result = JSON.parse(server.buildFromSource('demo-app', source, 'nuxt', null, { design_variance: 7 }));
    const after = fs.readdirSync(source);
    assert.strictEqual(result.status, 'success');
    assert.deepStrictEqual(before, after);

    const sources = {};
    for (const item of result.detected_sources) {
      sources[item.filename] = item;
    }
    assert.ok(sources['page.vue']);
    assert.ok(sources['page.vue'].framework_hints.includes('nuxt'));
    assert.ok(sources['page.svelte'].framework_hints.includes('sveltekit'));
    assert.ok(sources['page.tsx'].framework_hints.includes('nextjs'));
    assert.ok(sources['app.component.ts'].framework_hints.includes('angular'));
    assert.ok(sources['page.tsx'].content_excerpt);
    assert.strictEqual(sources['page.tsx'].sha256.length, 64);
    assert.ok(result.source_fidelity);
    assert.ok(result.premium_effects_policy.includes('do not inject generic'));
    assert.ok(result.directives.join('\n').includes('DESIGN_VARIANCE=7/10'));
    console.log('✓ Source contract detects framework files passed');

    // 4. Invalid framework and dials are rejected
    assert.ok(JSON.parse(server.buildFromText('demo', 'x', 'solid')).error.includes('framework must be one of'));
    assert.ok(JSON.parse(server.buildFromText('demo', 'x', 'next', null, { design_variance: 11 })).error.includes('design_variance'));
    console.log('✓ Invalid input validation passed');

    // 5. Source path cannot escape workspace
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_out_'));
    try {
      const res = JSON.parse(server.buildFromSource('demo', outside, 'next'));
      assert.ok(res.error.includes('outside workspace'));
      console.log('✓ Source path workspace guard passed');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }

    console.log('\nAll test_build_workflows passed cleanly!');
  } finally {
    server.WORKSPACE_ROOT = prevRoot;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
