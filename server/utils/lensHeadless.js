// server/utils/lensHeadless.js — server-side Google Lens visual matching (no extension).
//
// Vercel-safe split: Chrome is probed, never assumed. Where no browser exists
// (Vercel serverless) every entrypoint reports supported:false and callers fall
// back to the manual uploadbyurl link. puppeteer-core is dynamically imported so
// a missing install can never crash server boot.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFile } from 'node:child_process';

const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE = 50;
const cache = new Map(); // key -> { ts, data }
const inflight = new Map(); // key -> Promise

function execWhich(cmd) {
  return new Promise((resolve) => {
    execFile(process.platform === 'win32' ? 'where' : 'which', [cmd], (err, stdout) => {
      if (err) return resolve(null);
      const first = String(stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
      resolve(first || null);
    });
  });
}

async function findChromeBinary() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const candidates = [];
  if (process.platform === 'win32') {
    const localApp = process.env.LOCALAPPDATA || '';
    const progFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
    const progFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    candidates.push(
      path.join(localApp, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(progFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(progFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(progFiles, 'Chromium', 'Application', 'chrome.exe')
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    );
  }
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) return c;
    } catch { /* next */ }
  }
  for (const cmd of ['google-chrome', 'chromium', 'chromium-browser']) {
    const found = await execWhich(cmd);
    if (found) return found;
  }
  return null;
}

let probeCache = null;
let launchChain = Promise.resolve(); // serialize launches: one profile dir, one writer
let walledUntil = 0; // Google bot-wall cooldown — no automated hits while active
const WALL_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/** True while Google is rate-limiting automation from this network. */
export function isLensWalled() {
  return Date.now() < walledUntil;
}

function markWalled(reason) {
  walledUntil = Date.now() + WALL_COOLDOWN_MS;
  console.warn(`[LensHeadless] bot wall detected (${reason}) — automated runs paused for 6h. Manual browser use is unaffected.`);
}

/** Capability probe — cheap, cached, never throws. */
export async function isLensHeadlessAvailable() {
  if (probeCache) return probeCache;
  // Explicit kill-switch / Vercel guard: set LENS_HEADLESS=0 to force-disable.
  if (process.env.LENS_HEADLESS === '0' || process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    probeCache = { supported: false, reason: 'serverless-disabled' };
    return probeCache;
  }
  try {
    await import('puppeteer-core');
  } catch {
    probeCache = { supported: false, reason: 'puppeteer-missing' };
    return probeCache;
  }
  const binary = await findChromeBinary();
  if (!binary) {
    probeCache = { supported: false, reason: 'no-chrome-binary' };
    return probeCache;
  }
  probeCache = { supported: true, binary };
  return probeCache;
}

