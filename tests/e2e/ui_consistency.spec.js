import { test, expect } from '@playwright/test';
import { loginAndUnlock } from './auth_helper.js';

const STANDARD_ROUTES = [
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
  '/settings'
];

test.describe('UI Consistency: Width, PageHero Shell & Form Fields', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndUnlock(page);
  });

  test('All standard console pages share authoritative max-width and center alignment', async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 1920, height: 1080 });

    for (const route of STANDARD_ROUTES) {
      await page.goto(`http://127.0.0.1:4173${route}`);
      await page.waitForTimeout(300);

      const metrics = await page.evaluate(() => {
        const container = document.querySelector('.console-content-container');
        if (!container) return null;
        const rect = container.getBoundingClientRect();
        const style = window.getComputedStyle(container);
        return {
          width: Math.round(rect.width),
          left: Math.round(rect.left),
          maxWidth: style.maxWidth
        };
      });

      expect(metrics, `Route ${route} must have .console-content-container`).not.toBeNull();
      expect(metrics.width, `Route ${route} container width`).toBe(1280);
      expect(metrics.maxWidth, `Route ${route} max-width`).toBe('1280px');
      expect(metrics.left, `Route ${route} container left offset`).toBe(448);
    }
  });

  test('/dashboard and /docs opt out of width constraint and retain wide layouts', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });

    // Dashboard
    await page.goto('http://127.0.0.1:4173/dashboard');
    await page.waitForTimeout(400);
    const dashMetrics = await page.evaluate(() => {
      const cc = document.querySelector('.console-content-container');
      const main = document.querySelector('main');
      const inner = main?.querySelector('div.w-full');
      return {
        hasConsoleContainer: !!cc,
        innerRectWidth: inner ? Math.round(inner.getBoundingClientRect().width) : null
      };
    });
    expect(dashMetrics.hasConsoleContainer).toBe(false);
    expect(dashMetrics.innerRectWidth).toBeGreaterThanOrEqual(1600);

    // Docs
    await page.goto('http://127.0.0.1:4173/docs');
    await page.waitForTimeout(400);
    const docsMetrics = await page.evaluate(() => {
      const cc = document.querySelector('.console-content-container');
      const hero = document.querySelector('.glass-card-3d');
      const aside = document.querySelector('aside');
      return {
        hasConsoleContainer: !!cc,
        hasHero: !!hero,
        heroRadius: hero ? window.getComputedStyle(hero).borderRadius : null,
        hasAside: !!aside
      };
    });
    expect(docsMetrics.hasConsoleContainer).toBe(false);
    expect(docsMetrics.hasHero).toBe(true);
    expect(docsMetrics.heroRadius).toBe('5px');
    expect(docsMetrics.hasAside).toBe(true);
  });

  test('Standard routes render unified PageHero shell with 5px radius', async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width: 1920, height: 1080 });

    for (const route of STANDARD_ROUTES) {
      await page.goto(`http://127.0.0.1:4173${route}`);
      await page.waitForTimeout(300);

      const heroInfo = await page.evaluate(() => {
        const hero = document.querySelector('.glass-card-3d');
        if (!hero) return null;
        const style = window.getComputedStyle(hero);
        return {
          borderRadius: style.borderRadius,
          borderStyle: style.borderStyle,
          borderWidth: style.borderWidth
        };
      });

      expect(heroInfo, `Route ${route} must render PageHero with .glass-card-3d`).not.toBeNull();
      expect(heroInfo.borderRadius, `Route ${route} hero border-radius`).toBe('5px');
      expect(heroInfo.borderStyle).toBe('solid');
      expect(heroInfo.borderWidth).toBe('1px');
    }
  });

  test('Post-login form fields apply login-field-effect with 3px radius', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });

    // Settings password fields
    await page.goto('http://127.0.0.1:4173/settings');
    await page.waitForTimeout(300);
    const settingsInputs = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input[type="password"]'));
      return inputs.map(i => {
        const s = window.getComputedStyle(i);
        return {
          hasEffect: i.classList.contains('login-field-effect'),
          radius: s.borderRadius
        };
      });
    });
    expect(settingsInputs.length).toBeGreaterThanOrEqual(3);
    for (const inp of settingsInputs) {
      expect(inp.hasEffect).toBe(true);
      expect(inp.radius).toBe('3px');
    }

    // Remote access fields
    await page.goto('http://127.0.0.1:4173/remote');
    await page.waitForTimeout(300);
    const remoteFields = await page.evaluate(() => {
      const tokenInput = document.querySelector('#tg-bot-token');
      const chatInput = document.querySelector('#tg-chat-id');
      return {
        tokenEffect: tokenInput?.classList.contains('login-field-effect'),
        tokenRadius: tokenInput ? window.getComputedStyle(tokenInput).borderRadius : null,
        chatEffect: chatInput?.classList.contains('login-field-effect'),
        chatRadius: chatInput ? window.getComputedStyle(chatInput).borderRadius : null
      };
    });
    expect(remoteFields.tokenEffect).toBe(true);
    expect(remoteFields.tokenRadius).toBe('3px');
    expect(remoteFields.chatEffect).toBe(true);
    expect(remoteFields.chatRadius).toBe('3px');
  });

  test('Responsive viewports do not cause document horizontal overflow', async ({ page }) => {
    test.setTimeout(120000);
    const viewports = [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 }
    ];

    for (const vp of viewports) {
      await page.setViewportSize(vp);
      for (const route of ['/remote', '/search', '/settings', '/dashboard', '/docs']) {
        await page.goto(`http://127.0.0.1:4173${route}`);
        await page.waitForTimeout(250);

        const overflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth;
        });

        expect(overflow, `Route ${route} at ${vp.width}x${vp.height} must not have document horizontal overflow`).toBe(false);
      }
    }
  });

  test('Card style consistency: /settings, /search, /tasks, and /persona render metric-card-3d with 5px radius', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });

    for (const route of ['/settings', '/search', '/tasks', '/persona']) {
      await page.goto(`http://127.0.0.1:4173${route}`);
      await page.waitForTimeout(400);

      const checkCards = async (label) => {
        const cards = await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll('.metric-card-3d'));
          return els.map(el => {
            const s = window.getComputedStyle(el);
            return {
              borderRadius: s.borderRadius,
              borderStyle: s.borderStyle,
              borderWidth: s.borderWidth
            };
          });
        });

        expect(cards.length, `Route ${route} (${label}) must have at least one .metric-card-3d`).toBeGreaterThanOrEqual(1);
        for (const card of cards) {
          expect(card.borderRadius, `Route ${route} (${label}) card radius`).toBe('5px');
          expect(card.borderStyle).toBe('solid');
        }
      };

      await checkCards('default view');

      if (route === '/persona') {
        const soulTab = page.getByRole('button', { name: "Ninja's Soul" });
        if (await soulTab.isVisible()) {
          await soulTab.click();
          await page.waitForTimeout(400);
          await checkCards("Ninja's Soul tab");
        }
      }
    }
  });

  test('Search multi-source flow: returns blended citations with distinct badges and responds to source filters', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('http://127.0.0.1:4173/search');
    await page.waitForTimeout(400);

    // Enter query and search in All Sources mode
    const searchInput = page.locator('input[type="text"]');
    await searchInput.fill('SvelteKit');
    await page.locator('button[type="submit"]').click();

    // Await results
    await expect(page.getByText('citations')).toBeVisible({ timeout: 25000 });
    const badges = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('.metric-card-3d span'));
      return b.map(el => el.textContent.trim()).filter(t => t.includes('DuckDuckGo') || t.includes('Wikipedia') || t.includes('Skills') || t.includes('SearXNG'));
    });
    expect(badges.length).toBeGreaterThanOrEqual(2);

    // Switch to Wikipedia source filter
    await page.getByRole('button', { name: 'Wikipedia' }).click();
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('citations')).toBeVisible({ timeout: 25000 });
    const wikiBadges = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('.metric-card-3d span'));
      return b.map(el => el.textContent.trim()).filter(t => t === 'Wikipedia');
    });
    expect(wikiBadges.length).toBeGreaterThanOrEqual(1);
  });
});
