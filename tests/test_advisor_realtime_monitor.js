'use strict';
require('./helpers/isolate_db');

/**
 * Verification Suite: Component 7 — Real-Time Idle `@advisor` Worker Manager & Hallucination Guard
 * (`<= 8,192 Tokens` / Turn Hard Budget, `0 Tokens` When Idle, Head+Middle+Tail Anti-Lost-in-the-Middle)
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const advisorMonitor = require('../src/workflow/kage-reviewer/advisor_monitor');
const {
  MAX_ADVISOR_TURN_TOKENS,
  MAX_ADVISOR_TURN_BYTES,
  clampAdvisorBytes,
  estimateTokens,
  evaluateWorkerTurn
} = advisorMonitor;

async function runTests() {
  console.log('Running test_advisor_realtime_monitor.js...');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-advisor-test-'));
  const validFile = path.join(tmpDir, 'valid.js');
  fs.writeFileSync(validFile, "'use strict';\nmodule.exports = { ok: true };\n", 'utf8');

  assert.strictEqual(MAX_ADVISOR_TURN_TOKENS, 8192);
  assert.strictEqual(MAX_ADVISOR_TURN_BYTES, 32768);

  const hugeSummary = 'Implemented backend endpoint with validation. '.repeat(500);
  const clamped = clampAdvisorBytes(hugeSummary, MAX_ADVISOR_TURN_BYTES);
  const byteLength = Buffer.byteLength(clamped, 'utf8');
  const tokenEstimate = estimateTokens(clamped);
  assert.ok(byteLength <= MAX_ADVISOR_TURN_BYTES, `Clamped bytes ${byteLength} exceeded ${MAX_ADVISOR_TURN_BYTES}`);
  assert.ok(tokenEstimate <= MAX_ADVISOR_TURN_TOKENS, `Clamped tokens ${tokenEstimate} exceeded ${MAX_ADVISOR_TURN_TOKENS}`);

  const idleRes = evaluateWorkerTurn({
    agent: 'anbu',
    delegatedTodo: 'Implement backend endpoint with validation',
    summary: 'Implemented backend endpoint with validation in valid.js and verified unit tests.',
    ownedFiles: [validFile],
    filesModified: [validFile],
    worktreePath: tmpDir,
    status: 'completed',
    validation: ['node tests/run_all.js: 5 passed (exit 0)']
  });
  assert.strictEqual(idleRes.status, 'IDLE_OK');
  assert.strictEqual(idleRes.interrupted, false);
  assert.strictEqual(idleRes.tokens_used, 0, 'Compliant worker turn must consume 0 advisor output tokens');
  assert.strictEqual(idleRes.evict_stale_results, true);

  const conflictFile = path.join(tmpDir, 'conflict.js');
  fs.writeFileSync(conflictFile, '<<<<<<< HEAD\nconst a = 1;\n=======\nconst a = 2;\n>>>>>>> branch\n', 'utf8');
  const nonExistentFile = path.join(tmpDir, 'hallucinated_ghost_file.js');

  const interruptRes = evaluateWorkerTurn({
    agent: 'jonin',
    delegatedTodo: 'Build responsive navigation header component',
    summary: 'TODO: placeholder implementation completed successfully without running tests',
    ownedFiles: [validFile],
    filesModified: [conflictFile, nonExistentFile, '/etc/outside_worktree.js'],
    worktreePath: tmpDir,
    checkDiskExistence: true,
    status: 'completed',
    validation: []
  });

  assert.strictEqual(interruptRes.status, 'INTERRUPT_CORRECTION');
  assert.strictEqual(interruptRes.interrupted, true);
  assert.strictEqual(interruptRes.evict_stale_results, true);
  assert.ok(interruptRes.tokens_used <= MAX_ADVISOR_TURN_TOKENS, 'Interrupt directive must stay <= 8,192 tokens');
  assert.ok(interruptRes.violations.some((v) => v.type === 'owned_files_breach' || v.type === 'worktree_escape'));
  assert.ok(interruptRes.violations.some((v) => v.type === 'fabricated_file'));
  assert.ok(interruptRes.violations.some((v) => v.type === 'conflict_marker'));
  assert.ok(interruptRes.violations.some((v) => v.type === 'placeholder_slop'));
  assert.ok(interruptRes.directive && interruptRes.directive.includes('[ADVISOR INTERRUPT'));

  // Test 7: Turn-0 session supervisor initialization + all-agent Plan/TODO/Goal drift + all-8-client direct steering
  const {
    initAdvisorSessionSupervisor,
    checkPlanTodoGoalDrift,
    buildClientSteerCall,
    enqueueAdvisorSteer,
    peekPendingAdvisorSteers,
    consumeAdvisorSteerContext,
    formatSteerInjectionBlock
  } = advisorMonitor;
  const { reportFromAgent } = require('../src/mcp/memory_project_context');

  const taskDir = path.join(tmpDir, 'task-steer-1');
  fs.mkdirSync(taskDir, { recursive: true });
  const wfStatus = {
    task_id: 'task-steer-1',
    client: 'codex',
    prompt: 'Implement JWT authentication endpoints',
    plan: '1. [anbu] Implement JWT auth controller\n2. [jonin] Add login UI',
    tasks: [
      { id: 't1', agent: 'anbu', task: 'Implement JWT auth controller', status: 'in_progress' }
    ]
  };

  const sup = initAdvisorSessionSupervisor({
    client: 'codex',
    status: wfStatus,
    goal: wfStatus.prompt,
    plan: wfStatus.plan,
    todos: wfStatus.tasks
  });
  assert.strictEqual(sup.agent, 'advisor');
  assert.strictEqual(sup.state, 'idle');
  assert.strictEqual(sup.started_from_beginning, true);
  assert.strictEqual(sup.review_scope, 'all_agents');
  assert.strictEqual(sup.tokens_used, 0);

  // Non-worker / all-agent drift during in_progress turn: agent bypasses plan & drifts off goal
  const kageDriftViolations = checkPlanTodoGoalDrift({
    agent: 'kage',
    status: 'in_progress',
    delegatedTodo: 'Implement JWT auth controller',
    goal: 'Implement JWT authentication endpoints',
    plan: '1. [anbu] Implement JWT auth controller',
    todos: wfStatus.tasks,
    summary: 'Agent bypassed the plan and jumped ahead with unrelated feature work'
  });
  assert.ok(kageDriftViolations.some((v) => v.type === 'goal_drift' || v.type === 'plan_drift'), 'must detect Goal/Plan drift across all agents including kage');

  const anbuDriftViolations = checkPlanTodoGoalDrift({
    agent: 'anbu',
    status: 'in_progress',
    delegatedTodo: 'Implement JWT auth controller and token refresh',
    goal: 'Implement JWT authentication endpoints and login middleware',
    plan: '1. [anbu] Implement JWT auth controller',
    todos: wfStatus.tasks,
    summary: 'Modified pricing calculator invoice export table and currency formatter columns'
  });
  assert.ok(anbuDriftViolations.some((v) => v.type === 'goal_drift'), 'must detect in-progress zero-overlap goal drift on worker agent');

  // Verify all 8 clients generate valid native direct steer calls
  const all8Clients = ['antigravity', 'claude', 'codex', 'omp', 'cursor', 'opencode', 'commandcode', 'pi'];
  for (const c of all8Clients) {
    const call = buildClientSteerCall({
      client: c,
      targetAgent: 'anbu',
      targetAgentId: 'agent-123',
      directive: '[ADVISOR STEER] Stay on JWT auth plan',
      piSubagentSupported: c === 'pi'
    });
    assert.strictEqual(call.client, c);
    assert.strictEqual(call.target_agent, 'anbu');
    assert.ok(call.tool && call.call, `Expected native steer descriptor for ${c}`);
  }
  const piFallback = buildClientSteerCall({ client: 'pi', targetAgent: 'anbu', directive: 'Steer', piSubagentSupported: false });
  assert.strictEqual(piFallback.transport, 'cli_steer');

  // Queue + peek + format + consume steer persistence
  const queued = enqueueAdvisorSteer({
    taskDir,
    workflowStatus: wfStatus,
    client: 'codex',
    targetAgent: 'anbu',
    violations: [{ type: 'todo_drift', detail: 'drifted off TODO' }],
    directive: '[ADVISOR STEER] Realign with TODO t1'
  });
  assert.strictEqual(queued.status, 'pending');
  assert.strictEqual(wfStatus.advisor_supervisor.state, 'steering');
  assert.strictEqual(peekPendingAdvisorSteers(taskDir, 'anbu').length, 1);
  assert.ok(formatSteerInjectionBlock(peekPendingAdvisorSteers(taskDir, 'anbu')).includes('[ADVISOR STEER'));
  const consumed = consumeAdvisorSteerContext(taskDir, 'anbu');
  assert.strictEqual(consumed.pending.length, 1);
  assert.ok(consumed.block.includes('[ADVISOR STEER DIRECTIVE'));
  assert.strictEqual(peekPendingAdvisorSteers(taskDir, 'anbu').length, 0);

  // reportFromAgent triggers live evaluation + direct steer_call across all active agents
  fs.writeFileSync(path.join(taskDir, 'status.json'), JSON.stringify(wfStatus, null, 2), 'utf8');
  const repRaw = reportFromAgent({
    agent: 'anbu',
    summary: 'I deleted unrelated invoice styling and bypassed the plan entirely',
    status: 'in_progress',
    taskDir,
    projectPath: tmpDir
  });
  const rep = JSON.parse(repRaw);
  assert.strictEqual(rep.advisor_interrupted, true, 'Drift on in_progress report must trigger advisor steer');
  assert.ok(rep.advisor_steer_call && rep.advisor_target_agent === 'anbu');
  assert.ok(rep.advisor_directive.includes('[ADVISOR STEER]'));

  // Test 8: Security hardening regressions (shell quoting, MCP read-only advisor block, relative traversal & task_dir containment)
  const { checkGeninToolAccess } = require('../src/mcp/genin_guard');
  const { getResolvedTaskDir } = require('../src/mcp/workflow_common');

  const injCall = buildClientSteerCall({
    client: 'pi',
    targetAgent: 'anbu; id',
    directive: 'Stop $(id) `whoami` "quoted" & stay on plan',
    piSubagentSupported: false
  });
  assert.strictEqual(injCall.target_agent, 'anbuid');
  assert.ok(injCall.command.includes("--task 'Stop $(id)"), 'CLI fallback must POSIX single-quote untrusted directive text');

  assert.strictEqual(checkGeninToolAccess('document_create', { agent: 'advisor' }, () => '').allowed, false);
  assert.strictEqual(checkGeninToolAccess('sannin', { agent: 'advisor' }, () => '').allowed, false);
  assert.strictEqual(checkGeninToolAccess('aislop_fix', { agent: 'advisor' }, () => '').allowed, false);
  assert.strictEqual(checkGeninToolAccess('code_search', { agent: 'advisor' }, () => '').allowed, true);
  assert.strictEqual(checkGeninToolAccess('code_remove', { agent: 'anbu' }, () => 'advisor').allowed, false, 'Active @advisor session must stay pinned in read-only mode');

  const traversalRes = evaluateWorkerTurn({
    agent: 'anbu',
    delegatedTodo: 'Update valid file only',
    summary: 'Update valid file only done cleanly',
    ownedFiles: [validFile],
    filesModified: ['../../etc/passwd'],
    worktreePath: tmpDir,
    status: 'completed',
    validation: ['passed 100% exit code 0']
  });
  assert.strictEqual(traversalRes.interrupted, true, 'Relative ../ traversal must trigger worktree/owned_files violation');
  assert.ok(traversalRes.violations.some((v) => v.type === 'worktree_escape'));

  assert.throws(() => getResolvedTaskDir('../../escape-root', tmpDir), /escapes tasks root/);

  // Test 9: 8K Advisor budget, SDLC ceiling, & Anti-Lost-in-the-Middle workflow budget preservation
  const dbModule = require('../src/db');
  const sdlcManager = require('../src/workflow/kage-reviewer/sdlc_manager');
  const workflowGates = require('../src/mcp/workflow_gates');
  const skillsCommon = require('../src/mcp/skills_common');
  const requestBudget = require('../src/bridge/request_budget');
  const toolPayload = require('../src/bridge/tool_payload');
  const { planRouter } = require('../src/mcp/langgraph/edges/router');
  const { runMcpAgent } = require('../src/mcp/memory_subagent_runner');

  const budgetProjDir = path.join(tmpDir, 'budget-proj');
  fs.mkdirSync(budgetProjDir, { recursive: true });
  const testDbPath = path.join(tmpDir, 'advisor-budget-test.db');
  const initDbConn = dbModule.getConnection(testDbPath);
  dbModule.setupSchema(initDbConn);
  initDbConn.close();

  const defaultCfg = sdlcManager.getProjectSdlcConfig(budgetProjDir, testDbPath);
  assert.strictEqual(defaultCfg.advisor_max_tokens, 8192, 'Default advisor_max_tokens must be 8192 (8K)');
  assert.strictEqual(defaultCfg.agent_input_token_quota, 100000, 'Default agent_input_token_quota must be 100000');
  const updatedQuotaCfg = sdlcManager.setProjectSdlcConfig(budgetProjDir, { agent_input_token_quota: 45000 }, testDbPath);
  assert.strictEqual(updatedQuotaCfg.agent_input_token_quota, 45000, 'agent_input_token_quota must persist dynamic user value');
  assert.strictEqual(sdlcManager.getProjectSdlcConfig(budgetProjDir, testDbPath).agent_input_token_quota, 45000);
  assert.strictEqual(sdlcManager.setProjectSdlcConfig(budgetProjDir, { agent_input_token_quota: 100 }, testDbPath).agent_input_token_quota, 1000, 'agent_input_token_quota must clamp to 1000 floor');
  assert.strictEqual(sdlcManager.setProjectSdlcConfig(budgetProjDir, { agent_input_token_quota: 99999999 }, testDbPath).agent_input_token_quota, 2000000, 'agent_input_token_quota must clamp to 2000000 ceiling');
  const cappedCfg = sdlcManager.setProjectSdlcConfig(budgetProjDir, { advisor_max_tokens: 999999 }, testDbPath);
  assert.strictEqual(cappedCfg.advisor_max_tokens, 8192, 'advisor_max_tokens must clamp to 8192 ceiling');
  const flooredCfg = sdlcManager.setProjectSdlcConfig(budgetProjDir, { advisor_max_tokens: 10 }, testDbPath);
  assert.strictEqual(flooredCfg.advisor_max_tokens, 250, 'advisor_max_tokens must clamp to 250 floor');

  const filler = 'Standard diagnostic telemetry line padding context window safely. '.repeat(260);
  const advisorBlob = [
    'HEAD_GOAL_ANCHOR: Deliver production API without regression.',
    filler,
    'Constraint: MIDDLE_CRITICAL_RULE must validate HMAC webhook signatures.',
    filler,
    'TAIL_EXECUTION_ANCHOR: Run pnpm test:parallel and report exit code.'
  ].join('\n');
  const clamped8k = clampAdvisorBytes(advisorBlob, MAX_ADVISOR_TURN_BYTES);
  assert.ok(Buffer.byteLength(clamped8k, 'utf8') <= MAX_ADVISOR_TURN_BYTES);
  assert.ok(clamped8k.includes('HEAD_GOAL_ANCHOR'), '8K clamp must keep head anchor');
  assert.ok(clamped8k.includes('MIDDLE_CRITICAL_RULE'), '8K clamp must keep middle rule');
  assert.ok(clamped8k.includes('TAIL_EXECUTION_ANCHOR'), '8K clamp must keep tail anchor');

  const manyTasks = Array.from({ length: 16 }, (_, idx) => ({
    id: `T-${String(idx + 1).padStart(2, '0')}`,
    agent: idx % 2 === 0 ? 'anbu' : 'jonin',
    status: idx < 8 ? 'completed' : 'pending',
    summary: `Step ${idx + 1} implementation summary`
  }));
  const dynCtx = advisorMonitor.retrieveAdvisorDynamicContext({
    status: { plan: advisorBlob, tasks: manyTasks },
    maxBytes: 8192
  });
  assert.ok(dynCtx.bytes_used <= 8192, `Dynamic context exceeded 8K bytes: ${dynCtx.bytes_used}`);
  assert.ok(dynCtx.context.includes('MIDDLE_CRITICAL_RULE'), 'Dynamic context must preserve middle plan constraint');
  assert.ok(dynCtx.context.includes('T-01') && dynCtx.context.includes('T-16'), 'Dynamic context must preserve head & tail tasks');

  const gateTaskDir = path.join(tmpDir, 'gate-compact-task');
  fs.mkdirSync(gateTaskDir, { recursive: true });
  const gateStatus = {
    plan: [
      'PLAN_HEAD_ANCHOR: Build authenticated gateway.',
      'Step padding line for plan compaction check. '.repeat(50),
      'Constraint: PLAN_MIDDLE_INVARIANT never bypass JWT signature check.',
      'Step padding line for plan compaction check. '.repeat(50),
      'PLAN_TAIL_DELIVERABLE: Verify unit and E2E suites.'
    ].join('\n'),
    findings: [
      'FINDING_HEAD: Inspected auth middleware.',
      'Diagnostic padding line for findings compaction check. '.repeat(25),
      'Must: FINDING_MIDDLE_KEY missing replay nonce check.',
      'Diagnostic padding line for findings compaction check. '.repeat(25),
      'FINDING_TAIL: Patch routes/webhook.js next.'
    ].join('\n')
  };
  workflowGates.compactPostApprovalContext(gateTaskDir, gateStatus, { projectPath: budgetProjDir, sessionId: 'adv-9' });
  assert.ok(gateStatus.plan.includes('PLAN_HEAD_ANCHOR') && gateStatus.plan.includes('PLAN_MIDDLE_INVARIANT') && gateStatus.plan.includes('PLAN_TAIL_DELIVERABLE'));
  assert.ok(gateStatus.findings.includes('FINDING_HEAD') && gateStatus.findings.includes('FINDING_MIDDLE_KEY') && gateStatus.findings.includes('FINDING_TAIL'));

  const multiSectionSkill = [
    '# Skill Header\nKeep API latency low.\n',
    '## Section Alpha\n' + 'Alpha body details. '.repeat(60),
    '## Section Beta Constraint\nCRITICAL_MIDDLE_SKILL_RULE: Never hardcode tokens.\n' + 'Beta body details. '.repeat(60),
    '## Section Gamma\n' + 'Gamma body details. '.repeat(60),
    '## Final Verification Checklist\nTAIL_SKILL_GATE: Confirm 0 warnings.'
  ].join('\n');
  const truncatedSkill = skillsCommon.smartTruncate(multiSectionSkill, 1600, 'budget-skill');
  assert.strictEqual(truncatedSkill.truncated, true);
  assert.ok(truncatedSkill.text.includes('Skill Header') && truncatedSkill.text.includes('CRITICAL_MIDDLE_SKILL_RULE') && truncatedSkill.text.includes('TAIL_SKILL_GATE'));

  const payloadWithMiddle = [
    'TOOL_HEAD_MARKER: Scan started',
    'Middle padding line in bridge output. '.repeat(40),
    'Constraint: TOOL_MIDDLE_ALERT detected timing mismatch',
    'Middle padding line in bridge output. '.repeat(40),
    'TOOL_TAIL_MARKER: Scan finished cleanly'
  ].join('\n');
  const markedPayload = toolPayload.truncateWithMarker(payloadWithMiddle, 900);
  assert.ok(markedPayload.includes('TOOL_HEAD_MARKER') && markedPayload.includes('TOOL_MIDDLE_ALERT') && markedPayload.includes('TOOL_TAIL_MARKER'));

  const historyMsgs = Array.from({ length: 10 }, (_, idx) => ({
    role: idx % 2 === 0 ? 'user' : 'assistant',
    content: idx === 5
      ? `Turn 5 Requirement: MIDDLE_HISTORY_INVARIANT must preserve tenant isolation. ${'details '.repeat(120)}`
      : `Turn ${idx} conversational payload ${'details '.repeat(120)}`
  }));
  const historyPayload = { messages: historyMsgs };
  const compactedMeta = requestBudget.compactConversationHistory(historyPayload, 900);
  assert.strictEqual(compactedMeta.compacted, true);
  const compactedSummaryText = JSON.stringify(historyPayload.messages || []);
  assert.ok(compactedSummaryText.includes('MIDDLE_HISTORY_INVARIANT'), 'Conversation compaction must keep middle turn anchor');

  const agentResp = JSON.parse(runMcpAgent('anbu', {
    task: 'AGENT_HEAD_TASK: Patch webhook handler.',
    context: advisorBlob,
    constraints: ['AGENT_TAIL_CONSTRAINT: Run lint and unit tests before exit.'],
    project_path: budgetProjDir
  }));
  const agentInstr = agentResp.instructions || '';
  assert.ok(Buffer.byteLength(agentInstr, 'utf8') <= 8000, 'Subagent prompt must remain <= 8000 bytes');
  assert.ok(agentInstr.includes('AGENT_HEAD_TASK') && agentInstr.includes('MIDDLE_CRITICAL_RULE') && agentInstr.includes('AGENT_TAIL_CONSTRAINT'));

  assert.strictEqual(planRouter({ hitlPending: true, budgetExceeded: true }), '__end__', 'HITL pause must take precedence over budgetExceeded');

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS test_advisor_realtime_monitor.js');
}

runTests().catch((err) => {
  console.error('FAIL test_advisor_realtime_monitor.js:', err);
  process.exit(1);
});
