import { test, expect } from '@playwright/test';
import fs from 'fs';

test.describe('Konoha Web UI End-to-End Suite', () => {
  test.beforeEach(async () => {
    try {
      if (fs.existsSync('/tmp/konoha_test_web_auth.json')) {
        fs.unlinkSync('/tmp/konoha_test_web_auth.json');
      }
    } catch (_) {}
  });

  test('Health check and CSRF endpoints respond cleanly', async ({ request }) => {
    const healthRes = await request.get('/api/v1/health');
    expect(healthRes.status()).toBe(200);
    const healthData = await healthRes.json();
    expect(healthData.status).toBe('healthy');

    const csrfRes = await request.get('/api/v1/csrf');
    expect(csrfRes.status()).toBe(200);
    const csrfData = await csrfRes.json();
    expect(typeof csrfData.token).toBe('string');
    expect(csrfData.token.length).toBeGreaterThan(10);
  });

  test('Authenticate with bootstrap credential konohagakure', async ({ request }) => {
    const csrfRes = await request.get('/api/v1/csrf');
    const { token } = await csrfRes.json();

    const loginRes = await request.post('/api/v1/auth/login', {
      headers: { 'x-konoha-web-token': token },
      data: { password: 'konohagakure' }
    });
    expect(loginRes.status()).toBe(200);
    const loginData = await loginRes.json();
    expect(loginData.ok).toBe(true);
    expect(loginData.sessionId).toBeTruthy();
    expect(loginData.is_bootstrap).toBe(true);
  });

  test('Documentation endpoint returns all 26 authoritative docs via type=documentation', async ({ request }) => {
    const csrfRes = await request.get('/api/v1/csrf');
    const { token } = await csrfRes.json();

    const loginRes = await request.post('/api/v1/auth/login', {
      headers: { 'x-konoha-web-token': token },
      data: { password: 'konohagakure' }
    });
    const loginData = await loginRes.json();
    const sessionId = loginData.sessionId;

    await request.post('/api/v1/auth/change-password', {
      headers: {
        'x-konoha-web-token': token,
        'Cookie': `konoha_session=${sessionId}`
      },
      data: {
        current_password: 'konohagakure',
        new_password: 'secure-shinobi-2026!'
      }
    });

    const reloginRes = await request.post('/api/v1/auth/login', {
      headers: { 'x-konoha-web-token': token },
      data: { password: 'secure-shinobi-2026!' }
    });
    const reloginData = await reloginRes.json();
    const newSessionId = reloginData.sessionId;

    const docsRes = await request.get('/api/v1/skills?type=documentation&limit=100', {
      headers: {
        'x-konoha-web-token': token,
        'Cookie': `konoha_session=${newSessionId}`
      }
    });
    expect(docsRes.status()).toBe(200);
    const docsData = await docsRes.json();
    expect(Array.isArray(docsData)).toBe(true);
    expect(docsData.length).toBe(26);

    const docNames = docsData.map(d => d.name);
    expect(docNames).toContain('doc:architecture');
    expect(docNames).toContain('doc:security');
    expect(docNames).toContain('doc:qa-test-checklist');
  });

  test('Web UI frontend page loads and serves app HTML cleanly', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Konoha/i);
    const bodyText = await page.textContent('body');
    expect(bodyText.length).toBeGreaterThan(50);
  });
});
