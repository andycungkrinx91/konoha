import { test, expect } from '@playwright/test';
import fs from 'fs';

// Defect guard for 2.2.20: while the server reports `is_bootstrap: true` the login
// page must land on the two-field set-new-password form and must never render the
// default bootstrap value. Runs against the local suite server by default, and can
// be pointed at a sandbox install with KONOHA_E2E_BASE_URL / KONOHA_AUTH_FILE.
const BASE = process.env.KONOHA_E2E_BASE_URL || 'http://127.0.0.1:4173';
const AUTH_FILE = process.env.KONOHA_AUTH_FILE || '/tmp/konoha_test_web_auth.json';
const BOOTSTRAP_PASSWORD = process.env.KONOHA_BOOTSTRAP_PASSWORD || 'konohagakure';
const CUSTOM_PASSWORD = 'secure-shinobi-2026!';

test.describe('First-run login redirect', () => {
  test.beforeEach(() => {
    try {
      if (fs.existsSync(AUTH_FILE)) fs.unlinkSync(AUTH_FILE);
    } catch (_) { /* fresh bootstrap is also valid */ }
  });

  test('bootstrap active: setup form is the landing view, value never rendered, new password works, default fails', async ({ page, request }) => {
    test.setTimeout(90000);

    const before = await request.get(`${BASE}/api/v1/auth/status`);
    expect((await before.json()).is_bootstrap).toBe(true);

    await page.goto(`${BASE}/`);
    await expect(page.getByTestId('first-run-setup-form')).toBeVisible();
    await expect(page.locator('#setup-new-password')).toBeVisible();
    await expect(page.locator('#login-password')).toHaveCount(0);
    await expect(page.getByTestId('first-run-login-tab')).toHaveCount(0);
    await expect(page.getByTestId('first-run-setup-toggle')).toHaveCount(0);

    const html = (await page.content()).toLowerCase();
    expect(html).not.toContain(BOOTSTRAP_PASSWORD.toLowerCase());
    expect(html).not.toContain('default passphrase');
    await page.screenshot({
      path: process.env.KONOHA_LOGIN_SCREENSHOT || '/tmp/konoha-login-first-load.png',
      fullPage: true
    });

    await page.fill('#setup-new-password', CUSTOM_PASSWORD);
    await page.fill('#setup-confirm-password', CUSTOM_PASSWORD);
    await page.getByRole('button', { name: 'Initialize Password' }).click();
    await expect(page.locator('#login-password')).toBeVisible({ timeout: 15000 });

    const after = await request.get(`${BASE}/api/v1/auth/status`);
    expect((await after.json()).is_bootstrap).toBe(false);

    const { token } = await (await request.get(`${BASE}/api/v1/csrf`)).json();
    const oldLogin = await request.post(`${BASE}/api/v1/auth/login`, {
      headers: { 'x-konoha-web-token': token },
      data: { password: BOOTSTRAP_PASSWORD }
    });
    expect(oldLogin.status()).toBe(401);

    await page.fill('#login-password', CUSTOM_PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByText('Mission Control Dashboard')).toBeVisible({ timeout: 20000 });
  });
});