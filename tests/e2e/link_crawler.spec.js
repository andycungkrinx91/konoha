import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';
const BOOTSTRAP_PASS = process.env.KONOHA_BOOTSTRAP_PASSWORD || 'konohagakure';

test.describe('Internal Link & Route Integrity Crawler', () => {
  test('Crawl all navigation links, assert 200/307 status and 0 dead links', async ({ page }) => {
    test.setTimeout(120000);
    // Authenticate
    await page.goto(BASE_URL);
    const input = page.locator('input[type="password"], input[type="text"]').first();
    if (await input.isVisible()) {
      await input.fill(BOOTSTRAP_PASS);
      await page.locator('button[type="submit"]').click();
      await page.waitForTimeout(3200);
    }

    const visited = new Set();
    const deadLinks = [];

    // All standard navigation routes
    const routesToTest = [
      '/',
      '/dashboard',
      '/clients',
      '/bridges',
      '/remote',
      '/savings',
      '/agents',
      '/skills',
      '/persona',
      '/context',
      '/search',
      '/semble',
      '/detector',
      '/tasks',
      '/doctor',
      '/docs',
      '/settings',
      '/skill' // Tests our redirect route
    ];

    for (const r of routesToTest) {
      const targetUrl = `${BASE_URL}${r}`;
      visited.add(targetUrl);

      const response = await page.goto(targetUrl);
      const status = response ? response.status() : 0;

      // Assert valid status (200 OK or 307 redirect)
      if (status >= 400) {
        deadLinks.push({ url: targetUrl, status });
      }

      // Check that page didn't throw an unhandled crash
      const errorText = page.locator('text=STATUS 500');
      expect(await errorText.count()).toBe(0);
    }

    // Crawl all anchor links in current DOM
    const links = await page.locator('a[href^="/"]').evaluateAll((anchors) =>
      anchors.map(a => a.getAttribute('href')).filter(Boolean)
    );

    for (const href of new Set(links)) {
      const fullUrl = `${BASE_URL}${href}`;
      if (visited.has(fullUrl) || href.startsWith('/api/')) continue;
      visited.add(fullUrl);

      const resp = await page.goto(fullUrl);
      const status = resp ? resp.status() : 0;
      if (status >= 400) {
        deadLinks.push({ url: fullUrl, status });
      }
    }

    expect(deadLinks, `Found dead links: ${JSON.stringify(deadLinks)}`).toEqual([]);
  });
});
