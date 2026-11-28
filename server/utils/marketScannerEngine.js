/**
 * Market Scanner Supabase Backend Engine (100% Node + Supabase, zero Railway/Python/SQLite).
 *
 * Powers GCC & Oman construction tender radar, live Oman Tender Board + BNC RSS scanning,
 * 12-lead chunked observer refreshes, AI lead enrichment, Top 10 Daily Digests, and
 * 1-click AI Starter BOQ generation directly inside BOQ Flow.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { supabase, supabaseAdmin } from './supabaseStorage.js';
import {
  aiKeyStorage,
  callGoogle,
  callOpenRouter,
  callNvidia,
  safeParseJSON,
} from './llmUtils.js';
import { readSettings } from '../settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SEED_SNAPSHOT_PATH = path.resolve(__dirname, '../data/market_scanner_seed.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) BOQFlowRadar/2.0';

// ── Scopes, Stages & GCC Countries Registry ─────────────────────────────────

export const SCOPES = {
  furniture: {
    id: 'furniture',
    label: 'Furniture & FF&E',
    shortLabel: 'Furniture',
    priority: 1.6,
    color: '#60a5fa',
    keywords: {
      furniture: 3, 'ff&e': 4, ffe: 3, 'loose furniture': 4, 'office furniture': 3,
      'hotel furniture': 4, joinery: 2, millwork: 2, wardrobe: 3, carpentry: 2,
      upholstery: 3, seating: 2, workstations: 3, desks: 2, casegoods: 3,
      'bespoke furniture': 4, furnishing: 2, 'furniture package': 4, curtains: 3,
      carpet: 2, blinds: 2, sofa: 2, reception: 2,
    },
  },
  residential_kitchen: {
    id: 'residential_kitchen',
    label: 'Residential Kitchen',
    shortLabel: 'Res. Kitchen',
    priority: 1.4,
    color: '#fbbf24',
    keywords: {
      'residential kitchen': 4, 'modular kitchen': 4, 'kitchen cabinets': 4,
      countertop: 2, worktop: 2, 'kitchen joinery': 3, 'villa kitchens': 4,
      'apartment kitchens': 4, 'kitchen island': 3, pantry: 2, 'home kitchen': 4,
      'fitted kitchen': 4,
    },
  },
  commercial_kitchen: {
    id: 'commercial_kitchen',
    label: 'Commercial Kitchen',
    shortLabel: 'Com. Kitchen',
    priority: 1.3,
    color: '#f97316',
    keywords: {
      'commercial kitchen': 4, 'kitchen equipment': 3, 'catering equipment': 4,
      'restaurant kitchen': 4, 'central kitchen': 4, 'cloud kitchen': 4,
      'banquet kitchen': 4, 'cold room': 2, 'food service': 2, 'hotel kitchen': 4,
      'stainless steel kitchen': 4, bakery: 2,
    },
  },
  sanitary_tiles: {
    id: 'sanitary_tiles',
    label: 'Sanitaryware & Tiles',
    shortLabel: 'Sanitary & Tiles',
    priority: 1.2,
    color: '#2dd4bf',
    keywords: {
      'sanitary ware': 4, sanitaryware: 4, tiles: 3, tiling: 3, porcelain: 3,
      'ceramic tile': 4, 'bathroom fittings': 4, washbasin: 2, marble: 2,
      sanitary: 3, 'plumbing fixtures': 3, vanity: 2,
    },
  },
  fitouts: {
    id: 'fitouts',
    label: 'Interior Fit-Outs',
    shortLabel: 'Fit-Outs',
    priority: 1.0,
    color: '#a78bfa',
    keywords: {
      'fit-out': 3, fitout: 3, 'fit out': 3, 'interior fit': 3, 'interior finishing': 2,
      partitioning: 2, 'suspended ceiling': 2, 'false ceiling': 2, shopfitting: 3,
      refurbishment: 1, 'turnkey interiors': 3, 'interior design and build': 3,
      'interior works': 3, acoustics: 2,
    },
  },
};

export const STAGES = {
  concept: { id: 'concept', label: 'Concept / Announced', weight: 45, patterns: ['concept', 'master plan', 'feasibility', 'announced', 'planned', 'proposed', 'unveil'] },
  design: { id: 'design', label: 'Design Stage', weight: 60, patterns: ['design', 'architect appoint', 'consultant appoint', 'drawing', 'masterplan'] },
  tender: { id: 'tender', label: 'Active Tender', weight: 90, patterns: ['tender', 'rfq', 'rfp', 'invitation to bid', 'bids invited', 'itb', 'solicitation', 'bidding'] },
  award: { id: 'award', label: 'Awarded', weight: 100, patterns: ['award', 'contract signed', 'appointed contractor', 'won the contract', 'wins contract'] },
  construction: { id: 'construction', label: 'Under Construction', weight: 75, patterns: ['construction', 'underway', 'under way', 'breaks ground', 'main works', 'on site'] },
  completion: { id: 'completion', label: 'Near Completion', weight: 40, patterns: ['complet', 'substantial', 'snagging', 'commissioning', 'topped out', 'fitout'] },
  handover: { id: 'handover', label: 'Handover / Operational', weight: 22, patterns: ['handover', 'handed over', 'inaugurat', 'opened', 'operational'] },
  hold: { id: 'hold', label: 'On Hold', weight: 15, patterns: ['on hold', 'suspended', 'delayed'] },
  unknown: { id: 'unknown', label: 'Tracking', weight: 35, patterns: [] },
};

export const GCC_COUNTRIES = {
  OM: {
    code: 'OM',
    name: 'Oman',
    flag: '🇴🇲',
    currency: 'OMR',
    vatPercent: 5,
    rateToOmr: 1.0,
    lat: 23.588,
    lng: 58.3829,
    zoom: 6,
    gl: 'OM',
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
      'Yiti': { lat: 23.532, lng: 58.675, governorate: 'Muscat' },
      'Al Mouj': { lat: 23.628, lng: 58.257, governorate: 'Muscat' },
      Sohar: { lat: 24.365, lng: 56.747, governorate: 'North Al Batinah' },
      Suwaiq: { lat: 23.849, lng: 57.438, governorate: 'North Al Batinah' },
      Saham: { lat: 24.172, lng: 56.889, governorate: 'North Al Batinah' },
      Shinas: { lat: 24.742, lng: 56.466, governorate: 'North Al Batinah' },
      Liwa: { lat: 24.539, lng: 56.565, governorate: 'North Al Batinah' },
      Khaburah: { lat: 23.972, lng: 57.093, governorate: 'North Al Batinah' },
      Barka: { lat: 23.683, lng: 57.883, governorate: 'South Al Batinah' },
      Khazaen: { lat: 23.645, lng: 57.840, governorate: 'South Al Batinah' },
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
    queries: [
      'Oman construction project award',
      'Oman Vision 2040 Sultan Haitham City Khazaen construction tender',
      'Oman hotel resort Omran Yiti fit-out FF&E contract',
      'Oman Ministry of Health hospital construction fit-out Al-Namaa Sumail',
      'Duqm SEZAD Sohar Freezone Oman commercial building contract',
    ],
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
    rateToOmr: 0.103,
    lat: 24.7136,
    lng: 46.6753,
    zoom: 5,
    gl: 'SA',
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
    queries: [
      'Saudi Arabia construction project award tender',
      'Riyadh Diriyah Red Sea fit-out contract',
    ],
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
    rateToOmr: 0.105,
    lat: 25.2048,
    lng: 55.2708,
    zoom: 7,
    gl: 'AE',
    defaultCity: 'Dubai',
    cities: {
      Dubai: { lat: 25.2048, lng: 55.2708, governorate: 'Dubai' },
      'Abu Dhabi': { lat: 24.4539, lng: 54.3773, governorate: 'Abu Dhabi' },
      Sharjah: { lat: 25.3463, lng: 55.4209, governorate: 'Sharjah' },
      'Ras Al Khaimah': { lat: 25.67, lng: 55.74, governorate: 'RAK' },
      Marjan: { lat: 25.67, lng: 55.74, governorate: 'RAK' },
      Ajman: { lat: 25.4052, lng: 55.5136, governorate: 'Ajman' },
    },
    queries: [
      'UAE Dubai construction project award',
      'Abu Dhabi Ras Al Khaimah resort fit-out contract',
    ],
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
    rateToOmr: 0.106,
    lat: 25.2854,
    lng: 51.531,
    zoom: 8,
    gl: 'QA',
    defaultCity: 'Doha',
    cities: {
      Doha: { lat: 25.2854, lng: 51.531, governorate: 'Ad Dawhah' },
      Lusail: { lat: 25.42, lng: 51.49, governorate: 'Al Daayen' },
      Simaisma: { lat: 25.575, lng: 51.485, governorate: 'Al Khor' },
    },
    queries: [
      'Qatar Doha Lusail construction project award',
      'Qatar resort hotel fit-out tender',
    ],
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
    rateToOmr: 1.25,
    lat: 29.3759,
    lng: 47.9774,
    zoom: 8,
    gl: 'KW',
    defaultCity: 'Kuwait City',
    cities: {
      'Kuwait City': { lat: 29.3759, lng: 47.9774, governorate: 'Al Asimah' },
      Mutlaa: { lat: 29.54, lng: 47.68, governorate: 'Al Jahra' },
      'Al Jahra': { lat: 29.3375, lng: 47.6581, governorate: 'Al Jahra' },
    },
    queries: [
      'Kuwait construction project contract award',
      'South Al Mutlaa Kuwait project tender',
    ],
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
    rateToOmr: 1.02,
    lat: 26.2285,
    lng: 50.586,
    zoom: 10,
    gl: 'BH',
    defaultCity: 'Manama',
    cities: {
      Manama: { lat: 26.2285, lng: 50.586, governorate: 'Capital' },
      Muharraq: { lat: 26.2572, lng: 50.6119, governorate: 'Muharraq' },
      Riffa: { lat: 26.13, lng: 50.555, governorate: 'Southern' },
    },
    queries: [
      'Bahrain Manama construction project tender award',
    ],
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
    rateToOmr: 0.008,
    lat: 30.0444,
    lng: 31.2357,
    zoom: 6,
    gl: 'EG',
    defaultCity: 'Cairo',
    cities: {
      Cairo: { lat: 30.0444, lng: 31.2357, governorate: 'Cairo' },
      'New Alamein': { lat: 30.835, lng: 28.955, governorate: 'Matrouh' },
      Alexandria: { lat: 31.2001, lng: 29.9187, governorate: 'Alexandria' },
    },
    queries: [
      'Egypt New Administrative Capital New Alamein construction contract',
    ],
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
    rateToOmr: 0.543,
    lat: 31.9539,
    lng: 35.9106,
    zoom: 7,
    gl: 'JO',
    defaultCity: 'Amman',
    cities: {
      Amman: { lat: 31.9539, lng: 35.9106, governorate: 'Amman' },
      Aqaba: { lat: 29.5321, lng: 35.0063, governorate: 'Aqaba' },
    },
    queries: [
      'Jordan Amman Aqaba construction project award',
    ],
    platforms: [
      { id: 'joneps', name: 'JONEPS (Jordan GTD)', url: 'https://www.joneps.gov.jo/', category: 'Government', desc: 'Jordan National Electronic Procurement System' },
    ],
  },
};

const ENTITY_AR_EN = {
  'أسياد': 'Asyad Group',
  'اسياد': 'Asyad Group',
  'وزارة الصحة': 'Ministry of Health',
  'وزارة التعليم العالي': 'Ministry of Higher Education',
  'وزارة التربية والتعليم': 'Ministry of Education',
  'وزارة التعليم': 'Ministry of Education',
  'وزارة المالية': 'Ministry of Finance',
  'وزارة الثروة الزراعية والسمكية وموارد المياه': 'Ministry of Agriculture, Fisheries & Water Resources',
  'وزارة التنمية الاجتماعية': 'Ministry of Social Development',
  'وزارة الأوقاف والشؤون الدينية': 'Ministry of Endowments & Religious Affairs',
  'وزارة العمل': 'Ministry of Labour',
  'وزارة التجارة والصناعة وترويج الاستثمار': 'Ministry of Commerce, Industry & Investment Promotion',
  'وزارة الطاقة والمعادن': 'Ministry of Energy & Minerals',
  'وزارة الاقتصاد': 'Ministry of Economy',
  'بلدية مسقط': 'Muscat Municipality',
  'بلدية ظفار': 'Dhofar Municipality',
  'بلديه ظفار': 'Dhofar Municipality',
  'وزارة الإسكان والتخطيط العمراني': 'Ministry of Housing & Urban Planning',
  'وزارة التراث والسياحة': 'Ministry of Heritage & Tourism',
  'وزارة الدفاع': 'Ministry of Defence',
  'وزارة الإعلام': 'Ministry of Information',
  'وزارة الثقافة والرياضة والشباب': 'Ministry of Culture, Sports & Youth',
  'وزارة النقل والاتصالات وتقنية المعلومات': 'Ministry of Transport, Communications & IT',
  'شرطة عمان السلطانية': 'Royal Oman Police',
  'شؤون البلاط السلطاني': 'Royal Court Affairs',
  'مطارات عمان': 'Oman Airports',
  'هيئة الطيران المدني': 'Civil Aviation Authority',
  'هيئة البيئة': 'Environment Authority',
  'هيئة تنمية المؤسسات الصغيرة والمتوسطة': 'SME Development Authority (Riyada)',
  'جامعة السلطان قابوس': 'Sultan Qaboos University',
  'جامعة التقنية والعلوم التطبيقية': 'University of Technology & Applied Sciences',
  'كلية عمان للعلوم الصحية': 'Oman College of Health Sciences',
  'المستشفى السلطاني': 'Royal Hospital',
  'مستشفى خولة': 'Khoula Hospital',
  'مستشفى النهضة': 'Al Nahdha Hospital',
  'الشركة العمانية لإدارة التنمية السياحية': 'OMRAN Group',
  'المؤسسة العامة للمناطق الصناعية': 'Madayn',
  'الهيئة العامة للمناطق الاقتصادية الخاصة والمناطق الحرة': 'OPAZ / SEZAD',
  'هيئة المشاريع والمناقصات والمحتوى المحلي': 'Projects, Tenders & Local Content Authority (Esnaad)',
  'مكتب محافظ مسقط': 'Governor of Muscat Office',
  'مكتب محافظ ظفار': 'Governor of Dhofar Office',
  'مكتب محافظ مسندم': 'Governor of Musandam Office',
  'مكتب محافظ الظاهرة': 'Governor of Al Dhahirah Office',
  'مكتب محافظ الداخلية': 'Governor of Ad Dakhiliyah Office',
  'مكتب محافظ شمال الباطنة': 'Governor of North Al Batinah Office',
  'مكتب محافظ جنوب الباطنة': 'Governor of South Al Batinah Office',
  'مكتب محافظ شمال الشرقية': 'Governor of North Ash Sharqiyah Office',
  'مكتب محافظ جنوب الشرقية': 'Governor of South Ash Sharqiyah Office',
  'مكتب محافظ البريمي': 'Governor of Al Buraimi Office',
  'مكتب محافظ الوسطى': 'Governor of Al Wusta Office',
};

export function resolveOmanEntityDisplay(entityRaw = '') {
  const trimmed = String(entityRaw || '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  if (/[A-Za-z]/.test(trimmed) && /[\u0600-\u06FF]/.test(trimmed)) return trimmed;
  for (const [ar, en] of Object.entries(ENTITY_AR_EN).sort((a, b) => b[0].length - a[0].length)) {
    if (trimmed === ar || trimmed.startsWith(ar) || trimmed.includes(ar)) {
      return `${en} (${trimmed})`;
    }
  }
  return trimmed;
}

const TITLE_GLOSSARY = [
  ['الخدمات الإستشارية لإعداد حصر نطاق أعمال صيانة مبنى', 'Consultancy & BOQ Scope Survey for Building Refurbishment'],
  ['مركز الوفاء لتاهيل الاشخاص ذوي الاعاقة', 'Al Wafa Rehabilitation Center'],
  ['الاعمال المتبقية من مناقصة صيانة مدرسة', 'Completion of School Building Renovation Works'],
  ['أعمال التهيئة والتجهيز في مشروع الواجهة البحرية لميناء السلطان قابوس', 'Site Preparation & Fit-Out Works for Port Sultan Qaboos Waterfront'],
  ['أعمال تقسيم قاعات', 'Hall Partitioning & Interior Fit-Out Works for'],
  ['مواصفات الصيانة بمدارس', 'Multi-School Building Refurbishment Works at'],
  ['أعمال صيانة بمدرسة', 'School Building Refurbishment & Maintenance Works at'],
  ['أعمال إنشاء مبنى البرنامج التحضيري ومخزن', 'Construction of Foundation Program Building & Store'],
  ['بالكلية المهنية بالسيب', 'Vocational College (Seeb)'],
  ['تطوير منتزه الثابتي', 'Al Thabiti Park Development'],
  ['تركيب بلاط متشابك', 'Supply & Installation of Interlocking Paving Tiles'],
  ['مبنى الاستراحة', 'Rest House Building'],
  ['المبنى المستأجر', 'Leased Building'],
  ['خزانة معدنية', 'Metal Storage Cabinets'],
  ['خزائن معدنية', 'Metal Storage Cabinets'],
  ['للمستشفى السلطاني', 'for Royal Hospital'],
  ['المستشفى السلطاني', 'for Royal Hospital'],
  ['لمستشفى خولة', 'for Khoula Hospital'],
  ['مستشفى خولة', 'for Khoula Hospital'],
  ['مستشفى النهضة', 'for Al Nahdha Hospital'],
  ['للمستشفى الجديد في سمائل', 'for New Samail Hospital'],
  ['للمستشفى الجديد', 'for New Hospital'],
  ['بمستشفى إبراء', 'Hospital Ibra'],
  ['بمستشفى صحار', 'Hospital Sohar'],
  ['بمستشفى نزوى', 'Hospital Nizwa'],
  ['للمؤسسات الصحية بمحافظة الظاهرة', 'for Health Facilities (Al Dhahirah)'],
  ['قطع غيار سباكة', 'Plumbing & Sanitary Fittings'],
  ['طاولة سرير المريض', 'Hospital Overbed Tables'],
  ['شراء كراسي وطاولات', 'Purchase of Chairs & Tables'],
  ['توريد وتركيب', 'Supply & Installation of'],
  ['توريد و تركيب', 'Supply & Installation of'],
  ['تركيب الجرانيت', 'Supply & Installation of Granite Stone'],
  ['أثاث مكتب', 'Supply of Office Furniture'],
  ['أثاث مكتبي', 'Office Furniture'],
  ['الأثاث الطبي', 'Medical Furniture'],
  ['أثاث فندقي', 'Hotel Furniture'],
  ['أثاث مدرسي', 'School Furniture'],
  ['عيادات خارجية', 'Outpatient Clinics'],
  ['أقسام التنويم', 'Inpatient Wards'],
  ['فصول دراسية', 'Classrooms'],
  ['غرفتي معلمين', '2 Teachers Rooms'],
  ['غرف معلمين', 'Teachers Rooms'],
  ['مختبر فيزيا', 'Physics Lab'],
  ['ومرافق أخرى', '& Ancillary Facilities'],
  ['خزائن طبية', 'Medical Cabinets'],
  ['أدوات صحية', 'Sanitary Ware'],
  ['صيانة مباني', 'Building Refurbishment & Maintenance Works'],
  ['صيانة مبنى', 'Building Refurbishment & Maintenance Works at'],
  ['سكن المدير العام', 'Senior Residence Quarters'],
  ['نيوم — مشروع ذا لاين (المرحلة الأولى والمارينا المخفية)', 'NEOM — THE LINE (Phase 1 & Hidden Marina Hospitality Fit-Outs)'],
  ['مشروع تروجينا للسياحة الجبلية — قرية التزلج والشاليهات الفندقية', 'Trojena Mountain Tourism — Ski Village & Luxury Chalet Hotels'],
  ['مشروع البحر الأحمر — منتجعات جزيرة شُورى والفنادق الشاطئية الفاخرة', 'Red Sea Project — Shura Island Luxury Beach Resorts & Hotels'],
  ['هيئة تطوير بوابة الدرعية — المخطط التراثي والفنادق العالمية الفاخرة', 'Diriyah Gate Development — Heritage District & Luxury Hotels'],
  ['روشن — مجتمع سدرة السكني شمال الرياض', 'ROSHN — Sedra Residential Community North Riyadh'],
  ['نخلة جبل علي — الفلل الشاطئية الفاخرة والمجمعات الفندقية', 'Palm Jebel Ali — Luxury Beachfront Villas & Hospitality Resorts'],
  ['إعمار — برج خور دبي والمنطقة التجارية بمرفأ الخور', 'Emaar — Dubai Creek Tower & Creek Harbour Commercial District'],
  ['منتجع وين جزيرة المرجان المتكامل — رأس الخيمة', 'Wynn Al Marjan Island Integrated Luxury Resort — Ras Al Khaimah'],
  ['أبراج لوسيل بلازا — التجهيزات الداخلية للأبراج الحكومية والتجارية', 'Lusail Plaza Towers — Government & Commercial Interior Fit-Outs'],
  ['مشروع سميسمة السياحي والمنتجعات الساحلية الفاخرة', 'Simaisma Coastal Tourism & Luxury Beachfront Resorts'],
  ['مدينة جنوب المطلاع السكنية — المجمع التجاري والمباني الخدمية', 'South Al Mutlaa Residential City — Commercial Mall & Civic Buildings'],
  ['مطار الكويت الدولي — مبنى الركاب الجديد (T2) والتجهيزات الفندقية', 'Kuwait International Airport — Terminal T2 & Hospitality Fit-Outs'],
  ['مشروع بلاج الجزائر السياحي — الفنادق الشاطئية والمحلات التجارية', 'Bilaj Al Jazayer Waterfront — Beachfront Hotels & Retail'],
  ['مشروع مترو البحرين — المرحلة الأولى ومحطات الركاب المركزية', 'Bahrain Metro Phase 1 & Central Passenger Terminal Stations'],
  ['العاصمة الإدارية الجديدة — منطقة الأعمال المركزية والبرج الأيقوني', 'New Administrative Capital — CBD & Iconic Tower Fit-Outs'],
  ['مدينة العلمين الجديدة — أبراج الداون تاون والمنتجعات الساحلية الفاخرة', 'New Alamein City — Downtown Towers & Coastal Luxury Resorts'],
  ['بوليفارد العبدلي عمان — المرحلة الثانية والأبراج الفندقية والتجارية', 'Abdali Boulevard Amman — Phase 2 Hospitality & Commercial Towers'],
  ['مشروع مرسى زايد ومنتجعات خليج العقبة السياحية — الأردن', 'Marsa Zayed & Aqaba Gulf Luxury Tourism Resorts — Jordan'],
  ['مدينة القدية الترفيهية — حلبة السرعة ومنتزه الألعاب المائية أكواريبيا', 'Qiddiya City — Speed Park & Aquarabia Resort Developments'],
  ['وسط جدة — دار الأوبرا والمتحف المائي ومجمع الفنادق المارينا', 'Jeddah Central — Opera House, Oceanarium & Marina Hotels'],
  ['مدينة الجادة الشارقة — البوليفارد التجاري والأبراج السكنية مدار', 'Aljada Sharjah — Commercial Boulevard, Madar & Residential Towers'],
  ['بدء الأعمال الإنشائية في 3 أحياء بمدينة السلطان هيثم', 'Construction Begins Across 3 Residential Districts in Sultan Haitham City'],
  ['مدينة السلطان هيثم.. مشروع عُمان العملاق ومستقبل التنمية الحضرية', 'Sultan Haitham City — Oman Flagship Urban Development Masterplan'],
  ['بمدينة السلطان هيثم', 'in Sultan Haitham City'],
  ['مدينة السلطان هيثم', 'Sultan Haitham City'],
  ['لإنشاء فندق جديد في نزوى', 'New Hotel Construction Tender in Nizwa'],
  ['بالخوض', 'Al Khoud'],
  ['للمكتبة التابعة لمركز رعية الطفولة وبيوت الشباب بالخوض', 'for Al Khoud Library, Childcare Center & Youth Hostel'],
  ['التجهيزات الطبية المنفصلة', 'Standalone Specialized Equipment & Fit-Out'],
  ['لبلدية ظفار', 'for Dhofar Municipality'],
  ['في ولاية مطرح', 'Muttrah'],
  ['في ولاية سدح', 'Sadah'],
  ['بولاية البريمي', 'Buraimi'],
  ['بولاية سمائل', 'Samail'],
  ['بولاية هيما', 'Haima'],
  ['بالسويق', 'Suwaiq'],
  ['توريد', 'Supply of'],
  ['شراء', 'Purchase of'],
  ['توفير', 'Supply of'],
  ['تركيب', 'Installation of'],
  ['تأثيث', 'Furnishing of'],
  ['إضافة', 'Extension & Construction of'],
  ['صيانة', 'Refurbishment & Maintenance of'],
  ['تأهيل', 'Rehabilitation of'],
  ['إدارة البيئة', 'Environment Authority Building'],
  ['أثاث', 'Furniture'],
  ['مفروشات', 'Furnishings'],
  ['ستائر', 'Curtains'],
  ['سجاد', 'Carpets'],
  ['وطاولات', '& Tables'],
  ['طاولات', 'Tables'],
  ['طاولة', 'Tables'],
  ['سرير', 'Beds'],
  ['كراسي', 'Chairs'],
  ['دولاب', 'Cabinets'],
  ['خزائن', 'Cabinets'],
  ['جرانيت', 'Granite Stone'],
  ['بلاط', 'Tiles'],
  ['رخام', 'Marble'],
  ['سيراميك', 'Ceramic Tiles'],
  ['بورسلين', 'Porcelain Tiles'],
  ['سباكة', 'Plumbing & Sanitary'],
  ['معدات مطابخ', 'Kitchen Equipment'],
  ['معدات', 'Equipment'],
  ['مطبخ', 'Kitchen'],
  ['مكاتب', 'Offices'],
  ['عيادات', 'Clinics'],
  ['مختبرات', 'Laboratories'],
  ['قاعات', 'Halls'],
  ['واجهة', 'Facade'],
  ['أرضيات', 'Flooring'],
  ['أسقف', 'Ceilings'],
  ['قواطع', 'Partitions'],
  ['تشطيب', 'Finishing Works'],
  ['ديكور', 'Interior Decoration'],
  ['إنشاء', 'Construction of'],
  ['تجهيز', 'Fit-out Works for'],
  ['أعمال', 'Works'],
  ['مستشفى', 'Hospital'],
  ['المركز الصحي', 'Health Center'],
  ['جامعة', 'University'],
  ['مدرسة', 'School'],
  ['فندق', 'Hotel'],
  ['مبنى', 'Building'],
  ['إبراء', 'Ibra'],
  ['صلالة', 'Salalah'],
  ['صحار', 'Sohar'],
  ['نزوى', 'Nizwa'],
  ['الدقم', 'Duqm'],
  ['صور', 'Sur'],
  ['خصب', 'Khasab'],
  ['الرستاق', 'Rustaq'],
  ['السويق', 'Suwaiq'],
  ['سمائل', 'Samail'],
  ['المضيبي', 'Mudhaibi'],
  ['هيما', 'Haima'],
  ['سدح', 'Sadah'],
  ['عبري', 'Ibri'],
  ['البريمي', 'Buraimi'],
  ['أدم', 'Adam'],
  ['صحم', 'Saham'],
  ['مسندم', 'Musandam'],
  ['الوسطى', 'Al Wusta'],
  ['الظاهرة', 'Al Dhahirah'],
  ['الداخلية', 'Ad Dakhiliyah'],
  ['شمال الشرقية', 'North Ash Sharqiyah'],
  ['جنوب الشرقية', 'South Ash Sharqiyah'],
  ['شمال الباطنة', 'North Al Batinah'],
  ['جنوب الباطنة', 'South Al Batinah'],
];

const SCOPE_HINTS_AR = {
  furniture: ['أثاث', 'أثاث مكتب', 'أثاث مكتبي', 'مفروشات', 'سجاد', 'ستائر', 'مكاتب خشب', 'خزائن', 'خزانة', 'خزانة معدنية', 'خزائن معدنية', 'دولاب', 'تأثيث', 'كنبات', 'مقاعد', 'كراسي', 'طاولات', 'طاولة', 'سرير', 'نجارة', 'أثاث طبي', 'الأثاث الطبي'],
  sanitary_tiles: ['أدوات صحية', 'مواد صحية', 'تمديدات صحية', 'أطقم حمامات', 'سباكة', 'بلاط', 'رخام', 'جرانيت', 'الجرانيت', 'سيراميك', 'بورسلين', 'مغاسل', 'دورات مياه', 'حمامات'],
  commercial_kitchen: ['مطعم', 'مطبخ تجاري', 'معدات مطابخ', 'كافيتريا', 'مطابخ', 'مطبخ مركزي'],
  residential_kitchen: ['مطبخ سكني', 'مطبخ منزلي', 'مطابخ الوحدات', 'مطبخ شقة'],
  fitouts: ['تشطيب', 'ديكور', 'تقسيم قاعات', 'أقسام', 'قواطع', 'جبس', 'أسقف', 'أرضيات', 'دهان', 'ترميم', 'تجهيز', 'أعمال داخلية', 'صيانة مباني', 'صيانة مبنى', 'صيانة مدرسة', 'صيانة مدارس', 'فصول دراسية', 'تأهيل مبنى', 'الأعمال الإنشائية'],
};

const OMAN_NOISE_AR_RX = /(?:استكرات|ملصقات|خراطيم\s+الحريق|طفايات\s+الحريق|مواد\s+مختبرية|مواد\s+مختبريه|مواد\s+الجراحية|المواد\s+الجراحيه|مواد\s+غير\s+الطبية|معدات\s+طبية|جهاز\s+الاسنان|جهاز\s+قياس|جهاز\s+فحص|جهاز\s+تقطير|منظار|فحص\s+السمع|العلاج\s+الضوئي|العلاج\s+الطبيعي|الموشرات\s+الحيويه|العلامات\s+الحيوية|نبض\s+الجنين|المحرك\s+الكهربائي|أرتريكس|لجهاز\s+الحفر|خدمات\s+النظافة|اعمال\s+تنظيف|تنظيف\s+مبنى|مكافحة\s+الحشرات|شفط\s+مياه|سحب\s+مياه|الصرف\s+الصحي|باقة\s+ورد|حفلات\s+التخرج|طباعة\s+وتوريد[^\n]*ملف|طباعة\s+اللوحات\s+التعريفية|النقل\s+العام|قطع\s+غيار\s+التكييف|قطع\s+غيار\s+لمستشفى|وحدات\s+التكييف\s+والتبريد|عقد\s+التكييف|التوصيلات\s+الكهربائية\s+وتمديدات\s+المياه|انترلوك[^\n]*سوق\s+الأسماك|سياج\s+حديدي|بطاريات|أدوية|لقاحات|مبيدات|أعلاف|وقود|ديزل|سيارات\s+إسعاف|مركبات|شبكة\s+أنابيب\s+غاز)/i;

const GLOBAL_NOISE_EN_RX = /\b(?:desalination|wastewater\s+(?:plant|treatment)|sewage\s+(?:plant|infrastructure|treatment)|water\s+conveyance|water\s+pipeline|oil\s+pipeline|gas\s+pipeline|gas\s+compression|petrochemical\s+plant|lng\s+(?:plant|terminal|project)|artificial\s+lift|exploration\s+blocks|ppas?\s+for\s+\d+\s*mw|power\s+projects|hafeet\s+rail|substation|transmission\s+line|overhead\s+line|wind\s+farm|solar\s+pv|oilfield|drilling\s+rig|refinery\s+unit|fire\s+hose|fire\s+extinguisher|batter(?:y|ies)|pharmaceutical|vaccine|pesticide|threatens\s+to\s+bomb|addresses\s+concerns|ev\s+enters|not\s+a\s+construction\s+project)\b/i;

export function isScannerNoiseText(text = '') {
  const s = String(text || '');
  return OMAN_NOISE_AR_RX.test(s) || GLOBAL_NOISE_EN_RX.test(s);
}

export const OMAN_FITOUT_CONSTRUCTION_RX = /(?:أثاث|تأثيث|مفروشات|كراسي|طاولات|خزانة|خزائن|دولاب|ستائر|سجاد|تشطيب|ديكور|قواطع|تقسيم\s+قاعات|جرانيت|الجرانيت|رخام|بلاط|سيراميك|بورسلين|أدوات\s+صحية|معدات\s+مطابخ|مطبخ|صيانة\s+(?:مبنى|مباني|مدرسة|مدارس|الاستراحة)|تأهيل\s+مبنى|فصول\s+دراسية|إنشاء\s+(?:مبنى|فصول|مركز|مستشفى|فندق|مدرسة)|توسعة|مدينة\s+السلطان\s+هيثم|خزائن\s+الاقتصادية|\bfit-?out\b|\binterior\b|\bfurniture\b|\bff&e\b|\bjoinery\b|\bkitchen\b|\bsanitary\b|\btil(?:e|ing)\b|\bhotel\b|\bresort\b|\bmall\b|\boffice\s+tower\b|\bcommercial\s+building\b|\brefurbishment\b|\bsultan\s+haitham\b|\byiti\b|\bkhazaen\b|\bomran\b)/i;

const OMAN_BILINGUAL_LOCATIONS = [
  ['مدينة السلطان هيثم', 'Sultan Haitham City', 'Muscat', 23.655, 58.145],
  ['sultan haitham', 'Sultan Haitham City', 'Muscat', 23.655, 58.145],
  ['الخوير', 'Al Khuwair', 'Muscat', 23.598, 58.435],
  ['السيب', 'Seeb', 'Muscat', 23.67, 58.19],
  ['بوشر', 'Bawshar', 'Muscat', 23.575, 58.405],
  ['مطرح', 'Muttrah', 'Muscat', 23.62, 58.55],
  ['العامرات', 'Amerat', 'Muscat', 23.52, 58.49],
  ['قريات', 'Quriyat', 'Muscat', 23.264, 58.918],
  ['يتي', 'Yiti', 'Muscat', 23.532, 58.675],
  ['الموج', 'Al Mouj', 'Muscat', 23.628, 58.257],
  ['مدينة خزائن', 'Khazaen', 'South Al Batinah', 23.645, 57.840],
  ['خزائن الاقتصادية', 'Khazaen', 'South Al Batinah', 23.645, 57.840],
  ['khazaen', 'Khazaen', 'South Al Batinah', 23.645, 57.840],
  ['بركاء', 'Barka', 'South Al Batinah', 23.683, 57.883],
  ['الرستاق', 'Rustaq', 'South Al Batinah', 23.39, 57.42],
  ['نخل', 'Nakhal', 'South Al Batinah', 23.392, 57.829],
  ['المصنعة', 'Musannah', 'South Al Batinah', 23.758, 57.646],
  ['صحار', 'Sohar', 'North Al Batinah', 24.365, 56.747],
  ['السويق', 'Suwaiq', 'North Al Batinah', 23.849, 57.438],
  ['صحم', 'Saham', 'North Al Batinah', 24.172, 56.889],
  ['شناص', 'Shinas', 'North Al Batinah', 24.742, 56.466],
  ['لوى', 'Liwa', 'North Al Batinah', 24.539, 56.565],
  ['الخابورة', 'Khaburah', 'North Al Batinah', 23.972, 57.093],
  ['صلالة', 'Salalah', 'Dhofar', 17.015, 54.092],
  ['سدح', 'Sadah', 'Dhofar', 17.049, 55.069],
  ['مرباط', 'Mirbat', 'Dhofar', 16.991, 54.691],
  ['طاقة', 'Taqah', 'Dhofar', 17.04, 54.398],
  ['ثمريت', 'Thumrait', 'Dhofar', 17.674, 54.022],
  ['ظفار', 'Salalah', 'Dhofar', 17.015, 54.092],
  ['إبراء', 'Ibra', 'North Ash Sharqiyah', 22.691, 58.533],
  ['المضيبي', 'Mudhaibi', 'North Ash Sharqiyah', 22.567, 58.121],
  ['سناو', 'Sinaw', 'North Ash Sharqiyah', 22.495, 58.027],
  ['بدية', 'Bidiyah', 'North Ash Sharqiyah', 22.449, 58.803],
  ['جعلان', 'Jaalan Bani Bu Ali', 'South Ash Sharqiyah', 22.017, 59.324],
  ['صور', 'Sur', 'South Ash Sharqiyah', 22.567, 59.529],
  ['مصيرة', 'Masirah', 'South Ash Sharqiyah', 20.662, 58.882],
  ['نزوى', 'Nizwa', 'Ad Dakhiliyah', 22.933, 57.533],
  ['سمائل', 'Samail', 'Ad Dakhiliyah', 23.304, 57.95],
  ['الجبل الأخضر', 'Jabal Akhdar', 'Ad Dakhiliyah', 23.074, 57.661],
  ['بهلاء', 'Bahla', 'Ad Dakhiliyah', 22.964, 57.3],
  ['أدم', 'Adam', 'Ad Dakhiliyah', 22.379, 57.527],
  ['إزكي', 'Izki', 'Ad Dakhiliyah', 22.933, 57.767],
  ['منح', 'Manah', 'Ad Dakhiliyah', 22.8, 57.6],
  ['بدبد', 'Bidbid', 'Ad Dakhiliyah', 23.409, 58.126],
  ['الدقم', 'Duqm', 'Al Wusta', 19.697, 57.695],
  ['محوت', 'Mahout', 'Al Wusta', 20.43, 58.18],
  ['هيما', 'Haima', 'Al Wusta', 19.956, 56.279],
  ['عبري', 'Ibri', 'Ad Dhahirah', 23.226, 56.509],
  ['ينقل', 'Yanqul', 'Ad Dhahirah', 23.588, 56.549],
  ['ضنك', 'Dhank', 'Ad Dhahirah', 23.549, 56.262],
  ['البريمي', 'Buraimi', 'Al Buraimi', 24.251, 55.793],
  ['محضة', 'Mahadha', 'Al Buraimi', 24.407, 55.978],
  ['خصب', 'Khasab', 'Musandam', 26.18, 56.248],
  ['مسندم', 'Khasab', 'Musandam', 26.18, 56.248],
  ['دبا', 'Dibba', 'Musandam', 25.62, 56.261],
  ['بخاء', 'Bukha', 'Musandam', 26.143, 56.152],
  ['مدحاء', 'Madha', 'Musandam', 25.284, 56.332],
  ['مسقط', 'Muscat', 'Muscat', 23.588, 58.408],
];

export function resolveOmanLocation(text = '') {
  const str = String(text || '');
  const low = str.toLowerCase();
  for (const [needle, city, governorate, lat, lng] of OMAN_BILINGUAL_LOCATIONS) {
    if (str.includes(needle) || low.includes(needle)) {
      return { city, governorate, lat, lng };
    }
  }
  for (const [cityName, info] of Object.entries(GCC_COUNTRIES.OM.cities)) {
    if (low.includes(cityName.toLowerCase())) {
      return { city: cityName, governorate: info.governorate, lat: info.lat, lng: info.lng };
    }
  }
  return { city: 'Muscat', governorate: 'Muscat', lat: 23.588, lng: 58.408 };
}

const STAGE_ORDER = ['unknown', 'concept', 'design', 'tender', 'award', 'construction', 'completion', 'handover'];

// ── Seed Fallback Cache ─────────────────────────────────────────────────────

let seedSnapshotCache = null;
function loadSeedSnapshot() {
  if (seedSnapshotCache) return seedSnapshotCache;
  try {
    if (fs.existsSync(SEED_SNAPSHOT_PATH)) {
      seedSnapshotCache = JSON.parse(fs.readFileSync(SEED_SNAPSHOT_PATH, 'utf8'));
      return seedSnapshotCache;
    }
  } catch (err) {
    console.warn('[MarketScanner] Failed loading seed snapshot:', err.message);
  }
  seedSnapshotCache = { projects: [], contacts: [], updates: [], scan_runs: [], digests: [] };
  return seedSnapshotCache;
}

function getDbClient() {
  return supabaseAdmin || supabase || null;
}

// ── Pure Geo, Classification & Scoring Utilities ────────────────────────────

export function resolveCountryMeta(input = 'OM') {
  const raw = String(input || 'OM').trim();
  const up = raw.toUpperCase();
  if (GCC_COUNTRIES[up]) return GCC_COUNTRIES[up];
  const low = raw.toLowerCase();
  for (const meta of Object.values(GCC_COUNTRIES)) {
    if (meta.name.toLowerCase() === low || low.includes(meta.name.toLowerCase())) {
      return meta;
    }
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
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

export function classifyScopesAndFitout(text = '', { fallbackToFitouts = true } = {}) {
  const raw = String(text || '');
  const low = ` ${raw.toLowerCase()} `;
  const strengths = {};
  for (const [scopeKey, meta] of Object.entries(SCOPES)) {
    let score = 0;
    for (const [kw, weight] of Object.entries(meta.keywords)) {
      const rx = new RegExp(kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      const hits = low.match(rx);
      if (hits) score += weight * Math.min(hits.length, 3);
    }
    const arHits = SCOPE_HINTS_AR[scopeKey] || [];
    for (const arKw of arHits) {
      if (raw.includes(arKw)) score += 3;
    }
    if (score > 0) strengths[scopeKey] = score;
  }
  const matchedCount = Object.keys(strengths).length;
  const maxS = Math.max(0, ...Object.values(strengths)) || 1;
  const normalized = {};
  for (const [k, v] of Object.entries(strengths)) normalized[k] = v / maxS;
  const scopes = Object.entries(normalized)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
  return {
    scopes: scopes.length > 0 ? scopes : (fallbackToFitouts ? ['fitouts'] : []),
    strengths: normalized,
    top_scope: scopes[0] || (fallbackToFitouts ? 'fitouts' : null),
    matchedCount,
  };
}

export function detectStage(text = '') {
  const low = String(text || '').toLowerCase();
  const order = ['concept', 'design', 'tender', 'award', 'construction', 'completion', 'handover'];
  for (let i = order.length - 1; i >= 0; i--) {
    const st = order[i];
    if (STAGES[st].patterns.some((p) => low.includes(p))) return st;
  }
  return 'unknown';
}

function detectValueFromText(text = '', defaultRate = 1.0, defaultCurrency = 'OMR') {
  const m = text.match(/(?:(OMR|RO|USD|\$|AED|SAR|QAR|KWD|BHD|EGP|JOD)\s?([\d,.]+)\s?(billion|bn|million|mn|m\b)?)/i)
    || text.match(/([\d,.]+)\s?(billion|bn|million|mn|m\b)\s?(OMR|RO|USD|AED|SAR|QAR|KWD|BHD|EGP|JOD)?/i);
  if (!m) return { valueOmr: null, note: null };
  const rawNum = parseFloat((m[2] && /[\d.]/.test(m[2]) ? m[2] : m[1]).replace(/,/g, ''));
  if (!Number.isFinite(rawNum) || rawNum <= 0) return { valueOmr: null, note: null };
  const mult = (m[3] || m[2] || '').toLowerCase();
  const scaled = mult.startsWith('b') ? rawNum * 1000 : rawNum;
  const cur = (m[1] && !/[\d.]/.test(m[1]) ? m[1] : (m[3] && !/million|mn|bn|billion/i.test(m[3]) ? m[3] : defaultCurrency)).toLowerCase();
  const rates = {
    omr: 1.0, ro: 1.0, usd: 0.385, '$': 0.385, aed: 0.105, sar: 0.103, qar: 0.106, kwd: 1.25, bhd: 1.02, egp: 0.008, jod: 0.543,
  };
  const rate = rates[cur] ?? defaultRate;
  return { valueOmr: Math.round(scaled * rate * 100) / 100, note: m[0].trim() };
}

function extractEnglishEntityName(entityDisplay = '') {
  const s = String(entityDisplay || '').trim();
  if (!s) return '';
  const m = s.match(/^([A-Za-z][^()]+?)\s*\(/);
  if (m) return m[1].trim();
  const resolved = resolveOmanEntityDisplay(s);
  const m2 = resolved.match(/^([A-Za-z][^()]+?)\s*\(/);
  if (m2) return m2[1].trim();
  return /[A-Za-z]/.test(s) ? s.replace(/[\u0600-\u06FF()]+/g, '').trim() : '';
}

export function translateArabicTitle(arText = '', entityDisplay = '') {
  const full = String(arText || '').trim();
  const hasFullGccPhrase = /[\u0600-\u06FF]/.test(full);
  if (!full) return extractEnglishEntityName(entityDisplay) || arText;
  if (!hasFullGccPhrase) return full.split(' — ')[0].trim();

  // First test full composite string against full mega-project phrases before splitting ' — '
  for (const [ar, en] of [...TITLE_GLOSSARY].sort((a, b) => b[0].length - a[0].length)) {
    if (ar.includes('—') && full.includes(ar)) {
      return en.slice(0, 160);
    }
  }

  const rawCore = full.split(' — ')[0].trim();
  let out = rawCore.replace(/عدد\s*(\d+)/g, ' ($1 Units) ');
  for (const [ar, en] of [...TITLE_GLOSSARY].sort((a, b) => b[0].length - a[0].length)) {
    out = out.split(ar).join(` ${en} `);
  }
  out = out
    .replace(/[\u0600-\u06FF]+/g, ' ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = out.split(' ').filter((w, i, arr) => i === 0 || w.toLowerCase() !== arr[i - 1].toLowerCase());
  out = tokens.join(' ')
    .replace(/^[\s.,;:\-/&—]+|[\s.,;:\-/&—]+$/g, '')
    .replace(/^(?:and|of|for|at)\s+/i, '')
    .replace(/\s+(?:of|for|at|and)$/i, '')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();

  const enEntity = extractEnglishEntityName(entityDisplay);
  if (!out || !/[A-Za-z]/.test(out)) {
    return enEntity ? `Tender Package — ${enEntity}` : rawCore;
  }
  if (out.length < 32 && enEntity && !out.toLowerCase().includes(enEntity.toLowerCase())) {
    return `${out} — ${enEntity}`.slice(0, 160);
  }
  return out.slice(0, 160);
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
  const scopes = Array.isArray(row.scopes)
    ? row.scopes.map((s) => normalizeScopeKey(s))
    : [];
  const cityCoord = row.city && countryMeta.cities[row.city];
  const lat = Number.isFinite(Number(row.lat)) && row.lat !== null
    ? Number(row.lat)
    : (cityCoord ? cityCoord.lat : countryMeta.lat);
  const lon = Number.isFinite(Number(row.lon)) && row.lon !== null
    ? Number(row.lon)
    : (cityCoord ? cityCoord.lng : countryMeta.lng);

  const effectiveContacts = Math.max(0, Number(contactCount || row.contact_count || 0));
  const heatScore = scoreLead(row, effectiveContacts);
  const priority = enrichment.priority
    || (heatScore >= 70 ? 'high' : heatScore >= 45 ? 'medium' : 'low');

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

// ── LLM Helper (Uses active BOQ Flow settings or env Google key) ────────────

async function callScannerLLM(systemPrompt, userPrompt) {
  const store = aiKeyStorage.getStore() || {};
  const saved = readSettings();
  const hasGoogle = Boolean(
    store.googleApiKey
    || store.googleFreeKey
    || saved.googleApiKey
    || saved.googleFreeKey
    || process.env.GOOGLE_API_KEY
    || process.env.GOOGLE_FREE_KEY
  );
  const hasOpenRouter = Boolean(store.openrouterApiKey || saved.openrouterApiKey);
  const hasNvidia = Boolean(store.nvidiaApiKey || saved.nvidiaApiKey);

  const execCall = async () => {
    const provider = (store.aiProvider || saved.engine || 'google').toLowerCase();
    if (provider === 'openrouter' && hasOpenRouter) {
      return await callOpenRouter(systemPrompt, userPrompt);
    }
    if (provider === 'nvidia' && hasNvidia) {
      return await callNvidia(systemPrompt, userPrompt);
    }
    if (hasGoogle) {
      return await callGoogle(systemPrompt, userPrompt, false, null, 'market_scanner');
    }
    return '';
  };

  if (!hasGoogle && !hasOpenRouter && !hasNvidia) return null;

  try {
    let raw = '';
    if (!store.googleApiKey && !store.googleFreeKey && !store.openrouterApiKey && !store.nvidiaApiKey) {
      // Seed AsyncLocalStorage from env/saved keys when called in background or unauthenticated test
      raw = await aiKeyStorage.run({
        googleApiKey: process.env.GOOGLE_API_KEY || saved.googleApiKey || '',
        googleFreeKey: process.env.GOOGLE_FREE_KEY || saved.googleFreeKey || '',
        activeTier: saved.activeTier || (process.env.GOOGLE_FREE_KEY ? 'free' : 'billed'),
        googleModel: saved.googleModel || 'gemini-2.5-flash-lite',
        aiProvider: saved.engine || 'google',
      }, execCall);
    } else {
      raw = await execCall();
    }
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    if (typeof raw === 'string') return safeParseJSON(raw);
    return null;
  } catch (err) {
    console.warn('[MarketScanner LLM] Fallback triggered:', err.message);
    return null;
  }
}

// ── HTTP Fetch Helper with AbortController ──────────────────────────────────

async function fetchWithTimeout(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml,text/xml,*/*',
      },
    });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

