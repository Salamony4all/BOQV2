/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  Blind Test Runner on Completely Unseen & Unfamiliar BOQ PDFs           │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { extractMultiplePdfsV21 } from '../server/universalPatternParsersVercel.v22.dynamic-header-boq-spec.js';
import fs from 'fs';

const UNSEEN_TESTS = [
  {
    name: 'unseen_reversed_order_boq.pdf',
    path: './test_unseen_pdfs/unseen_reversed_order_boq.pdf',
    description: 'Reversed Column Permutation [Total, Rate, Qty, Unit, Description, RefCode, Item#]',
    expectedMinRows: 8
  },
  {
    name: 'unseen_hospitality_ffe_boq.pdf',
    path: './test_unseen_pdfs/unseen_hospitality_ffe_boq.pdf',
    description: 'Hospitality Hotel FF&E Schedule with 9 columns [Mark, Specs, Finish, Dims, Area, Qty, Unit, Rate, Amount]',
    expectedMinRows: 9
  },
  {
    name: 'unseen_mep_infrastructure_boq.pdf',
    path: './test_unseen_pdfs/unseen_mep_infrastructure_boq.pdf',
    description: 'Data Center MEP & Civil BOQ with Division codes & Sum lots [Serial, Code, Particulars, UOM, Qty, Rate, Cost]',
    expectedMinRows: 8
  }
];

export async function runUnseenTests() {
  console.log('🧪 [Blind Unseen Test] Testing Universal PDF Extractor against 3 brand new, unfamiliar PDF layouts...\n');

  let passed = 0;
  let total = 0;
  const scoreCard = [];

  for (const t of UNSEEN_TESTS) {
    total++;
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`▶ Testing Unseen PDF: "${t.name}"`);
    console.log(`  Layout Scenario: ${t.description}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    const start = Date.now();
    try {
      const res = await extractMultiplePdfsV21([t.path], () => {});
      const elapsed = Date.now() - start;

      if (!res || !res.tables || res.tables.length === 0) {
        console.error(`  ❌ FAILED: Extractor returned 0 tables.`);
        scoreCard.push({ name: t.name, status: 'FAILED', reason: 'Zero tables' });
        continue;
      }

      const table = res.tables[0];
      const rowCount = table.rows?.length || 0;
      const headers = table.header || [];
      const roles = table.columnMetadata || [];

      console.log(`  📊 Extracted Header Columns (${headers.length}):`, headers.join(' | '));
      console.log(`  📊 Extracted Rows Count: ${rowCount} rows (in ${elapsed}ms)`);
      
      // Sample first 2 extracted rows
      console.log(`  🔍 Sample Rows:`);
      table.rows.slice(0, 2).forEach((r, i) => {
        const cellVals = r.cells.map(c => c.value).filter(Boolean);
        console.log(`     Row ${i + 1}: ${cellVals.join(' | ')}`);
      });

      const isRowsOk = rowCount >= t.expectedMinRows;
      const isColsOk = headers.length >= 5;

      if (isRowsOk && isColsOk) {
        console.log(`  ✅ PASSED: Successfully inferred unseen structure without prior training or rules!`);
        passed++;
        scoreCard.push({
          name: t.name,
          scenario: t.description.substring(0, 45) + '...',
          status: 'PASSED',
          rows: rowCount,
          columns: headers.length,
          timeMs: elapsed
        });
      } else {
        console.error(`  ❌ FAILED: Row/Column count mismatch (Rows: ${rowCount}, Cols: ${headers.length})`);
        scoreCard.push({ name: t.name, status: 'FAILED', reason: `Rows=${rowCount}, Cols=${headers.length}` });
      }
    } catch (err) {
      console.error(`  ❌ ERROR:`, err.message);
      scoreCard.push({ name: t.name, status: 'ERROR', reason: err.message });
    }
    console.log('');
  }

  console.log('═════════════════════════════════════════════════════════════════════');
  console.log(`🏆 BLIND TEST RESULTS: ${passed}/${total} Unfamiliar PDFs Passed (${((passed / total) * 100).toFixed(0)}%)`);
  console.log('═════════════════════════════════════════════════════════════════════\n');

  console.table(scoreCard);
  return { passed, total, success: passed === total };
}

runUnseenTests().then(res => {
  if (!res.success) process.exit(1);
});
