#!/usr/bin/env node
'use strict';

require('./helpers/isolate_db');

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const GUARD_CLI = path.join(REPO_ROOT, 'scripts', 'konoha_project_mcp_guard.js');

const {
  SUPPORTED_HARNESSES,
  normalizeHarness,
  findKonohaRepoRoot,
  evaluateProjectMcpGuardrail,
  formatHarnessDecision,
  describeGuardrailRemediation,
  readGuardrailExceptions,
  recordGuardrailException,
  revokeGuardrailExceptions,
  guardrailExceptionsPath,
  guardrailAuditPath,
  createHarnessInterceptor,
  ensureProjectKonohaGuardPlugin
} = require('../src/project_konoha_mcp_guardrail');

function createTempKonohaFixture(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dirType = process.platform === 'win32' ? 'junction' : 'dir';
  fs.symlinkSync(path.join(REPO_ROOT, 'src'), path.join(dir, 'src'), dirType);
  fs.symlinkSync(path.join(REPO_ROOT, 'bin'), path.join(dir, 'bin'), dirType);
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'konoha-mcp', version: '2.2.22' }));
  fs.copyFileSync(GUARD_CLI, path.join(dir, 'scripts', 'konoha_project_mcp_guard.js'));
  return dir;
}

const TEMP_PLUGIN_REPO = createTempKonohaFixture('konoha-guard-plugin-');
const TEMP_ENSURED = ensureProjectKonohaGuardPlugin(TEMP_PLUGIN_REPO);
assert.strictEqual(TEMP_ENSURED.ok, true, 'ensureProjectKonohaGuardPlugin must materialize plugin files in a clean checkout');
const PLUGIN_DIR = TEMP_ENSURED.pluginDir;
const pluginGuard = require(path.join(PLUGIN_DIR, 'guard.js'));

const PENDING_TESTS = [];

function runTest(name, fn) {
  try {
    const outcome = fn();
    if (outcome && typeof outcome.then === 'function') {
      PENDING_TESTS.push(outcome.then(
        () => console.log(`  PASS ${name}`),
        (err) => {
          console.error(`  FAIL ${name}: ${err.stack || err.message}`);
          process.exitCode = 1;
        }
      ));
      return;
    }
    console.log(`  PASS ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}: ${err.stack || err.message}`);
    process.exitCode = 1;
  }
}

console.log('Running Project-Only Konoha-MCP Guardrail Tests...\n');

runTest('1. Supports all 8 coding agent harnesses and normalizes aliases', () => {
  assert.deepStrictEqual(
    [...SUPPORTED_HARNESSES],
    ['antigravity', 'claudecode', 'cursor', 'commandcode', 'opencode', 'codex', 'omp', 'pi']
  );
  assert.strictEqual(normalizeHarness('agy'), 'antigravity');
  assert.strictEqual(normalizeHarness('claudecode'), 'claudecode');
  assert.strictEqual(normalizeHarness('claude'), 'claudecode');
  assert.strictEqual(normalizeHarness('claude-code'), 'claudecode');
  assert.strictEqual(normalizeHarness('pi-dev'), 'pi');
  assert.strictEqual(Object.keys(pluginGuard.interceptors).length, 8);
});

runTest('2. Rejects native file read/search/glob/outline/shell-bypass across all 8 harnesses inside Konoha repo', () => {
  const deniedTools = [
    { tool_name: 'Read', tool_input: { file_path: path.join(REPO_ROOT, 'src', 'server.js') } },
    { tool_name: 'view_file', tool_input: { AbsolutePath: path.join(REPO_ROOT, 'README.md') } },
    { tool_name: 'read_file', tool_input: { path: path.join(REPO_ROOT, '.agents', 'skills', 'konoha', 'SKILL.md') } },
    { tool_name: 'Grep', tool_input: { pattern: 'runSannin', path: path.join(REPO_ROOT, 'src') } },
    { tool_name: 'grep_search', tool_input: { Query: 'runSannin', SearchPath: REPO_ROOT } },
    { tool_name: 'Glob', tool_input: { pattern: 'src/**/*.js', path: REPO_ROOT } },
    { tool_name: 'find_by_name', tool_input: { SearchDirectory: REPO_ROOT, Pattern: '*.js' } },
    { tool_name: 'list_dir', tool_input: { DirectoryPath: path.join(REPO_ROOT, 'src') } },
    { tool_name: 'view_file_outline', tool_input: { AbsolutePath: path.join(REPO_ROOT, 'src', 'server.js') } },
    { tool_name: 'Bash', tool_input: { command: 'cat src/server.js' } },
    { tool_name: 'Bash', tool_input: { command: 'node tests/test_docs_currency.js' } },
    { tool_name: 'Write', tool_input: { file_path: path.join(REPO_ROOT, 'prompt.md') } },
    { tool_name: 'call_mcp_tool', tool_input: { ServerName: 'semble', ToolName: 'search', Arguments: {} } },
    { tool_name: 'mcp__konoha__build_with_image_design', tool_input: {} }
  ];

  for (const harness of SUPPORTED_HARNESSES) {
    for (const call of deniedTools) {
      const ev = evaluateProjectMcpGuardrail({ ...call, cwd: REPO_ROOT }, { harness });
      assert.strictEqual(ev.in_konoha_repo, true, `Expected Konoha repo detection for ${harness}`);
      assert.strictEqual(ev.allowed, false, `Expected deny for ${harness}:${call.tool_name}`);
      assert.strictEqual(ev.decision, 'deny');
      const formatted = formatHarnessDecision(harness, ev);
      assert.strictEqual(formatted.decision, 'deny');
      if (harness === 'claude' || harness === 'commandcode') {
        assert.strictEqual(formatted.hookSpecificOutput.permissionDecision, 'deny');
      } else if (harness === 'omp' || harness === 'pi') {
        assert.strictEqual(formatted.block, true);
      } else if (harness === 'cursor') {
        assert.strictEqual(formatted.permission, 'deny');
        assert.strictEqual(formatted.continue, false);
      } else if (harness === 'codex') {
        assert.strictEqual(formatted.approve, false);
      }
    }
  }
});

