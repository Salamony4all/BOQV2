// migrate_gateway_db.js — Phase 1 gateway-DB migration (additive-only, readers ignore new keys)
// Usage: node server/scripts/migrate_gateway_db.js [--apply]
// Default = dry-run report. --apply writes (backup first).
// Steps: backup → merge dupes by normalized name → unify keys → stamp thin stubs.
import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const DIR = path.join(process.cwd(), 'server', 'data', 'brands');
const BACKUP = path.join(process.cwd(), 'server', 'data', 'brands.backup-phase1');
const NOW = new Date().toISOString();

const normName = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const report = { merged: [], unified: [], stamped: [], skipped: [], errors: [] };

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));
const brands = [];
for (const fn of files) {
  try {
    brands.push({ fn, data: JSON.parse(fs.readFileSync(path.join(DIR, fn), 'utf8')) });
  } catch (e) { report.errors.push(`${fn}: unreadable (${e.message})`); }
}

// 1) Group by normalized name + tier → merge dupes (tier variants must NOT merge)
const groups = new Map();
for (const b of brands) {
  const k = `${normName(b.data?.name) || b.fn}|${String(b.data?.budgetTier || b.data?.budget_tier || 'mid').toLowerCase()}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(b);
}

if (APPLY) fs.mkdirSync(BACKUP, { recursive: true });

for (const [key, group] of groups) {
  if (group.length === 1) continue;
  // Winner = most products; merge models by normalized model name
  group.sort((a, b) => ((b.data.products || []).length - (a.data.products || []).length));
  const [winner, ...losers] = group;
  const seen = new Set((winner.data.products || []).map((p) => String(p.model || '').toLowerCase().trim()));
  for (const loser of losers) {
    for (const p of (loser.data.products || [])) {
      const m = String(p.model || '').toLowerCase().trim();
      if (m && !seen.has(m)) { seen.add(m); winner.data.products.push(p); }
    }
    report.merged.push(`${loser.fn} → ${winner.fn} (+${(loser.data.products || []).length} models)`);
    if (APPLY) {
      fs.copyFileSync(path.join(DIR, loser.fn), path.join(BACKUP, loser.fn));
      fs.unlinkSync(path.join(DIR, loser.fn));
    }
  }
}

// 2) Unify keys + stamp thin stubs (additive only)
for (const b of brands) {
  const fp = path.join(DIR, b.fn);
  if (!fs.existsSync(fp)) continue; // merged away
  const d = b.data;
  let changed = false;

  // Unify keys NON-DESTRUCTIVELY (dual-write canonical + alias; readers vary)
  if (d.url && !d.websiteUrl) { d.websiteUrl = d.url; changed = true; }
  if (d.websiteUrl && !d.url) { d.url = d.websiteUrl; changed = true; }
  if (d.budget_tier && !d.budgetTier) { d.budgetTier = d.budget_tier; changed = true; }
  if (d.budgetTier && !d.budget_tier) { d.budget_tier = d.budgetTier; changed = true; }
  if (changed && !report.unified.includes(b.fn)) report.unified.push(b.fn);

  // Stamp thin prescan stubs with gateway metadata (additive keys only)
  const isThinStub = d.origin === 'VE-Prescan-Discovery' || (d.products || []).every((p) => !p.imageUrl && (p.source === 'VE-Prescan-Discovery' || !p.source));
  if (isThinStub && !d.gatewayVersion) {
    d.gatewayVersion = 1;
    d.registry = {
      name: d.name,
      officialDomain: (() => { try { return new URL(d.websiteUrl || '').hostname; } catch { return ''; } })(),
      budgetTier: d.budgetTier || 'mid',
      origin: d.origin || 'VE-Prescan-Discovery'
    };
    d.discovery = { discoveredAt: d.createdAt || NOW, ttlDays: 30, verified: false, quarantine: true };
    for (const p of (d.products || [])) {
      if (p.verified === undefined) p.verified = false;
      if (!p.discoveredAt) p.discoveredAt = d.createdAt || NOW;
      if (!p.ttlDays) p.ttlDays = 30;
    }
    report.stamped.push(`${b.fn} (${(d.products || []).length} stub products quarantined)`);
    changed = true;
  }

  if (changed && APPLY) {
    if (!fs.existsSync(path.join(BACKUP, b.fn))) fs.copyFileSync(fp, path.join(BACKUP, b.fn));
    fs.writeFileSync(fp, JSON.stringify(d, null, 2));
  }
}

console.log(`MODE: ${APPLY ? 'APPLY (backup: server/data/brands.backup-phase1/)' : 'DRY-RUN (no writes)'}`);
console.log(`MERGED DUPES (${report.merged.length}):`); report.merged.forEach((m) => console.log('  -', m));
console.log(`UNIFIED KEYS (${report.unified.length}):`); report.unified.forEach((m) => console.log('  -', m));
console.log(`STAMPED STUBS (${report.stamped.length}):`); report.stamped.forEach((m) => console.log('  -', m));
console.log(`ERRORS (${report.errors.length}):`); report.errors.forEach((m) => console.log('  !', m));
