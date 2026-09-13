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

function runCli(args) {
  try {
    const env = { ...process.env };
    if (activeTestDbPath) env.KONOHA_DB_PATH = activeTestDbPath;
    const stdout = execFileSync('node', [CLI_JS, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000
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
  const testDbPath = path.join(tmpDir, 'test_konoha.db');
  activeTestDbPath = testDbPath;
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

    const resList = runCli(['project', 'list']);
    assert.strictEqual(resList.status, 0, `Error: ${resList.stderr}`);
    assert.ok(stripAnsi(resList.stdout).includes('my-ecommerce-project'));
    console.log('✓ Project add and list command passed');

    // 3. project memory, memory delete, and project prune
    const personaMemory = require('../src/persona_memory');
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
    const personaMemory = require('../src/persona_memory');
    const db = require('../src/db');
    activeTestDbPath = null;
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
