/**
 * Dynamic Project Action & Control Plan Engine
 * Generates:
 *   1. `buildDynamicProjectPlan(...)` — Scale-adaptive CPM schedule, WBS, EV 80/20 split,
 *      deliverables (MAS/MIR/WIR/DN), resources histogram, materials with Official Finishes,
 *      cash-flow S-curve, risks, and RACI matrix directly from any BOQ / 3D takeoff.
 *   2. `buildProjectPlanExcel(plan)` -> Blob (.xlsx via ExcelJS — 10 interconnected worksheets).
 *   3. `buildMsProjectXml(plan)` -> Blob (.xml MSPDI schema for MS Project / Primavera / ProjectLibre).
 */

import { resolveItemFinishes, formatFinishSummary, resolveFitoutSkuCode } from '../../utils/officialBrandFinishes.js';

function offerColumns(table) {
  const header = (table?.header || []).map((h) => String(h || '').replace(/\s+/g, ' ').trim());
  const find = (re, not) => header.findIndex((h) => re.test(h) && !(not && not.test(h)));
  const described = find(/description|particulars|specification/i);
  const description = described >= 0 ? described : find(/item|product/i, /\bno\b|no\.|number|code|ref|#/i);
  let sn = find(/^(s\.?n\.?|sr\.?\s*no\.?|sl\.?\s*no\.?|ref\.?|code|no\.?|#)$/i);
  if (sn < 0) sn = header.findIndex((h, i) => /^item$/i.test(h) && i !== description);
  return {
    sn,
    image: find(/image|photo|picture/i, /brand|logo/i),
    description,
    brand: find(/brand|manufacturer|make/i),
    model: find(/model|sku|series/i),
    qty: find(/qty|quantity/i),
    unit: find(/^(unit|uom|u\.?o\.?m\.?)$/i),
    rate: find(/rate|unit\s*price|price/i),
    amount: find(/amount|total/i),
  };
}

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const r3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000;
const cellVal = (row, i) => {
  if (!(i >= 0)) return undefined;
  const c = row?.cells?.[i];
  return c && typeof c === 'object' ? c.value : c;
};
const escXml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const ISO_DATE = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const ADD_DAYS = (baseDate, offsetDays) => {
  const d = new Date(baseDate.getTime());
  d.setDate(d.getDate() + offsetDays);
  return d;
};

const COL_LETTER = (n) => {
  let s = '';
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
};

function currencyToOmrFactor(cur) {
  const c = String(cur || 'OMR').toUpperCase();
  if (c === 'OMR' || c === 'BHD' || c === 'KWD') return 1;
  if (c === 'AED' || c === 'SAR' || c === 'QAR') return 0.105;
  if (c === 'USD') return 0.385;
  if (c === 'EUR' || c === 'GBP') return 0.42;
  return 0.385;
}

function classifyTrade(line) {
  const hay = `${line.brand || ''} ${line.model || ''} ${line.category || ''} ${line.description || ''} ${line.code || ''}`.toLowerCase();
  const code = String(line.code || resolveFitoutSkuCode(line) || '').toUpperCase();

  if (/^(mob|util|hse|deb|cln|ins)/i.test(code) || /\b(mobilization|prelim|insurance|car|permit|hoarding|cleaning|disposal|supervision)\b/i.test(hay)) {
    return { key: 'prelims', label: 'Mobilization, Permits & Prelims / التجهيز والتأمين والمعاينات', evMode: 'site', execHint: 'A00' };
  }
  if (/^(mep-av)/i.test(code) || /\b(signage|lettering|3d\s*letter|lightbox|light\s*box|branding|display\s*screen|led\s*display|tv|video\s*wall)\b/i.test(hay)) {
    return { key: 'signage', label: 'Branding, Signage & AV Systems / البراندنج والشاشات', evMode: 'fab', execHint: 'SIGN' };
  }
  if (/^(mep|el-|pl-)/i.test(code) || /\b(electrical|lighting|luminaire|downlight|wiring|power\s*point|socket|data\s*point|hvac|ac\s*diffuser|fire\s*alarm|sprinkler|plumbing)\b/i.test(hay)) {
    return { key: 'mep', label: 'Electrical, Lighting & MEP Works / الأعمال الكهروميكانيكية', evMode: 'site', execHint: 'MEP' };
  }
  if (/^(mep-san|jn-pnt|jn-van)/i.test(code) || /\b(sanitary|w\.?c\.?|water\s*closet|wash\s*basin|urinal|faucet|mixer|pantry|kitchenette)\b/i.test(hay)) {
    return { key: 'sanitary', label: 'Sanitary Fixtures & Pantry / الأدوات الصحية', evMode: 'fab', execHint: 'SAN' };
  }
  if (line.fulfillmentType === 'custom_fabrication' || /\bcustom\s*fab|bespoke|millwork|joinery|reception\s*counter|cashier\s*counter|corian|banquette|display\s*unit|podium\b/i.test(hay) || /^FAB-/i.test(code)) {
    return { key: 'joinery', label: 'Custom Joinery & Millwork / النجارة والتصنيع الخاص', evMode: 'fab', execHint: 'JOIN' };
  }
  if (/^(wc-|pt-)/i.test(code) || /\b(partition|drywall|gyproc\s*partition|glass\s*partition|glazed\s*partition|demountable|blockwork|wall\s*cladding|fluted\s*(?:timber|wood).*wall)\b/i.test(hay)) {
    return { key: 'partitions', label: 'Partitions, Glazing & Wall Cladding / القواطع والتكسيات والزجاج', evMode: 'site', execHint: 'PART' };
  }
  if (/^(cl-)/i.test(code) || /\b(ceiling|soffit|acoustic\s*tile|gypsum\s*ceiling|rotunda\s*canopy|baffle)\b/i.test(hay)) {
    return { key: 'ceiling', label: 'Ceiling Works / أعمال الأسقف', evMode: 'site', execHint: 'CEIL' };
  }
  if (/^(fn-)/i.test(code) || /\b(paint|emulsion|skim|plaster|wallpaper)\b/i.test(hay)) {
    return { key: 'paint', label: 'Wall Finishes & Painting / دهان الحوائط والتشطيبات', evMode: 'site', execHint: 'PAINT' };
  }
  if (/^(fl-)/i.test(code) || /\b(floor|porcelain|ceramic|carpet|vinyl|lvt|parquet|terrazzo|skirting|screed)\b/i.test(hay)) {
    return { key: 'flooring', label: 'Floor Finishes & Skirting / أعمال الأرضيات والنعلات', evMode: 'site', execHint: 'FLOOR' };
  }
  if (/^(dr-|wn-)/i.test(code) || /\b(door|window|ironmongery)\b/i.test(hay)) {
    return { key: 'doors', label: 'Doors, Windows & Ironmongery / الأبواب والنوافذ', evMode: 'site', execHint: 'DOORS' };
  }
  return { key: 'furniture', label: 'Loose Furniture & Seating (FF&E) / الأثاث والتجهيزات', evMode: 'fab', execHint: 'FFE' };
}

function normalizeBoqLines(tables = [], products = [], takeoff = null) {
  const out = [];
  if (Array.isArray(tables) && tables.length > 0) {
    tables.forEach((tbl) => {
      const col = offerColumns(tbl);
      (tbl?.rows || []).forEach((row) => {
        if (!row || row.isHeader || row.isSummary || row.isOptionRow || row.isSetSubItem || !Array.isArray(row.cells)) return;
        const desc = String(cellVal(row, col.description) || row.sourceDescription || '').trim();
        if (!desc) return;
        const qty = Math.max(0, num(cellVal(row, col.qty)) || 1);
        const rate = Math.max(0, num(cellVal(row, col.rate)));
        const rawAmt = num(cellVal(row, col.amount));
        const amount = rawAmt > 0 ? r3(rawAmt) : r3(qty * rate);
        const brand = col.brand >= 0 ? String(cellVal(row, col.brand) || row.selectedBrand || '').trim() : String(row.selectedBrand || '').trim();
        const model = col.model >= 0 ? String(cellVal(row, col.model) || row.selectedModel || '').trim() : String(row.selectedModel || '').trim();
        const code = String(row.code || row.skuCode || resolveFitoutSkuCode({ model, description: desc }) || '').trim();
        const finishes = resolveItemFinishes({
          brand,
          code,
          model,
          description: desc,
          category: row.selectedMainCat || '',
          finishes: row.finishes,
        });
        const base = {
          sn: String(cellVal(row, col.sn) || out.length + 1),
          code,
          brand,
          model,
          description: desc,
          unit: String(cellVal(row, col.unit) || 'Nos').trim(),
          qty: r2(qty),
          rate: r3(rate || (qty > 0 ? amount / qty : 0)),
          amount,
          category: [row.selectedMainCat, row.selectedSubCat, row.categoryHint].filter(Boolean).join(' / '),
          fulfillmentType: row.fulfillmentType || '',
          leadTimeDays: Number(row.leadTimeDays) || 0,
          finishes,
          finishSummary: formatFinishSummary(finishes),
        };
        out.push({ ...base, trade: classifyTrade(base) });
      });
    });
  } else if (Array.isArray(products) && products.length > 0) {
    products.forEach((p, idx) => {
      const qty = Math.max(0, num(p.qty) || 1);
      const rate = Math.max(0, num(p.rate));
      const amount = num(p.amount) > 0 ? r3(num(p.amount)) : r3(qty * rate);
      const code = String(p.code || p.skuCode || resolveFitoutSkuCode(p) || '').trim();
      const finishes = resolveItemFinishes({ ...p, code });
      const base = {
        sn: String(p.sn || idx + 1),
        code,
        brand: p.brand || '',
        model: p.model || '',
        description: p.description || p.model || `Item ${idx + 1}`,
        unit: p.unit || 'Nos',
        qty: r2(qty),
        rate: r3(rate),
        amount,
        category: p.category || '',
        fulfillmentType: p.fulfillmentType || '',
        leadTimeDays: Number(p.leadTimeDays) || 0,
        finishes,
        finishSummary: formatFinishSummary(finishes),
      };
      out.push({ ...base, trade: classifyTrade(base) });
    });
  }

  // Fallback benchmark items when an empty shell plan is built from 3D takeoff alone
  if (out.length === 0 && takeoff) {
    const seeds = [
      { code: 'MOB 01', brand: 'FitOut V2', model: 'Site Preliminaries & CAR Insurance', description: 'Mobilization, landlord permits, site supervision, and CAR insurance', unit: 'LS', qty: 1, rate: 650 },
      takeoff.netFloorAreaM2 > 0 && { code: 'FL-POR-01', brand: 'FitOut V2', model: 'Flooring Package', description: 'Commercial floor finish across measured slab', unit: 'Sqm', qty: r2(takeoff.netFloorAreaM2), rate: 18 },
      takeoff.solidWallNetPaintAreaM2 > 0 && { code: 'FN-PNT-01', brand: 'FitOut V2', model: 'Wall Painting', description: 'Internal wall prep, primer and 2 coats emulsion', unit: 'Sqm', qty: r2(takeoff.solidWallNetPaintAreaM2), rate: 5.5 },
      takeoff.ceilingAreaM2 > 0 && { code: 'CL-GYP-01', brand: 'FitOut V2', model: 'Gyproc Ceiling', description: 'Suspended gypsum ceiling across floor area', unit: 'Sqm', qty: r2(takeoff.ceilingAreaM2), rate: 14 },
      takeoff.glassPartitionAreaM2 > 0 && { code: 'PT-GLS-01', brand: 'FitOut V2', model: 'Acoustic Glass Partition', description: 'Tempered double-glazed partition & pod walls', unit: 'Sqm', qty: r2(takeoff.glassPartitionAreaM2), rate: 68 },
      (takeoff.furnitureTotalCount || 0) > 0 && { code: 'FFE-01', brand: 'Contract Furniture', model: 'Loose FF&E Supply & Install', description: `Loose furniture schedule (${takeoff.furnitureTotalCount} pieces extracted from drawing)`, unit: 'Nos', qty: takeoff.furnitureTotalCount, rate: 180 },
    ].filter(Boolean);
    seeds.forEach((s, idx) => {
      const finishes = resolveItemFinishes({ brand: s.brand, code: s.code, model: s.model, description: s.description });
      const base = { ...s, sn: String(idx + 1), amount: r3(s.qty * s.rate), category: s.brand, fulfillmentType: '', leadTimeDays: 21, finishes, finishSummary: formatFinishSummary(finishes) };
      out.push({ ...base, trade: classifyTrade(base) });
    });
  }
  return out;
}

/**
 * Synthesizes a complete scale-adaptive CPM Project Action & Control Plan from BOQ data + 3D takeoff.
 */
export function buildDynamicProjectPlan({
  tables = [],
  products = [],
  takeoff = null,
  project = {},
  brand = {},
  currency = 'OMR',
  costingFactors = null,
  planName = '',
} = {}) {
  const lines = normalizeBoqLines(tables, products, takeoff);
  const netTotal = r3(lines.reduce((s, l) => s + num(l.amount), 0));
  const vatPct = Number.isFinite(Number(project.vatPercent)) && String(project.vatPercent).trim() !== ''
    ? Math.max(0, Number(project.vatPercent))
    : (Number.isFinite(Number(costingFactors?.vat)) ? Math.max(0, Number(costingFactors.vat)) : 5);
  const vatRate = vatPct / 100;
  const grossTotal = r3(netTotal * (1 + vatRate));

  const tradeSet = new Set(lines.map((l) => l.trade.key));
  const floorSqm = Number(takeoff?.netFloorAreaM2 || 0) || lines.filter((l) => l.trade.key === 'flooring').reduce((s, l) => s + num(l.qty), 0);
  const netOmr = netTotal * currencyToOmrFactor(currency);
  const maxLead = Math.max(14, ...lines.map((l) => Number(l.leadTimeDays) || 0));

  const overrideDur = Number(project.contractDurationDays);
  let scaleTier = 'Small Fit-Out / Boutique';
  let scaleFactor = 1;
  let durationDays = 45;
  if (overrideDur >= 15) {
    durationDays = Math.round(overrideDur);
    scaleFactor = Math.max(0.75, durationDays / 45);
    scaleTier = durationDays >= 110 ? 'Turnkey Major' : durationDays >= 80 ? 'Large Commercial' : durationDays >= 55 ? 'Medium Fit-Out' : 'Compact Fit-Out';
  } else if (netOmr > 200000 || floorSqm >= 800 || tradeSet.size >= 9) {
    durationDays = Math.max(120, Math.min(180, maxLead + 60));
    scaleTier = 'Turnkey Major (120+ Days)';
    scaleFactor = durationDays / 45;
  } else if (netOmr > 60000 || floorSqm >= 300 || tradeSet.size >= 7) {
    durationDays = Math.max(90, Math.min(120, maxLead + 42));
    scaleTier = 'Large Commercial (90 Days)';
    scaleFactor = durationDays / 45;
  } else if (netOmr > 15000 || floorSqm >= 100 || tradeSet.size >= 5) {
    durationDays = Math.max(60, maxLead + 30);
    scaleTier = 'Medium Fit-Out (60 Days)';
    scaleFactor = durationDays / 45;
  } else {
    durationDays = 45;
    scaleTier = 'Boutique Fit-Out (45 Days)';
    scaleFactor = 1;
  }

  const sc = (baseDays, min = 1) => Math.max(min, Math.round(baseDays * scaleFactor));
  const startDate = (() => {
    const m = String(project.issueDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date();
  })();
  const finishDate = ADD_DAYS(startDate, durationDays - 1);

  const clientName = String(project.clientName || 'Client').trim();
  const contractorName = String(project.contractor || brand.company || 'Main Contractor').trim();
  const pmName = String(project.projectManager || project.siteEngineer || 'Project Manager').trim();
  const projectTitle = String(project.projectName || planName || 'Design & Build Fit-Out Project').replace(/\.pdf$/i, '').trim();

  // Dynamic phase durations
  const mobEnd = Math.min(Math.round(durationDays * 0.16), sc(7, 5)); // e.g. day 7 of 45
  const fabStart = mobEnd + 1;
  const fabDurJoinery = Math.max(sc(18, 10), Math.min(Math.round(durationDays * 0.45), tradeSet.has('joinery') ? (maxLead || 20) : 14));
  const fabDurFfe = Math.max(sc(16, 10), Math.min(Math.round(durationDays * 0.42), sc(18, 10)));
  const fabDurSign = Math.max(sc(18, 10), Math.min(Math.round(durationDays * 0.45), sc(20, 12)));

  const hasJoinery = tradeSet.has('joinery');
  const hasFfe = tradeSet.has('furniture');
  const hasSignage = tradeSet.has('signage');
  const hasSanitary = tradeSet.has('sanitary');
  const hasPartitions = tradeSet.has('partitions');
  const hasMep = tradeSet.has('mep') || hasSignage || hasSanitary;
  const hasCeiling = tradeSet.has('ceiling');
  const hasPaint = tradeSet.has('paint');
  const hasFlooring = tradeSet.has('flooring');
  const hasDoors = tradeSet.has('doors');
  const hasOffsite = hasJoinery || hasFfe || hasSignage || hasSanitary;

  const activities = [];
  const pushAct = (act) => activities.push({ ...act, endDay: act.startDay + act.duration - 1 });

  // Phase 1: Project Management
  pushAct({ id: 'A00', phase: '1. Project Management | إدارة المشروع', name: 'Project management, HSE, landlord coordination & progress control (Continuous)', type: 'Task', boqRef: 'Prelims', owner: pmName, predIds: [], predText: '-', startDay: 1, duration: durationDays, resourceId: 'R01' });

  // Phase 2: Mobilization, Permits & Engineering Approvals
  pushAct({ id: 'A01', phase: '2. Mobilization & Approvals | التجهيز والاعتمادات', name: 'Receive 60% advance payment & commence contractual duration', type: 'Milestone', boqRef: 'Payment 60%', owner: clientName, predIds: [], predText: '-', startDay: 1, duration: 1, resourceId: 'R11' });
  pushAct({ id: 'A02', phase: '2. Mobilization & Approvals | التجهيز والاعتمادات', name: 'Issue CAR Insurance policy & HSE risk plan', type: 'Task', boqRef: 'Prelims', owner: pmName, predIds: ['A01'], predText: 'A01', startDay: 1, duration: sc(3, 2), resourceId: 'R01' });
  pushAct({ id: 'A03', phase: '2. Mobilization & Approvals | التجهيز والاعتمادات', name: 'Submit landlord/municipality fit-out permit dossier', type: 'Task', boqRef: 'Prelims', owner: pmName, predIds: ['A02'], predText: 'A02', startDay: 2, duration: Math.max(3, mobEnd - 2), resourceId: 'R10' });
  pushAct({ id: 'A04', phase: '2. Mobilization & Approvals | التجهيز والاعتمادات', name: 'Site handover & Work Permit issued by Landlord/Client', type: 'Milestone', boqRef: 'Site Access', owner: 'Landlord / Management', predIds: ['A03'], predText: 'A03', startDay: mobEnd, duration: 1, resourceId: 'R10' });
  pushAct({ id: 'A05', phase: '2. Mobilization & Approvals | التجهيز والاعتمادات', name: 'Site dimensional laser survey & 3D as-built verification', type: 'Task', boqRef: 'All Trades', owner: 'Technical Designer', predIds: ['A01'], predText: 'A01', startDay: 2, duration: sc(3, 2), resourceId: 'R03' });
  pushAct({ id: 'A06', phase: '2. Mobilization & Approvals | التجهيز والاعتمادات', name: 'Prepare shop drawings (Joinery, FF&E, Ceiling & Partitions)', type: 'Task', boqRef: 'Joinery & FF&E', owner: 'Technical Designer', predIds: ['A05'], predText: 'A05', startDay: 3, duration: Math.max(2, mobEnd - 4), resourceId: 'R03' });
  pushAct({ id: 'A07', phase: '2. Mobilization & Approvals | التجهيز والاعتمادات', name: 'Submit official brand finish swatches, veneers, fabrics & paint samples (MAS)', type: 'Task', boqRef: 'Official Finishes', owner: pmName, predIds: ['A01'], predText: 'A01', startDay: 3, duration: sc(3, 2), resourceId: 'R01' });
  if (hasMep) {
    pushAct({ id: 'A08', phase: '2. Mobilization & Approvals | التجهيز والاعتمادات', name: 'Prepare coordinated MEP, lighting & AV containment drawings', type: 'Task', boqRef: 'MEP / AV', owner: 'MEP Engineer', predIds: ['A05'], predText: 'A05', startDay: Math.min(4, mobEnd - 2), duration: sc(2, 2), resourceId: 'R07' });
  }
  const approvalPreds = ['A06', 'A07', ...(hasMep ? ['A08'] : [])];
  const approvalStart = Math.max(mobEnd - 1, Math.max(...activities.filter((a) => approvalPreds.includes(a.id)).map((a) => a.endDay)) + 1);
  pushAct({ id: 'A09', phase: '2. Mobilization & Approvals | التجهيز والاعتمادات', name: 'Client formal approval of shop drawings & finish samples (MAS Gate)', type: 'Milestone', boqRef: 'Critical Gate', owner: clientName, predIds: approvalPreds, predText: approvalPreds.join(', '), startDay: Math.min(mobEnd, approvalStart), duration: 2, resourceId: 'R01' });

  const gateEnd = activities.find((a) => a.id === 'A09').endDay;
  const workStart = Math.max(fabStart, gateEnd + 1);

  // Phase 3: Off-Site Fabrication & Procurement
  const fabGroupIds = [];
  const offIdsByKey = {};
  if (hasJoinery) {
    pushAct({ id: 'A10', phase: '3. Off-Site Manufacturing & Procurement | التصنيع والتوريد', name: 'Factory fabrication of custom joinery, counters & millwork (80% EV)', type: 'Task', boqRef: 'Joinery', owner: 'Joinery Factory', predIds: ['A09'], predText: 'A09', startDay: workStart, duration: fabDurJoinery, resourceId: 'R04' });
    fabGroupIds.push('A10');
    offIdsByKey.joinery = 'A10';
  }
  if (hasFfe) {
    pushAct({ id: 'A11', phase: '3. Off-Site Manufacturing & Procurement | التصنيع والتوريد', name: 'Procure & manufacture contract loose furniture (FF&E) orders (80% EV)', type: 'Task', boqRef: 'Loose FF&E', owner: 'FF&E Supplier', predIds: ['A09'], predText: 'A09', startDay: workStart, duration: fabDurFfe, resourceId: 'R05' });
    fabGroupIds.push('A11');
    offIdsByKey.furniture = 'A11';
  }
  if (hasSignage || hasSanitary) {
    pushAct({ id: 'A12', phase: '3. Off-Site Manufacturing & Procurement | التصنيع والتوريد', name: 'Fabricate 3D branding signage, AV displays & sanitary procurements (80% EV)', type: 'Task', boqRef: 'Signage/AV/Sanitary', owner: 'Signage / MEP Supply', predIds: ['A09'], predText: 'A09', startDay: workStart, duration: fabDurSign, resourceId: 'R06' });
    fabGroupIds.push('A12');
    if (hasSignage) offIdsByKey.signage = 'A12';
    if (hasSanitary) offIdsByKey.sanitary = 'A12';
  }
  const fabFinishDay = fabGroupIds.length ? Math.max(...activities.filter((a) => fabGroupIds.includes(a.id)).map((a) => a.endDay)) : workStart + 10;
  if (fabGroupIds.length) {
    pushAct({ id: 'A14', phase: '3. Off-Site Manufacturing & Procurement | التصنيع والتوريد', name: 'Factory QC inspection (MIR) & fabrication completion (20% Payment trigger)', type: 'Milestone', boqRef: 'MIR / 20%', owner: pmName, predIds: [...fabGroupIds], predText: fabGroupIds.join(', '), startDay: fabFinishDay + 1, duration: 1, resourceId: 'R04' });
  }

  // Phase 4: On-Site Fit-Out & MEP Execution
  const siteIdsByKey = {};
  let siteCursor = Math.max(mobEnd + 1, workStart);
  let lastSitePred = ['A04'];
  if (hasPartitions) {
    const d = sc(5, 3);
    pushAct({ id: 'A15', phase: '4. On-Site Fit-Out Works | أعمال الموقع', name: 'Erect drywall partitions & acoustic glass partition frames', type: 'Task', boqRef: 'Partitions', owner: 'Site Fit-Out Team', predIds: ['A04', 'A09'], predText: 'A04, A09', startDay: siteCursor, duration: d, resourceId: 'R02' });
    siteIdsByKey.partitions = 'A15';
    siteCursor += Math.max(2, Math.floor(d * 0.7));
    lastSitePred = ['A15'];
  }
  if (hasMep) {
    const d = sc(6, 3);
    const preds = hasPartitions ? ['A15', 'A08'] : ['A04', 'A08'];
    pushAct({ id: 'A17', phase: '4. On-Site Fit-Out Works | أعمال الموقع', name: 'MEP first-fix conduits, power points, data & lighting wiring', type: 'Task', boqRef: 'MEP', owner: 'MEP Team', predIds: preds, predText: preds.join(', '), startDay: siteCursor, duration: d, resourceId: 'R07' });
    siteIdsByKey.mep = 'A17';
    siteCursor += d;
    pushAct({ id: 'A18', phase: '4. On-Site Fit-Out Works | أعمال الموقع', name: 'Consultant / Landlord MEP concealment inspection (WIR)', type: 'Milestone', boqRef: 'WIR-MEP', owner: 'Landlord / Consultant', predIds: ['A17'], predText: 'A17', startDay: siteCursor, duration: 1, resourceId: 'R10' });
    siteCursor += 1;
    lastSitePred = ['A18'];
  }
  if (hasCeiling) {
    const d = sc(4, 2);
    pushAct({ id: 'A19', phase: '4. On-Site Fit-Out Works | أعمال الموقع', name: 'Install suspended gypsum/acoustic ceiling grid & closure', type: 'Task', boqRef: 'Ceiling', owner: 'Site Fit-Out Team', predIds: lastSitePred, predText: lastSitePred.join(', '), startDay: siteCursor, duration: d, resourceId: 'R02' });
    siteIdsByKey.ceiling = 'A19';
    siteCursor += d;
    lastSitePred = ['A19'];
  }
  if (hasPaint) {
    const d = sc(5, 3);
    pushAct({ id: 'A21', phase: '4. On-Site Fit-Out Works | أعمال الموقع', name: 'Surface prep, skim coat, primer & 2 finish paint coats (10% Paint milestone)', type: 'Task', boqRef: 'Painting', owner: 'Painting Crew', predIds: lastSitePred, predText: lastSitePred.join(', '), startDay: siteCursor, duration: d, resourceId: 'R08' });
    siteIdsByKey.paint = 'A21';
    siteCursor += d;
    lastSitePred = ['A21'];
  }
  if (hasFlooring) {
    const d = sc(4, 2);
    pushAct({ id: 'A22P', phase: '4. On-Site Fit-Out Works | أعمال الموقع', name: 'Floor leveling screed, porcelain/carpet laying & skirting installation', type: 'Task', boqRef: 'Flooring', owner: 'Flooring Crew', predIds: lastSitePred, predText: lastSitePred.join(', '), startDay: siteCursor, duration: d, resourceId: 'R02' });
    siteIdsByKey.flooring = 'A22P';
    siteCursor += d;
    lastSitePred = ['A22P'];
  }
  if (hasDoors) {
    const d = sc(3, 2);
    pushAct({ id: 'A22D', phase: '4. On-Site Fit-Out Works | أعمال الموقع', name: 'Hang door frames, architectural leaves & ironmongery', type: 'Task', boqRef: 'Doors', owner: 'Carpentry Crew', predIds: lastSitePred, predText: lastSitePred.join(', '), startDay: Math.max(siteCursor - 1, mobEnd + 2), duration: d, resourceId: 'R09' });
    siteIdsByKey.doors = 'A22D';
    siteCursor += Math.max(1, d - 1);
    lastSitePred = ['A22D'];
  }

  // Fit contract tail cleanly inside `durationDays`
  const tailBudget = sc(12, 8);
  const payStart = Math.min(durationDays - tailBudget, Math.max(fabGroupIds.length ? fabFinishDay + 2 : workStart + 8, siteCursor));
  const payDur = sc(3, 2);

  // Phase 5: Milestone Billing & Delivery Logistics
  if (hasOffsite) {
    const payPreds = [fabGroupIds.length ? 'A14' : 'A09'];
    pushAct({ id: 'A22', phase: '5. Payment & Delivery | السداد والتوريد', name: 'Invoice & clear 20% pre-delivery milestone payment (<= 5d SLA)', type: 'Task', boqRef: 'Payment 20%', owner: `${clientName} Finance`, predIds: payPreds, predText: payPreds.join(', '), startDay: payStart, duration: payDur, resourceId: 'R11' });
    pushAct({ id: 'A23', phase: '5. Payment & Delivery | السداد والتوريد', name: 'Coordinate loading bay schedule & mall delivery permits (DN)', type: 'Task', boqRef: 'Delivery Note', owner: pmName, predIds: ['A22'], predText: 'A22', startDay: payStart + payDur, duration: sc(2, 1), resourceId: 'R10' });
  }

  // Phase 6: Site Installation & Final Hookup
  const instStart = hasOffsite ? activities.find((a) => a.id === 'A23').endDay + 1 : Math.max(siteCursor, durationDays - 7);
  const remainToHandover = Math.max(5, durationDays - instStart + 1);
  const ffeInstDur = Math.max(2, Math.round(remainToHandover * 0.45));
  const instPreds = hasOffsite ? ['A23', ...lastSitePred] : lastSitePred;
  pushAct({ id: 'A24', phase: '6. Site Installation | التركيب والتشطيب النهائي', name: 'Deliver & install loose FF&E, custom joinery & lightboxes on site (20% EV)', type: 'Task', boqRef: 'FF&E & Joinery', owner: 'Site Installation Team', predIds: [...new Set(instPreds)], predText: [...new Set(instPreds)].join(', '), startDay: instStart, duration: ffeInstDur, resourceId: 'R09' });

  const hookStart = Math.max(instStart + 1, activities.find((a) => a.id === 'A24').endDay - 1);
  const hookDur = Math.max(2, sc(3, 2));
  pushAct({ id: 'A25', phase: '6. Site Installation | التركيب والتشطيب النهائي', name: 'Final MEP trim, signage/AV hookup & sanitary commissioning', type: 'Task', boqRef: 'MEP/AV/Sanitary', owner: 'MEP & Signage Teams', predIds: ['A24'], predText: 'A24 (SS/Overlap)', startDay: Math.min(durationDays - 4, hookStart), duration: hookDur, resourceId: 'R07' });

  // Phase 7: Testing, Inspections, Snagging & Handover
  const testDay = Math.min(durationDays - 3, activities.find((a) => a.id === 'A25').endDay + 1);
  pushAct({ id: 'A26', phase: '7. Testing & Handover | التشغيل والتسليم', name: 'Test & commission all lighting, AV displays, power & HVAC interfaces', type: 'Task', boqRef: 'Commissioning', owner: 'MEP Engineer', predIds: ['A25'], predText: 'A25', startDay: testDay, duration: 1, resourceId: 'R07' });
  const snagStart = Math.min(durationDays - 2, testDay + 1);
  pushAct({ id: 'A27', phase: '7. Testing & Handover | التشغيل والتسليم', name: 'Pre-handover joint inspection with Landlord / Client Representative', type: 'Milestone', boqRef: 'Final WIR', owner: 'Landlord / Consultant', predIds: ['A26'], predText: 'A26', startDay: snagStart, duration: 1, resourceId: 'R10' });
  pushAct({ id: 'A28', phase: '7. Testing & Handover | التشغيل والتسليم', name: 'Complete Snag List rectification & deep cleaning', type: 'Task', boqRef: 'Snagging', owner: 'Site Supervisor', predIds: ['A27'], predText: 'A27', startDay: snagStart, duration: Math.max(1, durationDays - snagStart), resourceId: 'R02' });
  pushAct({ id: 'A29', phase: '7. Testing & Handover | التشغيل والتسليم', name: 'Final Handover & Sign-Off Certificate (10% Final Payment trigger)', type: 'Milestone', boqRef: 'Handover 10%', owner: `${clientName} + ${contractorName}`, predIds: ['A28'], predText: 'A28', startDay: durationDays, duration: 1, resourceId: 'R01' });

  // Reconcile 100% of Net BOQ BAC into WBS allocations
  const wbsItems = lines.map((l, idx) => {
    const tk = l.trade.key;
    let execActId = 'A00';
    let installActId = '';
    let execWeight = 1;
    if (l.trade.evMode === 'fab' && offIdsByKey[tk]) {
      execActId = offIdsByKey[tk];
      installActId = 'A24';
      execWeight = 0.8;
    } else if (siteIdsByKey[tk]) {
      execActId = siteIdsByKey[tk];
      installActId = '';
      execWeight = 1;
    } else if (tk === 'prelims') {
      execActId = 'A00';
      installActId = '';
      execWeight = 1;
    } else {
      execActId = 'A24';
      installActId = '';
      execWeight = 1;
    }
    const allocExec = r3(l.amount * execWeight);
    const allocInst = r3(l.amount - allocExec);
    return {
      wbsCode: `WBS ${idx + 1}.${l.sn}`,
      ...l,
      execActId,
      installActId,
      execWeight,
      allocExec,
      allocInst,
    };
  });

  const actMap = new Map(activities.map((a) => [a.id, a]));
  activities.forEach((a) => { a.allocatedBac = 0; });
  wbsItems.forEach((w) => {
    if (actMap.has(w.execActId)) actMap.get(w.execActId).allocatedBac = r3(actMap.get(w.execActId).allocatedBac + w.allocExec);
    if (w.installActId && actMap.has(w.installActId)) actMap.get(w.installActId).allocatedBac = r3(actMap.get(w.installActId).allocatedBac + w.allocInst);
  });

  // Payment milestones (60 / 20 / 10 / 10)
  const midSiteDay = activities.find((a) => a.id === 'A21')?.endDay || activities.find((a) => a.id === 'A18')?.endDay || Math.round(durationDays * 0.52);
  const facDoneDay = activities.find((a) => a.id === 'A14')?.endDay || Math.round(durationDays * 0.62);
  const payments = [
    { id: 1, title: 'Advance Payment (60%) | الدفعة المقدمة', share: 0.6, amount: r2(grossTotal * 0.6), actId: 'A01', day: 1 },
    { id: 2, title: 'Off-Site Manufacturing Complete / MIR (20%) | اكتمال التصنيع', share: 0.2, amount: r2(grossTotal * 0.2), actId: activities.some((a) => a.id === 'A14') ? 'A14' : 'A09', day: facDoneDay },
    { id: 3, title: 'Mid-Fitout / Wall & Ceiling Milestone (10%) | أعمال الموقع', share: 0.1, amount: r2(grossTotal * 0.1), actId: activities.some((a) => a.id === 'A21') ? 'A21' : 'A24', day: midSiteDay },
    { id: 4, title: 'Final Handover & Snag Closure (10%) | التسليم النهائي', share: 0.1, amount: r2(grossTotal - r2(grossTotal * 0.6) - r2(grossTotal * 0.2) - r2(grossTotal * 0.1)), actId: 'A29', day: durationDays },
  ];

  // Action Items (1:1 mirror of activities)
  const actionItems = activities.map((a, idx) => ({
    id: idx + 1,
    actId: a.id,
    action: a.name,
    owner: a.owner,
    dateAssigned: ISO_DATE(ADD_DAYS(startDate, a.startDay - 1)),
    dueDate: ISO_DATE(ADD_DAYS(startDate, a.endDay - 1)),
    priority: a.type === 'Milestone' || a.id === 'A09' || a.id === 'A10' || a.id === 'A24' || a.id === 'A25' ? 'High' : 'Medium',
    status: 'Not Started',
    pctComplete: 0,
    notes: `${a.boqRef}${a.predText && a.predText !== '-' ? ` | Pred: ${a.predText}` : ''}`,
    startDay: a.startDay,
    duration: a.duration,
  }));

  // Deliverables & Submittals
  const deliverables = [
    { id: 'D01', title: '60% Advance Payment Confirmation', type: 'Financial', actId: 'A01', from: clientName, to: contractorName, note: 'Triggers contract day 1' },
    { id: 'D02', title: 'CAR Insurance Policy & HSE Plan', type: 'Document', actId: 'A02', from: contractorName, to: 'Landlord / Client', note: 'Required prior to site access' },
    { id: 'D03', title: 'Landlord Work Permit Application Pack', type: 'Permit', actId: 'A03', from: contractorName, to: 'Landlord', note: '' },
    { id: 'D04', title: 'Signed Site Handover & Work Permit', type: 'Permit', actId: 'A04', from: 'Landlord', to: contractorName, note: 'Delay entitles EOT' },
    { id: 'D05', title: 'Site Laser Survey & As-Built Report', type: 'Technical', actId: 'A05', from: contractorName, to: clientName, note: '' },
    { id: 'D06', title: 'Full Execution Shop Drawings', type: 'Drawings', actId: 'A06', from: contractorName, to: clientName, note: '' },
    { id: 'D07', title: 'Material Approval Sheets (MAS) + Official Brand Finish Swatches', type: 'MAS Samples', actId: 'A07', from: contractorName, to: clientName, note: 'All veneers, fabrics, Corian & paints' },
    ...(hasMep ? [{ id: 'D08', title: 'MEP, Lighting & AV Containment Shop Drawings', type: 'Drawings', actId: 'A08', from: contractorName, to: `${clientName} / Landlord`, note: '' }] : []),
    { id: 'D09', title: 'Client Formal Design & Finish Sign-Off', type: 'Approval', actId: 'A09', from: clientName, to: contractorName, note: 'Critical Path Gate' },
    ...(hasMep ? [{ id: 'D10', title: 'Work Inspection Request (WIR) — MEP First-Fix', type: 'WIR Inspection', actId: 'A18', from: 'Landlord / Consultant', to: contractorName, note: '' }] : []),
    ...(hasPaint ? [{ id: 'D11', title: 'Wall & Ceiling Paint WIR + 10% Interim Invoice', type: 'WIR / Financial', actId: 'A21', from: contractorName, to: clientName, note: '' }] : []),
    ...(activities.some((a) => a.id === 'A14') ? [{ id: 'D12', title: 'Factory Material Inspection Report (MIR) + 20% Invoice', type: 'MIR / Financial', actId: 'A14', from: contractorName, to: clientName, note: 'Pre-dispatch release' }] : []),
    ...(hasOffsite ? [{ id: 'D13', title: 'Delivery Note (DN) & Site Material Gate Pass', type: 'Delivery Note', actId: 'A23', from: contractorName, to: 'Landlord', note: '' }] : []),
    { id: 'D14', title: 'FF&E, Joinery & Signage Installed Inspection (WIR)', type: 'Product', actId: 'A24', from: contractorName, to: clientName, note: '' },
    { id: 'D15', title: 'MEP/AV Testing & Commissioning Report', type: 'Commissioning', actId: 'A26', from: contractorName, to: clientName, note: '' },
    { id: 'D16', title: 'Snag List Closure Sign-Off', type: 'QA/QC', actId: 'A28', from: contractorName, to: clientName, note: '' },
    { id: 'D17', title: 'Final Handover Certificate & 10% Final Invoice', type: 'Handover / Financial', actId: 'A29', from: contractorName, to: clientName, note: '' },
  ];

  // Active Resources
  const catalogResources = [
    { id: 'R01', name: 'Project Manager | مدير المشروع', type: 'Staff', org: contractorName, role: 'Overall control, permits, CAR & client coordination' },
    { id: 'R02', name: 'Site Supervisor | مشرف الموقع', type: 'Staff', org: contractorName, role: 'Daily site QA/QC, partitions, ceilings & snagging' },
    { id: 'R03', name: 'Technical / CAD Designer | مصمم الرسومات', type: 'Staff', org: contractorName, role: 'As-built survey, shop drawings & schedules' },
    { id: 'R04', name: 'Joinery & Millwork Factory | مصنع الأثاث والنجارة', type: 'Subcontractor', org: 'Approved Workshop', role: 'Bespoke counters, wall units & solid surface fabrication' },
    { id: 'R05', name: 'Contract FF&E Suppliers | موردو الأثاث', type: 'Supplier', org: 'Contract Brands', role: 'Branded chairs, sofas & desks manufacture & delivery' },
    { id: 'R06', name: 'Signage & AV Integrator | مصنع اللوحات والشاشات', type: 'Subcontractor', org: 'Specialist', role: '3D illuminated signage, lightboxes & displays' },
    { id: 'R07', name: 'Licensed MEP Contractor | مقاول الكهرباء', type: 'Subcontractor', org: 'Specialist', role: 'First-fix wiring, lighting, AV power & T&C' },
    { id: 'R08', name: 'Finishing & Painting Crew | فريق الدهانات', type: 'Subcontractor', org: 'Specialist', role: 'Surface prep, skim, primer & finish coats' },
    { id: 'R09', name: 'Site Installation & Carpentry Team | فريق التركيب', type: 'Staff', org: contractorName, role: 'FF&E, joinery & door installation' },
    { id: 'R10', name: 'Landlord / Consultant Coord | إدارة المول والاستشاري', type: 'External', org: 'Landlord', role: 'Work permits, gate passes & WIR inspections' },
    { id: 'R11', name: 'Commercial & Finance | الإدارة المالية', type: 'Staff', org: `${contractorName} / ${clientName}`, role: 'Interim billing, collections & 5d payment SLA' },
  ];
  const usedResIds = new Set(activities.map((a) => a.resourceId));
  const resources = catalogResources
    .filter((r) => usedResIds.has(r.id))
    .map((r) => {
      const assigned = activities.filter((a) => a.resourceId === r.id);
      const boqRefs = [...new Set(assigned.map((a) => a.boqRef))].join(', ');
      return { ...r, boqRefs, actIds: assigned.map((a) => a.id), assigned };
    });

  // Materials register from lines with Official Brand Finishes
  const materials = lines.slice(0, 35).map((l, idx) => ({
    id: `M${String(idx + 1).padStart(2, '0')}`,
    item: l.model || l.description.slice(0, 55),
    boqRef: l.code || l.sn,
    qtyUnit: `${l.qty} ${l.unit}`,
    finishes: l.finishSummary || 'Standard Specification',
    brand: l.brand || 'Specified',
  }));

  // Risks
  const risks = [
    { id: 'R01', risk: 'Delay in site handover or work permit issuance', category: 'External / Landlord', prob: 4, impact: 4, owner: pmName, actId: 'A04', response: 'Submit CAR & permit pack Day 2; invoke contractual EOT immediately if handover slips.' },
    { id: 'R02', risk: 'Client delay in approving shop drawings & finish samples (MAS)', category: 'Client / Contractual', prob: 4, impact: 5, owner: clientName, actId: 'A09', response: 'Enforce 48h review turnaround; split approvals by trade package.' },
    { id: 'R03', risk: 'Delayed interim payment (> 5 days) halting factory dispatch', category: 'Financial', prob: 3, impact: 4, owner: `${clientName} Finance`, actId: 'A22', response: 'Issue MIR + invoice 48h before factory completion; contractual EOT clause on late payment.' },
    { id: 'R04', risk: `Off-site joinery/FF&E manufacturing exceeding ${fabDurJoinery} days`, category: 'Supply Chain', prob: 3, impact: 5, owner: 'Joinery / FF&E Lead', actId: offIdsByKey.joinery || offIdsByKey.furniture || 'A24', response: 'Weekly factory progress audits at 50% & 80% plus early raw material booking.' },
    { id: 'R05', risk: 'Landlord MEP / safety inspection rejections (WIR)', category: 'Technical / HSE', prob: 3, impact: 4, owner: 'MEP Engineer', actId: hasMep ? 'A18' : 'A27', response: 'Pre-inspect internally 24h before landlord walkthrough using checklist.' },
    { id: 'R06', risk: 'As-built site dimensions differ after strip-out / demolition', category: 'Technical', prob: 3, impact: 3, owner: 'Technical Designer', actId: 'A05', response: 'Laser scan & Design & Build 3D verification prior to cutting CNC joinery.' },
    { id: 'R07', risk: 'Official brand finish lead-time / batch colour variation', category: 'Quality', prob: 2, impact: 4, owner: pmName, actId: 'A07', response: 'Lock approved batch codes (Fenix/Kvadrat/Jotun/Eggers) on MAS sign-off.' },
    { id: 'R08', risk: 'Trade congestion during final installation & snag window', category: 'Schedule', prob: 4, impact: 3, owner: 'Site Supervisor', actId: 'A24', response: 'Sequence night/day shift zones & clear corridors prior to FF&E delivery.' },
  ];

  const stakeholders = [
    { id: 'S01', name: `${clientName} (Client / Owner)`, role: 'Design Approver & Funder', power: 5, interest: 5, strategy: 'Manage Closely' },
    { id: 'S02', name: `${contractorName} (Main Contractor)`, role: 'End-to-End Turnkey Delivery', power: 5, interest: 5, strategy: 'Manage Closely' },
    { id: 'S03', name: 'Landlord / Mall / Building Management', role: 'Permits, Access & Final WIR', power: 5, interest: 3, strategy: 'Keep Satisfied' },
    { id: 'S04', name: 'Joinery & FF&E Manufacturers', role: 'Off-Site Fabrication & Delivery', power: 3, interest: 4, strategy: 'Keep Informed' },
    { id: 'S05', name: 'Licensed MEP & AV Contractors', role: 'Services, Signage & Testing', power: 3, interest: 4, strategy: 'Keep Informed' },
    { id: 'S06', name: `${clientName} Finance Department`, role: '60/20/10/10 Milestone Payments', power: 4, interest: 3, strategy: 'Keep Satisfied' },
  ];

  // Daily Planned Value Curve (for S-Curve)
  const sCurve = [];
  let cumPv = 0;
  for (let day = 1; day <= durationDays + 15; day++) {
    let dayPv = 0;
    if (day <= durationDays) {
      for (const a of activities) {
        if (day >= a.startDay && day <= a.endDay && a.allocatedBac > 0) {
          dayPv += a.allocatedBac / Math.max(1, a.duration);
        }
      }
    }
    cumPv = Math.min(netTotal, cumPv + dayPv);
    let cumBilling = 0;
    payments.forEach((p) => { if (day >= p.day) cumBilling += p.amount; });
    sCurve.push({
      day,
      date: ISO_DATE(ADD_DAYS(startDate, day - 1)),
      dailyPv: r2(dayPv),
      cumPv: r2(cumPv),
      pctWork: netTotal > 0 ? r3(cumPv / netTotal) : 0,
      cumBilling: r2(cumBilling),
      pctBilling: grossTotal > 0 ? r3(cumBilling / grossTotal) : 0,
    });
  }

  return {
    meta: {
      title: projectTitle,
      client: clientName,
      contractor: contractorName,
      pm: pmName,
      location: String(project.locationZone || 'Project Site').trim(),
      projectNumber: String(project.projectNumber || 'PRJ-2026').trim(),
      currency,
      vatPct,
      vatRate,
      netTotal,
      grossTotal,
      durationDays,
      scaleTier,
      floorSqm: r2(floorSqm),
      startDate,
      finishDate,
      startDateIso: ISO_DATE(startDate),
      finishDateIso: ISO_DATE(finishDate),
    },
    wbsItems,
    activities,
    actionItems,
    deliverables,
    resources,
    materials,
    payments,
    risks,
    stakeholders,
    sCurve,
  };
}

/**
 * Generates the complete 10-sheet formula-driven Excel Control Workbook (.xlsx Blob).
 */
export async function buildProjectPlanExcel(plan) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = plan.meta.contractor;
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  const NAVY = 'FF0F172A';
  const BLUE = 'FF1D4ED8';
  const SLATE = 'FF334155';
  const SOFT = 'FFF1F5F9';
  const INPUT_BG = 'FFFEF9C3';
  const GANTT_BAR = 'FF2563EB';
  const MILESTONE_BAR = 'FFD97706';
  const BORDER_CLR = 'FFCBD5E1';

  const styleHdr = (row, bg = NAVY) => {
    row.eachCell((cell) => {
      cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: BORDER_CLR } } };
    });
    row.height = 26;
  };
  const styleBanner = (ws, title, subtitle, cols = 10) => {
    ws.mergeCells(1, 1, 1, cols);
    ws.getCell(1, 1).value = title;
    ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    ws.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    ws.getCell(1, 1).alignment = { vertical: 'middle', indent: 1 };
    ws.getRow(1).height = 28;
    ws.mergeCells(2, 1, 2, cols);
    ws.getCell(2, 1).value = subtitle;
    ws.getCell(2, 1).font = { size: 10, color: { argb: SLATE } };
    ws.getRow(2).height = 20;
  };

  // ── 1. Dashboard (named cells anchor StartDate / ProjDur / StatusDay)
  const wsDash = wb.addWorksheet('Dashboard | لوحة المعلومات', { properties: { tabColor: { argb: NAVY } } });
  styleBanner(wsDash, `${plan.meta.title} — Executive Project Control Dashboard`, `${plan.meta.scaleTier} · ${plan.meta.durationDays} Calendar Days · Client: ${plan.meta.client} · Contractor: ${plan.meta.contractor}`, 10);

  wsDash.getRow(4).values = ['Contract Parameter', 'Value', 'Notes', '', 'Schedule Assumption', 'Value', 'Formula / Unit'];
  styleHdr(wsDash.getRow(4), SLATE);

  const actLastRow = 5 + plan.activities.length;
  const wbsLastRow = 5 + plan.wbsItems.length;
  const delivLastRow = 4 + plan.deliverables.length;
  const riskLastRow = 4 + plan.risks.length;

  wsDash.getRow(5).values = ['Project Name', plan.meta.title, plan.meta.projectNumber, '', 'Baseline Start Date', plan.meta.startDate, 'YYYY-MM-DD (Editable)'];
  wsDash.getRow(6).values = ['Client / Owner', plan.meta.client, plan.meta.location, '', 'Status Date (Report)', new Date(), '=TODAY() editable'];
  wsDash.getRow(7).values = [`Net Contract Value (${plan.meta.currency})`, { formula: `='Scope & WBS'!J${wbsLastRow + 1}` }, 'Excl. VAT', '', 'Contract Duration (Days)', plan.meta.durationDays, 'Auto-scaled to BOQ'];
  wsDash.getRow(8).values = [`VAT (${plan.meta.vatPct}%)`, { formula: `=B7*${plan.meta.vatRate}` }, 'GCC Standard', '', 'Planned Finish Date', { formula: '=F5+F7-1' }, 'Auto-calculated'];
  wsDash.getRow(9).values = [`Gross Contract Total (${plan.meta.currency})`, { formula: '=B7+B8' }, '100% Contract Value', '', 'Current Project Day', { formula: '=MAX(0,MIN(F7,F6-F5+1))' }, 'Elapsed days'];

  [wsDash.getCell('F5'), wsDash.getCell('F6'), wsDash.getCell('F7')].forEach((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT_BG } };
    c.font = { bold: true, color: { argb: BLUE } };
  });
  wsDash.getCell('F5').numFmt = 'yyyy-mm-dd';
  wsDash.getCell('F6').numFmt = 'yyyy-mm-dd';
  wsDash.getCell('F8').numFmt = 'yyyy-mm-dd';
  [wsDash.getCell('B7'), wsDash.getCell('B8'), wsDash.getCell('B9')].forEach((c) => { c.numFmt = '#,##0.00'; c.font = { bold: true }; });

  wsDash.getRow(11).values = ['EVM KPI', 'Value', 'Description', '', 'Operations KPI', 'Value', 'Target'];
  styleHdr(wsDash.getRow(11), BLUE);
  wsDash.getRow(12).values = [
    'Actual Weighted Progress %', { formula: `='Schedule & Gantt'!P${actLastRow + 1}` }, 'Value-weighted completion',
    '', 'Activities Completed', { formula: `=COUNTIF('Schedule & Gantt'!R6:R${actLastRow},"Completed")` }, `of ${plan.activities.length}`,
  ];
  wsDash.getRow(13).values = [
    'Planned Progress % (PV/BAC)', { formula: `=IF(B7=0,0,B15/B7)` }, 'Baseline S-curve at Status Date',
    '', 'Activities Delayed', { formula: `=COUNTIF('Schedule & Gantt'!R6:R${actLastRow},"Delayed")` }, '0 Target',
  ];
  wsDash.getRow(14).values = [
    'Schedule Performance Index (SPI)', { formula: '=IF(B15=0,1,B16/B15)' }, '>= 1.00 On Schedule',
    '', 'Deliverables Approved', { formula: `=COUNTIF(Deliverables!K5:K${delivLastRow},"Done")` }, `of ${plan.deliverables.length}`,
  ];
  wsDash.getRow(15).values = [
    'Planned Value PV', { formula: `='Schedule & Gantt'!T${actLastRow + 1}` }, 'Earned target by Status Date',
    '', 'Open High Risks (>=15)', { formula: `=COUNTIFS(Risks!I5:I${riskLastRow},"High",Risks!M5:M${riskLastRow},"Open")` }, 'Mitigate Priority',
  ];
  wsDash.getRow(16).values = [
    'Earned Value EV', { formula: `='Schedule & Gantt'!U${actLastRow + 1}` }, 'Value earned to date',
    '', 'Total Cash Collected', { formula: `='Cost, EV & S-Curve'!K${plan.wbsItems.length + 14}` }, `of ${r2(plan.meta.grossTotal)}`,
  ];
  wsDash.getCell('B12').numFmt = '0.0%';
  wsDash.getCell('B13').numFmt = '0.0%';
  wsDash.getCell('B14').numFmt = '0.00';
  wsDash.getCell('B15').numFmt = '#,##0.00';
  wsDash.getCell('B16').numFmt = '#,##0.00';
  wsDash.getCell('F16').numFmt = '#,##0.00';
  [22, 18, 28, 4, 28, 16, 22].forEach((w, i) => { wsDash.getColumn(i + 1).width = w; });

  // ── 2. Action Plan
  const wsAct = wb.addWorksheet('Action Plan | خطة العمل', { properties: { tabColor: { argb: BLUE } } });
  styleBanner(wsAct, `Project Action Tracker | خطة العمل التنفيذية (${plan.meta.title})`, 'Daily/weekly execution checklist tied 1:1 to Master Gantt activities', 10);
  wsAct.getRow(4).values = ['ID', 'Done', 'Action / النشاط', 'Owner / المسؤول', 'Start Date', 'Due Date', 'Priority', 'Status', '% Complete', 'Notes / BOQ & Predecessors'];
  styleHdr(wsAct.getRow(4));
  plan.actionItems.forEach((it, idx) => {
    const r = 5 + idx;
    const row = wsAct.getRow(r);
    row.values = [
      it.id,
      '',
      it.action,
      it.owner,
      { formula: `='Schedule & Gantt'!K${6 + idx}` },
      { formula: `='Schedule & Gantt'!L${6 + idx}` },
      it.priority,
      { formula: `='Schedule & Gantt'!R${6 + idx}` },
      { formula: `='Schedule & Gantt'!P${6 + idx}` },
      it.notes,
    ];
    row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT_BG } };
    row.getCell(5).numFmt = 'yyyy-mm-dd';
    row.getCell(6).numFmt = 'yyyy-mm-dd';
    row.getCell(9).numFmt = '0%';
    row.height = 22;
  });
  [6, 7, 52, 22, 13, 13, 11, 13, 12, 34].forEach((w, i) => { wsAct.getColumn(i + 1).width = w; });

  // ── 3. Instructions
  const wsInst = wb.addWorksheet('Instructions | تعليمات');
  styleBanner(wsInst, 'Operating Guide & EVM Assumptions | تعليمات الاستخدام', 'Follow this color legend and 5-step weekly update cadence.', 6);
  [
    ['Color Code', 'Meaning'],
    ['Yellow Fill / Blue Font', 'User editable inputs (Start Date, Actual Start/Duration, % Complete, Invoices, Risk Scores)'],
    ['Black / Formula Font', 'Automated Excel formulas linking Dashboard, Gantt, Cost EV, and Deliverables'],
    ['EVM 80 / 20 Rule', 'Supply & Fabrication BOQ items earn 80% upon factory MIR completion and 20% upon site installation (A24/A25)'],
    ['Scale Tier Detected', `${plan.meta.scaleTier} (${plan.meta.durationDays} days; ${plan.wbsItems.length} BOQ items; Net ${r2(plan.meta.netTotal)} ${plan.meta.currency})`],
  ].forEach((pair, idx) => {
    const row = wsInst.getRow(4 + idx);
    row.values = pair;
    if (idx === 0) styleHdr(row, SLATE);
    row.height = 24;
  });
  wsInst.getColumn(1).width = 28;
  wsInst.getColumn(2).width = 96;

  // ── 4. Scope & WBS
  const wsWbs = wb.addWorksheet('Scope & WBS | نطاق العمل', { properties: { tabColor: { argb: 'FF0F766E' } } });
  styleBanner(wsWbs, 'Project Scope & Work Breakdown Structure (WBS) | الأعمال المطلوبة', 'Mapped 1:1 from active BOQ & Official Brand Finishes to Schedule Activities', 12);
  wsWbs.getRow(4).values = ['WBS', 'BOQ Code', 'Trade Package', 'Item Description & Specification', 'Official Brand Finishes', 'Unit', 'Qty', 'Exec Activity', 'Install Activity', `Net Value (${plan.meta.currency})`, '% Complete', 'Status'];
  styleHdr(wsWbs.getRow(4));
  plan.wbsItems.forEach((w, idx) => {
    const r = 5 + idx;
    const row = wsWbs.getRow(r);
    row.values = [
      w.wbsCode,
      w.code || w.sn,
      w.trade.label,
      w.description,
      w.finishSummary || 'Standard',
      w.unit,
      w.qty,
      w.execActId,
      w.installActId || '-',
      w.amount,
      { formula: `=IF(J${r}=0,0,'Cost, EV & S-Curve'!O${7 + idx}/J${r})` },
      { formula: `=IF(K${r}>=0.99,"Completed",IF(K${r}>0,"In Progress","Not Started"))` },
    ];
    row.getCell(10).numFmt = '#,##0.00';
    row.getCell(11).numFmt = '0%';
    row.height = 24;
  });
  const wbsTot = wsWbs.getRow(wbsLastRow + 1);
  wbsTot.values = ['Total Net Value (BAC)', '', '', '', '', '', '', '', '', { formula: `=SUM(J5:J${wbsLastRow})` }, { formula: `=IF(J${wbsLastRow + 1}=0,0,'Cost, EV & S-Curve'!O${6 + plan.wbsItems.length + 1}/J${wbsLastRow + 1})` }, ''];
  wbsTot.font = { bold: true };
  wbsTot.getCell(10).numFmt = '#,##0.00';
  wbsTot.getCell(11).numFmt = '0%';
  [12, 13, 28, 44, 34, 8, 9, 13, 13, 16, 12, 14].forEach((w, i) => { wsWbs.getColumn(i + 1).width = w; });

  // ── 5. Schedule & Gantt (Calendar Visual Grid)
  const totalGanttDays = plan.meta.durationDays + 15;
  const wsSch = wb.addWorksheet('Schedule & Gantt | مخطط جانت', { properties: { tabColor: { argb: GANTT_BAR } } });
  styleBanner(wsSch, `Master CPM Schedule & Gantt Chart | الجدول الزمني (${plan.meta.durationDays} Days)`, 'Blue/yellow cells accept weekly progress inputs; Gantt bars & EV update live.', 21 + totalGanttDays);

  const schHdr = [
    'ID', 'Phase', 'Activity / النشاط', 'Type', 'BOQ Ref', 'Owner', 'Predecessors',
    'Plan Start (d)', 'Plan Dur (d)', 'Plan End (d)', 'Start Date', 'End Date',
    'Act Start (d)', 'Act Dur (d)', 'Forecast End (d)', '% Complete', 'Planned %', 'Status',
    `BAC (${plan.meta.currency})`, 'Planned PV', 'Earned EV',
    ...Array.from({ length: totalGanttDays }, (_, i) => i + 1),
  ];
  wsSch.getRow(4).values = schHdr;
  styleHdr(wsSch.getRow(4));

  const dateRow = wsSch.getRow(5);
  dateRow.getCell(1).value = 'Calendar →';
  for (let d = 1; d <= totalGanttDays; d++) {
    const c = dateRow.getCell(21 + d);
    c.value = { formula: `='Dashboard | لوحة المعلومات'!$F$5+${d - 1}` };
    c.numFmt = 'dd/mm';
    c.font = { size: 7.5, color: { argb: SLATE } };
    c.alignment = { horizontal: 'center' };
  }

  const costEndRow = 6 + plan.wbsItems.length;
  plan.activities.forEach((a, idx) => {
    const r = 6 + idx;
    const row = wsSch.getRow(r);
    row.values = [
      a.id,
      a.phase,
      a.name,
      a.type,
      a.boqRef,
      a.owner,
      a.predText,
      a.startDay,
      a.duration,
      { formula: `=H${r}+I${r}-1` },
      { formula: `='Dashboard | لوحة المعلومات'!$F$5+H${r}-1` },
      { formula: `='Dashboard | لوحة المعلومات'!$F$5+J${r}-1` },
      '',
      '',
      { formula: `=IF(M${r}="",J${r},M${r}+IF(N${r}="",I${r},N${r})-1)` },
      0,
      { formula: `=MAX(0,MIN(1,('Dashboard | لوحة المعلومات'!$F$9-H${r}+1)/I${r}))` },
      { formula: `=IF(P${r}>=1,"Completed",IF(OR(Q${r}>P${r}+0.0001,O${r}>J${r}),"Delayed",IF(P${r}>0,"In Progress","Not Started")))` },
      { formula: `=SUMIFS('Cost, EV & S-Curve'!$K$7:$K$${costEndRow},'Cost, EV & S-Curve'!$H$7:$H$${costEndRow},A${r})+SUMIFS('Cost, EV & S-Curve'!$L$7:$L$${costEndRow},'Cost, EV & S-Curve'!$I$7:$I$${costEndRow},A${r})` },
      { formula: `=S${r}*Q${r}` },
      { formula: `=S${r}*P${r}` },
    ];
    row.getCell(11).numFmt = 'yyyy-mm-dd';
    row.getCell(12).numFmt = 'yyyy-mm-dd';
    [13, 14, 16].forEach((ci) => {
      row.getCell(ci).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT_BG } };
      row.getCell(ci).font = { color: { argb: BLUE }, bold: true };
    });
    row.getCell(16).numFmt = '0%';
    row.getCell(17).numFmt = '0%';
    [19, 20, 21].forEach((ci) => { row.getCell(ci).numFmt = '#,##0.00'; });

    for (let d = 1; d <= totalGanttDays; d++) {
      if (d >= a.startDay && d <= a.endDay) {
        const gCell = row.getCell(21 + d);
        gCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: a.type === 'Milestone' ? MILESTONE_BAR : GANTT_BAR } };
        gCell.value = a.type === 'Milestone' ? '◆' : '';
        gCell.font = { size: 9, color: { argb: 'FFFFFFFF' } };
        gCell.alignment = { horizontal: 'center', vertical: 'middle' };
      }
    }
    row.height = 20;
  });

  const schTot = wsSch.getRow(actLastRow + 1);
  schTot.values = [
    'TOTAL', '', 'Master Schedule Weighted Totals', '', '', '', '', '', plan.meta.durationDays, '', '', '', '', '',
    { formula: `=MAX(O6:O${actLastRow})` },
    { formula: `=IF(S${actLastRow + 1}=0,0,U${actLastRow + 1}/S${actLastRow + 1})` },
    { formula: `=IF(S${actLastRow + 1}=0,0,T${actLastRow + 1}/S${actLastRow + 1})` },
    '',
    { formula: `=SUM(S6:S${actLastRow})` },
    { formula: `=SUM(T6:T${actLastRow})` },
    { formula: `=SUM(U6:U${actLastRow})` },
  ];
  schTot.font = { bold: true };
  schTot.getCell(16).numFmt = '0.0%';
  schTot.getCell(17).numFmt = '0.0%';
  [19, 20, 21].forEach((ci) => { schTot.getCell(ci).numFmt = '#,##0.00'; });
  [7, 26, 46, 10, 15, 20, 15, 10, 10, 10, 12, 12, 10, 10, 12, 10, 10, 13, 14, 13, 13].forEach((w, i) => { wsSch.getColumn(i + 1).width = w; });
  for (let d = 1; d <= totalGanttDays; d++) wsSch.getColumn(21 + d).width = 3.2;

  // ── 6. Deliverables & Submittals
  const wsDel = wb.addWorksheet('Deliverables | التسليمات');
  styleBanner(wsDel, 'Submittals & Deliverables Register (MAS / MIR / WIR / DN) | سجل التسليمات', 'Planned due dates auto-sync with Master Gantt activities.', 12);
  wsDel.getRow(4).values = ['ID', 'Deliverable / التسليم', 'Type', 'Activity', 'Submitted By', 'Approved By', 'Plan Day', 'Plan Date', 'Actual Date', 'Approval Status', 'Status Flag', 'Notes'];
  styleHdr(wsDel.getRow(4));
  plan.deliverables.forEach((d, idx) => {
    const r = 5 + idx;
    const row = wsDel.getRow(r);
    row.values = [
      d.id, d.title, d.type, d.actId, d.from, d.to,
      { formula: `=INDEX('Schedule & Gantt'!$J$6:$J$${actLastRow},MATCH(D${r},'Schedule & Gantt'!$A$6:$A$${actLastRow},0))` },
      { formula: `='Dashboard | لوحة المعلومات'!$F$5+G${r}-1` },
      '',
      'Not Submitted',
      { formula: `=IF(OR(J${r}="Approved",J${r}="Received"),"Done",IF('Dashboard | لوحة المعلومات'!$F$9>G${r},"Overdue","On Track"))` },
      d.note,
    ];
    row.getCell(8).numFmt = 'yyyy-mm-dd';
    row.getCell(9).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT_BG } };
    row.getCell(10).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT_BG } };
    row.height = 22;
  });
  [8, 44, 15, 10, 18, 20, 10, 12, 12, 16, 12, 28].forEach((w, i) => { wsDel.getColumn(i + 1).width = w; });

  // ── 7. Resources & Key Materials
  const wsRes = wb.addWorksheet('Resources & Materials | الموارد');
  styleBanner(wsRes, 'Resource Allocation Histogram & Key Materials (with Official Finishes)', 'Daily active crews plus Key Materials mapped from BOQ specs.', 9 + plan.meta.durationDays);
  wsRes.getRow(4).values = ['ID', 'Resource', 'Type', 'Org', 'Role / Scope', 'Assigned Activities', 'Start Day', 'End Day', 'Active Days', ...Array.from({ length: plan.meta.durationDays }, (_, i) => i + 1)];
  styleHdr(wsRes.getRow(4));
  plan.resources.forEach((res, idx) => {
    const r = 5 + idx;
    const row = wsRes.getRow(r);
    const sDay = Math.min(...res.assigned.map((a) => a.startDay));
    const eDay = Math.max(...res.assigned.map((a) => a.endDay));
    row.values = [res.id, res.name, res.type, res.org, res.role, res.actIds.join(', '), sDay, eDay, eDay - sDay + 1];
    for (let d = 1; d <= plan.meta.durationDays; d++) {
      const active = res.assigned.some((a) => d >= a.startDay && d <= a.endDay);
      if (active) {
        const c = row.getCell(9 + d);
        c.value = 1;
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
        c.alignment = { horizontal: 'center' };
      }
    }
    row.height = 20;
  });
  const matStart = 7 + plan.resources.length;
  wsRes.getRow(matStart).values = ['Mat ID', 'Material / Product', 'BOQ Code', 'Qty & Unit', 'Official Brand Finishes', 'Manufacturer / Brand'];
  styleHdr(wsRes.getRow(matStart), SLATE);
  plan.materials.forEach((m, idx) => {
    const row = wsRes.getRow(matStart + 1 + idx);
    row.values = [m.id, m.item, m.boqRef, m.qtyUnit, m.finishes, m.brand];
    row.height = 20;
  });
  [8, 32, 14, 18, 38, 22, 10, 10, 11].forEach((w, i) => { wsRes.getColumn(i + 1).width = w; });
  for (let d = 1; d <= plan.meta.durationDays; d++) wsRes.getColumn(9 + d).width = 3.2;

  // ── 8. Cost, EV & Cash-Flow S-Curve
  const wsCost = wb.addWorksheet('Cost, EV & S-Curve | التكاليف');
  styleBanner(wsCost, `BOQ Cost Control, 80/20 EV Split & S-Curve (${plan.meta.currency})`, 'Exact BAC + VAT reconciliation and daily planned S-curve cash flow.', 16);
  wsCost.getRow(6).values = ['SN', 'Trade', 'Item Description', 'Unit', 'Qty', `Unit Rate`, `Net Amount (${plan.meta.currency})`, 'Exec Act', 'Install Act', 'Exec Wt', 'Alloc Exec', 'Alloc Install', 'Row %', 'Planned PV', 'Earned EV', 'Actual AC'];
  styleHdr(wsCost.getRow(6));
  plan.wbsItems.forEach((w, idx) => {
    const r = 7 + idx;
    const row = wsCost.getRow(r);
    row.values = [
      w.code || w.sn, w.trade.label, w.description, w.unit, w.qty, w.rate,
      { formula: `=E${r}*F${r}` },
      w.execActId, w.installActId || '', w.execWeight,
      { formula: `=G${r}*J${r}` },
      { formula: `=G${r}-K${r}` },
      { formula: `=IF(G${r}=0,0,O${r}/G${r})` },
      { formula: `=K${r}*INDEX('Schedule & Gantt'!$Q$6:$Q$${actLastRow},MATCH(H${r},'Schedule & Gantt'!$A$6:$A$${actLastRow},0))+IF(I${r}="",0,L${r}*INDEX('Schedule & Gantt'!$Q$6:$Q$${actLastRow},MATCH(I${r},'Schedule & Gantt'!$A$6:$A$${actLastRow},0)))` },
      { formula: `=K${r}*INDEX('Schedule & Gantt'!$P$6:$P$${actLastRow},MATCH(H${r},'Schedule & Gantt'!$A$6:$A$${actLastRow},0))+IF(I${r}="",0,L${r}*INDEX('Schedule & Gantt'!$P$6:$P$${actLastRow},MATCH(I${r},'Schedule & Gantt'!$A$6:$A$${actLastRow},0)))` },
      '',
    ];
    row.getCell(16).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT_BG } };
    [6, 7, 11, 12, 14, 15, 16].forEach((ci) => { row.getCell(ci).numFmt = '#,##0.00'; });
    row.getCell(13).numFmt = '0%';
    row.height = 22;
  });
  const totR = 7 + plan.wbsItems.length;
  const cTot = wsCost.getRow(totR);
  cTot.values = ['Total BAC (Excl. VAT)', '', '', '', '', '', { formula: `=SUM(G7:G${totR - 1})` }, '', '', '', { formula: `=SUM(K7:K${totR - 1})` }, { formula: `=SUM(L7:L${totR - 1})` }, { formula: `=IF(G${totR}=0,0,O${totR}/G${totR})` }, { formula: `=SUM(N7:N${totR - 1})` }, { formula: `=SUM(O7:O${totR - 1})` }, { formula: `=SUM(P7:P${totR - 1})` }];
  cTot.font = { bold: true };
  [7, 11, 12, 14, 15, 16].forEach((ci) => { cTot.getCell(ci).numFmt = '#,##0.00'; });
  cTot.getCell(13).numFmt = '0.0%';

  const payHdrRow = totR + 2;
  wsCost.getRow(payHdrRow).values = ['Pay #', 'Milestone Payment', 'Share', `Gross Amount (${plan.meta.currency})`, 'Trigger Act', 'Plan Day', 'Plan Date', 'Invoice Date', 'Collection Date', 'Status', 'Collected Amt'];
  styleHdr(wsCost.getRow(payHdrRow), BLUE);
  plan.payments.forEach((p, idx) => {
    const r = payHdrRow + 1 + idx;
    const row = wsCost.getRow(r);
    row.values = [p.id, p.title, p.share, p.amount, p.actId, p.day, { formula: `='Dashboard | لوحة المعلومات'!$F$5+${p.day - 1}` }, '', '', 'Pending', 0];
    row.getCell(3).numFmt = '0%';
    row.getCell(4).numFmt = '#,##0.00';
    row.getCell(7).numFmt = 'yyyy-mm-dd';
    [8, 9, 11].forEach((ci) => { row.getCell(ci).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT_BG } }; });
    row.getCell(11).numFmt = '#,##0.00';
  });
  const payTotR = payHdrRow + 5;
  wsCost.getRow(payTotR).values = ['Total Contract', '', { formula: `=SUM(C${payHdrRow + 1}:C${payTotR - 1})` }, { formula: `=SUM(D${payHdrRow + 1}:D${payTotR - 1})` }, '', '', '', '', '', '', { formula: `=SUM(K${payHdrRow + 1}:K${payTotR - 1})` }];
  wsCost.getRow(payTotR).font = { bold: true };
  wsCost.getRow(payTotR).getCell(3).numFmt = '0%';
  wsCost.getRow(payTotR).getCell(4).numFmt = '#,##0.00';
  wsCost.getRow(payTotR).getCell(11).numFmt = '#,##0.00';

  const sCurveHdrR = payTotR + 2;
  wsCost.getRow(sCurveHdrR).values = ['Day', 'Date', 'Daily PV', 'Cumulative PV', 'Planned Work %', 'Cumulative Billing', 'Planned Billing %'];
  styleHdr(wsCost.getRow(sCurveHdrR), SLATE);
  plan.sCurve.forEach((pt, idx) => {
    const row = wsCost.getRow(sCurveHdrR + 1 + idx);
    row.values = [pt.day, pt.date, pt.dailyPv, pt.cumPv, pt.pctWork, pt.cumBilling, pt.pctBilling];
    [3, 4, 6].forEach((ci) => { row.getCell(ci).numFmt = '#,##0.00'; });
    [5, 7].forEach((ci) => { row.getCell(ci).numFmt = '0.0%'; });
  });
  [12, 26, 40, 8, 9, 12, 14, 10, 10, 9, 13, 13, 10, 13, 13, 13].forEach((w, i) => { wsCost.getColumn(i + 1).width = w; });

  // ── 9. Risks
  const wsRisk = wb.addWorksheet('Risks | المخاطر', { properties: { tabColor: { argb: 'FFDC2626' } } });
  styleBanner(wsRisk, 'Project Risk Register (5x5 Scoring) | سجل المخاطر', 'Score = Probability × Impact; High >= 15, Medium 8–14, Low <= 7', 13);
  wsRisk.getRow(4).values = ['ID', 'Risk Event / الخطر', 'Category', 'Prob (1-5)', 'Impact (1-5)', 'Score', 'Level', 'Mitigation Response', 'Owner', 'Activity', 'Status'];
  styleHdr(wsRisk.getRow(4), 'FF991B1B');
  plan.risks.forEach((rk, idx) => {
    const r = 5 + idx;
    const row = wsRisk.getRow(r);
    row.values = [rk.id, rk.risk, rk.category, rk.prob, rk.impact, { formula: `=D${r}*E${r}` }, { formula: `=IF(F${r}>=15,"High",IF(F${r}>=8,"Medium","Low"))` }, rk.response, rk.owner, rk.actId, 'Open'];
    [4, 5].forEach((ci) => { row.getCell(ci).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT_BG } }; });
    row.height = 24;
  });
  [8, 42, 18, 11, 11, 9, 11, 48, 22, 10, 12].forEach((w, i) => { wsRisk.getColumn(i + 1).width = w; });

  // ── 10. Stakeholders & RACI
  const wsStk = wb.addWorksheet('Stakeholders & RACI | المعنيين');
  styleBanner(wsStk, 'Stakeholder Matrix & Project Governance RACI | سجل المعنيين', 'Power × Interest auto-strategy and decision accountability matrix', 8);
  wsStk.getRow(4).values = ['ID', 'Stakeholder / الجهة', 'Role', 'Power (1-5)', 'Interest (1-5)', 'Strategy'];
  styleHdr(wsStk.getRow(4));
  plan.stakeholders.forEach((s, idx) => {
    const r = 5 + idx;
    const row = wsStk.getRow(r);
    row.values = [s.id, s.name, s.role, s.power, s.interest, { formula: `=IF(AND(D${r}>=4,E${r}>=4),"Manage Closely",IF(D${r}>=4,"Keep Satisfied",IF(E${r}>=4,"Keep Informed","Monitor")))` }];
    row.height = 22;
  });
  const raciRow = 7 + plan.stakeholders.length;
  wsStk.getRow(raciRow).values = ['#', 'Decision / Work Package', 'Client', 'Contractor PM', 'Landlord', 'Joinery/FF&E', 'MEP/Signage'];
  styleHdr(wsStk.getRow(raciRow), SLATE);
  [
    ['1', 'Shop Drawings & Official Finish Samples (MAS)', 'A', 'R', 'I', 'C', 'C'],
    ['2', 'Landlord Work Permit & Site Handover', 'I', 'R', 'A', '-', '-'],
    ['3', 'Off-Site Fabrication & Factory QC (MIR)', 'I', 'A', '-', 'R', 'R'],
    ['4', 'Site Fit-Out, MEP First-Fix & WIR', 'I', 'A', 'C', '-', 'R'],
    ['5', 'Interim Milestone Payments (60/20/10/10)', 'A/R', 'C', '-', '-', '-'],
    ['6', 'Installation, T&C, Snagging & Handover', 'A', 'R', 'C', 'I', 'C'],
  ].forEach((rowVals, idx) => {
    const row = wsStk.getRow(raciRow + 1 + idx);
    row.values = rowVals;
    row.height = 22;
  });
  [8, 42, 26, 12, 12, 18, 16].forEach((w, i) => { wsStk.getColumn(i + 1).width = w; });

  // Clean COL_LETTER lint check
  void COL_LETTER(1);

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/**
 * Generates native Microsoft Project MSPDI XML (.xml Blob) — directly importable into
 * Microsoft Project Desktop, Primavera P6, ProjectLibre, and Smartsheet.
 */
