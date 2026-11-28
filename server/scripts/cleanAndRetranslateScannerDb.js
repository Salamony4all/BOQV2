/**
 * Clean noise leads from public.scanner_projects, re-translate Arabic Esnaad/Oman titles
 * into complete descriptive English while preserving Arabic names, and refresh market_scanner_seed.json.
 *
 * Usage: node server/scripts/cleanAndRetranslateScannerDb.js
 */
import '../loadEnv.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { supabaseAdmin } from '../utils/supabaseStorage.js';
import {
  classifyScopesAndFitout,
  isScannerNoiseText,
  OMAN_FITOUT_CONSTRUCTION_RX,
  resolveOmanEntityDisplay,
  translateArabicTitle,
  polishShortArabicTitlesWithLLM,
  scoreLead,
  resolveOmanLocation,
} from '../utils/marketScannerEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SEED_SNAPSHOT_PATH = path.resolve(__dirname, '../data/market_scanner_seed.json');

function buildClientAndCore(row = {}) {
  const rawName = String(row.name || '').trim();
  const parts = rawName.split(' — ');
  const rawCore = parts[0].trim();
  const entityFromName = parts.slice(1).join(' — ').trim();
  const rawClient = String(row.client || entityFromName || '').trim();
  const isOman = String(row.country || '').toLowerCase() === 'oman';
  const nextClient = (isOman || /[\u0600-\u06FF]/.test(rawClient))
    ? resolveOmanEntityDisplay(rawClient)
    : rawClient;
  return { rawCore, nextClient };
}

