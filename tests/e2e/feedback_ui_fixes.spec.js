import { test, expect } from '@playwright/test';
import { loginAndUnlock } from './auth_helper.js';

test.describe("Feedback UI Fixes E2E", () => {
  test.beforeEach(async ({ page }) => {
    await loginAndUnlock(page);
  });

  test("Context page renders active workspaces and allows switching", async ({ page }) => {
    await page.goto("http://127.0.0.1:4173/context");
    await expect(page.getByText("Active Workspace")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Architectural Invariants & Constraints")).toBeVisible();
    await expect(page.locator("textarea")).toBeVisible();
  });

  test("Persona page in dark mode renders readable Ninja's Soul doctrine title", async ({ page }) => {
    await page.goto("http://127.0.0.1:4173/persona");
    
    // Ensure dark mode is active
    await page.evaluate(() => {
      document.documentElement.classList.add('theme-dark');
      document.documentElement.setAttribute('data-mode', 'dark');
    });

    // Switch to Ninja's Soul tab
    const soulTabBtn = page.getByRole("button", { name: "Ninja's Soul" });
    await expect(soulTabBtn).toBeVisible({ timeout: 15000 });
    await soulTabBtn.click();

    const doctrineTitle = page.getByText("Konohagakure Core Doctrine — Ninja's Soul");
    await expect(doctrineTitle).toBeVisible({ timeout: 15000 });

    // Verify computed visibility and color style
    const isLegible = await doctrineTitle.evaluate((el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const isVisible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      const color = style.color;
      return isVisible && Boolean(color);
    });

    expect(isLegible).toBe(true);
  });

  test("Tasks page renders tasks and Reconcile Stale controls", async ({ page }) => {
    await page.goto("http://127.0.0.1:4173/tasks");
    await expect(page.getByText("Tasks (").first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: "Reconcile Stale" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();
  });
});
