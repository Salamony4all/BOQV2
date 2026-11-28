// Supabase Edge Function: market-scanner
// 100% Serverless GCC & Oman Construction Market Radar (Scan, Observer, Enrich, Digest)
// Zero Railway dependency — persists directly into `scanner_*` Supabase tables.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ENV_GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') ?? Deno.env.get('GOOGLE_API_KEY') ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MarketScannerEdge/2.0';

const SCOPES: Record<string, { label: string; priority: number; keywords: Record<string, number> }> = {
  furniture: {
    label: 'Furniture (FF&E)',
    priority: 1.6,
    keywords: {
      furniture: 3, 'ff&e': 4, ffe: 3, 'loose furniture': 4, 'office furniture': 3,
      'hotel furniture': 4, joinery: 2, millwork: 2, wardrobe: 3, carpentry: 2,
      upholstery: 3, seating: 2, workstations: 3, desks: 2, casegoods: 3,
      'bespoke furniture': 4, furnishing: 2, 'furniture package': 4, curtains: 3, carpet: 2,
    },
  },
  residential_kitchen: {
    label: 'Residential Kitchen',
    priority: 1.4,
    keywords: {
      'residential kitchen': 4, 'modular kitchen': 4, 'kitchen cabinets': 4,
      countertop: 2, worktop: 2, 'kitchen joinery': 3, 'villa kitchens': 4,
      'apartment kitchens': 4, 'kitchen island': 3, pantry: 2, 'home kitchen': 4,
    },
  },
  commercial_kitchen: {
    label: 'Commercial Kitchen',
    priority: 1.3,
    keywords: {
      'commercial kitchen': 4, 'kitchen equipment': 3, 'catering equipment': 4,
      'restaurant kitchen': 4, 'central kitchen': 4, 'cloud kitchen': 4,
      'banquet kitchen': 4, 'cold room': 2, 'food service': 2, 'hotel kitchen': 4,
    },
  },
  sanitary_tiles: {
    label: 'Sanitary & Tiles',
    priority: 1.2,
    keywords: {
      'sanitary ware': 4, sanitaryware: 4, tiles: 3, tiling: 3, porcelain: 3,
      'ceramic tile': 4, 'bathroom fittings': 4, washbasin: 2, marble: 2,
      sanitary: 3, 'plumbing fixtures': 3,
    },
  },
  fitouts: {
    label: 'Fit-outs',
    priority: 1.0,
    keywords: {
      'fit-out': 3, fitout: 3, 'fit out': 3, 'interior fit': 3, 'interior finishing': 2,
      partitioning: 2, 'suspended ceiling': 2, 'false ceiling': 2, shopfitting: 3,
      refurbishment: 1, 'turnkey interiors': 3, 'interior design and build': 3,
    },
  },
};

const STAGES: Record<string, { weight: number; patterns: string[] }> = {
  concept: { weight: 45, patterns: ['concept', 'master plan', 'feasibility', 'announced', 'planned', 'proposed', 'unveil'] },
  design: { weight: 60, patterns: ['design', 'architect appoint', 'consultant appoint', 'drawing', 'masterplan'] },
  tender: { weight: 90, patterns: ['tender', 'rfq', 'rfp', 'invitation to bid', 'bids invited', 'itb', 'solicitation', 'bidding'] },
  award: { weight: 100, patterns: ['award', 'contract signed', 'appointed contractor', 'won the contract', 'wins contract'] },
  construction: { weight: 75, patterns: ['construction', 'underway', 'under way', 'breaks ground', 'main works', 'on site'] },
  completion: { weight: 35, patterns: ['complet', 'substantial', 'snagging', 'commissioning', 'topped out'] },
  handover: { weight: 20, patterns: ['handover', 'handed over', 'inaugurat', 'opened', 'operational'] },
  unknown: { weight: 30, patterns: [] },
};

