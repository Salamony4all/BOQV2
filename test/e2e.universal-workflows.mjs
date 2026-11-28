import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

const BOQFLOW_URL = process.env.E2E_APP_URL || 'http://localhost:5173';
const DESIGN_BUILD_URL = process.env.E2E_DB_URL || 'http://localhost:3003';
const SAMPLE_PDF = 'C:\\Users\\Salam\\App\\Design-And-Build-Stable-5d93e63\\apps\\design-build-editor\\public\\CODE_06.pdf';

const STEP_TIMEOUT = 45000;
const BUILD_3D_TIMEOUT = 150000;
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
  throw new Error(`Could not launch Chromium: ${lastErr?.message || lastErr}`);
}

async function createTempFixtures() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'universal-e2e-'));
  const dlDir = path.join(tmpDir, 'downloads');
  fs.mkdirSync(dlDir, { recursive: true });

  const boqPath = path.join(tmpDir, 'universal-boq-input.xlsx');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Main BOQ');
  ws.addRow(['S.N.', 'Scope', 'Description', 'Qty', 'Unit']);
  ws.addRow([1, 'Furniture', 'Herman Miller Aeron Ergonomic Mesh Task Chair with adjustable lumbar support', 8, 'Nos']);
  ws.addRow([2, 'Furniture', 'B&T Design Lamy Lounge Wood Swivel with Headrest upholstered chair', 4, 'Nos']);
  ws.addRow([3, 'FITOUT', 'Porcelain Floor Tile 600x600mm Matte Anti-Slip over screed', 50, 'Sqm']);
  ws.addRow([4, 'Furniture', 'Custom curved reception counter terrazzo base with solid surface Corian top 3200x850x1050mm', 1, 'Nos']);
  await wb.xlsx.writeFile(boqPath);

  return { tmpDir, dlDir, boqPath };
}

async function saveDownload(page, triggerFn, dlDir) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    triggerFn(),
  ]);
  const outPath = path.join(dlDir, download.suggestedFilename() || `dl-${Date.now()}`);
  await download.saveAs(outPath);
  const buf = fs.readFileSync(outPath);
  assert.ok(buf.length > 100, `Downloaded file ${outPath} should not be empty (${buf.length}B)`);
  return { filename: download.suggestedFilename(), path: outPath, buffer: buf };
}

function attachAuditors(page, report, scopeLabel) {
  page.on('pageerror', (err) => {
    report.pageErrors.push(`[${scopeLabel}] ${err.message}`);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      report.consoleErrors.push(`[${scopeLabel}] ${msg.text()}`);
    }
  });
  page.on('response', (res) => {
    const status = res.status();
    const url = res.url();
    if (status >= 500 && (url.includes('localhost:5173') || url.includes('localhost:3001') || url.includes('localhost:3003'))) {
      report.server5xx.push({ scope: scopeLabel, status, url });
    }
  });
}

