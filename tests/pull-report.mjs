import { chromium } from "playwright";

const LIVE_URL = "https://time-attendance-app-amber.vercel.app";

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto(LIVE_URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Click Reports
  await page.locator('button:has-text("Reports")').first().click();
  await page.waitForTimeout(3000);

  // Set date range to last few days (smaller = faster)
  const dateInputs = await page.locator('input[type="date"]').all();
  if (dateInputs.length >= 2) {
    await dateInputs[0].fill("2026-06-01");
    await dateInputs[1].fill("2026-06-08");
    await page.waitForTimeout(500);
  }

  // Queue Full Company Report (bypasses store matching issue)
  console.log("Queueing full company report...");
  await page.locator('button:has-text("Queue Full Company Report")').first().click();

  // Poll up to 120s for completion
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(2000);

    const bodyText = await page.locator("body").innerText();

    // Check for success
    if (bodyText.includes("Report generated successfully") || bodyText.includes("You can now export")) {
      console.log(`SUCCESS at ${i * 2}s`);
      // Print the status area
      const idx = bodyText.indexOf("Ready to send");
      if (idx >= 0) console.log(bodyText.substring(idx, idx + 400));
      break;
    }

    // Check for failure
    if (bodyText.includes("failed") || bodyText.includes("could not")) {
      console.log(`FAILED at ${i * 2}s:`);
      const idx = bodyText.indexOf("Ready to send");
      if (idx >= 0) console.log(bodyText.substring(idx, idx + 400));
      break;
    }

    // Log progress
    const queueMatch = bodyText.match(/Queue:.*/);
    const statusMatch = bodyText.match(/Desktop server[^.?!]*[.?!]/);
    if (i % 3 === 0) {
      if (queueMatch) console.log(`[${i * 2}s] ${queueMatch[0]}`);
      if (statusMatch) console.log(`[${i * 2}s] ${statusMatch[0]}`);
    }
  }

  // Check export button
  const exportBtn = page.locator('button:has-text("Export PDF")').first();
  const isEnabled = await exportBtn.isEnabled();
  console.log(`\nExport PDF enabled: ${isEnabled}`);

  if (isEnabled) {
    console.log("Exporting PDF...");
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 30000 }).catch(() => null),
      exportBtn.click(),
    ]);

    if (download) {
      const path = "tests/" + download.suggestedFilename();
      await download.saveAs(path);
      console.log(`PDF saved: ${path}`);
    } else {
      // Client-side blob export - just wait
      await page.waitForTimeout(5000);
      console.log("No download event — likely client-side blob export");
      
      // Check the status message for result
      const bodyText = await page.locator("body").innerText();
      const idx = bodyText.indexOf("Ready to send");
      if (idx >= 0) console.log(bodyText.substring(idx, idx + 400));
    }
  }

  await page.screenshot({ path: "tests/final-result.png" });
  console.log("Screenshot: tests/final-result.png");

  await page.waitForTimeout(3000);
  await browser.close();
}

main().catch(console.error);
