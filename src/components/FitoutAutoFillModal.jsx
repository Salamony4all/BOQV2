import React, { useState, useEffect, useMemo } from 'react';
import styles from '../styles/AutoFillSelectModal.module.css';

export default function FitoutAutoFillModal({ isOpen, onClose, allBrands = [], activeTier, onConfirm }) {
    const [selectedBrands, setSelectedBrands] = useState([]);
    const [selectedEngine, setSelectedEngine] = useState('google');
    const [selectedModel, setSelectedModel] = useState('gemini-2.5-flash');

    const modelOptions = {
        google: ['gemini-2.5-flash', 'gemini-2.0-flash-exp', 'gemini-1.5-flash', 'gemini-1.5-flash-002', 'gemini-1.5-pro'],
        openrouter: ['google/gemini-4-31b-it:free', 'google/gemma-4-26b-a4b-it:free', 'google/gemma-4-31b-it:free', 'anthropic/claude-opus-4.6-fast', 'anthropic/claude-opus-4', 'anthropic/claude-sonnet-4-20250514'],
        nvidia: ['nvidia/llama-3.3-70b-instruct', 'nvidia/llama-3.1-70b-instruct', 'nvidia/nemotron-3-super-120b-a12b', 'nvidia/gemma-4-31b-it', 'nvidia/cosmos-transfer2_5-2b', 'nvidia/llama-3.1-nemotron-nano-8b-v1', 'nvidia/llama-3.1-nemotron-70b-reward', 'nvidia/llama-3.1-nemotron-ultra-253b-v1', 'nvidia/llama-3.3-nemotron-super-49b-v1', 'nvidia/llama-3.3-nemotron-super-49b-v1.5']
    };

    const tierMeta = {
        budgetary: { label: 'Budgetary', color: '#3b82f6' },
        mid:       { label: 'Mid-Range', color: '#8b5cf6' },
        high:      { label: 'High-End',  color: '#ec4899' }
    };

    const engines = [
        { id: 'google',     name: 'Gemini Text',       desc: 'Google · Text-only furniture/fitout',        icon: 'AI', color: '#1a73e8' },
        { id: 'openrouter', name: 'OpenRouter Text',    desc: 'OpenRouter · Text-only model gateway',      icon: 'OR', color: '#8b5cf6' },
        { id: 'nvidia',     name: 'Nvidia Text',        desc: 'NVIDIA · Text-only model support',          icon: 'NV', color: '#76b900' }
    ];

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
            setSelectedModel(modelOptions.google[0]);
        }
    }, [isOpen, fitoutBrands]);

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
