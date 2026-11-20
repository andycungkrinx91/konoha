// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

/**
 * tests/test_dependency_audit.js — mandatory, deterministic dependency audit.
 *
 * No Socket account, no npx, no CLI install, no network beyond the registry advisory
 * endpoint `pnpm audit` itself queries. The Socket.dev scan lives in
 * `scripts/socket_audit_optional.js` and is opt-in.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const { firstJsonValue } = require('../scripts/lib/audit_json');

const REPO_ROOT = path.resolve(__dirname, '..');
const IS_WIN = process.platform === 'win32';

// On win32 pnpm is a .cmd shim, and Node refuses to spawn those without a shell, so
// execFileSync('pnpm', ...) fails with ENOENT on Windows only. Build the command line
// ourselves and hand it to cmd.exe; elsewhere spawn the binary directly.
function spawnArgs(command, args, options) {
  if (!IS_WIN) return [command, args, options];
  const quote = (value) => (/\s/.test(value) ? `"${value}"` : value);
  return [`${quote(command)} ${args.map(quote).join(' ')}`, undefined, { ...options, shell: true }];
}

// Advisories accepted as mitigated in-tree. An upstream advisory can be withdrawn, or a
// fixed release can ship, and neither is a change this repo made — so *absence* is always
// tolerated. *Presence* is tolerated only while the named patch is on disk and its
// regression proof passes; see assertMitigationProven(). An ignore list would silence a
// second advisory on the same package, so the gate classifies instead of pinning a set.
const APPROVED_MITIGATED_ADVISORIES = new Map([
  [
    'GHSA-fc5q-39xc-vjpf',
    {
      pkg: 'picomatch',
      patch: 'patches/picomatch@4.0.7.patch',
      proof: 'tests/test_picomatch_redos_patch.js',
      note: 'repeated-extglob ReDoS; withdrawn upstream 2026-11-18, no fixed release'
    }
  ]
]);

function classifyAdvisories(observed, approved = APPROVED_MITIGATED_ADVISORIES) {
  const unapproved = observed.filter((id) => !approved.has(id));
  return {
    ok: unapproved.length === 0,
    unapproved,
    mitigated: observed.filter((id) => approved.has(id))
  };
}

// A scan that emits no advisory object, or resolves no dependency, has failed rather than
// found nothing — reading either as "clean" is how a broken audit passes silently.
function parseAuditJson(stdout, scope) {
  const parsed = firstJsonValue(stdout);
  assert.ok(parsed, `${scope} pnpm audit --json produced no JSON:\n${stdout.slice(0, 800)}`);
  assert.ok(
    parsed.advisories && typeof parsed.advisories === 'object',
    `${scope} pnpm audit --json carries no advisories object, so a malformed scan is not a clean scan:\n${stdout.slice(0, 800)}`
  );
  const total = (parsed.metadata && parsed.metadata.totalDependencies) || 0;
  // ponytail: a resolved-tree floor only, never a ceiling — a shrinking tree must not need
  // a test edit, but a scan that resolved nothing must fail.
  assert.ok(total > 0, `${scope} pnpm audit resolved 0 dependencies, so an empty advisory list is a failed scan, not a clean tree`);
  const ids = [...new Set(Object.values(parsed.advisories).map((a) => a.github_advisory_id).filter(Boolean))].sort();
  return { ids, total };
}

// The two scopes audited by the gate. `--dir` would resolve the workspace root and audit
// the whole tree twice, so the package scope is selected with `--filter`.
const AUDIT_SCOPES = [
  { scope: 'root', filterArgs: [] },
  { scope: 'apps/web', filterArgs: ['--filter=./apps/web'] }
];

// The gate cannot resolve an organization, an account tier, or the optional integration.
function auditEnv() {
  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };
  delete env.SOCKET_CLI_API_TOKEN;
  delete env.KONOHA_SOCKET_OPTIONAL_AUDIT;
  return env;
}

function auditInvocation(scan) {
  return { command: 'pnpm', args: [...scan.filterArgs, 'audit', '--json'], cwd: REPO_ROOT };
}

// pnpm audit exits 1 whenever an advisory is present and 0 otherwise, so a wrapper that
// exits 0 while reporting findings would sail past an advisory-set check. execFileSync
// throws on that non-zero exit, so the JSON is recovered from err.stdout.
function auditScan(scan) {
  const inv = auditInvocation(scan);
  let stdout = '';
  let status = 0;
  try {
    stdout = execFileSync(...spawnArgs(inv.command, inv.args, {
      cwd: inv.cwd,
      encoding: 'utf8',
      timeout: 180000,
      env: auditEnv()
    }));
  } catch (err) {
    if (!err.stdout) throw err;
    stdout = err.stdout;
    status = typeof err.status === 'number' ? err.status : 2;
  }
  return { ...scan, stdout, status };
}

// Without these, a scan can be made to pass by pointing it at a subset or at a synthesized
// lockfile. The layout is asserted before any audit runs, so a drifted workspace reports a
// layout problem instead of a misleading advisory failure.
function assertWorkspaceIsReal() {
  const lockPath = path.join(REPO_ROOT, 'pnpm-lock.yaml');
  assert.ok(fs.existsSync(lockPath), 'pnpm-lock.yaml is required: the audit must read the real workspace lockfile');
  const lock = fs.readFileSync(lockPath, 'utf8');
  assert.ok(/^ {2}apps\/web:\r?$/m.test(lock), 'pnpm-lock.yaml must carry the apps/web importer');

  const workspacePath = path.join(REPO_ROOT, 'pnpm-workspace.yaml');
  assert.ok(fs.existsSync(workspacePath), 'pnpm-workspace.yaml is required: the audit must read the real workspace layout');
  assert.ok(/apps\/\*/.test(fs.readFileSync(workspacePath, 'utf8')), 'pnpm-workspace.yaml must list apps/*');

  for (const scan of AUDIT_SCOPES) {
    const inv = auditInvocation(scan);
    assert.strictEqual(inv.command, 'pnpm', `${scan.scope} audit must run pnpm, not ${inv.command}`);
    assert.strictEqual(inv.cwd, REPO_ROOT, `${scan.scope} audit must run at the workspace root, not ${inv.cwd}`);
    assert.deepStrictEqual(
      inv.args,
      [...scan.filterArgs, 'audit', '--json'],
      `${scan.scope} audit invocation must be exactly "<filter?> audit --json"`
    );
  }

  const env = auditEnv();
  assert.strictEqual(env.SOCKET_CLI_API_TOKEN, undefined, 'the gate must not pass a Socket token to pnpm');
  assert.strictEqual(env.KONOHA_SOCKET_OPTIONAL_AUDIT, undefined, 'the gate must not enable the optional Socket audit');
  console.log('✓ workspace layout: pnpm-lock.yaml with the apps/web importer, apps/* workspace, pnpm-only invocation');
}

