#!/usr/bin/env node
'use strict';

/**
 * Guards the two HIGH `image-size` CVEs (CVE-2025-71330, CVE-2025-71329).
 *
 * Both live in `image-size < 2.0.3` and reach this repo only as a transitive of
 * `pptxgenjs`. npm/pnpm cannot repair it from a shipped `overrides` block alone
 * (proven: npm ignores `overrides` in an installed package), so the fix is
 * three-layered and all three layers are asserted here:
 *
 *   1. `package.json` declares `overrides.image-size >= 2.0.3` for contributor trees.
 *      `pnpm-workspace.yaml` keeps `>=2.0.4`, which pnpm actually applies.
 *   2. `patches/pptxgenjs@4.0.1.patch` rewrites pptxgenjs's own dependency spec,
 *      so pnpm installs a compliant version instead of `^1.2.1`.
 *   3. The installed tree resolves to a compliant version.
 *
 * Also asserts the pptx path still WORKS at that version — `image-size` 2.x is a
 * major bump, and a passing resolver with a broken PPTX export is not a fix.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PATCHED_MIN = [2, 0, 3];

function parseVersion(v) {
  return String(v).split(/[.\-+]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
}

function atLeast(version, minimum) {
  const a = parseVersion(version);
  for (let i = 0; i < 3; i++) {
    if (a[i] > minimum[i]) return true;
    if (a[i] < minimum[i]) return false;
  }
  return true;
}

function check() {
  console.log('Running test_image_size_override...');

  // Root override present and compliant. pnpm-workspace.yaml is the real
  // authority (>=2.0.4); package.json carries the plan-mandated >=2.0.3 floor.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const override = pkg.overrides && pkg.overrides['image-size'];
  assert.ok(override, 'package.json must declare overrides["image-size"]');
  const floor = parseVersion(String(override).replace(/[^\d.]/g, ''));
  assert.ok(atLeast(floor.join('.'), PATCHED_MIN), `override "${override}" must floor at >= 2.0.3`);
  console.log(`  ok   root override floors image-size at ${override}`);

  // The shipped patch rewrites pptxgenjs's own spec.
  const patchPath = path.join(ROOT, 'patches', 'pptxgenjs@4.0.1.patch');
  const patch = fs.readFileSync(patchPath, 'utf8');
  const plus = patch.split('\n').filter((l) => l.startsWith('+') && l.includes('"image-size"'));
  const minus = patch.split('\n').filter((l) => l.startsWith('-') && l.includes('"image-size"'));
  assert.ok(plus.length > 0, 'patch must add a compliant image-size spec');
  assert.ok(
    plus.some((l) => l.includes('>=2.0.3')),
    `patch plus-side must pin >= 2.0.3, saw: ${plus.join(' | ')}`
  );
  // The minus side must stay at the registry's value or hunk #1 stops applying.
  assert.ok(
    minus.some((l) => l.includes('^1.2.1')),
    `patch minus-side must remain ^1.2.1 (hunk context), saw: ${minus.join(' | ')}`
  );
  console.log('  ok   pptxgenjs patch rewrites the spec to >= 2.0.3');

  // The installed tree is compliant, whichever package manager laid it down.
  let installed = null;
  try {
    installed = require('image-size/package.json').version;
  } catch (_) {
    /* resolved through the package manager below */
  }
  if (!installed) {
    try {
      const lock = fs.readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8');
      const m = lock.match(/\n\s*image-size@(\d+\.\d+\.\d+)/);
      assert.ok(m, 'pnpm-lock.yaml must pin a concrete image-size version');
      installed = m[1];
    } catch (err) {
      assert.fail(`cannot determine installed image-size version: ${err.message}`);
    }
  }
  assert.ok(
    atLeast(installed, PATCHED_MIN),
    `installed image-size ${installed} is inside the CVE range (< 2.0.3)`
  );
  console.log(`  ok   resolved image-size ${installed} is outside the CVE range`);

  // Lockfiles must not re-pin a vulnerable version.
  const lock = fs.readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8');
  const pinned = [...lock.matchAll(/image-size@(\d+\.\d+\.\d+)/g)].map((m) => m[1]);
  for (const v of new Set(pinned)) {
    assert.ok(atLeast(v, PATCHED_MIN), `pnpm-lock.yaml pins vulnerable image-size ${v}`);
  }
  console.log(`  ok   pnpm-lock.yaml has no vulnerable pins (${[...new Set(pinned)].join(', ')})`);

  // No package-lock.json back door: npm cannot express the patched tree, so
  //    the file is intentionally absent rather than silently stale.
  assert.ok(
    !fs.existsSync(path.join(ROOT, 'package-lock.json')),
    'package-lock.json must stay absent: npm records pptxgenjs\'s registry spec ^1.2.1 and flags 2.1.0 invalid'
  );
  console.log('  ok   no stale npm lockfile');

  console.log('All image-size override checks passed');
}

async function checkPptxStillWorks() {
  // Resolution alone is not proof: image-size 2.x is a major bump and pptxgenjs
  // calls into it for every embedded image. Round-trip a real deck.
  const os = require('os');
  const { execFileSync } = require('child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_pptx_'));
  const out = path.join(tmp, 'probe.pptx');
  const script = `
    const PptxGenJS = require(${JSON.stringify(path.join(ROOT, 'node_modules', 'pptxgenjs'))});
    const fs = require('fs');
    const p = new PptxGenJS();
    p.defineLayout({ name: 'W', width: 13.33, height: 7.5 });
    p.layout = 'W';
    const s = p.addSlide();
    // 1x1 transparent PNG — exercises image-size's parsing path.
    s.addImage({ data: 'image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', x: 0, y: 0, w: 1, h: 1 });
    s.addText('probe', { x: 1, y: 1, w: 4, h: 1 });
    p.writeFile({ fileName: ${JSON.stringify(out)} }).then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
  `;
  try {
    execFileSync(process.execPath, ['-e', script], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    const size = fs.statSync(out).size;
    assert.ok(size > 5000, `PPTX export produced suspiciously small file (${size} bytes)`);
    assert.strictEqual(
      fs.readFileSync(out).subarray(0, 2).toString(),
      'PK',
      'PPTX output must be a zip container'
    );
    console.log(`  ok   PPTX export with an embedded image succeeds (${size} bytes)`);
    console.log('All pptx/image-size compatibility checks passed');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

check();
checkPptxStillWorks().catch((err) => {
  console.error(`FAIL pptx/image-size compatibility: ${err.message}`);
  process.exit(1);
});