runTest('3. Allows Konoha MCP calls, companion aislop MCP, rtk commands, binary reads & non-readonly writes inside Konoha repo', () => {
  const allowedTools = [
    { tool_name: 'call_mcp_tool', tool_input: { ServerName: 'konoha', ToolName: 'code_search', Arguments: { root: REPO_ROOT, query: 'runSannin' } } },
    { tool_name: 'call_mcp_tool', tool_input: { ServerName: 'konoha', ToolName: 'get_skill', Arguments: { name: 'konoha' } } },
    { tool_name: 'mcp__konoha__read_file_range', tool_input: { path: path.join(REPO_ROOT, 'src', 'server.js'), start_line: 1, end_line: 50 } },
    { tool_name: 'mcp__konoha__find_skill', tool_input: { query: 'code intel' } },
    { tool_name: 'mcp__aislop__aislop_scan', tool_input: { paths: ['src/project_konoha_mcp_guardrail.js'] } },
    { tool_name: 'code_search', tool_input: { root: REPO_ROOT, query: 'ensureSchema' } },
    { tool_name: 'Bash', tool_input: { command: 'rtk node tests/test_docs_currency.js' } },
    { tool_name: 'edit_file', tool_input: { Path: path.join(REPO_ROOT, 'src', 'project_konoha_mcp_guardrail.js') } },
    { tool_name: 'view_file', tool_input: { AbsolutePath: path.join(REPO_ROOT, 'assets', 'hero.webp') } }
  ];

  for (const harness of SUPPORTED_HARNESSES) {
    for (const call of allowedTools) {
      const ev = evaluateProjectMcpGuardrail({ ...call, cwd: REPO_ROOT }, { harness });
      assert.strictEqual(ev.allowed, true, `Expected allow for ${harness}:${call.tool_name}, got: ${ev.reason}`);
      assert.strictEqual(ev.decision, 'allow');
    }
  }

  // Read-only specialist cannot edit even inside Konoha repo
  const roEdit = evaluateProjectMcpGuardrail(
    { tool_name: 'edit_file', tool_input: { Path: path.join(REPO_ROOT, 'src', 'server.js') }, cwd: REPO_ROOT },
    { harness: 'claude', agent: 'genin' }
  );
  assert.strictEqual(roEdit.allowed, false);
  assert.strictEqual(roEdit.code, 'READ_ONLY_AGENT_WRITE_DENIED');
});

runTest('4. Stays strictly inactive (Rule 19 safe) for external non-Konoha user repositories', () => {
  const externalRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'external-user-project-'));
  try {
    fs.writeFileSync(path.join(externalRepo, 'package.json'), JSON.stringify({ name: 'user-app', version: '1.0.0' }));
    fs.writeFileSync(path.join(externalRepo, 'index.js'), 'console.log(1);\n');

    assert.strictEqual(findKonohaRepoRoot(externalRepo), null);
    for (const harness of SUPPORTED_HARNESSES) {
      const res = evaluateProjectMcpGuardrail(
        { cwd: externalRepo, tool_name: 'Grep', tool_input: { pattern: 'console', path: externalRepo } },
        { harness }
      );
      assert.strictEqual(res.in_konoha_repo, false);
      assert.strictEqual(res.enforced, false);
      assert.strictEqual(res.allowed, true);
      assert.strictEqual(res.decision, 'allow');
    }
  } finally {
    fs.rmSync(externalRepo, { recursive: true, force: true });
  }
});

