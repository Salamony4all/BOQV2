/**
 * Official Manufacturer & Architectural Brand Finish Books
 * Shared across BOQFLOW (UI, matching, export suite) and Design & Build (3D + AI render anchors).
 */

export const PROJECT_PALETTE_PRESETS = [
  { id: 'auto', label: 'Auto (Spec-Matched Official)' },
  { id: 'warm-oak-charcoal', label: 'Warm Oak & Charcoal' },
  { id: 'walnut-cognac', label: 'Executive Walnut & Cognac' },
  { id: 'nordic-sand-sage', label: 'Nordic Ash, Sand & Sage' },
  { id: 'monochrome-mineral', label: 'Architectural Monochrome' },
];

const EUROPEAN_DESIGNER_BOOK = {
  upholstery: [
    { code: 'Kvadrat Hallingdal 65 #0220', name: 'Warm Sand', hex: '#DDD4C3', tone: 'sand' },
    { code: 'Kvadrat Divina MD #873', name: 'Deep Ocean Blue', hex: '#28445C', tone: 'blue' },
    { code: 'Kvadrat Vidar 4 #0554', name: 'Terracotta Wool', hex: '#A9553C', tone: 'terracotta' },
    { code: 'Elmo Soft 93129', name: 'Cognac Aniline Leather', hex: '#8E5234', tone: 'cognac' },
    { code: 'Camira Main Line Flax', name: 'Stone Charcoal', hex: '#5A5D60', tone: 'charcoal' },
    { code: 'Kvadrat Remix 3 #0933', name: 'Sage Moss', hex: '#778878', tone: 'sage' },
  ],
  surfaces: [
    { code: 'Bleached European Oak', name: 'Natural Oak Veneer', hex: '#D2B995', tone: 'oak' },
    { code: 'Canaletto Walnut', name: 'Warm Walnut Veneer', hex: '#5E4030', tone: 'walnut' },
    { code: 'Fenix NTM 0032', name: 'Bianco Kos Matte', hex: '#F3F2EE', tone: 'white' },
    { code: 'Fenix NTM 0720', name: 'Nero Ingo Matte', hex: '#222326', tone: 'black' },
  ],
  frames: [
    { code: 'RAL 9005', name: 'Matte Black Steel', hex: '#191A1C', tone: 'black' },
    { code: 'RAL 7016', name: 'Matte Anthracite', hex: '#373C40', tone: 'charcoal' },
    { code: 'BB-01', name: 'Brushed Brass', hex: '#B5985A', tone: 'brass' },
    { code: 'RAL 9016', name: 'Textured White', hex: '#F3F2EE', tone: 'white' },
  ],
};

const EUROPEAN_TASK_BOOK = {
  upholstery: [
    { code: 'Runner 3D Mesh RN-60999', name: 'Technical Black', hex: '#222426', tone: 'black' },
    { code: 'Gabriel Cura CR-60110', name: 'Slate Grey', hex: '#5E6368', tone: 'grey' },
    { code: 'Camira Era CSE29', name: 'Mineral Sage', hex: '#778878', tone: 'sage' },
    { code: 'Xtreme Plus YS009', name: 'Charcoal Crepe', hex: '#36393D', tone: 'charcoal' },
    { code: 'Kvadrat Steelcut #0150', name: 'Warm Stone', hex: '#B6AEA0', tone: 'sand' },
  ],
  surfaces: [
    { code: 'Natural Beech / Oak', name: 'Natural Timber Shell', hex: '#C9AA7E', tone: 'oak' },
    { code: 'POLY-W', name: 'Alpine White Polymer', hex: '#F2F2EF', tone: 'white' },
  ],
  frames: [
    { code: 'GF-BK', name: 'Glass-Fiber Nylon Black', hex: '#1E2022', tone: 'black' },
    { code: 'AL-P', name: 'Die-Cast Polished Aluminum', hex: '#C8CDD2', tone: 'chrome' },
  ],
};

const NURUS_FREZZA_BOOK = {
  surfaces: [
    { code: 'Canaletto Walnut', name: 'Book-Matched Walnut', hex: '#5F402F', tone: 'walnut' },
    { code: 'Natural European Oak', name: 'Quarter-Cut Oak', hex: '#C6A478', tone: 'oak' },
    { code: 'Smoked Eucalyptus', name: 'Smoked Eucalyptus', hex: '#473931', tone: 'espresso' },
    { code: 'Egger U963', name: 'Diamond Grey', hex: '#585A5D', tone: 'grey' },
    { code: 'Fenix 0032', name: 'Matte Alpine White', hex: '#F4F4F1', tone: 'white' },
  ],
  upholstery: [
    { code: 'Gabriel Crisp 4011', name: 'Deep Charcoal', hex: '#383A3D', tone: 'charcoal' },
    { code: 'Saddle Leather Tan', name: 'Cognac Saddle Leather', hex: '#8C5335', tone: 'cognac' },
    { code: 'Wool Melange Oatmeal', name: 'Oatmeal Sand', hex: '#CFC7B8', tone: 'sand' },
    { code: 'Gabriel Step #67070', name: 'Nordic Sage', hex: '#748477', tone: 'sage' },
  ],
  frames: [
    { code: 'AN-SB', name: 'Anodized Shadow Bronze', hex: '#5C5349', tone: 'bronze' },
    { code: 'RAL 9005', name: 'Matte Black Steel', hex: '#1A1B1D', tone: 'black' },
    { code: 'CR-01', name: 'Polished Chrome', hex: '#CBD0D5', tone: 'chrome' },
  ],
};

export const FURNITURE_BRAND_FINISH_BOOKS = {
  narbutas: {
    surfaces: [
      { code: 'A1', name: 'Natural Oak', hex: '#C8A679', tone: 'oak' },
      { code: 'D1', name: 'Amber Oak', hex: '#B6834D', tone: 'oak' },
      { code: 'R4', name: 'Natural Walnut', hex: '#5C4033', tone: 'walnut' },
      { code: 'M1', name: 'Pure White MFC', hex: '#F5F5F3', tone: 'white' },
      { code: 'U7', name: 'Cubanit Grey', hex: '#736E69', tone: 'grey' },
      { code: 'N1', name: 'Black Ash', hex: '#252526', tone: 'black' },
      { code: 'Fenix 0720', name: 'Nero Ingo Super-Matte', hex: '#1F2022', tone: 'black' },
    ],
    upholstery: [
      { code: 'Step Melange 60099', name: 'Charcoal Grey', hex: '#3A3C3F', tone: 'charcoal' },
      { code: 'Camira Era CSE14', name: 'Warm Stone', hex: '#B8B2A6', tone: 'sand' },
      { code: 'Berta W67', name: 'Terracotta Wool', hex: '#B55A3E', tone: 'terracotta' },
      { code: 'Gabriel Medley 66007', name: 'Soft Sage', hex: '#7D8E7E', tone: 'sage' },
      { code: 'Steelcut Trio 3 #253', name: 'Warm Sand', hex: '#C8BCA8', tone: 'sand' },
      { code: 'Dunes Cognac', name: 'Aniline Cognac Leather', hex: '#8A4F32', tone: 'cognac' },
    ],
    frames: [
      { code: 'J (RAL 9005)', name: 'Matte Black Powder Coat', hex: '#18191B', tone: 'black' },
      { code: 'A (RAL 7021)', name: 'Dark Anthracite Grey', hex: '#2E3234', tone: 'charcoal' },
      { code: 'E (RAL 9016)', name: 'Matte White', hex: '#F2F2F0', tone: 'white' },
      { code: 'M', name: 'Metallic Grey', hex: '#9A9E9F', tone: 'chrome' },
      { code: 'AL', name: 'Polished Aluminum', hex: '#C8CDD2', tone: 'chrome' },
    ],
  },
  'herman miller': {
    upholstery: [
      { code: '8Z Pellicle 23103', name: 'Graphite', hex: '#2C2E30', tone: 'charcoal' },
      { code: '8Z Pellicle 23101', name: 'Mineral', hex: '#C9CBC8', tone: 'sand' },
      { code: '8Z Pellicle 23102', name: 'Carbon', hex: '#4D5054', tone: 'grey' },
      { code: 'Sync 3SY11', name: 'Dark Mineral', hex: '#4B5156', tone: 'blue' },
      { code: 'Prone Leather 1S08', name: 'Espresso', hex: '#44322B', tone: 'cognac' },
    ],
    surfaces: [
      { code: 'OU', name: 'American Walnut Veneer', hex: '#5A3E30', tone: 'walnut' },
      { code: 'A2', name: 'White Ash Veneer', hex: '#DFD6C7', tone: 'oak' },
      { code: 'UL', name: 'Natural Maple', hex: '#DEC39B', tone: 'oak' },
      { code: '91', name: 'White Laminate', hex: '#F4F4F2', tone: 'white' },
    ],
    frames: [
      { code: 'G1', name: 'Graphite', hex: '#2B2D2F', tone: 'black' },
      { code: 'CD', name: 'Polished Aluminum', hex: '#C8CDD2', tone: 'chrome' },
      { code: 'VPR', name: 'Mineral Frame', hex: '#D3D5D2', tone: 'white' },
      { code: 'SC', name: 'Satin Carbon', hex: '#4A4D50', tone: 'charcoal' },
    ],
  },
  'sedus stoll': {
    upholstery: [
      { code: 'Atlantic AT-60999', name: 'Jet Black Mesh', hex: '#232426', tone: 'black' },
      { code: 'Atlantic AT-66064', name: 'Urban Grey', hex: '#7E8285', tone: 'grey' },
      { code: 'Step Melange SM-61148', name: 'Warm Taupe', hex: '#9C9286', tone: 'sand' },
      { code: 'Patina PA-705', name: 'Deep Petrol', hex: '#33535E', tone: 'blue' },
    ],
    surfaces: [
      { code: 'S35', name: 'Oak Sorrento', hex: '#C2A074', tone: 'oak' },
      { code: 'S10', name: 'Pure White', hex: '#F4F4F1', tone: 'white' },
      { code: 'WL-01', name: 'Walnut Veneer', hex: '#5D4031', tone: 'walnut' },
    ],
    frames: [
      { code: 'S11 (RAL 9011)', name: 'Jet Black', hex: '#1E2022', tone: 'black' },
      { code: 'PF', name: 'Polished Aluminum', hex: '#C6CBD0', tone: 'chrome' },
      { code: 'S10', name: 'Pure White', hex: '#F2F2EF', tone: 'white' },
    ],
  },
  'b&t design': {
    upholstery: [
      { code: 'B&T Boucle 04', name: 'Warm Cream', hex: '#DFD8CA', tone: 'sand' },
      { code: 'B&T Wool Felt 18', name: 'Cognac', hex: '#8C4F32', tone: 'cognac' },
      { code: 'B&T Velvet 27', name: 'Deep Petrol', hex: '#274A57', tone: 'blue' },
      { code: 'Kvadrat Remix 3 #0163', name: 'Architectural Stone', hex: '#9E988E', tone: 'charcoal' },
      { code: 'B&T Aniline', name: 'Saddle Tan Leather', hex: '#9A5E3A', tone: 'cognac' },
      { code: 'B&T Felt 09', name: 'Eucalyptus Sage', hex: '#768A7B', tone: 'sage' },
    ],
    surfaces: [
      { code: 'Crown Walnut', name: 'American Walnut Veneer', hex: '#614231', tone: 'walnut' },
      { code: 'White Oak', name: 'Natural White Oak', hex: '#C9AB81', tone: 'oak' },
      { code: 'Smoked Oak', name: 'Smoked Oak Veneer', hex: '#483A30', tone: 'espresso' },
      { code: 'Fenix 0718', name: 'Grigio Londra', hex: '#595856', tone: 'grey' },
      { code: 'Carrara', name: 'Carrara Honed Marble', hex: '#ECEAE4', tone: 'white' },
    ],
    frames: [
      { code: 'ESB (RAL 9005)', name: 'Electrostatic Matte Black', hex: '#1B1C1E', tone: 'black' },
      { code: 'CB-AN', name: 'Champagne Bronze Anodized', hex: '#A89578', tone: 'bronze' },
      { code: 'BCH', name: 'Brushed Chrome', hex: '#C9CFD5', tone: 'chrome' },
    ],
  },
  amara: {
    upholstery: [
      { code: 'AM-LTH-01', name: 'Tufted Espresso Leather', hex: '#5A3E33', tone: 'cognac' },
      { code: 'AM-VLV-08', name: 'Royal Navy Velvet', hex: '#274668', tone: 'blue' },
      { code: 'AM-BCL-02', name: 'Ivory Stone Boucle', hex: '#DED7CA', tone: 'sand' },
      { code: 'AM-LIN-05', name: 'Warm Taupe Linen', hex: '#ACA294', tone: 'charcoal' },
    ],
    surfaces: [
      { code: 'AM-WLN', name: 'Stained Dark Walnut Plinth', hex: '#4A3427', tone: 'walnut' },
      { code: 'AM-OAK', name: 'Natural Oak Plinth', hex: '#C4A377', tone: 'oak' },
    ],
    frames: [
      { code: 'AM-BRS', name: 'Brushed Champagne Brass', hex: '#B89B5E', tone: 'brass' },
      { code: 'RAL 9005', name: 'Matte Black Steel', hex: '#1C1D1F', tone: 'black' },
    ],
  },
  'ottimo furniture': {
    surfaces: [
      { code: 'OT-W04', name: 'E1 Virginia Walnut', hex: '#684835', tone: 'walnut' },
      { code: 'OT-K02', name: 'E1 Light Kendal Oak', hex: '#C9AC82', tone: 'oak' },
      { code: 'OT-WH1', name: 'E1 Alpine White', hex: '#F4F4F2', tone: 'white' },
      { code: 'OT-CG7', name: 'Concrete Grey MFC', hex: '#8E9092', tone: 'grey' },
    ],
    upholstery: [
      { code: 'BM-01', name: 'Breathable Black Mesh', hex: '#222426', tone: 'black' },
      { code: 'CF-14', name: 'Contract Charcoal Fabric', hex: '#3B3E42', tone: 'charcoal' },
      { code: 'PU-09', name: 'Contract Cognac', hex: '#864E32', tone: 'cognac' },
    ],
    frames: [
      { code: 'RAL 9005', name: 'Powder-Coat Matte Black', hex: '#1B1C1E', tone: 'black' },
      { code: 'RAL 9006', name: 'Metallic Silver Grey', hex: '#A4A8AC', tone: 'chrome' },
      { code: 'RAL 9016', name: 'Powder-Coat White', hex: '#F3F3F0', tone: 'white' },
    ],
  },
  'custom fabrication': {
    surfaces: [
      { code: 'Corian® Glacier White', name: 'Solid Surface Seamless', hex: '#F6F5F1', tone: 'white' },
      { code: 'Silestone® Ethereal Glow', name: 'Veined Quartz Stone', hex: '#ECE8DF', tone: 'white' },
      { code: 'Fluted European Oak', name: 'Quarter-Cut Timber Veneer', hex: '#C4A274', tone: 'oak' },
      { code: 'American Walnut', name: 'Book-Matched Walnut Veneer', hex: '#5D3F2E', tone: 'walnut' },
      { code: 'Ceppo Terrazzo', name: 'Precast Architectural Terrazzo', hex: '#8F8D88', tone: 'grey' },
    ],
    upholstery: [
      { code: 'Kvadrat Vidar 4 #0222', name: 'Boucle Warm Sand', hex: '#D5CBB9', tone: 'sand' },
      { code: 'Gabriel Step #66155', name: 'Deep Petrol Wool', hex: '#2C4C5A', tone: 'blue' },
      { code: 'Kvadrat Autumn #0522', name: 'Burnt Cognac', hex: '#8D5236', tone: 'cognac' },
      { code: 'Autex® Cube 9mm', name: 'Acoustic Felt Charcoal', hex: '#222427', tone: 'charcoal' },
    ],
    frames: [
      { code: 'PVD Brushed Brass', name: '304 Stainless Brass PVD', hex: '#B89B5E', tone: 'brass' },
      { code: 'RAL 9005', name: 'Matte Black Powder Steel', hex: '#1B1D1F', tone: 'black' },
      { code: '304 Brushed SS', name: 'Hairline Stainless Steel', hex: '#BFC5CA', tone: 'chrome' },
    ],
  },
  arper: EUROPEAN_DESIGNER_BOOK,
  pedrali: EUROPEAN_DESIGNER_BOOK,
  tacchini: EUROPEAN_DESIGNER_BOOK,
  sancal: EUROPEAN_DESIGNER_BOOK,
  kastel: EUROPEAN_DESIGNER_BOOK,
  'true design': EUROPEAN_DESIGNER_BOOK,
  marelli: EUROPEAN_DESIGNER_BOOK,
  divani: EUROPEAN_DESIGNER_BOOK,
  nurus: NURUS_FREZZA_BOOK,
  frezza: NURUS_FREZZA_BOOK,
  las: NURUS_FREZZA_BOOK,
  ofifran: NURUS_FREZZA_BOOK,
  sokoa: EUROPEAN_TASK_BOOK,
  rim: EUROPEAN_TASK_BOOK,
  interstuhl: EUROPEAN_TASK_BOOK,
  dauphin: EUROPEAN_TASK_BOOK,
  sitland: EUROPEAN_TASK_BOOK,
  default: EUROPEAN_DESIGNER_BOOK,
};

