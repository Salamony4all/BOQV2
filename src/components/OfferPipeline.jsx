import React from 'react';
import DesignBuildButton from './DesignBuildButton';
import { designBuild, useDesignBuild } from '../features/designBuild/designBuildStore';
import { getFullUrl } from '../utils/urlUtils';
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

/**
 * What one-click matching (the Value Engineer's 1-Click Auto Detect, run from the pipeline) is
 * doing: the run's progress, then what it found. `run.status`: idle | running | done | none |
 * busy | empty.
 */
export function QuickMatchStatus({ run, offerActive, onView, onReview }) {
    if (run.status === 'running') {
        const scanning = !run.total || run.stage === 'routing';
        const pct = run.total ? Math.round((run.current / run.total) * 100) : 0;
        return (
            <div className={styles.progress} role="status" aria-live="polite">
                <div className={styles.bar} aria-hidden>
                    <span style={{ width: `${Math.max(pct, 4)}%` }} />
                </div>
                <div className={styles.progressRow}>
                    <span className={styles.progressText}>
                        {scanning
                            ? 'Scanning the specs and catalogues…'
                            : `Matching ${run.current} of ${plural(run.total, 'line')} · ${run.found} found`}
                    </span>
                    <button type="button" className={styles.linkBtn} onClick={onReview}>Watch in the Value Engineer</button>
                </div>
                {run.item && <span className={styles.current} title={run.item}>{run.item}</span>}
                {run.model && (
                    <span className={styles.found}>
                        {run.image && <img src={getFullUrl(run.image)} alt="" loading="lazy" />}
                        <span>Found: {run.model}{run.brand ? ` · ${run.brand}` : ''}</span>
                    </span>
                )}
            </div>
        );
    }
    if (run.status === 'done' && offerActive) {
        const left = Math.max(0, run.total - run.found);
        return (
            <p className={styles.result} role="status">
                <span className={styles.resultMain}>{run.found} of {plural(run.total, 'line')} matched</span>
                <span className={styles.resultNote}>
                    {left > 0 ? `${plural(left, 'line')} to review. ` : ''}
                    The matched offer is in the costed results.
                </span>
                <button type="button" className={styles.linkBtn} onClick={onView}>View the offer</button>
                <button type="button" className={styles.linkBtn} onClick={onReview}>Review in the Value Engineer</button>
            </p>
        );
    }
    if (run.status === 'none') {
        return (
            <p className={`${styles.result} ${styles.resultError}`} role="alert">
                <span className={styles.resultMain}>No catalogue product was found for these lines.</span>
                <button type="button" className={styles.linkBtn} onClick={onReview}>Review in the Value Engineer</button>
            </p>
        );
    }
    if (run.status === 'busy') {
        return (
            <p className={`${styles.result} ${styles.resultError}`} role="alert">
                <span className={styles.resultMain}>The Value Engineer is already matching.</span>
                <button type="button" className={styles.linkBtn} onClick={onReview}>Watch it there</button>
            </p>
        );
    }
    if (run.status === 'empty') {
        return <p className={styles.resultNote}>No lines to match in this BOQ.</p>;
    }
    return null;
}

const SUITE_FILES = '3D model · renders · offer & BOQ · project action & plan (.xlsx + MS Project .xml) · MAS, MIR, WIR · FF&E schedule · mood board · drawings · presentation, with your logo and project details';

/**
 * The Design & Build export suite in the exports: the one-click button (the plan in 3D,
 * furnished with these products), and the package once a render is approved.
 */
export function DesignBuildSuite({ getTables, title }) {
    const s = useDesignBuild();
    const approved = s.open && s.renders.some((r) => r.id === s.approvedRenderId);
    const canExport = approved || (s.open && s.status === 'ready');
    const waiting = s.open && !approved && s.renders.length > 0;
    const busy = !!s.exporting;
    const hint = busy
        ? s.exporting.label || 'Preparing the package…'
        : s.exportError && canExport
            ? `The package could not be made: ${s.exportError}`
            : canExport
                ? s.exportResult
                    ? (s.exportResult.asZip !== false
                        ? `Saved .zip suite (${s.exportResult.files} files incl. Project Plan & BOQ) to your downloads.`
                        : `Saved ${s.exportResult.files} file${s.exportResult.files === 1 ? '' : 's'} to your downloads.`)
                    : `${approved ? 'Render approved' : '3D model ready'}: the package is ready${s.offer?.title ? ` (${s.offer.title})` : ''}.`
                : waiting
                    ? `${s.renders.length} render${s.renders.length === 1 ? '' : 's'} in Design & Build: use the newest for the package, or review them there.`
                    : s.open
                        ? 'Render a view in Design & Build, then Continue in BOQ Flow: the package downloads here.'
                        : 'Builds the plan in 3D with these products, ready to render; render a view to download the package.';
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
                {canExport && (
                    <button type="button" className={styles.suiteBtn} onClick={() => designBuild.downloadPackage()} disabled={busy}>
                        {busy ? 'Preparing…' : 'Download package'}
                    </button>
                )}
                {waiting && (
                    <button
                        type="button"
                        className={styles.suiteBtn}
                        onClick={() => designBuild.approveRender(s.renders[s.renders.length - 1].id)}
                        title="Put the newest render in the package"
                    >
                        Use the newest render
                    </button>
                )}
            </div>
            <span className={`${styles.suiteHint} ${s.exportError && canExport && !busy ? styles.suiteHintError : ''}`} role="status" aria-live="polite">
                {hint}
                {canExport && !busy && (
                    <>
                        {' '}
                        <button type="button" className={styles.linkBtn} onClick={() => designBuild.openExportSuite()}>
                            Choose files
                        </button>
                    </>
                )}
            </span>
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
