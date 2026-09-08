#!/usr/bin/env node
'use strict';

/**
 * tests/test_skill_resolution.js — Tests for fuzzy skill resolution and prompt-driven skill auto-loading.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../src/db');
const server = require('../src/server');

async function run() {
  console.log('Running test_skill_resolution tests...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill_res_'));
  const testDbPath = path.join(tmpDir, 'test_skills.db');

  const prevDbPath = db.DB_PATH;
  const prevServerDb = server.DB_PATH;

  db.DB_PATH = testDbPath;
  server.DB_PATH = testDbPath;

  const conn = db.getDb(testDbPath);
  conn.prepare(`
    CREATE TABLE IF NOT EXISTS skills (
      name TEXT PRIMARY KEY,
      skill_name TEXT,
      type TEXT,
      content TEXT
    )
  `).run();

  try {
    // --- 1. Levenshtein basic ---
    assert.strictEqual(server._levenshtein('abc', 'abc'), 0);
    assert.strictEqual(server._levenshtein('abc', 'abd'), 1);
    assert.strictEqual(server._levenshtein('abc', ''), 3);
    assert.strictEqual(server._levenshtein('', 'abc'), 3);
    assert.strictEqual(server._levenshtein('kitten', 'sitting'), 3);
    console.log('✓ Levenshtein basic passed');

    // --- 2. Fuzzy resolve typo in skill name ---
    conn.prepare(`
      INSERT OR REPLACE INTO skills (name, skill_name, type, content)
      VALUES (?, ?, ?, ?)
    `).run(
      'devsecops-engineer-test-typo',
      'devsecops-engineer',
      'skill',
      'Best practices for DevSecOps workflows, Docker, Kubernetes.'
    );

    const resolved = server._fuzzy_resolve_skill('devsecops-enginer', conn);
    assert.strictEqual(resolved, 'devsecops-engineer');
    console.log('✓ Fuzzy resolve typo passed');

    // --- 3. Distant typo returns null ---
    conn.prepare(`
      INSERT OR REPLACE INTO skills (name, skill_name, type, content)
      VALUES (?, ?, ?, ?)
    `).run('alpha-typo-test', 'alpha', 'skill', 'x');

    const resolvedDistant = server._fuzzy_resolve_skill('zxcvbnmlkjhgfdsa', conn);
    assert.strictEqual(resolvedDistant, null);
    console.log('✓ Distant typo returns null passed');

    // --- 4. Prompt autoload tests ---
    conn.prepare('INSERT OR REPLACE INTO skills VALUES (?, ?, ?, ?)').run(
      'docker-best-practices-test', 'docker-best-practices', 'skill',
      'How to write production-grade Dockerfiles, multi-stage builds, layer caching.'
    );
    conn.prepare('INSERT OR REPLACE INTO skills VALUES (?, ?, ?, ?)').run(
      'kubernetes-deployment-test', 'kubernetes-deployment', 'skill',
      'Deployments, services, ingress, helm charts for production clusters.'
    );
    conn.prepare('INSERT OR REPLACE INTO skills VALUES (?, ?, ?, ?)').run(
      'react-frontend-test', 'react-frontend', 'skill',
      'Component patterns, hooks, server components, suspense for React apps.'
    );

    const matchesDocker = server._autoload_skills_from_prompt(
      'Help me optimize my docker build for a smaller image', conn
    );
    assert.ok(matchesDocker.includes('docker-best-practices'), 'Must match docker skill');
    console.log('✓ Autoload picks docker skill passed');

    const matchesK8s = server._autoload_skills_from_prompt(
      'How should I structure helm charts for production deployment?', conn
    );
    assert.ok(matchesK8s.includes('kubernetes-deployment'), 'Must match kubernetes skill');
    console.log('✓ Autoload picks kubernetes skill passed');

    const matchesUnrelated = server._autoload_skills_from_prompt(
      'Tell me about the renaissance painting style', conn
    );
    assert.deepStrictEqual(matchesUnrelated, []);
    console.log('✓ Autoload returns empty for unrelated prompt passed');

    assert.deepStrictEqual(server._autoload_skills_from_prompt('', conn), []);
    assert.deepStrictEqual(server._autoload_skills_from_prompt('hi', conn), []);
    console.log('✓ Autoload empty prompt passed');

    const matchesCapped = server._autoload_skills_from_prompt(
      'docker kubernetes react deployment production image component', conn, 1
    );
    assert.strictEqual(matchesCapped.length, 1);
    console.log('✓ Autoload caps matches passed');

    console.log('\nAll test_skill_resolution tests passed!');
  } finally {
    conn.close();
    db.DB_PATH = prevDbPath;
    server.DB_PATH = prevServerDb;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run };
