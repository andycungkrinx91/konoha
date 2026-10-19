// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function walkFiles(dir, exts = ['.js', '.json', '.sh', '.py']) {
  const result = [];
  const skipDirs = new Set(['node_modules', '.git', '.svelte-kit', 'build', 'dist', 'coverage', '.cache', 'anthropic-cybersecurity-skills-assets']);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkFiles(full, exts));
    } else if (entry.isFile() && exts.some(ext => entry.name.endsWith(ext))) {
      result.push(full);
    }
  }
  return result;
}

function run() {
  console.log('Running test_no_hardcoded_homedir...');

  // 1. Verify no hardcoded user paths in bin/ and src/
  const targetDirs = [
    path.join(ROOT, 'bin'),
    path.join(ROOT, 'src'),
    path.join(ROOT, 'apps', 'web', 'src')
  ];

  const forbiddenPatterns = [
    /\/home\/(?!user[\b\/]|<user>)[a-zA-Z0-9_-]+/g, // /home/<specific_user> except generic placeholders
    /[cC]:\\Users\\(?!user[\b\\]|<user>)[a-zA-Z0-9_-]+/g, // C:\Users\<specific_user>
    /\/Users\/(?!user[\b\/]|<user>)[a-zA-Z0-9_-]+/g // /Users/<specific_user> (macOS)
  ];

  const violations = [];

  for (const dir of targetDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = walkFiles(dir);
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      for (const pattern of forbiddenPatterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const matchedStr = match[0];
          // Allow generic documentation examples or license/linkedin URLs
          if (matchedStr.includes('andycungkrinx91') && (matchedStr.includes('github') || matchedStr.includes('linkedin') || matchedStr.includes('@gmail'))) {
            continue;
          }
          if (matchedStr.includes('/home/user') || matchedStr.includes('/home/<user>') || matchedStr.includes('andycungkrinx91.konoha-bridge')) {
            continue;
          }
          violations.push({
            file: path.relative(ROOT, file),
            match: matchedStr
          });
        }
      }
    }
  }

  assert.strictEqual(
    violations.length,
    0,
    `Found hardcoded homedir violations:\n${JSON.stringify(violations, null, 2)}`
  );
  console.log('✓ Zero hardcoded user homedirs in bin/, src/, or apps/web/src');

  // 2. Verify bin/lib/paths.js uses os.homedir() dynamically
  const paths = require('../bin/lib/paths');
  assert.strictEqual(typeof paths.HOME, 'string');
  assert.ok(paths.HOME.length > 0);
  assert.strictEqual(paths.KONOHA, path.join(paths.HOME, '.konoha'));
  assert.strictEqual(paths.SKILLS_DB_DIR, path.join(paths.HOME, '.konoha'));
  console.log(`✓ paths.HOME dynamically resolves to: ${paths.HOME}`);
  console.log(`✓ paths.KONOHA dynamically resolves to: ${paths.KONOHA}`);

  // 3. Verify cross-platform path behavior
  // On Linux/Mac: /home/<user>/.konoha or /Users/<user>/.konoha
  // On Windows: C:\Users\<user>\.konoha
  if (process.platform === 'win32') {
    assert.match(paths.KONOHA, /^[a-zA-Z]:\\.*\.konoha$/, 'Windows path must start with drive letter and end with .konoha');
  } else {
    assert.match(paths.KONOHA, /^\/(home|Users|tmp|var|private)\/.*\.konoha$/, 'POSIX path must start with root and end with .konoha');
  }
  console.log('✓ Cross-platform path formatting verified');

  console.log('\nAll test_no_hardcoded_homedir tests passed cleanly!');
}

run();