const REGIONAL_CFG: Record<string, {
  country: string;
  gl: string;
  currency: string;
  rateToOmr: number;
  defaultCity: string;
  defaultLat: number;
  defaultLon: number;
  queries: string[];
  cities: Record<string, [number, number]>;
}> = {
  OM: {
    country: 'Oman', gl: 'OM', currency: 'OMR', rateToOmr: 1.0,
    defaultCity: 'Muscat', defaultLat: 23.588, defaultLon: 58.3829,
    queries: ['Oman construction project award', 'Oman hotel resort construction fit-out', 'Duqm SEZAD Oman project award'],
    cities: {
      muscat: [23.588, 58.408], seeb: [23.67, 58.19], sohar: [24.365, 56.747],
      salalah: [17.015, 54.092], nizwa: [22.933, 57.533], sur: [22.567, 59.529],
      duqm: [19.697, 57.695], ibri: [23.226, 56.509], barka: [23.683, 57.883],
      rustaq: [23.39, 57.42], khasab: [26.16, 56.246], buraimi: [24.35, 55.78],
    },
  },
  SA: {
    country: 'Saudi Arabia', gl: 'SA', currency: 'SAR', rateToOmr: 0.103,
    defaultCity: 'Riyadh', defaultLat: 24.7136, defaultLon: 46.6753,
    queries: ['Saudi Arabia construction project award tender', 'Riyadh Diriyah Red Sea fit-out contract'],
    cities: {
      riyadh: [24.7136, 46.6753], jeddah: [21.5433, 39.1728], neom: [28.0567, 35.3125],
      tabuk: [28.0567, 35.3125], diriyah: [24.734, 46.577], 'red sea': [25.545, 36.985],
      dammam: [26.4207, 50.0888], khobar: [26.2818, 50.2084], qiddiya: [24.58, 46.32],
    },
  },
  AE: {
    country: 'UAE', gl: 'AE', currency: 'AED', rateToOmr: 0.105,
    defaultCity: 'Dubai', defaultLat: 25.2048, defaultLon: 55.2708,
    queries: ['UAE Dubai construction project award', 'Abu Dhabi Ras Al Khaimah resort fit-out contract'],
    cities: {
      dubai: [25.2048, 55.2708], 'abu dhabi': [24.4539, 54.3773], sharjah: [25.3463, 55.4209],
      'ras al khaimah': [25.67, 55.74], marjan: [25.67, 55.74], ajman: [25.4052, 55.5136],
    },
  },
  QA: {
    country: 'Qatar', gl: 'QA', currency: 'QAR', rateToOmr: 0.106,
    defaultCity: 'Doha', defaultLat: 25.2854, defaultLon: 51.531,
    queries: ['Qatar Doha Lusail construction project award', 'Qatar resort hotel fit-out tender'],
    cities: { doha: [25.2854, 51.531], lusail: [25.42, 51.49], simaisma: [25.575, 51.485] },
  },
  KW: {
    country: 'Kuwait', gl: 'KW', currency: 'KWD', rateToOmr: 1.25,
    defaultCity: 'Kuwait City', defaultLat: 29.3759, defaultLon: 47.9774,
    queries: ['Kuwait construction project contract award', 'South Al Mutlaa Kuwait project tender'],
    cities: { 'kuwait city': [29.3759, 47.9774], mutlaa: [29.54, 47.68], 'al jahra': [29.3375, 47.6581] },
  },
  BH: {
    country: 'Bahrain', gl: 'BH', currency: 'BHD', rateToOmr: 1.02,
    defaultCity: 'Manama', defaultLat: 26.2285, defaultLon: 50.586,
    queries: ['Bahrain Manama construction project tender award'],
    cities: { manama: [26.2285, 50.586], muharraq: [26.2572, 50.6119], riffa: [26.13, 50.555] },
  },
  EG: {
    country: 'Egypt', gl: 'EG', currency: 'EGP', rateToOmr: 0.008,
    defaultCity: 'Cairo', defaultLat: 30.0444, defaultLon: 31.2357,
    queries: ['Egypt New Administrative Capital New Alamein construction contract'],
    cities: { cairo: [30.0444, 31.2357], 'new alamein': [30.835, 28.955], alexandria: [31.2001, 29.9187] },
  },
  JO: {
    country: 'Jordan', gl: 'JO', currency: 'JOD', rateToOmr: 0.543,
    defaultCity: 'Amman', defaultLat: 31.9539, defaultLon: 35.9106,
    queries: ['Jordan Amman Aqaba construction project award'],
    cities: { amman: [31.9539, 35.9106], aqaba: [29.5321, 35.0063] },
  },
};