function assertMitigationProven(id) {
  const entry = APPROVED_MITIGATED_ADVISORIES.get(id);
  assert.ok(entry, `${id} is reported but is not a registered mitigation in APPROVED_MITIGATED_ADVISORIES`);
  assert.ok(
    fs.existsSync(path.join(REPO_ROOT, entry.patch)),
    `${id} is reported but ${entry.patch} is missing; without the patch the advisory cannot be accepted`
  );
  const proof = spawnSync(process.execPath, [path.join(REPO_ROOT, entry.proof)], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120000
  });
  assert.strictEqual(
    proof.status,
    0,
    `${id} is reported but its proof ${entry.proof} fails:\n${proof.stdout || ''}${proof.stderr || ''}`
  );
  console.log(`  ✓ ${id} (${entry.pkg}) accepted: ${entry.patch} applied and ${entry.proof} passes`);
}

// The gate's decision has to be checkable without the network: a withdrawal must pass, a
// registered mitigation must pass, and a new advisory must fail. These fixtures also pin
// the parsing rules (a banner before the JSON, a truncated or vacuous scan).
function verifyAuditGateLogic() {
  assert.strictEqual(classifyAdvisories([]).ok, true, 'a withdrawn advisory set must pass');
  const registered = classifyAdvisories(['GHSA-fc5q-39xc-vjpf']);
  assert.strictEqual(registered.ok, true, 'a registered mitigation must pass');
  assert.deepStrictEqual(registered.mitigated, ['GHSA-fc5q-39xc-vjpf'], 'a registered advisory must be reported as mitigated');
  assert.deepStrictEqual(
    classifyAdvisories(['GHSA-aaaa-bbbb-cccc']).unapproved,
    ['GHSA-aaaa-bbbb-cccc'],
    'an unregistered advisory must be reported as unapproved'
  );
  assert.deepStrictEqual(
    classifyAdvisories(['GHSA-fc5q-39xc-vjpf', 'GHSA-aaaa-bbbb-cccc']),
    { ok: false, unapproved: ['GHSA-aaaa-bbbb-cccc'], mitigated: ['GHSA-fc5q-39xc-vjpf'] },
    'approval must be per-advisory, not per-scan'
  );
  assert.deepStrictEqual(
    parseAuditJson(
      'banner line\n{"advisories":{"1":{"github_advisory_id":"GHSA-x-y-z"}},"metadata":{"totalDependencies":7}}\n{"second":1}',
      'fixture'
    ),
    { ids: ['GHSA-x-y-z'], total: 7 },
    'a banner before the JSON must not hide the advisories'
  );
  assert.throws(() => parseAuditJson('{"advisories":{},"metadata":{}}', 'fixture'), /failed scan/,
    'a scan that resolved no dependencies must not read as clean');
  assert.throws(() => parseAuditJson('no json here', 'fixture'), /no JSON/,
    'a scan with no JSON must not read as clean');
  assert.throws(() => parseAuditJson('{"metadata":{"totalDependencies":4}}', 'fixture'), /no advisories object/,
    'a scan without an advisories object must not read as clean');
  assert.throws(() => assertMitigationProven('GHSA-not-registered'), /not a registered mitigation/,
    'an unregistered mitigation cannot be proven');

  // The shared extractor must survive the shapes a CLI actually emits: a banner, a second
  // document, a brace inside a string, an escaped quote, a truncated body, and no JSON.
  assert.deepStrictEqual(firstJsonValue('banner { "a": 1 } { "b": 2 }'), { a: 1 }, 'a banner and a trailing document must not hide the first value');
  assert.deepStrictEqual(firstJsonValue('x { "s": "} {" } y'), { s: '} {' }, 'a brace inside a string must not close the value');
  assert.deepStrictEqual(firstJsonValue('x { "s": "a\\"} b" }'), { s: 'a"} b' }, 'an escaped quote must not end the string');
  assert.deepStrictEqual(firstJsonValue('{ "n": { "m": [1, 2] } }'), { n: { m: [1, 2] } }, 'nested objects must balance');
  assert.strictEqual(firstJsonValue('{ "broken": '), null, 'a truncated body is not a value');
  assert.strictEqual(firstJsonValue('no json here'), null, 'text without a brace is not a value');

  console.log('✓ advisory gate logic: withdrawal tolerated, mitigation tolerated, new advisory rejected, malformed scan rejected');
  console.log('✓ audit JSON extraction: 6 shapes, including banner, string brace, escaped quote, truncation');
}

