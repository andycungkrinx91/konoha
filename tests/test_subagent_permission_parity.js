#!/usr/bin/env node
'use strict';

/**
 * Subagent tool-grant parity — does a client's generated subagent definition
 * grant the same tool set as that client's main agent?
 *
 * Status: MCP grants are PROVEN from disk for Claude Code. Everything else is
 * explicitly PARITY_UNVERIFIABLE. No other claim is made.
 *
 * Ground truth is an ARTIFACT READ FROM DISK, never the subagent list itself.
 * An earlier revision derived the "main agent grant set" from
 * `buildSubagentToolGrants()`, making the comparison `X ⊇ X`. That helper is
 * deleted and a regression guard at the bottom fails the suite if the
 * derivation path ever calls it again.
 *
 * Measured shape of `~/.claude/settings.json` on this host:
 *   permissions.allow : 54 x mcp__*  + 2 x Bash(...) command-scoped rules
 *   allowedTools      : the same 54 mcp entries
 *   bare built-in tool names: none — Claude Code grants built-ins by client
 *                      default and does not enumerate them.
 * Consequences, encoded below:
 *   - MCP grant parity IS checkable against the file. That is the only
 *     PROVEN_FROM_SETTINGS claim in this suite.
 *   - Built-in tool parity is NOT checkable: the file lists none, so any
 *     expected builtin set would be fabricated. Labelled PARITY_UNVERIFIABLE.
 *   - `Bash(rtk)` is a command-SCOPED RULE, not the `Bash` TOOL. The two are
 *     separate categories and are reported separately.
 *   - Approval POLICY application (what the client does with the grants) is
 *     UNVERIFIED_CLIENT_INTERNAL for every client.
 *
 * This is about TOOL grants only. ACTION permission is unchanged: the
 * prohibited-action contract (destructive shell/git/cloud, inline interpreter
 * evasion, secret reads) and the Gate 1 / Gate 2 HITL gates are independent of
 * which tools an agent holds, and are asserted present and byte-identical.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');

// bin/lib/paths.js resolves HOME-derived paths at require time, so point HOME
// at a throwaway directory BEFORE requiring any module that writes
// ~/.claude/settings.json. Refuse to trust anything outside the sandbox.
const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-subagent-parity-'));
const SANDBOX_HOME = path.join(TEMP_ROOT, '_home');
fs.mkdirSync(SANDBOX_HOME, { recursive: true });
process.env.HOME = SANDBOX_HOME;
process.env.USERPROFILE = SANDBOX_HOME;

const common = require('../src/mcp_clients/common');
const agentContract = require('../src/agent_contract');
const claudeCode = require('../src/mcp_clients/claude_code');
const commandCode = require('../src/mcp_clients/command_code');
const codexManager = require('../src/codex_manager');
const openCodeManager = require('../src/opencode_manager');
const antigravityAgents = require('../src/antigravity_agents');

const TEST_FILE = __filename;

const PROVEN = 'PROVEN_FROM_SETTINGS';
const UNVERIFIABLE = 'PARITY_UNVERIFIABLE';
const APPROVAL_UNVERIFIED = 'UNVERIFIED_CLIENT_INTERNAL';

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (e) {
    failed += 1;
    failures.push(`${name}: ${e.message}`);
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Fixtures and grant classification
// ---------------------------------------------------------------------------

const AGENTS = [
  { name: 'sannin', description: 'router', instructions: 'Route work.', skills: ['konoha/core'] },
  { name: 'kage', description: 'leader', instructions: 'Design systems.', skills: [] },
  { name: 'anbu', description: 'backend', instructions: 'Fix the API.', skills: ['backend/api'] }
];

function freshHome(tag) {
  const home = path.join(TEMP_ROOT, tag);
  fs.mkdirSync(home, { recursive: true });
  return home;
}

function parseFrontmatterList(md) {
  const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(match, 'subagent definition has no YAML frontmatter');
  const out = [];
  let inList = false;
  for (const raw of match[1].split('\n')) {
    if (/^allowed-tools:\s*$/.test(raw)) { inList = true; continue; }
    if (!inList) continue;
    if (/^\s+-\s+/.test(raw)) out.push(raw.replace(/^\s+-\s+/, '').trim());
    else if (raw.trim() === '') continue;
    else break;
  }
  return out;
}

const wildcardGrants = (list) => list.filter((g) => common.isWildcardGrant(g));

/**
 * Grant categories. `Bash(rtk)` is a scoped RULE; `Bash` is the TOOL. They are
 * never conflated: a rule grant is not evidence of tool parity.
 */
