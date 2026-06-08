import { chromium } from "playwright";

const LIVE_URL = "https://time-attendance-app-amber.vercel.app";

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  page.on("pageerror", (err) => console.log("PAGE ERROR:", err.message));

  await page.goto(LIVE_URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(4000);

  // Check the Coversheet page first - look for dates/attendance info
  const bodyText = await page.locator("body").innerText();
  
  // Find date-related info
  console.log("--- DATE/ATTENDANCE INFO ---");
  const lines = bodyText.split("\n");
  for (const line of lines) {
    if (line.match(/202[0-6]|[Aa]ttendance|[Rr]ecords*\s+\d+|[Ss]ync/)) {
      console.log(line.trim());
    }
  }

  // Click Reports
  await page.locator('button:has-text("Reports")').first().click();
  await page.waitForTimeout(4000);

  // There's likely a date picker or available dates list in ReportsBuilder
  // Check for any date-related selects or mentions
  const reportsText = await page.locator("body").innerText();
  console.log("\n--- REPORTS PAGE FIRST 800 CHARS ---");
  console.log(reportsText.substring(0, 800));

  // Check inputs
  const inputs = await page.locator("input, select").evaluateAll(els =>
    els.map(el => ({ type: el.type || el.tagName, val: el.value || "", ph: el.placeholder || "" }))
  );
  console.log("\n--- INPUTS ---");
  for (const i of inputs) console.log(JSON.stringify(i));

  // Set a much wider date range - try last 3 months
  const dateInputs = await page.locator('input[type="date"]').all();
  if (dateInputs.length >= 2) {
    await dateInputs[0].fill("2026-03-01");
    await dateInputs[1].fill("2026-06-08");
    await page.waitForTimeout(500);
    console.log("\nDate range: 2026-03-01 to 2026-06-08");
  }

  // Click Attendance Report template
  const attBtn = page.locator('button:has-text("Attendance Report")').first();
  if (await attBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await attBtn.click();
    await page.waitForTimeout(500);
  }

  // Select a store group
  const addAllBtns = await page.locator('button:has-text("Add all")').all();
  if (addAllBtns.length > 0) {
    await addAllBtns[0].click();
    await page.waitForTimeout(500);
  }

  // Click Generate
  for (const label of ["Generate Attendance Report", "Generate Report", "Generate"]) {
    const btn = page.locator(`button:has-text("${label}")`).first();
    const visible = await btn.isVisible({ timeout: 2000 }).catch(() => false);
    if (visible && !(await btn.isDisabled().catch(() => true))) {
      await btn.click();
      console.log(`\nClicked: "${label}"`);
      break;
    }
  }

  // Wait and check result
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(2000);
    const text = await page.locator("body").innerText();
    const genIdx = text.indexOf("Generated");
    if (genIdx >= 0) {
      const msg = text.substring(genIdx, genIdx + 300);
      console.log(`[${i * 2}s] ${msg}`);
      
      // Count if we got actual data
      if (text.includes("attendance report for") && !text.includes("No attendance")) {
        console.log("SUCCESS: Actual attendance data found!");
      }
      break;
    }
    if (text.includes("error")) {
      const errIdx = text.indexOf("error");
      console.log(`Error: ${text.substring(errIdx, errIdx + 200)}`);
      break;
    }
  }

  // Check export button
  const exportBtn = page.locator('button:has-text("Export PDF")').first();
  const enabled = await exportBtn.isEnabled().catch(() => false);
  console.log(`\nExport PDF enabled: ${enabled}`);

  await page.waitForTimeout(3000);
  await browser.close();
}

main().catch(console.error);
