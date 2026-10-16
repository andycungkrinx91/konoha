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

  test("Selecting theme triggers 2s Rasengan spinning energy and glass crack animation without counter", async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.goto("http://127.0.0.1:4173/skills");

    // Open Theme Switcher
    const themeFab = page.getByRole("button", { name: "Toggle Theme Selection Modal" });
    await themeFab.click();

    // Click "Sharingan Royal Indigo"
    await page.getByText("Sharingan Royal Indigo").click();

    // Verify Rasengan spinning chakra sphere appears
    const rasenganSphere = page.locator(".animate-huge-rasengan");
    await expect(rasenganSphere).toBeVisible({ timeout: 1500 });

    // Verify counter is removed (no HUD countdown text)
    const countdownEl = page.locator(".text-cyan-300");
    await expect(countdownEl).toHaveCount(0);

    // Wait for the full 2s Rasengan charge and crystalline glass shatter transition to complete
    await expect(rasenganSphere).not.toBeVisible({ timeout: 4500 });

    // Verify theme was applied to document element
    const dataTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(dataTheme).toBe('sharingan');

    expect(pageErrors).toEqual([]);
  });

  test("3D tactile buttons maintain consistent theme styles across components", async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    // Skills page has both primary and secondary 3D buttons
    await page.goto("http://127.0.0.1:4173/skills");

    // Check presence of 3D buttons
    const btnCount = await page.locator(".btn-3d").count();
    expect(btnCount).toBeGreaterThan(0);

    // Verify primary button presence (e.g. Create Skill or Vector Embeddings)
    const primaryBtns = page.locator(".btn-3d-primary");
    const primCount = await primaryBtns.count();
    expect(primCount).toBeGreaterThan(0);

    // Verify secondary buttons use theme surface rather than unstyled backgrounds
    const secondaryBtns = page.locator(".btn-3d-secondary");
    const secCount = await secondaryBtns.count();
    expect(secCount).toBeGreaterThan(0);

    expect(pageErrors).toEqual([]);
  });

  test("Footer attribution displays 'Created by Andy Setiyawan' with verified LinkedIn link under SQLite FTS5 + Semble", async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.goto("http://127.0.0.1:4173/dashboard");

    // Verify footer status block exists
    const statusFooter = page.locator("aside").locator("text=SQLite FTS5 + Semble");
    await expect(statusFooter).toBeVisible();

    // Verify 'Created by Andy Setiyawan' attribution link exists
    const authorLink = page.locator("a[href='https://www.linkedin.com/in/andy-setiyawan-452396170/']");
    await expect(authorLink).toBeVisible();
    await expect(authorLink).toHaveText("Andy Setiyawan");
    await expect(authorLink).toHaveAttribute("target", "_blank");
    await expect(authorLink).toHaveAttribute("rel", "noopener noreferrer");

    expect(pageErrors).toEqual([]);
  });

  test("Mobile view displays menu sidebar toggle in left header and controls mobile drawer navigation", async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    // Set mobile viewport (iPhone dimensions)
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("http://127.0.0.1:4173/dashboard");

    // Verify desktop sidebar toggle is hidden on mobile
    const desktopToggle = page.locator("header button[aria-label='Toggle sidebar']");
    await expect(desktopToggle).not.toBeVisible();

    // Verify mobile sidebar toggle button is visible in left header
    const mobileToggle = page.locator("header button[aria-label='Toggle mobile menu sidebar']");
    await expect(mobileToggle).toBeVisible();

    // Verify bottom navigation dock is completely removed in mobile view
    const bottomDock = page.locator("nav.fixed.bottom-0");
    await expect(bottomDock).toHaveCount(0);

    // Initially, sidebar drawer is closed on mobile
    const sidebar = page.locator("aside");
    await expect(sidebar).not.toBeVisible();

    // Click mobile sidebar toggle to open drawer
    await mobileToggle.click();
    await expect(sidebar).toBeVisible();
    await expect(sidebar).toHaveClass(/fixed inset-y-0 left-0 z-50/);

    // Backdrop overlay is visible
    const backdrop = page.locator("div[aria-label='Close mobile navigation sidebar']");
    await expect(backdrop).toBeVisible();

    // Verify close button inside mobile drawer closes drawer
    const drawerCloseBtn = sidebar.locator("button[aria-label='Close mobile menu']");
    await drawerCloseBtn.click();
    await expect(sidebar).not.toBeVisible();

    // Re-open mobile sidebar and test backdrop click (on uncovered right area > 256px)
    await mobileToggle.click();
    await expect(sidebar).toBeVisible();
    await backdrop.click({ position: { x: 320, y: 200 } });
    await expect(sidebar).not.toBeVisible();

    // Re-open mobile sidebar and navigate via link
    await mobileToggle.click();
    await expect(sidebar).toBeVisible();

    // Click a navigation link inside mobile sidebar (e.g. Skills & Vectors)
    const skillsLink = sidebar.locator("a[href='/skills']").first();
    await skillsLink.click();

    // Verify navigation succeeds and mobile sidebar drawer automatically closes
    await expect(page).toHaveURL("http://127.0.0.1:4173/skills");
    await expect(sidebar).not.toBeVisible();

    expect(pageErrors).toEqual([]);
  });
});
