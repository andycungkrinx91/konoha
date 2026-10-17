/**
 * tests/e2e/auth_helper.js — Shared Playwright auth helper.
 * Uses Playwright's shared browser context request API for deterministic session establishment.
 */

import { expect } from '@playwright/test';

export async function loginAndUnlock(page) {
  // 1. Try login with secure password
  let res = await page.request.post("http://127.0.0.1:4173/api/v1/auth/login", {
    data: { password: "secure-shinobi-2026!" }
  });

  if (!res.ok()) {
    // 2. Try bootstrap password if not yet changed
    res = await page.request.post("http://127.0.0.1:4173/api/v1/auth/login", {
      data: { password: "konohagakure" }
    });
  }

  if (res.ok()) {
    const data = await res.json().catch(() => ({}));
    if (data.is_bootstrap && data.token) {
      // Complete mandatory password change so all subsequent routes are unlocked
      await page.request.post("http://127.0.0.1:4173/api/v1/auth/change-password", {
        data: {
          current_password: "konohagakure",
          new_password: "secure-shinobi-2026!"
        },
        headers: {
          'X-Konoha-Web-Token': data.token
        }
      });
    }
  }

  // 3. Navigate to dashboard and assert ready
  await page.goto("http://127.0.0.1:4173/dashboard");
  await expect(page.getByText("Mission Control Dashboard")).toBeVisible({ timeout: 15000 });
}
