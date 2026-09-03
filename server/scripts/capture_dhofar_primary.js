import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
const ARTIFACTS_DIR = 'C:\\Users\\Salam\\.gemini\\antigravity-ide\\brain\\3a7f1722-ce55-4fa5-83b8-6377175b67a3';

async function captureDhofarPrimaryMatch() {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  try {
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 20000 });
    const dhofarPdfPath = path.join(ROOT, 'PDF', 'DHOFAR.pdf');
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(dhofarPdfPath);

    const extractBtn = page.locator('.pdm-extract, button:has-text("Extract and Consolidate"), button:has-text("Extract with")').first();
    try {
      await extractBtn.waitFor({ state: 'visible', timeout: 8000 });
      await extractBtn.click();
    } catch (_) {}

    await page.waitForSelector('table', { timeout: 90000 });
    await page.waitForTimeout(2000);

    const sparkButtons = page.locator('button:has-text("✨"), button[title*="AI Auto-Match"]');
    if (await sparkButtons.count() > 0) {
      await sparkButtons.first().click();
      // Wait for AI auto match result card to render (e.g. Apply button visible)
      await page.waitForSelector('button:has-text("Apply Matched Product to Row"), button:has-text("Quick Apply to Row")', { timeout: 15000 });
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(ARTIFACTS_DIR, '06_dhofar_automatch_modal.png') });
      console.log('📸 Updated 06_dhofar_automatch_modal.png with completed AI result card.');
    }
  } catch (e) {
    console.error('Capture error:', e);
  } finally {
    await browser.close();
  }
}

captureDhofarPrimaryMatch();
