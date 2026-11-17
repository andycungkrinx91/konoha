// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

console.log('Running test_dependency_posture: supply-chain invariants...');

const pkg = JSON.parse(read('package.json'));
const lock = read('pnpm-lock.yaml');
const workspace = read('pnpm-workspace.yaml');

// lodash must be gone. It only ever reached the tree through xlsx-populate, where it
//    was replaced by an in-patch shim; `template` was the eval sink Socket flagged.
assert.ok(!/^\s{2}lodash@/m.test(lock), 'pnpm-lock.yaml must not resolve any lodash version');
assert.ok(!lock.includes('/lodash/'), 'pnpm-lock.yaml must not reference a lodash package path');
assert.ok(!(pkg.dependencies || {}).lodash && !(pkg.devDependencies || {}).lodash, 'lodash must not be a direct dependency');
console.log('  ok   lodash absent from manifest and lockfile');

// xlsx-populate ships as a pnpm patch that drops lodash and the prebuilt browser bundle.
assert.ok(
  /"?xlsx-populate@1\.21\.0"?:\s*"?patches\/xlsx-populate@1\.21\.0\.patch"?/.test(workspace),
  'pnpm-workspace.yaml must register the xlsx-populate patch'
);
const patch = read('patches/xlsx-populate@1.21.0.patch');
assert.ok(/^\+'use strict';/m.test(patch) || patch.includes('lodash-lite'), 'patch must add the lodash-lite shim');
assert.ok(/^-\s+"lodash":/m.test(patch), 'patch must remove the lodash dependency');
assert.ok(/^-\s+"browser":/m.test(patch), 'patch must remove the browser bundle entry point');
assert.ok(/^deleted file mode/m.test(patch), 'patch must delete the prebuilt browser bundle');
console.log('  ok   xlsx-populate patch removes lodash and the browser bundle');

// The installed trees must match the patches. Three transitive or bundled packages ship
//    browser builds whose `setImmediate` polyfill calls `new Function(""+e)`; Konoha only ever
//    loads the Node entry points, so the patches delete those builds. A stale node_modules after
//    a patch edit re-ships them, so assert the resolved trees, not just the patch files.
// A path "ships" only if something regular lives at or under it. pnpm prunes
// emptied directories on Linux but not on Windows, so an `existsSync` check on
// a directory reports a false positive there.
function shipsAnyFile(target) {
  let st;
  try {
    st = fs.lstatSync(target);
  } catch (_) {
    return false;
  }
  if (!st.isDirectory()) return true;
  return fs.readdirSync(target, { withFileTypes: true }).some((entry) => shipsAnyFile(path.join(target, entry.name)));
}

const BUNDLED_SINKS = {
  pptxgenjs: ['dist/pptxgen.bundle.js', 'dist/pptxgen.bundle.js.map'],
  'xlsx-populate': ['browser', 'examples'],
  // pnpm leaves an empty `dist/` after the patch deletes its two files; the sink is the files.
  jszip: ['dist/jszip.js', 'dist/jszip.min.js']
};
for (const [pkg, entries] of Object.entries(BUNDLED_SINKS)) {
  // jszip is transitive: it has no root link, so resolve it the way its consumers do.
  const link = path.join(ROOT, 'node_modules', pkg);
  const root = fs.existsSync(link)
    ? fs.realpathSync(link)
    : path.dirname(require.resolve(`${pkg}/package.json`, {
        paths: [fs.realpathSync(path.join(ROOT, 'node_modules', 'xlsx-populate'))]
      }));
  assert.ok(fs.existsSync(path.join(root, 'package.json')), `${pkg} must be installed to validate its shipped tree`);
  for (const entry of entries) {
    // pnpm removes the deleted files but may leave the now-empty parent
    // directory behind — on Windows it does, on Linux it prunes. An empty
    // directory ships nothing, so the claim is "no file survives here".
    assert.ok(!shipsAnyFile(path.join(root, entry)), `${pkg}/${entry} must not ship: it carries an eval sink or is dead weight`);
  }
}

