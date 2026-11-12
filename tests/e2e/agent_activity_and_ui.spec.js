import { test, expect } from '@playwright/test';
import { loginAndUnlock } from './auth_helper.js';

test.describe('Konoha v2.2.18 Agent Activity Spider, Bottom Dock & Hidden Menus', () => {
  test('Overview -> Agent Activity spider visualization, 180-degree flip, zoom/pan, node inspection, Bottom Dock, and hidden Yamanaka/3D Studio menus', async ({ page }) => {
    await loginAndUnlock(page);

    // Verify Yamanaka & 3D Studio remain hidden in the sidebar menu while Agent Activity is visible under Overview
    const sidebar = page.locator('aside');
    await expect(sidebar.getByText('Agent Activity')).toBeVisible();
    await expect(sidebar.getByText('Yamanaka 3D Studio')).toHaveCount(0);
    await expect(sidebar.getByText('3D Model Maker')).toHaveCount(0);

    // Bottom Dock is mobile-only by design (`lg:hidden`): hidden at desktop width, mounted below `lg`
    const dock = page.getByTestId('konoha-bottom-dock');
    await expect(dock).toBeHidden();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dock).toBeVisible();
    const dockActivityBtn = page.getByTestId('dock-item-activity');
    await expect(dockActivityBtn).toBeVisible();

    // Navigate to Agent Activity via Bottom Dock
    await dockActivityBtn.click();
    await expect(page).toHaveURL(/\/activity$/);
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.getByTestId('agent-activity-page')).toBeVisible();

    // Verify Spider SVG & live nodes render
    const spiderSvg = page.getByTestId('agent-activity-spider-svg');
    await expect(spiderSvg).toBeVisible();
    await expect(page.getByTestId('activity-node-agent:sannin')).toBeVisible();

    // Verify clicking the spider triggers the 180-degree flip animation & preserves network state
    const flipStatus = page.getByTestId('spider-flip-status');
    await expect(flipStatus).toContainText('UPRIGHT (0°)');

    const flipBtn = page.getByTestId('spider-flip-btn');
    await flipBtn.click();
    await expect(flipStatus).toContainText('INVERTED (180°)');
    await expect(flipStatus).toContainText('Flips: 1');

    // Click the spider core directly on the SVG canvas to flip back
    const spiderCore = page.getByTestId('interactive-spider-core');
    await spiderCore.click({ force: true });
    await expect(flipStatus).toContainText('UPRIGHT (0°)');
    await expect(flipStatus).toContainText('Flips: 2');

    // Verify Zoom In / Zoom Out / Reset View controls
    const zoomLabel = page.getByTestId('spider-zoom-level');
    await expect(zoomLabel).toHaveText('100%');
    await page.getByTestId('spider-zoom-in').click();
    await expect(zoomLabel).toHaveText('120%');
    await page.getByTestId('spider-reset-view').click();
    await expect(zoomLabel).toHaveText('100%');

    // Verify Node Inspection Drawer updates when clicking an agent node
    const kageNode = page.getByTestId('activity-node-agent:kage');
    if (await kageNode.count() > 0) {
      await kageNode.click({ force: true });
      await expect(page.getByTestId('inspector-node-label')).toContainText('@kage');
    }

    // Verify Accessible Table toggle works
    await page.getByTestId('view-mode-table').click();
    await expect(page.getByTestId('activity-accessible-table')).toBeVisible();
    await page.getByTestId('view-mode-spider').click();
    await expect(spiderSvg).toBeVisible();

    // Verify Yamanaka is also hidden on the Ninja Agents page while @sannin and @kage are visible
    await page.goto('http://127.0.0.1:4173/agents');
    // /agents hydrates its roster from the API, so the first paint is the empty shell.
    await expect(page.getByText('@sannin').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('@kage').first()).toBeVisible();
    await expect(page.getByText('@yamanaka')).toHaveCount(0);
  });
});
