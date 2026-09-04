import React, { useState } from 'react';
import { getFullUrl } from '../utils/urlUtils';
import styles from '../styles/MultiImageCell.module.css';

/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  MultiImageCell — High-Density Thumbnail Grid with Drag, Drop & Remove  │
 * └─────────────────────────────────────────────────────────────────────────┘
 * Features:
 * - Drag & Drop: Drag images between cells, reorder within cell, or drop files from OS
 * - Remove: Small 'x' button on each image thumbnail
 * - Adaptive layout: 1, 2, 3, 4+ grid arrangements
 * - Interactive Lightbox Gallery on click
 */
export default function MultiImageCell({
    images = [],
    brandLogo = null,
    onPreview = null,
    onImagesChange = null,
    onRemoveImage = null,
    cellId = null,
    altPrefix = 'Ref',
    itemTitle = '',
    size = 68,
    allowDrop = true,
    allowRemove = true,
    allowDrag = true,
    singleMode = false // When true (e.g. Brand Img), dropping replaces the single image
}) {
    const [brokenImages, setBrokenImages] = useState(new Set());
    const [isDragOver, setIsDragOver] = useState(false);
    const [draggedIdx, setDraggedIdx] = useState(null);

    // Normalize image list (supports string URLs or { url } objects)
    const rawList = Array.isArray(images) ? images : (images ? [images] : []);
    const validImages = rawList
        .map(img => (typeof img === 'string' ? img : (img?.url || img?.data || img?.src || '')))
        .filter(url => url && typeof url === 'string' && url.trim().length > 0);

    const handleImageError = (imgUrl, index) => {
        setBrokenImages(prev => new Set(prev).add(index));
    };

    const handleCellClick = (e, targetIndex = 0) => {
        e.stopPropagation();
        if (validImages.length === 0) return;
        if (onPreview) {
            onPreview(validImages, targetIndex, itemTitle, brandLogo);
        }
    };

    // ── REMOVE ACTION ──
    const handleRemove = (e, targetIndex) => {
        e.stopPropagation();
        e.preventDefault();

        const updated = validImages.filter((_, idx) => idx !== targetIndex);
        if (onRemoveImage) {
            onRemoveImage(targetIndex, updated);
        }
        if (onImagesChange) {
            onImagesChange(updated);
        }
    };

    // ── DRAG & DROP HANDLERS ──
    const handleDragStart = (e, idx, imgUrl) => {
        if (!allowDrag) return;
        setDraggedIdx(idx);
        e.dataTransfer.effectAllowed = 'copyMove';

        const payload = JSON.stringify({
            type: 'boq-cell-image',
            url: imgUrl,
            sourceCellId: cellId,
            sourceIndex: idx
        });

        e.dataTransfer.setData('application/json', payload);
        e.dataTransfer.setData('text/plain', imgUrl);
    };

    const handleDragEnd = () => {
        setDraggedIdx(null);
        setIsDragOver(false);
    };

    const handleDragOver = (e) => {
        if (!allowDrop) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
    };

    const handleDragEnter = (e) => {
        if (!allowDrop) return;
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
    };

    const handleDragLeave = (e) => {
        if (!allowDrop) return;
        e.preventDefault();
        e.stopPropagation();
        // Only turn off if leaving the main wrapper
        if (!e.currentTarget.contains(e.relatedTarget)) {
            setIsDragOver(false);
        }
    };

    const handleDrop = async (e, dropTargetIdx = null) => {
        if (!allowDrop) return;
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        setDraggedIdx(null);

        // Case A: Local Files dropped from desktop (OS)
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
            if (files.length === 0) return;

            const readPromises = files.map(file => {
                return new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = (event) => resolve(event.target.result);
                    reader.onerror = () => resolve(null);
                    reader.readAsDataURL(file);
                });
            });

            const newBase64Images = (await Promise.all(readPromises)).filter(Boolean);
            if (newBase64Images.length > 0) {
                const updated = singleMode
                    ? [newBase64Images[0]]
                    : [...validImages, ...newBase64Images];
                if (onImagesChange) onImagesChange(updated);
            }
            return;
        }

        // Case B: Internal drag from another cell or within cell
        const jsonData = e.dataTransfer.getData('application/json');
        if (jsonData) {
            try {
                const data = JSON.parse(jsonData);
                if (data.type === 'boq-cell-image' && data.url) {
                    // Reordering within the same cell
                    if (data.sourceCellId === cellId && data.sourceIndex !== undefined && dropTargetIdx !== null) {
                        const fromIdx = data.sourceIndex;
                        const toIdx = dropTargetIdx;
                        if (fromIdx !== toIdx) {
                            const updated = [...validImages];
                            const [movedItem] = updated.splice(fromIdx, 1);
                            updated.splice(toIdx, 0, movedItem);
                            if (onImagesChange) onImagesChange(updated);
                        }
                        return;
                    }

                    // Dragged from another cell
                    const updated = singleMode
                        ? [data.url]
                        : [...validImages, data.url];
                    if (onImagesChange) onImagesChange(updated);
                }
            } catch (err) {
                console.error('[MultiImageCell] Drop parse error:', err);
            }
        } else {
            // Plain text URL drop
            const plainUrl = e.dataTransfer.getData('text/plain');
            if (plainUrl && (plainUrl.startsWith('http') || plainUrl.startsWith('data:') || plainUrl.startsWith('/'))) {
                const updated = singleMode ? [plainUrl] : [...validImages, plainUrl];
                if (onImagesChange) onImagesChange(updated);
            }
        }
    };

    // ── CASE 0: Empty Cell ──
    if (validImages.length === 0) {
        return (
            <div
                className={`${styles.emptyContainer} ${isDragOver ? styles.isDragOver : ''}`}
                style={{ width: `${size}px`, height: `${size}px` }}
                title="Drop image here or upload"
                onDragOver={handleDragOver}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                {isDragOver ? (
                    <div className={styles.dropOverlay}>
                        <span></span>
                        <span style={{ fontSize: '0.58rem' }}>Drop here</span>
                    </div>
                ) : (
                    <>
                        <span className={styles.emptyIcon}></span>
                        <span className={styles.emptyText}>No Ref</span>
                    </>
                )}
            </div>
        );
    }

    const count = validImages.length;

    return (
        <div
            className={`${styles.cellWrapper} ${isDragOver ? styles.isDragOver : ''}`}
            style={{ width: `${size}px`, height: `${size}px` }}
            title={count > 1 ? `${count} reference images • Drag to move or click to view gallery` : 'Drag to move or click to preview'}
            onClick={(e) => handleCellClick(e, 0)}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, null)}
        >
            {/* Drag-over indicator overlay */}
            {isDragOver && (
                <div className={styles.dropOverlay}>
                    <span></span>
                    <span style={{ fontSize: '0.62rem' }}>Add Asset</span>
                </div>
            )}

            {/* ── CASE 1: Single Image ── */}
            {count === 1 && (
                <div
                    className={`${styles.singleImageContainer} ${draggedIdx === 0 ? styles.isDragging : ''}`}
                    draggable={allowDrag}
                    onDragStart={(e) => handleDragStart(e, 0, validImages[0])}
                    onDragEnd={handleDragEnd}
                >
                    <img
                        src={getFullUrl(validImages[0])}
                        alt={`${altPrefix} 1`}
                        className={`${styles.cellImg} ${brokenImages.has(0) ? styles.brokenImg : ''}`}
                        onError={() => handleImageError(validImages[0], 0)}
                    />
                    {allowRemove && (
                        <button
                            className={styles.tileRemoveBtn}
                            onClick={(e) => handleRemove(e, 0)}
                            title="Remove image"
                        >
                            ×
                        </button>
                    )}
                    <div className={styles.hoverOverlay}>
                        <span className={styles.zoomIcon}></span>
                    </div>
                </div>
            )}

            {/* ── CASE 2: Two Images (Split Columns) ── */}
            {count === 2 && (
                <div className={styles.twoImageGrid}>
                    {validImages.slice(0, 2).map((img, idx) => (
                        <div
                            key={idx}
                            className={`${styles.splitTile} ${draggedIdx === idx ? styles.isDragging : ''}`}
                            draggable={allowDrag}
                            onDragStart={(e) => handleDragStart(e, idx, img)}
                            onDragEnd={handleDragEnd}
                            onDrop={(e) => handleDrop(e, idx)}
                            onClick={(e) => handleCellClick(e, idx)}
                        >
                            <img
                                src={getFullUrl(img)}
                                alt={`${altPrefix} ${idx + 1}`}
                                className={`${styles.cellImg} ${brokenImages.has(idx) ? styles.brokenImg : ''}`}
                                onError={() => handleImageError(img, idx)}
                            />
                            {allowRemove && (
                                <button
                                    className={styles.tileRemoveBtn}
                                    onClick={(e) => handleRemove(e, idx)}
                                    title="Remove this image"
                                >
                                    ×
                                </button>
                            )}
                        </div>
                    ))}
                    <div className={styles.countBadge}>2</div>
                </div>
            )}

            {/* ── CASE 3: Three Images (1 Hero Left + 2 Stacked Right) ── */}
            {count === 3 && (
                <div className={styles.threeImageGrid}>
                    <div
                        className={`${styles.heroTile} ${draggedIdx === 0 ? styles.isDragging : ''}`}
                        draggable={allowDrag}
                        onDragStart={(e) => handleDragStart(e, 0, validImages[0])}
                        onDragEnd={handleDragEnd}
                        onDrop={(e) => handleDrop(e, 0)}
                        onClick={(e) => handleCellClick(e, 0)}
                    >
                        <img
                            src={getFullUrl(validImages[0])}
                            alt={`${altPrefix} 1`}
                            className={`${styles.cellImg} ${brokenImages.has(0) ? styles.brokenImg : ''}`}
                            onError={() => handleImageError(validImages[0], 0)}
                        />
                        {allowRemove && (
                            <button
                                className={styles.tileRemoveBtn}
                                onClick={(e) => handleRemove(e, 0)}
                                title="Remove this image"
                            >
                                ×
                            </button>
                        )}
                    </div>
                    <div className={styles.stackedTiles}>
                        {validImages.slice(1, 3).map((img, idx) => {
                            const realIdx = idx + 1;
                            return (
                                <div
                                    key={realIdx}
                                    className={`${styles.stackedTile} ${draggedIdx === realIdx ? styles.isDragging : ''}`}
                                    draggable={allowDrag}
                                    onDragStart={(e) => handleDragStart(e, realIdx, img)}
                                    onDragEnd={handleDragEnd}
                                    onDrop={(e) => handleDrop(e, realIdx)}
                                    onClick={(e) => handleCellClick(e, realIdx)}
                                >
                                    <img
                                        src={getFullUrl(img)}
                                        alt={`${altPrefix} ${realIdx + 1}`}
                                        className={`${styles.cellImg} ${brokenImages.has(realIdx) ? styles.brokenImg : ''}`}
                                        onError={() => handleImageError(img, realIdx)}
                                    />
                                    {allowRemove && (
                                        <button
                                            className={styles.tileRemoveBtn}
                                            onClick={(e) => handleRemove(e, realIdx)}
                                            title="Remove this image"
                                        >
                                            ×
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <div className={styles.countBadge}>3</div>
                </div>
            )}

            {/* ── CASE 4: Four or More Images (2x2 Quad Grid) ── */}
            {count >= 4 && (
                <div className={styles.fourImageGrid}>
                    {validImages.slice(0, 4).map((img, idx) => {
                        const isLastTileWithMore = idx === 3 && count > 4;
                        const remainingCount = count - 3;
                        return (
                            <div
                                key={idx}
                                className={`${styles.quadTile} ${draggedIdx === idx ? styles.isDragging : ''}`}
                                draggable={allowDrag}
                                onDragStart={(e) => handleDragStart(e, idx, img)}
                                onDragEnd={handleDragEnd}
                                onDrop={(e) => handleDrop(e, idx)}
                                onClick={(e) => handleCellClick(e, idx)}
                            >
                                <img
                                    src={getFullUrl(img)}
                                    alt={`${altPrefix} ${idx + 1}`}
                                    className={`${styles.cellImg} ${brokenImages.has(idx) ? styles.brokenImg : ''}`}
                                    onError={() => handleImageError(img, idx)}
                                />
                                {allowRemove && (
                                    <button
                                        className={styles.tileRemoveBtn}
                                        onClick={(e) => handleRemove(e, idx)}
                                        title="Remove this image"
                                    >
                                        ×
                                    </button>
                                )}
                                {isLastTileWithMore && (
                                    <div className={styles.moreOverlay}>
                                        +{remainingCount}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    <div className={styles.countBadge}>{count}</div>
                </div>
            )}

            {/* Brand Logo Badge (if provided) */}
            {brandLogo && (
                <div className={styles.brandLogoBadge}>
                    <img
                        src={getFullUrl(brandLogo)}
                        alt="Brand"
                        className={styles.badgeLogo}
                        onError={(e) => { e.target.style.display = 'none'; }}
                    />
                </div>
            )}
        </div>
    );
}
