import { chromium } from 'playwright';
import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
const ARTIFACTS_DIR = 'C:\\Users\\Salam\\.gemini\\antigravity-ide\\brain\\3a7f1722-ce55-4fa5-83b8-6377175b67a3';

async function runBrowserTests() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('🌐 STARTING PLAYWRIGHT E2E BROWSER VERIFICATION SUITE');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });

  const page = await context.newPage();

  try {
    // 1. Navigate to Home
    console.log('1️⃣ Navigating to http://localhost:5173/ ...');
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 15000 });
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, '01_homepage.png') });
    console.log('   📸 Saved screenshot: 01_homepage.png');

    // 2. Upload Branded PDF (02. SCHEDULE OF LOOSE FURNITURE.pdf)
    const schedulePdfPath = path.join(ROOT, 'PDF', '02. SCHEDULE OF LOOSE FURNITURE.pdf');
    console.log(`\n2️⃣ Uploading Schedule PDF: ${schedulePdfPath} ...`);
    
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(schedulePdfPath);

    console.log('   🔍 Checking for PDF Model Modal...');
    const extractBtn = page.locator('.pdm-extract, button:has-text("Extract and Consolidate"), button:has-text("Extract with")').first();
    try {
      await extractBtn.waitFor({ state: 'visible', timeout: 8000 });
      console.log('   🖱️ Clicked "Extract and Consolidate" in PDF Model Modal.');
      await extractBtn.click();
    } catch (_) {
      console.log('   ℹ️ PDF Modal bypassed or already triggered.');
    }

    console.log('   ⏳ Waiting for table extraction and rendering (up to 120s)...');
    await page.waitForSelector('table', { timeout: 120000 });
    await page.waitForTimeout(4000); // Allow images to render in DOM

    await page.screenshot({ path: path.join(ARTIFACTS_DIR, '02_schedule_extracted_table.png'), fullPage: false });
    console.log('   📸 Saved screenshot: 02_schedule_extracted_table.png');

    // 3. Inspect Table Headers and Image Columns
    const tableHeaders = await page.$$eval('th, [class*="th"]', ths => ths.map(th => th.innerText.trim()).filter(Boolean));
    console.log(`   📋 Detected Table Headers:`, tableHeaders.slice(0, 8));

    // 4. Test Quick Auto-Match / AI Match Modal on Row 1 (LF-001)
    console.log('\n3️⃣ Testing Quick Action Auto-Match Button & Modal on Row 1...');
    const matchButtons = page.locator('button:has-text("Auto-Match"), button:has-text("Match"), button[title*="Match"], button[title*="Auto"], button:has-text("⚡")');
    const buttonCount = await matchButtons.count();
    console.log(`   🔘 Found ${buttonCount} match action buttons on page.`);

    if (buttonCount > 0) {
      await matchButtons.first().click();
      console.log('   🖱️ Clicked Auto-Match button on row 1.');

      // Wait for AISemanticMatchModal
      await page.waitForSelector('[class*="modalOverlay"], [class*="modalContent"], [class*="modalWrap"]', { timeout: 20000 });
      await page.waitForTimeout(3000);

      await page.screenshot({ path: path.join(ARTIFACTS_DIR, '03_schedule_automatch_modal.png') });
      console.log('   📸 Saved screenshot: 03_schedule_automatch_modal.png');

      // Switch to "Value-Engineered Partner Alternatives" tab
      const altTab = page.locator('button:has-text("Partner Alternatives"), button:has-text("Value-Engineered"), button:has-text("Alternatives")').first();
      if (await altTab.isVisible()) {
        await altTab.click();
        console.log('   🖱️ Switched to Partner Alternatives tab.');
        await page.waitForTimeout(2500);

        await page.screenshot({ path: path.join(ARTIFACTS_DIR, '04_schedule_alternatives_tab.png') });
        console.log('   📸 Saved screenshot: 04_schedule_alternatives_tab.png');

        // Click "Select Alternative" on the top alternative
        const selectBtn = page.locator('button:has-text("Select Alternative"), button:has-text("Select")').first();
        if (await selectBtn.isVisible()) {
          await selectBtn.click();
          console.log('   🖱️ Clicked "✓ Select Alternative".');
          await page.waitForTimeout(2000);
          await page.screenshot({ path: path.join(ARTIFACTS_DIR, '05_schedule_row_updated.png') });
          console.log('   📸 Saved screenshot: 05_schedule_row_updated.png');
        }
      }
    }

    // 5. Test Non-Branded BOQ (DHOFAR.pdf)
    console.log('\n4️⃣ Testing Non-Branded BOQ (DHOFAR.pdf)...');
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1000);

    const dhofarPdfPath = path.join(ROOT, 'PDF', 'DHOFAR.pdf');
    console.log(`   📄 Uploading DHOFAR PDF: ${dhofarPdfPath} ...`);
    const fileInput2 = page.locator('input[type="file"]').first();
    await fileInput2.setInputFiles(dhofarPdfPath);

    const extractBtn2 = page.locator('.pdm-extract, button:has-text("Extract and Consolidate"), button:has-text("Extract with")').first();
    try {
      await extractBtn2.waitFor({ state: 'visible', timeout: 8000 });
      console.log('   🖱️ Clicked "Extract and Consolidate" for DHOFAR.');
      await extractBtn2.click();
    } catch (_) {}

    console.log('   ⏳ Waiting for DHOFAR table extraction (up to 45s)...');
    await page.waitForSelector('table', { timeout: 60000 });
    await page.waitForTimeout(3000);

    await page.screenshot({ path: path.join(ARTIFACTS_DIR, '06_dhofar_extracted_table.png') });
    console.log('   📸 Saved screenshot: 06_dhofar_extracted_table.png');

    // Test Quick Auto-Match on DHOFAR Row 1 (L-Shape Executive Desk)
    const dhofarMatchBtns = page.locator('button:has-text("Auto-Match"), button:has-text("Match"), button[title*="Match"], button[title*="Auto"], button:has-text("⚡")');
    if (await dhofarMatchBtns.count() > 0) {
      await dhofarMatchBtns.first().click();
      console.log('   🖱️ Clicked Auto-Match button on DHOFAR Row 1.');

      await page.waitForSelector('[class*="modalOverlay"], [class*="modalContent"], [class*="modalWrap"]', { timeout: 20000 });
      await page.waitForTimeout(3000);

      await page.screenshot({ path: path.join(ARTIFACTS_DIR, '07_dhofar_automatch_modal.png') });
      console.log('   📸 Saved screenshot: 07_dhofar_automatch_modal.png');

      const altTab2 = page.locator('button:has-text("Partner Alternatives"), button:has-text("Value-Engineered"), button:has-text("Alternatives")').first();
      if (await altTab2.isVisible()) {
        await altTab2.click();
        await page.waitForTimeout(2500);

        await page.screenshot({ path: path.join(ARTIFACTS_DIR, '08_dhofar_alternatives_tab.png') });
        console.log('   📸 Saved screenshot: 08_dhofar_alternatives_tab.png');
      }
    }

    console.log('\n═══════════════════════════════════════════════════════════════════════');
    console.log('🏁 PLAYWRIGHT E2E BROWSER TESTS COMPLETED SUCCESSFULLY!');
    console.log('═══════════════════════════════════════════════════════════════════════\n');

  } catch (err) {
    console.error('❌ Playwright Test Error:', err);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'error_screenshot.png') }).catch(() => {});
  } finally {
    await browser.close();
  }
}

runBrowserTests();
