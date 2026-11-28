/**
 * Early Custom-Made / Fabrication Detector & Parametric Pricing Engine.
 * Detects bespoke millwork, joinery, reception counters, banquettes, oversized custom tables,
 * and feature walls early at Plan Extraction, BOQ Upload, VE Match, and Multi-Budget stages.
 */

import { detectSpecifiedBrandInText } from './veAutoDetectUtils.js';

const EXPLICIT_CUSTOM_PHRASES_RE = /\b(custom[\s\-]?made|bespoke|tailor[\s\-]?made|locally\s+fabricated|site[\s\-]?built|site[\s\-]?fabricated|built[\s\-]?in|as\s+per\s+(?:detail|drawing|design|shop\s*drawing|architect(?:ural)?\s*detail)|custom\s+joinery|millwork|carpentry\s+work|corian\s+(?:counter|vanity|reception)|solid\s+surface\s+(?:counter|vanity)|fluted\s+(?:mdf|oak|wood|timber)|cnc\s+(?:cut|perforated|screen)|hmr\s+mdf\s+with\s+(?:veneer|laminate|lacquer))\b/i;

const BESPOKE_TYPOLOGY_PATTERNS = [
  {
    key: 'reception',
    category: 'Reception Counter',
    dbKind: 'desk',
    dbSubtype: 'reception-counter',
    re: /\b(reception\s+(?:counter|desk)|concierge\s+(?:counter|desk)|security\s+desk|transaction\s+counter)\b/i,
    weight: 45,
  },
  {
    key: 'banquette',
    category: 'Banquette Seating',
    dbKind: 'sofa',
    dbSubtype: 'bench',
    re: /\b(banquette|booth\s+seating|built[-\s]?in\s+(?:bench|sofa|seating)|curved\s+(?:upholstered\s+)?bench(?:\s+seating)?|upholstered\s+(?:curved\s+)?bench(?:\s+seating)?|bench\s+seating|dining\s+booth|alcove\s+seating)\b/i,
    weight: 45,
  },
  {
    key: 'washroomVanity',
    category: 'Pantry & Vanity',
    dbKind: 'sanitary',
    dbSubtype: 'basin',
    re: /\b(washroom\s+vanity|vanity\s+counter|basin\s+counter|corian\s+vanity)\b/i,
    weight: 45,
  },
  {
    key: 'pantryJoinery',
    category: 'Pantry & Vanity',
    dbKind: 'storage',
    dbSubtype: 'kitchen-counter',
    re: /\b(pantry\s+(?:cabinet|counter|unit|joinery)|tea\s*(?:&|and)?\s*coffee\s+(?:station|counter|credenza)|kitchenette\s+joinery|built[-\s]?in\s+pantry)\b/i,
    weight: 45,
  },
  {
    key: 'featureWall',
    category: 'Feature Wall',
    dbKind: 'screen',
    dbSubtype: 'screen',
    re: /\b(feature\s+wall|slatted\s+(?:timber|wood)\s+wall|fluted\s+(?:wall|cladding|panel)|decorative\s+wall\s+cladding|acoustic\s+slat\s+wall|veneer\s+wall\s+paneling)\b/i,
    weight: 42,
  },
  {
    key: 'planterBox',
    category: 'Metalwork & Divider',
    dbKind: 'plant',
    dbSubtype: 'plant',
    re: /\b(planter\s+(?:box|trough)|custom\s+planter)\b/i,
    weight: 42,
  },
  {
    key: 'metalDivider',
    category: 'Metalwork & Divider',
    dbKind: 'screen',
    dbSubtype: 'screen',
    re: /\b(shelving\s+(?:room\s+)?divider|metalwork\s+divider|cnc\s+(?:laser\s+cut\s+)?screen)\b/i,
    weight: 40,
  },
  {
    key: 'joineryWall',
    category: 'Joinery & Millwork',
    dbKind: 'storage',
    dbSubtype: 'cabinet',
    re: /\b(full[-\s]?height\s+(?:cabinet|credenza|joinery|wall\s+unit)|backwall\s+(?:unit|credenza)|locker\s+wall|custom\s+locker|built[-\s]?in\s+(?:cabinet|wardrobe|shelving)|display\s+niche)\b/i,
    weight: 40,
  },
  {
    key: 'podium',
    category: 'Joinery & Millwork',
    dbKind: 'joinery',
    dbSubtype: 'joinery',
    re: /\b(podium|lectern)\b/i,
    weight: 38,
  },
  {
    key: 'precastBench',
    category: 'Precast / Landscape',
    dbKind: 'sofa',
    dbSubtype: 'bench',
    re: /\b(terrazzo\s+bench|precast\s+concrete\s+bench|monolithic\s+bench|capsule\s+shape\s+seat|gfrc\s+bench)\b/i,
    weight: 45,
  },
  {
    key: 'bespokeTable',
    category: 'Bespoke Table',
    dbKind: 'table',
    dbSubtype: 'meeting-table',
    re: /\b(boat[-\s]?shaped\s+(?:boardroom|conference)|island\s+collaboration\s+table|waterfall\s+(?:stone|quartz)\s+table)\b/i,
    weight: 38,
  },
];

