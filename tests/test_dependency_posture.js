// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
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
  jszip: ['dist/jszip.js', 'dist/jszip.min.js'],
  // Upstream ships a scraper that fetches remote code and runs it in node:vm (Socket finding,
  // konoha-mcp@2.2.23). Konoha imports only cl100k_base encoding; the scraper is unreachable
  // from our runtime graph and is removed from the installed/published tree.
  'gpt-tokenizer': ['src/scraper']
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
  ['jszip@3.10.2', 'patches/jszip@3.10.2.patch'],
  ['gpt-tokenizer@4.1.0', 'patches/gpt-tokenizer@4.1.0.patch']
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

// Copyleft packages may exist in the resolved tree only when this allowlist names
//    them and NOTICE explains them. Nothing here is bundled into the published
//    tarball; the point of the gate is that a new copyleft package cannot arrive
//    silently through a transitive dependency, which is what moved the Socket
//    license score from 100 to 90 (see NOTICE, "Copyleft in the install graph").
// `sharp`'s prebuilt binaries are split per platform, and the declared license
//    differs between them: the Windows builds state `Apache-2.0 AND
//    LGPL-3.0-or-later`, while the Linux and macOS builds state `Apache-2.0` for
//    the same libvips payload. Both halves are the same dependency, so one
//    prefix covers every host instead of an allowlist that only passes on Linux.
// The prefix is not a blank cheque: each family pins the expressions reviewed
//    for it, so a new package arriving under `@img/sharp-` with a different
//    licence still fails the gate instead of inheriting the exemption.
const COPYLEFT_ALLOWLIST = [
  { prefix: '@img/sharp-', licenses: [
    'LGPL-3.0-OR-LATER',
    'APACHE-2.0 AND LGPL-3.0-OR-LATER',
    // wasm32 builds only; published but never installed on a CI host.
    'APACHE-2.0 AND LGPL-3.0-OR-LATER AND MIT'
  ] },
  { prefix: 'lightningcss', licenses: ['MPL-2.0'] }
];
const PERMISSIVE = new Set([
  'MIT', 'ISC', 'BSD-2-CLAUSE', 'BSD-3-CLAUSE', '0BSD', 'APACHE-2.0',
  'BLUEOAK-1.0.0', 'UNLICENSE', 'CC0-1.0', 'ZLIB', 'PYTHON-2.0', 'BSL-1.0'
]);
// An SPDX expression is permissive when any `OR` alternative is entirely permissive,
//    so `(MIT OR GPL-3.0-or-later)` (jszip) and `(MIT AND Zlib)` (pako) both pass.
function isPermissive(expr) {
  return String(expr)
    .toUpperCase()
    .split(/\s+OR\s+/)
    .some((alt) => alt.split(/\s+AND\s+/).every((t) => PERMISSIVE.has(t.replace(/[()]/g, '').trim())));
}
const STORE = path.join(ROOT, 'node_modules', '.pnpm');

/** Package directories reachable from one store entry's node_modules. */
function packageDirsIn(nodeModules) {
  const dirs = [];
  for (const name of fs.readdirSync(nodeModules)) {
    if (name.startsWith('.')) continue;
    if (!name.startsWith('@')) {
      dirs.push({ name, dir: path.join(nodeModules, name) });
      continue;
    }
    const scope = path.join(nodeModules, name);
    if (!fs.statSync(scope).isDirectory()) continue;
    for (const sub of fs.readdirSync(scope)) dirs.push({ name: `${name}/${sub}`, dir: path.join(scope, sub) });
  }
  return dirs;
}

/**
 * Every installed package whose license is not permissive, each physical
 * directory inspected once.
 *
 * Identity is the realpath, not the spelling of the path: pnpm links a
 * dependency into the node_modules of every package that depends on it, so
 * `sharp`'s platform binary is reachable both from its own store entry and from
 * the `@img` link inside each dependent's store entry. Counting those as two
 * packages inflated the report on Windows, where the same layout exists with the
 * win32 binary.
 * A package reachable *only* through a link is still inspected: its realpath is
 * evaluated the first time any path reaches it.
 */