function extractContactsFromText(text = '', source = 'cross-reference') {
  const out = [];
  const emails = Array.from(new Set(String(text).match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []));
  for (const em of emails.slice(0, 4)) {
    if (/example\.com|noreply|sentry|schema\.org/i.test(em)) continue;
    const name = em.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    out.push({
      contact_key: `em:${em.toLowerCase()}`,
      name,
      role: 'Procurement / Contact',
      email: em,
      source,
      confidence: 0.82,
    });
  }
  const phones = Array.from(new Set(String(text).match(/(?:\+(?:968|966|971|974|965|973|20|962)[\s-]?)?\d{4}[\s-]?\d{4}(?:[\s-]?\d{3})?/g) || []));
  for (const ph of phones.slice(0, 3)) {
    const digits = ph.replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 15) {
      out.push({
        contact_key: `ph:${digits}`,
        name: 'Project Office Line',
        role: 'Office Contact',
        phone: ph.trim(),
        source,
        confidence: 0.55,
      });
    }
  }
  return out;
}

// ── Opportunistic Non-Blocking 12h Observer Check (Replaces Vercel Sub-Daily Cron) ─

let observerKickoffInFlight = false;
async function maybeRunOpportunisticObserver() {
  if (observerKickoffInFlight) return;
  const db = getDbClient();
  if (!db) return;

  observerKickoffInFlight = true;
  try {
    const { data: cfg } = await db
      .from('scanner_config')
      .select('value')
      .eq('key', 'observer_state')
      .maybeSingle();
    const lastRun = cfg?.value?.last_run_at ? new Date(cfg.value.last_run_at).getTime() : 0;
    const twelveHoursMs = 12 * 60 * 60 * 1000;
    if (Date.now() - lastRun < twelveHoursMs) return;

    await db.from('scanner_config').upsert({
      key: 'observer_state',
      value: { last_run_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });

    // Trigger lightweight background check without blocking stats response
    runObserverCycle({ limit: 8 }).catch((err) => {
      console.warn('[MarketScanner Observer] Background check error:', err.message);
    });
  } catch {
    // non-fatal
  } finally {
    observerKickoffInFlight = false;
  }
}

// ── Core Database Reads ─────────────────────────────────────────────────────

async function fetchContactCountsMap(projectIds = []) {
  const counts = new Map();
  if (!Array.isArray(projectIds) || projectIds.length === 0) return counts;
  const db = getDbClient();
  if (db) {
    try {
      const { data, error } = await db
        .from('scanner_contacts')
        .select('project_id')
        .in('project_id', projectIds.slice(0, 500));
      if (!error && Array.isArray(data)) {
        for (const r of data) {
          counts.set(r.project_id, (counts.get(r.project_id) || 0) + 1);
        }
        return counts;
      }
    } catch { /* fallback below */ }
  }
  const snap = loadSeedSnapshot();
  for (const c of snap.contacts || []) {
    counts.set(c.project_id, (counts.get(c.project_id) || 0) + 1);
  }
  return counts;
}

async function fetchRawProjects({ includeNews = false } = {}) {
  const db = getDbClient();
  if (db) {
    try {
      let query = db.from('scanner_projects').select('*');
      if (!includeNews) {
        query = query.eq('is_news', false);
      }
      const { data, error } = await query
        .order('score', { ascending: false })
        .limit(500);
      if (!error && Array.isArray(data) && data.length > 0) {
        return data;
      }
    } catch (err) {
      console.warn('[MarketScanner] Supabase read error, using snapshot fallback:', err.message);
    }
  }
  const snap = loadSeedSnapshot();
  return (snap.projects || []).filter((p) => (includeNews ? true : !p.is_news));
}

export async function getStats({ country = 'ALL' } = {}) {
  maybeRunOpportunisticObserver().catch(() => {});
  const raw = await fetchRawProjects({ includeNews: false });
  const targetMeta = country && country.toUpperCase() !== 'ALL' ? resolveCountryMeta(country) : null;
  const filtered = targetMeta
    ? raw.filter((p) => resolveCountryMeta(p.country).code === targetMeta.code)
    : raw;

  const countsMap = await fetchContactCountsMap(filtered.map((p) => p.id));
  const formatted = filtered.map((p) => formatProjectRow(p, countsMap.get(p.id) || 0));

  const byCountry = {};
  const byScope = {};
  const byStage = {};
  let hotLeads = 0;
  let activeTenders = 0;
  let verifiedContacts = 0;
  let lastScanAt = null;

  for (const p of formatted) {
    const code = p.country_code;
    byCountry[code] = (byCountry[code] || 0) + 1;
    for (const s of p.scopes) {
      byScope[s] = (byScope[s] || 0) + 1;
    }
    byStage[p.stage] = (byStage[p.stage] || 0) + 1;
    if (p.heat_score >= 70 || p.priority === 'high') hotLeads++;
    if (p.stage === 'tender') activeTenders++;
    verifiedContacts += p.contact_count;
    if (p.last_seen && (!lastScanAt || p.last_seen > lastScanAt)) {
      lastScanAt = p.last_seen;
    }
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
    storage_backend: getDbClient() ? 'supabase' : 'snapshot',
  };
}

export async function listProjects({
  country = 'ALL',
  scope = '',
  city = '',
  stage = '',
  priority = '',
  q = '',
  includeNews = false,
  sort = 'heat',
  limit = 200,
} = {}) {
  const raw = await fetchRawProjects({ includeNews: Boolean(includeNews) });
  const countsMap = await fetchContactCountsMap(raw.map((p) => p.id));
  let items = raw.map((p) => formatProjectRow(p, countsMap.get(p.id) || 0));

  if (country && country.toUpperCase() !== 'ALL') {
    const targetCode = resolveCountryMeta(country).code;
    items = items.filter((p) => p.country_code === targetCode);
  }
  if (scope) {
    const normScope = normalizeScopeKey(scope);
    items = items.filter((p) => p.scopes.includes(normScope));
  }
  if (city) {
    const cLow = city.toLowerCase().trim();
    items = items.filter((p) => String(p.city || '').toLowerCase().includes(cLow));
  }
  if (stage) {
    const stLow = stage.toLowerCase().trim();
    items = items.filter((p) => String(p.stage || '').toLowerCase() === stLow);
  }
  if (priority) {
    const prLow = priority.toLowerCase().trim();
    items = items.filter((p) => String(p.priority || '').toLowerCase() === prLow);
  }
  if (q) {
    const needle = q.toLowerCase().trim();
    items = items.filter((p) => {
      const hay = [
        p.name, p.en_name, p.title, p.city, p.country_name,
        p.client, p.contractor, p.consultant, p.summary, p.source_name,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }

  items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sort === 'value') {
      return (Number(b.est_value_omr) || 0) - (Number(a.est_value_omr) || 0);
    }
    if (sort === 'updated') {
      return String(b.last_seen || b.updated_at || '').localeCompare(String(a.last_seen || a.updated_at || ''));
    }
    if (sort === 'deadline') {
      return String(a.deadline || '9999-99-99').localeCompare(String(b.deadline || '9999-99-99'));
    }
    return (b.heat_score - a.heat_score) || ((b.contact_count || 0) - (a.contact_count || 0));
  });

  const maxLimit = Math.min(400, Math.max(1, Number(limit) || 200));
  return items.slice(0, maxLimit);
}

export async function getNearbyProjects({ lat, lng, radiusKm = 60, country = 'ALL', scope = '' } = {}) {
  const uLat = Number(lat);
  const uLng = Number(lng);
  if (!Number.isFinite(uLat) || !Number.isFinite(uLng)) {
    throw new Error('Valid lat and lng coordinates are required');
  }
  const all = await listProjects({ country, scope, limit: 350 });
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
    detected: detectCountryFromCoords(uLat, uLng),
    radius_km: r,
    count: nearby.length,
    projects: nearby,
  };
}

