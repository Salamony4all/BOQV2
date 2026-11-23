import React from 'react';
import DesignBuildButton from './DesignBuildButton';
import { designBuild, useDesignBuild } from '../features/designBuild/designBuildStore';
import styles from '../styles/OfferPipeline.module.css';

// The table actions as one pipeline, top to bottom: match the lines, value-engineer,
// compare budgets, export. Each step is a card on a numbered rail.

/**
 * The numbered rail. `start` numbers a part of it shown further down the page: `joined`
 * when it follows straight on (the rail of the part above is `open` at its end),
 * `continued` when something stands between (the costed results), with a dashed lead-in.
 */
export function Pipeline({ title, sub, tools, start = 1, open = false, joined = false, continued = false, children, label = 'Offer pipeline' }) {
    const cls = [styles.pipeline, open && styles.open, joined && styles.joined, continued && styles.continued].filter(Boolean).join(' ');
    return (
        <section className={cls} aria-label={label}>
            {(title || tools) && (
                <div className={styles.top}>
                    {title && (
                        <div className={styles.heading}>
                            <h2 className={styles.headingTitle}>{title}</h2>
                            {sub && <p className={styles.headingSub}>{sub}</p>}
                        </div>
                    )}
                    {tools && <div className={styles.tools}>{tools}</div>}
                </div>
            )}
            <ol className={styles.steps} start={start}>
                {children}
            </ol>
        </section>
    );
}

/**
 * One step: its number (a tick once its offer is the one in the costed results), what it
 * does, its main action, and anything it shows while it works.
 */
export function PipelineStep({ n, title, sub, tone = 'match', done = false, badge = '', actions = null, children = null, id }) {
    return (
        <li className={`${styles.step} ${styles[tone] || ''} ${done ? styles.done : ''}`} id={id}>
            <span className={styles.rail} aria-hidden>
                <span className={styles.dot}>{done ? '✓' : n}</span>
            </span>
            <div className={styles.card}>
                <div className={styles.cardHead}>
                    <h3 className={styles.cardTitle}>
                        <span className={styles.srOnly}>Step {n}: </span>
                        {title}
                    </h3>
                    {badge && <span className={styles.badge}>{badge}</span>}
                </div>
                {sub && <p className={styles.cardSub}>{sub}</p>}
                {actions && <div className={styles.actions}>{actions}</div>}
                {children}
            </div>
        </li>
    );
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const NETWORK_ERROR = /failed to fetch|networkerror|load failed|network request failed/i;

/**
 * What one-click matching is doing: the progress of a run, then what it found.
 * `run.status`: idle | running | done | none | error | empty.
 */
export function QuickMatchStatus({ run, offerActive, onStop, onView }) {
    if (run.status === 'running') {
        const pct = run.total ? Math.round((run.done / run.total) * 100) : 0;
        return (
            <div className={styles.progress} role="status" aria-live="polite">
                <div className={styles.bar} aria-hidden>
                    <span style={{ width: `${Math.max(pct, 4)}%` }} />
                </div>
                <div className={styles.progressRow}>
                    <span className={styles.progressText}>
                        Matching {run.done} of {plural(run.total, 'line')} · {run.found} found
                    </span>
                    <button type="button" className={styles.linkBtn} onClick={onStop}>Stop</button>
                </div>
                {run.current && <span className={styles.current} title={run.current}>{run.current}</span>}
                {run.preview?.length > 0 && (
                    <span className={styles.thumbs} aria-hidden>
                        {run.preview.map((src) => <img key={src} src={src} alt="" loading="lazy" />)}
                    </span>
                )}
            </div>
        );
    }
    if (run.status === 'done' && offerActive) {
        const left = run.total - run.found;
        return (
            <p className={styles.result} role="status">
                <span className={styles.resultMain}>
                    {run.stopped ? 'Stopped: ' : ''}
                    {run.found} of {plural(run.total, 'line')} matched{run.exact ? ` · ${run.exact} as specified` : ''}
                </span>
                <span className={styles.resultNote}>
                    {left > 0 ? `${plural(left, 'line')} kept as in the BOQ. ` : ''}
                    The matched offer is in the costed results.
                </span>
                <button type="button" className={styles.linkBtn} onClick={onView}>View the offer</button>
            </p>
        );
    }
    if (run.status === 'none' || run.status === 'error') {
        return (
            <p className={`${styles.result} ${styles.resultError}`} role="alert">
                <span className={styles.resultMain}>{run.status === 'error' ? 'The matcher could not be reached.' : 'No catalogue product was found for these lines.'}</span>
                {run.error && (
                    <span className={styles.resultNote}>
                        {NETWORK_ERROR.test(run.error) ? 'Check the connection to the BOQ Flow server, then match again.' : run.error}
                    </span>
                )}
            </p>
        );
    }
    if (run.status === 'empty') {
        return <p className={styles.resultNote}>No line with a description and a quantity to match.</p>;
    }
    return null;
}

const SUITE_FILES = '3D model · renders · BOQ · FF&E schedule · mood board · drawings · presentation';

/**
 * The Design & Build export suite in the exports: the one-click button (the plan in 3D,
 * furnished with these products), and the package once a render is approved.
 */
export function DesignBuildSuite({ getTables, title }) {
    const s = useDesignBuild();
    const ready = s.open && !!s.approvedRenderId;
    const hint = ready
        ? `Render approved: the package is ready${s.offer?.title ? ` (${s.offer.title})` : ''}.`
        : s.open
            ? 'Render a view and approve it in Design & Build, then download the package.'
            : 'Builds the plan in 3D with these products, ready to render; approve a render to download the package.';
    return (
        <div className={styles.suite}>
            <div className={styles.suiteText}>
                <span className={styles.suiteTitle}>
                    Design &amp; Build export suite
                    <span className={styles.newTag}>New</span>
                </span>
                <span className={styles.suiteFiles}>{SUITE_FILES} · .zip</span>
            </div>
            <div className={styles.suiteActions}>
                <DesignBuildButton getTables={getTables} title={title} />
                {ready && (
                    <button type="button" className={styles.suiteBtn} onClick={() => designBuild.openExportSuite()}>
                        Download package
                    </button>
                )}
            </div>
            <span className={styles.suiteHint}>{hint}</span>
        </div>
    );
}

/** Which tables the exports use: the offer in the costed results, or the BOQ as extracted. */
export function ExportSource({ value, onChange, offerName }) {
    const options = [
        { key: 'offer', label: offerName || 'Costed offer' },
        { key: 'original', label: 'Extracted BOQ' },
    ];
    return (
        <div className={styles.source} role="radiogroup" aria-label="Export">
            {options.map((o) => (
                <button
                    key={o.key}
                    type="button"
                    role="radio"
                    aria-checked={value === o.key}
                    className={`${styles.sourceBtn} ${value === o.key ? styles.sourceOn : ''}`}
                    onClick={() => onChange(o.key)}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}
