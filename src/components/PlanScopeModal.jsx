import React, { useState, useEffect } from 'react';
import { useCompanyProfile } from '../context/CompanyContext';
import { AI_ENGINES, MODEL_OPTIONS, DEFAULT_AI_SETTINGS } from '../utils/aiConstants';
import styles from '../styles/PlanScopeModal.module.css';

const PlanScopeModal = ({ isOpen, onClose, onSelect }) => {
    const { aiSettings } = useCompanyProfile();
    
    const [selectedEngine, setSelectedEngine] = useState(aiSettings?.engine || DEFAULT_AI_SETTINGS.engine);
    const [selectedModel, setSelectedModel] = useState(aiSettings?.model || DEFAULT_AI_SETTINGS.model);

    // Sync from profile when opened
    useEffect(() => {
        if (!isOpen && aiSettings) {
            setSelectedEngine(aiSettings.engine);
            setSelectedModel(aiSettings.model);
        }
    }, [isOpen, aiSettings]);

    // Fallback logic when engine changes locally
    useEffect(() => {
        const engineOptions = MODEL_OPTIONS[selectedEngine];
        if (selectedEngine === 'google') {
            const allGoogle = [...MODEL_OPTIONS.google.gemma, ...MODEL_OPTIONS.google.gemini, ...MODEL_OPTIONS.google.paid];
            if (!allGoogle.includes(selectedModel)) {
                setSelectedModel(DEFAULT_AI_SETTINGS.model);
            }
        } else if (engineOptions && !engineOptions.includes(selectedModel)) {
            setSelectedModel(engineOptions[0]);
        }
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
                </div>

                <div className={styles.footer}>
                    <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
                </div>
            </div>
        </div>
    );
};

export default PlanScopeModal;