// The path list above only covers the bundles that were there when this test was written.
// A new transitive dependency can ship a sink anywhere under node_modules and no fixed path
// would notice, so walk what actually ships and match the patterns directly.
const SINK_PATTERN = /(^|[^A-Za-z0-9_.$])Function\s*\(|(^|[^A-Za-z0-9_.$])eval\s*\(|require\(\s*['"]vm['"]\s*\)|runIn(New)?Context\s*\(/;
const SCRIPT_EXT = /\.(js|cjs|mjs)$/;
function walkScripts(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkScripts(full, out);
    else if (SCRIPT_EXT.test(entry.name)) out.push(full);
  }
  return out;
}
for (const pkg of Object.keys(BUNDLED_SINKS)) {
  const link = path.join(ROOT, 'node_modules', pkg);
  if (!fs.existsSync(link)) continue;
  for (const file of walkScripts(fs.realpathSync(link))) {
    const hit = SINK_PATTERN.exec(fs.readFileSync(file, 'utf8'));
    assert.ok(!hit, `${path.relative(ROOT, file)} must not ship a dynamic-execution sink (found ${hit && hit[0].trim()})`);
  }
}
for (const [pkg, patchFile] of [
  ['pptxgenjs@4.0.1', 'patches/pptxgenjs@4.0.1.patch'],
  ['jszip@3.10.2', 'patches/jszip@3.10.2.patch']
]) {
  assert.ok(workspace.includes(patchFile), `pnpm-workspace.yaml must register ${pkg} -> ${patchFile}`);
  assert.ok(/^deleted file mode/m.test(read(patchFile)), `${patchFile} must delete the browser build`);
}
console.log('  ok   bundled packages ship no browser bundle or eval sink');

// The emitted hook payloads must not rebuild their guardrail checker with new Function().
assert.ok(!/new Function\(/.test(read('src/mcp_clients/command_code.js')), 'command_code hook must not use new Function');
assert.ok(!/new Function\(/.test(read('src/mcp_clients/claude_code_hooks.js')), 'claude_code hook must not use new Function');
assert.ok(!/new Function\(/.test(read('src/pi_blocker_template.js')), 'pi blocker template must not use new Function');
console.log('  ok   no dynamic execution in emitted hook payloads');

// Install scripts stay denied for native packages that fetch unverified binaries.
assert.ok(/allowBuilds:/.test(workspace), 'pnpm-workspace.yaml must declare allowBuilds');
assert.ok(/onnxruntime-node:\s*false/.test(workspace), 'onnxruntime-node postinstall must stay denied');
console.log('  ok   onnxruntime-node postinstall denied');

// Exact pins for every bundled or patched dependency, so a publish cannot drift.
for (const dep of ['xlsx-populate', 'pptxgenjs', 'cfb', 'docx', 'playwright', 'hash-wasm']) {
  const range = (pkg.dependencies || {})[dep];
  assert.ok(range, `${dep} must be a declared dependency`);
  assert.ok(
    /^\d+\.\d+\.\d+$/.test(range),
    `${dep} must be pinned to an exact version, found "${range}"`
  );
}
console.log('  ok   bundled and patched dependencies pinned exactly');

// Publishing must install from the lockfile: no silent resolution drift at release time.
const publish = read('.github/workflows/publish.yml');
assert.ok(
  /run:\s*pnpm install --frozen-lockfile\b/.test(publish),
  'publish workflow must install with --frozen-lockfile'
);
assert.ok(!publish.includes('--no-frozen-lockfile'), 'publish workflow must not use --no-frozen-lockfile');
console.log('  ok   publish installs from the frozen lockfile');

// The dead isarray override must point at a real, current registry package. Only
//    pnpm-workspace.yaml carries it: package.json#overrides is limited to the pins
//    npm and Socket read, and duplicating it there fails test_pnpm_config_migration.
assert.ok(
  /"?isarray"?:\s*"?npm:@socketregistry\/isarray@1\.0\.8"?/.test(workspace),
  'isarray override must resolve to @socketregistry/isarray@1.0.8'
);
assert.ok(!/isarray@1\.0\.7/.test(lock) && !/isarray@1\.0\.7/.test(workspace), 'no stale isarray@1.0.7 override');
console.log('  ok   isarray override current');

console.log('\nAll test_dependency_posture checks passed successfully!');
