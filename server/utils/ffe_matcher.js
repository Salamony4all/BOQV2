/**
 * FF&E Specialist Matcher
 * A rule-based scoring engine for 100% precision matching of BOQ items.
 */

import { TAXONOMY, extractDimensions } from './normalizer.js';

export function matchFFE(boqDescription, candidateBrands) {
  if (!boqDescription || !candidateBrands?.length) return null;

  const boqText = boqDescription.toLowerCase();
  const boqDims = extractDimensions(boqText);
  
  // 1. Identify Target Taxonomy from BOQ
  /** SECTION 1: Sentence-Wise Taxonomy Detection **/
  let targetMainCat = null;
  let targetSubCat = null;

  // Prioritize specific phrase matches to avoid confusion (e.g. "Coffee Table" vs "Desk")
  const specificPriorities = [
    { main: "Desk & Table", sub: "Coffee Tables", regex: /coffee table|side table|center table|low table/i },
    { main: "Desk & Table", sub: "Conference Tables", regex: /conference table|meeting table|boardroom table/i },
    { main: "Desk & Table", sub: "Reception Desks", regex: /reception/i },
    { main: "Acoustic Solutions", sub: "Office Pods", regex: /pod|booth|acoustic booth/i },
    { main: "Office Seating", sub: "Sofas", regex: /sofa|couch|pouf|ottoman/i },
    { main: "Office Seating", sub: "Lounge Chairs", regex: /lounge chair|armchair|easy chair/i }
  ];

  for (const p of specificPriorities) {
    if (p.regex.test(boqText)) {
      targetMainCat = p.main;
      targetSubCat = p.sub;
      break;
    }
  }

  // Fallback to general taxonomy loop
  if (!targetMainCat) {
    outer: for (const [main, subs] of Object.entries(TAXONOMY)) {
      for (const [sub, regex] of Object.entries(subs)) {
        if (regex.test(boqText)) {
          targetMainCat = main;
          targetSubCat = sub;
          break outer;
        }
      }
    }
  }

  // 2. Tokenize BOQ for feature matching
  const boqTokens = boqText.split(/[\s,.-/]+/).filter(t => t.length > 2);

  let bestProduct = null;
  let bestBrand = null;
  let bestScore = -Infinity;
  let bestTieBreaker = -1;

  candidateBrands.forEach(brand => {
    (brand.products || []).forEach(p => {
      const norm = p.normalization || {};
      let score = 0;

      // Build product text corpus — reads from normalization if available, falls back to raw fields
      // This ensures matching works for both normalized AND freshly-scraped (un-normalized) products
      const pText = (
        p.model + ' ' +
        (p.description || '') + ' ' +
        (norm.subCategory || p.subCategory || '') + ' ' +
        (norm.category || p.mainCategory || '')
      ).toLowerCase();

      /** SECTION 2: SENTENCE-WISE BLOCKADES (1,000,000,000 pts) **/
      const isBoqSeating = /chair|seating|stool|sofa|pouf|bench/i.test(boqText);
      const isBoqChair = /chair|task|executive|operative|mid.back|high.back/i.test(boqText) && !/sofa|bench|pouf/i.test(boqText);
      const isBoqSofa = /sofa|couch|bench|pouf|ottoman/i.test(boqText);
      
      const isBoqDesk = /desk|workstation|benching/i.test(boqText);
      const isBoqTable = /table/i.test(boqText) && !/chair|seating|desk/i.test(boqText);
      const isBoqStorage = /cabinet|drawer|storage|pedestal|locker|filing/i.test(boqText);
      const isBoqPod = /pod|booth/i.test(boqText);
      const isBoqReception = /reception/i.test(boqText);

      const isProdSeating = norm.category === "Office Seating" || /chair|seating|stool|sofa|pouf|bench/i.test(pText);
      const isProdChair = norm.subCategory?.includes("Chair") || (/chair/i.test(pText) && !/sofa|bench|stool/i.test(pText));
      const isProdSofa = norm.subCategory?.includes("Sofa") || /sofa|couch|bench|pouf|ottoman/i.test(pText);
      const isProdDesk = norm.category === "Desk & Table" || /desk|workstation|benching/i.test(pText);
      const isProdTable = norm.subCategory?.includes("Table") || (/table/i.test(pText) && !/chair|desk/i.test(pText));
      const isProdStorage = norm.category === "Storage" || /cabinet|drawer|storage|pedestal|locker|filing/i.test(pText);
      const isProdPod = norm.category === "Acoustic Solutions" || /pod|booth/i.test(pText);
      const isProdReception = /reception/i.test(pText) || norm.subCategory?.includes("Reception");

      // 1. Cross-Category Leaks (Absolute Blockade)
      if (isBoqSeating && (isProdDesk || isProdTable || isProdStorage || isProdPod)) score -= 1500000000;
      if ((isBoqDesk || isBoqTable) && isProdSeating) score -= 1500000000;
      if (isBoqStorage && (isProdSeating || isProdDesk || isProdTable || isProdPod)) score -= 1500000000;
      if (isBoqPod && (isProdSeating || isProdDesk || isProdTable || isProdStorage)) score -= 1500000000;

      // 2. Intra-Seating Isolation (Chair vs Sofa)
      if (isBoqChair && isProdSofa) {
        // console.log(`[DEBUG] Blockade Engage: ${p.model} is a Sofa (+Chair BOQ)`);
        score -= 1500000000;
      }
      if (isBoqSofa && isProdChair) score -= 1500000000;

      // 3. Desk vs Table Isolation
      if (isBoqDesk && isProdTable && !isProdDesk) score -= 800000000;
      if (isBoqTable && isProdDesk && !isProdTable) score -= 800000000;

      // 4. Lounge Table vs Lounge Chair
      if (/lounge table/i.test(boqText) && isProdChair) score -= 1500000000;
      if (/lounge chair/i.test(boqText) && isProdTable) score -= 1500000000;

      // Isolation: Generic Desk vs Reception/Pod
      if ((isBoqDesk || isBoqTable) && !isBoqReception && isProdReception) score -= 500000000;
      if ((isBoqDesk || isBoqTable) && !isBoqPod && isProdPod) score -= 500000000;

      // Internal Seating Blockades (Task vs Lounge vs Sofa)
      if (/task chair|operative/i.test(boqText) && /lounge|sofa|armchair|relax|bench|pouf/i.test(pText)) score -= 1000000000;
      if (/chair/i.test(boqText) && !/sofa|bench|pouf|lounge/i.test(boqText) && /sofa|bench|pouf/i.test(pText)) score -= 1500000000;
      if (/lounge|sofa|armchair|relax/i.test(boqText) && /task chair|operative|mesh/i.test(pText)) score -= 500000000;

      // Desk vs Workstation Isolation (System vs Single)
      const isBoqWorkstation = /workstation|bench system|cluster|staff desk/i.test(boqText);
      const isProdWorkstation = /workstation|bench system|modular system|bench desk|benching/i.test(pText) || /nova|north cape|cross|zento/i.test(p.model?.toLowerCase() || "");
      const isProdSingleDesk = /single desk|freestanding desk|executive desk|manager desk|individual desk/i.test(pText) || /zedo|motion/i.test(p.model?.toLowerCase() || "");
      const isProdStrictTable = /meeting table|conference table|boardroom table/i.test(pText) && !/workstation|nova/i.test(pText);
      
      // 1. Direct Boost for Workstation matches
      if (isBoqWorkstation && isProdWorkstation) {
        score += 800000000; // MASSIVE BOOST FOR CORRECT SYSTEM
      }

      // 2. Prevent Single Desk for Workstation
      if (isBoqWorkstation && isProdSingleDesk && !isProdWorkstation) {
        score -= 1500000000; // DRACONIAN SINGLE DESK BLOCKADE
      }

      // 3. Prevent Meeting Table for Workstation
      if (isBoqWorkstation && isProdStrictTable) {
        score -= 1500000000; // DRACONIAN TABLE BLOCKADE
      }

      // 4. Prefer Single Desk for non-workstation Desk rows
      if (!isBoqWorkstation && /desk/i.test(boqText) && isProdWorkstation && !isProdSingleDesk) {
         score -= 500000000; 
      }

      // Table Isolation (Large vs Small)
      const isBoqLargeTable = /meeting table|conference table|boardroom table/i.test(boqText) || (boqDims && boqDims.width > 2000);
      const isProdSmallTable = norm.dimensions && norm.dimensions.width < 1000;
      if (isBoqLargeTable && isProdSmallTable) {
        score -= 1500000000; // DRACONIAN TABLE SIZE MISMATCH
      }
      
      const isBoqSmallTable = /side table|coffee table|cafe table/i.test(boqText) || (boqDims && boqDims.width < 1200);
      const isProdLargeTable = norm.dimensions && norm.dimensions.width > 2000;
      if (isBoqSmallTable && isProdLargeTable) {
        score -= 1500000000;
      }

      // Shape Isolation (Round vs Rectangular)
      const isBoqRectangular = /\d+\s*[x*]\s*\d+/i.test(boqText);
      const isProdRound = /round|circular|dia|ø/i.test(pText) || /round|circular|dia|ø/i.test(p.model || "");
      if (isBoqRectangular && isProdRound) {
        score -= 2000000000; // DRACONIAN SHAPE MISMATCH
      }
      
      const isBoqRound = /round|circular|dia|ø/i.test(boqText);
      const isProdRectangular = /\d+\s*[x*]\s*\d+/i.test(pText) || (norm.dimensions && norm.dimensions.width !== norm.dimensions.depth);
      if (isBoqRound && isProdRectangular && !isProdRound) {
        score -= 2000000000;
      }

      /** SECTION 3: HEURISTIC HIERARCHY **/
      // 1. EXACT ANCHOR MATCH: 100,000,000 pts (Absolute priority for Architonic Collection hint)
      if (norm.subCategory === targetSubCat && targetSubCat) {
        score += 100000000;
      }

      // 2. Category (Immutable Type): 100,000,000 pts
      if (norm.category === targetMainCat) score += 100000000;
      else if (targetMainCat) score -= 500000000; // Increased penalty for wrong category

      // 3. Sub-Category (Intended Use): 20,000,000 pts
      if (norm.subCategory === targetSubCat) score += 20000000;
      else if (targetSubCat) score -= 10000000;

      // 4. Seniority/Rank (Hard Role Isolation): 500,000,000 pts
      const isSeniorRole = /chairman|president|presidential|ceo|boardroom|director|executive|head of chair|head of desk|boss|management/i.test(boqText);
      if (isSeniorRole) {
        if (norm.rank >= 3) score += 50000000;
        else score -= 1500000000; // DRACONIAN RANK PENALTY FOR SENIOR ROLES
      } else {
        if (norm.rank >= 3) score -= 100000000;
      }
      
      /** SECTION 4: ATTRIBUTE ALIGNMENT (Materials, Base, etc.) **/
      if (norm.tags && norm.tags.length > 0) {
        norm.tags.forEach(tag => {
          if (boqText.includes(tag.toLowerCase())) {
            score += 1000000; // Major attribute match
          }
        });
      }

      /** SECTION 5: DIMENSION MATCHING **/
      if (boqDims && norm.dimensions) {
        const wDiff = Math.abs(boqDims.width - norm.dimensions.width);
        const dDiff = Math.abs(boqDims.depth - norm.dimensions.depth);
        const maxDiff = Math.max(wDiff, dDiff);

        if (wDiff === 0 && dDiff === 0) score += 5000000; // Perfect dimension match
        else if (wDiff <= 100 && dDiff <= 100) score += 1000000; // Close enough
        else if (maxDiff > 800) score -= 1500000000; // EXTREME MISMATCH -> BLOCK
        else if (wDiff > 300 || dDiff > 300) score -= 50000000; // Severe dimension mismatch
      }

      /** SECTION 6: KEYWORD DENSITY & MODEL MATCHING **/
      // Model name hits are extremely important
      const pModelClean = (p.model || "").split('#')[0].replace(/[^a-z0-9]/gi, ' ').trim().toLowerCase();
      if (pModelClean.length > 3 && boqText.includes(pModelClean)) {
        score += 2000000; // Massive bonus for model name match
      }

      let tokenScore = 0;
      boqTokens.forEach(token => {
        if (pText.includes(token)) tokenScore++;
      });
      score += (tokenScore * 20000);

      // Final check for Best Match
      if (score > bestScore || (score === bestScore && tokenScore > bestTieBreaker)) {
        bestScore = score;
        bestTieBreaker = tokenScore;
        bestProduct = p;
        bestBrand = brand;
      }
    });
  });

  if (bestProduct && bestBrand && bestScore > -500000000) {
    return {
      brand: bestBrand.name,
      logo: bestBrand.logo,
      image: bestProduct.imageUrl,
      description: bestProduct.description || bestProduct.model,
      mainCat: bestProduct.normalization?.category || bestProduct.mainCategory || 'Furniture',
      subCat: bestProduct.normalization?.subCategory || bestProduct.subCategory || 'Generic',
      family: bestProduct.family,
      model: bestProduct.model,
      modelUrl: bestProduct.productUrl || bestProduct.imageUrl,
      price: bestProduct.price || 0,
      source: 'algorithm',
      confidence: bestScore,
      normalization: bestProduct.normalization || {},
      alternatives: []
    };
  }

  return null;
}