const ENTITY_AR_EN: Record<string, string> = {
  'أسياد': 'Asyad Group',
  'وزارة الصحة': 'Ministry of Health',
  'وزارة التعليم': 'Ministry of Education',
  'بلدية مسقط': 'Muscat Municipality',
  'بلديه ظفار': 'Dhofar Municipality',
  'بلدية ظفار': 'Dhofar Municipality',
  'وزارة الإسكان والتخطيط العمراني': 'Ministry of Housing & Urban Planning',
  'وزارة التراث والسياحة': 'Ministry of Heritage & Tourism',
  'وزارة الدفاع': 'Ministry of Defence',
  'جامعة السلطان قابوس': 'Sultan Qaboos University',
  'الشركة العمانية لإدارة التنمية السياحية': 'Omran Group',
  'المؤسسة العامة للمناطق الصناعية': 'Madayn',
  'هيئة المشاريع والمناقصات والمحتوى المحلي': 'Projects, Tenders & Local Content Authority',
};

const TITLE_GLOSSARY: Array<[string, string]> = [
  ['توريد وتركيب', 'Supply & Installation of'],
  ['توريد و تركيب', 'Supply & Installation of'],
  ['توريد', 'Supply of'],
  ['تركيب', 'Installation of'],
  ['تأثيث', 'Furnishing of'],
  ['أثاث', 'Furniture'],
  ['مفروشات', 'Furnishings'],
  ['ستائر', 'Curtains'],
  ['سجاد', 'Carpets'],
  ['أدوات صحية', 'Sanitary Ware'],
  ['صحية', 'Sanitary'],
  ['بلاط', 'Tiles'],
  ['رخام', 'Marble'],
  ['سيراميك', 'Ceramic Tiles'],
  ['معدات', 'Equipment'],
  ['مطبخ', 'Kitchen'],
  ['مكاتب', 'Offices'],
  ['خزائن', 'Cabinets'],
  ['تشطيب', 'Finishing'],
  ['ديكور', 'Decoration'],
  ['إنشاء', 'Construction of'],
  ['تجهيز', 'Fit-out of'],
  ['أعمال', 'Works'],
  ['مستشفى', 'Hospital'],
  ['جامعة', 'University'],
  ['مدرسة', 'School'],
  ['فندق', 'Hotel'],
  ['مبنى', 'Building'],
];

const SCOPE_HINTS_AR: Record<string, string[]> = {
  furniture: ['أثاث', 'مفروشات', 'سجاد', 'ستائر', 'مكاتب', 'خزائن', 'تأثيث', 'كنبات', 'مقاعد', 'نجارة'],
  sanitary_tiles: ['سباكة', 'صحية', 'أدوات صحية', 'بلاط', 'رخام', 'سيراميك', 'بورسلين', 'مغاسل', 'حمام'],
  commercial_kitchen: ['مطعم', 'مطبخ تجاري', 'معدات مطابخ', 'كافيتريا', 'مطابخ', 'مطبخ مركزي'],
  residential_kitchen: ['مطبخ سكني', 'مطبخ منزلي', 'مطابخ الوحدات', 'مطبخ شقة'],
  fitouts: ['تشطيب', 'ديكور', 'أقسام', 'جبس', 'دهان', 'ترميم', 'تجهيز', 'أعمال داخلية'],
};

async function sha1Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-1', bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function classifyScopes(text: string): Record<string, number> {
  const low = ` ${text.toLowerCase()} `;
  const strengths: Record<string, number> = {};
  for (const [scope, meta] of Object.entries(SCOPES)) {
    let s = 0;
    for (const [kw, w] of Object.entries(meta.keywords)) {
      const escaped = kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matches = low.match(new RegExp(escaped, 'g'));
      if (matches) s += w * Math.min(matches.length, 3);
    }
    if (s > 0) strengths[scope] = s;
  }
  const maxS = Math.max(0, ...Object.values(strengths)) || 1;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(strengths)) out[k] = v / maxS;
  return out;
}

function detectStage(text: string): string {
  const low = text.toLowerCase();
  const order = ['concept', 'design', 'tender', 'award', 'construction', 'completion', 'handover'];
  for (let i = order.length - 1; i >= 0; i--) {
    const st = order[i];
    if (STAGES[st].patterns.some((p) => low.includes(p))) return st;
  }
  return 'unknown';
}

