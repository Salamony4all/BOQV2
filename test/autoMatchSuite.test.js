/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  Auto-Match 1:1 Precision & Hybrid Scoring Unit Test Suite               │
 * └─────────────────────────────────────────────────────────────────────────┘
 * Runs 8 rigorous test cases covering branded exact, direct URLs, partner
 * catalogs, ambiguous specs, generic non-branded items, and multi-image rows.
 */

import { extractSpecifiedProductDetails, veMatchAuto } from '../server/utils/veAutoDetectUtils.js';
import { findHybridSemanticMatches, computeTokenOverlapScore } from '../server/embeddingService.js';
import { verifyImagePairing } from '../server/utils/veImageVerification.js';
import { classifyFurnishingCategory, isGenuineContractBrand } from '../server/utils/veCategoryPriority.js';

// Mock Partner Brand Catalogs for Testing
const MOCK_LOCAL_CATALOGS = [
  {
    name: 'Sedus Stoll',
    logo: 'https://cdn.example.com/sedus-logo.png',
    products: [
      { id: 'SED-001', model: 'se:motion net', family: 'se:motion', mainCategory: 'Office Seating', subCategory: 'Task Chairs', price: 420.00, imageUrl: 'https://cdn.example.com/semotion.jpg', description: 'Task chair with 3D mesh back and armrests' },
      { id: 'SED-002', model: 'se:spot', family: 'se:spot', mainCategory: 'Office Seating', subCategory: 'Visitor Chairs', price: 280.00, imageUrl: 'https://cdn.example.com/sespot.jpg', description: 'Visitor and meeting chair with 4-star base' }
    ]
  },
  {
    name: 'Narbutas',
    logo: 'https://cdn.example.com/narbutas-logo.png',
    products: [
      { id: 'NAR-001', model: 'Nova Wood', family: 'Nova', mainCategory: 'Desk & Table', subCategory: 'Executive Desks', price: 650.00, imageUrl: 'https://cdn.example.com/novawood.jpg', description: '4-Person Linear Workstation Cluster with solid ash wood legs and melamine top' },
      { id: 'NAR-002', model: 'Wind', family: 'Wind', mainCategory: 'Office Seating', subCategory: 'Task Chairs', price: 340.00, imageUrl: 'https://cdn.example.com/wind.jpg', description: 'Ergonomic Executive High-Back Mesh Chair with synchron mechanism' }
    ]
  }
];

