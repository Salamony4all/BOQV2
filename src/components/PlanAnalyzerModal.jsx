import React, { useState, useEffect } from 'react';
import { useCompanyProfile } from '../context/CompanyContext';
import { DEFAULT_AI_SETTINGS } from '../utils/aiConstants';
import { getApiBase } from '../utils/apiBase';
import styles from '../styles/PlanAnalyzerModal.module.css';

const API_BASE = getApiBase();

const PlanAnalyzerModal = ({ isOpen, onClose, onApply }) => {
    const { aiSettings } = useCompanyProfile();
    const fileInputRef = React.useRef(null);
    const [files, setFiles] = useState([]);
    const [stage, setStage] = useState('upload'); // upload, uploading, scope, processing, results
    const [uploadProgress, setUploadProgress] = useState(0);
    const [progress, setProgress] = useState('');
    const [results, setResults] = useState(null);
    const [error, setError] = useState(null);

    // Only reset state on initial open/close
    useEffect(() => {
        if (!isOpen) {
            setFiles([]);
            setStage('upload');
            setResults(null);
            setError(null);
            setUploadProgress(0);
        }
    }, [isOpen]);

    const handleBrowseClick = () => {
        if (fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    const handleFileSelection = (e) => {
        const rawFiles = e.target ? e.target.files : (Array.isArray(e) ? e : [e]);
        const selected = Array.from(rawFiles || []);
        
        if (selected.length === 0) return;
        
        setStage('uploading');
        setFiles(selected);
        setError(null);
        setUploadProgress(0);

        let progressVal = 0;
        const interval = setInterval(() => {
            progressVal += 20;
            setUploadProgress(progressVal);
            if (progressVal >= 100) {
                clearInterval(interval);
                setStage('scope');
            }
        }, 80);
    };

    const startAnalysis = async (scope) => {
        setStage('processing');
        setError(null);
        setResults(null);
        
        let allItems = [];
        const includeFitout = scope === 'both';

        try {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const fileLabel = files.length > 1 ? `[File ${i+1}/${files.length}] ` : '';
                setProgress(`${fileLabel}Initializing AI Engine for ${file.name}...`);

                const formData = new FormData();
                formData.append('files', file);
                formData.append('includeFitout', includeFitout);
                formData.append('provider', aiSettings?.engine || 'google');
                formData.append('providerModel', aiSettings?.model || '');

                const response = await fetch(`${API_BASE}/api/analyze-plan`, {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.error || `Failed to analyze ${file.name}`);
                }

                const data = await response.json();
                if (data && data.items) {
                    const processedItems = data.items.map(item => ({
                        ...item,
                        location: files.length > 1 ? `${item.location} (${file.name})` : item.location
                    }));
                    allItems = [...allItems, ...processedItems];
                }
            }

            if (allItems.length > 0) {
                const extractedResults = {
                    items: allItems,
                    summary: `Unified extraction complete across ${files.length} document(s).`,
                    itemCount: allItems.length,
                    roomCount: new Set(allItems.map(i => i.location)).size
                };
                setResults(extractedResults);
                setStage('results');
            } else {
                throw new Error('No items detected in the provided drawings.');
            }
        } catch (err) {
            console.error('Multi-plan analysis error:', err);
            setError(err.message);
            setStage('scope');
        }
    };

    const handleClose = () => {
        onClose();
    };

    const handleApplyResults = () => {
        if (results && results.items && typeof onApply === 'function') {
            onApply(results.items);
        }
        handleClose();
    };

    const updateQty = (idx, newQty) => {
        const val = parseFloat(newQty) || 0;
        setResults(prev => {
            if (!prev) return null;
            const newItems = [...prev.items];
            newItems[idx] = { ...newItems[idx], qty: val };
            const total = newItems.reduce((acc, item) => acc + item.qty, 0);
            return { 
                ...prev, 
                items: newItems,
                itemCount: total
            };
        });
    };

    if (!isOpen) return null;

    return (
        <div className={styles.overlay} onClick={handleClose}>
            <div className={`${styles.modal} ${stage === 'results' ? styles.largeModal : ''}`} onClick={e => e.stopPropagation()}>
                
                {/* Header */}
                <div className={styles.header}>
                    <div className={styles.titleGroup}>
                        <div className={styles.title}>
                            <span className={styles.pulseIcon}></span>
                            Precision Plan AI Analyzer
                        </div>
                        <div className={styles.subtitle}>
                            {stage === 'results' ? 'Verify and correct extracted quantities before generating BOQ' : 'Architectural-grade furniture & fitout extraction'}
                        </div>
                    </div>
                    <button className={styles.closeBtn} onClick={handleClose}>×</button>
                </div>

                <div className={styles.content}>
                    {error && (
                        <div className={styles.errorMsg}>
                            <span className={styles.errorIcon}></span>
                            {error}
                        </div>
                    )}

                    {/* Step 0: Initial Upload */}
                    {stage === 'upload' && (
                        <div className={styles.uploadStage}>
                            <div className={styles.dropZone}>
                                <input 
                                    type="file" 
                                    ref={fileInputRef}
                                    className={styles.hiddenInput} 
                                    multiple 
                                    accept=".pdf,.png,.jpg,.jpeg"
                                    onChange={handleFileSelection}
                                />
                                <div className={styles.dropZoneContent}>
                                    <div className={styles.dropIcon}></div>
                                    <h3>Upload Floor Plans</h3>
                                    <p>Select one or more architectural drawings (PDF/JPG/PNG)</p>
                                    <button className={styles.browseBtn} onClick={handleBrowseClick}>Browse Files</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Step 1: Uploading Progress */}
                    {stage === 'uploading' && (
                        <div className={styles.processingArea}>
                            <div className={styles.uploadProgressContainer}>
                                <div className={styles.progressBar}>
                                    <div 
                                        className={styles.progressFill} 
                                        style={{ width: `${uploadProgress}%` }}
                                    />
                                </div>
                                <div className={styles.progressStatus}>
                                    TRANSMITTING SOURCE DRAWING... {uploadProgress}%
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Step 2: Scope Selection */}
                    {stage === 'scope' && (
                        <div className={styles.scopeSelectionArea}>
                            <h3>Analysis Configuration</h3>
                            <p>Configure how AI should process your drawings</p>
                            
                            <div className={styles.sectionTitle} style={{ marginTop: '1.5rem', width: '100%', maxWidth: '800px', textAlign: 'left' }}>Extraction Scope</div>
                            <div className={styles.scopeCards}>
                                <div className={styles.scopeCard} onClick={() => startAnalysis('furniture')}>
                                    <div className={styles.scopeIcon}></div>
                                    <div className={styles.scopeTitle}>Loose Furniture</div>
                                    <div className={styles.scopeDesc}>Extract only desks, chairs, sofas, and standalone items.</div>
                                </div>
                                
                                <div className={styles.scopeCard} onClick={() => startAnalysis('both')}>
                                    <div className={styles.scopeIcon}></div>
                                    <div className={styles.scopeTitle}>Furniture & Fitout</div>
                                    <div className={styles.scopeDesc}>Comprehensive extraction including partitions, walls, and flooring.</div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Step 3: AI Processing */}
                    {stage === 'processing' && (
                        <div className={styles.processingArea}>
                            <div className={styles.blueprintContainer}>
                                <div className={styles.blueprintGrid} />
                                <div className={styles.blueprintDrawing}>
                                    <svg viewBox="0 0 220 148" style={{ width: '100%', height: '100%', display: 'block' }} aria-hidden="true">
                                        <path d="M16 16 H68 M106 16 H156 M184 16 H204 V50 M204 86 V132 H130 M112 132 H16 V16" fill="none" stroke="#60a5fa" strokeWidth="2.4" />
                                        <path d="M124 16 V60 M124 76 V80 M16 78 H66 M82 78 H134 M134 78 V104 M134 120 V132" fill="none" stroke="rgba(96,165,250,0.75)" strokeWidth="1.4" />
                                        <line x1="112" y1="132" x2="112" y2="114" stroke="#93c5fd" strokeWidth="1.3" />
                                        <path d="M112 114 A18 18 0 0 1 130 132" fill="none" stroke="rgba(147,197,253,0.7)" strokeWidth="1" strokeDasharray="2.5 2" />
                                        <line x1="66" y1="78" x2="66" y2="62" stroke="#93c5fd" strokeWidth="1.3" />
                                        <path d="M66 62 A16 16 0 0 1 82 78" fill="none" stroke="rgba(147,197,253,0.7)" strokeWidth="1" strokeDasharray="2.5 2" />
                                        <line x1="124" y1="60" x2="140" y2="60" stroke="#93c5fd" strokeWidth="1.3" />
                                        <path d="M140 60 A16 16 0 0 1 124 76" fill="none" stroke="rgba(147,197,253,0.7)" strokeWidth="1" strokeDasharray="2.5 2" />
                                        <rect x="40" y="34" width="58" height="20" rx="10" fill="rgba(59,130,246,0.2)" stroke="#93c5fd" strokeWidth="1.2" />
                                        <rect x="48" y="26" width="9" height="5" rx="2" fill="rgba(96,165,250,0.35)" stroke="#93c5fd" strokeWidth="0.9" />
                                        <rect x="64" y="26" width="9" height="5" rx="2" fill="rgba(96,165,250,0.35)" stroke="#93c5fd" strokeWidth="0.9" />
                                        <rect x="80" y="26" width="9" height="5" rx="2" fill="rgba(96,165,250,0.35)" stroke="#93c5fd" strokeWidth="0.9" />
                                        <rect x="48" y="57" width="9" height="5" rx="2" fill="rgba(96,165,250,0.35)" stroke="#93c5fd" strokeWidth="0.9" />
                                        <rect x="64" y="57" width="9" height="5" rx="2" fill="rgba(96,165,250,0.35)" stroke="#93c5fd" strokeWidth="0.9" />
                                        <rect x="80" y="57" width="9" height="5" rx="2" fill="rgba(96,165,250,0.35)" stroke="#93c5fd" strokeWidth="0.9" />
                                        <path d="M150 30 H188 V58 H178 V41 H150 Z" fill="rgba(59,130,246,0.2)" stroke="#93c5fd" strokeWidth="1.2" />
                                        <circle cx="165" cy="50" r="5" fill="rgba(96,165,250,0.35)" stroke="#93c5fd" strokeWidth="0.9" />
                                        <rect x="30" y="94" width="62" height="24" rx="2" fill="rgba(59,130,246,0.2)" stroke="#93c5fd" strokeWidth="1.2" />
                                        <line x1="30" y1="106" x2="92" y2="106" stroke="rgba(147,197,253,0.6)" strokeWidth="0.9" strokeDasharray="2 1.5" />
                                        <path d="M154 92 H192 V122 H182 V101 H154 Z" fill="rgba(59,130,246,0.2)" stroke="#93c5fd" strokeWidth="1.2" />
                                        <circle cx="166" cy="114" r="7.5" fill="rgba(59,130,246,0.2)" stroke="#93c5fd" strokeWidth="1.2" />
                                    </svg>
                                </div>
                                <div className={styles.scanLine} />
                            </div>
                            <div className={styles.processingInfo}>
                                <h3>
                                    <span className={styles.loadingSpinner}></span>
                                    {progress}
                                </h3>
                                <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Analyzing geometric identifiers. This may take up to 60 seconds.</p>
                            </div>
                        </div>
                    )}

                    {/* Step 4: Verification Stage */}
                    {stage === 'results' && results && (
                        <div className={styles.resultsArea}>
                            <div className={styles.resultsHeader}>
                                <div className={styles.summaryBox}>
                                    {results.summary}
                                </div>
                                <div className={styles.statsBar}>
                                    <div className={styles.statItem}>
                                        <span className={styles.statLabel}>Rooms/Zones</span>
                                        <span className={styles.statValue}>{results.roomCount}</span>
                                    </div>
                                    <div className={styles.statItem}>
                                        <span className={styles.statLabel}>Total Objects</span>
                                        <span className={styles.statValue}>{results.items.reduce((a, b) => a + b.qty, 0)}</span>
                                    </div>
                                </div>
                            </div>

                            <div className={styles.tableWrapper}>
                                <table className={styles.table}>
                                    <thead>
                                        <tr>
                                            <th>Location / Zone</th>
                                            <th>Category</th>
                                            <th>Description</th>
                                            <th className={styles.numCol}>Qty (Edit)</th>
                                            <th>Unit</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {results.items.map((item, idx) => (
                                            <tr key={idx}>
                                                <td className={styles.locationCell}>{item.location}</td>
                                                <td>
                                                    <span className={`${styles.scopeTag} ${item.scope?.toLowerCase().includes('fitout') ? styles.fitoutScope : styles.furnitureScope}`}>
                                                        {item.scope}
                                                    </span>
                                                </td>
                                                <td className={styles.descCell}>{item.description}</td>
                                                <td className={styles.qtyCell}>
                                                    <input 
                                                        type="number" 
                                                        className={styles.editQtyInput}
                                                        value={item.qty}
                                                        min="0.1"
                                                        step="0.1"
                                                        onChange={(e) => updateQty(idx, e.target.value)}
                                                    />
                                                </td>
                                                <td className={styles.unitCell}>{item.unit}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Logic */}
                <div className={styles.footer}>
                    {stage !== 'processing' && stage !== 'uploading' && (
                        <button className={styles.cancelBtn} onClick={handleClose}>
                            {stage === 'results' ? 'Discard' : 'Cancel'}
                        </button>
                    )}
                    
                    {stage === 'results' && (
                        <button className={styles.applyBtn} onClick={handleApplyResults}>
                            Apply to Project BOQ
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default PlanAnalyzerModal;
