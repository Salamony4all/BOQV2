/**
 * Direct browser-to-Supabase read fallback for GCC & Oman Market Scanner.
 * Used transparently whenever Express (/api/scanner/*) is unreachable or returns non-200
 * (e.g., stopped dev server or un-restarted local backend), relying strictly on publishable anon creds.
 */
import { createClient } from '@supabase/supabase-js';

export const SCOPES = {
  furniture: { id: 'furniture', label: 'Furniture & FF&E', shortLabel: 'Furniture', priority: 1.6, color: '#60a5fa' },
  residential_kitchen: { id: 'residential_kitchen', label: 'Residential Kitchen', shortLabel: 'Res. Kitchen', priority: 1.4, color: '#fbbf24' },
  commercial_kitchen: { id: 'commercial_kitchen', label: 'Commercial Kitchen', shortLabel: 'Com. Kitchen', priority: 1.3, color: '#f97316' },
  sanitary_tiles: { id: 'sanitary_tiles', label: 'Sanitaryware & Tiles', shortLabel: 'Sanitary & Tiles', priority: 1.2, color: '#2dd4bf' },
  fitouts: { id: 'fitouts', label: 'Interior Fit-Outs', shortLabel: 'Fit-Outs', priority: 1.0, color: '#a78bfa' },
};

export const STAGES = {
  concept: { id: 'concept', label: 'Concept / Announced', weight: 45 },
  design: { id: 'design', label: 'Design Stage', weight: 60 },
  tender: { id: 'tender', label: 'Active Tender', weight: 90 },
  award: { id: 'award', label: 'Awarded', weight: 100 },
  construction: { id: 'construction', label: 'Under Construction', weight: 75 },
  completion: { id: 'completion', label: 'Near Completion', weight: 40 },
  handover: { id: 'handover', label: 'Handover / Operational', weight: 22 },
  hold: { id: 'hold', label: 'On Hold', weight: 15 },
  unknown: { id: 'unknown', label: 'Tracking', weight: 35 },
};

