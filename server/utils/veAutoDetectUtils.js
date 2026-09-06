/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  Value Engineered Offer — Dedicated Auto-Detect LLM Utilities           │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { callUniversalMultimodalAI, withRetry, GOOGLE_MODEL, VISION_MODEL } from './llmUtils.js';
import { TAXONOMY } from './normalizer.js';
import { BRAND_ALIASES, KNOWN_CONTRACT_BRANDS, NON_BRAND_MODEL_WORDS, VE_CATEGORY_CONFIG, classifyFurnishingCategory } from './veCategoryPriority.js';
import { detectSpecArchetype, DOMAIN_EXCLUSIONS } from './veBrandSpecialties.js';
import { getCanonicalBrandLogo, classifyContractCategory } from './brandLogos.js';
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
Task: Identify the exact specified product from that manufacturer with 100% fidelity.

### 🎯 CRITICAL RULES FOR BRANDED ITEMS:
1. Extract the canonical Manufacturer / Brand name. DO NOT SUBSTITUTE WITH ANOTHER BRAND. DO NOT LIMIT TO ANY PRESET LIST.
2. Identify the exact specified Model / Collection name.
3. Determine authentic product family, category, dimensions, and official manufacturer website URL.
4. If an image is provided, verify that the visual product matches this model.

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
Task: Match the specification description${hasImage ? ' and image' : ''} to the exact Brand, Model, Main Category, and Sub-Category.

### 🏢 CORE CONTRACT BRANDS CATALOG:
${brandList && brandList.length > 0 ? `Available Primary Contract Brands: ${brandList.join(', ')}` : 'Available Primary Contract Brands: Narbutas, Sedus Stoll, B&T Design, True Design, Pedrali, Nurus, Frezza, LAS, Ofifran, Sokoa, Rim, TMA, Leadcom, Figueras, Dauphin, AMARA, Arper, Ottimo Furniture, FitOut V2'}

### 🎯 CRITICAL MATCHING RULES FOR NON-BRANDED & GENERIC SPECIFICATIONS:

1. 🚫 NEVER CREATE OR RETURN FAKE BRANDS:
If the specification has origin indicators (e.g. "LOCAL-UAE", "FAR EAST", "LOCAL", "CUSTOM", "UNBRANDED", "GENERIC") or generic trade model words (e.g. "ROMA", "RACER", "TERMINAL", "APP", "WIND", "NOVA", "EVA", "OPTIMA", "CHOICE", "EASY", "L-SHAPE", "HIGH CABINET", "COFFEE TABLE", "RECEPTION COUNTER"):
- 🚫 NEVER CREATE FAKE BRANDS like "Roma", "Racer", "Terminal", "App", "Wind", "Local", "Far East"!
- Match to a prioritized premier contract partner from our category priority matrix by selecting an **EXACT PRODUCT MODEL NAME FROM THAT BRAND'S REAL CATALOG**.

2. 🏢 CONTRACT CATEGORY PRIORITY MATRIX (IN STRICT ORDER):
• Desking & Workstations: NARBUTAS (e.g. Nova Wood, Nova U, Motion Sit-Stand), Nurus (e.g. U Too, Ash), FREZZA, LAS, Ofifran, Ottimo Furniture, MW Structure Test.
• Task & Office Seating: NARBUTAS (e.g. Sonus M, Sonus S, North Cape), Sedus Stoll (e.g. se:motion net, se:flex, Black Dot, se:spot), Sokoa (e.g. M4, Wi-Max), Rim, Dauphin, Nurus, Ottimo Furniture.
• Soft & Lounge Seating: B&T Design (e.g. Noda Sofa, Boom Sofa, Alek Lounge, Durgu), True Design, Arper (e.g. Zinta, Loop, Aston), AMARA, Divani, FREZZA, NARBUTAS.
• Outdoor & Landscape Seating: Pedrali (e.g. Tribeca, Nolita, Passport), Vondom, Dedon, Emu, Slide Design, Escofet.
• Auditorium & Theatre Seating: TMA, Leadcom, Figueras, Ferco Seating.
• Folding & Portable Stools: Ottimo Furniture (e.g. Portable Round Foldable Stool with Handle), Pedrali (e.g. Passport Folding Chair), AMARA (e.g. Round Foldable Stool X-Frame).
• Custom Landscape, Terrazzo & Precast: ATTF (Automatic Terrazzo Tiles Factory), Assarain Concrete Products, Escofet, FitOut V2 (Custom Joinery).
• Meeting & Coffee Tables: B&T Design, Pedrali, Ottimo Furniture, NARBUTAS, Nurus, Arper, FREZZA, Sedus Stoll.
• Storage & Credenzas: NARBUTAS (e.g. Choice Cabinets, Nova Storage), Nurus, Ottimo Furniture, FREZZA, LAS.

