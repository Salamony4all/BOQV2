
export const TAXONOMY = {
  "Desk & Table": {
    "Desk System": /desk system|modular desk|workstation system|bench system|staff workstation/i,
    "Single Desks": /single desk|freestanding desk|individual desk|executive desk|manager desk|secretary desk/i,
    "Height Adjustable Desks": /height adjustable|sit.stand|sit-to-stand|electric desk|motorized/i,
    "Benching": /benching|cluster/i,
    "Conference Tables": /conference table|meeting table|boardroom table|discussion table|collaborative table/i,
    "Manager Tables": /manager table|executive table|senior desk|head of desk/i,
    "Training Desk": /training desk|classroom desk|educational desk|folding table/i,
    "Coffee Tables": /coffee table|side table|low table|breakout table|center table|sky lounge table/i,
    "Reception Desks": /reception desk|counter|front desk/i,
    "Computer Desks": /computer desk|pc desk/i
  },
  "Office Seating": {
    "Staff Chairs": /staff chair|task chair|mesh chair|operator|operative|work chair|low back|low-back|steno|assistant chair/i,
    "Supervisor Chairs": /supervisor chair|manager chair|ergonomic chair|medium back|medium-back|mid back|mid-back|technical chair|specialist chair|lobby chair|waiting chair|guest chair|side chair/i,
    "Executive Chairs": /executive chair|high back|high-back|head of chair|ceo|director|chairman|president|presidential|boss chair/i,
    "Conference Chairs": /conference chair|meeting chair|visitor chair|meeting room chair|meeting room seating|meeting table chair|boardroom chair|general meeting chair|reading hall chair|hall chair|auditorium|multipurpose chair|guest chair/i,
    "Training Chairs": /training chair|stackable chair|folding chair|seminar chair/i,
    "Plastic Chair": /plastic chair|polypropylene|shell chair/i,
    "Lounge Chairs": /lounge chair|armchair|soft seating|easy chair|club chair|relax chair/i,
    "Specialist Chairs": /theatre artist chair|artist chair|drafting chair/i,
    "Stools": /stool|bar stool|counter stool|drafting stool/i,
    "Sofas": /sofa|couch|modular sofa|ottoman|pouf|waiting bench|lounge bench/i
  },
  "Office Cubicle": {
    "Call Center Workstation": /call center|telemarketing/i,
    "Modular Cubicle": /modular cubicle|partitioned workstation/i,
    "Private Cubicle": /private cubicle|enclosed workstation/i,
    "Desk Screen": /desk screen|privacy screen|table divider/i
  },
  "Partition Wall": {
    "full height partition wall": /full height|glass partition|demountable/i,
    "movable partition": /movable partition|operable wall|folding partition/i,
    "Space Division": /space division|room divider/i,
    "wall cladding": /wall cladding|wall paneling/i
  },
  "Acoustic Solutions": {
     "Office Pods": /\bpod\b|acoustic pod|phone booth|meeting booth|acoustic phone booth/i,
     "Acoustic Panels": /acoustic panel|wall dampening|sound absorbing/i
  },
  "Storage": {
    "pedestals": /pedestal|mobile drawer/i,
    "cabinets": /cabinet|cupboard|swing door|storage unit/i,
    "lateral files": /lateral file|filing cabinet/i,
    "credenzas": /credenza|sideboard|low storage/i,
    "bookcase": /bookcase|bookshelf/i,
    "wardrobes": /wardrobe|locker|personal storage/i
  },
  "Accessories": {
    "power data socked": /power socket|data socket|electrical|power data/i,
    "wires managerment": /wire management|cable tray|cable spine|cable manager/i,
    "workstation trays": /tray|monitor arm|keyboard tray/i,
    "writing boards": /writing board|whiteboard|magnetic board/i,
    "Aluminum Profile": /aluminum profile|extrusion/i
  }
};

export const RANK_MAP = [
  { rank: 4, keywords: /ceo|chairman|president|luxury|high-end executive|presidential|boardroom|boss/i },
  { rank: 3, keywords: /manager|director|executive|headrest|high-back|senior|head of department|head of chair|head of desk/i },
  { rank: 2, keywords: /supervisor|head of|ergonomic|mid-back|medium-back|mid back|lobby|guest/i },
  { rank: 1, keywords: /staff|employee|operator|task chair|mesh|benching|workstation|staff desk|operative|assistant|staff chair/i }
];

export const FEATURE_TAXONOMY = {
  "Materials": {
    "leather": /leather|genuine leather|nappa|top grain|hide/i,
    "mesh": /mesh|breathable/i,
    "fabric": /fabric|upholstered|textile|wool/i,
    "veneer": /veneer|wood finish|natural wood/i,
    "melamine": /melamine|mfc|laminate/i,
    "glass": /glass|tempered/i,
    "aluminum": /aluminum|aluminium/i,
    "chrome": /chrome|polished metal/i
  },
  "Adjustability": {
    "height_adj": /height adjustable|seat height|gas lift|adjustable height|gas height/i,
    "tilt": /tilt|recline|synchro|tension|mechanism/i,
    "swivel": /swivel|360 degree/i,
    "lumbar": /lumbar support/i,
    "headrest": /headrest/i,
    "armrests": /armrest|adjustable arm|4d arm/i
  },
  "Base": {
    "5_star": /5-star base|star-base|casters|wheels|star base/i,
    "sled": /sled base|cantilever|meeting base/i,
    "4_leg": /4-leg|four leg|wooden leg|4 star base|4 legs/i,
    "pedestal": /pedestal base|trumpet base/i
  },
  "Mechanism": {
    "flip_top": /flip-top|folding top/i,
    "stackable": /stackable|nesting/i,
    "wire_managed": /wire management|cable port|cable management/i
  }
};

