import React, { useState, useEffect, useMemo } from 'react';
import styles from '../styles/AutoFillSelectModal.module.css';

const MODEL_OPTIONS = {
    google: {
        gemma: [
            'gemma-4-31b-it',
            'gemma-4-26b-a4b-it',
            'gemma-3-27b-it',
            'gemma-3-12b-it',
            'gemma-3-4b-it',
            'gemma-3n-e4b-it',
            'gemma-3n-e2b-it'
        ],
        gemini: [
            'gemini-2.5-pro',
            'gemini-2.5-flash',
            'gemini-2.0-flash',
            'gemini-2.0-flash-lite',
            'gemini-3-flash-preview',
            'gemini-3.1-pro-preview',
            'gemini-flash-latest',
            'gemini-1.5-pro',
            'gemini-1.5-flash'
        ],
        paid: [
            'gemini-1.5-pro-001',
            'gemini-1.5-pro-002',
            'gemini-1.5-flash-001',
            'gemini-1.5-flash-002',
            'gemini-1.0-pro'
        ]
    },
    openrouter: ['google/gemini-2.5-flash-lite-001', 'anthropic/claude-opus-4.6-fast', 'anthropic/claude-opus-4', 'anthropic/claude-sonnet-4-20250514', 'openai/gpt-4-vision-preview', 'openai/gpt-4-turbo-vision'],
    nvidia: ['nvidia/llama-3.3-70b-instruct', 'nvidia/llama-3.1-70b-instruct', 'nvidia/nemotron-3-super-120b-a12b', 'nvidia/gemma-4-31b-it', 'nvidia/cosmos-transfer2_5-2b', 'nvidia/llama-3.1-nemotron-nano-8b-v1', 'nvidia/llama-3.1-nemotron-70b-reward', 'nvidia/llama-3.1-nemotron-ultra-253b-v1', 'nvidia/llama-3.3-nemotron-super-49b-v1', 'nvidia/llama-3.3-nemotron-super-49b-v1.5'],
    local: ['llama3.2']
};

const TIER_META = {
    budgetary: { label: 'Budgetary', color: '#3b82f6' },
    mid:       { label: 'Mid-Range', color: '#8b5cf6' },
    high:      { label: 'High-End',  color: '#ec4899' }
};

const ENGINES = [
    { id: 'google',     name: 'Google Text',       desc: 'Google · Text-only furniture/fitout',        icon: 'AI', color: '#1a73e8' },
    { id: 'local',      name: 'Local LLM',         desc: 'Llama 3.2 · Offline Capability',             icon: 'LL', color: '#b91c1c' },
    { id: 'openrouter', name: 'OpenRouter Text',    desc: 'OpenRouter · Text-only model gateway',      icon: 'OR', color: '#8b5cf6' },
    { id: 'nvidia',     name: 'Nvidia Text',        desc: 'NVIDIA · Text-only model support',          icon: 'NV', color: '#76b900' }
];

export default function FitoutAutoFillModal({ isOpen, onClose, allBrands = [], activeTier, onConfirm }) {
    const [selectedBrands, setSelectedBrands] = useState([]);
    const [selectedEngine, setSelectedEngine] = useState('google');
    const [selectedModel, setSelectedModel] = useState('gemma-4-31b-it');

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
            setSelectedEngine('google');
            setSelectedModel(MODEL_OPTIONS.google.gemma[0]);
        }
    }, [isOpen, fitoutBrands]);

    useEffect(() => {
        const engineOptions = MODEL_OPTIONS[selectedEngine];
        if (selectedEngine === 'google') {
            setSelectedModel(engineOptions.gemma[0]);
        } else {
            setSelectedModel(engineOptions[0]);
        }
    }, [selectedEngine]);

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

                    {/* 1. AI Engine */}
                    <div className={styles.section}>
                        <span className={styles.sectionTitle}>1. Choose AI Engine</span>
                        <div className={styles.engineGrid}>
                            {ENGINES.map(engine => (
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
                                {selectedEngine === 'google' ? (
                                    <>
                                        <optgroup label="Free List (Gemma Family)">
                                            {MODEL_OPTIONS.google.gemma.map((model) => (
                                                <option key={model} value={model}>{model}</option>
                                            ))}
                                        </optgroup>
                                        <optgroup label="Free List (Gemini Family)">
                                            {MODEL_OPTIONS.google.gemini.map((model) => (
                                                <option key={model} value={model}>{model}</option>
                                            ))}
                                        </optgroup>
                                        <optgroup label="Paid List (Billed Key)">
                                            {MODEL_OPTIONS.google.paid.map((model) => (
                                                <option key={model} value={model}>{model}</option>
                                            ))}
                                        </optgroup>
                                    </>
                                ) : (
                                    MODEL_OPTIONS[selectedEngine].map((model) => (
                                        <option key={model} value={model}>{model}</option>
                                    ))
                                )}
                            </select>
                            <p className={styles.modelHint}>Choose the model used for the fitout processing workflow.</p>
                        </div>
                    </div>

                    {/* 2. Brand Selection — Fitout Only */}
                    <div className={styles.section}>
                        <div className={styles.brandSectionHeader}>
                            <span className={styles.sectionTitle}>
                                2. Select Database
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
                        onClick={() => onConfirm(selectedBrands, selectedEngine, selectedModel)}
                        style={{ background: activeMeta.color }}
                    >
                        Start Fitout AI Batch
                    </button>
                </div>
            </div>
        </div>
    );
}
