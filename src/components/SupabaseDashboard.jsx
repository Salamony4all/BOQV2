import { useTheme } from '../context/ThemeContext';

const SupabaseDashboard = ({ isOpen, onClose }) => {
    const { theme } = useTheme();
    const [activeTab, setActiveTab] = useState('assets'); // 'assets' | 'brands'
    const [assets, setAssets] = useState([]);
    const [brands, setBrands] = useState([]);
    const [stats, setStats] = useState({ brands: 0, products: 0, assets: 0 });
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [uploading, setUploading] = useState(false);
    const [syncing, setSyncing] = useState(false);

    useEffect(() => {
        if (isOpen) {
            fetchAll();
        }
    }, [isOpen]);

    const fetchAll = async () => {
        setLoading(true);
        await Promise.all([
            fetchAssets(),
            fetchBrands(),
            fetchStats()
        ]);
        setLoading(false);
    };

    const fetchStats = async () => {
        try {
            const apiBase = getApiBase();
            const response = await fetch(`${apiBase}/api/supabase/stats`);
            const data = await response.json();
            if (data.success) {
                setStats(data);
            }
        } catch (error) {
            console.error('Failed to fetch stats:', error);
        }
    };

    const fetchAssets = async () => {
        try {
            const apiBase = getApiBase();
            const response = await fetch(`${apiBase}/api/blobs`);
            const data = await response.json();
            if (data.success) {
                const sortedAssets = (data.blobs || []).sort((a, b) => 
                    new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0)
                );
                setAssets(sortedAssets);
                setStats(prev => ({ ...prev, assets: sortedAssets.length }));
            }
        } catch (error) {
            console.error('Failed to fetch assets:', error);
        }
    };

    const fetchBrands = async () => {
        try {
            const apiBase = getApiBase();
            const response = await fetch(`${apiBase}/api/supabase/brands`);
            const data = await response.json();
            if (data.success) {
                setBrands(data.brands || []);
            }
        } catch (error) {
            console.error('Failed to fetch brands:', error);
        }
    };

    const handleSync = async () => {
        if (!window.confirm('This will sync all local brands to Supabase. Continue?')) return;
        setSyncing(true);
        try {
            const apiBase = getApiBase();
            const response = await fetch(`${apiBase}/api/supabase/sync`, { method: 'POST' });
            const data = await response.json();
            if (data.success) {
                alert(`Sync Complete! Synced ${data.successCount} brands.`);
                await fetchAll();
            } else {
                alert('Sync failed: ' + data.error);
            }
        } catch (error) {
            console.error('Sync failed:', error);
            alert('Sync failed');
        } finally {
            setSyncing(false);
        }
    };

    const handleDeleteAsset = async (url) => {
        if (!window.confirm('Are you sure you want to delete this file permanently?')) return;
        
        try {
            const apiBase = getApiBase();
            const response = await fetch(`${apiBase}/api/blobs/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            const data = await response.json();
            if (data.success) {
                setAssets(prev => prev.filter(a => a.url !== url));
            }
        } catch (error) {
            console.error('Delete failed:', error);
            alert('Failed to delete file');
        }
    };

    const handleUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setUploading(true);
        const formData = new FormData();
        formData.append('file', file);

        try {
            const apiBase = getApiBase();
            const response = await fetch(`${apiBase}/api/blobs/upload`, {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            if (data.success) {
                await fetchAssets();
            }
        } catch (error) {
            console.error('Upload failed:', error);
            alert('Failed to upload file');
        } finally {
            setUploading(false);
            e.target.value = ''; // Reset input
        }
    };

    const filteredAssets = assets.filter(a => 
        a.pathname.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const filteredBrands = brands.filter(b => 
        b.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const formatSize = (bytes) => {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const isImage = (pathname) => {
        return /\.(jpg|jpeg|png|webp|svg|gif)$/i.test(pathname);
    };

    if (!isOpen) return null;

    return (
        <div className={`${styles.overlay} ${theme === 'light' ? styles.lightOverlay : ''}`} onClick={onClose}>
            <div className={`${styles.container} ${theme === 'light' ? styles.light : ''}`} onClick={e => e.stopPropagation()}>

                <div className={styles.header}>
                    <div className={styles.titleGroup}>
                        <i className={`ri-database-2-line ${styles.icon}`}></i>
                        <h2 className={styles.title}>Supabase Management</h2>
                    </div>
                    <button className={styles.closeBtn} onClick={onClose}>
                        <i className="ri-close-line"></i>
                    </button>
                </div>

                <div className={styles.content}>
                    <div className={styles.tabs}>
                        <button 
                            className={`${styles.tab} ${activeTab === 'assets' ? styles.activeTab : ''}`}
                            onClick={() => setActiveTab('assets')}
                        >
                            <i className="ri-image-line"></i> Storage Assets
                        </button>
                        <button 
                            className={`${styles.tab} ${activeTab === 'brands' ? styles.activeTab : ''}`}
                            onClick={() => setActiveTab('brands')}
                        >
                            <i className="ri-layout-grid-line"></i> Brand Database
                        </button>
                    </div>

                    <div className={styles.actions}>
                        <div className={styles.searchBox}>
                            <i className={`ri-search-line ${styles.searchIcon}`}></i>
                            <input 
                                type="text" 
                                placeholder={`Search ${activeTab}...`} 
                                className={styles.searchInput}
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                            />
                        </div>
                        
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button className={styles.refreshBtn} onClick={fetchAll} title="Refresh All">
                                <i className="ri-refresh-line"></i>
                            </button>
                            {activeTab === 'assets' ? (
                                <label className={styles.uploadBtn}>
                                    <i className={uploading ? "ri-loader-4-line ri-spin" : "ri-upload-cloud-2-line"}></i>
                                    {uploading ? 'Uploading...' : 'Upload Asset'}
                                    <input type="file" hidden onChange={handleUpload} disabled={uploading} />
                                </label>
                            ) : (
                                <button className={`${styles.uploadBtn} ${styles.syncBtn}`} onClick={handleSync} disabled={syncing}>
                                    <i className={syncing ? "ri-loader-4-line ri-spin" : "ri-loop-right-line"}></i>
                                    {syncing ? 'Syncing...' : 'Sync Local to Cloud'}
                                </button>
                            )}
                        </div>
                    </div>

                    <div className={styles.statsGrid}>
                        <div className={styles.statCard}>
                            <span className={styles.statLabel}>Brands</span>
                            <span className={styles.statValue}>{stats.brands}</span>
                        </div>
                        <div className={styles.statCard}>
                            <span className={styles.statLabel}>Products</span>
                            <span className={styles.statValue}>{stats.products}</span>
                        </div>
                        <div className={styles.statCard}>
                            <span className={styles.statLabel}>Files</span>
                            <span className={styles.statValue}>{stats.assets}</span>
                        </div>
                    </div>

                    {loading ? (
                        <div className={styles.loading}>
                            <div className={styles.spinner}></div>
                            <p>Loading {activeTab}...</p>
                        </div>
                    ) : activeTab === 'assets' ? (
                        <div className={styles.assetList}>
                            {filteredAssets.length === 0 ? (
                                <div className={styles.emptyState}>
                                    <i className={`ri-folder-open-line ${styles.emptyIcon}`}></i>
                                    <p>No assets found.</p>
                                </div>
                            ) : filteredAssets.map((asset, idx) => (
                                <div key={idx} className={styles.assetCard}>
                                    <div className={styles.assetPreview}>
                                        {isImage(asset.pathname) ? (
                                            <img src={asset.url} alt="" className={styles.previewImg} loading="lazy" />
                                        ) : (
                                            <i className="ri-database-2-line" style={{ fontSize: '2.5rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}></i>
                                        )}
                                    </div>
                                    <div className={styles.assetInfo}>
                                        <div className={styles.assetName} title={asset.pathname}>
                                            {asset.pathname.split('/').pop()}
                                        </div>
                                        <div className={styles.assetMeta}>
                                            <span>{formatSize(asset.size)}</span>
                                            <span>{new Date(asset.uploadedAt).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                    <div className={styles.assetActions}>
                                        <button className={styles.actionBtnSmall} onClick={() => window.open(asset.url, '_blank')}>
                                            <i className="ri-external-link-line"></i>
                                        </button>
                                        <button className={`${styles.actionBtnSmall} ${styles.deleteBtnSmall}`} onClick={() => handleDeleteAsset(asset.url)}>
                                            <i className="ri-delete-bin-line" style={{ color: 'var(--danger)' }}></i>
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className={styles.brandGrid}>
                            {filteredBrands.length === 0 ? (
                                <div className={styles.emptyState}>
                                    <i className="ri-error-warning-line" style={{ fontSize: '2.5rem', color: 'var(--danger)', marginBottom: '1rem' }}></i>
                                    <p>No brands in cloud database.</p>
                                </div>
                            ) : filteredBrands.map((brand, idx) => (
                                <div key={idx} className={styles.brandCard}>
                                    <div className={styles.brandHeader}>
                                        <img src={brand.logo || 'https://via.placeholder.com/50'} alt="" className={styles.brandLogo} />
                                        <div className={styles.brandTitle}>
                                            <div className={styles.brandName}>{brand.name}</div>
                                            <div className={styles.brandTier}>{brand.budgetTier || 'Mid Range'}</div>
                                        </div>
                                    </div>
                                    <div className={styles.brandStats}>
                                        <div className={styles.brandStatItem}>
                                            <span className={styles.brandStatLabel}>Products</span>
                                            <span className={styles.brandStatValue}>{brand.products?.length || 0}</span>
                                        </div>
                                        <div className={styles.brandStatItem}>
                                            <span className={styles.brandStatLabel}>Source</span>
                                            <span className={styles.brandStatValue}>{brand.source || 'Imported'}</span>
                                        </div>
                                    </div>
                                    <div className={styles.syncStatus}>
                                        <i className="ri-checkbox-circle-line"></i> Cloud Synced
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SupabaseDashboard;