function verifyPnpmAuditMatrix() {
  assertWorkspaceIsReal();
  const scans = AUDIT_SCOPES.map(auditScan);
  const observed = new Set();
  const parsed = new Map();

  for (const scan of scans) {
    const { ids, total } = parseAuditJson(scan.stdout, scan.scope);
    parsed.set(scan.scope, total);
    assert.ok(total > 0, `${scan.scope} pnpm audit resolved 0 dependencies`);
    assert.strictEqual(
      scan.status,
      ids.length ? 1 : 0,
      `${scan.scope} pnpm audit exit ${scan.status} contradicts its own ${ids.length} advisories`
    );
    const verdict = classifyAdvisories(ids);
    assert.ok(
      verdict.ok,
      `${scan.scope} pnpm audit reports unapproved advisories: ${JSON.stringify(verdict.unapproved)}. ` +
      'Fix the dependency, or add a patch plus a regression test and register it in APPROVED_MITIGATED_ADVISORIES.'
    );
    for (const id of ids) observed.add(id);
    console.log(`${scan.scope}: ${total} dependencies, ${ids.length} advisories`);
  }

  assert.notStrictEqual(
    parsed.get('apps/web'),
    parsed.get('root'),
    'apps/web audit reused the workspace root scope; the two scopes must stay separate'
  );
  for (const id of observed) assertMitigationProven(id);
}

// Absent credentials must never block CI and never be reported as success: the optional
// integration prints SKIPPED and exits 0 in both tokenless configurations.
function verifyOptionalSocketSkip() {
  const script = path.join(REPO_ROOT, 'scripts', 'socket_audit_optional.js');

  // The envelope classifier is offline, so its fixtures run here rather than only for an
  // operator who happens to hold a token.
  const selfCheck = spawnSync(process.execPath, [script, '--self-check'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, SOCKET_CLI_API_TOKEN: '' }
  });
  assert.strictEqual(selfCheck.status, 0, `optional Socket classifier self-check failed:\n${selfCheck.stdout || ''}${selfCheck.stderr || ''}`);
  assert.ok(/outcome classifier: 11 fixtures/.test(selfCheck.stdout || ''), 'optional Socket classifier self-check must report its fixture count');

  const runs = [
    { label: 'not opted in', env: { KONOHA_SOCKET_OPTIONAL_AUDIT: '', SOCKET_CLI_API_TOKEN: '' }, expect: /KONOHA_SOCKET_OPTIONAL_AUDIT is not 1/ },
    { label: 'opted in without a token', env: { KONOHA_SOCKET_OPTIONAL_AUDIT: '1', SOCKET_CLI_API_TOKEN: '' }, expect: /SOCKET_CLI_API_TOKEN is not set/ }
  ];
  for (const run of runs) {
    const res = spawnSync(process.execPath, [script], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, ...run.env }
    });
    const out = `${res.stdout || ''}${res.stderr || ''}`;
    assert.strictEqual(res.status, 0, `optional Socket audit (${run.label}) must exit 0, got ${res.status}:\n${out.slice(0, 400)}`);
    assert.ok(/SKIPPED/.test(out), `optional Socket audit (${run.label}) must print SKIPPED:\n${out.slice(0, 400)}`);
    assert.ok(run.expect.test(out), `optional Socket audit (${run.label}) must state its reason:\n${out.slice(0, 400)}`);
    assert.ok(!/RESULT: PASS|0 vulnerabilities/i.test(out), `optional Socket audit (${run.label}) must never report success:\n${out.slice(0, 400)}`);
  }
  console.log('✓ optional Socket audit: 11 classifier fixtures pass offline, SKIPPED and exit 0 without opt-in or token, never a pass');
}

