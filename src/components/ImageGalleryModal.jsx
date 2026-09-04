import React, { useState, useEffect } from 'react';
import { getFullUrl } from '../utils/urlUtils';
import styles from '../styles/ImageGalleryModal.module.css';

/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  ImageGalleryModal — Premium Full-Screen Asset Gallery & Lightbox       │
 * └─────────────────────────────────────────────────────────────────────────┘
 * Features:
 * - High-Resolution full-screen viewport with ultra-high z-index (above all headers)
 * - Navigation: Previous / Next buttons & ArrowLeft / ArrowRight keyboard keys
 * - Zoom: Click image to toggle 1x / 1.75x zoom
 * - Download: Direct asset download button
 * - Remove: Delete button with Delete/Backspace keyboard shortcut
 * - Thumbnail strip: Click to switch between all extracted assets
 */
export default function ImageGalleryModal({
    images = [],
    initialIndex = 0,
    title = 'Reference Image',
    subtitle = '',
    brandLogo = null,
    brandName = null,
    onRemoveImage = null,
    onClose = () => {}
}) {
    const [imageList, setImageList] = useState(() => {
        return (Array.isArray(images) ? images : [images])
            .map(img => (typeof img === 'string' ? img : (img?.url || img?.data || img?.src || '')))
            .filter(url => url && typeof url === 'string' && url.trim().length > 0);
    });

    const [currentIndex, setCurrentIndex] = useState(
        Math.max(0, Math.min(initialIndex, imageList.length - 1))
    );

    const [isZoomed, setIsZoomed] = useState(false);

    // Keep synced if images prop changes
    useEffect(() => {
        const normalized = (Array.isArray(images) ? images : [images])
            .map(img => (typeof img === 'string' ? img : (img?.url || img?.data || img?.src || '')))
            .filter(url => url && typeof url === 'string' && url.trim().length > 0);
        setImageList(normalized);
        setCurrentIndex(prev => Math.max(0, Math.min(prev, normalized.length - 1)));
    }, [images]);

    // Reset zoom when switching images
    useEffect(() => {
        setIsZoomed(false);
    }, [currentIndex]);

    const total = imageList.length;
    const currentSrc = imageList[currentIndex] ? getFullUrl(imageList[currentIndex]) : '';

    const handleRemoveCurrent = () => {
        if (onRemoveImage) {
            onRemoveImage(currentIndex);
        }

        const remaining = imageList.filter((_, idx) => idx !== currentIndex);
        if (remaining.length === 0) {
            onClose();
        } else {
            setImageList(remaining);
            setCurrentIndex(prev => (prev >= remaining.length ? remaining.length - 1 : prev));
        }
    };

    const handleDownload = () => {
        if (!currentSrc) return;
        const link = document.createElement('a');
        link.href = currentSrc;
        link.download = `boq_asset_${currentIndex + 1}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleVisualSearch = () => {
        if (!currentSrc) return;
        if (currentSrc.startsWith('http')) {
            window.open(`https://lens.google.com/uploadbyurl?url=${encodeURIComponent(currentSrc)}`, '_blank');
            return;
        }
        const cleanQuery = subtitle ? subtitle.replace(/[|#]/g, ' ').slice(0, 100).trim() : 'commercial furniture design';
        window.open(`https://www.google.com/search?q=${encodeURIComponent(cleanQuery)}&tbm=isch`, '_blank');
    };

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                onClose();
            } else if (e.key === 'ArrowLeft') {
                setCurrentIndex(prev => (prev > 0 ? prev - 1 : total - 1));
            } else if (e.key === 'ArrowRight') {
                setCurrentIndex(prev => (prev < total - 1 ? prev + 1 : 0));
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                if (onRemoveImage) {
                    handleRemoveCurrent();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [total, onClose, currentIndex, imageList, onRemoveImage]);

    if (total === 0) return null;

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.dialog} onClick={e => e.stopPropagation()}>
                
                {/* ── Top Bar ── */}
                <div className={styles.topBar}>
                    <div className={styles.titleInfo}>
                        <div className={styles.mainTitle}>{title || 'Asset Gallery'}</div>
                        {subtitle && <div className={styles.subtitle} title={subtitle}>{subtitle}</div>}
                    </div>

                    <div className={styles.topRightControls}>
                        {total > 1 && (
                            <div className={styles.counterBadge}>
                                {currentIndex + 1} of {total}
                            </div>
                        )}

                        <button
                            className={styles.actionBtn}
                            onClick={() => setIsZoomed(!isZoomed)}
                            title={isZoomed ? "Reset Zoom" : "Zoom In (1.75x)"}
                        >
                            {isZoomed ? ' Normal' : ' Zoom'}
                        </button>

                        <button
                            className={styles.actionBtn}
                            onClick={handleDownload}
                            title="Download original image"
                        >
                             Save
                        </button>

                        <button
                            className={styles.actionBtn}
                            onClick={handleVisualSearch}
                            title="Reverse visual image search on Google Lens (Zero LLM Tokens)"
                            style={{ background: 'rgba(59, 130, 246, 0.15)', borderColor: 'rgba(59, 130, 246, 0.4)', color: '#60a5fa' }}
                        >
                             Lens Search
                        </button>

                        {onRemoveImage && (
                            <button
                                className={styles.deleteBtn}
                                onClick={handleRemoveCurrent}
                                title="Remove this image (Del key)"
                            >
                                 Remove
                            </button>
                        )}

                        <button 
                            className={styles.closeBtn} 
                            onClick={onClose} 
                            title="Close viewer (Esc)"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        </button>
                    </div>
                </div>

                {/* ── Main Image Viewport ── */}
                <div className={styles.viewport}>
                    {/* Left Navigation Arrow */}
                    {total > 1 && (
                        <button 
                            className={`${styles.navBtn} ${styles.prevBtn}`}
                            onClick={() => setCurrentIndex(prev => (prev > 0 ? prev - 1 : total - 1))}
                            title="Previous (Left Arrow key)"
                        >
                            ‹
                        </button>
                    )}

                    <div 
                        className={`${styles.imageStage} ${isZoomed ? styles.stageZoomed : ''}`}
                        onClick={() => setIsZoomed(!isZoomed)}
                        title={isZoomed ? "Click to zoom out" : "Click to zoom in"}
                    >
                        <img
                            src={currentSrc}
                            alt={`Asset ${currentIndex + 1}`}
                            className={`${styles.mainImage} ${isZoomed ? styles.mainImageZoomed : ''}`}
                            onError={(e) => {
                                e.target.src = 'https://placehold.co/600x400?text=Image+Not+Available';
                            }}
                        />
                    </div>

                    {/* Right Navigation Arrow */}
                    {total > 1 && (
                        <button 
                            className={`${styles.navBtn} ${styles.nextBtn}`}
                            onClick={() => setCurrentIndex(prev => (prev < total - 1 ? prev + 1 : 0))}
                            title="Next (Right Arrow key)"
                        >
                            ›
                        </button>
                    )}
                </div>

                {/* ── Bottom Strip: Thumbnails, Shortcuts & Branding ── */}
                <div className={styles.bottomBar}>
                    {/* Brand Branding Info */}
                    {(brandLogo || brandName) ? (
                        <div className={styles.brandBadge}>
                            {brandLogo && (
                                <img
                                    src={getFullUrl(brandLogo)}
                                    alt={brandName || 'Brand'}
                                    className={styles.brandLogoImg}
                                    onError={(e) => { e.target.style.display = 'none'; }}
                                />
                            )}
                            {brandName && <span className={styles.brandNameText}>{brandName}</span>}
                        </div>
                    ) : (
                        <div className={styles.shortcutHint}>
                            <kbd>←</kbd> <kbd>→</kbd> Navigate &nbsp;•&nbsp; <kbd>Esc</kbd> Close
                        </div>
                    )}

                    {/* Thumbnail Selector Strip (if multi-image) */}
                    {total > 1 && (
                        <div className={styles.thumbnailStrip}>
                            {imageList.map((img, idx) => {
                                const thumbSrc = getFullUrl(img);
                                const isActive = idx === currentIndex;
                                return (
                                    <div
                                        key={idx}
                                        className={`${styles.thumbItem} ${isActive ? styles.activeThumb : ''}`}
                                        onClick={() => setCurrentIndex(idx)}
                                        title={`Jump to asset ${idx + 1}`}
                                    >
                                        <img
                                            src={thumbSrc}
                                            alt={`thumb ${idx + 1}`}
                                            className={styles.thumbImg}
                                            onError={(e) => {
                                                e.target.style.opacity = '0.3';
                                            }}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
}
