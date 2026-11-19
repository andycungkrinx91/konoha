// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');

const IS_WIN = process.platform === 'win32';

// On win32 npx/npm/pnpm are .cmd shims, and Node refuses to spawn those without a
// shell, so execFileSync('npx', ...) fails with ENOENT on Windows only. Build the
// command line ourselves and hand it to cmd.exe; elsewhere spawn the binary directly.
function spawnArgs(command, args, options) {
  if (!IS_WIN) return [command, args, options];
  const quote = (value) => (/\s/.test(value) ? `"${value}"` : value);
  return [`${quote(command)} ${args.map(quote).join(' ')}`, undefined, { ...options, shell: true }];
}

// Every scratch directory this suite creates is removed here, so a run leaves no
// `konoha_socket_*` debris behind on any OS.
function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// `npx socket ... --json` can append a banner or a second document to stdout, so the
// whole buffer is not one JSON value. Scan for the first balanced object and parse that.
function firstJsonValue(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch (_) {
          return null;
        }
      }
    }
  }
  return null;
}

function verifySocketFixAudit() {
  console.log('[Socket Audit] Running `socket fix --all --no-apply-fixes --json`...');
  const res = runSocketJson(['fix', '--all', '--no-apply-fixes', '--json']);
  const verdict = classifySocketEnvelope(res);
  const payload = `${res.stdout}\n${res.stderr}`;

  if (verdict.outcome === OUTCOME.UNVERIFIED) {
    record('socket fix', OUTCOME.UNVERIFIED, verdict.reason, payload.slice(0, 400));
    console.log(`⚠ socket fix could not be verified (${verdict.reason}); this is not a finding and not a pass`);
    return;
  }
  if (verdict.outcome === OUTCOME.FAIL) {
    // A missing envelope used to be `SKIPPED`, which is how a broken CLI invocation passed
    // as clean. It is a failure: the command ran and did not answer.
    recordFailure('socket fix', verdict.reason, verdict.detail || payload);
  }

  const data = res.parsed.data;
  if (!data || typeof data !== 'object') recordFailure('socket fix', 'no-data-object', payload);
  if (!Array.isArray(data.ghsaDetails)) recordFailure('socket fix', 'no-ghsaDetails-array', JSON.stringify(data));
  if (data.ghsaDetails.length !== 0) {
    recordFailure('socket fix', 'unresolved-advisories', JSON.stringify(data.ghsaDetails));
  }
  record('socket fix', OUTCOME.PASS, '0 open GHSAs/CVEs');
  console.log('✓ PASS socket fix: 0 open GHSAs/CVEs');
}

// A check can end in three states. `PASS` and `FAIL` are both verified answers; `UNVERIFIED`
// means no answer was obtainable at all, which is not a pass. The previous version matched
// substrings such as "403" or "quota" in an error message, so a genuine API defect read as
// an account limit and the check quietly passed.
const OUTCOME = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', UNVERIFIED: 'UNVERIFIED' });

const outcomes = [];

function record(name, outcome, reason, detail) {
  outcomes.push({ name, outcome, reason, detail });
}

function summarizeOutcomes(list = outcomes) {
  return {
    pass: list.filter((o) => o.outcome === OUTCOME.PASS).length,
    fail: list.filter((o) => o.outcome === OUTCOME.FAIL).length,
    unverified: list.filter((o) => o.outcome === OUTCOME.UNVERIFIED).length
  };
}

function recordFailure(name, reason, detail) {
  record(name, OUTCOME.FAIL, reason, detail);
  assert.fail(`${name}: ${reason}${detail ? ` — ${String(detail).slice(0, 400)}` : ''}`);
}

/**
 * Classifies the CLI's own JSON envelope. HTTP statuses are read from `data.code`, never
 * from a substring of the message: the CLI reports auth, permission, and quota limits as
 * `{ ok: false, message: "Socket API error", data: { code: <http status> } }`, and a 5xx is
 * a defect in the API rather than a limit on this account.
 *
 * `VERIFIED` is internal — it means "the CLI answered, validate the payload yourself".
 */
