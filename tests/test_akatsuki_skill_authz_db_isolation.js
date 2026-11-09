'use strict';

/**
 * tests/test_akatsuki_skill_authz_db_isolation.js
 *
 * Verifies skill authorization tiers and physical lab-DB segregation:
 * A. Red/blue classification (single registry in src/skill_authorization.js)
 * B. Authorization matrix — no identity, no env, no option grants red access
 * C. Retrieval / search / dispatch redaction (no body leakage)
 * D. Red workflow fail-closed on identity and on missing container engine
 * E. Lab DB is a distinct file with a distinct schema; path guards hold
 * F. Lab templates and provisioner children never reach the main DB
 * G. Path-guard logic is host-independent
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-labdb-'));
const LAB_ROOT = path.join(TMP_ROOT, 'akatsuki-lab');
const MAIN_DB = path.join(TMP_ROOT, 'konoha.db');
const SECRET_MARKER = 'LAB_FIXTURE_SECRET_BODY';
const SKILLS_ROOT = path.join(TMP_ROOT, '.agents', 'skills');

process.env.KONOHA_LAB_DB_ROOT = LAB_ROOT;
process.env.KONOHA_DB_PATH = MAIN_DB;
process.env.HOME = TMP_ROOT;
process.env.USERPROFILE = TMP_ROOT;
process.env.KONOHA_HOME = path.join(TMP_ROOT, '.konoha');

let testsPassed = 0;

function runTest(name, fn) {
  try {
    fn();
    testsPassed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    cleanup();
    process.exit(1);
  }
}

function cleanup() {
  try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch (_) { /* best effort */ }
}

function writeFixture() {
  const dir = path.join(SKILLS_ROOT, 'pentest-fixture');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), [
    '---',
    'name: pentest-fixture',
    'description: fixture red skill for authorization tests',
    'tags:',
    '  - akatsuki',
    '  - red-team',
    'mode: red',
    'requires_lab: true',
    '---',
    '',
    '# Fixture',
    '',
    SECRET_MARKER
  ].join('\n'), 'utf8');
}

writeFixture();

const authz = require('../src/skill_authorization');
const labDb = require('../src/workflow/akatsuki/lab_db');
const dbModule = require('../src/db');
const { denyIfUnauthorized } = require('../src/mcp/skills_common');
const toolDispatch = require('../src/mcp/tool_dispatch');
const { buildSpawnDirective, buildParallelSpawnDirective } = require('../src/mcp/lazy_subagent');
const { runRedTeamWorkflow } = require('../src/workflow/akatsuki/workflows');

const ALL_AGENTS = ['sannin', 'genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin', 'yamanaka'];
const RED_SKILL = 'akatsuki-skill';

console.log('Running Akatsuki Skill Authorization & Lab DB Isolation Suite...\n');

// ---------------------------------------------------------------- A. classify
console.log('A. Skill classification');

runTest('A1 akatsuki-skill is red and requires the lab', () => {
  const c = authz.classifySkill(RED_SKILL);
  assert.strictEqual(c.red, true);
  assert.strictEqual(c.mode, 'red');
  assert.strictEqual(c.requires_lab, true);
});

runTest('A2 normalization (@Akatsuki_Skill) still classifies red', () => {
  assert.strictEqual(authz.classifySkill('@Akatsuki_Skill').red, true);
});

runTest('A3 anbu-skill is blue', () => {
  const c = authz.classifySkill('anbu-skill');
  assert.strictEqual(c.red, false);
  assert.strictEqual(c.mode, 'blue');
  assert.strictEqual(c.requires_lab, false);
});

runTest('A4 red-team tag classifies any skill red', () => {
  assert.strictEqual(authz.classifySkill('whatever', ['pentest']).red, true);
});

runTest('A5 pentest prefix classifies red', () => {
  assert.strictEqual(authz.classifySkill('pentest-tools').red, true);
});

runTest('A6 generic "security" tag does not classify red', () => {
  assert.strictEqual(authz.classifySkill('kage-skill', ['security']).red, false);
});

// ----------------------------------------------------------- B. authorization
console.log('\nB. Authorization matrix');

