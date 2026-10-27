'use strict';

/**
 * Shared Chromium Launcher & Interception Utilities
 */

let playwrightModule = null;

function getPlaywright() {
  if (!playwrightModule) {
    try {
      playwrightModule = require('playwright');
    } catch (_) {
      throw new Error('Playwright is required for browser rendering. Please run: pnpm add -D playwright');
    }
  }
  return playwrightModule;
}

/**
 * Launch Chromium with standard flags, optional custom executable path,
 * and graceful sandbox fallback if environment lacks setuid/namespace sandbox permissions.
 */
async function launchChromium(options = {}) {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
    const defaultPlaywrightDir = path.join(os.homedir(), '.cache', 'ms-playwright');
    if (!fs.existsSync(defaultPlaywrightDir)) {
      try {
        const realHome = (os.userInfo && os.userInfo().homedir) || process.env.USERPROFILE || '';
        const realCache = path.join(realHome, '.cache', 'ms-playwright');
        if (realHome && fs.existsSync(realCache)) {
          process.env.PLAYWRIGHT_BROWSERS_PATH = realCache;
        }
      } catch (_) { /* ignore */ }
    }
  }

  const playwright = getPlaywright();
  const chromePath = process.env.KONOHA_CHROME_PATH || null;
  const extraArgs = Array.isArray(options.extraArgs) ? options.extraArgs : [];

  const baseArgs = [
    '--disable-dev-shm-usage',
    '--disable-gpu',
    ...extraArgs
  ];

  const launchOpts = {
    headless: true,
    args: [...baseArgs]
  };

  if (chromePath) {
    launchOpts.executablePath = chromePath;
  }

  try {
    return await playwright.chromium.launch(launchOpts);
  } catch (err) {
    const msg = String(err.message || '');
    if (msg.includes('sandbox') || msg.includes('SUID') || msg.includes('EPERM')) {
      // Fallback: run with no-sandbox only when strictly required by host environment
      process.stderr.write('[konoha:chromium] Warning: falling back to --no-sandbox due to host environment constraints\n');
      return await playwright.chromium.launch({
        ...launchOpts,
        args: ['--no-sandbox', '--disable-setuid-sandbox', ...baseArgs]
      });
    }
    throw err;
  }
}

/**
 * Intercept outbound page requests to block non-local resources (external fonts, file://, ftp://).
 * Only data:, about:, and inline document requests are continued.
 */
async function setupOfflineInterception(page) {
  if (!page || typeof page.route !== 'function') return;
  await page.route('**', route => {
    const url = route.request().url().toLowerCase();
    if (url.startsWith('data:') || url.startsWith('about:') || url === 'about:blank') {
      return route.continue();
    }
    // Abort external network and file/ftp requests
    return route.abort();
  });
}

/**
 * Escape HTML special characters for document text blocks.
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  getPlaywright,
  launchChromium,
  setupOfflineInterception,
  escapeHtml
};
