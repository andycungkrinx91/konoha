import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testCredsPath = path.resolve(__dirname, '../../tests/helpers/test_auth_seed.json');
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
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
      },
    },
  ],
  webServer: {
    command: 'node ../../src/web_server.js',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    env: {
      PORT: '4173',
      HOST: '127.0.0.1',
      KONOHA_AUTH_FILE: '/tmp/konoha_test_web_auth.json',
      KONOHA_DISABLE_TELEGRAM_POLLER: '1',
      KONOHA_BOOTSTRAP_PASSWORD: process.env.KONOHA_BOOTSTRAP_PASSWORD || TEST_BOOTSTRAP_PASSWORD
    },
    timeout: 30000,
  },
});
