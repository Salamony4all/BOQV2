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

      const pText = (p.model + ' ' + (p.description || '') + ' ' + (norm.subCategory || '')).toLowerCase();

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

      // Internal Seating Blockades (Task vs Lounge)
      if (/task chair|operative/i.test(boqText) && /lounge|sofa|armchair|relax/i.test(pText)) score -= 500000000;
      if (/lounge|sofa|armchair|relax/i.test(boqText) && /task chair|operative|mesh/i.test(pText)) score -= 500000000;

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
      const isSeniorRole = /chairman|president|presidential|ceo|boardroom|director|executive|head of chair|head of desk|boss/i.test(boqText);
      if (isSeniorRole) {
        if (norm.rank >= 3) score += 50000000;
        else score -= 500000000; // DRACONIAN RANK PENALTY
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
        
        if (wDiff === 0 && dDiff === 0) score += 5000000; // Perfect dimension match
        else if (wDiff <= 100 && dDiff <= 100) score += 1000000; // Close enough
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

export default { matchFFE };