function scanCopyleftPackages(storeDir) {
  const found = [];
  const seen = new Set();
  for (const entry of fs.readdirSync(storeDir)) {
    const nm = path.join(storeDir, entry, 'node_modules');
    if (!fs.existsSync(nm)) continue;
    for (const { name, dir } of packageDirsIn(nm)) {
      const manifest = path.join(dir, 'package.json');
      if (!fs.existsSync(manifest)) continue;
      const identity = fs.realpathSync(dir);
      if (seen.has(identity)) continue;
      seen.add(identity);
      const license = JSON.parse(fs.readFileSync(manifest, 'utf8')).license;
      // A missing or non-string license is not evidence of permission, so it fails
      //    the gate the same way an unlisted copyleft expression does.
      if (typeof license !== 'string' || !license.trim()) found.push({ name, license: null });
      else if (!isPermissive(license)) found.push({ name, license });
    }
  }
  return found;
}

const normalizeLicense = (license) => license.toUpperCase().replace(/\s+/g, ' ').trim();

function assertCopyleftAllowlisted() {
  assert.ok(
    fs.existsSync(STORE),
    `the copyleft gate needs a populated ${STORE}; run pnpm install (a missing store must fail, not skip)`
  );
  const found = scanCopyleftPackages(STORE);
  const unlisted = [];
  for (const hit of found) {
    const allowed = COPYLEFT_ALLOWLIST.find((entry) => hit.name.startsWith(entry.prefix));
    const declared = hit.license ? `${hit.name} (${hit.license})` : `${hit.name} (no license field)`;
    if (!allowed) unlisted.push(declared);
    else if (!hit.license || !allowed.licenses.includes(normalizeLicense(hit.license))) {
      unlisted.push(`${declared} — license not reviewed for ${allowed.prefix}`);
    }
  }
  assert.deepStrictEqual(unlisted, [], `unlisted copyleft package(s) in the install tree: ${unlisted.join(', ')}`);
  const notice = read('NOTICE');
  for (const { prefix } of COPYLEFT_ALLOWLIST) {
    assert.ok(
      found.some((hit) => hit.name.startsWith(prefix)),
      `allowlist entry "${prefix}" matches no installed package; drop it or fix the name`
    );
    assert.ok(
      notice.includes(prefix),
      `NOTICE must explain the copyleft package "${prefix}"`
    );
  }
  console.log(`  ok   copyleft confined to the allowlist (${found.length} package(s), all documented in NOTICE)`);
}
assertCopyleftAllowlisted();

// The gate must count a package once per physical directory, and must still see
// a package that is only reachable through a link. Both properties are proven on
// a throwaway store, because the real tree cannot be arranged to have a dangling
// duplicate on demand.
{
  const tmpStore = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_posture_'));
  try {
    const writePkg = (rel, name, license) => {
      const dir = path.join(tmpStore, rel);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, license }), 'utf8');
      return dir;
    };
    // A platform binary in its own store entry, plus the dependent's link to it.
    const own = writePkg(path.join('@img+sharp-win32-x64@0.35.5', 'node_modules', '@img', 'sharp-win32-x64'), '@img/sharp-win32-x64', 'Apache-2.0 AND LGPL-3.0-or-later');
    const dependent = path.join(tmpStore, 'sharp@0.35.5', 'node_modules', '@img');
    fs.mkdirSync(dependent, { recursive: true });
    const ownLink = path.join(dependent, 'sharp-win32-x64');
    fs.symlinkSync(own, ownLink, 'junction');
    // A copyleft package whose real directory sits outside the store, reachable
    // only through a dependent's link: dedupe must not drop it.
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_external_'));
    const externalLink = path.join(tmpStore, 'consumer@1.0.0', 'node_modules', 'hidden');
    try {
      fs.writeFileSync(
        path.join(external, 'package.json'),
        JSON.stringify({ name: 'hidden', license: 'GPL-3.0-only' }),
        'utf8'
      );
      fs.mkdirSync(path.dirname(externalLink), { recursive: true });
      fs.symlinkSync(external, externalLink, 'junction');

      const scanned = scanCopyleftPackages(tmpStore);
      const names = scanned.map((hit) => hit.name);
      assert.deepStrictEqual(
        names.filter((n) => n === '@img/sharp-win32-x64'),
        ['@img/sharp-win32-x64'],
        'a linked duplicate must be inspected once, not reported twice'
      );
      assert.ok(names.includes('hidden'), 'a package reachable only through a link must still be inspected');
      console.log('  ok   store walk dedupes linked duplicates and keeps link-only packages');
    } finally {
      // Unlink the junctions before the recursive delete: a junction resolves to
      // a directory outside the temp store, and removing the tree must never
      // descend through one.
      for (const link of [externalLink, ownLink]) fs.rmSync(link, { force: true });
      fs.rmSync(external, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(tmpStore, { recursive: true, force: true });
  }
}

console.log('\nAll test_dependency_posture checks passed successfully!');
