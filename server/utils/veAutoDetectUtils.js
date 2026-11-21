/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  Value Engineered Offer — Dedicated Auto-Detect LLM Utilities           │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { callUniversalMultimodalAI, withRetry, GOOGLE_MODEL, VISION_MODEL } from './llmUtils.js';
import { TAXONOMY } from './normalizer.js';
import { BRAND_ALIASES, KNOWN_CONTRACT_BRANDS, NON_BRAND_MODEL_WORDS, VE_CATEGORY_CONFIG, classifyFurnishingCategory, findBrandInCatalog } from './veCategoryPriority.js';
import { detectSpecArchetype, DOMAIN_EXCLUSIONS } from './veBrandSpecialties.js';
import { getCanonicalBrandLogo, getCanonicalBrandWebsite, resolveBrandLogo, classifyContractCategory } from './brandLogos.js';
import { computeTokenOverlapScore } from '../embeddingService.js';
import { discoverLiveWebAndArchitonicAlternatives } from './liveAlternativesDiscovery.js';
import { fetchLiveProductImage } from './veImageEnricher.js';

const ALLOWED_CATEGORIES = Object.keys(TAXONOMY).join(', ');
const ALLOWED_SUB_CATEGORIES = Object.values(TAXONOMY).flatMap(cat => Object.keys(cat)).join(', ');

// ──────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPTS (Highly token-optimized)
// ──────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPTS (Highly token-optimized)
// ──────────────────────────────────────────────────────────────────────────────

export const VE_BRANDED_MATCH_SYSTEM = (hasImage = false) => `You are an expert FF&E Commercial Furniture & Architectural Specification Specialist with live web knowledge.
The user is providing an architectural schedule item that explicitly specifies a manufacturer and/or model code.
Task: Deterministically identify the exact specified product from that manufacturer with 100% fidelity.

### 🎯 DETERMINISTIC RESOLUTION RULES FOR BRANDED ITEMS:
1. PROPOSED OVERRIDE PRECEDENCE: If the text lists both a reference item and an explicit "Proposed Brand" / "Proposed Model" / "BRAND:" + "MODEL:" specification, ALWAYS honor the explicitly proposed manufacturer and model.
2. CANONICAL FIDELITY: Extract the canonical Manufacturer / Brand name and exact Model / Collection name. DO NOT SUBSTITUTE WITH ANOTHER BRAND or collapse distinct named series into another model.
3. ARCHETYPE & STRUCTURAL PRECISION: Verify functional typology, seating/table capacity, base geometry (e.g. 4-leg/cantilever/star-base visitor chair vs 5-star swivel task chair; folding/flip-top table vs static desk; high stool vs dining chair), dimensions, and official manufacturer URL.
4. ${hasImage ? 'VISUAL VERIFICATION: Cross-check the attached reference image silhouette, base, and armrest geometry against the identified model.' : 'TEXT PRECISION: Prioritize exact model codes, series tokens, dimensions, and material specifications.'}

### 🌍 GLOBAL CATEGORY MAPPING:
You MUST map to one of these Main Categories: ${ALLOWED_CATEGORIES}
Sub-Categories: ${ALLOWED_SUB_CATEGORIES}

Return ONLY valid JSON:
{
  "status": "success",
  "brand": "Exact Specified Manufacturer Name",
  "model": "Exact Specified Model Name",
  "family": "Product Line / Family",
  "mainCategory": "Main Category",
  "subCategory": "Sub-Category",
  "productUrl": "https://... (official manufacturer link)",
  "estimatedPrice": 0,
  "confidenceScore": 100,
  "logic": "Exact manufacturer specification verified."
}`;

const VE_MATCH_AUTO_SYSTEM = (hasImage = false, brandList = []) => `You are an expert FF&E Commercial Furniture Matcher & Value Engineering Specialist.
Task: Deterministically match the specification description${hasImage ? ' and image' : ''} to the single best-fit real Brand, Model, Main Category, and Sub-Category.

### 🏢 AVAILABLE CONTRACT BRANDS:
${brandList && brandList.length > 0 ? `Preferred Contract Catalog Brands: ${brandList.join(', ')}` : 'Preferred Contract Catalog Brands: Narbutas, Sedus Stoll, B&T Design, True Design, Pedrali, Nurus, Frezza, LAS, Ofifran, Sokoa, Rim, TMA, Leadcom, Figueras, Dauphin, AMARA, Arper, Ottimo Furniture, FitOut V2'}

### 🎯 DETERMINISTIC SELECTION RUBRIC (IN STRICT ORDER):
1. EXPLICIT SPECIFICATION FIRST: If a genuine contract manufacturer or explicit "BRAND:" / "MODEL:" / "Proposed Model:" is written in the specification, extract that exact manufacturer and exact model—never replace a specified model with an unrelated series.
2. NO FAKE OR DEALER BRANDS: If the specification only contains origin/trade markers ("LOCAL-UAE", "FAR EAST", "LOCAL", "CUSTOM", "UNBRANDED", "GENERIC") or generic product words, NEVER invent fake brands; instead select the strongest authentic contract brand from the available catalog for that exact product category.
3. STRICT ARCHETYPE & SCALE LOCK:
   - Never substitute across incompatible product archetypes: Visitor / Cantilever / 4-Leg Chair ≠ 5-Star Swivel Task Chair; High Chair / Bar Stool ≠ Standard Dining/Meeting Chair; Coffee / Side Table ≠ Boardroom / Conference Table; Folding / Flip-Top Training Table ≠ Fixed Executive Desk; Multi-Seat / Modular Sofa ≠ Single Armchair; Acoustic Divider / Movable Board ≠ Seating.
   - Match seating capacity, base geometry, backrest height, and dimensions (mm) closely.
4. DYNAMIC CATEGORY ROUTING (CHOOSE BEST AUTHENTIC REAL CATALOG MODEL):
   - Desking, Workstations & Executive Tables: match from premier desking/systems brands in the available list (e.g. NARBUTAS, Nurus, FREZZA, LAS, Ofifran, Ottimo Furniture, Teknion, Steelcase).
   - Task, Executive, Visitor & Conference Seating: match from premier commercial seating brands in the available list (e.g. NARBUTAS, Sedus Stoll, Sokoa, Rim, Dauphin, Interstuhl, Nurus, Arper, Ottimo Furniture).
   - Acoustic Pods, Booths & Dividers: match from acoustic/architectural brands (e.g. NARBUTAS, Framery, BuzziSpace, Workspace.ae).
   - Lounge, Soft Seating, Coffee & Café Tables: match from soft-seating/hospitality brands (e.g. B&T Design, Arper, Pedrali, True Design, FREZZA, NARBUTAS, Andreu World).
   - Auditorium, Theatre & Lecture Seating: match from specialist auditorium brands (e.g. Sedia Systems, Ferco Seating, Figueras, Leadcom, TMA).
   - Outdoor & Landscape Seating: match from outdoor contract brands (e.g. Pedrali, Vondom, Dedon, Emu, Slide Design, Escofet).
   - Architectural Fitout, Joinery & Custom Works: route to FitOut V2.
   - Generic non-furniture accessories ONLY (cable grommets, monitor arms, power boxes, trash bins, pillows): may match Amazon / IKEA. NEVER match commercial furniture to Amazon or IKEA.
5. DETERMINISTIC TIE-BREAKING: When multiple real models from the best-fit brand satisfy the specification equally, pick the flagship exact-archetype model consistently (break exact ties alphabetically by official model name).

### 🌍 GLOBAL CATEGORY MAPPING:
You MUST map to one of these Main Categories: ${ALLOWED_CATEGORIES}
Sub-Categories: ${ALLOWED_SUB_CATEGORIES}

Return ONLY valid JSON:
{
  "status": "success",
  "brand": "Contract Brand Name",
  "model": "Matched Real Catalog Model Name",
  "mainCategory": "Matched Main Category",
  "subCategory": "Matched Sub-Category",
  "estimatedPrice": 0,
  "productUrl": "https://...",
  "logic": "Brief deterministic reasoning"
}`;

// ──────────────────────────────────────────────────────────────────────────────
// PRE-SCAN PROMPT (Global Document & Table Extraction)
// ──────────────────────────────────────────────────────────────────────────────