export async function getProjectDetail(id) {
  const numId = Number(id);
  const db = getDbClient();
  let projectRow = null;
  let contacts = [];
  let updates = [];

  if (db) {
    try {
      const [{ data: proj }, { data: ctRows }, { data: updRows }] = await Promise.all([
        db.from('scanner_projects').select('*').eq('id', numId).maybeSingle(),
        db.from('scanner_contacts').select('*').eq('project_id', numId).order('confidence', { ascending: false }),
        db.from('scanner_updates').select('*').eq('project_id', numId).order('ts', { ascending: false }).limit(30),
      ]);
      projectRow = proj;
      contacts = ctRows || [];
      updates = updRows || [];
    } catch (err) {
      console.warn('[MarketScanner Detail] Supabase error:', err.message);
    }
  }

  if (!projectRow) {
    const snap = loadSeedSnapshot();
    projectRow = (snap.projects || []).find((p) => Number(p.id) === numId) || null;
    if (projectRow) {
      contacts = (snap.contacts || []).filter((c) => Number(c.project_id) === numId);
      updates = (snap.updates || []).filter((u) => Number(u.project_id) === numId).slice(0, 30);
    }
  }

  if (!projectRow) return null;

  const formatted = formatProjectRow(projectRow, contacts.length);
  const countryMeta = resolveCountryMeta(formatted.country);

  return {
    ...formatted,
    contacts,
    updates,
    recommended_portals: countryMeta.platforms || [],
  };
}

