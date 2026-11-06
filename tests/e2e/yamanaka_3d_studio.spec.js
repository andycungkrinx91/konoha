import { test, expect } from '@playwright/test';
import { loginAndUnlock } from './auth_helper.js';

test("Yamanaka 3D Studio routes load cleanly with interactive viewport", async ({ page }) => {
  await loginAndUnlock(page);

  // Test 3D Setup Tools page
  await page.goto("http://127.0.0.1:4173/3d/setup");
  await expect(page.getByText("Yamanaka 3D Toolchain Setup").first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Hardware Acceleration & Compute Engine")).toBeVisible();
  await expect(page.getByText("Three.js & Manifold 3D")).toBeVisible();
  await expect(page.getByText("One-Click Auto-Install")).toBeVisible();

  // Test 3D Model Maker page
  await page.goto("http://127.0.0.1:4173/3d/maker");
  await expect(page.getByText("Real 3D Token & Cost Counter")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Total Requests")).toBeVisible();
  await expect(page.getByText("Total Input Tokens")).toBeVisible();
  await expect(page.getByText("Total Output Tokens")).toBeVisible();
  await expect(page.getByText("EST. Cost (USD)")).toBeVisible();
  await expect(page.getByText("Synthesizer Model Router")).toBeVisible();
  await expect(page.getByText("Synthesize 3D Model")).toBeVisible();

  // The 3D viewport is now lazy: no canvas is mounted before the first synthesis.
  await expect(page.locator('canvas:not([aria-hidden="true"])')).toHaveCount(0);

  // The Agentic Blender pipeline graph card is retired from the maker page.
  await expect(page.getByText(/Agentic Blender Editing Pipeline/i)).toHaveCount(0);

  // Recent 3D Assets sits at the bottom with infinite scroll, and is present exactly once.
  await expect(page.getByText("Recent 3D Assets")).toHaveCount(1);
});

test("Yamanaka 3D Maker streams live GLB into viewport without 404 or module errors", async ({ page }) => {
  test.setTimeout(600000);
  await loginAndUnlock(page);
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("http://127.0.0.1:4173/3d/maker");
  await expect(page.getByText("Synthesize 3D Model")).toBeVisible({ timeout: 15000 });

  // No canvas before synthesis — the viewport is lazily mounted inside the modal.
  await expect(page.locator('canvas:not([aria-hidden="true"])')).toHaveCount(0);

  await page.getByRole("button", { name: /Synthesize 3D Model/i }).click();

  // Synthesis opens a modal with a ring loader and an animated percentage.
  const modal = page.locator('[role="dialog"]');
  await expect(modal).toBeVisible({ timeout: 15000 });
  await expect(modal.getByText(/Synthesizing 3D Model/i)).toBeVisible();
  const percent = modal.getByText(/%/).first();
  await expect(percent).toBeVisible({ timeout: 15000 });
  const firstPercent = parseInt((await percent.textContent()) || "0", 10);
  await expect
    .poll(async () => parseInt((await percent.textContent()) || "0", 10), { timeout: 60000 })
    .toBeGreaterThan(firstPercent);

  // Completion keeps the asset in the modal and lazy-loads the Three.js viewport.
  await expect(page.getByText(/synthesized and promoted/i)).toBeVisible({ timeout: 540000 });

  await expect(page.getByText(/Cannot find module 'three'/i)).toHaveCount(0);
  await expect(page.getByText(/Failed to load 3D model/i)).toHaveCount(0);
  await expect(modal.getByRole("button", { name: /3D Model Viewport/i })).toBeVisible({ timeout: 30000 });
  await expect(modal.locator("canvas").first()).toBeVisible({ timeout: 30000 });

  const fatal = consoleErrors.filter((line) => /Cannot find module|responded with 404/i.test(line));
  expect(fatal, `Unexpected fatal console errors: ${fatal.join(' | ')}`).toHaveLength(0);
});
