#!/usr/bin/env node
/**
 * tests/test_python_spawn_cross_platform.test.js
 * Verifies that normalizeCommand, spawnPythonSync, and spawnPython correctly handle
 * multi-part commands like "py -3", preventing "spawnSync py -3 ENOENT" errors on Windows.
 */
const assert = require('assert');
const path = require('path');
const platform = require('../src/platform_utils');

console.log('--- Testing normalizeCommand ---');

// 1. String: 'py -3'
const py3 = platform.normalizeCommand('py -3');
assert.strictEqual(py3.executable, 'py');
assert.deepStrictEqual(py3.prefixArgs, ['-3']);

// 2. String: 'py -3.11'
const py311 = platform.normalizeCommand('py -3.11');
assert.strictEqual(py311.executable, 'py');
assert.deepStrictEqual(py311.prefixArgs, ['-3.11']);

// 3. String: 'python3'
const pySimple = platform.normalizeCommand('python3');
assert.strictEqual(pySimple.executable, 'python3');
assert.deepStrictEqual(pySimple.prefixArgs, []);

// 4. String: 'python'
const pyWin = platform.normalizeCommand('python');
assert.strictEqual(pyWin.executable, 'python');
assert.deepStrictEqual(pyWin.prefixArgs, []);

// 5. Array: ['py', '-3']
const pyArr = platform.normalizeCommand(['py', '-3']);
assert.strictEqual(pyArr.executable, 'py');
assert.deepStrictEqual(pyArr.prefixArgs, ['-3']);

// 6. JSON array string: '["py", "-3"]'
const pyJson = platform.normalizeCommand('["py", "-3"]');
assert.strictEqual(pyJson.executable, 'py');
assert.deepStrictEqual(pyJson.prefixArgs, ['-3']);

// 7. Object: { executable: 'py', prefixArgs: ['-3'] }
const pyObj = platform.normalizeCommand({ executable: 'py', prefixArgs: ['-3'] });
assert.strictEqual(pyObj.executable, 'py');
assert.deepStrictEqual(pyObj.prefixArgs, ['-3']);

// 8. Quoted path with space and argument
const quoted = platform.normalizeCommand('"C:\\Program Files\\Python312\\python.exe" -u');
assert.strictEqual(quoted.executable, 'C:\\Program Files\\Python312\\python.exe');
assert.deepStrictEqual(quoted.prefixArgs, ['-u']);

// 9. Empty / invalid handling
assert.strictEqual(platform.normalizeCommand('').executable, '');
assert.strictEqual(platform.normalizeCommand(null).executable, null);

console.log('✓ normalizeCommand tests passed.');

console.log('--- Testing spawnPythonSync with multi-arg command simulation ---');

// Test running a simulated command using node with prefix arguments
const nodeSimulatedPy = {
  executable: process.execPath,
  prefixArgs: ['-e', 'process.stdout.write("SIMULATED_PYTHON_OK")']
};

const simResult = platform.spawnPythonSync(nodeSimulatedPy, [], { encoding: 'utf-8' });
assert.strictEqual(simResult.status, 0);
assert.strictEqual(simResult.stdout.trim(), 'SIMULATED_PYTHON_OK');

console.log('✓ spawnPythonSync multi-arg prefixArgs simulation passed.');

console.log('--- Testing spawnPythonSync with actual detected Python ---');

const detectedPy = platform.detectPythonOrDefault();
const actualResult = platform.spawnPythonSync(detectedPy, ['-c', 'print("REAL_PYTHON_OK")'], { encoding: 'utf-8' });
assert.strictEqual(actualResult.status, 0, `Python invocation failed: ${actualResult.stderr}`);
assert.strictEqual(actualResult.stdout.trim(), 'REAL_PYTHON_OK');

console.log('✓ spawnPythonSync actual Python execution passed.');

console.log('--- Verifying "py -3" does NOT spawn binary named "py -3" ---');
// If py launcher is not installed (e.g. Linux), error should be ENOENT for 'py', NOT 'py -3'
const py3Check = platform.spawnPythonSync('py -3', ['--version']);
if (py3Check.error) {
  assert.ok(
    !py3Check.error.message.includes('spawnSync py -3 ENOENT'),
    `Error should not attempt to execute "py -3" binary, got: ${py3Check.error.message}`
  );
  assert.ok(
    py3Check.error.message.includes('spawnSync py ENOENT') || py3Check.error.code === 'ENOENT',
    `Expected ENOENT on "py", got: ${py3Check.error.message}`
  );
}
console.log('✓ "py -3" correctly parsed into executable "py" with args ["-3"].');

console.log('\nAll cross-platform Python spawn tests passed successfully! 🎉');