export async function patchProject(id, patch = {}) {
  const numId = Number(id);
  const existing = await getProjectDetail(numId);
  if (!existing) return null;

  const nowIso = new Date().toISOString();
  const nextEnrichment = { ...(existing.enrichment || {}) };
  if (patch.priority !== undefined) nextEnrichment.priority = String(patch.priority);
  if (patch.notes !== undefined) nextEnrichment.notes = String(patch.notes);
  if (patch.pinned !== undefined) nextEnrichment.pinned = Boolean(patch.pinned);
  if (patch.deadline !== undefined) nextEnrichment.deadline = patch.deadline || null;

  const updateFields = { updated_at: nowIso, enrichment: nextEnrichment };
  if (patch.stage && STAGES[String(patch.stage).toLowerCase()]) {
    updateFields.stage = String(patch.stage).toLowerCase();
  }
  if (patch.boq_status && ['new', 'estimating', 'quoted', 'submitted'].includes(patch.boq_status)) {
    updateFields.boq_status = patch.boq_status;
  }
  if (patch.client !== undefined) updateFields.client = patch.client || null;
  if (patch.contractor !== undefined || patch.main_contractor !== undefined) {
    updateFields.contractor = (patch.main_contractor ?? patch.contractor) || null;
  }
  if (patch.consultant !== undefined) updateFields.consultant = patch.consultant || null;
  if (patch.est_value_omr !== undefined) {
    const v = Number(patch.est_value_omr);
    updateFields.est_value_omr = Number.isFinite(v) ? v : null;
  }

  const db = getDbClient();
  if (db) {
    await db.from('scanner_projects').update(updateFields).eq('id', numId);
    const auditNotes = [];
    if (updateFields.stage && updateFields.stage !== existing.stage) {
      auditNotes.push({ field: 'stage', old_value: existing.stage, new_value: updateFields.stage, note: 'Stage updated in BOQ Flow' });
    }
    if (updateFields.boq_status && updateFields.boq_status !== existing.boq_status) {
      auditNotes.push({ field: 'boq_status', old_value: existing.boq_status, new_value: updateFields.boq_status, note: `BOQ workflow marked ${updateFields.boq_status}` });
    }
    for (const audit of auditNotes) {
      await db.from('scanner_updates').insert({
        project_id: numId,
        ts: nowIso,
        kind: 'manual',
        ...audit,
      });
    }
  }

  return await getProjectDetail(numId);
}

