import React, { useCallback, useState } from 'react';
import { designBuild } from '../features/designBuild/designBuildStore';
import { SUITE_GROUPS, buildExportSuite, saveExportSuite } from '../features/designBuild/exportSuite';
import styles from '../styles/DesignBuildDock.module.css';

// The Design & Build export suite inside BOQ Flow: the package Design & Build lays out,
// made here from the approved render and the offer's real products.

const VIEW_LABEL = { cutaway: '3D cutaway', 'eye-level': 'Eye-level view', interior: 'Interior view' };

function groupState(g, s) {
    const offer = s.offer?.tables?.length ? s.offer : null;
    switch (g.key) {
        case 'boq':
            return offer ? { ok: true, note: `${offer.tables.length} sheet${offer.tables.length === 1 ? '' : 's'} from the applied offer` } : { ok: false, note: 'Apply an offer first' };
        case 'ffe':
            return s.products.length ? { ok: true, note: `${s.products.length} products with pictures, colours, links and where each piece stands` } : { ok: false, note: 'Apply an offer first' };
        case 'renders':
            return { ok: s.renders.length > 0, note: `${s.renders.length} render${s.renders.length === 1 ? '' : 's'}, the approved one first` };
        case 'drawings':
            return { ok: true, note: 'The source drawing, the extracted plan, and the plan with each product\'s photo in place' };
        case 'presentation':
            return { ok: true, note: 'Cover, the space, plan, renders, products and schedule' };
        case 'model':
            return { ok: true, note: 'The 3D scene from Design & Build' };
        default:
            return { ok: true, note: 'Extraction and product placement audit' };
    }
}

function filesOf(g, s) {
    if (g.key !== 'renders') return g.files;
    const n = s.renders.length;
    return n ? Array.from({ length: Math.min(n, 3) }, (_, i) => `Perspective_${String(i + 1).padStart(2, '0')}`).concat(n > 3 ? ['…'] : []) : g.files;
}

export default function DesignBuildExportPanel({ s, requestArtifacts, onClose }) {
    const approved = s.renders.find((r) => r.id === s.approvedRenderId) || null;
    const [chosen, setChosen] = useState(() => new Set(SUITE_GROUPS.filter((g) => groupState(g, s).ok).map((g) => g.key)));
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState('');
    const [notes, setNotes] = useState([]);
    const [error, setError] = useState('');

    const toggle = (key) => {
        setChosen((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const run = useCallback(async (groups, { asZip, suffix }) => {
        setBusy(true);
        setError('');
        setNotes([]);
        try {
            setProgress('Collecting the model from Design & Build…');
            const artifacts = await requestArtifacts();
            const st = designBuild.getState();
            const result = await buildExportSuite(
                {
                    plan: st.plan,
                    artifacts,
                    products: st.products,
                    furnished: st.furnished,
                    furniture: st.furniture,
                    renders: st.renders,
                    approvedRenderId: st.approvedRenderId,
                    offer: st.offer,
                    counts: st.counts,
                },
                { groups, onProgress: (label) => setProgress(label) },
            );
            if (!result.files.length) throw new Error(result.notes[0] || 'Nothing to export yet.');
            setProgress('Saving…');
            await saveExportSuite(result, { asZip, suffix });
            designBuild.set({ exportedAt: Date.now() });
            setNotes(result.notes);
            setProgress(`Saved ${result.files.length} file${result.files.length === 1 ? '' : 's'}${artifacts ? '' : ' (Design & Build did not send its views)'}.`);
        } catch (e) {
            setError(e?.message || String(e));
            setProgress('');
        } finally {
            setBusy(false);
        }
    }, [requestArtifacts]);

    return (
        <div className={styles.exportLayer}>
            <button type="button" className={styles.exportScrim} onClick={busy ? undefined : onClose} aria-label="Close the export suite" />
            <aside className={styles.exportPanel} role="dialog" aria-label="Design & Build export suite">
                <header className={styles.exportHead}>
                    <div>
                        <h3 className={styles.exportTitle}>Export suite</h3>
                        <p className={styles.exportSub}>The full Design &amp; Build package, from the approved render and the offer&apos;s real products.</p>
                    </div>
                    <button type="button" className={styles.iconBtn} onClick={onClose} disabled={busy} title="Close">
                        <span aria-hidden>×</span>
                        <span className={styles.srOnly}>Close</span>
                    </button>
                </header>

                {approved && (
                    <figure className={styles.exportHero}>
                        <img src={approved.image} alt="Approved render" />
                        <figcaption>
                            <span className={styles.approvedTag}>✓ Approved</span>
                            {[VIEW_LABEL[approved.viewKind], approved.score ? `geometry match ${Math.round(approved.score * 100)}%` : '', approved.products?.length ? `${approved.products.length} products in view` : '']
                                .filter(Boolean)
                                .join(' · ')}
                        </figcaption>
                    </figure>
                )}

                <ul className={styles.groupList}>
                    {SUITE_GROUPS.map((g) => {
                        const st = groupState(g, s);
                        return (
                            <li key={g.key} className={`${styles.groupRow} ${st.ok ? '' : styles.groupOff}`}>
                                <label className={styles.groupCheck}>
                                    <input type="checkbox" checked={st.ok && chosen.has(g.key)} disabled={!st.ok || busy} onChange={() => toggle(g.key)} />
                                    <span className={styles.groupName}>{g.folder}/</span>
                                </label>
                                <div className={styles.groupText}>
                                    <span className={styles.groupFiles}>{filesOf(g, s).join(' · ')}</span>
                                    <span className={styles.groupNote}>{st.note}</span>
                                </div>
                                <button
                                    type="button"
                                    className={styles.groupDownload}
                                    disabled={!st.ok || busy}
                                    onClick={() => run([g.key], { asZip: g.files.length > 1 || g.key === 'renders', suffix: g.folder })}
                                    title={`Download ${g.folder} only`}
                                >
                                    ↓<span className={styles.srOnly}> Download {g.folder}</span>
                                </button>
                            </li>
                        );
                    })}
                </ul>

                <footer className={styles.exportFoot}>
                    {(error || progress) && (
                        <p className={error ? styles.exportError : styles.exportProgress} role="status" aria-live="polite">
                            {busy && <span className={styles.exportSpinner} aria-hidden />}
                            {error || progress}
                        </p>
                    )}
                    {notes.length > 0 && (
                        <details className={styles.exportNotes}>
                            <summary>{notes.length} note{notes.length === 1 ? '' : 's'}</summary>
                            <ul>{notes.map((n) => <li key={n}>{n}</li>)}</ul>
                        </details>
                    )}
                    <button
                        type="button"
                        className={styles.primaryBtn}
                        disabled={busy || chosen.size === 0}
                        onClick={() => run([...chosen], { asZip: true })}
                    >
                        {busy ? 'Preparing…' : 'Download package (.zip)'}
                    </button>
                </footer>
            </aside>
        </div>
    );
}