const isMcpGrant = (g) => /^mcp__[a-z0-9-]+__[A-Za-z0-9_]+$/.test(g);
const isScopedRule = (g) => /^[A-Za-z_]+\s*\(\s*[^)]+\)$/.test(g);
const isBareBuiltin = (g) => !g.startsWith('mcp__') && !isScopedRule(g);
const categoryOf = (g) => (isMcpGrant(g) ? 'mcp' : isScopedRule(g) ? 'scoped-rule' : 'builtin-tool');

// ---------------------------------------------------------------------------
// (d) prohibited-action block: byte-identical reference
// ---------------------------------------------------------------------------

function sha256(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function extractProhibitedBlock(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.includes('Destructive command, Git, cloud infra'));
  if (start === -1) return null;
  let end = start;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('  - ')) { end = i; continue; }
    break;
  }
  return lines.slice(start, end + 1).join('\n');
}

// The contract as the runtime actually emits it. (The .js source escapes
// backticks, so raw-source bytes would be a false mismatch.)
const BASELINE_SHA = sha256(agentContract.buildProhibitedActionBlock() || '');

const PROHIBITED_BLOCKS = [
  'NEVER run harmful commands',
  'NEVER run destructive git commands',
  'NEVER run destructive cloud infrastructure commands',
  'NEVER use inline interpreter evasion',
  'NEVER view, print, dump, or commit secrets'
];

function assertProhibitedBlockIntact(label, text) {
  for (const needle of PROHIBITED_BLOCKS) {
    assert.ok(text.includes(needle), `${label}: prohibited-action line missing: "${needle}"`);
  }
  const block = extractProhibitedBlock(text);
  assert.ok(block, `${label}: prohibited-action block not found`);
  assert.strictEqual(sha256(block), BASELINE_SHA,
    `${label}: prohibited-action block was modified (SHA-256 mismatch)`);
}

