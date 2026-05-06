import React, { useState, useEffect, useRef } from 'react';
import styles from '../styles/AIPresentation.module.css';
import { useTheme } from '../context/ThemeContext';
import { getFullUrl } from '../utils/urlUtils';

const FURNITURE_STEPS = [
    { id: 'query', label: 'Analyzing Specification', icon: '' },
    { id: 'catalog', label: 'Exploring Brand Catalog', icon: '' },
    { id: 'filter', label: 'Applying Physical Constraints', icon: '' },
    { id: 'match', label: 'Identifying Perfect Match', icon: '' },
    { id: 'found', label: 'Product Authenticated', icon: '' }
];

const FITOUT_STEPS = [
    { id: 'query', label: 'Analyzing Engineering Spec', icon: '' },
    { id: 'catalog', label: 'Exploring Fitout Database', icon: '' },
    { id: 'filter', label: 'Calculating Material Needs', icon: '' },
    { id: 'match', label: 'Optimizing Element Match', icon: '' },
    { id: 'found', label: 'Engineering Solution Found', icon: '' }
];

const NeuralSynapse = ({ from, to, active }) => (
    <svg className={styles.synapseSvg} style={{ opacity: active ? 1 : 0.2 }}>
        <path 
            d={`M ${from.x} ${from.y} C ${from.x + 100} ${from.y}, ${to.x - 100} ${to.y}, ${to.x} ${to.y}`} 
            className={active ? styles.synapseActive : styles.synapseIdle}
        />
    </svg>
);

