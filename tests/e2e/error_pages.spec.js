import { test, expect } from '@playwright/test';
import { loginAndUnlock } from './auth_helper.js';

const BASE_URL = 'http://127.0.0.1:4173';

test.describe('Animated Error Experience & Routing', () => {
  test('404 Page: renders inside app layout with radar animation and readable breadcrumb', async ({ page }) => {
    await loginAndUnlock(page);

    // Navigate to unknown route
    await page.goto(`${BASE_URL}/this-route-does-not-exist`);
    await page.waitForTimeout(500);

    // 1. Header and sidebar stay present (rendered inside app layout)
    await expect(page.locator('#konoha-app-root')).toBeVisible();

    // 2. Breadcrumb displays "Not Found", NEVER raw route segment
    const breadcrumb = page.locator('header .font-extrabold');
    await expect(breadcrumb).toContainText('Not Found');

    // 3. Status 404 tag and title
    await expect(page.locator('text=STATUS 404')).toBeVisible();
    await expect(page.locator('h2', { hasText: 'Page Not Found' })).toBeVisible();

    // 4. Animated SVG radar
    const radar = page.locator('.radar-sweep');
    await expect(radar).toBeVisible();

    // 5. Action buttons
    const dashboardBtn = page.locator('button, a', { hasText: 'Go to Dashboard' });
    await expect(dashboardBtn).toBeVisible();
  });

  test('/skill redirect: navigating to /skill redirects to /skills cleanly', async ({ page }) => {
    await page.goto(`${BASE_URL}/skill`);
    await page.waitForTimeout(800);

    // Verify redirected URL is /skills
    expect(page.url()).toContain('/skills');
  });

  test('Sanitized Copy Error Details button', async ({ page }) => {
    await loginAndUnlock(page);
    await page.goto(`${BASE_URL}/unknown-error-test-path`);
    await page.waitForTimeout(500);

    const copyBtn = page.locator('button', { hasText: 'Copy Details' });
    await expect(copyBtn).toBeVisible();

    // Grant clipboard permissions
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await copyBtn.click();
    await page.waitForTimeout(300);

    // Verify toast feedback
    const toastHost = page.locator('aside[aria-label="Notifications"]');
    await expect(toastHost).toContainText('Sanitized error details copied');

    // Read clipboard content
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    const parsed = JSON.parse(clipboardText);

    expect(parsed.status).toBe(404);
    expect(parsed.path).toBe('/unknown-error-test-path');
    expect(parsed.error_id).toBeTruthy();
    // Invariant: no stack traces, file paths, or credentials in copied details
    expect(parsed.stack).toBeUndefined();
  });

  test('Unknown /api/* route returns structured JSON 404 (never HTML)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/v1/nonexistent-test-route`, {
      headers: { 'User-Agent': 'Konoha-CLI/2.2.0' }
    });
    expect(res.status()).toBe(404);

    const contentType = res.headers()['content-type'] || '';
    expect(contentType).toContain('application/json');

    const json = await res.json();
    expect(json.status).toBe(404);
    expect(json.code).toBe('NOT_FOUND');
    expect(json.error_id).toBeTruthy();
  });
});
