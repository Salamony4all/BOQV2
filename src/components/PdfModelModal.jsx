import React, { useState, useEffect } from 'react';
import styles from '../styles/PlanScopeModal.module.css';

const PdfModelModal = ({ isOpen, onClose, onExtract, fileName }) => {
    const [selectedEngine, setSelectedEngine] = useState('google');
    const [selectedModel, setSelectedModel] = useState('gemma-4-26b-a4b-it');

    const modelOptions = {
        google: {
            gemma: [
                'gemma-4-31b-it',
                'gemma-4-26b-a4b-it',
                'gemma-3-27b-it',
                'gemma-3-12b-it',
                'gemma-3-4b-it'
            ],
            gemini: [
                'gemini-2.0-flash',
                'gemini-1.5-pro',
                'gemini-1.5-flash'
            ],
            paid: [
                'gemini-1.5-pro-002',
                'gemini-1.5-flash-002'
            ]
        },
        openrouter: ['google/gemini-2.0-flash-lite-001', 'anthropic/claude-3.5-sonnet', 'openai/gpt-4o-mini'],
        nvidia: ['nvidia/llama-3.1-nemotron-nano-vl-8b-v1'],
        local: ['local/yolov8-llama3.2']
    };

    const engines = [
        { id: 'google',     name: 'Google AI',     desc: 'Deep PDF Multimodal', icon: 'GI', color: '#1a73e8' },
        { id: 'openrouter', name: 'OpenRouter',    desc: 'Alternative models',   icon: 'OR', color: '#8b5cf6' },
        { id: 'nvidia',     name: 'Nvidia',        desc: 'Fast vision models',   icon: 'NV', color: '#76b900' }
    ];

    useEffect(() => {
        if (isOpen) {
            setSelectedEngine('google');
            setSelectedModel('gemma-4-26b-a4b-it');
        }
    }, [isOpen]);

    useEffect(() => {
        const engineOptions = modelOptions[selectedEngine];
        if (selectedEngine === 'google') {
            setSelectedModel('gemma-4-26b-a4b-it');
        } else {
            setSelectedModel(engineOptions[0]);
        }
    }, [selectedEngine]);

    if (!isOpen) return null;

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={e => e.stopPropagation()} style={{ width: '550px' }}>
                <div className={styles.header}>
                    <h2 className={styles.title}>PDF BOQ Extraction</h2>
                    <p className={styles.subtitle}>Select the AI brain for model: <strong>{fileName}</strong></p>
                    <button className={styles.closeBtn} onClick={onClose}>×</button>
                </div>

                <div className={styles.content}>
                    <div className={styles.section}>
                        <span className={styles.sectionTitle}>Choose Provider</span>
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
                                onChange={(e) => setSelectedModel(e.target.value)}
                            >
                                {selectedEngine === 'google' ? (
                                    <>
                                        <optgroup label="Gemma (Best for Tables)">
                                            {modelOptions.google.gemma.map(m => <option key={m} value={m}>{m}</option>)}
                                        </optgroup>
                                        <optgroup label="Gemini (Standard)">
                                            {modelOptions.google.gemini.map(m => <option key={m} value={m}>{m}</option>)}
                                        </optgroup>
                                        <optgroup label="Paid Models">
                                            {modelOptions.google.paid.map(m => <option key={m} value={m}>{m}</option>)}
                                        </optgroup>
                                    </>
                                ) : (
                                    modelOptions[selectedEngine].map(m => <option key={m} value={m}>{m}</option>)
                                )}
                            </select>
                            <p className={styles.modelHint}>Gemma models are optimized for table extraction and structured data.</p>
                        </div>
                    </div>
                </div>

                <div className={styles.footer} style={{ justifyContent: 'space-between', alignItems: 'center', padding: '20px 30px' }}>
                    <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
                    <button 
                        className={styles.extractBtn} 
                        style={{
                            background: 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)',
                            color: 'white',
                            border: 'none',
                            padding: '14px 40px',
                            borderRadius: '12px',
                            fontWeight: '700',
                            fontSize: '1.1rem',
                            cursor: 'pointer',
                            transition: 'all 0.3s ease',
                            boxShadow: '0 6px 20px rgba(124, 58, 237, 0.4)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px'
                        }}
                        onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                        onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                        onClick={() => onExtract(selectedModel)}
                    >
                        Extract BOQ 🚀
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PdfModelModal;
