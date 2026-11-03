#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');

const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');

function runCli(args = []) {
  const res = cp.spawnSync('node', [CLI_PATH, 'config', ...args], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' }
  });
  return res;
}

function testConfigCli() {
  console.log('Testing konoha config CLI...');

  // Help
  const helpRes = runCli(['--help']);
  assert.strictEqual(helpRes.status, 0);
  assert.ok(helpRes.stdout.includes('konoha config'));
  console.log('✓ Test 1: konoha config --help verified');

  // Set key with string and number
  const setRes = runCli(['set', 'turn_budget', '16384', '--json']);
  assert.strictEqual(setRes.status, 0);
  const setJson = JSON.parse(setRes.stdout.trim());
  assert.strictEqual(setJson.status, 'ok');
  assert.strictEqual(setJson.key, 'turn_budget');
  assert.strictEqual(setJson.value, 16384);
  console.log('✓ Test 2: konoha config set verified');

  // Get key
  const getRes = runCli(['get', 'turn_budget', '--json']);
  assert.strictEqual(getRes.status, 0);
  const getJson = JSON.parse(getRes.stdout.trim());
  assert.strictEqual(getJson.key, 'turn_budget');
  assert.strictEqual(getJson.value, 16384);
  console.log('✓ Test 3: konoha config get verified');

  // List keys
  const listRes = runCli(['list', '--json']);
  assert.strictEqual(listRes.status, 0);
  const listJson = JSON.parse(listRes.stdout.trim());
  assert.strictEqual(listJson.config.turn_budget, 16384);
  console.log('✓ Test 4: konoha config list verified');

  // Disallowed key rejection
  const badKeyRes = runCli(['set', 'non_existent_key_123', 'foo']);
  assert.strictEqual(badKeyRes.status, 1);
  console.log('✓ Test 5: Disallowed key rejected with exit code 1');

  // Unset key
  const unsetRes = runCli(['unset', 'turn_budget', '--json']);
  assert.strictEqual(unsetRes.status, 0);
  const unsetJson = JSON.parse(unsetRes.stdout.trim());
  assert.strictEqual(unsetJson.status, 'ok');
  assert.strictEqual(unsetJson.unset, 'turn_budget');

  const checkUnsetRes = runCli(['get', 'turn_budget', '--json']);
  const checkUnsetJson = JSON.parse(checkUnsetRes.stdout.trim());
  assert.strictEqual(checkUnsetJson.value, null);
  console.log('✓ Test 6: konoha config unset verified');

  console.log('All test_cli_config.js tests passed cleanly!');
}

testConfigCli();
