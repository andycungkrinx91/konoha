#!/usr/bin/env node
'use strict';

/**
 * tests/test_commandcode_and_argument_aliases.js
 * Verifies:
 * 1. Argument normalization and alias handling in server and file_tools_router.
 * 2. Token-compact formatting of project context and dependency filtering in persona_memory.
 * 3. CLI help flag and subcommand parity across all commands.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const server = require('../src/server');
const personaMemory = require('../src/persona_memory');

const REPO_ROOT = path.resolve(__dirname, '..');
const CLI_PATH = path.join(REPO_ROOT, 'bin', 'cli.js');

async function run() {
  console.log('Running test_commandcode_and_argument_aliases tests...');

  // 1. Argument alias normalization in server
  const args = {
    FilePath: '/path/to/file.txt',
    StartLine: 5,
    EndLine: 20
  };
  server._validate_manifest_arguments('read_file_range', args);
  assert.ok('file_path' in args, 'file_path must be in args');
  assert.strictEqual(args.start_line, 5);
  assert.strictEqual(args.end_line, 20);
  console.log('✓ Argument alias normalization passed');

  // 2. Project stack dependency filtering
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdcode_dep_'));
  try {
    const mockPkg = {
      name: 'test-app',
      dependencies: {},
      devDependencies: {
        next: '15.0.0',
        tailwindcss: '4.0.0',
        '@tailwindcss/postcss': '4.0.0'
      }
    };
    for (let i = 0; i < 50; i++) {
      mockPkg.dependencies[`dep-${i}`] = '1.0.0';
    }
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(mockPkg));

    const stack = personaMemory.detectProjectStack(tmpDir);
    assert.ok(stack.framework.includes('Next.js'));
    assert.ok(stack.styling.includes('Tailwind CSS v4'));
    assert.ok(stack.dependencies.length <= 15, `Dependencies array should be <= 15 items, got ${stack.dependencies.length}`);
    console.log('✓ Project stack dependency filtering passed');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // 3. Format project context compactness
  const profile = {
    project_name: 'ecommerce-frontend',
    project_path: '/home/user/workspace/ecommerce',
    framework: 'Next.js 15.0',
    styling: 'Tailwind CSS v4 (@theme directives)',
    package_manager: 'pnpm',
    context_summary: 'Enforce strict TypeScript, Geist font, zero emojis, 10 light-mode themes, and pnpm exclusively across all components and API routes.'
  };
  const mems = [
    { memory_type: 'rule', content: 'Always validate forms with Zod and server actions.' },
    { memory_type: 'architecture', content: 'Keep page-level routes in app/ directory with dynamic metadata.' }
  ];

  const formattedNormal = personaMemory.formatProjectContextForPrompt(profile, mems, 2, false);
  const formattedCompact = personaMemory.formatProjectContextForPrompt(profile, mems, 2, true);

  assert.ok(formattedNormal.includes('Persistent Project Context'));
  assert.ok(formattedCompact.includes('Auto-Compacted'));
  assert.ok(formattedCompact.length < formattedNormal.length);
  assert.ok(formattedCompact.length < 350, `Compact block length should be < 350, got ${formattedCompact.length}`);
  console.log('✓ Format project context compactness passed');

  // 4. CLI help flags
  const commandsToTest = [
    ['init', '--help'],
    ['migrate', '--help'],
    ['test', '--help'],
    ['status', '--help'],
    ['savings', '--help'],
    ['doctor', '--help'],
    ['uninstall', '--help'],
    ['version', '--help'],
    ['upgrade', '--help'],
    ['skill', '--help'],
    ['agent', '--help'],
    ['models', '--help'],
    ['data', '--help'],
    ['project', '--help'],
    ['bridge', '--help'],
    ['help']
  ];

  for (const cmdArgs of commandsToTest) {
    const out = execFileSync('node', [CLI_PATH, ...cmdArgs], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    assert.ok(out.length > 20, `Command 'konoha ${cmdArgs.join(' ')}' returned empty output`);
  }
  console.log('✓ CLI help flags passed');

  console.log('\nAll test_commandcode_and_argument_aliases tests passed!');
}

if (require.main === module) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run };