export const FITOUT_OFFICIAL_FINISH_CARDS = {
  'MOB 01': { brandSystem: 'Contract Logistics', specBadge: 'Site Establishment', patternKind: 'general', searchQuery: 'construction site hoarding architecture', finishes: [{ role: 'Hoarding', code: 'RAL 7035', name: 'Light Grey', hex: '#CBD0D3' }, { role: 'Frame', code: 'GI', name: 'Galvanized Steel', hex: '#8D959C' }] },
  'UTIL 01': { brandSystem: 'Schneider® / ABB®', specBadge: 'Temporary MEP DB', patternKind: 'general', searchQuery: 'electrical distribution board panel', finishes: [{ role: 'Enclosure', code: 'RAL 7035', name: 'Industrial Grey', hex: '#C5CACD' }, { role: 'Warning', code: 'RAL 2004', name: 'Safety Orange', hex: '#E06020' }] },
  'HSE 01': { brandSystem: 'UL / Civil Defense', specBadge: 'HSE Compliance', patternKind: 'general', searchQuery: 'fire safety compliance signage commercial building', finishes: [{ role: 'Signage', code: 'RAL 6032', name: 'Safety Green', hex: '#1D8348' }, { role: 'Hardware', code: 'RAL 3001', name: 'Fire Red', hex: '#C0392B' }] },
  'DEB 01': { brandSystem: 'Site Waste Logistics', specBadge: 'Daily Housekeeping', patternKind: 'general', searchQuery: 'commercial interior fitout construction clean floor', finishes: [{ role: 'Protection', code: 'FR-3mm', name: 'Correx Grey', hex: '#7F8C8D' }, { role: 'Wrap', code: 'HDPE', name: 'Clean Kraft', hex: '#B59B7A' }] },
  'CLN 01': { brandSystem: '3M™ Commercial Care', specBadge: 'Handover Deep Clean', patternKind: 'general', searchQuery: 'modern luxury glass office interior clean floor', finishes: [{ role: 'Glass Finish', code: 'CLR-01', name: 'Streak-Free Polish', hex: '#DCEEF8' }, { role: 'Floor Buff', code: 'MAT-02', name: 'Sealer Neutral', hex: '#E8E4DC' }] },
  'INS 01': { brandSystem: 'Commercial CAR Policy', specBadge: 'All-Risk Cover', patternKind: 'general', searchQuery: 'modern commercial office building architecture', finishes: [{ role: 'Coverage', code: 'CAR-100', name: 'Policy Navy', hex: '#1E3A5F' }, { role: 'Bond', code: 'WC-01', name: 'Slate Seal', hex: '#64748B' }] },

  'FL-CPT-01': {
    brandSystem: 'Interface® Human Connections', specBadge: 'Class 33 · Bfl-s1 · 500×500', patternKind: 'carpet',
    searchQuery: 'carpet tiles texture interior office flooring',
    finishes: [
      { role: 'Primary Tile', code: 'IF-7501 Stone', name: 'Woven Ash Charcoal', hex: '#4B4F54' },
      { role: 'Accent Tile', code: 'IF-7504 Pebble', name: 'Warm Quartz Grey', hex: '#908E88' },
      { role: 'Backing', code: 'CQuest™Bio', name: 'Acoustic Cushion Black', hex: '#222528' },
    ],
  },
  'FL-CPT-02': {
    brandSystem: 'Shaw Contract® Broadloom', specBadge: 'Acoustic PU · Cut-Pile', patternKind: 'carpet',
    searchQuery: 'commercial carpet flooring texture interior',
    finishes: [
      { role: 'Broadloom', code: 'SC-4429', name: 'Heathered Greige', hex: '#888278' },
      { role: 'Perimeter', code: 'SC-4435', name: 'Charcoal Border', hex: '#3B3E42' },
      { role: 'Underlay', code: 'PU-9mm', name: 'Acoustic Foam', hex: '#6A7178' },
    ],
  },
  'FL-POR-01': {
    brandSystem: 'RAK Ceramics® / Atlas Concorde®', specBadge: '600×600 · R10 Matte', patternKind: 'tile',
    searchQuery: 'porcelain floor tile matte texture architecture',
    finishes: [
      { role: 'Tile Body', code: 'AC-Boost Pearl', name: 'Rectified Limestone Pearl', hex: '#D4CFC6' },
      { role: 'Pattern Zone', code: 'AC-Boost Smoke', name: 'Architectural Warm Grey', hex: '#8E8B84' },
      { role: 'Epoxy Grout', code: 'MAPEI 111', name: 'Silver Grey', hex: '#9D9E9D' },
    ],
  },
  'FL-VNL-01': {
    brandSystem: 'Tarkett® iD Inspiration', specBadge: '0.55mm Wear · LVT', patternKind: 'vinyl',
    searchQuery: 'light oak vinyl plank wood flooring texture',
    finishes: [
      { role: 'Wood Plank', code: 'TK-2401', name: 'Scandi Bleached Oak', hex: '#CBB18B' },
      { role: 'Feature Grain', code: 'TK-2409', name: 'Smoked Chestnut', hex: '#7A5B43' },
      { role: 'PUR Shield', code: 'TEKTANIUM', name: 'Ultra-Matte Seal', hex: '#E4DED4' },
    ],
  },
  'FL-MRB-01': {
    brandSystem: 'Margraf® Volakas Marble', specBadge: '1200×600×20mm Honed', patternKind: 'marble',
    searchQuery: 'white carrara marble slab texture',
    finishes: [
      { role: 'Slab Base', code: 'MG-Carrara', name: 'Cool White Veined', hex: '#F1EFEA' },
      { role: 'Mineral Vein', code: 'MG-Vein', name: 'Dovegrey Vein', hex: '#B4B7BA' },
      { role: 'Grout Joint', code: 'MAPEI 100', name: 'Bianco', hex: '#E8E6E0' },
    ],
  },
  'FL-MRB-02': {
    brandSystem: 'Margraf® Basaltina / Pietra Grey', specBadge: '20mm Threshold Anchor', patternKind: 'marble',
    searchQuery: 'dark grey basalt stone flooring tile texture',
    finishes: [
      { role: 'Threshold Stone', code: 'PIETRA-GRY', name: 'Honed Charcoal Stone', hex: '#5A5855' },
      { role: 'Anchor Pin', code: 'SS-316', name: 'Stainless Dowel', hex: '#B8BFC4' },
      { role: 'Sealer', code: 'FILA-MP90', name: 'Impregnated Natural', hex: '#D8D4CC' },
    ],
  },
  'FL-LEV-01': {
    brandSystem: 'Mapei® Ultraplan Eco', specBadge: '5–8mm Self-Leveling', patternKind: 'cement',
    searchQuery: 'self leveling concrete floor screed cement',
    finishes: [
      { role: 'Compound', code: 'MP-3240', name: 'Cementitious Grey', hex: '#A4A7A9' },
      { role: 'Primer', code: 'ECO-PRIM', name: 'Acrylic Grip', hex: '#7C8B94' },
    ],
  },
  'FL-TRM-01': {
    brandSystem: 'Schlüter®-SCHIENE 304 SS', specBadge: '3mm Brushed Trim', patternKind: 'metal',
    searchQuery: 'brushed stainless steel floor transition strip',
    finishes: [
      { role: 'Profile', code: 'E-304', name: 'Brushed 304 Stainless', hex: '#C2C7CC' },
      { role: 'Insert', code: 'ANOD-BK', name: 'Shadow Groove', hex: '#2E3134' },
    ],
  },

  'PT-DRY-01': {
    brandSystem: 'Saint-Gobain Gyproc® + Isover®', specBadge: '125mm · STC 48dB Acoustic', patternKind: 'drywall',
    searchQuery: 'gypsum drywall partition wall studio white',
    finishes: [
      { role: 'Outer Paint', code: 'Jotun 1624', name: 'Skylight Matte White', hex: '#F3F2EE' },
      { role: 'Stud Frame', code: 'Gypframe 70', name: 'Galvanized C-Stud', hex: '#9DA5AC' },
      { role: 'Core Infill', code: 'Rockwool 60', name: 'Acoustic Mineral Wool', hex: '#A38B52' },
    ],
  },
  'PT-DRY-02': {
    brandSystem: 'Saint-Gobain Gyproc® MR', specBadge: '125mm Moisture-Resistant', patternKind: 'drywall',
    searchQuery: 'moisture resistant green gypsum board wall partition',
    finishes: [
      { role: 'Board Core', code: 'Gyproc MR', name: 'Moisture-Shield Green', hex: '#79A57C' },
      { role: 'Stud Grid', code: 'GI-70', name: 'Galvanized C-Stud', hex: '#9CA4AA' },
      { role: 'Acoustic Core', code: 'Isover', name: 'Sealed Wool Core', hex: '#A69058' },
    ],
  },
  'PT-GLS-01': {
    brandSystem: 'Saint-Gobain Planilux® + Optima®', specBadge: '12mm Clear Toughened', patternKind: 'glass',
    searchQuery: 'modern office glass partition black aluminum frame',
    finishes: [
      { role: 'Glazing', code: 'SG-12mm', name: 'Low-Iron Clear Glass', hex: '#CDE4ED' },
      { role: 'Track Profile', code: 'RAL 9005', name: 'Slim Matte Black Alum', hex: '#1C1D20' },
      { role: 'Silicone', code: 'Dow 995', name: 'Crystal Clear Joint', hex: '#E3EEF2' },
    ],
  },
  'PT-GLS-02': {
    brandSystem: 'Optima® Revolution 100', specBadge: '10+10mm Double-Glazed 45dB', patternKind: 'glass',
    searchQuery: 'double glazed acoustic office glass partition interior',
    finishes: [
      { role: 'Acoustic Glass', code: 'Stadip Silence', name: 'Crystal Twin Glaze', hex: '#BFE0EC' },
      { role: '75mm Frame', code: 'RAL 7021', name: 'Black-Grey Anodized', hex: '#2F3236' },
      { role: 'Manifestation', code: '3M Dusted', name: 'Architectural Mist Band', hex: '#E7EDF0' },
    ],
  },
  'PT-GLS-03': {
    brandSystem: 'Saint-Gobain Satinovo® Fluted', specBadge: '10–12mm Reeded Glass', patternKind: 'glass',
    searchQuery: 'fluted reeded glass partition architectural detail',
    finishes: [
      { role: 'Fluted Glass', code: 'Satinovo-R', name: 'Translucent Reeded', hex: '#D8E8EE' },
      { role: 'Channel', code: 'RAL 9005', name: 'Matte Black Slim', hex: '#1E2022' },
      { role: 'Sealant', code: 'CLR-02', name: 'Frosted Joint', hex: '#E8EFF2' },
    ],
  },
  'PT-TMP-01': {
    brandSystem: 'Site Protection Hoarding', specBadge: '2400mm Dust Barrier', patternKind: 'drywall',
    searchQuery: 'painted white plywood hoarding construction wall',
    finishes: [
      { role: 'Panel Finish', code: 'RAL 9010', name: 'Pure Site White', hex: '#F2F1EC' },
      { role: 'Trim', code: 'RAL 7037', name: 'Dusty Grey', hex: '#7D8285' },
    ],
  },
  'WC-WOD-01': {
    brandSystem: 'Alpi® / Egger® Quarter-Cut', specBadge: '18mm FR MDF Veneer', patternKind: 'wood',
    searchQuery: 'natural oak wood veneer wall paneling interior',
    finishes: [
      { role: 'Veneer Face', code: 'ALPI-10.30', name: 'Quarter-Cut White Oak', hex: '#C6A375' },
      { role: 'Alternate', code: 'H3702', name: 'Smoked Walnut', hex: '#5D4030' },
      { role: 'Shadow Reveal', code: 'RAL 9005', name: 'Black Concealed Clip', hex: '#1D1E21' },
    ],
  },
  'WC-FLT-01': {
    brandSystem: 'Autex® + Natural Timber Slats', specBadge: 'Fluted Acoustic NRC 0.85', patternKind: 'fluted',
    searchQuery: 'wooden acoustic slat wall panel interior design',
    finishes: [
      { role: 'Timber Slat', code: 'OAK-FLT-01', name: 'Natural European Oak', hex: '#C29D6E' },
      { role: 'PET Backing', code: 'Autex Noir', name: '9mm Acoustic Black', hex: '#1E2023' },
      { role: 'End Trim', code: 'RAL 9005', name: 'Matte Black Angle', hex: '#2A2C30' },
    ],
  },
  'WC-ACU-01': {
    brandSystem: 'Autex® / Vescom® Acoustic', specBadge: '50mm Fabric · NRC 0.85', patternKind: 'fabric',
    searchQuery: 'fabric wrapped acoustic wall panel texture interior',
    finishes: [
      { role: 'Primary Textile', code: 'Camira Sonus', name: 'Warm Pebble Acoustic', hex: '#B4ACA0' },
      { role: 'Accent Textile', code: 'Autex Highland', name: 'Deep Petrol Slate', hex: '#344B57' },
      { role: 'Core', code: 'OC-703', name: 'High-Density Core', hex: '#D8C78E' },
    ],
  },
  'WC-MTL-01': {
    brandSystem: 'Rimex® / Grade 304 PVD', specBadge: '1.5mm Shadow-Gap Trim', patternKind: 'metal',
    searchQuery: 'brushed brass bronze metal architectural trim interior',
    finishes: [
      { role: 'Primary PVD', code: 'PVD-BRS', name: 'Brushed Champagne Brass', hex: '#B7995B' },
      { role: 'Dark PVD', code: 'PVD-BLK', name: 'Black Satin PVD 304', hex: '#232428' },
    ],
  },

  'CL-GYP-01': {
    brandSystem: 'Gyproc® 12.5mm + Jotun®', specBadge: 'Concealed MF · Shadow Gap', patternKind: 'ceiling',
    searchQuery: 'modern recessed gypsum false ceiling lighting interior',
    finishes: [
      { role: 'Ceiling Coat', code: 'Jotun 9918', name: 'Classic Matte White', hex: '#F6F6F3' },
      { role: 'Shadow Trim', code: 'RAL 9016', name: 'Recessed Perimeter', hex: '#DCDEDB' },
      { role: 'Grid Suspension', code: 'MF-05', name: 'Concealed GI Steel', hex: '#98A0A7' },
    ],
  },
  'CL-ACU-01': {
    brandSystem: 'Armstrong® Zentia Dune', specBadge: '600×600 Tegular · NRC 0.70', patternKind: 'ceiling',
    searchQuery: 'suspended acoustic ceiling grid tile office',
    finishes: [
      { role: 'Mineral Tile', code: 'ZT-BP14', name: 'Clean Fine White', hex: '#F2F3F0' },
      { role: 'Exposed T-Bar', code: '15mm White', name: 'Silhouette Grid White', hex: '#E5E7EB' },
    ],
  },
  'CL-ACU-02': {
    brandSystem: 'Autex® Cube Baffles / Clouds', specBadge: 'Suspended NRC 0.90', patternKind: 'ceiling',
    searchQuery: 'suspended acoustic ceiling baffles modern office',
    finishes: [
      { role: 'Baffle Felt', code: 'Autex Mist', name: 'Warm Silver Grey', hex: '#B8BDC2' },
      { role: 'Feature Baffle', code: 'Autex Terracotta', name: 'Warm Clay', hex: '#A55A42' },
      { role: 'Hanger', code: 'SS-1.5', name: 'Braided Wire Drop', hex: '#7F868D' },
    ],
  },
  'CL-WOD-01': {
    brandSystem: 'Hunter Douglas® HeartFelt / Baffle', specBadge: 'White Oak Slat Baffle', patternKind: 'fluted',
    searchQuery: 'wooden slat ceiling architecture modern interior',
    finishes: [
      { role: 'Slat Veneer', code: 'HD-Oak-02', name: 'Natural White Oak', hex: '#C6A476' },
      { role: 'Carrier Rail', code: 'RAL 9005', name: 'Matte Black U-Carrier', hex: '#1C1D1F' },
      { role: 'Acoustic Fleece', code: 'NF-BK', name: 'Black Non-Woven', hex: '#282A2E' },
    ],
  },
  'CL-PNT-01': {
    brandSystem: 'Jotun® Majestic Exposed Soffit', specBadge: '2-Coat Anti-Dust Matte', patternKind: 'ceiling',
    searchQuery: 'industrial black exposed concrete soffit ceiling office',
    finishes: [
      { role: 'Soffit Spray', code: 'RAL 7021', name: 'Black-Grey Anti-Dust', hex: '#2B2E31' },
      { role: 'Services Coat', code: 'RAL 9005', name: 'Jet Black Matte', hex: '#1B1C1E' },
    ],
  },

  'DR-SWG-01': {
    brandSystem: 'HPL Timber Core + Dormakaba®', specBadge: '900×2100×45mm · 30dB', patternKind: 'door',
    searchQuery: 'modern oak wood flush interior office door hardware',
    finishes: [
      { role: 'Door Leaf HPL', code: 'Formica 8843', name: 'Natural Ash Laminate', hex: '#C4A57B' },
      { role: 'Subframe', code: 'RAL 9005', name: 'Matte Black Aluminum', hex: '#1E2022' },
      { role: 'Ironmongery', code: 'Dormakaba SS', name: 'Brushed 304 Stainless', hex: '#C2C7CC' },
    ],
  },
  'DR-SWG-02': {
    brandSystem: 'Acoustic Double Leaf + Dormakaba®', specBadge: '1800×2100mm · Vision Panel', patternKind: 'door',
    searchQuery: 'double leaf wooden commercial door glass vision panel',
    finishes: [
      { role: 'Timber Veneer', code: 'Walnut FR', name: 'Quarter-Cut Walnut', hex: '#634331' },
      { role: 'Vision Bead', code: 'RAL 9005', name: 'Matte Black', hex: '#202225' },
      { role: 'Panic / Closer', code: 'Dormakaba TS93', name: 'Brushed Stainless', hex: '#C5CACF' },
    ],
  },
  'DR-GLS-01': {
    brandSystem: 'Optima® + Dormakaba® Patch', specBadge: '12mm Frameless · Soft-Close', patternKind: 'glass',
    searchQuery: 'frameless glass office door stainless handle',
    finishes: [
      { role: 'Door Leaf', code: 'SG-12mm', name: 'Clear Toughened Safety', hex: '#CEE5EE' },
      { role: 'Patch / Handle', code: 'SS-304', name: 'Satin Stainless / Black', hex: '#BFC5CA' },
    ],
  },
  'DR-SLD-01': {
    brandSystem: 'Dormakaba® MUTO + Tempered Glass', specBadge: 'Overhead Soft-Close Track', patternKind: 'glass',
    searchQuery: 'glass sliding door black aluminum track modern office',
    finishes: [
      { role: 'Glass Panel', code: 'SG-10mm', name: 'Clear Tempered Glass', hex: '#CBE3EC' },
      { role: 'Overhead Track', code: 'RAL 9005', name: 'Anodized Matte Black', hex: '#1D1E21' },
      { role: 'Manifestation', code: '3M 7725', name: 'Frosted Architectural Film', hex: '#E6ECEF' },
    ],
  },
  'WN-BLD-01': {
    brandSystem: 'Phifer® SheerWeave + Coulisse®', specBadge: '5% Openness Sunscreen', patternKind: 'fabric',
    searchQuery: 'modern commercial office roller blinds window',
    finishes: [
      { role: 'Screen Mesh', code: 'SW-2390 V10', name: 'Chalk / Pearl 5%', hex: '#E3DFD6' },
      { role: 'Charcoal Option', code: 'SW-2390 Q06', name: 'Charcoal Bronze 5%', hex: '#4B4A48' },
      { role: 'Bottom Bar', code: 'ANOD-SL', name: 'Clear Anodized Alum', hex: '#B8BDC2' },
    ],
  },
  'WN-CUR-01': {
    brandSystem: 'Somfy® Sonesse + Dimout Fabric', specBadge: 'Motorized Blackout / Ripple', patternKind: 'fabric',
    searchQuery: 'motorized blackout curtain drape modern window interior',
    finishes: [
      { role: 'Drapery Textile', code: 'Vescom Tica', name: 'Warm Sand Blackout', hex: '#C7BFB1' },
      { role: 'Sheer Layer', code: 'Creation Baumann', name: 'Ivory Voile', hex: '#F1EEE7' },
      { role: 'Track', code: 'Somfy Glydea', name: 'Recessed White Track', hex: '#ECECE8' },
    ],
  },

  'FN-PNT-01': {
    brandSystem: 'Jotun® Fenomastic My Home', specBadge: 'Low-VOC Washable Matte', patternKind: 'paint',
    searchQuery: 'matte white plaster painted wall architecture texture',
    finishes: [
      { role: 'Field Wall', code: 'Jotun 1624', name: 'Skylight Pure Matte', hex: '#F3F1EC' },
      { role: 'Warm Neutral', code: 'Jotun 10678', name: 'Space Warm Greige', hex: '#D8CFC2' },
      { role: 'Accent Wall', code: 'Jotun 9938', name: 'Dempet Sort Charcoal', hex: '#383A3D' },
    ],
  },
  'FN-PNT-02': {
    brandSystem: 'Jotun® Lady Minerals Lime', specBadge: 'Textured Mineral Effect', patternKind: 'paint',
    searchQuery: 'textured lime wash plaster wall finish interior',
    finishes: [
      { role: 'Mineral Wash', code: 'Jotun 12078', name: 'Comfort Grey Lime', hex: '#B6B0A6' },
      { role: 'Clay Option', code: 'Jotun 20142', name: 'Daydream Terracotta', hex: '#9E6E5B' },
      { role: 'Top Sealer', code: 'Matte Coat', name: 'Breathable Sealer', hex: '#E6E2DA' },
    ],
  },
  'FN-WLP-01': {
    brandSystem: 'Vescom® Type II Vinyl (B-s1,d0)', specBadge: '350 g/m² Heavy Contract', patternKind: 'fabric',
    searchQuery: 'textured woven linen vinyl wallcovering texture',
    finishes: [
      { role: 'Primary Weave', code: 'VS-2055.02', name: 'Natural Woven Flax', hex: '#D1C9BA' },
      { role: 'Dark Linen', code: 'VS-2055.19', name: 'Smoke Taupe', hex: '#7A746C' },
      { role: 'Joint', code: 'Overlap-Cut', name: 'Seamless Butted', hex: '#E4DFD6' },
    ],
  },
  'FN-SKT-01': {
    brandSystem: 'Anodized Aluminum / Solid Oak', specBadge: '18×100mm Shadow Profile', patternKind: 'metal',
    searchQuery: 'flush shadow gap baseboard skirting modern interior',
    finishes: [
      { role: 'Profile', code: 'RAL 9005', name: 'Anodized Matte Black', hex: '#232528' },
      { role: 'Timber Match', code: 'OAK-100', name: 'Natural Oak Matched', hex: '#C4A274' },
    ],
  },
  'FN-MIR-01': {
    brandSystem: 'Saint-Gobain Miralite® Revolution', specBadge: '6mm Copper-Free · 3000K LED', patternKind: 'glass',
    searchQuery: 'backlit round bathroom vanity mirror led light',
    finishes: [
      { role: 'Silver Glass', code: 'Miralite 6mm', name: 'Clear Polished Mirror', hex: '#D8E3E8' },
      { role: 'LED Halo', code: '3000K CRI90', name: 'Warm Backlit Strip', hex: '#F6DF9F' },
      { role: 'Edge Frame', code: 'PVC-BK', name: 'Brushed Black Seal', hex: '#25272A' },
    ],
  },
  'FN-ART-01': {
    brandSystem: 'Museum Archival Frame + Canvas', specBadge: 'Security Cleated Artwork', patternKind: 'fabric',
    searchQuery: 'minimalist framed abstract canvas artwork wall',
    finishes: [
      { role: 'Frame', code: 'RAL 9005', name: 'Gallery Matte Black', hex: '#1F2022' },
      { role: 'Mat Board', code: 'Museum Rag', name: 'Warm Cotton Rag', hex: '#F4F1EA' },
      { role: 'Palette', code: 'Terracotta/Indigo', name: 'Curated Tone', hex: '#5D6E7A' },
    ],
  },

  'JN-PNT-01': {
    brandSystem: 'Egger® HPL + Silestone® Quartz', specBadge: '600mm Deep Base Joinery', patternKind: 'wood',
    searchQuery: 'modern office pantry kitchenette wood quartz counter',
    finishes: [
      { role: 'Countertop', code: 'Silestone Glow', name: '20mm White Quartz', hex: '#F1EFEA' },
      { role: 'Door Front', code: 'Egger H1385', name: 'Casella Natural Oak', hex: '#C5A274' },
      { role: 'Kick Plinth', code: 'RAL 9005', name: 'Matte Black Recessed', hex: '#1E2022' },
    ],
  },
  'JN-PNT-02': {
    brandSystem: 'Egger® Matte HPL + Blum®', specBadge: '350mm Overhead Millwork', patternKind: 'wood',
    searchQuery: 'minimalist overhead kitchen cabinets matte finish',
    finishes: [
      { role: 'Cabinet Door', code: 'Egger U708', name: 'Light Warm Grey HPL', hex: '#D2D0CB' },
      { role: 'Bulkhead', code: 'Jotun 1624', name: 'Flush Gypsum White', hex: '#F3F2EE' },
    ],
  },
  'JN-VAN-01': {
    brandSystem: 'DuPont™ Corian® + Moisture HMR', specBadge: 'Floating Washroom Vanity', patternKind: 'marble',
    searchQuery: 'modern floating corian bathroom vanity counter ceramic basin',
    finishes: [
      { role: 'Solid Surface', code: 'Corian Glacier', name: 'Glacier White Seamless', hex: '#F5F4F0' },
      { role: 'Lower Apron', code: 'ALPI Walnut', name: 'Sealed Timber / Slate', hex: '#635347' },
      { role: 'Faucet Spec', code: 'Grohe Chrome', name: 'Polished Chrome', hex: '#C9CFD4' },
    ],
  },
  'JN-WB-01': {
    brandSystem: 'Back-Painted Magnetic Glass', specBadge: 'Concealed Biophilic Planter', patternKind: 'glass',
    searchQuery: 'modern glass whiteboard wall integrated planter office',
    finishes: [
      { role: 'Writing Glass', code: 'RAL 9010', name: 'Low-Iron Magnetic White', hex: '#EFF4F6' },
      { role: 'Frame Tray', code: 'OAK-01', name: 'Quarter-Cut Oak Ledge', hex: '#C4A274' },
      { role: 'Foliage Insert', code: 'BG-01', name: 'Natural Olive/Pothos', hex: '#5C7C54' },
    ],
  },

  'MEP-LGT-01': {
    brandSystem: 'ERCO® / Zumtobel® PANOS', specBadge: '36W · UGR<19 · CRI>90 DALI', patternKind: 'lighting',
    searchQuery: 'recessed led architectural ceiling downlight white trim',
    finishes: [
      { role: 'Bezel Trim', code: 'RAL 9016', name: 'Matte Plaster White', hex: '#F4F4F1' },
      { role: 'Reflector', code: 'AL-SPEC', name: 'Low-Glare Darklight', hex: '#383C42' },
      { role: 'CCT', code: '4000K CRI90', name: 'Neutral Architectural', hex: '#FFF4DC' },
    ],
  },
  'MEP-LGT-02': {
    brandSystem: 'Zumtobel® TECTON / Linear', specBadge: '18W/m · Opal Diffuser', patternKind: 'lighting',
    searchQuery: 'linear suspended led ceiling profile architectural lighting',
    finishes: [
      { role: 'Housing', code: 'RAL 9005', name: 'Anodized Black Alum', hex: '#1E2023' },
      { role: 'Diffuser', code: 'PMMA-OP', name: 'Satin Opal Acrylic', hex: '#FAF8F0' },
    ],
  },
  'MEP-LOG-01': {
    brandSystem: '3mm Brushed Brass + Halo LED', specBadge: 'CNC Backlit Signage 3000K', patternKind: 'metal',
    searchQuery: 'backlit brass company signage logo reception wall',
    finishes: [
      { role: 'CNC Face', code: 'BRS-PVD', name: 'Brushed Brass 304 SS', hex: '#B89A58' },
      { role: 'Halo Glow', code: 'LED-3000K', name: 'Warm Backlight', hex: '#F8DDA0' },
    ],
  },
  'MEP-SAN-01': {
    brandSystem: 'Franke® 304 SS + Grohe® Mixer', specBadge: 'Undermount Single Bowl', patternKind: 'sanitary',
    searchQuery: 'stainless steel kitchen sink chrome faucet mixer',
    finishes: [
      { role: 'Bowl Finish', code: 'SS-304 Satin', name: 'Brushed Stainless', hex: '#C3C8CD' },
      { role: 'Mixer', code: 'Grohe StarLight', name: 'Polished Chrome', hex: '#DCE1E6' },
    ],
  },
  'MEP-SAN-02': {
    brandSystem: 'Duravit® ME by Starck + Geberit®', specBadge: 'Vitreous China Dual-Flush WC', patternKind: 'sanitary',
    searchQuery: 'wall hung ceramic toilet wc modern bathroom',
    finishes: [
      { role: 'Ceramic Body', code: 'Alpin 00', name: 'Gloss White Vitreous', hex: '#F8F8F6' },
      { role: 'Flush Plate', code: 'Geberit Sigma', name: 'Brushed Chrome / Black', hex: '#C6CBD0' },
    ],
  },
  'MEP-SAN-03': {
    brandSystem: 'Duravit® Vero / Villeroy + Grohe®', specBadge: 'Ceramic Basin + Single Lever', patternKind: 'sanitary',
    searchQuery: 'ceramic bathroom wash basin chrome tap mixer',
    finishes: [
      { role: 'Basin', code: 'Alpin 00', name: 'Vitreous China White', hex: '#F8F8F6' },
      { role: 'Mixer Tap', code: 'Grohe Eurosmart', name: 'Chrome StarLight', hex: '#C8CDD2' },
    ],
  },
  'MEP-SAN-04': {
    brandSystem: 'Grohe® Tempesta Thermostatic', specBadge: 'Chrome Rain + Hand Shower', patternKind: 'sanitary',
    searchQuery: 'modern chrome thermostatic rain shower mixer bathroom',
    finishes: [
      { role: 'Valve & Head', code: 'StarLight CR', name: 'Mirror Polished Chrome', hex: '#D0D6DC' },
      { role: 'Enclosure Trim', code: 'AL-BK', name: 'Brushed Nickel / Black', hex: '#4B5056' },
    ],
  },
  'MEP-WRG-01': {
    brandSystem: 'Legrand® Arteor + Cat6A', specBadge: 'Flush Floor Box / Dado Outlet', patternKind: 'metal',
    searchQuery: 'stainless steel flush floor box power socket office',
    finishes: [
      { role: 'Floor Lid', code: 'SS-BR', name: 'Brushed Stainless Steel', hex: '#B9BFC5' },
      { role: 'Insert Module', code: 'Legrand Graphite', name: 'Anthracite Socket', hex: '#383B40' },
    ],
  },
  'MEP-AV-01': {
    brandSystem: 'Samsung® QMC 4K + Chief® Mount', specBadge: '65"-75" UHD · Anti-Glare', patternKind: 'screen',
    searchQuery: 'commercial wall mounted 4k flat screen television meeting room',
    finishes: [
      { role: 'Bezel & Frame', code: 'Slim 28mm', name: 'Anodized Titan Black', hex: '#1B1D20' },
      { role: 'Display Panel', code: 'QMC Non-Glare', name: 'Anti-Reflective Obsidian', hex: '#282C34' },
      { role: 'Wall Bracket', code: 'Chief LTM1U', name: 'Micro-Tilt Steel Black', hex: '#383C42' },
    ],
  },
};

