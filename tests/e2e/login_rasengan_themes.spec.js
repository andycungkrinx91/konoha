import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const THEMES = [
  'chidori',
  'byakugan',
  'konoha-leaf',
  'rasengan',
  'sharingan',
  'hokage-gold',
  'anbu-shadow',
  'sage-mode',
  'sound-village',
  'akatsuki'
];

function calculateContrastRatio(rgb1, rgb2) {
  function getLuminance(r, g, b) {
    const a = [r, g, b].map(v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
  }
  const l1 = getLuminance(rgb1[0], rgb1[1], rgb1[2]);
  const l2 = getLuminance(rgb2[0], rgb2[1], rgb2[2]);
  const brightest = Math.max(l1, l2);
  const darkest = Math.min(l1, l2);
  return (brightest + 0.05) / (darkest + 0.05);
}

test.describe("Login Page & Theme Switch Rasengan End-to-End Verification", () => {
  test.setTimeout(90000);

  test.beforeEach(async () => {
    const authFile = process.env.KONOHA_AUTH_FILE || '/tmp/konoha_test_web_auth.json';
    if (fs.existsSync(authFile)) {
      try { fs.unlinkSync(authFile); } catch (_) {}
    }
  });

  test("All 10 themes in Light and Dark mode on Login Page: clean white background, contrast, palette wiring, 20 screenshots", async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.goto("http://127.0.0.1:4173/");
    await expect(page.getByRole("heading", { name: "KONOHA CONSOLE" })).toBeVisible();

    const screenshotDir = path.resolve(process.cwd(), 'tests/e2e/screenshots');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    for (const themeId of THEMES) {
      for (const mode of ['light', 'dark']) {
        // Apply theme and mode live via themeState
        await page.evaluate(({ t, m }) => {
          localStorage.setItem('konoha-theme', t);
          localStorage.setItem('konoha-appearance-mode', m);
          // Apply theme directly on document
          document.documentElement.setAttribute('data-mode', m);
          // Trigger theme picker modal selection or dispatch custom event
          window.dispatchEvent(new CustomEvent('konoha-theme-apply', { detail: { theme: t, mode: m } }));
        }, { t: themeId, m: mode });

        // Select via modal if needed or use floating switcher
        await page.locator("button[aria-label='Toggle Theme Selection Modal']").click();
        await expect(page.locator("#konoha-theme-picker")).toBeVisible();
        await page.locator(`button[data-theme-id="${themeId}"]`).click();
        await expect(page.locator("#konoha-theme-picker")).not.toBeVisible();

        // Switch to target mode if different
        const currentMode = await page.evaluate(() => document.documentElement.getAttribute('data-mode'));
        if (currentMode !== mode) {
          const modeBtn = page.locator("button[aria-label$='appearance mode']");
          await modeBtn.click();
          await page.waitForTimeout(150);
        }

        await page.waitForTimeout(100);

        // Verify mode attribute
        const currentDataMode = await page.evaluate(() => document.documentElement.getAttribute('data-mode'));
        expect(currentDataMode).toBe(mode);

        // 1. Verify Light Mode clean white background
        if (mode === 'light') {
          const bgEvaluation = await page.evaluate(() => {
            const container = document.querySelector('#shared-rasengan-bg-root') || document.querySelector('div.relative.min-h-screen');
            const style = window.getComputedStyle(container);
            const docStyle = window.getComputedStyle(document.documentElement);
            return {
              containerBg: style.backgroundColor,
              bgLoginToken: docStyle.getPropertyValue('--bg-login').trim()
            };
          });

          // Must be clean white (rgb(255, 255, 255))
          expect(bgEvaluation.containerBg).toBe('rgb(255, 255, 255)');
          expect(bgEvaluation.bgLoginToken).toBe('#ffffff');
        }

        // 2. Verify dynamic rasengan tokens exist and are populated
        const rasenganTokens = await page.evaluate(() => {
          const docStyle = window.getComputedStyle(document.documentElement);
          return [
            docStyle.getPropertyValue('--rasengan-1').trim(),
            docStyle.getPropertyValue('--rasengan-2').trim(),
            docStyle.getPropertyValue('--rasengan-3').trim(),
            docStyle.getPropertyValue('--rasengan-4').trim()
          ];
        });
        expect(rasenganTokens[0].length).toBeGreaterThan(0);
        expect(rasenganTokens[1].length).toBeGreaterThan(0);
        expect(rasenganTokens[2].length).toBeGreaterThan(0);
        expect(rasenganTokens[3].length).toBeGreaterThan(0);

        // 3. Verify card elements contrast
        const contrastResults = await page.evaluate(() => {
          function parseRgb(str) {
            const match = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
            if (!match) return [0, 0, 0];
            const r = Number(match[1]), g = Number(match[2]), b = Number(match[3]);
            const a = match[4] !== undefined ? Number(match[4]) : 1;
            const isDark = document.documentElement.getAttribute('data-mode') === 'dark';
            const base = isDark ? 20 : 255;
            return [
              Math.round(r * a + base * (1 - a)),
              Math.round(g * a + base * (1 - a)),
              Math.round(b * a + base * (1 - a))
            ];
          }

          const card = document.querySelector('div.relative.rounded-\\[6px\\]');
          const title = document.querySelector('h1');
          const subtitle = document.querySelector('header p');
          const label = document.querySelector('label[for="login-password"]');
          const input = document.querySelector('#login-password');

          const cardBg = parseRgb(window.getComputedStyle(card).backgroundColor);
          const titleColor = parseRgb(window.getComputedStyle(title).color);
          const subtitleColor = parseRgb(window.getComputedStyle(subtitle).color);
          const labelColor = parseRgb(window.getComputedStyle(label).color);
          const inputColor = parseRgb(window.getComputedStyle(input).color);
          const inputBg = parseRgb(window.getComputedStyle(input).backgroundColor);

          return {
            cardBg,
            titleColor,
            subtitleColor,
            labelColor,
            inputColor,
            inputBg
          };
        });

        const titleContrast = calculateContrastRatio(contrastResults.titleColor, contrastResults.cardBg);
        const subtitleContrast = calculateContrastRatio(contrastResults.subtitleColor, contrastResults.cardBg);
        const labelContrast = calculateContrastRatio(contrastResults.labelColor, contrastResults.cardBg);
        const inputContrast = calculateContrastRatio(contrastResults.inputColor, contrastResults.inputBg);

        expect(titleContrast).toBeGreaterThanOrEqual(4.5);
        expect(subtitleContrast).toBeGreaterThanOrEqual(4.5);
        expect(labelContrast).toBeGreaterThanOrEqual(4.5);
        expect(inputContrast).toBeGreaterThanOrEqual(4.5);

        // 4. Capture screenshot
        const screenshotPath = path.join(screenshotDir, `login-${themeId}-${mode}.png`);
        await page.screenshot({ path: screenshotPath });
        expect(fs.existsSync(screenshotPath)).toBe(true);
      }
    }

    // Verify persistence across reload for last chosen theme
    await page.reload();
    await expect(page.getByRole("heading", { name: "KONOHA CONSOLE" })).toBeVisible();
    const persistedTheme = await page.evaluate(() => localStorage.getItem('konoha-theme'));
    expect(persistedTheme).toBe(THEMES[THEMES.length - 1]);

    expect(pageErrors).toEqual([]);
  });

  test("Theme Switch Rasengan Transition: plays on selection, matches active theme, and cleans up completely", async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.goto("http://127.0.0.1:4173/");

    // Open theme picker modal via FAB
    const fabButton = page.locator("button[aria-label='Toggle Theme Selection Modal']");
    await expect(fabButton).toBeVisible();
    await fabButton.click();

    const modal = page.locator("#konoha-theme-picker");
    await expect(modal).toBeVisible();

    // Select Hokage Crimson Flame
    const hokageOption = page.locator("button").filter({ hasText: "Hokage Crimson Flame" }).first();
    await hokageOption.click();

    // Verify modal closes immediately
    await expect(modal).not.toBeVisible({ timeout: 1500 });

    // Verify rasengan transition container appears
    const transitionContainer = page.locator(".animate-huge-rasengan");
    await expect(transitionContainer).toBeVisible({ timeout: 1500 });

    // Capture screenshot mid-animation
    const midAnimScreenshot = path.resolve(process.cwd(), 'tests/e2e/screenshots/theme-transition-hokage-mid.png');
    await page.screenshot({ path: midAnimScreenshot });
    expect(fs.existsSync(midAnimScreenshot)).toBe(true);

    // Verify after 2.5s the transition cleans up completely and is removed from the DOM
    await expect(page.locator(".animate-huge-rasengan")).not.toBeVisible({ timeout: 4500 });

    // Verify UI is interactive again: click password input and type
    const passwordInput = page.locator("#login-password");
    await passwordInput.click();
    await passwordInput.fill("konohagakure");
    await expect(passwordInput).toHaveValue("konohagakure");

    expect(pageErrors).toEqual([]);
  });

  test("Login authentication operates correctly: invalid passphrase shows error, valid passphrase signs in", async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.goto("http://127.0.0.1:4173/");

    const passwordInput = page.locator("#login-password");
    await passwordInput.fill("wrong-passphrase-attempt");
    await page.getByRole("button", { name: "Login" }).click();

    await expect(page.getByText("Invalid password")).toBeVisible({ timeout: 6000 });

    // Submit bootstrap credential
    await passwordInput.fill("konohagakure");
    await page.getByRole("button", { name: "Login" }).click();

    // Successfully unlocks and displays password change modal or dashboard
    await expect(page.getByText("Set Permanent Password").or(page.getByText("Mission Control Dashboard"))).toBeVisible({ timeout: 12000 });

    expect(pageErrors).toEqual([]);
  });
});
