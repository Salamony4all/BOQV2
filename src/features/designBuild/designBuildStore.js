// Design & Build link: one small shared store for the Design & Build modal, so the
// modal (and the 3D model inside it) survives BOQ Flow's own page changes. The
// modal itself is mounted once, next to the app (see DesignBuildDock).
import { useSyncExternalStore } from 'react';
import { extractImageUrl, loadExportImageData } from '../../utils/urlUtils.js';
import { resolveItemFinishes, resolveFitoutSkuCode } from '../../utils/officialBrandFinishes.js';

const FITOUT_3D_FIXTURE_CODES = new Set([
    'MEP-SAN-01', 'MEP-SAN-02', 'MEP-SAN-03', 'MEP-SAN-04',
    'MEP-AV-01', 'JN-VAN-01', 'JN-PNT-01',
]);

export function inferArchitecturalRole({ brand = '', code = '', category = '', description = '', fulfillmentType = '', designBuildKind = '', subtype = '' }) {
    const sku = String(code || '').toUpperCase().trim();
    const hay = `${sku} ${brand} ${category} ${description} ${subtype}`;
    if (designBuildKind === 'ceiling' || /^CL-(?:WOD|ACU|GYP)-|^FAB-CLG-/.test(sku) || /\b(rotunda\s*canopy|slatted?\s*(?:ceiling|canopy)|ceiling\s*(?:baffle|cloud|canopy)|hunter\s*douglas\s*.*ceil|recessed\s*cove\s*ceil)\b/i.test(hay)) {
        return 'ceiling-feature';
    }
    if (/^PT-GLS-/.test(sku) || /\b(glass\s*partition|glazed\s*partition|fluted\s*glass|reeded\s*glass|frosted\s*glass|optima\s*revolution)\b/i.test(hay)) {
        return 'glazing-partition';
    }
    if (/^WC-(?:WOD|FLT|ACU|MTL)-|^FAB-FTR-/.test(sku) || /\b(fluted\s*(?:timber|wood|oak|walnut)?\s*(?:wall|panel)|wood\s*veneer\s*wall|acoustic\s*wall\s*panel|feature\s*wall\s*(?:panel|cladding))\b/i.test(hay)) {
        return 'wall-cladding';
    }
    if (/^PT-DRY-/.test(sku) || /\b(knauf.*drywall|gypsum\s*partition)\b/i.test(hay)) {
        return 'gypsum-partition';
    }
    if (/^FAB-ART-|^FN-ART-/.test(sku) || subtype === 'wall-art' || /\b(wall\s*art(?:work)?|framed\s*(?:art|canvas|painting)|bas[\s-]*relief|sculptural\s*wall\s*(?:art|panel))\b/i.test(hay)) {
        return 'wall-artwork';
    }
    if (fulfillmentType === 'custom_fabrication' && (subtype === 'slat-screen' || /^FAB-SCR-/.test(sku))) return 'slat-screen';
    if (fulfillmentType === 'custom_fabrication' && (subtype === 'retail-kiosk' || /^FAB-KSK-/.test(sku))) return 'retail-kiosk';
    return '';
}

function isPlaceable3DProduct({ brand = '', code = '', category = '', description = '', unit = '', fulfillmentType = '', designBuildKind = '' }) {
    if (fulfillmentType === 'custom_fabrication' || /custom\s*fab/i.test(`${brand} ${category}`)) return true;
    const isFitout = /fitout|fit-out/i.test(`${brand} ${category}`) || /^(?:FL|PT|WC|CL|DR|WN|FN|JN|MEP|MOB|UTIL|HSE|DEB|CLN|INS)\b/i.test(code);
    if (!isFitout) return true;
    if (FITOUT_3D_FIXTURE_CODES.has(String(code || '').toUpperCase())) return true;
    if (/^(sanitary|screen|joinery|storage|equipment)$/i.test(String(designBuildKind || ''))) return true;
    if (/^(sqm|m2|lm|ls|lot)$/i.test(String(unit || '').trim())) return false;
    return /\b(wc|toilet|basin|urinal|shower|vanity|pantry|display\s*screen|television|tv)\b/i.test(description) && !/\b(tile|paint|gypsum|carpet|vinyl|partition|skirting|plaster)\b/i.test(description);
}

