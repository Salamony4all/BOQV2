/**
 * Live Supabase Storage Bucket Provisioner, Catalog Sanitizer & V2 Migrator.
 * Usage: node scripts/migrateToSupabaseV2.js [--dry-run] [--backfill-embeddings]
 */
import fs from 'fs';
import path from 'path';
import '../server/loadEnv.js';
import { supabaseAdmin } from '../server/utils/supabaseStorage.js';
import { toLegacyFitoutBrand, FITOUT_CATALOG_SEED } from '../server/data/fitoutCatalogSeed.js';
import { FABRICATION_CATALOG_SEED } from '../server/data/fabricationCatalogSeed.js';
import { classifyFurnishingCategory } from '../server/utils/veCategoryPriority.js';
import { getBatchEmbeddings } from '../server/embeddingService.js';
import { readSettings } from '../server/settings.js';
import { isNonProductCatalogRow, normalizeProductImageUrl } from '../server/utils/catalogHygiene.js';

const DRY_RUN = process.argv.includes('--dry-run');
const BACKFILL_EMBEDDINGS = process.argv.includes('--backfill-embeddings');
const V2_ONLY = process.argv.includes('--v2-only');
const USE_BILLED = process.argv.includes('--use-billed');
const FORCE_REEMBED = process.argv.includes('--force-reembed');

if (!supabaseAdmin) {
  console.error('Supabase admin client is not initialized.');
  process.exit(1);
}

const CANONICAL_BRAND_RENAMES = new Map([
  ['mw structure test', 'M&W'],
  ['m&w', 'M&W'],
  ['mw', 'M&W'],
  ['dauphin products, collections and more', 'Dauphin'],
  ['nrbutas', 'NARBUTAS'],
  ['narbutas', 'NARBUTAS'],
  ['brees new world', "Bree's New World"],
  ["bree's new world", "Bree's New World"],
  ['magis spa', 'Magis'],
  ['magis', 'Magis'],
  ['workspace', 'Workspace.ae'],
  ['workspace.ae', 'Workspace.ae'],
  ['ottimo', 'Ottimo Furniture'],
  ['ottimo furniture', 'Ottimo Furniture'],
  ['sedus', 'Sedus Stoll'],
  ['sedus stoll', 'Sedus Stoll'],
  ['bt design', 'B&T Design'],
  ['b&t design', 'B&T Design'],
  ['teknion me', 'Teknion ME'],
  ['al khoudh', 'HADID'],
  ['al khoudh steel furniture', 'HADID'],
]);

const HIGH_TIER_BRANDS = new Set([
  'arper', 'teknion me', 'herman miller', 'steelcase', 'vitra', 'knoll',
  'dedon', 'freifrau', 'andreu world', 'figueras', 'please wait to be seated', 'hay', 'muuto', 'walter knoll'
]);
const BUDGETARY_TIER_BRANDS = new Set([
  'ottimo furniture', 'amara', 'hadid', 'xinda clover', 'workspace.ae', 'studio designs', 'sew ready'
]);

const normalizeKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'brand';

function canonicalBrandName(raw = '') {
  const clean = String(raw || '').replace(/\s+/g, ' ').trim();
  const low = clean.toLowerCase();
  if (CANONICAL_BRAND_RENAMES.has(low)) return CANONICAL_BRAND_RENAMES.get(low);
  return clean;
}

function normalizeTierForBrand(brandName, currentTier = 'mid') {
  const low = String(brandName || '').toLowerCase().trim();
  if (HIGH_TIER_BRANDS.has(low)) return 'high';
  if (BUDGETARY_TIER_BRANDS.has(low)) return 'budgetary';
  const t = String(currentTier || 'mid').toLowerCase().trim();
  if (t === 'premium' || t === 'high') return 'high';
  if (t === 'budgetary' || t === 'budget') return 'budgetary';
  return 'mid';
}

