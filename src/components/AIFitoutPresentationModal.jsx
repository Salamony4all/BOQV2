import React, { useState, useEffect, useRef } from 'react';
import styles from '../styles/AIPresentation.module.css';
import { useTheme } from '../context/ThemeContext';
import { getFullUrl } from '../utils/urlUtils';

const FITOUT_STEPS = [
    { id: 'query', label: 'Analyzing Engineering Spec', icon: '🛠️' },
    { id: 'catalog', label: 'Exploring Fitout Database', icon: '🗄️' },
    { id: 'filter', label: 'Calculating Material Needs', icon: '📊' },
    { id: 'match', label: 'Optimizing Element Match', icon: '🏗️' },
    { id: 'found', label: 'Engineering Solution Found', icon: '✅' }
];

const AIFitoutPresentationModal = ({ 
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
    type = 'fitout',
    alignment = 'center',
    isMinimized = false,
    minimizedOffset = 24,
    onToggleMinimize = () => {},
    onMinimizeAll = () => {},
    swarm = null // { lanes: { id: { label, status, progress, currentItem, brand } } }
}) => {
    const { theme } = useTheme();
    const [stepIndex, setStepIndex] = useState(0);
    const [logs, setLogs] = useState([]);
    const [accuracy, setAccuracy] = useState(99.1);
    
    // DRAGGING STATE
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const modalRef = useRef(null);
    
    const AI_STEPS = FITOUT_STEPS;
    const modeIcon = '🛠️';
    
    // Persistent display data: syncs image and description together
    const [memoizedDisplay, setMemoizedDisplay] = useState({
        image: null,
        model: '',
        brand: '',
        accuracy: 99.1,
        description: '', // Added to fix timing bug
        category: ''     // Track category for stability
    });
    const [isTransitioning, setIsTransitioning] = useState(false);
    const lastMatchedModelRef = useRef(null);
    const [swarmImageIndex, setSwarmImageIndex] = useState(0);

    // Cycle through images from active lanes for the central core visual
    useEffect(() => {
        if (swarm && swarm.lanes && Object.keys(swarm.lanes).length > 0) {
            const laneImages = Object.values(swarm.lanes)
                .map(l => l.currentItem?.image || l.image)
                .filter(Boolean);
            
            if (laneImages.length > 0) {
                const interval = setInterval(() => {
                    setSwarmImageIndex(prev => (prev + 1) % laneImages.length);
                }, 2000);
                return () => clearInterval(interval);
            }
        }
    }, [swarm]);

    const getSwarmActiveImage = () => {
        if (!swarm || !swarm.lanes) return null;
        const validLanes = Object.values(swarm.lanes).filter(l => l.image || (l.currentItem && l.currentItem.image));
        if (validLanes.length === 0) return null;
        const lane = validLanes[swarmImageIndex % validLanes.length];
        return lane.image || lane.currentItem.image;
    };

    const getSwarmActiveTier = () => {
        if (!swarm || !swarm.lanes) return null;
        const validLanes = Object.values(swarm.lanes).filter(l => l.image || (l.currentItem && l.currentItem.image));
        if (validLanes.length === 0) return null;
        const lane = validLanes[swarmImageIndex % validLanes.length];
        return lane.tier || lane.id;
    };

    const getTierColor = () => {
        if (tier === 'budgetary') return '#059669'; // Emerald
        if (tier === 'mid') return '#0284c7';       // Sky
        if (tier === 'high') return '#2563eb';      // Blue
        return '#10b981';
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
            setLogs([`Initializing Neural Fitout Engine...`]);
            
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
    useEffect(() => {
        let timer;
        
        if (status === 'success' && foundModel && foundModel !== lastMatchedModelRef.current) {
            lastMatchedModelRef.current = foundModel;
            
            setMemoizedDisplay({
                image: foundImage,
                model: foundModel,
                brand: brand,
                accuracy: accuracy,
                description: currentItem?.description || '', // Capture current item's description
                category: currentItem?.category || ''        // Capture current category
            });
            
            setIsTransitioning(true);
            timer = setTimeout(() => {
                setIsTransitioning(false);
            }, 1000);
        } else if (status !== 'success') {
            setIsTransitioning(false);
        }

        return () => {
            if (timer) clearTimeout(timer);
        };
    }, [status, foundModel, foundImage, brand, accuracy]);

    useEffect(() => {
        if (isOpen) {
            if (status === 'routing') {
                setLogs(prev => [...prev, '🌐 Orchestrating Fitout Swarm...', '🏗️ Analyzing Structural Spec...', '🤖 AI Router Online'].slice(-5));
            } else if (AI_STEPS[stepIndex]) {
                setLogs(prev => [...prev, `${AI_STEPS[stepIndex].icon} ${AI_STEPS[stepIndex].label}`].slice(-5));
            }
        }
    }, [stepIndex, isOpen, status]);

    // Handle Dragging Events on Window
    useEffect(() => {
        const handleMouseMove = (e) => {
            if (!isDragging) return;
            
            const newX = e.clientX - dragStart.x;
            const newY = e.clientY - dragStart.y;
            
            setPosition({ x: newX, y: newY });
        };

        const handleMouseUp = () => {
            setIsDragging(false);
        };

        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, dragStart]);

    const handleMouseDown = (e) => {
        // Only allow dragging from header
        if (e.target.closest(`.${styles.header}`)) {
            setIsDragging(true);
            setDragStart({
                x: e.clientX - position.x,
                y: e.clientY - position.y
            });
        }
    };

    if (!isOpen) return null;

    const handleOutsideClick = (e) => {
        if (e.target.className && typeof e.target.className === 'string' && e.target.className.includes(styles.overlay)) {
            onToggleMinimize(true);
        }
    };

    if (isMinimized) {
        return (
            <div className={`${styles.overlay} ${styles.minimized}`}>
                <div 
                    className={`${styles.minimizedContainer} ${theme === 'light' ? styles.light : ''}`} 
                    onClick={() => onToggleMinimize(false)}
                    style={{ right: `${minimizedOffset}px` }}
                >
                    <div className={styles.minimizedHeader}>
                        <div className={styles.pulse} style={{ background: getTierColor() }}></div>
                        <span style={{ color: getTierColor() }}>
                            🏗️ FITOUT: {tier.toUpperCase()} {Math.round(progress)}%
                        </span>
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
                <div className={styles.modal} style={{ padding: '40px', textAlign: 'center', borderColor: '#10b981' }} onClick={e => e.stopPropagation()}>
                    <div className={styles.completionHeader}>
                        <div className={styles.sparkleLarge} style={{ color: '#10b981' }}>✅</div>
                        <h2 style={{ color: '#10b981' }}>FITOUT ANALYSIS COMPLETE</h2>
                        <p>We've successfully optimized and updated your Fitout elements.</p>
                    </div>
                    
                    <div className={styles.summaryStats}>
                        <div className={styles.statBox}>
                            <span className={styles.statVal} style={{ color: '#10b981' }}>{batchResult.success || 0}</span>
                            <span className={styles.statLabel}>Solutions Matched</span>
                        </div>
                        <div className={styles.statBox}>
                            <span className={styles.statVal} style={{ color: '#ef4444' }}>{batchResult.error || 0}</span>
                            <span className={styles.statLabel}>Requires Help</span>
                        </div>
                    </div>

                    <div style={{ margin: '30px 0', opacity: 0.7, fontSize: '0.9rem' }}>
                        {batchResult.error > 0 
                            ? "Some engineering specs couldn't be matched automatically. Review results below."
                            : "Perfect! All fitout elements matched with maximum engineering accuracy."}
                    </div>

                    <button className={styles.doneBtn} style={{ background: 'linear-gradient(135deg, #10b981 0%, #0284c7 100%)' }} onClick={onClose}>
                        Review Engineering Results
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
            <div ref={modalRef} className={styles.modal} style={{ 
                ...getAlignmentStyle(),
                transform: `${getAlignmentStyle().transform || ''} translate(${position.x}px, ${position.y}px)`.trim(),
                borderColor: getTierColor() + '44',
                boxShadow: `0 50px 100px rgba(0,0,0,0.6), 0 0 50px ${getTierColor()}33`
            }} onClick={(e) => e.stopPropagation()} onMouseDown={handleMouseDown}>
                <div className={styles.header}>
                    <div className={styles.aiStatus}>
                        <div className={styles.pulse} style={{ background: getTierColor() }}></div>
                        <span style={{ color: getTierColor() }}>
                            {tier.toUpperCase()} {status === 'success' ? 'ENGINEERING OK' : status === 'error' ? 'RECALCULATING' : 'ENGINEERING DISCOVERY'}
                        </span>
                    </div>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        {swarm && <div className={styles.swarmIndicator}>NEURAL SWARM SYNCHRONIZED</div>}
                        {status === 'routing' && <div className={styles.routingIndicator}>ROUTING...</div>}
                         <button className={styles.minimizeBtn} title="Minimize" onClick={() => onToggleMinimize(true)}>_</button>
                         <button className={styles.close} title="Close" onClick={onClose}>×</button>
                    </div>
                </div>

                {swarm && (
                    <div className={styles.swarmDashboard}>
                        <div className={`${styles.swarmEngine} ${status === 'success' ? styles.engineSuccess : status === 'error' ? styles.engineError : ''}`}>
                            <div className={styles.engineCore}>
                                {swarm ? (
                                    <div className={styles.swarmImageContainer}>
                                        {getSwarmActiveImage() ? (
                                            <div key={getSwarmActiveImage()} className={styles.swarmImageWrapper}>
                                                <img 
                                                    src={getFullUrl(getSwarmActiveImage())} 
                                                    className={styles.coreProductImage} 
                                                    alt="" 
                                                />
                                                <div className={`${styles.matchingOverlay} ${styles[getSwarmActiveTier() || '']}`}>
                                                    <span>ENGINEERING MATCH</span>
                                                </div>
                                            </div>
                                        ) : memoizedDisplay.image ? (
                                            <div className={styles.swarmImageWrapper}>
                                                <img 
                                                    src={getFullUrl(memoizedDisplay.image)} 
                                                    className={styles.coreProductImage} 
                                                    alt="" 
                                                />
                                                <div className={styles.matchingOverlay}>
                                                    <span>STABILIZING SPEC...</span>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className={styles.corePulse}>
                                                <i className="ri-tools-line"></i>
                                            </div>
                                        )}
                                    </div>
                                ) : (foundImage || memoizedDisplay.image) && (
                                    <div className={styles.singleImageWrapper}>
                                        <img 
                                            src={getFullUrl(foundImage || memoizedDisplay.image)} 
                                            className={styles.coreProductImage} 
                                            alt="" 
                                        />
                                    </div>
                                )}
                            </div>
                            {Array.from({ length: 3 }).map((_, i) => (
                                <div key={i} className={styles.engineRing}></div>
                            ))}
                            <div className={styles.engineScanner}></div>
                            <div className={styles.engineAura}></div>
                        </div>

                        <div className={styles.tierOrbit}>
                            {['budgetary', 'mid', 'high'].map((tKey, tIndex) => {
                                const isTierInSwarm = swarm && swarm.lanes && Object.values(swarm.lanes).some(l => (l.tier || '').toLowerCase() === tKey);
                                const isActive = tier === tKey || isTierInSwarm || !tier;
                                const isMatched = (status === 'success' && tier === tKey) || 
                                                 (swarm && swarm.lanes && Object.values(swarm.lanes).some(l => (l.tier || '').toLowerCase() === tKey && l.status === 'success'));
                                
                                return (
                                    <div 
                                        key={tKey}
                                        className={`${styles.tierNode} ${isActive ? styles.active : ''} ${isMatched ? styles.matched : ''}`}
                                        style={{
                                            '--t-index': tIndex,
                                            '--tier-color': tKey === 'budgetary' ? '#22c55e' : tKey === 'mid' ? '#3b82f6' : '#db2777'
                                        }}
                                    >
                                        <div className={styles.tierNodePulse} />
                                        <div className={styles.tierNodeContent}>
                                            <span className={styles.tierNodeIcon}>
                                                {tKey === 'budgetary' ? '🛠️' : tKey === 'mid' ? '🏗️' : '🏛️'}
                                            </span>
                                            <span className={styles.tierNodeLabel}>{tKey.toUpperCase()}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        
                        <div className={styles.swarmParticleContainer}>
                            {Array.from({ length: 30 }).map((_, i) => (
                                <div key={i} className={styles.swarmParticle} style={{ 
                                    left: `${Math.random() * 100}%`, 
                                    top: `${Math.random() * 100}%`,
                                    animationDelay: `${Math.random() * 5}s`,
                                    animationDuration: `${5 + Math.random() * 10}s`,
                                    background: i % 3 === 0 ? '#10b981' : i % 3 === 1 ? '#0284c7' : '#fff'
                                }} />
                            ))}
                        </div>

                        {/* Swarm Lanes */}
                        {swarm && swarm.lanes && Object.values(swarm.lanes).map((lane, index) => {
                            const isProcessing = lane.status === 'active' || lane.status === 'identifying';
                            const angle = (index / Object.keys(swarm.lanes).length) * 2 * Math.PI;
                            const radius = 240; 
                            const x = Math.cos(angle) * radius;
                            const y = Math.sin(angle) * radius;
                            const isThisTier = lane.id === tier;

                            return (
                                <div 
                                    key={lane.id} 
                                    className={`${styles.swarmLane} ${isProcessing ? styles.laneActive : ''} ${lane.status === 'success' ? styles.laneComplete : ''} ${lane.status === 'error' ? styles.laneError : ''} ${isThisTier ? styles.lanePrimary : ''}`}
                                    style={{
                                        '--orbit-x': `${x}px`,
                                        '--orbit-y': `${y}px`,
                                        animationDelay: `${index * 0.15}s`
                                    }}
                                >
                                    <div className={styles.laneHeader}>
                                        <div className={styles.laneAvatar}>
                                            <div className={styles.avatarInner}>
                                                {lane.status === 'success' ? '✓' : lane.id.substring(0, 1).toUpperCase()}
                                            </div>
                                            {isProcessing && <div className={styles.avatarPulse}></div>}
                                            <div className={styles.laneScanner}></div>
                                        </div>
                                        <div className={styles.laneNode}>
                                            <div className={styles.laneLabel}>{lane.status === 'success' ? 'RESOLVED' : isProcessing ? 'CALCULATING' : 'PENDING'}</div>
                                        </div>
                                    </div>
                                    
                                    <div className={styles.laneProgressContainer}>
                                        <div className={styles.laneProgressBar} style={{ width: `${lane.progress || 0}%` }} />
                                    </div>

                                    <div className={styles.laneStatus}>
                                        {isProcessing ? (
                                            <div className={styles.laneProcessing}>
                                                <div className={styles.miniTierPill} style={{ 
                                                    background: (lane.tier || (['budgetary', 'mid', 'high'].includes(lane.id) ? lane.id : tier)) === 'budgetary' ? '#22c55e' : (lane.tier || (['budgetary', 'mid', 'high'].includes(lane.id) ? lane.id : tier)) === 'mid' ? '#3b82f6' : '#db2777' 
                                                }}>{(lane.tier || (['budgetary', 'mid', 'high'].includes(lane.id) ? lane.id : tier))?.toUpperCase() || 'FITOUT SWARM'}</div>
                                                <div className={styles.laneCategorySecondary}>{lane.label}</div>
                                                <span className={styles.laneCurrentItem}>SOLVING...</span>
                                            </div>
                                        ) : (
                                            <div className={styles.laneIdleState}>
                                                <div className={styles.miniTierPill} style={{ background: '#64748b' }}>PENDING</div>
                                                <div className={styles.laneCategorySecondary}>{lane.label}</div>
                                                <span className={styles.laneIdle}>WAITING...</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                <div className={styles.content}>
                    <div className={styles.visualArea}>
                        <div className={styles.imagePreviewContainer} style={{ borderColor: getTierColor() + '66' }}>
                            {(() => {
                                const activeImage = isTransitioning 
                                    ? memoizedDisplay.image 
                                    : (foundImage || memoizedDisplay.image);
                                
                                if (!activeImage) {
                                    if (memoizedDisplay.model || foundModel) {
                                        return (
                                            <div className={`${styles.imageWrapper} ${isTransitioning ? styles.isScanning : ''}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0, 0, 0, 0.4)', backdropFilter: 'blur(10px)', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                                                <div style={{ textAlign: 'center', padding: '20px' }}>
                                                    <span style={{ color: '#10b981', fontSize: '3rem', display: 'block', marginBottom: '15px' }}>{modeIcon}</span>
                                                    <h3 style={{ color: '#fff', margin: 0, fontSize: '1.2rem', letterSpacing: '0.5px' }}>{memoizedDisplay.model || foundModel}</h3>
                                                    <div style={{ color: '#aaa', fontSize: '0.8rem', marginTop: '8px', textTransform: 'uppercase' }}>{memoizedDisplay.brand || brand}</div>
                                                </div>
                                                {isTransitioning && (
                                                    <div className={styles.authOverlay}>
                                                        <div className={styles.authScanner} style={{ background: 'linear-gradient(to right, transparent, #10b981, transparent)' }}></div>
                                                        <span className={styles.authText} style={{ textShadow: '0 0 10px #10b981' }}>SOLVING...</span>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    }

                                    return (
                                        <div className={styles.placeholderVisual}>
                                            <div className={styles.neuralCoreContainer}>
                                                <div className={styles.wireframeCube} style={{ borderColor: 'rgba(16, 185, 129, 0.4)' }}></div>
                                                <div className={styles.radarCircle} style={{ borderColor: 'rgba(16, 185, 129, 0.2)' }}></div>
                                                <div className={styles.radarCircle2} style={{ borderColor: 'rgba(16, 185, 129, 0.2)' }}></div>
                                                
                                                {/* Neural Scanning Gallery */}
                                                {swarm && swarm.lanes && (
                                                    <div className={styles.neuralGallery}>
                                                        {Object.values(swarm.lanes)
                                                            .filter(l => l.currentItem?.image || l.image)
                                                            .slice(-6)
                                                            .map((l, i) => (
                                                                <img 
                                                                    key={i}
                                                                    src={getFullUrl(l.currentItem?.image || l.image)} 
                                                                    className={styles.galleryThumb} 
                                                                    style={{ '--delay': `${i * 0.2}s` }}
                                                                    alt=""
                                                                />
                                                            ))
                                                        }
                                                    </div>
                                                )}
                                                <span className={styles.searchingText} style={{ color: '#10b981', marginTop: '20px' }}>OPTIMIZING SOLUTIONS...</span>
                                            </div>
                                        </div>
                                    );
                                }

                                return (
                                    <div className={`${styles.imageWrapper} ${isTransitioning ? styles.isScanning : ''}`}>
                                        <img 
                                            key={activeImage}
                                            src={getFullUrl(activeImage)} 
                                            alt="Discovery Preview" 
                                            className={styles.productImage} 
                                            onError={(e) => { e.target.src = 'https://placehold.co/600x400?text=Fitout+Found'; }}
                                        />
                                        {isTransitioning && (
                                            <div className={styles.authOverlay}>
                                                <div className={styles.authScanner} style={{ background: 'linear-gradient(to right, transparent, #10b981, transparent)' }}></div>
                                                <span className={styles.authText} style={{ textShadow: '0 0 10px #10b981' }}>SOLVING...</span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}
                            <div className={styles.imageScanner} style={{ background: 'rgba(16, 185, 129, 0.5)', boxShadow: '0 0 15px #10b981' }}></div>
                        </div>

                        <div className={styles.dataStreams}>
                            <div className={styles.stream} style={{ borderLeftColor: '#10b981' }}>ITEM: {(memoizedDisplay.description || currentItem?.description || '...').substring(0, 15)}...</div>
                            <div className={styles.stream} style={{ borderLeftColor: '#10b981' }}>CATEGORY: {memoizedDisplay.category || currentItem?.category || 'FITOUT'}</div>
                            <div className={styles.stream} style={{ borderLeftColor: '#10b981' }}>BRAND: {isTransitioning ? 'CRYSTALLIZING...' : (memoizedDisplay.brand || (foundModel ? brand : '...'))}</div>
                            <div className={styles.stream} style={{ borderLeftColor: '#10b981' }}>ACCURACY: {isTransitioning ? 'CALCULATING...' : (memoizedDisplay.accuracy || accuracy).toFixed(2)}%</div>
                        </div>
                    </div>

                    <div className={styles.infoArea}>
                        {(memoizedDisplay.model || foundModel) && (
                            <div className={styles.matchedBox} style={{ background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(2, 132, 199, 0.1) 100%)', borderColor: 'rgba(16, 185, 129, 0.3)' }}>
                                <label style={{ color: '#10ffaa' }}>MATCHED SOLUTION:</label>
                                <h2>{memoizedDisplay.model || foundModel}</h2>
                                <div className={styles.brand}>{memoizedDisplay.brand || brand}</div>
                            </div>
                        )}

                        <div className={styles.targetBox} style={{ background: 'rgba(16, 185, 129, 0.1)', borderColor: 'rgba(16, 185, 129, 0.2)' }}>
                            <label style={{ color: '#10b981' }}>TARGETING SPEC:</label>
                            <h3>{(memoizedDisplay.description || currentItem?.description || 'Fitout Element').substring(0, 80)}</h3>
                        </div>

                        <div className={styles.processSteps}>
                            {AI_STEPS.map((step, i) => {
                                const isActive = i <= stepIndex;
                                const isCurrent = i === stepIndex;
                                const isFinal = i === AI_STEPS.length - 1;
                                const isFailed = status === 'error' && isCurrent;

                                return (
                                    <div key={step.id} className={`${styles.step} ${isActive ? styles.active : ''} ${isCurrent ? styles.current : ''} ${isFailed ? styles.failed : ''}`}>
                                        <span className={styles.stepIcon}>{isFailed ? '❌' : (isActive && !isCurrent ? '✓' : '●')}</span>
                                        <span className={styles.stepLabel} style={isCurrent ? { color: '#10b981' } : {}}>{isFailed ? 'Failed to resolve spec' : step.label}</span>
                                        {isActive && !isCurrent && !isFailed && <span className={styles.stepCheck} style={{ color: '#10b981' }}>✓</span>}
                                        {isFinal && status === 'success' && <span className={styles.stepCheck} style={{ color: '#10b981' }}>✓</span>}
                                    </div>
                                );
                            })}
                        </div>

                        <div className={styles.terminal} style={{ color: '#10ffaa', borderColor: 'rgba(16, 255, 170, 0.1)' }}>
                            {logs.map((log, i) => (
                                <div key={i} className={styles.logEntry}>{`> ${log}`}</div>
                            ))}
                        </div>

                        <div className={styles.progressSection}>
                            <div className={styles.progressInfo}>
                                <span>BATCH PROGRESS</span>
                                <span>{Math.round(progress)}%</span>
                            </div>
                            <div className={styles.progressBar}>
                                <div className={styles.progressFill} style={{ width: `${progress}%`, background: `linear-gradient(90deg, #10b981, #0284c7)` }}></div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className={styles.footer}>
                    <div className={styles.discoveryTag}>
                       <span className={styles.sparkle}>🛠️</span> 
                       {isTransitioning 
                        ? 'SOLVING ENGINEERING SPEC...' 
                        : (status === 'success' || memoizedDisplay.model) 
                            ? 'SOLUTION AUTHENTICATED' 
                            : 'OPTIMIZING SOLUTION'}
                       : <strong style={{ color: '#10b981' }}>{isTransitioning ? 'VERIFYING STABILITY...' : (memoizedDisplay.brand || (foundModel ? brand : 'ENGINEERING...'))} {isTransitioning ? '' : (foundModel || memoizedDisplay.model || '')}</strong>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AIFitoutPresentationModal;