/**
 * GCC Commercial Fit-Out Manufacturers & Photorealistic Material Swatch Prompts.
 * Applied directly onto FITOUT_OFFICIAL_FINISH_CARDS so both frontend Finish Cards,
 * export suites, and the material visual generator share a single source of truth.
 */
const FITOUT_GCC_PROFILES = {
  'MOB 01': {
    manufacturer: '',
    brandSystem: 'GCC Contract Standard',
    photoPrompt: 'Clean architectural site setup material sample flatlay: white painted steel site hoarding panel corner, galvanized steel angle bracket, construction plans rolled neatly on neutral grey concrete workbench, crisp studio lighting, no text or watermarks',
  },
  'UTIL 01': {
    manufacturer: 'Schneider Electric',
    brandSystem: 'Schneider Electric® / ABB®',
    photoPrompt: 'Macro studio product photograph of industrial Schneider PrismaSeT RAL 7035 powder-coated grey steel electrical distribution enclosure door with heavy-duty rotary isolator switch and copper busbar detail on neutral studio surface, realistic architectural hardware photography, no overlaid text',
  },
  'HSE 01': {
    manufacturer: 'NAFFCO',
    brandSystem: 'NAFFCO® / Civil Defense',
    photoPrompt: 'Studio product photograph of brushed stainless and glossy fire-red powder coated NAFFCO commercial fire extinguisher cabinet with photoluminescent safety aluminum backing plate and green exit trim detail, photorealistic commercial building hardware, clean lighting, no text',
  },
  'DEB 01': {
    manufacturer: '',
    brandSystem: 'GCC Contract Standard',
    photoPrompt: 'Architectural protection material sample pair: fluted rigid polypropylene floor protection sheet (3mm charcoal) overlapped with heavy-duty woven geotextile protection membrane on concrete subfloor, studio macro shot, realistic construction materials, no text',
  },
  'CLN 01': {
    manufacturer: '3M Commercial',
    brandSystem: '3M™ Commercial Care',
    photoPrompt: 'Studio still life of crystal-clear post-construction polished low-iron glass corner meeting freshly sealed honed stone tile edge with commercial microfiber buffing pad and stainless squeegee blade, bright clean architectural studio photography, no text',
  },
  'INS 01': {
    manufacturer: '',
    brandSystem: 'GCC Contract Standard',
    photoPrompt: 'Minimalist architectural project specification binder in charcoal linen cloth alongside calibrated brass vernier caliper and concrete core sample on stone surface, clean warm daylight studio photography, no text',
  },
  'FL-CPT-01': {
    manufacturer: 'Interface',
    brandSystem: 'Interface® Human Connections',
    photoPrompt: 'Overhead 45-degree close-up studio material sample photograph of commercial 500x500mm tufted loop-pile carpet tile in warm stone grey and pebble heather texture showing heavy-duty bitumen acoustic backing edge lifted slightly, crisp woven yarn detail, no text',
  },
  'FL-CPT-02': {
    manufacturer: 'Shaw Contract',
    brandSystem: 'Shaw Contract® Broadloom',
    photoPrompt: 'Close-up studio photograph of plush commercial cut-pile broadloom carpet sample in warm taupe and slate heather with dense 9mm green high-density polyurethane acoustic cushion underlay peeking at beveled cut edge, rich textile grain, no text',
  },
  'FL-POR-01': {
    manufacturer: 'RAK Ceramics',
    brandSystem: 'RAK Ceramics® Surface Tech',
    finishes: [
      { role: 'Field Tile', code: 'RAK Atlas Warm', name: 'Warm Limestone Matte R10', hex: '#D8CFC2' },
      { role: 'Accent Tile', code: 'RAK Basalt Grey', name: 'Full-Body Anthracite Matte', hex: '#6F7275' },
      { role: 'Adhesive / Grout', code: 'MAPEI 111', name: 'Silver Grey C2TE + Epoxy', hex: '#9DA3A8' },
    ],
    photoPrompt: 'Architectural flatlay photograph of rectified 10mm full-body matte porcelain floor tile samples in warm Gulf limestone beige and basalt charcoal grey showing crisp kiln-fired porcelain body edge beside troweled Mapei silver grey epoxy grout joint, natural raking studio light, no text',
  },
  'FL-VNL-01': {
    manufacturer: 'Tarkett',
    brandSystem: 'Tarkett® iD Inspiration',
    photoPrompt: 'Close-up studio material sample photograph of commercial luxury vinyl plank LVT in natural Nordic brushed oak and warm greige stone texture showing multi-layer acoustic PVC backing at a fanned corner stack, realistic wood-grain embossing, no text',
  },
  'FL-MRB-01': {
    manufacturer: 'Al Turki Enterprises (Omani Marble)',
    brandSystem: 'Omani Marble (Al Turki Ibri Crema)',
    finishes: [
      { role: 'Primary Stone', code: 'Ibri Crema', name: 'Omani Crema Polished Slab', hex: '#E6D6BF' },
      { role: 'Secondary Vein', code: 'Sohar Beige', name: 'Omani Desert Warm Vein', hex: '#CBB393' },
      { role: 'Bedding Mortar', code: 'MAPEI 100', name: 'Keraflex White Marble Glue', hex: '#EFECE6' },
    ],
    photoPrompt: 'Luxury architectural stone sample photograph of genuine Omani Marble Ibri Crema 20mm thick slab polished face next to Sohar warm beige marble corner cut, showing authentic warm cream-beige limestone base with delicate amber and honey mineral veins and crisp sawn 20mm marble edge thickness, studio macro lighting, no text',
  },
  'FL-MRB-02': {
    manufacturer: 'Al Turki Enterprises (Omani Marble)',
    brandSystem: 'Omani Marble (Nizwa Limestone / SS-316)',
    finishes: [
      { role: 'Stone Cut', code: 'Nizwa Desert', name: 'Omani Honed Limestone 20mm', hex: '#D5C3A5' },
      { role: 'Mechanical Anchor', code: 'SS-316', name: 'Marine Stainless Kerf Bracket', hex: '#A4ABB2' },
      { role: 'Stone Sealer', code: 'FILA-MP90', name: 'Penetrating Oleophobic Seal', hex: '#E8E3D9' },
    ],
    photoPrompt: 'Architectural detail sample photograph of 20mm thick honed Omani Nizwa beige limestone slab edge slotted onto a brushed 316 stainless steel mechanical Z-kerf anchor bracket over cementitious mortar substrate, crisp mineral stone pores and metal machining detail, no text',
  },
  'FL-LEV-01': {
    manufacturer: 'Mapei',
    brandSystem: 'Mapei® Ultraplan Eco',
    photoPrompt: 'Cross-section architectural substrate sample block showing smooth troweled dark grey polymer-modified self-leveling cementitious screed layer bonded cleanly over primed coarse concrete subfloor core, studio lighting, no text',
  },
  'FL-TRM-01': {
    manufacturer: 'Schlüter-Systems',
    brandSystem: 'Schlüter®-SCHIENE 304 SS',
    photoPrompt: 'Macro studio photograph of brushed Grade 304 stainless steel and matte black anodized aluminum T-profile and L-profile floor transition trim strips resting between a matte limestone porcelain tile edge and woven grey carpet tile, crisp metalwork reflections, no text',
  },
  'PT-DRY-01': {
    manufacturer: 'Knauf',
    brandSystem: 'Knauf® GKB 12.5mm + Isover®',
    finishes: [
      { role: 'Paint Finish', code: 'Jotun 1624', name: 'Skylight Matte Emulsion', hex: '#ECEBE6' },
      { role: 'Gypsum Board & Stud', code: 'Knauf GKB 12.5', name: 'Double Ivory Board + 70mm GI', hex: '#D8D4C9' },
      { role: 'Acoustic Core', code: 'Rockwool 60', name: '60kg/m³ Mineral Wool Batts', hex: '#C7B68A' },
    ],
    photoPrompt: 'Architectural cutaway assembly sample photograph of Knauf drywall partition system: double 12.5mm taper-edge ivory gypsum plasterboards screwed onto galvanized steel C-stud framing filled cleanly with dense golden-brown rockwool acoustic insulation core, bright studio cutaway, no text',
  },
  'PT-DRY-02': {
    manufacturer: 'Knauf',
    brandSystem: 'Knauf® GKBI Moisture-Resistant',
    finishes: [
      { role: 'Board Core', code: 'Knauf GKBI', name: 'Moisture-Resistant Green Core', hex: '#9EBCA3' },
      { role: 'Stud System', code: 'Knauf CW-70', name: '0.6mm Galvanized Track', hex: '#B4BAC0' },
      { role: 'Acoustic Infill', code: 'Isover 50mm', name: 'Foil-Faced Mineral Wool', hex: '#CBB882' },
    ],
    photoPrompt: 'Architectural cutaway assembly sample of Knauf moisture-resistant GKBI green-faced gypsum plasterboard twin layer mounted on galvanized steel C-channel stud track with dense mineral wool acoustic batt visible in cross-section, clean studio lighting, no text',
  },
  'PT-GLS-01': {
    manufacturer: 'Guardian Glass / Optima',
    brandSystem: 'Guardian® Planibel + Optima®',
    photoPrompt: 'Architectural detail photograph of 12mm crystal-clear low-iron toughened glass partition corner seated cleanly inside a slim matte black anodized aluminum U-channel track with translucent structural silicone joint on honed floor tile, studio daylight, no text',
  },
  'PT-GLS-02': {
    manufacturer: 'Optima',
    brandSystem: 'Optima® Revolution 100',
    photoPrompt: 'Architectural corner cutaway sample of double-glazed acoustic glass partition: twin panes of 10mm laminated acoustic glass set parallel inside a precision anthracite grey powder-coated 75mm aluminum mullion frame with black acoustic gasket strip, studio product shot, no text',
  },
  'PT-GLS-03': {
    manufacturer: 'Saint-Gobain',
    brandSystem: 'Saint-Gobain Satinovo® Fluted',
    photoPrompt: 'Close-up architectural sample photograph of ribbed vertical fluted reeded translucent glass panel alongside acid-etched satin frosted glass panel framed in slim matte black anodized aluminum glazing bead, soft diffused backlight through glass grooves, no text',
  },
  'PT-TMP-01': {
    manufacturer: '',
    brandSystem: 'GCC Site Protection Standard',
    photoPrompt: 'Clean architectural sample detail of white painted structural plywood site hoarding panel joint with matte grey steel kickplate channel and galvanized corner lock clasp on concrete slab, clean studio photo, no text',
  },
  'WC-WOD-01': {
    manufacturer: 'Alpi / Egger',
    brandSystem: 'Alpi® / Egger® Quarter-Cut',
    photoPrompt: 'Architectural joinery sample board showing quarter-cut natural European white oak wood veneer and warm American walnut veneer pressed onto 18mm dark fire-rated MDF core with crisp shadow-gap aluminum reveal spline, rich wood pore macro photography, no text',
  },
  'WC-FLT-01': {
    manufacturer: 'Autex',
    brandSystem: 'Autex® + Natural Timber Slats',
    photoPrompt: 'Three-quarter studio photograph of architectural fluted vertical natural oak timber slats bonded cleanly onto deep charcoal black 9mm PET recycled acoustic felt backing panel, warm directional lighting casting crisp linear shadows, no text',
  },
  'WC-ACU-01': {
    manufacturer: 'Autex / Vescom',
    brandSystem: 'Autex® / Vescom® Acoustic',
    photoPrompt: 'Studio photograph of chamfered square acoustic wall panels upholstered in finely woven oatmeal linen and slate blue architectural wool acoustic fabric with cutaway corner revealing dense rigid fiberglass acoustic core, crisp weave texture, no text',
  },
  'WC-MTL-01': {
    manufacturer: 'Rimex Metals',
    brandSystem: 'Rimex® / Grade 304 PVD',
    photoPrompt: 'Macro studio photograph of hairline satin brushed warm champagne brass PVD and matte brushed black PVD Grade 304 stainless steel architectural trim T-profiles and bevel strips on dark slate stone, realistic metallic sheen, no text',
  },
  'CL-GYP-01': {
    manufacturer: 'Knauf',
    brandSystem: 'Knauf® MF Ceiling + Jotun®',
    finishes: [
      { role: 'Ceiling Paint', code: 'Jotun 9918', name: 'Classic White Ultra Matte', hex: '#F3F2EE' },
      { role: 'Board / Grid', code: 'Knauf GKB 12.5', name: 'Flush Skimmed Taper-Edge', hex: '#F5F5F3' },
      { role: 'Perimeter Shadow', code: 'MF Shadow Angle', name: '20mm Matte Black Reveal', hex: '#2B2E33' },
    ],
    photoPrompt: 'Architectural cutaway model photograph showing suspended 12.5mm Knauf gypsum plasterboard ceiling corner painted matte pure white supported from above by galvanized steel MF primary channels, furring clips and threaded rod hanger with slim matte black shadow-gap perimeter trim, studio daylight, no text',
  },
  'CL-ACU-01': {
    manufacturer: 'Knauf Ceiling Solutions',
    brandSystem: 'Knauf® Armstrong® Zentia Dune',
    photoPrompt: 'Close-up architectural sample photograph of white micro-perforated 600x600mm mineral fiber tegular acoustic ceiling tiles nested crisply into a flush 15mm exposed white T-bar ceiling grid, showing crisp sand-textured acoustic surface and recessed edge reveal, no text',
  },
  'CL-ACU-02': {
    manufacturer: 'Autex',
    brandSystem: 'Autex® Cube Baffles / Clouds',
    photoPrompt: 'Studio architectural sample photograph of suspended rectangular acoustic PET ceiling baffles in soft mist grey and muted terracotta clay tones hung vertically on fine stainless steel aircraft cable grippers, clean modern ceiling detail, no text',
  },
  'CL-WOD-01': {
    manufacturer: 'Hunter Douglas',
    brandSystem: 'Hunter Douglas® HeartFelt / Baffle',
    photoPrompt: 'Three-quarter underside studio photograph of linear white oak wood-grain aluminum baffle ceiling blades clipped onto a matte black carrier rail with black acoustic nonwoven fleece liner between blades, crisp architectural shadow lines, no text',
  },
  'CL-PNT-01': {
    manufacturer: 'Jotun',
    brandSystem: 'Jotun® Majestic Exposed Soffit',
    photoPrompt: 'Macro studio architectural surface sample of raw cast concrete soffit slab corner spray-coated half in ultra-matte anthracite charcoal grey Jotun anti-dust acrylic paint with clean masking line against galvanized round HVAC duct clamp, realistic matte paint texture, no text',
  },
  'DR-SWG-01': {
    manufacturer: 'Dormakaba',
    brandSystem: 'HPL Timber Core + Dormakaba®',
    photoPrompt: 'Architectural door section corner sample showing solid-core acoustic timber door leaf faced in warm grey-taupe matte Formica HPL laminate with solid oak lipping, embedded perimeter intumescent smoke seal and brushed stainless steel lever handle on rose, studio photo, no text',
  },
  'DR-SWG-02': {
    manufacturer: 'Dormakaba',
    brandSystem: 'Acoustic Double Leaf + Dormakaba®',
    photoPrompt: 'Architectural detail photograph of double-leaf smoked walnut HPL solid-core acoustic door meeting stile edge with slim glass vision panel bead, black acoustic perimeter gasket and brushed silver overhead cam-action door closer arm, studio lighting, no text',
  },
  'DR-GLS-01': {
    manufacturer: 'Dormakaba / Optima',
    brandSystem: 'Optima® + Dormakaba® Patch',
    photoPrompt: 'Close-up studio photograph of 12mm clear toughened glass door corner fitted with precision satin brushed 304 stainless steel hydraulic top/bottom patch fitting, tubular stainless pull handle and anodized aluminum floor track, realistic reflections, no text',
  },
  'DR-SLD-01': {
    manufacturer: 'Dormakaba',
    brandSystem: 'Dormakaba® MUTO + Tempered Glass',
    photoPrompt: 'Macro architectural hardware sample of slim matte black anodized aluminum Dormakaba overhead sliding glass track with concealed soft-close roller carriage gripping 10mm tempered glass panel etched with clean frosted stripe manifestation band, studio lighting, no text',
  },
  'WN-BLD-01': {
    manufacturer: 'Phifer / Coulisse',
    brandSystem: 'Phifer® SheerWeave + Coulisse®',
    photoPrompt: 'Close-up studio material sample photograph of commercial PVC-coated fiberglass sunscreen roller blind woven mesh fabric (5% openness) in chalk white and warm linen grey, unrolled slightly from a brushed aluminum weighted bottom hem bar and stainless beaded chain control, crisp translucent weave, no text',
  },
  'WN-CUR-01': {
    manufacturer: 'Somfy',
    brandSystem: 'Somfy® Sonesse + Dimout Fabric',
    photoPrompt: 'Studio architectural sample of woven slate-grey dimout acoustic drapery fabric hanging in crisp ripple-fold waves beneath a ceiling-recessed Somfy anodized white aluminum motorized track with braided silent belt drive cutaway, soft raking studio light, no text',
  },
  'FN-PNT-01': {
    manufacturer: 'Jotun',
    brandSystem: 'Jotun® Fenomastic My Home',
    photoPrompt: 'Architectural paint finish sample board trio rendered in silky ultra-matte Jotun Fenomastic interior wall emulsion in warm alabaster white, Scandinavian sand beige and soft greige over smooth gypsum skim coat alongside a clean fine-nap paint roller edge, true color studio daylight, no text',
  },
  'FN-PNT-02': {
    manufacturer: 'Jotun',
    brandSystem: 'Jotun® Lady Minerals Lime',
    photoPrompt: 'Macro studio photograph of trowel-applied Jotun Lady Minerals limewash textured feature wall paint panels in warm desert clay sand and terracotta earth tones showing subtle organic mineral brush movement and chalky matte depth, no text',
  },
  'FN-WLP-01': {
    manufacturer: 'Vescom',
    brandSystem: 'Vescom® Type II Vinyl (B-s1,d0)',
    photoPrompt: 'Studio flatlay photograph of rolled and flat commercial Type II non-woven backed Vescom vinyl wallcovering swatches featuring fine woven silk-linen embossing in oyster ivory and slate pebble with clean double-cut butt seam joint, macro texture, no text',
  },
  'FN-SKT-01': {
    manufacturer: 'Gulf Extrusions',
    brandSystem: 'Gulf Extrusions® Anodized / Oak',
    photoPrompt: 'Studio architectural trim sample of 100mm flush recessed matte black powder-coated extruded aluminum skirting profile beside warm solid European oak 100mm skirting board seated against porcelain tile and gypsum plaster wall corner, crisp shadow reveal, no text',
  },
  'FN-MIR-01': {
    manufacturer: 'Saint-Gobain',
    brandSystem: 'Saint-Gobain Miralite® Revolution',
    photoPrompt: 'Architectural washroom mirror edge detail photograph showing 6mm beveled copper-free silver mirror mounted on waterproof aluminum backing sub-frame emitting a soft warm 3000K halo LED glow onto textured light limestone wall tile behind it, studio photo, no text',
  },
  'FN-ART-01': {
    manufacturer: '',
    brandSystem: 'Bespoke Acoustic Print',
    photoPrompt: 'Detail corner photograph of museum-grade textured archival cotton canvas print stretched over acoustic felt backing inside a slim mitered matte black anodized aluminum floater frame on gallery wall, warm raking light, no text',
  },
  'JN-PNT-01': {
    manufacturer: 'Cosentino Silestone / Egger',
    brandSystem: 'Egger® HPL + Silestone® Quartz',
    photoPrompt: 'Studio joinery material board displaying a beveled 20mm Cosentino Silestone warm white subtly veined quartz countertop slab resting over natural Halifax oak laminate and matte charcoal Egger cabinetry door sample with soft-close concealed hinge cup, crisp kitchen millwork sample, no text',
  },
  'JN-PNT-02': {
    manufacturer: 'Egger / Blum',
    brandSystem: 'Egger® Matte HPL + Blum®',
    photoPrompt: 'Architectural cabinetry corner cutaway photograph showing anti-fingerprint pebble grey Egger matte laminate door leaf, precision ABS edgebanding and brushed steel Blum soft-close hinge mechanism inside moisture-resistant carcass, clean studio photo, no text',
  },
  'JN-VAN-01': {
    manufacturer: 'DuPont Corian',
    brandSystem: 'DuPont™ Corian® + Moisture HMR',
    photoPrompt: 'Studio architectural sample of thermoformed DuPont Corian Glacier White solid surface integrated countertop apron edge cleanly joined with zero visible seam above fluted walnut moisture-resistant veneer cabinetry fascia, crisp lighting, no text',
  },
  'JN-WB-01': {
    manufacturer: 'Saint-Gobain',
    brandSystem: 'Saint-Gobain® Planilaque Glass',
    photoPrompt: 'Architectural detail photograph of flush wall-mounted pure white magnetic back-painted glass panel mitered against a warm oak timber frame planter trough filled with lush preserved green fern foliage, crisp studio shot, no text',
  },
  'MEP-LGT-01': {
    manufacturer: 'Signify Philips / Zumtobel',
    brandSystem: 'Signify® Philips / Zumtobel® PANOS',
    photoPrompt: 'Studio product photograph of trimless recessed architectural LED ceiling downlight with deep darklight specular aluminum anti-glare reflector casting warm-neutral 4000K beam beside slim micro-prismatic 600x600 LED panel corner, clean lighting hardware photo, no text',
  },
  'MEP-LGT-02': {
    manufacturer: 'Zumtobel',
    brandSystem: 'Zumtobel® TECTON / Linear',
    photoPrompt: 'Studio photograph of extruded matte black anodized aluminum linear suspended LED lighting profile section glowing evenly through satin opal polycarbonate diffuser lens, clean industrial luminaire detail, no text',
  },
  'MEP-LOG-01': {
    manufacturer: '',
    brandSystem: 'Bespoke PVD Brass Signage',
    photoPrompt: 'Architectural close-up photograph of CNC-milled 3mm solid brushed champagne brass architectural geometric emblem pinned 15mm off a dark basalt stone backdrop casting soft warm 3000K LED halo illumination around its beveled edges, no readable words or letters',
  },
  'MEP-SAN-01': {
    manufacturer: 'Franke / Grohe',
    brandSystem: 'Franke® 304 SS + Grohe® Mixer',
    photoPrompt: 'Studio product photograph of brushed Grade 304 stainless steel crisp-radius undermount pantry sink basin paired with slim single-lever brushed chrome pull-out spout kitchen mixer tap under quartz deck cutaway, bright studio lighting, no text',
  },
  'MEP-SAN-02': {
    manufacturer: 'Duravit / Geberit',
    brandSystem: 'Duravit® ME by Starck + Geberit®',
    photoPrompt: 'Studio product photograph of contemporary alpine white vitreous china rimless wall-hung commercial WC toilet bowl mounted cleanly in front of brushed stainless steel dual-flush rectangular actuator plate on travertine stone wall, realistic showroom photo, no text',
  },
  'MEP-SAN-03': {
    manufacturer: 'Duravit / Grohe',
    brandSystem: 'Duravit® Vero + Grohe® Eurosmart',
    photoPrompt: 'Studio product photograph of rectangular white architectural ceramic countertop wash basin with crisp thin rims and gleaming polished chrome single-lever mixer tap resting on warm limestone vanity deck, bright clean showroom shot, no text',
  },
  'MEP-SAN-04': {
    manufacturer: 'Grohe',
    brandSystem: 'Grohe® Tempesta Thermostatic',
    photoPrompt: 'Studio product photograph of polished StarLight chrome thin-profile square overhead rain shower head paired with cylindrical thermostatic exposed bar mixer valve on matte grey porcelain wet-wall tile, clean water-drop-free showroom shot, no text',
  },
  'MEP-WRG-01': {
    manufacturer: 'Legrand / Schneider Electric',
    brandSystem: 'Legrand® Arteor + Schneider® Cat6A',
    photoPrompt: 'Macro studio photograph of flush brushed stainless steel recessed commercial floor outlet box open cleanly alongside matte graphite grey Legrand/Schneider double 13A switched UK socket and dual RJ45 Cat6A data faceplate, crisp architectural electrical hardware, no text',
  },
  'MEP-AV-01': {
    manufacturer: 'Samsung',
    brandSystem: 'Samsung® QMC 4K + Chief® Mount',
    photoPrompt: 'Three-quarter architectural product photograph of ultra-slim 28mm depth anti-glare matte 4K commercial meeting room display panel on micro-tilt black steel wall bracket against acoustic wood slat boardroom wall showing subtle abstract architectural lines on screen, no text',
  },
};