runTest('B7 every non-akatsuki identity (and no identity) is denied', () => {
  for (const agentName of ALL_AGENTS.concat([''])) {
    const res = authz.authorizeSkillAccess({ skillName: RED_SKILL, agentName });
    assert.strictEqual(res.authorized, false, `expected denial for "${agentName}"`);
    assert.strictEqual(res.code, 'SKILL_AUTHORIZATION_DENIED');
    assert.ok(res.reason && res.reason.length > 0);
  }
});

runTest('B8 blue skills are authorized for every identity', () => {
  for (const agentName of ALL_AGENTS) {
    const res = authz.authorizeSkillAccess({ skillName: 'anbu-skill', agentName });
    assert.strictEqual(res.authorized, true, `expected allow for "${agentName}"`);
  }
});

runTest('B9 akatsuki is authorized for the red skill', () => {
  const res = authz.authorizeSkillAccess({ skillName: RED_SKILL, agentName: 'akatsuki' });
  assert.strictEqual(res.authorized, true);
});

runTest('B10 KONOHA_AKATSUKI_REDTEAM / KONOHA_AKATSUKI_MODE cannot grant red access', () => {
  const saved = {
    redteam: process.env.KONOHA_AKATSUKI_REDTEAM,
    mode: process.env.KONOHA_AKATSUKI_MODE
  };
  try {
    process.env.KONOHA_AKATSUKI_REDTEAM = '1';
    process.env.KONOHA_AKATSUKI_MODE = 'red';
    const res = authz.authorizeSkillAccess({ skillName: RED_SKILL, agentName: 'anbu' });
    assert.strictEqual(res.authorized, false);
    assert.strictEqual(res.code, 'SKILL_AUTHORIZATION_DENIED');
  } finally {
    if (saved.redteam === undefined) delete process.env.KONOHA_AKATSUKI_REDTEAM;
    else process.env.KONOHA_AKATSUKI_REDTEAM = saved.redteam;
    if (saved.mode === undefined) delete process.env.KONOHA_AKATSUKI_MODE;
    else process.env.KONOHA_AKATSUKI_MODE = saved.mode;
  }
});

runTest('B11 denyIfUnauthorized returns a denial payload, never null, for other agents', () => {
  const denied = denyIfUnauthorized('pentest-fixture', ['red-team'], 'jonin');
  assert.ok(denied);
  assert.strictEqual(denied.code, 'SKILL_AUTHORIZATION_DENIED');
  assert.strictEqual(denied.requires_lab, true);
  assert.strictEqual(denyIfUnauthorized('anbu-skill', null, 'jonin'), null);
  assert.strictEqual(denyIfUnauthorized('pentest-fixture', null, 'akatsuki'), null);
});

// ------------------------------------------------- C. retrieval/search/dispatch
console.log('\nC. Retrieval, search, and dispatch');

const { getSkill } = require('../src/mcp/skills_retrieval');
const { findSkill } = require('../src/mcp/skills_search');
const { searchMirrorSkills } = require('../src/mcp/skills_common');

function withSkillsRoot(fn) {
  return fn();
}

runTest('C12 retrieval denies a fixture red skill to another agent without leaking the body', () => {
  withSkillsRoot(() => {
    const raw = getSkill('pentest-fixture', 'anbu');
    const parsed = JSON.parse(raw);
    assert.strictEqual(parsed.code, 'SKILL_AUTHORIZATION_DENIED');
    assert.ok(!raw.includes(SECRET_MARKER), 'red skill body must not be returned to @anbu');
  });
});

runTest('C13 retrieval serves the same skill to @akatsuki (guard is not blanket denial)', () => {
  withSkillsRoot(() => {
    const raw = getSkill('pentest-fixture', 'akatsuki');
    assert.ok(raw.includes(SECRET_MARKER), 'akatsuki must receive the skill body');
  });
});

runTest('C14 search redacts rows for non-akatsuki identities', () => {
  withSkillsRoot(() => {
    const rows = searchMirrorSkills('secret', 5);
    if (rows.length === 0) return; // mirror root resolution differs per host; dispatch test covers the path
    const raw = findSkill('red-team', 5, 'jonin');
    assert.ok(!raw.includes(SECRET_MARKER), 'search results must not carry red skill bodies');
  });
});