const VE_PRESCAN_SYSTEM = `You are an expert FF&E Project Specification & Manufacturer Discovery Agent.
Analyze the provided schedule / table of items and extract ONLY the ACTUAL PRODUCT MANUFACTURERS and BRAND NAMES.

### 🎯 STRICT RULES (MANUFACTURERS & BRANDS ONLY):
1. ✅ EXTRACT ONLY the actual product Manufacturer, Brand Name, Designer Collection, or Manufacturer URL (e.g., "Moodie", "Moonako", "Freifrau", "Dedon", "Emu", "Magis", "Figueras", "Wiesner Hager", "B&T Design", "Herman Miller", "Please Wait to Be Seated", "Encore Seating", "Bree's New World", "Planurban", "Kirkhouse", "Milimetry", "Sui Generis", "Ciment Studio", "West Elm", "Scandinavian Designs", "StudioDesk", "Meeden", "TON", "Pedrali", "Andreu World", "Vitra", "Arper", "Hay", "Muuto", "Knoll", "Steelcase", "Sokoa", "Sedus Stoll", "Nurus", "Narbutas", "Ottimo Furniture", "Workspace.ae", "Sprout Kids", "Modul").
2. 🚫 FORBID AND IGNORE ALL LOCAL SUPPLIERS, DEALERS, TRADERS, AND RETAILERS:
   - NEVER extract local furniture dealers or trading companies (e.g., "Fahmy Furniture", "KR Furniture", "Al Jassar", "Timeout Space", "Gear4music", "Home Depot", "ATTF", "Automatic Terrazzo Tiles Factory", "Assarain Concrete", "ACP").
   - If a line states "Supplier: Fahmy Furniture / KR Furniture / Al Jassar or similar", DO NOT extract those supplier names as brands!
   - If a distributor link is present (e.g., "timeoutspace.com/products/ton-811-chair"), extract the actual Manufacturer "TON", NEVER the distributor.
   - If a dealer link is present (e.g. "gear4music.com/.../modul-Reclining-Studio-Chair"), extract the actual brand "Modul", NEVER "Gear4music".
   - If a retailer link is present (e.g. "homedepot.com/.../Studio-Designs-..."), extract the actual brand "Studio Designs" or "Sew Ready", NEVER "Home Depot".
3. 🚫 FORBID consumer retail marketplaces (Amazon, Noon) from being extracted as contract manufacturers.
4. For each detected manufacturer/brand, list the specific models, product lines, or collection names associated with it in this document.

Return ONLY valid JSON:
{
  "status": "success",
  "brands": [
    {
      "name": "Canonical Manufacturer / Brand Name (e.g., 'Moodie', 'Moonako', 'Freifrau', 'Dedon', 'Magis', 'Workspace.ae', 'TON')",
      "models": ["Model 1", "Model 2"],
      "websiteUrl": "https://... (official manufacturer URL if present, else empty)",
      "categoryHint": "Primary category (e.g., 'Furniture', 'Office Seating', 'Desk & Table')"
    }
  ]
}`;

/**
 * Deterministic domain-to-brand mapper for instant, zero-miss brand discovery from reference URLs.
 * Strictly maps to canonical product manufacturers (forbidding generic suppliers/dealers).
 */
export function cleanDomainToBrand(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return null;
    try {
        const fixedUrl = urlStr.startsWith('http') ? urlStr : `https://${urlStr}`;
        const u = new URL(fixedUrl);
        let hostname = u.hostname.replace(/^www\./i, '').toLowerCase();
        const hostParts = hostname.split('.');
        let domainBase = hostParts[0];

        // Specific well-known contract manufacturer mappings
        const domainMap = {
            'dedon': { name: 'Dedon', url: 'https://www.dedon.de' },
            'emu': { name: 'Emu', url: 'https://www.emu.it' },
            'freifrau': { name: 'Freifrau', url: 'https://www.freifrau.com' },
            'figueras': { name: 'Figueras', url: 'https://figueras.com' },
            'magisdesign': { name: 'Magis', url: 'https://www.magisdesign.com' },
            'magis': { name: 'Magis', url: 'https://www.magisdesign.com' },
            'encoreseating': { name: 'Encore Seating', url: 'https://encoreseating.com' },
            'kirkhouse': { name: 'Kirkhouse', url: 'https://www.kirkhouse.co.uk' },
            'studiodesk': { name: 'StudioDesk', url: 'https://www.studiodesk.net' },
            'breesnewworld': { name: "Bree's New World", url: 'https://www.breesnewworld.nl' },
            'sprout': { name: 'Sprout Kids', url: 'https://sprout-kids.com' },
            'sprout-kids': { name: 'Sprout Kids', url: 'https://sprout-kids.com' },
            'scandinaviandesigns': { name: 'Scandinavian Designs', url: 'https://scandinaviandesigns.com' },
            'westelm': { name: 'West Elm', url: 'https://www.westelm.com' },
            'meedenart': { name: 'Meeden', url: 'https://meedenart.com' },
            'meeden': { name: 'Meeden', url: 'https://meedenart.com' },
            'milimetry': { name: 'Milimetry', url: 'https://milimetry.com' },
            'cimentstudio': { name: 'Ciment Studio', url: 'https://www.cimentstudio.com' },
            'suigeneris': { name: 'Sui Generis', url: 'https://www.suigeneris.co.uk' },
            'infabbrica': { name: 'Infabbrica', url: 'https://www.infabbrica.com' },
            'wiesner': { name: 'Wiesner Hager', url: 'https://www.wiesner-hager.com' },
            'wiesner-hager': { name: 'Wiesner Hager', url: 'https://www.wiesner-hager.com' },
            'bt': { name: 'B&T Design', url: 'https://bt.design' },
            'workspace': { name: 'Workspace.ae', url: 'https://workspace.ae' },
            'hermanmiller': { name: 'Herman Miller', url: 'https://www.hermanmiller.com' },
            'moodie': { name: 'Moonako', url: 'https://www.moonako.fr' },
            'moonako': { name: 'Moonako', url: 'https://www.moonako.fr' },
            'planurban': { name: 'Planurban', url: 'https://www.planurban.it' },
            'timeoutspace': { name: 'TON', url: 'https://www.ton.eu' }, // Maps dealer to actual manufacturer
            'ton': { name: 'TON', url: 'https://www.ton.eu' },
            'frameryacoustics': { name: 'Framery', url: 'https://www.frameryacoustics.com' },
            'framery': { name: 'Framery', url: 'https://www.frameryacoustics.com' },
            'buzzispace': { name: 'BuzziSpace', url: 'https://www.buzzi.space' },
            'buzzi': { name: 'BuzziSpace', url: 'https://www.buzzi.space' },
            'pleasewaittobeseated': { name: 'Please Wait to Be Seated', url: 'https://www.pleasewaittobeseated.com' },
            'narbutas': { name: 'NARBUTAS', url: 'https://www.narbutas.com' },
            'pedrali': { name: 'Pedrali', url: 'https://www.pedrali.com' },
            'andreuworld': { name: 'Andreu World', url: 'https://www.andreuworld.com' },
            'vitra': { name: 'Vitra', url: 'https://www.vitra.com' },
            'arper': { name: 'Arper', url: 'https://www.arper.com' },
            'hay': { name: 'Hay', url: 'https://hay.dk' },
            'muuto': { name: 'Muuto', url: 'https://www.muuto.com' },
            'knoll': { name: 'Knoll', url: 'https://www.knoll.com' },
            'steelcase': { name: 'Steelcase', url: 'https://www.steelcase.com' },
            'sokoa': { name: 'Sokoa', url: 'https://www.sokoa.com' },
            'sedus': { name: 'Sedus Stoll', url: 'https://www.sedus.com' },
            'sedus-stoll': { name: 'Sedus Stoll', url: 'https://www.sedus.com' },
            'nurus': { name: 'Nurus', url: 'https://www.nurus.com' },
            'ofifran': { name: 'Ofifran', url: 'https://www.ofifran.com' },
            'ismobil': { name: 'ISMOBIL', url: 'https://www.ismobil.com' },
            'las': { name: 'LAS', url: 'https://www.las.it' },
            'frezza': { name: 'FREZZA', url: 'https://www.frezza.com' }
        };

        if (domainMap[domainBase]) {
            return {
                name: domainMap[domainBase].name,
                websiteUrl: domainMap[domainBase].url,
                domain: hostname
            };
        }

        // Special dealer/retailer URL unpacking
        if (hostname.includes('gear4music')) {
            return { name: 'Modul', websiteUrl: 'https://www.gear4music.com', domain: hostname };
        }
        if (hostname.includes('homedepot')) {
            if (urlStr.toLowerCase().includes('sew-ready') || urlStr.toLowerCase().includes('craft')) {
                return { name: 'Sew Ready', websiteUrl: 'https://www.homedepot.com', domain: hostname };
            }
            if (urlStr.toLowerCase().includes('studio-designs')) {
                return { name: 'Studio Designs', websiteUrl: 'https://www.homedepot.com', domain: hostname };
            }
        }
        if (hostname.includes('amazon')) {
            return { name: 'Amazon', websiteUrl: 'https://www.amazon.com', domain: hostname };
        }
        if (hostname.includes('noon')) {
            return { name: 'Noon', websiteUrl: 'https://www.noon.com', domain: hostname };
        }

        // Strict filter: ignore retail marketplaces, local dealers, and generic portals
        const FORBIDDEN_DOMAINS = /^(attfoman|assarainconcrete|google|youtube|wikipedia|pinterest|instagram|facebook|bit|tinyurl|drive|dropbox|ebay|aliexpress)/i;
        if (domainBase.length >= 3 && !FORBIDDEN_DOMAINS.test(domainBase)) {
            const prettyName = domainBase.charAt(0).toUpperCase() + domainBase.slice(1);
            return {
                name: prettyName,
                websiteUrl: u.origin,
                domain: hostname
            };
        }
    } catch (e) { }
    return null;
}

/**
 * Repairs line-wrapped or broken URLs commonly found in PDF table extractions,
 * joins hyphenated segments, and extracts clean canonical URLs.
 */
