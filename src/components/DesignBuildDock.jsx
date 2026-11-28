import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    designBuild,
    useDesignBuild,
    customProducts,
    productsFromTables,
    prepareProductPictures,
    productForBridge,
    smallPicture,
    DESIGN_BUILD_URL,
    DESIGN_BUILD_ORIGIN,
} from '../features/designBuild/designBuildStore';
import DesignBuildExportPanel from './DesignBuildExportPanel';
import ProjectSettingsPanel from './ProjectSettingsPanel';
import { useCompanyProfile } from '../context/CompanyContext';
import { useProject } from '../context/ProjectContext';
import { getApiBase } from '../utils/apiBase';
import { SUITE_GROUPS, buildExportSuite, saveExportSuite } from '../features/designBuild/exportSuite';
import { suiteGroupState } from '../features/designBuild/exportGroups';
import { buildGeometricEnrichmentPlan } from '../features/boq/geometricBoqEnricher';
import styles from '../styles/DesignBuildDock.module.css';

// Design & Build express modal. Design & Build runs inside an iframe in its
// "express" mode; the two apps talk by postMessage only (origin-checked both
// ways). The modal can tuck into a chip, which keeps the 3D model loaded while
// the user carries on in BOQ Flow (for example in a Value Engineered offer).
// On a phone the 3D model gets the screen: one slim header row with the steps,
// and the status under it folds to a bar while the user chats, prompts or
// watches a render in Design & Build. "Continue in BOQ Flow" takes the newest
// render (unless one is approved) for the package, which then downloads from
// here, from BOQ Flow's exports and from the chip.

const BRIDGE = { source: 'boqflow', v: 1 };
const READY_TIMEOUT_MS = 30000;
const ARTIFACTS_TIMEOUT_MS = 45000;
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp);base64,/i;
const VIEW_LABEL = { cutaway: '3D cutaway', 'eye-level': 'Eye-level view', interior: 'Interior view' };

const STEPS = [
    { key: 'model', label: '3D model' },
    { key: 'enrich', label: 'Enrich BOQ' },
    { key: 'furnish', label: 'Furnish' },
    { key: 'render', label: 'Render' },
    { key: 'export', label: 'Export suite' },
];

function describeProgress(m) {
    if (m.state === 'project-ready') return 'Finishing the model…';
    const stage = typeof m.stage === 'string' && m.stage ? m.stage : 'Building the 3D model';
    const walls = m.total > 0 ? ` · ${Math.min(m.committed, m.total)} of ${m.total} walls` : '';
    return `${stage}${walls}`;
}

function describeCounts(c) {
    if (!c) return '';
    const glass = c.glassWalls ? ` (${c.glassWalls} glass)` : '';
    return `${c.walls} walls${glass} · ${c.windows} windows · ${c.doors} doors`;
}

function describeFurnished(f, products) {
    const withProduct = (f.products || []).filter((m) => m.placed > 0).length;
    // Lines that are not furniture (finishes, lights…) are left out of the count.
    const notFurniture = Array.isArray(f.unplacedFurnitureIds)
        ? Math.max(0, (f.unplacedProductIds || []).length - f.unplacedFurnitureIds.length)
        : 0;
    const lines = Math.max(withProduct, products.length - notFurniture);
    const photos = f.withPhotos ? ` · ${f.withPhotos === withProduct ? 'all' : f.withPhotos} shown by their own photo` : '';
    return `Furnished · ${f.placedPieces} of ${f.pieces} drawn pieces carry ${withProduct} of ${lines} furniture products${photos}`;
}

const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Phones and small tablets: the status folds to a bar so the 3D model has the screen. */
function isCompact() {
    try {
        return window.matchMedia('(max-width: 900px)').matches;
    } catch {
        return false;
    }
}

const KIND_LABEL = {
    seat: 'Chair', sofa: 'Sofa', table: 'Table', 'side-table': 'Side table', desk: 'Desk', bed: 'Bed',
    storage: 'Storage', plant: 'Plant', screen: 'Screen', sanitary: 'Sanitary fitting', equipment: 'Equipment',
    joinery: 'Joinery', unknown: 'Furniture',
};
const SUBTYPE_LABEL = {
    chair: 'Chair', armchair: 'Armchair', stool: 'Stool', sofa: 'Sofa', 'l-sofa': 'L-shaped sofa',
    'curved-sofa': 'Curved sofa', bench: 'Bench', 'dining-table': 'Dining table', 'meeting-table': 'Meeting table',
    'coffee-table': 'Coffee table', 'side-table': 'Side table', desk: 'Desk', 'reception-counter': 'Reception counter',
    'retail-kiosk': 'Retail display kiosk', 'bar-counter': 'Bar counter', 'feature-column': 'Fluted column', 'slat-screen': 'Slat privacy screen',
    booth: 'Acoustic booth', banquette: 'Built-in banquette', 'wall-art': 'Wall artwork', 'wall-cladding': 'Wall cladding & artwork',
    'rotunda-canopy': 'Rotunda canopy ceiling', 'ceiling-bulkhead': 'Ceiling bulkhead / baffle',
    'single-bed': 'Single bed', 'double-bed': 'Double bed', cabinet: 'Cabinet', wardrobe: 'Wardrobe',
    credenza: 'Credenza', 'kitchen-counter': 'Kitchen counter', island: 'Kitchen island', shelving: 'Shelving',
    joinery: 'Joinery', wc: 'WC', basin: 'Basin', shower: 'Shower', bathtub: 'Bathtub', urinal: 'Urinal',
    plant: 'Plant', screen: 'Screen', appliance: 'Appliance', equipment: 'Equipment',
};
const kindLabel = (k, sub) => (sub && SUBTYPE_LABEL[sub]) || KIND_LABEL[k] || 'Furniture';
const TYPE_ID = /^[\w-]{1,40}$/;

/** The drawn furniture types (from Design & Build's schedule), checked field by field. */
function scheduleFromMessage(list) {
    if (!Array.isArray(list)) return [];
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    return list.slice(0, 400).filter((t) => t && typeof t === 'object').map((t) => ({
        typeId: typeof t.typeId === 'string' && TYPE_ID.test(t.typeId) ? t.typeId : '',
        kind: text(t.kind, 30),
        subtype: text(t.subtype, 30),
        customModel: !!t.customModel,
        shape: text(t.shape, 30),
        widthM: num(t.widthM),
        depthM: num(t.depthM),
        count: Math.max(0, Math.round(num(t.count))),
    }));
}

const sizeText = (t) => (t.widthM > 0 && t.depthM > 0 ? `${t.widthM.toFixed(t.widthM < 1 ? 2 : 1)} × ${t.depthM.toFixed(t.depthM < 1 ? 2 : 1)} m` : '');
const SHAPE_LABEL = { round: 'round', curved: 'curved', 'l-shape': 'L-shaped', free: 'free-form' };
const shapeText = (shape) => SHAPE_LABEL[shape] || '';
/** "Curved reception counter", "Round table", "Chair": a first name for a custom item. */
const defaultName = (t) => {
    const label = kindLabel(t.kind, t.subtype);
    if (t.subtype && SUBTYPE_LABEL[t.subtype]) return label;
    const shape = shapeText(t.shape);
    return shape ? `${shape.charAt(0).toUpperCase()}${shape.slice(1)} ${label.toLowerCase()}` : label;
};

const FAB_KIND_COMPAT = {
    desk: ['desk', 'table'],
    table: ['table', 'desk'],
    storage: ['storage', 'joinery'],
    joinery: ['joinery', 'storage'],
    sofa: ['sofa'],
    seat: ['sofa', 'seat'],
    screen: ['screen', 'storage'],
    plant: ['plant'],
    sanitary: ['sanitary', 'storage'],
};

