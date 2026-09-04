// lensJar.js — Vercel-safe Google Lens hot path (port of darcodev/chrome-lens-search req backend, MIT)
// No browser: replays a browser-minted cookie jar over plain fetch.
// Mint/refresh the jar locally: `glens warmup` with GLENS_COOKIE_FILE pointed at .lens-jar/cookies.json
// (or any trusted-profile browser run that saves {user_agent, cookies, minted_at} JSON).
import fs from 'node:fs';
import path from 'node:path';
import { load as cheerioLoad } from 'cheerio';

const UPLOAD_ENDPOINT = 'https://lens.google.com/v3/upload';
const UPLOAD_PATH = '/v3/upload';
const JS_GATE_MARKER = '/httpservice/retry/enablejs';
const REQ_ATTEMPTS = 2;
const BACKOFF_MS = 1500;
const REQ_TIMEOUT_MS = 25000;
const MIN_EXTERNAL = 3;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const UA_FALLBACK = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

function jarFilePath() {
  if (process.env.LENS_JAR_PATH) return process.env.LENS_JAR_PATH;
  return path.join(process.cwd(), '.lens-jar', 'cookies.json');
}

export async function loadJar() {
  // 1) Vercel KV (production) — guarded, optional
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const { kv } = await import('@vercel/kv');
      const stored = await kv.get('lens:jar');
      if (stored && (stored.cookies?.length || stored.value?.cookies?.length)) {
        return stored.value || stored;
      }
    } catch { /* KV unavailable — fall through to file */ }
  }
  // 2) Local file (dev) — same JSON shape glens writes
  try {
    const raw = fs.readFileSync(jarFilePath(), 'utf8');
    const jar = JSON.parse(raw);
    if (jar && Array.isArray(jar.cookies) && jar.cookies.length > 0) return jar;
  } catch { /* no jar */ }
  return null;
}

export function jarStatus() {
  try {
    const raw = fs.readFileSync(jarFilePath(), 'utf8');
    const jar = JSON.parse(raw);
    if (jar?.cookies?.length) return { present: true, cookies: jar.cookies.length, minted_at: jar.minted_at || null };
  } catch { /* absent */ }
  return { present: false };
}

function uaPlatform(ua) {
  if (ua.includes('Macintosh')) return 'macOS';
  if (ua.includes('Linux')) return 'Linux';
  return 'Windows';
}

function buildHeaders(jar, lang) {
  const ua = jar.user_agent || UA_FALLBACK;
  const h = {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': lang ? `${lang},en;q=0.8` : 'en-US,en;q=0.9',
    'Referer': 'https://www.google.com/',
    'Origin': 'https://www.google.com',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Dest': 'document',
    'Upgrade-Insecure-Requests': '1'
  };
  const major = (ua.match(/Chrome\/(\d+)/) || [])[1];
  if (major) {
    h['sec-ch-ua'] = `"Google Chrome";v="${major}", "Chromium";v="${major}", "Not_A Brand";v="24"`;
    h['sec-ch-ua-mobile'] = '?0';
    h['sec-ch-ua-platform'] = `"${uaPlatform(ua)}"`;
  }
  const cookiePairs = (jar.cookies || [])
    .filter((c) => c.name && c.value != null)
    .map((c) => `${c.name}=${c.value}`);
  if (!cookiePairs.some((p) => p.startsWith('SOCS='))) cookiePairs.push('SOCS=CAI');
  h['Cookie'] = cookiePairs.join('; ');
  return h;
}