export const DESIGN_BUILD_URL = String(import.meta.env?.VITE_DESIGN_BUILD_URL || 'https://design-and-build-v2.vercel.app').replace(/\/+$/, '');

export const DESIGN_BUILD_ORIGIN = (() => {
    try {
        return new URL(DESIGN_BUILD_URL).origin;
    } catch {
        return 'https://design-and-build-v2.vercel.app';
    }
})();

/** Renders kept per session (each is a full-size picture). */
const MAX_RENDERS = 8;

const initial = {
    session: 0,         // increases each time a new session opens
    open: false,        // a Design & Build session exists (its iframe is mounted)
    minimized: false,   // modal tucked into a chip; the 3D model stays loaded
    plan: null,         // { file, name, token }
    status: 'idle',     // idle | connecting | building | ready
    stage: '',
    counts: null,       // { walls, glassWalls, curvedWalls, windows, doors, items }
    error: null,
    products: [],       // BOQ lines with their chosen products (sent for furnishing)
    productsToken: 0,
    furniture: null,    // { pieces, schedule } read from the drawing by Design & Build
    takeoff: null,      // pure 3D geometric surface/opening takeoff from Design & Build
    boqEnrichedAt: null,
    furnished: null,    // { placedPieces, pieces, products, unplacedProductIds, colours }
    offer: null,        // { tables, title } of the applied offer, for the export suite
    renders: [],        // finished renders from Design & Build, newest last
    approvedRenderId: null,
    exportedAt: null,
    exportPanel: false, // the export suite panel is open in the modal
    exporting: null,    // { label } while the package is being made (from the modal, BOQ Flow's exports or the chip)
    exportResult: null, // { files, notes, viewsMissing, at } of the last package saved
    exportError: null,
    lastPlan: null,     // the last plan PDF uploaded (kept when a session closes), for one-click starts
    customItems: [],    // { typeId, name, kind, count, picture } set on drawn furniture without a product
    documents: null,    // { source } while BOQ Flow's table can add its offer, BOQ and submittals to the package
};

/** Custom items at most (each carries a small picture). */
const MAX_CUSTOM_ITEMS = 24;

let state = { ...initial };
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());
/** How the open session makes the package (it needs Design & Build's views): set by the modal. */
let exporter = null;
/** How BOQ Flow's table makes its own offer, BOQ and submittals for the package: set by the table viewer. */
let documentMaker = null;
/** How BOQ Flow's table applies post-build 3D geometric enrichment updates & additions. */
let boqEnricher = null;
/** Active BOQ tables getter for post-build geometric enrichment even before applying an offer. */
let tablesGetter = null;