runTest('5. Plugin manifest, hooks.json, JS interceptors, and CLI runner work end-to-end', () => {
  assert.ok(fs.existsSync(path.join(PLUGIN_DIR, 'plugin.json')));
  const hooksCfg = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'hooks.json'), 'utf8'));
  assert.ok(hooksCfg['konoha-mcp-guard'] && hooksCfg['konoha-mcp-guard'].enabled === true);

  // Real generated guard.js interceptors deny inside the materialized Konoha repo root
  const generatedAgy = pluginGuard.interceptors.antigravity({
    cwd: TEMP_PLUGIN_REPO,
    tool_name: 'grep_search',
    tool_input: { SearchPath: TEMP_PLUGIN_REPO, Query: 'runSannin' }
  });
  assert.strictEqual(generatedAgy.decision, 'deny');
  assert.throws(
    () => pluginGuard.interceptors.opencode({
      cwd: TEMP_PLUGIN_REPO,
      tool_name: 'Grep',
      tool_input: { pattern: 'x', path: TEMP_PLUGIN_REPO }
    }),
    /KONOHA_MCP_REQUIRED_SEARCH|rejected in the Konoha repository/i
  );

  // OpenCode plugin throws on deny
  const openCodeHook = createHarnessInterceptor('opencode', { projectRoot: REPO_ROOT });
  assert.throws(
    () => openCodeHook({ tool_name: 'Grep', tool_input: { pattern: 'x', path: REPO_ROOT }, cwd: REPO_ROOT }),
    /KONOHA_MCP_REQUIRED_SEARCH|rejected in the Konoha repository/i
  );

  // CLI stdin execution for antigravity (deny raw grep_search inside Konoha)
  const cliDenyOut = execFileSync(process.execPath, [GUARD_CLI, '--harness', 'antigravity'], {
    cwd: REPO_ROOT,
    input: JSON.stringify({ cwd: REPO_ROOT, tool_name: 'grep_search', tool_input: { SearchPath: REPO_ROOT, Query: 'x' } }),
    encoding: 'utf8'
  });
  const cliDenyJson = JSON.parse(cliDenyOut.trim());
  assert.strictEqual(cliDenyJson.decision, 'deny');

  // CLI exit-on-deny for codex
  let exitedNonZero = false;
  try {
    execFileSync(process.execPath, [GUARD_CLI, '--harness', 'codex', '--exit-on-deny'], {
      cwd: REPO_ROOT,
      input: JSON.stringify({ cwd: REPO_ROOT, tool_name: 'read_file', tool_input: { path: path.join(REPO_ROOT, 'src', 'server.js') } }),
      encoding: 'utf8'
    });
  } catch (err) {
    exitedNonZero = err.status === 2;
    const body = JSON.parse(String(err.stdout || '{}').trim());
    assert.strictEqual(body.approve, false);
  }
  assert.strictEqual(exitedNonZero, true);
});

runTest('6. ensureProjectKonohaGuardPlugin skips user repos and supports copied nested plugin scripts', () => {
  const { ensureProjectKonohaGuardPlugin } = require('../src/project_konoha_mcp_guardrail');

  const userProject = fs.mkdtempSync(path.join(os.tmpdir(), 'external-guard-noop-'));
  try {
    fs.writeFileSync(path.join(userProject, 'package.json'), JSON.stringify({ name: 'user-project', version: '1.0.0' }));
    const res = ensureProjectKonohaGuardPlugin(userProject);
    assert.strictEqual(res.skipped, true);
    assert.strictEqual(fs.existsSync(path.join(userProject, '.agents')), false);
  } finally {
    fs.rmSync(userProject, { recursive: true, force: true });
  }

  const fakeKonoha = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-guard-deploy-'));
  try {
    const dirType = process.platform === 'win32' ? 'junction' : 'dir';
    fs.symlinkSync(path.join(REPO_ROOT, 'src'), path.join(fakeKonoha, 'src'), dirType);
    fs.symlinkSync(path.join(REPO_ROOT, 'bin'), path.join(fakeKonoha, 'bin'), dirType);
    fs.mkdirSync(path.join(fakeKonoha, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(fakeKonoha, 'package.json'), JSON.stringify({ name: 'konoha-mcp', version: '2.2.22' }));
    fs.copyFileSync(GUARD_CLI, path.join(fakeKonoha, 'scripts', 'konoha_project_mcp_guard.js'));

    // Materialize the plugin via ensureProjectKonohaGuardPlugin and verify copied nested CLI works
    const ensured = ensureProjectKonohaGuardPlugin(fakeKonoha);
    assert.strictEqual(ensured.ok, true);
    assert.strictEqual(ensured.skipped, false);
    const copiedPluginScript = path.join(fakeKonoha, '.agents', 'plugins', 'konoha-mcp-guard', 'scripts', 'konoha_project_mcp_guard.js');
    assert.ok(fs.existsSync(copiedPluginScript), 'plugin scripts/konoha_project_mcp_guard.js must exist');
    assert.strictEqual(fs.lstatSync(copiedPluginScript).isSymbolicLink(), false, 'deployed plugin script must work as a real copy');

    const out = execFileSync(process.execPath, [copiedPluginScript, '--harness', 'antigravity'], {
      cwd: path.join(fakeKonoha, '.agents', 'plugins', 'konoha-mcp-guard'),
      input: JSON.stringify({ cwd: fakeKonoha, tool_name: 'Grep', tool_input: { pattern: 'x', path: fakeKonoha } }),
      encoding: 'utf8'
    });
    assert.strictEqual(JSON.parse(out.trim()).decision, 'deny');

    // The copy has no src/ sibling, so --hitl used to fail with a rejected
    // MODULE_NOT_FOUND promise: exit 2, the same code a real denial returns,
    // but only a bare module error on stderr instead of the fail-closed briefing.
    let hitlFailed = null;
    try {
      execFileSync(process.execPath, [copiedPluginScript, '--harness', 'antigravity', '--hitl'], {
        cwd: path.join(fakeKonoha, '.agents', 'plugins', 'konoha-mcp-guard'),
        input: JSON.stringify({ cwd: fakeKonoha, tool_name: 'grep_search', tool_input: { SearchPath: fakeKonoha, Query: 'x' } }),
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, KONOHA_GUARD_NO_TTY: '1' }
      });
    } catch (err) {
      hitlFailed = err;
    }
    assert.ok(hitlFailed, 'a copied plugin --hitl run with no terminal must exit non-zero');
    assert.strictEqual(hitlFailed.status, 2, 'the copied plugin must fail closed with exit 2, not crash');
    const hitlStderr = String(hitlFailed.stderr || '');
    assert.ok(!/Cannot find module/.test(hitlStderr), `the copied plugin must resolve src/ modules (got: ${hitlStderr.slice(0, 300)})`);
    assert.ok(/No TTY available/.test(hitlStderr), `the copied plugin must render the fail-closed briefing (got: ${hitlStderr.slice(0, 300)})`);
  } finally {
    fs.rmSync(fakeKonoha, { recursive: true, force: true });
  }
});

