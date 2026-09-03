import { chromium } from 'playwright';
import path from 'path';

async function verify() {
  console.log('🚀 Starting Playwright E2E Verification for Quick Action Alternatives...');
  const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => 
    chromium.launch({ channel: 'msedge', headless: true })
  );
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const ports = [5173, 5174];
  let connected = false;
  for (const port of ports) {
    try {
      await page.goto(`http://localhost:${port}`, { waitUntil: 'domcontentloaded', timeout: 5000 });
      console.log(`✅ Navigated to homepage on port ${port}`);
      connected = true;
      break;
    } catch (e) {
      console.log(`Port ${port} not ready, trying next...`);
    }
  }
  if (!connected) throw new Error('Could not connect to Vite dev server');

  // Upload 02. SCHEDULE OF LOOSE FURNITURE.pdf
  const pdfPath = path.resolve(process.cwd(), 'PDF', '02. SCHEDULE OF LOOSE FURNITURE.pdf');
  const fileInput = await page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(pdfPath);
  console.log('📁 Uploaded 02. SCHEDULE OF LOOSE FURNITURE.pdf');

  // Click extract button on PdfModelModal
  const extractBtn = page.locator('.pdm-extract').first();
  await extractBtn.waitFor({ state: 'visible', timeout: 5000 });
  await extractBtn.click();
  console.log('🚀 Clicked Extract and Consolidate button in PdfModelModal');

  // Wait for table to render
  await page.waitForSelector('table', { timeout: 90000 });
  console.log('📊 Table extracted and rendered!');
  await page.screenshot({ path: 'C:/Users/Salam/.gemini/antigravity-ide/brain/3a7f1722-ce55-4fa5-83b8-6377175b67a3/10_extracted_table_live.png' });

  // 1. Test LF-019 (Theater Seats)
  console.log('\n🎭 Testing LF-019 (Theater Seats)...');
  // 1. Test LF-019 (Theater Seats)
  console.log('\n🎭 Testing LF-019 (Theater Seats)...');
  const lf019Row = page.locator('tr', { hasText: 'LF-019' }).first();
  if (await lf019Row.count() > 0) {
    const autoMatchBtn = lf019Row.locator('button[title*="AI Auto-Match"], button:has-text("✨")').first();
    await autoMatchBtn.click();
    console.log('Clicked Auto-Match for LF-019. Waiting for alternatives tab count...');
    
    // Wait for the modal alternatives tab to have (4)
    const altsTab = page.locator('button:has-text("Value-Engineered Partner Alternatives")').first();
    await page.waitForFunction(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Value-Engineered Partner Alternatives'));
      return btn && !btn.textContent.includes('(0)');
    }, { timeout: 35000 });

    await altsTab.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'C:/Users/Salam/.gemini/antigravity-ide/brain/3a7f1722-ce55-4fa5-83b8-6377175b67a3/11_lf019_theater_seats_alternatives.png' });
    console.log('📸 Captured 11_lf019_theater_seats_alternatives.png');

    // Close modal
    const closeBtn = page.locator('button:has-text("✕")').first();
    if (await closeBtn.count() > 0) await closeBtn.click();
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
  }

  // 2. Test LF-023 (Armchair)
  console.log('\n🛋️ Testing LF-023 (Armchair)...');
  const lf023Row = page.locator('tr', { hasText: 'LF-023' }).first();
  if (await lf023Row.count() > 0) {
    const autoMatchBtn = lf023Row.locator('button[title*="AI Auto-Match"], button:has-text("✨")').first();
    const responsePromise = page.waitForResponse(r => r.url().includes('/api/ve-match-auto') && r.status() === 200, { timeout: 35000 });
    await autoMatchBtn.click();
    console.log('Clicked Auto-Match for LF-023. Waiting for AI response...');
    
    await responsePromise;
    await page.waitForTimeout(1000);

    const altsTab = page.locator('button:has-text("Value-Engineered Partner Alternatives")').first();
    if (await altsTab.count() > 0) {
      await altsTab.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: 'C:/Users/Salam/.gemini/antigravity-ide/brain/3a7f1722-ce55-4fa5-83b8-6377175b67a3/12_lf023_armchair_alternatives.png' });
      console.log('📸 Captured 12_lf023_armchair_alternatives.png');
    }
    const closeBtn = page.locator('button:has-text("✕")').first();
    if (await closeBtn.count() > 0) await closeBtn.click();
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
  }

  // 3. Test LF-066 (Student Chair)
  console.log('\n🎓 Testing LF-066 (Student Chair)...');
  const lf066Row = page.locator('tr', { hasText: 'LF-066' }).first();
  if (await lf066Row.count() > 0) {
    const autoMatchBtn = lf066Row.locator('button[title*="AI Auto-Match"], button:has-text("✨")').first();
    const responsePromise = page.waitForResponse(r => r.url().includes('/api/ve-match-auto') && r.status() === 200, { timeout: 35000 });
    await autoMatchBtn.click();
    console.log('Clicked Auto-Match for LF-066. Waiting for AI response...');
    
    await responsePromise;
    await page.waitForTimeout(1000);

    const altsTab = page.locator('button:has-text("Value-Engineered Partner Alternatives")').first();
    if (await altsTab.count() > 0) {
      await altsTab.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: 'C:/Users/Salam/.gemini/antigravity-ide/brain/3a7f1722-ce55-4fa5-83b8-6377175b67a3/13_lf066_student_chair_alternatives.png' });
      console.log('📸 Captured 13_lf066_student_chair_alternatives.png');
    }
    const closeBtn = page.locator('button:has-text("✕")').first();
    if (await closeBtn.count() > 0) await closeBtn.click();
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
  }

  await browser.close();
  console.log('\n🎉 E2E Verification Complete!');
}

verify().catch(e => {
  console.error('❌ E2E failed:', e);
  process.exit(1);
});
