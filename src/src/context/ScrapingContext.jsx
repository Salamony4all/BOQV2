import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import styles from '../styles/AddBrandModal.module.css';

const ScrapingContext = createContext(null);

const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:3001' : '';

export function ScrapingProvider({ children }) {
    const [scrapingState, setScrapingState] = useState({
        isActive: false,
        brandName: '',
        progress: 0,
        stage: '',
        taskId: null,
        onComplete: null,
        onError: null,
        // New: connection status tracking
        isConnected: true,
        consecutiveErrors: 0,
        lastSuccessfulPoll: null
    });

    const [successData, setSuccessData] = useState(null);
    const pollingRef = useRef(null);

    // Clear polling when unmounting
    useEffect(() => {
        return () => {
            if (pollingRef.current?.clear) {
                pollingRef.current.clear();
            }
        };
    }, []);

    // Adaptive polling interval based on error state
    const getPollingInterval = useCallback((errorCount) => {
        if (errorCount >= 5) return 8000; // 8s when many errors
        if (errorCount >= 3) return 5000; // 5s when some errors
        return 2500; // 2.5s normal
    }, []);

    // Check for saved files on Railway (Smart Recovery)
    const checkForSavedFile = useCallback(async (brandName) => {
        try {
            // normalizing name for comparison
            const targetName = brandName.toLowerCase().trim();

            const res = await fetch(`${API_BASE}/api/brands`);
            if (!res.ok) return null;

            const data = await res.json();
            if (!data.brands || data.brands.length === 0) return null;

            // Find most recent matching file
            const match = data.brands
                .filter(b => b.name.toLowerCase().trim() === targetName)
                .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))[0];

            if (match) {
                // Check if this file was created AFTER we started scraping
                // (To avoid picking up old scrapes)
                console.log(`📂 Found saved backup for ${brandName}:`, match.filename);
                return match;
            }
        } catch (e) {
            console.warn('Failed to check for saved files:', e);
        }
        return null;
    }, []);

    // Core polling function - NEVER STOPS, auto-recovers
    const startPolling = useCallback(async (taskId, brandName, onComplete, onError) => {
        // Clear any existing polling
        if (pollingRef.current?.clear) {
            pollingRef.current.clear();
        }

        const startTime = Date.now();

        // Reset connection status
        setScrapingState(prev => ({
            ...prev,
            isConnected: true,
            consecutiveErrors: 0
        }));

        let currentErrorCount = 0;
        let pollIntervalId = null;

        // Recursive polling function that adapts to errors
        const poll = async () => {
            try {
                // Longer timeout - Railway can be slow under load
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

                const res = await fetch(`${API_BASE}/api/tasks/${taskId}`, {
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }

                const task = await res.json();

                // Successfully got response - reset error counter
                currentErrorCount = 0;
                setScrapingState(prev => ({
                    ...prev,
                    isConnected: true,
                    consecutiveErrors: 0,
                    lastSuccessfulPoll: Date.now()
                }));

                if (task.status === 'completed') {
                    if (pollIntervalId) clearTimeout(pollIntervalId);
                    pollingRef.current = null;

                    setScrapingState(prev => ({ ...prev, progress: 100, stage: 'Complete!' }));

                    setTimeout(() => {
                        // Show success modal
                        setSuccessData({
                            brandName: task.brandName || brandName,
                            count: task.productCount || task.brand?.productCount || 0,
                            enriched: task.summary?.enriched || 0
                        });

                        setScrapingState(prev => ({ ...prev, isActive: false }));

                        // Call completion callback
                        if (onComplete) onComplete(task);
                    }, 500);
                    return; // Stop polling

                } else if (task.status === 'failed') {
                    if (pollIntervalId) clearTimeout(pollIntervalId);
                    pollingRef.current = null;

                    setScrapingState(prev => ({ ...prev, isActive: false }));
                    if (onError) onError(new Error(task.error || 'Scraping failed'));
                    return; // Stop polling

                } else if (task.status === 'cancelled') {
                    if (pollIntervalId) clearTimeout(pollIntervalId);
                    pollingRef.current = null;
                    setScrapingState(prev => ({ ...prev, isActive: false }));
                    return; // Stop polling

                } else {
                    // Update progress
                    setScrapingState(prev => ({
                        ...prev,
                        progress: task.progress || prev.progress,
                        stage: task.stage || prev.stage,
                        brandName: task.brandName || prev.brandName
                    }));
                }

                // Schedule next poll with normal interval
                pollIntervalId = setTimeout(poll, getPollingInterval(0));

            } catch (e) {
                console.warn('Polling error (will retry):', e.message);

                // Track consecutive errors but KEEP POLLING
                currentErrorCount++;
                const isDisconnected = currentErrorCount >= 3;

                setScrapingState(prev => ({
                    ...prev,
                    consecutiveErrors: currentErrorCount,
                    isConnected: !isDisconnected,
                    stage: isDisconnected
                        ? `⚠️ Connection unstable (retrying... ${currentErrorCount})`
                        : prev.stage
                }));

                // SMART RECOVERY: If connection is bad, check if file was saved anyway!
                if (currentErrorCount > 2) {
                    const savedFile = await checkForSavedFile(brandName);
                    if (savedFile) {
                        try {
                            const fileRes = await fetch(`${API_BASE}/api/brands/${savedFile.filename}`);
                            if (fileRes.ok) {
                                const fileData = await fileRes.json();

                                // Only use if it looks new enough (created after we started)
                                const fileTime = new Date(fileData.completedAt).getTime();
                                if (fileTime > startTime) {
                                    console.log('🎉 RECOVERED FROM SAVED FILE!');

                                    if (pollIntervalId) clearTimeout(pollIntervalId);
                                    pollingRef.current = null;

                                    setScrapingState(prev => ({ ...prev, progress: 100, stage: 'Recovered from backup!' }));

                                    setTimeout(() => {
                                        setSuccessData({
                                            brandName: fileData.brandInfo.name,
                                            count: fileData.productCount,
                                            enriched: 0
                                        });
                                        setScrapingState(prev => ({ ...prev, isActive: false }));
                                        if (onComplete) onComplete(fileData);
                                    }, 500);
                                    return;
                                }
                            }
                        } catch (recError) {
                            console.error('Recovery failed:', recError);
                        }
                    }
                }

                // KEEP POLLING - use longer interval when errors occur
                const nextInterval = getPollingInterval(currentErrorCount);
                console.log(`🔄 Retrying in ${nextInterval / 1000}s (attempt ${currentErrorCount})`);
                pollIntervalId = setTimeout(poll, nextInterval);
            }
        };

        // Store reference so we can clear it
        pollingRef.current = { clear: () => { if (pollIntervalId) clearTimeout(pollIntervalId); } };

        // Start first poll immediately
        poll();
    }, [getPollingInterval, checkForSavedFile]);

    // Refresh/Reconnect function - manually restarts polling
    const refreshConnection = useCallback(() => {
        if (scrapingState.taskId && scrapingState.isActive) {
            console.log('🔄 Manually refreshing connection for task:', scrapingState.taskId);

            setScrapingState(prev => ({
                ...prev,
                stage: 'Reconnecting...',
                consecutiveErrors: 0,
                isConnected: true
            }));

            startPolling(
                scrapingState.taskId,
                scrapingState.brandName,
                scrapingState.onComplete,
                scrapingState.onError
            );
        }
    }, [scrapingState.taskId, scrapingState.brandName, scrapingState.onComplete, scrapingState.onError, scrapingState.isActive, startPolling]);

    // Start scraping and begin polling - THIS PERSISTS AFTER MODAL CLOSES
    const startScrapingWithTask = useCallback((brandName, taskId, onComplete, onError) => {
        setSuccessData(null);

        setScrapingState({
            isActive: true,
            brandName,
            progress: 5,
            stage: 'Connecting to server...',
            taskId,
            onComplete,
            onError,
            isConnected: true,
            consecutiveErrors: 0,
            lastSuccessfulPoll: Date.now()
        });

        // Start polling
        startPolling(taskId, brandName, onComplete, onError);
    }, [startPolling]);

    // Legacy startScraping for backward compatibility (will be replaced soon)
    const startScraping = (brandName, onComplete, onError, taskId = null) => {
        setSuccessData(null);
        setScrapingState({
            isActive: true,
            brandName,
            progress: 5,
            stage: 'Connecting to Website...',
            taskId: taskId,
            onComplete,
            onError,
            isConnected: true,
            consecutiveErrors: 0,
            lastSuccessfulPoll: Date.now()
        });
    };

    const updateProgress = (progress, stage, brandName = null) => {
        setScrapingState(prev => ({
            ...prev,
            progress,
            stage,
            brandName: brandName || prev.brandName
        }));
    };

    const cancelCurrentScrape = async () => {
        // Stop polling first
        if (pollingRef.current?.clear) {
            pollingRef.current.clear();
            pollingRef.current = null;
        }

        if (scrapingState.taskId) {
            try {
                await fetch(`${API_BASE}/api/tasks/${scrapingState.taskId}`, {
                    method: 'DELETE'
                });
            } catch (e) {
                console.error('Failed to notify server of cancellation:', e);
            }
        }

        setScrapingState({
            isActive: false,
            brandName: '',
            progress: 0,
            stage: '',
            taskId: null,
            onComplete: null,
            onError: null,
            isConnected: true,
            consecutiveErrors: 0,
            lastSuccessfulPoll: null
        });
    };

    const completeScraping = (data) => {
        const callback = scrapingState.onComplete;

        // Show success modal instead of immediately clearing
        setSuccessData({
            brandName: scrapingState.brandName,
            count: data.productCount || 0,
            enriched: data.summary?.enriched || 0
        });

        // Trigger callback but keep success modal open
        if (callback) callback(data);

        setScrapingState(prev => ({ ...prev, isActive: false }));
    };

    const closeSuccessModal = () => {
        setSuccessData(null);
        setScrapingState({
            isActive: false,
            brandName: '',
            progress: 0,
            stage: '',
            taskId: null,
            onComplete: null,
            onError: null,
            isConnected: true,
            consecutiveErrors: 0,
            lastSuccessfulPoll: null
        });
    };

    const failScraping = (error) => {
        const callback = scrapingState.onError;
        setScrapingState(prev => ({ ...prev, isActive: false }));
        if (callback) callback(error);

        // Reset state after failure
        setScrapingState({
            isActive: false,
            brandName: '',
            progress: 0,
            stage: '',
            taskId: null,
            onComplete: null,
            onError: null,
            isConnected: true,
            consecutiveErrors: 0,
            lastSuccessfulPoll: null
        });
    };

    return (
        <ScrapingContext.Provider value={{
            ...scrapingState,
            startScraping,
            startScrapingWithTask,
            updateProgress,
            completeScraping,
            failScraping,
            cancelCurrentScrape,
            refreshConnection
        }}>
            {children}
            {/* Global Floating Progress Bar - Always visible during scraping */}
            <div className={`${styles.scrapingContainer} ${scrapingState.isActive ? styles.active : ''} ${successData ? styles.success : ''} ${!scrapingState.isConnected ? styles.disconnected : ''}`}>
                {scrapingState.isActive && !successData && (
                    <div className={styles.minimizedBarContent}>
                        <div className={`${styles.throbber} ${!scrapingState.isConnected ? styles.paused : ''}`}></div>
                        <div className={styles.progressInfo}>
                            <span className={styles.minimizedText}>
                                {!scrapingState.isConnected && '⚠️ '}
                                Scraping {scrapingState.brandName}... {scrapingState.progress}%
                            </span>
                            <span className={`${styles.minimizedStage} ${!scrapingState.isConnected ? styles.errorStage : ''}`}>
                                {scrapingState.stage}
                            </span>
                        </div>
                        <div className={styles.minimizedProgress}>
                            <div
                                className={`${styles.minimizedProgressFill} ${!scrapingState.isConnected ? styles.disconnectedFill : ''}`}
                                style={{ width: `${scrapingState.progress}%` }}
                            />
                        </div>
                        {/* Refresh Button - Always visible, highlighted when disconnected */}
                        <button
                            className={`${styles.refreshBtn} ${!scrapingState.isConnected ? styles.refreshBtnActive : ''}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                refreshConnection();
                            }}
                            title="Refresh connection"
                        >
                            🔄
                        </button>
                        <button
                            className={styles.cancelScrapeBtn}
                            onClick={(e) => {
                                e.stopPropagation();
                                cancelCurrentScrape();
                            }}
                            title="Cancel Scraping"
                        >
                            ×
                        </button>
                    </div>
                )}

                {/* Success Modal State (Transforms from Bar) */}
                {successData && (
                    <div className={styles.successContent}>
                        <div className={styles.successIcon}>✅</div>
                        <div className={styles.successTitle}>Scraping Complete!</div>
                        <div className={styles.successDetails}>
                            Successfully added <strong>{successData.count}</strong> products to <strong>{successData.brandName}</strong>.
                        </div>
                        <button className={styles.successBtn} onClick={closeSuccessModal}>OK</button>
                    </div>
                )}
            </div>

            {/* Backdrop for Success */}
            {successData && <div className={styles.successBackdrop} onClick={closeSuccessModal} />}
        </ScrapingContext.Provider>
    );
}

export function useScraping() {
    const context = useContext(ScrapingContext);
    if (!context) {
        throw new Error('useScraping must be used within a ScrapingProvider');
    }
    return context;
}

