import { test, expect } from '@playwright/test';
import fs from 'fs';

const CUSTOM_PASSWORD = 'secure-shinobi-2026!';

test.describe("Cyberpunk 3D Login, Rasengan Animation & Auth Gating E2E", () => {
  test.beforeEach(async () => {
    const authFile = process.env.KONOHA_AUTH_FILE || '/tmp/konoha_test_web_auth.json';
    if (fs.existsSync(authFile)) {
      try { fs.unlinkSync(authFile); } catch (_) {}
    }
  });

  test("First-run setup lands first, then login, animation, and logout flow", async ({ page }) => {
    test.setTimeout(60000);
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    // Visit root - bootstrap is active, so the set-new-password form is the only form
    await page.goto("http://127.0.0.1:4173/");
    await expect(page.getByRole("heading", { name: "KONOHA CONSOLE" })).toBeVisible();
    await expect(page.getByTestId("first-run-setup-form")).toBeVisible();
    await expect(page.locator("#login-password")).toHaveCount(0);
    await expect(page.getByText("default passphrase")).toHaveCount(0);
    await expect(page.getByTestId("first-run-login-tab")).toHaveCount(0);

    // Complete first-run setup with the two strict fields
    await page.locator("#setup-new-password").fill(CUSTOM_PASSWORD);
    await page.locator("#setup-confirm-password").fill(CUSTOM_PASSWORD);
    await page.getByRole("button", { name: "Initialize Password" }).click();

    // Sign-in form replaces the setup form once the server clears is_bootstrap
    await expect(page.locator("#login-password")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#setup-new-password")).toHaveCount(0);
    const tag = page.getByText("passphrase protected");
    await expect(tag).toBeVisible();
    const tagTransform = await tag.evaluate(el => window.getComputedStyle(el).textTransform);
    expect(tagTransform).toBe("lowercase");

    const passwordInput = page.locator("#login-password");
    const radius = await passwordInput.evaluate(el => window.getComputedStyle(el).borderRadius);
    expect(radius).toBe("3px");

    // Verify sleek neon focus animation on focus
    await passwordInput.focus();
    const focusStyle = await passwordInput.evaluate(el => {
      const s = window.getComputedStyle(el);
      return {
        animationName: s.animationName,
        boxShadow: s.boxShadow,
        outlineStyle: s.outlineStyle
      };
    });
    expect(focusStyle.outlineStyle).toBe("none");
    expect(focusStyle.animationName).toContain("neonBorderSweep");
    expect(focusStyle.boxShadow).toContain("0px 0px 0px 1px");

    // Test show/hide password toggle
    await passwordInput.fill("test-pass-123");
    await expect(passwordInput).toHaveAttribute("type", "password");

    const toggleBtn = page.getByRole("button", { name: "Show password" });
    await toggleBtn.click();
    await expect(passwordInput).toHaveAttribute("type", "text");

    const hideBtn = page.getByRole("button", { name: "Hide password" });
    await hideBtn.click();
    await expect(passwordInput).toHaveAttribute("type", "password");

    // Test invalid password submission
    await passwordInput.fill("wrong-ninja-password");
    await page.getByRole("button", { name: "Login" }).click();

    // Verify error feedback
    await expect(page.getByText("Invalid password")).toBeVisible({ timeout: 6000 });

    // Test login with the freshly established credential and the 3s animation
    await expect(page.getByRole("button", { name: "Login" })).toBeEnabled({ timeout: 5000 });
    await passwordInput.fill(CUSTOM_PASSWORD);
    await page.getByRole("button", { name: "Login" }).click();

    // Verify 3s animation phase indicator or authenticating state appears
    await expect(page.getByText(/Charging chakra core|Authenticating/i).first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#login-password")).toBeDisabled();

    // Verify dashboard is unlocked and revealed
    await expect(page.getByText("Mission Control Dashboard")).toBeVisible({ timeout: 10000 });

    // Test Theme Switcher on the authenticated dashboard
    const themeFab = page.getByRole("button", { name: "Toggle Theme Selection Modal" });
    await expect(themeFab).toBeVisible();
    await themeFab.click();

    await expect(page.getByText("Konoha 4-Gradient Theme Palette")).toBeVisible();
    await page.getByRole("button", { name: /^Byakugan Deep Ocean/ }).click();
    await expect(page.getByText("Konoha 4-Gradient Theme Palette")).not.toBeVisible();

    // Verify theme updated
    const dataTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(dataTheme).toBe('byakugan');

    // Test Logout
    const logoutBtn = page.getByRole("button", { name: /Logout \/ Lock|Logout/i }).first();
    await logoutBtn.scrollIntoViewIfNeeded();
    await logoutBtn.click({ force: true });

    // Returns to Cyberpunk Login screen
    await expect(page.getByRole("heading", { name: "KONOHA CONSOLE" })).toBeVisible({ timeout: 10000 });

    // Assert zero uncaught JavaScript page errors
    expect(pageErrors).toEqual([]);
  });

  test("Accessibility and reduced motion preference", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto("http://127.0.0.1:4173/");
    await expect(page.getByRole("heading", { name: "KONOHA CONSOLE" })).toBeVisible();
    const setupInput = page.locator("#setup-new-password");
    await expect(setupInput).toBeVisible();
    const isReduced = await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    expect(isReduced).toBe(true);
  });
});