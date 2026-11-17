/**
 * Targeted regression suite for branch modifications across:
 *   - src/mcp/workflow_common.js (task_dir symlink/traversal/null-byte & symlinked status.json guards)
 *   - src/mcp/workflow_gates.js (compactPostApprovalContext HMT preservation & LangGraph compaction state)
 *   - src/mcp/workflow_runner.js (findingsSummary HMT anchor slicing)
 *   - src/mcp/workflow_sannin.js (tag-based skill authorization & advisor startup supervisor)
 *   - src/workflow/kage-reviewer/sdlc_manager.js (hasExplicitHitlEnabled, advisor_max_tokens=8192, agent_input_token_quota)
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-sdlc-reg-'));
process.env.HOME = tmpRoot;
process.env.USERPROFILE = tmpRoot;
process.env.KONOHA_HOME = path.join(tmpRoot, '.konoha');
process.env.KONOHA_DB_PATH = path.join(tmpRoot, 'konoha.db');
process.env.KONOHA_SEMANTIC_SEARCH = '0';

const db = require('../src/db');
const sdlcManager = require('../src/workflow/kage-reviewer/sdlc_manager');
const {
  getResolvedTaskDir,
  loadWorkflowStatus,
  saveWorkflowStatus
} = require('../src/mcp/workflow_common');
const { compactPostApprovalContext } = require('../src/mcp/workflow_gates');
const { runMcpWorkflow } = require('../src/mcp/workflow_runner');
const { runSannin } = require('../src/mcp/workflow_sannin');
const { setWorkspaceRoot } = require('../src/mcp/runtime_state');

function trySymlinkDir(target, linkPath) {
  try {
    fs.symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    return true;
  } catch (err) {
    if (err && (err.code === 'EPERM' || err.code === 'EACCES' || err.code === 'ENOTSUP')) return false;
    throw err;
  }
}

function trySymlinkFile(target, linkPath) {
  try {
    fs.symlinkSync(target, linkPath, 'file');
    return true;
  } catch (err) {
    if (err && (err.code === 'EPERM' || err.code === 'EACCES' || err.code === 'ENOTSUP')) return false;
    throw err;
  }
}

function run() {
  const conn = db.getConnection();
  db.setupSchema(conn);

  const proj = path.join(tmpRoot, 'sample_project');
  fs.mkdirSync(proj, { recursive: true });
  setWorkspaceRoot(proj);

  // sdlc_manager: hasExplicitHitlEnabled, advisor_max_tokens=8192, agent_input_token_quota
  assert.strictEqual(sdlcManager.hasExplicitHitlEnabled(proj), false, 'Unregistered project must return false for hasExplicitHitlEnabled');
  const defCfg = sdlcManager.getProjectSdlcConfig(proj);
  assert.strictEqual(defCfg.advisor_max_tokens, 8192, 'Default advisor_max_tokens must be raised to 8192');
  assert.strictEqual(defCfg.agent_input_token_quota, 100000, 'Default agent_input_token_quota must be 100000');

  const updatedCfg = sdlcManager.setProjectSdlcConfig(proj, {
    hitl_mode: 'enabled',
    advisor_max_tokens: 50000,
    agent_input_token_quota: 250000
  });
  assert.strictEqual(updatedCfg.advisor_max_tokens, 8192, 'advisor_max_tokens must clamp at 8192 max');
  assert.strictEqual(updatedCfg.agent_input_token_quota, 250000);
  assert.strictEqual(sdlcManager.hasExplicitHitlEnabled(proj), true, 'Explicitly enabled project must return true');

  const lowClampCfg = sdlcManager.setProjectSdlcConfig(proj, { advisor_max_tokens: 10, agent_input_token_quota: 100 });
  assert.strictEqual(lowClampCfg.advisor_max_tokens, 250, 'advisor_max_tokens must clamp at 250 min');
  assert.strictEqual(lowClampCfg.agent_input_token_quota, 1000, 'agent_input_token_quota must clamp at 1000 min');

  const prevQuotaEnv = process.env.KONOHA_AGENT_INPUT_TOKEN_QUOTA;
  try {
    process.env.KONOHA_AGENT_INPUT_TOKEN_QUOTA = '420000';
    assert.strictEqual(sdlcManager.getProjectSdlcConfig(proj).agent_input_token_quota, 420000, 'Env override must take precedence');
  } finally {
    if (prevQuotaEnv === undefined) delete process.env.KONOHA_AGENT_INPUT_TOKEN_QUOTA;
    else process.env.KONOHA_AGENT_INPUT_TOKEN_QUOTA = prevQuotaEnv;
  }

  sdlcManager.setProjectSdlcConfig(proj, { hitl_mode: 'disabled' });
  assert.strictEqual(sdlcManager.hasExplicitHitlEnabled(proj), false, 'Disabled HITL project must return false');

  // workflow_common: null byte, traversal, out-of-root, symlinked task_dir & status.json guards
  assert.throws(() => getResolvedTaskDir('bad\0dir', proj, 's1'), /null byte/i);
  assert.throws(() => getResolvedTaskDir('../../escape', proj, 's1'), /escapes tasks root/i);
  const forbiddenAbsTaskDir = path.resolve(path.dirname(os.tmpdir()), 'konoha_forbidden_outside_task_dir');
  assert.throws(() => getResolvedTaskDir(forbiddenAbsTaskDir, proj, 's1'), /must reside inside|escapes/i);

  const realTaskDir = getResolvedTaskDir('valid_task_1', proj, 's1');
  fs.mkdirSync(realTaskDir, { recursive: true });
  saveWorkflowStatus(realTaskDir, { phase: 'explore', task_id: 'valid_task_1' });
  assert.strictEqual(loadWorkflowStatus(realTaskDir).phase, 'explore');

  const externalTarget = path.join(tmpRoot, 'outside_symlink_target');
  fs.mkdirSync(externalTarget, { recursive: true });
  const symlinkTaskDir = path.join(path.dirname(realTaskDir), 'symlink_task_dir');
  if (trySymlinkDir(externalTarget, symlinkTaskDir)) {
    assert.throws(() => getResolvedTaskDir(symlinkTaskDir, proj, 's1'), /symlink/i, 'Symlinked task_dir must be rejected');
  }

  const realStatusTarget = path.join(tmpRoot, 'outside_status.json');
  fs.writeFileSync(realStatusTarget, '{}', 'utf8');
  const symlinkStatusTaskDir = getResolvedTaskDir('symlink_status_task', proj, 's2');
  fs.mkdirSync(symlinkStatusTaskDir, { recursive: true });
  const symlinkStatusFile = path.join(symlinkStatusTaskDir, 'status.json');
  if (trySymlinkFile(realStatusTarget, symlinkStatusFile)) {
    assert.throws(
      () => saveWorkflowStatus(symlinkStatusTaskDir, { phase: 'plan' }),
      /Refusing to write symlinked workflow status file/i
    );
  }

  // workflow_gates: compactPostApprovalContext preserves HMT anchors & captures LangGraph state
  const longPlan = `HEAD_PLAN_MARKER\n${'Step detail line\n'.repeat(180)}MIDDLE_PLAN_ANCHOR\n${'More execution steps\n'.repeat(180)}TAIL_PLAN_MARKER`;
  const longFindings = `HEAD_FINDINGS ${'A'.repeat(400)} MIDDLE_FINDINGS ${'B'.repeat(400)} TAIL_FINDINGS`;
  const statusObj = {
    task_id: 'compact_task_1',
    assigned_agent: 'anbu',
    prompt: 'Implement compaction test',
    plan: longPlan,
    findings: longFindings,
    exploration_evidence: `HEAD_EXPL ${'E'.repeat(400)} MIDDLE_EXPL ${'F'.repeat(400)} TAIL_EXPL`,
    project_path: proj,
    session_id: 's3'
  };
  const compactSummary = compactPostApprovalContext(realTaskDir, statusObj, { projectPath: proj, sessionId: 's3' });
  assert.strictEqual(compactSummary.backend, 'langgraph_state');
  assert.strictEqual(compactSummary.compact_trigger, 'gate1_approval');
  assert.deepStrictEqual(compactSummary.preserved_anchors, ['head', 'middle', 'tail']);
  assert.ok(compactSummary.thread_id && compactSummary.checkpoint_ns);
  assert.ok(statusObj.plan.includes('HEAD_PLAN_MARKER') && statusObj.plan.includes('TAIL_PLAN_MARKER'), 'Compacted plan must preserve head and tail anchors');
  assert.ok(statusObj.findings.includes('HEAD_FINDINGS') && statusObj.findings.includes('TAIL_FINDINGS'), 'Compacted findings must preserve head and tail');

  // workflow_runner: findingsSummary preserves head & tail anchor slicing (>500 chars)
  const server = require('../src/server');
  const runnerDir = getResolvedTaskDir('runner_hmt_task', proj, 's4');
  fs.mkdirSync(runnerDir, { recursive: true });
  const bigFinding = `HEAD_RUNNER_ANCHOR ${'X'.repeat(350)} MID_RUNNER_ANCHOR ${'Y'.repeat(350)} TAIL_RUNNER_ANCHOR`;
  saveWorkflowStatus(runnerDir, { schema_version: 2, phase: 'route', prompt: 'Build HMT feature' });
  const expDispatch = JSON.parse(runMcpWorkflow(runnerDir));
  assert.strictEqual(expDispatch.phase, 'explore');
  fs.writeFileSync(path.join(runnerDir, 'findings.md'), bigFinding, 'utf8');
  server.reportFromAgent('genin', bigFinding, 'completed', null, null, null, null, runnerDir, expDispatch.dispatch_id, ['explore traced 3 files, exit 0']);
  const planDispatch = JSON.parse(runMcpWorkflow(runnerDir));
  assert.strictEqual(planDispatch.phase, 'plan');
  assert.ok(planDispatch.findings.includes('HEAD_RUNNER_ANCHOR') && planDispatch.findings.includes('TAIL_RUNNER_ANCHOR'));

  // workflow_sannin: tag-based red skill authorization & advisor startup supervisor
  conn.prepare(`
    INSERT OR REPLACE INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count)
    VALUES ('custom-red-exploit', 'custom-red-exploit', 'skill', 'offensive,red-team', 'Exploit checklist', 'local/SKILL.md', 17, 1)
  `).run();
  const sanninDir = getResolvedTaskDir('sannin_authz_task', proj, 's5');
  const sanninRes = JSON.parse(runSannin('Implement backend API caching endpoint with custom-red-exploit notes', sanninDir, proj, 's5'));
  assert.strictEqual(sanninRes.status, 'routed', 'Sannin should filter unauthorized red skill from prompt autoload for non-akatsuki agent');
  assert.ok(!sanninRes.skills.includes('custom-red-exploit'), 'Red-tagged skill must not leak to @anbu route');
  assert.ok(sanninRes.advisor_supervisor && sanninRes.advisor_supervisor.started_from_beginning === true, 'Sannin must start @advisor supervisor from turn 0');
  assert.ok(sanninRes.advisor_spawn_directive && sanninRes.advisor_spawn_directive.agent === 'advisor');

  conn.close();
  console.log('✓ All SDLC & workflow regression tests passed!');
}

try {
  run();
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
