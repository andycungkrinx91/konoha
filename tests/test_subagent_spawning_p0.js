#!/usr/bin/env node
'use strict';

/**
 * tests/test_subagent_spawning_p0.js — Phase 1 P0 Subagent Spawning Integration Proof
 *
 * Covers every supported client harness (claude, codex, opencode, omp, cursor,
 * commandcode, antigravity, pi):
 *   1. Native deployed config formats & least-privilege boundaries (no wildcards,
 *      read-only genin protections, ownership markers & .konoha-backup/.konoha-proposed)
 *   2. Fail-closed UNSUPPORTED_NATIVE_SPAWN for bare pi / unknown harnesses vs pi-subagents
 *   3. Real OS child-process spawning (PID isolation, workspace cwd, KONOHA_READONLY=1,
 *      child recursive spawn suppression, JSONL events, auto_reported DB evidence, zero legacy md IPC)
 *   4. Harness CLI binary execution, non-zero exit & ENOENT errors
 *   5. Timeout (SIGTERM/SIGKILL) & AbortController cancellation with zero orphan children
 *   6. Concurrent parallel subagent spawning (`spawnParallelSubagents` + CLI `--parallel`)
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-p0-spawn-'));
const SANDBOX_HOME = path.join(TEMP_ROOT, 'home');
const PROJECT_ROOT = path.join(TEMP_ROOT, 'workspace');
const WORKTREE_GENIN = path.join(TEMP_ROOT, 'wt-genin');
const WORKTREE_ANBU = path.join(TEMP_ROOT, 'wt-anbu');

fs.mkdirSync(SANDBOX_HOME, { recursive: true });
fs.mkdirSync(PROJECT_ROOT, { recursive: true });
fs.mkdirSync(WORKTREE_GENIN, { recursive: true });
fs.mkdirSync(WORKTREE_ANBU, { recursive: true });

process.env.HOME = SANDBOX_HOME;
process.env.USERPROFILE = SANDBOX_HOME;

require('./helpers/isolate_db');

const claudeCode = require('../src/mcp_clients/claude_code');
const commandCode = require('../src/mcp_clients/command_code');
const codexManager = require('../src/codex_manager');
const openCodeManager = require('../src/opencode_manager');
const ompManager = require('../src/omp_manager');
const cursorManager = require('../src/cursor_manager');
const antigravityAgents = require('../src/antigravity_agents');
const piManager = require('../src/pi_manager');
const { CANONICAL_AGENT_NAMES } = require('../src/canonical_agents');
const {
  SPAWNABLE_SUBAGENTS,
  resolveSpawnDescriptor,
  buildSpawnDirective,
  buildParallelSpawnDirective
} = require('../src/mcp/lazy_subagent');
const { runMcpAgent } = require('../src/mcp/memory_subagent_runner');
const {
  getActiveChildCount,
  validateSpawnCapability,
  spawnSubagent,
  spawnParallelSubagents
} = require('../src/mcp/subagent_spawner');
const { getDb } = require('../src/db');

const CLI_PATH = path.resolve(__dirname, '..', 'bin', 'cli.js');
let passed = 0;

function check(label, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  PASS ${label}`);
    });
}

function makeMockHarness(name, scriptBody) {
  const binPath = path.join(TEMP_ROOT, `mock-${name}`);
  const src = `#!/usr/bin/env node\n'use strict';\n${scriptBody}\n`;
  fs.writeFileSync(binPath, src, 'utf8');
  fs.chmodSync(binPath, 0o755);
  return binPath;
}

async function waitForFile(filePath, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`Timed out waiting for marker file ${filePath}`);
}

async function waitForPidExit(pid, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      await new Promise((r) => setTimeout(r, 20));
    } catch (err) {
      if (err && err.code === 'ESRCH') return true;
      return true;
    }
  }
  return false;
}

async function main() {
  console.log('Phase 1 P0 Subagent Spawning & 8-Harness Capability Matrix');

  await check('0. Canonical 9-agent roster & 8 spawnable specialists (incl. jonin & yamanaka)', () => {
    const expectedAll = ['sannin', 'genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin', 'akatsuki', 'yamanaka'];
    const expectedSpecialists = ['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin', 'akatsuki', 'yamanaka'];
    assert.strictEqual(CANONICAL_AGENT_NAMES.length, 9, 'Canonical Konoha roster must have exactly 9 agents');
    assert.deepStrictEqual([...CANONICAL_AGENT_NAMES].sort(), [...expectedAll].sort());
    assert.strictEqual(SPAWNABLE_SUBAGENTS.length, 8, 'Spawnable specialist list must have all 8 specialists');
    assert.deepStrictEqual([...SPAWNABLE_SUBAGENTS].sort(), [...expectedSpecialists].sort());

    const sanninRes = JSON.parse(runMcpAgent('sannin', {
      task: 'Triage and route 9-agent parity verification',
      projectPath: PROJECT_ROOT,
      client: 'claude'
    }));
    assert.strictEqual(sanninRes.status, 'ready');
    for (const specialist of expectedSpecialists) {
      const spRes = JSON.parse(runMcpAgent(specialist, {
        task: `Execute ${specialist} verification slice`,
        projectPath: PROJECT_ROOT,
        client: 'claude'
      }));
      assert.strictEqual(spRes.status, 'ready', `${specialist} must dispatch cleanly`);
      assert.strictEqual(spRes.agent, specialist);
      assert.ok(spRes.spawn_directive && spRes.spawn_directive.includes(specialist), `${specialist} must receive native spawn directive`);
    }
  });

  await check('1. Native agent profiles & conflict safety across all 8 harnesses', () => {
    const sampleGenin = { name: 'genin', description: 'explorer', instructions: 'Explore code.', skills: [] };
    const sampleAnbu = { name: 'anbu', description: 'backend', instructions: 'Fix bugs.', skills: [] };
    const sampleSannin = { name: 'sannin', description: 'router', instructions: 'Route work.', skills: [] };

    // Claude Code: `tools:` + `disallowedTools:`, read-only genin excludes write tools & Agent
    const claudeHome = path.join(SANDBOX_HOME, 'c_claude');
    const customClaudeAnbu = path.join(claudeHome, '.claude', 'agents', 'anbu.md');
    fs.mkdirSync(path.dirname(customClaudeAnbu), { recursive: true });
    fs.writeFileSync(customClaudeAnbu, '# user-authored custom anbu\n', 'utf8');
    const claudeRes = claudeCode.ensureClaudeCodeSetup({
      home: claudeHome,
      force: true,
      skipDetection: true,
      silent: true
    });
    assert.strictEqual(claudeRes.ok, true);
    assert.strictEqual(fs.readFileSync(customClaudeAnbu, 'utf8'), '# user-authored custom anbu\n');
    assert.ok(fs.existsSync(`${customClaudeAnbu}.konoha-backup`));
    assert.ok(fs.existsSync(`${customClaudeAnbu}.konoha-proposed`));
    const geninClaude = claudeCode.generateClaudeCodeSubagent(sampleGenin);
    assert.ok(geninClaude.includes('tools:\n') && geninClaude.includes('disallowedTools:\n'));
    assert.ok(geninClaude.includes('  - Write\n') && geninClaude.includes('  - Edit\n') && geninClaude.includes('  - Bash\n'));
    assert.ok(!geninClaude.includes('mcp__konoha__code_remove'), 'Read-only genin must not hold destructive MCP tools');
    assert.ok(!geninClaude.includes('mcp__aislop__aislop_fix'), 'Read-only genin must not hold mutating aislop_fix');

    // Codex: ~/.codex/agents/*.toml with sandbox_mode="read-only" for genin and config_file in config.toml
    const codexHome = path.join(SANDBOX_HOME, 'c_codex');
    const codexRes = codexManager.ensureCodexSetup({ home: codexHome, force: true, skipDetection: true, silent: true });
    assert.strictEqual(codexRes.ok, true);
    const codexToml = fs.readFileSync(path.join(codexHome, '.codex', 'config.toml'), 'utf8');
    assert.ok(codexToml.includes('[agents.genin]') && codexToml.includes('config_file = "agents/genin.toml"'));
    const geninToml = fs.readFileSync(path.join(codexHome, '.codex', 'agents', 'genin.toml'), 'utf8');
    const anbuToml = fs.readFileSync(path.join(codexHome, '.codex', 'agents', 'anbu.toml'), 'utf8');
    assert.ok(geninToml.includes('sandbox_mode = "read-only"'));
    assert.ok(anbuToml.includes('sandbox_mode = "workspace-write"'));

    // OpenCode: mode: subagent + permission map + agents/*.md
    const ocHome = path.join(SANDBOX_HOME, 'c_opencode');
    openCodeManager.registerOpenCodeMcp('node', path.join(__dirname, '..', 'src', 'file_tools_mcp.js'), true, { home: ocHome });
    openCodeManager.deployOpenCodeRules(true, { home: ocHome });
    const ocJson = JSON.parse(fs.readFileSync(path.join(ocHome, '.config', 'opencode', 'opencode.json'), 'utf8'));
    assert.strictEqual(ocJson.agent.genin.mode, 'subagent');
    assert.strictEqual(ocJson.agent.genin.permission.edit, 'deny');
    assert.strictEqual(ocJson.agent.genin.permission.bash, 'deny');
    assert.ok(fs.existsSync(path.join(ocHome, '.config', 'opencode', 'agents', 'anbu.md')));

    // OMP: ~/.omp/agent/agents/*.md with generated_by + read-only tool exclusion + conflict safety
    const ompHome = path.join(SANDBOX_HOME, 'c_omp');
    const customOmp = path.join(ompHome, '.omp', 'agent', 'agents', 'anbu.md');
    fs.mkdirSync(path.dirname(customOmp), { recursive: true });
    fs.writeFileSync(customOmp, '# user omp anbu\n', 'utf8');
    const ompAgentsRes = ompManager.deployOmpAgents({ home: ompHome, projectRoot: PROJECT_ROOT, deployProject: true, silent: true });
    assert.strictEqual(ompAgentsRes.ok, true);
    assert.ok(ompAgentsRes.conflicts.some((c) => c.agent === 'anbu'));
    assert.ok(fs.existsSync(`${customOmp}.konoha-backup`) && fs.existsSync(`${customOmp}.konoha-proposed`));
    const ompGenin = fs.readFileSync(path.join(ompHome, '.omp', 'agent', 'agents', 'genin.md'), 'utf8');
    assert.ok(ompGenin.includes('generated_by: konoha'));
    assert.ok(!ompGenin.includes('- write\n') && !ompGenin.includes('- edit\n') && !ompGenin.includes('- bash\n'));

    // Cursor: generated_by marker + readonly: true + conflict safety
    const cursorProj = path.join(TEMP_ROOT, 'cursor-proj');
    fs.mkdirSync(path.join(cursorProj, '.cursor', 'agents'), { recursive: true });
    const customCursor = path.join(cursorProj, '.cursor', 'agents', 'anbu.md');
    fs.writeFileSync(customCursor, '# user cursor anbu\n', 'utf8');
    assert.strictEqual(cursorManager.deployProjectCursor(cursorProj, [sampleGenin, sampleAnbu], true), true);
    assert.strictEqual(fs.readFileSync(customCursor, 'utf8'), '# user cursor anbu\n');
    assert.ok(fs.existsSync(`${customCursor}.konoha-backup`) && fs.existsSync(`${customCursor}.konoha-proposed`));
    assert.ok(cursorManager.generateCursorSubagent(sampleGenin).includes('readonly: true'));

    // CommandCode: tools: frontmatter + generated_by
    const ccHome = path.join(SANDBOX_HOME, 'c_cc');
    const ccRes = commandCode.deployCommandCodeRules(true, { home: ccHome });
    assert.strictEqual(ccRes.ok, true);
    const ccGenin = fs.readFileSync(path.join(ccHome, '.commandcode', 'agents', 'genin.md'), 'utf8');
    assert.ok(ccGenin.includes('generated_by: konoha') && ccGenin.includes('tools:\n'));

    // Antigravity: PascalCase define_subagent args & Workspace gating
    const agySannin = antigravityAgents.buildDefineSubagentArgs(sampleSannin);
    const agyGenin = antigravityAgents.buildDefineSubagentArgs(sampleGenin);
    assert.strictEqual(agySannin.EnableSubagentTools, true);
    assert.strictEqual(agyGenin.EnableWriteTools, false);
    assert.strictEqual(agyGenin.EnableSubagentTools, false);
    const agyDirectiveGenin = buildSpawnDirective({ client: 'antigravity', agent: 'genin', prompt: 'Inspect', worktreePath: WORKTREE_GENIN });
    const agyDirectiveAnbu = buildSpawnDirective({ client: 'antigravity', agent: 'anbu', prompt: 'Fix', worktreePath: WORKTREE_ANBU });
    assert.ok(agyDirectiveGenin.includes('Workspace: "inherit"'), 'Read-only genin must keep inherit workspace');
    assert.ok(agyDirectiveAnbu.includes('Workspace: "share"'), 'Writable anbu with worktree uses share workspace');

    // Pi: bare vs pi-subagents extension detection
    const barePiHome = path.join(SANDBOX_HOME, 'c_pi_bare');
    assert.strictEqual(piManager.hasPiSubagentSupport({ home: barePiHome }), false);
    assert.strictEqual(piManager.getPiStatus({ home: barePiHome }).subagentExtensionInstalled, false);
    const extPiHome = path.join(SANDBOX_HOME, 'c_pi_ext');
    fs.mkdirSync(path.join(extPiHome, '.pi', 'agent', 'extensions', 'subagent'), { recursive: true });
    assert.strictEqual(piManager.hasPiSubagentSupport({ home: extPiHome }), true);
    assert.strictEqual(piManager.getPiStatus({ home: extPiHome }).subagentExtensionInstalled, true);
  });

  await check('2. Fail-closed errors for unsupported spawning (bare pi, unknown harness, pkg settings)', () => {
    const bareDir = path.join(SANDBOX_HOME, 'pi_bare_check');
    fs.mkdirSync(bareDir, { recursive: true });
    const descBare = resolveSpawnDescriptor('pi', { home: bareDir });
    assert.strictEqual(descBare.supported, false);
    assert.strictEqual(descBare.error_code, 'UNSUPPORTED_NATIVE_SPAWN');

    const parBare = JSON.parse(buildParallelSpawnDirective({
      client: 'pi',
      home: bareDir,
      dispatches: [{ agent: 'genin', task: 'scan' }, { agent: 'anbu', task: 'fix' }]
    }));
    assert.strictEqual(parBare.ok, false);
    assert.strictEqual(parBare.error_code, 'UNSUPPORTED_NATIVE_SPAWN');

    const pkgPiHome = path.join(SANDBOX_HOME, 'c_pi_pkg');
    fs.mkdirSync(path.join(pkgPiHome, '.pi', 'agent'), { recursive: true });
    fs.writeFileSync(path.join(pkgPiHome, '.pi', 'agent', 'settings.json'), JSON.stringify({ packages: ['npm:pi-subagents'] }), 'utf8');
    assert.strictEqual(resolveSpawnDescriptor('pi', { home: pkgPiHome }).supported, true);

    assert.strictEqual(validateSpawnCapability('nonexistent-harness').ok, false);
  });

  await check('3. Real OS child worker spawns with cwd, read-only env, child suppression & auto_reported DB evidence', async () => {
    const taskDir = path.join(TEMP_ROOT, 'task-worker-proof');
    fs.mkdirSync(taskDir, { recursive: true });
    const geninRes = await spawnSubagent({
      agent: 'genin',
      client: 'claude',
      task: 'Inspect src/code_intel for schema bugs',
      projectPath: PROJECT_ROOT,
      cwd: WORKTREE_GENIN,
      taskDir,
      taskId: 'task-worker-proof',
      dispatchId: 'disp-genin-1',
      autoReport: true
    });
    assert.strictEqual(geninRes.ok, true, `genin spawn failed: ${geninRes.error}`);
    assert.ok(geninRes.child_pid && geninRes.child_pid !== process.pid, 'Must run in distinct OS child PID');
    assert.strictEqual(fs.realpathSync(geninRes.effective_cwd), fs.realpathSync(WORKTREE_GENIN));
    assert.strictEqual(geninRes.read_only_enforced, true);
    assert.strictEqual(geninRes.konoha_readonly_env, '1');
    assert.strictEqual(geninRes.task_context_received, true);
    assert.strictEqual(geninRes.auto_reported, true);
    assert.ok(Array.isArray(geninRes.jsonl_events) && geninRes.jsonl_events.length >= 1);
    assert.ok(!geninRes.instructions.includes('## Spawn (mandatory)'), 'Child worker must not emit recursive spawn directive');

    // Verify canonical DB / zero legacy markdown IPC files
    for (const legacyFile of ['prompt.md', 'delegate.md', 'delegated.md', 'result.md']) {
      assert.strictEqual(fs.existsSync(path.join(taskDir, legacyFile)), false, `Legacy ${legacyFile} must not be created`);
    }
    const conn = getDb();
    try {
      const row = conn.prepare('SELECT evidence FROM sdlc_tasks WHERE id = ?').get('task-worker-proof');
      assert.ok(row && row.evidence && row.evidence.includes('child_spawn_verified:genin:claude'), 'Evidence must persist to SQLite');
    } finally {
      conn.close();
    }

    // Bare pi fails loudly through spawnSubagent too
    const piRes = await spawnSubagent({ agent: 'anbu', client: 'pi', piSubagentSupported: false, task: 'Should fail' });
    assert.strictEqual(piRes.ok, false);
    assert.strictEqual(piRes.error_code, 'UNSUPPORTED_NATIVE_SPAWN');
  });

  if (process.platform !== 'win32') {
    await check('4. Real executable harness binary execution, non-zero exit & ENOENT across 8 clients', async () => {
      const markerLog = path.join(TEMP_ROOT, 'harness-calls.jsonl');
      const mockBin = makeMockHarness('ok', `
        const fs = require('fs');
        const entry = {
          pid: process.pid,
          cwd: process.cwd(),
          readonly: process.env.KONOHA_READONLY,
          workspace: process.env.KONOHA_WORKSPACE,
          client: process.env.KONOHA_CHILD_CLIENT,
          argv: process.argv.slice(2)
        };
        fs.appendFileSync(${JSON.stringify(markerLog)}, JSON.stringify(entry) + '\\n');
        console.log(JSON.stringify({ type: 'started', child_pid: process.pid }));
        console.log(JSON.stringify({ type: 'result', status: 'completed', effective_cwd: process.cwd(), summary: 'verified_by_mock' }));
      `);

      for (const client of ['claude', 'codex', 'opencode', 'omp', 'cursor', 'commandcode', 'antigravity']) {
        const res = await spawnSubagent({
          agent: 'genin',
          client,
          task: `Audit slice for ${client}`,
          projectPath: PROJECT_ROOT,
          cwd: WORKTREE_GENIN,
          execute: true,
          harnessBin: mockBin
        });
        assert.strictEqual(res.ok, true, `${client} harness execution failed: ${res.error}`);
        assert.strictEqual(res.summary, 'verified_by_mock');
        assert.strictEqual(res.read_only_enforced, true);
        assert.ok(res.jsonl_events.length === 2);
      }

      // Pi + pi-subagents mock harness
      const piExtRes = await spawnSubagent({
        agent: 'anbu',
        client: 'pi',
        piSubagentSupported: true,
        task: 'Fix endpoint',
        projectPath: PROJECT_ROOT,
        cwd: WORKTREE_ANBU,
        execute: true,
        harnessBin: mockBin
      });
      assert.strictEqual(piExtRes.ok, true);
      const calls = fs.readFileSync(markerLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      const claudeCall = calls.find((c) => c.client === 'claude');
      assert.ok(claudeCall.argv.includes('--disallowedTools'), 'Claude read-only CLI must enforce --disallowedTools');
      const codexCall = calls.find((c) => c.client === 'codex');
      assert.ok(codexCall.argv.includes('read-only'), 'Codex read-only CLI must enforce -s read-only');
      const piCall = calls.find((c) => c.client === 'pi');
      assert.strictEqual(piCall.readonly, '0');
      assert.strictEqual(fs.realpathSync(piCall.cwd), fs.realpathSync(WORKTREE_ANBU));

      // Non-zero exit code & missing binary
      const failBin = makeMockHarness('fail', `process.stderr.write('boom_err\\n'); process.exit(7);`);
      const failRes = await spawnSubagent({ agent: 'anbu', client: 'claude', task: 'fail', execute: true, harnessBin: failBin });
      assert.strictEqual(failRes.ok, false);
      assert.strictEqual(failRes.error_code, 'SPAWN_NONZERO_EXIT');
      assert.strictEqual(failRes.exit_code, 7);

      const missingRes = await spawnSubagent({
        agent: 'anbu',
        client: 'claude',
        task: 'missing',
        execute: true,
        harnessBin: path.join(TEMP_ROOT, 'definitely-does-not-exist')
      });
      assert.strictEqual(missingRes.ok, false);
      assert.strictEqual(missingRes.error_code, 'HARNESS_BINARY_NOT_FOUND');
    });

    await check('5. Timeout (SIGTERM->SIGKILL) & AbortController cancellation leave zero orphan processes', async () => {
      const sleeperBin = makeMockHarness('sleeper', `
        const fs = require('fs');
        const marker = process.argv[process.argv.length - 1];
        const markerPath = process.env.KONOHA_PID_MARKER;
        if (markerPath) fs.writeFileSync(markerPath, String(process.pid), 'utf8');
        console.log(JSON.stringify({ type: 'started', pid: process.pid }));
        void marker;
        setTimeout(() => {}, 30000);
      `);

      // Timeout kills child & leaves zero active children or live PIDs
      const timeoutMarker = path.join(TEMP_ROOT, 'timeout.pid');
      process.env.KONOHA_PID_MARKER = timeoutMarker;
      const timeoutRes = await spawnSubagent({
        agent: 'genin',
        client: 'claude',
        task: 'sleep until timeout',
        execute: true,
        harnessBin: sleeperBin,
        timeoutMs: 90,
        killGraceMs: 40
      });
      delete process.env.KONOHA_PID_MARKER;
      assert.strictEqual(timeoutRes.ok, false);
      assert.strictEqual(timeoutRes.timed_out, true);
      assert.strictEqual(timeoutRes.error_code, 'SPAWN_TIMEOUT');
      assert.strictEqual(getActiveChildCount(), 0);
      const timedPid = Number(fs.readFileSync(timeoutMarker, 'utf8').trim());
      assert.strictEqual(await waitForPidExit(timedPid), true, `Timed-out child PID ${timedPid} must be dead`);

      // AbortController kills active child after startup marker appears
      const abortMarker = path.join(TEMP_ROOT, 'abort.pid');
      process.env.KONOHA_PID_MARKER = abortMarker;
      const ac = new AbortController();
      const abortPromise = spawnSubagent({
        agent: 'anbu',
        client: 'codex',
        task: 'sleep until aborted',
        execute: true,
        harnessBin: sleeperBin,
        timeoutMs: 10000,
        killGraceMs: 40,
        signal: ac.signal
      });
      await waitForFile(abortMarker);
      const abortedPid = Number(fs.readFileSync(abortMarker, 'utf8').trim());
      ac.abort();
      const abortRes = await abortPromise;
      delete process.env.KONOHA_PID_MARKER;
      assert.strictEqual(abortRes.ok, false);
      assert.strictEqual(abortRes.aborted, true);
      assert.strictEqual(abortRes.error_code, 'SPAWN_ABORTED');
      assert.strictEqual(getActiveChildCount(), 0);
      assert.strictEqual(await waitForPidExit(abortedPid), true, `Aborted child PID ${abortedPid} must be dead`);
    });

    await check('6. Concurrent parallel spawning via spawnParallelSubagents & CLI run-agent --parallel', async () => {
      const delayBin = makeMockHarness('parallel', `
        const start = Date.now();
        setTimeout(() => {
          console.log(JSON.stringify({
            type: 'result',
            child_pid: process.pid,
            started: start,
            ended: Date.now(),
            readonly: process.env.KONOHA_READONLY
          }));
        }, 160);
      `);
      const t0 = Date.now();
      const par = await spawnParallelSubagents(
        [
          { agent: 'genin', task: 'Parallel read slice', cwd: WORKTREE_GENIN },
          { agent: 'anbu', task: 'Parallel write slice', cwd: WORKTREE_ANBU }
        ],
        { client: 'claude', projectPath: PROJECT_ROOT, execute: true, harnessBin: delayBin }
      );
      const wallMs = Date.now() - t0;
      assert.strictEqual(par.ok, true);
      assert.strictEqual(par.results.length, 2);
      assert.notStrictEqual(par.results[0].child_pid, par.results[1].child_pid);
      assert.strictEqual(par.results[0].read_only_enforced, true);
      assert.strictEqual(par.results[1].read_only_enforced, false);
      // Concurrency proof: both 160ms children must overlap in execution time rather than running serially
      assert.ok(par.results[0].started < par.results[1].ended && par.results[1].started < par.results[0].ended, 'Expected parallel subagent execution intervals to overlap');
      assert.ok(wallMs < 500, `Expected concurrent execution < 500ms for two 160ms children (plus Node boot), took ${wallMs}ms`);

      const taskDir = path.join(TEMP_ROOT, 'cli-parallel-task');
      fs.mkdirSync(taskDir, { recursive: true });
      const cliRun = spawnSync(
        process.execPath,
        [
          CLI_PATH, 'run-agent', '--parallel', '--agents', 'genin,anbu',
          '--client', 'claude', '--task', 'CLI concurrent proof',
          '--project-path', PROJECT_ROOT, '--task-dir', taskDir, '--task-id', 'cli-par-1',
          '--execute', '--harness-bin', delayBin, '--auto-report'
        ],
        { encoding: 'utf8', env: process.env }
      );
      assert.strictEqual(cliRun.status, 0, `CLI parallel run failed: ${cliRun.stderr}`);
      const cliJson = JSON.parse(cliRun.stdout.trim());
      assert.strictEqual(cliJson.status, 'parallel_completed');
      assert.strictEqual(cliJson.results.length, 2);
      assert.ok(cliJson.results.every((r) => r.auto_reported === true));
    });
  }

  await check('7. Unattributed clean environment resolves spawn directives cleanly without relaxing unknown-client fail-closed', async () => {
    const cleanHome = path.join(TEMP_ROOT, 'clean-home');
    const cleanTaskDir = path.join(TEMP_ROOT, 'clean-env-task');
    const cleanDispatchTaskDir = path.join(TEMP_ROOT, 'clean-env-dispatch-task');
    fs.mkdirSync(cleanHome, { recursive: true });
    fs.mkdirSync(cleanTaskDir, { recursive: true });
    fs.mkdirSync(cleanDispatchTaskDir, { recursive: true });

    const cleanEnv = { ...process.env, HOME: cleanHome, USERPROFILE: cleanHome, KONOHA_DB_PATH: path.join(TEMP_ROOT, 'clean-env-probe.db') };
    const envVarsToStrip = [
      'ACTIVE_CLIENT', 'KONOHA_CLIENT',
      'ANTIGRAVITY_CONVERSATION_ID', 'ANTIGRAVITY_LS_VERSION', 'ANTIGRAVITY_AGENTAPI_EXE',
      'CODEX_SESSION', 'CODEX_THREAD_ID', 'CODEX_CI',
      'OMP_SESSION', 'OMP_SESSION_ID', 'OMP_CLIENT', 'OMP_AGENT',
      'OPENCODE_CLIENT', 'OPENCODE_SESSION', 'OPENCODE_SESSION_ID',
      'COMMANDCODE_CLIENT', 'COMMANDCODE_SESSION', 'COMMANDCODE_SESSION_ID',
      'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CONVERSATION_ID',
      'PI_CODING_AGENT', 'PI_SESSION_FILE', 'PI_SESSION_ID',
      'CURSOR_SESSION_ID', 'KONOHA_SUBAGENT', 'SESSION_ID', 'KONOHA_SESSION_ID'
    ];
    for (const k of envVarsToStrip) delete cleanEnv[k];

    const repoRoot = path.resolve(__dirname, '..');
    const probeScript = path.join(TEMP_ROOT, 'clean_env_probe.js');
    fs.writeFileSync(probeScript, [
      "'use strict';",
      "const assert = require('assert');",
      "const fs = require('fs');",
      "const path = require('path');",
      `const repoRoot = ${JSON.stringify(repoRoot)};`,
      `const projectPath = ${JSON.stringify(PROJECT_ROOT)};`,
      `const taskDir = ${JSON.stringify(cleanTaskDir)};`,
      `const dispatchTaskDir = ${JSON.stringify(cleanDispatchTaskDir)};`,
      "const { detectActiveClient } = require(path.join(repoRoot, 'src/mcp/client_detection'));",
      "const { buildSpawnDirective } = require(path.join(repoRoot, 'src/mcp/lazy_subagent'));",
      "const { runSannin } = require(path.join(repoRoot, 'src/mcp/workflow_sannin'));",
      "const { runMcpAgent } = require(path.join(repoRoot, 'src/mcp/memory_subagent_runner'));",
      "const { saveWorkflowStatus } = require(path.join(repoRoot, 'src/mcp/workflow_common'));",
      "const { dispatchNode } = require(path.join(repoRoot, 'src/mcp/langgraph/nodes/dispatch'));",
      "const { executeNode } = require(path.join(repoRoot, 'src/mcp/langgraph/nodes/execute'));",
      "(async () => {",
      "  assert.strictEqual(detectActiveClient(), 'unattributed');",
      "  const sanninRes = JSON.parse(runSannin('Explore codebase architecture', taskDir, projectPath));",
      "  assert.ok(sanninRes.instructions && sanninRes.instructions.includes('## Spawn (mandatory)'), 'runSannin must emit spawn directive when client is unattributed');",
      "  assert.ok(!sanninRes.instructions.includes('UNSUPPORTED_NATIVE_SPAWN'));",
      "  const agentRes = JSON.parse(runMcpAgent('anbu', { task: 'Fix bug', projectPath, taskDir }));",
      "  assert.ok(agentRes.spawn_directive && agentRes.spawn_directive.includes('## Spawn (mandatory)'), 'runMcpAgent must emit spawn directive when client is unattributed');",
      "  const explicitUnattribRes = JSON.parse(runMcpAgent('anbu', { task: 'Fix bug', projectPath, taskDir, client: 'unattributed' }));",
      "  assert.ok(explicitUnattribRes.spawn_directive && explicitUnattribRes.spawn_directive.includes('## Spawn (mandatory)'), 'runMcpAgent must normalize explicit unattributed client');",
      "  const unknownAgentRes = JSON.parse(runMcpAgent('anbu', { task: 'Fix bug', projectPath, taskDir, client: 'unknown-client' }));",
      "  assert.strictEqual(unknownAgentRes.status, 'unsupported_native_spawn');",
      "  assert.strictEqual(unknownAgentRes.spawn_error && unknownAgentRes.spawn_error.error_code, 'UNSUPPORTED_NATIVE_SPAWN');",
      "  saveWorkflowStatus(dispatchTaskDir, {",
      "    phase: 'execute',",
      "    client: 'unattributed',",
      "    project_path: projectPath,",
      "    assigned_agent: 'anbu',",
      "    tasks: [{ id: 't_clean_1', agent: 'anbu', task: 'Fix bug', status: 'pending' }]",
      "  });",
      "  const dispatchOut = await dispatchNode({ taskDir: dispatchTaskDir });",
      "  const dSpawn = dispatchOut && dispatchOut.result && dispatchOut.result.spawn_directive;",
      "  assert.ok(dSpawn && dSpawn.includes('## Spawn (mandatory)'), 'dispatchNode must resolve unattributed status.client to spawn directive');",
      "  const unknownDispatchOut = await dispatchNode({ taskDir: dispatchTaskDir, client: 'unknown-client' });",
      "  const unknownDSpawn = JSON.parse(unknownDispatchOut.result.spawn_directive);",
      "  assert.strictEqual(unknownDSpawn.error_code, 'UNSUPPORTED_NATIVE_SPAWN');",
      "  const execTaskDir = path.join(path.dirname(dispatchTaskDir), 'clean-env-exec-task');",
      "  fs.mkdirSync(execTaskDir, { recursive: true });",
      "  saveWorkflowStatus(execTaskDir, {",
      "    phase: 'execute',",
      "    client: '',",
      "    project_path: projectPath,",
      "    assigned_agent: 'anbu',",
      "    tasks: [{ id: 't_exec_1', agent: 'anbu', task: 'Fix bug', status: 'pending' }]",
      "  });",
      "  const execOut = await executeNode({ taskDir: execTaskDir, projectPath, status: { phase: 'execute', client: '', tasks: [{ id: 't_exec_1', agent: 'anbu', task: 'Fix bug', status: 'pending' }] } });",
      "  assert.ok(execOut && execOut.status && execOut.status.tasks && execOut.status.tasks[0].result && execOut.status.tasks[0].result.spawn_directive.includes('run-agent'), 'executeNode must resolve empty/unattributed client to universal CLI directive instead of antigravity');",
      "  const badExplicit = JSON.parse(buildSpawnDirective({ client: 'unknown-client', agent: 'anbu', prompt: 'x' }));",
      "  assert.strictEqual(badExplicit.error_code, 'UNSUPPORTED_NATIVE_SPAWN');",
      "  process.env.ACTIVE_CLIENT = 'bare pi';",
      "  assert.strictEqual(detectActiveClient(), 'bare pi');",
      "  const barePiRes = JSON.parse(runMcpAgent('anbu', { task: 'Fix bug', projectPath, taskDir }));",
      "  assert.strictEqual(barePiRes.status, 'unsupported_native_spawn');",
      "  delete process.env.ACTIVE_CLIENT;",
      "})().catch((err) => { console.error(err); process.exit(1); });"
    ].join('\n'), 'utf8');

    const probeRun = spawnSync(process.execPath, [probeScript], { encoding: 'utf8', env: cleanEnv });
    assert.strictEqual(probeRun.status, 0, `Clean-env probe failed:\nSTDOUT:\n${probeRun.stdout}\nSTDERR:\n${probeRun.stderr}`);

    const cliRun = spawnSync(
      process.execPath,
      [CLI_PATH, 'run-agent', '--agent', 'anbu', '--task', 'Fix unattributed CLI bug', '--project-path', PROJECT_ROOT, '--task-dir', cleanTaskDir],
      { encoding: 'utf8', env: cleanEnv }
    );
    assert.strictEqual(cliRun.status, 0, `CLI run-agent without client failed: ${cliRun.stderr}`);
    const cliPayload = JSON.parse(cliRun.stdout.trim());
    assert.strictEqual(cliPayload.ok, true);
    assert.strictEqual(cliPayload.status, 'ready');
    assert.strictEqual(cliPayload.client, 'cli');
    assert.strictEqual(cliPayload.agent, 'anbu');
    assert.ok(cliPayload.child_pid && cliPayload.child_pid !== process.pid);

    const cliUnattribRun = spawnSync(
      process.execPath,
      [CLI_PATH, 'run-agent', '--agent', 'anbu', '--task', 'Fix explicit unattributed CLI bug', '--client', 'unattributed', '--project-path', PROJECT_ROOT, '--task-dir', cleanTaskDir],
      { encoding: 'utf8', env: cleanEnv }
    );
    assert.strictEqual(cliUnattribRun.status, 0, `CLI run-agent --client unattributed failed: ${cliUnattribRun.stderr}`);
    const cliUnattribPayload = JSON.parse(cliUnattribRun.stdout.trim());
    assert.strictEqual(cliUnattribPayload.ok, true);
    assert.strictEqual(cliUnattribPayload.client, 'cli');

    const cliUnknownRun = spawnSync(
      process.execPath,
      [CLI_PATH, 'run-agent', '--agent', 'anbu', '--task', 'Should fail closed', '--client', 'unknown-client', '--project-path', PROJECT_ROOT, '--task-dir', cleanTaskDir],
      { encoding: 'utf8', env: cleanEnv }
    );
    assert.strictEqual(cliUnknownRun.status, 1, 'CLI run-agent --client unknown-client must fail closed');
    const cliUnknownPayload = JSON.parse(cliUnknownRun.stdout.trim());
    assert.strictEqual(cliUnknownPayload.ok, false);
    assert.strictEqual(cliUnknownPayload.error_code, 'UNSUPPORTED_NATIVE_SPAWN');
  });

  await check('8. Turn-0 idle @advisor profile deployed across all 8 harnesses & CLI --idle supervisor', async () => {
    const { CANONICAL_AGENT_NAMES: nine, getDeployableAgentNames, isResidentSupervisorAgent } = require('../src/canonical_agents');
    const { buildAdvisorStartupDirective, isSpawnableAdvisor } = require('../src/mcp/lazy_subagent');
    assert.strictEqual(nine.length, 9, 'Canonical ninja roster stays 9');
    assert.strictEqual(SPAWNABLE_SUBAGENTS.length, 8, 'Spawnable worker subagent count stays 8');
    assert.ok(getDeployableAgentNames().includes('advisor') && isResidentSupervisorAgent('advisor') && isSpawnableAdvisor('advisor'));

    // Verify advisor agent profiles across Claude, Codex, OpenCode, OMP, Cursor, CommandCode, Pi, Antigravity
    const advHome = path.join(SANDBOX_HOME, 'advisor_all_8');
    claudeCode.ensureClaudeCodeSetup({ home: advHome, force: true, skipDetection: true, silent: true });
    assert.ok(fs.existsSync(path.join(advHome, '.claude', 'agents', 'advisor.md')));
    codexManager.ensureCodexSetup({ home: advHome, force: true, skipDetection: true, silent: true });
    codexManager.ensureCodexSetup({ home: advHome, force: true, skipDetection: true, silent: true });
    const codexTomlAdv = fs.readFileSync(path.join(advHome, '.codex', 'config.toml'), 'utf8');
    assert.ok(codexTomlAdv.includes('[agents.advisor]'), 'Codex config must keep [agents.advisor] managed across re-deploys');
    assert.ok(fs.existsSync(path.join(advHome, '.codex', 'agents', 'advisor.toml')));
    assert.ok(fs.readFileSync(path.join(advHome, '.codex', 'agents', 'advisor.toml'), 'utf8').includes('sandbox_mode = "read-only"'));
    openCodeManager.deployOpenCodeRules(true, { home: advHome });
    assert.ok(fs.existsSync(path.join(advHome, '.config', 'opencode', 'agents', 'advisor.md')));
    ompManager.deployOmpAgents({ home: advHome, projectRoot: PROJECT_ROOT, deployProject: false, silent: true });
    assert.ok(fs.existsSync(path.join(advHome, '.omp', 'agent', 'agents', 'advisor.md')));
    commandCode.deployCommandCodeRules(true, { home: advHome });
    assert.ok(fs.existsSync(path.join(advHome, '.commandcode', 'agents', 'advisor.md')));
    piManager.ensurePiSetup({ home: advHome, force: true, skipDetection: true, silent: true });
    const piAdvMd = fs.readFileSync(path.join(advHome, '.pi', 'agent', 'agents', 'advisor.md'), 'utf8');
    assert.ok(piAdvMd.includes('tools: read, grep, find, ls'), 'Pi advisor profile must declare read-only tools');
    const cursorAdvProj = path.join(SANDBOX_HOME, 'cursor_adv_proj');
    fs.mkdirSync(cursorAdvProj, { recursive: true });
    cursorManager.deployProjectCursor(cursorAdvProj, [], true);
    const cursorAdvMd = fs.readFileSync(path.join(cursorAdvProj, '.cursor', 'agents', 'advisor.md'), 'utf8');
    assert.ok(cursorAdvMd.includes('readonly: true'), 'Cursor advisor profile must enforce readonly: true');
    antigravityAgents.ensureAntigravityAgents([], { home: advHome });
    assert.ok(fs.existsSync(path.join(advHome, '.gemini', 'antigravity-cli', 'agents', 'advisor', 'agent.json')));
    assert.ok(fs.existsSync(path.join(advHome, '.gemini', 'antigravity-ide', 'agents', 'advisor', 'agent.json')));

    for (const c of ['antigravity', 'claude', 'codex', 'omp', 'cursor', 'opencode', 'commandcode']) {
      const startup = buildAdvisorStartupDirective({ client: c, projectPath: PROJECT_ROOT, prompt: 'Verify advisor turn-0 startup' });
      assert.strictEqual(startup.agent, 'advisor');
      assert.strictEqual(startup.state, 'idle');
      assert.strictEqual(startup.started_from_beginning, true);
      assert.strictEqual(startup.review_scope, 'all_agents');
      assert.strictEqual(startup.supported_native, true, `Advisor native spawn expected for ${c}`);
    }

    const cliAdv = spawnSync(
      process.execPath,
      [CLI_PATH, 'run-agent', '--agent', 'advisor', '--idle', '--client', 'codex', '--project-path', PROJECT_ROOT],
      { encoding: 'utf8' }
    );
    assert.strictEqual(cliAdv.status, 0, `CLI run-agent --agent advisor --idle failed: ${cliAdv.stderr}`);
    const cliAdvJson = JSON.parse(cliAdv.stdout.trim());
    assert.strictEqual(cliAdvJson.agent, 'advisor');
    assert.strictEqual(cliAdvJson.status, 'ready');
  });

  console.log(`\nPhase 1 P0 spawning suite passed (${passed} checks).`);
}

main()
  .catch((err) => {
    console.error('Phase 1 P0 spawning suite FAILED:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    try { fs.rmSync(TEMP_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch (_) {}
  });
