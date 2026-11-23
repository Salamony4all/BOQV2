import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    designBuild,
    useDesignBuild,
    prepareProductPictures,
    productForBridge,
    DESIGN_BUILD_URL,
    DESIGN_BUILD_ORIGIN,
} from '../features/designBuild/designBuildStore';
import DesignBuildExportPanel from './DesignBuildExportPanel';
import styles from '../styles/DesignBuildDock.module.css';

// Design & Build express modal. Design & Build runs inside an iframe in its
// "express" mode; the two apps talk by postMessage only (origin-checked both
// ways). The modal can tuck into a chip, which keeps the 3D model loaded while
// the user carries on in BOQ Flow (for example in a Value Engineered offer).

const BRIDGE = { source: 'boqflow', v: 1 };
const READY_TIMEOUT_MS = 30000;
const ARTIFACTS_TIMEOUT_MS = 45000;
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp);base64,/i;
const VIEW_LABEL = { cutaway: '3D cutaway', 'eye-level': 'Eye-level view', interior: 'Interior view' };

const STEPS = [
    { key: 'model', label: '3D model' },
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
    return `Furnished · ${f.placedPieces} of ${f.pieces} drawn pieces carry ${withProduct} of ${products.length} products`;
}

const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

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
            .map((v) => ({ kind: ['current', 'top', 'overview'].includes(v.kind) ? v.kind : 'current', image: v.image }))
        : [];
    return {
        planName: text(m.planName, 300),
        planImage: typeof m.planImage === 'string' && IMAGE_DATA_URL.test(m.planImage) ? m.planImage : null,
        views,
        scene: typeof m.scene === 'string' && m.scene.length < 80_000_000 ? m.scene : '',
        counts: m.counts && typeof m.counts === 'object' ? m.counts : null,
    };
}

