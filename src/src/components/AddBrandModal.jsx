import { useState, useEffect, useRef } from 'react';
import styles from '../styles/AddBrandModal.module.css';
import { useScraping } from '../context/ScrapingContext';

const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:3001' : '';

export default function AddBrandModal({ isOpen, onClose, onBrandAdded, onBrandUpdated }) {
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
    const fileInputRef = useRef(null);

    // Global scraping context - polling is handled by context, not this component
    const { isActive: isScrapingActive, startScrapingWithTask, failScraping } = useScraping();

    useEffect(() => {
        if (isOpen) {
            fetchBrands();
            fetchRailwayFiles();
            fetch(`${API_BASE}/api/scraper-config`)
                .then(r => r.json())
                .then(d => setDashboardUrl(d.dashboardUrl))
                .catch(e => console.error('Config fetch failed', e));
        }
    }, [isOpen]);

    const fetchRailwayFiles = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/railway-brands`);
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
        if (!confirm(`Recover "${filename}" into local storage? (This will move it from the cloud)`)) return;
        setImportingRailway(filename);
        try {
            // 1. Import
            const res = await fetch(`${API_BASE}/api/railway-brands/import/${filename}`, { method: 'POST' });
            const data = await res.json();

            if (data.success) {
                // 2. Delete from Railway (Move operation)
                await fetch(`${API_BASE}/api/railway-brands/${filename}`, { method: 'DELETE' });

                alert(`✅ Moved "${data.brandName}" to local storage!`);
                fetchBrands();
                setRailwayFiles(prev => prev.filter(f => f.filename !== filename));
            } else {
                throw new Error(data.error || 'Unknown error');
            }
        } catch (e) {
            alert(`Recovery Failed: ${e.message}`);
        } finally {
            setImportingRailway(null);
        }
    };

    const fetchBrands = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/brands`);
            const data = await res.json();
            if (Array.isArray(data)) {
                setAllBrands(data.sort((a, b) => a.name.localeCompare(b.name)));
            }
        } catch (err) {
            console.error('Failed to fetch brands:', err);
        }
    };

    if (!isOpen) return null;

    const handleScraping = async (e) => {
        e.preventDefault();
        setLoading(true);

        // Close the modal immediately - scraping continues in background
        onClose();

        try {
            let endpoint;
            if (scrapingMethod === 'ai') endpoint = `${API_BASE}/api/scrape-ai`;
            else if (scrapingMethod === 'scrapling') endpoint = `${API_BASE}/api/scrape-scrapling`;
            else endpoint = `${API_BASE}/api/scrape-brand`;

            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, url: website, origin, budgetTier, scraperSource })
            });

            if (!res.ok) throw new Error('Failed to start scraping');
            const startData = await res.json();
            const taskId = startData.taskId;

            // Start scraping with task - CONTEXT handles polling, not this component!
            // This means scraping continues even after modal is closed
            startScrapingWithTask(name, taskId, (data) => {
                // On complete callback
                if (data.success !== false) {
                    onBrandAdded(data.brand || data);
                    fetchBrands(); // Refresh list
                }
            }, (error) => {
                // On error callback
                console.error('Scraping failed:', error.message);
            });

            setLoading(false);

        } catch (error) {
            console.error('Scraping Error:', error);
            setLoading(false);
            failScraping(error);
        }
    };

    const handleDownloadDB = (brandId) => {
        window.open(`${API_BASE}/api/brands/${brandId}/export`, '_blank');
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
            const res = await fetch(`${API_BASE}/api/brands/${importingId}/import`, {
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
            e.target.value = ''; // Reset input
        }
    };

    const handleDeleteBrand = async (brand) => {
        const confirmed = window.confirm(
            `Are you sure you want to delete "${brand.name}"?\n\nThis will permanently remove the brand and all ${brand.products?.length || 0} products. This action cannot be undone.`
        );

        if (!confirmed) return;

        setDeletingId(brand.id);

        try {
            const res = await fetch(`${API_BASE}/api/brands/${brand.id}`, {
                method: 'DELETE'
            });
            const data = await res.json();

            if (data.success) {
                alert(`"${brand.name}" has been deleted successfully.`);
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
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
                <div className={styles.header}>
                    <div className={styles.title}>➕ Brand Management</div>
                    <button className={styles.closeBtn} onClick={onClose}>×</button>
                </div>

                <div className={styles.content}>
                    {/* Add Brand Section */}
                    <div className={styles.sectionTitle}>🚀 Add New Brand</div>
                    <div className={styles.description}>
                        Enter brand website or Architonic collection link to scrape products automatically.
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
                            <option value="ai">🤖 AI Scraper (Intelligent extraction for any site)</option>
                            <option value="scrapling">🧠 Scrapling (Undetectable Python Engine)</option>
                            <option value="requests">🔧 Specialized Scraper (Optimized for Architonic)</option>
                        </select>
                    </div>

                    {/* NEW: Scraper Source Selection (Only for Specialized Scraper) */}
                    {scrapingMethod === 'requests' && (
                        <div className={styles.formGroup}>
                            <label className={styles.label}>Execution Engine</label>
                            <select
                                className={styles.select}
                                value={scraperSource}
                                onChange={e => setScraperSource(e.target.value)}
                            >
                                <option value="railway">🚂 Railway Service (Recommended - Stable)</option>
                                <option value="local">🏠 Local Server (Testing/Debug)</option>
                            </select>
                        </div>
                    )}
                </div>

                <div className={styles.actionRow}>
                    <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
                    <button className={styles.getProductsBtn} onClick={handleScraping} disabled={loading || !name || !website}>
                        {loading ? 'Processing...' : '🔍 Start Harvesting'}
                    </button>
                </div>



                {/* Cloud Recovery */}
                <div className={styles.sectionTitle} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>☁️ Cloud Backups (Railway)</span>
                    {dashboardUrl && (
                        <a href={dashboardUrl} target="_blank" rel="noopener noreferrer"
                            style={{ fontSize: '12px', background: '#334155', color: 'white', padding: '4px 8px', borderRadius: '4px', textDecoration: 'none', border: '1px solid #475569' }}>
                            🔗 Manage Volume
                        </a>
                    )}
                </div>
                <div className={styles.description}>
                    Restore scraped data that is safely saved in the cloud (persistent volume).
                </div>
                <div className={`${styles.brandListContainer} ${styles.cloudList}`} style={{ marginBottom: '25px', maxHeight: '150px' }}>
                    {railwayFiles.length === 0 ? (
                        <div className={styles.emptyList}>No cloud backups found.</div>
                    ) : (
                        <div className={styles.brandList}>
                            {railwayFiles.map(file => (
                                <div key={file.filename} className={styles.brandItem} style={{ background: '#1e293b' }}>
                                    <div className={styles.brandInfo}>
                                        <div className={styles.brandNameText} style={{ color: '#93c5fd' }}>{file.name || file.filename}</div>
                                        <div className={styles.brandStats} style={{ color: '#64748b' }}>
                                            {file.productCount} Products • {new Date(file.completedAt).toLocaleDateString()}
                                        </div>
                                    </div>
                                    <div className={styles.brandActions}>
                                        <button
                                            className={`${styles.actionBtn} ${styles.miniUploadBtn}`}
                                            onClick={() => handleImportRailway(file.filename)}
                                            disabled={importingRailway === file.filename}
                                            style={{ background: '#3b82f6', color: 'white' }}
                                            title="Import to Local DB"
                                        >
                                            {importingRailway === file.filename ? '⏳' : '📥 Recover'}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>


                {/* DB Management */}
                <div className={styles.sectionTitle}>📥 Excel Database Operations</div>
                <div className={styles.description}>
                    Bulk update brand products using the Excel interface.
                </div>

                <div className={styles.brandListContainer} style={{ maxHeight: '500px', minHeight: '200px', overflowY: 'auto', border: '1px solid #334155', borderRadius: '6px', padding: '5px' }}>
                    {allBrands.length === 0 ? (
                        <div className={styles.emptyList}>No brands found. Add one above to manage its database.</div>
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
                                        <button
                                            className={`${styles.actionBtn} ${styles.miniDownloadBtn}`}
                                            onClick={() => handleDownloadDB(brand.id)}
                                            title="Download Excel"
                                        >
                                            📥 Export
                                        </button>
                                        <button
                                            className={`${styles.actionBtn} ${styles.miniUploadBtn}`}
                                            onClick={() => handleUploadClick(brand.id)}
                                            title="Upload Excel"
                                        >
                                            📤 {(importingId === brand.id) ? '...' : 'Import'}
                                        </button>
                                        <button
                                            className={`${styles.actionBtn} ${styles.miniDeleteBtn}`}
                                            onClick={() => handleDeleteBrand(brand)}
                                            title="Delete Brand"
                                            disabled={deletingId === brand.id}
                                        >
                                            🗑️ {(deletingId === brand.id) ? '...' : 'Delete'}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <input
                    type="file"
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    accept=".xlsx, .xls"
                    onChange={handleFileChange}
                />
            </div>
        </div>

    );
}
