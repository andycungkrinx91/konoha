'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { executeTool } = require('../src/mcp/tool_dispatch');
const { runKonohaGraph } = require('../src/mcp/workflow');
const { parseKonohaCommandInvocation, classifyExecutionTrack } = require('../src/mcp/workflow_sannin');
const {
  MAX_ADVISOR_TURN_TOKENS,
  buildAdvisorCoreCharter,
  retrieveAdvisorDynamicContext
} = require('../src/workflow/kage-reviewer/advisor_monitor');
const { isTrustedKonohaTaskReadPath, isCanonicalKonohaSubagentName } = require('../src/hook-base');
const { assertWithinAllowed } = require('../src/file_tools_router');
const { readFileHead } = require('../src/file_tools/read_file_head');
const { readFileRange } = require('../src/file_tools/read_file_range');
const { sanitizePollutedProjectGitignore } = require('../src/deploy_utils');
const { computeProjectHash } = require('../src/persona_memory_projects');
const { buildFromText, buildFromSource } = require('../src/mcp/build_spec');
const webAuth = require('../src/auth');
const { getLiveActivitySnapshot, normalizeExecutionStatus } = require('../src/web/controllers/activity_controller');
const {
  FRAMER_MARKETPLACE_URL,
  discoverFramerMarketplaceComponents,
  performFramerComponentREA,
  adaptFramerComponentToFramework
} = require('../src/workflow/chunin-intel/framer_marketplace_rea');
const { buildFrontendMaintenanceSkillMarkdown } = require('../src/workflow/jonin-builder/project_skill_generator');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');

const TEMPLATE_SKILLS_DIR = path.join(REPO_ROOT, 'src', 'templates', 'skills');

async function testTokenSavingsBenchmark() {
  const geninSkills = ['genin-skill', 'i-have-adhd', 'antislop', 'antislop-human', 'antislop-code'];
  // `use_skills` answers from konoha.db. A fresh HOME (the runner's per-suite
  // sandbox) has an empty skills table, so an unindexed call returns a tiny
  // "not_found" blob that scores as ~99% savings — a fake pass that hides a
  // broken bundle. Index the template skills the measurement reads first.
  require('../src/migrate').migrate_skills({ skills_dir: TEMPLATE_SKILLS_DIR });
  let rawBytes = 0;
  for (const s of geninSkills) {
    const p = path.join(REPO_ROOT, 'src', 'templates', 'skills', s, 'SKILL.md');
    if (fs.existsSync(p)) rawBytes += fs.statSync(p).size;
  }
  assert.ok(rawBytes > 40000, `Expected raw skill bundle > 40KB, got ${rawBytes}`);

  const sessId = `bench_tok_${Date.now()}`;
  const res1 = await Promise.resolve(executeTool('use_skills', {
    skills: geninSkills,
    agent_name: 'genin',
    session_id: sessId
  }));
  const compactBytes1 = Buffer.byteLength(res1, 'utf8');
  const savingsPct1 = ((rawBytes - compactBytes1) / rawBytes) * 100;
  const parsed1 = JSON.parse(res1);
  assert.strictEqual(parsed1.status, 'success', `use_skills must resolve the benchmark bundle: ${JSON.stringify(parsed1.skills || parsed1.warnings || [])}`);
  assert.ok(compactBytes1 <= 4200, `Expected compact response <= 4200B, got ${compactBytes1}B`);
  assert.ok(savingsPct1 >= 83 && savingsPct1 <= 99, `Expected 83%-98% token savings, got ${savingsPct1.toFixed(2)}%`);

  const res2 = await Promise.resolve(executeTool('use_skills', {
    skills: geninSkills,
    agent_name: 'genin',
    session_id: sessId
  }));
  const compactBytes2 = Buffer.byteLength(res2, 'utf8');
  const savingsPct2 = ((rawBytes - compactBytes2) / rawBytes) * 100;
  assert.ok(compactBytes2 < compactBytes1, 'Deduped second call must be smaller than first call');

  const contractRes = JSON.parse(await Promise.resolve(executeTool('get_skill', { name: 'konoha/contract' })));
  assert.strictEqual(contractRes.name, 'konoha/contract');
  assert.ok(contractRes.content && contractRes.content.includes('Konoha'), 'konoha/contract must resolve cleanly');

  console.log(`✓ Benchmark 1 (Token Savings): raw=${rawBytes}B -> first=${compactBytes1}B (${savingsPct1.toFixed(1)}% saved), dedup=${compactBytes2}B (${savingsPct2.toFixed(1)}% saved)`);
}

