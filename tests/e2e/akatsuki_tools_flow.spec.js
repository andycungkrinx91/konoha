/**
 * Generated from: akatsuki_tools_flow.json
 * Flow SHA256: 5cc86e75f463bf39544fc822e69618047caa0aa35d0acd6bb41565cb75f19d1b
 * Verified with agent-browser batch (exit 0)
 * Edit the flow file and regenerate, or remove this header to take ownership.
 */

import { test, expect } from '@playwright/test';
import { loginAndUnlock } from './auth_helper.js';

test("Akatsuki Tools Exploration Flow", async ({ page }) => {
  await loginAndUnlock(page);
  await page.goto("http://127.0.0.1:4173/skills");
  await expect(page.locator("body")).toBeVisible();
});
