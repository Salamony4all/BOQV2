import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  detectCustomFabrication,
  parseDimensionsMm,
  detectShapeHint,
  computeParametricFabricationRate,
} from '../server/utils/customFabricationDetector.js';
import { FABRICATION_CATALOG_SEED } from '../server/data/fabricationCatalogSeed.js';
import { searchFabricationHybrid, createFabricationItem, deleteFabricationItem } from '../server/repositories/supabaseCatalogRepo.js';
import { customProducts, inferArchitecturalRole, productsFromTables } from '../src/features/designBuild/designBuildStore.js';
import { resolveItemFinishes } from '../src/utils/officialBrandFinishes.js';

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  PASS: ${name}`);
    });
}

const VALID_DB_KINDS = new Set([
  'seat', 'sofa', 'table', 'side-table', 'desk', 'bed', 'storage', 'plant', 'screen', 'sanitary', 'equipment', 'joinery', 'ceiling',
]);

await test('1. Detects curved bespoke reception counter early & maps to Design & Build PieceKind', () => {
  const res = detectCustomFabrication('Curved Reception Counter 3200 x 850 x 1050 mm in fluted oak veneer and Corian solid surface top');
  assert.equal(res.isCustomFabrication, true);
  assert.equal(res.categoryHint, 'Reception Counter');
  assert.equal(res.designBuildKind, 'desk');
  assert.equal(res.designBuildSubtype, 'reception-counter');
  assert.equal(res.shape, 'curved');
  assert.equal(res.parsedDimsMm?.widthMm, 3200);
});

await test('2. Detects built-in L-shaped banquette booth seating early', () => {
  const res = detectCustomFabrication('L-Shaped upholstered banquette booth seating 2600x1800x1050mm for staff pantry lounge');
  assert.equal(res.isCustomFabrication, true);
  assert.equal(res.categoryHint, 'Banquette Seating');
  assert.equal(res.designBuildKind, 'sofa');
  assert.equal(res.shape, 'l-shape');
});

await test('3. Detects oversized 18-pax boardroom table >=3600mm when unbranded', () => {
  const res = detectCustomFabrication('18-Pax Boardroom Conference Table 5400 x 1500 x 750 mm with book-matched walnut veneer and power boxes');
  assert.equal(res.isCustomFabrication, true);
  assert.equal(res.categoryHint, 'Bespoke Table');
  assert.equal(res.designBuildKind, 'table');
});

await test('4. Does NOT hijack branded contract furniture unless explicit custom cue is present', () => {
  const branded = detectCustomFabrication('Brand: NARBUTAS | Model: Nova Wood | Reception desk 1800x800mm', '', [{ name: 'NARBUTAS', products: [] }]);
  assert.equal(branded.isCustomFabrication, false);

  const looseChair = detectCustomFabrication('Ergonomic 5-star swivel task chair with breathable mesh back and lumbar support');
  assert.equal(looseChair.isCustomFabrication, false);
});

await test('5. Does NOT hijack flat architectural drywall/carpet fitout', () => {
  const carpet = detectCustomFabrication('Heavy-duty tufted nylon carpet tile 500x500mm with acoustic backing');
  assert.equal(carpet.isCustomFabrication, false);
});

await test('6. Parses dimension formats & shapes cleanly', () => {
  assert.equal(parseDimensionsMm('W: 2400 D: 800 H: 1050').widthMm, 2400);
  assert.equal(parseDimensionsMm('3.6m x 1.2m conference').widthMm, 3600);
  assert.equal(detectShapeHint('Semi-circular curved booth'), 'curved');
  assert.equal(detectShapeHint('U-shaped corner booth'), 'u-shape');
});

await test('7. Parametric pricing scales cleanly across tiers & widths, and all seed kinds match Design & Build', () => {
  for (const item of FABRICATION_CATALOG_SEED) {
    assert.ok(VALID_DB_KINDS.has(item.design_build_kind), `Invalid Design & Build PieceKind "${item.design_build_kind}" on ${item.sku_code}`);
  }
  const vanity = detectCustomFabrication('Corian Floating Washroom Vanity Counter 2000x600x850mm');
  assert.equal(vanity.designBuildKind, 'sanitary');
  assert.equal(vanity.designBuildSubtype, 'basin');
  const planter = detectCustomFabrication('Bespoke Acoustic Planter Box 1600x400x750mm');
  assert.equal(planter.designBuildKind, 'plant');

  const rec = FABRICATION_CATALOG_SEED.find(f => f.sku_code === 'FAB-REC-01');
  assert.ok(rec);
  assert.ok(rec.rate_budgetary < rec.rate_mid && rec.rate_mid < rec.rate_high);

  const stdMid = computeParametricFabricationRate(rec, 'mid', { widthMm: 2800 }, 1, 'Nos');
  const wideMid = computeParametricFabricationRate(rec, 'mid', { widthMm: 4200 }, 1, 'Nos');
  assert.equal(stdMid.unitRate, rec.rate_mid);
  assert.ok(wideMid.unitRate > stdMid.unitRate);

  const bnq = FABRICATION_CATALOG_SEED.find(f => f.sku_code === 'FAB-BNQ-01');
  const lmScaled = computeParametricFabricationRate(bnq, 'high', { widthMm: 3000 }, 1, 'Nos');
  assert.equal(lmScaled.unitRate, bnq.rate_high * 3);
});

await test('8. Hybrid search + custom fabrication CRUD roundtrip works', async () => {
  const customFabPath = path.resolve(process.cwd(), 'server/data/fabrication_custom.json');
  const hadCustomFab = fs.existsSync(customFabPath);
  const prevCustomFab = hadCustomFab ? fs.readFileSync(customFabPath, 'utf8') : null;
  try {
    const hits = await searchFabricationHybrid({
      queryText: 'curved fluted oak corian reception counter',
      tier: 'mid',
      designBuildKind: 'desk',
      shape: 'curved',
      topK: 3,
    });
    assert.ok(hits.length > 0);
    assert.equal(hits[0].sku_code, 'FAB-REC-01');

    const created = await createFabricationItem({
      sku_code: 'FAB-TEST-999',
      name: 'Test Custom Timber Pod Bench',
      design_build_kind: 'sofa',
      rate_mid: 350,
    });
    assert.equal(created.sku_code, 'FAB-TEST-999');
    assert.equal(created.rate_budgetary, Math.round(350 * 0.7));
    await deleteFabricationItem('FAB-TEST-999');
  } finally {
    if (hadCustomFab && prevCustomFab !== null) {
      fs.writeFileSync(customFabPath, prevCustomFab, 'utf8');
    } else if (fs.existsSync(customFabPath)) {
      fs.unlinkSync(customFabPath);
    }
  }
});

await test('9. Architectural kiosk, slatted ceiling canopy & curved slat screen templates seed cleanly', () => {
  const ksk = FABRICATION_CATALOG_SEED.find((f) => f.sku_code === 'FAB-KSK-01');
  const clg = FABRICATION_CATALOG_SEED.find((f) => f.sku_code === 'FAB-CLG-01');
  const scr = FABRICATION_CATALOG_SEED.find((f) => f.sku_code === 'FAB-SCR-01');
  assert.ok(ksk && ksk.design_build_subtype === 'retail-kiosk');
  assert.ok(clg && clg.design_build_subtype === 'rotunda-canopy');
  assert.ok(scr && scr.design_build_subtype === 'slat-screen');
});

await test('10. Custom booth, wardrobe, kitchen island & wall artwork templates + cross-app bridge fields work', () => {
  const bth = FABRICATION_CATALOG_SEED.find((f) => f.sku_code === 'FAB-BTH-01');
  const wrd = FABRICATION_CATALOG_SEED.find((f) => f.sku_code === 'FAB-WRD-01');
  const isl = FABRICATION_CATALOG_SEED.find((f) => f.sku_code === 'FAB-ISL-01');
  const art = FABRICATION_CATALOG_SEED.find((f) => f.sku_code === 'FAB-ART-01');
  assert.equal(bth?.design_build_subtype, 'booth');
  assert.equal(wrd?.design_build_subtype, 'wardrobe');
  assert.equal(isl?.design_build_subtype, 'island');
  assert.equal(art?.design_build_subtype, 'wall-art');

  assert.equal(
    inferArchitecturalRole({ code: 'FAB-ART-01', description: art.name, designBuildKind: art.design_build_kind, subtype: art.design_build_subtype }),
    'wall-artwork',
  );

  const products = productsFromTables([
    {
      sheetName: 'Custom',
      header: ['SN', 'Image', 'Description', 'Brand', 'Model', 'Qty', 'Unit', 'Rate', 'Amount'],
      rows: [
        {
          cells: ['1', '', isl.description_template, 'Custom Fabrication', isl.sku_code, 1, 'Nos', isl.rate_mid, isl.rate_mid],
          fulfillmentType: 'custom_fabrication',
          skuCode: isl.sku_code,
          designBuildKind: isl.design_build_kind,
          designBuildSubtype: isl.design_build_subtype,
          dimensionsMm: '2800x1100x900 mm',
        },
        {
          cells: ['2', '', art.description_template, 'Custom Fabrication', art.sku_code, 1, 'Nos', art.rate_mid, art.rate_mid],
          fulfillmentType: 'custom_fabrication',
          skuCode: art.sku_code,
          designBuildKind: art.design_build_kind,
          designBuildSubtype: art.design_build_subtype,
          dimensionsMm: '1800x60x1200 mm',
        },
      ],
    },
  ]);

  assert.equal(products.length, 2);
  assert.equal(products[0].subtype, 'island');
  assert.equal(products[1].subtype, 'wall-art');
  assert.equal(products[1].architecturalRole, 'wall-artwork');
  const finishes = resolveItemFinishes({ brand: 'Custom Fabrication', description: 'Calacatta marble waterfall island in oak & brushed brass' });
  assert.ok(finishes.length >= 2);
});

await test('11. customProducts maps arch_walls / isWallTarget to wall-cladding and wall-artwork roles', () => {
  const mapped = customProducts([
    {
      typeId: 'arch_walls',
      isWallTarget: true,
      kind: 'screen',
      subtype: 'wall-cladding',
      name: 'Fluted Oak Feature Cladding',
      count: 2,
      rate: 185,
      materialSpec: 'Fluted white oak slats on black acoustic felt',
      skuCode: 'WC-FLT-01',
    },
    {
      typeId: 'arch_walls',
      isWallTarget: true,
      kind: 'screen',
      subtype: 'wall-art',
      name: 'Commissioned Bas-Relief Artwork',
      count: 1,
      rate: 320,
      materialSpec: 'Hand-carved plaster relief in brushed bronze frame',
      skuCode: 'FAB-ART-01',
    },
  ]);

  assert.equal(mapped.length, 2);
  assert.equal(mapped[0].customZoneId, 'arch_walls');
  assert.equal(mapped[0].architecturalRole, 'wall-cladding');
  assert.equal(mapped[0].designBuildKind, 'screen');
  assert.equal(mapped[1].customZoneId, 'arch_walls');
  assert.equal(mapped[1].architecturalRole, 'wall-artwork');
  assert.equal(mapped[1].designBuildKind, 'screen');
});

console.log(`\n✅ customFabrication.test.js: ${passed} checks passed.`);
