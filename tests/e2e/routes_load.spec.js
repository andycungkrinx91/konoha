/**
 * Generated from: routes_load.json
 * Flow SHA256: 483b09abfc887492d6f551bc83e0bf18291a7e98330cd908a24a99c24d4c49dd
 * Verified with agent-browser batch (exit 0)
 * Edit the flow file and regenerate, or remove this header to take ownership.
 */

import { test, expect } from '@playwright/test';
import { loginAndUnlock } from './auth_helper.js';

test("Routes load cleanly without errors", async ({ page }) => {
  await loginAndUnlock(page);
  await page.goto("http://127.0.0.1:4173/dashboard");
  await expect(page.getByText("Mission Control Dashboard")).toBeVisible();
  await page.goto("http://127.0.0.1:4173/detector");
  await expect(page.getByText("Website AI Detector")).toBeVisible();
  await page.goto("http://127.0.0.1:4173/agents");
  await expect(page.getByText("Ninja Subagents").first()).toBeVisible();
  await expect(page.locator("text=no such column")).toHaveCount(0);
  await expect(page.getByText("@sannin")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("@kage")).toBeVisible({ timeout: 15000 });
});