export function buildMsProjectXml(plan) {
  const isoTs = (d, hour = 8) => `${ISO_DATE(d)}T${String(hour).padStart(2, '0')}:00:00`;
  const durPt = (days) => `PT${Math.max(0, days * 8)}H0M0S`;

  const uidByActId = new Map();
  let nextUid = 1;
  // Summary Root UID 0, Phase summaries, then Activity tasks
  const phases = [];
  const byPhase = new Map();
  plan.activities.forEach((a) => {
    if (!byPhase.has(a.phase)) {
      const list = [];
      byPhase.set(a.phase, list);
      phases.push({ name: a.phase, list });
    }
    byPhase.get(a.phase).push(a);
  });

  const taskNodes = [];
  let outlineNum = 1;

  // Task 0: Project Summary
  taskNodes.push(`    <Task>
      <UID>0</UID>
      <ID>0</ID>
      <Name>${escXml(plan.meta.title)}</Name>
      <Type>1</Type>
      <IsNull>0</IsNull>
      <OutlineNumber>0</OutlineNumber>
      <OutlineLevel>0</OutlineLevel>
      <Start>${isoTs(plan.meta.startDate, 8)}</Start>
      <Finish>${isoTs(plan.meta.finishDate, 17)}</Finish>
      <Duration>${durPt(plan.meta.durationDays)}</Duration>
      <Work>${durPt(plan.meta.durationDays)}</Work>
      <Summary>1</Summary>
      <Milestone>0</Milestone>
      <FixedCost>${r2(plan.meta.netTotal)}</FixedCost>
      <Baseline>
        <Number>0</Number>
        <Start>${isoTs(plan.meta.startDate, 8)}</Start>
        <Finish>${isoTs(plan.meta.finishDate, 17)}</Finish>
        <Duration>${durPt(plan.meta.durationDays)}</Duration>
        <Cost>${r2(plan.meta.netTotal)}</Cost>
      </Baseline>
    </Task>`);

  // Assign UIDs first so cross-phase PredecessorLink references resolve
  const phaseMeta = phases.map((ph) => {
    const phUid = nextUid++;
    ph.list.forEach((a) => { uidByActId.set(a.id, nextUid++); });
    return { ...ph, uid: phUid };
  });

  let seqId = 1;
  phaseMeta.forEach((ph) => {
    const pStart = Math.min(...ph.list.map((a) => a.startDay));
    const pEnd = Math.max(...ph.list.map((a) => a.endDay));
    const pDur = pEnd - pStart + 1;
    const phCost = r2(ph.list.reduce((s, a) => s + num(a.allocatedBac), 0));
    const pStartDate = ADD_DAYS(plan.meta.startDate, pStart - 1);
    const pEndDate = ADD_DAYS(plan.meta.startDate, pEnd - 1);
    const pOut = String(outlineNum++);

    taskNodes.push(`    <Task>
      <UID>${ph.uid}</UID>
      <ID>${seqId++}</ID>
      <Name>${escXml(ph.name)}</Name>
      <Type>1</Type>
      <OutlineNumber>${pOut}</OutlineNumber>
      <OutlineLevel>1</OutlineLevel>
      <Start>${isoTs(pStartDate, 8)}</Start>
      <Finish>${isoTs(pEndDate, 17)}</Finish>
      <Duration>${durPt(pDur)}</Duration>
      <Summary>1</Summary>
      <Milestone>0</Milestone>
      <ConstraintType>0</ConstraintType>
      <Baseline>
        <Number>0</Number>
        <Start>${isoTs(pStartDate, 8)}</Start>
        <Finish>${isoTs(pEndDate, 17)}</Finish>
        <Duration>${durPt(pDur)}</Duration>
        <Cost>${phCost}</Cost>
      </Baseline>
    </Task>`);

    ph.list.forEach((a, subIdx) => {
      const uid = uidByActId.get(a.id);
      const tStart = ADD_DAYS(plan.meta.startDate, a.startDay - 1);
      const tEnd = ADD_DAYS(plan.meta.startDate, a.endDay - 1);
      const isMile = a.type === 'Milestone';
      const predXml = (a.predIds || [])
        .map((pid) => uidByActId.get(pid))
        .filter(Boolean)
        .map((pUid) => `      <PredecessorLink>
        <PredecessorUID>${pUid}</PredecessorUID>
        <Type>${a.id === 'A25' ? 3 : 1}</Type>
        <CrossProject>0</CrossProject>
        <LinkLag>0</LinkLag>
        <LagFormat>7</LagFormat>
      </PredecessorLink>`)
        .join('\n');

      taskNodes.push(`    <Task>
      <UID>${uid}</UID>
      <ID>${seqId++}</ID>
      <Name>${escXml(`${a.id}: ${a.name}`)}</Name>
      <Type>0</Type>
      <OutlineNumber>${pOut}.${subIdx + 1}</OutlineNumber>
      <OutlineLevel>2</OutlineLevel>
      <Start>${isoTs(tStart, 8)}</Start>
      <Finish>${isoTs(tEnd, isMile ? 8 : 17)}</Finish>
      <Duration>${isMile ? 'PT0H0M0S' : durPt(a.duration)}</Duration>
      <Work>${isMile ? 'PT0H0M0S' : durPt(a.duration)}</Work>
      <Summary>0</Summary>
      <Milestone>${isMile ? 1 : 0}</Milestone>
      <PercentComplete>0</PercentComplete>
      <Notes>${escXml(`BOQ: ${a.boqRef} | Owner: ${a.owner} | BAC: ${r2(a.allocatedBac)} ${plan.meta.currency}`)}</Notes>
      <Baseline>
        <Number>0</Number>
        <Start>${isoTs(tStart, 8)}</Start>
        <Finish>${isoTs(tEnd, isMile ? 8 : 17)}</Finish>
        <Duration>${isMile ? 'PT0H0M0S' : durPt(a.duration)}</Duration>
        <Cost>${r2(a.allocatedBac)}</Cost>
      </Baseline>
${predXml}
    </Task>`);
    });
  });

  const resUidMap = new Map();
  const resNodes = plan.resources.map((r, i) => {
    const rUid = i + 1;
    resUidMap.set(r.id, rUid);
    return `    <Resource>
      <UID>${rUid}</UID>
      <ID>${rUid}</ID>
      <Name>${escXml(`${r.id} - ${r.name}`)}</Name>
      <Type>1</Type>
      <Group>${escXml(r.org)}</Group>
      <MaxUnits>1</MaxUnits>
      <Notes>${escXml(r.role)}</Notes>
    </Resource>`;
  });

  const assignNodes = [];
  let assignUid = 1;
  plan.activities.forEach((a) => {
    const tUid = uidByActId.get(a.id);
    const rUid = resUidMap.get(a.resourceId);
    if (!tUid || !rUid) return;
    const cost = r2(a.allocatedBac);
    const tStart = ADD_DAYS(plan.meta.startDate, a.startDay - 1);
    const tEnd = ADD_DAYS(plan.meta.startDate, a.endDay - 1);
    assignNodes.push(`    <Assignment>
      <UID>${assignUid++}</UID>
      <TaskUID>${tUid}</TaskUID>
      <ResourceUID>${rUid}</ResourceUID>
      <PercentWorkComplete>0</PercentWorkComplete>
      <Units>1</Units>
      <Start>${isoTs(tStart, 8)}</Start>
      <Finish>${isoTs(tEnd, 17)}</Finish>
      <Work>${a.type === 'Milestone' ? 'PT0H0M0S' : durPt(a.duration)}</Work>
      <Cost>${cost}</Cost>
      <Baseline>
        <Number>0</Number>
        <Start>${isoTs(tStart, 8)}</Start>
        <Finish>${isoTs(tEnd, 17)}</Finish>
        <Cost>${cost}</Cost>
      </Baseline>
    </Assignment>`);
  });

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <SaveVersion>14</SaveVersion>
  <Name>${escXml(plan.meta.title)}</Name>
  <Title>${escXml(`${plan.meta.title} (${plan.meta.scaleTier})`)}</Title>
  <Author>${escXml(plan.meta.contractor)}</Author>
  <Manager>${escXml(plan.meta.pm)}</Manager>
  <CreationDate>${isoTs(new Date(), 9)}</CreationDate>
  <ScheduleFromStart>1</ScheduleFromStart>
  <StartDate>${isoTs(plan.meta.startDate, 8)}</StartDate>
  <FinishDate>${isoTs(plan.meta.finishDate, 17)}</FinishDate>
  <CalendarUID>1</CalendarUID>
  <DefaultStartTime>08:00:00</DefaultStartTime>
  <DefaultFinishTime>17:00:00</DefaultFinishTime>
  <MinutesPerDay>480</MinutesPerDay>
  <MinutesPerWeek>3360</MinutesPerWeek>
  <DaysPerMonth>30</DaysPerMonth>
  <CurrencySymbol>${escXml(plan.meta.currency)}</CurrencySymbol>
  <CurrencyCode>${escXml(plan.meta.currency)}</CurrencyCode>
  <Calendars>
    <Calendar>
      <UID>1</UID>
      <Name>7-Day Fit-Out Calendar</Name>
      <IsBaseCalendar>1</IsBaseCalendar>
      <WeekDays>
        <WeekDay><DayType>1</DayType><DayWorking>1</DayWorking><WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes></WeekDay>
        <WeekDay><DayType>2</DayType><DayWorking>1</DayWorking><WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes></WeekDay>
        <WeekDay><DayType>3</DayType><DayWorking>1</DayWorking><WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes></WeekDay>
        <WeekDay><DayType>4</DayType><DayWorking>1</DayWorking><WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes></WeekDay>
        <WeekDay><DayType>5</DayType><DayWorking>1</DayWorking><WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes></WeekDay>
        <WeekDay><DayType>6</DayType><DayWorking>1</DayWorking><WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes></WeekDay>
        <WeekDay><DayType>7</DayType><DayWorking>1</DayWorking><WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes></WeekDay>
      </WeekDays>
    </Calendar>
  </Calendars>
  <Tasks>
${taskNodes.join('\n')}
  </Tasks>
  <Resources>
${resNodes.join('\n')}
  </Resources>
  <Assignments>
${assignNodes.join('\n')}
  </Assignments>
</Project>
`;
  return new Blob([xml], { type: 'application/xml;charset=utf-8' });
}
