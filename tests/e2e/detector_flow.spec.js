/**
 * Generated from: detector_flow.json
 * Flow SHA256: 08e144d1d0de518e973f7a9fdd9ae92b1a13162786b6228666fd3fb7ba87b2f6
 * Verified with agent-browser batch (exit 0)
 * Edit the flow file and regenerate, or remove this header to take ownership.
 */

import { test, expect } from '@playwright/test';

test("Document AI Detector flow executes end to end", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/detector");
  await page.getByRole("button", { name: "📄 Document AI" }).click();
  await page.getByRole("button", { name: "Paste Text" }).click();
  await page.getByLabel("Paste Document Text").fill("Sample verified flow content for document detection");
  await expect(page.getByText("Analyze Text")).toBeVisible();
});
