import { test, expect } from '@playwright/test';
import fs from 'fs';

test.describe("Cyberpunk 3D Login, Rasengan Animation & Auth Gating E2E", () => {
  test.beforeEach(async () => {
    const authFile = process.env.KONOHA_AUTH_FILE || '/tmp/konoha_test_web_auth.json';
    if (fs.existsSync(authFile)) {
      try { fs.unlinkSync(authFile); } catch (_) {}
    }
  });

  test("Complete login, animation, mandatory change modal, and logout flow", async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    // 1. Visit root - unauthenticated user lands on Cyberpunk Login page
    await page.goto("http://127.0.0.1:4173/");

    // Verify Cyberpunk Login UI elements
    await expect(page.getByRole("heading", { name: "KONOHA CONSOLE" })).toBeVisible();
    await expect(page.getByText("Default Passphrase (konohagakure)")).toBeVisible();
    await expect(page.getByText("Default: konohagakure")).toBeVisible();

    const passwordInput = page.locator("#login-password");
    await expect(passwordInput).toBeVisible();

    // 2. Test show/hide password toggle
    await passwordInput.fill("test-pass-123");
    await expect(passwordInput).toHaveAttribute("type", "password");

    const toggleBtn = page.getByRole("button", { name: "Show password" });
    await toggleBtn.click();
    await expect(passwordInput).toHaveAttribute("type", "text");

    const hideBtn = page.getByRole("button", { name: "Hide password" });
    await hideBtn.click();
    await expect(passwordInput).toHaveAttribute("type", "password");

    // 3. Test invalid password submission
    await passwordInput.fill("wrong-ninja-password");
    await page.getByRole("button", { name: "Login" }).click();

    // Verify error feedback
    await expect(page.getByText("Invalid password")).toBeVisible({ timeout: 6000 });

    // 4. Test login with bootstrap credential 'konohagakure' and 3s animation
    await passwordInput.fill("konohagakure");
    await page.getByRole("button", { name: "Login" }).click();

    // Verify 3s animation phase indicator or authenticating state appears
    await expect(page.locator("[aria-live='polite']").filter({ hasText: /Charging chakra core|Authenticating/i }).first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#login-password")).toBeDisabled();

    // 5. Verify Mandatory Password Change Modal appears
    await expect(page.getByRole("heading", { name: "Mandatory Password Change" })).toBeVisible({ timeout: 8000 });
    await expect(page.getByText("The initial bootstrap password (konohagakure) is currently active")).toBeVisible();

    // Verify Escape cannot dismiss mandatory password change modal
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Mandatory Password Change" })).toBeVisible();

    // 6. Complete password change to secure credential
    await page.locator("#current-password").fill("konohagakure");
    const newPassInput = page.locator("#new-password");
    const confirmPassInput = page.locator("#confirm-password");
    await newPassInput.fill("secure-shinobi-2026!");
    await confirmPassInput.fill("secure-shinobi-2026!");

    await page.getByRole("button", { name: "Update & Continue to Dashboard" }).click();

    // 7. Verify dashboard is unlocked and revealed
    await expect(page.getByText("Mission Control Dashboard")).toBeVisible({ timeout: 10000 });

    // 8. Test Theme Switcher on the authenticated dashboard
    const themeFab = page.getByRole("button", { name: "Toggle Theme Selection Modal" });
    await expect(themeFab).toBeVisible();
    await themeFab.click();

    await expect(page.getByText("Konoha 4-Gradient Theme Palette")).toBeVisible();
    await page.getByRole("button", { name: "Byakugan Deep Ocean (active)" }).click();

    // Verify theme updated
    const dataTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(dataTheme).toBe('byakugan');

    // 9. Test Logout
    const logoutBtn = page.getByRole("button", { name: /Logout \/ Lock|Logout/i }).first();
    await logoutBtn.click();

    // Returns to Cyberpunk Login screen
    await expect(page.getByRole("heading", { name: "KONOHA CONSOLE" })).toBeVisible({ timeout: 5000 });

    // Assert zero uncaught JavaScript page errors
    expect(pageErrors).toEqual([]);
  });

  test("Accessibility and reduced motion preference", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto("http://127.0.0.1:4173/");
    await expect(page.getByRole("heading", { name: "KONOHA CONSOLE" })).toBeVisible();
    const passwordInput = page.locator("#login-password");
    await expect(passwordInput).toBeVisible();
    const isReduced = await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    expect(isReduced).toBe(true);
  });
});
