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

function runCli(args) {
  try {
    const stdout = execFileSync('node', [CLI_JS, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
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

    // 3. project memory and delete
    const resMem = runCli(['project', 'memory', projectDir]);
    assert.strictEqual(resMem.status, 0, `Error: ${resMem.stderr}`);

    const resDel = runCli(['project', 'delete', projectDir]);
    assert.strictEqual(resDel.status, 0, `Error: ${resDel.stderr}`);
    assert.ok(stripAnsi(resDel.stdout).includes('Deleted project profile'));
    console.log('✓ Project memory and delete command passed');

    console.log('\nAll test_cli_project_commands tests passed!');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run };