/**
 * Parses primary mm dimensions from architectural descriptions ("2800 x 850 x 1050 mm", "4.2m", "W3600 D1200").
 */
export function parseDimensionsMm(text = '') {
  const s = String(text || '');
  const xyz = s.match(/(\d{3,4})\s*[xX×*]\s*(\d{3,4})(?:\s*[xX×*]\s*(\d{3,4}))?\s*(mm|cm)?/i);
  if (xyz) {
    const scale = (xyz[4] || '').toLowerCase() === 'cm' ? 10 : 1;
    return {
      widthMm: Math.round(Number(xyz[1]) * scale),
      depthMm: Math.round(Number(xyz[2]) * scale),
      heightMm: xyz[3] ? Math.round(Number(xyz[3]) * scale) : null,
      raw: xyz[0].trim(),
    };
  }
  const wMatch = s.match(/\bW\s*[:=]?\s*(\d{3,4})\s*(?:mm)?/i);
  const dMatch = s.match(/\bD\s*[:=]?\s*(\d{3,4})\s*(?:mm)?/i);
  const hMatch = s.match(/\bH\s*[:=]?\s*(\d{3,4})\s*(?:mm)?/i);
  if (wMatch) {
    return {
      widthMm: Number(wMatch[1]),
      depthMm: dMatch ? Number(dMatch[1]) : null,
      heightMm: hMatch ? Number(hMatch[1]) : null,
      raw: `${wMatch[1]}mm`,
    };
  }
  const meterMatch = s.match(/\b(\d+(?:\.\d+)?)\s*m\b(?:\s*[xX×]\s*(\d+(?:\.\d+)?)\s*m\b)?/i);
  if (meterMatch) {
    return {
      widthMm: Math.round(Number(meterMatch[1]) * 1000),
      depthMm: meterMatch[2] ? Math.round(Number(meterMatch[2]) * 1000) : null,
      heightMm: null,
      raw: meterMatch[0].trim(),
    };
  }
  return null;
}

export function detectShapeHint(text = '') {
  const s = String(text || '').toLowerCase();
  if (/\b(curved|arc|semi[-\s]?circular|radius|curved[-\s]?front)\b/.test(s)) return 'curved';
  if (/\b(u[-\s]?shape|u[-\s]?shaped)\b/.test(s)) return 'u-shape';
  if (/\b(l[-\s]?shape|l[-\s]?shaped|corner)\b/.test(s)) return 'l-shape';
  if (/\b(round|circular|dia\.?|diameter)\b/.test(s)) return 'round';
  return 'rectangular';
}

/**
 * Early detection of Custom-Made / Fabrication products from Drawings or BOQs.
 * Respects specified contract manufacturers unless explicit bespoke/custom override cues appear.
 */
