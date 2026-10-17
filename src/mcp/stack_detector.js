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

function createStackDescriptor(ecosystem, manifest, package_manager, build_command, test_command, lint_command, details = {}) {
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

function detectStack(projectPath = process.cwd()) {
  const root = path.resolve(projectPath);

  // 1. Rust Ecosystem
  if (fs.existsSync(path.join(root, 'Cargo.toml'))) {
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

  // 2. Go Ecosystem
  if (fs.existsSync(path.join(root, 'go.mod'))) {
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

  // 3. Python Ecosystem
  const hasPyproject = fs.existsSync(path.join(root, 'pyproject.toml'));
  const hasRequirements = fs.existsSync(path.join(root, 'requirements.txt'));
  const hasPipfile = fs.existsSync(path.join(root, 'Pipfile'));
  const hasSetupPy = fs.existsSync(path.join(root, 'setup.py'));

  if (hasPyproject || hasRequirements || hasPipfile || hasSetupPy) {
    const hasUvLock = fs.existsSync(path.join(root, 'uv.lock'));
    const hasPoetryLock = fs.existsSync(path.join(root, 'poetry.lock'));

    let pkgManager = 'pip';
    let testCmd = 'rtk pytest';
    let lintCmd = 'rtk ruff check';
    let buildCmd = 'rtk python -m build';

    if (hasUvLock) {
      pkgManager = 'uv';
      testCmd = 'rtk uv run pytest';
      lintCmd = 'rtk uv run ruff check';
      buildCmd = 'rtk uv build';
    } else if (hasPoetryLock) {
      pkgManager = 'poetry';
      testCmd = 'rtk poetry run pytest';
      lintCmd = 'rtk poetry run ruff check';
      buildCmd = 'rtk poetry build';
    }

    return {
      ecosystem: 'python',
      manifest: hasPyproject ? 'pyproject.toml' : (hasRequirements ? 'requirements.txt' : (hasPipfile ? 'Pipfile' : 'setup.py')),
      package_manager: pkgManager,
      build_command: buildCmd,
      test_command: testCmd,
      lint_command: lintCmd,
      details: {
        has_pyproject: hasPyproject,
        has_requirements: hasRequirements
      }
    };
  }

  // 4. PHP Ecosystem
  if (fs.existsSync(path.join(root, 'composer.json'))) {
    const hasPest = fs.existsSync(path.join(root, 'vendor', 'bin', 'pest'));
    return {
      ecosystem: 'php',
      manifest: 'composer.json',
      package_manager: 'composer',
      build_command: 'rtk composer install',
      test_command: hasPest ? 'rtk vendor/bin/pest' : 'rtk vendor/bin/phpunit',
      lint_command: 'rtk vendor/bin/phpstan',
      details: {
        test_framework: hasPest ? 'pest' : 'phpunit'
      }
    };
  }

  // 5. Java / Kotlin Ecosystem
  const hasGradleKts = fs.existsSync(path.join(root, 'build.gradle.kts'));
  const hasGradle = fs.existsSync(path.join(root, 'build.gradle'));
  const hasMaven = fs.existsSync(path.join(root, 'pom.xml'));

  if (hasGradleKts || hasGradle || hasMaven) {
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
      details: {
        build_tool: isGradle ? 'gradle' : 'maven'
      }
    };
  }

  // 6. Node.js / TypeScript Ecosystem
  if (fs.existsSync(path.join(root, 'package.json'))) {
    let pkgManager = 'npm';
    if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) {
      pkgManager = 'pnpm';
    } else if (fs.existsSync(path.join(root, 'bun.lock')) || fs.existsSync(path.join(root, 'bun.lockb'))) {
      pkgManager = 'bun';
    } else if (fs.existsSync(path.join(root, 'yarn.lock'))) {
      pkgManager = 'yarn';
    } else if (fs.existsSync(path.join(root, 'package-lock.json'))) {
      pkgManager = 'npm';
    } else {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        if (pkg.packageManager && pkg.packageManager.startsWith('pnpm')) {
          pkgManager = 'pnpm';
        }
      } catch (_) { /* ignore */ }
    }

    let hasCheckScript = false;
    let hasLintScript = false;
    let hasTestScript = false;
    let hasBuildScript = false;

    try {
      const pkgJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
      const scripts = pkgJson.scripts || {};
      hasCheckScript = Boolean(scripts.check);
      hasLintScript = Boolean(scripts.lint);
      hasTestScript = Boolean(scripts.test);
      hasBuildScript = Boolean(scripts.build);
    } catch (_) { /* ignore */ }

    const testCmd = hasTestScript ? `rtk ${pkgManager} test` : `rtk ${pkgManager} run test`;
    const lintCmd = hasLintScript ? `rtk ${pkgManager} run lint` : (hasCheckScript ? `rtk ${pkgManager} run check` : `rtk npx eslint .`);
    const buildCmd = hasBuildScript ? `rtk ${pkgManager} run build` : `rtk ${pkgManager} build`;

    return {
      ecosystem: 'node',
      manifest: 'package.json',
      package_manager: pkgManager,
      build_command: buildCmd,
      test_command: testCmd,
      lint_command: lintCmd,
      details: {
        has_check: hasCheckScript,
        has_lint: hasLintScript,
        has_test: hasTestScript,
        has_build: hasBuildScript
      }
    };
  }

  // Fallback: Unknown Stack
  return {
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
