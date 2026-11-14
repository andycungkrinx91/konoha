'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

if (process.argv.includes('--child')) {
  const { repairFileToolsSubsystem } = require('../bin/commands/doctor_runtime');
  const { SKILLS_DB_DIR } = require('../bin/lib/paths');

  const records = [];
  let repairs = 0;
  let errors = 0;
  const context = {
    record: (component, status, details) => records.push({ component, status, details }),
    incrementRepairs: () => { repairs += 1; },
    markError: () => { errors += 1; }
  };

  repairFileToolsSubsystem(context);

  const grammarsDir = path.join(SKILLS_DB_DIR, 'assets', 'grammars');
  assert.strictEqual(errors, 0, `Expected 0 errors from repairFileToolsSubsystem, got ${errors}`);
  assert.ok(repairs >= 1, `Expected repairs >= 1 when restoring missing grammars, got ${repairs}`);
  assert.ok(fs.existsSync(path.join(grammarsDir, 'grammars.lock.json')), 'grammars.lock.json must be restored');
  assert.ok(
    fs.existsSync(path.join(grammarsDir, 'tree-sitter-javascript.wasm')),
    'tree-sitter-javascript.wasm must be restored'
  );
  const grammarRecord = records.find((r) => r.component.includes('assets/grammars'));
  assert.ok(grammarRecord, 'Expected a diagnostic record for assets/grammars');
  assert.strictEqual(grammarRecord.status, 'REPAIRED', `Expected REPAIRED status, got ${grammarRecord.status}`);

  // Second run must report HEALTHY with 0 additional repairs
  const secondRecords = [];
  let secondRepairs = 0;
  repairFileToolsSubsystem({
    record: (component, status, details) => secondRecords.push({ component, status, details }),
    incrementRepairs: () => { secondRepairs += 1; },
    markError: () => { errors += 1; }
  });
  const secondGrammarRecord = secondRecords.find((r) => r.component.includes('assets/grammars'));
  assert.strictEqual(secondRepairs, 0, `Expected 0 repairs on healthy second run, got ${secondRepairs}`);
  assert.strictEqual(secondGrammarRecord.status, 'HEALTHY', 'Second run must report HEALTHY for assets/grammars');

  // Partial removal (single deleted WASM) must also repair cleanly
  fs.unlinkSync(path.join(grammarsDir, 'tree-sitter-python.wasm'));
  const thirdRecords = [];
  let thirdRepairs = 0;
  repairFileToolsSubsystem({
    record: (component, status, details) => thirdRecords.push({ component, status, details }),
    incrementRepairs: () => { thirdRepairs += 1; },
    markError: () => { errors += 1; }
  });
  const thirdGrammarRecord = thirdRecords.find((r) => r.component.includes('assets/grammars'));
  assert.ok(
    fs.existsSync(path.join(grammarsDir, 'tree-sitter-python.wasm')),
    'Deleted tree-sitter-python.wasm must be restored'
  );
  assert.strictEqual(thirdGrammarRecord.status, 'REPAIRED', 'Partial deletion must report REPAIRED');
  assert.ok(thirdRepairs >= 1, 'Partial deletion must increment repairs');
  process.exit(0);
}

function main() {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-doctor-grammar-'));
  try {
    const grammarsDir = path.join(tmpHome, '.konoha', 'assets', 'grammars');
    assert.strictEqual(fs.existsSync(grammarsDir), false, 'Precondition: grammarsDir absent in fresh temp home');

    execFileSync(process.execPath, [__filename, '--child'], {
      cwd: REPO_ROOT,
      env: { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome },
      stdio: 'inherit'
    });
    console.log('✓ test_doctor_grammar_repair: All assertions passed.');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
}

main();
