import { chromium } from "playwright";

const LIVE_URL = "https://time-attendance-app-amber.vercel.app";

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  page.on("response", async (resp) => {
    const url = resp.url();
    if (url.includes("report-jobs-complete")) {
      console.log(`\nCOMPLETION ${resp.status()}: ${(await resp.text().catch(() => "")).substring(0, 200)}`);
    }
    if (url.includes("report-jobs?jobId=")) {
      try {
        const body = await resp.text();
        if (body.includes("complete") || body.includes("failed")) {
          console.log(`JOB_STATUS: ${body.substring(0, 500)}`);
        }
      } catch {}
    }
  });

  await page.goto(LIVE_URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(4000);

  await page.locator('button:has-text("Reports")').first().click();
  await page.waitForTimeout(4000);

  // Set date range
  const dateInputs = await page.locator('input[type="date"]').all();
  if (dateInputs.length >= 2) {
    await dateInputs[0].fill("2026-06-01");
    await dateInputs[1].fill("2026-06-08");
    await page.waitForTimeout(500);
  }

  // Queue Full Company Report
  await page.locator('button:has-text("Queue Full Company Report")').first().click();
  console.log("Queued full company report");

  // Poll for result
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(2000);
    const text = await page.locator("body").innerText();
    const queue = text.match(/Queue:\s*(.*)/);
    if (queue) {
      const status = queue[1];
      if (i % 5 === 0) console.log(`[${i * 2}s] ${status}`);
      
      // Check for completion
      if (status.includes("completed") || text.includes("Report generated successfully") || text.includes("download")) {
        console.log("REPORT COMPLETE!");
        break;
      }
      if (text.includes("failed") || text.includes("could not") || text.includes("no usable result")) {
        console.log("FAILED - checking state");
        const idx = text.indexOf("Remote bridge");
        if (idx >= 0) console.log(text.substring(idx, idx + 200));
        break;
      }
    }
  }

  // Try export
  const exportBtn = page.locator('button:has-text("Export PDF")').first();
  const enabled = await exportBtn.isEnabled().catch(() => false);
  console.log(`\nExport PDF enabled: ${enabled}`);

  if (enabled) {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }).catch(() => null),
      exportBtn.click(),
    ]);
    if (download) {
      await download.saveAs("tests/report.pdf");
      console.log("PDF DOWNLOADED: tests/report.pdf");
    }
  }

  await page.waitForTimeout(3000);
  await browser.close();
}

main().catch(console.error);
