/**
 * Clean 3-Tier Architectural Fit-Out Catalog Seed (OMR base rates).
 * Replaces identical local fitout_v2-*.json clones and strips all 16 junk price=0 discovery stubs.
 */

import { FITOUT_OFFICIAL_FINISH_CARDS } from '../../src/utils/officialBrandFinishes.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __seedDir = path.dirname(fileURLToPath(import.meta.url));
let IMAGE_MAP = {};
try {
  const raw = JSON.parse(fs.readFileSync(path.join(__seedDir, 'fitoutFabImages.json'), 'utf8'));
  if (raw && typeof raw === 'object') IMAGE_MAP = raw.fitout || {};
} catch { /* populated once enrichFitoutAndFabVisuals runs */ }

const RAW_FITOUT_ITEMS = [
  // General Requirements (Nos / Package items kept as 'Nos')
  { code: 'MOB 01', trade: 'General Requirements', subTrade: 'Site Setup', unit: 'Nos', name: 'Site Mobilization & Temporary Office', midSpec: 'Site mobilization including temporary site office, hoarding protection, and lockable storage.', rateMid: 2500 },
  { code: 'UTIL 01', trade: 'General Requirements', subTrade: 'Utilities', unit: 'Nos', name: 'Schneider / ABB Temporary Site Water & Power DB', midSpec: 'Provision and maintenance of temporary water, Schneider / ABB distribution boards, and site electricity.', rateMid: 500 },
  { code: 'HSE 01', trade: 'General Requirements', subTrade: 'Health & Safety', unit: 'Nos', name: 'NAFFCO HSE & Civil Defense Fire Safety Pack', midSpec: 'NAFFCO fire extinguishers, Civil Defense signage, PPE, first-aid station, and HSE compliance boards.', rateMid: 1200 },
  { code: 'DEB 01', trade: 'General Requirements', subTrade: 'Logistics', unit: 'Nos', name: 'Daily Housekeeping & Debris Disposal', midSpec: 'Daily housekeeping and periodic carting away of construction debris to approved municipal dumpsites.', rateMid: 850 },
  { code: 'CLN 01', trade: 'General Requirements', subTrade: 'Final Works', unit: 'Nos', name: '3M Commercial Deep Post-Construction Cleaning', midSpec: 'Professional builder clean using 3M commercial floor pads, glass polishing, floor scrubbing, and snagging handover.', rateMid: 1500 },
  { code: 'INS 01', trade: 'General Requirements', subTrade: 'Insurance', unit: 'Nos', name: 'CAR & Workmen Compensation Insurance', midSpec: 'Contractors All-Risk and Workmen Compensation Insurance covering full fit-out duration.', rateMid: 1800 },

  // Flooring & Wet Works (SQM / LM)
  { code: 'FL-CPT-01', trade: 'Flooring & Wet Works', subTrade: 'Carpet Tiles', unit: 'SQM', name: 'Heavy-Duty Commercial Carpet Tile 500x500mm', midSpec: '9mm tufted solution-dyed nylon carpet tile (500x500mm), bitumen/acoustic backing, Class 33, Bfl-s1 fire rating.', rateMid: 19 },
  { code: 'FL-CPT-02', trade: 'Flooring & Wet Works', subTrade: 'Carpet Tiles', unit: 'SQM', name: 'Wall-to-Wall Broadloom Carpet with Underlay', midSpec: '9mm commercial cut-pile broadloom carpet over high-density acousticPU underlay, tackless perimeter.', rateMid: 22 },
  { code: 'FL-POR-01', trade: 'Flooring & Wet Works', subTrade: 'Porcelain Tiles', unit: 'SQM', name: 'RAK Ceramics Rectified Matte Porcelain Floor Tile 600x600mm', midSpec: 'RAK Ceramics 600x600x10mm full-body rectified porcelain tile, R10 anti-slip matte finish, Mapei C2TE adhesive & epoxy grout.', rateMid: 24 },
  { code: 'FL-VNL-01', trade: 'Flooring & Wet Works', subTrade: 'Vinyl Flooring', unit: 'SQM', name: 'Tarkett Commercial LVT / Heterogeneous Vinyl Flooring', midSpec: 'Tarkett 3.0-5.0mm commercial luxury vinyl plank/tile with 0.55mm wear layer, acoustic backing & PU surface.', rateMid: 18 },
  { code: 'FL-MRB-01', trade: 'Flooring & Wet Works', subTrade: 'Stone Flooring', unit: 'SQM', name: 'Omani Marble Flooring (Ibri Crema / Beige) 1200x600x20mm', midSpec: 'Natural Omani marble slab (Al Turki Ibri Crema / Sohar Beige) 1200x600x20mm honed/polished on 50mm semi-dry cement sand screed with Mapei marble adhesive.', rateMid: 42 },
  { code: 'FL-MRB-02', trade: 'Flooring & Wet Works', subTrade: 'Stone Flooring', unit: 'SQM', name: 'Omani Limestone / Mechanically Fixed Stone Threshold', midSpec: '20mm thick Omani Nizwa / desert beige natural stone threshold & cladding with SS-316 anchors and sealed Fila MP90 grout joints.', rateMid: 34 },
  { code: 'FL-LEV-01', trade: 'Flooring & Wet Works', subTrade: 'Preparation', unit: 'SQM', name: 'Mapei Ultraplan Self-Leveling Floor Screed', midSpec: 'Mapei 5-8mm polymer-modified self-leveling cementitious screed and Eco Prim Grip damp-proof primer prior to carpet/vinyl.', rateMid: 7 },
  { code: 'FL-TRM-01', trade: 'Flooring & Wet Works', subTrade: 'Finishing', unit: 'LM', name: 'Schlüter Stainless Steel Floor Transition Trim', midSpec: 'Schlüter-SCHIENE 3mm brushed 304 stainless steel floor transition strip between dissimilar floor finishes.', rateMid: 12 },

  // Partitions & Wall Cladding (SQM / LM)
  { code: 'PT-DRY-01', trade: 'Partitions & Wall Cladding', subTrade: 'Masonry & Gypsum', unit: 'SQM', name: 'Knauf Acoustic Drywall Partition (100-125mm)', midSpec: 'Knauf 125mm acoustic drywall: double 12.5mm Knauf GKB gypsum boards each side on 70mm GI studs with 50mm 60kg/m3 rockwool.', rateMid: 28 },
  { code: 'PT-DRY-02', trade: 'Partitions & Wall Cladding', subTrade: 'Masonry & Gypsum', unit: 'SQM', name: 'Knauf Moisture-Resistant Wet Area Drywall Partition', midSpec: 'Knauf 125mm moisture-resistant GKBI (green core) double-board gypsum partition with acoustic rockwool infill for pantry/WC.', rateMid: 32 },
  { code: 'PT-GLS-01', trade: 'Partitions & Wall Cladding', subTrade: 'Glass Partitions', unit: 'SQM', name: 'Guardian / Optima Single-Glazed Acoustic Partition 12mm', midSpec: 'Guardian 12mm clear toughened safety glass partition in slimline Optima black/anodized aluminum U-channels, Dow 995 silicone joints.', rateMid: 58 },
  { code: 'PT-GLS-02', trade: 'Partitions & Wall Cladding', subTrade: 'Glass Partitions', unit: 'SQM', name: 'Optima Double-Glazed Acoustic Partition (45dB)', midSpec: 'Optima Revolution 100 double-glazed 10mm+10mm acoustic laminated glass partition in 75mm powder-coated aluminum framing.', rateMid: 95 },
  { code: 'PT-GLS-03', trade: 'Partitions & Wall Cladding', subTrade: 'Specialized Glass', unit: 'SQM', name: 'Saint-Gobain Frosted / Fluted Decorative Glass Partition', midSpec: 'Saint-Gobain Satinovo 10-12mm frosted/fluted toughened glass partition with concealed perimeter channels and 3M manifestation film.', rateMid: 72 },
  { code: 'PT-TMP-01', trade: 'Partitions & Wall Cladding', subTrade: 'Temporary Works', unit: 'SQM', name: 'Temporary Site Hoarding Partition (2400mm H)', midSpec: '2000-2400mm high painted plywood/gypsum temporary dust-barrier hoarding with lockable access.', rateMid: 18 },
  { code: 'WC-WOD-01', trade: 'Partitions & Wall Cladding', subTrade: 'Wood Cladding', unit: 'SQM', name: 'Alpi / Egger Natural Wood Veneer Wall Cladding', midSpec: '18mm FR-grade MDF wall cladding finished in quarter-cut Alpi oak/walnut veneer & Egger backing on concealed Z-clips.', rateMid: 65 },
  { code: 'WC-FLT-01', trade: 'Partitions & Wall Cladding', subTrade: 'Wood Cladding', unit: 'SQM', name: 'Autex Fluted Timber / Slatted Acoustic Wall Panel', midSpec: 'Prefabricated fluted natural oak timber slats over 9mm black Autex PET acoustic felt backing & timber battens.', rateMid: 85 },
  { code: 'WC-ACU-01', trade: 'Partitions & Wall Cladding', subTrade: 'Acoustic Partitions', unit: 'SQM', name: 'Autex / Vescom Fabric-Wrapped Acoustic Wall Panel', midSpec: '50mm high-density fiberglass core wrapped in acoustically transparent fire-rated Vescom / Camira commercial fabric (NRC 0.85).', rateMid: 75 },
  { code: 'WC-MTL-01', trade: 'Partitions & Wall Cladding', subTrade: 'Metal Cladding', unit: 'LM', name: 'Rimex PVD Brushed / Black Stainless Steel Wall Trim', midSpec: 'Rimex black/brass PVD-coated 1.5mm Grade 304 stainless steel shadow-gap trim or decorative wall inlay.', rateMid: 20 },

  // Ceiling Works (SQM)
  { code: 'CL-GYP-01', trade: 'Ceiling Works', subTrade: 'Gypsum Ceiling', unit: 'SQM', name: 'Knauf Suspended Gypsum False Ceiling (12.5mm)', midSpec: 'Knauf 12.5mm taper-edge gypsum plasterboard on 0.5mm concealed GI MF grid, shadow gap perimeter, Jotun matte emulsion.', rateMid: 16 },
  { code: 'CL-ACU-01', trade: 'Ceiling Works', subTrade: 'Acoustic Ceiling', unit: 'SQM', name: 'Knauf / Armstrong Acoustic Mineral Fiber Ceiling 600x600mm', midSpec: 'Knauf Ceiling Solutions / Armstrong 600x600x15mm tegular mineral fiber acoustic tiles (NRC 0.70) on 15mm exposed white T-bar grid.', rateMid: 15 },
  { code: 'CL-ACU-02', trade: 'Ceiling Works', subTrade: 'Acoustic Ceiling', unit: 'SQM', name: 'Autex Suspended Fabric Acoustic Baffles / Clouds', midSpec: 'Autex custom suspended acoustic ceiling clouds/baffles wrapped in commercial fabric with galvanized wire hangers.', rateMid: 90 },
  { code: 'CL-WOD-01', trade: 'Ceiling Works', subTrade: 'Wood Ceilings', unit: 'SQM', name: 'Hunter Douglas Suspended Wood Slat / Baffle Ceiling', midSpec: 'Hunter Douglas white oak veneered aluminum/timber slats suspended on primary black carrier rails with acoustic fleece.', rateMid: 55 },
  { code: 'CL-PNT-01', trade: 'Ceiling Works', subTrade: 'Painting', unit: 'SQM', name: 'Jotun Exposed Soffit Spray Paint Finish', midSpec: 'Jotun Majestic two-coat matte black/dark-grey anti-dust acrylic spray coating to exposed concrete soffit & services.', rateMid: 8 },

  // Doors, Windows & Blinds (Nos / SQM)
  { code: 'DR-SWG-01', trade: 'Doors & Windows', subTrade: 'Timber Doors', unit: 'Nos', name: 'Solid-Core Timber Flush Door & Dormakaba Closer 900x2100mm', midSpec: '900x2100x45mm solid-core flush timber door with Egger HPL finish, hardwood frame, stainless hardware & Dormakaba door closer.', rateMid: 260 },
  { code: 'DR-SWG-02', trade: 'Doors & Windows', subTrade: 'Timber Doors', unit: 'Nos', name: 'Double-Leaf Acoustic Timber Door + Dormakaba 1800x2100mm', midSpec: '1800x2100x45mm double-leaf solid-core acoustic/fire-rated timber door with vision panel & Dormakaba panic/lever set.', rateMid: 480 },
  { code: 'DR-GLS-01', trade: 'Doors & Windows', subTrade: 'Glass Doors', unit: 'Nos', name: 'Optima Frameless Glass Swing Door + Dormakaba Patch', midSpec: '12mm Guardian toughened clear glass single door 900x2400mm with Dormakaba hydraulic patch fittings, drop seal & brushed SS pull handle.', rateMid: 340 },
  { code: 'DR-SLD-01', trade: 'Doors & Windows', subTrade: 'Specialized Doors', unit: 'Nos', name: 'Dormakaba MUTO Acoustic Glass Sliding Door Unit', midSpec: 'Heavy-duty Dormakaba MUTO overhead aluminum track sliding glass door with soft-close dampers and 3M privacy manifestation.', rateMid: 420 },
  { code: 'WN-BLD-01', trade: 'Doors & Windows', subTrade: 'Window Treatments', unit: 'SQM', name: 'Phifer / Coulisse Manual Sunscreen Roller Blind (5%)', midSpec: 'Phifer SheerWeave fire-retardant fiberglass sunscreen fabric (5% openness) with Coulisse aluminum tube & SS chain drive.', rateMid: 22 },
  { code: 'WN-CUR-01', trade: 'Doors & Windows', subTrade: 'Window Treatments', unit: 'SQM', name: 'Somfy Motorized Blackout Curtain / Roller Blind System', midSpec: 'Somfy Sonesse motorized blackout roller blind or ripple-fold drapery on heavy-duty ceiling track with wall switch.', rateMid: 48 },

  // Finishes & Joinery (SQM / LM / Nos)
  { code: 'FN-PNT-01', trade: 'Finishes (Painting & Decoration)', subTrade: 'Painting', unit: 'SQM', name: 'Jotun Fenomastic Low-VOC Matte Emulsion Wall Paint', midSpec: 'Two coats Jotun Fenomastic My Home washable matte emulsion over Knauf/cement skim coat and alkali-resistant primer.', rateMid: 6 },
  { code: 'FN-PNT-02', trade: 'Finishes (Painting & Decoration)', subTrade: 'Painting', unit: 'SQM', name: 'Jotun Lady Minerals Textured Feature Wall Paint', midSpec: 'Jotun Lady Minerals limewash / brushed-suede Low-VOC decorative feature wall paint coating with protective sealer.', rateMid: 12 },
  { code: 'FN-WLP-01', trade: 'Finishes (Painting & Decoration)', subTrade: 'Wallpaper', unit: 'SQM', name: 'Vescom Commercial Vinyl Textured Wallcovering (Type II)', midSpec: 'Vescom heavy-duty Type II non-woven backed textured commercial vinyl wallcovering with fungicidal adhesive.', rateMid: 26 },
  { code: 'FN-SKT-01', trade: 'Finishes (Painting & Decoration)', subTrade: 'Skirting', unit: 'LM', name: 'Gulf Extrusions 100mm Anodized Aluminum / Oak Skirting', midSpec: '18x100mm moisture-resistant Gulf Extrusions anodized aluminum or solid oak skirting with flush/shadow-gap trim.', rateMid: 12 },
  { code: 'FN-MIR-01', trade: 'Finishes (Painting & Decoration)', subTrade: 'Mirrors', unit: 'Nos', name: 'Saint-Gobain Miralite Backlit Vanity Mirror 6mm', midSpec: 'Saint-Gobain Miralite 6mm copper-free beveled silver mirror on waterproof backing with concealed warm-white 3000K LED strip.', rateMid: 85 },
  { code: 'FN-ART-01', trade: 'Finishes (Painting & Decoration)', subTrade: 'Artwork', unit: 'Nos', name: 'Framed Feature Wall Artwork / Acoustic Print', midSpec: 'Custom framed giclee/textured canvas artwork up to 1900x2000mm with concealed security cleats.', rateMid: 210 },

  // Pantry & Built-in Cabinetry (LM / Nos)
  { code: 'JN-PNT-01', trade: 'Pantry & Cabinetry', subTrade: 'Custom Cabinets', unit: 'LM', name: 'Egger Pantry Base Cabinet with Silestone Quartz Counter', midSpec: '600mm deep HMR MDF/Egger HPL base cabinetry with Blum soft-close hinges, 20mm Cosentino Silestone quartz top & SS sink cutout.', rateMid: 145 },
  { code: 'JN-PNT-02', trade: 'Pantry & Cabinetry', subTrade: 'Custom Cabinets', unit: 'LM', name: 'Egger / Blum Built-in Pantry Overhead Wall Cabinet', midSpec: '350mm deep overhead wall cabinetry in matte Egger HPL/HMR MDF with Blum hinges and gypsum bulkhead filler to soffit.', rateMid: 115 },
  { code: 'JN-VAN-01', trade: 'Pantry & Cabinetry', subTrade: 'Custom Cabinets', unit: 'LM', name: 'DuPont Corian / Quartz Floating Washroom Vanity Counter', midSpec: '600mm deep floating DuPont Corian solid surface vanity counter with undermount ceramic basins & moisture-resistant apron.', rateMid: 185 },
  { code: 'JN-WB-01', trade: 'Pantry & Cabinetry', subTrade: 'Specialized Units', unit: 'Nos', name: 'Saint-Gobain Magnetic Glass Whiteboard & Planter Unit', midSpec: 'Recessed Saint-Gobain Planilaque magnetic back-painted glass whiteboard unit flanked by integrated biophilic planter ledge.', rateMid: 140 },

  // Electrical, Lighting & Sanitary Fit-out (Nos / LM)
  { code: 'MEP-LGT-01', trade: 'Electrical & Mechanical (MEP)', subTrade: 'Lighting', unit: 'Nos', name: 'Signify Philips / Zumtobel Recessed LED Downlight', midSpec: 'Signify Philips / Zumtobel PANOS 36W 600x600mm or recessed UGR<19 architectural LED downlight 4000K CRI>90 DALI dimmable.', rateMid: 38 },
  { code: 'MEP-LGT-02', trade: 'Electrical & Mechanical (MEP)', subTrade: 'Lighting', unit: 'LM', name: 'Zumtobel Architectural Linear Suspended / Cove LED Profile', midSpec: 'Zumtobel extruded anodized aluminum linear LED profile 4000K 18W/m CRI>90 with opal diffuser & remote driver.', rateMid: 32 },
  { code: 'MEP-LOG-01', trade: 'Electrical & Mechanical (MEP)', subTrade: 'Lighting', unit: 'Nos', name: 'Backlit Brushed Brass / PVD Reception Signage Logo', midSpec: 'CNC-cut brushed brass / black PVD stainless steel signage letters with concealed halo LED backlighting.', rateMid: 450 },
  { code: 'MEP-SAN-01', trade: 'Electrical & Mechanical (MEP)', subTrade: 'Plumbing', unit: 'Nos', name: 'Franke Undermount Pantry Sink & Grohe Pull-Out Mixer', midSpec: 'Franke 304 brushed stainless steel single-bowl undermount sink with Grohe pull-out chrome mixer & trap.', rateMid: 115 },
  { code: 'MEP-SAN-02', trade: 'Electrical & Mechanical (MEP)', subTrade: 'Sanitaryware', unit: 'Nos', name: 'Duravit Ceramic WC Toilet Suite & Geberit Cistern', midSpec: 'Duravit white vitreous china close-coupled or wall-hung WC toilet suite with Geberit dual-flush cistern, soft-close seat & angle valves.', rateMid: 185 },
  { code: 'MEP-SAN-03', trade: 'Electrical & Mechanical (MEP)', subTrade: 'Sanitaryware', unit: 'Nos', name: 'Duravit Washroom Basin & Grohe Eurosmart Mixer', midSpec: 'Duravit white ceramic undermount or countertop wash basin complete with Grohe Eurosmart single-lever chrome mixer tap, bottle trap & pop-up waste.', rateMid: 145 },
  { code: 'MEP-SAN-04', trade: 'Electrical & Mechanical (MEP)', subTrade: 'Sanitaryware', unit: 'Nos', name: 'Grohe Tempesta Thermostatic Shower Head & Mixer Set', midSpec: 'Grohe Tempesta chrome-plated brass wall-mounted thermostatic shower mixer valve with overhead rain shower, hand shower & flexible hose.', rateMid: 165 },
  { code: 'MEP-WRG-01', trade: 'Electrical & Mechanical (MEP)', subTrade: 'Power & Data', unit: 'Nos', name: 'Legrand Arteor / Schneider Floor Box Power & Cat6A Point', midSpec: 'Legrand Arteor flush floor box or Schneider dado trunking double 13A switched socket + dual Cat6A RJ45 data outlet, tested.', rateMid: 45 },
  { code: 'MEP-AV-01', trade: 'Electrical & Mechanical (MEP)', subTrade: 'AV & Display Systems', unit: 'Nos', name: 'Samsung QMC 65"-75" 4K Commercial Display & Chief Mount', midSpec: 'Samsung QMC 65-inch 4K anti-glare commercial LED display complete with Chief slim tilt wall bracket, concealed conduit & HDMI/Cat6A termination.', rateMid: 420 },
];