function classifySocketEnvelope({ status, parsed, stderr } = {}) {
  if (!parsed) {
    if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|socket hang up/i.test(String(stderr || ''))) {
      return { outcome: OUTCOME.UNVERIFIED, reason: 'network-unreachable' };
    }
    return { outcome: OUTCOME.FAIL, reason: 'no-json' };
  }
  if (parsed.ok === true) return { outcome: 'VERIFIED', reason: 'ok' };

  const message = String(parsed.message || '');
  if (message === 'Input error') {
    // The tokenless CLI answers exit 2 with the requirement embedded in `data`, so the
    // reason has to be read from there; any other input error is a broken invocation.
    if (/requires a Socket API token/.test(String(parsed.data || ''))) {
      return { outcome: OUTCOME.UNVERIFIED, reason: 'no-api-token' };
    }
    return { outcome: OUTCOME.FAIL, reason: 'input-error', detail: parsed.data };
  }
  if (message === 'Auth Error') return { outcome: OUTCOME.UNVERIFIED, reason: 'auth-error' };

  if (message === 'Socket API error') {
    const code = parsed.data && typeof parsed.data === 'object' ? parsed.data.code : null;
    if (typeof code !== 'number' || !Number.isFinite(code)) {
      return { outcome: OUTCOME.FAIL, reason: 'api-error-unstructured', detail: parsed.cause || parsed.data };
    }
    if (code === 401) return { outcome: OUTCOME.UNVERIFIED, reason: 'invalid-token' };
    if (code === 403) return { outcome: OUTCOME.UNVERIFIED, reason: 'missing-api-permission' };
    if (code === 429) return { outcome: OUTCOME.UNVERIFIED, reason: 'rate-limited' };
    return { outcome: OUTCOME.FAIL, reason: `api-error-${code}`, detail: parsed.cause || parsed.data };
  }

  // An envelope this suite does not recognise cannot be read as clean.
  return { outcome: OUTCOME.FAIL, reason: 'unrecognized-envelope', detail: message || parsed };
}

// execFileSync throws away the exit status the classifier needs, so the socket CLI is run
// through spawnSync and the envelope is recovered from whichever stream carries it.
function runSocketJson(args, opts = {}) {
  const [command, argv, options] = spawnArgs('npx', ['socket', ...args], {
    cwd: opts.cwd || REPO_ROOT,
    encoding: 'utf8',
    timeout: opts.timeout || 300000,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', ...(opts.env || {}) }
  });
  const res = spawnSync(command, argv, options);
  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  return {
    status: typeof res.status === 'number' ? res.status : null,
    stdout,
    stderr,
    parsed: firstJsonValue(stdout) || firstJsonValue(stderr)
  };
}

// Socket CLI runs a fully local scan with no login: the wrapper shells out to the package
// manager's advisory database. The API-backed commands (`package score`, `scan create`,
// `fix`) do need a token.
//
// Coverage ceiling, stated so it is never mistaken for the whole tree: the synthesized
// lockfile resolves only the root `package.json` dependency set through npm. It is not the
// pnpm-resolved tree, and `pnpm audit` remains authoritative for that one.
function buildPartialLocalScanTarget(dir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'konoha-local-scan',
      version: pkg.version,
      dependencies: pkg.dependencies || {},
      overrides: pkg.overrides || {}
    }, null, 2)
  );
  execFileSync(...spawnArgs('npm', ['install', '--package-lock-only', '--silent', '--no-audit', '--no-fund', '--ignore-scripts'], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 300000,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
  }));
  const lock = JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'));
  return Math.max(0, Object.keys(lock.packages || {}).length - 1);
}