export async function addProjectContact(projectId, contact = {}) {
  const numId = Number(projectId);
  const existing = await getProjectDetail(numId);
  if (!existing) return null;

  const email = String(contact.email || '').trim() || null;
  const phone = String(contact.phone || '').trim() || null;
  const website = String(contact.website || '').trim() || null;
  const name = String(contact.person_name || contact.name || '').trim() || 'Procurement Contact';
  const role = String(contact.role || '').trim() || 'Stakeholder';
  const org = String(contact.company || contact.org || '').trim() || existing.client || null;

  const digits = (phone || '').replace(/\D/g, '');
  const contactKey = email
    ? `em:${email.toLowerCase()}`
    : (digits.length >= 6 ? `ph:${digits}` : `nm:${name.toLowerCase()}|${role.toLowerCase()}`);

  const row = {
    project_id: numId,
    contact_key: contactKey.slice(0, 180),
    name,
    role,
    org,
    email,
    phone,
    website,
    source: 'User added in BOQ Flow',
    confidence: 0.95,
  };

  const db = getDbClient();
  if (db) {
    await db.from('scanner_contacts').upsert(row, { onConflict: 'project_id,contact_key' });
    await db.from('scanner_updates').insert({
      project_id: numId,
      ts: new Date().toISOString(),
      kind: 'contact',
      field: 'contact',
      new_value: `${name} (${role})`,
      note: 'Added verified contact in BOQ Flow',
    });
  }

  return await getProjectDetail(numId);
}

