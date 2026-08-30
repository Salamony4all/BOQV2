import { useEffect, useState } from 'react';
import styles from '../styles/ProgressModal.module.css';

function ProgressModal({ isOpen, progress, stage, stageDetail, planPreviewUrl, planPreviewType, planPreviewName }) {
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

    const normalizedType = planPreviewType ? planPreviewType.toLowerCase() : '';
    const hasPreview = Boolean(planPreviewUrl);
    const numericProgress = Math.min(100, Math.max(0, Math.round(progress || 0)));
    const isUploadPhase = numericProgress < 50;

    return (
        <div className={`${styles.modalOverlay} ${isOpen ? styles.visible : styles.hidden}`}>
            <div className={`${styles.modalContent} ${isOpen ? styles.visible : styles.hidden}`}>
                {hasPreview && (
                    <div className={styles.planPreviewSection}>
                        <div className={styles.planPreviewFrame}>
                            {normalizedType === 'application/pdf' ? (
                                <object data={planPreviewUrl} type="application/pdf" className={styles.previewMedia}>
                                    <div className={styles.previewFallback}>PDF preview unavailable</div>
                                </object>
                            ) : normalizedType.startsWith('image/') ? (
                                <img src={planPreviewUrl} alt={planPreviewName || 'Plan preview'} className={styles.previewMedia} />
                            ) : (
                                <div className={styles.previewFallback}>Preview unavailable</div>
                            )}
                            <div className={styles.scanLine} />
                        </div>
                        <div className={styles.planPreviewCaption}>
                            <strong>{planPreviewName || 'Uploaded plan'}</strong>
                            <span>Scanning drawing…</span>
                        </div>
                    </div>
                )}
                
                <div className={styles.throbber}>
                    <div className={styles.spinner}></div>
                </div>

                <div className={styles.phaseBadge}>
                    <span className={styles.phaseDot}></span>
                    {numericProgress >= 100 
                        ? 'Completed' 
                        : isUploadPhase 
                            ? 'Phase 1: Cloud Upload' 
                            : 'Phase 2: AI & Layout Extraction'}
                </div>

                <h2 className={styles.stage}>{stage || 'Processing...'}</h2>
                {stageDetail && <p className={styles.stageDetail}>{stageDetail}</p>}

                <div className={styles.progressBar}>
                    <div
                        className={styles.progressFill}
                        style={{ width: `${numericProgress}%` }}
                    ></div>
                </div>

                <div className={styles.percentage}>
                    {numericProgress}%
                </div>
            </div>
        </div>
    );
}

export default ProgressModal;
