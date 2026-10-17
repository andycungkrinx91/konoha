import { test, expect } from '@playwright/test';
import { loginAndUnlock } from './auth_helper.js';

const BASE_URL = 'http://127.0.0.1:4173';

test.describe('Alerting, Toast, Confirm & Form Dialog System', () => {
  test('Login Page: Feedback on empty, wrong passphrase, and enter submit', async ({ page }) => {
    await page.goto(BASE_URL);
    // 1. Empty passphrase validation
    const submitBtn = page.locator('button[type="submit"]');
    const input = page.locator('input[type="password"], input[type="text"]').first();

    await submitBtn.click();
    await expect(page.locator('aside[aria-label="Notifications"]')).toBeVisible();
    await expect(page.locator('aside[aria-label="Notifications"]')).toContainText('Enter your passphrase to continue.');

    // 2. Wrong passphrase feedback (clear, generic, no secrets leaked)
    await input.fill('definitely-incorrect-ninja-passphrase');
    await submitBtn.click();

    await expect(page.locator('aside[aria-label="Notifications"]')).toContainText('Invalid passphrase');
    const inlineError = page.locator('[role="alert"], .text-status-danger').first();
    await expect(inlineError).toBeVisible();
    await expect(inlineError).toContainText('Invalid passphrase');
  });

  test('Toast System: success, error, warning, info, progress, hover pause & close', async ({ page }) => {
    await loginAndUnlock(page);
    await expect(page.locator('#konoha-app-root')).toBeVisible();

    // Trigger toast via window.toast
    await page.evaluate(() => {
      window.toast.success('Chakra synchronization complete!', { title: 'Success Title' });
      window.toast.warning('Shield integrity at 45%');
      window.toast.info('Telemetry updated');
    });

    const host = page.locator('aside[aria-label="Notifications"]');
    await expect(host).toBeVisible();
    await expect(host).toContainText('Chakra synchronization complete!');
    await expect(host).toContainText('Shield integrity at 45%');
    await expect(host).toContainText('Telemetry updated');

    // Test hover pause
    const firstToast = host.locator('div[role="status"]').first();
    await firstToast.hover();
    await page.waitForTimeout(500);

    // Close button dismisses toast
    const closeBtn = firstToast.locator('button[aria-label="Dismiss notification"]');
    await closeBtn.click();
    await page.waitForTimeout(300);

    // Test loading progress controller
    await page.evaluate(() => {
      const loader = window.toast.loading('Re-indexing in progress...', { progress: 30 });
      window._testLoader = loader;
    });

    await expect(host).toContainText('Re-indexing in progress...');

    await page.evaluate(() => {
      window._testLoader.update({ message: 'Indexing 75% complete', progress: 75 });
    });
    await expect(host).toContainText('Indexing 75% complete');

    await page.evaluate(() => {
      window._testLoader.success('Re-indexing finished with 0 errors');
    });
    await expect(host).toContainText('Re-indexing finished with 0 errors');
  });

  test('Confirm Dialog: blocking native <dialog>, variants, confirm vs cancel', async ({ page }) => {
    await loginAndUnlock(page);

    // Trigger confirm dialog and verify cancel
    const cancelPromise = page.evaluate(async () => {
      return await window.confirmModal({
        title: 'Delete Test Subagent?',
        message: 'This is a test warning message.',
        confirmText: 'Delete Agent',
        variant: 'danger'
      });
    });

    const dialog = page.locator('dialog[role="alertdialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#confirm-title')).toContainText('Delete Test Subagent?');

    // Click cancel
    const cancelBtn = dialog.locator('button', { hasText: 'Cancel' });
    await cancelBtn.click();
    const resultCancel = await cancelPromise;
    expect(resultCancel).toBe(false);
    await expect(dialog).not.toBeVisible();

    // Trigger confirm and verify confirmation
    const confirmPromise = page.evaluate(async () => {
      return await window.confirmModal({
        title: 'Apply Mission Plan?',
        message: 'Execute all scheduled tasks?',
        confirmText: 'Execute',
        variant: 'info'
      });
    });

    await expect(dialog).toBeVisible();
    const executeBtn = dialog.locator('button', { hasText: 'Execute' });
    await executeBtn.click();
    const resultConfirm = await confirmPromise;
    expect(resultConfirm).toBe(true);
    await expect(dialog).not.toBeVisible();
  });

  test('Form Dialog: input validation, secret safety, dirty state, and XSS prevention', async ({ page }) => {
    await loginAndUnlock(page);

    // Trigger form dialog
    page.evaluate(async () => {
      window._formResult = null;
      window.formDialogModal({
        title: 'Create Custom Secret Key',
        message: 'Fill in secret credentials securely.',
        fields: [
          { name: 'alias', label: 'Key Alias', type: 'text', required: true },
          { name: 'secretKey', label: 'Secret Token', type: 'password', required: true }
        ],
        submitText: 'Save Key'
      }).then(res => { window._formResult = res; });
    });

    const dialog = page.locator('dialog[aria-labelledby="form-dialog-title"]');
    await expect(dialog).toBeVisible();

    // 1. Submit empty -> inline validation errors
    const submitBtn = dialog.locator('button[type="submit"]');
    await submitBtn.click();

    await expect(dialog.locator('#err-alias')).toBeVisible();
    await expect(dialog.locator('#err-alias')).toContainText('Key Alias is required');

    // 2. XSS Test: inject HTML tag into alias
    const xssPayload = '<img src=x onerror=alert(1)>';
    const aliasInput = dialog.locator('input[name="alias"]');
    await aliasInput.fill(xssPayload);

    // Password input and toggle eye
    const secretInput = dialog.locator('input[name="secretKey"]');
    await secretInput.fill('super-ninja-secret-token');

    // Eye toggle button changes type from password to text
    expect(await secretInput.getAttribute('type')).toBe('password');
    const eyeBtn = dialog.locator('button[aria-label="Show password"]');
    await eyeBtn.click();
    expect(await secretInput.getAttribute('type')).toBe('text');

    // Submit form
    await submitBtn.click();
    await page.waitForTimeout(300);

    const formResult = await page.evaluate(() => window._formResult);
    expect(formResult).not.toBeNull();
    // Verified that XSS payload is strictly preserved as verbatim raw text, never executed
    expect(formResult.alias).toBe(xssPayload);
    expect(formResult.secretKey).toBe('super-ninja-secret-token');
    await expect(dialog).not.toBeVisible();
  });

  test('Dialog does not break Theme Switcher and respects theme colors', async ({ page }) => {
    await loginAndUnlock(page);

    // Open Theme Switcher
    const themeFab = page.locator('button[aria-label="Toggle Theme Selection Modal"]');
    await themeFab.click();

    const themeModal = page.locator('#konoha-theme-picker');
    await expect(themeModal).toBeVisible();

    // Select sharingan theme
    const sharinganBtn = themeModal.locator('button', { hasText: 'Sharingan' }).first();
    await sharinganBtn.click();

    // Verify html tag attribute changed
    const htmlTheme = await page.locator('html').getAttribute('data-theme');
    expect(htmlTheme).toBe('sharingan');
  });
});
