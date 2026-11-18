import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testCredsPath = path.resolve(__dirname, '../../tests/helpers/test_auth_seed.json');
// Set by Konoha's live QA runner when the suite executes inside the Docker browser
// workspace: the app is already served from the host, and the image ships bundled
// Chromium rather than a system Chrome channel.
const IN_CONTAINER = process.env.KONOHA_PW_IN_CONTAINER === '1';
const BASE_URL = process.env.KONOHA_PW_BASE_URL || 'http://127.0.0.1:4173';
let TEST_BOOTSTRAP_PASSWORD = '';
try {
  const creds = JSON.parse(fs.readFileSync(testCredsPath, 'utf8'));
  if (creds.test_bootstrap_password) TEST_BOOTSTRAP_PASSWORD = creds.test_bootstrap_password;
} catch (_) {
  // Test credentials fixture optional in external environments
}

export default defineConfig({
  testDir: path.resolve(__dirname, '../../tests/e2e'),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: BASE_URL,
    headless: IN_CONTAINER ? false : (process.env.KONOHA_PW_HEADED === '1' && !process.env.CI ? false : undefined),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: process.env.KONOHA_PW_CHANNEL === 'bundled' ? undefined : 'chrome',
      },
    },
  ],
  // The container has no Node project root mounted for a second app server; the
  // caller serves the app and passes its reachable URL through KONOHA_PW_BASE_URL.
  webServer: IN_CONTAINER ? undefined : {
    command: 'node ../../src/web_server.js',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: '4173',
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      KONOHA_DISABLE_RATE_LIMIT: '1',
      KONOHA_AUTH_FILE: '/tmp/konoha_test_web_auth.json',
      KONOHA_DISABLE_TELEGRAM_POLLER: '1',
      KONOHA_CYCLES_SAMPLES: '4',
      KONOHA_BOOTSTRAP_PASSWORD: process.env.KONOHA_BOOTSTRAP_PASSWORD || TEST_BOOTSTRAP_PASSWORD || 'konohagakure'
    },
    timeout: 30000,
  },
});