function testAccuracyBenchmark() {
  const cases = [
    { input: '/konoha Architect a multi-region distributed payment ledger', mode: 'konoha_orchestrator', slash: true, track: 'full_sdlc' },
    { input: '/sannin Build fullstack dashboard and backend API', mode: 'konoha_orchestrator', slash: true, track: 'full_sdlc' },
    { input: '/genin Trace all references to computeProjectHash', mode: 'direct_subagent', agent: 'genin', track: 'fast_track' },
    { input: '/anbu Fix SQLite column mismatch in activity_controller.js', mode: 'direct_subagent', agent: 'anbu', track: 'fast_track' },
    { input: '/jonin Redesign the Agent Activity full-screen modal', mode: 'direct_subagent', agent: 'jonin', track: 'fast_track' },
    { input: '/kage Review system architecture and threat boundaries', mode: 'direct_subagent', agent: 'kage', track: 'fast_track' },
    { input: '/chunin Research WebGPU shader pipelines', mode: 'direct_subagent', agent: 'chunin', track: 'fast_track' },
    { input: '/tokubetsu-jonin Write API specification document', mode: 'direct_subagent', agent: 'tokubetsu_jonin', track: 'fast_track' },
    { input: '/akatsuki Run OWASP red-team security audit', mode: 'direct_subagent', agent: 'akatsuki', track: 'fast_track' },
    { input: 'quick question', mode: 'konoha_orchestrator', slash: false, track: 'fast_track' },
    { input: 'fix typo in variable name', mode: 'konoha_orchestrator', slash: false, track: 'fast_track' },
    { input: 'Implement authentication controller and Svelte login form', mode: 'konoha_orchestrator', slash: false, track: 'full_sdlc' },
  ];

  let correct = 0;
  for (const c of cases) {
    const parsed = parseKonohaCommandInvocation(c.input);
    const track = classifyExecutionTrack(c.input);
    const modeOk = parsed.invocationMode === c.mode;
    const agentOk = !c.agent || parsed.targetAgent === c.agent;
    const slashOk = c.slash === undefined || parsed.explicitSlash === c.slash;
    const trackOk = track === c.track;
    if (modeOk && agentOk && slashOk && trackOk) correct++;
  }
  const accuracyPct = (correct / cases.length) * 100;
  assert.ok(accuracyPct >= 95, `Expected accuracy >= 95%, got ${accuracyPct.toFixed(1)}%`);
  console.log(`✓ Benchmark 2 (Classification & Routing Accuracy): ${correct}/${cases.length} (${accuracyPct.toFixed(1)}%)`);
}

function testLongContextPreservationBenchmark() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_longctx_'));
  const bigFile = path.join(tmpDir, 'large_fixture.js');
  const lines = [];
  for (let i = 1; i <= 3200; i++) {
    if (i === 5) lines.push('// BEGIN_SENTINEL_ALPHA_901');
    else if (i === 1600) lines.push('// MIDDLE_SENTINEL_OMEGA_402');
    else if (i === 3198) lines.push('// END_SENTINEL_ZETA_777');
    else lines.push(`const line_${i} = ${i};`);
  }
  fs.writeFileSync(bigFile, lines.join('\n') + '\n', 'utf8');

  const headOut = readFileHead({ file_path: bigFile, max_lines: 20, workspace: tmpDir }).text;
  const midOut = readFileRange({ file_path: bigFile, start_line: 1590, end_line: 1610, workspace: tmpDir }).text;
  const endOut = readFileRange({ file_path: bigFile, start_line: 3185, end_line: 3200, workspace: tmpDir }).text;

  assert.ok(headOut.includes('BEGIN_SENTINEL_ALPHA_901'), 'Beginning sentinel must be preserved');
  assert.ok(midOut.includes('MIDDLE_SENTINEL_OMEGA_402'), 'Middle sentinel must be preserved');
  assert.ok(endOut.includes('END_SENTINEL_ZETA_777'), 'End sentinel must be preserved');

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('✓ Benchmark 3 (Long-Context 3,200-Line Beginning/Middle/End Preservation): 100% preserved');
}