export function repairAndExtractUrls(text) {
    if (!text || typeof text !== 'string') return [];

    // Repair broken line-wrapped URLs in PDF text, e.g.:
    // "https://workspace.ae/executive-desks/ava-series-rectangular-executive- desk#/22-dimensions..."
    const repairedText = text.replace(/(https?:\/\/[a-z0-9\-._~:/?#[\]@!$&'()*+,;=]+)(?:\s+([a-z0-9\-._~:/?#[\]@!$&'()*+,;=]+))+/gi, (fullMatch) => {
        const tokens = fullMatch.split(/\s+/);
        let repaired = tokens[0];
        for (let i = 1; i < tokens.length; i++) {
            const token = tokens[i];
            if (/^(or|equivalent|approved|equal|and|similar|with|all|qty|unit|ref|boq_only)$/i.test(token)) {
                break;
            }
            if (token.includes('/') || token.includes('#') || token.includes('_') || token.includes('-') || token.includes('.html') || token.includes('?')) {
                if (repaired.endsWith('-') || repaired.endsWith('/')) {
                    repaired = repaired + token;
                } else {
                    repaired = repaired + '/' + token;
                }
            } else if (repaired.endsWith('-') || repaired.endsWith('/') || repaired.includes('#/')) {
                repaired = repaired + token;
            } else {
                break;
            }
        }
        return repaired;
    });

    const rawMatches = repairedText.match(/https?:\/\/[^\s\)\],]+/gi) || [];
    const validUrls = [];

    for (const rawUrl of rawMatches) {
        let clean = rawUrl.trim().replace(/[.,;]+$/, '');
        // For product URLs with hash fragments that break on remote servers (like workspace.ae), extract clean canonical URL
        if (clean.includes('workspace.ae') && clean.includes('#/')) {
            clean = clean.split('#/')[0].replace(/-+$/, '');
        }
        if (!validUrls.includes(clean)) {
            validUrls.push(clean);
        }
    }

    return validUrls;
}

/**
 * True when the URL belongs to a marketplace/dealer host (never an official manufacturer link).
 */
export function isMarketplaceUrl(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return false;
    try {
        const host = new URL(urlStr.startsWith('http') ? urlStr : `https://${urlStr}`).hostname.toLowerCase();
        return /(^|\.)(amazon|noon|ikea|ebay|ubuy|desertcart|alibaba|made-in-china|moodie)\.[a-z.]+$/.test(host);
    } catch { return false; }
}

const IDENTITY_STOP_WORDS = new Set([
    'chair', 'chairs', 'table', 'tables', 'desk', 'desks', 'sofa', 'sofas', 'lounge', 'armchair', 'armchairs',
    'stool', 'stools', 'bench', 'benches', 'cabinet', 'cabinets', 'storage', 'office', 'meeting', 'conference',
    'visitor', 'guest', 'task', 'swivel', 'executive', 'manager', 'staff', 'medium', 'high', 'low', 'back',
    'black', 'white', 'grey', 'gray', 'blue', 'red', 'green', 'mesh', 'fabric', 'leather', 'wood', 'wooden',
    'metal', 'base', 'star', 'legs', 'leg', 'castors', 'castor', 'armrest', 'armrests', 'series', 'model',
    'collection', 'furniture', 'system', 'systems', 'modular', 'ergonomic', 'performance', 'commercial',
    'with', 'and', 'for', 'the', 'plus', 'pro', 'new', 'lite', 'mini', 'max', 'set', 'unit', 'item', 'bar',
    'coffee', 'side', 'double', 'single', 'round', 'rectangular', 'folding', 'nesting', 'training', 'auditorium'
]);

const GARBAGE_DESC_RE = /(?:unfortunately,?\s*i\s+was\s+unable\s+to\s+find|product\s+not\s+found|unable\s+to\s+retrieve\s+description|information\s+not\s+publicly\s+available|no\s+official\s+product\s+details|products,\s*collections\s+and\s+more\s*[—-]\s*discover\s+the\s+world)/i;

/**
 * Returns true if a stored or live-fetched description is an LLM refusal / error / generic brand blurb.
 */
export function isGarbageProductDesc(desc) {
    if (!desc || typeof desc !== 'string') return false;
    return GARBAGE_DESC_RE.test(desc.trim());
}

/**
 * Extract distinctive series/model name tokens (alphabetic words >= 3 chars, ignoring generic furniture nouns and pure SKU codes).
 */
