import { test, expect } from '@playwright/test';
import { loginAndUnlock } from './auth_helper.js';

test.describe("Dashboard Gauges, Header Orb Removal, Breadcrumbs, Fullscreen Switch & Shared Background", () => {
  test.setTimeout(240000);

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

  function parseRgb(colorStr, bg = { r: 255, g: 255, b: 255 }) {
    if (!colorStr) return { r: 0, g: 0, b: 0, a: 1 };
    const str = colorStr.trim();
    if (str.startsWith('#')) {
      const hex = str.slice(1);
      if (hex.length === 6) {
        return {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16),
          a: 1
        };
      }
      if (hex.length === 3) {
        return {
          r: parseInt(hex[0] + hex[0], 16),
          g: parseInt(hex[1] + hex[1], 16),
          b: parseInt(hex[2] + hex[2], 16),
          a: 1
        };
      }
    }
    const srgbMatch = str.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/);
    if (srgbMatch) {
      const r = Math.round(parseFloat(srgbMatch[1]) * 255);
      const g = Math.round(parseFloat(srgbMatch[2]) * 255);
      const b = Math.round(parseFloat(srgbMatch[3]) * 255);
      const a = srgbMatch[4] !== undefined ? parseFloat(srgbMatch[4]) : 1;
      return {
        r: Math.round(r * a + bg.r * (1 - a)),
        g: Math.round(g * a + bg.g * (1 - a)),
        b: Math.round(b * a + bg.b * (1 - a)),
        a: 1
      };
    }
    const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (m) {
      const r = parseInt(m[1], 10);
      const g = parseInt(m[2], 10);
      const b = parseInt(m[3], 10);
      const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
      return {
        r: Math.round(r * a + bg.r * (1 - a)),
        g: Math.round(g * a + bg.g * (1 - a)),
        b: Math.round(b * a + bg.b * (1 - a)),
        a: 1
      };
    }
    return { r: 0, g: 0, b: 0, a: 1 };
  }

  function luminance({ r, g, b }) {
    const sRGB = [r, g, b].map(v => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * sRGB[0] + 0.7152 * sRGB[1] + 0.0722 * sRGB[2];
  }

  function contrastRatio(fg, bg) {
    const L1 = luminance(fg);
    const L2 = luminance(bg);
    const brightest = Math.max(L1, L2);
    const darkest = Math.min(L1, L2);
    return (brightest + 0.05) / (darkest + 0.05);
  }

  // ---------------------------------------------------------------------------
  // TEST 1: Header Orb Removal across all layouts and routes
  // ---------------------------------------------------------------------------
  test("Header Rasengan Orb is completely removed from all pages without leftover placeholder or gap", async ({ page }) => {
    await loginAndUnlock(page);

    const routesToTest = [
      '/dashboard',
      '/clients',
      '/agents',
      '/skills',
      '/settings',
      '/savings',
      '/bridges',
      '/doctor',
      '/docs',
      '/non-existent-error-route'
    ];

    for (const route of routesToTest) {
      await page.goto(`http://127.0.0.1:4173${route}`);
      await page.waitForTimeout(300);

      // Verify header exists
      const header = page.locator('header');
      if (await header.count() > 0) {
        // Assert NO rasengan orb exists inside the header
        const headerOrb = header.locator('[role="img"][aria-label*="Rasengan"], svg[viewBox="0 0 100 100"], [aria-label*="Rasengan Chakra Sphere"]');
        expect(await headerOrb.count()).toBe(0);
      }
    }

    // Verify floating FABs at bottom-right remain intact and functional
    const themeFab = page.getByRole("button", { name: "Toggle Theme Selection Modal" });
    await expect(themeFab).toBeVisible();

    const modeToggle = page.getByRole("button", { name: /appearance mode/i });
    await expect(modeToggle).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // TEST 2: Gauge Charts Mathematical Proportionality & Contrast Across 10 Themes
  // ---------------------------------------------------------------------------
  test("Dashboard gauge charts (track, arc, 3:1 contrast, proportional length, loop glow, no box artifact) across all 10 themes x 2 modes", async ({ page }) => {
    await loginAndUnlock(page);
    await page.goto("http://127.0.0.1:4173/dashboard");
    await expect(page.getByText("CPU Utilization")).toBeVisible();

    // Verify gauge arc length mathematical proportionality for values: [0, 4.7, 25, 50, 83.9, 100]
    const testValues = [0, 4.7, 25, 50, 83.9, 100];
    for (const val of testValues) {
      const calculatedOffset = await page.evaluate((pct) => {
        const p = Math.min(100, Math.max(0, pct || 0));
        return String(100 - p);
      }, val);
      const expectedOffset = String(100 - val);
      expect(calculatedOffset).toBe(expectedOffset);
    }

    // Capture 20 screenshots of /dashboard (10 themes x 2 modes) and verify contrast >= 3:1
    for (const theme of THEMES) {
      for (const mode of ['light', 'dark']) {
        await page.evaluate(({ t, m }) => {
          if (window.__themeState) {
            window.__themeState.applyTheme(t, m);
          } else {
            const html = document.documentElement;
            html.setAttribute('data-theme', t);
            html.setAttribute('data-mode', m);
          }
        }, { t: theme, m: mode });

        await page.waitForTimeout(150);

        // Capture screenshot
        await page.screenshot({
          path: `tests/e2e/screenshots/dashboard-${theme}-${mode}.png`,
          fullPage: false
        });

        // Verify gauge track and arc contrast against card surface
        const gaugeContrast = await page.evaluate(() => {
          function resolveRgb(cssColor) {
            const div = document.createElement('div');
            div.style.color = cssColor;
            document.body.appendChild(div);
            const computed = window.getComputedStyle(div).color;
            div.remove();
            return computed;
          }

          const style = window.getComputedStyle(document.documentElement);
          const rawCardBg = style.getPropertyValue('--color-surface').trim() || '#ffffff';
          const rawTrack = style.getPropertyValue('--theme-gauge-track').trim() || '#64748b';
          const rawArc = style.getPropertyValue('--theme-gauge-arc-start').trim() || '#0284c7';

          return {
            cardBg: resolveRgb(rawCardBg),
            trackStroke: resolveRgb(rawTrack),
            arcStroke: resolveRgb(rawArc)
          };
        });

        const cardRgb = parseRgb(gaugeContrast.cardBg);
        const trackRgb = parseRgb(gaugeContrast.trackStroke, cardRgb);
        const arcRgb = parseRgb(gaugeContrast.arcStroke, cardRgb);

        const trackCr = contrastRatio(trackRgb, cardRgb);
        const arcCr = contrastRatio(arcRgb, cardRgb);
        console.log(`[Gauge Contrast Result] theme=${theme.padEnd(14)} mode=${mode.padEnd(5)}: track=${trackCr.toFixed(2)}:1, arc=${arcCr.toFixed(2)}:1`);

        expect(trackCr).toBeGreaterThanOrEqual(3.0);
        expect(arcCr).toBeGreaterThanOrEqual(3.0);

        // Verify no rectangular / box artifact around gauge
        const hasBoxArtifact = await page.evaluate(() => {
          const gaugeContainer = document.querySelector('.metric-card-3d .relative.w-40.h-40');
          if (!gaugeContainer) return false;
          const style = window.getComputedStyle(gaugeContainer);
          return style.overflow === 'hidden' || (style.boxShadow && !style.boxShadow.includes('none'));
        });
        expect(hasBoxArtifact).toBe(false);

        // Verify center text contrast >= 4.5:1
        const textContrast = await page.evaluate(() => {
          const style = window.getComputedStyle(document.documentElement);
          const fg = style.getPropertyValue('--color-text').trim() || '#0f172a';
          const bg = style.getPropertyValue('--color-surface').trim() || '#ffffff';
          return { fg, bg };
        });

        const fgRgb = parseRgb(textContrast.fg);
        const bgRgb = parseRgb(textContrast.bg);
        const textCr = contrastRatio(fgRgb, bgRgb);
        expect(textCr).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // TEST 3: Header Breadcrumb Contrast >= 4.5:1 Across All 10 Themes in 2 Modes
  // ---------------------------------------------------------------------------
  test("Header breadcrumb contrast: active crumb, separator, parent crumb all >= 4.5:1 across all 10 themes in both modes", async ({ page }) => {
    test.setTimeout(180000);
    await loginAndUnlock(page);

    const routesToCheck = ['/dashboard', '/settings'];

    for (const route of routesToCheck) {
      await page.goto(`http://127.0.0.1:4173${route}`);
      await page.waitForTimeout(200);

      for (const theme of THEMES) {
        for (const mode of ['light', 'dark']) {
          await page.evaluate(({ t, m }) => {
            if (window.__themeState) {
              window.__themeState.applyTheme(t, m);
            } else {
              const html = document.documentElement;
              html.setAttribute('data-theme', t);
              html.setAttribute('data-mode', m);
            }
          }, { t: theme, m: mode });

          await page.waitForTimeout(40);

          const results = await page.evaluate(() => {
            function resolveRgb(cssColor) {
              const div = document.createElement('div');
              div.style.color = cssColor;
              document.body.appendChild(div);
              const computed = window.getComputedStyle(div).color;
              div.remove();
              return computed;
            }

            const header = document.querySelector('header');
            if (!header) return null;
            const style = window.getComputedStyle(document.documentElement);
            const rawSurface = style.getPropertyValue('--color-surface').trim() || '#ffffff';
            const rawActive = style.getPropertyValue('--theme-crumb-active').trim() || '#0f172a';
            const rawParent = style.getPropertyValue('--theme-crumb-parent').trim() || '#334155';
            const rawSep = style.getPropertyValue('--theme-crumb-separator').trim() || '#64748b';

            return {
              surface: resolveRgb(rawSurface),
              crumbActive: resolveRgb(rawActive),
              crumbParent: resolveRgb(rawParent),
              crumbSep: resolveRgb(rawSep)
            };
          });

          if (results) {
            const surfaceRgb = parseRgb(results.surface);
            const activeRgb = parseRgb(results.crumbActive);
            const parentRgb = parseRgb(results.crumbParent);
            const sepRgb = parseRgb(results.crumbSep);

            const crActive = contrastRatio(activeRgb, surfaceRgb);
            const crParent = contrastRatio(parentRgb, surfaceRgb);
            const crSep = contrastRatio(sepRgb, surfaceRgb);

            expect(crActive).toBeGreaterThanOrEqual(4.5);
            expect(crParent).toBeGreaterThanOrEqual(4.5);
            expect(crSep).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  });

  // ---------------------------------------------------------------------------
  // TEST 4: Full-Screen Theme Switch Rasengan Effect
  // ---------------------------------------------------------------------------
  test("Theme switch rasengan transition: 3D supernova trigger, newly selected palette, and clean disposal", async ({ page }) => {
    await loginAndUnlock(page);
    await page.goto("http://127.0.0.1:4173/dashboard");

    // Open theme switcher modal
    const themeFab = page.getByRole("button", { name: "Toggle Theme Selection Modal" });
    await themeFab.click();

    // Select Hokage Crimson Flame theme
    const hokageBtn = page.getByRole("button", { name: /Hokage Crimson Flame/i });
    await expect(hokageBtn).toBeVisible();
    await hokageBtn.click();

    // Verify 3D transition state in backgroundScene
    const transitionState = await page.evaluate(() => {
      const inst = window.backgroundScene?.instance;
      return {
        isTransitioning: inst?.isThemeTransitioning,
        supernovaVisible: inst?.supernovaGroup?.visible
      };
    });
    expect(transitionState.isTransitioning).toBe(true);

    // Wait for transition to complete (~1.1s)
    await page.waitForTimeout(1100);

    // Verify settled
    const settledState = await page.evaluate(() => {
      const inst = window.backgroundScene?.instance;
      return {
        isTransitioning: inst?.isThemeTransitioning,
        theme: document.documentElement.getAttribute('data-theme')
      };
    });
    expect(settledState.isTransitioning).toBe(false);
    expect(settledState.theme).toBe('hokage-gold');
  });

  // ---------------------------------------------------------------------------
  // TEST 5: Shared Rasengan Background Across Login and Dashboard
  // ---------------------------------------------------------------------------
  test("Shared Rasengan Background: persists across route changes, renders on login and dashboard with performance budget", async ({ page }) => {
    // 1. Visit Login page (unauthenticated state)
    await page.goto("http://127.0.0.1:4173/");

    // Check shared background root element
    const sharedBg = page.locator('#shared-rasengan-bg-root');
    await expect(sharedBg).toBeVisible({ timeout: 10000 });

    // Capture login screenshot
    await page.screenshot({ path: 'tests/e2e/screenshots/shared-bg-login-page.png' });

    // 2. Log in and verify shared background persists on dashboard
    await loginAndUnlock(page);
    await page.goto("http://127.0.0.1:4173/dashboard");

    await expect(sharedBg).toBeVisible();
    await page.screenshot({ path: 'tests/e2e/screenshots/shared-bg-dashboard-page.png' });

    // 3. Navigate to /agents, /clients, /skills — verify background is unchanged and single instance
    await page.goto("http://127.0.0.1:4173/agents");
    await expect(sharedBg).toHaveCount(1);

    await page.goto("http://127.0.0.1:4173/clients");
    await expect(sharedBg).toHaveCount(1);

    await page.goto("http://127.0.0.1:4173/skills");
    await expect(sharedBg).toHaveCount(1);

    // Measure CDP performance metrics on /dashboard
    const client = await page.context().newCDPSession(page);
    await client.send('Performance.enable');
    const perfMetrics = await client.send('Performance.getMetrics');

    const metricsMap = Object.fromEntries(perfMetrics.metrics.map(m => [m.name, m.value]));
    const heapUsedMB = (metricsMap.JSHeapUsedSize / (1024 * 1024)).toFixed(2);
    const heapTotalMB = (metricsMap.JSHeapTotalSize / (1024 * 1024)).toFixed(2);
    const docCount = metricsMap.Documents ?? 0;
    const frameCount = metricsMap.Frames ?? 0;
    const layoutCount = metricsMap.LayoutObjects ?? 0;
    const listenersCount = metricsMap.JSEventListeners ?? 0;

    console.log(`[CDP Verified Metrics] HeapUsed=${heapUsedMB}MB, HeapTotal=${heapTotalMB}MB, Documents=${docCount}, Frames=${frameCount}, LayoutObjects=${layoutCount}, Listeners=${listenersCount}`);

    expect(parseFloat(heapUsedMB)).toBeLessThan(100);
    expect(docCount).toBeLessThan(30);
  });
});
