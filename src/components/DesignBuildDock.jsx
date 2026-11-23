import React, { useCallback, useEffect, useRef, useState } from 'react';
import { designBuild, useDesignBuild, DESIGN_BUILD_URL, DESIGN_BUILD_ORIGIN } from '../features/designBuild/designBuildStore';
import styles from '../styles/DesignBuildDock.module.css';

// Design & Build express modal. Design & Build runs inside an iframe in its
// "express" mode; the two apps talk by postMessage only (origin-checked both
// ways). The modal can tuck into a chip, which keeps the 3D model loaded while
// the user carries on in BOQ Flow (for example in a Value Engineered offer).

const BRIDGE = { source: 'boqflow', v: 1 };
const READY_TIMEOUT_MS = 30000;

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
    const [frameKey, setFrameKey] = useState(0);
    const [confirmClose, setConfirmClose] = useState(false);
    const [timedOut, setTimedOut] = useState(false);

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

    // Products of the applied offer go to the finished model to furnish it.
    const sendProductsIfNeeded = useCallback(() => {
        const st = designBuild.getState();
        if (!readyRef.current || st.status !== 'ready' || !st.products.length || st.productsToken === sentProductsRef.current) return;
        if (post('products', { items: st.products })) {
            sentProductsRef.current = st.productsToken;
            designBuild.set({ stage: `Furnishing with ${st.products.length} products…` });
        }
    }, [post]);

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
                        },
                    });
                    break;
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

    // Escape tucks the modal away (the model stays loaded).
    useEffect(() => {
        if (s.minimized) return undefined;
        const onKey = (e) => {
            if (e.key === 'Escape') designBuild.minimize();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [s.minimized]);

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
    const stepState = (key) => {
        if (key === 'model') return ready ? 'done' : 'active';
        if (key === 'furnish') return furnished ? 'done' : ready && s.products.length ? 'active' : ready ? 'next' : 'todo';
        if (key === 'render') return furnished ? 'next' : 'todo';
        return 'todo';
    };
    const pieces = s.furniture?.pieces || 0;
    const statusText = timedOut
        ? 'Design & Build did not answer. Check your connection, then try again.'
        : s.error
            ? s.error
            : s.stage
                ? s.stage
                : furnished
                    ? describeFurnished(furnished, s.products)
                    : ready
                        ? `Model ready · ${describeCounts(s.counts)}${pieces ? ` · ${pieces} furniture pieces from the drawing` : ''}`
                        : 'Opening Design & Build…';
    const missing = furnished ? unplacedNames(furnished, s.products) : [];
    const hint = !ready || s.error
        ? ''
        : furnished
            ? missing.length
                ? `Not found on the drawing: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ` and ${missing.length - 4} more` : ''}.`
                : 'Every product found its place on the drawing.'
            : s.products.length
                ? ''
                : 'Next: apply a Value Engineered or Multi-Budget offer, then the space is furnished with your products here.';

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
                    </div>

                    <footer className={styles.footer}>
                        <div className={styles.status} role="status" aria-live="polite">
                            <span className={`${styles.statusDot} ${timedOut || s.error ? styles.dotError : ready ? styles.dotReady : styles.dotBusy}`} />
                            <div className={styles.statusLines}>
                                <span className={styles.statusMain}>{statusText}</span>
                                {hint && <span className={styles.statusHint}>{hint}</span>}
                            </div>
                        </div>
                        <div className={styles.footerActions}>
                            {(timedOut || s.error) && (
                                <button type="button" className={styles.secondaryBtn} onClick={retry}>Try again</button>
                            )}
                            <button type="button" className={styles.primaryBtn} onClick={designBuild.minimize}>
                                Continue in BOQ Flow
                            </button>
                        </div>
                    </footer>
                </section>
            </div>

            {s.minimized && (
                <div className={styles.chip} role="region" aria-label="Design & Build">
                    <span className={`${styles.statusDot} ${s.error ? styles.dotError : ready ? styles.dotReady : styles.dotBusy}`} />
                    <button type="button" className={styles.chipMain} onClick={designBuild.restore} title="Open Design & Build">
                        <span className={styles.chipTitle}>Design &amp; Build</span>
                        <span className={styles.chipSub}>{s.error ? 'Needs attention' : furnished ? `Furnished with ${s.products.length} products` : ready ? describeCounts(s.counts) : 'Building the 3D model…'}</span>
                    </button>
                    <button type="button" className={styles.chipOpen} onClick={designBuild.restore}>Open</button>
                </div>
            )}
        </>
    );
}