async function main() {
  if (!supabaseAdmin) {
    throw new Error('supabaseAdmin not initialized — check SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  }

  const { data: rows, error } = await supabaseAdmin
    .from('scanner_projects')
    .select('*')
    .order('id', { ascending: true });
  if (error) throw error;

  console.log(`[CleanScannerDB] Loaded ${rows.length} existing rows from scanner_projects.`);

  const deleteRows = [];
  const keepRows = [];

  for (const row of rows) {
    const combined = `${row.name || ''} ${row.en_name || ''} ${row.summary || ''}`;
    if (isScannerNoiseText(combined)) {
      deleteRows.push({ id: row.id, reason: 'noise', label: row.en_name || row.name });
      continue;
    }
    const isOmanSource = row.source_name === 'Oman Tender Board'
      || row.source_name === 'Oman Tenders AR'
      || row.source_name === 'Oman Vision 2040 Projects AR';
    if (isOmanSource && !row.is_news) {
      const classified = classifyScopesAndFitout(row.name || '', { fallbackToFitouts: false });
      const fitsConstruction = OMAN_FITOUT_CONSTRUCTION_RX.test(row.name || '');
      if (classified.matchedCount === 0 && !fitsConstruction) {
        deleteRows.push({ id: row.id, reason: 'non-fitout-oman', label: row.en_name || row.name });
        continue;
      }
    }
    keepRows.push(row);
  }

  if (deleteRows.length > 0) {
    const delIds = deleteRows.map((d) => d.id);
    for (let i = 0; i < delIds.length; i += 40) {
      const chunk = delIds.slice(i, i + 40);
      const { error: delErr } = await supabaseAdmin.from('scanner_projects').delete().in('id', chunk);
      if (delErr) throw delErr;
    }
  }
  console.log(`[CleanScannerDB] Deleted ${deleteRows.length} noise/non-building rows. Keeping ${keepRows.length} rows.`);
  if (deleteRows.length > 0) {
    console.log('[CleanScannerDB] Sample deleted:', deleteRows.slice(0, 8).map((d) => `#${d.id} (${d.reason}): ${String(d.label).slice(0, 60)}`));
  }

  // Recompute scopes, entity, location, and bilingual English title
  let prepared = keepRows.map((row) => {
    const { rawCore, nextClient } = buildClientAndCore(row);
    const hasArabicName = /[\u0600-\u06FF]/.test(String(row.name || ''));
    if (!hasArabicName && nextClient === (row.client || '')) {
      return { row, changed: false };
    }

    const classified = hasArabicName
      ? classifyScopesAndFitout(String(row.name || ''), { fallbackToFitouts: true })
      : null;
    const nextEnName = hasArabicName
      ? translateArabicTitle(String(row.name || ''), nextClient)
      : (row.en_name || row.name);
    const nextScopes = classified ? classified.scopes : row.scopes;
    const nextTopScope = classified ? classified.top_scope : row.top_scope;

    let nextCity = row.city;
    let nextLat = row.lat;
    let nextLon = row.lon;
    let nextLocationName = row.location_name;
    if (String(row.country || '').toLowerCase() === 'oman') {
      const loc = resolveOmanLocation(`${rawCore} ${nextClient || ''}`);
      nextCity = loc.city;
      nextLat = loc.lat;
      nextLon = loc.lng;
      nextLocationName = `${loc.city}, ${loc.governorate}`;
    }

    const nextScore = row.source_name === 'Oman Tender Board'
      ? Math.max(78, scoreLead({ ...row, scopes: nextScopes, top_scope: nextTopScope }, 0))
      : row.score;

    return {
      row: {
        ...row,
        client: nextClient || row.client || null,
        en_name: nextEnName,
        scopes: nextScopes,
        top_scope: nextTopScope,
        city: nextCity,
        lat: nextLat,
        lon: nextLon,
        location_name: nextLocationName,
        score: nextScore,
      },
      changed: true,
    };
  });

  // Optional LLM pass only when explicitly requested via --llm
  const toPolish = prepared.filter((p) => p.changed).map((p) => p.row);
  const polished = process.argv.includes('--llm') ? await polishShortArabicTitlesWithLLM(toPolish) : toPolish;
  const polishedById = new Map(polished.map((r) => [r.id, r]));

  const nowIso = new Date().toISOString();
  let updatedCount = 0;
  const sampleBeforeAfter = [];

  for (const item of prepared) {
    if (!item.changed) continue;
    const finalRow = polishedById.get(item.row.id) || item.row;
    const { error: updErr } = await supabaseAdmin
      .from('scanner_projects')
      .update({
        client: finalRow.client,
        en_name: finalRow.en_name,
        scopes: finalRow.scopes,
        top_scope: finalRow.top_scope,
        city: finalRow.city,
        lat: finalRow.lat,
        lon: finalRow.lon,
        location_name: finalRow.location_name,
        score: finalRow.score,
        updated_at: nowIso,
      })
      .eq('id', finalRow.id);
    if (updErr) throw updErr;
    updatedCount++;
    if (sampleBeforeAfter.length < 10) {
      sampleBeforeAfter.push({ id: finalRow.id, en_name: finalRow.en_name, client: finalRow.client });
    }
  }

  // Refresh local seed snapshot from live Supabase tables
  const [{ data: finalProjs }, { data: finalContacts }, { data: finalUpdates }, { data: finalRuns }, { data: finalDigests }] = await Promise.all([
    supabaseAdmin.from('scanner_projects').select('*').order('score', { ascending: false }),
    supabaseAdmin.from('scanner_contacts').select('*'),
    supabaseAdmin.from('scanner_updates').select('*').order('ts', { ascending: false }).limit(500),
    supabaseAdmin.from('scanner_runs').select('*').order('id', { ascending: false }).limit(50),
    supabaseAdmin.from('scanner_digests').select('*').order('id', { ascending: false }).limit(20),
  ]);

  fs.mkdirSync(path.dirname(SEED_SNAPSHOT_PATH), { recursive: true });
  fs.writeFileSync(
    SEED_SNAPSHOT_PATH,
    JSON.stringify(
      {
        exported_at: nowIso,
        projects: finalProjs || [],
        contacts: finalContacts || [],
        updates: finalUpdates || [],
        scan_runs: finalRuns || [],
        digests: finalDigests || [],
      },
      null,
      2,
    ),
    'utf8',
  );

  console.log(`[CleanScannerDB] Re-translated & updated ${updatedCount} rows.`);
  console.log(`[CleanScannerDB] Final active non-news count: ${(finalProjs || []).filter((p) => !p.is_news).length}`);
  console.log('[CleanScannerDB] Sample updated leads:', JSON.stringify(sampleBeforeAfter, null, 2));
}

main().catch((err) => {
  console.error('[CleanScannerDB] Fatal:', err);
  process.exit(1);
});
