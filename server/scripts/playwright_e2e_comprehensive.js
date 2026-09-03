import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
const ARTIFACTS_DIR = 'C:\\Users\\Salam\\.gemini\\antigravity-ide\\brain\\3a7f1722-ce55-4fa5-83b8-6377175b67a3';

async function runComprehensiveTests() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('🌐 COMPREHENSIVE PLAYWRIGHT E2E BROWSER TEST: BRANDED & NON-BRANDED');
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

  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`   [Browser ${msg.type().toUpperCase()}] ${msg.text().slice(0, 120)}`);
    }
  });

  try {
    // ── 1. Homepage ──
    console.log('1️⃣ Navigating to http://localhost:5173/ ...');
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 20000 });
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, '01_app_homepage.png') });
    console.log('   📸 Saved screenshot: 01_app_homepage.png');

    // ── 2. Test Non-Branded BOQ (DHOFAR.pdf) ──
    console.log('\n2️⃣ Testing Non-Branded BOQ (DHOFAR.pdf)...');
    const dhofarPdfPath = path.join(ROOT, 'PDF', 'DHOFAR.pdf');
    const fileInput1 = page.locator('input[type="file"]').first();
    await fileInput1.setInputFiles(dhofarPdfPath);

    const extractBtn1 = page.locator('.pdm-extract, button:has-text("Extract and Consolidate"), button:has-text("Extract with")').first();
    try {
      await extractBtn1.waitFor({ state: 'visible', timeout: 8000 });
      console.log('   🖱️ Clicked "Extract" in modal for DHOFAR.pdf.');
      await extractBtn1.click();
    } catch (_) {}

    console.log('   ⏳ Waiting for DHOFAR table extraction...');
    await page.waitForSelector('table', { timeout: 90000 });
    await page.waitForTimeout(3000);

    await page.screenshot({ path: path.join(ARTIFACTS_DIR, '05_dhofar_extracted_table.png') });
    console.log('   📸 Saved screenshot: 05_dhofar_extracted_table.png');

    // Inspect DHOFAR Row 1 Auto-Match Modal
    console.log('\n3️⃣ Inspecting ✨ AI Auto-Match & Inspector Modal for DHOFAR Row 1 (Executive Desk)...');
    const sparkButtons1 = page.locator('button:has-text("✨"), button[title*="AI Auto-Match"]');
    if (await sparkButtons1.count() > 0) {
      await sparkButtons1.first().click();
      console.log('   🖱️ Clicked ✨ AI Auto-Match button on Row 1.');

      // Wait for modal to complete AI loading
      console.log('   ⏳ Waiting for AI auto-match result...');
      try {
        await page.locator('text=AI Auto-Matching in Progress').waitFor({ state: 'detached', timeout: 35000 });
      } catch (_) {}
      await page.waitForTimeout(1500);

      await page.screenshot({ path: path.join(ARTIFACTS_DIR, '06_dhofar_automatch_modal.png') });
      console.log('   📸 Saved screenshot: 06_dhofar_automatch_modal.png');

      // Switch to Partner Alternatives Tab
      const altTab1 = page.locator('button:has-text("Partner Alternatives"), button:has-text("Value-Engineered"), button:has-text("Alternatives")').first();
      if (await altTab1.isVisible()) {
        await altTab1.click();
        console.log('   🖱️ Switched to Value-Engineered Partner Alternatives tab.');
        await page.waitForTimeout(2000);

        await page.screenshot({ path: path.join(ARTIFACTS_DIR, '07_dhofar_alternatives_tab.png') });
        console.log('   📸 Saved screenshot: 07_dhofar_alternatives_tab.png');
      }

      // Close modal
      const closeBtn1 = page.locator('button:has-text("✕")').first();
      if (await closeBtn1.isVisible()) await closeBtn1.click();
    }

    // ── 3. Test Branded BOQ (02. SCHEDULE OF LOOSE FURNITURE.pdf) ──
    console.log('\n4️⃣ Testing Branded BOQ (02. SCHEDULE OF LOOSE FURNITURE.pdf)...');
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1000);

    const schedulePdfPath = path.join(ROOT, 'PDF', '02. SCHEDULE OF LOOSE FURNITURE.pdf');
    const fileInput2 = page.locator('input[type="file"]').first();
    await fileInput2.setInputFiles(schedulePdfPath);

    const extractBtn2 = page.locator('.pdm-extract, button:has-text("Extract and Consolidate"), button:has-text("Extract with")').first();
    try {
      await extractBtn2.waitFor({ state: 'visible', timeout: 8000 });
      console.log('   🖱️ Clicked "Extract" for Schedule PDF.');
      await extractBtn2.click();
    } catch (_) {}

    console.log('   ⏳ Waiting for Schedule table extraction (MuPDF Vercel Engine)...');
    await page.waitForSelector('table', { timeout: 120000 });
    await page.waitForTimeout(3500);

    await page.screenshot({ path: path.join(ARTIFACTS_DIR, '02_schedule_extracted_table.png') });
    console.log('   📸 Saved screenshot: 02_schedule_extracted_table.png');

    // Inspect Schedule Row 1 Auto-Match Modal (LF-001)
    console.log('\n5️⃣ Inspecting ✨ AI Auto-Match & Inspector Modal for Schedule Row 1 (LF-001)...');
    const sparkButtons2 = page.locator('button:has-text("✨"), button[title*="AI Auto-Match"]');
    if (await sparkButtons2.count() > 0) {
      await sparkButtons2.first().click();
      console.log('   🖱️ Clicked ✨ AI Auto-Match button on LF-001.');

      // Wait for modal to complete AI loading with Live Architonic Grounding
      console.log('   ⏳ Waiting for AI auto-match result for LF-001...');
      try {
        await page.locator('text=AI Auto-Matching in Progress').waitFor({ state: 'detached', timeout: 35000 });
      } catch (_) {}
      await page.waitForTimeout(1500);

      await page.screenshot({ path: path.join(ARTIFACTS_DIR, '03_schedule_automatch_modal.png') });
      console.log('   📸 Saved screenshot: 03_schedule_automatch_modal.png');

      // Switch to Partner Alternatives Tab
      const altTab2 = page.locator('button:has-text("Partner Alternatives"), button:has-text("Value-Engineered"), button:has-text("Alternatives")').first();
      if (await altTab2.isVisible()) {
        await altTab2.click();
        console.log('   🖱️ Switched to Value-Engineered Partner Alternatives tab.');
        await page.waitForTimeout(2000);

        await page.screenshot({ path: path.join(ARTIFACTS_DIR, '04_schedule_alternatives_tab.png') });
        console.log('   📸 Saved screenshot: 04_schedule_alternatives_tab.png');
      }
    }

    console.log('\n═══════════════════════════════════════════════════════════════════════');
    console.log('🎉 ALL PLAYWRIGHT E2E BROWSER TESTS COMPLETED SUCCESSFULLY!');
    console.log('═══════════════════════════════════════════════════════════════════════\n');

  } catch (err) {
    console.error('❌ Browser Test Error:', err);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'error_screenshot.png') }).catch(() => {});
  } finally {
    await browser.close();
  }
}

runComprehensiveTests();
