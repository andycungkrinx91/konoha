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

  test("Clients page renders dynamic client count, names summary, and stat box from API", async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    // Mock /api/v1/clients with 8 clients including OMP
    await page.route("**/api/v1/clients", async route => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { id: 'antigravity', name: 'Antigravity IDE / CLI', configPath: '~/.gemini/config/mcp_config.json', configured: true },
          { id: 'cursor', name: 'Cursor IDE / CLI', configPath: '~/.cursor/mcp.json', configured: true },
          { id: 'claude', name: 'Claude Code CLI', configPath: '~/.claude.json', configured: false },
          { id: 'opencode', name: 'OpenCode IDE', configPath: '~/.config/opencode/opencode.json', configured: false },
          { id: 'commandcode', name: 'Command Code CLI', configPath: '~/.commandcode/mcp.json', configured: false },
          { id: 'codex', name: 'Codex IDE / CLI', configPath: '~/.codex/config.toml', configured: false },
          { id: 'pi', name: 'Pi (pi.dev)', configPath: '~/.pi/agent/mcp.json', configured: false },
          { id: 'omp', name: 'OMP Agent', configPath: '~/.omp/agent/mcp.json', configured: true }
        ])
      });
    });

    await page.goto("http://127.0.0.1:4173/clients");

    // Verify dynamic heading has 8 IDEs & CLIs
    await expect(page.getByRole("heading", { name: "Coding Clients (8 IDEs & CLIs)" })).toBeVisible({ timeout: 5000 });

    // Verify dynamic platforms stat box
    await expect(page.getByText("8 Platforms")).toBeVisible();

    // Verify connected count is 3 Active (antigravity, cursor, omp)
    await expect(page.getByText("3 Active")).toBeVisible();

    // Verify dynamic summary contains all client names including OMP Agent
    await expect(page.getByText("Auto-inject Konoha MCP tools and RTK output filtering into Antigravity IDE / CLI, Cursor IDE / CLI, Claude Code CLI, OpenCode IDE, Command Code CLI, Codex IDE / CLI, Pi (pi.dev), and OMP Agent.")).toBeVisible();

    // Verify client cards are rendered
    await expect(page.getByRole("heading", { name: "OMP Agent" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Antigravity IDE / CLI" })).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("Docs page presents 11 sections, verified 8 clients, theme custom property styles, and responsive layout", async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.goto("http://127.0.0.1:4173/docs");

    // Verify main docs header
    await expect(page.getByRole("heading", { name: "Documentation" })).toBeVisible({ timeout: 5000 });

    // Verify Overview section displays 8 Clients and lists OMP
    const overviewSection = page.locator("#overview");
    await expect(overviewSection).toBeVisible();
    await expect(overviewSection.getByText("8 Clients")).toBeVisible();
    await expect(overviewSection.getByText("Antigravity, Cursor, Claude Code, OpenCode, CommandCode, Codex, Pi, OMP")).toBeVisible();

    // Verify desktop table of contents has 11 sections
    const desktopToc = page.locator("aside nav");
    await expect(desktopToc.getByText("11 Sections")).toBeVisible();

    // Verify desktop links use theme class .doc-nav-link
    const tocLinks = page.locator(".doc-nav-link");
    expect(await tocLinks.count()).toBe(11);

    // Verify section switching updates active state
    const sdlcLink = tocLinks.filter({ hasText: "SDLC Lifecycle" });
    await sdlcLink.click();
    await expect(sdlcLink).toHaveClass(/active/);

    // Switch theme and verify theme attributes are active
    const themeFab = page.getByRole("button", { name: "Toggle Theme Selection Modal" });
    await themeFab.click();
    await page.getByText("Byakugan Deep Cyan").click();

    const dataTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(dataTheme).toBe('byakugan');

    // Test mobile responsive section menu at 375px viewport
    await page.setViewportSize({ width: 375, height: 667 });
    const mobilePillNav = page.locator("nav[aria-label='Mobile document sections']");
    await expect(mobilePillNav).toBeVisible();

    const mobilePillLinks = page.locator(".doc-pill-link");
    expect(await mobilePillLinks.count()).toBe(11);

    // Click a mobile pill link
    const mobileApiLink = mobilePillLinks.filter({ hasText: "Web API Reference" });
    await mobileApiLink.click();
    await expect(mobileApiLink).toHaveClass(/active/);

    expect(pageErrors).toEqual([]);
  });

  test("Context page displays active workspace profile and allows switching workspaces", async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.route("**/api/v1/projects/current*", async route => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          profile: {
            project_hash: "a1b2c3d4e5f6",
            project_name: "konoha-app",
            project_path: "/workspace/konoha-app",
            framework: "sveltekit",
            styling: "tailwind",
            package_manager: "pnpm",
            context_summary: "Always enforce pure light mode and zero AI slop"
          },
          memories: []
        })
      });
    });

    await page.route("**/api/v1/projects", async route => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          projects: [
            {
              project_hash: "a1b2c3d4e5f6",
              project_name: "konoha-app",
              project_path: "/workspace/konoha-app",
              framework: "sveltekit",
              context_summary: "Always enforce pure light mode and zero AI slop"
            },
            {
              project_hash: "b2c3d4e5f6a1",
              project_name: "portfolio-site",
              project_path: "/workspace/portfolio-site",
              framework: "nextjs",
              context_summary: "Portfolio site with 3D tilt"
            }
          ]
        })
      });
    });

    await page.goto("http://127.0.0.1:4173/context");

    // Verify Active Workspace Card
    await expect(page.getByText("Active Workspace")).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("heading", { name: "konoha-app" })).toBeVisible();
    await expect(page.getByText("/workspace/konoha-app").first()).toBeVisible();
    await expect(page.getByText("Framework: sveltekit")).toBeVisible();

    // Verify All Registered Workspaces section renders cards with Active badge and Switch button
    await expect(page.getByText("All Registered Workspaces (2)")).toBeVisible();
    await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Switch" })).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("Persona page displays memory type filters and does not render SOUL Authoritative Source card", async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.route("**/api/v1/soul", async route => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          title: "The Will of Fire Doctrine",
          path: "/home/user/.agents/SOUL.md",
          will_of_fire: "Where tree leaves dance, one shall find flames."
        })
      });
    });

    await page.goto("http://127.0.0.1:4173/persona");

    // Verify Memory Type Filter Buttons
    await expect(page.getByRole("button", { name: "All Types" })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: "Episodic (Learnings)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Strict Rules" })).toBeVisible();

    // Click Will of Fire (Village Soul) tab
    await page.getByRole("button", { name: "Will of Fire (Village Soul)" }).click();

    // Verify Will of Fire quote is visible
    await expect(page.getByText("Where tree leaves dance, one shall find flames.")).toBeVisible();

    // Verify that the Authoritative Source footer card is completely ABSENT
    await expect(page.getByText(/Authoritative Source:/i)).not.toBeVisible();
    await expect(page.getByText("Synced Across All Coding Clients")).not.toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("Agents page provides Model Assignment selector with discovered models and custom input", async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.route("**/api/v1/agents", async route => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            name: "jonin",
            title: "UI & Frontend",
            icon: "♦",
            model: null,
            skills: ["jonin-skill"]
          }
        ])
      });
    });

    await page.route("**/api/v1/skills*", async route => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([])
      });
    });

    await page.route("**/api/v1/bridges/models", async route => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          models: [
            { id: "claude-3-7-sonnet", model_name: "Claude 3.7 Sonnet", bridge: "claude", source: "client:claude" },
            { id: "deepseek-chat", model_name: "DeepSeek V3", bridge: "omp", source: "client:omp" }
          ],
          total: 2
        })
      });
    });

    await page.goto("http://127.0.0.1:4173/agents");

    // Verify Model Assignment is present and interactive (not blocked by missing bridge)
    await expect(page.getByText("Model Assignment").first()).toBeVisible({ timeout: 5000 });
    const modelSelect = page.locator("select").first();
    await expect(modelSelect).toBeVisible();

    // Verify options include discovered models
    await expect(modelSelect).toContainText("Claude 3.7 Sonnet (claude)");
    await expect(modelSelect).toContainText("Custom model string");

    expect(pageErrors).toEqual([]);
  });
});
