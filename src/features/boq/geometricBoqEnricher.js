/**
 * Post-Build Geometric BOQ Enricher
 * Bridges real 3D measured geometry (floor area, net wall paint area, curved walls,
 * glass partitions, skirting, doors, windows, sanitary fixtures, and furniture counts)
 * from Design & Build back into BOQFLOW's active BOQ / Costed Offer.
 */

import { resolveItemFinishes, FITOUT_OFFICIAL_FINISH_CARDS, resolveFitoutSkuCode } from '../../utils/officialBrandFinishes.js';

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

const cellVal = (c) => (c && typeof c === 'object' ? c.value : c);

function detectTableCols(table) {
  const header = (table?.header || []).map((h) => String(h || '').replace(/\s+/g, ' ').trim().toLowerCase());
  const find = (re) => header.findIndex((h) => re.test(h));
  const hasBrand = header.some((h) => /\bbrand\b|\bmfr\b/i.test(h));
  const sn = find(/^(#|s\.?n\.?|sr|sl|no|ref|code)/i);
  const img = find(/\bimage|pic|photo/i);
  const desc = find(/\bdesc|item|particular|scope|specification/i);
  const brand = find(/\bbrand|manufacturer|make/i);
  const model = find(/\bmodel|sku|series|type/i);
  const qty = find(/\bqty|quantity\b/i);
  const unit = find(/\bunit|uom\b/i);
  const rate = find(/\brate|unit\s*price|price\b/i);
  const amount = find(/\bamount|total\b/i);
  if (hasBrand || header.length >= 9) {
    return {
      sn: sn >= 0 ? sn : 0,
      image: img >= 0 ? img : 1,
      description: desc >= 0 ? desc : 2,
      brand: brand >= 0 ? brand : 3,
      model: model >= 0 ? model : 4,
      qty: qty >= 0 ? qty : 5,
      unit: unit >= 0 ? unit : 6,
      rate: rate >= 0 ? rate : 7,
      amount: amount >= 0 ? amount : 8,
    };
  }
  return {
    sn: sn >= 0 ? sn : 0,
    image: img >= 0 ? img : 1,
    description: desc >= 0 ? desc : 2,
    brand: -1,
    model: -1,
    qty: qty >= 0 ? qty : 3,
    unit: unit >= 0 ? unit : 4,
    rate: rate >= 0 ? rate : 5,
    amount: amount >= 0 ? amount : 6,
  };
}

const SURFACE_RULES = [
  {
    key: 'flooring',
    label: 'Floor Finishes (Measured Slab Area)',
    matchRe: /\b(floor(ing)?|porcelain|ceramic|carpet\s*tile|vinyl|lvt|parquet|terrazzo|epoxy\s*floor|raised\s*floor)\b/i,
    excludeRe: /\b(lamp|stand|box|drain|skirting)\b/i,
    allowedUnits: /^(sqm|m2|m²|sq\.?\s*m)$/i,
    fallbackSku: 'FL-POR-01',
    measure: (t) => r2(t.netFloorAreaM2),
    basis: (t) => `Measured floor slab ${r2(t.netFloorAreaM2)} m²`,
  },
  {
    key: 'ceiling',
    label: 'Ceiling Finishes (Measured Slab Area)',
    matchRe: /\b(ceiling|gypsum\s*board\s*ceiling|suspended\s*ceiling|acoustic\s*ceiling|baffle|soffit)\b/i,
    excludeRe: /\b(light|Fixture|luminaire|downlight|diffuser)\b/i,
    allowedUnits: /^(sqm|m2|m²|sq\.?\s*m)$/i,
    fallbackSku: 'CL-GYP-01',
    measure: (t) => r2(t.ceilingAreaM2 || t.netFloorAreaM2),
    basis: (t) => `Measured reflected ceiling ${r2(t.ceilingAreaM2 || t.netFloorAreaM2)} m²`,
  },
  {
    key: 'wall_paint',
    label: 'Wall Paint & Drywall Finish (Net Wall Surface)',
    matchRe: /\b(wall\s*paint|emulsion|acrylic\s*paint|internal\s*wall|wall\s*finish|wallcovering|wallpaper|acoustic\s*wall\s*panel|plaster(ing)?)\b/i,
    excludeRe: /\b(cabinet|shelf|display|sign|tv|unit|wash\s*basin|wc)\b/i,
    allowedUnits: /^(sqm|m2|m²|sq\.?\s*m)$/i,
    fallbackSku: 'FN-PNT-01',
    measure: (t) => r2(t.solidWallNetPaintAreaM2),
    basis: (t) => `${r2(t.solidWallLengthLm)} lm solid wall minus ${t.doors?.total || 0} doors & ${t.windows?.total || 0} windows`,
  },
  {
    key: 'glass_partition',
    label: 'Glazed Partitions (Measured Glass Walls)',
    matchRe: /\b(glass\s*partition|glazed\s*partition|acoustic\s*glazing|tempered\s*glass\s*wall|demountable\s*glass|pod\s*glazing)\b/i,
    excludeRe: /\b(door|table|film)\b/i,
    allowedUnits: /^(sqm|m2|m²|sq\.?\s*m|lm|l\.?m|m)$/i,
    fallbackSku: 'PT-GLS-01',
    measure: (t, unit) => (/^(lm|l\.?m|m)$/i.test(unit) ? r2(t.glassPartitionLengthLm) : r2(t.glassPartitionAreaM2)),
    basis: (t) => `${r2(t.glassPartitionLengthLm)} lm curved/straight glass (${r2(t.glassPartitionAreaM2)} m²)`,
  },
  {
    key: 'skirting',
    label: 'Perimeter Skirting & Baseboard',
    matchRe: /\b(skirting|baseboard|cove\s*base)\b/i,
    excludeRe: /^$/i,
    allowedUnits: /^(lm|l\.?m|m|rm)$/i,
    fallbackSku: 'FN-SKT-01',
    measure: (t) => r2(t.skirtingLengthLm),
    basis: (t) => `Measured solid wall perimeter less doors = ${r2(t.skirtingLengthLm)} lm`,
  },
  {
    key: 'doors',
    label: 'Internal Doors & Ironmongery',
    matchRe: /\b(flush\s*door|timber\s*door|glass\s*door|wooden\s*door|acoustic\s*door|entrance\s*door|internal\s*door)\b/i,
    excludeRe: /\b(cabinet|cupboard|locker|wardrobe|closer|handle|stopper)\b/i,
    allowedUnits: /^(nos|no|ea|each|pc|pcs|set)$/i,
    fallbackSku: 'DR-SWG-01',
    measure: (t) => Math.round(t.doors?.total || 0),
    basis: (t) => `${t.doors?.total || 0} extracted doors (${t.doors?.podGlass || 0} pod/glass)`,
  },
  {
    key: 'windows',
    label: 'Exterior Windows & Curtain Glazing',
    matchRe: /\b(window|curtain\s*wall|facade\s*glazing)\b/i,
    excludeRe: /\b(blind|film|curtain\s*track)\b/i,
    allowedUnits: /^(nos|no|ea|each|sqm|m2|m²)$/i,
    fallbackSku: 'WN-BLD-01',
    measure: (t, unit) => (/^(sqm|m2|m²)$/i.test(unit) ? r2(t.windows?.totalAreaM2 || 0) : Math.round(t.windows?.total || 0)),
    basis: (t) => `${t.windows?.total || 0} extracted windows (${r2(t.windows?.totalAreaM2 || 0)} m²)`,
  },
  {
    key: 'wc',
    label: 'Water Closets (WC) in Wet Rooms',
    matchRe: /\b(w\.?c\.?|water\s*closet|toilet\s*pan|toilet\s*suite)\b/i,
    excludeRe: /\b(partition|cubicle|brush|holder|sign)\b/i,
    allowedUnits: /^(nos|no|ea|each|set|pcs)$/i,
    fallbackSku: 'MEP-SAN-02',
    measure: (t) => Number(t.sanitaryCounts?.wc || 0),
    basis: (t) => `${t.sanitaryCounts?.wc || 0} WC fixtures extracted`,
  },
  {
    key: 'basin',
    label: 'Wash Basins & Mixers',
    matchRe: /\b(wash\s*basin|hand\s*basin|vanity\s*basin|lavatory\s*sink)\b/i,
    excludeRe: /\b(counter|vanity\s*unit)\b/i,
    allowedUnits: /^(nos|no|ea|each|set|pcs)$/i,
    fallbackSku: 'MEP-SAN-03',
    measure: (t) => Number(t.sanitaryCounts?.basin || 0),
    basis: (t) => `${t.sanitaryCounts?.basin || 0} wash basins extracted`,
  },
];

const MISSING_TEMPLATES = [
  {
    key: 'flooring',
    sku: 'FL-POR-01',
    name: 'FL-POR-01 — RAK Ceramics / Omani Marble Floor Finish',
    description: 'Supply and installation of commercial-grade 600x600mm RAK Ceramics rectified porcelain tile or Interface carpet tile over Mapei leveling screed as measured from 3D floor slab.',
    category: 'Floor Finishes',
    unit: 'Sqm',
    defaultRateOmr: 18,
    measure: (t) => r2(t.netFloorAreaM2),
    basis: (t) => `Net 3D Floor Slab Area (${r2(t.netFloorAreaM2)} m²)`,
  },
  {
    key: 'ceiling',
    sku: 'CL-GYP-01',
    name: 'CL-GYP-01 — Knauf Suspended Gypsum / Acoustic Ceiling',
    description: 'Knauf 12.5mm moisture-resistant concealed MF grid suspended gypsum ceiling with shadow-gap perimeter trim, jointing skim coat, and Jotun matte white paint across enclosed rooms.',
    category: 'Ceiling Works',
    unit: 'Sqm',
    defaultRateOmr: 14,
    measure: (t) => r2(t.ceilingAreaM2 || t.netFloorAreaM2),
    basis: (t) => `Reflected Ceiling Area (${r2(t.ceilingAreaM2 || t.netFloorAreaM2)} m²)`,
  },
  {
    key: 'wall_paint',
    sku: 'FN-PNT-01',
    name: 'FN-PNT-01 — Jotun Fenomastic Wall Skim & Emulsion Paint',
    description: 'Surface preparation, alkali-resistant primer, 2 coats putty skim, and 2 finish coats Jotun Fenomastic washable matt emulsion on both faces of internal partitions & inner perimeter walls.',
    category: 'Wall Finishes & Painting',
    unit: 'Sqm',
    defaultRateOmr: 5.5,
    measure: (t) => r2(t.solidWallNetPaintAreaM2),
    basis: (t) => `Net Wall Area (${r2(t.solidWallLengthLm)} lm solid wall less openings)`,
  },
  {
    key: 'glass_partition',
    sku: 'PT-GLS-01',
    name: 'PT-GLS-01 — Guardian / Optima Acoustic Glass Partition',
    description: '10mm/12mm Guardian clear tempered acoustic laminated glass partition & curved pod enclosure with slim Optima RAL 9005 extruded aluminum floor/ceiling channels.',
    category: 'Glazing & Partitions',
    unit: 'Sqm',
    defaultRateOmr: 68,
    measure: (t) => r2(t.glassPartitionAreaM2),
    basis: (t) => `${r2(t.glassPartitionLengthLm)} lm extracted glass & curved pod walls`,
  },
  {
    key: 'skirting',
    sku: 'FN-SKT-01',
    name: 'FN-SKT-01 — Gulf Extrusions Aluminum / Porcelain Skirting',
    description: '100mm Gulf Extrusions flush anodized aluminum / RAK porcelain skirting fixed along solid wall perimeters excluding door clear widths.',
    category: 'Floor Finishes',
    unit: 'Lm',
    defaultRateOmr: 4.5,
    measure: (t) => r2(t.skirtingLengthLm),
    basis: (t) => `${r2(t.skirtingLengthLm)} lm measured perimeter less doors`,
  },
  {
    key: 'doors',
    sku: 'DR-SWG-01',
    name: 'DR-SWG-01 — Solid-Core Door Set & Dormakaba Ironmongery',
    description: 'Full-height Egger HPL / oak veneer solid-core door set complete with perimeter acoustic seals, stainless lever handles, hinges, and Dormakaba door closer.',
    category: 'Doors & Ironmongery',
    unit: 'Nos',
    defaultRateOmr: 220,
    measure: (t) => Math.round(t.doors?.total || 0),
    basis: (t) => `${t.doors?.total || 0} extracted DoorNodes`,
  },
];

/**
 * Compare current BOQ tables against measured 3D geometry takeoff to produce:
 * - `updates`: matched existing rows whose qty should be synchronized to measured 3D geometry
 * - `additions`: missing architectural/MEP surfaces detected in the 3D model
 * - `summary`: concise metrics comparing Initial vs Post-Build 3D Takeoff
 */
export function buildGeometricEnrichmentPlan(tables = [], takeoff = null) {
  if (!takeoff) return { updates: [], additions: [], summary: null };

  const updates = [];
  const presentKeys = new Set();

  (tables || []).forEach((table, tableIndex) => {
    const col = detectTableCols(table);
    (table?.rows || []).forEach((row, rowIndex) => {
      if (!row || row.isHeader || row.isSummary || row.isOptionRow || row.isSetSubItem || !Array.isArray(row.cells)) return;
      const desc = String(cellVal(row.cells[col.description]) || row.sourceDescription || '').trim();
      const model = col.model >= 0 ? String(cellVal(row.cells[col.model]) || row.selectedModel || '').trim() : String(row.selectedModel || '').trim();
      const unit = String(cellVal(row.cells[col.unit]) || '').trim();
      const hay = `${desc} ${model} ${row.selectedSubCat || ''} ${row.selectedMainCat || ''}`;
      if (!hay.trim()) return;

      for (const rule of SURFACE_RULES) {
        if (!rule.matchRe.test(hay) || (rule.excludeRe.source !== '^$' && rule.excludeRe.test(hay))) continue;
        presentKeys.add(rule.key);
        if (unit && !rule.allowedUnits.test(unit)) break;
        const measuredQty = rule.measure(takeoff, unit || 'Sqm');
        if (!(measuredQty > 0)) break;
        const currentQty = num(cellVal(row.cells[col.qty]));
        const rate = num(cellVal(row.cells[col.rate]));
        const delta = r2(measuredQty - currentQty);
        if (Math.abs(delta) >= 0.05) {
          updates.push({
            id: `upd_${tableIndex}_${rowIndex}_${rule.key}`,
            selected: true,
            tableIndex,
            rowIndex,
            ruleKey: rule.key,
            label: rule.label,
            description: desc.slice(0, 120),
            unit: unit || (rule.key === 'doors' || rule.key === 'windows' || rule.key === 'wc' || rule.key === 'basin' ? 'Nos' : rule.key === 'skirting' ? 'Lm' : 'Sqm'),
            currentQty: r2(currentQty),
            measuredQty: r2(measuredQty),
            delta,
            rate: r2(rate),
            newAmount: r2(measuredQty * rate),
            basis: rule.basis(takeoff),
          });
        }
        break;
      }
    });
  });

  const additions = [];
  for (const tpl of MISSING_TEMPLATES) {
    if (presentKeys.has(tpl.key)) continue;
    const qty = tpl.measure(takeoff);
    if (!(qty > 0)) continue;
    const cardMeta = FITOUT_OFFICIAL_FINISH_CARDS[tpl.sku] || {};
    const finishes = resolveItemFinishes({ brand: 'FitOut V2', code: tpl.sku, model: tpl.name, description: tpl.description }, 'auto');
    additions.push({
      id: `add_${tpl.sku}`,
      selected: true,
      ruleKey: tpl.key,
      code: tpl.sku,
      brand: cardMeta.manufacturer || 'FitOut V2',
      brandSystem: cardMeta.brandSystem || '',
      model: tpl.name,
      category: tpl.category,
      description: tpl.description,
      unit: tpl.unit,
      qty,
      rate: tpl.defaultRateOmr,
      amount: r2(qty * tpl.defaultRateOmr),
      basis: tpl.basis(takeoff),
      imageUrl: cardMeta.imageUrl || `https://kfrjsvqhvwaezdvsrgzw.supabase.co/storage/v1/object/public/product-images/fitout-v2/${tpl.sku.toLowerCase()}.png`,
      finishes,
    });
  }

  return {
    updates,
    additions,
    summary: {
      netFloorAreaM2: r2(takeoff.netFloorAreaM2),
      solidWallLengthLm: r2(takeoff.solidWallLengthLm),
      solidWallNetPaintAreaM2: r2(takeoff.solidWallNetPaintAreaM2),
      glassPartitionAreaM2: r2(takeoff.glassPartitionAreaM2),
      skirtingLengthLm: r2(takeoff.skirtingLengthLm),
      doorsCount: Math.round(takeoff.doors?.total || 0),
      windowsCount: Math.round(takeoff.windows?.total || 0),
      furnitureCount: Math.round(takeoff.furnitureTotalCount || 0),
    },
  };
}

/**
 * Apply chosen measured 3D quantity updates & missing surface additions onto BOQ tables,
 * returning clean deep-cloned tables ready for TableViewer and Export Suite.
 */
export function applyGeometricEnrichmentToTables(tables = [], updates = [], additions = []) {
  const next = (tables || []).map((t) => ({
    ...t,
    header: [...(t.header || [])],
    rows: (t.rows || []).map((r) => ({
      ...r,
      cells: (r.cells || []).map((c) => (c && typeof c === 'object' ? { ...c } : c)),
    })),
  }));

  if (!next.length) return next;

  for (const upd of updates || []) {
    if (!upd?.selected) continue;
    const tbl = next[upd.tableIndex];
    const row = tbl?.rows?.[upd.rowIndex];
    if (!tbl || !row || !Array.isArray(row.cells)) continue;
    const col = detectTableCols(tbl);
    const qtyCell = row.cells[col.qty];
    const rate = num(cellVal(row.cells[col.rate]));
    const qtyVal = String(upd.measuredQty);
    row.cells[col.qty] = qtyCell && typeof qtyCell === 'object' ? { ...qtyCell, value: qtyVal } : { value: qtyVal };
    if (col.amount >= 0) {
      const amtVal = (upd.measuredQty * rate).toFixed(2);
      const amtCell = row.cells[col.amount];
      row.cells[col.amount] = amtCell && typeof amtCell === 'object' ? { ...amtCell, value: amtVal } : { value: amtVal };
    }
    row.measured3dBasis = upd.basis;
    row.measured3dQty = upd.measuredQty;
  }

  const chosenAdds = (additions || []).filter((a) => a?.selected && num(a.qty) > 0);
  if (chosenAdds.length > 0) {
    const targetTbl = next[0];
    const col = detectTableCols(targetTbl);
    const colCount = Math.max(targetTbl.header.length || 0, col.amount + 1, 7);
    let snCounter = targetTbl.rows.filter((r) => !r.isHeader && !r.isSummary).length;

    chosenAdds.forEach((add) => {
      snCounter += 1;
      const qtyNum = num(add.qty);
      const rateNum = num(add.rate);
      const amtNum = r2(qtyNum * rateNum);
      const cells = Array.from({ length: colCount }, () => ({ value: '' }));
      cells[col.sn] = { value: String(snCounter) };
      if (col.image >= 0) {
        cells[col.image] = {
          value: '',
          image: add.imageUrl || null,
          images: add.imageUrl ? [{ url: add.imageUrl }] : [],
        };
      }
      cells[col.description] = { value: add.description };
      if (col.brand >= 0) cells[col.brand] = { value: add.brand || 'FitOut V2' };
      if (col.model >= 0) cells[col.model] = { value: add.model || add.code };
      cells[col.qty] = { value: String(qtyNum) };
      if (col.unit >= 0) cells[col.unit] = { value: add.unit || 'Sqm' };
      if (col.rate >= 0) cells[col.rate] = { value: rateNum.toFixed(2) };
      if (col.amount >= 0) cells[col.amount] = { value: amtNum.toFixed(2) };

      const newRow = {
        id: `geo_${add.code}_${Date.now()}_${snCounter}`,
        sn: String(snCounter),
        code: add.code,
        skuCode: add.code,
        scope: 'FITOUT',
        selectedBrand: add.brand || 'FitOut V2',
        selectedMainCat: 'Architectural Fit-Out',
        selectedSubCat: add.category || 'Fit-Out Finishes',
        selectedModel: add.model || add.code,
        finishes: add.finishes || [],
        sectionLabel: 'FIT-OUT — 3D MEASURED SURFACES & ENRICHMENT',
        sectionCategory: 'Architectural Fit-Out & MEP Finishes',
        sourceDescription: add.description,
        measured3dBasis: add.basis,
        measured3dQty: qtyNum,
        placeable3D: Boolean(resolveFitoutSkuCode({ code: add.code }) && /^(MEP-SAN|MEP-AV|JN-)/i.test(add.code)),
        cells,
      };
      targetTbl.rows.push(newRow);
    });
  }

  return next;
}