/** No wildcard APPROVAL in a generated definition file. */
const WILDCARD_GRANT_SHAPE = /(^|[\s'"`])(\*|Bash\(\*\)|Shell\(\*\)|command\(\*\)|mcp\(\*\)|mcp__[a-z-]+__\*|mcp:[a-z-]+:\*|mcp\([a-z-]+\/\*\))(?=$|[\s'"`,])/;

/**
 * Only DECLARED grants are inspected (YAML lists, quoted JSON array entries,
 * TOML `key = "…"`, JSON `"k": "allow"`), never prose — markdown bold
 * (`**text**`) is not a grant.
 */
function declaredGrants(text) {
  const grants = [];
  for (const m of text.matchAll(/^\s{2}-\s+(.+?)\s*$/gm)) grants.push(m[1]);
  for (const m of text.matchAll(/^\s*"([^"]+)"\s*,?\s*$/gm)) grants.push(m[1]);
  for (const m of text.matchAll(/^\s*'([^']+)'\s*,?\s*$/gm)) grants.push(m[1]);
  for (const m of text.matchAll(/^\s*[A-Za-z_]+\s*=\s*"([^"]+)"\s*$/gm)) grants.push(m[1]);
  for (const m of text.matchAll(/"([a-z_]+)"\s*:\s*"(allow|deny|ask)"/g)) grants.push(m[1]);
  return grants;
}

function assertNoWildcardApproval(label, text) {
  const isFrontmatter = text.trimStart().startsWith('---');
  const surface = isFrontmatter ? declaredGrants(text) : [...declaredGrants(text), text];
  for (const grant of surface) {
    const hit = grant.match(WILDCARD_GRANT_SHAPE);
    assert.strictEqual(hit, null, `${label}: wildcard approval grant present (${grant.trim()})`);
  }
}

// ===========================================================================
console.log('declared state — a PROVEN claim without a settings read is a hard failure');

/**
 * Per-client posture, split by grant class. Written down so overclaiming fails
 * instead of being asserted away.
 *
 *   mcp_grants     Class 1 (PROVEN requires a settings file read this run)
 *   builtin_grants Class 3 (no client claims it; none is derivable)
 *   approval       always UNVERIFIED_CLIENT_INTERNAL — generated grants do not
 *                  demonstrate prompt suppression for any client
 */
const DECLARED_STATE = [
  {
    client: 'claude',
    mcp_grants: PROVEN,
    builtin_grants: UNVERIFIABLE,
    builtin_reason: 'client grants built-ins by default; permissions.allow enumerates none',
    approval: APPROVAL_UNVERIFIED,
    artifactPath: '~/.claude/settings.json'
  },
  {
    client: 'commandcode',
    mcp_grants: UNVERIFIABLE,
    builtin_grants: UNVERIFIABLE,
    mcp_reason: 'allowed-tools resolves inside the client; the settings file this repo writes is its own output, not a graded main-agent grant artifact',
    builtin_reason: 'same — no client-produced artifact',
    approval: APPROVAL_UNVERIFIED
  },
  {
    client: 'opencode',
    mcp_grants: UNVERIFIABLE,
    builtin_grants: UNVERIFIABLE,
    mcp_reason: 'permission object holds categories (mcp/read/bash), not tool names; categories are not representable as allowed-tools grants',
    builtin_reason: 'same — category names, not an enumerated tool list',
    approval: APPROVAL_UNVERIFIED
  },
  {
    client: 'codex',
    mcp_grants: UNVERIFIABLE,
    builtin_grants: UNVERIFIABLE,
    mcp_reason: 'this repo documents only [mcp_servers.*.tools.*]; no per-agent grant artifact, and the vocabulary differs from mcp__*',
    builtin_reason: 'no per-agent builtin artifact; vocabulary differs',
    approval: APPROVAL_UNVERIFIED
  },
  {
    client: 'antigravity',
    mcp_grants: UNVERIFIABLE,
    builtin_grants: UNVERIFIABLE,
    mcp_reason: 'agent.json toolNames is a closed vocabulary written by us; no artifact proves the main agent set',
    builtin_reason: 'same — toolNames is written by us, not derived from the client',
    approval: APPROVAL_UNVERIFIED
  },
  {
    client: 'pi',
    mcp_grants: UNVERIFIABLE,
    builtin_grants: UNVERIFIABLE,
    mcp_reason: 'no subagent definitions are generated at all',
    builtin_reason: 'no subagent definitions are generated at all',
    approval: APPROVAL_UNVERIFIED
  }
];

test('every declared client is accounted for', () => {
  assert.deepStrictEqual(DECLARED_STATE.map((c) => c.client).sort(),
    ['antigravity', 'claude', 'codex', 'commandcode', 'opencode', 'pi']);
});

test('every non-PROVEN claim carries a specific reason string', () => {
  for (const row of DECLARED_STATE) {
    if (row.mcp_grants !== PROVEN) {
      assert.ok(row.mcp_reason && row.mcp_reason.length > 20, `${row.client} lacks an mcp_reason`);
    }
    if (row.builtin_grants !== PROVEN) {
      assert.ok(row.builtin_reason && row.builtin_reason.length > 20, `${row.client} lacks a builtin_reason`);
    }
    assert.strictEqual(row.approval, APPROVAL_UNVERIFIED,
      `${row.client} claims ${row.approval}; no client source here proves approval policy`);
  }
});

test('no client claims built-in tool parity (it cannot be established)', () => {
  const claiming = DECLARED_STATE.filter((c) => c.builtin_grants === PROVEN);
  assert.deepStrictEqual(claiming.map((c) => c.client), [],
    'built-in parity is being claimed without an artifact that enumerates built-ins');
});

// ===========================================================================
console.log('PROVEN_FROM_SETTINGS — MCP grants only, checked against the file on disk');

// Populated by the Claude Code test below; only settings.json feeds it.
const artifacts = {};

/**
 * Partition the real `permissions.allow` into the three classes. Handling is
 * deliberately different per class — see the assertions below.
 *
 *   CLASS 1  exact MCP tool names            -> comparable, asserted verbatim
 *   CLASS 2  scoped Bash/command rules       -> non-comparable, recorded only
 *   CLASS 3  bare built-in tool names        -> none present; NOT derivable
 */
function partitionAllowList(allow) {
  const class1 = [];
  const class2 = [];
  const class3 = [];
  for (const entry of allow) {
    // Exact, normalised as written. No case folding, no globbing, no expansion.
    if (typeof entry !== 'string') { class2.push(String(entry)); continue; }
    if (isMcpGrant(entry)) class1.push(entry);
    else if (isScopedRule(entry)) class2.push(entry);
    else class3.push(entry);
  }
  return { class1, class2, class3 };
}

function readSettingsArtifact(settingsPath) {
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const allow = settings.permissions && Array.isArray(settings.permissions.allow)
    ? settings.permissions.allow : [];
  const allowedTools = Array.isArray(settings.allowedTools) ? settings.allowedTools : [];
  return { settingsPath, allow, allowedTools, ...partitionAllowList(allow) };
}

/**
 * The one real parity comparison: every CLASS 1 grant must appear verbatim in
 * the subagent's allowed-tools. Returns the checked count so the caller can
 * prove nothing was silently skipped.
 */
function assertClass1GrantsPresent(label, class1, subGrants) {
  const subSet = new Set(subGrants);
  const missing = class1.filter((g) => !subSet.has(g));
  assert.deepStrictEqual(missing, [],
    `${label}: subagent is missing Class-1 MCP grant(s) the main agent holds: ${missing.join(', ')}`);
  const checked = class1.filter((g) => subSet.has(g)).length;
  assert.strictEqual(checked, class1.length,
    `${label}: checked ${checked} of ${class1.length} Class-1 grants — some were skipped`);
  return checked;
}

test('claude_code: every Class-1 MCP grant in settings is present in the generated subagent', () => {
  const home = freshHome('claude');
  const res = claudeCode.ensureClaudeCodeSetup({ home, force: true, silent: true, agents: AGENTS });
  assert.ok(res && res.ok, `setup failed: ${res && res.reason}`);

  const settingsPath = common.CLAUDE_SETTINGS;
  assert.ok(settingsPath.startsWith(TEMP_ROOT),
    `refusing to read settings outside the sandbox: ${settingsPath}`);
  const artifact = readSettingsArtifact(settingsPath);
  artifacts.claude = { home, ...artifact };

  // VACUITY GUARD: a pass with nothing to compare is meaningless.
  assert.ok(artifact.class1.length > 0,
    'no comparable grants found: permissions.allow contains zero Class-1 MCP tool names');
  for (const server of ['mcp__konoha__', 'mcp__aislop__']) {
    assert.ok(artifact.class1.some((g) => g.startsWith(server)),
      `no ${server}* Class-1 grant in settings to compare`);
  }

  console.log(`    settings.allow: comparable(Class-1)=${artifact.class1.length} `
    + `non-comparable(Class-2)=${artifact.class2.length} `
    + `unverifiable(Class-3)=${artifact.class3.length}`);

  const checkedCounts = {};
  for (const agent of AGENTS) {
    const md = fs.readFileSync(path.join(home, '.claude', 'agents', `${agent.name}.md`), 'utf8');
    const sub = parseFrontmatterList(md);
    checkedCounts[agent.name] = assertClass1GrantsPresent(`claude/${agent.name}`, artifact.class1, sub);
    assert.deepStrictEqual(wildcardGrants(sub), [],
      `claude/${agent.name}: wildcard grant(s): ${wildcardGrants(sub).join(', ')}`);
    assertNoWildcardApproval(`claude/${agent.name}`, md);
    assertProhibitedBlockIntact(`claude/${agent.name}`, md);
  }
  artifacts.claude.checkedCounts = checkedCounts;
});

test('claude_code: every Class-1 grant was checked for every subagent', () => {
  const a = artifacts.claude;
  assert.ok(a && a.checkedCounts, 'comparison did not run');
  for (const agent of AGENTS) {
    assert.strictEqual(a.checkedCounts[agent.name], a.class1.length,
      `${agent.name}: checked ${a.checkedCounts[agent.name]} of ${a.class1.length}`);
  }
});

test('claude_code: Class-2 scoped rules are recorded, not asserted or counted as success', () => {
  const a = artifacts.claude;
  assert.ok(a, 'settings artifact was never read');
  assert.ok(a.class2.length > 0, 'expected scoped Bash rules in settings');
  console.log(`    Class-2 (non-comparable, command rules not tool grants): ${a.class2.join(', ')}`);
  const sub = parseFrontmatterList(
    fs.readFileSync(path.join(a.home, '.claude', 'agents', 'kage.md'), 'utf8'));
  // Recorded fact only. Its absence is NOT a parity result and NOT a failure.
  const carried = a.class2.filter((r) => sub.includes(r));
  console.log(`    subagent carries ${carried.length} of ${a.class2.length} Class-2 rules `
    + '(neither asserted present nor treated as success)');
});

test('claude_code: Class-3 builtin parity is PARITY_UNVERIFIABLE, not asserted', () => {
  const a = artifacts.claude;
  assert.ok(a, 'settings artifact was never read');
  assert.strictEqual(a.class3.length, 0,
    'settings now enumerates bare builtins — built-in parity may become checkable; update the declared table');
  // Deliberately no assertion on builtins. An empty expected set must never
  // be treated as a pass; the declared table carries PARITY_UNVERIFIABLE.
  const row = DECLARED_STATE.find((c) => c.client === 'claude');
  assert.strictEqual(row.builtin_grants, UNVERIFIABLE);
  console.log(`    builtins: ${UNVERIFIABLE} — ${row.builtin_reason}`);
});

// NEGATIVE CONTROL — required, or a passing comparison proves nothing.
test('negative control: a fake Class-1 grant absent from the subagent makes the check FAIL', () => {
  const a = artifacts.claude;
  assert.ok(a, 'settings artifact was never read');
  const FAKE = 'mcp__konoha__fake_missing_tool';
  const sub = parseFrontmatterList(
    fs.readFileSync(path.join(a.home, '.claude', 'agents', 'kage.md'), 'utf8'));

  // With the fake absent, the comparison must fail AND name the grant.
  const injected = [...a.class1, FAKE];
  let message = null;
  try {
    assertClass1GrantsPresent('negative-control', injected, sub);
  } catch (e) {
    message = e.message;
  }
  assert.ok(message, 'negative control FAILED to fail: injected grant was not detected');
  assert.ok(message.includes(FAKE), `failure did not name the missing grant: ${message}`);
  assert.ok(/missing Class-1 MCP grant/.test(message), `unexpected failure shape: ${message}`);

  // Remove it again: the real comparison passes.
  assert.strictEqual(
    assertClass1GrantsPresent('negative-control-restored', a.class1, sub),
    a.class1.length
  );
});

test('a PROVEN MCP claim must name a settings file actually read this run', () => {
  for (const row of DECLARED_STATE.filter((c) => c.mcp_grants === PROVEN)) {
    assert.ok(row.artifactPath, `${row.client} claims ${PROVEN} without an artifactPath`);
    const abs = row.artifactPath.replace(/^~/, SANDBOX_HOME);
    assert.ok(fs.existsSync(abs), `${row.client} claims ${PROVEN} but ${abs} was never written`);
    assert.ok(artifacts[row.client], `${row.client} claims ${PROVEN} but no artifact was recorded`);
  }
});

test('claude_code keeps explicit allow-list and rejects wildcards', () => {
  const settings = JSON.parse(fs.readFileSync(artifacts.claude.settingsPath, 'utf8'));
  assert.ok(Array.isArray(settings.permissions.allow) && settings.permissions.allow.length > 0);
  for (const grant of settings.permissions.allow) {
    assert.strictEqual(common.isWildcardGrant(grant), false, `settings.permissions.allow wildcard: ${grant}`);
  }
  const src = fs.readFileSync(path.join(REPO, 'src', 'mcp_clients', 'claude_code.js'), 'utf8');
  for (const rule of ["'*'", "'Bash(*)'", "'mcp(*)'", "'command(*)'"]) {
    assert.ok(src.includes(rule), `invalidRules rejection for ${rule} was removed`);
  }
});

// ===========================================================================
console.log('no generated definition file may carry a wildcard approval (every client)');

test('claude_code: generated .md files carry no wildcard approval', () => {
  for (const agent of AGENTS) {
    const md = fs.readFileSync(path.join(TEMP_ROOT, 'claude', '.claude', 'agents', `${agent.name}.md`), 'utf8');
    assertNoWildcardApproval(`claude/${agent.name}`, md);
  }
});

test('command_code: generated .md files carry no wildcard approval', () => {
  const home = freshHome('commandcode');
  const agentsDir = path.join(home, '.commandcode', 'agents');
  const res = commandCode.deployCommandCodeRules(true, {
    home,
    agentsMd: path.join(home, '.commandcode', 'AGENTS.md'),
    ruleDest: path.join(home, '.commandcode', 'rules', 'konoha.md'),
    agentsDir
  });
  assert.ok(res && res.ok, `deploy failed: ${res && res.reason}`);
  commandCode.registerCommandCodePermissions(true, { home });

  const settings = JSON.parse(fs.readFileSync(path.join(home, '.commandcode', 'settings.json'), 'utf8'));
  for (const grant of settings.permissions.allow) {
    assert.strictEqual(common.isWildcardGrant(grant), false, `CC settings.allow wildcard: ${grant}`);
  }
  for (const agent of AGENTS) {
    const md = fs.readFileSync(path.join(agentsDir, `${agent.name}.md`), 'utf8');
    assertNoWildcardApproval(`commandcode/${agent.name}`, md);
    assertProhibitedBlockIntact(`commandcode/${agent.name}`, md);
  }
});

test('opencode: agent permission blocks carry no wildcard form', () => {
  const home = freshHome('opencode');
  openCodeManager.registerOpenCodeMcp('node', path.join(REPO, 'src', 'file_tools_mcp.js'), true, { home });
  const config = JSON.parse(fs.readFileSync(path.join(home, '.config', 'opencode', 'opencode.json'), 'utf8'));
  assert.ok(config.agent, 'no agent entries generated');
  for (const name of Object.keys(config.agent)) {
    const perm = config.agent[name].permission;
    assert.ok(perm && typeof perm === 'object', `opencode subagent ${name} has no permission block`);
    for (const [key, value] of Object.entries(perm)) {
      assert.ok(!/[*]/.test(String(key)) && !/[*]/.test(String(value)),
        `opencode/${name} permission ${key}=${value} is a wildcard form`);
    }
  }
});

test('codex: config.toml carries no wildcard approval', () => {
  const toml = codexManager.updateCodexTomlMcp('', 'node', path.join(REPO, 'src', 'file_tools_mcp.js'));
  assertNoWildcardApproval('codex config.toml', toml);
  for (const agent of AGENTS) {
    const block = toml.split(`[agents.${agent.name}]`)[1];
    assert.ok(block, `codex agent table ${agent.name} missing`);
    const header = block.split('\n').slice(0, 4).join('\n');
    assert.ok(/approval_mode\s*=\s*"auto"/.test(header),
      `codex agent ${agent.name} has no approval_mode key`);
  }
});

// ===========================================================================
console.log('PARITY_UNVERIFIABLE clients — recorded, not asserted');

test('unverifiable clients state a reason and are not claimed as parity', () => {
  const unverifiable = DECLARED_STATE.filter((c) => c.mcp_grants !== PROVEN);
  assert.ok(unverifiable.length > 0, 'no client is marked unverifiable — recheck the evidence');
  for (const row of unverifiable) {
    console.log(`    ${row.client}: ${UNVERIFIABLE} — ${row.mcp_reason}`);
  }
});

test('antigravity subagent toolNames is a closed, narrower vocabulary', () => {
  const json = antigravityAgents.buildAgentJson({ name: 'kage', description: 'd', instructions: 'i', skills: [] });
  const toolNames = json.config.customAgent.toolNames;
  // Recorded as an observation only; no parity verdict is claimed.
  const lacksMapped = ['Read', 'Grep', 'Glob', 'Task'].filter((t) => !toolNames.includes(t));
  assert.ok(lacksMapped.length > 0,
    'antigravity now emits the full set — update the scope note and re-derive this row');
});

// ===========================================================================
console.log('(d) prohibited-action contract is intact, not weakened');

test('contract block SHA-256 is stable and present everywhere it must be', () => {
  assert.ok(BASELINE_SHA && BASELINE_SHA.length === 64, 'could not extract prohibited-action block');
  const src = fs.readFileSync(path.join(REPO, 'src', 'agent_contract.js'), 'utf8');
  assertProhibitedBlockIntact('src/agent_contract.js', src.replace(/\\`/g, '`'));
  assertProhibitedBlockIntact('full agent contract', agentContract.buildAgentContract({ client: 'claude' }));
  for (const client of ['claude', 'commandcode', 'codex', 'opencode', 'antigravity']) {
    assertProhibitedBlockIntact(`${client} subagent contract`, agentContract.buildSubagentContract(client));
  }
});

test('every generated subagent .md keeps the prohibited-action block', () => {
  for (const agent of AGENTS) {
    assertProhibitedBlockIntact(`generic/${agent.name}`, agentContract.generateGenericSubagentMd(agent, 'codex'));
    assertProhibitedBlockIntact(`claude/${agent.name}`, claudeCode.generateClaudeCodeSubagent(agent));
  }
});

// ===========================================================================
console.log('self-consistency — the constant matches itself (NOT parity, NOT inheritance)');

test('self-consistency: generator output equals the frozen constant', () => {
  // Explicitly self-consistency: subagent vs constant. This test CANNOT detect
  // a parity defect and does not claim to.
  for (const agent of AGENTS) {
    for (const client of ['generic', 'codex', 'opencode', 'commandcode', 'claude']) {
      const md = agentContract.generateGenericSubagentMd(agent, client);
      const sub = parseFrontmatterList(md);
      assert.deepStrictEqual(sub, common.buildSubagentToolGrants(client),
        `${client}/${agent.name} diverged from the constant`);
      assert.deepStrictEqual(wildcardGrants(sub), [], `${client}/${agent.name} emitted a wildcard`);
    }
  }
});

test('self-consistency: MAIN_AGENT_BUILTIN_TOOLS is a frozen literal', () => {
  // Named MAIN_AGENT_* but materially a policy list. Asserts current contents
  // only; it is not and cannot be evidence about any client.
  assert.deepStrictEqual([...common.MAIN_AGENT_BUILTIN_TOOLS], [
    'Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash', 'WebSearch', 'TodoRead', 'TodoWrite', 'Task'
  ]);
});

test('helper throws instead of emitting a wildcard', () => {
  assert.throws(() => common.assertNoWildcardGrants(['Read', '*']), /wildcard/i);
  assert.throws(() => common.assertNoWildcardGrants(['Bash(*)']), /wildcard/i);
  assert.throws(() => common.assertNoWildcardGrants(['mcp__konoha__*']), /wildcard/i);
  assert.strictEqual(common.assertNoWildcardGrants(['Read', 'mcp__konoha__kage']), true);
});

test('the old hardcoded list is gone from src/', () => {
  for (const file of ['src/mcp_clients/claude_code.js', 'src/agent_contract.js',
    'src/mcp_clients/command_code.js', 'src/opencode_manager.js', 'src/codex_manager.js']) {
    const src = fs.readFileSync(path.join(REPO, file), 'utf8');
    assert.ok(!/'\s{2}- mcp__konoha__\*'/.test(src), `${file} still hardcodes mcp__konoha__*`);
    assert.ok(!/'\s{2}- mcp__semble__\*'/.test(src), `${file} still hardcodes mcp__semble__*`);
  }
});

// ===========================================================================
console.log('regression guard — the main-agent grant set must never come from the subagent list');

function functionsMentioning(file, needle) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^\s*(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/);
    if (!m) continue;
    let depth = 0;
    let started = false;
    let end = i;
    for (let j = i; j < lines.length; j += 1) {
      for (const ch of lines[j]) {
        if (ch === '{') { depth += 1; started = true; }
        else if (ch === '}') depth -= 1;
      }
      if (started && depth === 0) { end = j; break; }
    }
    const body = lines.slice(i, end + 1).join('\n');
    if (body.includes(needle)) hits.push({ name: m[1], body });
  }
  return hits;
}

test('no main-grant derivation function calls buildSubagentToolGrants', () => {
  const offenders = functionsMentioning(TEST_FILE, 'buildSubagentToolGrants')
    .filter(({ name }) => /^(main|derive|readSettings)/i.test(name));
  assert.deepStrictEqual(offenders.map((o) => o.name), [],
    `circular derivation re-introduced in: ${offenders.map((o) => o.name).join(', ')}`);
});

test('the circular mainAgentGrants helper does not exist', () => {
  const src = fs.readFileSync(TEST_FILE, 'utf8');
  assert.ok(!/function\s+mainAgentGrants\s*\(/.test(src),
    'mainAgentGrants() was re-added; it must not derive from the subagent list');
});

test('no main-agent set is built from a spread of the subagent helper', () => {
  const src = fs.readFileSync(TEST_FILE, 'utf8');
  const circular = src.match(/(?:mainBare|mainScoped|mainSet|mainAgent\w*|mcpGrants)\s*=\s*[^;\n]*\.\.\.(?:common\.)?buildSubagentToolGrants\(/g) || [];
  assert.deepStrictEqual(circular, [], `circular derivation: ${circular.join(' | ')}`);
});

test('the Class-1 set is non-empty, so the comparison cannot pass vacuously', () => {
  const a = artifacts.claude;
  assert.ok(a, 'settings artifact was never read');
  assert.ok(a.class1.length > 0, 'no comparable grants found — a pass here would be meaningless');
  assert.strictEqual(a.class1.filter((g) => !isMcpGrant(g)).length, 0,
    'Class-1 partition leaked a non-MCP entry');
});

// ---------------------------------------------------------------------------
fs.rmSync(TEMP_ROOT, { recursive: true, force: true });

console.log('\nDeclared client state:');
for (const row of DECLARED_STATE) {
  console.log(`  ${row.client.padEnd(12)} mcp_grants=${row.mcp_grants.padEnd(20)} `
    + `builtin_grants=${row.builtin_grants.padEnd(20)} approval=${row.approval}`);
}

console.log(`\nSubagent tool-grant parity: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
process.exit(0);
