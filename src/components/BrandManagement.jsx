import { useState, useEffect, useRef } from 'react';
import styles from '../styles/BrandManagement.module.css';
import { useScraping } from '../context/ScrapingContext';
import { getApiBase } from '../utils/apiBase';
import SupabaseDashboard from './SupabaseDashboard';

export default function BrandManagement({ onBrandAdded, onBrandUpdated, onClose, isStandalone = false }) {
    const [name, setName] = useState('');
    const [website, setWebsite] = useState('');
    const [origin, setOrigin] = useState('');
    const [budgetTier, setBudgetTier] = useState('mid');
    const [scrapingMethod, setScrapingMethod] = useState('standard');
    const [scrapingEngine, setScrapingEngine] = useState('supabase'); // 'supabase' native engine
    const [scraperSource] = useState('supabase');
    const [loading, setLoading] = useState(false);

    // Supabase Native Queue State
    const [queueJobs, setQueueJobs] = useState([]);

    // DB Management State
    const [allBrands, setAllBrands] = useState([]);
    const [importingId, setImportingId] = useState(null);
    const [deletingId, setDeletingId] = useState(null);
    const [isSupabaseDashboardOpen, setIsSupabaseDashboardOpen] = useState(false);
    const fileInputRef = useRef(null);

    // Global scraping context
    const { 
        isActive: isScrapingActive, 
        startScraping, 
        startScrapingWithTask, 
        updateProgress, 
        completeScraping, 
        failScraping 
    } = useScraping();

    useEffect(() => {
        fetchBrands();
        fetchQueueJobs();
    }, []);

    const fetchQueueJobs = async () => {
        try {
            const apiBase = getApiBase();
            const res = await fetch(`${apiBase}/api/supabase-jobs?limit=20&t=${Date.now()}`);
            if (res.ok) {
                const data = await res.json();
                if (data.jobs && Array.isArray(data.jobs)) {
                    setQueueJobs(data.jobs);
                }
            }
        } catch (err) {
            console.error('Failed to fetch Supabase scrape queue:', err);
        }
    };

    const fetchBrands = async () => {
        try {
            const apiBase = getApiBase();
            const res = await fetch(`${apiBase}/api/brands`);
            const data = await res.json();
            if (Array.isArray(data)) {
                setAllBrands(data.sort((a, b) => a.name.localeCompare(b.name)));
            }
        } catch (err) {
            console.error('Failed to fetch brands:', err);
        }
    };

    const handleEngineChange = (engine) => {
        setScrapingEngine(engine);
        if (engine === 'js') {
            setScrapingMethod('standard');
        } else {
            setScrapingMethod('py_universal');
        }
    };

    const handleScraping = async (e) => {
        e.preventDefault();
        setLoading(true);

        if (onClose) onClose();

        try {
            const apiBase = getApiBase();
            
            // Check if using the new strategy-based scraping endpoints
            const isStrategyBased = ['py_universal', 'py_architonic', 'py_requests', 'italian', 'firecrawl'].includes(scrapingMethod);
            
            if (isStrategyBased) {
                // Use new unified strategy sync
                // Start progress bar in frontend context
                startScraping(name, (data) => {
                    if (data.success !== false) {
                        if (onBrandAdded) onBrandAdded(data.brand || data);
                        fetchBrands();
                    }
                }, (error) => {
                    console.error('Scraping failed:', error.message);
                });
                
                const strategyValue = scrapingMethod === 'py_universal' ? 'universal' : 
                                      scrapingMethod === 'py_architonic' ? 'architonic' : 
                                      scrapingMethod === 'py_requests' ? 'requests' : 
                                      scrapingMethod;
                
                updateProgress(15, `Initializing strategy: ${strategyValue}...`);
                
                const res = await fetch(`${apiBase}/api/brands/sync`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        brandName: name,
                        website,
                        syncStrategy: strategyValue,
                        origin,
                        budgetTier
                    })
                });
                
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    throw new Error(errData.error || `Failed scraping with strategy ${strategyValue}`);
                }
                
                const data = await res.json();
                updateProgress(90, 'Saving brand & finalizing products...');
                completeScraping(data);
            } else {
                // Legacy Scraping Methods (ai, scrapling, requests/standard)
                let endpoint;
                if (scrapingMethod === 'ai') endpoint = `${apiBase}/api/scrape-ai`;
                else if (scrapingMethod === 'scrapling') endpoint = `${apiBase}/api/scrape-scrapling`;
                else endpoint = `${apiBase}/api/scrape-brand`;

                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, url: website, origin, budgetTier, scraperSource })
                });

                if (!res.ok) throw new Error('Failed to start scraping');
                const startData = await res.json();
                const taskId = startData.taskId;

                startScrapingWithTask(name, taskId, (data) => {
                    if (data.success !== false) {
                        if (onBrandAdded) onBrandAdded(data.brand || data);
                        fetchBrands();
                    }
                }, (error) => {
                    console.error('Scraping failed:', error.message);
                });
            }

            setLoading(false);
            // Reset form
            setName('');
            setWebsite('');
            setOrigin('');
        } catch (error) {
            console.error('Scraping Error:', error);
            setLoading(false);
            failScraping(error);
        }
    };

    const handleDownloadDB = (brandId) => {
        const apiBase = getApiBase();
        window.open(`${apiBase}/api/brands/${brandId}/export`, '_blank');
    };

    const handleUploadClick = (brandId) => {
        setImportingId(brandId);
        if (fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file || !importingId) return;

        const formData = new FormData();
        formData.append('file', file);

        try {
            const apiBase = getApiBase();
            const res = await fetch(`${apiBase}/api/brands/${importingId}/import`, {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (data.success) {
                alert(`Database for brand updated successfully! (${data.count} products)`);
                fetchBrands();
                if (onBrandUpdated) onBrandUpdated();
            } else {
                throw new Error(data.error || 'Update failed');
            }
        } catch (e) {
            console.error('Import error:', e);
            alert("Upload failed: " + e.message);
        } finally {
            setImportingId(null);
            e.target.value = '';
        }
    };

    const handleDeleteBrand = async (brand) => {
        const confirmed = window.confirm(
            `Are you sure you want to delete "${brand.name}"?\n\nThis will permanently remove the brand and all ${brand.products?.length || 0} products. This action cannot be undone.`
        );

        if (!confirmed) return;

        setDeletingId(brand.id);

        try {
            const apiBase = getApiBase();
            const res = await fetch(`${apiBase}/api/brands/${brand.id}`, {
                method: 'DELETE'
            });
            const data = await res.json();

            if (data.success) {
                // Immediately remove from local UI state (optimistic update)
                setAllBrands(prev => prev.filter(b => String(b.id) !== String(brand.id)));
                alert(`"${brand.name}" has been deleted successfully.`);
                // Also trigger a full refresh from server as backup
                fetchBrands();
                if (onBrandUpdated) onBrandUpdated();
            } else {
                throw new Error(data.error || 'Delete failed');
            }
        } catch (e) {
            console.error('Delete error:', e);
            alert('Failed to delete brand: ' + e.message);
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div className={`${styles.container} ${isStandalone ? styles.standalone : ''}`}>
            {!isStandalone && (
                <div className={styles.header}>
                    <div className={styles.title}> Brand Management</div>
                    <div className={styles.headerActions}>
                        <button className={styles.supabaseDbBtn} onClick={() => setIsSupabaseDashboardOpen(true)}>
                            <i className="ri-database-2-line"></i>
                            <span>Supabase DB</span>
                        </button>
                        {onClose && <button className={styles.closeBtn} onClick={onClose}>×</button>}
                    </div>
                </div>
            )}

            <div className={styles.content}>
                {/* Add Brand Section */}
                <div className={styles.sectionHeader}>
                    <div className={styles.sectionTitle}> Add New Brand</div>
                    {isStandalone && (
                        <button className={styles.supabaseDbBtn} onClick={() => setIsSupabaseDashboardOpen(true)}>
                            <i className="ri-database-2-line"></i>
                            <span>Supabase DB</span>
                        </button>
                    )}
                </div>
                
                <div className={styles.description}>
                    Enter brand website or Architonic link to scrape products automatically.
                </div>

                <div className={styles.formGrid}>
                    <div className={styles.formGroup}>
                        <label className={styles.label}>Brand Name *</label>
                        <input className={styles.input} value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Herman Miller" />
                    </div>

                    <div className={styles.formGroup}>
                        <label className={styles.label}>Website / Architonic Link *</label>
                        <input className={styles.input} value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://..." />
                    </div>

                    <div className={styles.formGroup}>
                        <label className={styles.label}>Origin</label>
                        <input className={styles.input} value={origin} onChange={e => setOrigin(e.target.value)} placeholder="e.g., USA" />
                    </div>

                    <div className={styles.formGroup}>
                        <label className={styles.label}>Budget Tier</label>
                        <select className={styles.select} value={budgetTier} onChange={e => setBudgetTier(e.target.value)}>
                            <option value="budgetary"> Budgetary</option>
                            <option value="mid"> Mid-Range</option>
                            <option value="high"> High-End</option>
                        </select>
                    </div>
                </div>

                <div className={styles.engineContainer}>
                    <div className={styles.formGroup} style={{ marginBottom: '1.25rem' }}>
                        <label className={styles.label}>Scraping Engine</label>
                        <div className={styles.engineSelector}>
                            <button
                                type="button"
                                className={`${styles.engineBtn} ${styles.activeEngine}`}
                                onClick={() => handleEngineChange('supabase')}
                            >
                                <span className={styles.engineIcon}></span>
                                <div className={styles.engineInfo}>
                                    <span className={styles.engineName}>Supabase Native Engine</span>
                                    <span className={styles.engineDesc}>Sitemap + JSON-LD + Browserless + Storage Mirror</span>
                                </div>
                            </button>
                        </div>
                    </div>

                    <div className={styles.formGroup} style={{ marginBottom: '0.75rem' }}>
                        <label className={styles.label}>Harvest Strategy</label>
                        <select 
                            className={styles.select} 
                            value={scrapingMethod} 
                            onChange={e => setScrapingMethod(e.target.value)}
                        >
                            <option value="standard">Supabase Native (Sitemap + JSON-LD + Browserless)</option>
                            <option value="architonic">Architonic / Official Hybrid Discovery</option>
                            <option value="py_universal">Fast Sync (Queued Immediate)</option>
                        </select>
                    </div>
                </div>

                <div className={styles.actionRow}>
                    <button className={styles.getProductsBtn} onClick={handleScraping} disabled={loading || !name || !website}>
                        {loading ? 'Processing...' : 'Start Harvesting to Supabase'}
                    </button>
                </div>

                {/* Supabase Scrape Queue */}
                <div className={styles.cloudBackupsHeader}>
                    <div className={styles.cloudBackupsTitle}>
                        <span>Supabase Scrape &amp; Enrichment Queue</span>
                        <button 
                            onClick={(e) => { e.preventDefault(); fetchQueueJobs(); }}
                            className={styles.refreshIconBtn}
                            title="Refresh Queue"
                            aria-label="Refresh Supabase Scrape Queue"
                        >
                            ↻
                        </button>
                    </div>
                    <button type="button" className={styles.externalLink} onClick={() => setIsSupabaseDashboardOpen(true)}>
                        Open Supabase Hub
                    </button>
                </div>
                <div className={styles.description}>
                    Async brand enrichment and catalog harvest jobs stored in Supabase.
                </div>
                <div className={`${styles.brandListContainer} ${styles.cloudList}`}>
                    {(!queueJobs || queueJobs.length === 0) ? (
                        <div className={styles.emptyList}>No recent scrape jobs in queue.</div>
                    ) : (
                        <div className={styles.brandList}>
                            {queueJobs.map((job) => (
                                <div key={job.id} className={styles.brandItem}>
                                    <div className={styles.brandInfo}>
                                        <div className={styles.brandNameText}>{job.brand_name || job.job_type}</div>
                                        <div className={styles.brandStats}>
                                            {job.status?.toUpperCase()} ({job.progress || 0}%) • {job.job_type} • {job.created_at ? new Date(job.created_at).toLocaleDateString() : ''}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* DB Management */}
                <div className={styles.excelSectionTitle}> Excel Database Operations</div>
                <div className={styles.description}>Bulk update products using Excel.</div>

                <div className={styles.brandListScrollContainer}>
                    {allBrands.length === 0 ? (
                        <div className={styles.emptyList}>No brands found.</div>
                    ) : (
                        <div className={styles.brandList}>
                            {allBrands.map(brand => (
                                <div key={brand.id} className={styles.brandItem}>
                                    <div className={styles.brandInfo}>
                                        <div className={styles.brandNameText}>{brand.name}</div>
                                        <div className={styles.brandStats}>
                                            {brand.products?.length || 0} Products • {brand.budgetTier}
                                        </div>
                                    </div>
                                    <div className={styles.brandActions}>
                                        <button className={`${styles.actionBtn} ${styles.miniDownloadBtn}`} onClick={() => handleDownloadDB(brand.id)}>
                                             Export
                                        </button>
                                        <button className={`${styles.actionBtn} ${styles.miniUploadBtn}`} onClick={() => handleUploadClick(brand.id)}>
                                             {importingId === brand.id ? '...' : 'Import'}
                                        </button>
                                        <button className={`${styles.actionBtn} ${styles.miniDeleteBtn}`} onClick={() => handleDeleteBrand(brand)} disabled={deletingId === brand.id}>
                                             {deletingId === brand.id ? '...' : 'Delete'}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".xlsx, .xls" onChange={handleFileChange} />

            <SupabaseDashboard isOpen={isSupabaseDashboardOpen} onClose={() => setIsSupabaseDashboardOpen(false)} />
        </div>
    );
}
