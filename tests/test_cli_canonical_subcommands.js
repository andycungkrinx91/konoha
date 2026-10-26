const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI_PATH = path.resolve(__dirname, '../bin/cli.js');

test('CLI rejects removed subcommand synonyms and errors naming canonical forms', () => {
  // 1. task rm -> task delete
  const taskRes = spawnSync(process.execPath, [CLI_PATH, 'task', 'rm'], {
    encoding: 'utf8',
    timeout: 120000
  });
  assert.notStrictEqual(taskRes.status, 0, 'task rm must exit non-zero');
  const taskOut = (taskRes.stdout || '') + (taskRes.stderr || '');
  assert.ok(
    taskOut.includes("canonical subcommand 'konoha task delete'"),
    `task rm must name canonical form 'konoha task delete', got: ${taskOut}`
  );

  // 2. project show -> project context
  const projRes = spawnSync(process.execPath, [CLI_PATH, 'project', 'show'], {
    encoding: 'utf8',
    timeout: 120000
  });
  assert.notStrictEqual(projRes.status, 0, 'project show must exit non-zero');
  const projOut = (projRes.stdout || '') + (projRes.stderr || '');
  assert.ok(
    projOut.includes("canonical subcommand 'konoha project context'"),
    `project show must name canonical form 'konoha project context', got: ${projOut}`
  );

  // 3. telegram edit -> telegram config
  const tgRes = spawnSync(process.execPath, [CLI_PATH, 'telegram', 'edit'], {
    encoding: 'utf8',
    timeout: 120000
  });
  assert.notStrictEqual(tgRes.status, 0, 'telegram edit must exit non-zero');
  const tgOut = (tgRes.stdout || '') + (tgRes.stderr || '');
  assert.ok(
    tgOut.includes("canonical subcommand 'konoha telegram config'"),
    `telegram edit must name canonical form 'konoha telegram config', got: ${tgOut}`
  );

  // 4. data rm -> data delete
  const dataRes = spawnSync(process.execPath, [CLI_PATH, 'data', 'rm'], {
    encoding: 'utf8',
    timeout: 120000
  });
  assert.notStrictEqual(dataRes.status, 0, 'data rm must exit non-zero');
  const dataOut = (dataRes.stdout || '') + (dataRes.stderr || '');
  assert.ok(
    dataOut.includes("canonical subcommand 'konoha data delete'"),
    `data rm must name canonical form 'konoha data delete', got: ${dataOut}`
  );
});
