import React, { useState, useEffect, useMemo } from 'react';
import styles from '../styles/AutoFillSelectModal.module.css';

export default function AutoFillSelectModal({ isOpen, onClose, allBrands, activeTier, onConfirm }) {
    const [selectedBrands, setSelectedBrands] = useState([]);
    const [selectedEngine, setSelectedEngine] = useState('google');
    const [selectedModel, setSelectedModel] = useState('gemini-2.5-flash');

    const modelOptions = {
        google: ['gemini-2.5-flash', 'gemini-2.0-flash-exp', 'gemini-1.5-flash', 'gemini-1.5-flash-002', 'gemini-1.5-pro'],
        openrouter: ['google/gemini-2.5-flash-lite-001', 'google/gemini-4-31b-it:free', 'google/gemma-4-26b-a4b-it:free', 'google/gemma-4-31b-it:free', 'z-ai/glm-5.1', 'cohere/rerank-4-pro'],
        nvidia: ['meta/llama-3.1-405b-instruct', 'meta/llama-3.1-70b-instruct', 'meta/llama-3.3-70b-instruct', 'nvidia/nemotron-3-super-120b-a12b', 'nvidia/gemma-4-31b-it']
    };

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

    // Reset to empty on open
    useEffect(() => {
        if (isOpen) {
            setSelectedBrands([]);
            setSelectedEngine('google');
            setSelectedModel(modelOptions.google[0]);
        }
    }, [isOpen]);

    useEffect(() => {
        setSelectedModel(modelOptions[selectedEngine][0]);
    }, [selectedEngine]);

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

    const engines = [
        { id: 'google',     name: 'Gemini 2.5 Flash', desc: 'Google · Higher Precision · Web Search', icon: 'AI', color: '#1a73e8' },
        { id: 'openrouter', name: 'Open Router',       desc: 'Universal · Gemini 2.0 Flash Lite',      icon: 'OR', color: '#8b5cf6' },
        { id: 'nvidia',     name: 'Nvidia NIM',        desc: 'NVIDIA · Llama 3.3 70B · Ultra Fast',   icon: 'NV', color: '#76b900' }
    ];

    const activeMeta = tierMeta[activeTier] || tierMeta.mid;

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className={styles.header}>
                    <h2>AI AutoFill</h2>
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

                        <div className={styles.modelSection}>
                            <span className={styles.sectionSubtitle}>Select Model</span>
                            <select
                                className={styles.modelSelect}
                                value={selectedModel}
                                onChange={(event) => setSelectedModel(event.target.value)}
                            >
                                {modelOptions[selectedEngine].map((model) => (
                                    <option key={model} value={model}>{model}</option>
                                ))}
                            </select>
                            <p className={styles.modelHint}>Choose the exact model name used by the selected AI provider.</p>
                        </div>
                    </div>

                    {/* 2. Brand Selection — all tiers */}
                    <div className={styles.section}>
                        <div className={styles.brandSectionHeader}>
                            <span className={styles.sectionTitle}>
                                2. Select Brands
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
                        onClick={() => onConfirm(selectedBrands, selectedEngine, selectedModel)}
                    >
                        Start AI Batch — {selectedBrands.length} Brand{selectedBrands.length !== 1 ? 's' : ''}
                    </button>
                </div>
            </div>
        </div>
    );
}