export const designBuild = {
    getState: () => state,
    subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
    set(patch) {
        state = { ...state, ...patch };
        emit();
    },
    /** Send a plan to Design & Build and open its modal. */
    openWithPlan(file) {
        const token = (state.plan?.token || 0) + 1;
        state = {
            ...state,
            session: state.open ? state.session : state.session + 1,
            open: true,
            minimized: false,
            plan: { file, name: file.name, token },
            lastPlan: file,
            status: 'connecting',
            stage: 'Opening Design & Build…',
            counts: null,
            error: null,
            furniture: null,
            furnished: null,
            renders: [],
            approvedRenderId: null,
            exportedAt: null,
            exportPanel: false,
            exporting: null,
            exportResult: null,
            exportError: null,
            // Custom items belong to the drawing they were set on (kept when the same plan reopens).
            customItems: state.plan?.file === file || state.lastPlan === file ? state.customItems : [],
        };
        emit();
    },
    /** Remember a plan PDF the user uploaded, so Design & Build can start from it in one click. */
    rememberPlan(file) {
        if (isPdfFile(file)) designBuild.set({ lastPlan: file });
    },
    minimize() {
        designBuild.set({ minimized: true });
    },
    restore() {
        designBuild.set({ minimized: false });
    },
    /** End the session; the 3D model is discarded. */
    close() {
        state = { ...initial, session: state.session, lastPlan: state.lastPlan, customItems: state.customItems, documents: state.documents };
        emit();
    },
    /**
     * Products of an applied offer (and the offer itself, for the export suite). Renders
     * made with earlier products stay to look at, but one must be approved again.
     */
    setProducts(products, offer = null) {
        designBuild.set({
            products,
            productsToken: state.productsToken + 1,
            ...(offer ? { offer } : {}),
            approvedRenderId: null,
            exportedAt: null,
        });
    },
    /** A custom item (name and picture) on one drawn furniture type that has no product line. */
    setCustomItem(item) {
        const others = state.customItems.filter((c) => c.typeId !== item.typeId);
        designBuild.set({
            customItems: [...others, item].slice(-MAX_CUSTOM_ITEMS),
            productsToken: state.productsToken + 1,
            approvedRenderId: null,
            exportedAt: null,
        });
    },
    removeCustomItem(typeId) {
        if (!state.customItems.some((c) => c.typeId === typeId)) return;
        designBuild.set({
            customItems: state.customItems.filter((c) => c.typeId !== typeId),
            productsToken: state.productsToken + 1,
            approvedRenderId: null,
            exportedAt: null,
        });
    },
    addRender(render) {
        const renders = [...state.renders.filter((r) => r.id !== render.id), render].slice(-MAX_RENDERS);
        const approvedRenderId = renders.some((r) => r.id === state.approvedRenderId) ? state.approvedRenderId : null;
        designBuild.set({ renders, approvedRenderId });
    },
    /** The render the client validated: the export suite is built around it. */
    approveRender(id) {
        designBuild.set({ approvedRenderId: state.renders.some((r) => r.id === id) ? id : null });
    },
    /** Show the export suite of the open session. */
    openExportSuite() {
        if (!state.open || (state.status !== 'ready' && !state.renders.some((r) => r.id === state.approvedRenderId))) return;
        designBuild.set({ minimized: false, exportPanel: true });
    },
    /** The open session tells the store how to make the package (null when it closes). */
    setExporter(fn) {
        exporter = typeof fn === 'function' ? fn : null;
    },
    /** BOQ Flow's table tells the store how to make its own documents (null when it closes). */
    setDocumentMaker(fn) {
        documentMaker = typeof fn === 'function' ? fn : null;
    },
    /** What BOQ Flow's table would add to the package ({ source }), for the export panel. */
    setDocumentsInfo(info) {
        if ((state.documents?.source || '') !== (info?.source || '')) designBuild.set({ documents: info?.source ? { source: info.source } : null });
    },
    /** BOQ Flow's offer, BOQ and submittals for the package ({ files, notes, source }), or null when its table is not open. */
    async makeDocuments(opts) {
        return documentMaker ? documentMaker(opts) : null;
    },
    setBoqEnricher(fn) {
        boqEnricher = typeof fn === 'function' ? fn : null;
    },
    setTablesGetter(fn) {
        tablesGetter = typeof fn === 'function' ? fn : null;
    },
    getActiveTables() {
        if (state.offer?.tables?.length) return state.offer.tables;
        return typeof tablesGetter === 'function' ? (tablesGetter() || []) : [];
    },
    applyBoqEnrichment(payload) {
        if (!boqEnricher) return false;
        const ok = boqEnricher(payload);
        if (ok) designBuild.set({ boqEnrichedAt: Date.now() });
        return !!ok;
    },
    /**
     * Make and save the package around the approved render: every folder that can be
     * made, as one .zip (or the `groups` asked for). Progress shows wherever the store
     * is shown: the modal, BOQ Flow's exports and the chip.
     */
    async downloadPackage(opts = {}) {
        if (!exporter || state.exporting) return false;
        if (state.status !== 'ready' && !state.renders.some((r) => r.id === state.approvedRenderId)) return false;
        designBuild.set({ exporting: { label: 'Collecting the model from Design & Build…' }, exportError: null });
        try {
            const res = await exporter({ ...opts, onProgress: (label) => designBuild.set({ exporting: { label: String(label || '') } }) });
            designBuild.set({ exporting: null, exportedAt: Date.now(), exportResult: { ...res, at: Date.now() } });
            return true;
        } catch (e) {
            designBuild.set({ exporting: null, exportError: e?.message || String(e) });
            return false;
        }
    },
};

