import React, { useState, useEffect, useMemo } from 'react';
import { useCompanyProfile } from '../context/CompanyContext';
import { DEFAULT_AI_SETTINGS } from '../utils/aiConstants';
import styles from '../styles/AutoFillSelectModal.module.css';

const TIER_META = {
    budgetary: { label: 'Budgetary', color: '#3b82f6' },
    mid:       { label: 'Mid-Range', color: '#8b5cf6' },
    high:      { label: 'High-End',  color: '#ec4899' }
};

export default function FitoutAutoFillModal({ isOpen, onClose, allBrands = [], activeTier, onConfirm }) {
    const { aiSettings } = useCompanyProfile();
    
    const [selectedBrands, setSelectedBrands] = useState([]);

    // Filter brands containing 'fitout' or tagged as fitout (case-insensitive)
    const fitoutBrands = useMemo(() => {
        const filtered = allBrands.filter(b => 
            b.name.toLowerCase().includes('fitout') || 
            (b.type || '').toLowerCase() === 'fitout'
        );
        // If no fitout brands found in database, fallback to a default one
        if (filtered.length === 0) return [{ name: 'FitOut V2', budgetTier: 'mid', type: 'fitout' }];
        return filtered;
    }, [allBrands]);

    // Reset selection on open
    useEffect(() => {
        if (isOpen) {
            setSelectedBrands([]);
        }
    }, [isOpen, fitoutBrands]);

    const toggleBrand = (brandName, tier) => {
        const id = `${brandName}|${tier}`;
        setSelectedBrands(prev =>
            prev.includes(id)
                ? prev.filter(b => b !== id)
                : [...prev, id]
        );
    };

    const fitoutBrandsByTier = useMemo(() => {
        return {
            budgetary: fitoutBrands.filter(b => (b.budgetTier || '').toLowerCase() === 'budgetary'),
            mid:       fitoutBrands.filter(b => (b.budgetTier || 'mid').toLowerCase() === 'mid'),
            high:      fitoutBrands.filter(b => ['high', 'premium'].includes((b.budgetTier || '').toLowerCase()))
        };
    }, [fitoutBrands]);

    const selectTier = (tierKey) => {
        const ids = fitoutBrandsByTier[tierKey].map(b => `${b.name}|${tierKey}`);
        setSelectedBrands(prev => [...new Set([...prev, ...ids])]);
    };
 
    const deselectTier = (tierKey) => {
        const ids = fitoutBrandsByTier[tierKey].map(b => `${b.name}|${tierKey}`);
        setSelectedBrands(prev => prev.filter(id => !ids.includes(id)));
    };
 
    const selectAll = () => {
        const allIds = [];
        Object.keys(fitoutBrandsByTier).forEach(tKey => {
            fitoutBrandsByTier[tKey].forEach(b => {
                allIds.push(`${b.name}|${tKey}`);
            });
        });
        setSelectedBrands(allIds);
    };
    const clearAll = () => setSelectedBrands([]);

    const activeMeta = TIER_META[activeTier] || TIER_META.mid;

    if (!isOpen) return null;

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className={styles.header}>
                    <h2>Fitout AI Match</h2>
                    <button className={styles.closeBtn} onClick={onClose}>×</button>
                </div>

                <div className={styles.content}>
                    {/* Brand Selection — Fitout Only */}
                    <div className={styles.section}>
                        <div className={styles.brandSectionHeader}>
                            <span className={styles.sectionTitle}>
                                Select Database
                                <span className={styles.countPill}>{selectedBrands.length} selected</span>
                            </span>
                            <div className={styles.quickActions}>
                                <button className={styles.quickBtn} onClick={selectAll}>✓ All</button>
                                <button className={`${styles.quickBtn} ${styles.quickBtnDanger}`} onClick={clearAll}>✕ Clear</button>
                            </div>
                        </div>

                        {['budgetary', 'mid', 'high'].map((tierKey) => {
                            const brands = fitoutBrandsByTier[tierKey];
                            if (!brands.length) return null;
                            const meta = TIER_META[tierKey];
                            const tierSelected = brands.filter(b => selectedBrands.includes(`${b.name}|${tierKey}`)).length;
                            const isActive = tierKey === activeTier;
                            return (
                                <div key={tierKey} className={`${styles.tierGroup} ${isActive ? styles.tierGroupActive : ''}`} style={isActive ? { borderColor: meta.color + '60' } : {}}>
                                    <div className={styles.tierHeader}>
                                        <div className={styles.tierLabel}>
                                            <span className={styles.tierDot} style={{ background: meta.color }} />
                                            <span style={{ color: meta.color }}>{meta.label}</span>
                                            {isActive && <span className={styles.activePill} style={{ background: meta.color + '30', color: meta.color }}>Active Tab</span>}
                                            <span className={styles.countBadge}>{tierSelected}/{brands.length}</span>
                                        </div>
                                        <div className={styles.tierActions}>
                                            <button onClick={() => selectTier(tierKey)}>All</button>
                                            <button onClick={() => deselectTier(tierKey)}>None</button>
                                        </div>
                                    </div>
                                    <div className={styles.brandGrid}>
                                        {brands.map(b => {
                                            const brandId = `${b.name}|${tierKey}`;
                                            const isChecked = selectedBrands.includes(brandId);
                                            return (
                                                <div
                                                    key={brandId}
                                                    className={`${styles.brandItem} ${isChecked ? styles.checked : ''}`}
                                                    onClick={() => toggleBrand(b.name, tierKey)}
                                                    style={isChecked ? { borderColor: meta.color, background: meta.color + '15' } : {}}
                                                >
                                                    <input type="checkbox" checked={isChecked} readOnly style={{ accentColor: meta.color }} />
                                                    <span className={styles.brandName}>{b.name}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Footer */}
                <div className={styles.footer}>
                    <button className={styles.btnCancel} onClick={onClose}>Cancel</button>
                    <button
                        className={styles.btnConfirm}
                        disabled={selectedBrands.length === 0}
                        onClick={() => onConfirm(selectedBrands, aiSettings?.engine || 'google', aiSettings?.model || DEFAULT_AI_SETTINGS.model)}
                        style={{ background: activeMeta.color }}
                    >
                        Start Fitout AI Batch — {selectedBrands.length} Selected
                    </button>
                </div>
            </div>
        </div>
    );
}
