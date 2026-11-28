import assert from 'node:assert/strict';
import { FITOUT_CATALOG_SEED, toLegacyFitoutBrand } from '../server/data/fitoutCatalogSeed.js';
import { FABRICATION_CATALOG_SEED } from '../server/data/fabricationCatalogSeed.js';
import { VE_CATEGORY_CONFIG, BRAND_ALIASES } from '../server/utils/veCategoryPriority.js';
import { findHybridSemanticMatches } from '../server/embeddingService.js';
import { extractEmbeddedRasterFromMetafile } from '../server/utils/emfConverter.js';
import { normalizeBudgetTier, searchFitoutHybrid } from '../server/repositories/supabaseCatalogRepo.js';
import {
  isBadOrPlaceholderImageUrl,
  isNonProductCatalogRow,
  normalizeProductImageUrl,
} from '../server/utils/catalogHygiene.js';

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  PASS: ${name}`);
    });
}

await test('1. FitOut V2 3-tier seed has zero junk price=0 items and strict budgetary < mid < high', () => {
  assert.ok(FITOUT_CATALOG_SEED.length >= 45);
  for (const item of FITOUT_CATALOG_SEED) {
    assert.ok(['SQM', 'LM', 'Nos'].includes(item.unit), `Invalid unit ${item.unit}`);
    assert.ok(item.rate_budgetary > 0 && item.rate_mid > 0 && item.rate_high > 0);
    assert.ok(item.rate_budgetary < item.rate_mid, `${item.code}: budgetary >= mid`);
    assert.ok(item.rate_mid < item.rate_high, `${item.code}: mid >= high`);
    assert.notEqual(item.spec_budgetary, item.spec_mid);
    assert.notEqual(item.spec_mid, item.spec_high);
  }
  const bud = toLegacyFitoutBrand('budgetary');
  const mid = toLegacyFitoutBrand('mid');
  const hi = toLegacyFitoutBrand('high');
  assert.ok(bud.products[10].price < mid.products[10].price);
  assert.ok(mid.products[10].price < hi.products[10].price);
});

await test('2. Custom Fabrication seed covers 3 tiers & Design & Build kinds cleanly', () => {
  assert.ok(FABRICATION_CATALOG_SEED.length >= 16);
  for (const f of FABRICATION_CATALOG_SEED) {
    assert.ok(f.rate_budgetary < f.rate_mid && f.rate_mid < f.rate_high);
    assert.ok(f.design_build_kind);
    assert.ok(Array.isArray(f.detection_keywords) && f.detection_keywords.length > 0);
  }
});

await test('3. FitOut hybrid search returns distinct prices per budget tier', async () => {
  const b = await searchFitoutHybrid({ queryText: 'commercial carpet tile 500x500', tier: 'budgetary', unitHint: 'SQM', topK: 1 });
  const m = await searchFitoutHybrid({ queryText: 'commercial carpet tile 500x500', tier: 'mid', unitHint: 'SQM', topK: 1 });
  const h = await searchFitoutHybrid({ queryText: 'commercial carpet tile 500x500', tier: 'high', unitHint: 'SQM', topK: 1 });
  assert.ok(b[0] && m[0] && h[0]);
  assert.ok(b[0].price < m[0].price && m[0].price < h[0].price);
});

await test('4. VE category config & brand aliases are clean (no MW Structure Test / Dauphin blurb)', () => {
  assert.equal(VE_CATEGORY_CONFIG.auditoriumAndTheatre, undefined);
  assert.ok(VE_CATEGORY_CONFIG.auditoriumAndTheater);
  assert.equal(BRAND_ALIASES['mw structure test'], 'M&W');
  assert.equal(BRAND_ALIASES['dauphin'], 'Dauphin');
  assert.equal(BRAND_ALIASES['nrbutas'], 'NARBUTAS');
  assert.ok(!VE_CATEGORY_CONFIG.desking.priorityBrands.includes('MW Structure Test'));
});

await test('5. Embedding service never fabricates 0.75 cosine similarity when unembedded', async () => {
  const res = await findHybridSemanticMatches({
    description: 'completely unrelated quantum flux capacitor item',
    brandName: 'TestBrand',
    products: [{ model: 'ErgoTask', description: 'Mesh swivel task chair' }],
    topK: 1,
  });
  assert.ok(res.length === 1);
  assert.ok(res[0].confidenceScore < 35, `Expected low honest score without fake 0.75 cosine, got ${res[0].confidenceScore}`);
});

await test('6. Pure-JS EMF metafile extractor recovers embedded PNG and JPEG streams without Railway', () => {
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const pngBody = Buffer.from('test-png-data');
  const pngEnd = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  const fakeEmfWithPng = Buffer.concat([Buffer.alloc(64, 1), pngHeader, pngBody, pngEnd, Buffer.alloc(16, 0)]);
  const extractedPng = extractEmbeddedRasterFromMetafile(fakeEmfWithPng);
  assert.equal(extractedPng?.ext, '.png');
  assert.equal(extractedPng?.data.length, pngHeader.length + pngBody.length + pngEnd.length);

  const jpgFake = Buffer.concat([Buffer.alloc(40, 0), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 0xff, 0xd9])]);
  const extractedJpg = extractEmbeddedRasterFromMetafile(jpgFake);
  assert.equal(extractedJpg?.ext, '.jpg');
});

await test('7. Tier normalization maps premium -> high cleanly', () => {
  assert.equal(normalizeBudgetTier('premium'), 'high');
  assert.equal(normalizeBudgetTier('budget'), 'budgetary');
  assert.equal(normalizeBudgetTier('MID'), 'mid');
});

await test('8. Catalog hygiene removes non-product metadata & placeholder URLs while keeping real furniture', () => {
  assert.equal(isNonProductCatalogRow({ model: 'Test certificates', main_category: 'Certificates and resources' }, 'ISMOBIL').isJunk, true);
  assert.equal(isNonProductCatalogRow({ model: 'AEGIS GALLERY', sub_category: 'Image Gallery' }, 'Teknion ME').isJunk, true);
  assert.equal(isNonProductCatalogRow({ model: '502 Bad Gateway' }, 'Sedus Stoll').isJunk, true);
  assert.equal(isNonProductCatalogRow({ model: '<img src="logo.svg" />' }, 'ISMOBIL').isJunk, true);
  assert.equal(isNonProductCatalogRow({ model: 'Seda', description: 'Unfortunately, I was unable to find more information on the product.' }, 'NARBUTAS').isJunk, true);

  assert.equal(isNonProductCatalogRow({ model: 'Gallery Desk #1543258', main_category: 'Furniture', sub_category: 'Directional Collection' }, 'Ofifran').isJunk, false);
  assert.equal(isNonProductCatalogRow({ model: 'Reefs solitary 3-seater bench with privacy panel', main_category: 'Furniture' }, 'Dauphin').isJunk, false);
  assert.equal(isNonProductCatalogRow({ model: 'Manual Flip Up Power Socket', main_category: 'Accessories' }, 'Ottimo Furniture').isJunk, false);

  assert.equal(isBadOrPlaceholderImageUrl('data:image/svg+xml;base64,PHN2Zw=='), true);
  assert.equal(isBadOrPlaceholderImageUrl('https://placehold.co/240x240/ffffff/000000?text=Image%20not%20found'), true);
  assert.equal(isBadOrPlaceholderImageUrl('https://media.architonic.com/m-on/10001981/logo/narbutas_logo_c1db0dc7.jpeg'), true);
  assert.equal(normalizeProductImageUrl('/Uploads/202404/ambi.jpg', '', 'M&W'), 'https://www.mwworkstation.com/Uploads/202404/ambi.jpg');
});

console.log(`\n✅ productionPipelines.test.js: ${passed} checks passed.`);