for (const [sku, profile] of Object.entries(FITOUT_GCC_PROFILES)) {
  if (FITOUT_OFFICIAL_FINISH_CARDS[sku]) {
    Object.assign(FITOUT_OFFICIAL_FINISH_CARDS[sku], profile);
  }
}

export function normalizeBrandBookKey(brandName = '') {
  const s = String(brandName || '').toLowerCase().trim();
  if (!s) return 'default';
  if (s.includes('narbutas')) return 'narbutas';
  if (s.includes('herman') && s.includes('miller')) return 'herman miller';
  if (s.includes('sedus')) return 'sedus stoll';
  if (s.includes('b&t') || s.includes('b & t')) return 'b&t design';
  if (s.includes('amara')) return 'amara';
  if (s.includes('ottimo')) return 'ottimo furniture';
  if (s.includes('custom fab')) return 'custom fabrication';
  for (const k of Object.keys(FURNITURE_BRAND_FINISH_BOOKS)) {
    if (k !== 'default' && s.includes(k)) return k;
  }
  return 'default';
}

function getBook(brandName) {
  return FURNITURE_BRAND_FINISH_BOOKS[normalizeBrandBookKey(brandName)] || FURNITURE_BRAND_FINISH_BOOKS.default;
}

function detectSlotUsage(text = '') {
  const t = text.toLowerCase();
  const isCustomJoinery = /\b(reception|counter|banquette|booth|pantry|vanity|kitchenette|millwork|planter|cladding|cred|joinery)\b/i.test(t);
  const isSeating = /\b(chair|sofa|couch|loveseat|armchair|stool|pouf|ottoman|recliner|banquette|bench|seating)\b/i.test(t);
  const isSurfaceItem = /\b(desk|table|workstation|credenza|cabinet|wardrobe|bookcase|shelf|counter|vanity|pantry|reception|planter)\b/i.test(t);
  return { isCustomJoinery, isSeating, isSurfaceItem };
}

