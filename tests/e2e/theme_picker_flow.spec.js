import { test, expect } from '@playwright/test';
import { loginAndUnlock } from './auth_helper.js';

test("Theme Picker selection flow executes end to end", async ({ page }) => {
  await loginAndUnlock(page);
  await page.goto("http://127.0.0.1:4173/dashboard");
  await expect(page.getByText("Mission Control Dashboard")).toBeVisible();
  await page.getByRole("button", { name: "Toggle Theme Selection Modal" }).click();
  await expect(page.getByText("Konoha 4-Gradient Theme Palette")).toBeVisible();
  await expect(page.getByText("Children of Midnight Violet")).toBeVisible();
});