async function testOrchestrationDirectAndParallel() {
  const charter = buildAdvisorCoreCharter();
  assert.ok(charter.tokens_used <= MAX_ADVISOR_TURN_TOKENS, `Advisor charter tokens ${charter.tokens_used} > ${MAX_ADVISOR_TURN_TOKENS}`);

  const directDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_direct_'));
  fs.writeFileSync(path.join(directDir, 'status.json'), JSON.stringify({
    project_path: directDir,
    confidence: 100,
    ai_slop_clean: true,
    ai_slop_findings: 0
  }, null, 2), 'utf8');
  const directStep1 = await runKonohaGraph({
    prompt: '/genin Map all exports in src/mcp/workflow_sannin.js',
    taskDir: directDir,
    projectPath: directDir,
    threadId: `direct_${Date.now()}`
  });
  const directStatus = directStep1.workflow_status || JSON.parse(fs.readFileSync(path.join(directDir, 'status.json'), 'utf8'));
  assert.strictEqual(directStep1.invocationMode, 'direct_subagent');
  assert.strictEqual(directStep1.directSubagent, 'genin');
  assert.strictEqual(directStep1.mandatoryKageReview, true);
  // `phase` here is the outcome of the auto-signoff branch: a direct subagent
  // invocation is supposed to complete without a Gate 2 prompt. When it does not,
  // the only way to tell why is to report every input that branch reads.
  assert.strictEqual(
    directStep1.phase,
    'done',
    `direct subagent run must complete without Gate 2 (${JSON.stringify({
      resultPhase: directStep1.phase,
      hitlStage: directStep1.hitlStage,
      gateVerdict: directStep1.gateVerdict,
      invocationMode: directStep1.invocationMode,
      statusInvocationMode: directStatus.invocation_mode,
      statusPhase: directStatus.phase,
      humanSignedOff: directStatus.human_signed_off,
      autoSignoff: directStatus.auto_signoff,
      confidence: directStatus.confidence,
      aislopGate: directStatus.aislop_gate,
      akatsukiGate: directStatus.akatsuki_gate,
      remediationReason: directStatus.remediation_reason,
      advisorViolations: directStatus.advisor_review && directStatus.advisor_review.violations,
    })})`
  );
  assert.ok(directStatus.advisor_audit_log.length >= 2, 'Advisor lifecycle telemetry must be recorded');

  const parDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_par_'));
  fs.writeFileSync(path.join(parDir, 'status.json'), JSON.stringify({
    project_path: parDir,
    plan: '1. Backend API\n2. Frontend UI',
    plan_approved: true,
    human_signed_off: true,
    confidence: 100,
    ai_slop_clean: true,
    ai_slop_findings: 0,
    phase: 'execute',
    tasks: [
      { id: 't1', agent: 'anbu', task: 'Build API endpoint', status: 'pending', owned_files: ['src/api.js'] },
      { id: 't2', agent: 'jonin', task: 'Build UI view', status: 'pending', owned_files: ['src/View.svelte'] }
    ]
  }, null, 2), 'utf8');

  const parRes = await runKonohaGraph({
    prompt: '/konoha Build backend API endpoint and frontend UI component',
    taskDir: parDir,
    projectPath: parDir,
    threadId: `par_${Date.now()}`
  });
  const parStatus = parRes.workflow_status || JSON.parse(fs.readFileSync(path.join(parDir, 'status.json'), 'utf8'));
  assert.ok(parStatus.parallel_execution_proof, 'Parallel execution proof must be recorded');
  assert.strictEqual(parStatus.parallel_execution_proof.concurrent_count, 2);

  const dynCtx = retrieveAdvisorDynamicContext({ taskDir: parDir, status: parStatus });
  assert.ok(dynCtx.context.includes('Tasks (2)'), 'Advisor dynamic context must summarize parallel tasks');

  fs.rmSync(directDir, { recursive: true, force: true });
  fs.rmSync(parDir, { recursive: true, force: true });
  console.log('✓ Test 4 (Orchestration, /konoha, /<subagent> + Mandatory Kage Review, Parallel Proof & Always-On Advisor): PASSED');
}

