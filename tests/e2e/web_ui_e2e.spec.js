import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

test.describe('Konoha Web UI End-to-End Suite', () => {
  test.beforeEach(async () => {
    try {
      if (fs.existsSync('/tmp/konoha_test_web_auth.json')) {
        fs.unlinkSync('/tmp/konoha_test_web_auth.json');
      }
    } catch (_) {}
  });

  test('Health check and CSRF endpoints respond cleanly', async ({ request }) => {
    const healthRes = await request.get('/api/v1/health');
    expect(healthRes.status()).toBe(200);
    const healthData = await healthRes.json();
    expect(healthData.status).toBe('healthy');

    const csrfRes = await request.get('/api/v1/csrf');
    expect(csrfRes.status()).toBe(200);
    const csrfData = await csrfRes.json();
    expect(typeof csrfData.token).toBe('string');
    expect(csrfData.token.length).toBeGreaterThan(10);
  });

  test('Authenticate with bootstrap credential konohagakure', async ({ request }) => {
    const csrfRes = await request.get('/api/v1/csrf');
    const { token } = await csrfRes.json();

    const loginRes = await request.post('/api/v1/auth/login', {
      headers: { 'x-konoha-web-token': token },
      data: { password: 'konohagakure' }
    });
    expect(loginRes.status()).toBe(200);
    const loginData = await loginRes.json();
    expect(loginData.ok).toBe(true);
    expect(loginData.sessionId).toBeTruthy();
    expect(loginData.is_bootstrap).toBe(true);
  });

  test('Documentation endpoint returns all 26 authoritative docs via type=documentation', async ({ request }) => {
    const csrfRes = await request.get('/api/v1/csrf');
    const { token } = await csrfRes.json();

    const loginRes = await request.post('/api/v1/auth/login', {
      headers: { 'x-konoha-web-token': token },
      data: { password: 'konohagakure' }
    });
    const loginData = await loginRes.json();
    const sessionId = loginData.sessionId;

    await request.post('/api/v1/auth/change-password', {
      headers: {
        'x-konoha-web-token': token,
        'Cookie': `konoha_session=${sessionId}`
      },
      data: {
        current_password: 'konohagakure',
        new_password: 'secure-shinobi-2026!'
      }
    });

    const reloginRes = await request.post('/api/v1/auth/login', {
      headers: { 'x-konoha-web-token': token },
      data: { password: 'secure-shinobi-2026!' }
    });
    const reloginData = await reloginRes.json();
    const newSessionId = reloginData.sessionId;

    const docsRes = await request.get('/api/v1/skills?type=documentation&limit=100', {
      headers: {
        'x-konoha-web-token': token,
        'Cookie': `konoha_session=${newSessionId}`
      }
    });
    expect(docsRes.status()).toBe(200);
    const docsData = await docsRes.json();
    expect(Array.isArray(docsData)).toBe(true);
    expect(docsData.length).toBe(26);

    const docNames = docsData.map(d => d.name);
    expect(docNames).toContain('doc:architecture');
    expect(docNames).toContain('doc:security');
    expect(docNames).toContain('doc:qa-test-checklist');
  });

  test('Web UI frontend page loads and serves app HTML cleanly', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Konoha/i);
    const bodyText = await page.textContent('body');
    expect(bodyText.length).toBeGreaterThan(50);
  });

  test('Konoha 2.2.18 Master Suite, Linter, Agent Activity Full-Screen & Spider Flip, Mobile-Only Dock', async ({ page }) => {
    test.setTimeout(240000);
    execFileSync(process.execPath, [path.join(REPO_ROOT, 'scripts/sync_skills.js')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 60000
    });
    execFileSync('pnpm', ['--dir', path.join(REPO_ROOT, 'apps/web'), 'run', 'build'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 60000
    });

    let masterOut = '';
    try {
      masterOut = execFileSync(process.execPath, [path.join(REPO_ROOT, 'tests/test_konoha_2_2_18_master.js')], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        timeout: 180000
      });
    } catch (err) {
      throw new Error(`master suite failed:\nSTDOUT:\n${err.stdout || ''}\nSTDERR_TAIL:\n${(err.stderr || '').slice(-600)}`);
    }
    expect(masterOut).toContain('ALL KONOHA 2.2.18 MASTER TESTS & BENCHMARKS PASSED');

    const lintOut = execFileSync(process.execPath, [path.join(REPO_ROOT, 'scripts/lint.js')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 30000
    });
    expect(lintOut).toContain('0 errors and 0 warnings');

    // Desktop viewport (1440x900): verify two-field initial password setup, BottomDock hidden on desktop, Agent Activity full-screen & spider 180 flip
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    // Verify the first-run setup form is the landing view with no default value shown
    await expect(page.getByTestId('first-run-setup-form')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#login-password')).toHaveCount(0);
    await expect(page.getByTestId('first-run-setup-toggle')).toHaveCount(0);

    await page.fill('#setup-new-password', 'secure-shinobi-2026!');
    await page.fill('#setup-confirm-password', 'secure-shinobi-2026!');
    await page.getByRole('button', { name: 'Initialize Password' }).click();

    await expect(page.locator('#login-password')).toBeVisible({ timeout: 10000 });
    await page.fill('#login-password', 'secure-shinobi-2026!');
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByText('Mission Control Dashboard')).toBeVisible({ timeout: 10000 });

    // Verify Overview embeds Agent Activity as a first-class section
    await expect(page.getByTestId('overview-agent-activity-section')).toBeVisible();

    // BottomDock must be hidden on desktop (1440x900)
    const bottomDock = page.getByTestId('konoha-bottom-dock');
    await expect(bottomDock).toBeHidden();

    // Yamanaka and 3D Studio must remain hidden in navigation
    const navText = await page.locator('body').innerText();
    expect(navText).not.toContain('3D Studio');

    // Navigate to Agent Activity page and verify Full Screen modal + Spider 180 flip + 6-state filter
    await page.goto('/activity');
    const stateFilter = page.getByTestId('activity-state-filter');
    await expect(stateFilter).toBeVisible({ timeout: 10000 });
    const fullScreenBtn = page.getByTestId('activity-fullscreen-btn');
    await expect(fullScreenBtn).toBeVisible({ timeout: 10000 });
    await fullScreenBtn.click();
    await expect(page.getByTestId('activity-fullscreen-modal')).toBeVisible();

    const spiderGroup = page.getByTestId('fullscreen-interactive-spider-core');
    await expect(spiderGroup).toBeVisible();
    await spiderGroup.click({ force: true });

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('activity-fullscreen-modal')).toHaveCount(0);

    // Mobile viewport (390x844): verify BottomDock is visible on mobile
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(bottomDock).toBeVisible();
  });
});