export async function getNews({ country = 'ALL', q = '', limit = 40 } = {}) {
  const raw = await fetchRawProjects({ includeNews: true });
  let news = raw.filter((p) => p.is_news);
  if (country && country.toUpperCase() !== 'ALL') {
    const code = resolveCountryMeta(country).code;
    news = news.filter((p) => resolveCountryMeta(p.country).code === code);
  }
  if (q) {
    const low = q.toLowerCase().trim();
    news = news.filter((p) => `${p.name || ''} ${p.summary || ''}`.toLowerCase().includes(low));
  }
  news.sort((a, b) => String(b.last_seen || '').localeCompare(String(a.last_seen || '')));
  return news.slice(0, Math.min(100, Number(limit) || 40)).map((r) => formatProjectRow(r, 0));
}

// ── Live Cloud Scanning (Esnaad + Oman Portals + GCC BNC RSS) ────────────────

async function scanOmanTenderBoard(maxPages = 4) {
  const base = 'https://etendering.tenderboard.gov.om/product/publicDash';
  const found = [];

  for (const viewFlag of ['NewTenders', 'AwardedTenders']) {
    const pageLimit = viewFlag === 'AwardedTenders' ? Math.min(2, maxPages) : maxPages;
    for (let page = 1; page <= pageLimit; page++) {
      const html = await fetchWithTimeout(`${base}?viewFlag=${viewFlag}${page > 1 ? `&pageNo=${page}` : ''}`, 10000);
      if (!html || !html.includes('<tr')) break;

      const $ = cheerio.load(html);
      let pageRows = 0;

      $('tr').each((_, tr) => {
        const tds = $(tr).find('td').map((__, td) => $(td).text().replace(/\s+/g, ' ').trim()).get();
        if (tds.length < 7 || !/^\d+\.$/.test(tds[0])) return;
        pageRows++;

        const tndId = tds[1] || '';
        const hiddenVal = $(tr).find('input[name*="tendDesc"]').attr('value');
        const fullDesc = (hiddenVal || tds[2] || '').trim();
        const entityAr = tds[3] || '';
        const catAr = (tds[4] || '').split('[')[0].trim();
        const typeAr = (tds[5] || '').split('[')[0].trim();
        const datesRaw = tds[6] || '';
        const salesMatch = datesRaw.match(/Sales EndDate:\s*([\d-]+)/i);
        const closeMatch = datesRaw.match(/Bid Closing Date:\s*([\d-]+)/i);
        const fee = (tds[7] && tds[7] !== 'N/A') ? tds[7] : null;
        const bond = (tds[8] && tds[8] !== 'N/A') ? tds[8] : null;

        const combinedText = `${fullDesc} ${catAr}`;
        if (isScannerNoiseText(combinedText)) return;

        const classified = classifyScopesAndFitout(combinedText, { fallbackToFitouts: false });
        const hasBuildingFitout = OMAN_FITOUT_CONSTRUCTION_RX.test(combinedText);
        if (classified.matchedCount === 0 && !hasBuildingFitout) return;

        const scopes = classified.scopes.length > 0 ? classified.scopes : ['fitouts'];
        const topScope = classified.top_scope || 'fitouts';

        const entityDisplay = resolveOmanEntityDisplay(entityAr);

        const loc = resolveOmanLocation(`${fullDesc} ${entityAr}`);
        const nitMatch = $(tr).html()?.match(/getNit\('(\d+)'\)/);
        const hash = crypto.createHash('sha1').update(tndId || fullDesc).digest('hex').slice(0, 12);
        const stage = viewFlag === 'AwardedTenders' ? 'award' : 'tender';
        const enName = translateArabicTitle(fullDesc, entityDisplay);
        const tenderType = typeAr.includes('صغيرة') ? 'SME (Riyada)' : (typeAr.includes('عالمية') ? 'International' : 'Public Tender');

        const summaryParts = [
          `[Oman Esnaad · ${tenderType}]`,
          catAr || '',
          closeMatch ? `Bid closing ${closeMatch[1]}` : '',
          salesMatch ? `Sales end ${salesMatch[1]}` : '',
          fee ? `Fee ${fee} OMR` : '',
        ].filter(Boolean);

        found.push({
          ext_id: `tb:${hash}`,
          name: `${fullDesc} — ${entityDisplay}`.slice(0, 160),
          en_name: enName.slice(0, 160),
          country: 'Oman',
          city: loc.city,
          lat: loc.lat,
          lon: loc.lng,
          location_name: `${loc.city}, ${loc.governorate}`,
          scopes,
          top_scope: topScope,
          stage,
          client: entityDisplay,
          summary: summaryParts.join(' · ').slice(0, 500),
          source_name: 'Oman Tender Board',
          source_url: `${base}?${nitMatch ? `tenderId=${nitMatch[1]}&` : ''}viewFlag=${viewFlag}`,
          score: classified.matchedCount > 0 ? 88 : 76,
          status: 'active',
          is_news: false,
          enrichment: {
            reference_no: tndId || `TB:${hash.toUpperCase()}`,
            deadline: closeMatch ? closeMatch[1] : null,
            sales_end: salesMatch ? salesMatch[1] : null,
            fee_omr: fee,
            bond_pct: bond,
            tender_type: tenderType,
            governorate: loc.governorate,
          },
        });
      });

      if (pageRows === 0) break;
    }
  }

  return found;
}

const OMAN_DIRECT_FEEDS = [
  { name: 'Khazaen Economic City', url: 'https://khazaen.om/feed/', forceCity: 'Khazaen' },
  { name: 'Times of Oman', url: 'https://timesofoman.com/feed' },
  { name: 'Oman Observer', url: 'https://www.omanobserver.om/rssFeed/home' },
  {
    name: 'Oman Tenders AR',
    url: 'https://news.google.com/rss/search?q=%D9%85%D9%86%D8%A7%D9%82%D8%B5%D8%A9+%D8%B3%D9%84%D8%B7%D9%86%D8%A9+%D8%B9%D9%85%D8%A7%D9%86+%D8%AA%D8%A3%D8%AB%D9%8A%D8%AB+OR+%D8%AA%D8%B4%D8%B7%D9%8A%D8%A8%D8%A7%D8%AA+OR+%D9%85%D8%B3%D8%AA%D8%B4%D9%81%D9%89+OR+%D9%81%D9%86%D8%AF%D9%82&hl=ar&gl=OM&ceid=OM:ar',
  },
  {
    name: 'Oman Vision 2040 Projects AR',
    url: 'https://news.google.com/rss/search?q=%D9%85%D8%AF%D9%8A%D9%86%D8%A9+%D8%A7%D9%84%D8%B3%D9%84%D8%B7%D8%A7%D9%86+%D9%87%D9%8A%D8%AB%D9%85+OR+%D8%A7%D9%84%D8%AF%D9%82%D9%85+OR+%D8%B9%D9%85%D8%B1%D8%A7%D9%86+OR+%D8%AE%D8%B2%D8%A7%D8%A6%D9%86+%D9%85%D8%B4%D8%B1%D9%88%D8%B9+%D8%B9%D9%82%D8%AF&hl=ar&gl=OM&ceid=OM:ar',
  },
];

async function scanDirectOmanFeeds() {
  const omCfg = GCC_COUNTRIES.OM;
  const tasks = OMAN_DIRECT_FEEDS.map(async (feed) => {
    const xml = await fetchWithTimeout(feed.url, 8500);
    if (!xml || !xml.includes('<item>')) return [];
    const $ = cheerio.load(xml, { xmlMode: true });
    const items = [];

    $('item').slice(0, 12).each((_, el) => {
      const rawTitle = $(el).find('title').text().trim();
      const link = $(el).find('link').text().trim();
      const descRaw = $(el).find('description').text().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!rawTitle || !link) return;

      const cleanTitle = rawTitle.replace(/\s*[-–—|]\s*(The Times of Oman|Times of Oman|Oman Observer|Zawya|Reuters).*$/i, '').trim() || rawTitle;
      const combined = `${cleanTitle} ${descRaw}`;
      if (isScannerNoiseText(combined)) return;

      const classified = classifyScopesAndFitout(combined, { fallbackToFitouts: false });
      const isConstructionRelevant = OMAN_FITOUT_CONSTRUCTION_RX.test(combined);
      if (classified.matchedCount === 0 && !isConstructionRelevant) return;

      const scopes = classified.scopes.length > 0 ? classified.scopes : ['fitouts'];
      const topScope = classified.top_scope || 'fitouts';
      const stage = detectStage(combined);
      const { valueOmr, note } = detectValueFromText(combined, omCfg.rateToOmr, omCfg.currency);
      const loc = feed.forceCity ? resolveOmanLocation(feed.forceCity) : resolveOmanLocation(combined);
      const hasArabic = /[\u0600-\u06FF]/.test(cleanTitle);
      const enTitle = hasArabic ? translateArabicTitle(cleanTitle, feed.name) : cleanTitle;
      const keyHash = crypto.createHash('sha1').update(`OM:${cleanTitle.toLowerCase()}`).digest('hex').slice(0, 14);

      items.push({
        ext_id: `omfeed:${keyHash}`,
        name: cleanTitle.slice(0, 160),
        en_name: enTitle.slice(0, 160),
        country: 'Oman',
        city: loc.city,
        lat: loc.lat,
        lon: loc.lng,
        location_name: `${loc.city}, ${loc.governorate}`,
        scopes,
        top_scope: topScope,
        stage: stage === 'unknown' ? 'concept' : stage,
        est_value_omr: valueOmr,
        value_note: note,
        summary: `[${feed.name}] ${descRaw || cleanTitle}`.slice(0, 500),
        source_name: feed.name,
        source_url: link,
        score: Math.max(72, scoreLead({ scopes, top_scope: topScope, stage, est_value_omr: valueOmr }, 0)),
        status: 'active',
        is_news: false,
      });
    });

    return items;
  });

  const settled = await Promise.allSettled(tasks);
  const projects = [];
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