function detectValue(text: string, defaultRate = 1.0, defaultCurrency = 'OMR'): { valueOmr: number | null; note: string | null } {
  const m = text.match(/(?:(OMR|RO|USD|\$|AED|SAR|QAR|KWD|BHD|EGP|JOD)\s?([\d,.]+)\s?(billion|bn|million|mn|m\b)?)/i)
    || text.match(/([\d,.]+)\s?(billion|bn|million|mn|m\b)\s?(OMR|RO|USD|AED|SAR|QAR|KWD|BHD|EGP|JOD)?/i);
  if (!m) return { valueOmr: null, note: null };
  const rawNum = parseFloat((m[2] && /[\d.]/.test(m[2]) ? m[2] : m[1]).replace(/,/g, ''));
  if (!Number.isFinite(rawNum) || rawNum <= 0) return { valueOmr: null, note: null };
  const mult = (m[3] || m[2] || '').toLowerCase();
  const scaled = mult.startsWith('b') ? rawNum * 1000 : rawNum;
  const cur = (m[1] && !/[\d.]/.test(m[1]) ? m[1] : (m[3] && !/million|mn|bn|billion/i.test(m[3]) ? m[3] : defaultCurrency)).toLowerCase();
  const rates: Record<string, number> = {
    omr: 1.0, ro: 1.0, usd: 0.385, '$': 0.385, aed: 0.105, sar: 0.103, qar: 0.106, kwd: 1.25, bhd: 1.02, egp: 0.008, jod: 0.543,
  };
  const rate = rates[cur] ?? defaultRate;
  return { valueOmr: Math.round(scaled * rate * 100) / 100, note: m[0].trim() };
}

function scoreLead(scopesStrength: Record<string, number>, stage: string, hasValue: boolean, hasContacts: boolean): number {
  const base = STAGES[stage]?.weight ?? 30;
  let topScope: string | null = null;
  let topVal = 0;
  for (const [k, v] of Object.entries(scopesStrength)) {
    if (v > topVal) { topVal = v; topScope = k; }
  }
  const scopeMult = topScope ? SCOPES[topScope].priority : 0.8;
  const scopeStrength = topVal || 0.2;
  let s = base * scopeMult * (0.6 + 0.4 * scopeStrength);
  if (hasValue) s *= 1.05;
  if (hasContacts) s *= 1.1;
  return Math.round(Math.min(100, s) * 10) / 10;
}

function translateArabicTitle(arText: string): string {
  let out = arText.trim();
  for (const [ar, en] of [...TITLE_GLOSSARY].sort((a, b) => b[0].length - a[0].length)) {
    out = out.split(ar).join(` ${en} `);
  }
  out = out.replace(/[\u0600-\u06FF]+/g, '').replace(/\(\)/g, '').replace(/\s{2,}/g, ' ').replace(/^[\s\-–—()]+|[\s\-–—()]+$/g, '');
  return out || arText;
}

function extractContactsFromText(text: string, source = 'scan') {
  const out: Array<Record<string, unknown>> = [];
  const emails = Array.from(new Set(text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []));
  for (const em of emails.slice(0, 4)) {
    if (/example\.com|noreply|sentry/i.test(em)) continue;
    const name = em.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    out.push({
      contact_key: `em:${em.toLowerCase()}`,
      name,
      email: em,
      source,
      confidence: 0.8,
    });
  }
  const phones = Array.from(new Set(text.match(/(?:\+\d{1,3}[\s-]?)?\d{4}[\s-]?\d{4}(?:[\s-]?\d{3})?/g) || []));
  for (const ph of phones.slice(0, 3)) {
    const digits = ph.replace(/\D/g, '');
    if (digits.length >= 8) {
      out.push({
        contact_key: `ph:${digits}`,
        phone: ph.trim(),
        source,
        confidence: 0.45,
      });
    }
  }
  return out;
}