function cacheKey(imageUrl, brand, model) {
  return `${imageUrl}||${(brand || '').toLowerCase()}||${(model || '').toLowerCase()}`;
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

function cacheSet(key, data) {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(key, { ts: Date.now(), data });
}

/**
 * Run a headed-offscreen headless Chromium against Google Lens uploadbyurl,
 * optionally type the brand + model anchor, and scrape visual-match cards.
 * Returns { visualMatches, textQuery, textAnchored, source }.
 */
export async function scrapeLensVisualMatches({ imageUrl, brand = '', model = '', timeoutMs = 60000 } = {}) {
  if (!imageUrl || typeof imageUrl !== 'string') throw new Error('imageUrl required');
  const textQuery = [brand, model].filter((s) => s && String(s).trim().length > 1).join(' ').trim();
  const key = cacheKey(imageUrl, brand, model);
  const cached = cacheGet(key);
  if (cached) return { ...cached, cached: true };
  if (inflight.has(key)) return inflight.get(key);

  const job = (async () => {
    if (isLensWalled()) {
      const err = new Error('lens-headless-walled');
      err.code = 'WALLED';
      throw err;
    }
    const caps = await isLensHeadlessAvailable();
    if (!caps.supported) {
      const err = new Error(`lens-headless-unsupported:${caps.reason}`);
      err.code = 'UNSUPPORTED';
      throw err;
    }
    const { default: puppeteer } = await import('puppeteer-core');
    const targetUrl = `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(imageUrl)}`;
    // Dedicated persistent profile: Google trust (cookies) accumulates across runs,
    // unlike incognito headless which gets bot-walled. Gitignored, local-only.
    const profileDir = path.join(process.cwd(), '.lens-chrome-profile');
    try { fs.mkdirSync(profileDir, { recursive: true }); } catch { /* noop */ }
    const baseArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1366,900'];
    const launchHeaded = () => puppeteer.launch({
      executablePath: caps.binary,
      headless: false, // headed but off-screen: passes bot checks headless fails
      userDataDir: profileDir,
      args: [...baseArgs, '--window-position=-3000,0']
    });
    const launchFallbackHeadless = () => puppeteer.launch({
      executablePath: caps.binary,
      headless: true,
      args: baseArgs
    });
    let browser = null;
    // Serialize: a single profile dir cannot be written by two Chromes at once.
    // Each job waits for the previous holder, then holds the gate until done.
    let releaseGate = null;
    const gate = new Promise((r) => { releaseGate = r; });
    const prevHolder = launchChain;
    launchChain = gate;
    await prevHolder;
    try {
      try {
        browser = await launchHeaded();
      } catch (headedErr) {
        console.warn('[LensHeadless] headed launch failed, falling back to headless:', headedErr.message);
        browser = await launchFallbackHeadless();
      }
      const page = await browser.newPage();
      // Place the window where the user can restore it from the taskbar:
      // bottom-right at a modest size, then minimized (silent but openable).
      // (Chrome rejects minimized+position at creation — so create, move, minimize.)
      try {
        const screen = await page.evaluate(() => ({ w: window.screen.availWidth || 1920, h: window.screen.availHeight || 1080 }));
        const session = await page.createCDPSession();
        const { windowId } = await session.send('Browser.getWindowForTarget');
        const ww = 900, wh = 650;
        await session.send('Browser.setWindowBounds', {
          windowId,
          bounds: { left: Math.max(0, screen.w - ww - 40), top: Math.max(0, screen.h - wh - 80), width: ww, height: wh, windowState: 'normal' }
        });
        await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
      } catch { /* stays off-screen — still functional */ }
      await page.setViewport({ width: 1366, height: 900 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
      // Prefer English pages: the Oman IP gets Arabic consent/homepage variants
      // whose controls our selectors would otherwise miss.
      try { await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' }); } catch { /* noop */ }
      // Reduce headless automation fingerprints (Google serves degraded pages to bots)
      await page.evaluateOnNewDocument(() => {
        try {
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
          window.chrome = window.chrome || { runtime: {} };
        } catch { /* noop */ }
      });
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      // Consent FIRST (before the settle wait): the interstitial consumes the
      // navigation, so waiting for results before accepting wastes the whole run.
      // Accept once per profile (choice persists).
      const acceptConsent = () => page.evaluate(() => {
        try {
          const btns = Array.from(document.querySelectorAll('button, div[role="button"], input[type="submit"]'));
          for (const b of btns) {
            const t = ((b.innerText || b.textContent || b.value || '').trim().split('\n')[0] || '').trim();
            if (/^(accept all|i agree|agree|accept|قبول الكل|قبول|موافق)$/i.test(t) && b.offsetParent !== null) {
              b.click();
              return t;
            }
          }
          return null;
        } catch { return null; }
      });
      try {
        const first = await acceptConsent();
        if (first) {
          console.log(`[LensHeadless] accepted consent ("${first}"), waiting for results...`);
          await new Promise((r) => setTimeout(r, 5000));
        }
      } catch { /* noop */ }
      // Let Lens render results: fixed settle wait (nav links exist before results do,
      // so link-count waits would fire too early), plus title/body diagnostics
      await new Promise((r) => setTimeout(r, 7000));
      try {
        const title = await page.title();
        console.log(`[LensHeadless] loaded: "${title.slice(0, 80)}" for ${imageUrl.slice(0, 70)}...`);
      } catch { /* noop */ }

      // Consent retry: a late interstitial can appear after the first pass.
      // Also take Google's own "Change to English" offer when present — the
      // choice persists in the profile and all later runs get English DOM.
      try {
        const second = await acceptConsent();
        if (second) {
          console.log(`[LensHeadless] accepted late consent ("${second}"), waiting for results...`);
          await new Promise((r) => setTimeout(r, 5000));
        } else {
          const switched = await page.evaluate(() => {
            try {
              const els = Array.from(document.querySelectorAll('a'));
              for (const el of els) {
                if (/change to english/i.test(el.textContent || '') && el.offsetParent !== null) {
                  el.click();
                  return true;
                }
              }
              return false;
            } catch { return false; }
          });
          if (switched) {
            console.log('[LensHeadless] switched results language to English, waiting...');
            // The switch navigates (detached frames); wait for the new document.
            try { await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }); } catch { /* already settled */ }
            await new Promise((r) => setTimeout(r, 5000));
          }
        }
      } catch { /* noop */ }

      // Text anchor: exact brand + model into Lens's own search box (best-effort)
      let textAnchored = false;
      if (textQuery) {
        try {
          const anchored = await page.evaluate((query) => {
            try {
              const selectors = ['textarea[name="q"]', 'input[name="q"]'];
              let box = null;
              for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el && el.offsetParent !== null) { box = el; break; }
              }
              if (!box) return false;
              box.focus();
              const proto = box.tagName === 'TEXTAREA'
                ? window.HTMLTextAreaElement.prototype
                : window.HTMLInputElement.prototype;
              const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
              if (setter) setter.call(box, query);
              else box.value = query;
              box.dispatchEvent(new Event('input', { bubbles: true }));
              return true;
            } catch { return false; }
          }, textQuery);
          if (anchored) {
            await page.keyboard.press('Enter');
            await new Promise((r) => setTimeout(r, 4000));
            textAnchored = true;
          }
        } catch { /* visual-only fallback */ }
      }

      const scrapeCards = () => page.evaluate(() => {
        try {
          const out = [];
          const seen = new Set();
          // ALL anchors: merchant tiles use relative /url?q= wrappers, which an
          // href^="http" selector misses entirely. Resolve + unwrap instead.
          const links = Array.from(document.querySelectorAll('a[href]'));
          for (const a of links) {
            let href = '';
            try { href = new URL(a.getAttribute('href'), location.origin).toString(); } catch { continue; }
            try {
              const u = new URL(href);
              if ((u.hostname.includes('google.') || u.hostname === 'google.com') && u.pathname === '/url') {
                const t = u.searchParams.get('q') || u.searchParams.get('url') || '';
                if (t && t.startsWith('http')) href = t;
              }
            } catch { /* keep resolved href */ }
            if (!href || seen.has(href)) continue;
            let host = '';
            try { host = new URL(href).hostname.replace(/^www\./i, '').toLowerCase(); } catch { continue; }
            // Skip ALL Google properties: footer/utility links (families, support,
            // accounts, policies…) exist from t=0 and would fake a "result".
            if (!host || host.includes('google') || host.includes('gstatic')) continue;
            const text = ((a.getAttribute('aria-label') || a.innerText || a.textContent || '').trim().split('\n')[0] || '').trim();
            if (text.length < 4 || /^(privacy|terms|feedback|about|sign in|google|الخصوصية|البنود|حول|تسجيل الدخول|إرسال ملاحظات|change to english)/i.test(text)) continue;
            const img = a.querySelector('img') || a.closest('div')?.querySelector('img');
            const imgSrc = img?.src || '';
            seen.add(href);
            out.push({ title: text, url: href, imageUrl: imgSrc, source: host });
            if (out.length >= 6) break;
          }
          return out;
        } catch { return []; }
      });

      // Wait for tiles: results stream in late ("Thinking" state); poll for real
      // external anchors up to ~24s instead of a fixed short retry.
      let cards = [];
      for (let waited = 0; waited <= 24000; waited += 2000) {
        try {
          cards = await scrapeCards();
        } catch {
          // Detached frame mid-navigation (e.g. language switch) — settle and retry
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        if (cards.length > 0) break;
        await new Promise((r) => setTimeout(r, 2000));
      }

      // Bot-wall check: NEVER attempt to solve challenges — stand down for 6h instead.
      // (Interactive browsers are unaffected; only automation pauses.)
      if (cards.length === 0) {
        let walled = false;
        try {
          const bodyText = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 2000) : '');
          walled = /unusual traffic|not a robot|recaptcha|captcha/i.test(bodyText || '');
        } catch { /* noop */ }
        if (!walled) {
          try {
            const frames = page.frames();
            for (const f of frames) {
              if (/recaptcha|sorry/i.test(f.url())) { walled = true; break; }
            }
          } catch { /* noop */ }
        }
        if (walled) markWalled('challenge-page');
      }

      const data = {
        visualMatches: cards,
        topMatch: cards[0] || null,
        textQuery: textQuery || null,
        textAnchored,
        source: 'Google Lens (server headless)'
      };
      // Evidence screenshot on empty (bot-wall diagnosis) — inside gitignored profile dir
      if (cards.length === 0) {
        try {
          await page.screenshot({ path: path.join(profileDir, 'last-empty.png') });
          console.log('[LensHeadless] empty result screenshot: .lens-chrome-profile/last-empty.png');
        } catch { /* noop */ }
      }
      // Only cache real results — never cache bot-wall empties (they must stay retryable)
      if (cards.length > 0) cacheSet(key, data);
      return data;
    } finally {
      if (browser) await browser.close().catch(() => {});
      inflight.delete(key);
      if (releaseGate) releaseGate();
    }
  })();

  inflight.set(key, job);
  const raced = await Promise.race([
    job,
    new Promise((_, reject) => setTimeout(() => reject(new Error('lens-headless-timeout')), timeoutMs))
  ]);
  return raced;
}
