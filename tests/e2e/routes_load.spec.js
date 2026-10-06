/**
 * Generated from: routes_load.json
 * Flow SHA256: 483b09abfc887492d6f551bc83e0bf18291a7e98330cd908a24a99c24d4c49dd
 * Verified with agent-browser batch (exit 0)
 * Edit the flow file and regenerate, or remove this header to take ownership.
 */

import { test, expect } from '@playwright/test';

test("Routes load cleanly without errors", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/");
  await page.waitForURL("**/dashboard");
  await expect(page.getByText("Mission Control Dashboard")).toBeVisible();
  await page.goto("http://127.0.0.1:4173/detector");
  await expect(page.getByText("Website AI Detector")).toBeVisible();
});