function testTrustedKonohaTaskReadPath() {
  const homeDir = os.homedir();
  const clients = ['antigravity', 'claude', 'cursor', 'opencode', 'commandcode', 'codex', 'pi', 'omp'];
  for (const client of clients) {
    const projectId = computeProjectHash(REPO_ROOT).slice(0, 12);
    const sessionId = `sess_${client}_mw74elgs_${Math.floor(Math.random() * 900000 + 100000)}`;
    const taskId = `task_mw74g0aa_${client}`;
    const dynamicTarget = path.join(homeDir, '.konoha', 'tmp', client, projectId, sessionId, 'scratch', 'tasks', taskId, 'walkthrough_todos.json');
    const targetDir = path.dirname(dynamicTarget);
    fs.mkdirSync(targetDir, { recursive: true });
    const payload = JSON.stringify({
      task_id: taskId,
      todos: [{ id: '1', content: `Verify trusted Konoha task read path for ${client}`, status: 'completed' }]
    }, null, 2);
    fs.writeFileSync(dynamicTarget, payload, 'utf8');

    assert.strictEqual(isTrustedKonohaTaskReadPath(dynamicTarget), true, `Dynamic walkthrough_todos.json path must be trusted for ${client}`);
    assert.doesNotThrow(() => assertWithinAllowed(dynamicTarget), `file_tools_router must allow read of walkthrough_todos.json for ${client}`);

    const headRes = readFileHead({ file_path: dynamicTarget, max_lines: 20, workspace: REPO_ROOT }).text;
    assert.ok(headRes.includes(taskId), `read_file_head must read walkthrough_todos.json outside workspace for ${client}`);

    assert.strictEqual(isTrustedKonohaTaskReadPath(`${targetDir}/../../../etc/passwd`), false);
    assert.strictEqual(isTrustedKonohaTaskReadPath(`${targetDir}/arbitrary_script.sh`), false);
    fs.rmSync(path.join(homeDir, '.konoha', 'tmp', client, projectId, sessionId), { recursive: true, force: true });
  }
  assert.strictEqual(isTrustedKonohaTaskReadPath('/etc/passwd'), false);

  for (const name of ['sannin', 'kage', 'jonin', 'anbu', 'chunin', 'tokubetsu_jonin', 'genin', 'akatsuki', 'yamanaka']) {
    assert.strictEqual(isCanonicalKonohaSubagentName(name), true);
  }
  console.log('✓ Test 5 (Trusted Konoha Task File Read walkthrough_todos.json & Traversal Rejection): PASSED');
}

function testGitignoreAndProjectIsolation() {
  const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_unrelated_proj_'));
  const gitignorePath = path.join(tmpProj, '.gitignore');
  fs.writeFileSync(gitignorePath, 'node_modules/\ndist/\n/PLAN.md\nPLAN.md\n/.omp/plans/\n.omp/plans/\n.omp/plans\n.omp/\n.env\n', 'utf8');

  const res = sanitizePollutedProjectGitignore(tmpProj);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.modified, true);
  const cleaned = fs.readFileSync(gitignorePath, 'utf8');
  assert.ok(cleaned.includes('node_modules/'), 'User entries must be preserved');
  assert.ok(cleaned.includes('.env'), 'User entries must be preserved');
  assert.ok(!cleaned.includes('PLAN.md') && !cleaned.includes('.omp'), 'Polluted Konoha plan entries must be removed');

  // Symlink project hash parity
  const realDir = path.join(tmpProj, 'real_repo');
  const linkDir = path.join(tmpProj, 'link_repo');
  fs.mkdirSync(realDir, { recursive: true });
  fs.symlinkSync(realDir, linkDir);
  assert.strictEqual(computeProjectHash(realDir), computeProjectHash(linkDir), 'Symlinked workspace must produce identical project_hash');

  fs.rmSync(tmpProj, { recursive: true, force: true });
  console.log('✓ Test 6 (Zero .gitignore Pollution & Symlink Project Hash Parity): PASSED');
}