async function runWorkflow1Standalone(browser, fixtures, report) {
  console.log('\n🚀 WORKFLOW 1: Standalone Design & Build (http://localhost:3003)...');
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  attachAuditors(page, report, 'standalone:3003');

  try {
    const providersReady = page.waitForResponse((r) => r.url().includes('/api/providers') && r.status() === 200, { timeout: 60000 }).catch(() => null);
    await page.goto(DESIGN_BUILD_URL, { waitUntil: 'load', timeout: 60000 });
    await providersReady;
    const trySampleBtn = page.getByRole('button', { name: /Try the sample plan/i });
    await trySampleBtn.waitFor({ state: 'visible', timeout: STEP_TIMEOUT });

    // Start sample geometric 3D build (CODE_06.pdf)
    const [mupdfReq] = await Promise.all([
      page.waitForRequest((r) => r.url().includes('/api/extraction/mupdf') && r.method() === 'POST', { timeout: 25000 }),
      trySampleBtn.click(),
    ]);
    assert.ok(mupdfReq, 'Try the sample plan did not trigger /api/extraction/mupdf');
    console.log('   ⏳ Extraction request started; waiting for CODE_06.pdf 3D geometric build...');
    const exportSuiteBtn = page.getByRole('button', { name: /Export suite/i });
    await exportSuiteBtn.waitFor({ state: 'visible', timeout: BUILD_3D_TIMEOUT });

    const readyText = await page.locator('aside[aria-label="Build summary"], aside[aria-label="Build progress"]').first().innerText();
    assert.ok(/Model ready/i.test(readyText), `Expected Model ready summary, got: ${readyText}`);
    await exportSuiteBtn.click();

    const exportRail = page.locator('aside[aria-label="Export project suite"]');
    await exportRail.waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
    const railTextBefore = await exportRail.innerText();
    assert.ok(/3D Pure Takeoff/i.test(railTextBefore) && /m²/i.test(railTextBefore), 'ExportRail missing 3D Pure Takeoff metrics');

    // Fill custom standalone metadata & test Post-Build inline BOQ edit
    await exportRail.locator('input[placeholder="Project Name"]').fill('Universal E2E Standalone Tower');
    await exportRail.locator('input[placeholder="Client Name"]').fill('Oman Aviation Group');
    await exportRail.locator('input[placeholder="Company / Contractor"]').fill('Apex Turnkey LLC');
    await exportRail.locator('input[title*="Contract duration"]').fill('75');

    await exportRail.getByRole('button', { name: /Edit BOQ/i }).click();
    const rateInput = exportRail.locator('input[title^="Rate"]').first();
    await rateInput.waitFor({ state: 'visible', timeout: 10000 });
    await rateInput.fill('250');
    await page.waitForTimeout(150);

    // 1. BOQ Excel
    const boqXlsx = await saveDownload(page, () => exportRail.getByRole('button', { name: /BOQ Excel/i }).click(), fixtures.dlDir);
    const boqWb = new ExcelJS.Workbook();
    await boqWb.xlsx.load(boqXlsx.buffer);
    const boqWs = boqWb.getWorksheet('Detailed BOQ');
    assert.ok(boqWs, 'BOQ Excel missing "Detailed BOQ" worksheet');
    assert.ok(String(boqWs.getCell(1, 1).value).includes('Universal E2E Standalone Tower'), 'BOQ Excel missing custom Project Name');

    // 2. Project Plan (.xlsx)
    const planXlsx = await saveDownload(page, () => exportRail.getByRole('button', { name: /Project Plan \(\.xlsx\)/i }).click(), fixtures.dlDir);
    const planWb = new ExcelJS.Workbook();
    await planWb.xlsx.load(planXlsx.buffer);
    const planSheets = planWb.worksheets.map((w) => w.name);
    assert.equal(planSheets.length, 10, `Expected 10 planner sheets, got ${planSheets.length}`);
    assert.ok(planSheets[0].startsWith('Dashboard'), `Unexpected first sheet: ${planSheets[0]}`);

    // 3. MS Project (.xml)
    const msXml = await saveDownload(page, () => exportRail.getByRole('button', { name: /MS Project \(\.xml\)/i }).click(), fixtures.dlDir);
    const xmlStr = msXml.buffer.toString('utf8');
    assert.ok(xmlStr.includes('xmlns="http://schemas.microsoft.com/project"'), 'Missing MSPDI namespace');
    assert.ok(xmlStr.includes('<Tasks>') && xmlStr.includes('<PredecessorLink>') && xmlStr.includes('Universal E2E Standalone Tower'));

    // 4. Full Design & Build Package ZIP
    const fullZip = await saveDownload(page, () => exportRail.getByRole('button', { name: /Download Full Design & Build ZIP/i }).click(), fixtures.dlDir);
    const zip = await JSZip.loadAsync(fullZip.buffer);
    const zipPaths = Object.keys(zip.files).filter((p) => !zip.files[p].dir);
    const mustHaveSuffixes = [
      'BOQ/Detailed_BOQ.xlsx',
      'BOQ/BOQ_Summary.pdf',
      'Submittals/MAS.pdf',
      'Submittals/MIR.pdf',
      'Submittals/WIR.pdf',
      'Submittals/Delivery_Note.pdf',
      'Programme/Action_and_Project_Plan.xlsx',
      'Programme/MS_Project_Schedule.xml',
      'Presentation/Design_and_Build_Presentation.pptx',
      'FF&E/FF&E_Schedule.xlsx',
      'FF&E/Mood_Board.pdf',
      'Drawings/Source_Drawing.pdf',
      'Model/Pascal_Scene.json',
      'Reports/Extraction_Audit.pdf',
    ];
    for (const suffix of mustHaveSuffixes) {
      const entryName = zipPaths.find((p) => p.endsWith(`/${suffix}`) || p === suffix);
      assert.ok(entryName, `Standalone Full ZIP missing ${suffix} (got: ${zipPaths.join(', ')})`);
      const bytes = await zip.files[entryName].async('nodebuffer');
      assert.ok(bytes.length > 300, `ZIP entry ${entryName} unexpectedly small (${bytes.length}B)`);
    }

    const sceneEntry = zipPaths.find((p) => p.endsWith('Model/Pascal_Scene.json'));
    const sceneJson = JSON.parse(await zip.files[sceneEntry].async('string'));
    const leakedPilot = Object.values(sceneJson).filter((n) => n && typeof n === 'object' && n.pilotExcluded === true);
    assert.equal(leakedPilot.length, 0, 'Pilot excluded nodes must not appear in Pascal_Scene.json');

    report.checks.workflow1Standalone = {
      passed: true,
      boqRowsEdited: true,
      boqExcelBytes: boqXlsx.buffer.length,
      plannerSheets: planSheets.length,
      msProjectXmlBytes: msXml.buffer.length,
      fullZipEntries: zipPaths.length,
    };
    console.log(`   ✅ Workflow 1 passed (${zipPaths.length} ZIP entries verified, 10 planner sheets, valid MSPDI XML & Post-Build BOQ)`);
  } finally {
    await context.close().catch(() => {});
  }
}

