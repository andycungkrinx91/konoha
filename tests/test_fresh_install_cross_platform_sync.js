'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Set isolated HOME and USERPROFILE before requiring any Konoha modules
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_fresh_install_'));
const origHome = process.env.HOME;
const origUserprofile = process.env.USERPROFILE;

process.env.HOME = tempRoot;
process.env.USERPROFILE = tempRoot;

const ROOT = path.resolve(__dirname, '..');
const deployUtils = require(path.join(ROOT, 'src', 'deploy_utils'));
const skillsCommon = require(path.join(ROOT, 'src', 'mcp', 'skills_common'));
const antigravityManager = require(path.join(ROOT, 'src', 'antigravity_manager'));
const cursorManager = require(path.join(ROOT, 'src', 'cursor_manager'));
const mcpClientsManager = require(path.join(ROOT, 'src', 'mcp_clients_manager'));
const opencodeManager = require(path.join(ROOT, 'src', 'opencode_manager'));
const codexManager = require(path.join(ROOT, 'src', 'codex_manager'));
const piManager = require(path.join(ROOT, 'src', 'pi_manager'));
const ompManager = require(path.join(ROOT, 'src', 'omp_manager'));
const agentManager = require(path.join(ROOT, 'src', 'agent_manager'));

function run() {
  console.log('Running test_fresh_install_cross_platform_sync...');

  try {
    const workspaceDir = path.join(tempRoot, 'my-project');
    fs.mkdirSync(workspaceDir, { recursive: true });

    // 1. Verify SOUL.md synchronization across ~/.agents and all 8 client trees
    console.log('1. Testing syncSoulAcrossClients for ~/.agents and all clients...');
    const updatedCount = deployUtils.syncSoulAcrossClients({ projectRoot: workspaceDir, silent: true });
    assert.ok(updatedCount > 0, 'syncSoulAcrossClients must copy files to targets');

    const expectedGlobalSoulTargets = [
      path.join(tempRoot, '.agents', 'SOUL.md'),
      path.join(tempRoot, '.gemini', 'SOUL.md'),
      path.join(tempRoot, '.cursor', 'SOUL.md'),
      path.join(tempRoot, '.claude', 'SOUL.md'),
      path.join(tempRoot, '.commandcode', 'SOUL.md'),
      path.join(tempRoot, '.codex', 'SOUL.md'),
      path.join(tempRoot, '.config', 'opencode', 'SOUL.md'),
      path.join(tempRoot, '.opencode', 'SOUL.md'),
      path.join(tempRoot, '.pi', 'SOUL.md'),
      path.join(tempRoot, '.omp', 'SOUL.md')
    ];

    for (const t of expectedGlobalSoulTargets) {
      assert.ok(fs.existsSync(t), `Expected SOUL.md at ${t}`);
      const content = fs.readFileSync(t, 'utf8');
      assert.ok(content.includes('Ninja\'s Soul') || content.includes('Will of Fire') || content.includes('Soul Engine'), `Target ${t} must contain soul doctrine`);
    }

    // Verify workspace is clean and not polluted with .agents/skills
    assert.ok(!fs.existsSync(path.join(workspaceDir, '.agents', 'skills')), 'Workspace must not have .agents/skills');
    console.log('  ✓ SOUL.md successfully synchronized to ~/.agents and all 8 client trees');

    // 2. Verify all client configurations, hooks, settings, and rules on fresh setup
    console.log('2. Testing client configs, hooks, settings, rules, semble, and aislop across all 8 clients...');

    // Mock launcher/server
    const dummyServer = path.join(tempRoot, 'server.js');
    fs.writeFileSync(dummyServer, '// mock server');

    // Antigravity
    antigravityManager.ensureAntigravityPermissions(true, { home: tempRoot });
    antigravityManager.deployAntigravityRtkRule(true, { home: tempRoot });
    assert.ok(fs.existsSync(path.join(tempRoot, '.agents', 'rules', 'rtk-rules.md')), 'Must have ~/.agents/rules/rtk-rules.md');
    assert.ok(fs.existsSync(path.join(tempRoot, '.agents', 'rules', 'antigravity-rtk-rules.md')), 'Must have ~/.agents/rules/antigravity-rtk-rules.md');

    // Cursor
    const cursorMcpPath = path.join(tempRoot, '.cursor', 'mcp.json');
    cursorManager.registerCursorMcp('node', dummyServer, 'uvx', true, { configPath: cursorMcpPath, home: tempRoot });
    cursorManager.deployCursorRtkRule(true, { home: tempRoot });
    assert.ok(fs.existsSync(cursorMcpPath), 'Must have ~/.cursor/mcp.json');
    assert.ok(fs.existsSync(path.join(tempRoot, '.cursor', 'rules', 'rtk.mdc')), 'Must have ~/.cursor/rules/rtk.mdc');
    const cursorCfg = JSON.parse(fs.readFileSync(cursorMcpPath, 'utf8'));
    assert.ok(cursorCfg.mcpServers.konoha, 'Cursor must configure konoha');
    assert.ok(cursorCfg.mcpServers.semble, 'Cursor must configure semble');
    assert.ok(cursorCfg.mcpServers.aislop, 'Cursor must configure aislop');

    // Claude Code
    const claudeConfigPath = path.join(tempRoot, '.claude', 'settings.json');
    mcpClientsManager.ensureClaudeCodeSetup({
      pythonCmd: 'node',
      serverPath: dummyServer,
      uvxCmd: 'uvx',
      silent: true,
      skipDetection: true,
      force: true,
      home: tempRoot,
      configPath: claudeConfigPath,
      projectRoot: workspaceDir,
      deployProject: true
    });
    assert.ok(fs.existsSync(claudeConfigPath), 'Must have Claude settings.json');
    assert.ok(fs.existsSync(path.join(tempRoot, '.claude', 'rules', 'rtk.md')), 'Must have ~/.claude/rules/rtk.md');
    const claudeCfg = JSON.parse(fs.readFileSync(claudeConfigPath, 'utf8'));
    assert.ok(claudeCfg.mcpServers.semble, 'Claude Code must configure semble');
    assert.ok(claudeCfg.mcpServers.aislop, 'Claude Code must configure aislop');

    // OpenCode
    const openCodeConfigPath = path.join(tempRoot, '.config', 'opencode', 'opencode.json');
    opencodeManager.ensureOpenCodeSetup({
      pythonCmd: 'node',
      serverPath: dummyServer,
      uvxCmd: 'uvx',
      silent: true,
      skipDetection: true,
      force: true,
      home: tempRoot,
      configPath: openCodeConfigPath
    });
    assert.ok(fs.existsSync(openCodeConfigPath), 'Must have OpenCode opencode.json');
    const openCodeCfg = JSON.parse(fs.readFileSync(openCodeConfigPath, 'utf8'));
    assert.ok(openCodeCfg.mcp.konoha, 'OpenCode must configure konoha');
    assert.ok(openCodeCfg.mcp.semble, 'OpenCode must configure semble');
    assert.ok(openCodeCfg.mcp.aislop, 'OpenCode must configure aislop');

    // Command Code
    const ccConfigPath = path.join(tempRoot, '.commandcode', 'mcp.json');
    mcpClientsManager.ensureCommandCodeSetup({
      pythonCmd: 'node',
      serverPath: dummyServer,
      uvxCmd: 'uvx',
      silent: true,
      skipDetection: true,
      force: true,
      home: tempRoot,
      configPath: ccConfigPath
    });
    assert.ok(fs.existsSync(ccConfigPath), 'Must have Command Code mcp.json');
    const ccCfg = JSON.parse(fs.readFileSync(ccConfigPath, 'utf8'));
    assert.ok(ccCfg.mcpServers.semble, 'Command Code must configure semble');
    assert.ok(ccCfg.mcpServers.aislop, 'Command Code must configure aislop');

    // Codex
    const codexConfigPath = path.join(tempRoot, '.codex', 'config.json');
    codexManager.ensureCodexSetup({
      pythonCmd: 'node',
      serverPath: dummyServer,
      uvxCmd: 'uvx',
      silent: true,
      skipDetection: true,
      force: true,
      home: tempRoot,
      configPath: codexConfigPath
    });
    assert.ok(fs.existsSync(codexConfigPath), 'Must have Codex config.json');
    const codexCfg = fs.readFileSync(codexConfigPath, 'utf8');
    assert.ok(codexCfg.includes('mcp_servers.konoha'), 'Codex must configure konoha');
    assert.ok(codexCfg.includes('mcp_servers.semble'), 'Codex must configure semble');
    assert.ok(codexCfg.includes('mcp_servers.aislop'), 'Codex must configure aislop');

    // Pi
    const piConfigPath = path.join(tempRoot, '.pi', 'agent', 'mcp.json');
    piManager.ensurePiSetup({
      pythonCmd: 'node',
      serverPath: dummyServer,
      uvxCmd: 'uvx',
      silent: true,
      skipDetection: true,
      force: true,
      home: tempRoot,
      configPath: piConfigPath
    });
    assert.ok(fs.existsSync(piConfigPath), 'Must have Pi mcp.json');
    const piCfg = JSON.parse(fs.readFileSync(piConfigPath, 'utf8'));
    assert.ok(piCfg.mcpServers.konoha, 'Pi must configure konoha');
    assert.ok(piCfg.mcpServers.semble, 'Pi must configure semble');
    assert.ok(piCfg.mcpServers.aislop, 'Pi must configure aislop');

    // OMP
    const ompConfigPath = path.join(tempRoot, '.omp', 'agent', 'mcp.json');
    ompManager.ensureOmpSetup({
      nodeCmd: 'node',
      launcherPath: dummyServer,
      uvxCmd: 'uvx',
      silent: true,
      skipDetection: true,
      force: true,
      home: tempRoot,
      configPath: ompConfigPath
    });
    assert.ok(fs.existsSync(ompConfigPath), 'Must have OMP mcp.json');
    const ompCfg = JSON.parse(fs.readFileSync(ompConfigPath, 'utf8'));
    assert.ok(ompCfg.mcpServers.konoha, 'OMP must configure konoha');
    assert.ok(ompCfg.mcpServers.semble, 'OMP must configure semble');
    assert.ok(ompCfg.mcpServers.aislop, 'OMP must configure aislop');

    // Test regenerateAndDeploy with isolated home
    agentManager.regenerateAndDeploy({
      force: true,
      silent: true,
      home: tempRoot
    });

    console.log('  ✓ Client configs, hooks, settings, rules, semble, and aislop verified across all 8 clients');

    // 3. Verify cross-platform Windows homedir and mirror fallback resolution
    console.log('3. Testing Windows homedir & mirror fallback resolution (global and client mirrors only)...');

    // Simulate Windows USERPROFILE without process.env.HOME
    delete process.env.HOME;
    process.env.USERPROFILE = tempRoot;

    // Create client mirror directory
    const cursorSkillsDir = path.join(tempRoot, '.cursor', 'skills');
    fs.mkdirSync(path.join(cursorSkillsDir, 'test-client-skill'), { recursive: true });
    fs.writeFileSync(path.join(cursorSkillsDir, 'test-client-skill', 'SKILL.md'), '# Test Client Skill\n');

    const roots = skillsCommon.getMirrorRoots();
    assert.ok(roots.length > 0, 'getMirrorRoots must return roots');

    // CRITICAL USER INVARIANT: Workspace mirror must NOT be included in fallback roots!
    assert.ok(!roots.includes(path.resolve(workspaceDir, '.agents', 'skills')), 'Fallback must NOT include workspace mirror');

    // Must include global mirror and client mirror
    assert.ok(roots.some(r => r.includes('.agents')), 'getMirrorRoots must include .agents/skills');
    assert.ok(roots.some(r => r.includes('.cursor')), 'getMirrorRoots must include .cursor/skills');

    // Verify findInMirror resolves cleanly from client mirror using path.relative boundary checks
    const foundSkill = skillsCommon.findInMirror('test-client-skill');
    assert.ok(foundSkill, 'findInMirror must find test-client-skill in client mirror');
    assert.strictEqual(foundSkill.type, 'skill');
    assert.ok(foundSkill.filePath.includes('test-client-skill'), 'filePath must resolve to test-client-skill');

    console.log('  ✓ Windows homedir and mirror fallback resolution verified cleanly');

  } finally {
    process.env.HOME = origHome;
    if (origUserprofile !== undefined) {
      process.env.USERPROFILE = origUserprofile;
    } else {
      delete process.env.USERPROFILE;
    }
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (_) {}
  }

  console.log('\nAll test_fresh_install_cross_platform_sync tests passed cleanly!');
}

if (require.main === module) {
  run();
}

module.exports = { run };
