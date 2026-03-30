import { useEffect, useState } from 'react';
import styles from '../styles/ProgressModal.module.css';

function ProgressModal({ isOpen, progress, stage }) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setVisible(true);
        } else {
            const timer = setTimeout(() => setVisible(false), 300);
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    if (!visible) return null;

    return (
        <div className={`${styles.modalOverlay} ${isOpen ? styles.visible : styles.hidden}`}>
            <div className={`${styles.modalContent} ${isOpen ? styles.visible : styles.hidden}`}>
                <div className={styles.throbber}>
                    <div className={styles.spinner}></div>
                </div>

                <h2 className={styles.stage}>{stage}</h2>

                <div className={styles.progressBar}>
                    <div
                        className={styles.progressFill}
                        style={{ width: `${progress}%` }}
                    ></div>
                </div>

                <div className={styles.percentage}>
                    {Math.round(progress)}%
                </div>
            </div>
        </div>
    );
}

export default ProgressModal;
