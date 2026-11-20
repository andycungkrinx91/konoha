#!/usr/bin/env node
'use strict';

/**
 * Optional Socket.dev integration. Mandatory CI does not run this file and does not require
 * a Socket account; `pnpm audit` over the root and `apps/web` workspaces
 * (`tests/test_dependency_audit.js`) is the gate. This script is an extra pair of eyes for
 * operators who have a token.
 *
 * Enable: KONOHA_SOCKET_OPTIONAL_AUDIT=1 SOCKET_CLI_API_TOKEN=... pnpm audit:socket
 *
 * A run that could not be made is reported as SKIPPED or UNVERIFIED with its reason and
 * never as a pass, and it never fails CI on its own.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { firstJsonValue } = require('./lib/audit_json');

const REPO_ROOT = path.resolve(__dirname, '..');
const IS_WIN = process.platform === 'win32';

const OUTCOME = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', UNVERIFIED: 'UNVERIFIED' });

// On win32 npx/npm/pnpm are .cmd shims, and Node refuses to spawn those without a shell, so
// execFileSync('npx', ...) fails with ENOENT on Windows only. Build the command line
// ourselves and hand it to cmd.exe; elsewhere spawn the binary directly.
function spawnArgs(command, args, options) {
  if (!IS_WIN) return [command, args, options];
  const quote = (value) => (/\s/.test(value) ? `"${value}"` : value);
  return [`${quote(command)} ${args.map(quote).join(' ')}`, undefined, { ...options, shell: true }];
}

/**
 * Classifies the CLI's own JSON envelope. HTTP statuses are read from `data.code`, never
 * from a substring of the message: the CLI reports auth, permission, and quota limits as
 * `{ ok: false, message: "Socket API error", data: { code: <http status> } }`, and a 5xx is
 * a defect in the API rather than a limit on this account.
 *
 * `VERIFIED` is internal — it means "the CLI answered, validate the payload yourself".
 */
function classifySocketEnvelope({ parsed, stderr } = {}) {
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

  // An envelope this script does not recognise cannot be read as clean.
  return { outcome: OUTCOME.FAIL, reason: 'unrecognized-envelope', detail: message || parsed };
}

// spawnSync rather than execFileSync: it returns stdout and stderr together instead of
// throwing away the streams on a non-zero exit.
function runSocketJson(args) {
  const [command, argv, options] = spawnArgs('npx', ['--yes', 'socket', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 300000,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
  });
  const res = spawnSync(command, argv, options);
  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  return {
    stdout,
    stderr,
    parsed: firstJsonValue(stdout) || firstJsonValue(stderr)
  };
}

// The classifier decides whether a run counts as verified, so it is pinned offline: these
// fixtures are the exact envelopes this CLI produces, including the one that used to pass
// because a "403" appeared somewhere in the message.
function verifyOutcomeClassifier() {
  const fixtures = [
    {
      name: 'tokenless score query is UNVERIFIED',
      input: { parsed: { ok: false, message: 'Input error', data: "✖ This command requires a Socket API token for access (try `socket login`)" } },
      expected: { outcome: OUTCOME.UNVERIFIED, reason: 'no-api-token' }
    },
    {
      name: 'a real input error is FAIL',
      input: { parsed: { ok: false, message: 'Input error', data: '✖ Expecting at least one package' } },
      expected: { outcome: OUTCOME.FAIL, reason: 'input-error' }
    },
    {
      name: 'HTTP 401 is an invalid token',
      input: { parsed: { ok: false, message: 'Socket API error', data: { code: 401 } } },
      expected: { outcome: OUTCOME.UNVERIFIED, reason: 'invalid-token' }
    },
    {
      name: 'HTTP 403 is a missing API permission',
      input: { parsed: { ok: false, message: 'Socket API error', data: { code: 403 } } },
      expected: { outcome: OUTCOME.UNVERIFIED, reason: 'missing-api-permission' }
    },
    {
      name: 'HTTP 429 is rate limiting',
      input: { parsed: { ok: false, message: 'Socket API error', data: { code: 429 } } },
      expected: { outcome: OUTCOME.UNVERIFIED, reason: 'rate-limited' }
    },
    {
      name: 'HTTP 500 is an API defect, not a limit',
      input: { parsed: { ok: false, message: 'Socket API error', data: { code: 500 } } },
      expected: { outcome: OUTCOME.FAIL, reason: 'api-error-500' }
    },
    {
      name: 'an API error with no status code is FAIL',
      input: { parsed: { ok: false, message: 'Socket API error' } },
      expected: { outcome: OUTCOME.FAIL, reason: 'api-error-unstructured' }
    },
    {
      name: 'a DNS failure is UNVERIFIED',
      input: { parsed: null, stderr: 'getaddrinfo ENOTFOUND api.socket.dev' },
      expected: { outcome: OUTCOME.UNVERIFIED, reason: 'network-unreachable' }
    },
    {
      name: 'a missing binary is FAIL, not offline',
      input: { parsed: null, stderr: 'Error: spawn ENOENT' },
      expected: { outcome: OUTCOME.FAIL, reason: 'no-json' }
    },
    {
      name: 'a verified envelope leaves payload validation to the caller',
      input: { parsed: { ok: true, data: { self: { score: { vulnerability: 100 }, alerts: [] } } } },
      expected: { outcome: 'VERIFIED', reason: 'ok' }
    },
    {
      name: '"403" in the message does not override the real status code',
      input: { parsed: { ok: false, message: 'Socket API error', cause: 'forbidden by gateway (403)', data: { code: 502 } } },
      expected: { outcome: OUTCOME.FAIL, reason: 'api-error-502' }
    }
  ];

  for (const fixture of fixtures) {
    const actual = classifySocketEnvelope(fixture.input);
    assert.strictEqual(actual.outcome, fixture.expected.outcome, `${fixture.name}: outcome ${actual.outcome}`);
    assert.strictEqual(actual.reason, fixture.expected.reason, `${fixture.name}: reason ${actual.reason}`);
  }
  console.log(`✓ outcome classifier: ${fixtures.length} fixtures, 403-in-message no longer reads as a limit`);
}

