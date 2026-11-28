import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import fs from 'fs';
import os from 'os';
import path from 'path';

const APP_URL = process.env.E2E_APP_URL || 'http://localhost:5173';
const STEP_TIMEOUT = 35000;
const AI_BATCH_TIMEOUT = 150000;

async function launchBrowser() {
  const candidates = [
    { label: 'msedge', opts: { channel: 'msedge', headless: true } },
    { label: 'chrome', opts: { channel: 'chrome', headless: true } },
    { label: 'chromium', opts: { headless: true } },
  ];
  let lastErr;
  for (const c of candidates) {
    try {
      const browser = await chromium.launch(c.opts);
      return { browser, label: c.label };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Could not launch any Chromium browser: ${lastErr?.message || lastErr}`);
}

async function createFixtures() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boqflow-e2e-'));
  const xlsxPath = path.join(tmpDir, 'e2e-boq-suite.xlsx');
  const pngPath = path.join(tmpDir, 'e2e-plan.png');

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Office & Fitout BOQ');
  ws.addRow(['S.N.', 'Scope', 'Description', 'Qty', 'Unit']);
  ws.addRow([1, 'Furniture', 'Herman Miller Aeron Ergonomic Mesh Task Chair with adjustable lumbar support and armrests', 10, 'Nos']);
  ws.addRow([2, 'Furniture', '4-Person Back-to-Back Linear Workstation Cluster 2400x1200mm with acoustic desk screens and mobile pedestals', 4, 'Set']);
  ws.addRow([3, 'Furniture', 'Executive L-Shape Manager Desk 2000x900mm walnut veneer top with side return credenza', 2, 'Nos']);
  ws.addRow([4, 'FITOUT', 'Acoustic Perforated Gypsum Board Suspended Ceiling 12.5mm thick with rockwool insulation', 120, 'SQM']);
  ws.addRow([5, 'Furniture', 'Custom curved reception counter terrazzo base with solid surface Corian top and LED strip 3600x900x1100mm', 1, 'Nos']);
  await wb.xlsx.writeFile(xlsxPath);

  // Valid 1x1 PNG
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  fs.writeFileSync(pngPath, Buffer.from(pngBase64, 'base64'));

  return { tmpDir, xlsxPath, pngPath };
}

function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

async function main() {
  const report = {
    startedAt: new Date().toISOString(),
    appUrl: APP_URL,
    browser: null,
    checks: {},
    pageErrors: [],
    consoleErrors: [],
    apiFailures: [],
  };

  const fixtures = await createFixtures();
  let browser;

  try {
    const launched = await launchBrowser();
    browser = launched.browser;
    report.browser = launched.label;
    console.log(`🌐 Launching Playwright (${launched.label}) against ${APP_URL}`);

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    page.on('pageerror', (err) => {
      report.pageErrors.push(err.message);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        report.consoleErrors.push(msg.text());
      }
    });
    page.on('response', (res) => {
      const url = res.url();
      const status = res.status();
      if (status >= 400 && (url.includes('localhost:5173') || url.includes('localhost:3001'))) {
        report.apiFailures.push({ status, url });
      }
    });

    // -------------------------------------------------------------------------
    // CHECK 1: Initial Landing & Catalog Load
    // -------------------------------------------------------------------------
    console.log('1️⃣  Check 1: Landing & Live Catalog Load...');
    const brandsResponsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/brands') && res.request().method() === 'GET',
      { timeout: STEP_TIMEOUT }
    ).catch(() => null);

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
    await page.locator('button[title="Settings"]').first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
    const brandsRes = await brandsResponsePromise;
    const brandsStatus = brandsRes ? brandsRes.status() : null;
    await page.waitForTimeout(800);

    const bodyText = await page.locator('body').innerText();
    assert(bodyText.includes('BOQ') && bodyText.includes('Upload BOQ'), 'Landing page missing BOQ FLOW hero / Upload BOQ button');
    report.checks.landing = {
      passed: true,
      brandsApiStatus: brandsStatus,
      hasUploadBoq: true,
    };
    console.log(`   ✅ Landing loaded (GET /api/brands => ${brandsStatus})`);

    // -------------------------------------------------------------------------
    // CHECK 2: System Configuration -> Brands & Database & Supabase Management
    // -------------------------------------------------------------------------
    console.log('2️⃣  Check 2: System Configuration -> Brands & Database & Supabase Management...');
    await page.locator('button[title="Settings"]').first().click();
    await page.getByText('System Configuration', { exact: false }).waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
    await page.getByText('Brands & Database', { exact: true }).click();

    await page.getByText('Add New Brand', { exact: false }).waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
    const startHarvestBtn = page.getByRole('button', { name: /Start Harvesting to Supabase/i });
    await startHarvestBtn.scrollIntoViewIfNeeded();
    await startHarvestBtn.waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
    const brandMgmtText = await page.locator('body').textContent();
    assert(/Supabase Native Engine/i.test(brandMgmtText), 'Missing Supabase Native Engine option');
    assert(/Supabase Scrape & Enrichment Queue/i.test(brandMgmtText), 'Missing Supabase Scrape & Enrichment Queue');
    assert(!/\brailway\b/i.test(brandMgmtText), 'Unexpected legacy Railway reference still visible in Settings UI');

    // Open Supabase Management Hub
    await page.locator('button:has-text("Supabase DB")').first().click();
    await page.getByRole('heading', { name: 'Supabase Management' }).waitFor({ state: 'visible', timeout: STEP_TIMEOUT });

    // Wait for initial loading spinner inside Supabase Management to clear
    await page.waitForFunction(() => {
      const h = Array.from(document.querySelectorAll('h2')).find(el => el.textContent?.includes('Supabase Management'));
      if (!h) return false;
      const modal = h.closest('[class*="container"]');
      return modal && !modal.textContent?.includes('Loading assets') && !modal.textContent?.includes('Loading brands');
    }, { timeout: STEP_TIMEOUT });

    const supabaseStats = await page.evaluate(() => {
      const h = Array.from(document.querySelectorAll('h2')).find(el => el.textContent?.includes('Supabase Management'));
      const modal = h.closest('[class*="container"]');
      const statCards = Array.from(modal.querySelectorAll('[class*="statCard"]'));
      const out = {};
      for (const card of statCards) {
        const label = card.querySelector('[class*="statLabel"]')?.textContent?.trim();
        const valText = card.querySelector('[class*="statValue"]')?.textContent?.trim();
        if (label) out[label.toLowerCase()] = Number(valText?.replace(/,/g, '') || 0);
      }
      const hasApiError = modal.textContent?.includes('Cannot reach backend API') || false;
      const assetImgs = Array.from(modal.querySelectorAll('[class*="assetCard"] img'));
      const loadedImgs = assetImgs.filter(img => img.complete && img.naturalWidth > 0).length;
      const assetCards = modal.querySelectorAll('[class*="assetCard"]').length;
      return { stats: out, hasApiError, assetCards, assetImgsCount: assetImgs.length, loadedImgs };
    });

    assert(!supabaseStats.hasApiError, 'Supabase Management showed API error banner');
    assert((supabaseStats.stats.brands || 0) >= 50, `Expected >= 50 brands, got ${supabaseStats.stats.brands}`);
    assert((supabaseStats.stats.products || 0) >= 2500, `Expected >= 2500 products, got ${supabaseStats.stats.products}`);
    assert((supabaseStats.stats.files || 0) >= 50, `Expected >= 50 storage files, got ${supabaseStats.stats.files}`);
    assert(supabaseStats.assetCards > 0, 'Expected > 0 storage asset cards');

    // Switch to Brand Database tab and test search
    await page.locator('button:has-text("Brand Database")').first().click();
    await page.waitForTimeout(400);
    const totalBrandCards = await page.locator('[class*="brandCard"]').count();
    assert(totalBrandCards >= 50, `Expected >= 50 brand cards, got ${totalBrandCards}`);

    const searchInput = page.locator('input[placeholder*="Search brands"]');
    await searchInput.fill('Sedus');
    await page.waitForTimeout(200);
    const sedusInfo = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[class*="brandCard"]'));
      return cards.map(c => ({
        name: c.querySelector('[class*="brandName"]')?.textContent?.trim(),
        products: Number(c.querySelector('[class*="brandStatValue"]')?.textContent?.trim() || 0),
      }));
    });
    assert(sedusInfo.length >= 1 && sedusInfo.some(b => /sedus/i.test(b.name || '') && b.products > 0), 'Sedus search in Brand Database returned no populated card');

    // Close Supabase Management
    await page.evaluate(() => {
      const h = Array.from(document.querySelectorAll('h2')).find(el => el.textContent?.includes('Supabase Management'));
      const modal = h?.closest('[class*="container"]');
      modal?.querySelector('button')?.click();
    });
    await page.waitForTimeout(250);
    // Close System Configuration by clicking overlay outside modal
    await page.mouse.click(12, 12);
    await page.getByText('System Configuration').waitFor({ state: 'hidden', timeout: 10000 }).catch(async () => {
      await page.mouse.click(10, 450);
      await page.getByText('System Configuration').waitFor({ state: 'hidden', timeout: 10000 });
    });

    report.checks.supabaseManagement = {
      passed: true,
      stats: supabaseStats.stats,
      storageAssetCards: supabaseStats.assetCards,
      storageThumbnailsLoaded: `${supabaseStats.loadedImgs}/${supabaseStats.assetImgsCount}`,
      brandCardsTotal: totalBrandCards,
      sedusSearchMatch: sedusInfo[0],
    };
    console.log(`   ✅ Supabase Management: Brands=${supabaseStats.stats.brands}, Products=${supabaseStats.stats.products}, Files=${supabaseStats.stats.files}, BrandCards=${totalBrandCards}`);

    // -------------------------------------------------------------------------
    // CHECK 3: BOQ Upload & Extraction -> TableViewer
    // -------------------------------------------------------------------------
    console.log('3️⃣  Check 3: BOQ Upload & Extraction -> TableViewer...');
    const uploadResponsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/upload') && res.request().method() === 'POST',
      { timeout: STEP_TIMEOUT }
    );
    const boqInput = page.locator('input[type="file"][accept*=".xlsx"]').first();
    await boqInput.setInputFiles(fixtures.xlsxPath);

    const uploadRes = await uploadResponsePromise;
    assert(uploadRes.status() === 200, `/api/upload returned HTTP ${uploadRes.status()}`);
    await page.locator('button:has-text("AI Value Engineer")').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });

    const tableText = await page.locator('body').innerText();
    for (const snippet of ['Herman Miller Aeron', '4-Person Back-to-Back', 'Executive L-Shape', 'Acoustic Perforated', 'Custom curved reception counter']) {
      assert(tableText.includes(snippet), `Extracted TableViewer missing row "${snippet}"`);
    }
    report.checks.boqUpload = {
      passed: true,
      uploadApiStatus: uploadRes.status(),
      extractedRowsVerified: 5,
    };
    console.log('   ✅ Uploaded .xlsx extracted into TableViewer (5/5 rows verified)');

    // -------------------------------------------------------------------------
    // CHECK 4: Value Engineering 1-Click Auto Detect AI + Costing
    // -------------------------------------------------------------------------
    console.log('4️⃣  Check 4: Value Engineering 1-Click Auto Detect AI + Costing...');
    await page.locator('button:has-text("AI Value Engineer")').click();
    await page.getByText('Value Engineered Offer', { exact: false }).waitFor({ state: 'visible', timeout: STEP_TIMEOUT });

    const autoDetectBtn = page.locator('button:has-text("AUTO DETECT AI")');
    await autoDetectBtn.waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
    assert(await autoDetectBtn.isEnabled(), 'AUTO DETECT AI button should be enabled for 5 workable rows');
    await autoDetectBtn.click();

    await page.getByText('VE Batch Complete', { exact: false }).waitFor({ state: 'visible', timeout: AI_BATCH_TIMEOUT });
    // Allow proxied brand images time to finish loading cleanly
    await page.waitForFunction(() => {
      const h = Array.from(document.querySelectorAll('[class*="title"]')).find(el => el.textContent?.includes('Value Engineered Offer'));
      const modal = h?.closest('[class*="modal"]');
      const imgs = Array.from(modal?.querySelectorAll('tbody tr td:nth-child(4) img[src]') || []);
      return imgs.length === 0 || imgs.every(img => img.complete);
    }, { timeout: 10000 }).catch(() => {});

    const veResults = await page.evaluate(() => {
      const h = Array.from(document.querySelectorAll('[class*="title"]')).find(el => el.textContent?.includes('Value Engineered Offer'));
      const modal = h?.closest('[class*="modal"]');
      const rows = Array.from(modal?.querySelectorAll('tbody tr') || []).filter(tr => !tr.className.includes('locationDivider') && tr.querySelectorAll('td').length >= 9);
      const readCell = (td) => {
        if (!td) return '';
        const inp = td.querySelector('input, textarea');
        return (inp ? inp.value : td.textContent)?.trim() || '';
      };
      return rows.map(tr => {
        const tds = tr.querySelectorAll('td');
        const brandImg = tds[3]?.querySelector('img');
        const rateText = readCell(tds[7]);
        const amountText = readCell(tds[8]);
        const selectionText = tds[9]?.textContent?.replace(/\s+/g, ' ').trim() || '';
        const selects = Array.from(tds[9]?.querySelectorAll('select') || []).map(s => s.options[s.selectedIndex]?.text || s.value).filter(Boolean);
        return {
          sl: tds[0]?.textContent?.trim(),
          desc: readCell(tds[2]).replace(/\s+/g, ' ').slice(0, 80),
          brandDesc: readCell(tds[4]).replace(/\s+/g, ' ').slice(0, 80),
          qty: readCell(tds[5]),
          unit: readCell(tds[6]),
          rate: rateText,
          amount: amountText,
          selection: (selects.length ? selects.join(' / ') + ' — ' : '') + selectionText.slice(0, 60),
          hasBrandImg: Boolean(brandImg),
          brandImgSrc: brandImg?.getAttribute('src') || null,
          brandImgLoaded: Boolean(brandImg && brandImg.complete && brandImg.naturalWidth > 0),
        };
      });
    });

    console.log('   📊 VE Match Results:');
    for (const r of veResults) {
      console.log(`      #${r.sl} | ${r.selection} | Rate=${r.rate} | ImgLoaded=${r.brandImgLoaded} | ${r.desc.slice(0, 48)}`);
    }

    const numericRate = (s) => {
      const n = parseFloat(String(s || '').replace(/[^0-9.]/g, ''));
      return Number.isFinite(n) ? n : 0;
    };
    const matchedRowsCount = veResults.filter(r => !/^Select Brand/i.test(r.selection)).length;
    assert(matchedRowsCount === 5, `Expected all 5/5 VE rows matched, got ${matchedRowsCount}/5`);

    const hermanRow = veResults.find(r => /Herman Miller/i.test(r.desc));
    assert(hermanRow && /Herman Miller/i.test(hermanRow.selection) && /Aeron/i.test(hermanRow.selection), `Branded chair should match Herman Miller Aeron, got ${hermanRow?.selection}`);
    assert(hermanRow.brandImgLoaded, 'Herman Miller Aeron image did not load cleanly');

    const workstationSetRow = veResults.find(r => /4-Person Back-to-Back/i.test(r.desc));
    assert(workstationSetRow && /3\/3 components/i.test(workstationSetRow.selection) && workstationSetRow.brandImgLoaded, `Workstation set mismatch: ${workstationSetRow?.selection}`);

    const lDeskSetRow = veResults.find(r => /Executive L-Shape/i.test(r.desc));
    assert(lDeskSetRow && /2\/2 components/i.test(lDeskSetRow.selection) && lDeskSetRow.hasBrandImg, `L-Shape Desk set mismatch: ${lDeskSetRow?.selection}`);

    const fitoutRow = veResults.find(r => /Acoustic Perforated/i.test(r.desc));
    assert(fitoutRow && /FitOut V2/i.test(fitoutRow.selection) && /Ceiling/i.test(fitoutRow.selection) && numericRate(fitoutRow.rate) > 0, `Fit-out ceiling should match FitOut V2 Ceiling Works with Rate > 0, got: ${fitoutRow?.selection} (Rate=${fitoutRow?.rate})`);

    const fabRow = veResults.find(r => /reception counter/i.test(r.desc));
    assert(fabRow && /Custom Fabrication/i.test(fabRow.selection) && numericRate(fabRow.rate) > 0, `Custom reception counter should match Custom Fabrication with Rate > 0, got: ${fabRow?.selection} (Rate=${fabRow?.rate})`);

    // Apply Costing & Review -> CostingModal -> Apply Costing -> Costed Results in TableViewer
    await page.locator('button:has-text("Apply Costing & Review")').click();
    await page.locator('button:has-text("Apply Costing")').last().waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
    await page.locator('button:has-text("Apply Costing")').last().click();

    await page.locator('#costed-results').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
    report.checks.valueEngineering = {
      passed: true,
      matchedRows: `${matchedRowsCount}/${veResults.length}`,
      rows: veResults,
      costedResultsVisible: true,
    };
    console.log(`   ✅ VE Auto-Match (${matchedRowsCount}/${veResults.length} matched across Branded, Sets, Fit-Out Ceiling, & Custom Fabrication) & Costed Results rendered`);

    // -------------------------------------------------------------------------
    // CHECK 5: Multi-Budget 3-Tier & AI Fitout
    // -------------------------------------------------------------------------
    console.log('5️⃣  Check 5: Multi-Budget 3-Tier (Budgetary / Mid / High / Comparison / Fitout)...');
    await page.locator('button:has-text("Multi Budget Offer")').click();
    await page.locator('button:has-text("AI FURNITURE")').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });

    // Open AutoFillSelectModal and select 1 brand per tier
    await page.locator('button:has-text("AI FURNITURE")').click();
    await page.getByRole('heading', { name: 'AI AutoFill' }).waitFor({ state: 'visible', timeout: STEP_TIMEOUT });

    const autoFillOverlay = page.getByRole('heading', { name: 'AI AutoFill' }).locator('xpath=ancestor::div[contains(@class,"modal")]');
    const tierTriggers = autoFillOverlay.locator('[class*="dropdownTrigger"]');
    const triggerCount = await tierTriggers.count();
    assert(triggerCount === 3, `Expected 3 tier brand dropdowns in AutoFillSelectModal, found ${triggerCount}`);

    const selectedTierBrands = [];
    const preferredBrandQueries = ['Ottimo', 'Sedus', 'Herman Miller'];
    for (let idx = 0; idx < 3; idx++) {
      await tierTriggers.nth(idx).click();
      const menu = autoFillOverlay.locator('[class*="dropdownMenu"]').last();
      await menu.waitFor({ state: 'visible', timeout: 5000 });
      const search = menu.locator('input[placeholder*="Search"]');
      await search.fill(preferredBrandQueries[idx]);
      await page.waitForTimeout(150);
      let firstOpt = menu.locator('[class*="option"]').first();
      if ((await firstOpt.count()) === 0) {
        await search.fill('');
        await page.waitForTimeout(150);
        firstOpt = menu.locator('[class*="option"]').first();
      }
      const chosenName = (await firstOpt.innerText()).trim();
      selectedTierBrands.push(chosenName);
      await firstOpt.click();
      await page.waitForTimeout(120);
    }

    const startBatchBtn = page.locator('button:has-text("Start AI Batch")');
    await startBatchBtn.waitFor({ state: 'visible', timeout: 5000 });
    assert(await startBatchBtn.isEnabled(), 'Start AI Batch should be enabled with 3 brands selected');
    await startBatchBtn.click();

    await page.getByText('Furniture Batch Complete', { exact: false }).waitFor({ state: 'visible', timeout: AI_BATCH_TIMEOUT });

    // Verify all 4 view tabs in Multi-Budget modal
    await page.locator('button:has-text("Budgetary")').first().click();
    await page.locator('button:has-text("Mid-Range")').first().click();
    await page.locator('button:has-text("High-End")').first().click();
    await page.locator('button:has-text("Comparison View")').first().click();
    await page.waitForTimeout(300);

    const compHeaders = await page.locator('th[class*="tierHeader"]').allInnerTexts();
    assert(compHeaders.length === 3, `Expected 3 Comparison View tier headers, got ${compHeaders.length}`);

    // Test AI FITOUT modal & execution for the [FITOUT] row
    await page.locator('button:has-text("AI FITOUT")').click();
    await page.getByRole('heading', { name: 'Fitout AI Match' }).waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
    const fitoutOverlay = page.getByRole('heading', { name: 'Fitout AI Match' }).locator('xpath=ancestor::div[contains(@class,"modal")]');
    await fitoutOverlay.locator('button:has-text("All")').first().click();
    const startFitoutBtn = fitoutOverlay.locator('button:has-text("Start Fitout AI Batch")');
    assert(await startFitoutBtn.isEnabled(), 'Start Fitout AI Batch should be enabled after clicking All');
    await startFitoutBtn.click();

    await page.getByText('Fitout Batch Complete', { exact: false }).waitFor({ state: 'visible', timeout: AI_BATCH_TIMEOUT });

    // Close MultiBudgetModal
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button')).filter(b => b.textContent?.trim() === '×' && b.className.includes('closeBtn'));
      btns.at(-1)?.click();
    });
    await page.waitForTimeout(250);

    report.checks.multiBudget = {
      passed: true,
      selectedTierBrands,
      comparisonHeaders: compHeaders.map(h => h.trim()),
      fitoutBatchCompleted: true,
    };
    console.log(`   ✅ Multi-Budget 3-Tier (${selectedTierBrands.join(' / ')}) + Comparison View + AI Fitout passed`);

    // -------------------------------------------------------------------------
    // CHECK 6: Plan Scope Modal & Design & Build Integration
    // -------------------------------------------------------------------------
    console.log('6️⃣  Check 6: Plan Scope Modal & Design & Build Trigger...');
    const designBuildBtn = page.locator('button:has-text("Design & Build"), button:has-text("Open in Design & Build")').first();
    await designBuildBtn.waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
    const dbText = (await designBuildBtn.innerText()).replace(/\s+/g, ' ').trim();

    // Return to Landing view and trigger the Floor Plan file input -> opens PlanScopeModal
    await page.locator('[class*="logoSmall"]').first().click();
    await page.locator('label:has-text("Floor Plan") input[type="file"]').waitFor({ state: 'attached', timeout: STEP_TIMEOUT });
    await page.locator('label:has-text("Floor Plan") input[type="file"]').setInputFiles(fixtures.pngPath);
    await page.getByRole('heading', { name: 'Extraction Scope' }).waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
    const scopeModalText = await page.getByRole('heading', { name: 'Extraction Scope' }).locator('xpath=ancestor::div[1]').locator('..').innerText();
    assert(scopeModalText.includes('Extraction Scope'), 'PlanScopeModal heading missing');

    // Close PlanScopeModal cleanly
    await page.evaluate(() => {
      const h = Array.from(document.querySelectorAll('h2')).find(el => el.textContent?.includes('Extraction Scope'));
      const modal = h?.parentElement;
      const close = modal?.querySelector('button');
      close?.click();
    });
    await page.waitForTimeout(250);

    report.checks.planAndDesignBuild = {
      passed: true,
      designBuildButtonVisible: dbText,
      planScopeModalOpened: true,
    };
    console.log(`   ✅ PlanScopeModal opened cleanly & Design & Build visible ("${dbText}")`);

    // -------------------------------------------------------------------------
    // FINAL ASSERTION: Zero fatal errors or internal 5xx responses
    // -------------------------------------------------------------------------
    const server5xx = report.apiFailures.filter(f => f.status >= 500);
    assert(report.pageErrors.length === 0, `Uncaught pageerrors detected: ${report.pageErrors.join(' | ')}`);
    assert(server5xx.length === 0, `Internal 5xx responses detected: ${JSON.stringify(server5xx)}`);

    report.finishedAt = new Date().toISOString();
    report.overall = 'PASSED';
    console.log('\n🎉 ALL 6 BROWSER E2E CHECKS PASSED');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (browser) await browser.close().catch(() => {});
    try {
      fs.rmSync(fixtures.tmpDir, { recursive: true, force: true });
    } catch { /* ignore cleanup errors */ }
  }
}

main().catch((err) => {
  console.error('\n❌ E2E SUITE FAILED:', err.message);
  process.exit(1);
});