const TIER_SPEC_PREFIX = {
  budgetary: 'Value-Engineered / Economy Grade: ',
  mid: 'Commercial Contract Grade: ',
  high: 'Executive / Architectural Bespoke Grade: ',
};

const roundPrice = (n) => {
  if (n >= 100) return Math.round(n / 5) * 5;
  if (n >= 20) return Math.round(n);
  return Math.max(1, Math.round(n * 2) / 2);
};

export const FITOUT_CATALOG_SEED = RAW_FITOUT_ITEMS.map((item) => {
  const rateMid = Number(item.rateMid);
  const rateBudgetary = Math.max(1, roundPrice(rateMid * 0.7));
  const rateHigh = Math.max(rateMid + 1, roundPrice(rateMid * 1.55));
  return {
    code: item.code,
    trade: item.trade,
    sub_trade: item.subTrade,
    unit: item.unit,
    name: item.name,
    manufacturer: FITOUT_OFFICIAL_FINISH_CARDS[item.code]?.manufacturer || '',
    brand_system: FITOUT_OFFICIAL_FINISH_CARDS[item.code]?.brandSystem || '',
    spec_budgetary: `${TIER_SPEC_PREFIX.budgetary}${item.midSpec}`,
    rate_budgetary: rateBudgetary,
    spec_mid: `${TIER_SPEC_PREFIX.mid}${item.midSpec}`,
    rate_mid: rateMid,
    spec_high: `${TIER_SPEC_PREFIX.high}${item.midSpec}`,
    rate_high: rateHigh,
    currency: 'OMR',
    image_url: IMAGE_MAP[item.code] || '',
    finishes: (FITOUT_OFFICIAL_FINISH_CARDS[item.code]?.finishes || []).map((f) => ({ ...f })),
  };
});