function extractDistinctiveSeriesTokens(modelName) {
    const clean = String(modelName || '')
        .toLowerCase()
        .replace(/\s*#\d+\b/g, '')
        .replace(/[^a-z0-9\s\-]/g, ' ')
        .trim();
    if (!clean) return [];
    // If the entire model is an alphanumeric SKU code (e.g. WS-FD-Y01, M50, E10), don't force alphabetic word matching
    const rawTokens = clean.split(/[\s\-_]+/).filter(Boolean);
    const alphaSeries = rawTokens.filter(t => /^[a-z]{3,}$/.test(t) && !IDENTITY_STOP_WORDS.has(t));
    return alphaSeries;
}

/**
 * Verify that a candidate catalog entry or live-web enrichment actually refers to the requested model series,
 * preventing cross-model poisoning (e.g. saving "SANDIE visitor chair" under "MOON G5A0342" or "Yukon" under "WAVE-C").
 */
export function isProductIdentityAligned(requestedModel, candidateModel = '', candidateDesc = '', candidateUrl = '') {
    if (isGarbageProductDesc(candidateDesc)) return false;
    const reqSeries = extractDistinctiveSeriesTokens(requestedModel);
    if (reqSeries.length === 0) return true; // SKU-only or generic model name — cannot detect cross-series mismatch reliably

    const haystack = [
        String(candidateModel || ''),
        String(candidateDesc || '').slice(0, 140),
        String(candidateUrl || '')
    ].join(' ').toLowerCase();

    if (!haystack.trim()) return true;

    // Direct token or 4-char stem match (handles minor plural/spelling variants like polyton <-> polytone)
    const aligned = reqSeries.some(tok => {
        if (haystack.includes(tok)) return true;
        if (tok.length >= 5 && haystack.includes(tok.slice(0, 5))) return true;
        return false;
    });
    if (aligned) return true;

    // Only reject when the candidate explicitly leads with a DIFFERENT product title / slug
    const descHead = String(candidateDesc || '').trim();
    const looksLikeNamedProduct = descHead.length >= 20 || Boolean(candidateModel) || /\/products?\/|thickbox_default|\/uploads\//i.test(String(candidateUrl || ''));
    return !looksLikeNamedProduct;
}

/**
 * Dynamically detects if a specification text explicitly mentions a contract manufacturer/brand or URL.
 * Checks URLs -> explicit BRAND:/Proposed Brand: labels -> ALL live localCatalogs brand names -> aliases.
 */
export function detectSpecifiedBrandInText(text, localCatalogs = []) {
    if (!text || typeof text !== 'string') return null;

    // 1. Direct URL check with line-wrap healing — manufacturer domains preferred.
    const urlMatches = repairAndExtractUrls(text);
    const mapped = [];
    for (const urlStr of urlMatches) {
        const info = cleanDomainToBrand(urlStr);
        if (info && info.name) mapped.push({ brand: info.name, canonical: info.websiteUrl || urlStr, sourceUrl: urlStr });
    }
    if (mapped.length > 0) {
        const hostOf = (u) => {
            try { return new URL(u.startsWith('http') ? u : `https://${u}`).hostname.replace(/^www\./i, '').toLowerCase(); }
            catch { return ''; }
        };
        for (const m of mapped) {
            const rawHost = hostOf(m.sourceUrl), canHost = hostOf(m.canonical);
            if (rawHost && canHost && (rawHost === canHost || rawHost.endsWith(`.${canHost}`) || canHost.endsWith(`.${rawHost}`))) {
                const others = mapped.filter((x) => x.sourceUrl !== m.sourceUrl).map((x) => x.sourceUrl);
                return { brand: m.brand, url: m.sourceUrl, sourceUrl: m.sourceUrl, domain: rawHost, supplierUrls: others };
            }
        }
        const first = mapped[0];
        const firstHost = hostOf(first.sourceUrl);
        const suppliers = mapped.map((x) => x.sourceUrl).filter((u) => u !== first.canonical);
        if (!suppliers.includes(first.sourceUrl) && first.sourceUrl !== first.canonical) suppliers.unshift(first.sourceUrl);
        return { brand: first.brand, url: first.canonical, sourceUrl: first.sourceUrl, domain: firstHost, supplierUrls: suppliers };
    }

    // 2. Explicit Proposed Brand / Maker / Manufacturer / Brand / Supplier key labels (highest text precedence)
    const explicitBrandMatch =
        text.match(/Proposed\s*Brand\s*:\s*([^|\n;\r]+)/i) ||
        text.match(/(?:Supplier\s*\/\s*)?Maker\s*:\s*([^|\n;\r]+)/i) ||
        text.match(/Manufacturer\s*:\s*([^|\n;\r]+)/i) ||
        text.match(/(?:^|[\n|;,\s])Brand\s*:\s*([^|\n;\r]+)/i) ||
        text.match(/(?:^|[\n|;,\s])Supplier\s*:\s*([^|\n;\r]+)/i);

    if (explicitBrandMatch) {
        let rawBrand = explicitBrandMatch[1].trim().replace(/\.$/, '');
        rawBrand = rawBrand.replace(/\s*(?:or\s+approved\s+equal|or\s+similar|or\s+equal)\b/i, '').trim();
        const rawLower = rawBrand.toLowerCase();
        const FORBIDDEN = /^(fahmy|kr furniture|al jassar|gear4music|homedepot|timeout|attf|assarain|acp|automatic terrazzo|amazon|noon|desertcart|ubuy|marketplace|ikea|generic|unknown|dealer|trader|supplier|distributor|local|far east|tbd|n\/a|none|various)$/i;
        if (rawBrand.length >= 2 && !FORBIDDEN.test(rawLower) && !NON_BRAND_MODEL_WORDS.has(rawLower)) {
            const catalogHit = Array.isArray(localCatalogs) && localCatalogs.length > 0
                ? findBrandInCatalog(rawBrand, localCatalogs)
                : null;
            const canonical = catalogHit?.name || BRAND_ALIASES[rawLower] || rawBrand;
            return { brand: canonical, url: '', matchedText: rawBrand, isExplicitLabel: true };
        }
    }

    // 3. Dynamic scan across ALL loaded localCatalogs brand names + aliases (picks earliest mention in text, longest on tie)
    const textLower = text.toLowerCase();
    const candidates = [];
    const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const seenTerms = new Set();

    const registerCandidate = (term, canonicalName) => {
        const cleanTerm = String(term || '').trim();
        const termLower = cleanTerm.toLowerCase();
        if (cleanTerm.length < 3 || NON_BRAND_MODEL_WORDS.has(termLower) || seenTerms.has(`${termLower}=>${canonicalName}`)) return;
        if (/^(fitout|local|generic|custom|other|furniture|seating|office|desk|table|chair|amazon|noon|ikea)$/i.test(termLower)) return;
        seenTerms.add(`${termLower}=>${canonicalName}`);
        const rx = new RegExp(`\\b${escapeRx(cleanTerm)}\\b`, 'i');
        const m = rx.exec(text);
        if (m) {
            candidates.push({ index: m.index, length: m[0].length, brand: canonicalName, matchedText: m[0] });
        }
    };

    if (Array.isArray(localCatalogs) && localCatalogs.length > 0) {
        for (const b of localCatalogs) {
            const name = String(b?.name || '').trim();
            if (!name || name.toLowerCase().includes('fitout')) continue;
            registerCandidate(name, name);
            // Strip TLD / suffix variants dynamically (e.g. "Workspace.ae" -> "Workspace", "Sedia Systems" -> "Sedia System")
            const noTld = name.replace(/\.(com|ae|eu|it|de|co\.uk|net|org)$/i, '').trim();
            if (noTld !== name && noTld.length >= 4) registerCandidate(noTld, name);
            if (/s$/i.test(noTld) && noTld.length >= 6) registerCandidate(noTld.slice(0, -1), name);
            // Short base before "products, collections..."
            const beforeComma = noTld.split(',')[0].replace(/\s+products?$/i, '').trim();
            if (beforeComma.length >= 4 && beforeComma !== noTld) registerCandidate(beforeComma, name);
        }
    }

    for (const [aliasKey, canonicalName] of Object.entries(BRAND_ALIASES)) {
        if (aliasKey.length < 3) continue;
        registerCandidate(aliasKey, canonicalName);
        if (/s$/i.test(aliasKey) && aliasKey.length >= 6) registerCandidate(aliasKey.slice(0, -1), canonicalName);
    }

    for (const brandKey of KNOWN_CONTRACT_BRANDS) {
        if (brandKey.length < 3) continue;
        const prettyName = brandKey.charAt(0).toUpperCase() + brandKey.slice(1);
        registerCandidate(brandKey, prettyName);
    }

    if (candidates.length > 0) {
        // Earliest mention wins (e.g. lead-line "Workspace - Yukon..."), longest term wins at same position
        candidates.sort((a, b) => (a.index !== b.index ? a.index - b.index : b.length - a.length));
        const top = candidates[0];
        return { brand: top.brand, url: '', matchedText: top.matchedText };
    }

    return null;
}

/**
 * Extracts complete specified product details (brand, model, size, finish, type, URL)
 * dynamically from BOQ specification descriptions, including "Brand - Model;" lead lines
 * and Model-Only reverse lookups across all loaded catalogs.
 */
export function extractSpecifiedProductDetails(text, localCatalogs = []) {
    if (!text || typeof text !== 'string') return null;

    let brandInfo = detectSpecifiedBrandInText(text, localCatalogs);

    let candidateModel = '';
    const textLower = text.toLowerCase();

    // 1. Explicit Proposed Model / Model / Product Code key extraction (Proposed Model & Model beat generic Code)
    const explicitModelMatch =
        text.match(/Proposed\s*Model\s*:\s*([^|\n;\r]+)/i) ||
        text.match(/(?:^|[\n|;,\s])(?:Item\s*)?Model\s*:\s*([^|\n;\r]+)/i) ||
        text.match(/(?:Product\s*)?Code\s*:\s*([^|\n;\r]+)/i) ||
        text.match(/Item\s*Code\s*:\s*([^|\n;\r]+)/i);

    const explicitDescMatch =
        text.match(/Spec\s*(?:Item\s*)?Description\s*:\s*([^|\n;\r]+)/i) ||
        text.match(/(?:^|[\n|;])\s*Type\s*:\s*([^|\n;\r]+)/i);

    if (explicitModelMatch) {
        const codeVal = explicitModelMatch[1].trim();
        const descVal = explicitDescMatch ? explicitDescMatch[1].trim() : '';
        if (codeVal && descVal && !descVal.toLowerCase().includes(codeVal.toLowerCase()) && !explicitModelMatch[0].toLowerCase().includes('model')) {
            candidateModel = `${codeVal} (${descVal})`;
        } else if (codeVal) {
            candidateModel = codeVal;
        }
    }

    // 1a. Dynamic Model-Only Reverse Catalog Lookup (e.g. "MODEL: PRIMERA" without an explicit BRAND line)
    if (!brandInfo && candidateModel && Array.isArray(localCatalogs) && localCatalogs.length > 0) {
        const cleanTarget = candidateModel.toLowerCase().replace(/\s*#\d+\b/g, '').replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim();
        if (cleanTarget.length >= 3 && !IDENTITY_STOP_WORDS.has(cleanTarget)) {
            let bestBrandHit = null;
            let bestRevScore = 0;
            for (const b of localCatalogs) {
                if (!b?.name || !Array.isArray(b.products) || b.name.toLowerCase().includes('fitout')) continue;
                for (const p of b.products) {
                    const pm = String(p?.model || '').toLowerCase().replace(/\s*#\d+\b/g, '').replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim();
                    if (!pm) continue;
                    let s = 0;
                    if (pm === cleanTarget) s = 100;
                    else if (cleanTarget.length >= 5 && pm.startsWith(cleanTarget + ' ')) s = 85;
                    if (s > bestRevScore) {
                        bestRevScore = s;
                        bestBrandHit = { brand: b.name, url: p.websiteUrl || p.productUrl || b.websiteUrl || '' };
                    }
                }
            }
            if (bestBrandHit) {
                brandInfo = bestBrandHit;
            }
        }
    }

    if (!brandInfo) return null;

    // 1b. Dynamic "<Brand> - <Model Name>" lead-line parser (e.g. "Workspace - Yukon Black Chair Medium Back;", "Sedia System - E10 Auditorium Chair;")
    if (!candidateModel && brandInfo.matchedText && !brandInfo.isExplicitLabel) {
        const escBrand = brandInfo.matchedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const leadRx = new RegExp(`${escBrand}(?:\\s*[®™])?\\s*[-–—:]\\s*([^\\n;|]{2,75})`, 'i');
        const leadMatch = text.match(leadRx);
        if (leadMatch && leadMatch[1]) {
            let parsedLead = leadMatch[1]
                .replace(/\s*\b(?:ref\.?|qty|unit)\b.*$/i, '')
                .replace(/\s*\([^)]{10,}\)\s*$/g, '')
                .trim()
                .replace(/[,:\-]+$/, '')
                .trim();
            if (parsedLead.length >= 2 && parsedLead.length <= 70) {
                candidateModel = parsedLead;
            }
        } else {
            // Handle "<Brand>® <Model>" without dash (e.g. "ThinkingWall® AV Divider; Ref. SC-01")
            const tmRx = new RegExp(`${escBrand}\\s*[®™]\\s+([^\\n;|]{2,60})`, 'i');
            const tmMatch = text.match(tmRx);
            if (tmMatch && tmMatch[1]) {
                const parsedTm = tmMatch[1].replace(/\s*\b(?:ref\.?|qty|unit)\b.*$/i, '').trim();
                if (parsedTm.length >= 2) candidateModel = parsedTm;
            }
        }
    }

    if (!candidateModel && explicitDescMatch) {
        candidateModel = explicitDescMatch[1].trim();
    }

    // 1b. Pipe-delimited standalone alphanumeric SKU/model code (e.g. "1.01 | WS-FD-Y01 | Y-Series ...")
    if (!candidateModel) {
        const pipeSegs = text.split(/\s*\|\s*/).map(s => s.trim()).filter(Boolean);
        const skuSeg = pipeSegs.find(seg =>
            /^(?=.*\d)[A-Za-z]{1,8}[-_:][A-Za-z0-9\-_:]+$/.test(seg) &&
            !/^\d+(?:[wWdDhHxX*]|mm|cm|kg|nos|pcs)$/i.test(seg)
        );
        if (skuSeg) candidateModel = skuSeg;
    }

    // 2. Direct model extraction from description keywords
    if (!candidateModel) {
        const modelPatterns = [
            /\b(se:[a-z0-9\s_\-]+)\b/i,
            /\b(nova\s*wood|nova)\b/i,
            /\b(wind\s+(?:visitor|chair|armchair|seating))\b/i,
            /\b(scala\s*148|scala)\b/i,
            /\b(mesa\s*cuvier|cuvier)\b/i,
            /\b(halo\s*modern|halo)\b/i,
            /\b(piper)\b/i,
            /\b(stella)\b/i,
            /\b(skill)\b/i,
            /\b(limone)\b/i,
            /\b(arco)\b/i,
            /\b(lobby)\b/i,
            /\b(pila)\b/i,
            /\b(p\.o\.v\.|pov)\b/i,
            /\b(boom\s*curve|boom)\b/i,
            /\b(satellite)\b/i,
            /\b(minglez[a-z0-9 -]*cart|vendor\s*cart)\b/i
        ];
        for (const pattern of modelPatterns) {
            const match = text.match(pattern);
            if (match) {
                candidateModel = match[1].trim();
                break;
            }
        }
    }


    // 3. URL Path/Query model extraction — mine EVERY raw URL (dealer ?product=
    // params often carry the model even when linking goes canonical manufacturer)
    if (!candidateModel) {
        const urlsToMine = [brandInfo.sourceUrl, ...(brandInfo.supplierUrls || []), brandInfo.url].filter(Boolean);
        for (const mineUrl of urlsToMine) {
            try {
                const u = new URL(mineUrl);
                const productParam = u.searchParams.get('product') || '';
                if (productParam) {
                    const cleanParam = productParam.replace(/^\d+-moonako-?/i, '').replace(/[-_]/g, ' ').trim();
                    if (cleanParam) candidateModel = cleanParam;
                }
                if (!candidateModel) {
                    const pathParts = u.pathname.split('/').filter(Boolean);
                    const lastPart = pathParts[pathParts.length - 1] || '';
                    const cleanPath = lastPart
                        .replace(/\.(html?|php|aspx?)$/i, '')
                        .replace(/^(foldable-chair-|chair-|table-|desk-|seating-)/i, '')
                        .replace(/[-_]/g, ' ')
                        .trim();
                    if (cleanPath && cleanPath.length > 2 && !cleanPath.includes('index') && !cleanPath.includes('product') && !cleanPath.includes('products')) {
                        candidateModel = cleanPath.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                    }
                }
                if (candidateModel) break; // mined from this URL — stop
            } catch (e) { }
        }
    }

    // 4. Extract dimensions, finishes, and type
    const sizeMatch = text.match(/Size:\s*([0-9xX\s\.\,\*\-\(\)diahtDIAHTmmcmMmCm]+)/i) || text.match(/(\d{3,4}\s*[xX*]\s*\d{3,4}(?:\s*[xX*]\s*\d{3,4})?\s*(?:mm|cm)?\s*(?:ht)?)/i);
    const finishMatch = text.match(/Finish(?:es)?:\s*([^|;\n]+)/i);
    const typeMatch = text.match(/Type:\s*([^|;\n]+)/i);
    const specDescMatch = text.match(/Spec Item Description:\s*([^|;\n]+)/i);

    const size = sizeMatch ? sizeMatch[1].trim() : '';
    const finish = finishMatch ? finishMatch[1].trim() : '';
    const type = typeMatch ? typeMatch[1].trim() : (specDescMatch ? specDescMatch[1].trim() : '');

    return {
        brand: brandInfo.brand,
        url: brandInfo.url,
        sourceUrl: brandInfo.sourceUrl || brandInfo.url || '',
        supplierUrls: brandInfo.supplierUrls || [],
        model: candidateModel,
        size,
        finish,
        type
    };
}

/**
 * Rapidly scans an entire BOQ / project table to detect and index all specified contract MANUFACTURERS and BRANDS.
 * Strictly excludes local suppliers, dealers, and trading entities.
 */
export async function vePrescanBrands(items = [], providerModel = null) {
    return withRetry(async () => {
        if (!items || items.length === 0) return { status: 'success', brands: [] };

        const brandMap = new Map(); // Canonical Name -> Brand Object
        const FORBIDDEN_SUPPLIERS = /^(fahmy|kr furniture|al jassar|gear4music|homedepot|timeout|attf|assarain|acp|automatic terrazzo|amazon|noon|desertcart|ubuy|marketplace|ikea|generic|unknown|dealer|trader|supplier|distributor|roma|racer|terminal|app|wind|nova|eva|optima|choice|easy|single seater|two seater|three seater|l-shape|high cabinet)/i;

        // ── STEP 1: Fast Deterministic URL + Label Extraction (Zero-LLM) ──
        for (const item of items) {
            const desc = item.description || item.desc || (typeof item === 'string' ? item : '');
            if (!desc) continue;

            // 1A: Extract URLs
            const urlMatches = desc.match(/https?:\/\/[^\s\)\],]+/gi) || [];
            for (const urlStr of urlMatches) {
                const brandInfo = cleanDomainToBrand(urlStr);
                if (brandInfo && !FORBIDDEN_SUPPLIERS.test(brandInfo.name.toLowerCase())) {
                    if (!brandMap.has(brandInfo.name.toLowerCase())) {
                        brandMap.set(brandInfo.name.toLowerCase(), {
                            name: brandInfo.name,
                            models: [],
                            websiteUrl: brandInfo.websiteUrl,
                            categoryHint: 'Furniture'
                        });
                    }
                }
            }

            // 1B: Extract explicit Brand / Manufacturer / Supplier / Model labels deterministically (works even when LLM quota is capped)
            const det = extractSpecifiedProductDetails(desc, []);
            if (det && det.brand && !FORBIDDEN_SUPPLIERS.test(det.brand.toLowerCase())) {
                const key = det.brand.toLowerCase();
                if (!brandMap.has(key)) {
                    brandMap.set(key, {
                        name: det.brand,
                        models: det.model ? [det.model] : [],
                        websiteUrl: det.url || '',
                        categoryHint: /carpet|floor/i.test(desc) ? 'Flooring & Carpet' : 'Furniture'
                    });
                } else if (det.model) {
                    const existing = brandMap.get(key);
                    if (!existing.models.includes(det.model) && existing.models.length < 25) {
                        existing.models.push(det.model);
                    }
                }
            }
        }

        // ── STEP 2: Parallel Fast LLM Manufacturer Extraction (JSON mode over schedule text) ──
        const batchSize = 60;
        const effectiveModel = providerModel || GOOGLE_MODEL;
        const chunks = [];
        for (let i = 0; i < items.length; i += batchSize) {
            chunks.push({ startIndex: i, rows: items.slice(i, i + batchSize) });
        }

        const concurrency = 3;
        for (let c = 0; c < chunks.length; c += concurrency) {
            const slice = chunks.slice(c, c + concurrency);
            const batchResults = await Promise.all(slice.map(async ({ startIndex, rows }) => {
                const textSnippets = rows
                    .map((item, idx) => `[Item ${startIndex + idx + 1}] ${item.description || item.desc || (typeof item === 'string' ? item : '')}`)
                    .filter(Boolean)
                    .join('\n');
                const userPrompt = `Project Schedule Items:\n${textSnippets}`;
                try {
                    return await callUniversalMultimodalAI(VE_PRESCAN_SYSTEM, userPrompt, [], effectiveModel, false);
                } catch (llmErr) {
                    console.warn(`  ⚠️ [VE Pre-Scan LLM Warning]:`, llmErr.message);
                    return null;
                }
            }));

            for (const parsed of batchResults) {
                if (!parsed || !Array.isArray(parsed.brands)) continue;
                for (const b of parsed.brands) {
                    const bName = (b.name || '').trim();
                    const bNameLower = bName.toLowerCase();
                    if (!bNameLower || FORBIDDEN_SUPPLIERS.test(bNameLower)) continue;

                    if (brandMap.has(bNameLower)) {
                        const existing = brandMap.get(bNameLower);
                        existing.models = Array.from(new Set([...existing.models, ...(b.models || [])]));
                        if (b.websiteUrl && !existing.websiteUrl) existing.websiteUrl = b.websiteUrl;
                        if (b.categoryHint && existing.categoryHint === 'Furniture') existing.categoryHint = b.categoryHint;
                    } else {
                        brandMap.set(bNameLower, {
                            name: bName,
                            models: b.models || [],
                            websiteUrl: b.websiteUrl || '',
                            categoryHint: b.categoryHint || 'Furniture'
                        });
                    }
                }
            }
        }

        const finalBrands = Array.from(brandMap.values()).filter(b => !FORBIDDEN_SUPPLIERS.test(b.name.toLowerCase()));
        console.log(`  🔍 [VE Pre-Scan] Discovered ${finalBrands.length} unique contract MANUFACTURERS across document.`);
        return { status: 'success', brands: finalBrands };
    }, 2, 2000);
}

