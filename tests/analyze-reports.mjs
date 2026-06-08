import { chromium } from "playwright";

const LIVE_URL = "https://time-attendance-app-amber.vercel.app";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto(LIVE_URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Click Reports nav
  const reportsBtn = page.locator('button:has-text("Reports")').first();
  await reportsBtn.click();
  await page.waitForTimeout(3000);

  // Get reports page content
  const bodyText = await page.locator("body").innerText();
  console.log("\n--- REPORTS PAGE TEXT ---");
  console.log(bodyText.substring(0, 5000));

  // Get buttons on reports page
  const allButtons = await page.locator("button, a").evaluateAll((els) =>
    els.slice(0, 50).map((el) => ({
      text: (el.innerText || "").substring(0, 150).replace(/\s+/g, " ").trim(),
    }))
  );
  console.log("\n--- REPORTS BUTTONS ---");
  for (const b of allButtons) {
    if (b.text.trim()) console.log(`  "${b.text}"`);
  }

  // Screenshot
  await page.screenshot({ path: "tests/reports-page.png" });
  console.log("\nScreenshot: tests/reports-page.png");

  // Try to find date inputs, generate button, export button
  const inputs = await page.locator("input").evaluateAll((els) =>
    els.map((el) => ({
      type: el.type || "text",
      placeholder: el.placeholder || "",
      value: el.value || "",
      id: el.id || "",
    }))
  );
  console.log("\n--- INPUTS ---");
  for (const i of inputs) {
    console.log(`  type=${i.type} placeholder="${i.placeholder}" value="${i.value}"`);
  }

  await browser.close();
}

main().catch(console.error);