export function hardMatchByModel(suggestedModel, candidateBrands) {
  if (!suggestedModel || suggestedModel === 'null' || !candidateBrands?.length) return null;

  const cleanQuery = suggestedModel.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (cleanQuery.length < 3) return null; // Avoid trivial matches

  for (const brand of candidateBrands) {
    for (const p of brand.products || []) {
      const pModel = (p.model || "").toLowerCase().replace(/[^a-z0-9]/g, '');
      
      // Match if exact or if one contains the other (e.g., "Era" vs "Narbutas Era")
      if (pModel && (pModel === cleanQuery || pModel.includes(cleanQuery) || cleanQuery.includes(pModel))) {
        return {
          brand: brand.name,
          logo: brand.logo,
          image: p.imageUrl,
          description: p.description || p.model,
          mainCat: p.normalization?.category || p.mainCategory || 'Furniture',
          subCat: p.normalization?.subCategory || p.subCategory || 'Generic',
          family: p.family,
          model: p.model,
          modelUrl: p.productUrl || p.imageUrl,
          price: p.price || 0,
          source: 'ai-hardmatch',
          confidence: 1.0,
          normalization: p.normalization || {},
          alternatives: []
        };
      }
    }
  }
  return null;
}

export default { matchFFE, hardMatchByModel };