async function fetchWithTimeout(url: string, ms = 8500): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml,text/xml,*/*' },
    });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  } finally {
    clearTimeout(t);
  }
}

async function fetchOmanTenderBoard(maxPages = 2): Promise<Array<Record<string, unknown>>> {
  const base = 'https://etendering.tenderboard.gov.om/product/publicDash';
  const out: Array<Record<string, unknown>> = [];
  for (const viewFlag of ['NewTenders', 'AwardedTenders']) {
    for (let page = 1; page <= maxPages; page++) {
      const html = await fetchWithTimeout(`${base}?viewFlag=${viewFlag}${page > 1 ? `&pageNo=${page}` : ''}`, 10000);
      if (!html || !html.includes('<tr')) break;
      const trMatches = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
      let pageRows = 0;
      for (const tr of trMatches) {
        const tds = Array.from(tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((m) => stripTags(m[1]));
        if (tds.length < 7 || !/^\d+\.$/.test(tds[0])) continue;
        pageRows++;
        const tndId = tds[1] || '';
        const hiddenMatch = tr.match(/name=["'][^"']*tendDesc[^"']*["'][^>]*value=["']([^"']*)["']/i);
        const fullDesc = (hiddenMatch ? decodeXml(hiddenMatch[1]) : tds[2]) || '';
        const entityAr = tds[3] || '';
        const catAr = (tds[4] || '').split('[')[0].trim();
        const datesRaw = tds[6] || '';
        const closeM = datesRaw.match(/Bid Closing Date:\s*([\d-]+)/i);
        const textForScope = `${fullDesc} ${catAr}`.toLowerCase();
        const scopes = Object.entries(SCOPE_HINTS_AR)
          .filter(([, kws]) => kws.some((k) => textForScope.includes(k)))
          .map(([k]) => k);
        if (scopes.length === 0) continue;

        let entityDisplay = entityAr;
        for (const [ar, en] of Object.entries(ENTITY_AR_EN)) {
          if (entityAr.startsWith(ar)) { entityDisplay = `${en} (${ar})`; break; }
        }
        const nitM = tr.match(/getNit\('(\d+)'\)/);
        const extId = `tb:${(await sha1Hex(tndId || fullDesc)).slice(0, 12)}`;
        const enName = translateArabicTitle(fullDesc);
        const stage = viewFlag === 'AwardedTenders' ? 'award' : 'tender';
        out.push({
          ext_id: extId,
          name: `${fullDesc} — ${entityDisplay}`.slice(0, 160),
          en_name: enName.slice(0, 160),
          country: 'Oman',
          city: 'Muscat',
          lat: 23.588,
          lon: 58.408,
          location_name: 'Oman',
          scopes,
          top_scope: scopes[0],
          stage,
          client: entityDisplay,
          summary: `[Oman Tender Board · ${stage}] ${closeM ? `Bid closing ${closeM[1]}` : ''}`.trim().slice(0, 500),
          source_name: 'Oman Tender Board',
          source_url: `${base}?${nitM ? `tenderId=${nitM[1]}&` : ''}viewFlag=${viewFlag}`,
          score: 84,
          status: 'active',
          is_news: false,
        });
      }
      if (pageRows === 0) break;
    }
  }
  return out;
}

async function fetchRssLeads(country = 'ALL'): Promise<{ projects: Array<Record<string, unknown>>; ok: number; fail: number }> {
  const targetCodes = country && country.toUpperCase() !== 'ALL'
    ? Object.keys(REGIONAL_CFG).filter((c) => c === country.toUpperCase() || REGIONAL_CFG[c].country.toLowerCase() === country.toLowerCase())
    : Object.keys(REGIONAL_CFG);
  const codes = targetCodes.length ? targetCodes : ['OM'];

  const tasks: Array<Promise<Array<Record<string, unknown>>>> = [];
  for (const code of codes) {
    const cfg = REGIONAL_CFG[code];
    for (const q of cfg.queries.slice(0, 2)) {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en&gl=${cfg.gl}&ceid=${cfg.gl}:en`;
      tasks.push((async () => {
        const xml = await fetchWithTimeout(url, 8000);
        if (!xml || !xml.includes('<item>')) return [];
        const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
        const found: Array<Record<string, unknown>> = [];
        for (const it of items.slice(0, 4)) {
          const rawTitle = decodeXml((it.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
          const link = decodeXml((it.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '');
          if (!rawTitle || !link) continue;
          const cleanTitle = rawTitle.replace(/\s*[-–—|]\s*(The Times of Oman|Oman Observer|Zawya|Reuters|Construction Week|Gulf News|TradeArabia|Arabian Business|Arab News|Khaleej Times|The National).*$/i, '').trim() || rawTitle;
          const scopesObj = classifyScopes(cleanTitle);
          const scopesList = Object.keys(scopesObj);
          const stage = detectStage(cleanTitle);
          const { valueOmr, note } = detectValue(cleanTitle, cfg.rateToOmr, cfg.currency);
          let city = cfg.defaultCity;
          let lat = cfg.defaultLat;
          let lon = cfg.defaultLon;
          const low = cleanTitle.toLowerCase();
          for (const [ck, coords] of Object.entries(cfg.cities)) {
            if (low.includes(ck)) {
              city = ck.replace(/\b\w/g, (c) => c.toUpperCase());
              [lat, lon] = coords;
              break;
            }
          }
          const key = (await sha1Hex(`${cfg.country}:${cleanTitle.toLowerCase()}`)).slice(0, 14);
          found.push({
            ext_id: `bnc:${code.toLowerCase()}_${key}`,
            name: cleanTitle.slice(0, 160),
            en_name: cleanTitle.slice(0, 160),
            country: cfg.country,
            city,
            lat,
            lon,
            location_name: `${city}, ${cfg.country}`,
            scopes: scopesList.length ? scopesList : ['fitouts'],
            top_scope: scopesList[0] || 'fitouts',
            stage,
            est_value_omr: valueOmr,
            value_note: note,
            summary: `[BNC Regional Intelligence] ${cleanTitle}`.slice(0, 500),
            source_name: 'BNC Network',
            source_url: link,
            score: Math.max(72, scoreLead(scopesObj, stage, valueOmr !== null, false)),
            status: 'active',
            is_news: false,
          });
        }
        return found;
      })());
    }
  }

  const settled = await Promise.allSettled(tasks);
  const projects: Array<Record<string, unknown>> = [];
  let ok = 0;
  let fail = 0;
  for (const res of settled) {
    if (res.status === 'fulfilled') {
      ok++;
      projects.push(...res.value);
    } else {
      fail++;
    }
  }
  return { projects, ok, fail };
}

async function upsertScannedProjects(projects: Array<Record<string, unknown>>) {
  const deduped = Array.from(new Map(projects.map((p) => [String(p.ext_id), p])).values());
  let created = 0;
  let updated = 0;
  if (deduped.length === 0) return { created, updated };

  const extIds = deduped.map((p) => String(p.ext_id));
  const { data: existingRows } = await supabase.from('scanner_projects').select('id, ext_id').in('ext_id', extIds);
  const existingSet = new Set((existingRows || []).map((r) => r.ext_id));

  const nowIso = new Date().toISOString();
  const payload = deduped.map((p) => ({
    ...p,
    last_seen: nowIso,
    updated_at: nowIso,
  }));

  for (let i = 0; i < payload.length; i += 40) {
    await supabase.from('scanner_projects').upsert(payload.slice(i, i + 40), { onConflict: 'ext_id' });
  }

  for (const p of deduped) {
    if (existingSet.has(String(p.ext_id))) updated++;
    else created++;
  }
  return { created, updated };
}

async function callAiJson(
  systemPrompt: string,
  userPrompt: string,
  aiConfig?: { provider?: string; apiKey?: string; model?: string; baseUrl?: string },
): Promise<Record<string, unknown> | null> {
  const apiKey = aiConfig?.apiKey || ENV_GEMINI_KEY;
  if (!apiKey) return null;

  const provider = (aiConfig?.provider || 'google').toLowerCase();
  if (provider === 'google') {
    const model = (aiConfig?.model || 'gemini-2.5-flash-lite').replace(':billed', '').trim();
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
        }),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const txt = (data?.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || '').join('');
    try { return JSON.parse(txt); } catch { return null; }
  }

  const baseUrl = (aiConfig?.baseUrl || (provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://integrate.api.nvidia.com/v1')).replace(/\/+$/, '');
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: aiConfig?.model || 'gpt-4o-mini',
      temperature: 0.1,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content || '';
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

async function runEnrichOne(projectId: number, aiConfig?: { provider?: string; apiKey?: string; model?: string; baseUrl?: string }) {
  const { data: proj } = await supabase.from('scanner_projects').select('*').eq('id', projectId).maybeSingle();
  if (!proj) return { ok: false, error: 'Project not found' };

  const title = proj.en_name || proj.name || '';
  const query = `${title.split(/[-|—]/)[0].trim().split(/\s+/).slice(0, 7).join(' ')} ${proj.country || 'Oman'} construction project`;
  const [rssXml, ddgHtml, pageHtml] = await Promise.all([
    fetchWithTimeout(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en`, 7500),
    fetchWithTimeout(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, 7500),
    proj.source_url?.startsWith('http') ? fetchWithTimeout(proj.source_url, 7500) : Promise.resolve(''),
  ]);

  const snippets: string[] = [];
  for (const m of rssXml.match(/<title>([\s\S]*?)<\/title>/gi) || []) snippets.push(stripTags(m));
  for (const m of ddgHtml.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi) || []) snippets.push(stripTags(m));
  if (pageHtml) snippets.push(stripTags(pageHtml).slice(0, 4000));
  const corpus = `${title}. ${proj.summary || ''}. ${snippets.join(' ')}`.slice(0, 12000);

  const contacts = extractContactsFromText(corpus, 'cross-reference');
  for (const c of contacts) {
    await supabase.from('scanner_contacts').upsert({ project_id: proj.id, ...c }, { onConflict: 'project_id,contact_key' });
  }

  let aiSummary = proj.enrichment?.summary || '';
  let aiClient = proj.client;
  let aiContractor = proj.contractor;
  let aiConsultant = proj.consultant;
  const aiOut = await callAiJson(
    'You are a GCC construction intelligence analyst for furniture & fit-out suppliers. Return JSON with keys: summary (2 concise commercial sentences), client (string|null), contractor (string|null), consultant (string|null).',
    `Project: ${title}\nCountry: ${proj.country}\nCity: ${proj.city || ''}\nExisting summary: ${proj.summary || ''}\nEvidence snippets:\n${snippets.slice(0, 10).join('\n')}`,
    aiConfig,
  );
  if (aiOut) {
    if (typeof aiOut.summary === 'string' && aiOut.summary.trim()) aiSummary = aiOut.summary.trim();
    if (!aiClient && typeof aiOut.client === 'string' && aiOut.client.trim()) aiClient = aiOut.client.trim();
    if (!aiContractor && typeof aiOut.contractor === 'string' && aiOut.contractor.trim()) aiContractor = aiOut.contractor.trim();
    if (!aiConsultant && typeof aiOut.consultant === 'string' && aiOut.consultant.trim()) aiConsultant = aiOut.consultant.trim();
  }

  const nowIso = new Date().toISOString();
  const nextEnrichment = {
    ...(proj.enrichment || {}),
    summary: aiSummary || `${title} — tracked opportunity in ${proj.city || proj.country} covering ${(proj.scopes || []).join(', ') || 'fit-outs & FF&E'}.`,
    snippets_count: snippets.length,
    updated_via: 'supabase-edge',
  };

  await supabase.from('scanner_projects').update({
    client: aiClient || null,
    contractor: aiContractor || null,
    consultant: aiConsultant || null,
    enrichment: nextEnrichment,
    enriched_at: nowIso,
    updated_at: nowIso,
  }).eq('id', proj.id);

  return { ok: true, id: proj.id, contacts_added: contacts.length, enrichment: nextEnrichment };
}

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || 'scan').toLowerCase();

    if (action === 'scan') {
      const mode = body?.mode === 'deep' ? 'deep' : 'manual';
      const country = String(body?.country || 'ALL');
      const startedAt = new Date().toISOString();
      const { data: runRow } = await supabase.from('scanner_runs').insert({ started_at: startedAt, mode }).select('id').single();

      const [tbLeads, rssRes] = await Promise.all([
        country.toUpperCase() === 'ALL' || country.toUpperCase() === 'OM' ? fetchOmanTenderBoard(mode === 'deep' ? 3 : 2) : Promise.resolve([]),
        fetchRssLeads(country),
      ]);
      const all = [...tbLeads, ...rssRes.projects];
      const { created, updated } = await upsertScannedProjects(all);
      const okCount = rssRes.ok + (tbLeads.length > 0 ? 1 : 0);

      if (runRow?.id) {
        await supabase.from('scanner_runs').update({
          finished_at: new Date().toISOString(),
          sources_ok: okCount,
          sources_failed: rssRes.fail,
          findings: all.length,
          new_projects: created,
          updated,
          log: `Edge scan(${mode}, ${country}): findings=${all.length}, new=${created}, updated=${updated}`,
        }).eq('id', runRow.id);
      }
      return new Response(JSON.stringify({ ok: true, run_id: runRow?.id || null, findings: all.length, new: created, updated, sources_ok: okCount, sources_failed: rssRes.fail }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'observer') {
      const limit = Math.min(25, Math.max(1, Number(body?.limit) || 12));
      const { data: projs } = await supabase
        .from('scanner_projects')
        .select('*')
        .eq('status', 'active')
        .eq('is_news', false)
        .order('last_checked', { ascending: true, nullsFirst: true })
        .limit(limit);

      let checked = 0;
      let changes = 0;
      const stageOrder = ['unknown', 'concept', 'design', 'tender', 'award', 'construction', 'completion', 'handover'];
      const nowIso = new Date().toISOString();

      for (const p of projs || []) {
        checked++;
        if (p.source_url?.startsWith('http')) {
          const html = await fetchWithTimeout(p.source_url, 6500);
          if (html) {
            const txt = stripTags(html).slice(0, 6000);
            const newStage = detectStage(txt);
            const curStageIdx = stageOrder.indexOf(p.stage || 'unknown');
            const newStageIdx = stageOrder.indexOf(newStage);
            if (newStage !== 'unknown' && newStageIdx > curStageIdx) {
              await supabase.from('scanner_projects').update({ stage: newStage, updated_at: nowIso }).eq('id', p.id);
              await supabase.from('scanner_updates').insert({
                project_id: p.id, ts: nowIso, kind: 'change', field: 'stage', old_value: p.stage, new_value: newStage, note: 'Observer detected stage update',
              });
              changes++;
            }
            for (const c of extractContactsFromText(txt, 'observer')) {
              await supabase.from('scanner_contacts').upsert({ project_id: p.id, ...c }, { onConflict: 'project_id,contact_key' });
            }
          }
        }
        await supabase.from('scanner_projects').update({
          last_checked: nowIso,
          check_count: Number(p.check_count || 0) + 1,
        }).eq('id', p.id);
      }

      return new Response(JSON.stringify({ ok: true, checked, changes }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'enrich') {
      if (body?.projectId) {
        const res = await runEnrichOne(Number(body.projectId), body?.aiConfig);
        return new Response(JSON.stringify(res), { headers: { 'Content-Type': 'application/json' } });
      }
      const limit = Math.min(15, Math.max(1, Number(body?.limit) || 5));
      const { data: todo } = await supabase
        .from('scanner_projects')
        .select('id')
        .eq('status', 'active')
        .eq('is_news', false)
        .is('enriched_at', null)
        .order('score', { ascending: false })
        .limit(limit);
      let enriched = 0;
      for (const row of todo || []) {
        const r = await runEnrichOne(row.id, body?.aiConfig);
        if (r.ok) enriched++;
      }
      return new Response(JSON.stringify({ ok: true, enriched }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (action === 'digest') {
      const { data: leads } = await supabase
        .from('scanner_projects')
        .select('*')
        .eq('status', 'active')
        .eq('is_news', false)
        .order('score', { ascending: false })
        .limit(10);

      const enrichedLeads = [];
      for (const l of leads || []) {
        const { data: contacts } = await supabase.from('scanner_contacts').select('*').eq('project_id', l.id);
        enrichedLeads.push({ ...l, contacts: contacts || [] });
      }
      const summaryText = enrichedLeads.map((p, idx) =>
        `${idx + 1}. [${Math.round(p.score)}/100] ${p.en_name || p.name} (${p.city || p.country}) — ${p.stage}`,
      ).join('\n');

      const { data: cfgRow } = await supabase.from('scanner_config').select('value').eq('key', 'digest').maybeSingle();
      const webhookUrl = cfgRow?.value?.webhook_url;
      let dispatched = false;
      if (typeof webhookUrl === 'string' && /^https?:\/\//i.test(webhookUrl)) {
        try {
          const wh = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: `Top 10 Construction Leads Digest\n\n${summaryText}`, content: `Top 10 Construction Leads Digest\n\n${summaryText}` }),
          });
          dispatched = wh.ok;
        } catch { /* ignore webhook failure */ }
      }

      const { data: savedDigest } = await supabase.from('scanner_digests').insert({
        title: `Daily Top 10 Construction Radar — ${new Date().toISOString().slice(0, 10)}`,
        leads_count: enrichedLeads.length,
        leads_json: enrichedLeads,
        summary_text: summaryText,
        recipient: webhookUrl ? 'Webhook' : 'Dashboard',
        dispatched,
      }).select().single();

      return new Response(JSON.stringify({ ok: true, leads_count: enrichedLeads.length, digest_id: savedDigest?.id, dispatched }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: false, error: `Unknown action: ${action}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