runTest('7. Tracked .agents plugin copies match what the generator emits', () => {
  // `.agents/plugins/konoha-mcp-guard/` is tracked in git, but only `ensureProjectKonohaGuardPlugin`
  // ever writes it, and nothing runs that on this repo. Compare against a fresh generation in a
  // temp fixture rather than regenerating in place — in-place would overwrite the drift it reports.
  const trackedDir = path.join(REPO_ROOT, '.agents', 'plugins', 'konoha-mcp-guard');
  assert.ok(fs.existsSync(trackedDir), 'repo must track .agents/plugins/konoha-mcp-guard');
  for (const rel of ['plugin.json', 'hooks.json', 'guard.js', path.join('scripts', 'konoha_project_mcp_guard.js')]) {
    const tracked = path.join(trackedDir, rel);
    assert.ok(fs.existsSync(tracked), `.agents/plugins/konoha-mcp-guard/${rel} must exist in the repo`);
    assert.strictEqual(
      fs.lstatSync(tracked).isSymbolicLink(),
      false,
      `.agents/plugins/konoha-mcp-guard/${rel} must be a regular file; a symlink resolves only on the machine that created it`
    );
    assert.ok(
      fs.readFileSync(tracked).equals(fs.readFileSync(path.join(PLUGIN_DIR, rel))),
      `.agents/plugins/konoha-mcp-guard/${rel} drifted from the generator`
    );
  }

  // The symlink that broke CI was one file in this directory. A walk over the
  // whole tracked tree is what stops the next hand-added mirror link: a mode
  // 120000 entry checks out on Windows as a text file holding the target path.
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      assert.strictEqual(
        fs.lstatSync(full).isSymbolicLink(),
        false,
        `${path.relative(REPO_ROOT, full)} must be a regular file; a tracked symlink resolves only on the machine that created it`
      );
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(path.join(REPO_ROOT, '.agents'));
});

