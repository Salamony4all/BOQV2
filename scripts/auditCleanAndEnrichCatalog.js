/**
 * Live Catalog Audit, Non-Product Cleanup & Dynamic Image Recovery.
 * Usage:
 *   node scripts/auditCleanAndEnrichCatalog.js --dry-run
 *   node scripts/auditCleanAndEnrichCatalog.js --apply
 */
import '../server/loadEnv.js';
import { supabaseAdmin } from '../server/utils/supabaseStorage.js';
import {
  fetchDynamicProductImage,
  isBadOrPlaceholderImageUrl,
  isNonProductCatalogRow,
  loadWordPressMediaIndex,
  normalizeProductImageUrl,
  verifyImageUrlReachable,
} from '../server/utils/catalogHygiene.js';

const DRY_RUN = !process.argv.includes('--apply');

if (!supabaseAdmin) {
  console.error('Supabase admin client is not initialized.');
  process.exit(1);
}

async function fetchAllRows(table, selectCols) {
  const all = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(selectCols)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}

async function main() {
  console.log(`\n🔎 Catalog Audit, Junk Removal & Image Enrichment (${DRY_RUN ? 'DRY RUN' : 'APPLY MODE'})...\n`);

  const brands = await fetchAllRows('catalog_brands', 'id, legacy_id, slug, name, budget_tier, logo_url, website_url, status');
  const brandById = new Map(brands.map(b => [b.id, b]));
  const products = await fetchAllRows(
    'catalog_products',
    'id, brand_id, model, model_normalized, family, main_category, sub_category, archetype, description, dimensions_mm, price, currency, price_source, image_url, source_image_url, official_url, verified, source'
  );

  console.log(`Loaded ${brands.length} catalog_brands and ${products.length} catalog_products.\n`);

  const junkRows = [];
  const junkByBrand = new Map();
  const realRows = [];

  for (const row of products) {
    const bName = brandById.get(row.brand_id)?.name || '';
    const check = isNonProductCatalogRow(row, bName);
    if (check.isJunk) {
      junkRows.push({ row, brandName: bName, reason: check.reason });
      const list = junkByBrand.get(bName) || [];
      list.push({ model: row.model, reason: check.reason });
      junkByBrand.set(bName, list);
    } else {
      realRows.push({ row, brandName: bName });
    }
  }

  console.log(`=== 1. NON-PRODUCT AUDIT (${junkRows.length} junk / ${realRows.length} kept) ===`);
  for (const [bName, items] of Array.from(junkByBrand.entries()).sort((a, b) => b[1].length - a[1].length)) {
    const sample = items.slice(0, 6).map(i => `${i.model} [${i.reason}]`).join('; ');
    console.log(`  - ${bName}: ${items.length} junk rows -> ${sample}`);
  }

  // Analyze images on kept rows
  const relativeOrTrimFix = [];
  const clearBadImg = [];
  const needDynamicFetch = [];
  const alreadyGoodImg = [];

  for (const { row, brandName } of realRows) {
    const rawImg = String(row.image_url || '');
    const normalized = normalizeProductImageUrl(rawImg, row.official_url || '', brandName);

    if (normalized) {
      if (normalized !== rawImg) {
        relativeOrTrimFix.push({ row, brandName, normalizedUrl: normalized });
      } else {
        alreadyGoodImg.push({ row, brandName });
      }
    } else {
      if (rawImg.trim() !== '') {
        clearBadImg.push({ row, brandName });
      }
      needDynamicFetch.push({ row, brandName });
    }
  }

  console.log(`\n=== 2. IMAGE AUDIT ON ${realRows.length} REAL PRODUCTS ===`);
  console.log(`  - Valid HTTP(S) non-placeholder images: ${alreadyGoodImg.length}`);
  console.log(`  - Fixable via trim / relative URL resolution: ${relativeOrTrimFix.length}`);
  console.log(`  - Bad / fake / SVG / logo images to clear & replace: ${clearBadImg.length}`);
  console.log(`  - Total requiring dynamic image fetch: ${needDynamicFetch.length}`);

  if (DRY_RUN) {
    const byBrandMissing = new Map();
    for (const { brandName } of needDynamicFetch) {
      byBrandMissing.set(brandName, (byBrandMissing.get(brandName) || 0) + 1);
    }
    console.log('\nMissing-image breakdown by brand (top 15):');
    for (const [b, c] of Array.from(byBrandMissing.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      console.log(`  - ${b}: ${c}`);
    }
    console.log('\nDry run complete. Re-run with --apply to clean DB and enrich missing images.');
    return;
  }

  // APPLY MODE
  // 1. Delete non-product rows
  console.log(`\nDeleting ${junkRows.length} non-product rows from catalog_products...`);
  const junkIds = junkRows.map(j => j.row.id);
  for (let i = 0; i < junkIds.length; i += 100) {
    const chunk = junkIds.slice(i, i + 100);
    const { error: delErr } = await supabaseAdmin.from('catalog_products').delete().in('id', chunk);
    if (delErr) console.error('  Delete error:', delErr.message);
  }
  console.log(`  Deleted ${junkIds.length} junk rows.`);

  // Mark any 0-product brands as pending_enrichment
  const countByBrandId = new Map();
  for (const { row } of realRows) {
    countByBrandId.set(row.brand_id, (countByBrandId.get(row.brand_id) || 0) + 1);
  }
  for (const b of brands) {
    const cnt = countByBrandId.get(b.id) || 0;
    if (cnt === 0 && b.status === 'verified') {
      await supabaseAdmin.from('catalog_brands').update({ status: 'pending_enrichment', updated_at: new Date().toISOString() }).eq('id', b.id);
      console.log(`  Marked empty brand as pending_enrichment: ${b.name}`);
    }
  }

  // 2. Verify & save normalized/relative URLs (e.g., M&W `/Uploads/...`)
  console.log(`\nNormalizing ${relativeOrTrimFix.length} relative/trimmed URLs & clearing ${clearBadImg.length} placeholder URLs...`);
  for (const { row, brandName, normalizedUrl } of relativeOrTrimFix) {
    const ok = await verifyImageUrlReachable(normalizedUrl, 6000);
    if (ok) {
      row.image_url = normalizedUrl;
      await supabaseAdmin.from('catalog_products').update({
        image_url: normalizedUrl,
        source_image_url: normalizedUrl,
        verified: true,
        updated_at: new Date().toISOString(),
      }).eq('id', row.id);
    } else {
      row.image_url = null;
      needDynamicFetch.push({ row, brandName });
      await supabaseAdmin.from('catalog_products').update({ image_url: null, verified: false }).eq('id', row.id);
    }
  }

  for (const { row } of clearBadImg) {
    row.image_url = null;
    await supabaseAdmin.from('catalog_products').update({ image_url: null, verified: false }).eq('id', row.id);
  }

  // 3. Pre-load AMARA WP media index once
  let amaraWpMedia = [];
  if (needDynamicFetch.some(x => x.brandName === 'AMARA')) {
    console.log('\nPre-loading AMARA WordPress media index...');
    amaraWpMedia = await loadWordPressMediaIndex('https://amara-art.com', 8);
    console.log(`  Loaded ${amaraWpMedia.length} AMARA WP media assets.`);
  }

  // 4. Dynamically recover missing product images in batches of 8
  console.log(`\nRecovering images for ${needDynamicFetch.length} products (concurrency=8)...`);
  let recoveredCount = 0;
  let failedCount = 0;
  const recoveredBySource = new Map();
  const CONCURRENCY = 8;

  for (let i = 0; i < needDynamicFetch.length; i += CONCURRENCY) {
    const slice = needDynamicFetch.slice(i, i + CONCURRENCY);
    await Promise.all(slice.map(async ({ row, brandName }) => {
      const wpIndex = brandName === 'AMARA' ? amaraWpMedia : null;
      const res = await fetchDynamicProductImage({
        brand: brandName,
        model: row.model,
        officialUrl: row.official_url || '',
        wpMediaIndex: wpIndex,
        mirrorToStorage: true,
        allowWebSearch: true,
      });

      if (res?.imageUrl && !isBadOrPlaceholderImageUrl(res.imageUrl)) {
        const patch = {
          image_url: res.imageUrl,
          source_image_url: res.sourceImageUrl || res.imageUrl,
          verified: true,
          updated_at: new Date().toISOString(),
        };
        if (res.description && (!row.description || row.description.length < 20)) {
          patch.description = res.description;
          row.description = res.description;
        }
        row.image_url = res.imageUrl;
        row.verified = true;
        await supabaseAdmin.from('catalog_products').update(patch).eq('id', row.id);
        recoveredCount++;
        recoveredBySource.set(res.source, (recoveredBySource.get(res.source) || 0) + 1);
      } else {
        failedCount++;
      }
    }));

    if ((i + CONCURRENCY) % 40 === 0 || i + CONCURRENCY >= needDynamicFetch.length) {
      console.log(`  Progress: ${Math.min(i + CONCURRENCY, needDynamicFetch.length)}/${needDynamicFetch.length} (recovered=${recoveredCount}, unresolved=${failedCount})`);
    }
  }

  console.log('\nImage recovery breakdown:', Object.fromEntries(recoveredBySource.entries()));

  // 5. Sync cleaned & image-enriched furniture products back to legacy `public.brands` JSONB rows
  console.log('\nSyncing cleaned catalogs back to legacy `brands` table...');
  const { data: legacyBrands, error: legErr } = await supabaseAdmin
    .from('brands')
    .select('id, name, products');
  if (legErr) throw legErr;

  const groupedByBrandName = new Map();
  for (const { row, brandName } of realRows) {
    const key = brandName.toLowerCase().trim();
    if (!groupedByBrandName.has(key)) groupedByBrandName.set(key, []);
    groupedByBrandName.get(key).push({
      model: row.model,
      brand: brandName,
      family: row.family || '',
      mainCategory: row.main_category || 'Furniture',
      subCategory: row.sub_category || '',
      description: row.description || '',
      price: Number(row.price) || 0,
      currency: row.currency || 'USD',
      imageUrl: row.image_url || '',
      officialProductUrl: row.official_url || '',
      productUrl: row.official_url || '',
      websiteUrl: row.official_url || '',
      verified: Boolean(row.verified),
      source: row.source || 'Catalog-Audited',
    });
  }

  let legacySynced = 0;
  for (const lb of legacyBrands || []) {
    if (!lb.name || /fitout/i.test(lb.name)) continue;
    const key = lb.name.toLowerCase().trim();
    const cleanedList = groupedByBrandName.get(key);
    if (cleanedList !== undefined) {
      await supabaseAdmin.from('brands').update({ products: cleanedList }).eq('id', lb.id);
      legacySynced++;
    }
  }

  console.log(`  Synced ${legacySynced} legacy furniture brand JSONB rows.`);
  console.log(`\n✅ Catalog Audit & Enrichment Complete! Kept=${realRows.length}, Deleted=${junkRows.length}, RecoveredImages=${recoveredCount}, Unresolved=${failedCount}.\n`);
}

main().catch((err) => {
  console.error('❌ Audit/cleanup failed:', err);
  process.exit(1);
});
