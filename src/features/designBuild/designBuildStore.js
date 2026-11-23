// Design & Build link: one small shared store for the Design & Build modal, so the
// modal (and the 3D model inside it) survives BOQ Flow's own page changes. The
// modal itself is mounted once, next to the app (see DesignBuildDock).
import { useSyncExternalStore } from 'react';
import { extractImageUrl, loadExportImageData } from '../../utils/urlUtils';

export const DESIGN_BUILD_URL = String(import.meta.env.VITE_DESIGN_BUILD_URL || 'https://design-and-build-v2.vercel.app').replace(/\/+$/, '');

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
    furnished: null,    // { placedPieces, pieces, products, unplacedProductIds, colours }
    offer: null,        // { tables, title } of the applied offer, for the export suite
    renders: [],        // finished renders from Design & Build, newest last
    approvedRenderId: null,
    exportedAt: null,
    lastPlan: null,     // the last plan PDF uploaded (kept when a session closes), for one-click starts
    customItems: [],    // { typeId, name, kind, count, picture } set on drawn furniture without a product
};

/** Custom items at most (each carries a small picture). */
const MAX_CUSTOM_ITEMS = 24;

let state = { ...initial };
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());

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
        state = { ...initial, session: state.session, lastPlan: state.lastPlan, customItems: state.customItems };
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
        return {
            sn: 0,
            image: find(/image|photo|picture/i, /brand|logo/i),
            // "Item No." / "Item code" columns are not the description.
            description: described >= 0 ? described : find(/item|product/i, /\bno\b|no\.|number|code|ref|#/i),
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
            out.push({
                id: `t${t}r${r}`,
                description: description.slice(0, 1000),
                qty,
                unit: String(cellValue(row, col.unit) || ''),
                location: row.location || '',
                category: [row.selectedMainCat, row.selectedSubCat, row.categoryHint].filter(Boolean).join(' / '),
                brand: String(cellValue(row, col.brand) || row.selectedBrand || ''),
                model: String(cellValue(row, col.model) || row.selectedModel || ''),
                // Sent as is when it is a link; prepareProductPictures turns any picture into a thumbnail.
                imageUrl: /^https?:\/\//i.test(imageRef) ? imageRef : '',
                imageRef,
                productUrl: /^https?:\/\//i.test(productUrl) ? productUrl : '',
                productText: offerText,
                sn: String(cellValue(row, col.sn) ?? ''),
                rate: amountOf(cellValue(row, col.rate)),
                amount: amountOf(cellValue(row, col.amount)),
                section: row.sectionLabel || row.sectionCategory || table.sheetName || '',
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
    return (items || []).map((c) => ({
        id: `custom-${c.typeId}`,
        description: `Custom ${c.name || c.kind || 'item'}`.slice(0, 300),
        qty: Math.max(1, Number(c.count) || 1),
        unit: 'Nos',
        location: '',
        category: 'Custom item',
        brand: 'Custom',
        model: String(c.name || c.kind || 'Custom item').slice(0, 120),
        imageUrl: typeof c.picture === 'string' ? c.picture : '',
        imageRef: typeof c.picture === 'string' ? c.picture : '',
        productUrl: '',
        productText: '',
        sn: '',
        rate: 0,
        amount: 0,
        section: 'Custom items',
        typeId: c.typeId,
        custom: true,
    }));
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

if (import.meta.env.DEV && typeof window !== 'undefined') {
    window.__boqDesignBuild = designBuild;
}
