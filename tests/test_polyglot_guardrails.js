#!/usr/bin/env node
'use strict';

/**
 * tests/test_polyglot_guardrails.js
 * Comprehensive verification of Konoha Universal Polyglot Guardrails & Zero-Bypass Engine.
 */

const assert = require('assert');
const { checkCommandGuardrails, buildGuardrailCheckerSource } = require('../src/guardrails');

function run() {
  console.log('Running test_polyglot_guardrails tests...');

  // 1. Interpreter Inline Evasion Blocked
  const interpreterEvasionCases = [
    'python -c "import os; os.system(\'ls\')"',
    'python3 -c "print(\'hello\')"',
    'rtk python3 -c "import sys"',
    'node -e "console.log(process.env)"',
    'node --eval "require(\'fs\').unlinkSync(\'foo\')"',
    'rtk node -e "process.exit(0)"',
    'bun -e "console.log(1)"',
    'php -r "echo 1;"',
    'rtk php -r "phpinfo();"',
    'perl -e "print 1;"',
    'ruby -e "puts 1"',
    'bash -c "rm foo"',
    'sh -c "ls"',
    'eval "rm -rf foo"',
    'base64 -d | sh',
    'base64 --decode | bash'
  ];

  for (const cmd of interpreterEvasionCases) {
    const res = checkCommandGuardrails(cmd);
    assert.ok(res, `Command should be blocked: ${cmd}`);
    assert.strictEqual(res.category, 'interpreter-bypass', `Category must be interpreter-bypass for: ${cmd}`);
  }
  console.log('✓ All 16 inline interpreter evasion vectors blocked cleanly');

  // 2. Config & Hook Self-Tampering Blocked
  const configTamperingCases = [
    'rm -rf .git/hooks',
    'rm .claude/settings.json',
    'mv .cursor/hooks.json /tmp/',
    'sed -i "s/error/off/g" eslint.config.js',
    'sed -i "s/level: 8/level: 0/g" phpstan.neon',
    'echo "" > .rtk',
    'rm -f tsconfig.json',
    'rm -rf .omp/agent/mcp.json',
    'truncate -s 0 .git/hooks/pre-commit'
  ];

  for (const cmd of configTamperingCases) {
    const res = checkCommandGuardrails(cmd);
    assert.ok(res, `Tampering command should be blocked: ${cmd}`);
    assert.strictEqual(res.category, 'config-tampering', `Category must be config-tampering for: ${cmd}`);
  }
  console.log('✓ All 9 config/linter/hook self-tampering attempts blocked cleanly');

  // 3. Destructive Cloud Infrastructure Blocked
  const cloudInfraCases = [
    'terraform destroy',
    'tofu destroy',
    'pulumi destroy',
    'kubectl delete ns production',
    'kubectl delete namespace default',
    'kubectl delete all --all'
  ];

  for (const cmd of cloudInfraCases) {
    const res = checkCommandGuardrails(cmd);
    assert.ok(res, `Destructive cloud infra command should be blocked: ${cmd}`);
    assert.strictEqual(res.category, 'destructive-infra', `Category must be destructive-infra for: ${cmd}`);
  }
  console.log('✓ All 6 destructive cloud infrastructure commands blocked cleanly');

  // 4. Legitimate Development Commands ALLOWED (Zero False Positives)
  const legitimateCases = [
    'python tests/run.py',
    'python3 scripts/sync.py',
    'uv run pytest',
    'node bin/cli.js web',
    'node scripts/lint.js',
    'php artisan test',
    'composer test',
    'pnpm test',
    'pnpm run build',
    'pnpm run lint',
    'cargo test',
    'terraform plan',
    'terraform fmt',
    'terraform validate',
    'kubectl get pods -A',
    'kubectl describe deployment web'
  ];

  for (const cmd of legitimateCases) {
    const res = checkCommandGuardrails(cmd);
    assert.strictEqual(res, null, `Legitimate command must be allowed: ${cmd}`);
  }
  console.log('✓ All 16 legitimate development commands allowed without false positives');

  // 5. Verify buildGuardrailCheckerSource exports self-contained function
  const source = buildGuardrailCheckerSource();
  assert.ok(source.startsWith('function checkCommandGuardrails(command) {'));
  const recreatedFn = new Function(source + '\nreturn checkCommandGuardrails;')();
  assert.strictEqual(typeof recreatedFn, 'function');
  assert.strictEqual(recreatedFn('python -c "exit()"').category, 'interpreter-bypass');
  assert.strictEqual(recreatedFn('pnpm test'), null);
  console.log('✓ buildGuardrailCheckerSource produces self-contained, eval-safe executable source');

  console.log('\nAll test_polyglot_guardrails tests passed cleanly!');
}

run();