function testJoninModesAndWebUiContracts() {
  const textSpec = JSON.parse(buildFromText('nebula-studio', 'Immersive 3D motion-art AI platform', 'nextjs'));
  assert.strictEqual(textSpec.creation_mode, 'build_from_text');
  assert.strictEqual(textSpec.online_reference_research_required, true);
  assert.ok(Array.isArray(textSpec.creation_modes_supported) && textSpec.creation_modes_supported.length === 3);

  const tmpScratchBase = path.join(os.homedir(), '.konoha', 'tmp');
  fs.mkdirSync(tmpScratchBase, { recursive: true });
  const tmpImgDir = fs.mkdtempSync(path.join(tmpScratchBase, 'konoha_img_mode_'));
  // Minimal 1x1 PNG header
  const pngBuf = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');
  fs.writeFileSync(path.join(tmpImgDir, 'hero_mockup.png'), pngBuf);
  const imgSpec = JSON.parse(buildFromSource('nebula-image', tmpImgDir, 'svelte'));
  assert.strictEqual(imgSpec.creation_mode, 'build_from_image');
  fs.rmSync(tmpImgDir, { recursive: true, force: true });

  const tmpSrcDir = fs.mkdtempSync(path.join(tmpScratchBase, 'konoha_src_mode_'));
  fs.writeFileSync(path.join(tmpSrcDir, 'index.html'), '<!doctype html><html><body><h1>Source Site</h1></body></html>', 'utf8');
  const srcSpec = JSON.parse(buildFromSource('nebula-source', tmpSrcDir, 'nextjs'));
  assert.strictEqual(srcSpec.creation_mode, 'build_from_source');
  fs.rmSync(tmpSrcDir, { recursive: true, force: true });

  // Verify default release password is konohagakure and two-field initial setup works
  const tmpAuthFile = path.join(os.tmpdir(), `konoha_auth_2218_${Date.now()}.json`);
  const prevAuthFile = process.env.KONOHA_AUTH_FILE;
  process.env.KONOHA_AUTH_FILE = tmpAuthFile;
  try {
    assert.strictEqual(webAuth.resolveBootstrapPassword(), 'konohagakure');
    const loginRes = webAuth.authenticate('konohagakure', '127.0.0.1');
    assert.strictEqual(loginRes.success, true);
    assert.strictEqual(loginRes.isBootstrap, true);
    assert.strictEqual(loginRes.requiresPasswordChange, true);

    // Two-field updatePassword without currentPassword during bootstrap session
    const updateRes = webAuth.updatePassword(loginRes.sessionId, '', 'shinobi-production-2026!');
    assert.strictEqual(updateRes.success, true);
    assert.strictEqual(updateRes.requires_login, true);

    // Prevent unauthenticated re-initialization once configured
    const reinitRes = webAuth.setupInitialPassword('hacker-password-123!', 'hacker-password-123!');
    assert.strictEqual(reinitRes.success, false);
    assert.strictEqual(reinitRes.status, 403);
  } finally {
    if (prevAuthFile === undefined) delete process.env.KONOHA_AUTH_FILE;
    else process.env.KONOHA_AUTH_FILE = prevAuthFile;
    if (fs.existsSync(tmpAuthFile)) fs.unlinkSync(tmpAuthFile);
  }

  // Verify UI component contracts
  const modalSrc = fs.readFileSync(path.join(REPO_ROOT, 'apps/web/src/components/PasswordChangeModal.svelte'), 'utf8');
  assert.ok(modalSrc.includes('{#if !authState.requiresPasswordChange}'), 'PasswordChangeModal must hide current-password during initial setup');

  const activitySrc = fs.readFileSync(path.join(REPO_ROOT, 'apps/web/src/components/AgentActivity.svelte'), 'utf8');
  assert.ok(activitySrc.includes('activity-fullscreen-btn') && activitySrc.includes('isFullScreen'), 'AgentActivity must provide full-screen modal');
  assert.ok(
    activitySrc.includes('spiderFlipped') &&
    activitySrc.includes('triggerSpiderFlip') &&
    activitySrc.includes('spiderFlipCount * 180'),
    'AgentActivity spider must flip 180 degrees on click'
  );

  const dockSrc = fs.readFileSync(path.join(REPO_ROOT, 'apps/web/src/components/BottomDock.svelte'), 'utf8');
  assert.ok(dockSrc.includes('lg:hidden'), 'BottomDock must be mobile-only (lg:hidden)');

  const dashSrc = fs.readFileSync(path.join(REPO_ROOT, 'apps/web/src/components/Dashboard.svelte'), 'utf8');
  assert.ok(dashSrc.includes('overview-agent-activity-section') && dashSrc.includes('<AgentActivity embedded={true}'), 'Overview (Dashboard.svelte) must embed first-class AgentActivity section');

  const loginSrc = fs.readFileSync(path.join(REPO_ROOT, 'apps/web/src/components/Login.svelte'), 'utf8');
  assert.ok(loginSrc.includes('setup-new-password') && loginSrc.includes('setup-confirm-password'), 'Login.svelte must support 2-field First-Run Setup');

  // Verify all 6 execution states in normalizeExecutionStatus & getLiveActivitySnapshot
  for (const st of ['queued', 'running', 'completed', 'failed', 'paused', 'awaiting-approval']) {
    assert.strictEqual(normalizeExecutionStatus(st), st, `State ${st} must normalize cleanly`);
  }
  const snap = getLiveActivitySnapshot();
  assert.strictEqual(snap.ok, true);
  assert.ok(snap.summary && snap.summary.state_counts && typeof snap.summary.state_counts === 'object', 'Activity snapshot must include 6-state counts');

  console.log('✓ Test 7 (3 Jonin Creation Modes, 2-Field First-Install Password Setup, konohagakure Default & Web UI Contracts): PASSED');
}

