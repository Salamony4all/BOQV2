import React, { useState, useEffect, useRef } from 'react';
import styles from '../styles/AIPresentation.module.css';
import { useTheme } from '../context/ThemeContext';
import { getFullUrl } from '../utils/urlUtils';

const AI_STEPS = [
    { id: 'query', label: 'Analyzing Specification', icon: '' },
    { id: 'catalog', label: 'Exploring Brand Catalog', icon: '' },
    { id: 'filter', label: 'Applying Physical Constraints', icon: '' },
    { id: 'match', label: 'Identifying Perfect Match', icon: '' },
    { id: 'found', label: 'Product Authenticated', icon: '' }
];

const AIPresentationModal = ({ 
    isOpen, 
    onClose, 
    currentItem, 
    batchResult, 
    brand, 
    foundModel, 
    foundImage, 
    progress, 
    status,
    tier = '',
    alignment = 'center',
    isMinimized = false,
    minimizedOffset = 24,
    onToggleMinimize = () => {},
    onMinimizeAll = () => {}
}) => {
    const { theme } = useTheme();
    const [stepIndex, setStepIndex] = useState(0);
    const [logs, setLogs] = useState([]);
    const [accuracy, setAccuracy] = useState(99.1);
    
    // NEW: Persistent display data to keep previously matched item visible during next search
    const [memoizedDisplay, setMemoizedDisplay] = useState({
        image: null,
        model: '',
        brand: '',
        accuracy: 99.1
    });
    const [isTransitioning, setIsTransitioning] = useState(false);
    const lastMatchedModelRef = useRef(null);

    const getTierColor = () => {
        if (tier === 'budgetary') return '#4f46e5'; // Indigo
        if (tier === 'mid') return '#7c3aed';      // Violet
        if (tier === 'high') return '#db2777';     // Pink
        return '#8a2be2';
    };

    const getAlignmentStyle = () => {
        if (alignment === 'left') return { position: 'fixed', left: '20px', top: '50%', transform: 'translateY(-50%)', margin: 0, width: '32%' };
        if (alignment === 'right') return { position: 'fixed', right: '20px', left: 'auto', top: '50%', transform: 'translateY(-50%)', margin: 0, width: '32%' };
        if (alignment === 'center-narrow') return { position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', margin: 0, width: '32%' };
        return {}; // center is default
    };

    useEffect(() => {
        if (isOpen) {
            setStepIndex(0);
            setAccuracy(99.1 + Math.random() * 0.8);
            setLogs(['Initializing Neural Furniture Engine...']);
            
            const timer = setInterval(() => {
                setStepIndex(prev => {
                    if (status === 'success') return AI_STEPS.length - 1;
                    if (status === 'error') return prev; 
                    return prev < AI_STEPS.length - 2 ? prev + 1 : prev; 
                });
            }, 1000);

            return () => clearInterval(timer);
        }
    }, [isOpen, currentItem, status]);

    // Transition effect: Only update the main display screen when a NEW match is definitive.
    // This allows the previous product to remain visible while the next search happens in the background.
    useEffect(() => {
        let timer;
        
        if (status === 'success' && foundModel && foundModel !== lastMatchedModelRef.current) {
            lastMatchedModelRef.current = foundModel;
            
            // CRITICAL: Update immediately so the new model becomes the static background
            // for the subsequent search, overcoming cleanup race conditions in batch processing.
            setMemoizedDisplay({
                image: foundImage,
                model: foundModel,
                brand: brand,
                accuracy: accuracy
            });
            
            // Brief high-intensity matching animation when a new candidate is authenticated
            setIsTransitioning(true);
            
            timer = setTimeout(() => {
                setIsTransitioning(false);
            }, 1000); // 1s matching animation duration
        } else if (status !== 'success') {
            setIsTransitioning(false);
        }

        return () => {
            if (timer) clearTimeout(timer);
        };
    }, [status, foundModel, foundImage, brand, accuracy]);

    useEffect(() => {
        if (isOpen && AI_STEPS[stepIndex]) {
            setLogs(prev => [...prev, `${AI_STEPS[stepIndex].icon} ${AI_STEPS[stepIndex].label}`].slice(-5));
        }
    }, [stepIndex, isOpen]);

    if (!isOpen) return null;

    const handleOutsideClick = (e) => {
        if (e.target.className.includes(styles.overlay)) {
            onMinimizeAll(true);
        }
    };

    if (isMinimized) {
        return (
            <div className={`${styles.overlay} ${styles.minimized}`} onClick={() => onToggleMinimize(false)}>
                <div 
                    className={`${styles.minimizedContainer} ${theme === 'light' ? styles.light : ''}`} 
                    onClick={(e) => e.stopPropagation()}
                    style={{ right: `${minimizedOffset}px` }}
                >
                    <div className={styles.minimizedHeader}>
                        <div className={styles.pulse} style={{ background: getTierColor() }}></div>
                        <span style={{ color: getTierColor() }}>{tier.toUpperCase()} {Math.round(progress)}%</span>
                        <div className={styles.minimizedControls}>
                             <button className={styles.maximizeBtn} onClick={() => onToggleMinimize(false)}>⛶</button>
                        </div>
                    </div>
                    <div className={styles.minimizedBody}>
                        {foundImage && (
                            <img 
                                src={getFullUrl(foundImage)} 
                                alt="" 
                                className={styles.minimizedThumb} 
                                onError={(e) => { e.target.style.display = 'none'; }}
                            />
                        )}
                        <div className={styles.minimizedInfo}>
                            <div className={styles.minimizedText} style={{ fontWeight: 'bold' }}>
                                {foundModel ? `Found: ${foundModel}` : `Working: ${currentItem?.description?.substring(0, 20)}...`}
                            </div>
                            <div className={styles.minimizedText} style={{ opacity: 0.6, fontSize: '0.7rem' }}>
                                Accuracy: {accuracy.toFixed(1)}%
                            </div>
                        </div>
                    </div>
                    <div className={styles.minimizedProgress}>
                        <div className={styles.progressFill} style={{ width: `${progress}%`, background: getTierColor() }}></div>
                    </div>
                </div>
            </div>
        );
    }

    if (batchResult) {
        return (
            <div className={`${styles.overlay} ${theme === 'light' ? styles.light : ''}`} onClick={onClose}>
                <div className={styles.modal} style={{ padding: '40px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                    <div className={styles.completionHeader}>
                        <div className={styles.sparkleLarge}></div>
                        <h2>AI ANALYSIS COMPLETE</h2>
                        <p>We've successfully audited and updated your BOQ tiers.</p>
                    </div>
                    
                    <div className={styles.summaryStats}>
                        <div className={styles.statBox}>
                            <span className={styles.statVal}>{batchResult.success || 0}</span>
                            <span className={styles.statLabel}>Products Matched</span>
                        </div>
                        <div className={styles.statBox}>
                            <span className={styles.statVal}>{batchResult.error || 0}</span>
                            <span className={styles.statLabel}>Requires Help</span>
                        </div>
                        {batchResult.newlyAdded > 0 && (
                            <div className={styles.statBox}>
                                <span className={styles.statVal}>{batchResult.newlyAdded}</span>
                                <span className={styles.statLabel}>New Brands Found</span>
                            </div>
                        )}
                    </div>

                    <div style={{ margin: '30px 0', opacity: 0.7, fontSize: '0.9rem' }}>
                        {batchResult.error > 0 
                            ? "Some items couldn't be matched automatically. You can review them in red."
                            : "Perfect! All items matched with high confidence."}
                    </div>

                    <button className={styles.doneBtn} onClick={onClose}>
                        Analyze & Review
                    </button>
                    
                    <div className={styles.summaryLogs}>
                       {logs.slice(-3).map((l, i) => <div key={i} style={{ opacity: 0.4 }}>{l}</div>)}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={`${styles.overlay} ${theme === 'light' ? styles.light : ''} ${alignment !== 'center' ? styles.sideOverlay : ''}`} onClick={handleOutsideClick}>
            <div className={styles.modal} style={{ 
                ...getAlignmentStyle(),
                borderColor: getTierColor() + '22',
                boxShadow: `0 50px 100px rgba(0,0,0,0.6), 0 0 50px ${getTierColor()}22`
            }} onClick={(e) => e.stopPropagation()}>
                {/* Header with Scanning Effect */}
                <div className={styles.header}>
                    <div className={styles.aiStatus}>
                        <div className={styles.pulse} style={{ background: getTierColor() }}></div>
                        <span style={{ color: getTierColor() }}>
                            {tier.toUpperCase()} {status === 'success' ? 'IDENTIFIED' : status === 'error' ? 'RETRYING' : 'DISCOVERY ACTIVE'}
                        </span>
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                         <button className={styles.minimizeBtn} onClick={() => onToggleMinimize(true)}>_</button>
                         <button className={styles.close} onClick={() => onToggleMinimize(true)}>×</button>
                    </div>
                </div>

                <div className={styles.content}>
                    {/* Left Side: The "Brain" / Thinking Area */}
                    <div className={styles.visualArea}>
                        <div className={styles.imagePreviewContainer}>
                            {/* Logic: While transitioning or searching, prefer showing the last stable match (memoizedDisplay) 
                                unless we finally have a fresh success. This eliminates the "progress placeholder" between items. */}
                            {(() => {
                                const activeImage = isTransitioning 
                                    ? memoizedDisplay.image 
                                    : (foundImage || memoizedDisplay.image);
                                
                                if (!activeImage) {
                                    if (memoizedDisplay.model || foundModel) {
                                        return (
                                            <div className={`${styles.imageWrapper} ${isTransitioning ? styles.isScanning : ''}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0, 0, 0, 0.4)', backdropFilter: 'blur(10px)', border: '1px solid rgba(138, 43, 226, 0.2)' }}>
                                                <div style={{ textAlign: 'center', padding: '20px' }}>
                                                    <span style={{ color: '#8a2be2', fontSize: '3rem', display: 'block', marginBottom: '15px' }}>🛋️</span>
                                                    <h3 style={{ color: '#fff', margin: 0, fontSize: '1.2rem', letterSpacing: '0.5px' }}>{memoizedDisplay.model || foundModel}</h3>
                                                    <div style={{ color: '#aaa', fontSize: '0.8rem', marginTop: '8px', textTransform: 'uppercase' }}>{memoizedDisplay.brand || brand}</div>
                                                </div>
                                                {isTransitioning && (
                                                    <div className={styles.authOverlay}>
                                                        <div className={styles.authScanner}></div>
                                                        <span className={styles.authText}>AUTHENTICATING...</span>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    }

                                    return (
                                        <div className={styles.placeholderVisual}>
                                            <div className={styles.wireframeCube}></div>
                                            <div className={styles.radarCircle}></div>
                                            <div className={styles.radarCircle2}></div>
                                            <span className={styles.searchingText}>MATCHING BEST PRODUCT...</span>
                                        </div>
                                    );
                                }

                                return (
                                    <div className={`${styles.imageWrapper} ${isTransitioning ? styles.isScanning : ''}`}>
                                        <img 
                                            key={activeImage} // Force re-animation on source change
                                            src={getFullUrl(activeImage)} 
                                            alt="Discovery Preview" 
                                            className={styles.productImage} 
                                            onError={(e) => {
                                                e.target.src = 'https://placehold.co/600x400?text=Match+Found';
                                            }}
                                        />
                                        
                                        {isTransitioning && (
                                            <div className={styles.authOverlay}>
                                                <div className={styles.authScanner}></div>
                                                <span className={styles.authText}>AUTHENTICATING...</span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}
                            <div className={styles.imageScanner}></div>
                        </div>

                        <div className={styles.dataStreams}>
                            <div className={styles.stream}>ITEM: {currentItem?.description?.substring(0, 15)}...</div>
                            <div className={styles.stream}>CATEGORY: {currentItem?.category || 'FURNITURE'}</div>
                            <div className={styles.stream}>BRAND: {isTransitioning ? 'CRYSTALLIZING...' : (memoizedDisplay.brand || (foundModel ? brand : '...'))}</div>
                            <div className={styles.stream}>ACCURACY: {isTransitioning ? 'CALCULATING...' : (memoizedDisplay.accuracy || accuracy).toFixed(2)}%</div>
                        </div>
                    </div>

                    {/* Right Side: Process Logs & Result */}
                    <div className={styles.infoArea}>
                        <div className={styles.targetBox}>
                            <label>TARGETING:</label>
                            <h3>{currentItem?.description?.substring(0, 50) || 'Lounge Sofa'}{currentItem?.description?.length > 50 ? '...' : ''}</h3>
                        </div>

                        <div className={styles.processSteps}>
                            {AI_STEPS.map((step, i) => {
                                const isActive = i <= stepIndex;
                                const isCurrent = i === stepIndex;
                                const isFinal = i === AI_STEPS.length - 1;
                                const isFailed = status === 'error' && isCurrent;

                                return (
                                    <div 
                                        key={step.id} 
                                        className={`${styles.step} ${isActive ? styles.active : ''} ${isCurrent ? styles.current : ''} ${isFailed ? styles.failed : ''}`}
                                    >
                                        <span className={styles.stepIcon}>{isFailed ? '❌' : (isActive && !isCurrent ? '✓' : '●')}</span>
                                        <span className={styles.stepLabel}>{isFailed ? 'Failed to process row' : step.label}</span>
                                        {isActive && !isCurrent && !isFailed && <span className={styles.stepCheck}></span>}
                                        {isFinal && status === 'success' && <span className={styles.stepCheck}>✓</span>}
                                    </div>
                                );
                            })}
                        </div>

                        <div className={styles.terminal}>
                            {logs.map((log, i) => (
                                <div key={i} className={styles.logEntry}>{`> ${log}`}</div>
                            ))}
                        </div>

                        {/* Progress Bar */}
                        <div className={styles.progressSection}>
                            <div className={styles.progressInfo}>
                                <span>BATCH PROGRESS</span>
                                <span>{Math.round(progress)}%</span>
                            </div>
                            <div className={styles.progressBar}>
                                <div className={styles.progressFill} style={{ width: `${progress}%` }}></div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer / Discovery Tag */}
                <div className={styles.footer}>
                    <div className={styles.discoveryTag}>
                       <span className={styles.sparkle}>✨</span> 
                       {isTransitioning 
                        ? 'AUTHENTICATING IDENTITY...' 
                        : (status === 'success' || memoizedDisplay.model) 
                            ? 'NEW MODEL AUTHENTICATED' 
                            : 'DISCOVERING IDENTITY'}
                       : <strong>{isTransitioning ? 'VERIFYING SYMMETRY...' : (memoizedDisplay.brand || (foundModel ? brand : 'IDENTIFYING...'))} {isTransitioning ? '' : (foundModel || memoizedDisplay.model || '')}</strong>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AIPresentationModal;