export function detectCustomFabrication(description = '', scope = '', localCatalogs = []) {
  const raw = String(description || '').trim();
  const scopeStr = String(scope || '').trim();
  if (!raw && !scopeStr) {
    return { isCustomFabrication: false, confidence: 0, categoryHint: '', designBuildKind: '', shape: 'rectangular', parsedDimsMm: null, reasons: [] };
  }

  const reasons = [];
  let score = 0;

  // Explicit scope tag always wins
  if (/custom\s*fab|bespoke|millwork|custom\s*joinery/i.test(scopeStr)) {
    score += 70;
    reasons.push(`Explicit scope "${scopeStr}"`);
  }

  const explicitCustomHit = raw.match(EXPLICIT_CUSTOM_PHRASES_RE);
  if (explicitCustomHit) {
    score += 45;
    reasons.push(`Bespoke cue "${explicitCustomHit[0]}"`);
  }

  // Never hijack an explicit contract manufacturer item (e.g. "Narbutas Nova Desk", URLs) unless bespoke phrase is explicit
  const specifiedBrand = detectSpecifiedBrandInText(raw, localCatalogs);
  const hasRealBrand = Boolean(
    specifiedBrand &&
    specifiedBrand.brand &&
    !/^(generic|custom|local|unknown|amazon|noon|ikea|fitout)/i.test(specifiedBrand.brand)
  );
  if (hasRealBrand && !explicitCustomHit && score < 70) {
    return {
      isCustomFabrication: false,
      confidence: 0,
      categoryHint: '',
      designBuildKind: '',
      shape: detectShapeHint(raw),
      parsedDimsMm: parseDimensionsMm(raw),
      reasons: [`Branded spec (${specifiedBrand.brand}) takes precedence`],
    };
  }

  // Headline-first typology detection so accessory add-ons in body text (e.g. "curved bench seating — ..., integrated planter box")
  // never hijack the primary piece typology.
  const headline = raw.split(/\s*[—–\-|]\s*|\s*,\s*|\s+with\s+/i)[0].trim() || raw;
  let matchedTypology = null;
  for (const pat of BESPOKE_TYPOLOGY_PATTERNS) {
    if (pat.re.test(headline)) {
      matchedTypology = pat;
      score += pat.weight + 10;
      reasons.push(`Typology "${pat.category}" (headline)`);
      break;
    }
  }
  if (!matchedTypology) {
    for (const pat of BESPOKE_TYPOLOGY_PATTERNS) {
      if (pat.re.test(raw)) {
        matchedTypology = pat;
        score += pat.weight;
        reasons.push(`Typology "${pat.category}"`);
        break;
      }
    }
  }

  const parsedDimsMm = parseDimensionsMm(raw);
  const shape = detectShapeHint(raw);

  // Oversized conference tables (>= 3600mm or >= 14 pax) without a brand are almost always bespoke fabrication
  const isLargeConference = /\b(boardroom|conference\s*table|meeting\s*table)\b/i.test(raw)
    && (
      (parsedDimsMm?.widthMm && parsedDimsMm.widthMm >= 3600) ||
      /\b(1[4-9]|[2-9]\d)\s*[-\s]?(?:pax|persons?|seaters?|seats?)\b/i.test(raw)
    );
  if (isLargeConference && !hasRealBrand) {
    score += 45;
    if (!matchedTypology) {
      matchedTypology = { category: 'Bespoke Table', dbKind: 'table' };
    }
    reasons.push('Oversized conference table (>=3600mm or 14+ pax)');
  }

  // Never steal pure loose seating (task chairs, student chairs, auditorium chairs) unless explicitly custom banquette/bench
  const isPureLooseChair = /\b(task\s+chair|swivel\s+chair|ergonomic\s+chair|mesh\s+chair|visitor\s+chair|student\s+chair|auditorium\s+chair|cinema\s+seat|bar\s+stool)\b/i.test(raw)
    && !/\b(banquette|bench|booth)\b/i.test(raw);
  if (isPureLooseChair && score < 70) {
    return {
      isCustomFabrication: false,
      confidence: 0,
      categoryHint: '',
      designBuildKind: '',
      shape,
      parsedDimsMm,
      reasons: ['Standard catalog loose chair'],
    };
  }

  // Standard architectural flat fit-out (paint, carpet tiles, gypsum ceiling, drywall) goes to FitOut V2 unless joinery/banquette/reception
  const isStandardFlatFitout = /\b(carpet\s*tile|porcelain\s*tile|vinyl\s*flooring|gypsum\s*(?:board\s*)?ceiling|mineral\s*fiber\s*ceiling|drywall\s*partition|glass\s*partition|swing\s*door|roller\s*blind|emulsion\s*paint)\b/i.test(raw)
    && !matchedTypology && !explicitCustomHit;
  if (isStandardFlatFitout && score < 70) {
    return {
      isCustomFabrication: false,
      confidence: 0,
      categoryHint: '',
      designBuildKind: '',
      shape,
      parsedDimsMm,
      reasons: ['Standard architectural fit-out trade'],
    };
  }

  const isCustomFabrication = score >= 45;
  const confidence = Math.min(100, Math.round(score));

  return {
    isCustomFabrication,
    confidence,
    categoryHint: matchedTypology?.category || (/\bsofa|lounge\b/i.test(raw) ? 'Banquette Seating' : /\btable|desk\b/i.test(raw) ? 'Bespoke Table' : 'Joinery & Millwork'),
    designBuildKind: matchedTypology?.dbKind || (/\btable\b/i.test(raw) ? 'table' : /\bdesk\b/i.test(raw) ? 'desk' : /\bsofa|bench|banquette\b/i.test(raw) ? 'sofa' : 'storage'),
    designBuildSubtype: matchedTypology?.dbSubtype || '',
    shape,
    parsedDimsMm,
    reasons,
  };
}