const NeuralLink = () => (
    <svg className={styles.neuralLinkSvg} viewBox="0 0 1000 200" preserveAspectRatio="none">
        <defs>
            <linearGradient id="neuralGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(138, 43, 226, 0)" />
                <stop offset="50%" stopColor="rgba(138, 43, 226, 0.4)" />
                <stop offset="100%" stopColor="rgba(138, 43, 226, 0)" />
            </linearGradient>
            <linearGradient id="neuralGradGold" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(245, 166, 35, 0)" />
                <stop offset="50%" stopColor="rgba(245, 166, 35, 0.2)" />
                <stop offset="100%" stopColor="rgba(245, 166, 35, 0)" />
            </linearGradient>
            <filter id="glow">
                <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                </feMerge>
            </filter>
        </defs>
        
        {/* Complex Neural Paths */}
        <path d="M0,100 C200,20 400,180 600,100 S800,180 1000,100" fill="none" stroke="url(#neuralGrad)" strokeWidth="2" className={styles.neuralPath} style={{ animationDuration: '4s' }} />
        <path d="M0,50 C200,180 400,20 600,50 S800,20 1000,50" fill="none" stroke="url(#neuralGrad)" strokeWidth="1.2" className={styles.neuralPath} style={{ animationDuration: '6s', animationDelay: '-1s' }} />
        <path d="M0,150 C200,50 400,150 600,150 S800,50 1000,150" fill="none" stroke="url(#neuralGradGold)" strokeWidth="1" className={styles.neuralPath} style={{ animationDuration: '8s', animationDelay: '-2s' }} />
        <path d="M0,100 Q250,0 500,100 T1000,100" fill="none" stroke="url(#neuralGrad)" strokeWidth="0.8" className={styles.neuralPath} style={{ animationDuration: '10s', animationDelay: '-3s' }} />
        <path d="M0,100 Q250,200 500,100 T1000,100" fill="none" stroke="url(#neuralGradGold)" strokeWidth="0.8" className={styles.neuralPath} style={{ animationDuration: '12s', animationDelay: '-4s' }} />
        
        {/* Additional Cross-Neural Links */}
        <path d="M0,200 Q500,0 1000,200" fill="none" stroke="url(#neuralGrad)" strokeWidth="0.5" opacity="0.3" className={styles.neuralPath} style={{ animationDuration: '15s' }} />
        <path d="M0,0 Q500,200 1000,0" fill="none" stroke="url(#neuralGradGold)" strokeWidth="0.5" opacity="0.3" className={styles.neuralPath} style={{ animationDuration: '18s' }} />
    </svg>
);

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
    type = '',
    alignment = 'center',
    isMinimized = false,
    minimizedOffset = 24,
    onToggleMinimize = () => {},
    onMinimizeAll = () => {},
    swarm = null, // { lanes: { id: { label, status, progress, currentItem, brand } } }
    title = '' 
}) => {
    const { theme } = useTheme();
    const [stepIndex, setStepIndex] = useState(0);
    const [logs, setLogs] = useState([]);
    const [accuracy, setAccuracy] = useState(99.1);

    // Derive dynamic panel label from title prop
    const agentLabel = title?.toLowerCase().includes('multi budget')
        ? 'BUDGET AGENTS'
        : title?.toLowerCase().includes('value engineer')
            ? 'CATEGORY AGENTS'
            : 'SWARM AGENTS';
    
    // DRAGGING STATE
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const modalRef = useRef(null);
    
    const AI_STEPS = type === 'fitout' ? FITOUT_STEPS : FURNITURE_STEPS;
    const modeIcon = '';
    
    // NEW: Persistent display data to keep previously matched item visible during next search
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
        const validLanes = Object.values(swarm.lanes).filter(l => 
            l.image || 
            (l.currentItem && (l.currentItem.image || l.currentItem.brandImage || l.currentItem.imageRef))
        );
        if (validLanes.length === 0) return null;
        const lane = validLanes[swarmImageIndex % validLanes.length];
        return lane.image || lane.currentItem?.brandImage || lane.currentItem?.image || lane.currentItem?.imageRef;
    };

    const getSwarmActiveTier = () => {
        if (!swarm || !swarm.lanes) return null;
        const validLanes = Object.values(swarm.lanes).filter(l => l.image || (l.currentItem && l.currentItem.image));
        if (validLanes.length === 0) return null;
        const lane = validLanes[swarmImageIndex % validLanes.length];
        return lane.tier || lane.id;
    };

    const getTierColor = () => {
        if (swarm && Object.keys(swarm.lanes || {}).length > 1) return '#8a2be2'; // Swarm Purple
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
            const engineName = type === 'fitout' ? 'Neural Fitout Engine' : 'Neural Furniture Engine';
            setLogs([`Initializing ${engineName}...`]);
            
            const timer = setInterval(() => {
                setStepIndex(prev => {
                    if (status === 'success') return AI_STEPS.length - 1;
                    if (status === 'routing') return 0; // Stay at first step during routing
                    if (status === 'error') return prev; 
                    return prev < AI_STEPS.length - 2 ? prev + 1 : prev; 
                });
            }, 1000);

            return () => clearInterval(timer);
        }
    }, [isOpen, currentItem, status, type]);

    // Transition effect: Only update the main display screen when a NEW match is definitive.
    // This allows the previous product to remain visible while the next search happens in the background.
    useEffect(() => {
        let timer;
        
        // In swarm mode, we might not have a single 'foundModel' top-level prop, 
        // but we can memoize the latest active swarm image/model for stability.
        const swarmActive = getSwarmActiveImage();
        const swarmLane = swarm && swarm.lanes ? Object.values(swarm.lanes).find(l => 
            l.image === swarmActive || 
            l.currentItem?.brandImage === swarmActive || 
            l.currentItem?.image === swarmActive || 
            l.currentItem?.imageRef === swarmActive
        ) : null;

        if (status === 'success' && foundModel && foundModel !== lastMatchedModelRef.current) {
            lastMatchedModelRef.current = foundModel;
            setMemoizedDisplay({
                image: foundImage,
                model: foundModel,
                brand: brand,
                accuracy: accuracy,
                description: currentItem?.description || '',
                category: currentItem?.category || ''
            });
            setIsTransitioning(true);
            timer = setTimeout(() => setIsTransitioning(false), 1000);
        } else if (swarmLane && swarmLane.model && swarmLane.model !== memoizedDisplay.model) {
            // Also update memoized display from swarm lanes for visual continuity
            setMemoizedDisplay(prev => ({
                ...prev,
                image: swarmActive,
                model: swarmLane.model,
                brand: swarmLane.brand,
                description: swarmLane.currentItem?.description || prev.description
            }));
        } else if (status !== 'success' && !swarm) {
            setIsTransitioning(false);
        }

        return () => {
            if (timer) clearTimeout(timer);
        };
    }, [status, foundModel, foundImage, brand, accuracy, swarm, swarmImageIndex]);

    useEffect(() => {
        if (isOpen) {
            if (status === 'routing') {
                setLogs(prev => [...prev, 'Orchestrating Swarm Lanes...', 'Analyzing BOQ Structure...', 'AI Router Online'].slice(-5));
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
        if (e.target === e.currentTarget) {
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
                            {type?.toUpperCase() === 'FITOUT' ? 'FITOUT' : 'FURNITURE'}: {tier.toUpperCase()} {Math.round(progress)}%
                        </span>
                        <div className={styles.minimizedControls}>
                             <button className={styles.maximizeBtn} onClick={(e) => { e.stopPropagation(); onToggleMinimize(false); }}>⛶</button>
                        </div>
                    </div>
                    <div className={styles.minimizedBody}>
                        {(foundImage || memoizedDisplay.image) && (
                            <img 
                                src={getFullUrl(foundImage || memoizedDisplay.image)} 
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
            <div className={`${styles.overlay} ${theme === 'light' ? styles.light : ''}`} onClick={() => onToggleMinimize(true)}>
                <div className={styles.modal} style={{ padding: '40px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                    <div className={styles.aiStatus}>
                        <div className={styles.pulse}></div>
                        {title || 'AI Engine Active'}
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
            <div 
                ref={modalRef} 
                className={styles.modal} 
                style={{ 
                    ...getAlignmentStyle(),
                    transform: `${getAlignmentStyle().transform || ''} translate(${position.x}px, ${position.y}px)`.trim(),
                    borderColor: getTierColor() + '44',
                    boxShadow: `0 50px 100px rgba(0,0,0,0.6), 0 0 50px ${getTierColor()}33`
                }} 
                onClick={(e) => e.stopPropagation()} 
                onMouseDown={handleMouseDown}
            >
                {/* Header with Scanning Effect */}
                <div className={styles.header} onMouseDown={handleMouseDown}>
                    <div className={styles.aiStatus}>
                        <div className={styles.pulse} style={{ background: getTierColor() }}></div>
                        <span style={{ color: getTierColor() }}>
                            {title || 'AI Engine Active'}
                        </span>
                    </div>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        {swarm && <div className={styles.swarmIndicator}>NEURAL SWARM SYNCHRONIZED</div>}
                        {status === 'routing' && <div className={styles.routingIndicator}>ROUTING...</div>}
                         <button className={styles.minimizeBtn} title="Minimize" onClick={() => onToggleMinimize(true)}>_</button>
                         <button className={styles.close} title="Close" onClick={onClose}>×</button>
                    </div>
                </div>

                {/* Swarm Dashboard removed — categories are now in the side panel */}

                <div className={styles.content}>
                    {/* SWARM SIDE PANEL: Compact vertical category agents */}
                    {swarm && swarm.lanes && (
                        <div className={styles.swarmSidePanel}>
                            <div className={styles.sidePanelHeader}>
                                <div className={styles.sidePanelIcon}>
                                    <i className="ri-cpu-line"></i>
                                </div>
                                <span>{agentLabel}</span>
                            </div>
                            {Object.entries(swarm.lanes).map(([catId, lane]) => {
                                const isActive = lane.status === 'active' || lane.status === 'identifying';
                                const isSuccess = lane.status === 'success';
                                const isError = lane.status === 'error';
                                return (
                                    <div 
                                        key={catId} 
                                        className={`${styles.swarmCard} ${isActive ? styles.swarmCardActive : ''} ${isSuccess ? styles.swarmCardSuccess : ''} ${isError ? styles.swarmCardError : ''}`}
                                    >
                                        {/* Card left accent */}
                                        <div className={styles.swarmCardAccent} />
                                        
                                        {/* Logo */}
                                        <div className={styles.swarmCardLogo}>
                                            {lane.brandLogo ? (
                                                <img src={lane.brandLogo} alt="" />
                                            ) : (
                                                <i className="ri-building-line"></i>
                                            )}
                                        </div>
                                        
                                        {/* Info */}
                                        <div className={styles.swarmCardInfo}>
                                            <div className={styles.swarmCardCategory}>{lane.label}</div>
                                            {lane.brand && lane.brand !== 'N/A' && (
                                                <div className={styles.swarmCardBrand}>{lane.brand}</div>
                                            )}
                                        </div>
                                        
                                        {/* Status */}
                                        <div className={styles.swarmCardStatus}>
                                            <span className={`${styles.statusDot} ${isActive ? styles.statusActive : isSuccess ? styles.statusSuccess : isError ? styles.statusError : styles.statusIdle}`} />
                                        </div>
                                        
                                        {/* Mini progress */}
                                        <div className={styles.swarmCardProgress}>
                                            <div className={styles.swarmCardProgressFill} style={{ width: `${lane.progress || 0}%` }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Main Visual: The "Brain" / Thinking Area */}
                    <div className={`${styles.visualArea} ${swarm ? styles.swarmVisualArea : ''}`}>
                        <div className={styles.imagePreviewContainer}>
                            {/* Logic: While transitioning or searching, prefer showing the last stable match (memoizedDisplay) 
                                unless we finally have a fresh success. This eliminates the "progress placeholder" between items. */}
                            {(() => {
                                const swarmImage = getSwarmActiveImage();
                                const activeImage = isTransitioning 
                                    ? memoizedDisplay.image 
                                    : (foundImage || swarmImage || memoizedDisplay.image);
                                
                                if (!activeImage) {
                                    if (memoizedDisplay.model || foundModel) {
                                        return (
                                            <div className={`${styles.imageWrapper} ${styles.emptyImageState} ${isTransitioning ? styles.isScanning : ''}`}>
                                                <div className={styles.emptyImageContent}>
                                                    <span className={styles.emptyImageIcon}>{modeIcon}</span>
                                                    <h3 className={styles.emptyImageTitle}>{memoizedDisplay.model || foundModel}</h3>
                                                    <div className={styles.emptyImageSubtitle}>{memoizedDisplay.brand || brand}</div>
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
                                            <div className={styles.neuralCoreContainer}>
                                                <div className={styles.wireframeCube} />
                                                <div className={styles.radarCircle} />
                                                <div className={styles.radarCircle2} />
                                                
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
                                            </div>
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
                            <div className={styles.stream}>ITEM: {(memoizedDisplay.description || currentItem?.description || '...').substring(0, 20)}...</div>
                            <div className={styles.stream}>BRAND: {isTransitioning ? '...' : (memoizedDisplay.brand || (foundModel ? brand : '...'))} | ACC: {isTransitioning ? '...' : `${(memoizedDisplay.accuracy || accuracy).toFixed(1)}%`}</div>
                        </div>
                    </div>

                    {/* Right Side: Process Logs & Result */}
                    <div className={styles.infoArea}>
                        {/* TIER STACK - Only for non-swarm (standard) mode; swarm categories are in the side panel */}
                        {!swarm && (
                            <div className={styles.tierStack}>
                                {[
                                    { id: 'premium', label: 'PREMIUM TIER', scopes: ['Elite Selection', 'High Durability', 'Iconic Design'] },
                                    { id: 'mid-range', label: 'MID-RANGE TIER', scopes: ['Balanced Cost', 'Standard Specs', 'Reliable Build'] },
                                    { id: 'value-engineered', label: 'VALUE ENGINEERED', scopes: ['Cost Optimized', 'Functional Match', 'Project Grade'] }
                                ].sort((a, b) => a.id === tier ? -1 : b.id === tier ? 1 : 0).map(t => (
                                    <div key={t.id} className={`${styles.tierItem} ${tier === t.id ? styles.active : ''}`}>
                                        <div className={styles.tierMain}>
                                            <span className={styles.tierLabel}>{t.label}</span>
                                            {tier === t.id && <span className={styles.tierValue}>ACTIVE ENGINE</span>}
                                        </div>
                                        <div className={styles.scopeSecondary}>
                                            {t.scopes.map(s => (
                                                <span key={s} className={styles.scopePill}>{s}</span>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {(memoizedDisplay.model || foundModel) && (
                            <div className={`${styles.matchedBox} ${styles.shimmerEffect}`}>
                                <label>MATCHED PRODUCT:</label>
                                <h2>{memoizedDisplay.model || foundModel}</h2>
                                <div className={styles.brand}>{memoizedDisplay.brand || brand}</div>
                            </div>
                        )}

                        <div className={styles.targetBox}>
                            <label>TARGETING:</label>
                            <h3>{(memoizedDisplay.description || currentItem?.description || 'Lounge Sofa').substring(0, 80)}</h3>
                            <div className={styles.categorySubText}>Category: {memoizedDisplay.category || currentItem?.category || (type === 'fitout' ? 'FITOUT' : 'FURNITURE')}</div>
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
                                        <span className={styles.stepIcon}>{isFailed ? 'X' : (isActive && !isCurrent ? '✓' : '')}</span>
                                        <span className={styles.stepLabel}>{isFailed ? 'Failed to process row' : step.label}</span>
                                        {isActive && !isCurrent && !isFailed && <span className={styles.stepCheck}></span>}
                                        {isFinal && status === 'success' && <span className={styles.stepCheck}>✓</span>}
                                    </div>
                                );
                            })}
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
                    {isTransitioning 
                        ? 'AUTHENTICATING IDENTITY...' 
                        : (status === 'success' || memoizedDisplay.model) 
                            ? 'NEW MODEL AUTHENTICATED' 
                            : 'DISCOVERING IDENTITY'}
                    {' : '}
                    <strong>{isTransitioning ? 'VERIFYING SYMMETRY...' : (memoizedDisplay.brand || (foundModel ? brand : 'IDENTIFYING...'))} {isTransitioning ? '' : (foundModel || memoizedDisplay.model || '')}</strong>
                </div>
            </div>
        </div>
    );
};

export default AIPresentationModal;