function verifySocketNpmAudit() {
  console.log('[Socket Audit] Running `socket npm audit`...');
  const repo = runSocketJson(['npm', 'audit']);
  const repoText = `${repo.stdout}\n${repo.stderr}`;
  if (repoText.includes('found 0 vulnerabilities')) {
    record('socket npm audit (repo)', OUTCOME.PASS, 'found 0 vulnerabilities');
    console.log('✓ PASS socket npm audit: 0 vulnerabilities in the repository lockfile');
    return;
  }
  // Only the two documented reasons a repository without `package-lock.json` cannot be
  // scanned in place justify the fallback: ENOLOCK when no lockfile is in scope, and
  // EALLOWSCRIPTS when npm 11+ rejects the wrapper's own flag.
  assert.ok(
    /EALLOWSCRIPTS|--allow-scripts is not allowed|ENOLOCK|requires an existing lockfile/.test(repoText),
    `socket npm audit failed for an unrecognised reason, so the local fallback would hide it:\n${repoText.slice(0, 800)}`
  );

  withTempDir('konoha_socket_local_', (localDir) => {
    const packages = buildPartialLocalScanTarget(localDir);
    console.log(
      `⚠ PARTIAL: npm-resolved subset of root package.json dependencies (${packages} packages) — ` +
      'this is not the pnpm-resolved tree; pnpm audit is authoritative for it.'
    );
    withTempDir('konoha_socket_nologin_', (isolatedHome) => {
      // win32 resolves the home directory from USERPROFILE and the config file from
      // XDG_CONFIG_HOME, so all three must point at the isolated directory. With
      // SOCKET_CLI_NO_API_TOKEN the absence of a credential is a fact the CLI states,
      // not something inferred from a failure.
      const local = runSocketJson(['npm', 'audit'], {
        cwd: localDir,
        env: {
          HOME: isolatedHome,
          USERPROFILE: isolatedHome,
          XDG_CONFIG_HOME: isolatedHome,
          SOCKET_CLI_NO_API_TOKEN: '1'
        }
      });
      const localText = `${local.stdout}\n${local.stderr}`;

      // The banner is the proof that no org and no token were in play. Requiring it turns
      // "we could not see the banner" into a failure instead of a silent skip.
      const banner = localText.match(/CLI: [^|]*\| cmd: [^|]*\| org: ([^|]*)\| token: ([^|]*)/);
      if (!banner) recordFailure('socket local scan (tokenless)', 'no-banner', localText);
      const org = banner[1].trim();
      const token = banner[2].trim();
      if (org !== '(not set)') recordFailure('socket local scan (tokenless)', `resolved-org:${org}`, localText);
      if (!['(disabled)', '(not set)'].includes(token)) {
        recordFailure('socket local scan (tokenless)', `token-present:${token}`, localText);
      }
      if (!localText.includes('found 0 vulnerabilities')) {
        recordFailure('socket local scan (tokenless)', 'vulnerabilities-reported', localText);
      }
      record('socket local scan (tokenless)', OUTCOME.PASS, `0 vulnerabilities, org ${org}, token ${token}`, { packages });
      console.log(`✓ PASS socket local scan (no login): 0 vulnerabilities, org ${org}, token ${token}, PARTIAL coverage`);
    });
  });
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

// pnpm audit exits 1 whenever an advisory is present and 0 otherwise, so a wrapper that
// exits 0 while reporting findings would sail past an advisory-set check. execFileSync
// throws on that non-zero exit, so the JSON is recovered from err.stdout.
function auditScan(scope, filterArgs) {
  let stdout = '';
  let status = 0;
  try {
    stdout = execFileSync(...spawnArgs('pnpm', [...filterArgs, 'audit', '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 180000,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
    }));
  } catch (err) {
    if (!err.stdout) throw err;
    stdout = err.stdout;
    status = typeof err.status === 'number' ? err.status : -1;
  }
  assert.ok(status === 0 || status === 1, `${scope} pnpm audit exited ${status}, not 0 or 1:\n${stdout.slice(0, 800)}`);
  const { ids, total } = parseAuditJson(stdout, scope);
  assert.strictEqual(status, ids.length ? 1 : 0, `${scope} pnpm audit exit ${status} contradicts its own ${ids.length} advisories`);
  return { scope, ids, total };
}

function assertMitigationProven(id) {
  const entry = APPROVED_MITIGATED_ADVISORIES.get(id);
  assert.ok(entry, `${id} is reported but not registered in APPROVED_MITIGATED_ADVISORIES`);
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

function verifyPnpmAuditMatrix() {
  console.log('[Socket Audit] Running `pnpm audit --json` across root and apps/web...');
  const root = auditScan('root', []);
  // `--dir` resolves the workspace root, so it audited the whole tree and both assertions
  // pinned the same scan; `--filter` selects the real package.
  const web = auditScan('apps/web', ['--filter=./apps/web']);
  assert.notStrictEqual(
    web.total,
    root.total,
    `apps/web audit reused the workspace root scope (${web.total} dependencies both times); the two scopes must stay separate`
  );

  for (const scan of [root, web]) {
    const verdict = classifyAdvisories(scan.ids);
    assert.ok(
      verdict.ok,
      `${scan.scope} pnpm audit reports unapproved advisories: ${JSON.stringify(verdict.unapproved)}. ` +
      'Fix the dependency, or add a patch plus a regression test and register it in APPROVED_MITIGATED_ADVISORIES.'
    );
  }
  const observed = new Set([...root.ids, ...web.ids]);
  for (const id of observed) assertMitigationProven(id);
  console.log(
    `✓ audit gate clean: root ${root.total} deps, apps/web ${web.total} deps, ` +
    `${observed.size} registered mitigation(s) observed, 0 unapproved`
  );
}

function verifySocketConfigRules() {
  console.log('[Socket Audit] Verifying socket.yml configuration invariants...');
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

  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.strictEqual(
    pkg.overrides && pkg.overrides.globalthis,
    'npm:@socketregistry/globalthis@1.0.7',
    'package.json#overrides must override globalthis to @socketregistry/globalthis@1.0.7 for npm/Socket resolution'
  );
  const lockContent = fs.readFileSync(path.join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8');
  assert.ok(lockContent.includes('@socketregistry/globalthis@1.0.7'), 'pnpm-lock.yaml must resolve @socketregistry/globalthis@1.0.7');
  for (const legacyPkg of ['define-properties@1.2.1', 'es-define-property@1.0.1', 'globalthis@1.0.4', 'gopd@1.2.0', 'has-property-descriptors@1.0.2', 'object-keys@1.1.1']) {
    const legacyPattern = new RegExp(`^\\s{2}${legacyPkg.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}:`, 'm');
    assert.ok(!legacyPattern.test(lockContent), `pnpm-lock.yaml must not resolve ${legacyPkg}`);
  }
  console.log('✓ socket.yml configuration and issue rules verified');
}

function verifyDirectDependencyScores() {
  console.log('[Socket Audit] Scoring core production dependencies via Socket API...');
  const pkgPath = path.join(REPO_ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const deps = Object.keys(pkg.dependencies || {});

  const criticalPackages = [
    '@bufbuild/protobuf',
    '@huggingface/transformers',
    '@langchain/core',
    '@langchain/langgraph',
    '@socketregistry/globalthis',
    'three',
    'zod',
    'docx',
    'pptxgenjs',
    'xlsx-populate'
  ].filter(dep => deps.includes(dep) || dep === '@socketregistry/globalthis');

  for (const dep of criticalPackages) {
    const res = runSocketJson(['package', 'score', 'npm', dep, '--json']);
    const verdict = classifySocketEnvelope(res);
    const payload = `${res.stdout}\n${res.stderr}`;

    if (verdict.outcome === OUTCOME.UNVERIFIED) {
      record(`score ${dep}`, OUTCOME.UNVERIFIED, verdict.reason, payload.slice(0, 300));
      console.log(`  - ${dep}: ⚠ UNVERIFIED (${verdict.reason})`);
      continue;
    }
    if (verdict.outcome === OUTCOME.FAIL) {
      recordFailure(`score ${dep}`, verdict.reason, verdict.detail || payload);
    }

    // Every field below was previously read optionally (`res.data?.self?.score` behind
    // `if (selfScore)`, alerts behind `|| []`), so an envelope without a score or without
    // an alerts array was reported as "0 high, 0 critical". A missing field is not clean.
    const data = res.parsed.data;
    if (!data || typeof data !== 'object') recordFailure(`score ${dep}`, 'no-data-object', payload);
    if (!data.self || typeof data.self !== 'object') recordFailure(`score ${dep}`, 'no-data-self', payload);
    const score = data.self.score;
    if (!score || typeof score !== 'object') recordFailure(`score ${dep}`, 'no-score-object', payload);
    if (!Number.isFinite(score.vulnerability)) {
      recordFailure(`score ${dep}`, 'vulnerability-not-finite', JSON.stringify(score));
    }
    if (score.vulnerability !== 100) {
      recordFailure(`score ${dep}`, `vulnerability-${score.vulnerability}`, JSON.stringify(score));
    }
    if (!Array.isArray(data.self.alerts)) recordFailure(`score ${dep}`, 'alerts-not-array', payload);

    const criticals = data.self.alerts.filter((a) => a && a.severity === 'critical');
    const highs = data.self.alerts.filter((a) => a && a.severity === 'high');
    if (criticals.length > 0) recordFailure(`score ${dep}`, 'critical-alerts', JSON.stringify(criticals));
    if (highs.length > 0) recordFailure(`score ${dep}`, 'high-alerts', JSON.stringify(highs));

    record(`score ${dep}`, OUTCOME.PASS, 'vuln=100, 0 high, 0 critical', {
      supplyChain: score.supplyChain,
      alerts: data.self.alerts.length
    });
    console.log(`  - ${dep}: PASS vuln=100, supplyChain=${score.supplyChain}, high=0, critical=0`);
  }

  const scores = outcomes.filter((o) => o.name.startsWith('score '));
  const summary = summarizeOutcomes(scores);
  console.log(`Socket scores: ${summary.pass} verified at 100, ${summary.unverified} unverified, ${summary.fail} failed`);
}

function verifyDbRecoveryRemediation() {
  console.log('[Socket Audit] Verifying P0 remediation for src/db_recovery.js and src/db_recovery_salvage.js...');
  const dbRecPath = path.join(REPO_ROOT, 'src', 'db_recovery.js');
  const dbSalvagePath = path.join(REPO_ROOT, 'src', 'db_recovery_salvage.js');
  const recSrc = fs.readFileSync(dbRecPath, 'utf8');
  const salvageSrc = fs.readFileSync(dbSalvagePath, 'utf8');

  for (const [label, src] of [['src/db_recovery.js', recSrc], ['src/db_recovery_salvage.js', salvageSrc]]) {
    assert.ok(!src.includes("require('child_process')") && !src.includes('require("child_process")'), `${label} must not import child_process`);
    assert.ok(!/\bexecSync\s*\(/.test(src), `${label} must not invoke execSync`);
    assert.ok(!/\bspawnSync\s*\(/.test(src), `${label} must not invoke spawnSync`);
    assert.ok(src.includes('allowExtension: false'), `${label} must enforce allowExtension: false`);
    assert.ok(src.includes('PRAGMA trusted_schema = OFF'), `${label} must enforce PRAGMA trusted_schema = OFF`);
  }
  console.log('✓ src/db_recovery.js and src/db_recovery_salvage.js verified: 0 shell invocations, constrained SQLite salvage active');
}

// The classifier decides whether a run counts as verified, so it is pinned offline: these
// fixtures are the exact envelopes this CLI produces, including the one that used to pass
// because a "403" appeared somewhere in the message.
function verifyOutcomeClassifier() {
  console.log('[Socket Audit] Verifying the outcome classifier against fixtures...');
  const fixtures = [
    {
      name: 'tokenless score query is UNVERIFIED',
      input: { status: 2, parsed: { ok: false, message: 'Input error', data: "✖ This command requires a Socket API token for access (try `socket login`)" } },
      expected: { outcome: OUTCOME.UNVERIFIED, reason: 'no-api-token' }
    },
    {
      name: 'a real input error is FAIL',
      input: { status: 2, parsed: { ok: false, message: 'Input error', data: '✖ Expecting at least one package' } },
      expected: { outcome: OUTCOME.FAIL, reason: 'input-error' }
    },
    {
      name: 'HTTP 401 is an invalid token',
      input: { status: 1, parsed: { ok: false, message: 'Socket API error', data: { code: 401 } } },
      expected: { outcome: OUTCOME.UNVERIFIED, reason: 'invalid-token' }
    },
    {
      name: 'HTTP 403 is a missing API permission',
      input: { status: 1, parsed: { ok: false, message: 'Socket API error', data: { code: 403 } } },
      expected: { outcome: OUTCOME.UNVERIFIED, reason: 'missing-api-permission' }
    },
    {
      name: 'HTTP 429 is rate limiting',
      input: { status: 1, parsed: { ok: false, message: 'Socket API error', data: { code: 429 } } },
      expected: { outcome: OUTCOME.UNVERIFIED, reason: 'rate-limited' }
    },
    {
      name: 'HTTP 500 is an API defect, not a limit',
      input: { status: 1, parsed: { ok: false, message: 'Socket API error', data: { code: 500 } } },
      expected: { outcome: OUTCOME.FAIL, reason: 'api-error-500' }
    },
    {
      name: 'an API error with no status code is FAIL',
      input: { status: 1, parsed: { ok: false, message: 'Socket API error' } },
      expected: { outcome: OUTCOME.FAIL, reason: 'api-error-unstructured' }
    },
    {
      name: 'a DNS failure is UNVERIFIED',
      input: { status: 1, parsed: null, stderr: 'getaddrinfo ENOTFOUND api.socket.dev' },
      expected: { outcome: OUTCOME.UNVERIFIED, reason: 'network-unreachable' }
    },
    {
      name: 'a missing binary is FAIL, not offline',
      input: { status: 1, parsed: null, stderr: 'Error: spawn ENOENT' },
      expected: { outcome: OUTCOME.FAIL, reason: 'no-json' }
    },
    {
      name: 'a verified envelope leaves payload validation to the caller',
      input: { status: 0, parsed: { ok: true, data: { self: { score: { vulnerability: 100 }, alerts: [] } } } },
      expected: { outcome: 'VERIFIED', reason: 'ok' }
    },
    {
      name: '"403" in the message does not override the real status code',
      input: { status: 1, parsed: { ok: false, message: 'Socket API error', cause: 'forbidden by gateway (403)', data: { code: 502 } } },
      expected: { outcome: OUTCOME.FAIL, reason: 'api-error-502' }
    }
  ];

  for (const fixture of fixtures) {
    const actual = classifySocketEnvelope(fixture.input);
    assert.strictEqual(actual.outcome, fixture.expected.outcome, `${fixture.name}: outcome ${actual.outcome}`);
    assert.strictEqual(actual.reason, fixture.expected.reason, `${fixture.name}: reason ${actual.reason}`);
  }
  assert.strictEqual(
    summarizeOutcomes([
      { outcome: OUTCOME.PASS }, { outcome: OUTCOME.FAIL }, { outcome: OUTCOME.UNVERIFIED }, { outcome: OUTCOME.PASS }
    ]).pass,
    2,
    'the summary must count only PASS entries as passes'
  );
  console.log(`✓ outcome classifier: ${fixtures.length} fixtures, 403-in-message no longer reads as a limit`);
}
// The gate's decision has to be checkable without the network: a withdrawal must pass, a
// registered mitigation must pass, and a new advisory must fail. These fixtures also pin
// the parsing rules (a banner before the JSON, a truncated or vacuous scan) and the
// temp-dir cleanup.
function verifyAuditGateLogic() {
  console.log('[Socket Audit] Verifying advisory-gate logic against fixtures...');
  assert.strictEqual(classifyAdvisories([]).ok, true, 'a withdrawn advisory set must pass');
  assert.strictEqual(classifyAdvisories(['GHSA-fc5q-39xc-vjpf']).ok, true, 'a registered mitigation must pass');
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
  let probeDir = '';
  withTempDir('konoha_gate_probe_', (dir) => {
    probeDir = dir;
    assert.ok(fs.existsSync(dir), 'withTempDir must hand the callback an existing directory');
  });
  assert.strictEqual(fs.existsSync(probeDir), false, 'withTempDir must remove the directory it created');
  console.log('✓ advisory gate logic: withdrawal tolerated, mitigation tolerated, new advisory rejected, malformed scan rejected');
}

// Deterministic checks throw on failure; recording them keeps the summary honest about how
// many checks ran, and rethrowing preserves the existing fail-fast behaviour.
function runCheck(name, fn) {
  try {
    fn();
    record(name, OUTCOME.PASS, 'ok');
  } catch (err) {
    record(name, OUTCOME.FAIL, 'threw', err && err.message);
    throw err;
  }
}

async function main() {
  console.log('====================================================');
  console.log('     KONOHA SOCKET.DEV SUPPLY-CHAIN SECURITY AUDIT   ');
  console.log('====================================================');
  runCheck('outcome classifier', verifyOutcomeClassifier);
  runCheck('advisory gate logic', verifyAuditGateLogic);
  runCheck('socket.yml configuration', verifySocketConfigRules);
  runCheck('db recovery remediation', verifyDbRecoveryRemediation);
  verifySocketFixAudit();
  verifySocketNpmAudit();
  runCheck('pnpm audit matrix', verifyPnpmAuditMatrix);
  verifyDirectDependencyScores();

  const { pass, fail, unverified } = summarizeOutcomes();
  console.log('\n====================================================');
  console.log(`Socket verification summary: ${OUTCOME.PASS} ${pass} | ${OUTCOME.FAIL} ${fail} | ${OUTCOME.UNVERIFIED} ${unverified}`);
  for (const entry of outcomes.filter((o) => o.outcome === OUTCOME.UNVERIFIED)) {
    console.log(`⚠ UNVERIFIED ${entry.name}: ${entry.reason} — this check did not verify anything`);
  }
  console.log(`Socket verification complete: ${pass} PASS, ${fail} FAIL, ${unverified} UNVERIFIED`);
  console.log('====================================================');

  // UNVERIFIED is not a pass, but on a host without a Socket token it is the expected
  // result, so promoting it to failure by default would keep this gate permanently red.
  // `KONOHA_SOCKET_REQUIRE_VERIFIED=1` is the strict mode for CI that claims verification.
  if (fail > 0) process.exit(1);
  if (unverified > 0 && process.env.KONOHA_SOCKET_REQUIRE_VERIFIED === '1') {
    console.log('KONOHA_SOCKET_REQUIRE_VERIFIED=1: an unverified check is a failure.');
    process.exit(1);
  }
}

// Exported so the gate's rules can be exercised directly, and the entry point guarded so a
// `require()` of this file inspects the rules instead of running the whole audit.
module.exports = {
  classifyAdvisories,
  classifySocketEnvelope,
  parseAuditJson,
  summarizeOutcomes,
  verifyOutcomeClassifier,
  withTempDir
};

if (require.main === module) {
  main().catch((err) => {
    console.error('\n✖ SOCKET CLI AUDIT FAILURE:', err && (err.stack || err.message || String(err)));
    process.exit(1);
  });
}
