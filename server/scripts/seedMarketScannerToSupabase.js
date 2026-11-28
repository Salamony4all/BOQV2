/**
 * Seed Market Scanner SQLite DB (`c:\Users\Salam\market-scanner\data\market_scanner.db`)
 * into Supabase PostgreSQL (`scanner_projects`, `scanner_contacts`, `scanner_updates`,
 * `scanner_runs`, `scanner_digests`, `scanner_config`) and refresh local JSON fallback snapshot.
 *
 * Usage: node server/scripts/seedMarketScannerToSupabase.js [--sqlite path]
 */
import '../loadEnv.js';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { supabaseAdmin } from '../utils/supabaseStorage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_SQLITE_PATH = process.env.MARKET_SCANNER_DB_PATH
  || 'c:\\Users\\Salam\\market-scanner\\data\\market_scanner.db';
const SEED_SNAPSHOT_PATH = path.resolve(__dirname, '../data/market_scanner_seed.json');

function getSqlitePath() {
  const idx = process.argv.indexOf('--sqlite');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return DEFAULT_SQLITE_PATH;
}

function parseJsonSafe(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function parseIsoOrNull(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = trimmed.includes(' ') && !trimmed.includes('T')
    ? `${trimmed.replace(' ', 'T')}Z`
    : trimmed;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function buildContactKey(c = {}) {
  const email = String(c.email || '').trim().toLowerCase();
  if (email) return `em:${email}`;
  const phoneDigits = String(c.phone || '').replace(/\D/g, '');
  if (phoneDigits.length >= 6) return `ph:${phoneDigits}`;
  const website = String(c.website || '').trim().toLowerCase().replace(/\/+$/, '');
  if (website) return `ws:${website}`;
  const name = String(c.name || '').trim().toLowerCase();
  const role = String(c.role || '').trim().toLowerCase();
  return `nm:${name}|${role}`.slice(0, 180) || `anon:${Date.now()}`;
}

function extractSqliteDump(sqlitePath) {
  const pyScript = `
import json, sqlite3, sys
db_path = sys.argv[1]
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
out = {}
for tbl in ("projects", "contacts", "updates", "scan_runs", "digests", "digest_config"):
    try:
        out[tbl] = [dict(r) for r in conn.execute(f"SELECT * FROM {tbl}").fetchall()]
    except Exception:
        out[tbl] = []
print(json.dumps(out, ensure_ascii=False))
`;
  const stdout = execFileSync('python', ['-c', pyScript, sqlitePath], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function seed() {
  const sqlitePath = getSqlitePath();
  let dump;

  if (fs.existsSync(sqlitePath)) {
    console.log(`[MarketScanner Seed] Reading SQLite DB: ${sqlitePath}`);
    dump = extractSqliteDump(sqlitePath);
  } else if (fs.existsSync(SEED_SNAPSHOT_PATH)) {
    console.log(`[MarketScanner Seed] SQLite not found; reading snapshot: ${SEED_SNAPSHOT_PATH}`);
    const snap = JSON.parse(fs.readFileSync(SEED_SNAPSHOT_PATH, 'utf8'));
    dump = {
      projects: snap.projects || [],
      contacts: snap.contacts || [],
      updates: snap.updates || [],
      scan_runs: snap.scan_runs || [],
      digests: snap.digests || [],
      digest_config: snap.digest_config_rows || [],
    };
  } else {
    throw new Error(`Neither SQLite DB (${sqlitePath}) nor snapshot (${SEED_SNAPSHOT_PATH}) exists.`);
  }

  // Build normalized rows
  const normProjects = (dump.projects || []).map((p) => ({
    _oldId: p.id,
    ext_id: String(p.ext_id || `legacy:${p.id}`),
    name: String(p.name || p.en_name || 'Untitled Project'),
    en_name: p.en_name || null,
    city: p.city || null,
    country: p.country || 'Oman',
    lat: p.lat != null && Number.isFinite(Number(p.lat)) ? Number(p.lat) : null,
    lon: p.lon != null && Number.isFinite(Number(p.lon)) ? Number(p.lon) : null,
    location_name: p.location_name || null,
    scopes: Array.isArray(p.scopes) ? p.scopes : parseJsonSafe(p.scopes, []),
    top_scope: p.top_scope || null,
    stage: p.stage || 'unknown',
    completion_pct: p.completion_pct != null && Number.isFinite(Number(p.completion_pct)) ? Number(p.completion_pct) : null,
    est_value_omr: p.est_value_omr != null && Number.isFinite(Number(p.est_value_omr)) ? Number(p.est_value_omr) : null,
    value_note: p.value_note || null,
    client: p.client || null,
    consultant: p.consultant || null,
    contractor: p.contractor || null,
    operator: p.operator || null,
    summary: p.summary || null,
    source_name: p.source_name || null,
    source_url: p.source_url || null,
    score: Number.isFinite(Number(p.score)) ? Number(p.score) : 0,
    status: p.status || 'active',
    boq_status: p.boq_status || 'new',
    is_demo: Boolean(p.is_demo),
    is_news: Boolean(p.is_news),
    geo_unlocated: Boolean(p.geo_unlocated),
    enrichment: typeof p.enrichment === 'object' && p.enrichment !== null ? p.enrichment : parseJsonSafe(p.enrichment, {}),
    enriched_at: parseIsoOrNull(p.enriched_at),
    first_seen: parseIsoOrNull(p.first_seen) || new Date().toISOString(),
    last_seen: parseIsoOrNull(p.last_seen) || new Date().toISOString(),
    last_checked: parseIsoOrNull(p.last_checked),
    check_count: Number(p.check_count || 0),
    updated_at: new Date().toISOString(),
  }));

  // Deduplicate projects by ext_id
  const projByExtId = new Map();
  for (const p of normProjects) {
    projByExtId.set(p.ext_id, p);
  }
  const uniqueProjects = Array.from(projByExtId.values());

  // Save clean offline snapshot alongside server/data/
  const snapshotPayload = {
    generated_at: new Date().toISOString(),
    projects: uniqueProjects.map(({ _oldId, ...rest }) => ({ id: _oldId, ...rest })),
    contacts: dump.contacts || [],
    updates: dump.updates || [],
    scan_runs: dump.scan_runs || [],
    digests: (dump.digests || []).map((d) => ({
      ...d,
      leads_json: Array.isArray(d.leads_json) ? d.leads_json : parseJsonSafe(d.leads_json, []),
      dispatched: Boolean(d.dispatched),
    })),
    digest_config_rows: dump.digest_config || [],
  };
  fs.mkdirSync(path.dirname(SEED_SNAPSHOT_PATH), { recursive: true });
  fs.writeFileSync(SEED_SNAPSHOT_PATH, JSON.stringify(snapshotPayload, null, 2));
  console.log(`[MarketScanner Seed] Saved local fallback snapshot (${uniqueProjects.length} projects) -> ${SEED_SNAPSHOT_PATH}`);

  if (!supabaseAdmin) {
    console.warn('[MarketScanner Seed] supabaseAdmin not configured; skipped remote Postgres seed.');
    return;
  }

  // 1. Upsert projects in batches of 50
  const oldIdToExtId = new Map(uniqueProjects.map((p) => [p._oldId, p.ext_id]));
  for (let i = 0; i < uniqueProjects.length; i += 50) {
    const batch = uniqueProjects.slice(i, i + 50).map(({ _oldId, ...row }) => row);
    const { error } = await supabaseAdmin
      .from('scanner_projects')
      .upsert(batch, { onConflict: 'ext_id' });
    if (error) throw new Error(`scanner_projects upsert failed: ${error.message}`);
  }
  console.log(`[MarketScanner Seed] Upserted ${uniqueProjects.length} scanner_projects.`);

  // 2. Fetch back ext_id -> new Supabase ID mapping
  const { data: sbProjects, error: fetchErr } = await supabaseAdmin
    .from('scanner_projects')
    .select('id, ext_id');
  if (fetchErr) throw new Error(`Failed reading scanner_projects IDs: ${fetchErr.message}`);

  const extIdToNewId = new Map((sbProjects || []).map((r) => [r.ext_id, r.id]));
  const oldIdToNewId = new Map();
  for (const [oldId, extId] of oldIdToExtId.entries()) {
    const newId = extIdToNewId.get(extId);
    if (newId != null) oldIdToNewId.set(oldId, newId);
  }

  // 3. Deduplicate & upsert contacts
  const contactMap = new Map();
  for (const c of (dump.contacts || [])) {
    const newPid = oldIdToNewId.get(c.project_id);
    if (!newPid) continue;
    const contactKey = buildContactKey(c);
    const dedupeKey = `${newPid}::${contactKey}`;
    const existing = contactMap.get(dedupeKey);
    const row = {
      project_id: newPid,
      contact_key: contactKey,
      name: c.name || null,
      role: c.role || null,
      org: c.org || null,
      email: c.email || null,
      phone: c.phone || null,
      website: c.website || null,
      source: c.source || 'seed',
      confidence: Number.isFinite(Number(c.confidence)) ? Number(c.confidence) : 0.5,
      created_at: parseIsoOrNull(c.created_at) || new Date().toISOString(),
    };
    if (!existing || row.confidence >= existing.confidence) {
      contactMap.set(dedupeKey, row);
    }
  }
  const uniqueContacts = Array.from(contactMap.values());
  for (let i = 0; i < uniqueContacts.length; i += 100) {
    const batch = uniqueContacts.slice(i, i + 100);
    const { error } = await supabaseAdmin
      .from('scanner_contacts')
      .upsert(batch, { onConflict: 'project_id,contact_key' });
    if (error) throw new Error(`scanner_contacts upsert failed: ${error.message}`);
  }
  console.log(`[MarketScanner Seed] Upserted ${uniqueContacts.length} scanner_contacts.`);

  // 4. Seed updates only if table is empty (idempotent)
  const { count: updCount } = await supabaseAdmin
    .from('scanner_updates')
    .select('*', { count: 'exact', head: true });
  if ((updCount || 0) === 0) {
    const updateRows = [];
    for (const u of (dump.updates || [])) {
      const newPid = oldIdToNewId.get(u.project_id);
      if (!newPid) continue;
      updateRows.push({
        project_id: newPid,
        ts: parseIsoOrNull(u.ts) || new Date().toISOString(),
        kind: u.kind || null,
        field: u.field || null,
        old_value: u.old_value != null ? String(u.old_value) : null,
        new_value: u.new_value != null ? String(u.new_value) : null,
        note: u.note || null,
      });
    }
    for (let i = 0; i < updateRows.length; i += 200) {
      const { error } = await supabaseAdmin.from('scanner_updates').insert(updateRows.slice(i, i + 200));
      if (error) throw new Error(`scanner_updates insert failed: ${error.message}`);
    }
    console.log(`[MarketScanner Seed] Inserted ${updateRows.length} scanner_updates.`);
  } else {
    console.log(`[MarketScanner Seed] scanner_updates already has ${updCount} rows; skipping.`);
  }

  // 5. Seed scan_runs if empty
  const { count: runsCount } = await supabaseAdmin
    .from('scanner_runs')
    .select('*', { count: 'exact', head: true });
  if ((runsCount || 0) === 0 && (dump.scan_runs || []).length > 0) {
    const runRows = (dump.scan_runs || []).map((r) => ({
      started_at: parseIsoOrNull(r.started_at) || new Date().toISOString(),
      finished_at: parseIsoOrNull(r.finished_at),
      mode: r.mode || 'manual',
      sources_ok: Number(r.sources_ok || 0),
      sources_failed: Number(r.sources_failed || 0),
      findings: Number(r.findings || 0),
      new_projects: Number(r.new_projects || 0),
      updated: Number(r.updated || 0),
      log: r.log || null,
    }));
    const { error } = await supabaseAdmin.from('scanner_runs').insert(runRows);
    if (error) throw new Error(`scanner_runs insert failed: ${error.message}`);
    console.log(`[MarketScanner Seed] Inserted ${runRows.length} scanner_runs.`);
  }

  // 6. Seed digests if empty
  const { count: digestCount } = await supabaseAdmin
    .from('scanner_digests')
    .select('*', { count: 'exact', head: true });
  if ((digestCount || 0) === 0 && (dump.digests || []).length > 0) {
    const digRows = (dump.digests || []).map((d) => ({
      created_at: parseIsoOrNull(d.created_at) || new Date().toISOString(),
      title: d.title || 'Daily Construction Leads Radar',
      leads_count: Number(d.leads_count || 10),
      leads_json: Array.isArray(d.leads_json) ? d.leads_json : parseJsonSafe(d.leads_json, []),
      summary_text: d.summary_text || null,
      recipient: d.recipient || null,
      dispatched: Boolean(d.dispatched),
    }));
    const { error } = await supabaseAdmin.from('scanner_digests').insert(digRows);
    if (error) throw new Error(`scanner_digests insert failed: ${error.message}`);
    console.log(`[MarketScanner Seed] Inserted ${digRows.length} scanner_digests.`);
  }

  // 7. Upsert digest config
  const cfgMap = {
    enabled: true,
    schedule_time: '08:00',
    timezone: 'Asia/Muscat',
    email: '',
    webhook_url: '',
    min_score: 60,
    auto_enrich: true,
    last_run_date: '',
  };
  for (const r of (dump.digest_config || [])) {
    if (r.key === 'enabled' || r.key === 'auto_enrich') {
      cfgMap[r.key] = r.value === '1' || r.value === 'true' || r.value === true;
    } else if (r.key === 'min_score') {
      cfgMap[r.key] = Number(r.value || 60);
    } else if (r.key) {
      cfgMap[r.key] = r.value ?? '';
    }
  }
  const { error: cfgErr } = await supabaseAdmin
    .from('scanner_config')
    .upsert({ key: 'digest', value: cfgMap, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (cfgErr) throw new Error(`scanner_config upsert failed: ${cfgErr.message}`);
  console.log('[MarketScanner Seed] Seed completed successfully!');
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  seed().catch((err) => {
    console.error('❌ [MarketScanner Seed] Error:', err);
    process.exit(1);
  });
}