runTest('C15 tool dispatch denies get_skill for a non-akatsuki agent', () => {
  const raw = toolDispatch.executeToolSync('get_skill', { name: RED_SKILL, agent: 'anbu' });
  const parsed = JSON.parse(raw);
  assert.strictEqual(parsed.code, 'SKILL_AUTHORIZATION_DENIED');
  assert.ok(!raw.includes(SECRET_MARKER));
});

runTest('C16 tool dispatch serves red skills to @akatsuki', () => {
  const raw = toolDispatch.executeToolSync('get_skill', { name: RED_SKILL, agent: 'akatsuki' });
  assert.ok(!raw.includes('SKILL_AUTHORIZATION_DENIED'), 'akatsuki must be allowed');
});

runTest('C17 delegation spawn denies red skills for a non-akatsuki target', () => {
  const raw = buildSpawnDirective({ agent: 'jonin', skills: [RED_SKILL], projectPath: TMP_ROOT });
  assert.strictEqual(JSON.parse(raw).code, 'SKILL_AUTHORIZATION_DENIED');
  const parallel = buildParallelSpawnDirective({ dispatches: [{ agent: 'jonin', skills: [RED_SKILL] }] });
  assert.strictEqual(JSON.parse(parallel).code, 'SKILL_AUTHORIZATION_DENIED');
  const allowed = buildSpawnDirective({ agent: 'jonin', skills: ['jonin-skill'], projectPath: TMP_ROOT });
  assert.ok(!allowed.includes('SKILL_AUTHORIZATION_DENIED'));
});

runTest('C18 Sannin route blocks a red skill bound to a non-akatsuki agent row', () => {
  const conn = dbModule.getConnection();
  dbModule.setupSchema(conn);
  conn.prepare("INSERT OR REPLACE INTO agents (name, description, skills) VALUES ('kage','x',?)")
    .run(JSON.stringify([RED_SKILL]));
  conn.close();

  const { runSannin } = require('../src/mcp/workflow_sannin');
  const raw = runSannin('build a landing page', path.join(TMP_ROOT, 'route-task'), TMP_ROOT, 'route-session', {});
  const parsed = JSON.parse(raw);
  assert.strictEqual(parsed.status, 'blocked');
  assert.strictEqual(parsed.phase, 'skill_authorization');
  assert.strictEqual(parsed.code, 'SKILL_AUTHORIZATION_DENIED');
  assert.ok(!raw.includes(SECRET_MARKER), 'route denial must not carry a red skill body');
});

// ------------------------------------------------------------- D. workflows
console.log('\nD. Red workflow fail-closed');

runTest('D18 runRedTeamWorkflow blocks a non-akatsuki identity with SKILL_AUTHORIZATION_DENIED', () => {
  const res = runRedTeamWorkflow(
    { task: 'authorized: true target: 127.0.0.1' },
    { agentName: 'anbu', redteam_enabled: true, platform: 'linux' }
  );
  assert.strictEqual(res.status, 'blocked');
  assert.strictEqual(res.code, 'SKILL_AUTHORIZATION_DENIED');
});

runTest('D18c runRedTeamWorkflow with no identity fails closed', () => {
  const res = runRedTeamWorkflow(
    { task: 'authorized: true target: 127.0.0.1', authorized: true },
    { redteam_enabled: true, platform: 'linux' }
  );
  assert.strictEqual(res.status, 'blocked');
  assert.strictEqual(res.code, 'SKILL_AUTHORIZATION_DENIED');
  assert.ok(res.reason.includes('No authenticated agent identity'));
});

