import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { matchFFE } from '../utils/ffe_matcher.js';
import { normalizeProducts } from '../utils/normalizer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRANDS_DIR = path.join(__dirname, '../data/brands');

async function testMatcher() {
  console.log('--- FF&E Matcher Precision Test ---');

  // Load Arper for testing
  const arperPath = path.join(BRANDS_DIR, 'arper-high.json');
  if (!fs.existsSync(arperPath)) {
    console.error('Arper data not found for testing!');
    return;
  }

  const arperData = JSON.parse(fs.readFileSync(arperPath, 'utf8'));
  // Re-normalize with new rules
  arperData.products = normalizeProducts(arperData.products);
  
  const testCases = [
    {
      id: 'TC1',
      name: 'Executive Match',
      boq: 'Executive Office Chair High Back Leather with Headrest for CEO',
      brand: arperData,
      expectedKeywords: ['Executive', 'High Back']
    },
    {
      id: 'TC2',
      name: 'Lounge Bench (Isolation Test)',
      boq: 'Waiting Area Lounge Bench Pausit upholstered in fabric',
      brand: arperData,
      expectedKeywords: ['Bench', 'Lounge']
    },
    {
      id: 'TC3',
      name: 'Staff Chair (Rank Isolation)',
      boq: 'Staff Task Chair Mesh back with Casters',
      brand: arperData,
      expectedKeywords: ['Staff', 'Task']
    },
    {
      id: 'TC4',
      name: 'Plastic/Training (Subcat Match)',
      boq: 'Stackable Plastic Chair for Training Room',
      brand: arperData,
      expectedKeywords: ['Stackable', 'Plastic']
    }
  ];

  const topN = 3;
  testCases.forEach(tc => {
    console.log(`\n[TEST] ${tc.id}: ${tc.name}`);
    console.log(`BOQ: "${tc.boq}"`);
    
    // Custom match with candidates logging
    const results = [];
    (tc.brand.products || []).forEach(p => {
        // Mock a minimal brand array
        const res = matchFFE(tc.boq, [{ name: tc.brand.name, products: [p] }]);
        if (res) results.push({ ...res, model: p.model });
    });
    
    results.sort((a, b) => b.confidence - a.confidence);
    
    const best = results[0];
    if (best) {
      console.log(`✅ MATCH: ${best.model}`);
      console.log(`   Score: ${best.confidence}`);
      console.log(`   Category: ${best.mainCat} > ${best.subCat}`);
      
      console.log('--- Top Candidates ---');
      results.slice(0, topN).forEach((r, i) => {
          console.log(`${i+1}. ${r.model} | Score: ${r.confidence} | ${r.subCat}`);
      });

      const matchedModel = best.model.toLowerCase();
      const hasKeywords = tc.expectedKeywords.every(k => 
        matchedModel.includes(k.toLowerCase()) || 
        (best.description || "").toLowerCase().includes(k.toLowerCase()) ||
        best.subCat.toLowerCase().includes(k.toLowerCase())
      );
      
      if (hasKeywords) {
        console.log('   RESULT: PASS');
      } else {
        console.warn('   RESULT: POTENTIAL MISMATCH (Keywords not found)');
      }
    } else {
      console.log('❌ NO MATCH FOUND');
    }
  });

  console.log('\n--- Test Complete ---');
}

testMatcher().catch(console.error);