function pickByTone(list = [], preferredTones = [], fallbackIdx = 0) {
  for (const tone of preferredTones) {
    const hit = list.find((f) => f.tone === tone);
    if (hit) return hit;
  }
  return list[fallbackIdx % Math.max(1, list.length)] || list[0];
}

function detectExplicitTones(text = '') {
  const t = text.toLowerCase();
  const surfaceTones = [];
  const uphTones = [];
  const frameTones = [];
  if (/\b(walnut|dark\s*wood)\b/.test(t)) surfaceTones.push('walnut', 'espresso');
  else if (/\b(oak|ash|beech|maple|timber|wood|veneer)\b/.test(t)) surfaceTones.push('oak', 'walnut');
  else if (/\b(corian|marble|stone|quartz|white|laminate|melamine)\b/.test(t)) surfaceTones.push('white', 'grey');
  else if (/\b(terrazzo|concrete|grey)\b/.test(t)) surfaceTones.push('grey', 'white');

  if (/\b(leather|cognac|saddle|tan|camel)\b/.test(t)) uphTones.push('cognac', 'terracotta');
  else if (/\b(blue|navy|petrol|teal)\b/.test(t)) uphTones.push('blue');
  else if (/\b(green|sage|olive|moss)\b/.test(t)) uphTones.push('sage');
  else if (/\b(terracotta|rust|orange|burgundy|red)\b/.test(t)) uphTones.push('terracotta', 'cognac');
  else if (/\b(cream|ivory|beige|sand|oatmeal|boucle|linen)\b/.test(t)) uphTones.push('sand');
  else if (/\b(black|mesh|charcoal|dark\s*grey)\b/.test(t)) uphTones.push('charcoal', 'black');

  if (/\b(brass|gold|champagne)\b/.test(t)) frameTones.push('brass', 'bronze');
  else if (/\b(chrome|polished\s*alumin|silver|stainless)\b/.test(t)) frameTones.push('chrome');
  else if (/\b(white\s*frame|white\s*leg)\b/.test(t)) frameTones.push('white');
  else if (/\b(black|powder[-\s]*coated|dark|steel)\b/.test(t)) frameTones.push('black', 'charcoal');

  return { surfaceTones, uphTones, frameTones };
}