// socket.yml governs the optional integration's config, not a mandatory scan: the issue
// rules stay narrow so a capability alert cannot be silenced into a clean report.
function verifySocketConfigInvariants() {
  const socketYmlPath = path.join(REPO_ROOT, 'socket.yml');
  assert.ok(fs.existsSync(socketYmlPath), 'socket.yml must exist at repo root');
  const ymlContent = fs.readFileSync(socketYmlPath, 'utf8');

  assert.ok(ymlContent.includes('projectIgnorePaths:'), 'Must specify projectIgnorePaths');
  assert.ok(ymlContent.includes('"apps/web"'), 'Must ignore apps/web bundle');
  assert.ok(ymlContent.includes('issueRules:'), 'Must specify issueRules');
  assert.ok(ymlContent.includes('envVars: false'), 'Must safely filter benign envVars capability alerts');
  assert.ok(ymlContent.includes('networkAccess: false'), 'Must safely filter benign networkAccess capability alerts');
  assert.ok(!ymlContent.includes('usesEval: false'), 'usesEval must not be suppressed: v2.2.23 removed every eval sink');
  assert.ok(!/^\s*-\s*"pnpm-lock\.yaml"/m.test(ymlContent), 'pnpm-lock.yaml must stay audited, not ignored');
  assert.ok(!/^\s*-\s*"patches\/\*\*"/m.test(ymlContent), 'patches/** must stay audited, not ignored');
  console.log('✓ socket.yml configuration and issue rules verified');
}

function verifyOverrideResolution() {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const expectedOverrides = {
    globalthis: 'npm:@socketregistry/globalthis@1.0.7',
    isarray: 'npm:@socketregistry/isarray@1.0.8',
    'readable-stream': '^3.6.2',
    'safe-buffer': 'npm:@socketregistry/safe-buffer@1.0.9',
    setimmediate: 'npm:immediate@^3.3.0'
  };
  for (const [name, spec] of Object.entries(expectedOverrides)) {
    assert.strictEqual(
      pkg.overrides && pkg.overrides[name],
      spec,
      `package.json#overrides must pin ${name} to ${spec} for npm/Socket resolution`
    );
  }
  const lockContent = fs.readFileSync(path.join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8');
  for (const resolved of ['@socketregistry/globalthis@1.0.7', '@socketregistry/safe-buffer@1.0.9', 'readable-stream@3.6.2', 'immediate@3.3.0']) {
    assert.ok(lockContent.includes(resolved), `pnpm-lock.yaml must resolve ${resolved}`);
  }
  for (const legacyPkg of [
    'define-properties@1.2.1',
    'es-define-property@1.0.1',
    'globalthis@1.0.4',
    'gopd@1.2.0',
    'has-property-descriptors@1.0.2',
    'isarray@1.0.0',
    'object-keys@1.1.1',
    'readable-stream@2.3.8',
    'safe-buffer@5.1.2',
    'safe-buffer@5.2.1',
    'setimmediate@1.0.5'
  ]) {
    const legacyPattern = new RegExp(`^\\s{2}${legacyPkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`, 'm');
    assert.ok(!legacyPattern.test(lockContent), `pnpm-lock.yaml must not resolve ${legacyPkg}`);
  }
  console.log('✓ override resolution: Socket registry and stream overrides pinned in package.json and lockfile');
}

function main() {
  console.log('====================================================');
  console.log('      KONOHA LOCAL DEPENDENCY AUDIT (pnpm audit)     ');
  console.log('====================================================');
  verifyAuditGateLogic();
  verifySocketConfigInvariants();
  verifyOverrideResolution();
  verifyPnpmAuditMatrix();
  verifyOptionalSocketSkip();
  console.log('\n====================================================');
  console.log('✓ Mandatory local dependency audit passed (root + apps/web, no Socket account).');
  console.log('====================================================');
}

// Exported so the gate's rules can be exercised directly, and the entry point guarded so a
// `require()` of this file inspects the rules instead of running the whole audit.
module.exports = { APPROVED_MITIGATED_ADVISORIES, classifyAdvisories, parseAuditJson };

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('\n✖ DEPENDENCY AUDIT FAILURE:', err && (err.stack || err.message || String(err)));
    process.exit(1);
  }
}
