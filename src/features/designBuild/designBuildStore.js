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

const AUTO_KEY = 'boqflow.designBuild.auto';
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
};

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
            status: 'connecting',
            stage: 'Opening Design & Build…',
            counts: null,
            error: null,
            furniture: null,
            furnished: null,
            renders: [],
            approvedRenderId: null,
            exportedAt: null,
        };
        emit();
    },
    minimize() {
        designBuild.set({ minimized: true });
    },
    restore() {
        designBuild.set({ minimized: false });
    },
    /** End the session; the 3D model is discarded. */
    close() {
        state = { ...initial, session: state.session };
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
        return {
            sn: 0,
            image: find(/image|photo|picture/i),
            description: find(/description|item|product/i),
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
            const imageCell = row.cells[col.image >= 0 ? col.image : 1] || {};
            const imageRef = extractImageUrl(imageCell.image) || extractImageUrl(imageCell.images?.[0]) || '';
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
                    loadExportImageData(p.imageRef, { maxWidth: 384, format: 'image/jpeg', quality: 0.8 }),
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

/** What goes to Design & Build for one product line (local fields stay here). */
export function productForBridge(p) {
    const { imageRef: _ref, productUrl: _url, productText: _text, sn: _sn, rate: _rate, amount: _amount, section: _section, ...rest } = p;
    return rest;
}

export function isPdfFile(file) {
    return !!file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''));
}

/** Whether plan uploads also open Design & Build (on unless the user turned it off). */
export function getAutoDesignBuild() {
    try {
        return localStorage.getItem(AUTO_KEY) !== 'off';
    } catch {
        return true;
    }
}

export function setAutoDesignBuild(on) {
    try {
        localStorage.setItem(AUTO_KEY, on ? 'on' : 'off');
    } catch {
        // storage unavailable: the choice lasts for this visit only
    }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
    window.__boqDesignBuild = designBuild;
}
