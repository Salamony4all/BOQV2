/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  MASSIVE UNSEEN STRESS TEST: 16 Diverse Real-World BOQ Archetypes       │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { extractMultiplePdfsV21 } from '../server/universalPatternParsersVercel.v22.dynamic-header-boq-spec.js';
import fs from 'fs';

const STRESS_TEST_SUITE = [
  {
    name: '01_university_campus_boq.pdf',
    category: 'Educational & University Campus',
    minExpectedRows: 5,
    minCols: 5
  },
  {
    name: '02_hospital_medical_boq.pdf',
    category: 'Healthcare & Clinical Hospital',
    minExpectedRows: 5,
    minCols: 6
  },
  {
    name: '03_airport_transit_boq.pdf',
    category: 'Airport Terminal & Transit Hub',
    minExpectedRows: 4,
    minCols: 6
  },
  {
    name: '04_luxury_residential_ffe.pdf',
    category: 'High-Rise Luxury Residential Penthouse',
    minExpectedRows: 5,
    minCols: 6
  },
  {
    name: '05_corporate_workplace_boq.pdf',
    category: 'Commercial Corporate Headquarters',
    minExpectedRows: 5,
    minCols: 6
  },
  {
    name: '06_judicial_courts_boq.pdf',
    category: 'Judicial Courts & Ministry Fit-Out',
    minExpectedRows: 5,
    minCols: 6
  },
  {
    name: '07_restaurant_hospitality_boq.pdf',
    category: 'Restaurant, F&B & Hospitality Lounge',
    minExpectedRows: 5,
    minCols: 6
  },
  {
    name: '08_european_metric_boq.pdf',
    category: 'German/European Metric DIN Schedule (€)',
    minExpectedRows: 5,
    minCols: 6
  },
  {
    name: '09_uk_nrm2_boq.pdf',
    category: 'UK NRM2 Bill of Quantities (£)',
    minExpectedRows: 5,
    minCols: 5
  },
  {
    name: '10_gulf_bilingual_boq.pdf',
    category: 'Middle East Gulf Arabic/English Bilingual',
    minExpectedRows: 5,
    minCols: 6
  },
  {
    name: '11_industrial_warehouse_boq.pdf',
    category: 'Industrial Warehouse & Logistics Racking',
    minExpectedRows: 5,
    minCols: 6
  },
  {
    name: '12_csi_masterformat_boq.pdf',
    category: 'CSI MasterFormat Multi-Division Schedule',
    minExpectedRows: 5,
    minCols: 6
  },
  {
    name: '13_extreme_reversed_boq.pdf',
    category: 'Extreme Reversed Column Cost Schedule',
    minExpectedRows: 4,
    minCols: 6
  },
  {
    name: '14_multipage_studio_boq.pdf',
    category: 'Multi-Page Studio Complex Schedule',
    minExpectedRows: 6,
    minCols: 6
  },
  {
    name: '15_minimalist_3col_boq.pdf',
    category: 'Minimalist 3-Column Lump Sum Package',
    minExpectedRows: 4,
    minCols: 3
  },
  {
    name: '16_dense_12col_ffe_matrix.pdf',
    category: 'Dense 12-Column Architectural FF&E Matrix',
    minExpectedRows: 5,
    minCols: 8
  }
];

export async function runMassiveStressTest() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('🚀 [Massive Unseen Stress Test] Benchmarking 16 completely new BOQ archetypes');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  let passed = 0;
  let total = 0;
  const scoreCard = [];

  for (const item of STRESS_TEST_SUITE) {
    total++;
    const filePath = `./test_unseen_suite/${item.name}`;
    console.log(`▶ [${total}/16] Testing Archetype: "${item.category}"`);
    console.log(`  File: ${item.name}`);

    const startTime = Date.now();
    try {
      const result = await extractMultiplePdfsV21([filePath], () => {});
      const elapsed = Date.now() - startTime;

      if (!result || !result.tables || result.tables.length === 0) {
        console.error(`  ❌ FAILED: No tables extracted.`);
        scoreCard.push({ name: item.name, category: item.category, status: 'FAILED', reason: 'Zero tables' });
        continue;
      }

      const table = result.tables[0];
      const rowCount = table.rows?.length || 0;
      const colCount = table.header?.length || 0;
      const headersStr = (table.header || []).join(' | ');

      const isRowsPass = rowCount >= item.minExpectedRows;
      const isColsPass = colCount >= item.minCols;

      if (isRowsPass && isColsPass) {
        console.log(`  ✅ PASSED (${elapsed}ms): Extracted ${rowCount} rows, ${colCount} columns`);
        console.log(`     Headers: ${headersStr}`);
        console.log(`     Sample Item: ${table.rows[0].cells.map(c => c.value).filter(Boolean).slice(0, 3).join(' — ')}`);
        passed++;
        scoreCard.push({
          index: total,
          name: item.name,
          category: item.category,
          status: 'PASSED',
          rows: rowCount,
          columns: colCount,
          timeMs: elapsed
        });
      } else {
        console.error(`  ❌ FAILED: Threshold mismatch. Rows=${rowCount} (Exp: ${item.minExpectedRows}), Cols=${colCount} (Exp: ${item.minCols})`);
        scoreCard.push({
          index: total,
          name: item.name,
          category: item.category,
          status: 'FAILED',
          reason: `Rows=${rowCount}/${item.minExpectedRows}, Cols=${colCount}/${item.minCols}`
        });
      }
    } catch (err) {
      console.error(`  ❌ ERROR:`, err.message);
      scoreCard.push({ index: total, name: item.name, category: item.category, status: 'ERROR', reason: err.message });
    }
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log(`📊 STRESS TEST SCORECARD: ${passed}/${total} Archetypes Passed (${((passed / total) * 100).toFixed(0)}% Universality Score)`);
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  console.table(scoreCard);
  return { passed, total, success: passed === total };
}

runMassiveStressTest().then(res => {
  if (!res.success) process.exit(1);
});
