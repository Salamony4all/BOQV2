import React, { useState, useEffect } from 'react';
import styles from '../styles/AISemanticMatchModal.module.css';
import { getApiBase } from '../utils/apiBase';
import { useCompanyProfile } from '../context/CompanyContext';
import { useTheme } from '../context/ThemeContext';
import { getFullUrl } from '../utils/urlUtils';

/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  AISemanticMatchModal — Interactive Single-Item Auto-Match Inspector    │
 * └─────────────────────────────────────────────────────────────────────────┘
 * Runs the fast, multi-stage AI auto-matching pipeline with progressive loading,
 * instant sub-second primary resolution, and background partner discovery.
 */
export default function AISemanticMatchModal({
  isOpen,
  onClose,
  item = null,
  allBrands = [],
  onSelectProduct = () => {}
}) {
  const { aiSettings } = useCompanyProfile();
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState('auto_detect');
  const [selectedBrand, setSelectedBrand] = useState('All');
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState(0);

  // Auto-Detect Result State
  const [autoDetectResult, setAutoDetectResult] = useState(null);
  const [specBreakdown, setSpecBreakdown] = useState(null);

  // Catalog Semantic Matches State
  const [matches, setMatches] = useState([]);
  const [error, setError] = useState(null);

  // Google Lens visual match state (via Chrome extension)
  const [lensResults, setLensResults] = useState(null);
  const [lensLoading, setLensLoading] = useState(false);
  const [lensError, setLensError] = useState(null);
  const [lensRunMode, setLensRunMode] = useState(null); // 'extension' | 'server' | null
  // Best picked image (raw) + resolved public URL + pick explanation
  const [lensBestRaw, setLensBestRaw] = useState(null);
  const [lensImageUrl, setLensImageUrl] = useState(null);
  const [lensPickNote, setLensPickNote] = useState('');
  const [lensCandidates, setLensCandidates] = useState([]);
  const [extensionInstalled, setExtensionInstalled] = useState(
    () => typeof document !== 'undefined' && document.documentElement.getAttribute('data-auto-browser-extension-installed') === 'true'
  );
  // The content script sets the flag + fires this event when it loads, which
  // can be after this modal mounted — listen so the Lens tab lights up live.
  useEffect(() => {
    const check = () => {
      if (document.documentElement.getAttribute('data-auto-browser-extension-installed') === 'true') setExtensionInstalled(true);
    };
    check();
    window.addEventListener('AutoBrowserExtensionReady', check);
    return () => window.removeEventListener('AutoBrowserExtensionReady', check);
  }, []);
  // Extension bridge live: Lens runs in your own trusted tab (your IP trust
  // passes captcha), results return over the page message bridge.
  const LENS_EXTENSION_ENABLED = true;
  const lensSilentAvailable = LENS_EXTENSION_ENABLED && extensionInstalled;

  // ── Image URL helpers ──────────────────────────────────────────────────────
  /** True when the URL is a local server path that Google Lens cannot reach */
  const isLocalImage = (url) => {
    if (!url) return false;
    return (
      url.startsWith('/temp/') ||
      url.startsWith('/api/') ||
      url.startsWith('/home/') ||
      url.includes('localhost') ||
      url.includes('127.0.0.1')
    );
  };

  /** Resolve a potentially-relative image path to its full local server URL */
  const resolveLocalUrl = (url) => {
    if (!url) return null;
    if (url.startsWith('http')) return url;
    const apiBase = getApiBase(); // e.g. http://localhost:3001
    return `${apiBase}${url.startsWith('/') ? '' : '/'}${url}`;
  };

  /** Build the best available image URL for passing to Google Lens */
  const resolveLensImageUrl = (rawUrl) => {
    if (!rawUrl) return null;
    if (rawUrl.startsWith('http') && !rawUrl.includes('localhost') && !rawUrl.includes('127.0.0.1')) {
      return rawUrl; // Already a public URL
    }
    // Local path — resolve to full localhost URL
    // Note: Lens won't reach localhost, but the extension runs inside Chrome
    // which CAN access localhost. So the minimized-window approach works.
    return resolveLocalUrl(rawUrl);
  };

  /**
   * Resolve any item image to a Lens-usable URL without duplicating Supabase objects.
   * - Already-public http(s) (non-localhost, non-proxy) → returned as-is, no upload.
   * - /api/image-proxy?url=<inner> → unwrapped first, then re-checked.
   * - Local /temp/ /api/ /localhost paths → POST /api/image/lens-share (single upload),
   *   fallback to localhost URL for the minimized-window extension path.
   */
  const resolveLensPublicUrl = async (rawUrl) => {
    if (!rawUrl) return null;
    let candidate = typeof rawUrl === 'string' ? rawUrl : rawUrl?.url;
    if (!candidate) return null;
    // Unwrap our own image-proxy so Lens gets the real public URL, not localhost
    try {
      if (candidate.includes('/api/image-proxy')) {
        const u = new URL(candidate, window.location.origin);
        const inner = u.searchParams.get('url');
        if (inner) candidate = decodeURIComponent(inner);
      }
    } catch { /* keep candidate as-is */ }
    const isPublicHttp =
      candidate.startsWith('http') &&
      !candidate.includes('localhost') &&
      !candidate.includes('127.0.0.1');
    if (isPublicHttp) return candidate; // Already on Supabase/CDN — do NOT re-upload
    // Local path — needs one Supabase share upload for uploadbyurl consumers
    try {
      const apiBase = getApiBase();
      const res = await fetch(`${apiBase}/api/image/lens-share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagePath: candidate })
      });
      const data = await res.json().catch(() => null);
      if (data?.success && data?.publicUrl) return data.publicUrl;
    } catch (e) {
      console.warn('[Lens] lens-share upload failed, falling back to local URL:', e.message);
    }
    return resolveLocalUrl(candidate);
  };

  /** All candidate image URLs for this item (primary + every cell image), deduped */
  const collectLensCandidates = () => {
    const out = [];
    const push = (v) => {
      const u = typeof v === 'string' ? v : v?.url || v?.src || v?.data;
      if (u && typeof u === 'string' && !out.includes(u)) out.push(u);
    };
    push(item?.imageUrl);
    if (Array.isArray(item?.images)) item.images.forEach(push);
    return out;
  };

  /** Hasler–Süsstrunk colorfulness + size score via a downscaled canvas. Null when unreadable. */
  const scoreImageColor = (url, timeoutMs = 25000) => new Promise((resolve) => {
    try {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const w = img.naturalWidth || 0, h = img.naturalHeight || 0;
          if (!w || !h) { clearTimeout(timer); resolve(null); return; }
          // Score the CENTER region only: color strips, watermarks and borders live
          // at the edges and would otherwise pass a B&W drawing off as colorful.
          const sx = Math.round(w * 0.15), sy = Math.round(h * 0.15);
          const sw = Math.round(w * 0.7), sh = Math.round(h * 0.7);
          const scale = Math.min(1, 64 / Math.max(sw, sh));
          const cw = Math.max(1, Math.round(sw * scale)), ch = Math.max(1, Math.round(sh * scale));
          const canvas = document.createElement('canvas');
          canvas.width = cw; canvas.height = ch;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
          const px = ctx.getImageData(0, 0, cw, ch).data; // throws if CORS-tainted
          let sumRg = 0, sumYb = 0, n = 0;
          const rgs = [], ybs = [];
          const uniq = new Set();
          for (let i = 0; i < px.length; i += 16) { // sample every 4th pixel
            const r = px[i], g = px[i + 1], b = px[i + 2];
            const rg = r - g, yb = 0.5 * (r + g) - b;
            sumRg += rg; sumYb += yb; rgs.push(rg); ybs.push(yb); n++;
            uniq.add((r >> 3) * 1024 + (g >> 3) * 32 + (b >> 3)); // 5-bit quantized color
          }
          const meanRg = sumRg / n, meanYb = sumYb / n;
          let vRg = 0, vYb = 0;
          for (let k = 0; k < n; k++) { vRg += (rgs[k] - meanRg) ** 2; vYb += (ybs[k] - meanYb) ** 2; }
          const colorfulness = Math.sqrt(vRg / n + vYb / n) + 0.3 * Math.sqrt(meanRg ** 2 + meanYb ** 2);
          const uniqueColors = uniq.size;
          clearTimeout(timer);
          resolve({ score: colorfulness * Math.log10(w * h + 10), colorfulness, uniqueColors, w, h });
        } catch { clearTimeout(timer); resolve(null); }
      };
      img.onerror = () => { clearTimeout(timer); resolve(null); };
      // Score through our own same-origin proxy for public URLs: a direct
      // cross-origin load taints the canvas (getImageData throws → unscored),
      // so the colorful photo could never win. Local paths resolve as before.
      try {
        const apiBase = getApiBase();
        img.src = (typeof url === 'string' && url.startsWith('http') && !url.includes('localhost') && !url.includes('127.0.0.1'))
          ? `${apiBase}/api/image-proxy?url=${encodeURIComponent(url)}`
          : resolveLocalUrl(url);
      } catch { img.src = resolveLocalUrl(url); }
    } catch { resolve(null); }
  });

  const isLogoLike = (url) => /logo|clearbit|\.svg($|\?)/i.test(url || '');

  /**
   * Pick the best colored photo for Lens: skip logos, score the rest by
   * colorfulness × size, fall back to the first candidate when scoring fails.
   */
  const pickBestLensImage = async (candidates) => {
    if (!candidates || candidates.length === 0) return { url: null, note: '', ranked: [] };
    if (candidates.length === 1) return { url: candidates[0], note: '', ranked: [{ url: candidates[0], color: null, size: '', final: null, gray: false }] };
    const photos = candidates.filter((u) => !isLogoLike(u));
    const pool = photos.length > 0 ? photos : candidates;
    try {
      let scored = await Promise.all(pool.map(async (u) => ({ u, s: await scoreImageColor(u) })));
      // One retry for the unreadable: proxy hiccups are transient, and a missed
      // photo defaults the whole run to a drawing.
      if (scored.some((r) => !r.s)) {
        await new Promise((r) => setTimeout(r, 1500));
        scored = await Promise.all(scored.map(async (r) => (r.s ? r : { u: r.u, s: await scoreImageColor(r.u) })));
      }
      if (typeof console !== 'undefined' && console.table) {
        try {
          console.table(scored.map((r) => ({
            url: String(r.u).slice(-48),
            color: r.s ? r.s.colorfulness.toFixed(0) : 'UNREADABLE',
            uniq: r.s ? r.s.uniqueColors : '-',
            size: r.s ? `${r.s.w}x${r.s.h}` : '-',
            score: r.s ? r.s.score.toFixed(0) : '-'
          })));
        } catch { /* console unavailable — skip pick diagnostics */ }
      }
      const unscored = scored.filter((r) => !r.s).length;
      const ok = scored.filter((r) => r.s && r.s.w >= 40 && r.s.h >= 40).map((r) => {
        // Drawings/graphics lose twice: near-zero colorfulness (grayscale) and few
        // flat quantized colors (graphic) — photos carry gradient shades by the hundreds.
        // Either flag costs 80%; a flat grayscale drawing keeps 4% and only wins solo.
        const grayPenalty = r.s.colorfulness < 15 ? 0.2 : 1;
        const graphicPenalty = (r.s.uniqueColors || 0) < 60 ? 0.2 : 1;
        return { ...r, final: r.s.score * grayPenalty * graphicPenalty, gray: r.s.colorfulness < 15, graphic: (r.s.uniqueColors || 0) < 60 };
      });
      // Fully-colored photographic automation: colorful non-graphic finalists always win.
      // Flat or grayscale graphics are only eligible when NO photo-like candidate scored.
      const colorful = ok.filter((r) => !r.gray && !r.graphic);
      const finalists = colorful.length > 0 ? colorful : ok;
      const grayFallback = colorful.length === 0 && ok.length > 0;
      if (finalists.length > 0) {
        finalists.sort((a, b) => b.final - a.final);
        const best = finalists[0];
        return {
          url: best.u,
          note: `best of ${candidates.length} · color ${best.s.colorfulness.toFixed(0)} · ${best.s.w}×${best.s.h}${grayFallback ? ' · graphic-only (no photo)' : ''}${unscored > 0 ? ` · ${unscored} unscored` : ''}`,
          ranked: [...finalists, ...ok.filter((r) => (r.gray || r.graphic) && !finalists.includes(r))].map((r) => ({ url: r.u, color: Math.round(r.s.colorfulness), uniq: r.s.uniqueColors, size: `${r.s.w}×${r.s.h}`, final: Math.round(r.final), gray: r.gray, graphic: r.graphic }))
        };
      }
      if (unscored > 0) console.warn(`[Lens] ${unscored} of ${pool.length} candidates unreadable even via proxy:`, scored.filter((r) => !r.s).map((r) => String(r.u).slice(-72)));
    } catch (e) {
      console.warn('[Lens] color scoring failed, using first image:', e.message);
    }
    return { url: pool[0], note: pool.length > 1 ? `first of ${candidates.length} (unscored)` : '', ranked: [] };
  };

  // Editable test query for live simulation
  const [testDescription, setTestDescription] = useState('');

  const availableBrands = allBrands && allBrands.length > 0
    ? allBrands.filter(b => b.name && b.products && b.products.length > 0)
    : [];

  // ── Lens-aware alternatives: rank catalog matches corroborated by Lens first,
  // append pure-Lens finds the catalog missed. Specified-brand mentions boost. ──
  const lensVisuals = (lensResults?.visualMatches || []).slice(0, 6);
  const lensHostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./i, '').toLowerCase(); } catch { return ''; } };
  const lensHosts = new Set(lensVisuals.map((m) => lensHostOf(m.url)).filter(Boolean));
  const specifiedBrandTokens = ((autoDetectResult?.brand || specBreakdown?.brand || '').toLowerCase().split(/[\s&/]+/).filter((t) => t.length > 2));
  const isLensHit = (m) => {
    if (lensVisuals.length === 0) return false;
    const h = lensHostOf(m.officialProductUrl || m.websiteUrl || m.productUrl || '');
    if (h && lensHosts.has(h)) return true;
    const hay = `${m.brand || ''} ${m.model || ''}`.toLowerCase();
    if (specifiedBrandTokens.length > 0 && specifiedBrandTokens.some((t) => hay.includes(t))) return true;
    return lensVisuals.some((l) => {
      const lt = (l.title || '').toLowerCase();
      if (!lt) return false;
      const words = hay.split(/[^a-z0-9]+/).filter((w) => w.length > 3);
      return words.filter((w) => lt.includes(w)).length >= 2;
    });
  };
  const rankedMatches = [...matches].map((m) => ({ ...m, _lensHit: isLensHit(m) }))
    .sort((a, b) => ((b._lensHit ? 1 : 0) - (a._lensHit ? 1 : 0)));
  const lensOnlyMatches = lensVisuals.filter((l) => {
    const lt = (l.title || '').toLowerCase(), lh = lensHostOf(l.url);
    return !matches.some((m) => {
      const mh = lensHostOf(m.officialProductUrl || m.websiteUrl || m.productUrl || '');
      if (mh && mh === lh) return true;
      const mt = `${m.brand || ''} ${m.model || ''}`.toLowerCase();
      return mt && lt && mt.length > 5 && lt.length > 5 && (mt.includes(lt.slice(0, 18)) || lt.includes(mt.slice(0, 18)));
    });
  }).slice(0, 3).map((l) => ({
    brand: l.source || lensHostOf(l.url) || 'Lens find',
    model: l.title || 'Visual match',
    imageUrl: l.imageUrl || '',
    websiteUrl: l.url, productUrl: l.url,
    description: 'Found by Google Lens visual match — not in partner catalog.',
    source: 'Lens Visual Match', _lensOnly: true, _lensHit: true
  }));
  const displayMatches = [...rankedMatches, ...lensOnlyMatches];
  // Lens visual matches ranked by specified brand + model mention (exact anchoring)
  const specifiedModelStr = (autoDetectResult?.model || '').toLowerCase().trim();
  const lensBrandScore = (l) => {
    const t = `${l.title || ''} ${l.source || ''}`.toLowerCase();
    let s = 0;
    specifiedBrandTokens.forEach((tok) => { if (t.includes(tok)) s += 2; });
    if (specifiedModelStr.length > 3 && t.includes(specifiedModelStr)) s += 3;
    return s;
  };
  const rankedLensVisuals = [...lensVisuals].sort((a, b) => lensBrandScore(b) - lensBrandScore(a));

  // Live maker check state (declared before makerCard — its subtitle reads it).
  const [makerLive, setMakerLive] = useState(null);
  const makerVerifyRef = React.useRef('');
  // The maker, from your spec (not from Lens): when AI resolved the brand plus
  // its official page, it leads the Lens tab — Lens below only hunts lookalikes.
  // Lens has no question box, so asking it "who makes this" was never possible.
  const makerCardUrl = autoDetectResult?.websiteUrl || autoDetectResult?.productUrl || '';
  let makerCardHost = '';
  try { makerCardHost = new URL(makerCardUrl).hostname.replace(/^www\./i, ''); } catch { /* no usable URL */ }
  const makerCard = (autoDetectResult?.brand && makerCardHost && !/amazon|noon|ebay|alibaba|aliexpress/i.test(makerCardHost)) ? (
    <div style={{
      background: 'rgba(16,185,129,0.12)',
      border: '1px solid rgba(16,185,129,0.5)',
      borderRadius: '10px', padding: '12px 14px',
      display: 'flex', alignItems: 'center', gap: '12px'
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ background: 'rgba(16,185,129,0.3)', color: '#a7f3d0', borderRadius: '20px', padding: '1px 8px', fontSize: '0.67rem', fontWeight: 700, display: 'inline-block', marginBottom: '3px' }}> SPECIFIED MANUFACTURER</span>
        <div style={{ color: '#a7f3d0', fontWeight: 600, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{`${autoDetectResult.brand}${autoDetectResult.model ? ` ${autoDetectResult.model}` : ''} — official page`}</div>
        <div style={{ color: '#64748b', fontSize: '0.73rem', marginTop: '2px' }}> {makerCardHost}{makerLive === true ? ' · verified live at maker' : ' · from your spec, not a Lens guess'}</div>
      </div>
      <a
        href={makerCardUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: '#34d399', fontSize: '0.75rem', textDecoration: 'none', padding: '5px 12px', border: '1px solid rgba(52,211,153,0.4)', borderRadius: '6px', whiteSpace: 'nowrap', flexShrink: 0 }}
      >
         View →
      </a>
    </div>
  ) : null;

  // Live maker check: confirm the spec's maker URL really carries this model.
  // Runs once per item, silently — a dead link keeps the card, just unbadged.
  useEffect(() => {
    if (!makerCard || !makerCardUrl) return;
    const key = `${item?.id || item?.item_code || 'auto'}|${makerCardUrl}`;
    if (makerVerifyRef.current === key) return;
    makerVerifyRef.current = key;
    setMakerLive(null);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    fetch(`${getApiBase()}/api/maker/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({ url: makerCardUrl, brand: autoDetectResult?.brand || '', model: autoDetectResult?.model || '' })
    }).then((r) => r.json()).catch(() => null).then((d) => {
      clearTimeout(t);
      if (makerVerifyRef.current === key) setMakerLive(d?.verified === true);
    });
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [makerCardUrl, autoDetectResult?.brand, autoDetectResult?.model]);

  // Animate loading stages smoothly
  useEffect(() => {
    let timer1, timer2;
    if (loading) {
      setLoadingStage(0);
      timer1 = setTimeout(() => setLoadingStage(1), 350);
      timer2 = setTimeout(() => setLoadingStage(2), 700);
    }
    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [loading]);

  useEffect(() => {
    if (isOpen && item) {
      const initialDesc = item.description || item.specifications || item.model || '';
      setTestDescription(initialDesc);
      setSelectedBrand('All');

      // Reset lens state for new item
      setLensResults(null);
      setLensLoading(false);
      setLensRunMode(null);
      setLensBestRaw(null);
      setLensImageUrl(null);
      setLensPickNote('');
      setLensError(null);
      setLensCandidates([]);
      lensAnchoredRef.current = '';
      makerVerifyRef.current = '';
      setMakerLive(null);

      // ① AI match — starts immediately
      runFullTestSimulation(initialDesc);

      // ② Lens match — pick the best colored photo across all cell images and
      // resolve it once to a public URL. Extension silent match runs first when
      // installed; otherwise the server-headless path (capability-gated).
      const candidates = collectLensCandidates();

      if (candidates.length > 0) {
        setTimeout(async () => {
          try {
            const best = await pickBestLensImage(candidates);
            if (!best.url) return;
            setLensBestRaw(best.url);
            setLensPickNote(best.note);
            setLensCandidates(best.ranked || []);
            const lensImage = await resolveLensPublicUrl(best.url);
            if (!lensImage) return;
            setLensImageUrl(lensImage);
            // Silent background match only when the extension path is enabled;
            // otherwise try the server-headless path (capability-gated, Vercel-safe).
            if (lensSilentAvailable) {
              triggerLensMatch(lensImage, item.id || item.item_code || 'auto');
            } else {
              const capRes = await fetch(`${getApiBase()}/api/lens/capabilities`).then((r) => r.json()).catch(() => null);
              if (capRes?.supported && !capRes?.walled) {
                runServerHeadlessLens(lensImage, item?.brand || '', item?.model || '', 'auto');
              } else if (capRes?.walled) {
                setLensError('Google is limiting automated checks from this network for a few hours — open the manual link above; results stay on Google for now.');
              }
            }
          } catch (e) {
            console.warn('[Lens] Could not resolve public URL:', e.message);
          }
        }, 400);
      }
    } else {
      setAutoDetectResult(null);
      setSpecBreakdown(null);
      setMatches([]);
      setError(null);
      setLensResults(null);
      setLensLoading(false);
      setLensRunMode(null);
      setLensBestRaw(null);
      setLensImageUrl(null);
      setLensPickNote('');
      setLensError(null);
      setLensCandidates([]);
      lensAnchoredRef.current = '';
      makerVerifyRef.current = '';
      setMakerLive(null);
    }
  }, [isOpen, item]);

  // Fast Progressive Pipeline Execution
  const runFullTestSimulation = async (descToTest) => {
    if (!descToTest || !descToTest.trim()) {
      setError('Item has no specification text to test.');
      return;
    }

    setLoading(true);
    setError(null);

    const apiBase = getApiBase();
    const headers = { 'Content-Type': 'application/json' };

    if (aiSettings) {
      if (aiSettings.googleApiKey) headers['x-google-api-key'] = aiSettings.googleApiKey;
      if (aiSettings.googleFreeKey) headers['x-google-free-key'] = aiSettings.googleFreeKey;
      if (aiSettings.model) headers['x-model-name'] = aiSettings.model;
    }

    try {
      const normalizedImages = (item?.images && Array.isArray(item.images) && item.images.length > 0)
        ? item.images.map(img => typeof img === 'string' ? { url: img } : img)
        : (item?.imageUrl ? [{ url: item.imageUrl }] : []);

      // Call /api/ve-match-auto with rich multimodal context and live alternatives discovery
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 50000);

      const veRes = await fetch(`${apiBase}/api/ve-match-auto`, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          description: descToTest,
          qty: item?.quantity || 1,
          unit: item?.unit || 'pcs',
          imageUrl: item?.imageUrl || (normalizedImages[0]?.url || null),
          imageAssets: normalizedImages,
          ocrTokens: item?.ocrTokens || [],
          rowBoundingBox: item?.rowBoundingBox || null,
          category: item?.category || item?.mainCategory || null,
          providerModel: aiSettings?.model,
          tier: item?.tier || 'mid'
        })
      })
        .then(res => res.json())
        .catch(err => ({ status: 'error', message: err.message }));

      clearTimeout(timeoutId);

      // Evaluate primary result
      if (veRes.status === 'success' && veRes.product) {
        const prod = veRes.product;
        setAutoDetectResult(prod);
        setSpecBreakdown({
          identifiedModel: prod.model,
          source: veRes.source || (veRes.matchTier === 'EXACT_MATCH' ? 'Exact Manufacturer Discovery' : 'Contract Priority Catalog'),
          matchTier: veRes.matchTier || 'HIGH_CONFIDENCE',
          confidenceScore: veRes.confidenceScore || 98,
          brand: prod.brand,
          brandLogo: prod.brandLogo || '',
          family: prod.family || '',
          category: `${prod.mainCategory || 'Furniture'} → ${prod.subCategory || 'General'}`,
          price: prod.price || 0,
          currency: prod.currency || 'USD',
          websiteUrl: prod.websiteUrl || prod.productUrl || '',
          evidence: veRes.evidence || null
        });

        // ── Google Lens auto-trigger DISABLED ──────────────────────────────
        // Lens matching now runs ONLY via manual button click.
        // Re-enable this block if you want silent background Lens on every match:
        // const imgForLens = item?.imageUrl || (normalizedImages[0]?.url) || prod.imageUrl || null;
        // if (imgForLens && extensionInstalled) {
        //   triggerLensMatch(imgForLens, item?.id || item?.item_code || 'unknown');
        // }

        if (veRes.alternatives && Array.isArray(veRes.alternatives) && veRes.alternatives.length > 0) {
          setMatches(veRes.alternatives);
        }
      } else {
        // Fallback: Check local catalog directly
        const fallbackRes = await fetch(`${apiBase}/api/ai/live-alternatives`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            description: descToTest,
            category: item?.category || item?.mainCategory || null,
            topK: 4
          })
        }).then(r => r.json()).catch(() => null);

        if (fallbackRes && fallbackRes.alternatives && fallbackRes.alternatives.length > 0) {
          setMatches(fallbackRes.alternatives);
          const topMatch = fallbackRes.alternatives[0];
          setAutoDetectResult(topMatch);
          setSpecBreakdown({
            identifiedModel: topMatch.model,
            source: topMatch.source || 'Contract Alternative',
            matchTier: 'SPEC_MATCH',
            confidenceScore: topMatch.confidenceScore || 90,
            brand: topMatch.brand,
            brandLogo: topMatch.brandLogo || '',
            family: topMatch.family || '',
            category: `${topMatch.mainCategory || 'Furniture'} → ${topMatch.subCategory || 'General'}`,
            price: topMatch.price || 0,
            currency: topMatch.currency || 'USD',
            websiteUrl: topMatch.websiteUrl || topMatch.productUrl || ''
          });
        } else {
          setError(veRes.message || 'No automatic match found. You can refine the test query above.');
        }
      }

    } catch (err) {
      console.error('Test simulation error:', err);
      setError(err.message || 'Error executing match simulation.');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Server-headless Lens run (no extension): POST /api/lens/scrape with the
   * picked image + exact brand/model anchor. Manual link stays the fallback.
   */
  const runServerHeadlessLens = async (targetUrl, brand, model, idSuffix = 'server') => {
    if (!targetUrl) return;
    const seq = ++lensRunSeqRef.current; // supersede older runs, same as extension path
    setLensLoading(true);
    setLensRunMode('server');
    setLensResults(null);
    setLensError(null);
    try {
      const apiBase = getApiBase();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 90000);
      const sc = await fetch(`${apiBase}/api/lens/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({ imageUrl: targetUrl, brand: brand || '', model: model || '' })
      }).then((r) => r.json()).catch(() => null);
      clearTimeout(timer);
      setLensLoading(false);
      if (seq !== lensRunSeqRef.current) return; // superseded by a newer anchored run
      if (sc?.success && Array.isArray(sc?.visualMatches)) {
        setLensResults({
          itemId: `${item?.id || item?.item_code || 'auto'}-${idSuffix}`,
          visualMatches: sc.visualMatches,
          topMatch: sc.topMatch || sc.visualMatches[0] || null,
          textQuery: sc.textQuery || null,
          textAnchored: !!sc.textAnchored,
          source: sc.source || 'Google Lens (server headless)'
        });
      } else if (sc?.walled) {
        setLensError('Google is limiting automated checks from this network for a few hours — open the manual link above; results stay on Google for now.');
      } else if (sc && sc.supported === false) {
        console.warn('[Lens] server headless unsupported:', sc.reason);
      } else {
        setLensError(sc?.error || 'Server Lens scan returned no matches.');
      }
    } catch (e) {
      setLensLoading(false);
      const msg = e?.name === 'AbortError' ? 'Server Lens scan timed out (90s).' : (e.message || 'Server Lens scan failed.');
      setLensError(msg);
      console.warn('[Lens] server run failed:', msg);
    }
  };
  /**
   * Trigger Google Lens silent visual match via the Chrome extension.
   * Gated by LENS_EXTENSION_ENABLED. An optional {brand, model} anchor focuses
   * Lens textually as well as visually.
   */
  const triggerLensMatch = (imageUrl, itemId, anchor = null) => {
    if (!LENS_EXTENSION_ENABLED || !extensionInstalled || !imageUrl) return;
    // Liveness ping first: after an extension reload the page can hold a stale
    // flag with an orphaned content script (its chrome.runtime is dead). A ping
    // that goes unanswered means refresh — fail in ~6s with the real fix,
    // instead of burning the full 30s seven steps later.
    const pingId = `lens-ping-${Date.now()}`;
    let pingAnswered = false;
    const onPing = (event) => {
      if (event.data?.source === 'auto-browser-extension' && event.data?.requestId === pingId) {
        pingAnswered = true;
        window.removeEventListener('message', onPing);
        clearTimeout(pingTimer);
        if (event.data?.error === 'EXTENSION_RELOADED_REFRESH_PAGE' || /context invalidated|reloaded/i.test(event.data?.error || '')) {
          setLensLoading(false);
          setLensError('Extension reloaded but this tab still talks to its old copy — refresh the localhost tab once and reopen the modal.');
          return;
        }
        startLensRun();
      }
    };
    window.addEventListener('message', onPing);
    window.postMessage({ source: 'auto-browser-app', requestId: pingId, action: 'getStatus', args: {} }, '*');
    const pingTimer = setTimeout(() => {
      window.removeEventListener('message', onPing);
      if (!pingAnswered) {
        setLensLoading(false);
        setLensError('Extension reloaded but this tab still talks to its old copy — refresh the localhost tab once and reopen the modal.');
      }
    }, 6000);
    const startLensRun = () => {
    setLensLoading(true);
    // Sequence guard: the anchored re-run supersedes the first weak run. Late
    // arrivals from the older run are ignored so weak results ("LF-001")
    // can never overwrite anchored ones ("Moonako Lobby").
    const seq = ++lensRunSeqRef.current;
    setLensRunMode('extension');
    setLensResults(null);
    setLensError(null);

    const requestId = `lens-${Date.now()}`;
    const anchorBrand = anchor?.brand || autoDetectResult?.brand || specBreakdown?.brand || item?.brand || '';
    // Prefer genuine model names; never a BOQ row code ("LF-019", "A-19") —
    // codes actively confuse Lens, so they resolve to visual-only instead.
    let anchorModel = anchor?.model || autoDetectResult?.model || specBreakdown?.identifiedModel || item?.model || '';
    const rowCode = String(item?.item_code || item?.code || '').trim().toLowerCase();
    if (anchorModel && (anchorModel.toLowerCase() === rowCode || /^([A-Z]{1,3}-?\d{2,5}[A-Z]?|LF-\d+)$/i.test(anchorModel.trim()))) anchorModel = '';

    const handleResponse = (event) => {
      if (event.data?.source === 'auto-browser-extension' && event.data?.requestId === requestId) {
        window.removeEventListener('message', handleResponse);
        clearTimeout(timerId);
        setLensLoading(false);
        if (seq !== lensRunSeqRef.current) return; // superseded by a newer anchored run
        if (event.data.success && event.data.result?.visualMatches) {
          // Manufacturer-first: Google ranks lookalikes and suppliers above the
          // maker. Re-sort by detected brand/model token hits so the exact
          // manufacturer's own page leads, suppliers follow. A maker-domain
          // hit (hostname carries the brand) counts double — derived from the
          // detected brand itself, no lists.
          const toks = `${anchorBrand} ${anchorModel}`.toLowerCase().split(/[\s&/]+/).filter((t) => t.length > 2);
          const brandTok = String(anchorBrand || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2)[0] || '';
          const hits = (m) => {
            const hay = `${m?.title || ''} ${m?.url || ''} ${m?.source || ''}`.toLowerCase();
            let s = toks.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0);
            try {
              const host = new URL(m?.url || '', 'http://x').hostname.toLowerCase().replace(/^www\./, '');
              if (brandTok && host.includes(brandTok)) s += 2;
              // Marketplaces/B2B bazaars never verify a maker — sink them.
              if (/amazon|noon|ebay|alibaba|aliexpress|made-in-china/i.test(host)) s -= 2;
            } catch { /* relative URL — skip domain adjustments */ }
            return s;
          };
          const sorted = [...event.data.result.visualMatches].sort((a, b) => hits(b) - hits(a));
          setLensResults({ ...event.data.result, visualMatches: sorted, topMatch: sorted[0] || event.data.result.topMatch || null });
        } else {
          const msg = event.data?.error || event.data?.result?.error || 'Lens scan failed with no matches.';
          setLensError(msg);
          console.warn('[Lens] scan failed:', msg);
        }
      }
    };

    window.addEventListener('message', handleResponse);
    window.postMessage({
      source: 'auto-browser-app',
      requestId,
      action: 'lensVisualMatch',
      args: { imageUrl, itemId: itemId || 'modal-auto', description: item?.description || testDescription, brand: anchorBrand, model: anchorModel }
    }, '*');

    // Cleanup listener after 30s timeout — a timeout almost always means the
    // message bridge is gone (page loaded before the extension was reloaded)
    const timerId = setTimeout(() => {
      window.removeEventListener('message', handleResponse);
      setLensLoading((was) => {
        if (was) setLensError('No reply from the extension in 30s. If you just updated/reloaded it, refresh this page and reopen the modal, then wait ~20s.');
        return false;
      });
    }, 30000);
    };
  };

  // Anchored refine: the first Lens run fires before AI resolves the brand, so
  // it anchors weak ("LF-001"). Re-run per resolved brand+model — keyed, so a
  // later AI answer replaces weak results instead of being skipped. Skips while
  // a run is in flight; the effect re-fires when loading flips back to false.
  const lensAnchoredRef = React.useRef('');
  // Monotonic run id — see sequence guard in startLensRun.
  const lensRunSeqRef = React.useRef(0);
  useEffect(() => {
    const brand = autoDetectResult?.brand || '';
    const model = autoDetectResult?.model || '';
    if (!isOpen || !item || !brand || model.length < 2) return;
    const target = lensImageUrl;
    if (!target) return;
    const query = `${brand} ${model}`.toLowerCase();
    if (lensAnchoredRef.current === query || lensLoading) return;
    lensAnchoredRef.current = query;
    if (lensSilentAvailable) {
      triggerLensMatch(target, `${item.id || item.item_code || 'auto'}-anchored`, { brand, model });
    } else {
      runServerHeadlessLens(target, brand, model, 'anchored');
    }
  }, [autoDetectResult, lensImageUrl, lensLoading]);

  const handleBrandFilterChange = async (e) => {
    const newBrand = e.target.value;
    setSelectedBrand(newBrand);
    setLoading(true);

    try {
      const apiBase = getApiBase();
      const headers = { 'Content-Type': 'application/json' };
      const res = await fetch(`${apiBase}/api/ai/semantic-match`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          description: testDescription,
          brand: newBrand === 'All' ? null : newBrand,
          category: item?.category || item?.mainCategory || null,
          topK: 4
        })
      });
      const data = await res.json();
      setMatches(data.matches || []);
    } catch (err) {
      console.error('Brand filter match error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyMatch = (matchProduct) => {
    if (!matchProduct) return;
    onSelectProduct(matchProduct);
    onClose();
  };

  if (!isOpen || !item) return null;

  const itemCode = item.code || item.itemNo || item.id || '#';

  return (
    <div className={styles.overlay} data-theme={theme} onClick={onClose}>
      <div className={styles.modal} data-theme={theme} onClick={(e) => e.stopPropagation()}>
        
        {/* Modal Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.headerIcon}><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="#fff" /></svg></div>
            <div>
              <h2 className={styles.title}>AI Auto-Match Inspector</h2>
              <p className={styles.subtitle}>Single-Item Multimodal Auto-Match & Value-Engineering Sandbox</p>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} title="Close"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
        </div>

        {/* Modal Content */}
        <div className={styles.content}>
          
          {/* Target Item Context & Live Sandbox Box */}
          <div className={styles.itemContextCard}>
            <div className={styles.contextHeaderRow}>
              <span className={styles.contextLabel}>Target Specification • Item {itemCode}</span>
              <div className={styles.contextMeta}>
                {item.quantity != null && <span className={styles.metaBadge}> Qty: {item.quantity} {item.unit || 'pcs'}</span>}
                {item.brand && <span className={styles.metaBadge}> Brand: {item.brand}</span>}
                {item.model && <span className={styles.metaBadge}> Code: {item.model}</span>}
              </div>
            </div>
            
            <textarea
              className={styles.testQueryTextarea}
              value={testDescription}
              onChange={(e) => setTestDescription(e.target.value)}
              placeholder="Edit specification text here to test AI matching variations..."
              rows={2}
            />

            <div className={styles.testActionsRow}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <button 
                  className={styles.runTestBtn}
                  onClick={() => runFullTestSimulation(testDescription)}
                  disabled={loading}
                >
                  {loading ? ' Auto-Matching...' : ' Re-Run Auto-Match'}
                </button>
                <button
                  className={styles.runTestBtn}
                  onClick={() => {
                    const cleanQuery = (testDescription || '').replace(/[|#]/g, ' ').slice(0, 100).trim();
                    const rawImg = lensBestRaw || item?.imageUrl ||
                      (Array.isArray(item?.images) && item.images.length > 0
                        ? (typeof item.images[0] === 'string' ? item.images[0] : item.images[0]?.url)
                        : null);
                    const primaryImage = rawImg ? resolveLensImageUrl(rawImg) : null;
                    if (primaryImage && typeof primaryImage === 'string' && primaryImage.startsWith('http') && !isLocalImage(rawImg)) {
                      window.open(`https://lens.google.com/uploadbyurl?url=${encodeURIComponent(primaryImage)}`, '_blank');
                    } else {
                      window.open(`https://www.google.com/search?q=${encodeURIComponent(cleanQuery)}&tbm=isch`, '_blank');
                    }
                  }}
                  style={{ background: 'rgba(59, 130, 246, 0.15)', borderColor: 'rgba(59, 130, 246, 0.4)', color: '#60a5fa' }}
                  title="Zero-token reverse image search on Google Lens / Google Images for custom or unmatched items"
                >
                   Visual Lens Search
                </button>
                {autoDetectResult && !loading && (
                  <button
                    className={styles.quickApplyBtn}
                    onClick={() => handleApplyMatch(autoDetectResult)}
                    title="Quickly apply this verified match to row"
                  >
                     Quick Apply to Row
                  </button>
                )}
              </div>
              <span className={styles.tipText}>Tip: Uses full multi-brand catalog + live web discovery pipeline</span>
            </div>
          </div>

          {/* Mode Switch Tabs */}
          <div className={styles.tabsContainer}>
            <button
              className={`${styles.tabBtn} ${activeTab === 'auto_detect' ? styles.activeTab : ''}`}
              onClick={() => setActiveTab('auto_detect')}
            >
               Full Auto-Match Result {autoDetectResult && !loading && <span className={styles.tabBadge}>Verified</span>}
            </button>
            <button
              className={`${styles.tabBtn} ${activeTab === 'lens_match' ? styles.activeTab : ''}`}
              onClick={() => setActiveTab('lens_match')}
              style={{ borderColor: activeTab === 'lens_match' ? 'rgba(124,58,237,0.7)' : undefined }}
            >
               Lens Visual Match
              {lensResults && !lensLoading && (
                <span className={styles.tabBadge} style={{ background: 'rgba(124,58,237,0.3)', color: '#c4b5fd' }}>
                  {lensResults.visualMatches?.length || 0}
                </span>
              )}
              {lensLoading && <span className={styles.tabBadge} style={{ background: 'rgba(124,58,237,0.15)', color: '#a78bfa' }}></span>}
            </button>
            <button
              className={`${styles.tabBtn} ${activeTab === 'partner_catalog' ? styles.activeTab : ''}`}
              onClick={() => setActiveTab('partner_catalog')}
            >
               Partner Alternatives ({matches.length})
            </button>
          </div>

          {/* ── RICH LOADING THROBBER & STAGE PROGRESS ── */}
          {loading && (
            <div className={styles.loadingContainer}>
              <div className={styles.throbberWrapper}>
                <div className={styles.throbberOrb}>
                  <span className={styles.throbberIcon}></span>
                </div>
                <div className={styles.throbberRing} />
                <div className={styles.throbberRingOuter} />
              </div>

              <div className={styles.loadingInfo}>
                <h4 className={styles.loadingTitle}>AI Auto-Matching in Progress</h4>
                <p className={styles.loadingSubtitle}>Executing full multimodal contract catalog & live web discovery...</p>
              </div>

              <div className={styles.loadingSteps}>
                <div className={`${styles.stepItem} ${loadingStage >= 0 ? styles.stepActive : ''}`}>
                  <span className={styles.stepDot}>{loadingStage > 0 ? '' : '1'}</span>
                  <span>Decomposing item specifications & image tokens</span>
                </div>
                <div className={`${styles.stepItem} ${loadingStage >= 1 ? styles.stepActive : ''}`}>
                  <span className={styles.stepDot}>{loadingStage > 1 ? '' : '2'}</span>
                  <span>Scanning partner brand catalogs & manufacturer models</span>
                </div>
                <div className={`${styles.stepItem} ${loadingStage >= 2 ? styles.stepActive : ''}`}>
                  <span className={styles.stepDot}>3</span>
                  <span>Matching high-res photos, finishes & unit rates</span>
                </div>
              </div>

              {/* Shimmer Skeleton Card */}
              <div className={styles.skeletonCard}>
                <div className={styles.skeletonHeader}>
                  <div className={styles.skeletonLogo} />
                  <div className={styles.skeletonLines}>
                    <div className={styles.skeletonLineShort} />
                    <div className={styles.skeletonLineLong} />
                  </div>
                </div>
                <div className={styles.skeletonBody}>
                  <div className={styles.skeletonImage} />
                  <div className={styles.skeletonSpecs}>
                    <div className={styles.skeletonGridItem} />
                    <div className={styles.skeletonGridItem} />
                    <div className={styles.skeletonGridItem} />
                    <div className={styles.skeletonGridItem} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && !loading && (
            <div className={styles.errorBox}>
               {error}
            </div>
          )}

          {/* ── TAB 1: AUTO-DETECT PIPELINE RESULTS ── */}
          {activeTab === 'auto_detect' && !loading && (
            <div className={styles.autoDetectView}>
              {autoDetectResult ? (
                <div className={styles.primaryResultCard}>
                  
                  {/* Top Bar with Brand & Match Status */}
                  <div className={styles.resultHeader}>
                    <div className={styles.brandTitleWrap}>
                      {autoDetectResult.brandLogo || specBreakdown?.brandLogo ? (
                        <img 
                          src={getFullUrl(autoDetectResult.brandLogo || specBreakdown.brandLogo)} 
                          alt={autoDetectResult.brand} 
                          className={styles.cardBrandLogo}
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                      ) : null}
                      <div>
                        <div className={styles.cardBrandName}>{autoDetectResult.brand || 'Contract Manufacturer'}</div>
                        <h3 className={styles.cardModelName}>{autoDetectResult.model || 'Identified Model'}</h3>
                      </div>
                    </div>
                    <span className={styles.matchScoreBadge}>
                       {specBreakdown?.confidenceScore ? `${specBreakdown.confidenceScore}%` : '100%'} Specification Fit
                    </span>
                  </div>

                  {/* Body Content */}
                  <div className={styles.resultBody}>
                    <div className={styles.resultImageWrap}>
                      {autoDetectResult.imageUrl ? (
                        <img
                          src={getFullUrl(autoDetectResult.imageUrl)}
                          alt={autoDetectResult.model}
                          className={styles.resultImage}
                          onError={(e) => {
                            e.target.src = 'https://placehold.co/400x300?text=No+Live+Image';
                          }}
                        />
                      ) : (
                        <div className={styles.noImagePh}> No Image</div>
                      )}
                    </div>

                    <div className={styles.resultSpecsWrap}>
                      <div className={styles.specGrid}>
                        <div className={styles.specItem}>
                          <span className={styles.specKey}>Category</span>
                          <span className={styles.specVal}>{specBreakdown?.category || 'Office Furniture'}</span>
                        </div>
                        <div className={styles.specItem}>
                          <span className={styles.specKey}>Match Source</span>
                          <span className={styles.specVal}>{specBreakdown?.source || 'Contract Catalog'}</span>
                        </div>
                        {autoDetectResult.price > 0 && (
                          <div className={styles.specItem}>
                            <span className={styles.specKey}>Unit Rate</span>
                            <span className={styles.specValHighlight}>{autoDetectResult.currency || 'USD'} {Number(autoDetectResult.price).toFixed(2)}</span>
                          </div>
                        )}
                        {(autoDetectResult.websiteUrl || autoDetectResult.productUrl) && (
                          <div className={styles.specItem}>
                            <span className={styles.specKey}>Official Link</span>
                            <a href={autoDetectResult.websiteUrl || autoDetectResult.productUrl} target="_blank" rel="noreferrer" className={styles.specLink}>
                               View Product Page
                            </a>
                          </div>
                        )}
                        {(autoDetectResult.supplierReferences && autoDetectResult.supplierReferences.length > 0) && (
                          <div className={styles.specItem}>
                            <span className={styles.specKey}>Supplier Ref</span>
                            <a href={autoDetectResult.supplierReferences[0]} target="_blank" rel="noreferrer" className={styles.specLink} title={autoDetectResult.supplierReferences.join('\n')}>
                               Dealer reference{autoDetectResult.supplierReferences.length > 1 ? ` (+${autoDetectResult.supplierReferences.length - 1})` : ''}
                            </a>
                          </div>
                        )}
                      </div>

                      {autoDetectResult.description && (
                        <div className={styles.specDescBox}>
                          <span className={styles.specDescLabel}>Technical Specifications:</span>
                          <p className={styles.specDescText}>{autoDetectResult.description}</p>
                        </div>
                      )}

                      <button
                        className={styles.applyPrimaryBtn}
                        onClick={() => handleApplyMatch(autoDetectResult)}
                      >
                         Apply Matched Product to Row
                      </button>
                    </div>
                  </div>

                </div>
              ) : (
                <div className={styles.emptyState}>
                  <p>No specification match returned. Try running a test simulation or switch to Partner Alternatives.</p>
                </div>
              )}

              {/* Lens results now live in dedicated tab 3 — removed from here */}
              {false && (
                <div style={{
                  marginTop: '14px',
                  background: 'rgba(124,58,237,0.08)',
                  border: '1px solid rgba(124,58,237,0.3)',
                  borderRadius: '10px',
                  padding: '14px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                    <span style={{ fontSize: '1rem' }}></span>
                    <strong style={{ color: '#c4b5fd', fontSize: '0.88rem' }}>Google Lens 1:1 Visual Match</strong>
                    {lensLoading && (
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginLeft: '4px' }}>
                         Scanning Lens results silently...
                      </span>
                    )}
                    {lensResults && !lensLoading && (
                      <span style={{ 
                        background: 'rgba(124,58,237,0.25)', color: '#c4b5fd',
                        border: '1px solid rgba(124,58,237,0.4)',
                        borderRadius: '20px', padding: '2px 8px', fontSize: '0.72rem', fontWeight: 700
                      }}>
                         {lensResults.visualMatches?.length || 0} Visual Matches
                      </span>
                    )}
                  </div>

                  {lensResults && lensResults.visualMatches && lensResults.visualMatches.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {lensResults.visualMatches.slice(0, 5).map((m, i) => (
                        <div key={i} style={{
                          background: i === 0 ? 'rgba(124,58,237,0.15)' : 'rgba(30,41,59,0.8)',
                          border: `1px solid ${i === 0 ? 'rgba(124,58,237,0.5)' : '#334155'}`,
                          borderRadius: '8px',
                          padding: '10px 12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px'
                        }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {i === 0 && (
                              <span style={{
                                background: 'rgba(124,58,237,0.3)', color: '#e9d5ff',
                                borderRadius: '20px', padding: '1px 7px', fontSize: '0.68rem',
                                fontWeight: 700, display: 'inline-block', marginBottom: '3px'
                              }}> Top Match</span>
                            )}
                            <div style={{ color: '#c4b5fd', fontWeight: 600, fontSize: '0.83rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {m.title || 'Visual Match'}
                            </div>
                            <div style={{ color: '#94a3b8', fontSize: '0.74rem' }}> {m.source || 'Unknown source'}</div>
                          </div>
                          {m.url && (
                            <a href={m.url} target="_blank" rel="noopener noreferrer" style={{
                              color: '#38bdf8', fontSize: '0.75rem', textDecoration: 'none',
                              flexShrink: 0, padding: '4px 10px',
                              border: '1px solid rgba(56,189,248,0.3)',
                              borderRadius: '6px', whiteSpace: 'nowrap'
                            }}>
                               View →
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : lensResults && !lensLoading ? (
                    <div style={{ color: '#94a3b8', fontSize: '0.8rem', padding: '8px 0' }}>
                      No visual matches extracted. 
                      <a
                        href={`https://lens.google.com/uploadbyurl?url=${encodeURIComponent(item?.imageUrl || '')}`}
                        target="_blank" rel="noopener noreferrer"
                        style={{ color: '#38bdf8', marginLeft: '6px' }}
                      >
                         Open Lens manually →
                      </a>
                    </div>
                  ) : null}

                  {!extensionInstalled && (
                    <div style={{ color: '#94a3b8', fontSize: '0.78rem' }}>
                      Install the Auto Browser Extension to enable silent Google Lens visual matching.
                    </div>
                  )}
                </div>
              )}

              {/* Lens install nudge for items with images when extension not installed */}
              {!extensionInstalled && (item?.imageUrl || (item?.images && item.images.length > 0)) && !loading && (
                <div style={{
                  marginTop: '10px', fontSize: '0.76rem', color: '#94a3b8',
                  display: 'flex', alignItems: 'center', gap: '6px'
                }}>
                  <span></span>
                  <span>Install the <strong style={{ color: '#c4b5fd' }}>Auto Browser Extension</strong> to enable  Google Lens 1:1 visual matching for this item (zero AI tokens).</span>
                </div>
              )}
            </div>
          )}


          {/* ── TAB 2: VALUE-ENGINEERED PARTNER ALTERNATIVES ── */}
          {activeTab === 'partner_catalog' && !loading && (
            <div className={styles.partnerCatalogView}>
              <div className={styles.partnerControls}>
                <label className={styles.selectLabel}>Filter Catalog Brand:</label>
                <select
                  className={styles.brandSelect}
                  value={selectedBrand}
                  onChange={handleBrandFilterChange}
                >
                  <option value="All">All Partner Brands (Priority Matching)</option>
                  {availableBrands.map(b => (
                    <option key={b.id || b.name} value={b.name}>{b.name} ({b.products?.length || 0} items)</option>
                  ))}
                </select>
              </div>

              {displayMatches.length > 0 ? (
                <div className={styles.matchesList}>
                  {displayMatches.map((match, idx) => {
                    const isLiveWeb = match.source === 'Live Architonic & Global Web Discovery';
                    const isLensOnly = match.source === 'Lens Visual Match';
                    const fallbackSearchUrl = `https://www.architonic.com/en/search/?q=${encodeURIComponent((match.brand || '') + ' ' + (match.model || ''))}`;
                    const officialUrl = match.officialProductUrl || match.websiteUrl || match.productUrl || fallbackSearchUrl;
                    const architonicUrl = match.architonicUrl;

                    return (
                      <div
                        key={idx}
                        className={`${styles.matchCard} ${idx === 0 ? styles.topMatchCard : ''}`}
                      >
                        <div className={styles.productImageWrap}>
                          {match.imageUrl ? (
                            <img
                              src={getFullUrl(match.imageUrl)}
                              alt={match.model}
                              className={styles.productImage}
                              onError={(e) => {
                                e.target.src = 'https://placehold.co/100x100?text=No+Photo';
                              }}
                            />
                          ) : (
                            <span className={styles.imagePlaceholder}></span>
                          )}
                        </div>

                        <div className={styles.matchDetails}>
                          <div className={styles.matchHeader}>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                                <span className={styles.brandBadge}>{match.brand}</span>
                                {isLensOnly ? (
                                  <span style={{ fontSize: '0.68rem', padding: '2px 8px', borderRadius: '12px', background: 'rgba(124,58,237,0.15)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.4)', fontWeight: 600 }}>
                                     Lens Visual Find
                                  </span>
                                ) : isLiveWeb ? (
                                  <span style={{ fontSize: '0.68rem', padding: '2px 8px', borderRadius: '12px', background: 'rgba(14, 165, 233, 0.15)', color: '#38bdf8', border: '1px solid rgba(14, 165, 233, 0.3)', fontWeight: 600 }}>
                                     Architonic & Live Web Discovery
                                  </span>
                                ) : (
                                  <span style={{ fontSize: '0.68rem', padding: '2px 8px', borderRadius: '12px', background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', border: '1px solid rgba(168, 85, 247, 0.3)', fontWeight: 600 }}>
                                     Verified Contract Partner
                                  </span>
                                )}
                                {match._lensHit && !match._lensOnly && (
                                  <span style={{ fontSize: '0.68rem', padding: '2px 8px', borderRadius: '12px', background: 'rgba(124,58,237,0.15)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.4)', fontWeight: 600 }}>
                                     Lens-seen
                                  </span>
                                )}
                              </div>
                              <h4 className={styles.modelName}>{match.model}</h4>
                              {match.mainCategory && (
                                <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '2px' }}>
                                   {match.mainCategory} {match.subCategory ? `→ ${match.subCategory}` : ''}
                                </div>
                              )}
                            </div>
                            <span className={`${styles.confidenceBadge} ${idx === 0 ? styles.topScore : ''}`}>
                              {match._lensOnly ? ' Visual match' : (match.exactModelMatch ? ' 100% Exact' : ` ${match.confidenceScore || match.specificationFit || 92}% Fit`)}
                            </span>
                          </div>

                          <p className={styles.productDesc}>{match.veReason || match.description || 'Verified Commercial Specification Alternative'}</p>

                          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', margin: '6px 0', flexWrap: 'wrap' }}>
                            <a
                              href={officialUrl}
                              target="_blank"
                              rel="noreferrer"
                              style={{ fontSize: '0.74rem', color: '#60a5fa', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                              title="Open live manufacturer product portal or verified search"
                            >
                               Official Website ↗
                            </a>
                            {architonicUrl && (
                              <a
                                href={architonicUrl}
                                target="_blank"
                                rel="noreferrer"
                                style={{ fontSize: '0.74rem', color: '#38bdf8', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                              >
                                 Architonic / Platform Page ↗
                              </a>
                            )}
                          </div>

                          <div className={styles.matchFooter}>
                            <span className={styles.productPrice}>
                              {match.price > 0 ? `${match.currency || '$'} ${Number(match.price).toFixed(2)}` : 'Price on Request'}
                            </span>
                            <button
                              className={styles.selectBtn}
                              onClick={() => handleApplyMatch(match)}
                            >
                               Select Alternative
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className={styles.emptyState}>
                  <p>No partner catalog matches found for the selected brand filter.</p>
                </div>
              )}
            </div>
          )}

          {/* ── TAB 3: GOOGLE LENS VISUAL MATCH ── */}
          {activeTab === 'lens_match' && !loading && (() => {
            // Best picked image wins; fall back to first image while scoring runs
            const rawImage = lensBestRaw || item?.imageUrl ||
              (Array.isArray(item?.images) && item.images.length > 0
                ? (typeof item.images[0] === 'string' ? item.images[0] : item.images[0]?.url)
                : null);
            // Prefer the resolved Supabase public URL (set on modal open); fall back to local for display
            const displayImage = lensImageUrl || (rawImage ? resolveLocalUrl(rawImage) : null);
            const primaryImage = displayImage;
            const imageIsLocal = !lensImageUrl && isLocalImage(rawImage);

            // Manual Lens link works once we have any public URL (Supabase-resolved or direct)
            const lensUrl = (lensImageUrl || (primaryImage && !imageIsLocal))
              ? `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(lensImageUrl || primaryImage)}`
              : null;

            // Text fallback for local images
            const textSearchUrl = (() => {
              const q = (item?.description || item?.model || '').replace(/[|#]/g, ' ').slice(0, 120).trim();
              return q ? `https://www.google.com/search?q=${encodeURIComponent(q)}&tbm=isch` : null;
            })();

            return (
              <div style={{ padding: '6px 0' }}>

                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <div style={{ fontWeight: 700, color: '#c4b5fd', fontSize: '0.92rem', marginBottom: '2px' }}> Google Lens 1:1 Visual Match</div>
                    <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>Zero AI tokens · Visual accuracy · Detects unlisted / custom products</div>
                  </div>
                  {lensResults && !lensLoading && (
                    <span style={{ background: 'rgba(124,58,237,0.25)', color: '#e9d5ff', border: '1px solid rgba(124,58,237,0.5)', borderRadius: '20px', padding: '3px 10px', fontSize: '0.74rem', fontWeight: 700 }}>
                       {lensResults.visualMatches?.length || 0} Visual Matches Found{lensResults.extVersion ? ` · ext v${lensResults.extVersion}` : ''}
                    </span>
                  )}
                </div>

                {/* Image preview + trigger */}
                <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap' }}>
                  {primaryImage ? (
                    <img
                      src={primaryImage}
                      alt="Product"
                      style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: '8px', border: '1px solid rgba(124,58,237,0.4)', flexShrink: 0 }}
                      onError={e => { e.target.style.display = 'none'; }}
                    />
                  ) : (
                    <div style={{ width: 90, height: 90, borderRadius: '8px', border: '1px dashed #334155', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: '1.6rem', flexShrink: 0 }}></div>
                  )}
                  <div style={{ flex: 1 }}>
                    {primaryImage ? (
                      <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '10px', wordBreak: 'break-all' }}> {primaryImage.slice(0, 80)}{primaryImage.length > 80 ? '...' : ''}</div>
                    ) : (
                      <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '10px' }}> No image available for this item. Lens matching requires a product image URL.</div>
                    )}
                    {lensPickNote && (
                      <div style={{ fontSize: '0.72rem', color: '#a78bfa', marginBottom: '10px' }}> {lensPickNote}</div>
                    )}
                    {lensCandidates.length > 1 && (
                      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Candidates:</span>
                        {lensCandidates.map((c, ci) => {
                          const isBest = (lensBestRaw || '') === c.url;
                          return (
                            <button
                              key={ci}
                              title={`${c.url.slice(-40)} · color ${c.color ?? '?'} · shades ${c.uniq ?? '?'} · ${c.size}${c.gray ? ' · grayscale' : ''}${c.graphic ? ' · graphic' : ''} — click to use for Lens`}
                              onClick={async () => {
                                setLensBestRaw(c.url);
                                setLensPickNote(`manual pick · color ${c.color ?? '?'} · ${c.size}`);
                                setLensResults(null);
                                setLensError(null);
                                try {
                                  const target = await resolveLensPublicUrl(c.url);
                                  if (target) {
                                    setLensImageUrl(target);
                                    if (extensionInstalled) triggerLensMatch(target, `${item?.id || item?.item_code || 'unknown'}-manual`, { brand: autoDetectResult?.brand || '', model: autoDetectResult?.model || '' });
                                  }
                                } catch (e) {
                                  console.warn('[Lens] manual pick resolve failed:', e.message);
                                }
                              }}
                              style={{
                                border: isBest ? '2px solid #a855f7' : '1px solid #334155',
                                borderRadius: '6px', padding: 0, cursor: 'pointer', background: 'transparent',
                                opacity: isBest ? 1 : 0.75
                              }}
                            >
                              <img src={resolveLocalUrl(c.url)} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: '4px', display: 'block' }} onError={e => { e.target.style.display = 'none'; }} />
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {lensResults?.textAnchored && lensResults?.textQuery && (
                      <div style={{ fontSize: '0.72rem', color: '#6ee7b7', marginBottom: '10px' }}> Lens anchored to “{lensResults.textQuery}”</div>
                    )}
                    {lensResults && !lensResults.textAnchored && (
                      <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: '10px' }}>Visual-only scan (brand/model landed after results)</div>
                    )}
                    {lensError && !lensLoading && (
                      <div style={{ fontSize: '0.78rem', color: '#f87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: '8px', padding: '8px 12px', marginBottom: '10px' }}> {lensError}</div>
                    )}
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                      {/* Extension silent match (primary) + manual Lens tab (always available) */}
                      {/* Manual path — always available, opens the picked image in a Google Lens tab */}
                      {lensUrl ? (
                        <a
                          href={lensUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            padding: '8px 14px', borderRadius: '8px',
                            border: '1px solid rgba(59,130,246,0.4)',
                            background: 'rgba(59,130,246,0.1)', color: '#60a5fa',
                            fontWeight: 600, fontSize: '0.82rem', textDecoration: 'none',
                            display: 'inline-flex', alignItems: 'center', gap: '5px'
                          }}
                        >
                           Open in Google Lens ↗
                        </a>
                      ) : (
                        <span style={{ fontSize: '0.78rem', color: '#64748b' }}>Resolving best image…</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Results list */}
                {lensLoading && (
                  <div style={{ textAlign: 'center', padding: '20px', color: '#a78bfa' }}>
                    <div style={{ fontSize: '1.4rem', marginBottom: '6px' }}></div>
                    <div style={{ fontSize: '0.82rem' }}>{lensRunMode === 'server' ? 'Running server Lens · Extracting visual matches...' : 'Opening background Lens tab · Extracting visual matches...'}</div>
                    <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px' }}>{lensRunMode === 'server' ? 'Real-browser run, up to ~60 seconds · Tab stays usable' : 'Takes 8–12 seconds · No flash in your browser'}</div>
                  </div>
                )}

                {lensResults && !lensLoading && lensResults.visualMatches?.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '10px', fontWeight: 600 }}>VISUAL MATCH RESULTS</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {makerCard}
                      {rankedLensVisuals.map((m, i) => (
                        <div key={i} style={{
                          background: i === 0 ? 'rgba(124,58,237,0.15)' : 'rgba(15,23,42,0.8)',
                          border: `1px solid ${i === 0 ? 'rgba(124,58,237,0.5)' : '#1e293b'}`,
                          borderRadius: '10px', padding: '12px 14px',
                          display: 'flex', alignItems: 'center', gap: '12px'
                        }}>
                          {m.imageUrl && (
                            <img src={m.imageUrl} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: '6px', flexShrink: 0 }}
                              onError={e => { e.target.style.display = 'none'; }} />
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {i === 0 && <span style={{ background: 'rgba(124,58,237,0.3)', color: '#e9d5ff', borderRadius: '20px', padding: '1px 8px', fontSize: '0.67rem', fontWeight: 700, display: 'inline-block', marginBottom: '3px' }}> TOP VISUAL MATCH</span>}
                            {lensBrandScore(m) > 0 && <span style={{ background: 'rgba(16,185,129,0.2)', color: '#6ee7b7', borderRadius: '20px', padding: '1px 8px', fontSize: '0.67rem', fontWeight: 700, display: 'inline-block', marginBottom: '3px', marginLeft: i === 0 ? '6px' : 0 }}> specified brand</span>}
                            <div style={{ color: '#c4b5fd', fontWeight: 600, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title || 'Visual Match'}</div>
                            <div style={{ color: '#64748b', fontSize: '0.73rem', marginTop: '2px' }}> {m.source || 'Unknown source'}</div>
                          </div>
                          <a
                            href={m.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#38bdf8', fontSize: '0.75rem', textDecoration: 'none', padding: '5px 12px', border: '1px solid rgba(56,189,248,0.3)', borderRadius: '6px', whiteSpace: 'nowrap', flexShrink: 0 }}
                          >
                             View →
                          </a>
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: '12px', fontSize: '0.73rem', color: '#475569', textAlign: 'center' }}>
                       Satisfied with Lens results? Let us know and we'll promote Lens as the primary matching strategy.
                    </div>
                  </div>
                )}

                {lensResults && !lensLoading && (!lensResults.visualMatches || lensResults.visualMatches.length === 0) && (
                  <div style={{ textAlign: 'center', padding: '20px', color: '#64748b' }}>
                    <div style={{ fontSize: '1.2rem', marginBottom: '6px' }}></div>
                    <div style={{ fontSize: '0.82rem' }}>No visual matches extracted from Lens DOM.</div>
                    {lensUrl && <a href={lensUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#38bdf8', fontSize: '0.78rem', marginTop: '6px', display: 'inline-block' }}> Try opening Google Lens manually →</a>}
                  </div>
                )}

                {!lensResults && !lensLoading && (
                  <div style={{ textAlign: 'center', padding: '16px', color: '#475569', fontSize: '0.8rem', borderTop: '1px solid #1e293b', marginTop: '4px' }}>
                     The link above opens the auto-picked best image in a Google Lens tab — no extension needed.
                  </div>
                )}

              </div>
            );
          })()}

        </div>
      </div>
    </div>
  );
}