export function useDesignBuild() {
    return useSyncExternalStore(designBuild.subscribe, designBuild.getState);
}

const cellValue = (row, i) => {
    if (!(i >= 0)) return undefined;
    const c = row?.cells?.[i];
    return c && typeof c === 'object' ? c.value : c;
};

const VE_COLUMNS = { sn: 0, image: 1, description: 2, brand: 3, model: 4, qty: 5, unit: 6, rate: 7, amount: 8 };
/** A line's own reference column: Sr., S/N, S.No., Sl. No, No., #, Ref, Item No., Item Code, Code. */
const REF_HEADER = /^(s\s*[./]?\s*n\.?(o\.?)?|sr\.?(\s*no\.?)?|sl\.?(\s*no\.?)?|no\.?|#|ref(erence)?\.?(\s*no\.?)?|item\s*(no\.?|code)|code)$/i;
const MB_COLUMNS = { sn: 0, image: 1, description: 2, brand: -1, model: -1, qty: 3, unit: 4, rate: 5, amount: 6 };

/**
 * Where an offer table keeps each field: by its header when it has one, otherwise by
 * its layout (Value Engineered offers have 9 columns, Multi-Budget offers 7).
 */
export function offerColumns(table) {
    const header = (table?.header || []).map((h) => String(h || '').replace(/\s+/g, ' ').trim());
    if (header.length >= 5) {
        const find = (re, not) => header.findIndex((h) => re.test(h) && !(not && not.test(h)));
        const described = find(/description|particulars|specification/i);
        // "Item No." / "Item code" columns are not the description.
        const description = described >= 0 ? described : find(/item|product/i, /\bno\b|no\.|number|code|ref|#/i);
        // The line's reference; an "Item" column next to a description is one too. None (a plan
        // analysis starts with Location): the export numbers the lines.
        let sn = header.findIndex((h) => REF_HEADER.test(h));
        if (sn < 0) sn = header.findIndex((h, i) => /^item$/i.test(h) && i !== description);
        return {
            sn,
            image: find(/image|photo|picture/i, /brand|logo/i),
            description,
            brand: find(/brand|manufacturer|make/i),
            model: find(/model/i),
            qty: find(/qty|quantity/i),
            unit: find(/^(unit|uom|u\.?o\.?m\.?)$/i),
            rate: find(/rate|price/i, /amount|total/i),
            amount: find(/amount|total/i, /qty|quantity/i),
        };
    }
    const cells = (table?.rows || []).find((r) => Array.isArray(r?.cells))?.cells?.length || 0;
    return cells >= 9 ? VE_COLUMNS : MB_COLUMNS;
}

const amountOf = (v) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0;

/**
 * Parses BOQ / fabrication dimension strings into metres (`{ w, d, h }`), clamped to Design & Build's
 * bridge bounds (`0.05 < v < 30`, `h < 4`). Returns `undefined` if no valid footprint exists.
 */
export function parseDimsMetres(text) {
    const s = String(text || '').replace(/,/g, '.');
    if (!s) return undefined;
    const toM = (val, unit, hint) => {
        const u = (unit || '').toLowerCase();
        if (u === 'mm') return val / 1000;
        if (u === 'cm') return val / 100;
        if (u === 'm') return val;
        return hint >= 100 ? val / 1000 : hint >= 10 ? val / 100 : val;
    };
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const clampSide = (v) => Number.isFinite(v) && v > 0.05 && v < 30;
    const box = s.match(/(\d+(?:\.\d+)?)\s*(mm|cm|m)?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)?(?:\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)?)?/i);
    if (box) {
        const tailUnit = box[6] || box[4] || box[2];
        const a = toM(parseFloat(box[1]), box[2] || tailUnit, parseFloat(box[1]));
        const b = toM(parseFloat(box[3]), box[4] || tailUnit, parseFloat(box[3]));
        const c = box[5] ? toM(parseFloat(box[5]), box[6] || tailUnit, parseFloat(box[5])) : undefined;
        if (clampSide(a) && clampSide(b)) {
            return {
                w: r3(Math.max(a, b)),
                d: r3(Math.min(a, b)),
                ...(c && c > 0.05 && c < 4 ? { h: r3(c) } : {}),
            };
        }
    }
    const dia = s.match(/(?:Ø|ø|⌀|dia(?:meter)?\.?)\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)?/i);
    if (dia) {
        const n = parseFloat(dia[1]);
        const m = toM(n, dia[2], n);
        if (clampSide(m)) return { w: r3(m), d: r3(m) };
    }
    return undefined;
}