async function runWorkflow2Integrated(browser, fixtures, report) {
  console.log('\n🚀 WORKFLOW 2: Integrated BOQFLOW -> Design & Build -> Post-Build BOQ -> Export Suite...');
  assert.ok(fs.existsSync(SAMPLE_PDF), `Missing fixture PDF: ${SAMPLE_PDF}`);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  attachAuditors(page, report, 'boqflow:5173');

  try {
    await page.goto(BOQFLOW_URL, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
    const boqInput = page.locator('input[type="file"][accept*=".xlsx"]').first();
    await boqInput.waitFor({ state: 'attached', timeout: STEP_TIMEOUT });
    await boqInput.setInputFiles(fixtures.boqPath);

    const veBtn = page.locator('button:has-text("AI Value Engineer")');
    await veBtn.waitFor({ state: 'visible', timeout: STEP_TIMEOUT });

    // Run VE Auto-Match across Chair, Armchair, FitOut Tile, and Custom Fabrication
    await veBtn.click();
    const autoDetect = page.locator('button:has-text("AUTO DETECT AI")');
    await autoDetect.waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
    await autoDetect.click();
    await page.getByText('VE Batch Complete', { exact: false }).waitFor({ state: 'visible', timeout: AI_BATCH_TIMEOUT });
    console.log('   ✅ VE Auto-Match completed on 4 cross-division items');

    await page.locator('button:has-text("Apply Costing & Review")').click();
    await page.locator('button:has-text("Apply Costing")').last().click();
    await page.locator('#costed-results').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });

    // Verify Offer documents directly in TableViewer
    const tvPlan = await saveDownload(page, () => page.getByRole('button', { name: 'Project Plan (.xlsx)' }).click(), fixtures.dlDir);
    const tvPlanWb = new ExcelJS.Workbook();
    await tvPlanWb.xlsx.load(tvPlan.buffer);
    assert.equal(tvPlanWb.worksheets.length, 10, 'TableViewer Project Plan should contain 10 sheets');

    const tvXml = await saveDownload(page, () => page.getByRole('button', { name: 'MS Project (.xml)' }).click(), fixtures.dlDir);
    assert.ok(tvXml.buffer.toString('utf8').includes('xmlns="http://schemas.microsoft.com/project"'), 'TableViewer XML missing MSPDI namespace');

    const tvMas = await saveDownload(page, () => page.getByRole('button', { name: 'MAS', exact: true }).click(), fixtures.dlDir);
    assert.ok(tvMas.buffer.subarray(0, 5).toString('utf8').startsWith('%PDF-'), 'TableViewer MAS output is not a valid PDF');
    console.log('   ✅ TableViewer Offer documents verified (10-sheet Project Plan, MS Project XML, MAS PDF)');

    // Open Design & Build with CODE_06.pdf
    const dbTrigger = page.locator('button:has-text("Design & Build"), button:has-text("Open in Design & Build")').first();
    await dbTrigger.waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
    await dbTrigger.scrollIntoViewIfNeeded();
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 15000 }),
      dbTrigger.click(),
    ]);
    await fileChooser.setFiles(SAMPLE_PDF);

    const dialog = page.locator('section[role="dialog"][aria-label="Design & Build"]');
    await dialog.waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
    console.log('   ⏳ Waiting for embedded 3D build + furnishing...');

    // Wait until Enrich BOQ (3D) appears (proves model is ready + takeoff received) and furnishing status settles
    const enrichBtn = dialog.getByRole('button', { name: 'Enrich BOQ (3D)' });
    await enrichBtn.waitFor({ state: 'visible', timeout: BUILD_3D_TIMEOUT });
    await page.waitForFunction(() => {
      const dlg = document.querySelector('section[role="dialog"][aria-label="Design & Build"]');
      return dlg && /Furnished ·/i.test(dlg.textContent || '');
    }, { timeout: 45000 }).catch(() => {});

    const statusLine = await dialog.innerText();
    const hasPhotoNotice = /shown by their own photo|with photos|custom item/i.test(statusLine) || (await dialog.locator('img[src]').count()) > 0;
    assert.ok(hasPhotoNotice, 'Expected DesignBuildDock product legend/status to show product photo references');

    // Step 2: Enrich BOQ (3D) -> verify quantity update (Porcelain 50 -> measured slab m²) & missing surfaces -> Apply
    await enrichBtn.click();
    const enrichDialog = page.locator('aside[role="dialog"][aria-label="Post-Building Geometric BOQ Enrichment"]');
    await enrichDialog.waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
    const enrichText = await enrichDialog.innerText();
    assert.ok(/Net Floor Slab/i.test(enrichText) && /m²/i.test(enrichText), 'Enrich modal missing 3D floor slab measurement');
    assert.ok(/Quantity Synchronizations \([1-9]/i.test(enrichText), `Expected >=1 quantity sync (50 -> 3D slab m²), got: ${enrichText.slice(0, 300)}`);
    assert.ok(/Missing 3D Architectural Surfaces \([1-9]/i.test(enrichText), 'Expected >=1 missing 3D architectural surface');

    await enrichDialog.getByRole('button', { name: /Apply 3D Measured Quantities to BOQ/i }).click();
    await enrichDialog.waitFor({ state: 'hidden', timeout: 15000 });
    await dialog.getByText('BOQ Enriched', { exact: false }).waitFor({ state: 'visible', timeout: 15000 });
    console.log('   ✅ Post-Build 3D Geometric BOQ Enrichment applied back to BOQFLOW');

    // Step 5: Integrated Export Suite (all 8 available folders without requiring paid AI render!)
    await dialog.getByRole('button', { name: /Export suite/i }).first().click();
    const exportPanel = page.locator('aside[role="dialog"][aria-label="Design & Build export suite"]');
    await exportPanel.waitFor({ state: 'visible', timeout: STEP_TIMEOUT });

    const suiteZip = await saveDownload(
      page,
      () => exportPanel.getByRole('button', { name: /Download package \(\.zip\)/i }).click(),
      fixtures.dlDir,
    );
    const szip = await JSZip.loadAsync(suiteZip.buffer);
    const szipPaths = Object.keys(szip.files).filter((p) => !szip.files[p].dir);
    const expectedPatterns = [
      /BOQ\/.*\.pdf$/i,
      /BOQ\/.*\.xlsx$/i,
      /Submittals\/.*MAS.*\.pdf$/i,
      /Submittals\/.*MIR.*\.pdf$/i,
      /Submittals\/.*WIR.*\.pdf$/i,
      /Submittals\/.*Delivery.*\.pdf$/i,
      /Programme\/Action_and_Project_Plan\.xlsx$/i,
      /Programme\/MS_Project_Schedule\.xml$/i,
      /Drawings\/Source_Drawing\.pdf$/i,
      /Presentation\/Design_and_Build_Presentation\.pptx$/i,
      /FF&E\/FF&E_Schedule\.xlsx$/i,
      /FF&E\/Mood_Board\.pdf$/i,
      /Model\/Pascal_Scene\.json$/i,
      /Reports\/Extraction_Audit\.pdf$/i,
    ];
    for (const rx of expectedPatterns) {
      const hit = szipPaths.find((p) => rx.test(p));
      assert.ok(hit, `Integrated Suite ZIP missing pattern ${rx} (entries: ${szipPaths.join(', ')})`);
    }

    const pptxEntry = szipPaths.find((p) => /Presentation\/Design_and_Build_Presentation\.pptx$/i.test(p));
    const pptxZip = await JSZip.loadAsync(await szip.files[pptxEntry].async('nodebuffer'));
    const slideXmls = await Promise.all(
      Object.keys(pptxZip.files)
        .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
        .map((k) => pptxZip.files[k].async('string')),
    );
    const joinedSlides = slideXmls.join('\n');
    assert.ok(!joinedSlides.includes('Furniture &amp; products'), 'Presentation still contains legacy mixed "Furniture & products" heading');
    assert.ok(
      joinedSlides.includes('1. Loose Furniture (FF&amp;E)') || joinedSlides.includes('3. Architectural Fit-Out &amp; MEP Finishes'),
      'Presentation missing separated division headings',
    );

    report.checks.workflow2Integrated = {
      passed: true,
      boqEnriched: true,
      suiteZipEntries: szipPaths.length,
    };
    console.log(`   ✅ Workflow 2 passed (Enrich BOQ + Full ${szipPaths.length}-file Integrated Export Suite verified)`);
  } finally {
    await context.close().catch(() => {});
  }
}

async function main() {
  const report = {
    startedAt: new Date().toISOString(),
    checks: {},
    pageErrors: [],
    consoleErrors: [],
    server5xx: [],
  };
  const fixtures = await createTempFixtures();
  let browser;
  try {
    const launched = await launchBrowser();
    browser = launched.browser;
    report.browser = launched.label;
    console.log(`🌐 Launching Playwright (${launched.label}) for Universal Workflow E2E...`);

    await runWorkflow1Standalone(browser, fixtures, report);
    await runWorkflow2Integrated(browser, fixtures, report);

    assert.equal(report.pageErrors.length, 0, `Uncaught pageErrors: ${report.pageErrors.join(' | ')}`);
    assert.equal(report.server5xx.length, 0, `HTTP 5xx errors: ${JSON.stringify(report.server5xx)}`);

    report.finishedAt = new Date().toISOString();
    report.overall = 'PASSED';
    console.log('\n🎉 UNIVERSAL E2E SUITE PASSED');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { fs.rmSync(fixtures.tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

main().catch((err) => {
  console.error('\n❌ UNIVERSAL E2E FAILED:', err);
  process.exit(1);
});
