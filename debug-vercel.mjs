import { chromium } from "playwright";

const URL = "https://time-attendance-app-amber.vercel.app";

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  const logs = [];
  page.on("console", (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => logs.push(`[PAGE ERROR] ${err.message}`));

  try {
    console.log("Opening Vercel app...");
    await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    // Click Reports tab
    console.log("Clicking Reports tab...");
    const reportsBtn = page.locator('button:has-text("Reports"), [role="tab"]:has-text("Reports")').first();
    await reportsBtn.click({ timeout: 5000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: "debug-reports-tab.png", fullPage: true });

    // Check for v2·guarded
    const bodyText = await page.textContent("body").catch(() => "");
    const hasBadge = bodyText.includes("v2·guarded");
    console.log(`\nv2·guarded badge in DOM: ${hasBadge}`);

    // Check page snippet around Remote Report
    const remoteIdx = bodyText.indexOf("Remote Report");
    if (remoteIdx >= 0) {
      console.log("Found 'Remote Report' text at index", remoteIdx);
      console.log("Context:", bodyText.slice(Math.max(0, remoteIdx - 20), remoteIdx + 100));
    } else {
      console.log("No 'Remote Report' text found on page");
    }

    // Print relevant console
    const relevant = logs.filter(l =>
      l.includes("ExportPDF") || l.includes("buildRemoteReportPdf") ||
      l.includes("PAGE ERROR") || l.includes("templateKey") ||
      l.includes("guarded") || l.includes("criteria")
    );
    console.log("\nRelevant console:", relevant.length);
    relevant.forEach(l => console.log("  ", l));

  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await browser.close();
    console.log("Done.");
  }
}

main();