function unplacedNames(f, products) {
    const byId = new Map(products.map((p) => [p.id, p]));
    return (f.unplacedProductIds || [])
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((p) => [p.brand, p.model].filter(Boolean).join(' ') || p.description.slice(0, 40));
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
    const [exportOpen, setExportOpen] = useState(false);

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
        if (!readyRef.current || st.status !== 'ready' || !st.products.length || st.productsToken === sentProductsRef.current) return;
        const token = st.productsToken;
        sentProductsRef.current = token;
        designBuild.set({ stage: `Preparing pictures of ${st.products.length} products…` });
        let items = st.products;
        try {
            items = await prepareProductPictures(st.products);
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
                    designBuild.set({ status: 'ready', stage: '', counts: m.counts || null, error: null });
                    sendProductsIfNeeded();
                    break;
                case 'furniture-ready':
                    designBuild.set({ furniture: { pieces: Number(m.pieces) || 0, schedule: Array.isArray(m.schedule) ? m.schedule : [] } });
                    break;
                case 'furnished':
                    designBuild.set({
                        stage: '',
                        furnished: {
                            placedPieces: Number(m.placedPieces) || 0,
                            pieces: Number(m.pieces) || 0,
                            products: Array.isArray(m.products) ? m.products : [],
                            unplacedProductIds: Array.isArray(m.unplacedProductIds) ? m.unplacedProductIds : [],
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
                    if (done) {
                        pendingArtifactsRef.current.delete(m.requestId);
                        done(artifactsFromMessage(m));
                    }
                    break;
                }
                case 'error':
                    designBuild.set({ error: String(m.message || 'Design & Build reported a problem.').slice(0, 400) });
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

    // Escape closes a review or the export suite first, then tucks the modal away
    // (the model stays loaded).
    useEffect(() => {
        if (s.minimized) return undefined;
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            if (reviewId) setReviewId(null);
            else if (exportOpen) setExportOpen(false);
            else designBuild.minimize();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [s.minimized, reviewId, exportOpen]);

    const retry = useCallback(() => {
        readyRef.current = false;
        sentPlanRef.current = 0;
        sentProductsRef.current = 0;
        setTimedOut(false);
        designBuild.set({ status: 'connecting', stage: 'Opening Design & Build…', error: null, counts: null });
        setFrameKey((k) => k + 1);
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
        if (key === 'furnish') return furnished ? 'done' : ready && s.products.length ? 'active' : ready ? 'next' : 'todo';
        if (key === 'render') return approved ? 'done' : s.renders.length ? 'active' : furnished || ready ? 'next' : 'todo';
        return s.exportedAt ? 'done' : approved ? 'active' : 'todo';
    };
    const pieces = s.furniture?.pieces || 0;
    const statusText = (() => {
        if (timedOut) return 'Design & Build did not answer. Check your connection, then try again.';
        if (s.error) return s.error;
        if (s.stage) return s.stage;
        if (approved) return s.exportedAt ? 'Exported · the package is in your downloads' : 'Render approved · the export suite is ready';
        if (s.renders.length) return `${s.renders.length} render${s.renders.length === 1 ? '' : 's'} · review one and approve it for the export suite`;
        if (furnished) return describeFurnished(furnished, s.products);
        if (ready) return `Model ready · ${describeCounts(s.counts)}${pieces ? ` · ${pieces} furniture pieces from the drawing` : ''}`;
        return 'Opening Design & Build…';
    })();
    const missing = furnished ? unplacedNames(furnished, s.products) : [];
    const notFound = (n) => (missing.length ? `Not found on the drawing: ${missing.slice(0, n).join(', ')}${missing.length > n ? ` and ${missing.length - n} more` : ''}.` : '');
    const hint = (() => {
        if (!ready || s.error || approved) return '';
        if (furnished && !s.renders.length) return `Next: press Render in Design & Build — the render shows the offer's real products. ${notFound(3)}`.trim();
        if (furnished) return notFound(4) || 'Every product found its place on the drawing.';
        if (s.products.length) return '';
        return 'Next: apply a Value Engineered or Multi-Budget offer, then the space is furnished with your products here.';
    })();
    const strip = s.renders.slice(-4).reverse();

    return (
        <>
            <div
                className={s.minimized ? styles.layerHidden : styles.overlay}
                aria-hidden={s.minimized ? 'true' : undefined}
            >
                <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Design & Build">
                    <header className={styles.header}>
                        <div className={styles.brand}>
                            <span className={styles.mark}>DB</span>
                            <div className={styles.titles}>
                                <h2 className={styles.title}>Design &amp; Build</h2>
                                <span className={styles.planName} title={s.plan?.name}>{s.plan?.name}</span>
                            </div>
                        </div>

                        <ol className={styles.steps} aria-label="Steps">
                            {STEPS.map((step, i) => (
                                <li key={step.key} className={`${styles.step} ${styles[`step_${stepState(step.key)}`]}`}>
                                    <span className={styles.stepDot}>{stepState(step.key) === 'done' ? '✓' : i + 1}</span>
                                    <span>{step.label}</span>
                                </li>
                            ))}
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

                        {exportOpen && approved && (
                            <DesignBuildExportPanel s={s} requestArtifacts={requestArtifacts} onClose={() => setExportOpen(false)} />
                        )}
                    </div>

                    <footer className={styles.footer}>
                        <div className={styles.status} role="status" aria-live="polite">
                            <span className={`${styles.statusDot} ${timedOut || s.error ? styles.dotError : ready ? styles.dotReady : styles.dotBusy}`} />
                            <div className={styles.statusLines}>
                                <span className={styles.statusMain}>{statusText}</span>
                                {hint && <span className={styles.statusHint}>{hint}</span>}
                            </div>
                        </div>
                        {strip.length > 0 && (
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
                            {(timedOut || s.error) && (
                                <button type="button" className={styles.secondaryBtn} onClick={retry}>Try again</button>
                            )}
                            {s.renders.length > 0 && !approved && (
                                <button type="button" className={styles.secondaryBtn} onClick={() => setReviewId(s.renders[s.renders.length - 1].id)}>
                                    Review render
                                </button>
                            )}
                            <button type="button" className={approved ? styles.secondaryBtn : styles.primaryBtn} onClick={designBuild.minimize}>
                                Continue in BOQ Flow
                            </button>
                            {approved && (
                                <button type="button" className={styles.primaryBtn} onClick={() => setExportOpen(true)}>
                                    Export suite
                                </button>
                            )}
                        </div>
                    </footer>
                </section>
            </div>

            {s.minimized && (
                <div className={styles.chip} role="region" aria-label="Design & Build">
                    <span className={`${styles.statusDot} ${s.error ? styles.dotError : ready ? styles.dotReady : styles.dotBusy}`} />
                    <button type="button" className={styles.chipMain} onClick={designBuild.restore} title="Open Design & Build">
                        <span className={styles.chipTitle}>Design &amp; Build</span>
                        <span className={styles.chipSub}>
                            {s.error
                                ? 'Needs attention'
                                : approved
                                    ? 'Render approved · export suite ready'
                                    : s.renders.length
                                        ? `${s.renders.length} render${s.renders.length === 1 ? '' : 's'} to review`
                                        : furnished
                                            ? `Furnished with ${s.products.length} products`
                                            : ready
                                                ? describeCounts(s.counts)
                                                : 'Building the 3D model…'}
                        </span>
                    </button>
                    <button type="button" className={styles.chipOpen} onClick={designBuild.restore}>Open</button>
                </div>
            )}
        </>
    );
}