const PALETTE_TONE_PREFS = {
  'warm-oak-charcoal': { surface: ['oak', 'white', 'walnut'], upholstery: ['charcoal', 'sand', 'black'], frame: ['black', 'charcoal'] },
  'walnut-cognac': { surface: ['walnut', 'espresso', 'oak'], upholstery: ['cognac', 'sand', 'terracotta'], frame: ['bronze', 'brass', 'black'] },
  'nordic-sand-sage': { surface: ['oak', 'white'], upholstery: ['sand', 'sage', 'grey'], frame: ['white', 'chrome', 'black'] },
  'monochrome-mineral': { surface: ['white', 'grey', 'black'], upholstery: ['charcoal', 'black', 'grey', 'sand'], frame: ['chrome', 'black', 'charcoal'] },
};

const SUPABASE_FITOUT_CARD_BASE = 'https://kfrjsvqhvwaezdvsrgzw.supabase.co/storage/v1/object/public/product-images/fitout-v2';

const LOOSE_FURNITURE_GUARD_RX = /\b(?:task\s*chair|office\s*chair|executive\s*chair|visitor\s*chair|meeting\s*chair|conference\s*chair|dining\s*chair|lounge\s*chair|bar\s*stool|counter\s*stool|sofa|couch|armchair|ottoman|pouf|workstation|desk\s*system|office\s*desk|manager\s*desk|executive\s*desk|conference\s*table|meeting\s*table|coffee\s*table|side\s*table|dining\s*table|pedestal|credenza|bookcase|freestanding|acoustic\s*pod|phone\s*booth)\b/i;
const EXPLICIT_SURFACE_OVERRIDE_RX = /\b(?:porcelain|ceramic\s*tile|carpet\s*tile|broadloom|vinyl\s*flooring|marble\s*flooring|stone\s*flooring|gypsum|false\s*ceiling|mineral\s*fiber|drywall|partition\s*wall|glass\s*partition|skirting|wall\s*paint|emulsion|swing\s*door|sliding\s*door|floor\s*finish|wall\s*cladding)\b/i;