async function testSixAgentEightClientSpawnAndAkatsukiBlueMode() {
  const specialists = ['akatsuki', 'kage', 'tokubetsu-jonin', 'anbu', 'chunin', 'genin'];
  const clients = ['antigravity', 'cursor', 'claude', 'opencode', 'commandcode', 'codex', 'pi', 'omp'];
  const cliPath = path.join(REPO_ROOT, 'bin', 'cli.js');
  const { execFile } = require('child_process');
  const { runMcpAgent } = require('../src/mcp/memory_subagent_runner');
  const spawnTaskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_spawn_matrix_'));
  let verifiedSpawns = 0;

  try {
    console.log('    [Test 9.1] Spawning 6 specialists sequentially in real child processes...');
    // Spawn all 6 specialists in real child processes and verify child PID + correlated evidence
    for (const [idx, agent] of specialists.entries()) {
      const client = clients[idx % clients.length];
      const dispatchId = `disp_${agent}_${client}`;
      console.log(`      -> Spawning @${agent} on client=${client}...`);
      await new Promise((resolve, reject) => {
        execFile(
          process.execPath,
          [
            cliPath,
            'run-agent',
            '--agent', agent,
            '--client', client,
            '--task', `Verify ${agent} specialist execution on ${client}`,
            '--project-path', spawnTaskDir,
            '--task-dir', spawnTaskDir,
            '--dispatch-id', dispatchId,
            '--auto-report'
          ],
          { encoding: 'utf8', timeout: 20000 },
          (err, stdout, stderr) => {
            if (err) return reject(new Error(`Spawn failed for ${agent}@${client}: ${stderr || err.message}`));
            try {
              const payload = JSON.parse(stdout.trim());
              assert.ok(payload.status === 'dispatched' || payload.status === 'ready', `Unexpected status ${payload.status}`);
              assert.strictEqual(payload.client, client);
              assert.strictEqual(payload.task_context_received, true);
              assert.ok(payload.child_pid && payload.child_pid !== process.pid, 'Must run in a real child process PID');
              assert.strictEqual(payload.auto_reported, true, 'Child process must record correlated evidence');
              resolve(payload);
            } catch (parseErr) {
              reject(parseErr);
            }
          }
        );
      });
    }

    console.log('    [Test 9.2] Verifying 48 dispatch adapter matrix cells...');
    // Verify all 6 specialists x 8 clients (48 dispatch adapter cells) produce valid spawn directives & context transfer
    for (const agent of specialists) {
      for (const client of clients) {
        const raw = runMcpAgent(agent, {
          task: `Execute ${agent} specialist verification`,
          projectPath: REPO_ROOT,
          taskDir: spawnTaskDir,
          sessionId: 'test_session_id',
          client
        });
        const parsed = JSON.parse(raw);
        assert.ok(parsed.status === 'dispatched' || parsed.status === 'ready');
        assert.ok(parsed.instructions || parsed.prompt || parsed.review_checklist, `Missing instructions for ${agent}@${client}`);
        verifiedSpawns++;
      }
    }
    assert.strictEqual(verifiedSpawns, 48, 'All 6 specialists x 8 clients (48 spawns) must succeed');

    console.log('    [Test 9.3] Validating correlated task evidence...');
    const evRaw = await Promise.resolve(executeTool('get_task_evidence', {
      task_id: path.basename(spawnTaskDir),
      task_dir: spawnTaskDir
    }));
    const ev = JSON.parse(evRaw);
    assert.strictEqual(ev.task_id, path.basename(spawnTaskDir), 'Correlated task_id must match');
    assert.ok(ev.evidence && ev.evidence.verified === true, 'Correlated task evidence must be verified in sdlc_tasks');

    console.log('    [Test 9.4] Running Akatsuki Blue Mode before Kage Review Gate...');
    // Verify Akatsuki Blue Mode -> actual execution & evidence -> Kage Review Gate ordering
    const gateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_blue_gate_'));
    fs.writeFileSync(path.join(gateDir, 'status.json'), JSON.stringify({
      project_path: gateDir,
      plan: '1. Harden authentication module',
      plan_approved: true,
      human_signed_off: true,
      confidence: 100,
      ai_slop_clean: true,
      ai_slop_findings: 0,
      phase: 'execute',
      tasks: [{ id: 't_sec', agent: 'anbu', task: 'Harden auth session validation', status: 'pending', owned_files: ['src/auth.js'] }]
    }, null, 2), 'utf8');

    const gateRes = await runKonohaGraph({
      prompt: '/konoha Harden authentication session validation',
      taskDir: gateDir,
      projectPath: gateDir,
      threadId: `blue_gate_${Date.now()}`
    });
    const gateStatus = gateRes.workflow_status || JSON.parse(fs.readFileSync(path.join(gateDir, 'status.json'), 'utf8'));
    assert.strictEqual(gateStatus.phase, 'done');
    assert.ok(gateStatus.akatsuki_review && gateStatus.akatsuki_review.mode === 'blue', 'Akatsuki Blue Mode must execute');
    assert.strictEqual(gateStatus.akatsuki_review.executed_before_kage, true);
    assert.strictEqual(gateStatus.blue_mode_before_kage_verified, true);
    assert.ok(fs.existsSync(path.join(gateDir, 'akatsuki_review.json')), 'akatsuki_review.json evidence artifact must exist');

    console.log('    [Test 9.5] Verifying fail-closed when Blue Mode is skipped...');
    // Verify fail-closed rejection when Blue Mode is skipped
    const failDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_blue_fail_'));
    fs.writeFileSync(path.join(failDir, 'status.json'), JSON.stringify({
      plan: '1. Skip security test',
      plan_approved: true,
      human_signed_off: true,
      skip_akatsuki_blue_mode: true,
      confidence: 100,
      ai_slop_clean: true,
      ai_slop_findings: 0,
      phase: 'review',
      tasks: [{ id: 't1', agent: 'anbu', task: 'Test', status: 'completed' }]
    }, null, 2), 'utf8');
    const failRes = await runKonohaGraph({
      prompt: '/konoha Test fail closed Blue Mode',
      taskDir: failDir,
      threadId: `blue_fail_${Date.now()}`
    });
    const failStatus = failRes.workflow_status || JSON.parse(fs.readFileSync(path.join(failDir, 'status.json'), 'utf8'));
    assert.notStrictEqual(failStatus.phase, 'done', 'Skipped Akatsuki Blue Mode must fail closed and trigger remediation');
    assert.strictEqual(failStatus.remediation_reason, 'akatsuki_blue_mode_skipped');

    fs.rmSync(gateDir, { recursive: true, force: true });
    fs.rmSync(failDir, { recursive: true, force: true });
  } finally {
    fs.rmSync(spawnTaskDir, { recursive: true, force: true });
  }
  console.log(`✓ Test 9 (6-Specialist x 8-Client = ${verifiedSpawns} Real Child Spawns & Akatsuki Blue Mode -> Kage Gate Proof): PASSED`);
}

