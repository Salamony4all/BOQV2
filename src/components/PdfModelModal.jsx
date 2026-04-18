import React, { useState, useEffect } from 'react';
import { useCompanyProfile } from '../context/CompanyContext';
import { AI_ENGINES, MODEL_OPTIONS, DEFAULT_AI_SETTINGS } from '../utils/aiConstants';
import styles from '../styles/PlanScopeModal.module.css';

const PdfModelModal = ({ isOpen, onClose, onExtract, fileName }) => {
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
            <div className={styles.modal} onClick={e => e.stopPropagation()} style={{ width: '550px' }}>
                <div className={styles.header}>
                    <h2 className={styles.title}>PDF BOQ Extraction</h2>
                    <p className={styles.subtitle}>Select the AI brain for model: <strong>{fileName}</strong></p>
                    <button className={styles.closeBtn} onClick={onClose}>×</button>
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