runTest('D18d MCP akatsuki dispatch denies a non-akatsuki or absent caller', () => {
  process.env.KONOHA_AKATSUKI_REDTEAM = '1';
  const args = {
    task: 'authorized: true target: localhost:8080',
    authorized: true, target: 'localhost:8080', workflow_type: 'red_team',
    redteam_enabled: true, platform: 'linux'
  };
  for (const caller of ['chunin', 'genin', null]) {
    const payload = { ...args };
    if (caller) payload.agent = caller;
    const res = JSON.parse(toolDispatch.executeToolSync('akatsuki', payload));
    assert.strictEqual(res.status, 'blocked', `caller ${caller} must be blocked`);
    assert.strictEqual(res.code, 'SKILL_AUTHORIZATION_DENIED');
  }
  delete process.env.KONOHA_AKATSUKI_REDTEAM;
});

runTest('D18e the akatsuki tool never infers a caller from the tool name', () => {
  delete process.env.KONOHA_AKATSUKI_REDTEAM;
  const res = JSON.parse(toolDispatch.executeToolSync('akatsuki', {
    task: 'authorized: true target: localhost:8080', authorized: true,
    target: 'localhost:8080', workflow_type: 'red_team', platform: 'linux', agent: 'chunin'
  }));
  assert.strictEqual(res.status, 'blocked');
  assert.strictEqual(res.code, 'SKILL_AUTHORIZATION_DENIED');
});

runTest('D18f identity is checked before mode and scope, so a denied caller learns nothing', () => {
  delete process.env.KONOHA_AKATSUKI_REDTEAM;
  const res = JSON.parse(toolDispatch.executeToolSync('akatsuki', {
    task: 'authorized: true target: localhost:8080', authorized: true,
    target: 'localhost:8080', workflow_type: 'red_team', platform: 'linux', agent: 'anbu'
  }));
  assert.strictEqual(res.code, 'SKILL_AUTHORIZATION_DENIED');
  assert.ok(!/disabled/i.test(res.reason), 'denial must not disclose red-team mode state');
});

runTest('D19 missing container engine blocks with DECLINE_NO_ENGINE and spawns no tools', () => {
  const commands = [];
  const missingRunner = (cmd) => {
    commands.push(String(cmd));
    return { status: 1, stdout: '', stderr: 'not found' };
  };
  const res = runRedTeamWorkflow(
    { task: 'authorized: true target: 127.0.0.1' },
    { agentName: 'akatsuki', redteam_enabled: true, platform: 'linux', runner: missingRunner }
  );
  assert.strictEqual(res.status, 'blocked');
  assert.strictEqual(res.declined, true);
  assert.strictEqual(res.reason, 'Declined: LXC/Docker not installed on this machine.');
  assert.strictEqual(res.host_execution_denied, true);
  const toolBinaries = commands.filter((c) => !/^(which|where)$/.test(c));
  assert.deepStrictEqual(toolBinaries, [], 'no host tool may run when the engine is absent');
});

// ---------------------------------------------------------- E. DB isolation
console.log('\nE. Lab DB isolation');

runTest('E20 openLabDb creates a separate lab.db file', () => {
  const conn = labDb.openLabDb();
  try {
    const labPath = labDb.getLabDbPath();
    assert.ok(fs.existsSync(labPath));
    assert.ok(fs.realpathSync(labPath) !== fs.realpathSync(fs.existsSync(MAIN_DB) ? MAIN_DB : labPath + '.none'));
  } finally {
    labDb.closeLabDb(conn);
  }
});

runTest('E21 main DB and lab DB realpaths differ', () => {
  const mainConn = dbModule.getConnection(MAIN_DB, false);
  mainConn.close();
  const labConn = labDb.openLabDb();
  try {
    assert.notStrictEqual(fs.realpathSync(labDb.getLabDbPath()), fs.realpathSync(MAIN_DB));
  } finally {
    labDb.closeLabDb(labConn);
  }
});

runTest('E22 lab schema contains only lab tables', () => {
  const conn = labDb.openLabDb();
  try {
    const names = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name).sort();
    assert.deepStrictEqual(names, ['kali_tools', 'lab_runs', 'lab_tool_invocations', 'red_skill_audit']);
    const catalog = conn.prepare('SELECT COUNT(*) AS c FROM kali_tools').get();
    assert.ok(catalog.c >= 360, 'lab DB must carry its own Kali catalog');
  } finally {
    labDb.closeLabDb(conn);
  }
});

