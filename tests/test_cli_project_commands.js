#!/usr/bin/env node
'use strict';

/**
 * tests/test_cli_project_commands.js — Tests for CLI 'konoha project' and 'konoha data --project' commands.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const CLI_JS = path.join(REPO_ROOT, 'bin', 'cli.js');

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*[mGKF]/g, '');
}

let activeTestDbPath = null;
let activeTestHome = null;

function runCli(args) {
  try {
    const env = {
      ...process.env,
      HOME: activeTestHome || process.env.HOME,
      USERPROFILE: activeTestHome || process.env.USERPROFILE,
      KONOHA_DB_PATH: activeTestDbPath || process.env.KONOHA_DB_PATH,
      KONOHA_UI_AUTOSTART: '0'
    };
    const stdout = execFileSync(process.execPath, [CLI_JS, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      status: err.status || 1,
      stdout: err.stdout ? err.stdout.toString() : '',
      stderr: err.stderr ? err.stderr.toString() : err.message
    };
  }
}

async function run() {
  console.log('Running test_cli_project_commands tests...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli_proj_'));
  const testHome = path.join(tmpDir, 'home');
  const dotKonoha = path.join(testHome, '.konoha');
  const dotAgents = path.join(testHome, '.agents');
  fs.mkdirSync(dotKonoha, { recursive: true });
  fs.mkdirSync(dotAgents, { recursive: true });

  const testDbPath = path.join(tmpDir, 'test_konoha.db');
  activeTestDbPath = testDbPath;
  activeTestHome = testHome;

  const cliVer = require('../package.json').version;
  fs.writeFileSync(path.join(dotKonoha, 'server.js'), '// dummy');
  fs.writeFileSync(path.join(dotKonoha, 'file_tools_launcher.js'), '// dummy');
  fs.writeFileSync(path.join(dotKonoha, 'file_tools_mcp.js'), '// dummy');
  fs.writeFileSync(path.join(dotKonoha, 'konoha.db'), '');
  const geminiConfigDir = path.join(testHome, '.gemini', 'config');
  fs.mkdirSync(geminiConfigDir, { recursive: true });
  fs.writeFileSync(path.join(geminiConfigDir, 'mcp_config.json'), '{}');

  const agentsYamlPath = path.join(dotAgents, 'agents.yaml');
  const defaultAgentsSrc = path.join(REPO_ROOT, 'src', 'templates', 'agents.yaml');
  if (fs.existsSync(defaultAgentsSrc)) {
    fs.copyFileSync(defaultAgentsSrc, agentsYamlPath);
  } else {
    fs.writeFileSync(agentsYamlPath, '[]');
  }
  const mtime = fs.statSync(agentsYamlPath).mtimeMs;
  fs.writeFileSync(path.join(dotKonoha, '.auto_setup_state.json'), JSON.stringify({
    version: cliVer,
    agentsMtime: mtime
  }));

  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;
  const origDbPath = process.env.KONOHA_DB_PATH;

  process.env.HOME = testHome;
  process.env.USERPROFILE = testHome;
  process.env.KONOHA_DB_PATH = testDbPath;

  const personaMemory = require('../src/persona_memory');
  const db = require('../src/db');
  personaMemory.DB_PATH = testDbPath;
  db.DB_PATH = testDbPath;
  const conn = db.getConnection(testDbPath);
  db.setupSchema(conn);
  conn.close();

  const projectDir = path.join(tmpDir, 'ecommerce_test_repo');
  fs.mkdirSync(projectDir, { recursive: true });

  fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
    name: 'my-ecommerce-project',
    dependencies: {
      next: '16.0.0',
      tailwindcss: '^4.0.0'
    }
  }));

  try {
    // 1. project context
    const resCtx = runCli(['project', 'context', projectDir]);
    assert.strictEqual(resCtx.status, 0, `Error: ${resCtx.stderr}`);
    const cleanCtx = stripAnsi(resCtx.stdout);
    assert.ok(cleanCtx.includes('my-ecommerce-project'));
    assert.ok(cleanCtx.includes('Next.js'));
    assert.ok(cleanCtx.includes('pnpm'));
    console.log('✓ Project context command passed');

    // 2. project add and list
    const resAdd = runCli(['project', 'add', projectDir, 'Always enforce strict typing and dark mode theme variables']);
    assert.strictEqual(resAdd.status, 0, `Error: ${resAdd.stderr}`);
    assert.ok(stripAnsi(resAdd.stdout).includes('Saved architectural invariants'));

    // Assert Konoha injects managed ignore block into consumer .gitignore and .dockerignore
    const expectedIgnoreEntries = [
      '.agents/plugins/',
      '.aislop/',
      '.aislopignore',
      '.claude.json',
      '.claude/',
      '.codex/',
      '.commandcode/',
      '.cursor/',
      '.cursorrules',
      '.gemini/',
      '.omp/',
      'AGENTS.md',
      'CLAUDE.md',
      'GEMINI.md'
    ];
    const gitignorePath = path.join(projectDir, '.gitignore');
    const dockerignorePath = path.join(projectDir, '.dockerignore');
    assert.ok(fs.existsSync(gitignorePath), '.gitignore must exist in consumer project');
    assert.ok(fs.existsSync(dockerignorePath), '.dockerignore must exist in consumer project');
    const gitignoreText = fs.readFileSync(gitignorePath, 'utf8');
    const dockerignoreText = fs.readFileSync(dockerignorePath, 'utf8');
    assert.ok(gitignoreText.includes('## Start Konoha config+skill'), '.gitignore must contain Start Konoha marker');
    assert.ok(gitignoreText.includes('## End Konoha config+skill'), '.gitignore must contain End Konoha marker');
    assert.ok(dockerignoreText.includes('## Start Konoha config+skill'), '.dockerignore must contain Start Konoha marker');
    assert.ok(dockerignoreText.includes('## End Konoha config+skill'), '.dockerignore must contain End Konoha marker');
    for (const entry of expectedIgnoreEntries) {
      assert.ok(gitignoreText.includes(entry), `.gitignore must contain ${entry}`);
      assert.ok(dockerignoreText.includes(entry), `.dockerignore must contain ${entry}`);
    }

    // Assert core konoha root does NOT contain consumer ignore block
    const konohaGitignoreText = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
    assert.ok(!konohaGitignoreText.includes('## Start Konoha config+skill'), 'Konoha repo root must NOT contain consumer ignore block');

    // Assert external konoha fixture repo (simulating global runner outside REPO_ROOT) is excluded
    const agentManager = require('../src/agent_manager');
    const konohaFixtureDir = path.join(tmpDir, 'konoha-fixture-repo');
    fs.mkdirSync(path.join(konohaFixtureDir, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(konohaFixtureDir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(konohaFixtureDir, 'package.json'), JSON.stringify({ name: 'konoha-mcp', version: '2.2.4' }), 'utf8');
    fs.writeFileSync(path.join(konohaFixtureDir, 'bin', 'cli.js'), '#!/usr/bin/env node\n', 'utf8');
    fs.writeFileSync(path.join(konohaFixtureDir, 'scripts', 'lint.js'), 'console.log("ok");\n', 'utf8');
    const fixtureDeploy = agentManager.deployProjectWorkspace(konohaFixtureDir, { silent: true, home: testHome });
    assert.ok(fixtureDeploy.ok !== false, 'deployProjectWorkspace should succeed for konoha fixture');
    const fixtureGitignore = path.join(konohaFixtureDir, '.gitignore');
    if (fs.existsSync(fixtureGitignore)) {
      const text = fs.readFileSync(fixtureGitignore, 'utf8');
      assert.ok(!text.includes('## Start Konoha config+skill'), 'External konoha repo fixture must NOT contain consumer ignore block');
    }

    const resList = runCli(['project', 'list']);
    assert.strictEqual(resList.status, 0, `Error: ${resList.stderr}`);
    assert.ok(stripAnsi(resList.stdout).includes('my-ecommerce-project'));
    console.log('✓ Project add, list, and ignore-injection commands passed');

    // 3. project memory, memory delete, and project prune
    const memId = personaMemory.saveMemory({
      agentName: 'jonin',
      content: 'CLI Test Project Learning',
      projectPath: projectDir,
      dbPath: testDbPath
    });
    assert.ok(memId, 'Saved memory should return ID');

    const resMem = runCli(['project', 'memory', projectDir]);
    assert.strictEqual(resMem.status, 0, `Error: ${resMem.stderr}`);
    assert.ok(stripAnsi(resMem.stdout).includes('CLI Test Project Learning'));

    // Test delete-memory 1 by 1
    const resDelMem = runCli(['project', 'delete-memory', String(memId)]);
    assert.strictEqual(resDelMem.status, 0, `Error: ${resDelMem.stderr}`);
    assert.ok(stripAnsi(resDelMem.stdout).includes(`Deleted memory item ID: ${memId}`));

    // Add another memory and test prune
    personaMemory.saveMemory({
      agentName: 'anbu',
      content: 'Prune Test Learning',
      projectPath: projectDir,
      dbPath: testDbPath
    });

    const resPrune = runCli(['project', 'prune', projectDir, '--invariants']);
    assert.strictEqual(resPrune.status, 0, `Error: ${resPrune.stderr}`);
    assert.ok(stripAnsi(resPrune.stdout).includes('Pruned'));
    assert.ok(stripAnsi(resPrune.stdout).includes('Architectural invariants cleared'));

    // 4. project delete and prune-all
    const resDel = runCli(['project', 'delete', projectDir]);
    assert.strictEqual(resDel.status, 0, `Error: ${resDel.stderr}`);
    assert.ok(stripAnsi(resDel.stdout).includes('Deleted project profile'));

    const resPruneAll = runCli(['project', 'prune-all']);
    assert.strictEqual(resPruneAll.status, 0, `Error: ${resPruneAll.stderr}`);
    assert.ok(stripAnsi(resPruneAll.stdout).includes('Pruned all registered workspace profiles'));
    console.log('✓ Project memory, delete-memory, prune, and delete commands passed');

    console.log('\nAll test_cli_project_commands tests passed!');
  } finally {
    process.env.HOME = origHome;
    process.env.USERPROFILE = origUserProfile;
    if (origDbPath !== undefined) process.env.KONOHA_DB_PATH = origDbPath;
    else delete process.env.KONOHA_DB_PATH;
    activeTestDbPath = null;
    activeTestHome = null;
    const personaMemory = require('../src/persona_memory');
    const db = require('../src/db');
    personaMemory.DB_PATH = null;
    db.DB_PATH = null;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run };