const GCC_FITOUT_BRAND_RX = /\b(?:fitout\s*v?2|gcc\s*contract\s*standard|jotun|knauf|rak\s*ceramics?|omani\s*marble|al\s*turki|mapei|schl[uü]ter|guardian\s*glass|optima|saint[\s-]*gobain|gyproc|dormakaba|gulf\s*extrusions|duravit|geberit|grohe|signify|philips|zumtobel|legrand|schneider|naffco|3m\s*commercial|somfy|phifer|coulisse|vescom|hunter\s*douglas|armstrong|corian|silestone|cosentino|rimex|autex|tarkett|shaw\s*contract|interface|alpi|egger|blum|franke|samsung)\b/i;

export function isGccFitoutBrand(brandName = '') {
  return GCC_FITOUT_BRAND_RX.test(String(brandName || '').trim());
}

export function resolveFitoutSkuCode(item = {}) {
  const hay = `${item.code || ''} ${item.skuCode || ''} ${item.model || ''} ${item.productText || ''} ${item.description || ''}`;
  const m = hay.match(/\b((?:FL|PT|WC|CL|DR|WN|FN|JN|MEP)-[A-Z]+-\d+|(?:MOB|UTIL|HSE|DEB|CLN|INS)\s*\d+)\b/i);
  if (m) {
    return m[1].toUpperCase().replace(/\s+/g, ' ').replace(/^(MOB|UTIL|HSE|DEB|CLN|INS)(\d+)$/, '$1 $2');
  }
  const codeHay = `${item.code || ''} ${item.skuCode || ''} ${item.model || ''}`;
  if (/\bCA[\s-]*10\d\b/i.test(codeHay)) return 'FL-CPT-01';
  if (/\bST[\s-]*10\d\b/i.test(codeHay)) return 'JN-VAN-01';
  if (/\bC[\s-]*0[12]\b/i.test(codeHay)) return 'CL-GYP-01';
  if (/\bSLD[\s-]*0[12]\b/i.test(codeHay)) return 'DR-SWG-01';
  return '';
}

/**
 * Infer a canonical FitOut V2 SKU from either an explicit/legacy code OR architectural specification text.
 * Guarded against loose furniture nouns unless explicit architectural surface keywords or SQM units apply.
 */
