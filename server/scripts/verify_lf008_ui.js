import { chromium } from 'playwright';
import path from 'path';

async function testLF008UI() {
    console.log('🚀 Running Playwright E2E Verification for LF-008 Folding Chair...');
    const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() =>
        chromium.launch({ channel: 'msedge', headless: true })
    );
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
    console.log('✅ Navigated to homepage');

    // Upload 02. SCHEDULE OF LOOSE FURNITURE.pdf
    const pdfPath = path.resolve(process.cwd(), 'PDF', '02. SCHEDULE OF LOOSE FURNITURE.pdf');
    const fileInput = await page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(pdfPath);
    console.log('📁 Uploaded 02. SCHEDULE OF LOOSE FURNITURE.pdf');

    const extractBtn = page.locator('.pdm-extract').first();
    await extractBtn.waitFor({ state: 'visible', timeout: 5000 });
    await extractBtn.click();
    console.log('🚀 Clicked Extract and Consolidate button in PdfModelModal');

    await page.waitForSelector('table', { timeout: 90000 });
    console.log('📊 Table extracted and rendered!');

    // 1. Find and click Auto-Match on LF-008
    const lf008Row = page.locator('tr', { hasText: 'LF-008' }).first();
    await lf008Row.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);

    const matchBtn = lf008Row.locator('button[title*="AI Auto-Match"], button:has-text("✨")').first();
    await matchBtn.click();
    console.log('Clicked Auto-Match for LF-008. Waiting for match to resolve...');

    // Wait for the modal alternatives tab to have non-zero count
    await page.waitForFunction(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Value-Engineered Partner Alternatives'));
      return btn && !btn.textContent.includes('(0)');
    }, null, { timeout: 60000 });
    console.log('Match complete and alternatives populated!');
    await page.waitForTimeout(2000);

    await page.screenshot({
        path: 'C:/Users/Salam/.gemini/antigravity-ide/brain/3a7f1722-ce55-4fa5-83b8-6377175b67a3/14_lf008_automatch_modal.png'
    });
    console.log('📸 Captured 14_lf008_automatch_modal.png');

    // Click Alternatives Tab
    const altsTab = page.locator('button:has-text("Value-Engineered Partner Alternatives")').first();
    if (await altsTab.isVisible()) {
        await altsTab.click();
        await page.waitForTimeout(1500);
        await page.screenshot({
            path: 'C:/Users/Salam/.gemini/antigravity-ide/brain/3a7f1722-ce55-4fa5-83b8-6377175b67a3/15_lf008_alternatives_tab.png'
        });
        console.log('📸 Captured 15_lf008_alternatives_tab.png');
    }

    await browser.close();
    console.log('🎉 Verification complete!');
}

testLF008UI().catch(console.error);