const cellPicture = (c) => (c && typeof c === 'object' ? extractImageUrl(c.image) || extractImageUrl(c.images?.[0]) || '' : '');

/**
 * The product picture of a line: its image column, else the first picture in the line
 * (extracted tables keep pictures wherever the BOQ had them), never a brand logo.
 */
function rowPicture(row, col, header) {
    const own = cellPicture(row.cells[col.image >= 0 ? col.image : 1]);
    if (own) return own;
    for (let i = 0; i < row.cells.length; i++) {
        if (i === col.description || /brand|logo/i.test(String(header?.[i] || ''))) continue;
        const url = cellPicture(row.cells[i]);
        if (url) return url;
    }
    return '';
}

/**
 * Product lines of an applied offer (Value Engineered or Multi-Budget): one per BOQ
 * line, with its own words, category, chosen brand and model, picture and quantity.
 * Option lines and set components are left out.
 */
export function productsFromTables(tables) {
    const out = [];
    (tables || []).forEach((table, t) => {
        const col = offerColumns(table);
        (table?.rows || []).forEach((row, r) => {
            if (!row || row.isOptionRow || row.isSetSubItem || !Array.isArray(row.cells) || row.cells.length < 5) return;
            const qty = amountOf(cellValue(row, col.qty));
            const offerText = String(cellValue(row, col.description) || '').trim();
            const description = String(row.sourceDescription || offerText).trim();
            if (!description || !(qty > 0)) return;
            const imageRef = rowPicture(row, col, table?.header);
            const productUrl = String(row.productUrl || '');
            const rate = amountOf(cellValue(row, col.rate));
            const amount = amountOf(cellValue(row, col.amount));
            const isCustomFab = row.fulfillmentType === 'custom_fabrication' || /custom\s*fab/i.test(String(row.scope || '')) || /custom\s*fab/i.test(String(cellValue(row, col.brand) || row.selectedBrand || ''));
            const dims = parseDimsMetres(row.dimensionsMm || row.dimensions || '') || parseDimsMetres(description) || parseDimsMetres(offerText);
            const brand = String(cellValue(row, col.brand) || row.selectedBrand || (isCustomFab ? 'Custom Fabrication' : ''));
            const model = String(cellValue(row, col.model) || row.selectedModel || '');
            const unitStr = String(cellValue(row, col.unit) || '');
            const categoryStr = [row.selectedMainCat, row.selectedSubCat, row.categoryHint].filter(Boolean).join(' / ');
            const code = String(row.code || row.skuCode || resolveFitoutSkuCode({ code: row.code, model, description, productText: offerText }) || '');
            const finishes = resolveItemFinishes({
                brand,
                code,
                model,
                description,
                productText: offerText,
                category: categoryStr,
                materialSpec: row.materialSpec || '',
                finishes: row.finishes,
            });
            const placeable3D = isPlaceable3DProduct({
                brand,
                code,
                category: categoryStr,
                description,
                unit: unitStr,
                fulfillmentType: row.fulfillmentType,
                designBuildKind: row.designBuildKind,
            });
            const architecturalRole = inferArchitecturalRole({
                brand,
                code,
                category: categoryStr,
                description,
                fulfillmentType: row.fulfillmentType,
                designBuildKind: row.designBuildKind,
                subtype: row.designBuildSubtype || '',
            });
            out.push({
                id: `t${t}r${r}`,
                description: description.slice(0, 1000),
                sourceDescription: String(row.sourceDescription || description).slice(0, 1000),
                qty,
                unit: unitStr,
                location: row.location || '',
                category: categoryStr,
                brand,
                model,
                code,
                finishes,
                placeable3D,
                ...(row.designBuildSubtype ? { subtype: row.designBuildSubtype } : {}),
                ...(architecturalRole ? { architecturalRole } : {}),
                // Sent as is when it is a link; prepareProductPictures turns any picture into a thumbnail.
                imageUrl: /^https?:\/\//i.test(imageRef) ? imageRef : '',
                imageRef,
                productUrl: /^https?:\/\//i.test(productUrl) ? productUrl : '',
                productText: offerText,
                sn: col.sn >= 0 ? String(cellValue(row, col.sn) ?? '') : '',
                rate,
                amount,
                section: row.sectionLabel || row.sectionCategory || table.sheetName || '',
                ...(dims ? { dims } : {}),
                ...(isCustomFab ? {
                    fulfillmentType: 'custom_fabrication',
                    fabricationId: row.fabricationId || '',
                    skuCode: row.skuCode || code,
                    designBuildKind: row.designBuildKind || '',
                    shape: row.shape || '',
                    dimensionsMm: row.dimensionsMm || row.dimensions || '',
                    materialSpec: row.materialSpec || '',
                    workshopTrade: row.workshopTrade || 'Joinery',
                    leadTimeDays: Number(row.leadTimeDays) || 21,
                } : {}),
            });
        });
    });
    return out;
}

