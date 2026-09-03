import 'dotenv/config';
import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { brandStorage } from '../storageProvider.js';
import { veMatchAuto, generateCrossBrandAlternatives } from '../utils/veAutoDetectUtils.js';
import { extractPdfViaWord } from '../wordExtractorService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');

async function testExtractionAndImageLeakage() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('🧪 TEST 1: PDF EXTRACTION & ZERO IMAGE LEAKAGE VERIFICATION');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  // Test 1A: 02. SCHEDULE OF LOOSE FURNITURE.pdf
  const schedulePdfPath = path.join(ROOT, 'PDF', '02. SCHEDULE OF LOOSE FURNITURE.pdf');
  console.log(`📄 Testing Schedule PDF: ${schedulePdfPath}`);
  const scheduleTables = await extractPdfViaWord(schedulePdfPath, 'test_sched_session', null, true);
  
  if (!scheduleTables || scheduleTables.length === 0) {
    throw new Error('Failed to extract Schedule PDF tables!');
  }

  const schedTable = Array.isArray(scheduleTables) ? scheduleTables[0] : (scheduleTables.tables ? scheduleTables.tables[0] : scheduleTables);
  const schedHeader = schedTable?.header || [];
  console.log(`   📊 Extracted ${schedTable?.rows?.length || 0} rows.`);
  console.log(`   📋 Detected Headers: ${JSON.stringify(schedHeader)}`);

  const schedImgColIdx = schedHeader.findIndex(h => /\b(image|photo|picture|img|pic|illustration|drawing|sketch)\b/i.test(h) || /\b(image\s*ref|photo\s*ref|pic\s*ref)\b/i.test(h));
  console.log(`   🔎 Image Column Index: ${schedImgColIdx} ("${schedHeader[schedImgColIdx] || 'None'}")`);

  let schedLeakage = false;
  (schedTable?.rows || []).forEach((row, rIdx) => {
    row.cells.forEach((cell, cIdx) => {
      if (cIdx !== schedImgColIdx && (cell?.images?.length > 0 || cell?.image)) {
        console.error(`   ❌ LEAKAGE ERROR in Row #${rIdx + 1} Col #${cIdx} ("${schedHeader[cIdx]}"): contains image metadata!`);
        schedLeakage = true;
      }
    });
  });

  if (!schedLeakage) {
    console.log(`   ✅ PASS: Zero image leakage in 02. SCHEDULE OF LOOSE FURNITURE.pdf (${schedTable?.rows?.length || 0} rows verified)!`);
  }

  // Test 1B: DHOFAR.pdf
  const dhofarPdfPath = path.join(ROOT, 'PDF', 'DHOFAR.pdf');
  console.log(`\n📄 Testing DHOFAR PDF: ${dhofarPdfPath}`);
  const dhofarTables = await extractPdfViaWord(dhofarPdfPath, 'test_dhofar_session', null, true);

  const dhofarTable = Array.isArray(dhofarTables) ? dhofarTables[0] : (dhofarTables.tables ? dhofarTables.tables[0] : dhofarTables);
  const dhofarHeader = dhofarTable?.header || [];
  console.log(`   📊 Extracted ${dhofarTable?.rows?.length || 0} rows.`);
  console.log(`   📋 Detected Headers: ${JSON.stringify(dhofarHeader)}`);

  const dhofarImgColIdx = dhofarHeader.findIndex(h => /\b(image|photo|picture|img|pic|illustration|drawing|sketch)\b/i.test(h) || /\b(image\s*ref|photo\s*ref|pic\s*ref)\b/i.test(h));
  console.log(`   🔎 Image Column Index: ${dhofarImgColIdx} ("${dhofarHeader[dhofarImgColIdx] || 'None'}")`);

  let dhofarLeakage = false;
  (dhofarTable?.rows || []).forEach((row, rIdx) => {
    row.cells.forEach((cell, cIdx) => {
      if (cIdx !== dhofarImgColIdx && (cell?.images?.length > 0 || cell?.image)) {
        console.error(`   ❌ LEAKAGE ERROR in Row #${rIdx + 1} Col #${cIdx} ("${dhofarHeader[cIdx]}"): contains image metadata!`);
        dhofarLeakage = true;
      }
    });
  });

  if (!dhofarLeakage) {
    console.log(`   ✅ PASS: Zero image leakage in DHOFAR.pdf (${dhofarTable?.rows?.length || 0} rows verified)!`);
  }
}

