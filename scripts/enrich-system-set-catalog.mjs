#!/usr/bin/env node
/**
 * Enriches the local brand catalogs (server/data/brands/*.json) for SYSTEM SET matching:
 * workstations / bench desks, L-shape & executive desks with returns, folding / flip-top
 * conference tables, desk screens, pedestals and system accessories.
 *
 *  • upserts  — products whose official page was checked on VERIFIED_ON (URL + image taken from
 *               the manufacturer's own site). Matched by model name (case-insensitive), so
 *               earlier entries with broken links / wrong images are corrected in place.
 *  • tags     — existing catalog products get `setRoles` (roles they can fill in a set),
 *               `seatsPerUnit` (positions covered by one unit) or `includesRoles`
 *               (components that are part of the product itself).
 *
 * Local JSON only: the storage provider gives local products precedence over Supabase rows
 * with the same model name, so nothing is written to the database. Idempotent.
 *
 *   node scripts/enrich-system-set-catalog.mjs             apply
 *   node scripts/enrich-system-set-catalog.mjs --dry-run   report only
 *   node scripts/enrich-system-set-catalog.mjs --dir <path-to-brands-folder>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERIFIED_ON = '2026-11-21';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const dirArgIdx = args.indexOf('--dir');
const BRANDS_DIR = dirArgIdx !== -1 && args[dirArgIdx + 1]
  ? path.resolve(args[dirArgIdx + 1])
  : path.resolve(__dirname, '..', 'server', 'data', 'brands');

const DESK = 'Desk & Table';

/** A product whose own official page was verified. */
const official = (p) => ({ price: 0, currency: 'USD', verified: true, source: 'official-site', lastUpdated: VERIFIED_ON, websiteUrl: p.productUrl, officialProductUrl: p.productUrl, ...p });
/** A price-list accessory of a system (no product page of its own): linked to the verified system page, no image. */
const accessory = (p) => ({ price: 0, currency: 'USD', verified: false, source: 'system-accessory', lastUpdated: VERIFIED_ON, websiteUrl: p.productUrl, imageUrl: '', ...p });

