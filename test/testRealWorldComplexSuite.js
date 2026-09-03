/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  REAL-WORLD COMPLEX SUITE BENCHMARK                                     │
 * │  Testing real-world Spec Sheets, Cut Sheets, Quotations, Presentation   │
 * │  Decks, Multi-Level Furniture Schedules, and Delivery/Invoice BOQs      │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { extractMultiplePdfsV21 } from '../server/universalPatternParsersVercel.v22.dynamic-header-boq-spec.js';
import fs from 'fs';
import path from 'path';

const REAL_WORLD_COMPLEX_DOCS = [
  {
    name: 'OQHQ_9080_L0_Furniture_Schedule_T2.pdf',
    dir: 'PDF_Round2',
    category: 'Multi-Card Furniture Spec Schedule (Level 0)',
    type: 'specsheet_schedule'
  },
  {
    name: 'OQHQ_9081_L1_Furniture_Schedule_T2.pdf',
    dir: 'PDF_Round2',
    category: 'Multi-Card Furniture Spec Schedule (Level 1)',
    type: 'specsheet_schedule'
  },
  {
    name: '23060-MDO-PLV-XXX-SCH-ID-700002_MATERIAL_SPECIFICATION.pdf',
    dir: 'PDF_Round2',
    category: 'Architectural Material Specification Deck',
    type: 'specsheet_deck'
  },
  {
    name: 'VVIP_Material_Schedule.pdf',
    dir: 'PDF_Round2',
    category: 'VVIP Presidential Interior Material Schedule',
    type: 'presentation_spec'
  },
  {
    name: '21203-ID-SCH-1HT-HT-70002_Furniture_Schedule.pdf',
    dir: 'PDF_Round2',
    category: 'Hospitality Hotel Furniture Cut-Sheet Schedule',
    type: 'cutsheet_schedule'
  },
  {
    name: 'Offer For Loose Furniture - Muscat University - R0 - Opt 1- European - Aladrak.pdf',
    dir: 'PDF',
    category: 'Commercial Quotation & Product Presentation (Option 1)',
    type: 'quote_presentation'
  },
  {
    name: 'Offer For Loose Furniture - Muscat University - R0 - Opt 2 - FAR EAST- Aladrak.pdf',
    dir: 'PDF',
    category: 'Commercial Quotation & Product Presentation (Option 2)',
    type: 'quote_presentation'
  },
  {
    name: 'ALSHAYA_OCC_Oman_2900_24120260035_1_180226-122004.pdf',
    dir: 'PDF',
    category: 'Corporate OCC Fit-Out Spec Book & Cut Sheets',
    type: 'cutsheet_specbook'
  },
  {
    name: 'OCC_#A_NATIONAL ARCHIEVE_QUOTE_AS.pdf',
    dir: 'PDF',
    category: 'National Archive Formal Quotation / Invoice',
    type: 'invoice_quote'
  },
  {
    name: 'AL MAZYOUNAH.pdf',
    dir: 'PDF',
    category: 'Municipality Tender BOQ with Embedded Photos',
    type: 'municipality_boq'
  }
];

async function runComplexBenchmark() {
  console.log('═══════════════════════════════════════════════════════════════════════════════════');
  console.log('🚀 [Real-World Complex Document Benchmark]');
  console.log('   Evaluating Spec Sheets, Cut Sheets, Product Presentations, Invoices & Schedules');
  console.log('═══════════════════════════════════════════════════════════════════════════════════\n');

  const scorecard = [];
  let passed = 0;
  let total = 0;

  for (const doc of REAL_WORLD_COMPLEX_DOCS) {
    const fullPath = path.resolve(doc.dir, doc.name);
    if (!fs.existsSync(fullPath)) {
      console.log(`⚠️ Skipping (file not found): ${fullPath}`);
      continue;
    }

    total++;
    console.log(`▶ [${total}] Processing: "${doc.name}"`);
    console.log(`    Category: ${doc.category} (${doc.type})`);
    console.log(`    File Size: ${(fs.statSync(fullPath).size / (1024 * 1024)).toFixed(2)} MB`);

    const startTime = Date.now();
    try {
      const result = await extractMultiplePdfsV21([fullPath], () => {});
      const elapsed = Date.now() - startTime;

      if (!result || !result.tables || result.tables.length === 0) {
        console.error(`    ❌ FAILED: No tables extracted.`);
        scorecard.push({
          name: doc.name,
          category: doc.category,
          status: 'FAILED',
          reason: 'No table extracted',
          timeMs: elapsed
        });
        continue;
      }

      const table = result.tables[0];
      const rowCount = table.rows?.length || 0;
      const colCount = table.header?.length || 0;
      const imageCount = (table.rows || []).reduce((acc, r) => {
        const imgCell = r.cells?.find((c, i) => /image/i.test(table.header[i] || ''));
        const images = Array.isArray(imgCell?.value) ? imgCell.value : (imgCell?.value ? [imgCell.value] : []);
        return acc + images.length;
      }, 0);

      const headersStr = (table.header || []).join(' | ');

      console.log(`    ✅ RESULT (${elapsed}ms): Extracted ${rowCount} items, ${colCount} columns, ${imageCount} paired images`);
      console.log(`       Headers: ${headersStr}`);
      if (table.rows && table.rows[0]) {
        console.log(`       Sample Item: ${table.rows[0].cells.map(c => typeof c.value === 'string' ? c.value : JSON.stringify(c.value)).filter(Boolean).slice(0, 4).join(' — ')}`);
      }

      passed++;
      scorecard.push({
        index: total,
        name: doc.name,
        category: doc.category,
        status: 'PASSED',
        rows: rowCount,
        columns: colCount,
        images: imageCount,
        timeMs: elapsed
      });
    } catch (err) {
      console.error(`    ❌ ERROR:`, err.message);
      scorecard.push({
        index: total,
        name: doc.name,
        category: doc.category,
        status: 'ERROR',
        reason: err.message
      });
    }
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════════');
  console.log(`📊 COMPLEX SUITE SCORECARD: ${passed}/${total} Documents Transformed into Tabled BOQs (${((passed / total) * 100).toFixed(0)}%)`);
  console.log('═══════════════════════════════════════════════════════════════════════════════════\n');

  console.table(scorecard);
  return { passed, total, success: passed === total };
}

runComplexBenchmark().catch(console.error);