/**
 * Computes tier-specific parametric rate for a Custom Fabrication template based on extracted dimensions & unit.
 */
export function computeParametricFabricationRate(template, tier = 'mid', parsedDimsMm = null, qty = 1, boqUnit = 'Nos') {
  const normTier = tier === 'budgetary' ? 'budgetary' : (tier === 'high' || tier === 'premium') ? 'high' : 'mid';
  const baseRate = Number(template?.[`rate_${normTier}`] ?? template?.rate_mid ?? 0);
  const materialSpec = template?.[`material_spec_${normTier}`] || template?.material_spec_mid || '';
  const currency = template?.currency || 'OMR';
  const tplUnit = String(template?.pricing_unit || 'Nos').toUpperCase();
  const reqUnit = String(boqUnit || 'Nos').toUpperCase();

  let unitRate = baseRate;
  let pricingBasis = `Base ${normTier} catalog rate (${tplUnit})`;

  const widthMm = parsedDimsMm?.widthMm || 0;
  const defWidthMm = Number(template?.default_width_mm || 0);

  if (baseRate > 0) {
    if (tplUnit === 'LM' && reqUnit === 'NOS' && widthMm >= 600) {
      const meters = Math.max(0.75, widthMm / 1000);
      unitRate = Math.round(baseRate * meters * 100) / 100;
      pricingBasis = `${baseRate} ${currency}/LM × ${meters.toFixed(2)}m extracted length`;
    } else if (tplUnit === 'SQM' && reqUnit === 'NOS' && widthMm >= 600 && parsedDimsMm?.heightMm) {
      const sqm = Math.max(0.5, (widthMm / 1000) * (parsedDimsMm.heightMm / 1000));
      unitRate = Math.round(baseRate * sqm * 100) / 100;
      pricingBasis = `${baseRate} ${currency}/SQM × ${sqm.toFixed(2)}m² calibrated area`;
    } else if (tplUnit === 'NOS' && reqUnit === 'NOS' && widthMm >= 600 && defWidthMm >= 600) {
      const ratio = Math.min(2.25, Math.max(0.75, widthMm / defWidthMm));
      if (Math.abs(ratio - 1.0) >= 0.12) {
        unitRate = Math.round(baseRate * ratio * 100) / 100;
        pricingBasis = `Parametric width scale (${widthMm}mm vs ${defWidthMm}mm ref = ${ratio.toFixed(2)}×)`;
      }
    }
  }

  return {
    unitRate,
    currency,
    materialSpec,
    pricingBasis,
    tier: normTier,
  };
}