export function inferCanonicalFitoutSku(item = {}) {
  const direct = resolveFitoutSkuCode(item);
  if (direct && FITOUT_OFFICIAL_FINISH_CARDS[direct]) return direct;

  const specText = String(item.sourceDescription || item.description || item.name || item.model || '').trim();
  const unitStr = String(item.unit || '').trim();
  if (!specText) return '';

  const hasLooseFurnitureNoun = LOOSE_FURNITURE_GUARD_RX.test(specText);
  const hasExplicitSurface = EXPLICIT_SURFACE_OVERRIDE_RX.test(specText) || /^(sqm|sq\.?\s*m|m2|m²)$/i.test(unitStr);
  if (hasLooseFurnitureNoun && !hasExplicitSurface) return '';

  if (/\b(carpet\s*tile|500x500mm.*carpet)\b/i.test(specText)) return 'FL-CPT-01';
  if (/\b(broadloom|wall-to-wall.*carpet)\b/i.test(specText)) return 'FL-CPT-02';
  if (/\b(porcelain|ceramic.*floor\s*tile|600x600.*tile|floor\s*tile)\b/i.test(specText)) return 'FL-POR-01';
  if (/\b(lvt|vinyl\s*floor|heterogeneous\s*vinyl)\b/i.test(specText)) return 'FL-VNL-01';
  if (/\b(omani\s*marble|natural\s*marble|marble\s*floor)\b/i.test(specText)) return 'FL-MRB-01';
  if (/\b(stone\s*floor|stone\s*threshold|mechanically\s*fixed\s*stone|limestone)\b/i.test(specText)) return 'FL-MRB-02';
  if (/\b(self[\s-]*leveling|floor\s*screed)\b/i.test(specText)) return 'FL-LEV-01';
  if (/\b(transition\s*trim|transition\s*strip|schl[uü]ter)\b/i.test(specText)) return 'FL-TRM-01';
  if (/\b(moisture[\s-]*resistant.*drywall|green\s*core.*gypsum|gkbi)\b/i.test(specText)) return 'PT-DRY-02';
  if (/\b(drywall|gypsum\s*partition|acoustic\s*partition.*gypsum|knauf\s*gkb)\b/i.test(specText)) return 'PT-DRY-01';
  if (/\b(double[\s-]*glazed.*partition|45\s*db.*glass|revolution\s*100)\b/i.test(specText)) return 'PT-GLS-02';
  if (/\b(frosted.*glass|fluted.*glass|satinovo|decorative\s*glass\s*partition)\b/i.test(specText)) return 'PT-GLS-03';
  if (/\b(glass\s*partition|curved\s*glass\s*partition|toughened.*partition)\b/i.test(specText)) return 'PT-GLS-01';
  if (/\b(hoarding|dust[\s-]*barrier)\b/i.test(specText)) return 'PT-TMP-01';
  if (/\b(fluted\s*timber|slatted\s*acoustic\s*wall)\b/i.test(specText)) return 'WC-FLT-01';
  if (/\b(fabric[\s-]*wrapped\s*acoustic|acoustic\s*wall\s*panel)\b/i.test(specText)) return 'WC-ACU-01';
  if (/\b(wood\s*veneer\s*wall|veneer.*cladding)\b/i.test(specText)) return 'WC-WOD-01';
  if (/\b(pvd.*wall\s*trim|stainless.*wall\s*trim|rimex)\b/i.test(specText)) return 'WC-MTL-01';
  if (/\b(mineral\s*fiber.*ceiling|600x600.*ceiling|t[\s-]*bar\s*grid)\b/i.test(specText)) return 'CL-ACU-01';
  if (/\b(ceiling\s*clouds?|ceiling\s*baffles?)\b/i.test(specText)) return 'CL-ACU-02';
  if (/\b(wood\s*slat.*ceiling|open[\s-]*cell\s*baffle\s*ceiling)\b/i.test(specText)) return 'CL-WOD-01';
  if (/\b(exposed\s*soffit|soffit\s*spray\s*paint)\b/i.test(specText)) return 'CL-PNT-01';
  if (/\b(gypsum\s*(?:board\s*)?(?:false\s*)?ceiling|suspended.*ceiling|12\.5mm.*ceiling)\b/i.test(specText)) return 'CL-GYP-01';
  if (/\b(double\s*leaf.*door|1800x2100.*door)\b/i.test(specText)) return 'DR-SWG-02';
  if (/\b(frameless.*glass.*door|glass\s*swing\s*door)\b/i.test(specText)) return 'DR-GLS-01';
  if (/\b(sliding\s*door|muto)\b/i.test(specText)) return 'DR-SLD-01';
  if (/\b(timber.*door|swing\s*door|flush\s*laminate.*door|solid[\s-]*core.*door)\b/i.test(specText)) return 'DR-SWG-01';
  if (/\b(sunscreen.*blind|roller\s*blind|sheerweave)\b/i.test(specText)) return 'WN-BLD-01';
  if (/\b(blackout\s*curtain|motorized.*blind|somfy)\b/i.test(specText)) return 'WN-CUR-01';
  if (/\b(textured.*paint|suede.*paint|lady\s*minerals|limewash)\b/i.test(specText)) return 'FN-PNT-02';
  if (/\b(wall\s*paint|emulsion|skim\s*coat|fenomastic|matte\s*acrylic)\b/i.test(specText)) return 'FN-PNT-01';
  if (/\b(wallcovering|wallpaper|vescom)\b/i.test(specText)) return 'FN-WLP-01';
  if (/\b(skirting|100mm.*aluminum.*skirting)\b/i.test(specText)) return 'FN-SKT-01';
  if (/\b(vanity.*mirror|backlit.*mirror|miralite)\b/i.test(specText)) return 'FN-MIR-01';
  if (/\b(vanity\s*counter|corian.*vanity|washroom\s*vanity|engineered\s*quartz\s*top.*undermount)\b/i.test(specText)) return 'JN-VAN-01';
  if (/\b(overhead\s*wall\s*cabinet|pantry\s*overhead)\b/i.test(specText)) return 'JN-PNT-02';
  if (/\b(pantry\s*base\s*cabinet|built[\s-]*in\s*pantry)\b/i.test(specText)) return 'JN-PNT-01';
  if (/\b(glass\s*whiteboard.*planter)\b/i.test(specText)) return 'JN-WB-01';
  if (/\b(linear.*led|cove\s*led|zumtobel\s*tecton)\b/i.test(specText)) return 'MEP-LGT-02';
  if (/\b(recessed\s*led|downlight|led\s*panel|luminaires?)\b/i.test(specText)) return 'MEP-LGT-01';
  if (/\b(pantry\s*sink|undermount.*sink)\b/i.test(specText)) return 'MEP-SAN-01';
  if (/\b(wc\s*toilet|wall[\s-]*hung.*wc|toilet\s*suite)\b/i.test(specText)) return 'MEP-SAN-02';
  if (/\b(wash\s*basin|hand\s*wash\s*basin)\b/i.test(specText)) return 'MEP-SAN-03';
  if (/\b(shower\s*head|thermostatic\s*shower)\b/i.test(specText)) return 'MEP-SAN-04';
  if (/\b(floor\s*box|cat6a?|data\s*outlet)\b/i.test(specText)) return 'MEP-WRG-01';
  if (/\b(4k.*display|commercial\s*led\s*display|samsung\s*qmc)\b/i.test(specText)) return 'MEP-AV-01';
  if (/\b(mobilization|site\s*office)\b/i.test(specText)) return 'MOB 01';
  if (/\b(hse|fire\s*safety|extinguisher|naffco)\b/i.test(specText)) return 'HSE 01';
  if (/\b(debris\s*disposal|housekeeping)\b/i.test(specText)) return 'DEB 01';
  if (/\b(post[\s-]*construction\s*cleaning)\b/i.test(specText)) return 'CLN 01';
  if (/\b(workmen\s*compensation|car\s*insurance)\b/i.test(specText)) return 'INS 01';
  return '';
}

export function resolveFitoutCardImageUrl(item = {}) {
  const sku = inferCanonicalFitoutSku(item);
  if (!sku || !FITOUT_OFFICIAL_FINISH_CARDS[sku]) return '';
  const slug = sku.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `${SUPABASE_FITOUT_CARD_BASE}/${slug}.png?v=2`;
}

/**
 * Resolve the authentic GCC commercial manufacturer / brand name for a FitOut V2 item.
 * Returns empty string for unbranded site preliminaries, waste/hoarding, and generic artwork.
 */
export function resolveFitoutManufacturer(item = {}) {
  if (item.manufacturer) return String(item.manufacturer).trim();
  const sku = inferCanonicalFitoutSku(item);
  if (sku && FITOUT_OFFICIAL_FINISH_CARDS[sku]) {
    return String(FITOUT_OFFICIAL_FINISH_CARDS[sku].manufacturer || '').trim();
  }
  return '';
}

/**
 * Resolves 2–3 official finish swatches (`{ role, code, name, hex }`) for any BOQ row / product.
 */
export function resolveItemFinishes(item = {}, paletteId = 'auto', opts = {}) {
  if (!opts.forcePalette && Array.isArray(item.finishes) && item.finishes.length > 0) {
    return item.finishes;
  }
  const brand = String(item.brand || item.selectedBrand || '');
  const fitoutCode = resolveFitoutSkuCode(item);
  if (fitoutCode && FITOUT_OFFICIAL_FINISH_CARDS[fitoutCode]) {
    return FITOUT_OFFICIAL_FINISH_CARDS[fitoutCode].finishes.map((f) => ({ ...f }));
  }

  const text = [item.description, item.productText, item.model, item.materialSpec, item.category].filter(Boolean).join(' ');
  const book = getBook(brand);
  const { isCustomJoinery, isSeating, isSurfaceItem } = detectSlotUsage(text);
  const explicit = detectExplicitTones(text);
  const palettePref = PALETTE_TONE_PREFS[paletteId] || null;

  const surfaceToneOrder = palettePref ? palettePref.surface : (explicit.surfaceTones.length ? explicit.surfaceTones : ['oak', 'walnut', 'white']);
  const uphToneOrder = palettePref ? palettePref.upholstery : (explicit.uphTones.length ? explicit.uphTones : ['charcoal', 'cognac', 'sand']);
  const frameToneOrder = palettePref ? palettePref.frame : (explicit.frameTones.length ? explicit.frameTones : ['black', 'chrome', 'bronze']);

  const pickedSurface = pickByTone(book.surfaces, surfaceToneOrder, 0);
  const pickedUph = pickByTone(book.upholstery, uphToneOrder, 0);
  const pickedFrame = pickByTone(book.frames, frameToneOrder, 0);

  const out = [];
  if (isCustomJoinery) {
    if (pickedSurface) out.push({ role: 'Primary Surface', code: pickedSurface.code, name: pickedSurface.name, hex: pickedSurface.hex });
    if (isSeating && pickedUph) {
      out.push({ role: 'Upholstery', code: pickedUph.code, name: pickedUph.name, hex: pickedUph.hex });
    } else {
      const secondarySurface = book.surfaces.find((s) => s.code !== pickedSurface?.code && (s.tone === 'oak' || s.tone === 'walnut' || s.tone === 'white')) || pickedSurface;
      if (secondarySurface && secondarySurface.code !== pickedSurface?.code) {
        out.push({ role: 'Carcass / Timber', code: secondarySurface.code, name: secondarySurface.name, hex: secondarySurface.hex });
      }
    }
    if (pickedFrame) out.push({ role: 'Metal / Plinth', code: pickedFrame.code, name: pickedFrame.name, hex: pickedFrame.hex });
    return out;
  }

  if (isSeating && !isSurfaceItem) {
    if (pickedUph) out.push({ role: 'Upholstery', code: pickedUph.code, name: pickedUph.name, hex: pickedUph.hex });
    if (/\b(wood|oak|walnut|timber|shell)\b/i.test(text) && pickedSurface) {
      out.push({ role: 'Timber / Shell', code: pickedSurface.code, name: pickedSurface.name, hex: pickedSurface.hex });
    }
    if (pickedFrame) out.push({ role: 'Base / Frame', code: pickedFrame.code, name: pickedFrame.name, hex: pickedFrame.hex });
    return out;
  }

  if (pickedSurface) out.push({ role: 'Top / Surface', code: pickedSurface.code, name: pickedSurface.name, hex: pickedSurface.hex });
  if (pickedFrame) out.push({ role: 'Frame / Base', code: pickedFrame.code, name: pickedFrame.name, hex: pickedFrame.hex });
  return out;
}

export function getBrandFinishOptions(brandName = '', itemText = '') {
  const fitoutCode = resolveFitoutSkuCode({ description: itemText, model: itemText });
  if (fitoutCode && FITOUT_OFFICIAL_FINISH_CARDS[fitoutCode]) {
    const card = FITOUT_OFFICIAL_FINISH_CARDS[fitoutCode];
    return {
      brandSystem: card.brandSystem,
      surfaces: card.finishes,
      upholstery: [],
      frames: [],
    };
  }
  const book = getBook(brandName);
  return {
    brandSystem: normalizeBrandBookKey(brandName).toUpperCase(),
    surfaces: book.surfaces || [],
    upholstery: book.upholstery || [],
    frames: book.frames || [],
  };
}

export function formatFinishSummary(finishes = []) {
  if (!Array.isArray(finishes) || finishes.length === 0) return '';
  return finishes
    .map((f) => `${f.role ? `${f.role}: ` : ''}${f.code ? `${f.code} ` : ''}${f.name || ''}`.trim())
    .filter(Boolean)
    .join(' · ');
}