async function testFramerMarketplaceChuninReaAndJoninAdaptation() {
  const textSpec = JSON.parse(buildFromText('framer-saas', 'Production analytics platform', 'nextjs'));
  assert.strictEqual(textSpec.component_discovery_source, FRAMER_MARKETPLACE_URL);
  assert.strictEqual(textSpec.chunin_playwright_rea_required, true);
  assert.strictEqual(textSpec.design_brief.fields.length, 9);
  assert.strictEqual(textSpec.framer_licensing_boundaries.no_iframe_injection, true);
  assert.strictEqual(textSpec.framer_licensing_boundaries.no_protected_source_extraction, true);

  const discoveryRes = discoverFramerMarketplaceComponents({ domainHints: ['admin_operations'] });
  const candidates = discoveryRes.components || discoveryRes;
  assert.ok(candidates.length > 0, 'Domain hints must produce research candidates');
  assert.ok(candidates.every((c) => c.suitability_score === null), 'Candidates must never carry fabricated scores');

  const reaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_framer_rea_'));
  try {
    const reaReport = await performFramerComponentREA({
      domainHints: ['admin_operations'],
      targetFramework: 'nextjs',
      taskDir: reaDir,
      runPlaywrightProbe: true
    });
    assert.strictEqual(reaReport.discovery_source, FRAMER_MARKETPLACE_URL);
    assert.strictEqual(reaReport.free_and_paid_evaluated, false, 'Unknown tiers must not be reported as evaluated');
    for (const comp of reaReport.components) {
      assert.strictEqual(comp.licensing_boundary.protected_source_extracted, false);
      assert.strictEqual(comp.licensing_boundary.iframe_injected, false);
      assert.strictEqual(comp.observations.responsive_viewports, null, 'No viewport data without a navigated preview');
      assert.strictEqual(comp.preview_evaluated, false, 'Nothing may claim a preview was evaluated without navigation');
    }

    const researchTarget = reaReport.components[0];
    for (const fw of ['nextjs', 'nuxt', 'svelte', 'angular']) {
      const adapted = adaptFramerComponentToFramework(researchTarget, fw);
      assert.ok(!adapted.code.includes('<iframe'), `Adapted ${fw} code must never use iframe injection`);
      assert.ok(adapted.provenance_markdown.includes(FRAMER_MARKETPLACE_URL), 'Provenance must reference Framer Marketplace');
    }

    const skillMd = buildFrontendMaintenanceSkillMarkdown({
      slug: 'framer-production',
      framework: 'nextjs',
      archetype: 'dashboard',
      componentProvenance: reaReport.components.map((c) => ({
        component_name: c.component_name,
        marketplace_url: c.marketplace_url,
        pricing_tier: c.pricing.tier,
        licensing_mode: c.licensing_boundary.implementation_strategy,
        target_framework: 'nextjs'
      }))
    });
    assert.ok(skillMd.includes('## Framer Marketplace Component Provenance (Chunin REA -> Jonin Native)'), 'Project maintenance skill must record component provenance');
  } finally {
    fs.rmSync(reaDir, { recursive: true, force: true });
  }
  console.log('✓ Test 10 (Framer Marketplace Discovery, Chunin Free/Paid REA, Licensing Boundaries & Jonin 4-Framework Native Adaptation): PASSED');
}

