// verify_discovery.js — Phase 2 verification loop (dry-run default, --apply writes)
// For each gatewayVersion-1 quarantined stub:
//   1) HEAD/GET the registry officialDomain → domainVerified true/false
//   2) TTL check (discoveredAt + ttlDays) → expired flag when stale
//   3) Dead domains: discovery.expired=true (kept for audit, excluded from future matching consideration)
// Model-level Product JSON-LD verification lands in Phase 3 (needs product URLs from adapters).
import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const DIR = path.join(process.cwd(), 'server', 'data', 'brands');
const TIMEOUT = 25000;

const report = { verified: [], dead: [], expired: [], skipped: [], errors: [] };

async function checkDomain(domain) {
  if (!domain) return { alive: false, reason: 'no-domain' };
  const targets = [`https://${domain}`, `http://${domain}`];
  for (const url of targets) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT);
      let res;
      try {
        res = await fetch(url, { method: 'HEAD', signal: ctrl.signal, redirect: 'follow' });
        if (res.status === 405 || res.status === 501) {
          res = await fetch(url, { method: 'GET', signal: ctrl.signal, redirect: 'follow' });
        }
      } finally { clearTimeout(t); }
      if (res.ok) return { alive: true, status: res.status };
      if (res.status < 500) return { alive: false, reason: `http-${res.status}` };
    } catch (e) { /* try next scheme */ }
  }
  return { alive: false, reason: 'unreachable' };
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));
for (const fn of files) {
  const fp = path.join(DIR, fn);
  let d;
  try { d = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { report.errors.push(`${fn}: unreadable`); continue; }
  if (d.gatewayVersion !== 1 || !d.discovery?.quarantine) { report.skipped.push(fn); continue; }

  // TTL sweep
  const ageMs = Date.now() - new Date(d.discovery.discoveredAt || d.createdAt || Date.now()).getTime();
  const ttlMs = (d.discovery.ttlDays || 30) * 864e5;
  if (ageMs > ttlMs) {
    d.discovery.expired = true;
    report.expired.push(`${fn} (age ${Math.round(ageMs / 864e5)}d > ttl ${d.discovery.ttlDays}d)`);
    if (APPLY) fs.writeFileSync(fp, JSON.stringify(d, null, 2));
    continue;
  }

  // Domain liveness (brand-level first, else most-common product domain)
  let domain = d.registry?.officialDomain || '';
  if (!domain) {
    const ds = (d.products || []).map((p) => { try { return new URL(p.websiteUrl || p.officialProductUrl || '').hostname; } catch { return ''; } }).filter(Boolean);
    domain = ds.sort((a, b) => ds.filter((x) => x === b).length - ds.filter((x) => x === a).length)[0] || '';
  }
  const res = await checkDomain(domain);
  if (res.alive) {
    d.discovery.domainVerified = true;
    d.discovery.domainCheckedAt = new Date().toISOString();
    report.verified.push(`${fn} (${domain} → ${res.status})`);
  } else {
    d.discovery.domainVerified = false;
    d.discovery.expired = true;
    d.discovery.expireReason = `domain ${res.reason}`;
    report.dead.push(`${fn} (${domain || 'no-domain'}: ${res.reason})`);
  }
  if (APPLY) fs.writeFileSync(fp, JSON.stringify(d, null, 2));
}

console.log(`MODE: ${APPLY ? 'APPLY' : 'DRY-RUN (no writes)'}`);
console.log(`DOMAIN-VERIFIED (${report.verified.length}):`); report.verified.forEach((m) => console.log('  +', m));
console.log(`DEAD/EXPIRED (${report.dead.length}):`); report.dead.forEach((m) => console.log('  -', m));
console.log(`TTL-EXPIRED (${report.expired.length}):`); report.expired.forEach((m) => console.log('  ~', m));
console.log(`SKIPPED non-gateway (${report.skipped.length}), ERRORS (${report.errors.length})`);
report.errors.forEach((m) => console.log('  !', m));
