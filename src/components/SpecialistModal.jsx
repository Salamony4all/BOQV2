import React from 'react';
import styles from '../styles/SpecialistModal.module.css';
import { getApiBase } from '../utils/apiBase';

const API_BASE = getApiBase();

const SpecialistModal = ({ isOpen, onClose, data }) => {
    if (!isOpen || !data) return null;

    const { product, status, error_message, boqDescription, brand, hardened } = data;

    const getFullUrl = (url) => {
        if (!url) return '';
        if (url.startsWith('http') || url.startsWith('data:')) {
            // For external images, always use proxy in Specialist Modal as it often deals with Architonic/Narbutas
            if (url.includes('amara-art.com') || url.includes('architonic.com') || url.includes('narbutas.com')) {
                return `${API_BASE}/api/image-proxy?url=${encodeURIComponent(url)}`;
            }
            return url;
        }
        return `${API_BASE}${url}`;
    };

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
                <div className={styles.header}>
                    <div className={styles.titleGroup}>
                        <h3>AI Search: Quick Check</h3>
                    </div>
                    <button className={styles.closeBtn} onClick={onClose}>&times;</button>
                </div>

                <div className={styles.body}>
                    <div className={styles.section}>
                        <h4 className={styles.sectionTitle}>Input: Tender BOQ Description</h4>
                        <div className={styles.boqDescBox}>
                            <p className={styles.boqDesc}>{boqDescription}</p>
                            <span className={styles.mandatoryBadge}>Mandatory Brand: {brand}</span>
                        </div>
                    </div>

                    <div className={styles.divider} />

                    {status === 'success' ? (
                        <div className={styles.resultContainer}>
                            <div className={styles.productHeader}>
                                <div className={styles.statusRow}>
                                    <div className={styles.verifiedBadge}>
                                        <span className={styles.checkIcon}>✅</span>
                                        <span>Verified Match</span>
                                    </div>
                                    {hardened && (
                                        <div className={styles.hardenBadge}>
                                            <span className={styles.gemIcon}>💎</span>
                                            <span>Hardened to Brand Catalog</span>
                                        </div>
                                    )}
                                </div>
                                <h2 className={styles.modelName}>{product.model}</h2>
                                <p className={styles.brandSubtitle}>{brand} | {product.family}</p>
                            </div>

                            <div className={styles.productGrid}>
                                <div className={styles.imageSection}>
                                    {product.imageUrl ? (
                                        <img 
                                            src={getFullUrl(product.imageUrl)} 
                                            alt={product.model} 
                                            className={styles.productImg} 
                                            onError={(e) => {
                                                e.target.src = 'https://placehold.co/600x400?text=Image+Not+Available';
                                            }}
                                        />
                                    ) : (
                                        <div className={styles.noImage}>No Image Available</div>
                                    )}
                                </div>
                                <div className={styles.infoSection}>
                                    <div className={styles.technicalScope}>
                                        <h5>Technical Specification:</h5>
                                        <p>{product.description}</p>
                                    </div>
                                    <div className={styles.metaInfo}>
                                        <div className={styles.metaItem}>
                                            <strong>Hierarchy:</strong>
                                            <span>{product.mainCategory} &gt; {product.subCategory}</span>
                                        </div>
                                        <div className={styles.metaItem}>
                                            <strong>Source URL:</strong>
                                            <a href={product.productUrl} target="_blank" rel="noopener noreferrer" className={styles.sourceLink}>
                                                Official Catalog / Architonic ↗
                                            </a>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className={styles.errorContainer}>
                            <div className={styles.errorIcon}>⚠️</div>
                            <div className={styles.errorText}>
                                <h3>Match Failed</h3>
                                <p>{error_message || "The AI Search Engine could not find a verifiable match from this brand that meets the BOQ requirements."}</p>
                            </div>
                        </div>
                    )}
                </div>

                <div className={styles.footer}>
                    <button className={styles.confirmBtn} onClick={onClose}>Close Exploration</button>
                </div>
            </div>
        </div>
    );
};

export default SpecialistModal;
