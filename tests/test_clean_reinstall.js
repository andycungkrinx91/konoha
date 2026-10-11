#!/usr/bin/env node
'use strict';

/**
 * tests/test_clean_reinstall.js
 * Verifies clean reinstallation mechanics and runtime directory sanitization:
 * 1. Stale backup files (*.bak, konoha.db.bak-*, skills.db.bak-*) are purged
 * 2. Legacy SQLite databases (skills.db*) are purged
 * 3. Legacy Python scripts in root (*.py, *.pyc, __pycache__) are purged
 * 4. Stale PID and lock files (*.pid, package-lock.json) are purged
 * 5. Dead caches (*.log, transcript_cache.json) and tmp/ scratch files are purged
 * 6. Root-level .vsix and obsolete cli.js are purged
 * 7. Orphaned root .js modules not present in src/ are purged
 * 8. Critical assets (konoha.db, transformers_cache, node_modules, vendor, searxng, web_token) are strictly preserved
 * 9. Database WAL truncation and VACUUM maintenance execute safely
 * 10. Safety guards reject unsafe directory targets (root, HOME, srcDir)
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { cleanKonohaRuntimeDir, mirrorSkillsDirectory, syncCursorSkillsFromAgents } = require('../src/deploy_utils');
const { SRC_DIR } = require('../bin/lib/paths');

function runTest() {
  console.log('\n--- Testing Clean Reinstallation & Runtime Directory Sanitization ---');

  const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-clean-test-'));
  const mockKonoha = path.join(sandboxDir, '.konoha');
  fs.mkdirSync(mockKonoha, { recursive: true });

  try {
    // 1. Populate preserved files and directories
    const preservedDirs = [
      path.join(mockKonoha, 'transformers_cache', 'models--xenova'),
      path.join(mockKonoha, 'node_modules', '@bufbuild', 'protobuf'),
      path.join(mockKonoha, 'vendor', 'vector-ext'),
      path.join(mockKonoha, 'searxng', 'config'),
      path.join(mockKonoha, 'assets', 'models'),
      path.join(mockKonoha, 'tmp', 'scratch-task-456'),
    ];
    preservedDirs.forEach(d => fs.mkdirSync(d, { recursive: true }));

    const preservedFiles = [
      path.join(mockKonoha, 'package.json'),
      path.join(mockKonoha, 'pnpm-lock.yaml'),
      path.join(mockKonoha, 'web_token'),
      path.join(mockKonoha, 'bridges.json'),
      path.join(mockKonoha, 'konoha-bridge.json'),
      path.join(mockKonoha, '.python_cmd'),
      path.join(mockKonoha, '.node_exec_path'),
      path.join(mockKonoha, '.deploy-fingerprint'),
      path.join(mockKonoha, 'transformers_cache', 'models--xenova', 'weight.bin'),
      path.join(mockKonoha, 'node_modules', '@bufbuild', 'protobuf', 'index.js'),
    ];
    preservedFiles.forEach(f => fs.writeFileSync(f, 'mock preserved content\n', 'utf8'));

    // Create a real SQLite database to verify vacuum / WAL truncation
    const dbPath = path.join(mockKonoha, 'konoha.db');
    const Database = require('../src/sqlite_driver');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE test_data (id INTEGER PRIMARY KEY, note TEXT);');
    db.exec("INSERT INTO test_data (note) VALUES ('active-user-agent-data');");
    db.close();

    // 2. Populate stale items that MUST be purged
    const staleFiles = [
      path.join(mockKonoha, 'konoha.db.bak-piaudit-20260910'),
      path.join(mockKonoha, 'konoha.db.bak-savings-fix-20260911'),
      path.join(mockKonoha, 'skills.db.bak-old-archive'),
      path.join(mockKonoha, 'arbitrary.bak'),
      path.join(mockKonoha, 'skills.db'),
      path.join(mockKonoha, 'skills.db-wal'),
      path.join(mockKonoha, 'skills.db-shm'),
      path.join(mockKonoha, 'db_agents.py'),
      path.join(mockKonoha, 'tools_savings_logger.py'),
      path.join(mockKonoha, 'yaml_parser.py'),
      path.join(mockKonoha, 'bridge.pid'),
      path.join(mockKonoha, 'ui.pid'),
      path.join(mockKonoha, 'package-lock.json'),
      path.join(mockKonoha, 'transcript_cache.json'),
      path.join(mockKonoha, 'debug.log'),
      path.join(mockKonoha, 'konoha-bridge-1.5.0.vsix'),
      path.join(mockKonoha, 'cli.js'),
      path.join(mockKonoha, 'hook-wrapper'),
      path.join(mockKonoha, 'orphaned_legacy_module_xyz.js'),
      path.join(mockKonoha, 'tmp', 'scratch-task-456', 'abandoned_output.txt'),
    ];
    staleFiles.forEach(f => fs.writeFileSync(f, 'stale content to reclaim space\n', 'utf8'));

    // Add stale junk directory
    const pycacheDir = path.join(mockKonoha, '__pycache__');
    fs.mkdirSync(pycacheDir, { recursive: true });
    fs.writeFileSync(path.join(pycacheDir, 'dead.pyc'), 'binary cache', 'utf8');

    // 3. Execute cleanKonohaRuntimeDir
    const cleanResult = cleanKonohaRuntimeDir({
      targetDir: mockKonoha,
      srcDir: SRC_DIR,
      silent: true,
      vacuumDatabase: true,
    });

    console.log(`  Purged ${cleanResult.purgedFiles} stale files/directories, reclaimed ${cleanResult.reclaimedBytes} bytes`);

    assert.strictEqual(cleanResult.errors.length, 0, `Expected 0 errors, got: ${cleanResult.errors.join(', ')}`);
    assert.ok(cleanResult.purgedFiles >= staleFiles.length, `Expected at least ${staleFiles.length} purged files, got ${cleanResult.purgedFiles}`);
    assert.ok(cleanResult.reclaimedBytes > 0, 'Reclaimed bytes must be greater than 0');

    // 4. Verify stale files are gone
    for (const file of staleFiles) {
      assert.strictEqual(fs.existsSync(file), false, `Stale file must be purged: ${file}`);
    }
    assert.strictEqual(fs.existsSync(pycacheDir), false, '__pycache__ must be purged');

    // 5. Verify preserved items remain intact
    for (const file of preservedFiles) {
      assert.strictEqual(fs.existsSync(file), true, `Preserved file must exist: ${file}`);
    }
    assert.strictEqual(fs.existsSync(dbPath), true, 'konoha.db must remain intact');
    assert.strictEqual(fs.existsSync(path.join(mockKonoha, 'tmp')), true, 'tmp/ directory must remain intact');

    // Verify konoha.db is still valid and uncorrupted
    const checkDb = new Database(dbPath);
    const row = checkDb.prepare('SELECT note FROM test_data WHERE id = 1').get();
    checkDb.close();
    assert.strictEqual(row && row.note, 'active-user-agent-data', 'Database contents must be preserved without data loss');

    // 6. Verify idempotency: running a second time should purge 0 items
    const secondPass = cleanKonohaRuntimeDir({
      targetDir: mockKonoha,
      srcDir: SRC_DIR,
      silent: true,
      vacuumDatabase: false,
    });
    assert.strictEqual(secondPass.purgedFiles, 0, 'Second cleaning pass must report 0 purged items');

    // 7. Verify safety guards
    assert.throws(
      () => cleanKonohaRuntimeDir({ targetDir: '/' }),
      /Refusing to clean unsafe directory/,
      'Must reject root directory'
    );
    assert.throws(
      () => cleanKonohaRuntimeDir({ targetDir: os.homedir() }),
      /Refusing to clean unsafe directory/,
      'Must reject user HOME directory'
    );
    assert.throws(
      () => cleanKonohaRuntimeDir({ targetDir: SRC_DIR, srcDir: SRC_DIR }),
      /Refusing to clean source directory/,
      'Must reject targetDir matching srcDir'
    );

    console.log('  ✓ Clean reinstallation safely purged stale files and preserved critical assets');
  } finally {
    try {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

function testPristineReinstallContract() {
  console.log('\n--- Testing Pristine Reinstallation Contract (Decision D2) ---');
  const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-pristine-reinstall-test-'));
  const mockKonoha = path.join(sandboxDir, '.konoha');
  fs.mkdirSync(mockKonoha, { recursive: true });

  try {
    // 1. Initial clean pass on runtime directory
    cleanKonohaRuntimeDir({
      targetDir: mockKonoha,
      srcDir: SRC_DIR,
      silent: true,
      vacuumDatabase: false,
    });

    // 2. Simulate pristine installation / runtime deployment in sandbox
    fs.writeFileSync(path.join(mockKonoha, 'server.js'), '// canonical server\n', 'utf8');
    fs.writeFileSync(path.join(mockKonoha, 'package.json'), '{"name":"konoha"}\n', 'utf8');
    fs.mkdirSync(path.join(mockKonoha, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(mockKonoha, 'bin', 'cli.js'), '#!/usr/bin/env node\n', 'utf8');

    // Invoke skill mirror functions to assert they remain strict no-ops
    const mirrorRes = mirrorSkillsDirectory(path.join(SRC_DIR, 'templates', 'skills'), path.join(mockKonoha, 'skills_mirror'));
    assert.strictEqual(mirrorRes, 0, 'mirrorSkillsDirectory must be a no-op returning 0');
    const syncRes = syncCursorSkillsFromAgents({
      projectRoot: sandboxDir,
      deployProject: true,
      silent: true,
    });
    assert.strictEqual(syncRes, 0, 'syncCursorSkillsFromAgents must be a no-op returning 0');

    // 3. Verify that pristine reinstallation strictly forbids legacy D2 artifacts
    const forbiddenLegacyArtifacts = [
      // Old separate agent and skill directories
      path.join(mockKonoha, 'agents'),
      path.join(mockKonoha, 'skills'),
      // Legacy filesystem skill mirrors
      path.join(mockKonoha, 'skills_mirror'),
      path.join(mockKonoha, '.mirror-test'),
      path.join(sandboxDir, '.cursor', 'skills'),
      path.join(sandboxDir, '.claude', 'skills'),
      // Legacy separate SQLite databases
      path.join(mockKonoha, 'skills.db'),
      path.join(mockKonoha, 'skills.db-wal'),
      path.join(mockKonoha, 'skills.db-shm'),
      // Legacy Python scripts in root
      path.join(mockKonoha, 'server.py'),
      path.join(mockKonoha, 'vector_search.py'),
      path.join(mockKonoha, 'tools_savings_logger.py'),
      path.join(mockKonoha, 'db_agents.py'),
      path.join(mockKonoha, 'yaml_parser.py'),
      // Legacy hooks and wrappers
      path.join(mockKonoha, 'hook-wrapper'),
      path.join(mockKonoha, 'konoha-subagent-hook'),
      // Stale backup files
      path.join(mockKonoha, 'konoha.db.bak'),
      path.join(mockKonoha, 'skills.db.bak'),
    ];

    for (const artifact of forbiddenLegacyArtifacts) {
      assert.strictEqual(
        fs.existsSync(artifact),
        false,
        `Pristine reinstallation must NOT recreate legacy D2 artifact: ${path.relative(sandboxDir, artifact)}`
      );
    }

    // 4. Verify that if any legacy artifact is reintroduced, cleanKonohaRuntimeDir purges it
    fs.mkdirSync(path.join(mockKonoha, '__pycache__'), { recursive: true });
    fs.writeFileSync(path.join(mockKonoha, 'skills.db'), 'stale db', 'utf8');
    fs.writeFileSync(path.join(mockKonoha, 'server.py'), '# stale python', 'utf8');
    fs.writeFileSync(path.join(mockKonoha, 'konoha.db.bak-test'), 'backup', 'utf8');

    const cleanRes = cleanKonohaRuntimeDir({
      targetDir: mockKonoha,
      srcDir: SRC_DIR,
      silent: true,
      vacuumDatabase: false,
    });

    assert.ok(cleanRes.purgedFiles >= 4, 'Cleaning pass must purge reintroduced legacy artifacts');
    assert.strictEqual(fs.existsSync(path.join(mockKonoha, 'skills.db')), false);
    assert.strictEqual(fs.existsSync(path.join(mockKonoha, 'server.py')), false);
    assert.strictEqual(fs.existsSync(path.join(mockKonoha, 'konoha.db.bak-test')), false);

    console.log('  ✓ Pristine reinstallation contract verified: zero legacy D2 artifacts recreated');
  } finally {
    try {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

runTest();
testPristineReinstallContract();
console.log('All clean reinstall tests passed.\n');
