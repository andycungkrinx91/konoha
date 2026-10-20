/**
 * tests/e2e/auth_helper.js — Shared Playwright auth helper.
 * Uses Playwright's shared browser context request API for deterministic session establishment.
 */

import { expect } from '@playwright/test';

export async function loginAndUnlock(page) {
  // 1. Query auth status to determine active credential mode without blind failure attempts
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
  let res = await page.request.post("http://127.0.0.1:4173/api/v1/auth/login", {
    data: { password: targetPassword }
  });

  if (!res.ok()) {
    const fallbackPassword = isBootstrap ? "secure-shinobi-2026!" : "konohagakure";
    res = await page.request.post("http://127.0.0.1:4173/api/v1/auth/login", {
      data: { password: fallbackPassword }
    });
  }

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

  // 3. Navigate to dashboard and assert ready
  await page.goto("http://127.0.0.1:4173/dashboard");
  const dashboardHeading = page.getByText("Mission Control Dashboard");
  const isDashboardVisible = await dashboardHeading.isVisible().catch(() => false);
  if (!isDashboardVisible) {
    const pwdInput = page.locator("#login-password");
    if (await pwdInput.isVisible().catch(() => false)) {
      await pwdInput.fill("secure-shinobi-2026!");
      await page.getByRole("button", { name: "Login" }).click();
      if (await page.getByText("Invalid password").isVisible().catch(() => false)) {
        await pwdInput.fill("konohagakure");
        await page.getByRole("button", { name: "Login" }).click();
      }
      await page.waitForTimeout(500);
      if (page.url().includes("/login") || page.url().endsWith(":4173/")) {
        await page.goto("http://127.0.0.1:4173/dashboard");
      }
    }
  }
  await expect(page.getByText("Mission Control Dashboard")).toBeVisible({ timeout: 15000 });
}
