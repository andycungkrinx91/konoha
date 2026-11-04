#!/usr/bin/env node
// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

/**
 * Verifies the docs drift report measures file mtimes against the release cut
 * instead of guessing freshness from version strings in prose, and that the
 * report and tool catalog are exposed over the web API.
 */

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

if (!process.env.KONOHA_AUTH_FILE) {
  const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_auth_'));
  process.env.KONOHA_AUTH_FILE = path.join(authDir, 'web_auth.json');
}

const { collectDocsDrift } = require('../src/docs_freshness');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === 'function') {
      return out.then(
        () => { passed += 1; console.log(`  PASS ${name}`); },
        (e) => { failed += 1; console.log(`  FAIL ${name}: ${e.message}`); }
      );
    }
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`  FAIL ${name}: ${e.message}`);
  }
  return null;
}

function buildFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-drift-'));
  fs.mkdirSync(path.join(root, 'docs', 'SecurityCompliance'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '9.9.9' }));
  fs.writeFileSync(path.join(root, 'README.md'), '# readme\n');
  fs.writeFileSync(path.join(root, 'docs', 'OLD.md'), 'stale prose mentioning v1.2.3\n');
  fs.writeFileSync(path.join(root, 'docs', 'NEW.md'), 'fresh prose\n');
  fs.writeFileSync(path.join(root, 'docs', 'SecurityCompliance', 'AUDIT.md'), 'archived\n');

  const cutMs = Date.now() - 60 * 60 * 1000;
  fs.utimesSync(path.join(root, 'package.json'), new Date(cutMs), new Date(cutMs));
  const older = new Date(cutMs - 24 * 60 * 60 * 1000);
  fs.utimesSync(path.join(root, 'README.md'), older, older);
  fs.utimesSync(path.join(root, 'docs', 'OLD.md'), older, older);
  const newer = new Date(cutMs + 5 * 60 * 1000);
  fs.utimesSync(path.join(root, 'docs', 'NEW.md'), newer, newer);
  return root;
}

console.log('docs freshness report');

test('files older than the release cut are reported as review_pending', () => {
  const root = buildFixture();
  const report = collectDocsDrift({ rootDir: root });
  assert.strictEqual(report.version, '9.9.9');
  assert.ok(report.cutAt, 'cutAt must be measured from package.json');
  assert.strictEqual(report.total, 4);
  const byFile = Object.fromEntries(report.docs.map((d) => [d.file, d.status]));
  assert.strictEqual(byFile['README.md'], 'review_pending');
  assert.strictEqual(byFile['docs/OLD.md'], 'review_pending');
  assert.strictEqual(byFile['docs/NEW.md'], 'current');
  assert.strictEqual(byFile['docs/SecurityCompliance/AUDIT.md'], 'historical');
  fs.rmSync(root, { recursive: true, force: true });
});

test('counts always sum to total and every doc states a reason', () => {
  const root = buildFixture();
  const report = collectDocsDrift({ rootDir: root });
  const sum = Object.values(report.counts).reduce((a, b) => a + b, 0);
  assert.strictEqual(sum, report.total);
  for (const doc of report.docs) {
    assert.ok(typeof doc.reason === 'string' && doc.reason.length > 0, `missing reason for ${doc.file}`);
    assert.ok(doc.modifiedAt, `missing modifiedAt for ${doc.file}`);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('version strings in prose never influence the verdict', () => {
  const root = buildFixture();
  const report = collectDocsDrift({ rootDir: root });
  const oldDoc = report.docs.find((d) => d.file === 'docs/OLD.md');
  assert.strictEqual(oldDoc.status, 'review_pending', 'prose version must not upgrade the verdict');
  fs.rmSync(root, { recursive: true, force: true });
});

test('a missing package.json yields unknown rather than a guessed verdict', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-drift-nopkg-'));
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'X.md'), 'text\n');
  const report = collectDocsDrift({ rootDir: root });
  assert.strictEqual(report.version, null);
  assert.strictEqual(report.cutAt, null);
  assert.strictEqual(report.counts.unknown, report.total);
  assert.strictEqual(report.counts.current + report.counts.review_pending, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('the live repository report is internally consistent', () => {
  const report = collectDocsDrift();
  assert.ok(report.total > 0, 'repository must ship markdown docs');
  const sum = Object.values(report.counts).reduce((a, b) => a + b, 0);
  assert.strictEqual(sum, report.total);
  assert.ok(report.docs.some((d) => d.status === 'historical'), 'archived records must be classified');
});

async function authenticate(base, webToken) {
  const jsonPost = (route, body, cookie) => fetch(base + route, {
    method: 'POST',
    headers: Object.assign(
      { 'Content-Type': 'application/json', 'X-Konoha-Web-Token': webToken },
      cookie ? { Cookie: cookie } : {}
    ),
    body: JSON.stringify(body)
  });
  const cookiesOf = (res) => {
    const raw = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie')];
    return raw.filter(Boolean).map((c) => String(c).split(';')[0]).join('; ');
  };

  const bootstrapPassword = process.env.KONOHA_TEST_PASSWORD || 'konohagakure';
  const login = await jsonPost('/api/v1/auth/login', { password: bootstrapPassword });
  assert.strictEqual(login.status, 200, 'test password must authenticate against the isolated auth store');
  const session = cookiesOf(login);
  const payload = await login.json();
  if (!payload.requires_password_change) return session;

  const rotated = await jsonPost('/api/v1/auth/change-password', {
    current_password: bootstrapPassword,
    new_password: 'Konoha-Docs-Test-2026!'
  }, session);
  assert.strictEqual(rotated.status, 200, 'bootstrap session must be able to rotate its password');
  const relogin = await jsonPost('/api/v1/auth/login', { password: 'Konoha-Docs-Test-2026!' });
  assert.strictEqual(relogin.status, 200, 'rotated password must authenticate');
  return cookiesOf(relogin);
}

async function endpoints() {
  const { createWebServer } = require('../src/web_server');
  const port = 1404 + Math.floor(Math.random() * 200);
  const wrapper = createWebServer({ port });
  await new Promise((resolve) => wrapper.server.listen(port, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${port}`;
  try {
    const cookie = await authenticate(base, wrapper.token);

    for (const route of ['/api/v1/docs/drift', '/api/v1/tools']) {
      const res = await fetch(base + route, { headers: { Cookie: cookie } });
      assert.strictEqual(res.status, 200, `${route} must answer 200`);
      const body = await res.json();
      assert.ok(body && typeof body === 'object', `${route} must return an object`);
      if (route === '/api/v1/docs/drift') {
        assert.ok(Array.isArray(body.docs) && body.docs.length > 0, 'drift report must list documents');
        assert.strictEqual(typeof body.total, 'number');
        assert.ok(body.counts && typeof body.counts.unknown === 'number');
      } else {
        assert.ok(Array.isArray(body.tools) && body.tools.includes('yamanaka'), 'tool catalog must include yamanaka');
        assert.ok(body.count >= 48, 'tool catalog must report the canonical count');
        assert.ok(Array.isArray(body.deprecated), 'deprecated aliases must be listed separately');
      }
    }
  } finally {
    await new Promise((resolve) => wrapper.server.close(resolve));
  }
}

(async () => {
  await test('web API exposes the drift report and the tool catalog', endpoints);
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