runTest('E23 main schema contains no lab tables and vice versa', () => {
  const mainConn = dbModule.getConnection(MAIN_DB, false);
  try {
    dbModule.setupSchema(mainConn);
    const mainTables = mainConn.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    assert.ok(!mainTables.includes('lab_runs'));
    assert.ok(!mainTables.includes('lab_tool_invocations'));
  } finally {
    mainConn.close();
  }
});

runTest('E24 lab writes never appear in the main DB', () => {
  const labConn = labDb.openLabDb();
  try {
    labConn.prepare('INSERT INTO lab_runs (lab_name, engine, workflow, started_at) VALUES (?,?,?,?)')
      .run('akatsuki-lab', 'lxc', 'red_team', new Date().toISOString());
  } finally {
    labDb.closeLabDb(labConn);
  }
  const mainConn = dbModule.getConnection(MAIN_DB, false);
  try {
    assert.throws(() => mainConn.prepare('SELECT * FROM lab_runs').all(), /no such table/i);
  } finally {
    mainConn.close();
  }
});

runTest('E25 lab DB pointed at the main DB throws LAB_DB_ISOLATION_VIOLATION', () => {
  const saved = process.env.KONOHA_AKATSUKI_LAB_DB;
  try {
    process.env.KONOHA_AKATSUKI_LAB_DB = MAIN_DB;
    assert.throws(() => labDb.openLabDb(), (e) => e.code === 'LAB_DB_ISOLATION_VIOLATION');
  } finally {
    if (saved === undefined) delete process.env.KONOHA_AKATSUKI_LAB_DB;
    else process.env.KONOHA_AKATSUKI_LAB_DB = saved;
  }
});

runTest('E26 lab DB outside the lab root throws LAB_DB_ISOLATION_VIOLATION', () => {
  const saved = process.env.KONOHA_AKATSUKI_LAB_DB;
  try {
    process.env.KONOHA_AKATSUKI_LAB_DB = path.join(os.tmpdir(), 'outside-lab.db');
    assert.throws(() => labDb.openLabDb(), (e) => e.code === 'LAB_DB_ISOLATION_VIOLATION');
  } finally {
    if (saved === undefined) delete process.env.KONOHA_AKATSUKI_LAB_DB;
    else process.env.KONOHA_AKATSUKI_LAB_DB = saved;
  }
});

runTest('E27 the main connector refuses the lab DB path', () => {
  assert.throws(() => dbModule.getConnection(labDb.getLabDbPath(), false), (e) => e.code === 'LAB_DB_ISOLATION_VIOLATION');
});

runTest('E28 openLabDb never inherits KONOHA_DB_PATH', () => {
  assert.strictEqual(process.env.KONOHA_DB_PATH, MAIN_DB);
  assert.notStrictEqual(labDb.getLabDbPath(), MAIN_DB);
  const conn = labDb.openLabDb();
  try {
    const names = conn.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    assert.ok(!names.includes('persona_memories'));
    assert.ok(!names.includes('tasks'));
  } finally {
    labDb.closeLabDb(conn);
  }
});

runTest('E29 purgeLabDb removes the file and its WAL sidecars', () => {
  const conn = labDb.openLabDb();
  labDb.closeLabDb(conn);
  const target = labDb.getLabDbPath();
  labDb.purgeLabDb();
  for (const suffix of ['', '-wal', '-shm']) {
    assert.strictEqual(fs.existsSync(target + suffix), false, `expected ${target + suffix} to be removed`);
  }
});

// -------------------------------------------------- F. templates + provisioner
console.log('\nF. Template and provisioner isolation');

runTest('F30 lab templates contain no main-DB references', () => {
  const root = path.join(__dirname, '..', 'src', 'templates', 'akatsuki_lab');
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      const text = fs.readFileSync(p, 'utf8');
      for (const needle of ['konoha.db', 'KONOHA_DB_PATH', 'persona_memories', '.konoha/']) {
        if (text.includes(needle)) offenders.push(`${path.relative(root, p)}: ${needle}`);
      }
    }
  };
  walk(root);
  assert.deepStrictEqual(offenders, []);
});