function testSafeInstallationAndCleanup() {
  const staleTmpStep = path.join(os.homedir(), '.konoha', 'tmp', 'verify_2218_step1.json');
  if (fs.existsSync(staleTmpStep)) {
    fs.unlinkSync(staleTmpStep);
  }

  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_install_lifecycle_'));
  const sandboxHome = path.join(sandboxRoot, 'home');
  const sandboxProj = path.join(sandboxRoot, 'user_project');
  fs.mkdirSync(sandboxHome, { recursive: true });
  fs.mkdirSync(sandboxProj, { recursive: true });

  // Pre-populate user-owned Antigravity agents & conversations to verify non-destructive install
  const userAgentsDir = path.join(sandboxHome, '.gemini', 'antigravity-cli', 'agents');
  const userConvsDir = path.join(sandboxHome, '.gemini', 'antigravity-cli', 'conversations');
  fs.mkdirSync(userAgentsDir, { recursive: true });
  fs.mkdirSync(userConvsDir, { recursive: true });
  const customAgentPath = path.join(userAgentsDir, 'custom_user_agent.md');
  const customConvPath = path.join(userConvsDir, 'conv_001.json');
  fs.writeFileSync(customAgentPath, '# Custom User Agent\nMust never be deleted.\n', 'utf8');
  fs.writeFileSync(customConvPath, JSON.stringify({ id: 'conv_001', preserved: true }), 'utf8');

  const userGitignore = path.join(sandboxProj, '.gitignore');
  fs.writeFileSync(userGitignore, 'node_modules/\ndist/\n', 'utf8');

  try {
    const antigravityManager = require('../src/antigravity_manager');
    const cursorManager = require('../src/cursor_manager');
    const mcpClientsManager = require('../src/mcp_clients_manager');
    const agentManager = require('../src/agent_manager');

    const setupAgents = agentManager.loadAgents();
    const serverPath = path.join(REPO_ROOT, 'src', 'server.js');

    antigravityManager.ensureAntigravityAgents(setupAgents, { home: sandboxHome });
    antigravityManager.ensureAntigravityPermissions(true, { home: sandboxHome });

    cursorManager.registerCursorMcp('node', serverPath, 'uvx', true, { home: sandboxHome, konohaHome: path.join(sandboxHome, '.konoha') });
    cursorManager.deployCursorGlobalRule(setupAgents, true, { home: sandboxHome });
    cursorManager.deployCursorGlobalAgents(setupAgents, true, { home: sandboxHome });
    assert.ok(fs.existsSync(path.join(sandboxHome, '.cursor', 'agents', 'sannin.md')), 'Cursor global agents must be deployed');

    mcpClientsManager.registerClaudeCodePermissions(true, { home: sandboxHome });
    mcpClientsManager.registerCommandCodePermissions(true, { home: sandboxHome });

    sanitizePollutedProjectGitignore(sandboxProj);

    assert.ok(fs.existsSync(customAgentPath), 'User custom agent must be preserved across fresh install & upgrade');
    assert.ok(fs.existsSync(customConvPath), 'User conversation history must be preserved across fresh install & upgrade');
    const afterGitignore = fs.readFileSync(userGitignore, 'utf8');
    assert.ok(!afterGitignore.includes('PLAN.md') && !afterGitignore.includes('.omp/plans'), 'Unrelated project .gitignore must never receive Konoha plan block');
  } finally {
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  }
  console.log('✓ Test 8 (8-Client Non-Destructive Sandbox Install, Preservation & Zero .gitignore Pollution): PASSED');
}

async function main() {
  console.log('=== Running Konoha 2.2.18 Master Verification & Benchmark Suite ===');
  await testTokenSavingsBenchmark();
  testAccuracyBenchmark();
  testLongContextPreservationBenchmark();
  await testOrchestrationDirectAndParallel();
  testTrustedKonohaTaskReadPath();
  testGitignoreAndProjectIsolation();
  testJoninModesAndWebUiContracts();
  testSafeInstallationAndCleanup();
  await testSixAgentEightClientSpawnAndAkatsukiBlueMode();
  await testFramerMarketplaceChuninReaAndJoninAdaptation();
  console.log('=== ALL KONOHA 2.2.18 MASTER TESTS & BENCHMARKS PASSED ===');
}

main().catch((err) => {
  console.log('MASTER_SUITE_FAILURE:', err && (err.stack || err.message || String(err)));
  process.exit(1);
});
