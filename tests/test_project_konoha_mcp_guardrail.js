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

function runTest(name, fn) {
  try {
    fn();
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
  } finally {
    fs.rmSync(fakeKonoha, { recursive: true, force: true });
  }
});

fs.rmSync(TEMP_PLUGIN_REPO, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