export const GCC_COUNTRIES = {
  OM: {
    code: 'OM',
    name: 'Oman',
    flag: '🇴🇲',
    currency: 'OMR',
    vatPercent: 5,
    lat: 23.588,
    lng: 58.3829,
    zoom: 6,
    defaultCity: 'Muscat',
    cities: {
      Muscat: { lat: 23.588, lng: 58.408, governorate: 'Muscat' },
      Seeb: { lat: 23.67, lng: 58.19, governorate: 'Muscat' },
      Bawshar: { lat: 23.575, lng: 58.405, governorate: 'Muscat' },
      Muttrah: { lat: 23.62, lng: 58.55, governorate: 'Muscat' },
      Amerat: { lat: 23.52, lng: 58.49, governorate: 'Muscat' },
      Quriyat: { lat: 23.264, lng: 58.918, governorate: 'Muscat' },
      'Al Khuwair': { lat: 23.598, lng: 58.435, governorate: 'Muscat' },
      'Sultan Haitham City': { lat: 23.655, lng: 58.145, governorate: 'Muscat' },
      Yiti: { lat: 23.532, lng: 58.675, governorate: 'Muscat' },
      'Al Mouj': { lat: 23.628, lng: 58.257, governorate: 'Muscat' },
      Sohar: { lat: 24.365, lng: 56.747, governorate: 'North Al Batinah' },
      Suwaiq: { lat: 23.849, lng: 57.438, governorate: 'North Al Batinah' },
      Saham: { lat: 24.172, lng: 56.889, governorate: 'North Al Batinah' },
      Shinas: { lat: 24.742, lng: 56.466, governorate: 'North Al Batinah' },
      Liwa: { lat: 24.539, lng: 56.565, governorate: 'North Al Batinah' },
      Khaburah: { lat: 23.972, lng: 57.093, governorate: 'North Al Batinah' },
      Barka: { lat: 23.683, lng: 57.883, governorate: 'South Al Batinah' },
      Khazaen: { lat: 23.645, lng: 57.84, governorate: 'South Al Batinah' },
      Rustaq: { lat: 23.39, lng: 57.42, governorate: 'South Al Batinah' },
      Nakhal: { lat: 23.392, lng: 57.829, governorate: 'South Al Batinah' },
      Musannah: { lat: 23.758, lng: 57.646, governorate: 'South Al Batinah' },
      Salalah: { lat: 17.015, lng: 54.092, governorate: 'Dhofar' },
      Sadah: { lat: 17.049, lng: 55.069, governorate: 'Dhofar' },
      Mirbat: { lat: 16.991, lng: 54.691, governorate: 'Dhofar' },
      Taqah: { lat: 17.04, lng: 54.398, governorate: 'Dhofar' },
      Thumrait: { lat: 17.674, lng: 54.022, governorate: 'Dhofar' },
      Nizwa: { lat: 22.933, lng: 57.533, governorate: 'Ad Dakhiliyah' },
      Samail: { lat: 23.304, lng: 57.95, governorate: 'Ad Dakhiliyah' },
      'Jabal Akhdar': { lat: 23.074, lng: 57.661, governorate: 'Ad Dakhiliyah' },
      Bahla: { lat: 22.964, lng: 57.3, governorate: 'Ad Dakhiliyah' },
      Adam: { lat: 22.379, lng: 57.527, governorate: 'Ad Dakhiliyah' },
      Izki: { lat: 22.933, lng: 57.767, governorate: 'Ad Dakhiliyah' },
      Manah: { lat: 22.8, lng: 57.6, governorate: 'Ad Dakhiliyah' },
      Bidbid: { lat: 23.409, lng: 58.126, governorate: 'Ad Dakhiliyah' },
      Ibra: { lat: 22.691, lng: 58.533, governorate: 'North Ash Sharqiyah' },
      Mudhaibi: { lat: 22.567, lng: 58.121, governorate: 'North Ash Sharqiyah' },
      Sinaw: { lat: 22.495, lng: 58.027, governorate: 'North Ash Sharqiyah' },
      Bidiyah: { lat: 22.449, lng: 58.803, governorate: 'North Ash Sharqiyah' },
      Sur: { lat: 22.567, lng: 59.529, governorate: 'South Ash Sharqiyah' },
      'Jaalan Bani Bu Ali': { lat: 22.017, lng: 59.324, governorate: 'South Ash Sharqiyah' },
      Masirah: { lat: 20.662, lng: 58.882, governorate: 'South Ash Sharqiyah' },
      Duqm: { lat: 19.697, lng: 57.695, governorate: 'Al Wusta' },
      Mahout: { lat: 20.43, lng: 58.18, governorate: 'Al Wusta' },
      Haima: { lat: 19.956, lng: 56.279, governorate: 'Al Wusta' },
      Ibri: { lat: 23.226, lng: 56.509, governorate: 'Ad Dhahirah' },
      Yanqul: { lat: 23.588, lng: 56.549, governorate: 'Ad Dhahirah' },
      Dhank: { lat: 23.549, lng: 56.262, governorate: 'Ad Dhahirah' },
      Buraimi: { lat: 24.251, lng: 55.793, governorate: 'Al Buraimi' },
      Mahadha: { lat: 24.407, lng: 55.978, governorate: 'Al Buraimi' },
      Khasab: { lat: 26.18, lng: 56.248, governorate: 'Musandam' },
      Dibba: { lat: 25.62, lng: 56.261, governorate: 'Musandam' },
      Bukha: { lat: 26.143, lng: 56.152, governorate: 'Musandam' },
      Madha: { lat: 25.284, lng: 56.332, governorate: 'Musandam' },
    },
    platforms: [
      { id: 'esnaad', name: 'Esnaad / Oman Tender Board', url: 'https://etendering.tenderboard.gov.om/product/publicDash?viewFlag=NewTenders', category: 'Government (Esnaad)', desc: 'Official Oman central e-tendering portal (New & Awarded tenders across all 11 Governorates)' },
      { id: 'jsrs', name: 'JSRS (Business Gateways)', url: 'https://businessgateways.com/', category: 'Oil & Gas Mandatory', desc: 'National JSRS supplier certification for PDO, OQ, Oman LNG & Daleel packages' },
      { id: 'omran', name: 'OMRAN Group', url: 'https://omran.om/', category: 'Tourism & Hospitality', desc: 'Oman tourism developments, resorts, Yiti, Sultan Haitham hospitality & FF&E' },
      { id: 'khazaen', name: 'Khazaen Economic City', url: 'https://khazaen.om/', category: 'Logistics & Urban Hub', desc: 'Integrated dry port, warehousing, commercial offices & residential parcels near Barka' },
      { id: 'opaz', name: 'OPAZ / Duqm SEZAD', url: 'https://www.opaz.gov.om/', category: 'Special Economic Zones', desc: 'Public Authority for Special Economic Zones & Free Zones (Duqm, Sohar, Salalah, Al Mazunah)' },
      { id: 'madayn', name: 'Madayn', url: 'https://madayn.om/', category: 'Industrial Estates', desc: 'Industrial cities, administrative hubs & innovation buildings across Oman' },
      { id: 'pdo', name: 'Petroleum Development Oman (PDO)', url: 'https://www.pdo.co.om/', category: 'Energy', desc: 'Interior accommodation camps, offices & industrial facility packages' },
      { id: 'oq', name: 'OQ Group', url: 'https://oq.com/en', category: 'Energy & Petrochemicals', desc: 'OQ energy complexes, Duqm/Sohar admin buildings & control centers' },
      { id: 'asyad', name: 'Asyad Group', url: 'https://asyad.om/', category: 'Ports & Logistics', desc: 'Port terminals, customs buildings & logistics park fit-outs' },
      { id: 'mm', name: 'Muscat Municipality', url: 'https://www.mm.gov.om/', category: 'Municipality', desc: 'Muscat municipal buildings, public markets & civic facility upgrades' },
      { id: 'airports', name: 'Oman Airports', url: 'https://www.omanairports.co.om/', category: 'Aviation & Duty Free', desc: 'Airport lounges, F&B kitchens, retail fit-outs (Muscat, Salalah, Sohar, Duqm)' },
    ],
  },
  SA: {
    code: 'SA',
    name: 'Saudi Arabia',
    flag: '🇸🇦',
    currency: 'SAR',
    vatPercent: 15,
    lat: 24.7136,
    lng: 46.6753,
    zoom: 5,
    defaultCity: 'Riyadh',
    cities: {
      Riyadh: { lat: 24.7136, lng: 46.6753, governorate: 'Riyadh Province' },
      Jeddah: { lat: 21.5433, lng: 39.1728, governorate: 'Makkah Province' },
      NEOM: { lat: 28.0567, lng: 35.3125, governorate: 'Tabuk' },
      Diriyah: { lat: 24.734, lng: 46.577, governorate: 'Riyadh Province' },
      'Red Sea': { lat: 25.545, lng: 36.985, governorate: 'Tabuk' },
      Dammam: { lat: 26.4207, lng: 50.0888, governorate: 'Eastern Province' },
      Khobar: { lat: 26.2818, lng: 50.2084, governorate: 'Eastern Province' },
      Qiddiya: { lat: 24.58, lng: 46.32, governorate: 'Riyadh Province' },
      'Al Ula': { lat: 26.617, lng: 37.919, governorate: 'Al Madinah' },
    },
    platforms: [
      { id: 'etimad', name: 'Etimad (Ministry of Finance)', url: 'https://etimad.sa/', category: 'Government', desc: 'KSA unified government procurement & public tenders portal' },
      { id: 'roshn', name: 'ROSHN Supplier Portal', url: 'https://www.roshn.sa/en/suppliers', category: 'PIF Giga-Project', desc: 'Large-scale community housing, clubhouses & retail hubs' },
      { id: 'neom', name: 'NEOM Procurement', url: 'https://www.neom.com/en-us/our-business/suppliers', category: 'PIF Giga-Project', desc: 'Sindalah, Trojena, Oxagon & THE LINE hospitality & fit-outs' },
      { id: 'rsg', name: 'Red Sea Global', url: 'https://www.redseaglobal.com/en/suppliers', category: 'Luxury Hospitality', desc: 'Ultra-luxury resorts, F&B kitchens & turnkey FF&E' },
      { id: 'diriyah', name: 'Diriyah Company', url: 'https://www.diriyah.sa/', category: 'Heritage & Hospitality', desc: 'Riyadh heritage district luxury hotels, offices & retail' },
    ],
  },
  AE: {
    code: 'AE',
    name: 'UAE',
    flag: '🇦🇪',
    currency: 'AED',
    vatPercent: 5,
    lat: 25.2048,
    lng: 55.2708,
    zoom: 7,
    defaultCity: 'Dubai',
    cities: {
      Dubai: { lat: 25.2048, lng: 55.2708, governorate: 'Dubai' },
      'Abu Dhabi': { lat: 24.4539, lng: 54.3773, governorate: 'Abu Dhabi' },
      Sharjah: { lat: 25.3463, lng: 55.4209, governorate: 'Sharjah' },
      'Ras Al Khaimah': { lat: 25.67, lng: 55.74, governorate: 'RAK' },
      Marjan: { lat: 25.67, lng: 55.74, governorate: 'RAK' },
      Ajman: { lat: 25.4052, lng: 55.5136, governorate: 'Ajman' },
    },
    platforms: [
      { id: 'esupply', name: 'eSupply Dubai', url: 'https://esupply.dubai.gov.ae/', category: 'Government', desc: 'Dubai Government official e-sourcing portal' },
      { id: 'adgp', name: 'Abu Dhabi Government Procurement (ADGP)', url: 'https://www.adgp.gov.ae/', category: 'Government', desc: 'Abu Dhabi public sector capital works & interiors' },
      { id: 'tejari', name: 'Tejari UAE', url: 'https://www.tejari.com/', category: 'Enterprise', desc: 'Major UAE hospitality & commercial procurement network' },
      { id: 'aldar', name: 'Aldar Properties Procurement', url: 'https://www.aldar.com/', category: 'Developer', desc: 'Saadiyat, Yas & Abu Dhabi residential/hospitality fit-outs' },
      { id: 'emaar', name: 'Emaar Supplier Network', url: 'https://www.emaar.com/', category: 'Developer', desc: 'Dubai Hills, Creek Harbour & hospitality developments' },
    ],
  },
  QA: {
    code: 'QA',
    name: 'Qatar',
    flag: '🇶🇦',
    currency: 'QAR',
    vatPercent: 0,
    lat: 25.2854,
    lng: 51.531,
    zoom: 8,
    defaultCity: 'Doha',
    cities: {
      Doha: { lat: 25.2854, lng: 51.531, governorate: 'Ad Dawhah' },
      Lusail: { lat: 25.42, lng: 51.49, governorate: 'Al Daayen' },
      Simaisma: { lat: 25.575, lng: 51.485, governorate: 'Al Khor' },
    },
    platforms: [
      { id: 'monaqasat', name: 'Monaqasat (MoF Qatar)', url: 'https://monaqasat.mof.gov.qa/', category: 'Government', desc: 'Qatar Ministry of Finance central tenders portal' },
      { id: 'ashghal', name: 'Ashghal Public Works', url: 'https://www.ashghal.gov.qa/en/Tenders', category: 'Infrastructure & Buildings', desc: 'Schools, healthcare centers & public buildings' },
    ],
  },
  KW: {
    code: 'KW',
    name: 'Kuwait',
    flag: '🇰🇼',
    currency: 'KWD',
    vatPercent: 0,
    lat: 29.3759,
    lng: 47.9774,
    zoom: 8,
    defaultCity: 'Kuwait City',
    cities: {
      'Kuwait City': { lat: 29.3759, lng: 47.9774, governorate: 'Al Asimah' },
      Mutlaa: { lat: 29.54, lng: 47.68, governorate: 'Al Jahra' },
      'Al Jahra': { lat: 29.3375, lng: 47.6581, governorate: 'Al Jahra' },
    },
    platforms: [
      { id: 'capt', name: 'Central Agency for Public Tenders (CAPT)', url: 'https://capt.gov.kw/', category: 'Government', desc: 'Official Kuwait public building & interior tenders' },
    ],
  },
  BH: {
    code: 'BH',
    name: 'Bahrain',
    flag: '🇧🇭',
    currency: 'BHD',
    vatPercent: 10,
    lat: 26.2285,
    lng: 50.586,
    zoom: 10,
    defaultCity: 'Manama',
    cities: {
      Manama: { lat: 26.2285, lng: 50.586, governorate: 'Capital' },
      Muharraq: { lat: 26.2572, lng: 50.6119, governorate: 'Muharraq' },
      Riffa: { lat: 26.13, lng: 50.555, governorate: 'Southern' },
    },
    platforms: [
      { id: 'bahrain-tb', name: 'Bahrain Tender Board', url: 'https://www.tenderboard.gov.bh/', category: 'Government', desc: 'Official Kingdom of Bahrain e-tendering & awarded contracts' },
    ],
  },
  EG: {
    code: 'EG',
    name: 'Egypt',
    flag: '🇪🇬',
    currency: 'EGP',
    vatPercent: 14,
    lat: 30.0444,
    lng: 31.2357,
    zoom: 6,
    defaultCity: 'Cairo',
    cities: {
      Cairo: { lat: 30.0444, lng: 31.2357, governorate: 'Cairo' },
      'New Alamein': { lat: 30.835, lng: 28.955, governorate: 'Matrouh' },
      Alexandria: { lat: 31.2001, lng: 29.9187, governorate: 'Alexandria' },
    },
    platforms: [
      { id: 'egypt-etenders', name: 'Egypt Public Contracts Portal', url: 'https://etenders.gov.eg/', category: 'Government', desc: 'Governmental public contracting & New Capital tenders' },
    ],
  },
  JO: {
    code: 'JO',
    name: 'Jordan',
    flag: '🇯🇴',
    currency: 'JOD',
    vatPercent: 16,
    lat: 31.9539,
    lng: 35.9106,
    zoom: 7,
    defaultCity: 'Amman',
    cities: {
      Amman: { lat: 31.9539, lng: 35.9106, governorate: 'Amman' },
      Aqaba: { lat: 29.5321, lng: 35.0063, governorate: 'Aqaba' },
    },
    platforms: [
      { id: 'joneps', name: 'JONEPS (Jordan GTD)', url: 'https://www.joneps.gov.jo/', category: 'Government', desc: 'Jordan National Electronic Procurement System' },
    ],
  },
};

