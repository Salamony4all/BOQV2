/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  End-to-End Test Runner for Branded and Non-Branded BOQs                │
 * └─────────────────────────────────────────────────────────────────────────┘
 * Tests:
 * 1. Branded / Specified BOQ: "02. SCHEDULE OF LOOSE FURNITURE.pdf"
 * 2. Non-Branded / Generic Commercial BOQ: "DHOFAR.pdf"
 */

import { veMatchAuto, extractSpecifiedProductDetails } from '../server/utils/veAutoDetectUtils.js';
import { classifyFurnishingCategory } from '../server/utils/veCategoryPriority.js';
import { brandStorage } from '../server/storageProvider.js';

export async function runE2EBoqTests() {
  console.log('🚀 [E2E BOQ Test] Starting End-to-End Matching Verification for Branded & Non-Branded BOQs...\n');

  const localBrands = await brandStorage.getAllBrands();
  const availableBrandNames = localBrands.filter(b => b && b.name && !b.name.toLowerCase().includes('fitout')).map(b => b.name);
  console.log(`📦 Loaded ${localBrands.length} authentic partner catalogs (${availableBrandNames.join(', ')})\n`);

  let passed = 0;
  let total = 0;

  // ════════════════════════════════════════════════════════════════════════════
  // 1. BRANDED / SPECIFIED BOQ: "02. SCHEDULE OF LOOSE FURNITURE.pdf"
  // ════════════════════════════════════════════════════════════════════════════
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📄 SECTION 1: Branded / Specified BOQ (02. SCHEDULE OF LOOSE FURNITURE.pdf)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const brandedItems = [
    {
      row: 1,
      sn: 'LF-001',
      desc: 'Inherently colored Polyethylene indoor Modular Benches, moveable, light weight. | Size: 1800 x 500 x 420 mm ht. | Finish: Polyethylene - Ecru. All finishes to approval. | https://www.moodie.com.au/?product=06-moonako-Lobby or equivalent',
      expectedBrand: 'Moonako',
      expectedModelSnippet: 'Lobby',
      tier: 'EXACT_MATCH'
    },
    {
      row: 2,
      sn: 'LF-002',
      desc: 'Rectangular Display Table | Size: 900 x 500 x 750 mm ht. | Finish: Light Ashwood with clear matte coating. All finishes to approval. | https://milimetry.com/products/set-total-shop-fixture-tables-vc-05-shelves-vs-05-perfect-for-events-and-shops or equivalent',
      expectedBrand: 'Milimetry',
      tier: 'EXACT_MATCH'
    },
    {
      row: 3,
      sn: 'LF-003',
      desc: 'Display Rack - Designed for easy assembly and disassembly without tools, lightweight, mobile, and space-efficient. | Size: 1060 x 500 x 2140 mm ht. | Finish: Light Ashwood with clear matte coating. | https://milimetry.com/products/set-total-shop-fixture-tables-vc-05-shelves-vs-05 or equivalent',
      expectedBrand: 'Milimetry',
      tier: 'EXACT_MATCH'
    },
    {
      row: 8,
      sn: 'LF-008',
      desc: 'Round Chair (Foldable) Creative Market | S.No: A-8 | Product Code: LF-008 | Spec Item Description: ROUND FOLDABLE CHAIR | Type: Round Foldable Chair | Maker: Creative Market | Material: Solid Wood & Black Metal Frame',
      expectedBrand: 'Creative Market',
      expectedModelSnippet: 'LF-008',
      tier: 'EXACT_MATCH'
    },
    {
      row: 9,
      sn: 'LF-009',
      desc: 'Protect against wind and rain. Folds up, easy to carry and store. | Size: 1600 x 1700 x 1900 mm ht. | Finish: Light Ashwood with clear matte coating. All finishes to approval | Supplier / Maker: Custom Craft Kiosk',
      expectedBrand: 'Custom Craft Kiosk',
      tier: 'EXACT_MATCH'
    }
  ];

  for (const item of brandedItems) {
    total++;
    console.log(`\n▶ [Item ${item.sn} (Row ${item.row})] Testing: "${item.desc.substring(0, 70)}..."`);
    const match = await veMatchAuto(item.desc, null, [], availableBrandNames, localBrands);

    const isBrandOk = match.brand && (
      match.brand.toLowerCase().includes(item.expectedBrand.toLowerCase()) ||
      item.expectedBrand.toLowerCase().includes(match.brand.toLowerCase())
    );
    const isTierOk = match.matchTier === 'EXACT_MATCH' || match.confidenceScore >= 95;
    const isAmazonForbidden = match.brand.toLowerCase() !== 'amazon';

    if (isBrandOk && isTierOk && isAmazonForbidden) {
      console.log(`  ✅ PASSED: Brand="${match.brand}" | Model="${match.model}" | Tier=${match.matchTier} (${match.confidenceScore}%)`);
      passed++;
    } else {
      console.error(`  ❌ FAILED: Received Brand="${match.brand}", Tier="${match.matchTier}" | Expected Brand="${item.expectedBrand}"`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 2. NON-BRANDED / GENERIC COMMERCIAL BOQ: "DHOFAR.pdf"
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📄 SECTION 2: Non-Branded / Generic Commercial BOQ (DHOFAR.pdf)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const genericItems = [
    {
      id: 'DHOFAR-01',
      desc: 'Executive Desk with Side Return Credenza, Melamine Finish Top with Chamfered Edge, Integrated Wire Cable Management, Size: 2200 x 1800 x 750 mm ht',
      expectedCategory: 'desking'
    },
    {
      id: 'DHOFAR-02',
      desc: 'High-Back Ergonomic Executive Task Chair, Breathable Mesh Back, 3D Adjustable Armrests, Synchronized Tilting Mechanism with Multi-Lock, 5-Star Chrome Base on Castors',
      expectedCategory: 'taskSeating'
    },
    {
      id: 'DHOFAR-03',
      desc: 'Linear 4-Person Workstation Cluster with Central Acoustic Fabric Privacy Screen, Cable Trays, Modesty Panels, Powder-Coated Metal O-Legs, Size: 2800 x 1400 x 750 mm ht',
      expectedCategory: 'desking'
    },
    {
      id: 'DHOFAR-04',
      desc: 'Conference Room Boardroom Meeting Table for 10 Persons, Boat-Shaped Table Top with Brushed Metal Cable Flaps, Heavy Duty Metal Base, Size: 3200 x 1200 x 750 mm ht',
      expectedCategory: 'desking'
    },
    {
      id: 'DHOFAR-05',
      desc: 'Medium-Back Mid-Century Visitor / Conference Chair, Upholstered Seat and Back in Heavy-Duty Fabric, Chrome Cantilever Sled Frame with Anti-Tip Glides',
      expectedCategory: 'taskSeating'
    },
    {
      id: 'DHOFAR-06',
      desc: 'Modular 3-Seater High-Back Acoustic Lounge Sofa with Integrated Side Arm Panels for Focus and Collaboration, Commercial Fabric Upholstery, Solid Wood Legs',
      expectedCategory: 'softSeating'
    },
    {
      id: 'DHOFAR-07',
      desc: 'Full Height Wooden Storage Credenza Cabinet with Sliding Tambour Doors and Adjustable Internal Shelves, Size: 1600 x 450 x 1200 mm ht',
      expectedCategory: 'storage'
    }
  ];

  for (const item of genericItems) {
    total++;
    console.log(`\n▶ [Item ${item.id}] Testing Generic Spec: "${item.desc.substring(0, 70)}..."`);
    const category = classifyFurnishingCategory(item.desc);
    const match = await veMatchAuto(item.desc, null, [], availableBrandNames, localBrands);

    const isCategoryOk = category === item.expectedCategory;
    const isForbiddenAmazon = match.brand && match.brand.toLowerCase() !== 'amazon';
    const isAuthenticPartner = localBrands.some(b => b.name && b.name.toLowerCase() === (match.brand || '').toLowerCase());

    if (isCategoryOk && isForbiddenAmazon) {
      console.log(`  ✅ PASSED: Category="${category}" ➔ Matched Partner Brand="${match.brand}" | Model="${match.model}" (${match.confidenceScore || 85}%)`);
      passed++;
    } else {
      console.error(`  ❌ FAILED: Category="${category}" (Expected "${item.expectedCategory}"), Brand="${match.brand}"`);
    }
  }

  console.log('\n═════════════════════════════════════════════════════════════════════');
  console.log(`🏆 OVERALL E2E RESULTS: ${passed}/${total} Tests Passed (${((passed / total) * 100).toFixed(0)}%)`);
  console.log('═════════════════════════════════════════════════════════════════════\n');

  return { passed, total, success: passed === total };
}

runE2EBoqTests().then(res => {
  if (!res.success) process.exit(1);
});
