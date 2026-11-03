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

  // Viewport canvas verification
  const canvas = page.locator("canvas");
  await expect(canvas.first()).toBeVisible({ timeout: 10000 });
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

  await page.getByRole("button", { name: /Synthesize 3D Model/i }).click();

  await expect(page.getByText(/synthesized and promoted/i)).toBeVisible({ timeout: 540000 });

  await expect(page.getByText(/Cannot find module 'three'/i)).toHaveCount(0);
  await expect(page.getByText(/Failed to load 3D model/i)).toHaveCount(0);
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15000 });

  const fatal = consoleErrors.filter((line) => /Cannot find module|responded with 404/i.test(line));
  expect(fatal, `Unexpected fatal console errors: ${fatal.join(' | ')}`).toHaveLength(0);
});