function cleanEnvStr(val) {
  return String(val || '').trim().replace(/^["']|["']$/g, '').trim();
}

function getPublishableEnv() {
  const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};
  let url = cleanEnvStr(env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL);
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  const key = cleanEnvStr(
    env.VITE_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  return { url, key };
}

let cachedClient = null;
function getBrowserSupabaseClient() {
  if (cachedClient) return cachedClient;
  const { url, key } = getPublishableEnv();
  if (!url || !key) return null;
  cachedClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

/** Return true when publishable Supabase credentials are exposed in browser env. */
export function hasDirectSupabaseScanner() {
  const { url, key } = getPublishableEnv();
  return Boolean(url && key);
}

export function resolveCountryMeta(input = 'OM') {
  const raw = String(input || 'OM').trim();
  const up = raw.toUpperCase();
  if (GCC_COUNTRIES[up]) return GCC_COUNTRIES[up];
  const low = raw.toLowerCase();
  for (const meta of Object.values(GCC_COUNTRIES)) {
    if (meta.name.toLowerCase() === low || low.includes(meta.name.toLowerCase())) return meta;
  }
  if (low === 'united arab emirates') return GCC_COUNTRIES.AE;
  if (low === 'ksa' || low.includes('saudi')) return GCC_COUNTRIES.SA;
  return GCC_COUNTRIES.OM;
}

export function normalizeScopeKey(s = '') {
  const k = String(s || '').toLowerCase().trim();
  if (k === 'fitout' || k === 'fit-out' || k === 'fit_out') return 'fitouts';
  return k;
}

export function distanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function detectCountryFromCoords(lat, lng) {
  let best = GCC_COUNTRIES.OM;
  let bestDist = Infinity;
  let bestCity = GCC_COUNTRIES.OM.defaultCity;

  for (const meta of Object.values(GCC_COUNTRIES)) {
    for (const [cityName, cityCoord] of Object.entries(meta.cities)) {
      const d = distanceKm(lat, lng, cityCoord.lat, cityCoord.lng);
      if (d < bestDist) {
        bestDist = d;
        best = meta;
        bestCity = cityName;
      }
    }
  }
  return {
    country_code: best.code,
    country_name: best.name,
    flag: best.flag,
    city: bestCity,
    distance_km: Math.round(bestDist * 10) / 10,
  };
}

function extractDeadlineFromSummary(summary = '') {
  const m = String(summary || '').match(/Bid closing\s+([\d-]{8,10})/i);
  return m ? m[1] : null;
}

export function scoreLead(row = {}, contactCount = 0) {
  const baseDbScore = Number(row.score || 0);
  const stageKey = String(row.stage || 'unknown').toLowerCase();
  const stageWeight = STAGES[stageKey]?.weight ?? 35;
  const scopes = Array.isArray(row.scopes) ? row.scopes : [];
  const topScope = row.top_scope || scopes[0] || 'fitouts';
  const scopePriority = SCOPES[normalizeScopeKey(topScope)]?.priority || 1.0;

  let heuristic = stageWeight * (0.55 + Math.min(0.45, scopePriority * 0.25));
  if (scopes.length >= 2) heuristic += 6;
  if (row.est_value_omr && Number(row.est_value_omr) > 0) heuristic += 5;
  if (contactCount > 0 || Number(row.contact_count) > 0) heuristic += 8;
  if (row.enrichment?.summary || row.enrichment?.ai_brief) heuristic += 4;
  if (row.source_name === 'Oman Tender Board' && stageKey === 'tender') heuristic += 10;

  const combined = baseDbScore > 0 ? (baseDbScore * 0.65 + Math.min(100, heuristic) * 0.35) : heuristic;
  return Math.round(Math.min(100, Math.max(5, combined)));
}

export function formatProjectRow(row = {}, contactCount = 0) {
  const countryMeta = resolveCountryMeta(row.country);
  const enrichment = (row.enrichment && typeof row.enrichment === 'object') ? row.enrichment : {};
  const scopes = Array.isArray(row.scopes) ? row.scopes.map((s) => normalizeScopeKey(s)) : [];
  const cityCoord = row.city && countryMeta.cities[row.city];
  const lat = Number.isFinite(Number(row.lat)) && row.lat !== null
    ? Number(row.lat)
    : (cityCoord ? cityCoord.lat : countryMeta.lat);
  const lon = Number.isFinite(Number(row.lon)) && row.lon !== null
    ? Number(row.lon)
    : (cityCoord ? cityCoord.lng : countryMeta.lng);

  const effectiveContacts = Math.max(0, Number(contactCount || row.contact_count || 0));
  const heatScore = scoreLead(row, effectiveContacts);
  const priority = enrichment.priority || (heatScore >= 70 ? 'high' : heatScore >= 45 ? 'medium' : 'low');

  const deadline = enrichment.deadline || extractDeadlineFromSummary(row.summary);
  const referenceNo = enrichment.reference_no
    || (String(row.ext_id || '').startsWith('tb:') ? String(row.ext_id).toUpperCase() : '');

  const rawCoreName = String(row.name || '').split(' — ')[0].trim();
  const arTitle = /[\u0600-\u06FF]/.test(rawCoreName) ? rawCoreName : '';

  return {
    ...row,
    title: row.en_name || row.name,
    ar_title: arTitle,
    lat,
    lon,
    lng: lon,
    scopes,
    top_scope: normalizeScopeKey(row.top_scope || scopes[0] || 'fitouts'),
    country_code: countryMeta.code,
    country_name: countryMeta.name,
    flag: countryMeta.flag,
    currency: countryMeta.currency,
    vat_percent: countryMeta.vatPercent,
    governorate: cityCoord?.governorate || row.location_name || '',
    main_contractor: row.contractor || '',
    heat_score: heatScore,
    priority,
    deadline,
    reference_no: referenceNo,
    sales_end: enrichment.sales_end || null,
    fee_omr: enrichment.fee_omr || null,
    bid_bond_pct: enrichment.bond_pct || null,
    tender_type: enrichment.tender_type || '',
    notes: enrichment.notes || '',
    pinned: Boolean(enrichment.pinned),
    ai_brief: enrichment.ai_brief || enrichment.summary || '',
    contact_count: effectiveContacts,
  };
}

async function fetchRawProjectsDirect() {
  const client = getBrowserSupabaseClient();
  if (!client) throw new Error('Supabase credentials are not available in browser env');
  const { data, error } = await client
    .from('scanner_projects')
    .select('*')
    .eq('is_news', false)
    .order('score', { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message || 'Supabase query failed');
  return Array.isArray(data) ? data : [];
}

async function fetchContactCountsDirect(projectIds = []) {
  const counts = new Map();
  if (!Array.isArray(projectIds) || projectIds.length === 0) return counts;
  const client = getBrowserSupabaseClient();
  if (!client) return counts;
  try {
    const { data, error } = await client
      .from('scanner_contacts')
      .select('project_id')
      .in('project_id', projectIds.slice(0, 500));
    if (!error && Array.isArray(data)) {
      for (const r of data) {
        counts.set(r.project_id, (counts.get(r.project_id) || 0) + 1);
      }
    }
  } catch {
    // non-fatal; project list still works with 0 contact count
  }
  return counts;
}

/** Query live aggregate radar KPIs directly from Supabase `scanner_projects`. */
export async function fetchScannerStatsDirect({ country = 'ALL' } = {}) {
  const raw = await fetchRawProjectsDirect();
  const targetMeta = country && country.toUpperCase() !== 'ALL' ? resolveCountryMeta(country) : null;
  const filtered = targetMeta
    ? raw.filter((p) => resolveCountryMeta(p.country).code === targetMeta.code)
    : raw;

  const countsMap = await fetchContactCountsDirect(filtered.map((p) => p.id));
  const formatted = filtered.map((p) => formatProjectRow(p, countsMap.get(p.id) || 0));

  const byCountry = {};
  const byScope = {};
  const byStage = {};
  let hotLeads = 0;
  let activeTenders = 0;
  let verifiedContacts = 0;
  let lastScanAt = null;

  for (const p of formatted) {
    byCountry[p.country_code] = (byCountry[p.country_code] || 0) + 1;
    for (const s of p.scopes) byScope[s] = (byScope[s] || 0) + 1;
    byStage[p.stage] = (byStage[p.stage] || 0) + 1;
    if (p.heat_score >= 70 || p.priority === 'high') hotLeads++;
    if (p.stage === 'tender') activeTenders++;
    verifiedContacts += p.contact_count;
    if (p.last_seen && (!lastScanAt || p.last_seen > lastScanAt)) lastScanAt = p.last_seen;
  }

  return {
    total_projects: formatted.length,
    hot_leads: hotLeads,
    active_tenders: activeTenders,
    verified_contacts: verifiedContacts,
    countries_covered: Object.keys(byCountry).length || 8,
    by_country: byCountry,
    by_scope: byScope,
    by_stage: byStage,
    last_scan_at: lastScanAt,
    storage_backend: 'supabase-direct',
  };
}

/** Query, filter, and sort leads directly from Supabase `scanner_projects`. */
export async function fetchScannerProjectsDirect({
  country = 'ALL',
  scope = '',
  stage = '',
  sort = 'heat',
  q = '',
  limit = 200,
} = {}) {
  const raw = await fetchRawProjectsDirect();
  const countsMap = await fetchContactCountsDirect(raw.map((p) => p.id));
  let items = raw.map((p) => formatProjectRow(p, countsMap.get(p.id) || 0));

  if (country && country.toUpperCase() !== 'ALL') {
    const targetCode = resolveCountryMeta(country).code;
    items = items.filter((p) => p.country_code === targetCode);
  }
  if (scope) {
    const normScope = normalizeScopeKey(scope);
    items = items.filter((p) => p.scopes.includes(normScope));
  }
  if (stage) {
    const stLow = stage.toLowerCase().trim();
    items = items.filter((p) => String(p.stage || '').toLowerCase() === stLow);
  }
  if (q) {
    const needle = q.toLowerCase().trim();
    items = items.filter((p) => {
      const hay = [
        p.name, p.en_name, p.title, p.city, p.governorate, p.country_name,
        p.client, p.contractor, p.consultant, p.summary, p.source_name,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }

  items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sort === 'value') return (Number(b.est_value_omr) || 0) - (Number(a.est_value_omr) || 0);
    if (sort === 'updated') return String(b.last_seen || b.updated_at || '').localeCompare(String(a.last_seen || a.updated_at || ''));
    if (sort === 'deadline') return String(a.deadline || '9999-99-99').localeCompare(String(b.deadline || '9999-99-99'));
    return (b.heat_score - a.heat_score) || ((b.contact_count || 0) - (a.contact_count || 0));
  });

  const maxLimit = Math.min(400, Math.max(1, Number(limit) || 200));
  return items.slice(0, maxLimit);
}

/** Query nearby leads using client-side Haversine distance against Supabase projects. */
export async function fetchNearbyProjectsDirect({ lat, lng, radiusKm = 60, country = 'ALL', scope = '' } = {}) {
  const uLat = Number(lat);
  const uLng = Number(lng);
  if (!Number.isFinite(uLat) || !Number.isFinite(uLng)) {
    throw new Error('Valid lat and lng coordinates are required');
  }
  const all = await fetchScannerProjectsDirect({ country, scope, limit: 350 });
  const r = Math.min(500, Math.max(5, Number(radiusKm) || 60));

  const nearby = all
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .map((p) => ({
      ...p,
      distance_km: Math.round(distanceKm(uLat, uLng, p.lat, p.lon) * 10) / 10,
    }))
    .filter((p) => p.distance_km <= r)
    .sort((a, b) => a.distance_km - b.distance_km);

  return {
    ok: true,
    detected: detectCountryFromCoords(uLat, uLng),
    radius_km: r,
    count: nearby.length,
    projects: nearby,
  };
}

/** Fetch full inspector detail (project + contacts + updates + portals) directly from Supabase. */
export async function fetchProjectDetailDirect(leadId) {
  const numId = Number(leadId);
  const client = getBrowserSupabaseClient();
  if (!client || !Number.isFinite(numId)) return null;

  const [{ data: proj, error }, { data: ctRows }, { data: updRows }] = await Promise.all([
    client.from('scanner_projects').select('*').eq('id', numId).maybeSingle(),
    client.from('scanner_contacts').select('*').eq('project_id', numId).order('confidence', { ascending: false }),
    client.from('scanner_updates').select('*').eq('project_id', numId).order('ts', { ascending: false }).limit(30),
  ]);
  if (error) throw new Error(error.message || 'Failed to read project detail from Supabase');
  if (!proj) return null;

  const contacts = Array.isArray(ctRows) ? ctRows : [];
  const updates = Array.isArray(updRows) ? updRows : [];
  const formatted = formatProjectRow(proj, contacts.length);
  const countryMeta = resolveCountryMeta(formatted.country);

  return {
    ...formatted,
    contacts,
    updates,
    recommended_portals: countryMeta.platforms || [],
  };
}

/** Load Top 10 leads & archived digests directly from Supabase for the Digest tab. */
export async function fetchDigestTabDirect({ country = 'ALL' } = {}) {
  const client = getBrowserSupabaseClient();
  const [top10, digestsRes] = await Promise.all([
    fetchScannerProjectsDirect({ country, sort: 'heat', limit: 10 }),
    client
      ? client.from('scanner_digests').select('*').order('created_at', { ascending: false }).limit(15)
      : Promise.resolve({ data: [] }),
  ]);

  const digests = (Array.isArray(digestsRes?.data) ? digestsRes.data : []).map((d) => ({
    ...d,
    digest_md: d.summary_text || '',
  }));

  return {
    top10,
    digests,
    config: { enabled: true, auto_enrich_top: true, webhook_url: '', schedule_note: 'On-demand & 12h observer' },
  };
}

/** Return verified GCC & Oman regional procurement portal directory metadata. */
export function getStaticRegionalCountries() {
  return Object.values(GCC_COUNTRIES).map((c) => ({
    code: c.code,
    name: c.name,
    flag: c.flag,
    currency: c.currency,
    vatPercent: c.vatPercent,
    lat: c.lat,
    lng: c.lng,
    zoom: c.zoom,
    cities: Object.entries(c.cities).map(([name, info]) => ({ name, ...info })),
    platforms: c.platforms,
  }));
}