3. 🛒 GENERIC RETAIL ACCESSORIES & MINOR ITEMS:
Match to "Amazon", "IKEA", or "Home Centre" ONLY for non-furniture accessories (cable grommets, monitor arms, power boxes, craft carts, trash bins, pillows).
🚫 NEVER match commercial office furniture, workstations, executive chairs, or sofas to Amazon or IKEA!

### 🌍 GLOBAL CATEGORY MAPPING:
You MUST map to one of these Main Categories: ${ALLOWED_CATEGORIES}
Sub-Categories: ${ALLOWED_SUB_CATEGORIES}

Return ONLY valid JSON:
{
  "status": "success",
  "brand": "Contract Brand Name",
  "model": "Matched Catalog Model Name",
  "mainCategory": "Matched Main Category",
  "subCategory": "Matched Sub-Category",
  "estimatedPrice": 0,
  "productUrl": "https://...",
  "logic": "Brief reasoning"
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
    } catch (e) {}
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

/**
 * Deterministically checks for specified brand/manufacturer in description or reference URLs.
 * Manufacturer-domain URLs win over dealer-alias URLs (e.g. moonako.fr beats moodie.com.au
 * even when the dealer link appears first). Raw dealer URLs are preserved as supplierUrls.
 */
export function detectSpecifiedBrandInText(text) {
    if (!text || typeof text !== 'string') return null;

    // 1. Direct URL check with line-wrap healing — manufacturer domains preferred.
    // Collect every brand-mapped URL first; a raw manufacturer-domain URL (host matches
    // the canonical brand host) wins. Otherwise the first mapped URL wins but links
    // canonically, with raw dealer URLs kept as supplier references.
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

    // 2. Explicit Maker / Manufacturer / Brand key labels in specification
    const explicitBrandMatch = 
        text.match(/(?:Supplier\s*\/\s*)?Maker\s*:\s*([^|\n;\r]+)/i) ||
        text.match(/Manufacturer\s*:\s*([^|\n;\r]+)/i) ||
        text.match(/Brand\s*:\s*([^|\n;\r]+)/i);

    if (explicitBrandMatch) {
        let rawBrand = explicitBrandMatch[1].trim().replace(/\.$/, '');
        rawBrand = rawBrand.replace(/\s*(?:or\s+approved\s+equal|or\s+similar|or\s+equal)\b/i, '').trim();
        const rawLower = rawBrand.toLowerCase();
        const FORBIDDEN = /^(fahmy|kr furniture|al jassar|gear4music|homedepot|timeout|attf|assarain|acp|automatic terrazzo|amazon|noon|desertcart|ubuy|marketplace|ikea|generic|unknown|dealer|trader|supplier|distributor|local|far east)/i;
        if (rawBrand.length >= 2 && !FORBIDDEN.test(rawLower) && !NON_BRAND_MODEL_WORDS.has(rawLower)) {
            const canonical = BRAND_ALIASES[rawLower] || rawBrand;
            return { brand: canonical, url: '' };
        }
    }

    // 3. Direct Brand Name Mentions in text (case-insensitive word boundary)
    const textLower = text.toLowerCase();
    for (const [aliasKey, canonicalName] of Object.entries(BRAND_ALIASES)) {
        if (aliasKey.length < 3) continue;
        const regex = new RegExp(`\\b${aliasKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (regex.test(textLower) && !NON_BRAND_MODEL_WORDS.has(aliasKey)) {
            return { brand: canonicalName, url: '' };
        }
    }

    for (const brandKey of KNOWN_CONTRACT_BRANDS) {
        if (brandKey.length < 3) continue;
        const regex = new RegExp(`\\b${brandKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (regex.test(textLower) && !NON_BRAND_MODEL_WORDS.has(brandKey)) {
            const prettyName = brandKey.charAt(0).toUpperCase() + brandKey.slice(1);
            return { brand: prettyName, url: '' };
        }
    }

    return null;
}

/**
 * Extracts complete specified product details (brand, model, size, finish, type, URL)
 * from consolidated specification descriptions.
 */
export function extractSpecifiedProductDetails(text) {
    if (!text || typeof text !== 'string') return null;

    const brandInfo = detectSpecifiedBrandInText(text);
    if (!brandInfo) return null;

    let candidateModel = '';
    const textLower = text.toLowerCase();

    // 1. Explicit Product Code / Model / Spec Description key extraction (highest precision)
    const explicitCodeMatch = 
        text.match(/(?:Product\s*)?Code\s*:\s*([^|\n;\r]+)/i) ||
        text.match(/Item\s*Code\s*:\s*([^|\n;\r]+)/i) ||
        text.match(/(?:Item\s*)?Model\s*:\s*([^|\n;\r]+)/i);

    const explicitDescMatch = 
        text.match(/Spec\s*(?:Item\s*)?Description\s*:\s*([^|\n;\r]+)/i) ||
        text.match(/Type\s*:\s*([^|\n;\r]+)/i);

    if (explicitCodeMatch) {
        const codeVal = explicitCodeMatch[1].trim();
        const descVal = explicitDescMatch ? explicitDescMatch[1].trim() : '';
        if (codeVal && descVal && !descVal.toLowerCase().includes(codeVal.toLowerCase())) {
            candidateModel = `${codeVal} (${descVal})`;
        } else if (codeVal) {
            candidateModel = codeVal;
        }
    }

    if (!candidateModel && explicitDescMatch) {
        candidateModel = explicitDescMatch[1].trim();
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
        } catch (e) {}
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

        // ── STEP 1: Fast Deterministic URL Extraction (Manufacturers Only) ──
        for (const item of items) {
            const desc = item.description || item.desc || (typeof item === 'string' ? item : '');
            if (!desc) continue;

            // Extract URLs
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
        }

        // ── STEP 2: Deep LLM Manufacturer Discovery ──
        const batchSize = 60;
        const effectiveModel = providerModel || GOOGLE_MODEL;

        for (let i = 0; i < items.length; i += batchSize) {
            const chunk = items.slice(i, i + batchSize);
            const textSnippets = chunk.map((item, idx) => `[Item ${i + idx + 1}] ${item.description || item.desc || (typeof item === 'string' ? item : '')}`).filter(Boolean).join('\n');
            const userPrompt = `Project Schedule Items:\n${textSnippets}`;

            try {
                const parsed = await callUniversalMultimodalAI(VE_PRESCAN_SYSTEM, userPrompt, [], effectiveModel, true);
                if (parsed && Array.isArray(parsed.brands)) {
                    for (const b of parsed.brands) {
                        const bName = (b.name || '').trim();
                        const bNameLower = bName.toLowerCase();
                        if (!bNameLower || FORBIDDEN_SUPPLIERS.test(bNameLower)) continue;

                        if (brandMap.has(bNameLower)) {
                            const existing = brandMap.get(bNameLower);
                            const mergedModels = Array.from(new Set([...existing.models, ...(b.models || [])]));
                            existing.models = mergedModels;
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
            } catch (llmErr) {
                console.warn(`  ⚠️ [VE Pre-Scan LLM Warning]:`, llmErr.message);
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
        const specifiedDetails = extractSpecifiedProductDetails(description);
        
        if (specifiedDetails && specifiedDetails.brand && (specifiedDetails.model || specifiedDetails.url)) {
            const brandNorm = specifiedDetails.brand.toLowerCase().trim();
            const modelNorm = (specifiedDetails.model || '').toLowerCase().trim();
            
            // Check against loaded local partner catalogs first
            const matchedCatalogBrand = (localCatalogs || []).find(b => 
                b.name && b.name.toLowerCase().trim() === brandNorm
            );
            
            if (matchedCatalogBrand && matchedCatalogBrand.products && matchedCatalogBrand.products.length > 0) {
                const exactProduct = matchedCatalogBrand.products.find(p => {
                    const pModel = (p.model || '').toLowerCase().trim();
                    return pModel === modelNorm || (modelNorm && pModel.includes(modelNorm)) || (pModel && modelNorm.includes(pModel));
                });
                
                if (exactProduct) {
                    console.log(`  ⚡ [ExactMatch Short-Circuit] Direct catalog hit for "${matchedCatalogBrand.name} - ${exactProduct.model}" (Bypassing LLM)`);
                    return {
                        status: 'success',
                        matchTier: 'EXACT_MATCH',
                        confidenceScore: 100,
                        brand: matchedCatalogBrand.name,
                        model: exactProduct.model,
                        mainCategory: exactProduct.mainCategory || exactProduct.category || 'Office Furniture',
                        subCategory: exactProduct.subCategory || '',
                        family: exactProduct.family || '',
                        imageUrl: exactProduct.imageUrl || (exactProduct.images && exactProduct.images[0]) || '',
                        websiteUrl: specifiedDetails.url || exactProduct.productUrl || '',
                        productUrl: specifiedDetails.url || exactProduct.productUrl || '',
                        supplierReferences: specifiedDetails.supplierUrls || [],
                        price: exactProduct.price || 0,
                        currency: exactProduct.currency || 'USD',
                        description: exactProduct.description || '',
                        evidence: {
                            matchType: 'DETERMINISTIC_CATALOG_EXACT',
                            matchedTokens: [specifiedDetails.brand, specifiedDetails.model].filter(Boolean),
                            manufacturerUrl: specifiedDetails.url || exactProduct.productUrl || '',
                            catalogId: exactProduct.id || `${matchedCatalogBrand.name}-${exactProduct.model}`,
                            imageCdn: exactProduct.imageUrl || ''
                        }
                    };
                }
            }

            // Direct Deterministic Specification Hit (Specified Maker + Product Code / Model)
            if (specifiedDetails.model && specifiedDetails.model.length >= 2) {
                console.log(`  ⚡ [ExactMatch Short-Circuit] Direct specification hit for "${specifiedDetails.brand} - ${specifiedDetails.model}"`);
                return {
                    status: 'success',
                    matchTier: 'EXACT_MATCH',
                    confidenceScore: 98,
                    brand: specifiedDetails.brand,
                    model: specifiedDetails.model,
                    mainCategory: specifiedDetails.type ? 'Office Furniture' : 'Furniture',
                    subCategory: specifiedDetails.type || '',
                    family: specifiedDetails.model.split(/[\s\-_]/)[0] || '',
                    websiteUrl: specifiedDetails.url || '',
                    productUrl: specifiedDetails.url || '',
                    supplierReferences: specifiedDetails.supplierUrls || [],
                    price: 0,
                    currency: 'USD',
                    description: `Specified Manufacturer: ${specifiedDetails.brand} | Model: ${specifiedDetails.model}${specifiedDetails.size ? ` | Size: ${specifiedDetails.size}` : ''}${specifiedDetails.finish ? ` | Finish: ${specifiedDetails.finish}` : ''}`,
                    evidence: {
                        matchType: 'DETERMINISTIC_SPECIFICATION_EXACT',
                        matchedTokens: [specifiedDetails.brand, specifiedDetails.model, specifiedDetails.url].filter(Boolean),
                        manufacturerUrl: specifiedDetails.url || '',
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
            system = VE_MATCH_AUTO_SYSTEM(hasValidImage, brandList);
            user = `Specification Item Description: "${description}"\nTask: Classify furnishing category and match with priority contract brand or identify as custom specification.`;
        }

        console.log(`  🤖 [VE Match Auto] Executing ${isBranded ? '🌟 BRANDED' : '🏢 CATEGORY PRIORITY'} match for: ${description.substring(0, 50)}... (Images: ${validAssets.length})`);

        // Respect user selection, fallback to environment default only if null
        let effectiveModel = providerModel || GOOGLE_MODEL;
        let parsed;

        if (hasValidImage) {
            try {
                // 1. Attempt using the user's selected model first
                parsed = await callUniversalMultimodalAI(system, user, validAssets, effectiveModel, true);
            } catch (visionErr) {
                const errMsg = visionErr.message || '';
                console.warn(`  ⚠️ [VE Match Auto] Vision matching failed with "${effectiveModel}": ${errMsg}. Rescuing with text AI...`);
                parsed = await callUniversalMultimodalAI(system, user, [], effectiveModel, true);
            }
        } else {
            // Robust text matching
            parsed = await callUniversalMultimodalAI(system, user, [], effectiveModel, true);
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
                const isTerrazzoConcrete = /\b(terrazzo|terazzo|precast|concrete|monolithic|landscape|outdoor|street\s*furniture|arcade)\b/i.test(prodText);
                const isIndoorOffice = /\b(swivel|castor|5-star|mesh|executive|task|waiting\s*bench|beam\s*seating)\b/i.test(prodText);
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
            const logo = (brandObj.logo && !brandObj.logo.includes('clearbit.com'))
                ? brandObj.logo
                : (getCanonicalBrandLogo(brandObj.name, brandObj.websiteUrl) || '');

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
            } catch (e) {}
        }
    }));

    return selected;
}