const results = [];

function record(name, outcome, reason) {
  results.push({ name, outcome, reason });
  const glyph = outcome === OUTCOME.PASS ? '✓' : outcome === OUTCOME.FAIL ? '✖' : '⚠';
  console.log(`${glyph} ${name}: ${outcome}${reason ? ` (${reason})` : ''}`);
}

function verifyFixAudit() {
  const res = runSocketJson(['fix', '--all', '--no-apply-fixes', '--json']);
  const verdict = classifySocketEnvelope(res);

  if (verdict.outcome === OUTCOME.UNVERIFIED) return record('socket fix', OUTCOME.UNVERIFIED, verdict.reason);
  if (verdict.outcome === OUTCOME.FAIL) return record('socket fix', OUTCOME.FAIL, verdict.reason);

  // A missing envelope used to read as "nothing to fix"; the command ran and did not answer.
  const data = res.parsed.data;
  if (!data || typeof data !== 'object') return record('socket fix', OUTCOME.FAIL, 'no-data-object');
  if (!Array.isArray(data.ghsaDetails)) return record('socket fix', OUTCOME.FAIL, 'no-ghsaDetails-array');
  if (data.ghsaDetails.length !== 0) {
    return record('socket fix', OUTCOME.FAIL, `unresolved-advisories:${JSON.stringify(data.ghsaDetails).slice(0, 300)}`);
  }
  record('socket fix', OUTCOME.PASS, '0 open GHSAs/CVEs');
}

function verifyScores() {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  for (const dep of Object.keys(pkg.dependencies || {}).sort()) {
    const res = runSocketJson(['package', 'score', 'npm', dep, '--json']);
    const verdict = classifySocketEnvelope(res);
    if (verdict.outcome === OUTCOME.UNVERIFIED) {
      record(`score ${dep}`, OUTCOME.UNVERIFIED, verdict.reason);
      continue;
    }
    if (verdict.outcome === OUTCOME.FAIL) {
      record(`score ${dep}`, OUTCOME.FAIL, verdict.reason);
      continue;
    }

    // Every field below was previously read optionally (`res.data?.self?.score` behind
    // `if (selfScore)`, alerts behind `|| []`), so an envelope without a score or without
    // an alerts array was reported as "0 high, 0 critical". A missing field is not clean.
    const data = res.parsed.data;
    if (!data || typeof data !== 'object') { record(`score ${dep}`, OUTCOME.FAIL, 'no-data-object'); continue; }
    if (!data.self || typeof data.self !== 'object') { record(`score ${dep}`, OUTCOME.FAIL, 'no-data-self'); continue; }
    const score = data.self.score;
    if (!score || typeof score !== 'object') { record(`score ${dep}`, OUTCOME.FAIL, 'no-score-object'); continue; }
    if (!Number.isFinite(score.vulnerability)) { record(`score ${dep}`, OUTCOME.FAIL, 'vulnerability-not-finite'); continue; }
    if (score.vulnerability !== 100) { record(`score ${dep}`, OUTCOME.FAIL, `vulnerability-${score.vulnerability}`); continue; }
    if (!Array.isArray(data.self.alerts)) { record(`score ${dep}`, OUTCOME.FAIL, 'alerts-not-array'); continue; }

    const criticals = data.self.alerts.filter((a) => a && a.severity === 'critical').length;
    const highs = data.self.alerts.filter((a) => a && a.severity === 'high').length;
    if (criticals > 0) { record(`score ${dep}`, OUTCOME.FAIL, `critical-alerts-${criticals}`); continue; }
    if (highs > 0) { record(`score ${dep}`, OUTCOME.FAIL, `high-alerts-${highs}`); continue; }
    record(`score ${dep}`, OUTCOME.PASS, `vuln=100, supplyChain=${score.supplyChain}`);
  }
}

function skip(reason) {
  console.log(`SKIPPED: ${reason} — optional Socket audit did not run; mandatory CI uses the local dependency audit only`);
  return 0;
}

function main() {
  // The classifier is offline and account-free, so it can be exercised without a token.
  if (process.argv.includes('--self-check')) { verifyOutcomeClassifier(); return 0; }
  if (process.env.KONOHA_SOCKET_OPTIONAL_AUDIT !== '1') return skip('KONOHA_SOCKET_OPTIONAL_AUDIT is not 1');
  if (!process.env.SOCKET_CLI_API_TOKEN) return skip('SOCKET_CLI_API_TOKEN is not set');

  verifyOutcomeClassifier();
  verifyFixAudit();
  verifyScores();

  const pass = results.filter((r) => r.outcome === OUTCOME.PASS).length;
  const fail = results.filter((r) => r.outcome === OUTCOME.FAIL).length;
  const unverified = results.filter((r) => r.outcome === OUTCOME.UNVERIFIED).length;
  // An unavailable external audit is never reported as success and never blocks CI.
  const verdict = fail > 0 ? 'FAIL' : unverified > 0 ? 'UNVERIFIED' : 'PASS';
  console.log(`Socket optional audit: ${OUTCOME.PASS} ${pass} | ${OUTCOME.FAIL} ${fail} | ${OUTCOME.UNVERIFIED} ${unverified}`);
  console.log(`RESULT: ${verdict}`);
  return fail > 0 ? 1 : 0;
}

process.exitCode = main();
