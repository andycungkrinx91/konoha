#!/usr/bin/env node
'use strict';

/**
 * tests/test_stack_detector.js
 * Unit tests for Workstream B: Dynamic Polyglot Stack Detection & Validation Matrix.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { detectStack } = require('../src/mcp/stack_detector');

console.log('Running test_stack_detector.js tests...');

// 1. Current Node.js Repository
const nodeStack = detectStack(path.resolve(__dirname, '..'));
assert.strictEqual(nodeStack.ecosystem, 'node');
assert.strictEqual(nodeStack.manifest, 'package.json');
assert.strictEqual(nodeStack.package_manager, 'pnpm');
assert.ok(nodeStack.lint_command.includes('lint'));
console.log('  ✓ Node.js / TypeScript stack detected successfully.');

// Test with isolated temp directories
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_stack_test_'));

try {
  // 2. Python (uv)
  const pyDir = path.join(tmpRoot, 'python_project');
  fs.mkdirSync(pyDir);
  fs.writeFileSync(path.join(pyDir, 'pyproject.toml'), '[project]\nname = "demo"\n');
  fs.writeFileSync(path.join(pyDir, 'uv.lock'), '');
  const pyStack = detectStack(pyDir);
  assert.strictEqual(pyStack.ecosystem, 'python');
  assert.strictEqual(pyStack.package_manager, 'uv');
  assert.strictEqual(pyStack.test_command, 'rtk uv run pytest');
  assert.strictEqual(pyStack.lint_command, 'rtk uv run ruff check');
  console.log('  ✓ Python (uv) stack detected successfully.');

  // 3. Go
  const goDir = path.join(tmpRoot, 'go_project');
  fs.mkdirSync(goDir);
  fs.writeFileSync(path.join(goDir, 'go.mod'), 'module example.com/demo\n');
  const goStack = detectStack(goDir);
  assert.strictEqual(goStack.ecosystem, 'go');
  assert.strictEqual(goStack.manifest, 'go.mod');
  assert.strictEqual(goStack.test_command, 'rtk go test ./...');
  assert.strictEqual(goStack.lint_command, 'rtk golangci-lint run');
  console.log('  ✓ Go stack detected successfully.');

  // 4. Rust
  const rustDir = path.join(tmpRoot, 'rust_project');
  fs.mkdirSync(rustDir);
  fs.writeFileSync(path.join(rustDir, 'Cargo.toml'), '[package]\nname = "demo"\n');
  const rustStack = detectStack(rustDir);
  assert.strictEqual(rustStack.ecosystem, 'rust');
  assert.strictEqual(rustStack.manifest, 'Cargo.toml');
  assert.strictEqual(rustStack.build_command, 'rtk cargo build');
  assert.strictEqual(rustStack.test_command, 'rtk cargo test');
  assert.strictEqual(rustStack.lint_command, 'rtk cargo clippy -- -D warnings');
  console.log('  ✓ Rust stack detected successfully.');

  // 5. PHP
  const phpDir = path.join(tmpRoot, 'php_project');
  fs.mkdirSync(phpDir);
  fs.writeFileSync(path.join(phpDir, 'composer.json'), '{"name": "demo/app"}\n');
  const phpStack = detectStack(phpDir);
  assert.strictEqual(phpStack.ecosystem, 'php');
  assert.strictEqual(phpStack.manifest, 'composer.json');
  assert.strictEqual(phpStack.build_command, 'rtk composer install');
  console.log('  ✓ PHP stack detected successfully.');

  // 6. Java (Gradle)
  const javaDir = path.join(tmpRoot, 'java_project');
  fs.mkdirSync(javaDir);
  fs.writeFileSync(path.join(javaDir, 'build.gradle'), '// gradle build\n');
  const javaStack = detectStack(javaDir);
  assert.strictEqual(javaStack.ecosystem, 'java');
  assert.strictEqual(javaStack.package_manager, 'gradle');
  assert.ok(javaStack.test_command.includes('gradle test'));
  console.log('  ✓ Java stack detected successfully.');

  // 7. Unknown
  const emptyDir = path.join(tmpRoot, 'empty_project');
  fs.mkdirSync(emptyDir);
  const unknownStack = detectStack(emptyDir);
  assert.strictEqual(unknownStack.ecosystem, 'unknown');
  assert.strictEqual(unknownStack.manifest, null);
  console.log('  ✓ Unknown stack returns clean fallback structure.');

} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log('\nAll test_stack_detector tests passed cleanly!');
