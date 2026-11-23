import React, { useRef, useState } from 'react';
import { designBuild, useDesignBuild, isPdfFile, productsFromTables } from '../features/designBuild/designBuildStore';
import styles from '../styles/DesignBuildButton.module.css';

// One click from a table to Design & Build: the table's lines (with their pictures)
// furnish the 3D model of the plan, ready to render with the real products. It uses
// the open session, else the last plan uploaded, else asks for the plan PDF once.

/**
 * @param {{ getTables: () => any[], title?: string, compact?: boolean }} props
 *   getTables: the tables to send (read on click, so they are always current).
 */
export default function DesignBuildButton({ getTables, title = 'Offer', compact = false }) {
    const s = useDesignBuild();
    const inputRef = useRef(null);
    const pendingRef = useRef(null);
    const [note, setNote] = useState('');

    const offerOf = () => {
        let tables = [];
        try {
            tables = (typeof getTables === 'function' ? getTables() : getTables) || [];
        } catch {
            tables = [];
        }
        return { products: productsFromTables(tables), offer: { tables, title } };
    };

    const start = (plan, { products, offer }) => {
        designBuild.openWithPlan(plan);
        designBuild.setProducts(products, offer);
    };

    const onClick = () => {
        setNote('');
        const next = offerOf();
        if (!next.products.length) {
            setNote('No lines with a quantity to place in this table.');
            return;
        }
        const st = designBuild.getState();
        if (st.open) {
            // The model is already built: furnish it with this table instead.
            designBuild.setProducts(next.products, next.offer);
            designBuild.restore();
            return;
        }
        if (st.lastPlan) {
            start(st.lastPlan, next);
            return;
        }
        pendingRef.current = next;
        inputRef.current?.click();
    };

    const onPlan = (e) => {
        const file = Array.from(e.target.files || []).find(Boolean);
        e.target.value = '';
        const next = pendingRef.current;
        pendingRef.current = null;
        if (!file || !next) return;
        if (!isPdfFile(file)) {
            setNote('Pick the floor plan as a PDF (the drawing the 3D model is built from).');
            return;
        }
        start(file, next);
    };

    const planName = s.open ? s.plan?.name : s.lastPlan?.name;
    const sub = s.open
        ? 'Furnish the 3D model with this table'
        : planName
            ? '3D model · real products · renders'
            : 'Pick the plan PDF · 3D · renders';
    const tip = s.open
        ? `Furnish the open Design & Build model (${planName || 'plan'}) with the products of this table`
        : planName
            ? `Build ${planName} in 3D, furnished with the products of this table (their pictures included), then render it`
            : 'Pick the floor plan PDF: Design & Build builds it in 3D, furnished with the products of this table, ready to render';

    return (
        <span className={`${styles.wrap} ${compact ? styles.compact : ''}`}>
            <button type="button" className={styles.btn} onClick={onClick} title={tip}>
                <span className={styles.mark} aria-hidden>DB</span>
                <span className={styles.text}>
                    <span className={styles.label}>{s.open ? 'Open in Design & Build' : 'Design & Build'}</span>
                    {!compact && <span className={styles.sub}>{sub}</span>}
                </span>
                {s.open && <span className={styles.live} aria-label="Session open" />}
            </button>
            <input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden onChange={onPlan} />
            {note && (
                <span className={styles.note} role="status">
                    {note}
                </span>
            )}
        </span>
    );
}
