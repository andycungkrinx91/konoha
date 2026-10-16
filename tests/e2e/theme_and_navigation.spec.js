import { test, expect } from '@playwright/test';

test.describe("Web UI Theme Switcher & Navigation E2E Suite", () => {
  test("Theme switcher FAB opens modal, displays 10 4-gradient themes, and updates theme correctly", async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.goto("http://127.0.0.1:4173/dashboard");
    await expect(page.getByText("Mission Control Dashboard")).toBeVisible();

    // Verify Theme Switcher FAB button is visible in bottom-right
    const themeFab = page.getByRole("button", { name: "Toggle Theme Selection Modal" });
    await expect(themeFab).toBeVisible();

    // Click to open theme switcher modal
    await themeFab.click();

    // Verify modal title and 4-gradient subtitle
    await expect(page.getByText("Konoha 4-Gradient Theme Palette")).toBeVisible();
    await expect(page.getByText("10 Light-Mode calibrated palettes with 4-stop vibrant gradients")).toBeVisible();

    // Verify presence of all 10 themes
    const themeNames = [
      "Chidori Midnight Violet",
      "Byakugan Deep Cyan",
      "Konoha Forest Aurora",
      "Rasengan Cosmic Magenta",
      "Sharingan Royal Indigo",
      "Hokage Crimson Flame",
      "Anbu Abyssal Emerald",
      "Sage Mode Nebula Orchid",
      "Sound Imperial Bronze",
      "Akatsuki Jade Matrix"
    ];

    for (const name of themeNames) {
      await expect(page.getByText(name)).toBeVisible();
    }

    // Switch to Byakugan Deep Cyan (clicking a theme applies it and closes the modal)
    await page.getByText("Byakugan Deep Cyan").click();

    // Verify modal automatically closed upon selection
    await expect(page.getByText("Konoha 4-Gradient Theme Palette")).not.toBeVisible();

    // Verify document theme updated to byakugan
    let dataTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(dataTheme).toBe('byakugan');

    // Re-open modal via FAB to switch to Akatsuki Jade Matrix
    await themeFab.click();
    await expect(page.getByText("Konoha 4-Gradient Theme Palette")).toBeVisible();

    // Switch to Akatsuki Jade Matrix
    await page.getByText("Akatsuki Jade Matrix").click();
    await expect(page.getByText("Konoha 4-Gradient Theme Palette")).not.toBeVisible();

    dataTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(dataTheme).toBe('akatsuki');

    // Test opening modal and closing via Escape key
    await themeFab.click();
    await expect(page.getByText("Konoha 4-Gradient Theme Palette")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("Konoha 4-Gradient Theme Palette")).not.toBeVisible();

    // Assert zero uncaught JavaScript page errors
    expect(pageErrors).toEqual([]);
  });

  test("All primary navigation routes render cleanly without errors", async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    const routes = [
      { path: "/dashboard", heading: "Mission Control Dashboard" },
      { path: "/savings", heading: "Token Savings" },
      { path: "/agents", heading: "Ninja Subagents" },
      { path: "/skills", heading: "Skills & Vectors" },
      { path: "/persona", heading: "Will of Fire" },
      { path: "/detector", heading: "Website AI Detector" },
      { path: "/remote", heading: "Remote Access" },
      { path: "/tasks", heading: "SDLC Tasks" }
    ];

    for (const route of routes) {
      await page.goto(`http://127.0.0.1:4173${route.path}`);
      await expect(page.getByText(route.heading).first()).toBeVisible({ timeout: 5000 });
    }

    expect(pageErrors).toEqual([]);
  });
});
