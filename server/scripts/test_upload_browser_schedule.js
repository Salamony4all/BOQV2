import { chromium } from 'playwright';
import path from 'path';

async function run() {
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome'
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log('1. Navigating to http://localhost:5173...');
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });

  console.log('2. Uploading 02. SCHEDULE OF LOOSE FURNITURE.pdf...');
  const filePath = path.resolve('PDF/02. SCHEDULE OF LOOSE FURNITURE.pdf');
  const fileInput = await page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(filePath);
  await page.waitForTimeout(1000);

  const extractBtn = page.locator('.pdm-extract, button:has-text("Extract and Consolidate"), button:has-text("Extract with")').first();
  if (await extractBtn.isVisible()) {
    console.log('   🖱️ Clicking Extract button...');
    await extractBtn.click();
  }

  console.log('3. Waiting for table extraction to complete...');
  await page.waitForSelector('table', { timeout: 120000 });
  await page.waitForTimeout(4000);

  console.log('4. Capturing top rows screenshot...');
  await page.screenshot({ path: 'server/scripts/extracted_schedule_table_top.png', fullPage: false });

  console.log('5. Scrolling to LF-052 / LF-053...');
  const row52 = page.locator('tr:has-text("LF-052"), td:has-text("LF-052")').first();
  if (await row52.isVisible()) {
    await row52.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
  }

  console.log('6. Capturing LF-052 & LF-053 rows screenshot...');
  await page.screenshot({ path: 'server/scripts/extracted_schedule_table_row52_53.png', fullPage: false });

  console.log('✅ Screenshots saved successfully!');
  await browser.close();
}

run().catch(err => {
  console.error('❌ Playwright error:', err);
  process.exit(1);
});