runTest('8. A stale symlink in the plugin dir is replaced, not written through', () => {
  const fakeKonoha = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-guard-symlink-'));
  const sentinel = path.join(fakeKonoha, 'sentinel.js');
  try {
    const dirType = process.platform === 'win32' ? 'junction' : 'dir';
    fs.symlinkSync(path.join(REPO_ROOT, 'src'), path.join(fakeKonoha, 'src'), dirType);
    fs.symlinkSync(path.join(REPO_ROOT, 'bin'), path.join(fakeKonoha, 'bin'), dirType);
    fs.mkdirSync(path.join(fakeKonoha, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(fakeKonoha, 'package.json'), JSON.stringify({ name: 'konoha-mcp', version: '2.2.22' }));
    fs.copyFileSync(GUARD_CLI, path.join(fakeKonoha, 'scripts', 'konoha_project_mcp_guard.js'));

    const dest = path.join(fakeKonoha, '.agents', 'plugins', 'konoha-mcp-guard', 'scripts', 'konoha_project_mcp_guard.js');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(sentinel, 'SENTINEL\n');
    try {
      fs.symlinkSync(sentinel, dest, 'file');
    } catch (err) {
      if (err.code === 'EPERM' || err.code === 'EACCES') {
        console.log('  SKIP 8. symlink creation not permitted on this host');
        return;
      }
      throw err;
    }

    const res = ensureProjectKonohaGuardPlugin(fakeKonoha);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(fs.lstatSync(dest).isSymbolicLink(), false, 'the symlink must be replaced by a real file');
    assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), 'SENTINEL\n', 'the write must not follow the symlink to its target');
    assert.ok(fs.readFileSync(dest).equals(fs.readFileSync(GUARD_CLI)), 'the replacement must carry the guard CLI');
  } finally {
    fs.rmSync(fakeKonoha, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

const HITL_DENIAL = {
  tool_name: 'Read',
  tool_input: { file_path: path.join(REPO_ROOT, 'src', 'server.js') },
  cwd: REPO_ROOT
};

runTest('9. Accepting a risk writes a scoped exception, an audit line, and lets the next identical call through', () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-guard-hitl-accept-'));
  try {
    const before = evaluateProjectMcpGuardrail(HITL_DENIAL, { harness: 'omp', repoRoot: store });
    assert.strictEqual(before.allowed, false);
    assert.strictEqual(before.code, 'KONOHA_MCP_REQUIRED_READ');
    assert.ok(describeGuardrailRemediation(before.code).includes('read_file_range'), 'the denial must name the Konoha alternative');

    const entry = recordGuardrailException(store, {
      code: before.code,
      tool: 'Read',
      justification: 'Auditing the guard itself for the CI fix',
      harness: 'omp',
      acceptedBy: 'test'
    });
    assert.strictEqual(entry.code, 'KONOHA_MCP_REQUIRED_READ');
    assert.ok(Date.parse(entry.expires_at) > Date.now(), 'the exception must carry a future expiry');
    assert.strictEqual(readGuardrailExceptions(store).length, 1);

    const after = evaluateProjectMcpGuardrail(HITL_DENIAL, { harness: 'omp', repoRoot: store });
    assert.strictEqual(after.allowed, true, 'the accepted exception must satisfy the same call');
    assert.strictEqual(after.code, 'RISK_ACCEPTED');
    assert.strictEqual(after.risk_accepted, true);

    // The exception is scoped to one denial code and one tool, so nothing else slips through.
    assert.strictEqual(evaluateProjectMcpGuardrail({
      tool_name: 'Glob', tool_input: { pattern: 'src/**/*.js', path: REPO_ROOT }, cwd: REPO_ROOT
    }, { harness: 'omp', repoRoot: store }).allowed, false, 'a different denial code must not be covered');
    assert.strictEqual(evaluateProjectMcpGuardrail({
      tool_name: 'Grep', tool_input: { pattern: 'x', path: REPO_ROOT }, cwd: REPO_ROOT
    }, { harness: 'omp', repoRoot: store }).allowed, false, 'a different tool must not be covered');

    const audit = fs.readFileSync(guardrailAuditPath(store), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const accepted = audit.filter((row) => row.event === 'risk_accepted');
    assert.strictEqual(accepted.length, 1);
    assert.strictEqual(accepted[0].exception_id, entry.id);
    assert.strictEqual(accepted[0].justification, 'Auditing the guard itself for the CI fix');

    assert.strictEqual(revokeGuardrailExceptions(store), 1);
    assert.strictEqual(readGuardrailExceptions(store).length, 0);
    assert.strictEqual(evaluateProjectMcpGuardrail(HITL_DENIAL, { harness: 'omp', repoRoot: store }).allowed, false);
  } finally {
    fs.rmSync(store, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

runTest('10. Blocking writes no exception and no audit entry', () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-guard-hitl-block-'));
  try {
    assert.strictEqual(evaluateProjectMcpGuardrail(HITL_DENIAL, { harness: 'omp', repoRoot: store }).allowed, false);
    assert.strictEqual(fs.existsSync(guardrailExceptionsPath(store)), false, 'blocking must not create the exception store');
    assert.strictEqual(fs.existsSync(guardrailAuditPath(store)), false, 'blocking must not append an audit line');
  } finally {
    fs.rmSync(store, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

runTest('11. An expired exception is ignored and pruned from the store', () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-guard-hitl-expired-'));
  try {
    recordGuardrailException(store, {
      code: 'KONOHA_MCP_REQUIRED_READ',
      tool: 'Read',
      justification: 'Short-lived exception for the probe',
      ttlMs: 60000,
      acceptedBy: 'test'
    });
    const persisted = JSON.parse(fs.readFileSync(guardrailExceptionsPath(store), 'utf8'));
    persisted.exceptions[0].expires_at = new Date(Date.now() - 60000).toISOString();
    fs.writeFileSync(guardrailExceptionsPath(store), JSON.stringify(persisted));

    assert.strictEqual(readGuardrailExceptions(store).length, 0);
    assert.strictEqual(JSON.parse(fs.readFileSync(guardrailExceptionsPath(store), 'utf8')).exceptions.length, 0,
      'expired entries are pruned on read');
    assert.strictEqual(evaluateProjectMcpGuardrail(HITL_DENIAL, { harness: 'omp', repoRoot: store }).allowed, false);
  } finally {
    fs.rmSync(store, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

runTest('12. The CLI fails closed on --hitl without a TTY and records a risk only when explicitly accepted', () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-guard-hitl-cli-'));
  const payload = JSON.stringify(HITL_DENIAL);
  try {
    // KONOHA_GUARD_NO_TTY makes the no-terminal branch reachable from a script:
    // a child inherits the developer's terminal otherwise and waits on it.
    let failed = null;
    try {
      execFileSync(process.execPath, [GUARD_CLI, '--harness', 'omp', '--hitl', '--repo-root', store], {
        cwd: store,
        input: payload,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, KONOHA_GUARD_NO_TTY: '1' }
      });
    } catch (err) {
      failed = err;
    }
    assert.ok(failed, 'a no-terminal --hitl run must exit non-zero');
    assert.strictEqual(failed.status, 2, 'a no-terminal --hitl run must exit 2 (deny)');
    // The non-TTY briefing goes to stderr so a hook's JSON stdout stays parseable.
    const briefing = String(failed.stderr) + String(failed.stdout);
    assert.ok(briefing.includes('read_file_range'), 'the fail-closed briefing must name the Konoha alternative');
    assert.ok(briefing.includes('--accept-with-risk'), 'the fail-closed briefing must name the explicit escape hatch');
    assert.strictEqual(fs.existsSync(guardrailExceptionsPath(store)), false, 'a blocked run must not record a risk');

    const out = execFileSync(process.execPath, [
      GUARD_CLI, '--harness', 'omp', '--repo-root', store,
      '--accept-with-risk', '--justification', 'Explicitly accepted by the operator'
    ], { cwd: store, input: payload, encoding: 'utf8' });
    assert.strictEqual(JSON.parse(out.trim()).decision, 'allow');
    const recorded = readGuardrailExceptions(store);
    assert.strictEqual(recorded.length, 1);
    // The payload arrives on stdin once: a second read sees EOF, and a wildcard
    // exception for every tool would be recorded instead of one for `read`.
    assert.strictEqual(recorded[0].tool, 'read', 'the acceptance must be scoped to the tool that was denied, not to every tool');
    assert.strictEqual(recorded[0].code, 'KONOHA_MCP_REQUIRED_READ', 'the acceptance must be scoped to the denial code');
    assert.strictEqual(recorded[0].path, path.join(REPO_ROOT, 'src', 'server.js'), 'the claimed path must be recorded for the audit trail');
    const auditEvents = fs.readFileSync(guardrailAuditPath(store), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.strictEqual(auditEvents[0].event, 'risk_accepted');
    assert.strictEqual(auditEvents[0].tool, 'read', 'the audit line must name the scoped tool');

    const listed = execFileSync(process.execPath, [GUARD_CLI, '--list-exceptions', '--repo-root', store], { cwd: store, encoding: 'utf8' });
    assert.ok(listed.includes('KONOHA_MCP_REQUIRED_READ'), 'the list must show the accepted code');
    const revoked = execFileSync(process.execPath, [GUARD_CLI, '--revoke-exceptions', '--repo-root', store], { cwd: store, encoding: 'utf8' });
    assert.ok(revoked.includes('Revoked 1 guardrail exception'), `unexpected revoke output: ${revoked}`);
  } finally {
    fs.rmSync(store, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

runTest('13. The interactive menu offers both resolutions, defaults to block on EOF, and refuses a short justification', async () => {
  const { askHitlDecision } = require('../src/guardrail_hitl');
  const { PassThrough } = require('stream');
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-guard-hitl-menu-'));
  const drive = (answers) => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks = [];
    output.on('data', (chunk) => chunks.push(chunk));
    input.end(answers.map((answer) => `${answer}\n`).join(''));
    return { input, output, text: () => Buffer.concat(chunks).toString('utf8') };
  };
  const evalResult = { code: 'KONOHA_MCP_REQUIRED_READ', reason: 'native read blocked inside the Konoha repo', harness: 'omp' };
  try {
    const eof = drive([]);
    const blocked = await askHitlDecision({ evalResult, repoRoot: store, input: eof.input, output: eof.output });
    assert.strictEqual(blocked.choice, 'block', 'EOF must resolve to block');
    const menu = eof.text();
    assert.ok(menu.includes('Block this call and try another way'), 'the menu must offer blocking');
    assert.ok(menu.includes('Accept with risk'), 'the menu must offer accepting the risk');
    assert.ok(menu.includes('read_file_range'), 'the menu must name the Konoha alternative');

    const short = drive(['2', 'nope']);
    await assert.rejects(
      () => askHitlDecision({ evalResult, repoRoot: store, input: short.input, output: short.output }),
      /justification of at least 8 characters/,
      'an under-length justification must fail closed instead of accepting the risk'
    );
    assert.strictEqual(fs.existsSync(guardrailExceptionsPath(store)), false, 'a refused acceptance must write nothing');

    const accepted = drive(['2', 'Operator accepted the risk for this audit']);
    const decision = await askHitlDecision({ evalResult, repoRoot: store, input: accepted.input, output: accepted.output });
    assert.strictEqual(decision.choice, 'accept');
    assert.ok(decision.exception && decision.exception.id, 'accepting must return the recorded exception');
    assert.strictEqual(readGuardrailExceptions(store).length, 1);

    // A rule whose only correct outcome is "no" must not become a button: the
    // answer is taken, then refused, and nothing is recorded.
    fs.rmSync(guardrailExceptionsPath(store), { force: true });
    const secret = drive(['2', 'Operator wants to write the secret anyway']);
    const refused = await askHitlDecision({
      evalResult: { code: 'SECRET_FILE_WRITE_DENIED', reason: 'writing .env is forbidden', harness: 'omp' },
      repoRoot: store,
      input: secret.input,
      output: secret.output
    });
    assert.strictEqual(refused.choice, 'block', 'a non-acceptable code must resolve as a block even when 2 is chosen');
    assert.ok(
      secret.text().includes('has no acceptable form'),
      `the refusal must say why (got: ${secret.text().slice(0, 300)})`
    );
    assert.strictEqual(fs.existsSync(guardrailExceptionsPath(store)), false, 'a refused code must record nothing');
  } finally {
    fs.rmSync(store, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

runTest('14. A piped payload still prompts: the menu reads the controlling terminal, not stdin', async () => {
  // The denial payload owns stdin, so `--hitl` in a pipeline cannot prompt on it.
  // This drives the CLI under a real pty: payload on a file redirect, answers on
  // the terminal. Windows has no `script`, so the pty leg is skipped there and
  // the fail-closed leg still runs everywhere.
  const { hasControllingTerminal } = require('../src/guardrail_hitl');
  const { spawnSync } = require('child_process');
  assert.strictEqual(typeof hasControllingTerminal(), 'boolean', 'the terminal probe must always answer');

  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-guard-hitl-pty-'));
  const payloadPath = path.join(store, 'payload.json');
  fs.writeFileSync(payloadPath, JSON.stringify(HITL_DENIAL));
  try {
    const hasScript = spawnSync(process.platform === 'win32' ? 'where' : 'sh',
      process.platform === 'win32' ? ['script'] : ['-c', 'command -v script'], { encoding: 'utf8' }).status === 0;
    if (process.platform === 'win32' || !hasScript) {
      console.log('  SKIP 14a. No pty driver on this platform; the fail-closed leg above covers the CLI');
    } else {
      const node = process.execPath;
      const inner = `"${node}" "${GUARD_CLI}" --harness omp --hitl --repo-root "${store}" < "${payloadPath}"`;
      // Never inherit a KONOHA_GUARD_NO_TTY from the developer's shell: these legs
      // assert that a real terminal does prompt.
      const ptyEnv = { ...process.env };
      delete ptyEnv.KONOHA_GUARD_NO_TTY;
      const runPty = (answers, extraEnv = {}) => {
        const argv = process.platform === 'darwin'
          ? ['-q', '/dev/null', '/bin/sh', '-c', inner]
          : ['-qec', inner, '/dev/null'];
        return spawnSync('script', argv, { input: answers, encoding: 'utf8', timeout: 30000, env: { ...ptyEnv, ...extraEnv } });
      };

      const blocked = runPty('1\n');
      const blockedText = `${blocked.stdout || ''}${blocked.stderr || ''}`;
      assert.ok(blockedText.includes('Block this call and try another way'),
        `the menu must render when stdin is a payload pipe (got: ${blockedText.slice(0, 400)})`);
      assert.ok(blockedText.includes('read_file_range'), 'the pty briefing must name the Konoha alternative');
      assert.ok(!blockedText.includes('No TTY available'), 'a controlling terminal must not be mistaken for no terminal');
      if (process.platform !== 'darwin') {
        assert.strictEqual(blocked.status, 2, 'choosing block under a pty must exit 2');
      }
      assert.strictEqual(fs.existsSync(guardrailExceptionsPath(store)), false, 'blocking under a pty must record nothing');

      const accepted = runPty('2\nOperator accepted the risk on the terminal\n');
      const acceptedText = `${accepted.stdout || ''}${accepted.stderr || ''}`;
      assert.ok(acceptedText.includes('"decision":"allow"'), `accepting under a pty must allow (got: ${acceptedText.slice(0, 400)})`);
      const recorded = readGuardrailExceptions(store);
      assert.strictEqual(recorded.length, 1, 'accepting under a pty must record exactly one exception');
      assert.strictEqual(recorded[0].tool, 'read', 'the pty acceptance must stay scoped to the denied tool');
      assert.strictEqual(recorded[0].code, 'KONOHA_MCP_REQUIRED_READ');

      // The override forces the no-terminal branch even where a terminal exists.
      // It exists so the fail-closed path is reachable from a script; it must be
      // able to block, and only to block.
      fs.rmSync(guardrailExceptionsPath(store), { force: true });
      fs.rmSync(guardrailAuditPath(store), { force: true });
      const forced = runPty('2\nOperator accepted the risk on the terminal\n', { KONOHA_GUARD_NO_TTY: '1' });
      const forcedText = `${forced.stdout || ''}${forced.stderr || ''}`;
      assert.ok(forcedText.includes('No TTY'), `KONOHA_GUARD_NO_TTY=1 must skip the menu (got: ${forcedText.slice(0, 400)})`);
      assert.ok(!forcedText.includes('Block this call and try another way'), 'a forced no-terminal run must not render the menu');
      if (process.platform !== 'darwin') {
        assert.strictEqual(forced.status, 2, 'a forced no-terminal run must exit 2 even with an answer on stdin');
      }
      assert.strictEqual(fs.existsSync(guardrailExceptionsPath(store)), false, 'a forced no-terminal run must record nothing');
    }
  } finally {
    fs.rmSync(store, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

runTest('15. A tool call cannot write the exception store, and no unconditional rule can be risk-accepted', () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-guard-selfmint-'));
  const call = (payload) => evaluateProjectMcpGuardrail(payload, { harness: 'omp', repoRoot: store });
  try {
    const ledger = guardrailExceptionsPath(store);
    const write = call({ tool_name: 'Write', tool_input: { file_path: ledger, content: '{}' }, cwd: REPO_ROOT });
    assert.strictEqual(write.allowed, false, 'a tool call must not be able to write the exception store');
    assert.strictEqual(write.code, 'GUARDRAIL_STATE_WRITE_DENIED');

    // The same store through an rtk-wrapped shell must be closed too, or the deny
    // above is cosmetic. `cp` passes the destructive-command rules.
    const shell = call({ tool_name: 'Bash', tool_input: { command: `rtk cp /tmp/forged.json ${ledger}` }, cwd: REPO_ROOT });
    assert.strictEqual(shell.code, 'GUARDRAIL_STATE_WRITE_DENIED');
    assert.ok(describeGuardrailRemediation(shell.code).length > 0, 'the new code must still name another way');

    // No exception can cover it, so accepting one cannot bootstrap a bypass.
    for (const code of ['GUARDRAIL_STATE_WRITE_DENIED', 'SECRET_FILE_WRITE_DENIED']) {
      assert.throws(
        () => recordGuardrailException(store, { code, tool: 'Write', justification: 'let the guard mint itself' }),
        /cannot be risk-accepted/
      );
    }

    // A hand-edited store cannot grant one either, and nothing outlives the ceiling.
    const now = Date.now();
    const forge = (entry) => {
      fs.mkdirSync(path.dirname(ledger), { recursive: true });
      fs.writeFileSync(ledger, JSON.stringify({ version: 1, exceptions: [entry] }));
    };
    const entry = (code, createdAt) => ({
      id: `grx_${code}`, code, tool: '*', path: '*', justification: 'forged', accepted_by: 'forger',
      harness: 'omp', created_at: new Date(createdAt).toISOString(),
      expires_at: new Date(now + 365 * 24 * 3600 * 1000).toISOString()
    });
    forge(entry('SECRET_FILE_WRITE_DENIED', now));
    const forged = call({ tool_name: 'Write', tool_input: { file_path: path.join(REPO_ROOT, '.env') }, cwd: REPO_ROOT });
    assert.strictEqual(forged.allowed, false, 'a forged entry must not cover an unconditional denial');
    assert.strictEqual(forged.code, 'SECRET_FILE_WRITE_DENIED');

    forge(entry('KONOHA_MCP_REQUIRED_READ', now - 2 * 3600 * 1000));
    assert.deepStrictEqual(readGuardrailExceptions(store), [], 'an entry older than the ceiling must be pruned');

    // A recorded acceptance is capped too, so --ttl-minutes cannot mint a month.
    fs.rmSync(ledger, { force: true });
    const capped = recordGuardrailException(store, {
      code: 'KONOHA_MCP_REQUIRED_READ', tool: 'Read', justification: 'ceiling probe for the store', ttlMs: 365 * 24 * 3600 * 1000
    });
    const cappedMs = Date.parse(capped.expires_at) - Date.parse(capped.created_at);
    assert.ok(cappedMs <= 60 * 60 * 1000, `an accepted risk must be capped at an hour (got ${cappedMs} ms)`);

    // Ordinary writes stay allowed: the deny is the store, not every write.
    const ordinary = call({ tool_name: 'Write', tool_input: { file_path: path.join(REPO_ROOT, 'src', 'server.js') }, cwd: REPO_ROOT });
    assert.strictEqual(ordinary.allowed, true, `a normal write must stay allowed (got: ${ordinary.reason})`);
  } finally {
    fs.rmSync(store, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

Promise.all(PENDING_TESTS).then(() => {
  fs.rmSync(TEMP_PLUGIN_REPO, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