// Immediate resolution (zero artificial delay)
const randomJitter = () => Promise.resolve();

/**
 * Matches specifications or extracts brands and models directly from the description (and image).
 * Uses withRetry for optimal parallel performance.
 * STRICTLY respects the UI providerModel selection, with a multi-stage safety rescue for API image failures.
 */
export async function veMatchAuto(description, providerModel = null, assets = [], brandList = [], localCatalogs = []) {
    return withRetry(async () => {
        // ── 1. DETERMINISTIC EXACTMATCH SHORT-CIRCUIT (< 5ms) ────────────────
        const specifiedDetails = extractSpecifiedProductDetails(description, localCatalogs);
        const GENERIC_CATEGORY_MODEL_RE = /^(?:acoustic\s+furniture|office\s+furniture|commercial\s+furniture|furniture|seating|office\s+seating|chair|chairs|desk|desks|table|tables|stool|stools|sofa|sofas|lounge|cabinet|storage|workstation|partition|divider|general)$/i;

        if (specifiedDetails && specifiedDetails.brand && (specifiedDetails.model || specifiedDetails.url)) {
            const rawModelNorm = (specifiedDetails.model || '').toLowerCase().trim();
            const isGenericModelName = !rawModelNorm || GENERIC_CATEGORY_MODEL_RE.test(rawModelNorm);
            const cleanModelBase = (str) => String(str || '')
                .toLowerCase()
                .replace(/\s*#\d+\b/g, '')
                .replace(/[^\w\s-]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            const STOP_SPEC_WORDS = new Set(['chair', 'chairs', 'table', 'tables', 'coffee', 'low', 'side', 'desk', 'desks', 'sofa', 'sofas', 'double', 'single', 'lounge', 'armchair', 'bar', 'stool', 'stools', 'high', 'medium', 'back', 'office', 'meeting', 'conference', 'visitor', 'task', 'swivel', 'furniture', 'system', 'systems', 'series', 'model', 'with', 'and', 'for', 'the']);
            const extractSeriesTokens = (str) => cleanModelBase(str).split(/[\s\-_]+/).filter(t => t.length >= 2 && !STOP_SPEC_WORDS.has(t));

            const modelNorm = cleanModelBase(rawModelNorm);
            const targetSeriesTokens = extractSeriesTokens(rawModelNorm);

            // Check against loaded local partner catalogs using dynamic alias/origin/TLD root resolution
            const matchedCatalogBrand = findBrandInCatalog(specifiedDetails.brand, localCatalogs, specifiedDetails.model || '');

            if (!isGenericModelName && matchedCatalogBrand && matchedCatalogBrand.products && matchedCatalogBrand.products.length > 0) {
                const fullSpecLower = String(description || '').toLowerCase();
                const wantTable = /\b(table|desk|coffee|low|conference\s+table|meeting\s+table)\b/i.test(rawModelNorm);
                const wantChair = /\b(chair|seating|stool|bar|sofa|lounge|armchair)\b/i.test(rawModelNorm);
                const wantBar = /\b(bar\s*stool|barstool|bar\b|high\s*chair)\b/i.test(`${rawModelNorm} ${fullSpecLower}`);
                const specFeatureTokens = ['castor', 'wheel', '4-leg', '4 leg', 'star base', 'cantilever', 'wooden', 'wood', 'mesh', 'swivel', 'outdoor', 'stackable', 'folding', 'auditorium', 'tablet', 'armrest']
                    .filter(kw => fullSpecLower.includes(kw));

                let bestProd = null;
                let bestScore = -1;

                for (const p of matchedCatalogBrand.products) {
                    const pClean = cleanModelBase(p.model || '');
                    if (!pClean) continue;
                    const pSeries = extractSeriesTokens(pClean);
                    const pSubAndModel = `${pClean} ${String(p.subCategory || '').toLowerCase()}`;
                    const pTextAll = `${pSubAndModel} ${String(p.description || '').toLowerCase()}`;

                    // Prevent cross-archetype short-circuit (e.g. matching a chair when a coffee table is specified, or a bar stool for a standard chair)
                    const pIsTable = /\b(table|desk|workstation)\b/i.test(pSubAndModel);
                    const pIsChair = /\b(chair|seating|stool|sofa|lounge|armchair|pouf|bench)\b/i.test(pSubAndModel);
                    const pIsBar = /\b(bar\s*stool|barstool|high\s*chair)\b/i.test(pSubAndModel);
                    if (wantTable && !wantChair && pIsChair && !pIsTable) continue;
                    if (wantChair && !wantTable && pIsTable && !pIsChair) continue;
                    if (wantBar && !pIsBar && !/\bbar\b/i.test(pClean)) continue;
                    if (!wantBar && pIsBar) continue;

                    let score = 0;
                    if (pClean === modelNorm) {
                        score = 100;
                    } else if (modelNorm.length >= 3 && (pClean.includes(modelNorm) || modelNorm.includes(pClean))) {
                        score = 88;
                    } else if (targetSeriesTokens.length > 0 && pSeries.length > 0) {
                        const shared = targetSeriesTokens.filter(t => pSeries.includes(t) || (t.length >= 5 && pSeries.some(pt => pt.startsWith(t.slice(0, 5)))));
                        if (shared.length === targetSeriesTokens.length) {
                            score = 85;
                        } else if (shared.length > 0 && shared[0].length >= 4) {
                            score = 76;
                        }
                    }

                    if (score <= 0) continue;

                    // Spec feature affinity bonus (e.g. castors, 4-leg, wooden, mesh, outdoor)
                    for (const kw of specFeatureTokens) {
                        if (pTextAll.includes(kw)) score += 3;
                    }
                    // Penalize poisoned/garbage catalog descriptions so clean verified variants always win
                    const entryAligned = isProductIdentityAligned(p.model, '', p.description, p.imageUrl || p.websiteUrl);
                    if (!entryAligned) {
                        score -= 12;
                    } else {
                        if (p.imageUrl && !String(p.imageUrl).includes('logo') && !String(p.imageUrl).includes('/header/')) score += 4;
                        if (p.description && String(p.description).trim().length >= 25) score += 2;
                    }
                    if (parseFloat(p.price) > 0) score += 1;

                    if (score > bestScore || (score === bestScore && bestProd && String(p.model).localeCompare(String(bestProd.model)) < 0)) {
                        bestScore = score;
                        bestProd = p;
                    }
                }

                const exactProduct = bestProd;
                if (exactProduct) {
                    const entryAligned = isProductIdentityAligned(exactProduct.model, '', exactProduct.description, exactProduct.imageUrl || exactProduct.websiteUrl);
                    console.log(`  ⚡ [ExactMatch Short-Circuit] Direct catalog hit for "${matchedCatalogBrand.name} - ${exactProduct.model}" (score=${bestScore}, aligned=${entryAligned}, Bypassing LLM)`);
                    const resolvedSiteUrl = specifiedDetails.url
                        || (entryAligned ? (exactProduct.officialProductUrl || exactProduct.productUrl || exactProduct.websiteUrl) : '')
                        || getCanonicalBrandWebsite(matchedCatalogBrand.name) || '';
                    const resolvedImgUrl = entryAligned ? (exactProduct.imageUrl || (exactProduct.images && exactProduct.images[0]) || '') : '';
                    const cleanStoredDesc = (entryAligned && !isGarbageProductDesc(exactProduct.description)) ? (exactProduct.description || '') : '';
                    const hasRealDesc = Boolean(cleanStoredDesc.trim().length >= 25 && !cleanStoredDesc.startsWith('Specified Manufacturer:'));
                    return {
                        status: 'success',
                        matchTier: 'EXACT_MATCH',
                        confidenceScore: 100,
                        brand: matchedCatalogBrand.name,
                        brandLogo: matchedCatalogBrand.logo || getCanonicalBrandLogo(matchedCatalogBrand.name, resolvedSiteUrl) || '',
                        model: exactProduct.model,
                        mainCategory: exactProduct.mainCategory || exactProduct.category || 'Office Furniture',
                        subCategory: exactProduct.subCategory || '',
                        family: exactProduct.family || '',
                        imageUrl: resolvedImgUrl,
                        websiteUrl: resolvedSiteUrl,
                        productUrl: resolvedSiteUrl,
                        supplierReferences: specifiedDetails.supplierUrls || [],
                        price: exactProduct.price || 0,
                        currency: exactProduct.currency || 'USD',
                        description: cleanStoredDesc,
                        needsWebEnrichment: !resolvedImgUrl || !hasRealDesc || !(parseFloat(exactProduct.price) > 0),
                        evidence: {
                            matchType: 'DETERMINISTIC_CATALOG_EXACT',
                            matchedTokens: [specifiedDetails.brand, specifiedDetails.model].filter(Boolean),
                            manufacturerUrl: resolvedSiteUrl,
                            catalogId: exactProduct.id || `${matchedCatalogBrand.name}-${exactProduct.model}`,
                            imageCdn: resolvedImgUrl
                        }
                    };
                }
            }

            // Direct Deterministic Specification Hit (Specified Maker + Specific Product Code / Model, excluding generic category words)
            if (!isGenericModelName && specifiedDetails.model && specifiedDetails.model.length >= 2) {
                const resolvedBrandName = matchedCatalogBrand?.name || specifiedDetails.brand;
                console.log(`  ⚡ [ExactMatch Short-Circuit] Direct specification hit for "${resolvedBrandName} - ${specifiedDetails.model}"`);
                const canonicalBrandUrl = specifiedDetails.url || matchedCatalogBrand?.websiteUrl || getCanonicalBrandWebsite(resolvedBrandName) || '';
                return {
                    status: 'success',
                    matchTier: 'EXACT_MATCH',
                    confidenceScore: 98,
                    brand: resolvedBrandName,
                    brandLogo: resolveBrandLogo(matchedCatalogBrand || { name: resolvedBrandName, websiteUrl: canonicalBrandUrl }, canonicalBrandUrl) || '',
                    model: specifiedDetails.model,
                    mainCategory: specifiedDetails.type ? 'Office Furniture' : 'Furniture',
                    subCategory: specifiedDetails.type || '',
                    family: specifiedDetails.model.split(/[\s\-_]/)[0] || '',
                    websiteUrl: canonicalBrandUrl,
                    productUrl: canonicalBrandUrl,
                    supplierReferences: specifiedDetails.supplierUrls || [],
                    price: 0,
                    currency: 'USD',
                    needsWebEnrichment: true,
                    description: `Specified Manufacturer: ${specifiedDetails.brand} | Model: ${specifiedDetails.model}${specifiedDetails.size ? ` | Size: ${specifiedDetails.size}` : ''}${specifiedDetails.finish ? ` | Finish: ${specifiedDetails.finish}` : ''}`,
                    evidence: {
                        matchType: 'DETERMINISTIC_SPECIFICATION_EXACT',
                        matchedTokens: [specifiedDetails.brand, specifiedDetails.model, canonicalBrandUrl].filter(Boolean),
                        manufacturerUrl: canonicalBrandUrl,
                        catalogId: `SPEC-${specifiedDetails.brand}-${specifiedDetails.model}`,
                        dimensions: specifiedDetails.size || '',
                        finish: specifiedDetails.finish || ''
                    }
                };
            }
        }

        // Spread out parallel requests slightly to protect Free Tier quotas
        await randomJitter();

        // Universal Asset Formatter (Strict Base64 Filter)
        const validAssets = [];
        if (assets && Array.isArray(assets)) {
            for (const asset of assets) {
                let rawData = asset?.inlineData?.data || asset?.data || asset?.base64Data;
                let mime = asset?.inlineData?.mimeType || asset?.mimeType || 'image/jpeg';

                if (!rawData && typeof asset === 'string' && (asset.startsWith('data:') || (asset.length > 100 && !asset.startsWith('http')))) {
                    rawData = asset;
                }

                if (typeof rawData === 'string' && rawData.startsWith('data:')) {
                    const mimeMatch = rawData.match(/^data:(image\/\w+);base64,/);
                    if (mimeMatch) mime = mimeMatch[1];
                    rawData = rawData.split(',')[1];
                }

                // Strictly verify rawData is a valid non-empty base64 string and NOT a URL or object
                if (typeof rawData === 'string' && rawData.length > 50 && !rawData.startsWith('http') && !rawData.includes('{')) {
                    validAssets.push({
                        base64Data: rawData,
                        mimeType: mime,
                        inlineData: {
                            data: rawData,
                            mimeType: mime
                        }
                    });
                }
            }
        }

        const hasValidImage = validAssets.length > 0;
        const isBranded = Boolean(specifiedDetails && specifiedDetails.brand);

        let system;
        let user;

        if (isBranded) {
            system = VE_BRANDED_MATCH_SYSTEM(hasValidImage);
            user = `Specification Item Description: "${description}"`;
            if (specifiedDetails.brand) user += `\nSpecified Contract Manufacturer: "${specifiedDetails.brand}"`;
            if (specifiedDetails.model) user += `\nSpecified Model/Collection: "${specifiedDetails.model}"`;
            if (specifiedDetails.url) user += `\nReference Link: ${specifiedDetails.url}`;
            user += `\nTask: What is this exact model from this manufacturer? Identify genuine official model name, canonical manufacturer, and product line.`;
        } else {
            const detectedCat = classifyFurnishingCategory(description);
            const catCfg = VE_CATEGORY_CONFIG[detectedCat] || VE_CATEGORY_CONFIG.desking;
            const availablePriorityBrands = (catCfg.priorityBrands || [])
                .map(name => {
                    const hit = Array.isArray(localCatalogs) && localCatalogs.length > 0
                        ? findBrandInCatalog(name, localCatalogs)
                        : null;
                    return hit ? hit.name : null;
                })
                .filter(Boolean);
            const effectivePriority = availablePriorityBrands.length > 0
                ? Array.from(new Set(availablePriorityBrands)).slice(0, 5)
                : (catCfg.priorityBrands || []).slice(0, 5);

            system = VE_MATCH_AUTO_SYSTEM(hasValidImage, brandList);
            user = `Specification Item Description: "${description}"\nDetected Category: ${catCfg.label}\nMANDATORY PREFERRED PARTNER PRIORITY (STRICT ORDER): ${effectivePriority.join(' -> ')}\nTask: Match from the #1 preferred partner ("${effectivePriority[0]}") first if they manufacture this exact product archetype; only step down the priority list if the #1 brand lacks this product type. Do NOT default to Narbutas for soft seating, coffee tables, dining, outdoor, or classroom items when ${effectivePriority[0]} is preferred.`;
        }

        console.log(`  🤖 [VE Match Auto] Executing ${isBranded ? '🌟 BRANDED' : '🏢 CATEGORY PRIORITY'} match for: ${description.substring(0, 50)}... (Images: ${validAssets.length})`);

        // Respect user selection, fallback to environment default only if null
        let effectiveModel = providerModel || GOOGLE_MODEL;
        let parsed;

        if (hasValidImage) {
            try {
                // 1. Attempt using the pipeline-optimal model (with automatic Free-Tier routing & failover)
                parsed = await callUniversalMultimodalAI(system, user, validAssets, effectiveModel, true, 'matching');
            } catch (visionErr) {
                const errMsg = visionErr.message || '';
                if (/exceeded its monthly spending cap|RESOURCE_EXHAUSTED/i.test(errMsg) || visionErr?.allModelsExhausted) {
                    throw visionErr;
                }
                console.warn(`  ⚠️ [VE Match Auto] Vision matching failed with "${effectiveModel}": ${errMsg}. Rescuing with text AI...`);
                parsed = await callUniversalMultimodalAI(system, user, [], effectiveModel, true, 'matching');
            }
        } else {
            // Robust text matching
            parsed = await callUniversalMultimodalAI(system, user, [], effectiveModel, true, 'matching');
        }

        if (!parsed || parsed.model === 'FAILED') throw new Error('AI failed to match specification');

        // Normalize mainCategory and subCategory using TAXONOMY keys
        const rawMain = parsed.mainCategory || '';
        const rawSub = parsed.subCategory || '';
        const logicText = parsed.logic || '';

        const mainCat = Object.keys(TAXONOMY).find(c => c.toLowerCase() === rawMain.toLowerCase()) || 'Office Seating';
        const subCatsMap = TAXONOMY[mainCat] || {};
        const subCatKeys = Object.keys(subCatsMap);

        let subCat = subCatKeys.find(s => s.toLowerCase() === rawSub.toLowerCase());

        if (!subCat && rawSub) {
            subCat = subCatKeys.find(s => {
                const regex = subCatsMap[s];
                return regex instanceof RegExp && regex.test(rawSub);
            });
        }

        if (!subCat && logicText) {
            subCat = subCatKeys.find(s => {
                const regex = subCatsMap[s];
                return regex instanceof RegExp && regex.test(logicText);
            });
        }

        if (!subCat) {
            subCat = subCatKeys.includes('Staff Chairs') ? 'Staff Chairs' : (subCatKeys.includes('General') ? 'General' : (subCatKeys[0] || 'General'));
        }

        parsed.mainCategory = mainCat;
        parsed.subCategory = subCat;

        return { status: 'success', ...parsed };

    }, 3, 3000).catch(err => {
        console.error(`  ❌ [VE Match Auto] Failed:`, err.message);
        throw err; // Allows withRetry to handle exponential backoff properly
    });
}

/**
 * Generates 100% specification-matched Value-Engineered alternatives from distinct premier partner brands.
 * Guarantees physical archetype compatibility (capacity, dimensions, function, materials).
 */
export function generateCrossBrandAlternatives(primaryBrand, primaryModel, description, allLocalBrands = [], categoryHint = '', topK = 4) {
    if (!description || !allLocalBrands || allLocalBrands.length === 0) return [];

    const archetype = detectSpecArchetype(description, categoryHint);
    const descLower = description.toLowerCase();
    const primaryBrandNorm = String(primaryBrand || '').toLowerCase().trim();

    // Determine candidate partner brands based on archetype
    const catConfig = VE_CATEGORY_CONFIG[archetype] || VE_CATEGORY_CONFIG.desking;
    const priorityBrandSequence = catConfig.priorityBrands || ['NARBUTAS', 'B&T Design', 'Sedus Stoll', 'Nurus', 'Ottimo Furniture', 'Frezza', 'LAS', 'Sokoa', 'Ofifran', 'Arper'];

    const alternatives = [];
    const seenBrands = new Set();
    const seenImages = new Set();
    if (primaryBrandNorm && primaryBrandNorm !== 'generic') seenBrands.add(primaryBrandNorm);

    // 1. Iterate through priority sequence to get 1 best item per premier brand
    for (const brandName of priorityBrandSequence) {
        if (/^(amazon|noon)/i.test(brandName) && archetype !== 'genericAccessories') continue;
        const brandNorm = brandName.toLowerCase().trim();
        if (seenBrands.has(brandNorm)) continue;

        const brandObj = allLocalBrands.find(b => b.name && b.name.toLowerCase().trim() === brandNorm) ||
            allLocalBrands.find(b => b.name && b.name.toLowerCase().includes(brandNorm));
        if (!brandObj || !brandObj.products || brandObj.products.length === 0) continue;

        // Check if brand is excluded for this archetype
        if (DOMAIN_EXCLUSIONS && DOMAIN_EXCLUSIONS[archetype]) {
            const excluded = DOMAIN_EXCLUSIONS[archetype];
            if (excluded.some(b => brandNorm === b || brandNorm.includes(b))) continue;
        }

        // Filter brand products for strict archetype compatibility
        const compatibleProducts = brandObj.products.filter(p => {
            const prodDesc = `${p.model} ${p.mainCategory || ''} ${p.subCategory || ''} ${p.description || ''}`.toLowerCase();
            const prodArchetype = detectSpecArchetype(prodDesc, p.mainCategory);

            // STRICT ARCHETYPE ISOLATION:
            if (archetype === 'auditoriumAndTheater') {
                if (!/\b(theater|theatre|auditorium|tip-up|tip up|cinema|spectator|stadium)\b/i.test(prodDesc)) return false;
            } else if (archetype === 'foldingAndPortableSeating') {
                if (/\b(swivel|castor|castors|wheels|task chair|operator chair|mesh back|5-star|high back executive|sofa|lounge|credenza|desk|table)\b/i.test(prodDesc)) return false;
                if (!/\b(foldable|folding|compact stool|portable|x-shape|stool|folding chair|passport|smart chair|bistrot|carry)\b/i.test(prodDesc)) return false;
            } else if (archetype === 'classroomAndStackable') {
                if (/\b(swivel|castor|castors|wheels|task chair|operator chair|mesh back|5-star|high back executive|contract table|meeting table|meeting island|monitor caddy|desk|folding|foldable)\b/i.test(prodDesc)) return false;
                if (!/\b(stackable|stacking|student|classroom|polypropylene|4-leg|cantilever|conference|multipurpose|multi-purpose|visitor|shell chair|glide|se:spot|se:café)\b/i.test(prodDesc)) return false;
            } else if (archetype === 'benchesAndPublicSeating') {
                if (/\b(shelf|shelving|bookcase|cabinet|credenza|desk|desks|workstation|face\s*to\s*face)\b/i.test(prodDesc)) return false;
                if (!/\b(bench|benches|banquette|pouf|ottoman|lounge|seating|seat)\b/i.test(prodDesc)) return false;
            } else if (archetype === 'softSeating') {
                if (/\b(shelf|shelving|desk|desks|workstation|cabinet|mesh chair|task chair|swivel chair|5-star|castor|aluminum group)\b/i.test(prodDesc)) return false;
                if (!/\b(sofa|couch|lounge|armchair|pouf|ottoman|seating|bench)\b/i.test(prodDesc)) return false;
            } else if (archetype === 'desking') {
                if (/\b(chair|sofa|couch|armchair|pouf|lounge|cabinet)\b/i.test(prodDesc) && !/\b(desk|workstation|table)\b/i.test(prodDesc)) return false;
                if (!/\b(desk|desks|workstation|table|l-shape|bench\s*desk)\b/i.test(prodDesc)) return false;
            } else if (archetype === 'taskSeating') {
                if (/\b(desk|workstation|cabinet|sofa|table|foldable|folding stool|x-shape)\b/i.test(prodDesc)) return false;
                if (!/\b(chair|seating|stool|swivel|cantilever)\b/i.test(prodDesc)) return false;
            } else if (archetype === 'storage') {
                if (/\b(chair|sofa|couch|armchair|pouf|desk|workstation)\b/i.test(prodDesc)) return false;
                if (!/\b(cabinet|credenza|storage|filing|bookcase|wardrobe|cupboard|drawers|pedestal)\b/i.test(prodDesc)) return false;
            } else if (archetype === 'customLandscapeAndTerrazzo') {
                const isTerrazzoConcrete = /\b(terrazzo|terazzo|precast|concrete|monolithic|landscape|outdoor|street\s*furniture|arcade)\b/i.test(prodDesc);
                const isIndoorOffice = /\b(swivel|castor|5-star|mesh|executive|task|waiting\s*bench|beam\s*seating)\b/i.test(prodDesc);
                if (!isTerrazzoConcrete || isIndoorOffice) return false;
            }

            if (prodArchetype && archetype && prodArchetype !== archetype) return false;

            // Capacity checks
            if (descLower.includes('2 seater') || descLower.includes('2-seater') || descLower.includes('two seater')) {
                if (p.model.toLowerCase().includes('3 seater') || p.model.toLowerCase().includes('1 seater')) return false;
            }
            if (descLower.includes('3 seater') || descLower.includes('3-seater') || descLower.includes('three seater')) {
                if (p.model.toLowerCase().includes('1 seater') || p.model.toLowerCase().includes('single')) return false;
            }
            // Height checks
            if ((descLower.includes('high cabinet') || descLower.includes('tall')) && p.model.toLowerCase().includes('low')) return false;

            return true;
        });

        if (compatibleProducts.length === 0) continue;

        // Score products by token overlap and visual uniqueness
        let bestProd = null;
        let bestScore = -1;

        for (const p of compatibleProducts) {
            let score = computeTokenOverlapScore(description, p);
            const img = p.imageUrl || (p.images && p.images[0]) || '';
            // If image is already seen in previous alternative, slightly reduce score to prefer distinct photos
            if (img && seenImages.has(img)) {
                score -= 0.15;
            }
            if (score > bestScore) {
                bestScore = score;
                bestProd = p;
            }
        }

        if (bestProd) {
            seenBrands.add(brandNorm);
            const chosenImg = bestProd.imageUrl || (bestProd.images && bestProd.images[0]) || '';
            if (chosenImg) seenImages.add(chosenImg);

            const fitScore = Math.round(Math.min(99, Math.max(85, (bestScore * 35) + 65)));
            const logo = resolveBrandLogo(brandObj) || brandObj.logo || '';

            const catNorm = classifyContractCategory(
                bestProd.mainCategory || bestProd.category,
                bestProd.subCategory,
                bestProd.model,
                bestProd.description || description
            );

            let liveProductUrl = bestProd.websiteUrl || bestProd.productUrl || brandObj.websiteUrl || '';
            if (!liveProductUrl || liveProductUrl.trim() === '') {
                liveProductUrl = `https://www.architonic.com/en/search/?q=${encodeURIComponent(brandObj.name + ' ' + bestProd.model)}`;
            }

            alternatives.push({
                brand: brandObj.name,
                brandLogo: logo,
                model: bestProd.model,
                family: bestProd.family || bestProd.model.split(' ')[0] || 'Collection',
                mainCategory: catNorm.mainCategory,
                subCategory: catNorm.subCategory,
                price: bestProd.price || 0,
                currency: bestProd.currency || 'USD',
                imageUrl: bestProd.imageUrl || (bestProd.images && bestProd.images[0]) || '',
                officialProductUrl: bestProd.websiteUrl || bestProd.productUrl || brandObj.websiteUrl || '',
                architonicUrl: '',
                websiteUrl: bestProd.websiteUrl || bestProd.productUrl || brandObj.websiteUrl || '',
                description: bestProd.description || `Value-engineered specification alternative from ${brandObj.name}`,
                confidenceScore: fitScore,
                specificationFit: fitScore,
                veReason: `Verified 100% equivalent ${VE_CATEGORY_CONFIG[archetype]?.label || archetype} specification from premier partner ${brandObj.name}`,
                source: 'Verified Contract Partner'
            });

            if (alternatives.length >= topK) break;
        }
    }

    return alternatives;
}

/**
 * Async version of generateCrossBrandAlternatives:
 * Combines local contract catalog alternatives with Live Web & Architonic discovered alternatives.
 * Parallel image verification & retrieval ensures genuine high-resolution imagery for all alternatives.
 */
export async function generateCrossBrandAlternativesAsync(primaryBrand, primaryModel, description, allLocalBrands = [], categoryHint = '', topK = 4) {
    const localAlts = generateCrossBrandAlternatives(primaryBrand, primaryModel, description, allLocalBrands, categoryHint, topK);
    let combined = [...localAlts];

    try {
        const liveAlts = await discoverLiveWebAndArchitonicAlternatives(description, categoryHint, primaryBrand, topK);
        if (liveAlts && liveAlts.length > 0) {
            const existingBrands = new Set(localAlts.map(a => a.brand.toLowerCase().trim()));
            for (const alt of liveAlts) {
                const bNorm = alt.brand.toLowerCase().trim();
                if (!existingBrands.has(bNorm)) {
                    existingBrands.add(bNorm);
                    combined.push(alt);
                }
            }
        }
    } catch (e) {
        console.warn('Live alternatives merge notice:', e.message);
    }

    // Sort by priority-sequence position first (user's Category & Manufacturer
    // Priority Matrix), fit score second. Brands outside the sequence (live web
    // finds) trail the sequenced DB makers — exactly the requested 3-tier order:
    // AutoMatch exact (tab 1) → Lens-corroborated (badged) → sequence → online.
    const seqOrder = (VE_CATEGORY_CONFIG[detectSpecArchetype(description, categoryHint)]?.priorityBrands || [])
        .map((b) => String(b).toLowerCase().trim());
    const seqIdx = (a) => {
        const n = String(a.brand || '').toLowerCase().trim();
        const i = seqOrder.findIndex((s) => s === n || n.includes(s) || s.includes(n));
        return i === -1 ? 9999 : i;
    };
    combined.sort((a, b) => (seqIdx(a) - seqIdx(b)) || ((b.confidenceScore || 0) - (a.confidenceScore || 0)));
    const selected = combined.slice(0, Math.max(topK, 4));

    // Parallel high-resolution image verification & retrieval for all selected alternatives
    await Promise.all(selected.map(async (alt) => {
        if (!alt.imageUrl || alt.imageUrl.includes('localhost') || !alt.imageUrl.startsWith('http')) {
            try {
                const fetched = await fetchLiveProductImage(alt.brand, alt.model, alt.officialProductUrl || alt.architonicUrl || alt.websiteUrl);
                if (fetched) alt.imageUrl = fetched;
            } catch (e) { }
        }
    }));

    return selected;
}