const SUBTYPE_FAB_TERMS = {
    'reception-counter': ['reception', 'counter'],
    'retail-kiosk': ['kiosk', 'duty', 'vitrine', 'display'],
    'bar-counter': ['counter', 'island', 'bar'],
    'feature-column': ['column', 'fluted'],
    'slat-screen': ['slat', 'screen', 'divider', 'louver'],
    'rotunda-canopy': ['rotunda', 'canopy', 'slatted', 'ceiling'],
    'ceiling-bulkhead': ['ceiling', 'baffle', 'canopy'],
    'kitchen-counter': ['pantry', 'kitchenette'],
    island: ['island', 'waterfall', 'pantry'],
    cabinet: ['cabinet', 'locker', 'backwall'],
    credenza: ['credenza', 'tea', 'printer'],
    wardrobe: ['wardrobe', 'locker', 'full-height'],
    shelving: ['divider', 'display', 'shelving'],
    bench: ['banquette', 'bench'],
    booth: ['booth', 'acoustic booth', 'dining booth', 'banquette'],
    banquette: ['banquette', 'booth', 'bench'],
    'l-sofa': ['l-shape', 'banquette', 'booth'],
    'curved-sofa': ['curved', 'banquette', 'booth'],
    'meeting-table': ['boardroom', 'conference', 'boat'],
    basin: ['vanity', 'washroom'],
    'wall-art': ['artwork', 'wall artwork', 'bas-relief', 'gallery'],
    'wall-cladding': ['cladding', 'fluted', 'veneer', 'panel', 'artwork', 'bas-relief', 'feature wall'],
};

const normShape = (s) => (s === 'rect' ? 'rectangular' : String(s || '').toLowerCase());

function rankFabricationTemplates(templates, draft) {
    if (!Array.isArray(templates) || !draft) return [];
    const compat = FAB_KIND_COMPAT[draft.kind] || [];
    const subTerms = SUBTYPE_FAB_TERMS[draft.subtype] || [];
    const dShape = normShape(draft.shape);
    return templates
        .map((tpl) => {
            let score = 0;
            if (draft.subtype && tpl.design_build_subtype && tpl.design_build_subtype === draft.subtype) score += 14;
            if (draft.kind && tpl.design_build_kind === draft.kind) score += 10;
            else if (compat.includes(tpl.design_build_kind)) score += 5;
            if (dShape && normShape(tpl.shape) === dShape) score += 4;
            if (subTerms.length) {
                const hay = `${tpl.name || ''} ${tpl.category || ''} ${tpl.sub_category || ''} ${(tpl.detection_keywords || []).join(' ')}`.toLowerCase();
                if (subTerms.some((term) => hay.includes(term))) score += 8;
            }
            return { tpl, score };
        })
        .sort((a, b) => b.score - a.score)
        .filter((x, i) => x.score > 0 || i < 6)
        .slice(0, 6)
        .map((x) => x.tpl);
}

function zonesFromMessage(list) {
    if (!Array.isArray(list)) return [];
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    return list.slice(0, 50).filter((z) => z && typeof z === 'object' && typeof z.zoneId === 'string').map((z) => ({
        typeId: z.zoneId,
        zoneId: z.zoneId,
        kind: 'ceiling',
        subtype: text(z.kind, 40) || 'rotunda-canopy',
        shape: text(z.shape, 30) || 'round',
        widthM: num(z.widthM),
        depthM: num(z.depthM),
        count: 1,
        label: text(z.label, 80),
        customModel: true,
        isZone: true,
    }));
}

function freeZonesOf(zones, customItems) {
    const custom = new Map((customItems || []).map((c) => [c.typeId, c]));
    return (zones || [])
        .filter((z) => z.zoneId)
        .map((z) => ({ ...z, custom: custom.get(z.zoneId) || null }));
}

/**
 * Drawn furniture types that no offer line took: a custom item (a name and a photo)
 * can be set on each. Types already custom are listed too, to change them.
 */
function freeTypesOf(schedule, furnished, customItems) {
    const taken = new Set();
    for (const m of furnished?.products || []) {
        if (!m || String(m.productId || '').startsWith('custom-') || !(Number(m.placed) > 0)) continue;
        for (const id of m.typeIds || []) taken.add(id);
    }
    const custom = new Map((customItems || []).map((c) => [c.typeId, c]));
    return (schedule || [])
        .filter((t) => t.typeId && t.count > 0 && !taken.has(t.typeId))
        .map((t) => ({ ...t, custom: custom.get(t.typeId) || null }))
        .sort((a, b) => b.count - a.count);
}

/** A finished render from Design & Build, checked field by field. */
function renderFromMessage(m) {
    if (typeof m.image !== 'string' || !IMAGE_DATA_URL.test(m.image)) return null;
    const products = Array.isArray(m.products)
        ? m.products.slice(0, 24).map((p) => ({
            id: text(p?.id, 100),
            label: text(p?.label, 200),
            colour: /^#[0-9a-f]{6}$/i.test(p?.colour) ? p.colour : '',
            count: Number(p?.count) || 0,
            withPicture: !!p?.withPicture,
        }))
        : [];
    return {
        id: text(m.renderId, 80) || `render_${Date.now().toString(36)}`,
        image: m.image,
        width: Number(m.width) || 0,
        height: Number(m.height) || 0,
        viewKind: text(m.viewKind, 20),
        style: text(m.style, 20),
        tier: text(m.tier, 20),
        modelLabel: text(m.modelLabel, 80),
        score: Math.max(0, Math.min(1, Number(m.score) || 0)),
        products,
        at: Date.now(),
    };
}

/** The model's export material from Design & Build (pictures as inline images only). */
function artifactsFromMessage(m) {
    const views = Array.isArray(m.views)
        ? m.views
            .filter((v) => v && typeof v.image === 'string' && IMAGE_DATA_URL.test(v.image))
            .map((v) => ({ kind: ['current', 'top', 'top-plain', 'overview'].includes(v.kind) ? v.kind : 'current', image: v.image }))
        : [];
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const placements = Array.isArray(m.placements)
        ? m.placements.slice(0, 5000).filter((p) => p && typeof p.pieceId === 'string').map((p) => ({
            pieceId: text(p.pieceId, 60),
            kind: text(p.kind, 30),
            productId: typeof p.productId === 'string' ? text(p.productId, 100) : null,
            x: num(p.x),
            y: num(p.y),
            angleDeg: num(p.angleDeg),
            // which way the piece's front points on the plan, when the drawing shows it
            facingDeg: p.facingDeg !== null && p.facingDeg !== undefined && Number.isFinite(Number(p.facingDeg)) ? Number(p.facingDeg) : null,
            widthM: num(p.widthM),
            depthM: num(p.depthM),
        }))
        : [];
    return {
        planName: text(m.planName, 300),
        planImage: typeof m.planImage === 'string' && IMAGE_DATA_URL.test(m.planImage) ? m.planImage : null,
        views,
        placements,
        scene: typeof m.scene === 'string' && m.scene.length < 80_000_000 ? m.scene : '',
        counts: m.counts && typeof m.counts === 'object' ? m.counts : null,
        ...(m.takeoff && typeof m.takeoff === 'object' ? { takeoff: m.takeoff } : {}),
        ...(Array.isArray(m.zones) ? { zones: m.zones } : {}),
    };
}

/** The start of a text, cut at a word, with an ellipsis when cut. */
function shortText(t, max) {
    const s = String(t || '').replace(/\s+/g, ' ').trim();
    if (s.length <= max) return s;
    const cut = s.slice(0, max + 1).replace(/[\s,;:–—-]+\S*$/, '');
    return `${(cut.length > max * 0.5 ? cut : s.slice(0, max)).replace(/[\s,;:–—-]+$/, '')}…`;
}

/** The export suite panel lives in the store, so BOQ Flow's exports can open it too. */
const setExportOpen = (open) => designBuild.set({ exportPanel: !!open });

const productName = (p) => [p.brand, p.model].filter(Boolean).join(' ') || shortText(p.description, 36);

/** Furniture lines of the offer that found no place on the drawing (other lines are not furniture). */
function unplacedNames(f, products) {
    const byId = new Map(products.map((p) => [p.id, p]));
    const ids = Array.isArray(f.unplacedFurnitureIds) ? f.unplacedFurnitureIds : f.unplacedProductIds || [];
    return ids.map((id) => byId.get(id)).filter(Boolean).map(productName);
}

/**
 * The legend of the furnished model: each product placed on the drawing with its
 * picture, its colour in the model and how many pieces carry it against the offer.
 */
