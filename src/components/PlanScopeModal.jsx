import React from 'react';
import styles from '../styles/PlanScopeModal.module.css';

const PlanScopeModal = ({ isOpen, onClose, onSelect }) => {
    if (!isOpen) return null;

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
                <div className={styles.header}>
                    <h2 className={styles.title}>Extraction Scope</h2>
                    <p className={styles.subtitle}>Select the layer categories to process from your plan</p>
                    <button className={styles.closeBtn} onClick={onClose}>×</button>
                </div>

                <div className={styles.cards}>
                    <div className={styles.card} onClick={() => onSelect('furniture')}>
                        <div className={styles.icon}>🛋️</div>
                        <h3 className={styles.cardTitle}>Furniture Only</h3>
                        <p className={styles.cardDesc}>Extract desks, chairs, sofas, and standalone items.</p>
                    </div>

                    <div className={styles.card} onClick={() => onSelect('both')}>
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