const PLAN = {
  // ───────────────────────────── NARBUTAS (mid) ─────────────────────────────
  'narbutas-mid.json': {
    upserts: [
      official({
        model: 'NOVA U Bench Workstation System', family: 'Nova', mainCategory: DESK, subCategory: 'Workstations',
        productUrl: 'https://www.narbutas.com/products/desks-tables/bench-desks/nova-u-bench/',
        imageUrl: 'https://www.narbutas.com/wp-content/uploads/2018/11/Bench-desks-NOVA-U-Narbutas-1920x864.jpg',
        description: 'NOVA U bench desks: benches of 2 or 4 desks, extendable with supplementary units up to 6 back-to-back positions. Desk length 1200–1800 mm, back-to-back width 1440 / 1640 mm, 25 mm MFC tops with wire-management cut-outs. Options: NOVA fabric or Plexiglas screens, TOP 530 acoustic screens, horizontal cable trays.',
        setRoles: ['workstation_desk'],
      }),
      official({
        model: 'NOVA U Desk', family: 'Nova', mainCategory: DESK, subCategory: 'Workstations',
        productUrl: 'https://www.narbutas.com/products/desks-tables/desks/nova-u/',
        imageUrl: 'https://www.narbutas.com/wp-content/uploads/2018/11/Single-desks-NOVA-U-Narbutas-1920x864.jpg',
        description: 'NOVA U single desk on a U-shaped metal frame — the single-position version of the NOVA U bench system.',
        setRoles: ['workstation_desk'],
      }),
      official({
        model: 'PLANA Executive Desk with Side Return', family: 'Plana', mainCategory: DESK, subCategory: 'Executive Desks',
        productUrl: 'https://www.narbutas.com/products/executive-furniture/executive-furniture-1/plana-executive/',
        imageUrl: 'https://www.narbutas.com/wp-content/uploads/2018/11/Executive-furniture-PLANA-Narbutas-1920x864.jpg',
        description: 'PLANA executive desk 1800 × 900 or 2200 × 900 mm with a right- or left-hand supplementary unit 1400 × 800 mm (side return), modesty panel, fixed pedestal 900 × 600 mm, grommet and power socket box.',
        setRoles: ['executive_desk'], includesRoles: ['side_return'],
      }),
      {
        // Kept under its existing model name; link and image now come from the catalog's own NOVA executive entry.
        model: 'NOVA Executive L-Shaped Desk with Side Return', family: 'Nova', mainCategory: DESK, subCategory: 'Executive Desks',
        copyFrom: { model: 'Nova Executive Furniture #20264110', fields: ['imageUrl', 'productUrl', 'websiteUrl'] },
        officialProductUrl: 'https://www.narbutas.com/wp-content/uploads/2018/11/Technical-information_NOVA-Executive-desks_EN-1.pdf',
        description: 'NOVA executive desk configured as an L-shape with a side return unit. Technical information: NARBUTAS "NOVA Executive desks" data sheet.',
        price: 0, currency: 'USD', verified: false, source: 'catalog-repair', lastUpdated: VERIFIED_ON,
        setRoles: ['executive_desk'], includesRoles: ['side_return'],
      },
      official({
        model: 'FLIP TOP II Modular Folding Conference Table', family: 'Flip Top', mainCategory: DESK, subCategory: 'Folding & Multi-Purpose Conference Tables',
        productUrl: 'https://www.narbutas.com/products/desks-tables/conference-meeting/fliptop',
        imageUrl: 'https://www.narbutas.com/wp-content/uploads/2026/05/FLIPTOP_NARBUTAS_2026_P3.jpg',
        description: 'FLIPTOP mobile conference table for meeting, training and multi-purpose rooms: flip-top modules L 1400 / 1600 × W 700 / 800 × H 735 mm on lockable castors that nest for storage; a folding-leg version is also available.',
        copyFrom: { model: 'Flip Top II Conference Tables #20264062', fields: ['price'], onlyIfPositive: true },
        setRoles: ['folding_table'],
      }),
      official({
        model: 'NOVA Conference & Meeting Tables', family: 'Nova', mainCategory: DESK, subCategory: 'Conference Tables',
        productUrl: 'https://www.narbutas.com/products/desks-tables/conference-meeting/nova-u-conference/',
        copyFrom: { model: 'Nova U Meeting Tables #20264117', fields: ['imageUrl'] },
        description: 'NOVA conference and meeting tables on the NOVA U frame, matching the NOVA desk and bench range.',
        setRoles: ['conference_table'],
      }),
      official({
        model: 'NOVA Pedestals', family: 'Nova', mainCategory: 'Storage', subCategory: 'Pedestals',
        productUrl: 'https://www.narbutas.com/products/storage/pedestals/nova-pedestals/',
        imageUrl: 'https://www.narbutas.com/wp-content/uploads/2021/01/pedestals-NOVA-features-1920x1080-2.jpg',
        description: 'NOVA pedestals — mobile and fixed drawer units for NOVA desks and benches.',
        setRoles: ['pedestal'],
      }),
      official({
        model: 'NOVA Side Return Storage Credenza', family: 'Nova', mainCategory: 'Storage', subCategory: 'Return Credenzas & Pedestals',
        productUrl: 'https://www.narbutas.com/products/storage/cabinets-and-shelving/nova/',
        imageUrl: 'https://www.narbutas.com/wp-content/uploads/2018/11/Storage-cabinets-NOVA-Narbutas-1-1920x864.jpg',
        description: 'NOVA storage units (cabinets and shelving) used beside the desk as a side return or credenza.',
        setRoles: ['side_return'],
      }),
      official({
        model: 'FONO Acoustic Desk Screens', family: 'Fono', mainCategory: 'Accessories', subCategory: 'Desk Screens',
        productUrl: 'https://www.narbutas.com/products/acoustic-solutions/acoustic-desk-screens/fono/',
        imageUrl: 'https://www.narbutas.com/wp-content/uploads/2025/11/FONO_featured-image.jpg',
        description: 'FONO acoustic desk screens (sound-absorption class A) for desks and benches.',
        setRoles: ['screen'],
      }),
      accessory({
        model: 'NARBUTAS Metal Cable Management Tray', family: 'Nova', mainCategory: 'Accessories', subCategory: 'Cable Management',
        productUrl: 'https://www.narbutas.com/products/desks-tables/bench-desks/nova-u-bench/',
        description: 'Horizontal cable tray for NOVA desks and benches — a price-list accessory of the desk system (no product page of its own).',
        setRoles: ['cable_management'],
      }),
      accessory({
        model: 'NARBUTAS Power & Data Socket Block', family: 'Plana', mainCategory: 'Accessories', subCategory: 'Power & Electrification',
        productUrl: 'https://www.narbutas.com/products/executive-furniture/executive-furniture-1/plana-executive/',
        description: 'Desktop grommet with power socket box, offered as a price-list accessory of NARBUTAS desk systems (listed with the PLANA executive desks; no product page of its own).',
        setRoles: ['power_box'],
      }),
      accessory({
        model: 'NARBUTAS Workstation Modesty Panel', family: 'Plana', mainCategory: 'Accessories', subCategory: 'Modesty Panels',
        productUrl: 'https://www.narbutas.com/products/executive-furniture/executive-furniture-1/plana-executive/',
        description: 'Modesty panel offered as a price-list accessory of NARBUTAS desks (listed with the PLANA executive desks; no product page of its own).',
        setRoles: ['modesty_panel'],
      }),
    ],
    tags: [
      { match: /^(?:nova [uhao] desks|nova wood desks|t[- ]easy desks|zedo desk|zedo bench desk|optima)\b/i, set: { setRoles: ['workstation_desk'] } },
      { match: /^(?:plana|nova|air|motion) executive furniture\b|^move & lead executive furniture\b/i, set: { setRoles: ['executive_desk'] } },
      { match: /^flip[- ]top(?: ii)? conference tables\b/i, set: { setRoles: ['folding_table'] } },
      { match: /^(?:nova u|nova wood|plana|air|forum|t[- ]easy|zedo|arqus|parthos) meeting tables?\b|^tutti meeting tables$/i, set: { setRoles: ['conference_table'] } },
      { match: /^nova pedestals\b/i, set: { setRoles: ['pedestal'] } },
      { match: /^(?:top 530|desk 760|modus) acoustic screens\b|^modus acoustic desk screens$/i, set: { setRoles: ['screen'] } },
    ],
  },

  // ─────────────────────────────── LAS (mid) ───────────────────────────────
  'las-mid.json': {
    upserts: [
      official({
        model: '5th Element Modular Bench Workstation & Executive L-Shape System', family: '5th Element', mainCategory: DESK, subCategory: 'Workstations',
        productUrl: 'https://www.las.it/en/products/5th-element/',
        imageUrl: 'https://www.las.it/wp-content/uploads/2021/08/5thelement-thumb-01-scaled.jpg',
        description: '5TH ELEMENT shared-structure operative system in Executive, Desking-Bench and Meeting versions, with height-adjustable legs, desk screens and felt front panels.',
        setRoles: ['workstation_desk', 'executive_desk'],
      }),
      official({
        model: 'Oxi Linear Workstation & L-Shape Desk System', family: 'Oxi', mainCategory: DESK, subCategory: 'Workstations',
        productUrl: 'https://www.las.it/en/products/oxi/',
        imageUrl: 'https://www.las.it/wp-content/uploads/2021/08/oxi-thumb-01-scaled.jpg',
        description: 'OXI operative desks on bridge legs in single-desk and bench versions, with desk screens and Comby storage.',
        setRoles: ['workstation_desk'],
      }),
      official({
        model: 'SIGMA Operative Desk System', family: 'Sigma', mainCategory: DESK, subCategory: 'Workstations',
        productUrl: 'https://www.las.it/en/products/20457/',
        imageUrl: 'https://www.las.it/wp-content/uploads/2025/07/sitemi-operativo-sigma-thumb.jpg',
        description: 'SIGMA operative desk system.',
        setRoles: ['workstation_desk'],
      }),
      official({
        model: 'IULIO Executive Desk with Service Unit', family: 'Iulio', mainCategory: DESK, subCategory: 'Executive Desks',
        productUrl: 'https://www.las.it/en/products/iulio/',
        imageUrl: 'https://www.las.it/wp-content/uploads/2021/08/iulio-thumb-01-scaled.jpg',
        description: 'IULIO executive range: desks with castor drawer units, service cabinets and sliding-door service units, plus matching meeting tables.',
        setRoles: ['executive_desk'], includesRoles: ['side_return'],
      }),
      official({
        model: 'I-Meet Modular Conference & Multi-Purpose Meeting Table', family: 'I-Meet', mainCategory: DESK, subCategory: 'Conference Tables',
        productUrl: 'https://www.las.it/en/products/i-meet/',
        imageUrl: 'https://www.las.it/wp-content/uploads/2021/08/imeet-thumb-01-scaled.jpg',
        description: 'I-MEET modular meeting tables in several formats that combine into large compositions, with top access module and under-top wire management. Fixed tables (not folding).',
        setRoles: ['conference_table'],
      }),
      official({
        model: 'PIEGO Folding Tables', family: 'Piego', mainCategory: DESK, subCategory: 'Folding & Multi-Purpose Conference Tables',
        productUrl: 'https://www.las.it/en/products/piego/',
        imageUrl: 'https://www.las.it/wp-content/uploads/2021/08/piego-thumb-02-1.jpg',
        description: 'PIEGO folding tables (folding tops or folding legs) for meetings, training and teamwork: three lengths, fixed feet or castors with brakes, 18 mm tops.',
        setRoles: ['folding_table'],
      }),
      official({
        model: 'CHIUDO Folding Meeting Tables', family: 'Chiudo', mainCategory: DESK, subCategory: 'Folding & Multi-Purpose Conference Tables',
        productUrl: 'https://www.las.it/en/products/chiudo/',
        imageUrl: 'https://www.las.it/wp-content/uploads/2021/08/chiudo-thumb-01-scaled.jpg',
        description: 'CHIUDO folding meeting tables (folding legs or folding tops) in three lengths on castors; storage cart for 5 tables.',
        setRoles: ['folding_table'],
      }),
      official({
        model: 'SCHERMI UNIVERSALI Desk Screens', family: 'Schermi Universali', mainCategory: 'Accessories', subCategory: 'Desk Screens',
        productUrl: 'https://www.las.it/en/products/schermi-universali/',
        imageUrl: 'https://www.las.it/wp-content/uploads/2021/08/schermi-thumb-02.jpg',
        description: 'SCHERMI UNIVERSALI desk-fixed partition screens in plain or acoustic versions.',
        setRoles: ['screen'],
      }),
      official({
        model: 'CONTENITORI UNIVERSALI Pedestals & Service Units', family: 'Contenitori Universali', mainCategory: 'Storage', subCategory: 'Pedestals',
        productUrl: 'https://www.las.it/en/products/contenitori-universali/',
        imageUrl: 'https://www.las.it/wp-content/uploads/2021/08/contenitori-thumb-01-scaled.jpg',
        description: 'CONTENITORI UNIVERSALI storage: six chest-of-drawers (pedestal) models, service units and cabinets.',
        setRoles: ['pedestal', 'side_return'],
      }),
    ],
    tags: [
      { match: /^(?:oxi|sigma|delta|5th element)$/i, set: { setRoles: ['workstation_desk'] } },
      { match: /^(?:iulio|enosi|monolith|elite)$/i, set: { setRoles: ['executive_desk'] } },
      { match: /^(?:piego|chiudo)$/i, set: { setRoles: ['folding_table'] } },
      { match: /^i[- ]?meet$/i, set: { setRoles: ['conference_table'] } },
      { match: /^schermi universali$/i, set: { setRoles: ['screen'] } },
      { match: /^contenitori universali$/i, set: { setRoles: ['pedestal', 'side_return'] } },
    ],
  },

  // ────────────────────────────── FREZZA (mid) ──────────────────────────────
  'frezza-mid.json': {
    upserts: [
      official({
        model: 'Be.1 Modular Bench Workstation & Folding Meeting System', family: 'Be.1', mainCategory: DESK, subCategory: 'Workstations',
        productUrl: 'https://www.frezza.com/en/products/open-space-bench-desks-be1/',
        imageUrl: 'https://www.frezza.com/wp-content/uploads/2024/07/scrivania-multipostazione-con-divisori-e-cassettiere-frezza-min.jpg',
        description: 'Be.1 modular bench desks (design Progetto CMR): bench depths 125 / 165 cm, melamine, fabric or glass partition screens, accessory trays and holders, cable grommets. Bench desks (not folding).',
        setRoles: ['workstation_desk'],
      }),
      official({
        model: 'Pop Easy Bench Desks', family: 'Pop Easy', mainCategory: DESK, subCategory: 'Workstations',
        productUrl: 'https://www.frezza.com/en/products/office-bench-desks-pop-easy/',
        imageUrl: 'https://www.frezza.com/wp-content/uploads/2024/07/scrivanie-multipostazione-bench-ufficio-open-space-pop-easy-frezza.jpg',
        description: 'Pop Easy modular bench desks: bench depths 125 / 165 cm with melamine, fabric or glass partition screens.',
        setRoles: ['workstation_desk'],
      }),
      official({
        model: 'Alplus Executive L-Shape Desk with Service Return', family: 'Alplus', mainCategory: DESK, subCategory: 'Executive Desks',
        productUrl: 'https://www.frezza.com/en/products/design-modern-executive-desk-alplus/',
        imageUrl: 'https://www.frezza.com/wp-content/uploads/2024/07/scrivania-direzionale-di-design-alplus-04.jpg',
        description: 'Alplus executive desk L 180 / 200 / 220 × D 90 cm (operative versions L 140 / 160 / 180 × D 80 cm). Combine with a sideboard or pedestal as the service return.',
        setRoles: ['executive_desk'],
      }),
      official({
        model: 'Mux70 Executive L-Shape Desk & Conference System', family: 'Mux70', mainCategory: DESK, subCategory: 'Executive Desks',
        productUrl: 'https://www.frezza.com/en/products/presidential-office-desk-mux70/',
        imageUrl: 'https://www.frezza.com/wp-content/uploads/2024/07/scrivania-presidenziale-moderna-stefano-boeri-mux70-frezza-3.jpg',
        description: 'Mux70 presidential desk by Stefano Boeri Interiors. Accessories: side extensions, hanging drawers / pedestals, service units and cupboards.',
        setRoles: ['executive_desk'],
      }),
      official({
        model: 'Mux70 Office Sideboard', family: 'Mux70', mainCategory: 'Storage', subCategory: 'Return Credenzas & Pedestals',
        productUrl: 'https://www.frezza.com/en/products/office-sideboard-design-mux70/',
        copyFrom: { model: 'MUX70 sideboard #20772160', fields: ['imageUrl'] },
        description: 'Mux70 office sideboard — the storage / service return of the Mux70 executive range.',
        setRoles: ['side_return'],
      }),
      official({
        model: 'Pop Folding Desk with Wheels', family: 'Pop Folding', mainCategory: DESK, subCategory: 'Folding & Multi-Purpose Conference Tables',
        productUrl: 'https://www.frezza.com/en/products/folding-desk-with-wheels-pop-folding/',
        imageUrl: 'https://www.frezza.com/wp-content/uploads/2024/07/pop-folding-scrivania-regolabile-in-altezza-still-life-00-1.jpg',
        description: 'Pop Folding: L 120 / 140 / 160 / 180 × D 60 / 80 cm, 25 mm top that folds to vertical, castors (two with brake), corner hooks to link tables in line for horseshoe or boardroom layouts. For training, educational and multi-purpose rooms.',
        setRoles: ['folding_table'],
      }),
      official({
        model: 'Frezza Pedestals', family: 'Pedestals', mainCategory: 'Storage', subCategory: 'Pedestals',
        productUrl: 'https://www.frezza.com/en/products/office-drawers-in-wood-and-metal-pedestals/',
        imageUrl: 'https://www.frezza.com/wp-content/uploads/2024/08/cassettiere-per-ufficio-pedestals-frezza-02.jpg',
        description: 'Wood and metal office pedestals: fixed desk-height units or mobile units on four castors, with lock.',
        setRoles: ['pedestal'],
      }),
      official({
        model: 'Pal Spina Desk Dividing Panels', family: 'Pal Spina', mainCategory: 'Accessories', subCategory: 'Desk Screens',
        productUrl: 'https://www.frezza.com/en/products/dividing-panels-for-desks-pal-spina-frezza/',
        imageUrl: 'https://www.frezza.com/wp-content/uploads/2024/07/passacavi-scrivanie-ufficio-pal-spina-frezza-ufficio-2-min.jpg',
        description: 'Pal Spina dividing panel system for desks: separates workstations and routes electrical cables to them, with shelves and trays.',
        setRoles: ['screen'],
      }),
      accessory({
        model: 'FREZZA Top-Access Power & Cable Management Kit', family: 'Be.1', mainCategory: 'Accessories', subCategory: 'Cable Management & Power',
        productUrl: 'https://www.frezza.com/en/products/open-space-bench-desks-be1/',
        description: 'Cable grommets and accessory trays offered with the Be.1 bench desks — price-list accessories of the bench system (no product page of their own).',
        setRoles: ['cable_management', 'power_box'],
      }),
      accessory({
        model: 'FREZZA Pop-Easy Modesty Panel', family: 'Pop Easy', mainCategory: 'Accessories', subCategory: 'Modesty Panels',
        productUrl: 'https://www.frezza.com/en/products/office-bench-desks-pop-easy/',
        description: 'Modesty panel for Pop Easy bench desks — a price-list accessory of the bench system (no product page of its own).',
        setRoles: ['modesty_panel'],
      }),
    ],
    tags: [
      { match: /^(?:be\.1|pop easy|pop square|pop tee|alplus) #\d+$/i, set: { setRoles: ['workstation_desk'] } },
      { match: /^mux70 desk #\d+$/i, set: { setRoles: ['executive_desk'] } },
      { match: /^mux70 sideboard #\d+$/i, set: { setRoles: ['side_return'] } },
      { match: /^mux70 meeting table #\d+$/i, set: { setRoles: ['conference_table'] } },
      { match: /^pop folding #\d+$/i, set: { setRoles: ['folding_table'] } },
    ],
  },

  // ─────────────────────────────── Nurus (mid) ───────────────────────────────
  'nurus-mid.json': {
    upserts: [
      official({
        model: 'U Too Workstations', family: 'U Too', mainCategory: DESK, subCategory: 'Workstations',
        productUrl: 'https://nurus.com/en/product/u-too-family/u-too-workstations/',
        imageUrl: 'https://nurus.com/wp-content/uploads/2025/08/Nurus_Operational-Desks_U-Too_Workstation_Catalogue.jpg',
        description: 'U Too workstations: single and double desk set-ups with extensions, optional upholstered separators and modesty panel, integrated cable management and power access.',
        setRoles: ['workstation_desk'],
      }),
      official({
        model: 'Pila Wood Workstations', family: 'Pila Wood', mainCategory: DESK, subCategory: 'Workstations',
        productUrl: 'https://nurus.com/en/product/pila-wood-family/pila-wood-workstations/',
        imageUrl: 'https://nurus.com/wp-content/uploads/2025/09/Pila-Wood_2li_WS.jpg',
        description: 'Pila Wood workstations for up to six users, with optional upholstered separators and modesty panel and integrated cable management.',
        setRoles: ['workstation_desk'],
      }),
      official({
        model: 'U Too Semi-Executive Desks', family: 'U Too', mainCategory: DESK, subCategory: 'Executive Desks',
        productUrl: 'https://nurus.com/en/product/u-too-family/u-too-semi-executive-desks/',
        imageUrl: '',
        description: 'U Too semi-executive desks from the U Too desking family.',
        setRoles: ['executive_desk'],
      }),
      {
        // Earlier entry pointed to a non-existent page and showed a chair; now linked to the verified semi-executive range.
        model: 'Nurus Next Executive L-Shape Desk with Return Credenza', family: 'U Too', mainCategory: DESK, subCategory: 'Executive Desks',
        productUrl: 'https://nurus.com/en/product/u-too-family/u-too-semi-executive-desks/',
        websiteUrl: 'https://nurus.com/en/product/u-too-family/u-too-semi-executive-desks/',
        imageUrl: '',
        description: 'Nurus semi-executive desk (U Too family) used for L-shape layouts with a return unit. No dedicated "Next" product page exists on nurus.com — confirm the exact configuration with the supplier.',
        price: 0, currency: 'USD', verified: false, source: 'catalog-repair', lastUpdated: VERIFIED_ON,
        setRoles: ['executive_desk'],
      },
      official({
        model: 'U Too Modular Folding & Meeting Table System', family: 'U Too', mainCategory: DESK, subCategory: 'Conference Tables',
        productUrl: 'https://nurus.com/en/product/u-too-family/u-too-meeting-tables/',
        copyFrom: { model: 'U too Meeting Table #1066823', fields: ['imageUrl'] },
        description: 'U Too meeting tables with optional modesty panel, flap electrification cap and integrated cable management. Fixed tables (not folding).',
        setRoles: ['conference_table'],
      }),
      accessory({
        model: 'Nurus Workstation Cable Tray & Power Module', family: 'U Too', mainCategory: 'Accessories', subCategory: 'Cable Management & Power',
        productUrl: 'https://nurus.com/en/product/u-too-family/u-too-workstations/',
        description: 'Integrated cable management and power access of the U Too workstations — part of the desk system (no product page of its own).',
        setRoles: ['cable_management', 'power_box'],
      }),
    ],
    tags: [
      { match: /^u too six fold desk #\d+$/i, set: { setRoles: ['workstation_desk'], seatsPerUnit: 6 } },
      { match: /^u too quadro desk #\d+$/i, set: { setRoles: ['workstation_desk'], seatsPerUnit: 4 } },
      { match: /^(?:u too double desk|silva double working system) #\d+$/i, set: { setRoles: ['workstation_desk'], seatsPerUnit: 2 } },
      { match: /^(?:u too desk|pila desk|silva desk) #\d+$/i, set: { setRoles: ['workstation_desk'] } },
      { match: /^(?:u too|silva|i\|x) meeting table #\d+$/i, set: { setRoles: ['conference_table'] } },
      { match: /^(?:fe2 h\d+ (?:mobile|fixed) pedastal|cube h[\d.]+ movable pedestal) #\d+$/i, set: { setRoles: ['pedestal'] } },
    ],
  },

  // ──────────────────────────── Sedus Stoll (mid) ────────────────────────────
  'sedus_stoll-mid.json': {
    upserts: [
      official({
        model: 'mastermind fold', family: 'mastermind', mainCategory: DESK, subCategory: 'Folding & Multi-Purpose Conference Tables',
        productUrl: 'https://www.sedus.com/en/products/tables/mastermind-fold',
        imageUrl: 'https://www.sedus.com/fileadmin/_processed_/b/a/csm_header_mastermind_fold_turn_around_Milieu_2_Hi-Res_JPG_13005_aef677303a.jpg',
        description: 'mastermind fold: folding conference table for up to 8 people, on castors and linkable, rectangular or boat-shaped top; only 400 mm wide when folded.',
        setRoles: ['folding_table'],
      }),
      official({
        model: 'se:lab flip', family: 'se:lab', mainCategory: DESK, subCategory: 'Folding & Multi-Purpose Conference Tables',
        productUrl: 'https://www.sedus.com/en/products/tables/selab-flip',
        imageUrl: 'https://www.sedus.com/fileadmin/_processed_/8/6/csm_se_lab_flip_Header_32419df8b4.jpg',
        description: 'se:lab flip: mobile table on lockable castors whose top flips up in the centre so tables nest; linkable; widths 700–1000 mm, lengths 1200–2000 mm.',
        setRoles: ['folding_table'],
      }),
      official({
        model: 'se:lab fold', family: 'se:lab', mainCategory: DESK, subCategory: 'Folding & Multi-Purpose Conference Tables',
        productUrl: 'https://www.sedus.com/en/products/tables/selab-fold',
        imageUrl: 'https://www.sedus.com/fileadmin/_processed_/b/8/csm_sedus_banner-produkte-selabfold_1_06e8d073c7.jpg',
        description: 'se:lab fold: space-saving folding table with optional castors; a stacking trolley holds 12 tables.',
        setRoles: ['folding_table'],
      }),
      official({
        model: 'se:lab bench', family: 'se:lab', mainCategory: DESK, subCategory: 'Workstations',
        productUrl: 'https://www.sedus.com/en/products/tables/selab-bench',
        imageUrl: 'https://www.sedus.com/fileadmin/_processed_/e/0/csm_sedus_banner-produkte-selabbench_66544e7f72.jpg',
        description: 'se:lab bench: team bench with optional se:lab screen and se:lab tray drawer.',
        setRoles: ['workstation_desk'],
      }),
      official({
        model: 'temptation four Bench Workstation', family: 'temptation', mainCategory: DESK, subCategory: 'Workstations',
        productUrl: 'https://www.sedus.com/en/products/tables/temptation-four-1',
        imageUrl: 'https://www.sedus.com/fileadmin/_processed_/9/9/csm_sedus_banner-produkte-temptationfour_714b2afd44.jpg',
        description: 'temptation four table system as team bench (also single workstation and meeting versions): cable outlets, cable trays, CPU holders and vertical cable management on the beam.',
        setRoles: ['workstation_desk'],
      }),
      official({
        model: 'temptation smart twin', family: 'temptation', mainCategory: DESK, subCategory: 'Workstations',
        productUrl: 'https://www.sedus.com/en/products/tables/temptation-smart-twin',
        imageUrl: 'https://www.sedus.com/fileadmin/_processed_/2/a/csm_sedus_temptation_tmart_twin-banner_ba719e7473.jpg',
        description: 'temptation smart twin: electrically height-adjustable double bench for two users, with electrification.',
        setRoles: ['workstation_desk'], seatsPerUnit: 2,
      }),
      official({
        // temptation prime is a single-desk / conference range — not an L-shape product.
        model: 'temptation prime Executive L-Shape Desk', family: 'temptation', mainCategory: DESK, subCategory: 'Executive Desks',
        productUrl: 'https://www.sedus.com/en/products/tables/temptation-prime-1',
        description: 'temptation prime single desk (fixed height) from the temptation prime range of executive desks, team tables and conference tables. Not an L-shape product: pair it with se:vision storage or a sideboard for a return.',
        setRoles: ['executive_desk'],
      }),
      official({
        model: 'se:vision desk & storage', family: 'se:vision', mainCategory: DESK, subCategory: 'Executive Desks',
        productUrl: 'https://www.sedus.com/en/products/tables/sevision-desk',
        imageUrl: 'https://www.sedus.com/fileadmin/_processed_/c/5/csm_sedus_banner-produkte-sevision_50b6ba7c61.jpg',
        description: 'se:vision desk with optional adjacent storage (beside or under the table, or as a sideboard) — the Sedus desk-with-return solution.',
        setRoles: ['executive_desk'], includesRoles: ['side_return'],
      }),
      official({
        model: 'temptation prime Conference Table', family: 'temptation', mainCategory: DESK, subCategory: 'Conference Tables',
        productUrl: 'https://www.sedus.com/en/products/tables/temptation-prime',
        copyFrom: { model: 'temptation prime Executive L-Shape Desk', fields: ['imageUrl'] },
        description: 'temptation prime conference tables in fine materials for boardrooms and conference rooms.',
        setRoles: ['conference_table'],
      }),
      official({
        model: 'get together Modular Workstation & Meeting Table', family: 'get together', mainCategory: DESK, subCategory: 'Conference Tables',
        productUrl: 'https://www.sedus.com/en/products/tables/get-together',
        description: 'get together: team table for concentrated work and open exchange.',
        setRoles: ['conference_table', 'workstation_desk'],
      }),
      official({
        model: 'easy screen', family: 'easy screen', mainCategory: 'Accessories', subCategory: 'Desk Screens',
        productUrl: 'https://www.sedus.com/en/products/room-elements-screens-acoustics/easy-screen-4',
        imageUrl: 'https://www.sedus.com/fileadmin/_processed_/5/8/csm_header_tem_high_Milieu_Bench_2f876da0c5.jpg',
        description: 'easy screen: desk-mounted privacy screen in two heights.',
        setRoles: ['screen'],
      }),
      official({
        model: 'Container Desk Pedestals', family: 'Container', mainCategory: 'Storage', subCategory: 'Pedestals',
        productUrl: 'https://www.sedus.com/en/products/storage-space/desk-pedestals/container-multifunctional-or-personal-storage-space',
        imageUrl: 'https://www.sedus.com/fileadmin/_processed_/6/f/csm_sedus_banner-produkte-container_14213f9b64.jpg',
        description: 'Sedus Container: fixed and mobile desk pedestals for multifunctional or personal storage.',
        setRoles: ['pedestal'],
      }),
      accessory({
        model: 'Sedus Cable Tray & Electrification Module', family: 'temptation', mainCategory: 'Accessories', subCategory: 'Cable Management & Power',
        productUrl: 'https://www.sedus.com/en/products/tables/temptation-four-1',
        description: 'Cable outlets, cable trays and vertical cable management of the temptation four table system — part of the system (no product page of its own).',
        setRoles: ['cable_management', 'power_box'],
      }),
    ],
    tags: [],
  },

  // ─────────────────────────────── Pedrali (mid) ───────────────────────────────
  'pedrali-mid.json': {
    upserts: [
      official({
        model: 'Ypsilon Tilting Folding Conference Table', family: 'Ypsilon', mainCategory: DESK, subCategory: 'Folding & Multi-Purpose Conference Tables',
        productUrl: 'https://www.pedrali.com/en-us/products/tables-design/ypsilon-tilting',
        imageUrl: 'https://pedraliitprodkenticosa.blob.core.windows.net/media/pedrali/media/assets/thumbnails/prodotti/y/ypsilon-tilting-tyt-listing.png',
        description: 'Ypsilon tilting: table with tilting top that nests when stacked, used as workstation or meeting table.',
        setRoles: ['folding_table'],
      }),
      official({
        model: 'Arki-Table Adjustable Workstation Desk', family: 'Arki-Table', mainCategory: DESK, subCategory: 'Workstations',
        productUrl: 'https://www.pedrali.com/en-us/products/tables-design/arki-table-ark-adj-desk',
        imageUrl: 'https://pedraliitprodkenticosa.blob.core.windows.net/media/pedrali/media/assets/thumbnails/prodotti/a/arki-table-adj-desk-listing.png',
        description: 'Arki-Table ARK ADJ DESK: height-adjustable desk of the Arki-Table collection.',
        setRoles: ['workstation_desk'],
      }),
      {
        // Link and image now come from the catalog's verified "arki-table ark" entry.
        model: 'Arki-Table Modular Conference Table', family: 'Arki-Table', mainCategory: DESK, subCategory: 'Conference Tables',
        copyFrom: { model: 'arki-table ark', fields: ['imageUrl', 'productUrl', 'websiteUrl', 'price'] },
        description: 'Arki-Table ARK: table collection with slim top and trestle legs, used as meeting and conference table.',
        currency: 'USD', verified: true, source: 'official-site', lastUpdated: VERIFIED_ON,
        setRoles: ['conference_table'],
      },
      {
        // No official Elliot meeting-table page could be found (the old link opens the Pedrali home page).
        model: 'Elliot Meeting Table', family: 'Elliot', mainCategory: DESK, subCategory: 'Conference Tables',
        productUrl: 'https://www.pedrali.com/en-us', websiteUrl: 'https://www.pedrali.com/en-us', imageUrl: '',
        description: 'Unverified catalog entry: no official Pedrali product page was found for an "Elliot" meeting table. Confirm with the supplier before quoting.',
        price: 0, currency: 'USD', verified: false, source: 'catalog-repair', lastUpdated: VERIFIED_ON,
        excludeFromSets: true,
      },
    ],
    tags: [
      { match: /^arki-table ark$/i, set: { setRoles: ['conference_table'] } },
    ],
  },

  // ───────────────────────── Ottimo Furniture (budgetary) ─────────────────────────
  // ottimouae.com blocks automated access, so nothing new is added here: existing catalog
  // products (already carrying their own ottimouae.com links) are only tagged.
  'ottimo_furniture-budgetary.json': {
    upserts: [],
    tags: [
      { match: /^(?:rectangular desk white leg|rectangular table|oxo rectangular desk|pyramid rectangular desk|mix series desk|onyx(?: pro)? series desk)$/i, set: { setRoles: ['workstation_desk'] } },
      { match: /^(?:\d+ pax (?:face to face|single line)\b.*|cluster (?:of )?\d+ (?:face to face|single line)\b.*)$/i, set: { setRoles: ['workstation_desk'] } },
      { match: /^(?:l shape \d+ pax\b.*|cluster (?:of )?\d+ l[- ]shape desk\b.*|lshape single person with overhead cabinet)$/i, set: { setRoles: ['workstation_desk'], includesRoles: ['side_return'] } },
      { match: /^(?:l shape executive desk|pyramid l shape desk \d+|oxo l shape desk)$/i, set: { setRoles: ['executive_desk'], includesRoles: ['side_return'] } },
      { match: /^(?:wooden leg|modern|oxo|versa|fine crafted|diamond) meeting table$|^meeting table with metal leg$/i, set: { setRoles: ['conference_table'] } },
      { match: /^\dx users desktop power access and cable management\b/i, set: { setRoles: ['power_box', 'cable_management'] } },
      { match: /^(?:hydraulic pop up socket|manual flip up power socket|power pop up table socket|clamp on table socket|grommet socket|brush cover socket)$/i, set: { setRoles: ['power_box'] } },
      { match: /^(?:bevel .*sideboard.*cabinet|low height .*cabinet.*|bevel .*low height .*cabinet)$/i, set: { setRoles: ['side_return'] } },
    ],
  },

  // ───────────────────────────── Teknion ME (premium) ─────────────────────────────
  'teknion_me-premium.json': {
    upserts: [
      official({
        model: 'Expansion Learning Tables (Flip-Top & Folding)', family: 'Expansion', mainCategory: 'CLASSROOM / TRAINING TABLES', subCategory: 'Folding & Multi-Purpose Conference Tables',
        productUrl: 'https://www.teknion.com/ca/products/product-details?productlineid=8283336e-8e7a-673b-a6c8-ff00004460c4',
        imageUrl: 'https://teknion.bynder.com/m/5b12848a975b68e5/prodban_Expansion_Training_Tables.jpg',
        description: 'Expansion training tables: mobile multi-purpose tables in Flip-Top and Folding models with Quick Release Linking System, modesty panels and optional electrical tray.',
        setRoles: ['folding_table'],
      }),
    ],
    tags: [
      { match: /^(?:expansion citybench|expansion desking|upstage|interpret|tek\/n ap|routes)$/i, set: { setRoles: ['workstation_desk'] } },
      { match: /^(?:expansion casegoods|journal|dossier)$/i, set: { setRoles: ['executive_desk'] } },
      { match: /^(?:expansion learning tables|expansion training|expansion training table|thesis flip top table)$/i, set: { setRoles: ['folding_table'] } },
      { match: /^(?:c\+d conference table|audience|audience boardroom table|community table)$/i, set: { setRoles: ['conference_table'] } },
      { match: /^pedestals$/i, set: { setRoles: ['pedestal'] } },
    ],
  },

  // ─────────────────────────────── Arper (high) ───────────────────────────────
  'arper-high.json': {
    upserts: [
      official({
        model: 'Cross Meeting & Boardroom Table System', family: 'Cross', mainCategory: DESK, subCategory: 'Conference Tables',
        productUrl: 'https://www.arper.com/us_EN/collections/cross.html',
        imageUrl: 'https://www.arper.com/media/wysiwyg/CollectionImages/Cross_Gallery_3_2.png',
        description: 'Cross table system for meeting, boardroom and collaborative work: standard or electrified versions, in-line configurations for long tables.',
        setRoles: ['conference_table'],
      }),
    ],
    tags: [],
  },

  // ─────────────────────────────── ISMOBIL (mid) ───────────────────────────────
  // Roles follow the manufacturer's own URL taxonomy (…/mobiliario/operativo/… and …/mobiliario/direccion/…).
  'ismobil-mid.json': {
    upserts: [],
    tags: [
      { matchUrl: /\/mobiliario\/operativo\/[^/]+\/?$/i, set: { setRoles: ['workstation_desk'] } },
      { matchUrl: /\/mobiliario\/direccion\/[^/]+\/?$/i, set: { setRoles: ['executive_desk'] } },
    ],
  },
};

const norm = (v) => String(v || '').trim().toLowerCase();

function applyPlan(brand, plan) {
  const products = Array.isArray(brand.products) ? brand.products : (brand.products = []);
  const stats = { added: [], updated: [], tagged: 0, missingCopy: [] };

  for (const entry of plan.upserts || []) {
    const { copyFrom, ...fields } = entry;
    const next = { ...fields };
    if (copyFrom) {
      const src = products.find(p => norm(p.model) === norm(copyFrom.model));
      if (src) {
        for (const key of copyFrom.fields) {
          const val = src[key];
          if (val === undefined || val === null || val === '') continue;
          if (copyFrom.onlyIfPositive && !(parseFloat(val) > 0)) continue;
          next[key] = val;
        }
      } else {
        stats.missingCopy.push(`${entry.model} ← ${copyFrom.model}`);
      }
    }
    if (next.productUrl && !next.websiteUrl) next.websiteUrl = next.productUrl;
    const idx = products.findIndex(p => norm(p.model) === norm(entry.model));
    if (idx === -1) {
      products.push(next);
      stats.added.push(entry.model);
    } else {
      const prev = products[idx];
      // A price that is already on file is never reset to 0 by the enrichment
      if (parseFloat(prev.price) > 0 && !(parseFloat(next.price) > 0)) next.price = prev.price;
      const merged = { ...prev, ...next };
      if (JSON.stringify(merged) !== JSON.stringify(prev)) {
        products[idx] = merged;
        stats.updated.push(entry.model);
      }
    }
  }

  for (const rule of plan.tags || []) {
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const model = String(p.model || '').trim();
      const url = String(p.productUrl || p.websiteUrl || '');
      const hit = rule.match ? rule.match.test(model) : (rule.matchUrl ? rule.matchUrl.test(url) : false);
      if (!hit) continue;
      const merged = { ...p, ...rule.set };
      if (JSON.stringify(merged) !== JSON.stringify(p)) {
        products[i] = merged;
        stats.tagged++;
      }
    }
  }
  return stats;
}

let changedFiles = 0;
for (const [file, plan] of Object.entries(PLAN)) {
  const filePath = path.join(BRANDS_DIR, file);
  if (!fs.existsSync(filePath)) {
    console.warn(`[skip] ${file} not found in ${BRANDS_DIR}`);
    continue;
  }
  const original = fs.readFileSync(filePath, 'utf8');
  const brand = JSON.parse(original);
  const stats = applyPlan(brand, plan);
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  let output = JSON.stringify(brand, null, 2);
  if (eol !== '\n') output = output.replace(/\n/g, eol);
  if (original.endsWith('\n')) output += eol;
  const changed = output !== original;
  if (changed) changedFiles++;
  console.log(`${changed ? (DRY_RUN ? '[would update]' : '[updated]') : '[unchanged]'} ${file} (${brand.name}): +${stats.added.length} added, ${stats.updated.length} corrected, ${stats.tagged} tagged, ${brand.products.length} products`);
  for (const m of stats.added) console.log(`    + ${m}`);
  for (const m of stats.updated) console.log(`    ~ ${m}`);
  for (const m of stats.missingCopy) console.log(`    ! copy source not found: ${m}`);
  if (changed && !DRY_RUN) fs.writeFileSync(filePath, output, 'utf8');
}
console.log(`${DRY_RUN ? 'Dry run — ' : ''}${changedFiles} catalog file(s) ${DRY_RUN ? 'would change' : 'changed'}.`);
