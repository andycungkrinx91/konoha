import { expect } from '@playwright/test';
import fs from 'fs';

const E2E_BASE_URL = 'http://127.0.0.1:4173';

// Deletes the auth store and hardens it with a known password through the same
// bootstrap path the login page uses, so specs can exercise the sign-in form
// regardless of what a previous spec left behind.
export async function resetAuthToCustomPassword(page, password = 'secure-shinobi-2026!') {
  const authFile = process.env.KONOHA_AUTH_FILE || '/tmp/konoha_test_web_auth.json';
  try {
    if (fs.existsSync(authFile)) fs.unlinkSync(authFile);
  } catch (_) { /* fresh bootstrap is also valid */ }

  const { token } = await (await page.request.get(`${E2E_BASE_URL}/api/v1/csrf`)).json();
  const res = await page.request.post(`${E2E_BASE_URL}/api/v1/auth/setup-password`, {
    headers: { 'x-konoha-web-token': token },
    data: { new_password: password, confirm_password: password }
  });
  if (!res.ok()) throw new Error(`resetAuthToCustomPassword failed: ${res.status()} ${await res.text()}`);
}

export async function loginAndUnlock(page) {
  let isBootstrap = true;
  try {
    const statusRes = await page.request.get("http://127.0.0.1:4173/api/v1/auth/status");
    if (statusRes.ok()) {
      const statusData = await statusRes.json().catch(() => ({}));
      if (statusData.authenticated && !statusData.requires_password_change) {
        await page.goto("http://127.0.0.1:4173/dashboard");
        await expect(page.getByText("Mission Control Dashboard")).toBeVisible({ timeout: 15000 });
        return;
      }
      isBootstrap = statusData.is_bootstrap !== false;
    }
  } catch (_) {}

  const targetPassword = isBootstrap ? "konohagakure" : "secure-shinobi-2026!";
  const res = await page.request.post("http://127.0.0.1:4173/api/v1/auth/login", {
    data: { password: targetPassword }
  });

  if (res.ok()) {
    const data = await res.json().catch(() => ({}));
    if (data.is_bootstrap && data.token) {
      await page.request.post("http://127.0.0.1:4173/api/v1/auth/change-password", {
        data: {
          current_password: "konohagakure",
          new_password: "secure-shinobi-2026!"
        },
        headers: {
          'X-Konoha-Web-Token': data.token
        }
      });
      await page.request.post("http://127.0.0.1:4173/api/v1/auth/login", {
        data: { password: "secure-shinobi-2026!" }
      });
    }
  }

  await page.goto("http://127.0.0.1:4173/dashboard");
  await expect(page.getByText("Mission Control Dashboard")).toBeVisible({ timeout: 15000 });
}