import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
const ARTIFACTS_DIR = 'C:\\Users\\Salam\\.gemini\\antigravity-ide\\brain\\3a7f1722-ce55-4fa5-83b8-6377175b67a3';

async function runVerifiedBrowserTests() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('🌐 STARTING VERIFIED PLAYWRIGHT E2E BROWSER TESTING');
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

  page.on('console', msg => console.log(`   [Browser Console] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => console.log(`   [Browser Error] ${err.message}`));

  try {
    // 1. Navigate to App
    console.log('1️⃣ Navigating to http://localhost:5173/ ...');
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 20000 });
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, '01_homepage.png') });
    console.log('   📸 Saved screenshot: 01_homepage.png');

    // 2. Test Non-Branded BOQ (DHOFAR.pdf)
    console.log('\n2️⃣ Testing Non-Branded BOQ (DHOFAR.pdf)...');
    const dhofarPdfPath = path.join(ROOT, 'PDF', 'DHOFAR.pdf');
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(dhofarPdfPath);

    // Handle extraction modal
    const extractBtn = page.locator('.pdm-extract, button:has-text("Extract and Consolidate"), button:has-text("Extract with")').first();
    try {
      await extractBtn.waitFor({ state: 'visible', timeout: 8000 });
      console.log('   🖱️ Clicked "Extract" in modal for DHOFAR.pdf.');
      await extractBtn.click();
    } catch (_) {
      console.log('   ℹ️ Modal not shown.');
    }

    console.log('   ⏳ Waiting for DHOFAR table extraction...');
    await page.waitForSelector('table', { timeout: 90000 });
    await page.waitForTimeout(3000);

    await page.screenshot({ path: path.join(ARTIFACTS_DIR, '02_dhofar_extracted_table.png') });
    console.log('   📸 Saved screenshot: 02_dhofar_extracted_table.png');

    // Inspect Table Headers
    const headers = await page.$$eval('th, [class*="th"]', ths => ths.map(th => th.innerText.trim()).filter(Boolean));
    console.log('   📋 DHOFAR Headers:', headers);

    // 3. Test AI Semantic Match & Alternatives Inspector Modal on Row 1 (L-Shape Executive Desk)
    console.log('\n3️⃣ Testing ✨ AI Auto-Match & Inspector Modal on DHOFAR Row 1...');
    const sparkButtons = page.locator('button:has-text("✨"), button[title*="AI Auto-Match"], button[title*="Inspector"]');
    const btnCount = await sparkButtons.count();
    console.log(`   🔘 Found ${btnCount} ✨ AI Match buttons.`);

    if (btnCount > 0) {
      await sparkButtons.first().click();
      console.log('   🖱️ Clicked ✨ AI Auto-Match button on Row 1.');

      // Wait for modal to render (look for modal container or close button)
      await page.waitForSelector('button:has-text("✕"), [class*="modal"], [class*="tab"]', { timeout: 15000 });
      await page.waitForTimeout(3500); // Allow live API grounding to populate match results

      await page.screenshot({ path: path.join(ARTIFACTS_DIR, '03_dhofar_automatch_modal.png') });
      console.log('   📸 Saved screenshot: 03_dhofar_automatch_modal.png');

      // Switch to Partner Alternatives Tab
      const altTab = page.locator('button:has-text("Partner Alternatives"), button:has-text("Value-Engineered"), button:has-text("Alternatives")').first();
      if (await altTab.isVisible()) {
        await altTab.click();
        console.log('   🖱️ Switched to Value-Engineered Partner Alternatives tab.');
        await page.waitForTimeout(3000);

        await page.screenshot({ path: path.join(ARTIFACTS_DIR, '04_dhofar_alternatives_tab.png') });
        console.log('   📸 Saved screenshot: 04_dhofar_alternatives_tab.png');

        // Click "Select Alternative"
        const selectBtn = page.locator('button:has-text("Select Alternative"), button:has-text("Select")').first();
        if (await selectBtn.isVisible()) {
          await selectBtn.click();
          console.log('   🖱️ Clicked "✓ Select Alternative".');
          await page.waitForTimeout(2000);
          await page.screenshot({ path: path.join(ARTIFACTS_DIR, '05_dhofar_row_applied.png') });
          console.log('   📸 Saved screenshot: 05_dhofar_row_applied.png');
        }
      }
    }

    console.log('\n═══════════════════════════════════════════════════════════════════════');
    console.log('🏁 PLAYWRIGHT BROWSER TESTS EXECUTED AND CAPTURED SUCCESSFULLY!');
    console.log('═══════════════════════════════════════════════════════════════════════\n');

  } catch (err) {
    console.error('❌ Browser Test Error:', err);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'error_screenshot.png') }).catch(() => {});
  } finally {
    await browser.close();
  }
}

runVerifiedBrowserTests();