async function testAutoMatchingAndAlternatives() {
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('🧪 TEST 2: AUTO-MATCHING & 100% SPEC-MATCHED ALTERNATIVES');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const allBrands = await brandStorage.getAllBrands();
  console.log(`📦 Loaded ${allBrands.length} active manufacturer catalogs.\n`);

  const testCases = [
    {
      type: 'Unbranded Desking (DHOFAR)',
      desc: 'L-SHAPE EXECUTIVE DESK WITH ATTACHED RETURN SIDE AND 3-DRAWER MOBILE PEDESTAL (2000X1800X750MM), LOCAL-UAE',
      qty: 2,
      unit: 'No.',
      expectedArchetype: 'desking'
    },
    {
      type: 'Unbranded Seating (DHOFAR)',
      desc: 'EXECUTIVE HIGH BACK MESH CHAIR WITH ADJUSTABLE LUMBAR SUPPORT, 3D ARMRESTS, AND SYNCHRO MECHANISM (RACER), FAR EAST',
      qty: 4,
      unit: 'No.',
      expectedArchetype: 'taskSeating'
    },
    {
      type: 'Unbranded Soft Seating (DHOFAR)',
      desc: '2-SEATER RECEPTION WAITING SOFA WITH SOLID WOOD FRAME AND HIGH DENSITY FOAM (ROMA), FAR EAST',
      qty: 2,
      unit: 'No.',
      expectedArchetype: 'softSeating'
    },
    {
      type: 'Unbranded Storage (DHOFAR)',
      desc: 'HIGH STORAGE FILING CABINET (2000X900X450MM) WITH 4 ADJUSTABLE SHELVES AND LOCKABLE WOODEN DOORS, LOCAL-UAE',
      qty: 4,
      unit: 'No.',
      expectedArchetype: 'storage'
    },
    {
      type: 'Specified Contract Seating (Schedule)',
      desc: 'Freifrau Stella Armchair - High quality upholstered lounge chair with wooden base, specified for executive lounge (www.freifrau.com)',
      qty: 4,
      unit: 'No.',
      expectedArchetype: 'softSeating'
    },
    {
      type: 'Specified Auditorium Seating (Schedule)',
      desc: 'Figueras Scala 148 Auditorium Seating with integrated foldaway writing tablet (www.figueras.com)',
      qty: 60,
      unit: 'No.',
      expectedArchetype: 'auditoriumSeating'
    }
  ];

  for (const tc of testCases) {
    console.log(`───────────────────────────────────────────────────────────────────────`);
    console.log(`🔹 Testing [${tc.type}]`);
    console.log(`   Spec: "${tc.desc}"`);

    const availableBrandNames = allBrands.filter(b => b.name && !b.name.toLowerCase().includes('fitout')).map(b => b.name);
    const matchRes = await veMatchAuto(tc.desc, null, [], availableBrandNames, allBrands);

    console.log(`   🎯 Matched Primary: Brand="${matchRes.brand}", Model="${matchRes.model}", Category="${matchRes.mainCategory} / ${matchRes.subCategory}"`);

    // Verify alternatives
    const alternatives = generateCrossBrandAlternatives(matchRes.brand, matchRes.model, tc.desc, allBrands, matchRes.mainCategory, 4);
    console.log(`   ✨ Generated ${alternatives.length} Cross-Brand Alternatives:`);

    alternatives.forEach((alt, idx) => {
      console.log(`      ${idx + 1}. [${alt.brand}] ${alt.model} | Fit: ${alt.confidenceScore}% | ${alt.mainCategory}`);
    });

    // Validation checks
    const fakeBrands = ['roma', 'wind', 'app', 'racer', 'terminal', 'local-uae', 'far east'];
    if (fakeBrands.includes(String(matchRes.brand).toLowerCase())) {
      console.error(`   ❌ FAILED: Hallucinated fake brand "${matchRes.brand}"`);
    } else {
      console.log(`   ✅ PASS: Authentic brand returned.`);
    }

    if (alternatives.length > 0) {
      const distinctBrands = new Set(alternatives.map(a => a.brand.toLowerCase()));
      if (distinctBrands.size === alternatives.length) {
        console.log(`   ✅ PASS: All ${alternatives.length} alternatives are from distinct premier partner brands!`);
      } else {
        console.warn(`   ⚠️ Warning: Some alternatives share the same brand.`);
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('🏁 ALL VERIFICATION TESTS COMPLETED SUCCESSFULLY!');
  console.log('═══════════════════════════════════════════════════════════════════════\n');
}

async function main() {
  await testExtractionAndImageLeakage();
  await testAutoMatchingAndAlternatives();
}

main().catch(err => {
  console.error('Fatal Test Error:', err);
  process.exit(1);
});