/**
 * Extracts dimensions from string. Example: "1600x800", "1600W x 800D", "R:90", "80 X 160"
 */
export function extractDimensions(text) {
  // Common format: 1600x800
  const normRegex = /(\d{2,4})\s*[x*]\s*(\d{2,4})/gi;
  const normMatches = [...text.matchAll(normRegex)];
  
  if (normMatches.length > 0) {
    let w = parseInt(normMatches[0][1]);
    let d = parseInt(normMatches[0][2]);

    // Auto-scale cm to mm (standard catalog unit)
    // If both are small (e.g. 80x160), scale them.
    if (w < 250 && d < 250) {
      w *= 10;
      d *= 10;
    }

    // Standardize order: Width usually > Depth
    if (d > w && d > 500) { [w, d] = [d, w]; }

    return { width: w, depth: d, raw: normMatches[0][0] };
  }

  // Round table format: R:90 or DIA:90 or 90 Round
  const roundRegex = /(?:r|dia|round|circle)[:\s]*(\d{2,4})/i;
  const roundMatch = text.match(roundRegex);
  if (roundMatch) {
    let dim = parseInt(roundMatch[1]);
    if (dim < 250) dim *= 10; // cm to mm
    return { width: dim, depth: dim, raw: roundMatch[0] };
  }

  return null;
}

export function normalizeProducts(products) {
  if (!products || !Array.isArray(products)) return [];
  
  return products.map(p => {
    const description = p.description || "";
    const typeHint = (description.split('.')[0] || "").toLowerCase().trim(); // Leading word anchor
    const text = `${p.family || ""} ${p.model} ${description} ${p.mainCategory || ""} ${p.subCategory || ""} ${typeHint}`.toLowerCase();
    
    let mainCat = 'OTHER';
    let subCat = 'Generic';

    const isSeatingHint = /chair|seating|stool|sofa|armchair|bench/i.test(typeHint + " " + (p.subCategory || ""));
    const isDeskHint = /desk|table|benching|workstation|system/i.test(typeHint + " " + (p.subCategory || ""));
    const isStorageHint = /cabinet|drawer|storage|pedestal|locker|filing/i.test(typeHint + " " + (p.subCategory || ""));

    // Find best match in taxonomy
    outer: for (const [main, subs] of Object.entries(TAXONOMY)) {
      // Force match if typeHint is extremely specific
      if (main === "Office Seating" && isSeatingHint) {
        // Continue but prioritize seating subs
      } else if (main === "Desk & Table" && isDeskHint) {
        // Continue but prioritize desk subs
      }

      for (const [sub, regex] of Object.entries(subs)) {
        if (regex.test(text)) {
          mainCat = main;
          subCat = sub;
          break outer;
        }
      }
    }

    // Fallback logic if no subcat match
    if (mainCat === 'OTHER') {
      if (isSeatingHint) mainCat = "Office Seating";
      else if (isDeskHint) mainCat = "Desk & Table";
      else if (isStorageHint) mainCat = "Storage";
      else if (/pod|partition|wall/i.test(text)) mainCat = "Partition Wall";
    }
    
    // Determine Rank
    let rank = 1;
    for (const level of RANK_MAP) {
      if (level.keywords.test(text)) { rank = level.rank; break; }
    }
    
    // Special logic for chairs (Standardization per rank)
    if (mainCat === "Office Seating") {
       if (rank >= 3 && subCat === 'Generic') subCat = "Executive Chairs";
       else if (rank === 2 && subCat === 'Generic') subCat = "Supervisor Chairs";
       else if (rank === 1 && subCat === 'Generic') subCat = "Staff Chairs";
    }

    // Special logic for desks/tables
    if (mainCat === "Desk & Table" && subCat === 'Generic') {
       if (rank >= 3) subCat = "Manager Tables";
       else subCat = "Single Desks";
    }

    // Extract Tags and Dimensions
    const dimensions = extractDimensions(text);
    const tags = [];
    for (const [group, features] of Object.entries(FEATURE_TAXONOMY)) {
      for (const [featureName, regex] of Object.entries(features)) {
        if (regex.test(text)) {
          tags.push(featureName);
        }
      }
    }

    return {
      ...p,
      normalization: {
        category: mainCat,
        subCategory: subCat,
        rank,
        tags,
        dimensions
      }
    };
  });
}

export default {
  normalizeProducts,
  TAXONOMY,
  RANK_MAP,
  FEATURE_TAXONOMY
};
