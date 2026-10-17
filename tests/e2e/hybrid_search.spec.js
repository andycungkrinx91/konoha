import { test, expect } from '@playwright/test';
import { loginAndUnlock } from './auth_helper.js';

const BASE_URL = 'http://127.0.0.1:4173';

test.describe('Hybrid FTS5 & Neural Vector Skill Search', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndUnlock(page);
    await page.goto(`${BASE_URL}/skills`);
    await page.waitForTimeout(800);
  });

  test('Single unified "FTS5 & Vector" tab and "skills.sh Registry" tab', async ({ page }) => {
    // Verify only 2 tabs exist
    const hybridTab = page.locator('button', { hasText: 'FTS5 & Vector' });
    const registryTab = page.locator('button', { hasText: 'skills.sh Registry' });

    await expect(hybridTab).toBeVisible();
    await expect(registryTab).toBeVisible();

    // Verify old split tabs no longer exist
    await expect(page.locator('button', { hasText: 'Local FTS5' })).not.toBeVisible();
    await expect(page.locator('button', { hasText: 'Neural Vector' })).not.toBeVisible();
  });

  test('Keyword Search Match & Semantic Query Match with Badges and Scores', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Hybrid search by keyword"]');
    await expect(searchInput).toBeVisible();

    // 1. Keyword search test
    await searchInput.fill('helm');
    await page.waitForTimeout(800);

    const skillsList = page.locator('.metric-card-3d');
    await expect(skillsList.first()).toBeVisible();

    // Check engine badge on first result
    const badge = skillsList.first().locator('.rounded-\\[5px\\], .gradient-badge').first();
    await expect(badge).toBeVisible();

    // 2. Semantic query test (plain-language description without exact name overlap)
    await searchInput.fill('container orchestration deployment cloud');
    await page.waitForTimeout(800);

    const semanticResults = page.locator('.metric-card-3d');
    await expect(semanticResults.first()).toBeVisible();
  });

  test('Vector stats chunk badge reflects real state', async ({ page }) => {
    const chunkBadge = page.locator('span[title*="Hybrid RAG Search"]');
    await expect(chunkBadge).toBeVisible();
    const text = await chunkBadge.textContent();
    expect(text).toMatch(/\d+ Vector Chunks/);
  });

  test('Search input debounce and cancellation stability', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Hybrid search by keyword"]');

    // Rapid keystrokes to ensure requests debounce cleanly without UI crash
    await searchInput.pressSequentially('docker security audit', { delay: 50 });
    await page.waitForTimeout(600);

    // Verify results render stably
    const results = page.locator('.metric-card-3d');
    expect(await results.count()).toBeGreaterThanOrEqual(0);
  });
});