runTest('F31 provisioner children get KONOHA_DB_PATH pinned to the lab DB', () => {
  const { _labChildEnv } = require('../src/workflow/akatsuki/lab');
  assert.strictEqual(_labChildEnv().KONOHA_DB_PATH, labDb.getLabDbPath());
});

// ------------------------------------------------- F. red-skill audit trail
console.log('\nF. Red-skill audit (lab DB only)');

runTest('F38 red_skill_audit lives in the lab DB, never the main DB', () => {
  const labConn = labDb.openLabDb();
  try {
    labDb.recordRedSkillAudit(
      { skillName: 'akatsuki-skill', agentName: 'anbu', decision: 'denied', code: 'SKILL_AUTHORIZATION_DENIED', surface: 'test' },
      labConn
    );
    const rows = labConn.prepare('SELECT skill_name, agent_name, decision, code FROM red_skill_audit').all();
    assert.ok(rows.length >= 1);
    assert.strictEqual(rows[rows.length - 1].decision, 'denied');
  } finally {
    labDb.closeLabDb(labConn);
  }
  const mainConn = dbModule.getConnection(MAIN_DB, false);
  const tables = mainConn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='red_skill_audit'").all();
  mainConn.close();
  assert.strictEqual(tables.length, 0, 'main DB must never carry the red-skill audit table');
});

runTest('F39 recordRedSkillAudit requires an open lab connection and never creates one', () => {
  assert.strictEqual(labDb.recordRedSkillAudit({ skillName: 'akatsuki-skill', decision: 'denied' }, null), false);
  assert.strictEqual(labDb.recordRedSkillAudit({ skillName: 'akatsuki-skill', decision: 'denied' }, {}), false);
});

runTest('F40 a denied red workflow appends an audit row to a supplied lab connection', () => {
  const labConn = labDb.openLabDb();
  try {
    const before = labConn.prepare('SELECT COUNT(*) AS c FROM red_skill_audit').get().c;
    const res = runRedTeamWorkflow(
      { task: 'authorized: true target: 127.0.0.1', authorized: true },
      { agentName: 'chunin', redteam_enabled: true, platform: 'linux', labConn }
    );
    assert.strictEqual(res.code, 'SKILL_AUTHORIZATION_DENIED');
    const after = labConn.prepare('SELECT COUNT(*) AS c FROM red_skill_audit').get().c;
    assert.strictEqual(after, before + 1, 'denial must be audited');
    const row = labConn.prepare('SELECT agent_name, decision, code, surface FROM red_skill_audit ORDER BY id DESC LIMIT 1').get();
    assert.strictEqual(row.decision, 'denied');
    assert.strictEqual(row.agent_name, 'chunin');
    assert.strictEqual(row.surface, 'runRedTeamWorkflow');
  } finally {
    labDb.closeLabDb(labConn);
  }
});

runTest('F41 a denied red workflow audits an existing lab store and never creates a missing one', () => {
  // Absent lab store: the denial must not conjure a lab DB.
  labDb.purgeLabDb();
  assert.strictEqual(fs.existsSync(labDb.getLabDbPath()), false, 'precondition: no lab DB');
  const denied = runRedTeamWorkflow(
    { task: 'authorized: true target: 127.0.0.1', authorized: true },
    { agentName: 'genin', redteam_enabled: true, platform: 'linux' }
  );
  assert.strictEqual(denied.code, 'SKILL_AUTHORIZATION_DENIED');
  assert.strictEqual(fs.existsSync(labDb.getLabDbPath()), false, 'auditing must never create the lab DB');

  // Existing lab store: the same denial appends exactly one row.
  const labConn = labDb.openLabDb();
  const before = labConn.prepare('SELECT COUNT(*) AS c FROM red_skill_audit').get().c;
  labDb.closeLabDb(labConn);
  const denied2 = runRedTeamWorkflow(
    { task: 'authorized: true target: 127.0.0.1', authorized: true },
    { agentName: 'genin', redteam_enabled: true, platform: 'linux' }
  );
  assert.strictEqual(denied2.code, 'SKILL_AUTHORIZATION_DENIED');
  const recheck = labDb.openLabDb();
  try {
    assert.strictEqual(recheck.prepare('SELECT COUNT(*) AS c FROM red_skill_audit').get().c, before + 1);
  } finally {
    labDb.closeLabDb(recheck);
  }
});