function productQualityScore(p) {
  let score = 0;
  if (p?.verified === true) score += 20;
  const img = String(p?.imageUrl || '');
  if (img.startsWith('http') && !/img\.architonic\.com/i.test(img)) score += 15;
  else if (img.startsWith('http')) score += 4;
  if (parseFloat(p?.price) > 0) score += 12;
  const desc = String(p?.description || '').trim();
  if (desc.length >= 25 && !/could not be found|unable to/i.test(desc)) score += 8;
  const url = String(p?.officialProductUrl || p?.productUrl || p?.websiteUrl || '');
  if (url.startsWith('http') && !/architonic\.com/i.test(url)) score += 5;
  return score;
}

function mergeProductArrays(existing = [], incoming = []) {
  const byModel = new Map();
  for (const p of [...existing, ...incoming]) {
    if (!p || !p.model) continue;
    const key = String(p.model).toLowerCase().replace(/#\d+/g, '').replace(/\s+/g, ' ').trim();
    if (!key) continue;
    const prev = byModel.get(key);
    if (!prev || productQualityScore(p) > productQualityScore(prev)) {
      byModel.set(key, p);
    }
  }
  return Array.from(byModel.values());
}

async function ensureAllBuckets() {
  const required = [
    { name: 'assets', public: true, fileSizeLimit: 15728640 },
    { name: 'extracted-images', public: true, fileSizeLimit: 15728640 },
    { name: 'product-images', public: true, fileSizeLimit: 10485760 },
    { name: 'fabrication-assets', public: true, fileSizeLimit: 15728640 },
    { name: 'plan-uploads', public: false, fileSizeLimit: 52428800 },
  ];
  const { data: existing, error } = await supabaseAdmin.storage.listBuckets();
  if (error) {
    console.warn('Could not list buckets:', error.message);
    return;
  }
  const existingNames = new Set((existing || []).map(b => b.name));
  for (const spec of required) {
    if (existingNames.has(spec.name)) {
      console.log(`  Bucket exists: ${spec.name}`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would create bucket: ${spec.name} (public=${spec.public})`);
      continue;
    }
    const { error: cErr } = await supabaseAdmin.storage.createBucket(spec.name, {
      public: spec.public,
      fileSizeLimit: spec.fileSizeLimit,
    });
    if (cErr && !/already exists/i.test(cErr.message)) {
      console.warn(`  Bucket create warning (${spec.name}): ${cErr.message}`);
    } else {
      console.log(`  Created bucket: ${spec.name} (public=${spec.public})`);
    }
  }
}

async function sanitizeLegacyBrandsTable() {
  const { data: rawBrands, error } = await supabaseAdmin
    .from('brands')
    .select('id, name, products, source, budget_tier, logo, updated_at');
  if (error) throw error;

  console.log(`\nLoaded ${rawBrands.length} live brand rows from Supabase.`);
  if (!V2_ONLY) {
    fs.mkdirSync('supabase/.temp', { recursive: true });
    const backupPath = `supabase/.temp/brands_backup_${Date.now()}.json`;
    fs.writeFileSync(backupPath, JSON.stringify(rawBrands, null, 2));
    console.log(`Backup written to ${backupPath}`);
  }

  const fitoutRows = [];
  const furnitureGroups = new Map(); // canonicalLower -> merged row + mergedIds
  const idsToDelete = new Set();

  for (const b of rawBrands) {
    const rawName = String(b.name || '').trim();
    if (!rawName) {
      idsToDelete.add(String(b.id));
      continue;
    }

    if (/fitout/i.test(rawName)) {
      fitoutRows.push(b);
      continue;
    }

    const canonName = canonicalBrandName(rawName);
    const prods = Array.isArray(b.products) ? b.products : [];
    if (prods.length === 0 && /VE-Prescan-Discovery/i.test(String(b.source || ''))) {
      idsToDelete.add(String(b.id));
      continue;
    }

    const key = normalizeKey(canonName);
    if (!furnitureGroups.has(key)) {
      furnitureGroups.set(key, {
        keepId: String(b.id),
        allIds: [String(b.id)],
        name: canonName,
        source: /UNKNOWN|VE-Prescan/i.test(String(b.source || '')) && canonName === 'M&W' ? 'CHINA' : (b.source || 'Supabase'),
        budget_tier: normalizeTierForBrand(canonName, b.budget_tier),
        logo: b.logo || '',
        products: mergeProductArrays([], prods.map(p => ({ ...p, brand: canonName }))),
      });
    } else {
      const grp = furnitureGroups.get(key);
      grp.allIds.push(String(b.id));
      // Prefer richer/non-prescan record id & logo
      if (prods.length > grp.products.length && !/VE-Prescan/i.test(String(b.source || ''))) {
        grp.keepId = String(b.id);
      }
      if (!grp.logo && b.logo) grp.logo = b.logo;
      grp.products = mergeProductArrays(grp.products, prods.map(p => ({ ...p, brand: canonName })));
    }
  }

  for (const grp of furnitureGroups.values()) {
    for (const id of grp.allIds) {
      if (id !== grp.keepId) idsToDelete.add(id);
    }
  }

  // Prepare clean 3-tier FitOut V2 rows (replacing 3 identical clones)
  const cleanFitoutUpserts = ['budgetary', 'mid', 'high'].map((tier) => {
    const leg = toLegacyFitoutBrand(tier);
    return {
      id: String(leg.id),
      name: leg.name,
      products: leg.products,
      source: 'Fitout-Seed-V2',
      budget_tier: tier,
      logo: leg.logo || '',
    };
  });

  if (V2_ONLY) {
    console.log(`V2-only mode: preserving legacy \`brands\`; extracted ${furnitureGroups.size} furniture brands.`);
    return Array.from(furnitureGroups.values());
  }

  // Update local fitout_v2 JSON files too so local fallback matches
  for (const tier of ['budgetary', 'mid', 'high']) {
    const leg = toLegacyFitoutBrand(tier);
    const localPath = path.resolve(`server/data/brands/fitout_v2-${tier}.json`);
    if (!DRY_RUN) {
      fs.writeFileSync(localPath, JSON.stringify(leg, null, 2));
    }
  }

  console.log(`Sanitization plan:
  - Raw rows: ${rawBrands.length}
  - Clean furniture brands: ${furnitureGroups.size}
  - Clean FitOut tiers: ${cleanFitoutUpserts.length}
  - Duplicate / 0-prod stub rows to delete: ${idsToDelete.size}`);

  if (DRY_RUN) return Array.from(furnitureGroups.values());

  // Upsert merged furniture brands
  for (const grp of furnitureGroups.values()) {
    const { error: uErr } = await supabaseAdmin.from('brands').upsert({
      id: grp.keepId,
      name: grp.name,
      products: grp.products,
      source: grp.source,
      budget_tier: grp.budget_tier,
      logo: grp.logo,
    }, { onConflict: 'id' });
    if (uErr) console.warn(`  Upsert warning (${grp.name}):`, uErr.message);
  }

  // Upsert clean 3-tier FitOut V2 rows
  for (const fRow of cleanFitoutUpserts) {
    const { error: fErr } = await supabaseAdmin.from('brands').upsert(fRow, { onConflict: 'id' });
    if (fErr) console.warn(`  FitOut upsert warning (${fRow.budget_tier}):`, fErr.message);
  }

  // Delete duplicate/stub IDs (remove any stale fitout ids not in canonical set)
  const fitoutKeepIds = new Set(cleanFitoutUpserts.map(r => r.id));
  for (const fr of fitoutRows) {
    if (!fitoutKeepIds.has(String(fr.id))) idsToDelete.add(String(fr.id));
  }
  const delArr = Array.from(idsToDelete);
  if (delArr.length > 0) {
    const { error: dErr } = await supabaseAdmin.from('brands').delete().in('id', delArr);
    if (dErr) console.warn('  Delete warning:', dErr.message);
    else console.log(`  Deleted ${delArr.length} duplicate/stub brand rows.`);
  }

  return Array.from(furnitureGroups.values());
}

async function checkAndPopulateNormalizedTables(cleanedBrands) {
  const { error: checkErr } = await supabaseAdmin.from('catalog_brands').select('id').limit(1);
  if (checkErr) {
    console.log(`\nNormalized tables not yet applied (${checkErr.message}).`);
    console.log('To enable pgvector + sub-80ms SQL RPCs, run supabase/migrations/20261124_01_production_ai_pipelines.sql in Supabase SQL Editor.');
    return false;
  }

  console.log('\nNormalized V2 tables detected! Syncing catalog_brands, catalog_products, fitout_catalog, fabrication_catalog...');
  if (DRY_RUN) return true;

  // 1. Seed FitOut & Fabrication catalogs
  for (const item of FITOUT_CATALOG_SEED) {
    await supabaseAdmin.from('fitout_catalog').upsert(item, { onConflict: 'code' });
  }
  console.log(`  Upserted ${FITOUT_CATALOG_SEED.length} fitout_catalog rows.`);

  for (const fab of FABRICATION_CATALOG_SEED) {
    await supabaseAdmin.from('fabrication_catalog').upsert(fab, { onConflict: 'sku_code' });
  }
  console.log(`  Upserted ${FABRICATION_CATALOG_SEED.length} fabrication_catalog rows.`);

  // 2. Sync catalog_brands & catalog_products
  for (const b of cleanedBrands) {
    const slug = slugify(b.name);
    const { data: bData, error: bErr } = await supabaseAdmin
      .from('catalog_brands')
      .upsert({
        legacy_id: b.keepId,
        slug,
        name: b.name,
        budget_tier: b.budget_tier,
        origin: b.source || '',
        logo_url: b.logo || '',
        status: b.products.length > 0 ? 'verified' : 'pending_enrichment',
      }, { onConflict: 'slug' })
      .select('id')
      .single();

    if (bErr || !bData?.id) {
      console.warn(`  catalog_brands error (${b.name}):`, bErr?.message);
      continue;
    }

    const rows = [];
    const seenNorm = new Set();
    for (const p of b.products) {
      if (isNonProductCatalogRow(p, b.name).isJunk) continue;
      const mNorm = String(p.model || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (!mNorm || seenNorm.has(mNorm)) continue;
      seenNorm.add(mNorm);
      const offUrl = p.officialProductUrl || p.productUrl || p.websiteUrl || null;
      const cleanImg = normalizeProductImageUrl(p.imageUrl, offUrl || '', b.name);
      const archetype = classifyFurnishingCategory(`${p.model || ''} ${p.mainCategory || ''} ${p.subCategory || ''} ${p.description || ''}`);
      rows.push({
        brand_id: bData.id,
        model: String(p.model).trim(),
        model_normalized: mNorm,
        family: p.family || null,
        main_category: p.mainCategory || p.category || null,
        sub_category: p.subCategory || null,
        archetype,
        description: p.description || null,
        price: Number(p.price) > 0 ? Number(p.price) : 0,
        currency: p.currency || 'USD',
        price_source: Number(p.price) > 0 ? 'scraped_retail' : 'unpriced',
        image_url: cleanImg || null,
        source_image_url: cleanImg || p.imageUrl || null,
        official_url: offUrl,
        verified: Boolean(p.verified && cleanImg),
        source: p.source || 'Migrated',
      });
    }

    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { error: pErr } = await supabaseAdmin
        .from('catalog_products')
        .upsert(chunk, { onConflict: 'brand_id,model_normalized' });
      if (pErr) console.warn(`  catalog_products chunk error (${b.name}):`, pErr.message);
    }
  }

  if (BACKFILL_EMBEDDINGS) {
    const billedKey = USE_BILLED ? (readSettings().googleApiKey || null) : null;
    console.log(`\nBackfilling canonical Gemini-embedding-2 768-d vectors (keyMode=${billedKey ? 'billed' : 'default'})...`);
    for (const table of ['fitout_catalog', 'fabrication_catalog', 'catalog_products']) {
      if (FORCE_REEMBED) {
        const { error: clrErr } = await supabaseAdmin.from(table).update({ embedding: null }).not('embedding', 'is', null);
        if (clrErr) console.warn(`  [${table}] Force re-embed clear warning: ${clrErr.message}`);
        else console.log(`  [${table}] Cleared existing embeddings for uniform re-embed.`);
      }

      const cols = table === 'fitout_catalog'
        ? 'id, code, name, trade, sub_trade, spec_mid'
        : table === 'fabrication_catalog'
          ? 'id, sku_code, name, category, sub_category, description_template'
          : 'id, model, family, main_category, sub_category, archetype, dimensions_mm, description, catalog_brands(name)';
      let totalEmbedded = 0;
      let batchNum = 0;

      while (true) {
        const { data: missing, error: selErr } = await supabaseAdmin
          .from(table)
          .select(cols)
          .is('embedding', null)
          .limit(100);
        if (selErr) {
          console.error(`  [${table}] Select error: ${selErr.message}`);
          break;
        }
        if (!missing?.length) break;

        batchNum++;
        const texts = missing.map((r) => {
          if (table === 'catalog_products') {
            return [
              r.catalog_brands?.name || '',
              r.archetype || '',
              r.model || '',
              r.family || '',
              r.main_category || '',
              r.sub_category || '',
              r.dimensions_mm || '',
              r.description || '',
            ].filter(Boolean).join(' | ').slice(0, 1800);
          }
          return Object.entries(r)
            .filter(([k, v]) => k !== 'id' && v)
            .map(([, v]) => String(v))
            .join(' | ')
            .slice(0, 1500);
        });

        let vecs = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          vecs = await getBatchEmbeddings(texts, billedKey);
          const gotAny = Array.isArray(vecs) && vecs.some(v => Array.isArray(v) && v.length === 768);
          if (gotAny) break;
          if (attempt < 2) {
            console.warn(`  [${table}] Batch ${batchNum} returned 0 valid vectors (attempt ${attempt + 1}/3); pausing 6s before retry...`);
            await new Promise(r => setTimeout(r, 6000));
          }
        }

        const validIndices = [];
        for (let i = 0; i < missing.length; i++) {
          if (Array.isArray(vecs?.[i]) && vecs[i].length === 768) {
            validIndices.push(i);
          }
        }
        if (validIndices.length === 0) {
          console.error(`  [${table}] Stopping backfill: persistent embedding failure after retries.`);
          break;
        }

        let batchUpdated = 0;
        for (let j = 0; j < validIndices.length; j += 25) {
          const slice = validIndices.slice(j, j + 25);
          const results = await Promise.all(
            slice.map(async (idx) => {
              const { error: uErr } = await supabaseAdmin
                .from(table)
                .update({ embedding: JSON.stringify(vecs[idx]) })
                .eq('id', missing[idx].id);
              return uErr;
            })
          );
          const firstErr = results.find(Boolean);
          if (firstErr) {
            console.error(`  [${table}] Update error on batch ${batchNum}: ${firstErr.message}`);
            batchUpdated = -1;
            break;
          }
          batchUpdated += slice.length;
        }

        if (batchUpdated <= 0) break;
        totalEmbedded += batchUpdated;
        console.log(`  [${table}] Batch ${batchNum}: embedded ${batchUpdated}/${missing.length} rows (total: ${totalEmbedded}).`);

        if (batchUpdated < missing.length) {
          console.warn(`  [${table}] Partial batch update (${batchUpdated}/${missing.length}); stopping to inspect remainder.`);
          break;
        }
      }

      console.log(`  Finished ${table}: ${totalEmbedded} rows newly embedded.`);
    }
  }
  return true;
}

async function main() {
  console.log(`🚀 Supabase V2 Migration starting (dryRun=${DRY_RUN}, backfillEmbeddings=${BACKFILL_EMBEDDINGS})...`);
  await ensureAllBuckets();
  const cleanedBrands = await sanitizeLegacyBrandsTable();
  await checkAndPopulateNormalizedTables(cleanedBrands);
  console.log('\n✅ Supabase V2 Migration completed.');
}

main().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
