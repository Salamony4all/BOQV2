
export const TAXONOMY = {
  "Office Seating": {
    "Stools": /stool|bar stool|counter stool|drafting stool|high stool|bar-stool/i,
    "Lounge Chairs": /lounge chair|armchair|soft seating|easy chair|club chair|relax chair/i,
    "Executive Chairs": /executive chair|high back|high-back|\bh\/b\b|head of chair|ceo|director|chairman|president|presidential|boss chair/i,
    "Conference Chairs": /conference chair|meeting chair|visitor chair|meeting room chair|meeting room seating|meeting table chair|boardroom chair|general meeting chair|reading hall chair|hall chair|auditorium|multipurpose chair/i,
    "Staff Chairs": /staff chair|task chair|mesh chair|operator|operative|work chair|low back|low-back|steno|assistant chair/i,
    "Supervisor Chairs": /supervisor chair|manager chair|ergonomic chair|medium back|medium-back|mid back|mid-back|technical chair|specialist chair|lobby chair|waiting chair|guest chair|side chair/i,
    "Training Chairs": /training chair|stackable chair|folding chair|seminar chair/i,
    "Plastic Chair": /plastic chair|polypropylene|shell chair/i,
    "Specialist Chairs": /theatre artist chair|artist chair|drafting chair/i,
    "Sofas": /sofa|couch|modular sofa|ottoman|pouf|waiting bench|lounge bench/i
  },
  "Desk & Table": {
    "Coffee Tables": /coffee table|side table|low table|breakout table|center table|sky lounge table|occasional table/i,
    "Lounge Tables": /lounge table|informal meeting table|soft seating table/i,
    "Conference Tables": /conference table|meeting table|boardroom table|discussion table|collaborative table|project table/i,
    "Desk System": /desk system|modular desk|workstation system|bench system|staff workstation|bench type|workstation/i,
    "Reception Desks": /reception desk|\bcounter\b(?! stool)|front desk/i,
    "Manager Tables": /manager table|executive table|senior desk|head of desk/i,
    "Height Adjustable Desks": /height adjustable|sit.stand|sit-to-stand|electric desk|motorized/i,
    "Single Desks": /single desk|freestanding desk|individual desk|executive desk|manager desk|secretary desk/i,
    "Benching": /benching|cluster/i,
    "Training Desk": /training desk|classroom desk|educational desk|folding table/i,
    "Computer Desks": /computer desk|pc desk/i
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
  },
  "Materials/Fabrics": {
    "Fabrics": /fabric|textile|upholstery|leather|mesh|wool|polyester|narbutas era|berta|synergy|step melange/i
  },
  "Ceiling": {
    "Suspended Ceiling": /suspended|grid|mineral fiber|acoustic tile/i,
    "Gypsum Ceiling": /gypsum ceiling|plasterboard|plain ceiling/i,
    "Open Cell": /open cell|baffle/i
  },
  "Flooring": {
    "Carpet Tiles": /carpet tile|floor carpet|carpeting|\bcarpet\b/i,
    "Broadloom": /broadloom|roll carpet|wall-to-wall carpet/i,
    "Luxury Vinyl Tiles": /lvt|vinyl tile|vinyl floor|spc flooring/i,
    "Raised Floor": /raised floor|access floor|computer floor/i,
    "Ceramic/Porcelain": /tile|ceramic|porcelain|wet work/i,
    "Parquet": /parquet|wood flooring|timber floor|laminate flooring/i
  },
  "Wall Finishes": {
    "Paint": /paint|emulsion/i,
    "Wall Cladding": /wall cladding|wall paneling/i,
    "Wallpaper": /wallpaper|wall covering/i
  },
  "Joinery": {
    "Custom Cabinet": /cabinet|wardrobe|storage/i,
    "Wall Panelling": /wall panel|cladding/i,
    "Counter": /reception counter|pantry counter/i
  },
  "Lighting": {
    "General Lighting": /led panel|recessed light/i,
    "Decorative Lighting": /pendant|chandelier|wall lamp/i,
    "Emergency Lighting": /emergency|exit sign/i
  },
  "MEP": {
    "HVAC": /ac|air conditioning|duct|diffuser/i,
    "Fire Fighting": /sprinkler|fire alarm/i,
    "Electrical": /db|distribution board|wiring/i,
    "Plumbing": /plumbing|drainage|water/i
  },
  "General Requirements": {
    "Site Setup": /site setup|office setup|storage/i,
    "Utilities": /utility|utilities|water|electricity/i,
    "Health & Safety": /hse|safety|ppe/i,
    "Logistics": /logistics|housekeeping|disposal/i,
    "Final Works": /cleaning|handover/i,
    "Insurance": /insurance|all-risk/i
  },
  "Flooring & Wet Works": {
    "Stone Flooring": /stone|marble|granite|screed/i,
    "Carpet Tiles": /carpet tile|floor carpet|carpeting|\bcarpet\b/i,
    "Preparation": /self leveling|screed|leveling/i,
    "Finishing": /trim|skirting|transition/i,
    "Wet Works": /tiling|ceramic|porcelain|cement/i
  },
  "Partitions & Wall Cladding": {
    "Glass Partitions": /glass partition|toughened glass/i,
    "Wood Cladding": /wood cladding|veneer|fluted/i,
    "Metal Cladding": /metal cladding|stainless steel/i,
    "Acoustic Partitions": /acoustic partition/i,
    "Specialized Glass": /frosted glass|decorative glass/i,
    "Masonry & Gypsum": /drywall|masonry|gypsum/i,
    "Temporary Works": /temporary partition/i
  },
  "Ceiling Works": {
    "Acoustic Ceiling": /acoustic panel|fabric ceiling/i,
    "Wood Ceilings": /wood slat|suspended wood/i,
    "Painting": /paint|emulsion/i
  },
  "Doors & Windows": {
    "Window Treatments": /curtain|blind/i,
    "Specialized Doors": /sliding door|glass door/i,
    "Standard Doors": /swing door|wooden door/i
  },
  "Finishes (Painting & Decoration)": {
    "Painting": /paint|matte finish/i,
    "Wallpaper": /wallpaper/i,
    "Skirting": /skirting/i,
    "Mirrors": /mirror/i,
    "Artwork": /art work|artwork/i
  },
  "Pantry & Cabinetry": {
    "Custom Cabinets": /cabinet|pantry/i,
    "Furniture": /coffee table|fixed table/i,
    "Specialized Units": /whiteboard|artificial plant/i
  },
  "Electrical & Mechanical (MEP)": {
    "Lighting": /led|strip light|light/i,
    "Plumbing": /ablution|faucet|sink/i,
    "Sanitary": /stone ledge|counter top/i
  },
  "Furniture": {
    "Conference Tables": /conference table/i,
    "Conference Chairs": /meeting chair|conference chair/i,
    "Office Desks": /desk|workstation/i,
    "Office Chairs": /task chair|executive chair/i,
    "Sofa": /sofa|lounge/i,
    "Coffee Table": /coffee table/i
  }
};