function legendOf(f, products) {
    if (!f) return [];
    const byId = new Map(products.map((p) => [p.id, p]));
    const colour = new Map((f.colours || []).map((c) => [c.id, c]));
    const rows = [];
    for (const m of f.products || []) {
        const p = byId.get(m?.productId);
        const placed = Number(m?.placed) || 0;
        if (!p || placed <= 0) continue;
        const qty = Number(p.qty) || Number(m.qty) || 0;
        const c = colour.get(p.id);
        const name = productName(p);
        const differs = qty > 0 && Math.round(qty) !== placed;
        // The model names the product; the brand is in the tooltip.
        const short = p.model || p.brand || shortText(p.description, 28);
        const note = !differs ? '' : placed > qty
            ? `The drawing shows ${placed}; the offer has ${qty}.`
            : `The drawing shows ${placed} of the offer's ${qty}.`;
        rows.push({
            id: p.id,
            custom: !!p.custom,
            typeId: p.typeId || '',
            name: short,
            picture: typeof p.imageRef === 'string' && p.imageRef ? p.imageRef : p.imageUrl || '',
            hex: c?.hex || '',
            placed,
            count: differs ? `${placed} of ${qty}` : `${placed}`,
            differs,
            title: [p.custom ? `${short} (custom item)` : name, c?.name ? `${c.name} in the model` : '', `${placed} placed`, note, 'Click to see where it stands.'].filter(Boolean).join(' · '),
        });
    }
    return rows.sort((a, b) => b.placed - a.placed);
}

export default function DesignBuildDock() {
    const s = useDesignBuild();
    if (!s.open) return null;
    // One component per session, so its handshake and local state start fresh.
    return <DockSession key={s.session} s={s} />;
}

