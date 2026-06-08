import { chromium } from "playwright";

const LIVE_URL = "https://time-attendance-app-amber.vercel.app";

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") logs.push("CONSOLE ERROR: " + msg.text());
  });
  page.on("pageerror", (err) => logs.push("PAGE ERROR: " + err.message));

  await page.goto(LIVE_URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(4000);

  // Click Reports nav
  await page.locator('button:has-text("Reports")').first().click();
  await page.waitForTimeout(4000);

  const bodyText = await page.locator("body").innerText();
  console.log("PAGE:", bodyText.substring(bodyText.indexOf("Report Builder"), bodyText.indexOf("Report Builder") + 300));

  // Set date range
  const dateInputs = await page.locator('input[type="date"]').all();
  if (dateInputs.length >= 2) {
    await dateInputs[0].fill("2026-06-01");
    await dateInputs[1].fill("2026-06-08");
    await page.waitForTimeout(500);
  }

  // Click "Attendance Report" template button
  const attBtn = page.locator('button:has-text("Attendance Report")').first();
  if (await attBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await attBtn.click();
    await page.waitForTimeout(500);
    console.log("Selected Attendance Report template");
  }

  // Select a small store group - click "Checkers FNW" Add all
  const addAllBtns = await page.locator('button:has-text("Add all")').all();
  if (addAllBtns.length > 0) {
    await addAllBtns[0].click();
    await page.waitForTimeout(500);
    console.log("Added first store group");
  }

  // Find and click the actual "Generate Report" button (the button in ReportsBuilder)
  const allButtons = await page.locator("button").evaluateAll((els) =>
    els.map((el) => ({
      text: el.innerText?.trim(),
      disabled: el.disabled,
    })).filter(b => b.text && (b.text.includes("Generate") || b.text.includes("Export") || b.text.includes("Print")))
  );
  console.log("\n--- REPORT BUTTONS ---", JSON.stringify(allButtons, null, 2));

  // Click the generate button - it might be "Generate Report" or similar
  for (const label of ["Generate Report", "Generate", "Run"]) {
    const btn = page.locator(`button:has-text("${label}")`).first();
    const visible = await btn.isVisible({ timeout: 2000 }).catch(() => false);
    if (visible && !(await btn.isDisabled())) {
      await btn.click();
      console.log(`Clicked: "${label}"`);
      break;
    }
  }

  // Wait for report to generate
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(2000);
    const text = await page.locator("body").innerText();
    
    const genIdx = text.indexOf("Generated");
    if (genIdx >= 0) {
      console.log(`[${i * 2}s] ${text.substring(genIdx, genIdx + 250)}`);
      
      // Check for export button
      const exportBtn = page.locator('button:has-text("Export")').first();
      const enabled = await exportBtn.isEnabled().catch(() => false);
      if (enabled) {
        console.log("Export button is ENABLED!");
        break;
      }
    }

    if (text.includes("error") || text.includes("Error")) {
      const errIdx = text.indexOf("Error");
      console.log(`Error: ${text.substring(errIdx, errIdx + 200)}`);
      break;
    }
  }

  // Try export
  const exportBtns = await page.locator('button:has-text("Export")').all();
  console.log(`\nExport buttons found: ${exportBtns.length}`);
  for (const btn of exportBtns) {
    const enabled = await btn.isEnabled().catch(() => false);
    const text = await btn.innerText().catch(() => "");
    console.log(`  "${text}" enabled=${enabled}`);
    if (enabled) {
      // Click it
      await btn.click();
      console.log(`Clicked export button`);
      await page.waitForTimeout(5000);
      break;
    }
  }

  // Also try the "Print" button version
  const printBtn = page.locator('button:has-text("Print")').first();
  if (await printBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log(`Print button: enabled=${await printBtn.isEnabled()}`);
  }

  await page.screenshot({ path: "tests/reports-final.png" });
  console.log("\nScreenshot: tests/reports-final.png");

  if (logs.length > 0) {
    console.log("\n--- CONSOLE ERRORS ---");
    for (const l of logs) console.log(l);
  }

  await page.waitForTimeout(3000);
  await browser.close();
}

main().catch(console.error);
