import { chromium } from "playwright";

const LIVE_URL = "https://time-attendance-app-amber.vercel.app";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto(LIVE_URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Get page title
  const title = await page.title();
  console.log("PAGE TITLE:", title);

  // Get all visible text (first 3000 chars)
  const bodyText = await page.locator("body").innerText();
  console.log("\n--- PAGE TEXT (first 3000 chars) ---");
  console.log(bodyText.substring(0, 3000));

  // Get navigation buttons/text
  const allButtons = await page.locator("button, a, [role='button']").evaluateAll((els) =>
    els.slice(0, 40).map((el) => ({
      tag: el.tagName,
      text: (el.innerText || "").substring(0, 80),
      class: (el.className || "").substring(0, 100),
    }))
  );
  console.log("\n--- BUTTONS / LINKS ---");
  for (const b of allButtons) {
    if (b.text.trim()) console.log(`  ${b.tag}: "${b.text.trim()}"`);
  }

  // Take screenshot
  await page.screenshot({ path: "tests/live-app-screenshot.png", fullPage: false });
  console.log("\nScreenshot saved to tests/live-app-screenshot.png");

  await browser.close();
}

main().catch(console.error);