const THUMB_LIMIT = 80;
const THUMB_CONCURRENCY = 6;

/**
 * Small inline pictures of the products, so Design & Build can show them to the
 * render model without reaching each site itself (BOQ Flow's own loader handles
 * uploads, local pictures and sites that need its image proxy).
 */
export async function prepareProductPictures(products) {
    const out = products.map((p) => ({ ...p }));
    const todo = out.filter((p) => p.imageRef).slice(0, THUMB_LIMIT);
    let next = 0;
    const worker = async () => {
        while (next < todo.length) {
            const p = todo[next++];
            try {
                const img = await Promise.race([
                    loadExportImageData(p.imageRef, { maxWidth: 512, format: 'image/jpeg', quality: 0.82 }),
                    new Promise((resolve) => setTimeout(() => resolve(null), 12000)),
                ]);
                if (img?.dataUrl && img.dataUrl.length < 600000) p.imageUrl = img.dataUrl;
            } catch {
                // keep the link (or no picture)
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(THUMB_CONCURRENCY, todo.length) }, worker));
    return out;
}

/**
 * Custom items as product lines for Design & Build: each is set on its drawn type, with
 * the user's picture, and is listed as a custom item in the export suite.
 */
export function customProducts(items) {
    return (items || []).map((c) => {
        const qty = Math.max(1, Number(c.count) || 1);
        const rate = Math.max(0, Number(c.rate) || 0);
        const amount = rate > 0 ? Math.round(rate * qty * 100) / 100 : 0;
        const dims = (c.widthM > 0.05 && c.depthM > 0.05 && c.widthM < 30 && c.depthM < 30)
            ? { w: Math.round(Math.max(c.widthM, c.depthM) * 1000) / 1000, d: Math.round(Math.min(c.widthM, c.depthM) * 1000) / 1000 }
            : parseDimsMetres(c.size || c.materialSpec || '');
        return {
            id: `custom-${c.typeId}`,
            description: (c.materialSpec ? `${c.name || c.kind || 'Custom item'} — ${c.materialSpec}` : `Custom ${c.name || c.kind || 'item'}`).slice(0, 300),
            qty,
            unit: c.unit || 'Nos',
            location: '',
            category: c.category || 'Custom Fabrication',
            brand: c.brand || 'Custom Fabrication',
            model: String(c.name || c.kind || 'Custom item').slice(0, 120),
            code: c.skuCode || '',
            placeable3D: true,
            finishes: resolveItemFinishes({
                brand: c.brand || 'Custom Fabrication',
                code: c.skuCode || '',
                model: String(c.name || c.kind || 'Custom item'),
                description: c.materialSpec || '',
                finishes: c.finishes,
            }),
            imageUrl: typeof c.picture === 'string' ? c.picture : '',
            imageRef: typeof c.picture === 'string' ? c.picture : '',
            productUrl: '',
            productText: c.materialSpec || '',
            sn: c.skuCode || '',
            rate,
            amount,
            section: 'Custom Fabrication',
            ...(dims ? { dims } : {}),
            ...(c.isZone
                ? { customZoneId: c.typeId, subtype: c.subtype || 'rotunda-canopy', architecturalRole: 'ceiling-feature' }
                : (c.isWallTarget || c.typeId === 'arch_walls')
                    ? {
                        customZoneId: 'arch_walls',
                        subtype: c.subtype || 'wall-cladding',
                        architecturalRole: (c.subtype === 'wall-art' || /^FAB-ART-/i.test(c.skuCode || '')) ? 'wall-artwork' : 'wall-cladding',
                    }
                    : { typeId: c.typeId }),
            ...(c.subtype ? { subtype: c.subtype } : {}),
            custom: true,
            fulfillmentType: 'custom_fabrication',
            fabricationId: c.fabricationId || '',
            skuCode: c.skuCode || '',
            designBuildKind: c.isZone ? 'ceiling' : (c.isWallTarget || c.typeId === 'arch_walls') ? 'screen' : (c.kind || ''),
            dimensionsMm: c.size || '',
            materialSpec: c.materialSpec || '',
            workshopTrade: c.workshopTrade || 'Joinery',
            leadTimeDays: Number(c.leadTimeDays) || 21,
        };
    });
}

/** A picture file as a small JPEG data URL (for custom items), or null. */
export async function smallPicture(file, maxSide = 512) {
    if (!file || !/^image\//.test(file.type || '')) return null;
    const url = URL.createObjectURL(file);
    try {
        const img = new Image();
        img.src = url;
        await img.decode();
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
        c.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
        const ctx = c.getContext('2d');
        if (!ctx) return null;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', 0.85);
    } catch {
        return null;
    } finally {
        URL.revokeObjectURL(url);
    }
}

/** What goes to Design & Build for one product line (local fields stay here). */
export function productForBridge(p) {
    const { imageRef: _ref, productUrl: _url, productText: _text, sn: _sn, rate: _rate, amount: _amount, section: _section, custom: _custom, ...rest } = p;
    return rest;
}

export function isPdfFile(file) {
    return !!file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''));
}

if (import.meta.env?.DEV && typeof window !== 'undefined') {
    window.__boqDesignBuild = designBuild;
}
