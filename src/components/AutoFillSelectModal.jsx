import React, { useState, useEffect, useMemo } from 'react';
import BrandDropdown from './BrandDropdown';
import { useCompanyProfile } from '../context/CompanyContext';
import { DEFAULT_AI_SETTINGS } from '../utils/aiConstants';
import styles from '../styles/AutoFillSelectModal.module.css';

export default function AutoFillSelectModal({ isOpen, onClose, allBrands, activeTier, onConfirm }) {
    const { aiSettings } = useCompanyProfile();
    
    const [selectedBrands, setSelectedBrands] = useState({});

    const tierMeta = {
        budgetary: { label: 'Budgetary', color: '#3b82f6' },
        mid:       { label: 'Mid-Range', color: '#8b5cf6' },
        high:      { label: 'High-End',  color: '#ec4899' }
    };

    // All furniture brands (exclude specialized fitout brands)
    const furnitureBrands = useMemo(() => {
        return allBrands.filter(b => !b.name.toLowerCase().includes('fitout'));
    }, [allBrands]);

    useEffect(() => {
        if (isOpen) {
            setSelectedBrands({});
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const clearAll = () => setSelectedBrands({});

    const handleTierBrandSelect = (tierKey, brand) => {
        setSelectedBrands(prev => ({ ...prev, [tierKey]: brand.name }));
    };

    const handleTierBrandRemove = (tierKey) => {
        setSelectedBrands(prev => {
            const next = { ...prev };
            delete next[tierKey];
            return next;
        });
    };

    const selectedCount = Object.keys(selectedBrands).length;

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
                                <span className={styles.countPill}>{selectedCount} selected</span>
                            </span>
                            <div className={styles.quickActions}>
                                <button className={`${styles.quickBtn} ${styles.quickBtnDanger}`} onClick={clearAll}> Clear All</button>
                            </div>
                        </div>

                        <p className={styles.helperText} style={{ margin: '0 0 1.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            Choose one target brand for each budget tier to run the AI AutoFill.
                        </p>

                        {/* Tier groups */}
                        {['budgetary', 'mid', 'high'].map(tierKey => {
                            const meta = tierMeta[tierKey];
                            const isActive = tierKey === activeTier;
                            
                            // Find the currently selected brand for THIS tier slot
                            const tierSelectedBrand = selectedBrands[tierKey] || "";

                            return (
                                <div key={tierKey} className={`${styles.tierGroup} ${isActive ? styles.tierGroupActive : ''}`}
                                     style={isActive ? { borderColor: meta.color + '60' } : {}}>
                                    <div className={styles.tierHeader}>
                                        <div className={styles.tierLabel}>
                                            <span className={styles.tierDot} style={{ background: meta.color }} />
                                            <span style={{ color: meta.color, fontWeight: 600 }}>{meta.label}</span>
                                            {isActive && <span className={styles.activePill} style={{ background: meta.color + '30', color: meta.color }}>Active Tab</span>}
                                        </div>
                                        {tierSelectedBrand && (
                                            <button 
                                                className={styles.tierClearBtn}
                                                onClick={() => handleTierBrandRemove(tierKey)}
                                                style={{ fontSize: '0.75rem', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                                            >
                                                Clear
                                            </button>
                                        )}
                                    </div>
                                    <div style={{ padding: '0 1rem 1.2rem' }}>
                                        <BrandDropdown 
                                            brands={furnitureBrands}
                                            selectedBrands={tierSelectedBrand}
                                            multiple={false}
                                            onSelect={(b) => handleTierBrandSelect(tierKey, b)}
                                            onRemove={() => handleTierBrandRemove(tierKey)}
                                            placeholder={`Select ${meta.label} brand...`}
                                        />
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
                        disabled={selectedCount === 0}
                        onClick={() => onConfirm(selectedBrands, aiSettings?.engine || 'google', aiSettings?.model || DEFAULT_AI_SETTINGS.model)}
                    >
                        Start AI Batch {selectedCount > 0 ? `(${selectedCount})` : ''}
                    </button>
                </div>
            </div>
        </div>
    );
}
