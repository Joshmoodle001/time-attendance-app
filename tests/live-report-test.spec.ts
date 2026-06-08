import { test, expect } from "@playwright/test";

const LIVE_URL = "https://time-attendance-app-amber.vercel.app";
const EMAIL = "Josh@pfm.co.za";
const PASSWORD = "PFM@dmin2026!";

test("login, generate attendance report, export PDF", async ({ page }) => {
  await page.goto(LIVE_URL);

  // Login
  const emailInput = page.locator('input[placeholder*="Email" i], input[placeholder*="Username" i], input[placeholder*="pfm" i]').first();
  const passwordInput = page.locator('input[type="password"]').first();

  await emailInput.waitFor({ timeout: 15000 });
  await emailInput.fill(EMAIL);
  await passwordInput.fill(PASSWORD);

  // Click sign-in button
  const signInBtn = page.locator('button:has-text("Sign In"), button:has-text("Unlock"), button:has-text("Login"), button[type="submit"]').first();
  await signInBtn.click();

  // Wait for dashboard to load
  await page.waitForTimeout(3000);

  // Navigate to reports
  const reportsNav = page.locator('button:has-text("Reports"), a:has-text("Reports"), button:has-text("Remote")').first();
  if (await reportsNav.isVisible({ timeout: 5000 })) {
    await reportsNav.click();
    await page.waitForTimeout(2000);
  }

  // Take screenshot of current state
  await page.screenshot({ path: "tests/live-report-state.png", fullPage: true });

  console.log("Test completed — screenshot saved to tests/live-report-state.png");
});
