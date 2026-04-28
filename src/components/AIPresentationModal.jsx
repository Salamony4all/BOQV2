import React, { useState, useEffect, useRef } from 'react';
import styles from '../styles/AIPresentation.module.css';
import { useTheme } from '../context/ThemeContext';
import { getFullUrl } from '../utils/urlUtils';

const FURNITURE_STEPS = [
    { id: 'query', label: 'Analyzing Specification', icon: '🛋️' },
    { id: 'catalog', label: 'Exploring Brand Catalog', icon: '📖' },
    { id: 'filter', label: 'Applying Physical Constraints', icon: '📐' },
    { id: 'match', label: 'Identifying Perfect Match', icon: '🎯' },
    { id: 'found', label: 'Product Authenticated', icon: '✨' }
];

const FITOUT_STEPS = [
    { id: 'query', label: 'Analyzing Engineering Spec', icon: '🛠️' },
    { id: 'catalog', label: 'Exploring Fitout Database', icon: '🗄️' },
    { id: 'filter', label: 'Calculating Material Needs', icon: '📊' },
    { id: 'match', label: 'Optimizing Element Match', icon: '🏗️' },
    { id: 'found', label: 'Engineering Solution Found', icon: '✅' }
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

        {/* Animated Data Packets (Circles following paths) */}
        <circle r="3" fill="#fff" filter="url(#glow)" className={styles.dataPacket} style={{ color: '#fff' }}>
            <animateMotion dur="4s" repeatCount="indefinite" path="M0,100 C200,20 400,180 600,100 S800,180 1000,100" />
        </circle>
        <circle r="2.5" fill="#f5a623" filter="url(#glow)" className={styles.dataPacket} style={{ color: '#f5a623', animationDelay: '-1.5s' }}>
            <animateMotion dur="6s" repeatCount="indefinite" path="M0,50 C200,180 400,20 600,50 S800,20 1000,50" />
        </circle>
        <circle r="2" fill="#8a2be2" filter="url(#glow)" className={styles.dataPacket} style={{ color: '#8a2be2', animationDelay: '-3s' }}>
            <animateMotion dur="8s" repeatCount="indefinite" path="M0,150 C200,50 400,150 600,150 S800,50 1000,150" />
        </circle>
        <circle r="1.5" fill="#fff" filter="url(#glow)" className={styles.dataPacket} style={{ color: '#fff', animationDelay: '-5s' }}>
            <animateMotion dur="10s" repeatCount="indefinite" path="M0,100 Q250,0 500,100 T1000,100" />
        </circle>
        <circle r="1.5" fill="#f5a623" filter="url(#glow)" className={styles.dataPacket} style={{ color: '#f5a623', animationDelay: '-7s' }}>
            <animateMotion dur="12s" repeatCount="indefinite" path="M0,100 Q250,200 500,100 T1000,100" />
        </circle>
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
    
    const AI_STEPS = type === 'fitout' ? FITOUT_STEPS : FURNITURE_STEPS;
    const modeIcon = type === 'fitout' ? '🛠️' : '🛋️';
    
    // NEW: Persistent display data to keep previously matched item visible during next search
    const [memoizedDisplay, setMemoizedDisplay] = useState({
        image: null,
        model: '',
        brand: '',
        accuracy: 99.1,
        description: '' // Added to fix timing bug
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
        
        if (status === 'success' && foundModel && foundModel !== lastMatchedModelRef.current) {
            lastMatchedModelRef.current = foundModel;
            
            // CRITICAL: Update immediately so the new model becomes the static background
            // for the subsequent search, overcoming cleanup race conditions in batch processing.
            setMemoizedDisplay({
                image: foundImage,
                model: foundModel,
                brand: brand,
                accuracy: accuracy,
                description: currentItem?.description || '' // Capture current description
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
        if (isOpen) {
            if (status === 'routing') {
                setLogs(prev => [...prev, '🌐 Orchestrating Swarm Lanes...', '📡 Analyzing BOQ Structure...', '🤖 AI Router Online'].slice(-5));
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
                            {type?.toUpperCase() === 'FITOUT' ? '🏗️ FITOUT' : '🛋️ FURNITURE'}: {tier.toUpperCase()} {Math.round(progress)}%
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
                            {tier.toUpperCase()} {status === 'success' ? 'IDENTIFIED' : status === 'error' ? 'RETRYING' : 'AI FURNISHING ACTIVE'}
                        </span>
                    </div>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        {swarm && <div className={styles.swarmIndicator}>NEURAL SWARM SYNCHRONIZED</div>}
                        {status === 'routing' && <div className={styles.routingIndicator}>ROUTING...</div>}
                         <button className={styles.minimizeBtn} onClick={() => onToggleMinimize(true)}>_</button>
                         <button className={styles.close} onClick={() => onToggleMinimize(true)}>×</button>
                    </div>
                </div>

                {swarm && (
                    <div className={styles.swarmDashboard}>
                        {/* Central Engine - The Neural Core */}
                        <div className={`${styles.swarmEngine} ${status === 'success' ? styles.engineSuccess : status === 'error' ? styles.engineError : ''}`}>
                            <div className={styles.engineCore}></div>
                            {Array.from({ length: 3 }).map((_, i) => (
                                <div key={i} className={styles.engineRing}></div>
                            ))}
                            <div className={styles.engineScanner}></div>
                            <div className={styles.engineAura}></div>
                        </div>
                        
                        <NeuralLink />
                        
                        {/* Dynamic Connections: Synapses from Core to Lanes */}
                        <svg className={styles.swarmSynapseLayer}>
                            {Object.values(swarm.lanes).map((lane, index) => {
                                const angle = (index / Object.keys(swarm.lanes).length) * 2 * Math.PI;
                                const radius = 240; 
                                const tx = 400 + Math.cos(angle) * radius;
                                const ty = 140 + Math.sin(angle) * radius;
                                const isProcessing = lane.status === 'active' || lane.status === 'identifying';
                                
                                return (
                                    <path 
                                        key={`syn-${lane.id}`}
                                        d={`M 400 140 Q ${400 + (tx-400)*0.5} ${140 + (ty-140)*0.8}, ${tx} ${ty}`}
                                        className={`${styles.neuralSynapse} ${isProcessing ? styles.synapseActive : ''} ${lane.status === 'success' ? styles.synapseSuccess : ''}`}
                                    />
                                );
                            })}
                        </svg>
                        
                        <div className={styles.neuralConnectivity}></div>
                        <div className={styles.swarmAmbientGlow}></div>
                        
                        {/* Floating Particles */}
                        <div className={styles.swarmParticleContainer}>
                            {Array.from({ length: 30 }).map((_, i) => (
                                <div key={i} className={styles.swarmParticle} style={{ 
                                    left: `${Math.random() * 100}%`, 
                                    top: `${Math.random() * 100}%`,
                                    animationDelay: `${Math.random() * 5}s`,
                                    animationDuration: `${5 + Math.random() * 10}s`,
                                    background: i % 3 === 0 ? '#8a2be2' : i % 3 === 1 ? '#f5a623' : '#fff'
                                }} />
                            ))}
                        </div>

                        {/* Swarm Lanes (The Processing Nodes) */}
                        {Object.values(swarm.lanes).map((lane, index) => {
                            const isProcessing = lane.status === 'active' || lane.status === 'identifying';
                            const angle = (index / Object.keys(swarm.lanes).length) * 2 * Math.PI;
                            const radius = 240; 
                            const x = Math.cos(angle) * radius;
                            const y = Math.sin(angle) * radius;

                            return (
                                <div 
                                    key={lane.id} 
                                    className={`${styles.swarmLane} ${isProcessing ? styles.laneActive : ''} ${lane.status === 'success' ? styles.laneComplete : ''} ${lane.status === 'error' ? styles.laneError : ''}`}
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
                                        <div style={{ flex: 1 }}>
                                            <div className={styles.laneLabel}>{lane.label}</div>
                                            <div className={styles.laneBrand}>{lane.brand}</div>
                                        </div>
                                        {lane.status === 'success' && <div className={styles.successSparkle}></div>}
                                    </div>
                                    
                                    <div className={styles.laneProgressContainer}>
                                        <div className={styles.laneProgressBar} style={{ width: `${lane.progress || 0}%` }} />
                                        <div className={styles.progressShimmer}></div>
                                    </div>

                                    <div className={styles.laneStatus}>
                                        {isProcessing ? (
                                            <div className={styles.laneProcessing}>
                                                <span className={styles.laneCurrentItem}>PROCESSING...</span>
                                                <div className={styles.laneActivityLines}>
                                                    <span></span><span></span><span></span>
                                                </div>
                                            </div>
                                        ) : lane.status === 'success' ? (
                                            <div className={styles.laneSuccessState}>
                                                <span className={styles.laneResult}>AUTHENTICATED</span>
                                                <span className={styles.laneModelName}>{lane.model?.substring(0, 15)}...</span>
                                            </div>
                                        ) : lane.status === 'error' ? (
                                            <div className={styles.laneErrorState}>
                                                <span>NO MATCH FOUND</span>
                                            </div>
                                        ) : (
                                            <span className={styles.laneIdle}>WAITING...</span>
                                        )}
                                    </div>

                                    {isProcessing && (
                                        <div className={styles.laneMetrics}>
                                            <div className={styles.metricItem}>
                                                <label>SYNC</label>
                                                <span>{Math.floor(Math.random() * 20) + 80}%</span>
                                            </div>
                                            <div className={styles.metricItem}>
                                                <label>CPU</label>
                                                <span>{Math.floor(Math.random() * 15) + 5}%</span>
                                            </div>
                                        </div>
                                    )}

                                    {/* Data Stream Effect for active lanes */}
                                    {isProcessing && <div className={styles.laneDataStream}></div>}
                                </div>
                            );
                        })}

                        {/* Router State Overlay */}
                        {status === 'routing' && (
                            <div className={styles.routerOverlay}>
                                <div className={styles.routerPulse}></div>
                                <div className={styles.routerDataRing}></div>
                                <div className={styles.routerText}>ORCHESTRATING SWARM LANES</div>
                                <div className={styles.routerProgress}>
                                    <div className={styles.routerProgressFill}></div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                <div className={styles.content}>
                    {/* Left Side: The "Brain" / Thinking Area */}
                    <div className={`${styles.visualArea} ${swarm ? styles.swarmVisualArea : ''}`}>
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
                                                    <span style={{ color: '#8a2be2', fontSize: '3rem', display: 'block', marginBottom: '15px' }}>{modeIcon}</span>
                                                    <h3 style={{ color: theme === 'light' ? '#0f172a' : '#fff', margin: 0, fontSize: '1.2rem', letterSpacing: '0.5px' }}>{memoizedDisplay.model || foundModel}</h3>
                                                    <div style={{ color: theme === 'light' ? '#475569' : '#aaa', fontSize: '0.8rem', marginTop: '8px', textTransform: 'uppercase' }}>{memoizedDisplay.brand || brand}</div>
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
                                            <span className={styles.searchingText}>
                                                {status === 'routing' ? 'AI ROUTER: CLASSIFYING BOQ...' : 'NEURAL CORE: MATCHING BEST PRODUCT...'}
                                            </span>
                                            {status === 'routing' && (
                                                <div className={styles.routingDataNodes}>
                                                    {Array.from({ length: 8 }).map((_, i) => (
                                                        <div key={i} className={styles.dataNode} style={{ animationDelay: `${i * 0.1}s` }} />
                                                    ))}
                                                </div>
                                            )}
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
                            <div className={styles.stream}>ITEM: {(memoizedDisplay.description || currentItem?.description)?.substring(0, 15)}...</div>
                            <div className={styles.stream}>CATEGORY: {currentItem?.category || (type === 'fitout' ? 'FITOUT' : 'FURNITURE')}</div>
                            <div className={styles.stream}>BRAND: {isTransitioning ? 'CRYSTALLIZING...' : (memoizedDisplay.brand || (foundModel ? brand : '...'))}</div>
                            <div className={styles.stream}>ACCURACY: {isTransitioning ? 'CALCULATING...' : (memoizedDisplay.accuracy || accuracy).toFixed(2)}%</div>
                        </div>
                    </div>

                    {/* Right Side: Process Logs & Result */}
                    <div className={styles.infoArea}>
                        {(memoizedDisplay.model || foundModel) && (
                            <div className={`${styles.matchedBox} ${styles.shimmerEffect}`}>
                                <label>MATCHED PRODUCT:</label>
                                <h2>{memoizedDisplay.model || foundModel}</h2>
                                <div className={styles.brand}>{memoizedDisplay.brand || brand}</div>
                            </div>
                        )}

                        <div className={styles.targetBox}>
                            <label>TARGETING:</label>
                            <h3>{currentItem?.description?.substring(0, 80) || 'Lounge Sofa'}</h3>
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