/**
 * Converts clean 3-tier seed into legacy brand format (per tier) so any legacy reader stays clean.
 */
export function toLegacyFitoutBrand(tier = 'mid') {
  const normTier = tier === 'budgetary' ? 'budgetary' : (tier === 'high' || tier === 'premium') ? 'high' : 'mid';
  const idMap = {
    budgetary: 1766941758541,
    mid: 1766941758543,
    high: 1766941758545,
  };
  return {
    id: idMap[normTier],
    name: 'FitOut V2',
    type: 'fitout',
    url: '',
    origin: 'Local',
    budgetTier: normTier,
    budget_tier: normTier,
    logo: '',
    products: FITOUT_CATALOG_SEED.map((it) => ({
      mainCategory: it.trade,
      subCategory: it.sub_trade,
      family: it.code.split('-')[0] || it.code.split(' ')[0],
      model: it.code,
      name: it.name,
      manufacturer: it.manufacturer || '',
      brandSystem: it.brand_system || '',
      unit: it.unit,
      currency: it.currency,
      description: it[`spec_${normTier}`],
      imageUrl: it.image_url || '',
      finishes: it.finishes || [],
      price: it[`rate_${normTier}`],
      productUrl: '',
      verified: true,
      source: 'Fitout-Seed-V2',
    })),
  };
}
