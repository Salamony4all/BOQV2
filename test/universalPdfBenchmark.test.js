/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  Universal PDF Extractor Benchmark & Stress Test Suite                  │
 * └─────────────────────────────────────────────────────────────────────────┘
 * Validates extraction universality across diverse architectural formats:
 * - Consolidated BOQ + Spec Cards (Loose Furniture Presentation Slides)
 * - Serial Financial Government BOQ (Dhofar, Rakhyut, Sadah)
 * - Civil & Infrastructure BOQ (Civil BOQ)
 * - Interior Fit-Out & Commercial Schedules (BOQ_FitOut)
 * - Multi-Page Tender Schedules (BOQ tender)
 * - Academic / Institutional Tender Packages (Muscat University, NITT)
 */

import { extractMultiplePdfsV21 } from '../server/universalPatternParsersVercel.v22.dynamic-header-boq-spec.js';
import fs from 'fs';
import path from 'path';

const BENCHMARK_FILES = [
  {
    name: '02. SCHEDULE OF LOOSE FURNITURE.pdf',
    path: './PDF/02. SCHEDULE OF LOOSE FURNITURE.pdf',
    category: 'Consolidated BOQ + 2D Spec Slides',
    minExpectedRows: 60,
    expectImages: true
  },
  {
    name: 'DHOFAR.pdf',
    path: './PDF/DHOFAR.pdf',
    category: 'Serial Financial Commercial BOQ',
    minExpectedRows: 30,
    expectImages: true
  },
  {
    name: 'CIVIL BOQ.pdf',
    path: './PDF/CIVIL BOQ.pdf',
    category: 'Civil & Infrastructure Schedule',
    minExpectedRows: 10,
    expectImages: false
  },
  {
    name: 'BOQ_FitOut.pdf',
    path: './PDF/BOQ_FitOut.pdf',
    category: 'Commercial Interior Fit-Out',
    minExpectedRows: 50,
    expectImages: false
  },
  {
    name: 'BOQ tender.pdf',
    path: './PDF/BOQ tender.pdf',
    category: 'Government Tender Schedule',
    minExpectedRows: 10,
    expectImages: false
  },
  {
    name: 'RAKHYUT.pdf',
    path: './PDF/RAKHYUT.pdf',
    category: 'Regional Municipality Tender BOQ',
    minExpectedRows: 15,
    expectImages: true
  },
  {
    name: 'SADAH.pdf',
    path: './PDF/SADAH.pdf',
    category: 'Regional Municipality Tender BOQ',
    minExpectedRows: 15,
    expectImages: true
  },
  {
    name: 'SHALIM AL HALLANIYAT ISLANDS.pdf',
    path: './PDF/SHALIM AL HALLANIYAT ISLANDS.pdf',
    category: 'Government Infrastructure BOQ',
    minExpectedRows: 15,
    expectImages: true
  },
  {
    name: 'UTAS  financial.pdf',
    path: './PDF/UTAS  financial.pdf',
    category: 'University Technical BOQ',
    minExpectedRows: 10,
    expectImages: false
  },
  {
    name: 'Studio 184 keys f.pdf',
    path: './PDF/Studio 184 keys f.pdf',
    category: 'Hospitality FF&E Master Schedule',
    minExpectedRows: 20,
    expectImages: false
  }
];


export async function runUniversalBenchmark() {
  console.log('🚀 [Universal PDF Extractor Benchmark] Running extraction across diverse BOQ formats...\n');

  let passed = 0;
  let total = 0;
  const results = [];

  for (const test of BENCHMARK_FILES) {
    if (!fs.existsSync(test.path)) {
      console.log(`⚠️ Skipping ${test.name} (File not found)`);
      continue;
    }

    total++;
    const startTime = Date.now();
    console.log(`▶ Testing: "${test.name}" [Format: ${test.category}]`);

    try {
      const res = await extractMultiplePdfsV21([test.path], () => {});
      const elapsed = Date.now() - startTime;

      if (!res || !res.tables || res.tables.length === 0) {
        console.error(`  ❌ FAILED: No tables extracted for ${test.name}`);
        results.push({ name: test.name, status: 'FAILED', reason: 'No tables' });
        continue;
      }

      const table = res.tables[0];
      const rowCount = table.rows?.length || 0;
      const colCount = table.header?.length || 0;
      const engineUsed = table.engineUsed || res.engineUsed || 'universal';

      // Check image counts if expected
      let totalImages = 0;
      (table.rows || []).forEach(r => {
        (r.cells || []).forEach(c => {
          if (c.images && c.images.length > 0) totalImages += c.images.length;
          else if (c.image) totalImages++;
        });
      });

      const isRowsOk = rowCount >= test.minExpectedRows;
      const isColsOk = colCount >= 3;
      const isImagesOk = !test.expectImages || totalImages > 0;

      if (isRowsOk && isColsOk && isImagesOk) {
        console.log(`  ✅ PASSED (${elapsed}ms): ${rowCount} rows, ${colCount} cols, ${totalImages} images | Engine: ${engineUsed}`);
        passed++;
        results.push({
          name: test.name,
          category: test.category,
          status: 'PASSED',
          rows: rowCount,
          columns: colCount,
          images: totalImages,
          engine: engineUsed,
          timeMs: elapsed
        });
      } else {
        console.error(`  ❌ FAILED (${elapsed}ms): Rows=${rowCount} (Min: ${test.minExpectedRows}), Cols=${colCount}, Images=${totalImages}`);
        results.push({ name: test.name, status: 'FAILED', reason: `Rows=${rowCount}, Cols=${colCount}` });
      }
    } catch (err) {
      console.error(`  ❌ ERROR on ${test.name}:`, err.message);
      results.push({ name: test.name, status: 'ERROR', reason: err.message });
    }
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════════════════');
  console.log(`📊 BENCHMARK SUMMARY: ${passed}/${total} Formats Passed (${((passed / total) * 100).toFixed(0)}% Universality Score)`);
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════\n');

  console.table(results);
  return { passed, total, success: passed === total, results };
}

runUniversalBenchmark().then(res => {
  if (!res.success) process.exit(1);
});
