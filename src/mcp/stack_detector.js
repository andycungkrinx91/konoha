/**
 * src/mcp/stack_detector.js — Dynamic Polyglot Stack Detection & Validation Matrix.
 *
 * Implements Workstream B of PLAN_REFINE_WORKFLOW.md:
 * Inspects workspace manifests and returns detected runtime, package manager,
 * and canonical validation commands wrapped with RTK for minimal tokens.
 *
 * Supported ecosystems:
 * - Node.js / TypeScript (package.json, pnpm-lock.yaml, bun.lock, etc.)
 * - Python (pyproject.toml, requirements.txt, Pipfile, setup.py)
 * - Go (go.mod)
 * - Rust (Cargo.toml)
 * - PHP (composer.json)
 * - Java / Kotlin (build.gradle, build.gradle.kts, pom.xml)
 */

'use strict';

const fs = require('fs');
const path = require('path');

function createStackDescriptor(ecosystem, manifest, package_manager, build_command, ...rest) {
  const [test_command, lint_command, details = {}] = rest;
  return {
    ecosystem,
    manifest,
    package_manager,
    build_command,
    test_command,
    lint_command,
    details
  };
}

function _detectRust(root) {
  if (!fs.existsSync(path.join(root, 'Cargo.toml'))) return null;
  return createStackDescriptor(
    'rust',
    'Cargo.toml',
    'cargo',
    'rtk cargo build',
    'rtk cargo test',
    'rtk cargo clippy -- -D warnings',
    { toolchain: 'cargo' }
  );
}

function _detectGo(root) {
  if (!fs.existsSync(path.join(root, 'go.mod'))) return null;
  return createStackDescriptor(
    'go',
    'go.mod',
    'go',
    'rtk go build ./...',
    'rtk go test ./...',
    'rtk golangci-lint run',
    { toolchain: 'go' }
  );
}

function _resolvePythonConfig(root) {
  const hasUvLock = fs.existsSync(path.join(root, 'uv.lock'));
  const hasPoetryLock = fs.existsSync(path.join(root, 'poetry.lock'));
  if (hasUvLock) {
    return { pkgManager: 'uv', testCmd: 'rtk uv run pytest', lintCmd: 'rtk uv run ruff check', buildCmd: 'rtk uv build' };
  }
  if (hasPoetryLock) {
    return { pkgManager: 'poetry', testCmd: 'rtk poetry run pytest', lintCmd: 'rtk poetry run ruff check', buildCmd: 'rtk poetry build' };
  }
  return { pkgManager: 'pip', testCmd: 'rtk pytest', lintCmd: 'rtk ruff check', buildCmd: 'rtk python -m build' };
}

function _detectPython(root) {
  const hasPyproject = fs.existsSync(path.join(root, 'pyproject.toml'));
  const hasRequirements = fs.existsSync(path.join(root, 'requirements.txt'));
  const hasPipfile = fs.existsSync(path.join(root, 'Pipfile'));
  const hasSetupPy = fs.existsSync(path.join(root, 'setup.py'));
  if (!hasPyproject && !hasRequirements && !hasPipfile && !hasSetupPy) return null;

  const cfg = _resolvePythonConfig(root);
  return {
    ecosystem: 'python',
    manifest: hasPyproject ? 'pyproject.toml' : (hasRequirements ? 'requirements.txt' : (hasPipfile ? 'Pipfile' : 'setup.py')),
    package_manager: cfg.pkgManager,
    build_command: cfg.buildCmd,
    test_command: cfg.testCmd,
    lint_command: cfg.lintCmd,
    details: { has_pyproject: hasPyproject, has_requirements: hasRequirements }
  };
}

function _detectPhp(root) {
  if (!fs.existsSync(path.join(root, 'composer.json'))) return null;
  const hasPest = fs.existsSync(path.join(root, 'vendor', 'bin', 'pest'));
  return {
    ecosystem: 'php',
    manifest: 'composer.json',
    package_manager: 'composer',
    build_command: 'rtk composer install',
    test_command: hasPest ? 'rtk vendor/bin/pest' : 'rtk vendor/bin/phpunit',
    lint_command: 'rtk vendor/bin/phpstan',
    details: { test_framework: hasPest ? 'pest' : 'phpunit' }
  };
}

function _detectJava(root) {
  const hasGradleKts = fs.existsSync(path.join(root, 'build.gradle.kts'));
  const hasGradle = fs.existsSync(path.join(root, 'build.gradle'));
  const hasMaven = fs.existsSync(path.join(root, 'pom.xml'));
  if (!hasGradleKts && !hasGradle && !hasMaven) return null;

  const isGradle = hasGradleKts || hasGradle;
  const gradlewExists = fs.existsSync(path.join(root, 'gradlew'));
  const gradleCmd = gradlewExists ? './gradlew' : 'gradle';
  return {
    ecosystem: 'java',
    manifest: isGradle ? (hasGradleKts ? 'build.gradle.kts' : 'build.gradle') : 'pom.xml',
    package_manager: isGradle ? 'gradle' : 'maven',
    build_command: isGradle ? `rtk ${gradleCmd} build` : 'rtk mvn package',
    test_command: isGradle ? `rtk ${gradleCmd} test` : 'rtk mvn test',
    lint_command: isGradle ? `rtk ${gradleCmd} check` : 'rtk mvn checkstyle:check',
    details: { build_tool: isGradle ? 'gradle' : 'maven' }
  };
}

function _detectNodePkgManager(root) {
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'bun.lock')) || fs.existsSync(path.join(root, 'bun.lockb'))) return 'bun';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(root, 'package-lock.json'))) return 'npm';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (pkg.packageManager?.startsWith('pnpm')) return 'pnpm';
  } catch (_) { /* ignore */ }
  return 'npm';
}

function _parseNodeScripts(root) {
  try {
    const pkgJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const scripts = pkgJson.scripts || {};
    return {
      hasCheck: Boolean(scripts.check),
      hasLint: Boolean(scripts.lint),
      hasTest: Boolean(scripts.test),
      hasBuild: Boolean(scripts.build)
    };
  } catch (_) {
    return { hasCheck: false, hasLint: false, hasTest: false, hasBuild: false };
  }
}

function _detectNode(root) {
  if (!fs.existsSync(path.join(root, 'package.json'))) return null;
  const pkgManager = _detectNodePkgManager(root);
  const { hasCheck, hasLint, hasTest, hasBuild } = _parseNodeScripts(root);
  const testCmd = hasTest ? `rtk ${pkgManager} test` : `rtk ${pkgManager} run test`;
  const lintCmd = hasLint ? `rtk ${pkgManager} run lint` : (hasCheck ? `rtk ${pkgManager} run check` : `rtk npx eslint .`);
  const buildCmd = hasBuild ? `rtk ${pkgManager} run build` : `rtk ${pkgManager} build`;
  return {
    ecosystem: 'node',
    manifest: 'package.json',
    package_manager: pkgManager,
    build_command: buildCmd,
    test_command: testCmd,
    lint_command: lintCmd,
    details: { has_check: hasCheck, has_lint: hasLint, has_test: hasTest, has_build: hasBuild }
  };
}

function detectStack(projectPath = process.cwd()) {
  const root = path.resolve(projectPath);
  return _detectRust(root) ||
         _detectGo(root) ||
         _detectPython(root) ||
         _detectPhp(root) ||
         _detectJava(root) ||
         _detectNode(root) || {
           ecosystem: 'unknown',
           manifest: null,
           package_manager: null,
           build_command: null,
           test_command: null,
           lint_command: null,
           details: {}
         };
}

module.exports = {
  detectStack
};