function hostOf(href) {
  try { return (new URL(href).hostname || '').toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

function isGoogleHost(host) {
  const h = (host || '').toLowerCase();
  return h === 'google.com' || h.endsWith('.google.com') || h === 'googleusercontent.com' || h.endsWith('.googleusercontent.com');
}

function looksLikeResultsUrl(u) {
  if (!u || !u.includes('://')) return false;
  let parts;
  try { parts = new URL(u); } catch { return false; }
  const host = (parts.hostname || '').toLowerCase().replace(/^www\./, '');
  if (!isGoogleHost(host) && host !== 'lens.google.com') return false;
  if (host.startsWith('consent.') || parts.pathname.startsWith('/sorry')) return false;
  if ((parts.search || '').includes('udm=26')) return true;
  return host === 'lens.google.com' && parts.pathname.replace(/\/$/, '') !== UPLOAD_PATH;
}

function unwrapRedirect(href) {
  if (!href.includes('/url?')) return href;
  try {
    const q = new URL(href).searchParams;
    const t = q.get('q') || q.get('url') || '';
    if (t.startsWith('http')) return t;
  } catch { /* keep */ }
  return href;
}

function isExternal(href) {
  const h = (href || '').toLowerCase();
  // Exclude ALL Google properties: footer/utility links exist from t=0 and fake results
  return h.includes('://') && !h.includes('google') && !h.includes('gstatic');
}

const MARKETPLACE_PREFIX = /^(Amazon\.com|www\.[^\s]+|eBay|Walmart|Target|AliExpress|Etsy|SHEIN|Google Shopping)\s+/i;
const JUNK_EXACT = new Set(['read more', 'view related links', 'opens in new tab', 'see more', 'shop now', 'related links', 'view product', 'product', '']);

function cleanTitle(text) {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  for (const sep of [' | ', ' – ', ' — ']) {
    if (t.includes(sep)) { t = t.split(sep)[0].trim(); break; }
  }
  t = t.replace(MARKETPLACE_PREFIX, '');
  t = t.replace(/\b(Opens in new tab|Out of stock|In stock|Read more|View related links)\b.*$/i, '');
  t = t.replace(/\s*\d\.\d\s*\(\d[\d,]*\).*$/, '');
  t = t.replace(/\s*[·|›»].*$/, '');
  return t.trim().replace(/^[-–—|·›». ]+|[-–—|·›». ]+$/g, '');
}

function parseAnchors(html) {
  const $ = cheerioLoad(html);
  const items = [];
  $('a').each((_, el) => {
    const rawHref = $(el).attr('href') || '';
    if (!rawHref) return;
    let href = rawHref;
    try { href = new URL(href, 'https://www.google.com/').toString(); } catch { return; }
    href = unwrapRedirect(href);
    const label = $(el).attr('aria-label') || $(el).text() || '';
    const text = label.replace(/\s+/g, ' ').trim();
    items.push({ href, text });
  });
  return items;
}

function shapeResult(items) {
  const seen = new Set();
  const matches = [];
  for (const it of items) {
    if (!isExternal(it.href)) continue;
    const title = cleanTitle(it.text);
    if (!title || JUNK_EXACT.has(title.toLowerCase())) continue;
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(title.replace(/\s/g, '')) && title.length < 30) continue; // domain-only
    const key = `${hostOf(it.href)}|${title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({ title, url: it.href, domain: hostOf(it.href) });
  }
  const freq = new Map();
  for (const m of matches) freq.set(m.title, (freq.get(m.title) || 0) + 1);
  const titles = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  return { top_title: titles[0] || null, titles: titles.slice(0, 6), matches };
}

async function fetchWithTimeout(url, opts, ms = REQ_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, redirect: 'follow' });
  } finally { clearTimeout(t); }
}

export async function fetchImageBytes(imageUrl) {
  const res = await fetchWithTimeout(imageUrl, { headers: { 'User-Agent': UA_FALLBACK } }, 20000);
  if (!res.ok) throw new Error(`image fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) throw new Error('image too large for Lens fast path');
  return buf;
}

/**
 * Plain-HTTP Lens lookup riding the browser-minted jar.
 * Returns { ok:true, result } on merchant tiles, or { ok:false, stale:true, results_url? }
 * when the caller should fall back to the browser (no jar / gate / hard status).
 */
export async function searchViaJar({ imageBytes, lang = null } = {}) {
  const jar = await loadJar();
  if (!jar) return { ok: false, stale: true, reason: 'no-jar' };
  const headers = buildHeaders(jar, lang);
  let resultsUrl = null;
  for (let attempt = 1; attempt <= REQ_ATTEMPTS; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, BACKOFF_MS));
    try {
      const fd = new FormData();
      fd.append('encoded_image', new Blob([imageBytes], { type: 'image/jpeg' }), 'frame.jpg');
      fd.append('sbisrc', 'Google Chrome');
      const up = await fetchWithTimeout(UPLOAD_ENDPOINT, {
        method: 'POST',
        headers, // NOTE: fetch sets multipart boundary automatically (no manual Content-Type)
        body: fd
      });
      if (up.status === 403 || up.status === 429) return { ok: false, stale: true, reason: `http-${up.status}` };
      if (!up.ok) continue; // transient — retry once
      resultsUrl = up.url || '';
      if (!looksLikeResultsUrl(resultsUrl)) return { ok: false, stale: true, reason: 'no-results-url' };
      let html = await up.text();
      let items = parseAnchors(html);
      let external = items.filter((i) => isExternal(i.href));
      if (external.length < MIN_EXTERNAL) {
        const g = await fetchWithTimeout(resultsUrl, { headers });
        if (!g.ok) continue;
        html = await g.text();
        items = parseAnchors(html);
        external = items.filter((i) => isExternal(i.href));
      }
      if (external.length < MIN_EXTERNAL) {
        return { ok: false, stale: true, reason: html.includes(JS_GATE_MARKER) ? 'js-gate' : `thin-${external.length}`, results_url: resultsUrl };
      }
      const shaped = shapeResult(items);
      if (shaped.matches.length === 0) return { ok: false, stale: true, reason: 'no-matches', results_url: resultsUrl };
      return { ok: true, stale: false, result: { ...shaped, results_url: resultsUrl } };
    } catch (e) {
      if (attempt === REQ_ATTEMPTS) return { ok: false, stale: true, reason: `transport:${e.message}` };
    }
  }
  return { ok: false, stale: true, reason: 'exhausted' };
}
