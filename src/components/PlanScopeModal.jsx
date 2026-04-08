import React, { useState, useEffect } from 'react';
import styles from '../styles/PlanScopeModal.module.css';

const PlanScopeModal = ({ isOpen, onClose, onSelect }) => {
    const [selectedEngine, setSelectedEngine] = useState('google');
    const [selectedModel, setSelectedModel] = useState('gemini-2.5-flash');

    const modelOptions = {
        google: ['gemini-2.5-flash', 'gemini-2.0-flash-exp', 'gemini-1.5-flash', 'gemini-1.5-flash-002', 'gemini-1.5-pro'],
        openrouter: ['google/gemini-2.5-flash-lite-001', 'anthropic/claude-opus-4.6-fast', 'anthropic/claude-opus-4', 'anthropic/claude-sonnet-4-20250514', 'openai/gpt-4-vision-preview', 'openai/gpt-4-turbo-vision'],
        nvidia: ['nvidia/vila', 'nvidia/vlia', 'nvidia/llama-3.1-nemotron-nano-vl-8b-v1', 'nvidia/nemotron-nano-12b-v2-vl']
    };

    const engines = [
        { id: 'google',     name: 'Gemini Vision',      desc: 'Google · Vision + PDF extraction', icon: 'AI', color: '#1a73e8' },
        { id: 'openrouter', name: 'OpenRouter Vision',  desc: 'OpenRouter · Vision-enabled gateway', icon: 'OR', color: '#8b5cf6' },
        { id: 'nvidia',     name: 'Nvidia Vision',      desc: 'NVIDIA · Vision-capable models',      icon: 'NV', color: '#76b900' }
    ];

    useEffect(() => {
        if (isOpen) {
            setSelectedEngine('google');
            setSelectedModel(modelOptions.google[0]);
        }
    }, [isOpen]);

    useEffect(() => {
        setSelectedModel(modelOptions[selectedEngine][0]);
    }, [selectedEngine]);

    if (!isOpen) return null;

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
                <div className={styles.header}>
                    <h2 className={styles.title}>Extraction Scope</h2>
                    <p className={styles.subtitle}>Select the layer categories to process from your plan</p>
                    <button className={styles.closeBtn} onClick={onClose}>×</button>
                </div>

                <div className={styles.content}>
                    <div className={styles.section}>
                        <span className={styles.sectionTitle}>0. Choose AI Provider</span>
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
                            <p className={styles.modelHint}>Choose the provider/model used to process the uploaded plan.</p>
                        </div>
                    </div>
                </div>

                <div className={styles.cards}>
                    <div className={styles.card} onClick={() => onSelect('furniture', selectedEngine, selectedModel)}>
                        <div className={styles.icon}>🛋️</div>
                        <h3 className={styles.cardTitle}>Furniture Only</h3>
                        <p className={styles.cardDesc}>Extract desks, chairs, sofas, and standalone items.</p>
                    </div>

                    <div className={styles.card} onClick={() => onSelect('both', selectedEngine, selectedModel)}>
                        <div className={styles.icon}>📐</div>
                        <h3 className={styles.cardTitle}>Furniture & Fitout</h3>
                        <p className={styles.cardDesc}>Comprehensive extraction including partitions, walls, and flooring.</p>
                    </div>
                </div>

                <div className={styles.footer}>
                    <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
                </div>
            </div>
        </div>
    );
};

export default PlanScopeModal;
