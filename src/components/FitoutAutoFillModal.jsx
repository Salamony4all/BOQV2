import React, { useState, useEffect, useMemo } from 'react';
import styles from '../styles/AutoFillSelectModal.module.css';

export default function FitoutAutoFillModal({ isOpen, onClose, allBrands = [], activeTier, onConfirm }) {
    const [selectedBrands, setSelectedBrands] = useState([]);
    const [selectedEngine, setSelectedEngine] = useState('google');

    const tierMeta = {
        budgetary: { label: 'Budgetary', color: '#3b82f6' },
        mid:       { label: 'Mid-Range', color: '#8b5cf6' },
        high:      { label: 'High-End',  color: '#ec4899' }
    };

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
            // Priority: select "FitOut V2" if found, otherwise select all found brands
            const v2Match = fitoutBrands.find(b => b.name === 'FitOut V2');
            if (v2Match) {
                setSelectedBrands([v2Match.name]);
            } else {
                setSelectedBrands(fitoutBrands.map(b => b.name));
            }
            setSelectedEngine('google');
        }
    }, [isOpen, fitoutBrands]);

    if (!isOpen) return null;

    const toggleBrand = (brandName) => {
        setSelectedBrands(prev =>
            prev.includes(brandName)
                ? prev.filter(b => b !== brandName)
                : [...prev, brandName]
        );
    };

    const engines = [
        { id: 'google',     name: 'Gemini 2.5 Flash', desc: 'Google · Higher Precision · Web Search', icon: 'AI', color: '#1a73e8' }
    ];

    const activeMeta = tierMeta[activeTier] || tierMeta.mid;

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className={styles.header}>
                    <h2>Fitout AI Match</h2>
                    <button className={styles.closeBtn} onClick={onClose}>×</button>
                </div>

                <div className={styles.content}>

                    {/* 1. AI Engine */}
                    <div className={styles.section}>
                        <span className={styles.sectionTitle}>1. Choose AI Engine</span>
                        <div className={styles.engineGrid}>
                            {engines.map(engine => (
                                    <div
                                        key={engine.id}
                                        className={`${styles.engineCard} ${selectedEngine === engine.id ? styles.active : ''}`}
                                        onClick={() => setSelectedEngine(engine.id)}
                                        style={selectedEngine === engine.id ? { borderColor: engine.color, background: engine.color + '10' } : {}}
                                    >
                                        <span className={styles.engineIcon} style={{ background: engine.color }}>{engine.icon}</span>
                                        <div className={styles.engineInfo}>
                                            <span className={styles.engineName}>{engine.name}</span>
                                            <span className={styles.engineDesc}>{engine.desc}</span>
                                        </div>
                                    </div>
                            ))}
                        </div>
                    </div>

                    {/* 2. Brand Selection — Fitout Only */}
                    <div className={styles.section}>
                        <div className={styles.brandSectionHeader}>
                            <span className={styles.sectionTitle}>
                                2. Select Database
                                <span className={styles.countPill}>{selectedBrands.length} selected</span>
                            </span>
                        </div>

                        <div className={`${styles.tierGroup} ${styles.tierGroupActive}`} style={{ borderColor: activeMeta.color + '60' }}>
                            <div className={styles.tierHeader}>
                                <div className={styles.tierLabel}>
                                    <span className={styles.tierDot} style={{ background: activeMeta.color }} />
                                    <span style={{ color: activeMeta.color }}>{activeMeta.label} ({activeTier})</span>
                                    <span className={styles.activePill} style={{ background: activeMeta.color + '30', color: activeMeta.color }}>Active Tab</span>
                                </div>
                            </div>
                            <div className={styles.brandGrid}>
                                {fitoutBrands.map(b => (
                                    <div
                                        key={b.name}
                                        className={`${styles.brandItem} ${selectedBrands.includes(b.name) ? styles.checked : ''}`}
                                        onClick={() => toggleBrand(b.name)}
                                        style={selectedBrands.includes(b.name) ? { borderColor: activeMeta.color, background: activeMeta.color + '15' } : {}}
                                    >
                                        <input type="checkbox" checked={selectedBrands.includes(b.name)} readOnly style={{ accentColor: activeMeta.color }} />
                                        <span className={styles.brandName}>{b.name}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className={styles.footer}>
                    <button className={styles.btnCancel} onClick={onClose}>Cancel</button>
                    <button
                        className={styles.btnConfirm}
                        disabled={selectedBrands.length === 0}
                        onClick={() => onConfirm(selectedBrands, selectedEngine)}
                        style={{ background: activeMeta.color }}
                    >
                        Start Fitout AI Batch
                    </button>
                </div>
            </div>
        </div>
    );
}
