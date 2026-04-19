import React, { useState, useEffect, useMemo } from 'react';
import { useCompanyProfile } from '../context/CompanyContext';
import { DEFAULT_AI_SETTINGS } from '../utils/aiConstants';
import styles from '../styles/AutoFillSelectModal.module.css';

export default function AutoFillSelectModal({ isOpen, onClose, allBrands, activeTier, onConfirm }) {
    const { aiSettings } = useCompanyProfile();
    
    const [selectedBrands, setSelectedBrands] = useState([]);

    const tierMeta = {
        budgetary: { label: 'Budgetary', color: '#3b82f6' },
        mid:       { label: 'Mid-Range', color: '#8b5cf6' },
        high:      { label: 'High-End',  color: '#ec4899' }
    };

    // Group ALL furniture brands by tier (exclude specialized fitout brands)
    const furnitureBrands = useMemo(() => {
        return allBrands.filter(b => !b.name.toLowerCase().includes('fitout'));
    }, [allBrands]);

    const groupedBrands = useMemo(() => ({
        budgetary: furnitureBrands.filter(b => (b.budgetTier || '').toLowerCase() === 'budgetary'),
        mid:       furnitureBrands.filter(b => (b.budgetTier || 'mid').toLowerCase() === 'mid'),
        high:      furnitureBrands.filter(b => ['high', 'premium'].includes((b.budgetTier || '').toLowerCase()))
    }), [furnitureBrands]);

    useEffect(() => {
        if (isOpen) {
            setSelectedBrands([]);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const toggleBrand = (brandName) => {
        setSelectedBrands(prev =>
            prev.includes(brandName)
                ? prev.filter(b => b !== brandName)
                : [...prev, brandName]
        );
    };

    const selectTier = (tierKey) => {
        const names = groupedBrands[tierKey].map(b => b.name);
        setSelectedBrands(prev => [...new Set([...prev, ...names])]);
    };

    const deselectTier = (tierKey) => {
        const names = groupedBrands[tierKey].map(b => b.name);
        setSelectedBrands(prev => prev.filter(b => !names.includes(b)));
    };

    const selectAll  = () => setSelectedBrands(furnitureBrands.map(b => b.name));
    const clearAll   = () => setSelectedBrands([]);

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className={styles.header}>
                    <h2>AI AutoFill</h2>
                    <button className={styles.closeBtn} onClick={onClose}>×</button>
                </div>

                <div className={styles.content}>
                    {/* Brand Selection — all tiers */}
                    <div className={styles.section}>
                        <div className={styles.brandSectionHeader}>
                            <span className={styles.sectionTitle}>
                                Select Brands
                                <span className={styles.countPill}>{selectedBrands.length} selected</span>
                            </span>
                            <div className={styles.quickActions}>
                                <button className={styles.quickBtn} onClick={selectAll}>✓ All</button>
                                <button className={`${styles.quickBtn} ${styles.quickBtnDanger}`} onClick={clearAll}>✕ Clear</button>
                            </div>
                        </div>

                        {/* Tier groups */}
                        {['budgetary', 'mid', 'high'].map(tierKey => {
                            const brands = groupedBrands[tierKey];
                            if (brands.length === 0) return null;
                            const meta = tierMeta[tierKey];
                            const isActive = tierKey === activeTier;
                            const tierSelected = brands.filter(b => selectedBrands.includes(b.name)).length;
                            return (
                                <div key={tierKey} className={`${styles.tierGroup} ${isActive ? styles.tierGroupActive : ''}`}
                                     style={isActive ? { borderColor: meta.color + '60' } : {}}>
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
                                        {brands.map(b => (
                                            <div
                                                key={b.name}
                                                className={`${styles.brandItem} ${selectedBrands.includes(b.name) ? styles.checked : ''}`}
                                                onClick={() => toggleBrand(b.name)}
                                                style={selectedBrands.includes(b.name) ? { borderColor: meta.color, background: meta.color + '15' } : {}}
                                            >
                                                <input type="checkbox" checked={selectedBrands.includes(b.name)} readOnly style={{ accentColor: meta.color }} />
                                                <span className={styles.brandName}>{b.name}</span>
                                            </div>
                                        ))}
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
                    >
                        Start AI Batch — {selectedBrands.length} Brand{selectedBrands.length !== 1 ? 's' : ''}
                    </button>
                </div>
            </div>
        </div>
    );
}