async function scanGoogleNewsRss(country = 'ALL') {
  const metas = country && country.toUpperCase() !== 'ALL'
    ? [resolveCountryMeta(country)]
    : Object.values(GCC_COUNTRIES);

  const tasks = [];
  for (const cfg of metas) {
    const queryCap = cfg.code === 'OM' ? 4 : 2;
    for (const q of cfg.queries.slice(0, queryCap)) {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en&gl=${cfg.gl}&ceid=${cfg.gl}:en`;
      tasks.push((async () => {
        const xml = await fetchWithTimeout(url, 8000);
        if (!xml || !xml.includes('<item>')) return [];
        const $ = cheerio.load(xml, { xmlMode: true });
        const list = [];

        $('item').slice(0, 4).each((_, el) => {
          const rawTitle = $(el).find('title').text().trim();
          const link = $(el).find('link').text().trim();
          if (!rawTitle || !link) return;
          const cleanTitle = rawTitle.replace(/\s*[-–—|]\s*(The Times of Oman|Oman Observer|Zawya|Reuters|Construction Week|Gulf News|TradeArabia|Arabian Business|Arab News|Khaleej Times|The National).*$/i, '').trim() || rawTitle;
          if (isScannerNoiseText(cleanTitle)) return;

          const classifiedStrict = classifyScopesAndFitout(cleanTitle, { fallbackToFitouts: false });
          const isRelevantBuilding = OMAN_FITOUT_CONSTRUCTION_RX.test(cleanTitle)
            || /\b(?:hotel|resort|mall|palace|tower|hospital|campus|mixed-use|luxury residences|serviced apartments|fit-out|interior|furniture|ff&e)\b/i.test(cleanTitle);
          if (classifiedStrict.matchedCount === 0 && !isRelevantBuilding) return;

          const classified = classifiedStrict.matchedCount > 0 ? classifiedStrict : classifyScopesAndFitout(cleanTitle);
          const stage = detectStage(cleanTitle);
          const { valueOmr, note } = detectValueFromText(cleanTitle, cfg.rateToOmr, cfg.currency);

          let city = cfg.defaultCity;
          let lat = cfg.lat;
          let lon = cfg.lng;
          let gov = '';
          if (cfg.code === 'OM') {
            const omLoc = resolveOmanLocation(cleanTitle);
            city = omLoc.city;
            lat = omLoc.lat;
            lon = omLoc.lng;
            gov = omLoc.governorate;
          } else {
            const low = cleanTitle.toLowerCase();
            for (const [cityName, cityObj] of Object.entries(cfg.cities)) {
              if (low.includes(cityName.toLowerCase())) {
                city = cityName;
                lat = cityObj.lat;
                lon = cityObj.lng;
                gov = cityObj.governorate || '';
                break;
              }
            }
          }

          const keyHash = crypto.createHash('sha1').update(`${cfg.name}:${cleanTitle.toLowerCase()}`).digest('hex').slice(0, 14);
          list.push({
            ext_id: `bnc:${cfg.code.toLowerCase()}_${keyHash}`,
            name: cleanTitle.slice(0, 160),
            en_name: cleanTitle.slice(0, 160),
            country: cfg.name,
            city,
            lat,
            lon,
            location_name: gov ? `${city}, ${gov}` : `${city}, ${cfg.name}`,
            scopes: classified.scopes,
            top_scope: classified.top_scope,
            stage,
            est_value_omr: valueOmr,
            value_note: note,
            summary: `[GCC Regional Intelligence] ${cleanTitle}`.slice(0, 500),
            source_name: 'BNC Network',
            source_url: link,
            score: Math.max(70, scoreLead({ scopes: classified.scopes, top_scope: classified.top_scope, stage, est_value_omr: valueOmr }, 0)),
            status: 'active',
            is_news: false,
          });
        });

        return list;
      })());
    }
  }

  const settled = await Promise.allSettled(tasks);
  const projects = [];
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

export async function polishShortArabicTitlesWithLLM(items = []) {
  const candidates = items
    .filter((p) => /[\u0600-\u06FF]/.test(String(p.name || '')) && (!p.en_name || String(p.en_name).length < 28))
    .slice(0, 18);
  if (candidates.length === 0) return items;

  const promptLines = candidates.map((c) => `${c.ext_id}: ${c.name}`).join('\n');
  const llmRes = await callScannerLLM(
    'Translate each Arabic GCC/Oman construction or FF&E tender line into a concise, complete English procurement title (7-16 words). Return strictly JSON { "titles": { "<ext_id>": "<English title>" } }.',
    promptLines,
  );
  const map = llmRes?.titles && typeof llmRes.titles === 'object' ? llmRes.titles : null;
  if (!map) return items;

  return items.map((item) => {
    const improved = map[item.ext_id];
    if (improved && typeof improved === 'string' && improved.trim().length > (item.en_name?.length || 0)) {
      return { ...item, en_name: improved.trim().slice(0, 160) };
    }
    return item;
  });
}

export async function runLiveScan({ mode = 'standard', country = 'ALL' } = {}) {
  const t0 = Date.now();
  const db = getDbClient();
  const startedAt = new Date().toISOString();
  let runId = null;

  if (db) {
    const { data: runRow } = await db
      .from('scanner_runs')
      .insert({ started_at: startedAt, mode })
      .select('id')
      .single();
    runId = runRow?.id || null;
  }

  const wantsOman = !country || country.toUpperCase() === 'ALL' || resolveCountryMeta(country).code === 'OM';
  const [tbLeads, omanFeedsRes, rssRes] = await Promise.all([
    wantsOman ? scanOmanTenderBoard(mode === 'deep' ? 6 : 4) : Promise.resolve([]),
    wantsOman ? scanDirectOmanFeeds() : Promise.resolve({ projects: [], ok: 0, fail: 0 }),
    scanGoogleNewsRss(country),
  ]);

  const rawDeduped = Array.from(
    new Map([...tbLeads, ...omanFeedsRes.projects, ...rssRes.projects].map((p) => [String(p.ext_id), p])).values(),
  );
  const deduped = await polishShortArabicTitlesWithLLM(rawDeduped);
  let inserted = 0;
  let updated = 0;

  if (db && deduped.length > 0) {
    const extIds = deduped.map((p) => p.ext_id);
    const { data: existingRows } = await db.from('scanner_projects').select('id, ext_id').in('ext_id', extIds);
    const existingSet = new Set((existingRows || []).map((r) => r.ext_id));

    const nowIso = new Date().toISOString();
    const payload = deduped.map((p) => ({ ...p, last_seen: nowIso, updated_at: nowIso }));
    for (let i = 0; i < payload.length; i += 40) {
      await db.from('scanner_projects').upsert(payload.slice(i, i + 40), { onConflict: 'ext_id' });
    }
    for (const p of deduped) {
      if (existingSet.has(p.ext_id)) updated++;
      else inserted++;
    }
  }

  const okCount = rssRes.ok + omanFeedsRes.ok + (tbLeads.length > 0 ? 1 : 0);
  const failCount = rssRes.fail + omanFeedsRes.fail;
  if (db && runId) {
    await db.from('scanner_runs').update({
      finished_at: new Date().toISOString(),
      sources_ok: okCount,
      sources_failed: failCount,
      findings: deduped.length,
      new_projects: inserted,
      updated,
      log: `Live scan(${mode}, ${country}): findings=${deduped.length}, new=${inserted}, updated=${updated}, tb=${tbLeads.length}, omanFeeds=${omanFeedsRes.projects.length}`,
    }).eq('id', runId);
  }

  return {
    ok: true,
    run_id: runId,
    country,
    discovered: deduped.length,
    inserted,
    updated,
    esnaad_count: tbLeads.length,
    oman_feeds_count: omanFeedsRes.projects.length,
    sources_ok: okCount,
    sources_failed: failCount,
    durationMs: Date.now() - t0,
  };
}

export async function runObserverCycle({ limit = 12 } = {}) {
  const db = getDbClient();
  if (!db) return { ok: true, checked: 0, changes: 0 };

  const cap = Math.min(20, Math.max(1, Number(limit) || 12));
  const { data: projs } = await db
    .from('scanner_projects')
    .select('*')
    .eq('status', 'active')
    .eq('is_news', false)
    .order('last_checked', { ascending: true, nullsFirst: true })
    .limit(cap);

  let checked = 0;
  let changes = 0;
  const nowIso = new Date().toISOString();

  await Promise.allSettled((projs || []).map(async (p) => {
    checked++;
    if (p.source_url?.startsWith('http')) {
      const html = await fetchWithTimeout(p.source_url, 6000);
      if (html) {
        const $ = cheerio.load(html);
        const txt = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 6000);
        const detected = detectStage(txt);
        const curIdx = STAGE_ORDER.indexOf(p.stage || 'unknown');
        const newIdx = STAGE_ORDER.indexOf(detected);
        if (detected !== 'unknown' && newIdx > curIdx) {
          changes++;
          await db.from('scanner_projects').update({ stage: detected, updated_at: nowIso }).eq('id', p.id);
          await db.from('scanner_updates').insert({
            project_id: p.id,
            ts: nowIso,
            kind: 'change',
            field: 'stage',
            old_value: p.stage,
            new_value: detected,
            note: 'Observer detected stage transition from live portal',
          });
        }
        for (const c of extractContactsFromText(txt, 'observer')) {
          await db.from('scanner_contacts').upsert({ project_id: p.id, ...c }, { onConflict: 'project_id,contact_key' });
        }
      }
    }
    await db.from('scanner_projects').update({
      last_checked: nowIso,
      check_count: Number(p.check_count || 0) + 1,
    }).eq('id', p.id);
  }));

  return { ok: true, checked, changes };
}

export async function enrichLead(id) {
  const detail = await getProjectDetail(id);
  if (!detail) return null;

  const title = detail.title || detail.name;
  const cleanQuery = `${title.split(/[-|—]/)[0].trim().split(/\s+/).slice(0, 7).join(' ')} ${detail.country_name || 'Oman'} construction project`;

  const [rssXml, ddgHtml, pageHtml] = await Promise.all([
    fetchWithTimeout(`https://news.google.com/rss/search?q=${encodeURIComponent(cleanQuery)}&hl=en`, 7500),
    fetchWithTimeout(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`, 7500),
    detail.source_url?.startsWith('http') ? fetchWithTimeout(detail.source_url, 7500) : Promise.resolve(''),
  ]);

  const snippets = [];
  if (rssXml) {
    const $rss = cheerio.load(rssXml, { xmlMode: true });
    $rss('item title').each((_, el) => snippets.push($rss(el).text().trim()));
  }
  if (ddgHtml) {
    const $ddg = cheerio.load(ddgHtml);
    $ddg('.result__snippet').each((_, el) => snippets.push($ddg(el).text().trim()));
  }
  if (pageHtml) {
    const $p = cheerio.load(pageHtml);
    snippets.push($p('body').text().replace(/\s+/g, ' ').trim().slice(0, 3500));
  }

  const corpus = `${title}. ${detail.summary || ''}. ${snippets.join(' ')}`.slice(0, 10000);
  const discoveredContacts = extractContactsFromText(corpus, 'ai-enrichment');

  const db = getDbClient();
  if (db) {
    for (const c of discoveredContacts) {
      await db.from('scanner_contacts').upsert({ project_id: detail.id, ...c }, { onConflict: 'project_id,contact_key' });
    }
  }

  const aiResult = await callScannerLLM(
    'You are a GCC & Oman construction FF&E and Fit-Out procurement intelligence analyst. Return strictly JSON with keys: ai_brief (2-3 sharp commercial sentences explaining FF&E / kitchen / sanitary / fit-out supply opportunity), client (string|null), contractor (string|null), consultant (string|null), est_value_omr (number|null).',
    `Project: ${title}\nCountry: ${detail.country_name}\nCity: ${detail.city || ''}\nScopes: ${(detail.scopes || []).join(', ')}\nExisting Client: ${detail.client || ''}\nExisting Contractor: ${detail.contractor || ''}\nSummary: ${detail.summary || ''}\nEvidence:\n${snippets.slice(0, 8).join('\n')}`,
  );

  const fallbackBrief = `${title} is an active ${STAGES[detail.stage]?.label || detail.stage} opportunity in ${detail.city || detail.country_name}, presenting commercial supply potential across ${(detail.scopes || ['fitouts']).map((s) => SCOPES[s]?.label || s).join(', ')}.${detail.client ? ` Procured by ${detail.client}.` : ''}`;

  const nowIso = new Date().toISOString();
  const nextEnrichment = {
    ...(detail.enrichment || {}),
    summary: aiResult?.ai_brief || detail.enrichment?.summary || fallbackBrief,
    ai_brief: aiResult?.ai_brief || detail.enrichment?.ai_brief || fallbackBrief,
    snippets_count: snippets.length,
    updated_via: aiResult ? 'boqflow-ai' : 'deterministic-crossref',
  };

  if (db) {
    await db.from('scanner_projects').update({
      client: detail.client || aiResult?.client || null,
      contractor: detail.contractor || aiResult?.contractor || null,
      consultant: detail.consultant || aiResult?.consultant || null,
      est_value_omr: detail.est_value_omr || (Number.isFinite(Number(aiResult?.est_value_omr)) ? Number(aiResult.est_value_omr) : null),
      enrichment: nextEnrichment,
      enriched_at: nowIso,
      updated_at: nowIso,
    }).eq('id', detail.id);

    await db.from('scanner_updates').insert({
      project_id: detail.id,
      ts: nowIso,
      kind: 'enrich',
      field: 'enrichment',
      new_value: aiResult ? 'AI Executive Brief' : 'Web Cross-Reference',
      note: `Enriched with ${snippets.length} live signals & ${discoveredContacts.length} contact candidates`,
    });
  }

  return await getProjectDetail(detail.id);
}

export async function enrichBatch({ limit = 6, country = 'ALL' } = {}) {
  const leads = await listProjects({ country, sort: 'heat', limit: Math.min(12, Math.max(1, Number(limit) || 6)) });
  const unenriched = leads.filter((l) => !l.enriched_at).slice(0, Number(limit) || 6);
  const targets = unenriched.length > 0 ? unenriched : leads.slice(0, 3);
  const results = await Promise.allSettled(targets.map((l) => enrichLead(l.id)));
  const okCount = results.filter((r) => r.status === 'fulfilled' && r.value).length;
  return { ok: true, enriched: okCount, attempted: targets.length };
}

// ── Top 10 Daily Digest & Config ────────────────────────────────────────────

export async function getTop10Leads({ country = 'ALL' } = {}) {
  const leads = await listProjects({ country, sort: 'heat', limit: 25 });
  return leads.slice(0, 10);
}

export async function buildTop10Digest({ country = 'ALL', autoEnrich = false, notify = false } = {}) {
  if (autoEnrich) {
    await enrichBatch({ limit: 3, country }).catch(() => {});
  }
  const top10 = await getTop10Leads({ country });
  const dateStr = new Date().toISOString().slice(0, 10);
  const lines = [
    `# Top ${top10.length} GCC & Oman Construction Leads (${dateStr})`,
    '',
    ...top10.map((p, idx) => {
      const scopesTxt = (p.scopes || []).map((s) => SCOPES[s]?.shortLabel || s).join(', ');
      const valTxt = p.value_note || (p.est_value_omr ? `${p.est_value_omr}M OMR` : 'Est. TBD');
      return `${idx + 1}. **${p.flag} [${p.heat_score}/100] ${p.title}** — ${p.city || p.country_name} · ${STAGES[p.stage]?.label || p.stage} · ${scopesTxt} · Value: ${valTxt}`;
    }),
  ];
  const digestMd = lines.join('\n');

  const cfg = await getDigestConfig();
  let dispatched = false;
  if (notify && cfg?.webhook_url && /^https?:\/\//i.test(cfg.webhook_url)) {
    try {
      const res = await fetch(cfg.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: digestMd, content: digestMd }),
      });
      dispatched = res.ok;
    } catch { /* ignore webhook failure */ }
  }

  let savedRow = null;
  const db = getDbClient();
  if (db) {
    const { data } = await db.from('scanner_digests').insert({
      title: `Top 10 Construction Leads — ${dateStr}${country !== 'ALL' ? ` (${country})` : ''}`,
      leads_count: top10.length,
      leads_json: top10,
      summary_text: digestMd,
      recipient: cfg?.webhook_url ? 'Webhook' : 'BOQ Flow Dashboard',
      dispatched,
    }).select().single();
    savedRow = data;
  }

  return {
    ok: true,
    top10,
    digest: {
      ...(savedRow || {}),
      digest_md: digestMd,
      summary_text: digestMd,
      leads_json: top10,
      dispatched,
    },
  };
}