export const RANK_MAP = [
  { rank: 4, keywords: /ceo|chairman|president|luxury|high-end executive|presidential|boardroom|boss/i },
  { rank: 3, keywords: /manager|director|executive|headrest|high-back|\bh\/b\b|senior|head of department|head of chair|head of desk/i },
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
    // Keep model IDs/suffixes as they are important for submodels (e.g. #123)
    const cleanModel = (p.model || "").trim();
    const description = (p.description || "").trim();
    
    // 1. Strict Exclusion Checks
    const text = `${p.family || ""} ${cleanModel} ${description} ${p.mainCategory || ""} ${p.subCategory || ""}`.toLowerCase();
    const isErrorItem = /502 Bad Gateway|404 Not Found|Service Unavailable|Internal Server Error|Cloudflare/i.test(text);
    const isMaterial = /material|fabric|upholstery|textile|leather|veneer sample|finish sample|color sample|swatch/i.test(text) ||
                       /narbutas era|berta|synergy|step melange/i.test(text);
                       
    const isDiscovery = /discovery/i.test(p.subCategory || "") || /discovery/i.test(p.mainCategory || "");
    const hasNoImage = !(p.imageUrl && p.imageUrl.length > 10);

    // If it's an error item, material, or a discovery item with no visuals, skip it
    if (isErrorItem || isMaterial || (isDiscovery && hasNoImage)) {
      return null;
    }

    // Return product without adding the 'normalization' block, preserving original structure
    return {
      ...p,
      model: cleanModel
    };
  }).filter(p => p !== null); 
}

export default {
  normalizeProducts,
  TAXONOMY,
  RANK_MAP,
  FEATURE_TAXONOMY
};