function DockSession({ s }) {
    const iframeRef = useRef(null);
    const readyRef = useRef(false);
    const sentPlanRef = useRef(0);
    const sentProductsRef = useRef(0);
    const pendingArtifactsRef = useRef(new Map());
    const [frameKey, setFrameKey] = useState(0);
    const [confirmClose, setConfirmClose] = useState(false);
    const [timedOut, setTimedOut] = useState(false);
    const [reviewId, setReviewId] = useState(null);
    const exportOpen = s.exportPanel;
    // The product shown in the model from the legend (Design & Build frames its pieces),
    // for the furnishing it was picked in: a new furnishing has none in focus.
    const [focus, setFocus] = useState({ id: null, of: null });
    const focusId = focus.of && focus.of === s.furnished ? focus.id : null;
    const [brokenPictures, setBrokenPictures] = useState(() => new Set());
    // Custom item picker: the list of drawn types without a product, then one type's form.
    const [customOpen, setCustomOpen] = useState(false);
    const [enrichOpen, setEnrichOpen] = useState(false);
    const [enrichDraft, setEnrichDraft] = useState(null);
    const [draft, setDraft] = useState(null);
    const [draftBusy, setDraftBusy] = useState(false);
    const [fabTemplates, setFabTemplates] = useState([]);
    const customFileRef = useRef(null);
    // The status, products and actions under the model: folded to a bar on phones.
    const [sheetOpen, setSheetOpen] = useState(() => !isCompact());
    // The company profile and project details brand the package; the project drawer opens from it.
    const company = useCompanyProfile();
    const { project } = useProject();
    const [projectOpen, setProjectOpen] = useState(false);
    const brandingRef = useRef(null);
    useEffect(() => {
        brandingRef.current = {
            brand: {
                company: company.companyName,
                website: company.website,
                logo: company.logoOriginal || company.logoWhite || null,
                logoWhite: company.logoWhite || null,
                logoIsLight: !!company.logo?.isLight,
            },
            project,
        };
    });

    const post = useCallback((type, payload = {}) => {
        const win = iframeRef.current?.contentWindow;
        if (!win) return false;
        win.postMessage({ ...BRIDGE, type, ...payload }, DESIGN_BUILD_ORIGIN);
        return true;
    }, []);

    const sendPlanIfNeeded = useCallback(() => {
        const plan = designBuild.getState().plan;
        if (!readyRef.current || !plan || plan.token === sentPlanRef.current) return;
        if (post('plan', { file: plan.file, name: plan.name })) {
            sentPlanRef.current = plan.token;
            designBuild.set({ status: 'building', stage: 'Reading the drawing…', error: null });
        }
    }, [post]);

    // Products of the applied offer go to the finished model to furnish it, with small
    // pictures of each product (the renders use them to show the real products).
    const sendProductsIfNeeded = useCallback(async () => {
        const st = designBuild.getState();
        // The offer's lines, and the custom items set on drawn furniture without a line.
        const all = [...st.products, ...customProducts(st.customItems)];
        if (!readyRef.current || st.status !== 'ready' || !all.length || st.productsToken === sentProductsRef.current) return;
        const token = st.productsToken;
        sentProductsRef.current = token;
        designBuild.set({ stage: `Preparing pictures of ${all.length} products…` });
        let items = all;
        try {
            items = await prepareProductPictures(all);
        } catch {
            // send the links only
        }
        if (designBuild.getState().productsToken !== token) return; // newer products go instead
        if (post('products', { items: items.map(productForBridge) })) {
            designBuild.set({ stage: `Furnishing with ${items.length} products…` });
        }
    }, [post]);

    /** Ask Design & Build for the model's export material (views, scene, counts). */
    const requestArtifacts = useCallback(() => new Promise((resolve) => {
        const requestId = `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
        const timer = window.setTimeout(() => {
            pendingArtifactsRef.current.delete(requestId);
            resolve(null);
        }, ARTIFACTS_TIMEOUT_MS);
        pendingArtifactsRef.current.set(requestId, (data) => {
            window.clearTimeout(timer);
            resolve(data);
        });
        if (!readyRef.current || !post('artifacts', { requestId })) {
            window.clearTimeout(timer);
            pendingArtifactsRef.current.delete(requestId);
            resolve(null);
        }
    }), [post]);

    // The package needs this session's views: the store calls this from the modal,
    // BOQ Flow's exports and the chip alike.
    useEffect(() => {
        designBuild.setExporter(async ({ groups, asZip = true, suffix, onProgress } = {}) => {
            onProgress?.('Collecting the model from Design & Build…');
            const artifacts = await requestArtifacts();
            const st = designBuild.getState();
            const activeTables = st.offer?.tables?.length ? st.offer.tables : designBuild.getActiveTables();
            const effectiveOffer = st.offer?.tables?.length
                ? st.offer
                : (activeTables.length ? { tables: activeTables, title: st.documents?.source || 'Extracted BOQ' } : null);
            const effectiveProducts = st.products.length ? st.products : (activeTables.length ? productsFromTables(activeTables) : []);
            const effectiveTakeoff = artifacts?.takeoff || st.takeoff;
            const effectiveState = { ...st, offer: effectiveOffer, products: effectiveProducts, takeoff: effectiveTakeoff };
            const keys = Array.isArray(groups) && groups.length
                ? groups
                : SUITE_GROUPS.filter((g) => suiteGroupState(g, effectiveState).ok).map((g) => g.key);
            // BOQ Flow's own offer, BOQ and submittals, from its table's generators.
            const documents = keys.includes('boq') || keys.includes('submittals')
                ? await designBuild.makeDocuments({ onProgress }).catch((e) => ({ files: [], notes: [`BOQ Flow's documents could not be made (${e?.message || e}).`] }))
                : null;
            const result = await buildExportSuite(
                {
                    plan: st.plan,
                    artifacts,
                    takeoff: effectiveTakeoff,
                    products: [...effectiveProducts, ...customProducts(st.customItems)],
                    furnished: st.furnished,
                    furniture: st.furniture,
                    renders: st.renders,
                    approvedRenderId: st.approvedRenderId,
                    offer: effectiveOffer,
                    counts: st.counts,
                    documents,
                    ...brandingRef.current,
                },
                { groups: keys, onProgress },
            );
            if (!result.files.length) throw new Error(result.notes[0] || 'Nothing to export yet.');
            onProgress?.('Saving…');
            await saveExportSuite(result, { asZip, suffix });
            return { files: result.files.length, asZip, notes: result.notes, viewsMissing: !artifacts };
        });
        return () => designBuild.setExporter(null);
    }, [requestArtifacts]);

    // On a phone, tapping into Design & Build (the model, the chat, a prompt) folds the status.
    useEffect(() => {
        const onBlur = () => window.setTimeout(() => {
            if (document.activeElement === iframeRef.current && isCompact()) setSheetOpen(false);
        }, 0);
        window.addEventListener('blur', onBlur);
        return () => window.removeEventListener('blur', onBlur);
    }, []);

    // Messages from Design & Build: only from its origin, and only from our iframe.
    useEffect(() => {
        const onMessage = (e) => {
            if (e.origin !== DESIGN_BUILD_ORIGIN || e.source !== iframeRef.current?.contentWindow) return;
            const m = e.data;
            if (!m || m.source !== 'design-build' || m.v !== 1 || typeof m.type !== 'string') return;
            switch (m.type) {
                case 'ready':
                    readyRef.current = true;
                    setTimedOut(false);
                    sendPlanIfNeeded();
                    break;
                case 'progress':
                    if (designBuild.getState().status !== 'ready') {
                        designBuild.set({ status: 'building', stage: describeProgress(m) });
                    }
                    break;
                case 'model-ready':
                    designBuild.set({
                        status: 'ready',
                        stage: '',
                        counts: m.counts || null,
                        ...(m.takeoff ? { takeoff: m.takeoff } : {}),
                        error: null,
                    });
                    sendProductsIfNeeded();
                    break;
                case 'furniture-ready':
                    designBuild.set({
                        furniture: {
                            pieces: Number(m.pieces) || 0,
                            schedule: scheduleFromMessage(m.schedule),
                            zones: zonesFromMessage(m.zones),
                        },
                        ...(m.takeoff ? { takeoff: m.takeoff } : {}),
                    });
                    break;
                case 'furnished':
                    designBuild.set({
                        stage: '',
                        furnished: {
                            placedPieces: Number(m.placedPieces) || 0,
                            pieces: Number(m.pieces) || 0,
                            withPhotos: Number(m.withPhotos) || 0,
                            products: Array.isArray(m.products) ? m.products : [],
                            unplacedProductIds: Array.isArray(m.unplacedProductIds) ? m.unplacedProductIds : [],
                            ...(Array.isArray(m.unplacedFurnitureIds) ? { unplacedFurnitureIds: m.unplacedFurnitureIds } : {}),
                            colours: Array.isArray(m.colours)
                                ? m.colours
                                    .filter((c) => c && typeof c.id === 'string' && /^#[0-9a-f]{6}$/i.test(c.hex))
                                    .map((c) => ({ id: c.id, hex: c.hex, name: text(c.name, 30) }))
                                : [],
                        },
                    });
                    break;
                case 'render-ready': {
                    const render = renderFromMessage(m);
                    if (render) designBuild.addRender(render);
                    break;
                }
                case 'artifacts': {
                    const done = pendingArtifactsRef.current.get(m.requestId);
                    if (m.takeoff) designBuild.set({ takeoff: m.takeoff });
                    if (done) {
                        pendingArtifactsRef.current.delete(m.requestId);
                        done(artifactsFromMessage(m));
                    }
                    break;
                }
                case 'error':
                    designBuild.set({ error: String(m.message || 'Design & Build reported a problem.').slice(0, 400) });
                    break;
                case 'ui':
                    // The user chats, types a prompt or watches a render there: on a phone the status makes room.
                    if (isCompact() && (m.panel || m.composing || m.rendering)) setSheetOpen(false);
                    break;
                default:
                    break;
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [sendPlanIfNeeded, sendProductsIfNeeded]);

    // Products arrive (an offer was applied) or the model became ready: furnish.
    useEffect(() => {
        sendProductsIfNeeded();
    }, [s.status, s.productsToken, sendProductsIfNeeded]);

    // Another plan uploaded while the session is open: send it on.
    useEffect(() => {
        sendPlanIfNeeded();
    }, [s.plan?.token, sendPlanIfNeeded]);

    // Design & Build should answer within seconds; say so if it does not.
    useEffect(() => {
        const id = window.setTimeout(() => {
            if (!readyRef.current) setTimedOut(true);
        }, READY_TIMEOUT_MS);
        return () => window.clearTimeout(id);
    }, [frameKey]);

    const retry = useCallback(() => {
        readyRef.current = false;
        sentPlanRef.current = 0;
        sentProductsRef.current = 0;
        setTimedOut(false);
        designBuild.set({ status: 'connecting', stage: 'Opening Design & Build…', error: null, counts: null });
        setFrameKey((k) => k + 1);
    }, []);

    /** Show where a product stands in the model (again: the whole model). */
    const focusProduct = useCallback((id) => {
        const next = focusId === id ? null : id;
        setReviewId(null);
        setExportOpen(false);
        if (post('focus-product', { productId: next })) setFocus({ id: next, of: designBuild.getState().furnished });
    }, [focusId, post]);

    /** Show where the pieces of a drawn type stand while a custom item is set on them. */
    const focusType = useCallback((typeId) => {
        if (post('focus-type', { typeId: typeId || null })) setFocus({ id: null, of: null });
    }, [post]);

    const openCustom = useCallback(() => {
        setReviewId(null);
        setExportOpen(false);
        setDraft(null);
        setCustomOpen((o) => {
            const next = !o;
            if (next && fabTemplates.length === 0) {
                fetch(`${getApiBase()}/api/fabrication-catalog`)
                    .then((r) => (r.ok ? r.json() : null))
                    .then((data) => {
                        if (data && Array.isArray(data.items)) setFabTemplates(data.items);
                    })
                    .catch(() => {});
            }
            return next;
        });
    }, [fabTemplates.length]);

    const closeCustom = useCallback(() => {
        setCustomOpen(false);
        setDraft(null);
        focusType(null);
    }, [focusType]);

    const pickType = useCallback((t) => {
        setDraft({
            typeId: t.typeId,
            isZone: !!t.isZone,
            isWallTarget: !!t.isWallTarget,
            kind: t.kind,
            subtype: t.subtype || '',
            shape: t.shape || '',
            count: t.count,
            widthM: t.widthM || 0,
            depthM: t.depthM || 0,
            size: sizeText(t),
            name: t.custom?.name || t.label || defaultName(t),
            picture: t.custom?.picture || '',
            rate: t.custom?.rate ? String(t.custom.rate) : '',
            materialSpec: t.custom?.materialSpec || '',
            skuCode: t.custom?.skuCode || '',
            fabricationId: t.custom?.fabricationId || '',
            workshopTrade: t.custom?.workshopTrade || 'Joinery',
            leadTimeDays: t.custom?.leadTimeDays || 21,
            saveToLibrary: false,
            existing: !!t.custom,
        });
        if (!t.isZone && !t.isWallTarget) focusType(t.typeId);
    }, [focusType]);

    const applyFabTemplateToDraft = useCallback((tpl) => {
        if (!tpl) return;
        setDraft((d) => {
            if (!d) return d;
            const isWallArt = /^FAB-ART-|^FN-ART-|art|relief|mural/i.test(`${tpl.sku_code || ''} ${tpl.name || ''}`);
            return {
                ...d,
                ...(d.isWallTarget ? { subtype: isWallArt ? 'wall-art' : 'wall-cladding' } : {}),
                name: tpl.name || d.name,
                picture: tpl.image_url || d.picture,
                rate: tpl.rate_mid ? String(tpl.rate_mid) : d.rate,
                materialSpec: tpl.material_spec_mid || tpl.description_template || d.materialSpec,
                skuCode: tpl.sku_code || d.skuCode,
                fabricationId: tpl.id || tpl.sku_code || d.fabricationId,
                workshopTrade: tpl.workshop_trade || d.workshopTrade,
                leadTimeDays: tpl.lead_time_days || d.leadTimeDays,
            };
        });
    }, []);

    const onCustomPicture = useCallback(async (e) => {
        const file = Array.from(e.target.files || []).find(Boolean);
        e.target.value = '';
        if (!file) return;
        setDraftBusy(true);
        const picture = await smallPicture(file);
        setDraftBusy(false);
        setDraft((d) => (d ? { ...d, picture: picture || d.picture, error: picture ? '' : 'Use a JPEG, PNG or WebP picture.' } : d));
    }, []);

    const saveCustom = useCallback(async () => {
        if (!draft || !draft.name.trim()) return;
        let savedFab = null;
        if (draft.saveToLibrary) {
            setDraftBusy(true);
            try {
                const res = await fetch(`${getApiBase()}/api/fabrication-catalog`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: draft.name.trim().slice(0, 80),
                        kind: draft.kind,
                        design_build_kind: draft.kind,
                        shape: draft.shape || 'rectangular',
                        rate_mid: parseFloat(draft.rate) || 0,
                        material_spec_mid: draft.materialSpec || '',
                        workshop_trade: draft.workshopTrade || 'Joinery',
                        lead_time_days: Number(draft.leadTimeDays) || 21,
                        imageDataUrl: /^data:image\//i.test(draft.picture || '') ? draft.picture : '',
                        imageUrl: /^https?:\/\//i.test(draft.picture || '') ? draft.picture : '',
                    }),
                });
                const json = await res.json().catch(() => null);
                if (json?.status === 'success' && json.item) {
                    savedFab = json.item;
                    setFabTemplates((prev) => [json.item, ...prev.filter((x) => x.sku_code !== json.item.sku_code)]);
                }
            } catch { /* non-fatal */ }
            setDraftBusy(false);
        }

        designBuild.setCustomItem({
            typeId: draft.typeId,
            isZone: !!draft.isZone,
            isWallTarget: !!draft.isWallTarget,
            name: draft.name.trim().slice(0, 80),
            kind: draft.kind,
            subtype: draft.subtype || '',
            count: draft.count,
            widthM: draft.widthM || 0,
            depthM: draft.depthM || 0,
            size: draft.size || '',
            picture: savedFab?.image_url || draft.picture || '',
            rate: parseFloat(draft.rate) || 0,
            currency: savedFab?.currency || 'OMR',
            materialSpec: draft.materialSpec || savedFab?.material_spec_mid || '',
            skuCode: savedFab?.sku_code || draft.skuCode || '',
            fabricationId: savedFab?.id || draft.fabricationId || '',
            workshopTrade: savedFab?.workshop_trade || draft.workshopTrade || 'Joinery',
            leadTimeDays: savedFab?.lead_time_days || draft.leadTimeDays || 21,
        });
        setCustomOpen(false);
        setDraft(null);
    }, [draft]);

    // Escape closes the custom item picker, a review or the export suite first, then tucks the modal away
    // (the model stays loaded).
    useEffect(() => {
        if (s.minimized) return undefined;
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            if (customOpen) closeCustom();
            else if (reviewId) setReviewId(null);
            else if (exportOpen) setExportOpen(false);
            else designBuild.minimize();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [s.minimized, reviewId, exportOpen, customOpen, closeCustom]);

    /** Open Design & Build's render panel on the current view. */
    const openRender = useCallback(() => {
        setReviewId(null);
        setExportOpen(false);
        // Design & Build lets go of a product picked here before the shot.
        if (post('render')) setFocus({ id: null, of: null });
    }, [post]);

    /**
     * Back to BOQ Flow. The newest render goes into the package unless one is approved,
     * so the package downloads from BOQ Flow's exports and the chip.
     */
    const continueInBoq = useCallback(() => {
        const st = designBuild.getState();
        if (st.renders.length && !st.renders.some((r) => r.id === st.approvedRenderId)) {
            designBuild.approveRender(st.renders[st.renders.length - 1].id);
        }
        setReviewId(null);
        setExportOpen(false);
        designBuild.minimize();
    }, []);

    const askClose = useCallback(() => {
        if (!confirmClose) {
            setConfirmClose(true);
            window.setTimeout(() => setConfirmClose(false), 4000);
            return;
        }
        designBuild.close();
    }, [confirmClose]);

    const ready = s.status === 'ready';
    const furnished = s.furnished && s.furnished.placedPieces > 0 ? s.furnished : null;
    const approved = s.renders.find((r) => r.id === s.approvedRenderId) || null;
    const reviewing = reviewId ? s.renders.find((r) => r.id === reviewId) || null : null;
    const stepState = (key) => {
        if (key === 'model') return ready ? 'done' : 'active';
        if (key === 'enrich') return s.boqEnrichedAt ? 'done' : ready && s.takeoff ? 'active' : 'todo';
        if (key === 'furnish') return furnished ? 'done' : ready && s.products.length ? 'active' : ready ? 'next' : 'todo';
        if (key === 'render') return approved ? 'done' : s.renders.length ? 'active' : furnished || ready ? 'next' : 'todo';
        return s.exportedAt ? 'done' : approved ? 'active' : ready ? 'next' : 'todo';
    };

    const openEnrichBoq = useCallback(() => {
        const st = designBuild.getState();
        if (!st.takeoff) return;
        const plan = buildGeometricEnrichmentPlan(designBuild.getActiveTables(), st.takeoff);
        setEnrichDraft(plan);
        setReviewId(null);
        setExportOpen(false);
        setCustomOpen(false);
        setEnrichOpen(true);
    }, []);

    const applyEnrichBoq = useCallback(() => {
        if (!enrichDraft) return;
        designBuild.applyBoqEnrichment({ updates: enrichDraft.updates, additions: enrichDraft.additions });
        setEnrichOpen(false);
    }, [enrichDraft]);
    const pieces = s.furniture?.pieces || 0;
    const statusText = (() => {
        if (timedOut) return 'Design & Build did not answer. Check your connection, then try again.';
        if (s.error) return s.error;
        if (s.stage) return s.stage;
        if (approved) {
            if (s.exporting) return s.exporting.label || 'Preparing the package…';
            if (s.exportError) return `The package could not be made: ${s.exportError}`;
            return s.exportedAt ? 'Exported · the package is in your downloads' : 'Render approved · the package is ready to download';
        }
        if (s.renders.length) return `${s.renders.length} render${s.renders.length === 1 ? '' : 's'} · Continue in BOQ Flow takes the newest for the package`;
        if (furnished) return describeFurnished(furnished, s.products);
        if (ready) return `Model ready · ${describeCounts(s.counts)}${pieces ? ` · ${pieces} furniture pieces from the drawing` : ''}`;
        return 'Opening Design & Build…';
    })();
    const missing = furnished ? unplacedNames(furnished, s.products) : [];
    const allProducts = s.customItems.length ? [...s.products, ...customProducts(s.customItems)] : s.products;
    const legend = legendOf(furnished, allProducts);
    const freeTypes = ready ? freeTypesOf(s.furniture?.schedule, furnished, s.customItems) : [];
    const freeZones = ready ? freeZonesOf(s.furniture?.zones, s.customItems) : [];
    const wallTarget = ready && (s.counts?.walls || 0) > 0
        ? [{
            typeId: 'arch_walls',
            isZone: false,
            isWallTarget: true,
            kind: 'screen',
            subtype: (s.customItems || []).find((c) => c.typeId === 'arch_walls')?.subtype || 'wall-cladding',
            shape: 'free',
            count: Math.max(1, Math.min(4, Math.ceil((s.counts?.walls || 1) * 0.25))),
            label: 'Interior Feature Walls (Cladding / Wall Art)',
            custom: (s.customItems || []).find((c) => c.typeId === 'arch_walls') || null,
        }]
        : [];
    const customTargets = [...freeZones, ...wallTarget, ...freeTypes];
    const canCustom = customTargets.length > 0;
    const notFound = (n) => (missing.length ? `Not found on the drawing: ${missing.slice(0, n).join(', ')}${missing.length > n ? ` and ${missing.length - n} more` : ''}.` : '');
    const hint = (() => {
        if (!ready || s.error || approved) return '';
        if (furnished && !s.renders.length) {
            const locate = legend.length ? ' Click a product below to see where it stands.' : '';
            return `Next: Render — the render shows the offer's real products.${locate} ${notFound(3)}`.trim();
        }
        if (furnished) return notFound(4) || 'Every furniture line found its place on the drawing.';
        if (s.products.length) return '';
        return 'Next: apply a Value Engineered or Multi-Budget offer, then the space is furnished with your products here.';
    })();
    const strip = s.renders.slice(-4).reverse();
    const lastRender = s.renders[s.renders.length - 1] || null;
    // Every action under the model; folded, only the main one shows.
    const actions = [];
    if (timedOut || s.error) actions.push({ key: 'retry', label: 'Try again', short: 'Try again', primary: true });
    if (ready && s.takeoff && !approved) {
        actions.push({
            key: 'enrich',
            label: s.boqEnrichedAt ? 'BOQ Enriched ✓' : 'Enrich BOQ (3D)',
            short: 'Enrich BOQ',
            title: 'Update initial BOQ quantities & add missing surfaces from measured 3D geometry',
        });
    }
    if (lastRender && !approved) actions.push({ key: 'review', label: 'Review render' });
    if (ready && !approved) {
        actions.push({
            key: 'render',
            label: s.renders.length ? 'New render' : 'Render',
            short: 'Render',
            primary: !!furnished && !s.renders.length,
            title: 'Photoreal render of the current view in Design & Build',
        });
    }
    if (ready) actions.push({ key: 'files', label: approved ? 'Choose files' : 'Export suite', short: 'Export', title: 'Pick and download files from the Design & Build suite' });
    actions.push({
        key: 'continue',
        label: 'Continue in BOQ Flow',
        short: 'Continue',
        primary: !approved && !(furnished && !s.renders.length) && !(timedOut || s.error),
        title: s.renders.length && !approved ? 'Back to BOQ Flow; the newest render goes into the package' : 'Back to BOQ Flow (the 3D model stays loaded)',
    });
    if (approved) {
        actions.push({
            key: 'download',
            label: s.exporting ? 'Preparing…' : 'Download package',
            short: s.exporting ? 'Preparing…' : 'Download',
            primary: true,
            disabled: !!s.exporting,
            title: 'The whole package as one .zip',
        });
    }
    const runAction = (key) => {
        if (key === 'retry') retry();
        else if (key === 'enrich') openEnrichBoq();
        else if (key === 'review' && lastRender) setReviewId(lastRender.id);
        else if (key === 'render') openRender();
        else if (key === 'files') setExportOpen(true);
        else if (key === 'continue') continueInBoq();
        else if (key === 'download') designBuild.downloadPackage();
    };
    // A step that does something: Render opens Design & Build's renders, Export suite the package.
    const stepGoes = (key) => (key === 'export' && ready) || (key === 'render' && ready) || (key === 'enrich' && ready && !!s.takeoff);
    const goToStep = (key) => {
        if (key === 'export') setExportOpen(true);
        else if (key === 'enrich') openEnrichBoq();
        else openRender();
    };
    const mainAction = [...actions].reverse().find((a) => a.primary) || actions[actions.length - 1];

    return (
        <>
            <div
                // Minimised while the package is made: the model stays technically on screen (under the
                // page, see-through), so the browser keeps drawing it for the package's views.
                className={s.minimized ? (s.exporting ? styles.layerCapturing : styles.layerHidden) : styles.overlay}
                aria-hidden={s.minimized ? 'true' : undefined}
            >
                <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Design & Build">
                    <header className={styles.header}>
                        <div className={styles.brand}>
                            <span className={styles.mark}>DB</span>
                            <div className={styles.titles}>
                                <h2 className={styles.title}>Design &amp; Build</h2>
                                <span className={styles.planName} title={[project.projectName, s.plan?.name].filter(Boolean).join(' · ')}>
                                    {project.projectName?.trim() || s.plan?.name}
                                </span>
                            </div>
                        </div>

                        <ol className={styles.steps} aria-label="Steps">
                            {STEPS.map((step, i) => {
                                const st = stepState(step.key);
                                const inner = (
                                    <>
                                        <span className={styles.stepDot}>{st === 'done' ? '✓' : i + 1}</span>
                                        <span className={styles.stepLabel}>{step.label}</span>
                                    </>
                                );
                                return (
                                    <li key={step.key} className={`${styles.step} ${styles[`step_${st}`]}`} aria-current={st === 'active' ? 'step' : undefined}>
                                        {stepGoes(step.key) ? (
                                            <button
                                                type="button"
                                                className={styles.stepBtn}
                                                onClick={() => goToStep(step.key)}
                                                title={step.key === 'export' ? 'Download the package' : step.key === 'enrich' ? 'Measure 3D surface geometry & enrich BOQ' : 'Render in Design & Build'}
                                            >
                                                {inner}
                                            </button>
                                        ) : inner}
                                    </li>
                                );
                            })}
                        </ol>

                        <div className={styles.headerActions}>
                            <button type="button" className={styles.iconBtn} onClick={designBuild.minimize} title="Minimise (the 3D model stays loaded)">
                                <span aria-hidden>–</span>
                                <span className={styles.srOnly}>Minimise</span>
                            </button>
                            <button
                                type="button"
                                className={`${styles.iconBtn} ${confirmClose ? styles.iconBtnConfirm : ''}`}
                                onClick={askClose}
                                title="Close Design & Build"
                            >
                                {confirmClose ? <span className={styles.confirmText}>Discard model?</span> : <span aria-hidden>×</span>}
                                {!confirmClose && <span className={styles.srOnly}>Close</span>}
                            </button>
                        </div>
                    </header>

                    <div className={styles.body}>
                        <iframe
                            key={frameKey}
                            ref={iframeRef}
                            className={styles.frame}
                            src={`${DESIGN_BUILD_URL}/?embed=boqflow`}
                            title="Design & Build 3D model"
                            allow="fullscreen; clipboard-write"
                        />

                        {reviewing && (
                            <div className={styles.review} role="dialog" aria-label="Review render">
                                <img className={styles.reviewImage} src={reviewing.image} alt="Render from Design & Build" />
                                <div className={styles.reviewBar}>
                                    <div className={styles.reviewInfo}>
                                        <span className={styles.reviewTitle}>
                                            {VIEW_LABEL[reviewing.viewKind] || 'Render'}
                                            {reviewing.score ? ` · geometry match ${Math.round(reviewing.score * 100)}%` : ''}
                                        </span>
                                        {reviewing.products.length > 0 && (
                                            <span className={styles.reviewProducts}>
                                                {reviewing.products.slice(0, 6).map((p) => (
                                                    <span key={p.id} className={styles.productChip} title={p.label}>
                                                        {p.colour && <span className={styles.swatch} style={{ background: p.colour }} />}
                                                        {p.label}
                                                    </span>
                                                ))}
                                                {reviewing.products.length > 6 && <span className={styles.productChip}>+{reviewing.products.length - 6}</span>}
                                            </span>
                                        )}
                                    </div>
                                    <div className={styles.reviewActions}>
                                        <button type="button" className={styles.secondaryBtn} onClick={() => setReviewId(null)}>Close</button>
                                        {reviewing.id === s.approvedRenderId ? (
                                            <button type="button" className={styles.approvedBtn} onClick={() => designBuild.approveRender(null)} title="Withdraw the approval">
                                                ✓ Approved
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                className={styles.primaryBtn}
                                                onClick={() => {
                                                    designBuild.approveRender(reviewing.id);
                                                    setReviewId(null);
                                                    setExportOpen(true);
                                                }}
                                            >
                                                Approve render
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {exportOpen && ready && (
                            <DesignBuildExportPanel s={s} onClose={() => setExportOpen(false)} onEditProject={() => setProjectOpen(true)} />
                        )}

                        {enrichOpen && enrichDraft && (
                            <div className={styles.exportLayer}>
                                <button type="button" className={styles.exportScrim} onClick={() => setEnrichOpen(false)} aria-label="Close Post-Build BOQ Enrichment" />
                                <aside className={styles.exportPanel} role="dialog" aria-label="Post-Building Geometric BOQ Enrichment">
                                    <header className={styles.exportHead}>
                                        <div>
                                            <h3 className={styles.exportTitle}>Post-Build Measured BOQ Enrichment</h3>
                                            <p className={styles.exportSub}>Pure 3D surface quantities measured from your live Pascal model (pilot windows excluded). Review updates &amp; additions to apply into BOQ Flow.</p>
                                        </div>
                                        <button type="button" className={styles.iconBtn} onClick={() => setEnrichOpen(false)} title="Close">
                                            <span aria-hidden>×</span>
                                        </button>
                                    </header>
                                    {enrichDraft.summary && (
                                        <div className={styles.enrichStatsGrid}>
                                            <div><span>Net Floor Slab</span><strong>{enrichDraft.summary.netFloorAreaM2} m²</strong></div>
                                            <div><span>Paintable Walls</span><strong>{enrichDraft.summary.solidWallNetPaintAreaM2} m²</strong></div>
                                            <div><span>Glass Partitions</span><strong>{enrichDraft.summary.glassPartitionAreaM2} m²</strong></div>
                                            <div><span>Skirting Perimeter</span><strong>{enrichDraft.summary.skirtingLengthLm} lm</strong></div>
                                            <div><span>Doors / Windows</span><strong>{enrichDraft.summary.doorsCount} / {enrichDraft.summary.windowsCount}</strong></div>
                                            <div><span>Furniture Count</span><strong>{enrichDraft.summary.furnitureCount} pcs</strong></div>
                                        </div>
                                    )}
                                    <div className={styles.enrichBody}>
                                        <h4>Quantity Synchronizations ({enrichDraft.updates.length})</h4>
                                        {enrichDraft.updates.length === 0 ? (
                                            <p className={styles.groupNote}>Existing BOQ quantities already align with the 3D scene (or no matching surface rows found).</p>
                                        ) : (
                                            <ul className={styles.enrichList}>
                                                {enrichDraft.updates.map((u, idx) => (
                                                    <li key={u.id}>
                                                        <label>
                                                            <input
                                                                type="checkbox"
                                                                checked={!!u.selected}
                                                                onChange={(e) => setEnrichDraft((prev) => ({
                                                                    ...prev,
                                                                    updates: prev.updates.map((x, i) => (i === idx ? { ...x, selected: e.target.checked } : x)),
                                                                }))}
                                                            />
                                                            <span>
                                                                <strong>{u.label}</strong> — {u.currentQty} → <b>{u.measuredQty} {u.unit}</b> ({u.delta >= 0 ? `+${u.delta}` : u.delta})
                                                                <small>{u.basis}</small>
                                                            </span>
                                                        </label>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                        <h4>Missing 3D Architectural Surfaces ({enrichDraft.additions.length})</h4>
                                        {enrichDraft.additions.length === 0 ? (
                                            <p className={styles.groupNote}>All measured 3D fit-out surfaces are already covered in your BOQ.</p>
                                        ) : (
                                            <ul className={styles.enrichList}>
                                                {enrichDraft.additions.map((a, idx) => (
                                                    <li key={a.id}>
                                                        <label>
                                                            <input
                                                                type="checkbox"
                                                                checked={!!a.selected}
                                                                onChange={(e) => setEnrichDraft((prev) => ({
                                                                    ...prev,
                                                                    additions: prev.additions.map((x, i) => (i === idx ? { ...x, selected: e.target.checked } : x)),
                                                                }))}
                                                            />
                                                            <span>
                                                                <strong>{a.model}</strong> — {a.qty} {a.unit} @ {a.rate} OMR
                                                                <small>{a.basis}</small>
                                                            </span>
                                                        </label>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                    <footer className={styles.exportFoot}>
                                        <button type="button" className={styles.secondaryBtn} onClick={() => setEnrichOpen(false)}>Cancel</button>
                                        <button
                                            type="button"
                                            className={styles.primaryBtn}
                                            disabled={!enrichDraft.updates.some((u) => u.selected) && !enrichDraft.additions.some((a) => a.selected)}
                                            onClick={applyEnrichBoq}
                                        >
                                            Apply 3D Measured Quantities to BOQ
                                        </button>
                                    </footer>
                                </aside>
                            </div>
                        )}
                    </div>

                    {sheetOpen && (legend.length > 0 || canCustom) && (
                        <div className={styles.legend} role="group" aria-label="Products in the model">
                            <span className={styles.legendTitle}>In the model</span>
                            <div className={styles.legendList}>
                                {legend.map((p) => {
                                    const chip = (
                                        <button
                                            key={p.custom ? undefined : p.id}
                                            type="button"
                                            className={`${styles.legendItem} ${focusId === p.id ? styles.legendItemActive : ''} ${p.custom ? styles.legendItemCustom : ''}`}
                                            onClick={() => focusProduct(p.id)}
                                            aria-pressed={focusId === p.id}
                                            title={p.title}
                                            disabled={!ready}
                                        >
                                            <span className={styles.legendPic} style={p.hex ? { borderColor: p.hex } : undefined}>
                                                {p.picture && !brokenPictures.has(p.id) ? (
                                                    <img
                                                        src={p.picture}
                                                        alt=""
                                                        loading="lazy"
                                                        onError={() => setBrokenPictures((b) => new Set(b).add(p.id))}
                                                    />
                                                ) : (
                                                    <span className={styles.legendDot} style={{ background: p.hex || '#94a3b8' }} />
                                                )}
                                            </span>
                                            <span className={styles.legendName}>{p.name}</span>
                                            {p.custom && <span className={styles.legendTag}>Custom</span>}
                                            <span className={`${styles.legendCount} ${p.differs ? styles.legendCountWarn : ''}`}>{p.count}</span>
                                        </button>
                                    );
                                    if (!p.custom) return chip;
                                    return (
                                        <span key={p.id} className={styles.legendGroup}>
                                            {chip}
                                            <button
                                                type="button"
                                                className={styles.legendRemove}
                                                onClick={() => designBuild.removeCustomItem(p.typeId)}
                                                aria-label={`Remove the custom item ${p.name}`}
                                                title="Remove this custom item"
                                            >
                                                ×
                                            </button>
                                        </span>
                                    );
                                })}
                                {missing.length > 0 && (
                                    <span className={styles.legendMissing} title={`Not on the drawing: ${missing.join(', ')}`}>
                                        {missing.length} not on the drawing
                                    </span>
                                )}
                            </div>
                            {canCustom && (
                                <button
                                    type="button"
                                    className={`${styles.legendAdd} ${customOpen ? styles.legendAddActive : ''}`}
                                    onClick={openCustom}
                                    aria-expanded={customOpen}
                                    title="Drawn furniture with no product in the offer: give it a name and a photo, and the model and renders show it"
                                >
                                    <span aria-hidden>＋</span> Custom item
                                </button>
                            )}

                            {customOpen && (
                                <div className={styles.customPop} role="dialog" aria-label="Custom item">
                                    <div className={styles.customHead}>
                                        <div>
                                            <strong>{draft ? (draft.existing ? 'Change the custom item' : 'Custom item') : 'Custom item'}</strong>
                                            <small>
                                                {draft
                                                    ? `${draft.count} drawn ${kindLabel(draft.kind, draft.subtype).toLowerCase()}${draft.count === 1 ? '' : 's'}${draft.size ? ` · ${draft.size}` : ''} — shown in the model`
                                                    : 'Drawn furniture with no product in the offer. Pick one, then give it a name and a photo: the model and the renders show it.'}
                                            </small>
                                        </div>
                                        <button type="button" className={styles.iconBtn} onClick={closeCustom} aria-label="Close">
                                            <span aria-hidden>×</span>
                                        </button>
                                    </div>
                                    {!draft ? (
                                        <ul className={styles.customTypes}>
                                            {customTargets.map((t) => (
                                                <li key={t.typeId}>
                                                    <button type="button" className={styles.customType} onClick={() => pickType(t)}>
                                                        <span className={styles.customTypePic}>
                                                            {t.custom?.picture ? <img src={t.custom.picture} alt="" /> : <span aria-hidden>{kindLabel(t.kind, t.subtype).charAt(0)}</span>}
                                                        </span>
                                                        <span className={styles.customTypeName}>
                                                            {t.custom?.name || t.label || kindLabel(t.kind, t.subtype)}
                                                            <small>{[sizeText(t), shapeText(t.shape), t.isZone ? 'overhead zone' : t.isWallTarget ? 'wall finish / art' : t.customModel ? 'custom drawn' : ''].filter(Boolean).join(' · ')}</small>
                                                        </span>
                                                        <span className={styles.customTypeCount}>{t.count}</span>
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <div className={styles.customForm}>
                                            {fabTemplates.length > 0 && (() => {
                                                const ranked = rankFabricationTemplates(fabTemplates, draft);
                                                return (
                                                    <div className={styles.customField}>
                                                        <span>Quick-pick from Fabrication DB ({ranked.length})</span>
                                                        <div className={styles.fabQuickStrip}>
                                                            {ranked.map((tpl) => (
                                                                <button
                                                                    key={tpl.sku_code || tpl.id}
                                                                    type="button"
                                                                    className={`${styles.fabChip} ${draft.skuCode === tpl.sku_code ? styles.fabChipActive : ''}`}
                                                                    onClick={() => applyFabTemplateToDraft(tpl)}
                                                                    title={tpl.description_template}
                                                                >
                                                                    <span>{tpl.name}</span>
                                                                    <small>{tpl.rate_mid ? `${tpl.rate_mid} ${tpl.currency || 'OMR'}` : tpl.sku_code}</small>
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                            {draft.isWallTarget && (
                                                <div className={styles.customField}>
                                                    <span>Wall Application Type</span>
                                                    <div className={styles.fabQuickStrip}>
                                                        <button
                                                            type="button"
                                                            className={`${styles.fabChip} ${draft.subtype !== 'wall-art' ? styles.fabChipActive : ''}`}
                                                            onClick={() => setDraft((d) => (d ? { ...d, subtype: 'wall-cladding', workshopTrade: 'Joinery' } : d))}
                                                        >
                                                            <span>Wall Cladding</span>
                                                            <small>Fluted / Veneer / Stone / PVD</small>
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className={`${styles.fabChip} ${draft.subtype === 'wall-art' ? styles.fabChipActive : ''}`}
                                                            onClick={() => setDraft((d) => (d ? { ...d, subtype: 'wall-art', workshopTrade: 'Art & Decor' } : d))}
                                                        >
                                                            <span>Wall Artwork</span>
                                                            <small>Framed / Bas-Relief / Triptych</small>
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                            <label className={styles.customField}>
                                                <span>Name</span>
                                                <input
                                                    type="text"
                                                    value={draft.name}
                                                    maxLength={80}
                                                    onChange={(e) => setDraft((d) => (d ? { ...d, name: e.target.value } : d))}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') saveCustom();
                                                    }}
                                                    autoFocus
                                                />
                                            </label>
                                            <div className={styles.customRowTwo}>
                                                <label className={styles.customField}>
                                                    <span>Unit Rate (OMR)</span>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        step="1"
                                                        placeholder="e.g. 450"
                                                        value={draft.rate ?? ''}
                                                        onChange={(e) => setDraft((d) => (d ? { ...d, rate: e.target.value } : d))}
                                                    />
                                                </label>
                                                <label className={styles.customField}>
                                                    <span>Trade</span>
                                                    <input
                                                        type="text"
                                                        maxLength={32}
                                                        value={draft.workshopTrade ?? 'Joinery'}
                                                        onChange={(e) => setDraft((d) => (d ? { ...d, workshopTrade: e.target.value } : d))}
                                                    />
                                                </label>
                                            </div>
                                            <label className={styles.customField}>
                                                <span>Material &amp; Finish Spec</span>
                                                <input
                                                    type="text"
                                                    maxLength={220}
                                                    placeholder="e.g. HMR MDF + white oak veneer + 20mm quartz top"
                                                    value={draft.materialSpec ?? ''}
                                                    onChange={(e) => setDraft((d) => (d ? { ...d, materialSpec: e.target.value } : d))}
                                                />
                                            </label>
                                            <div className={styles.customPicRow}>
                                                <span className={styles.customPic}>
                                                    {draft.picture ? <img src={draft.picture} alt="" /> : <small>No photo</small>}
                                                </span>
                                                <div className={styles.customPicText}>
                                                    <button type="button" className={styles.secondaryBtn} onClick={() => customFileRef.current?.click()} disabled={draftBusy}>
                                                        {draftBusy ? 'Reading…' : draft.picture ? 'Change photo' : 'Add a photo'}
                                                    </button>
                                                    <small>A product photo on a plain background renders best.</small>
                                                    <label className={styles.fabSaveCheck}>
                                                        <input
                                                            type="checkbox"
                                                            checked={!!draft.saveToLibrary}
                                                            onChange={(e) => setDraft((d) => (d ? { ...d, saveToLibrary: e.target.checked } : d))}
                                                        />
                                                        <span>Save to Supabase Fabrication DB</span>
                                                    </label>
                                                    {draft.error && <small className={styles.customError}>{draft.error}</small>}
                                                </div>
                                                <input ref={customFileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onCustomPicture} />
                                            </div>
                                            <div className={styles.customActions}>
                                                <button type="button" className={styles.secondaryBtn} onClick={() => { setDraft(null); focusType(null); }}>
                                                    Back
                                                </button>
                                                <button type="button" className={styles.primaryBtn} onClick={saveCustom} disabled={!draft.name.trim() || draftBusy}>
                                                    {draft.existing ? 'Update in the model' : 'Place in the model'}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    <footer className={`${styles.footer} ${sheetOpen ? '' : styles.footerFolded}`}>
                        <button
                            type="button"
                            className={styles.status}
                            onClick={() => setSheetOpen((o) => !o)}
                            aria-expanded={sheetOpen}
                            title={sheetOpen ? 'Fold the status (more room for the model)' : 'Show the products, renders and actions'}
                        >
                            <span className={`${styles.statusDot} ${timedOut || s.error ? styles.dotError : ready && !s.exporting ? styles.dotReady : styles.dotBusy}`} />
                            <span className={styles.statusLines} role="status" aria-live="polite">
                                <span className={styles.statusMain}>{statusText}</span>
                                {sheetOpen && hint && <span className={styles.statusHint}>{hint}</span>}
                            </span>
                        </button>
                        {sheetOpen && strip.length > 0 && (
                            <div className={styles.renderStrip} aria-label="Renders">
                                {strip.map((r) => (
                                    <button
                                        key={r.id}
                                        type="button"
                                        className={`${styles.renderThumb} ${r.id === s.approvedRenderId ? styles.renderThumbApproved : ''}`}
                                        onClick={() => setReviewId(r.id)}
                                        title={r.id === s.approvedRenderId ? 'Approved render' : 'Review this render'}
                                    >
                                        <img src={r.image} alt="" />
                                        {r.id === s.approvedRenderId && <span className={styles.thumbTick}>✓</span>}
                                    </button>
                                ))}
                            </div>
                        )}
                        <div className={styles.footerActions}>
                            {(sheetOpen ? actions : [mainAction]).map((a) => (
                                <button
                                    key={a.key}
                                    type="button"
                                    className={a.primary ? styles.primaryBtn : styles.secondaryBtn}
                                    onClick={() => runAction(a.key)}
                                    disabled={a.disabled}
                                    title={a.title}
                                >
                                    {sheetOpen ? a.label : a.short || a.label}
                                </button>
                            ))}
                            <button
                                type="button"
                                className={styles.sheetToggle}
                                onClick={() => setSheetOpen((o) => !o)}
                                aria-expanded={sheetOpen}
                                aria-label={sheetOpen ? 'Fold the status' : 'Show the products, renders and actions'}
                                title={sheetOpen ? 'Fold (more room for the model)' : 'Show more'}
                            >
                                <span aria-hidden>{sheetOpen ? '▾' : '▴'}</span>
                            </button>
                        </div>
                    </footer>
                </section>
            </div>

            {s.minimized && (
                <div className={styles.chip} role="region" aria-label="Design & Build">
                    <span className={`${styles.statusDot} ${s.error || s.exportError ? styles.dotError : ready && !s.exporting ? styles.dotReady : styles.dotBusy}`} />
                    <button type="button" className={styles.chipMain} onClick={designBuild.restore} title="Open Design & Build">
                        <span className={styles.chipTitle}>Design &amp; Build</span>
                        <span className={styles.chipSub}>
                            {s.error
                                ? 'Needs attention'
                                : approved
                                    ? s.exporting
                                        ? s.exporting.label || 'Preparing the package…'
                                        : s.exportError
                                            ? 'The package could not be made'
                                            : s.exportedAt
                                                ? 'Package saved · download again'
                                                : 'Package ready to download'
                                    : s.renders.length
                                        ? `${s.renders.length} render${s.renders.length === 1 ? '' : 's'} to review`
                                        : furnished
                                            ? `Furnished with ${s.products.length} products`
                                            : ready
                                                ? describeCounts(s.counts)
                                                : 'Building the 3D model…'}
                        </span>
                    </button>
                    {approved && (
                        <button
                            type="button"
                            className={styles.chipOpen}
                            onClick={() => designBuild.downloadPackage()}
                            disabled={!!s.exporting}
                            title="The whole package as one .zip"
                        >
                            {s.exporting ? 'Preparing…' : 'Download'}
                        </button>
                    )}
                    <button
                        type="button"
                        className={approved ? styles.chipGhost : styles.chipOpen}
                        onClick={designBuild.restore}
                    >
                        Open
                    </button>
                </div>
            )}
            {exportOpen && !s.minimized && (
                // The project drawer, above the modal: what it holds goes on every file of the package.
                <div className={styles.settingsLayer}>
                    <ProjectSettingsPanel isOpen={projectOpen} onClose={() => setProjectOpen(false)} />
                </div>
            )}
        </>
    );
}