export async function getDigests(limit = 15) {
  const db = getDbClient();
  if (db) {
    const { data, error } = await db
      .from('scanner_digests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (!error && Array.isArray(data)) {
      return data.map(toPublicDigestRow);
    }
  }
  const snap = loadSeedSnapshot();
  return (snap.digests || []).slice(0, limit).map(toPublicDigestRow);
}

/**
 * Digest row as sent to the browser. Older rows store the address a digest was mailed to;
 * the scanner API has no login, so only the channel ("Email") is passed on, never the address.
 */
export function toPublicDigestRow(d = {}) {
  const recipient = String(d.recipient || '');
  return {
    ...d,
    recipient: recipient.includes('@') ? 'Email' : recipient,
    digest_md: d.summary_text || '',
  };
}

export async function getDigestConfig() {
  const db = getDbClient();
  if (db) {
    try {
      const { data } = await db.from('scanner_config').select('value').eq('key', 'digest').maybeSingle();
      if (data?.value) return data.value;
    } catch { /* ignore */ }
  }
  return { enabled: true, auto_enrich_top: true, webhook_url: '', schedule_note: 'On-demand & 12h observer' };
}

/**
 * Digest settings as sent to the browser. The scanner API has no login, so the webhook address
 * (whoever holds it can post to that channel) and any stored e-mail stay on the server: the screen
 * only learns whether a webhook is saved and which service it points at.
 */
export function toPublicDigestConfig(cfg = {}) {
  const url = String(cfg?.webhook_url || '').trim();
  let host = '';
  try { host = url ? new URL(url).host : ''; } catch { host = ''; }
  return {
    enabled: cfg?.enabled !== false,
    auto_enrich_top: cfg?.auto_enrich_top !== false,
    schedule_note: String(cfg?.schedule_note || 'On-demand & 12h observer'),
    webhook_url: '',
    webhook_set: Boolean(url),
    webhook_host: host,
  };
}

/**
 * Combine the saved digest settings with a settings form sent from the screen.
 * The screen never receives the saved webhook address, so an empty field means "keep it";
 * a new address replaces it and `clear_webhook: true` removes it. Other saved keys are kept.
 */
export function mergeDigestConfig(existing = {}, incoming = {}) {
  const saved = String(existing?.webhook_url || '').trim();
  const typed = String(incoming?.webhook_url || '').trim();
  let webhookUrl = saved;
  if (incoming?.clear_webhook === true) {
    webhookUrl = '';
  } else if (typed) {
    if (!/^https?:\/\/\S+$/i.test(typed)) {
      throw Object.assign(new Error('Webhook URL must start with https:// (or http://)'), { status: 400 });
    }
    webhookUrl = typed;
  }
  return {
    ...(existing && typeof existing === 'object' ? existing : {}),
    enabled: incoming?.enabled !== false,
    auto_enrich_top: incoming?.auto_enrich_top !== false,
    webhook_url: webhookUrl,
    schedule_note: String(incoming?.schedule_note || existing?.schedule_note || 'On-demand & 12h observer'),
  };
}

export async function saveDigestConfig(cfg = {}) {
  const merged = mergeDigestConfig(await getDigestConfig(), cfg);
  const db = getDbClient();
  if (db) {
    await db.from('scanner_config').upsert({
      key: 'digest',
      value: merged,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
  }
  return merged;
}

// ── 1-Click Starter BOQ Generator for Source-less Tender Leads ──────────────

function buildDeterministicStarterBoq(lead) {
  const titleLow = `${lead.title || ''} ${lead.summary || ''}`.toLowerCase();
  const isHospitality = /hotel|resort|hospitality|lodge|serviced apartment/i.test(titleLow);
  const isHealthcare = /hospital|clinic|medical|health/i.test(titleLow);
  const isResidential = /villa|apartment|residential|housing|compound/i.test(titleLow);
  const scopes = lead.scopes || ['fitouts'];

  const items = [];
  let seq = 1;
  const pushItem = (location, scope, prefix, categoryHint, description, unit, qty) => {
    items.push({
      location,
      scope,
      code: `${prefix}-${String(seq++).padStart(2, '0')}`,
      categoryHint,
      description,
      unit,
      qty: String(qty),
    });
  };

  if (scopes.includes('furniture') || scopes.length === 0) {
    if (isHospitality) {
      pushItem('Lobby & Reception', 'Furniture', 'FFE', 'Soft Seating', 'Hospitality reception counter with engineered quartz top & modular lounge sofa seating', 'Set', 2);
      pushItem('Guestrooms', 'Furniture', 'FFE', 'Beds & Casegoods', 'King guestroom FF&E package: upholstered headboard, bedside tables, study desk & wardrobe', 'Room', 40);
      pushItem('All-Day Dining', 'Furniture', 'FFE', 'Dining Seating', 'Commercial contract dining tables with solid ash frame & upholstered dining chairs', 'Set', 24);
    } else if (isHealthcare) {
      pushItem('Waiting & Outpatient', 'Furniture', 'FFE', 'Public Seating', 'Healthcare antimicrobial beam seating (4-seater) with PU cushions & steel frame', 'Nos', 30);
      pushItem('Consultation Suites', 'Furniture', 'FFE', 'Desking & Task Seating', 'Ergonomic task chair & medical workstation desk with mobile pedestal', 'Set', 25);
    } else {
      pushItem('Executive Wing', 'Furniture', 'FFE', 'Executive Desking', 'Executive L-shape desk with cable management & high-back leather task chair', 'Set', 8);
      pushItem('Open Plan Offices', 'Furniture', 'FFE', 'Workstations', '4-person benching workstation cluster with acoustic desk screens & ergonomic task chairs', 'Cluster', 15);
      pushItem('Boardroom & Meeting', 'Furniture', 'FFE', 'Conference Tables', '3.6m boat-shaped boardroom conference table with integrated power box & 12 meeting chairs', 'Set', 3);
      pushItem('Breakout & Pantry Lounge', 'Furniture', 'FFE', 'Soft Seating', 'Acoustic high-back modular booth seating with coffee table', 'Set', 6);
    }
  }

  if (scopes.includes('commercial_kitchen')) {
    pushItem('Main Central Kitchen', 'Commercial Kitchen', 'CK', 'Cooking & Prep Line', 'Heavy-duty stainless steel 304 island cooking range, combi-steamer oven & exhaust hood', 'Set', 2);
    pushItem('Cold Storage & Stewarding', 'Commercial Kitchen', 'CK', 'Refrigeration & Warewash', 'Modular walk-in chiller/freezer cold room with pass-through commercial dishwasher', 'Lot', 1);
  }

  if (scopes.includes('residential_kitchen') || isResidential) {
    pushItem('Residential Units', 'Residential Kitchen', 'RK', 'Modular Kitchen Cabinetry', 'Moisture-resistant HMR carcass modular kitchen cabinets, soft-close hinges & quartz worktop', 'Set', 12);
    pushItem('Residential Pantries', 'Residential Kitchen', 'RK', 'Pantry & Sink Unit', 'Under-mount stainless double-bowl kitchen sink with pull-out mixer & pantry tall unit', 'Set', 12);
  }

  if (scopes.includes('sanitary_tiles')) {
    pushItem('Restrooms & Wet Areas', 'Sanitary & Tiles', 'SAN', 'Sanitaryware', 'Commercial concealed-cistern wall-hung WC, deck-mounted washbasin & sensor faucet set', 'Set', 32);
    pushItem('Lobby & Corridors', 'Sanitary & Tiles', 'TIL', 'Porcelain Tiles', '600x1200mm R10 rectified porcelain floor & wall tiles with adhesive and epoxy grout', 'm2', 850);
  }

  if (scopes.includes('fitouts') || items.length < 6) {
    pushItem('Main Interior Zone', 'Fit-Outs', 'FIT', 'Partitioning', 'Double-glazed acoustic aluminum office partition system (STC 44) with laminated glass doors', 'm2', 240);
    pushItem('Ceilings & Acoustic', 'Fit-Outs', 'FIT', 'Ceiling Works', 'Acoustic mineral-fiber & gypsum bulkhead suspended ceiling with linear slot diffuser openings', 'm2', 950);
    pushItem('Wall Cladding & Joinery', 'Fit-Outs', 'FIT', 'Bespoke Joinery', 'Fluted wood-veneer wall paneling & custom corridor reception feature backdrop', 'm2', 110);
  }

  return items;
}

export async function generateStarterBoqForLead(id) {
  const lead = await getProjectDetail(id);
  if (!lead) return null;

  let items = null;
  const aiOut = await callScannerLLM(
    'You are an expert Gulf/Oman Quantity Surveyor & FF&E Estimator. Generate a practical starter Bill of Quantities JSON object { "items": [ { "location": string, "scope": "Furniture"|"Fit-Outs"|"Commercial Kitchen"|"Residential Kitchen"|"Sanitary & Tiles", "code": string, "categoryHint": string, "description": string, "unit": "Nos"|"Set"|"m2"|"Lot"|"Lm", "qty": number } ] } with 10 to 14 realistic tender line items matched directly to the project archetype and scopes.',
    `Project: ${lead.title}\nLocation: ${lead.city || ''}, ${lead.country_name}\nClient: ${lead.client || 'N/A'}\nStage: ${lead.stage}\nScopes: ${(lead.scopes || []).join(', ')}\nEst Value (M OMR): ${lead.est_value_omr || 'N/A'}\nSummary: ${lead.ai_brief || lead.summary || ''}`,
  );

  if (aiOut && Array.isArray(aiOut.items) && aiOut.items.length >= 4) {
    items = aiOut.items.slice(0, 16).map((it, idx) => ({
      location: String(it.location || 'General Area').trim(),
      scope: String(it.scope || 'Furniture').trim(),
      code: String(it.code || `BOQ-${String(idx + 1).padStart(2, '0')}`).trim(),
      categoryHint: String(it.categoryHint || it.scope || 'General').trim(),
      description: String(it.description || 'Tender Supply & Installation Item').trim(),
      unit: String(it.unit || 'Nos').trim(),
      qty: String(Number(it.qty) > 0 ? Number(it.qty) : 1),
    }));
  }

  if (!items) {
    items = buildDeterministicStarterBoq(lead);
  }

  const table = {
    sheetName: `Starter BOQ — ${(lead.title || 'Tender').slice(0, 26)}`,
    columnCount: 6,
    header: ['Location', 'Scope', 'Code', 'Description', 'Unit', 'QTY'],
    rows: items.map((item) => ({
      location: item.location,
      scope: item.scope,
      code: item.code,
      categoryHint: item.categoryHint,
      description: item.description,
      cells: [
        { value: item.location },
        { value: item.scope },
        { value: item.code },
        { value: item.description },
        { value: item.unit },
        { value: item.qty },
      ],
    })),
    extractedSummary: { totalAmount: 0 },
  };

  await patchProject(lead.id, { boq_status: 'estimating' }).catch(() => {});

  const countryMeta = resolveCountryMeta(lead.country);
  return {
    ok: true,
    project: lead,
    items,
    table,
    vatPercent: String(countryMeta.vatPercent),
    source: aiOut ? 'ai-generated' : 'template-starter',
  };
}

// ── Regional Country & Platforms Helpers ────────────────────────────────────

export function listRegionalCountries() {
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

export function getRegionalCountry(code = 'OM') {
  const c = resolveCountryMeta(code);
  return {
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
  };
}

export function getAllRegionalPlatforms() {
  return Object.values(GCC_COUNTRIES).flatMap((c) =>
    (c.platforms || []).map((p) => ({
      ...p,
      country_code: c.code,
      country_name: c.name,
      flag: c.flag,
    })),
  );
}