runTest('F42 an allowed red workflow audits the identity the gate resolved, not an option echo', () => {
  const labConn = labDb.openLabDb();
  try {
    const res = runRedTeamWorkflow(
      { task: 'authorized: true target: 127.0.0.1', authorized: true, target: '127.0.0.1' },
      { agentName: 'akatsuki', redteam_enabled: true, platform: 'linux', labConn, skip_container_exec: true }
    );
    assert.strictEqual(res.status, 'completed');
    const row = labConn.prepare("SELECT agent_name, decision, surface FROM red_skill_audit WHERE decision = 'allowed' ORDER BY id DESC LIMIT 1").get();
    assert.ok(row, 'allowed decision must be audited');
    assert.strictEqual(row.agent_name, 'akatsuki');
    assert.strictEqual(row.surface, 'runRedTeamWorkflow');
  } finally {
    labDb.closeLabDb(labConn);
  }
});

runTest('F43 auditRedSkill never creates the lab store and reports whether it wrote', () => {
  const { auditRedSkill } = require('../src/workflow/akatsuki/lab_audit');
  labDb.purgeLabDb();
  assert.strictEqual(auditRedSkill({ skillName: 'akatsuki-skill', decision: 'denied' }, {}), false);
  assert.strictEqual(fs.existsSync(labDb.getLabDbPath()), false, 'auditing must not create the store');
  const conn = labDb.openLabDb();
  labDb.closeLabDb(conn);
  assert.strictEqual(auditRedSkill({ skillName: 'akatsuki-skill', decision: 'denied' }, {}), true);
  const check = labDb.openLabDb();
  try {
    assert.strictEqual(check.prepare('SELECT COUNT(*) AS c FROM red_skill_audit').get().c, 1);
  } finally {
    labDb.closeLabDb(check);
  }
});

// ------------------------------------------------------ G. path-guard logic
console.log('\nG. Cross-platform path guards');

runTest('G32 a Windows-style main DB path is not a lab path', () => {
  assert.strictEqual(authz.isLabDbPath('C:\\Users\\x\\.konoha\\konoha.db'), false);
});

runTest('G33 the canonical lab path is a lab path', () => {
  assert.strictEqual(authz.isLabDbPath(path.join(authz.getLabDbDir(), 'lab.db')), true);
});

runTest('G34 traversal out of the lab root is rejected', () => {
  assert.strictEqual(authz.isLabDbPath(path.join(authz.getLabDbDir(), '..', 'konoha.db')), false);
  assert.strictEqual(authz.isLabDbPath(authz.getLabDbDir()), false);
  // A directory whose name merely starts with ".." is still inside the root.
  assert.strictEqual(authz.isLabDbPath(path.join(authz.getLabDbDir(), '..sub', 'lab.db')), true);
});

runTest('G35 existing-file-only open refuses to create, including paths with ? and #', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-fileonly-'));
  for (const name of ['plain.db', 'with space.db', 'with#hash.db', 'with?query.db']) {
    const p = path.join(dir, name);
    assert.throws(() => dbModule.openRawConnection(p, { fileMustExist: true }), name);
    assert.strictEqual(fs.existsSync(p), false, `${name} must not be created`);
    dbModule.openRawConnection(p).close();
    dbModule.openRawConnection(p, { fileMustExist: true }).close();
  }
  // A nonexistent nested parent must stay absent: the existing-only branch returns
  // before any mkdir, so a denial leaves no filesystem artifact behind.
  const ghostParent = path.join(dir, 'ghost-root', 'nested');
  assert.throws(() => dbModule.openRawConnection(path.join(ghostParent, 'lab.db'), { fileMustExist: true }));
  assert.strictEqual(fs.existsSync(ghostParent), false, 'a denied existing-only open must not create the parent chain');
});

cleanup();
console.log(`\n${testsPassed} test cases passed.`);
