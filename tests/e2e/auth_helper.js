import { expect } from '@playwright/test';

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
