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
    const [scrapingMethod, setScrapingMethod] = useState('ai');
    const [scraperSource, setScraperSource] = useState('railway'); // 'railway' or 'local'
    const [loading, setLoading] = useState(false);

    // Railway Restore State
    const [railwayFiles, setRailwayFiles] = useState([]);
    const [importingRailway, setImportingRailway] = useState(null);
    const [dashboardUrl, setDashboardUrl] = useState(null);

    // DB Management State
    const [allBrands, setAllBrands] = useState([]);
    const [importingId, setImportingId] = useState(null);
    const [deletingId, setDeletingId] = useState(null);
    const [deletingRailway, setDeletingRailway] = useState(null);
    const [isSupabaseDashboardOpen, setIsSupabaseDashboardOpen] = useState(false);
    const fileInputRef = useRef(null);

    // Global scraping context
    const { isActive: isScrapingActive, startScrapingWithTask, failScraping } = useScraping();

    useEffect(() => {
        fetchBrands();
        fetchRailwayFiles();
        const apiBase = getApiBase();
        fetch(`${apiBase}/api/scraper-config?t=${Date.now()}`)
            .then(r => r.json())
            .then(d => setDashboardUrl(d.dashboardUrl))
            .catch(e => console.error('Config fetch failed', e));
    }, []);

    const fetchRailwayFiles = async () => {
        setRailwayFiles([]);
        try {
            const apiBase = getApiBase();
            const res = await fetch(`${apiBase}/api/railway-brands?t=${Date.now()}`);
            if (res.ok) {
                const data = await res.json();
                if (data.brands && Array.isArray(data.brands)) {
                    setRailwayFiles(data.brands.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt)));
                }
            }
        } catch (err) {
            console.error('Failed to fetch railway backups:', err);
        }
    };

    const handleImportRailway = async (filename) => {
        if (!confirm(`Recover "${filename}" to Supabase? (A backup will be kept on Railway for safety)`)) return;
        setImportingRailway(filename);
        try {
            const apiBase = getApiBase();
            const res = await fetch(`${apiBase}/api/railway-brands/import/${filename}`, { method: 'POST' });
            const data = await res.json();

            if (data.success) {
                alert(`✅ Recovered "${data.brandName}" to Supabase! (Backup preserved on cloud)`);
                fetchBrands();
            } else {
                throw new Error(data.error || 'Unknown error');
            }
        } catch (e) {
            alert(`Recovery Failed: ${e.message}`);
        } finally {
            setImportingRailway(null);
        }
    };

    const handleDeleteRailway = async (filename) => {
        if (!confirm(`Permanently delete cloud backup "${filename}"?`)) return;
        setDeletingRailway(filename);
        try {
            const apiBase = getApiBase();
            const res = await fetch(`${apiBase}/api/railway-brands/${filename}`, { method: 'DELETE' });
            if (res.ok) {
                setRailwayFiles(prev => prev.filter(f => f.filename !== filename));
            } else {
                throw new Error('Delete failed');
            }
        } catch (e) {
            alert(`Delete Failed: ${e.message}`);
        } finally {
            setDeletingRailway(null);
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

    const handleScraping = async (e) => {
        e.preventDefault();
        setLoading(true);

        if (onClose) onClose();

        try {
            const apiBase = getApiBase();
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
                    <div className={styles.title}>➕ Brand Management</div>
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
                    <div className={styles.sectionTitle}>🚀 Add New Brand</div>
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
                            <option value="budgetary">💰 Budgetary</option>
                            <option value="mid">⭐ Mid-Range</option>
                            <option value="high">👑 High-End</option>
                        </select>
                    </div>
                </div>

                <div className={styles.formGroup}>
                    <label className={styles.label}>Scraping Method</label>
                    <select className={styles.select} value={scrapingMethod} onChange={e => setScrapingMethod(e.target.value)}>
                        <option value="ai">🤖 AI Scraper (Intelligent extraction)</option>
                        <option value="scrapling">🧠 Scrapling (Undetectable Python)</option>
                        <option value="requests">🔧 Specialized Scraper (Architonic)</option>
                    </select>
                </div>

                {scrapingMethod === 'requests' && (
                    <div className={styles.formGroup}>
                        <label className={styles.label}>Execution Engine</label>
                        <select className={styles.select} value={scraperSource} onChange={e => setScraperSource(e.target.value)}>
                            <option value="railway">🚂 Railway Service (Recommended)</option>
                            <option value="local">🏠 Local Server (Debug)</option>
                        </select>
                    </div>
                )}

                <div className={styles.actionRow}>
                    <button className={styles.getProductsBtn} onClick={handleScraping} disabled={loading || !name || !website}>
                        {loading ? 'Processing...' : '🔍 Start Harvesting'}
                    </button>
                </div>

                {/* Cloud Recovery */}
                <div className={styles.cloudBackupsHeader}>
                    <div className={styles.cloudBackupsTitle}>
                        <span>☁️ Cloud Backups (Railway)</span>
                        <button 
                            onClick={(e) => { e.preventDefault(); fetchRailwayFiles(); }}
                            className={styles.refreshIconBtn}
                            title="Force Refresh"
                        >
                            🔄
                        </button>
                    </div>
                    {dashboardUrl && (
                        <a href={dashboardUrl} target="_blank" rel="noopener noreferrer" className={styles.externalLink}>
                            🔗 Manage Volume
                        </a>
                    )}
                </div>
                <div className={styles.description}>
                    Restore scraped data from the cloud volume.
                </div>
                <div className={`${styles.brandListContainer} ${styles.cloudList}`}>
                    {(!railwayFiles || railwayFiles.length === 0) ? (
                        <div className={styles.emptyList}>No cloud backups found.</div>
                    ) : (
                        <div className={styles.brandList}>
                            {railwayFiles.map((file) => (
                                <div key={file.filename} className={styles.brandItem}>
                                    <div className={styles.brandInfo}>
                                        <div className={styles.brandNameText}>{file.name || file.filename}</div>
                                        <div className={styles.brandStats}>
                                            {file.productCount || 0} Products • {file.completedAt ? new Date(file.completedAt).toLocaleDateString() : 'N/A'}
                                        </div>
                                    </div>
                                    <div className={styles.brandActions}>
                                        <button
                                            className={`${styles.actionBtn} ${styles.miniUploadBtn}`}
                                            onClick={() => handleImportRailway(file.filename)}
                                            disabled={importingRailway === file.filename || deletingRailway === file.filename}
                                        >
                                            {importingRailway === file.filename ? '⏳' : '📥'} Recover
                                        </button>
                                        <button
                                            className={`${styles.actionBtn} ${styles.miniDeleteBtn}`}
                                            onClick={() => handleDeleteRailway(file.filename)}
                                            disabled={importingRailway === file.filename || deletingRailway === file.filename}
                                        >
                                            {deletingRailway === file.filename ? '...' : '🗑️'}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* DB Management */}
                <div className={styles.excelSectionTitle}>📥 Excel Database Operations</div>
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
                                            📥 Export
                                        </button>
                                        <button className={`${styles.actionBtn} ${styles.miniUploadBtn}`} onClick={() => handleUploadClick(brand.id)}>
                                            📤 {importingId === brand.id ? '...' : 'Import'}
                                        </button>
                                        <button className={`${styles.actionBtn} ${styles.miniDeleteBtn}`} onClick={() => handleDeleteBrand(brand)} disabled={deletingId === brand.id}>
                                            🗑️ {deletingId === brand.id ? '...' : 'Delete'}
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
