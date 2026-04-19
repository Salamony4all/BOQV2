import React from 'react';
import { useCompanyProfile } from '../context/CompanyContext';
import { DEFAULT_AI_SETTINGS } from '../utils/aiConstants';
import styles from '../styles/PlanScopeModal.module.css';

const PdfModelModal = ({ isOpen, onClose, onExtract, fileName }) => {
    const { aiSettings } = useCompanyProfile();
    
    if (!isOpen) return null;

    const currentModel = aiSettings?.model || DEFAULT_AI_SETTINGS.model;

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={e => e.stopPropagation()} style={{ width: '550px' }}>
                <div className={styles.header}>
                    <h2 className={styles.title}>PDF BOQ Extraction</h2>
                    <p className={styles.subtitle}>Analyzing document: <strong>{fileName}</strong></p>
                    <p className={styles.engineBadge}>Using Global Model: {currentModel}</p>
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
                        onClick={() => onExtract(currentModel)}
                    >
                        Extract BOQ 🚀
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PdfModelModal;