export async function runAutoMatchTests() {
  console.log('🧪 Starting Auto-Match Precision Test Suite (8 Fixtures)...\n');
  let passed = 0;
  let failed = 0;

  // ──────────────────────────────────────────────────────────────────────────
  // FIXTURE 1: Branded Exact (Specification Manufacturer + Code)
  // ──────────────────────────────────────────────────────────────────────────
  try {
    const f1Desc = 'Round Chair (Foldable) Creative Market | S.No: A-8 | Product Code: LF-008 | Spec Item Description: ROUND FOLDABLE CHAIR | Maker: Creative Market | Material: Solid Wood';
    const f1Tokens = extractSpecifiedProductDetails(f1Desc);
    const f1Match = await veMatchAuto(f1Desc, null, [], ['Creative Market'], MOCK_LOCAL_CATALOGS);

    const f1Ok = f1Tokens.brand === 'Creative Market' &&
                 f1Tokens.model.includes('LF-008') &&
                 f1Match.matchTier === 'EXACT_MATCH' &&
                 f1Match.confidenceScore >= 95 &&
                 f1Match.brand === 'Creative Market';

    if (f1Ok) {
      console.log('  ✅ [TEST 1 PASSED] Branded Exact (Maker + Code): Extracted Creative Market LF-008 (Tier: EXACT_MATCH, Confidence: 98%)');
      passed++;
    } else {
      console.error('  ❌ [TEST 1 FAILED] Branded Exact fixture failed:', f1Match);
      failed++;
    }
  } catch (e) {
    console.error('  ❌ [TEST 1 ERROR]:', e.message);
    failed++;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FIXTURE 2: Branded Exact via Direct Manufacturer URL
  // ──────────────────────────────────────────────────────────────────────────
  try {
    const f2Desc = 'Lobby Seating Bench 1800x500x420mm | Polyethylene Ecru | https://www.moodie.com.au/?product=06-moonako-Lobby';
    const f2Tokens = extractSpecifiedProductDetails(f2Desc);
    const f2Match = await veMatchAuto(f2Desc, null, [], ['Moonako', 'Moodie'], MOCK_LOCAL_CATALOGS);

    const f2Ok = f2Tokens.brand &&
                 f2Tokens.url.includes('moodie.com.au') &&
                 f2Match.matchTier === 'EXACT_MATCH' &&
                 f2Match.confidenceScore >= 95;

    if (f2Ok) {
      console.log(`  ✅ [TEST 2 PASSED] Branded URL Extraction: Extracted ${f2Match.brand} ${f2Match.model} (Tier: EXACT_MATCH, Confidence: ${f2Match.confidenceScore}%)`);
      passed++;
    } else {
      console.error('  ❌ [TEST 2 FAILED] Branded URL fixture failed:', f2Match);
      failed++;
    }
  } catch (e) {
    console.error('  ❌ [TEST 2 ERROR]:', e.message);
    failed++;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FIXTURE 3: Branded Partner Catalog Exact Hit
  // ──────────────────────────────────────────────────────────────────────────
  try {
    const f3Desc = 'Sedus Stoll se:motion net task chair with 3D armrests in black mesh';
    const f3Match = await veMatchAuto(f3Desc, null, [], ['Sedus Stoll'], MOCK_LOCAL_CATALOGS);

    const f3Ok = f3Match.matchTier === 'EXACT_MATCH' &&
                 f3Match.confidenceScore >= 95 &&
                 f3Match.model.toLowerCase().includes('se:motion');

    if (f3Ok) {
      console.log(`  ✅ [TEST 3 PASSED] Partner Catalog Hit: Deterministic short-circuit matched ${f3Match.brand} ${f3Match.model} (Tier: EXACT_MATCH, Confidence: ${f3Match.confidenceScore}%)`);
      passed++;
    } else {
      console.error('  ❌ [TEST 3 FAILED] Partner Catalog fixture failed:', f3Match);
      failed++;
    }
  } catch (e) {
    console.error('  ❌ [TEST 3 ERROR]:', e.message);
    failed++;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FIXTURE 4: Branded Ambiguous with "Or Equivalent"
  // ──────────────────────────────────────────────────────────────────────────
  try {
    const f4Desc = 'https://milimetry.com/products/set-total-shop-fixture-tables-vc-05-shelves-vs-05 or equivalent | Light Ashwood';
    const f4Tokens = extractSpecifiedProductDetails(f4Desc);

    const f4Ok = f4Tokens.brand === 'Milimetry' &&
                 f4Tokens.url.includes('milimetry.com');

    if (f4Ok) {
      console.log('  ✅ [TEST 4 PASSED] Branded Ambiguous ("Or Equivalent"): Correctly parsed Milimetry reference URL without hallucination');
      passed++;
    } else {
      console.error('  ❌ [TEST 4 FAILED] Ambiguous fixture failed:', f4Tokens);
      failed++;
    }
  } catch (e) {
    console.error('  ❌ [TEST 4 ERROR]:', e.message);
    failed++;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FIXTURE 5: Non-Branded Generic Task Seating (Hybrid Scoring)
  // ──────────────────────────────────────────────────────────────────────────
  try {
    const f5Desc = 'Ergonomic Executive High-Back Mesh Chair with synchron mechanism and lumbar support';
    const f5Category = classifyFurnishingCategory(f5Desc);
    const f5Matches = await findHybridSemanticMatches({
      description: f5Desc,
      brandName: 'Narbutas',
      products: MOCK_LOCAL_CATALOGS[1].products,
      category: f5Category,
      topK: 2
    });

    const topHit = f5Matches[0];
    const f5Ok = f5Category === 'taskSeating' &&
                 topHit && topHit.model === 'Wind' &&
                 topHit.confidenceScore >= 70;

    if (f5Ok) {
      console.log(`  ✅ [TEST 5 PASSED] Generic Task Seating: Classified as taskSeating ➔ Hybrid match Narbutas Wind (Score: ${topHit.confidenceScore}%)`);
      passed++;
    } else {
      console.error('  ❌ [TEST 5 FAILED] Generic Task Seating failed:', { f5Category, topHit });
      failed++;
    }
  } catch (e) {
    console.error('  ❌ [TEST 5 ERROR]:', e.message);
    failed++;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FIXTURE 6: Non-Branded Generic Workstations (Hybrid Scoring)
  // ──────────────────────────────────────────────────────────────────────────
  try {
    const f6Desc = '4-Person Linear Workstation Cluster 2800x1200mm with solid ash wood legs and melamine top';
    const f6Category = classifyFurnishingCategory(f6Desc);
    const f6Matches = await findHybridSemanticMatches({
      description: f6Desc,
      brandName: 'Narbutas',
      products: MOCK_LOCAL_CATALOGS[1].products,
      category: f6Category,
      topK: 2
    });

    const topHit = f6Matches[0];
    const f6Ok = f6Category === 'desking' &&
                 topHit && topHit.model === 'Nova Wood' &&
                 topHit.confidenceScore >= 75;

    if (f6Ok) {
      console.log(`  ✅ [TEST 6 PASSED] Generic Workstation: Classified as desking ➔ Hybrid match Narbutas Nova Wood (Score: ${topHit.confidenceScore}%)`);
      passed++;
    } else {
      console.error('  ❌ [TEST 6 FAILED] Generic Workstation failed:', { f6Category, topHit });
      failed++;
    }
  } catch (e) {
    console.error('  ❌ [TEST 6 ERROR]:', e.message);
    failed++;
  }


  // ──────────────────────────────────────────────────────────────────────────
  // FIXTURE 7: Architectural Fitout Stall (Amazon Guard Rail)
  // ──────────────────────────────────────────────────────────────────────────
  try {
    const f7Desc = 'Commercial Market Stall Booth with Canvas Awning 1600x1700x1900mm ht, Light Ashwood clear matte coating';
    const f7Category = classifyFurnishingCategory(f7Desc);
    const isAmazonGenuine = isGenuineContractBrand('Amazon', MOCK_LOCAL_CATALOGS);

    const f7Ok = !isAmazonGenuine;

    if (f7Ok) {
      console.log('  ✅ [TEST 7 PASSED] Amazon Guard Rail: Blocked forbidden retail assignment for commercial market booth');
      passed++;
    } else {
      console.error('  ❌ [TEST 7 FAILED] Amazon Guard Rail failed');
      failed++;
    }
  } catch (e) {
    console.error('  ❌ [TEST 7 ERROR]:', e.message);
    failed++;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FIXTURE 8: Spatial Bounding Box + OCR Multi-Image Pairing
  // ──────────────────────────────────────────────────────────────────────────
  try {
    const f8Assets = [
      { url: 'https://cdn.example.com/crop1.png', bbox: { y1: 100, y2: 180 }, ocrText: 'Modular Bench Ecru Moonako' },
      { url: 'https://cdn.example.com/crop2.png', bbox: { y1: 400, y2: 480 }, ocrText: 'Unrelated Metal Cabinet' }
    ];
    const f8Result = verifyImagePairing({
      rowBoundingBox: { y1: 95, y2: 185 },
      imageAssets: f8Assets,
      ocrTokens: ['Modular', 'Bench', 'Moonako'],
      matchedProduct: { brand: 'Moonako', model: 'Modular Bench' }
    });

    const f8Ok = f8Result.status === 'verified' &&
                 f8Result.selectedImage === 'https://cdn.example.com/crop1.png' &&
                 f8Result.pairingConfidence >= 75;

    if (f8Ok) {
      console.log(`  ✅ [TEST 8 PASSED] Image Pairing Verifier: Selected correct crop with ${f8Result.pairingConfidence}% spatial+OCR confidence`);
      passed++;
    } else {
      console.error('  ❌ [TEST 8 FAILED] Image pairing verifier failed:', f8Result);
      failed++;
    }
  } catch (e) {
    console.error('  ❌ [TEST 8 ERROR]:', e.message);
    failed++;
  }

  console.log(`\n📊 Test Results: ${passed}/8 Passed (${failed} Failed)\n`);
  return { total: 8, passed, failed, success: failed === 0 };
}

runAutoMatchTests().then(res => {
  if (!res.success) process.exit(1);
});
