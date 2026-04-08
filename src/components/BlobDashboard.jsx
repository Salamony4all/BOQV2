import React, { useState, useEffect } from 'react';
import styles from '../styles/BlobDashboard.module.css';

const BlobDashboard = ({ isOpen, onClose }) => {
    const [blobs, setBlobs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [uploading, setUploading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            fetchBlobs();
        }
    }, [isOpen]);

    const fetchBlobs = async () => {
        setLoading(true);
        try {
            const response = await fetch('http://localhost:3001/api/blobs');
            const data = await response.json();
            if (data.success) {
                // Sort by date created (descending) if available
                const sortedBlobs = (data.blobs || []).sort((a, b) => 
                    new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0)
                );
                setBlobs(sortedBlobs);
            }
        } catch (error) {
            console.error('Failed to fetch blobs:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (url) => {
        if (!window.confirm('Are you sure you want to delete this file permanently?')) return;
        
        try {
            const response = await fetch('http://localhost:3001/api/blobs/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            const data = await response.json();
            if (data.success) {
                setBlobs(prev => prev.filter(b => b.url !== url));
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
            const response = await fetch('http://localhost:3001/api/blobs/upload', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            if (data.success) {
                await fetchBlobs();
            }
        } catch (error) {
            console.error('Upload failed:', error);
            alert('Failed to upload file');
        } finally {
            setUploading(false);
            e.target.value = ''; // Reset input
        }
    };

    const filteredBlobs = blobs.filter(b => 
        b.pathname.toLowerCase().includes(searchTerm.toLowerCase())
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
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.container} onClick={e => e.stopPropagation()}>
                <div className={styles.header}>
                    <div className={styles.titleGroup}>
                        <i className={`ri-database-2-line ${styles.icon}`}></i>
                        <h2 className={styles.title}>Blob Asset Dashboard</h2>
                    </div>
                    <button className={styles.closeBtn} onClick={onClose}>
                        <i className="ri-close-line"></i>
                    </button>
                </div>

                <div className={styles.content}>
                    <div className={styles.actions}>
                        <div className={styles.searchBox}>
                            <i className={`ri-search-line ${styles.searchIcon}`}></i>
                            <input 
                                type="text" 
                                placeholder="Search assets..." 
                                className={styles.searchInput}
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                            />
                        </div>
                        
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button className={styles.refreshBtn} onClick={fetchBlobs} title="Refresh List">
                                <i className="ri-refresh-line"></i>
                            </button>
                            <label className={styles.uploadBtn}>
                                <i className={uploading ? "ri-loader-4-line ri-spin" : "ri-upload-cloud-2-line"}></i>
                                {uploading ? 'Uploading...' : 'Upload Asset'}
                                <input type="file" hidden onChange={handleUpload} disabled={uploading} />
                            </label>
                        </div>
                    </div>

                    <div className={styles.stats}>
                        <div className={styles.statItem}>
                            <span className={styles.statLabel}>Total Files</span>
                            <span className={styles.statValue}>{blobs.length}</span>
                        </div>
                        <div className={styles.statItem}>
                            <span className={styles.statLabel}>Storage Used</span>
                            <span className={styles.statValue}>
                                {formatSize(blobs.reduce((acc, curr) => acc + (curr.size || 0), 0))}
                            </span>
                        </div>
                        <div className={styles.statItem}>
                            <span className={styles.statLabel}>Provider</span>
                            <span className={styles.statValue}>Vercel Blob</span>
                        </div>
                    </div>

                    {loading ? (
                        <div className={styles.loading}>
                            <div className={styles.spinner}></div>
                            <p>Loading assets...</p>
                        </div>
                    ) : filteredBlobs.length === 0 ? (
                        <div className={styles.emptyState}>
                            <i className={`ri-folder-open-line ${styles.emptyIcon}`}></i>
                            <p>{searchTerm ? 'No results found.' : 'No assets in storage.'}</p>
                        </div>
                    ) : (
                        <div className={styles.blobList}>
                            {filteredBlobs.map((blob, idx) => (
                                <div key={idx} className={styles.blobCard}>
                                    <div className={styles.blobPreview}>
                                        {isImage(blob.pathname) ? (
                                            <img src={blob.url} alt="" className={styles.previewImg} loading="lazy" />
                                        ) : (
                                            <i className={`ri-file-text-line ${styles.fileIcon}`}></i>
                                        )}
                                    </div>
                                    <div className={styles.blobInfo}>
                                        <div className={styles.blobName} title={blob.pathname}>
                                            {blob.pathname.split('/').pop()}
                                        </div>
                                        <div className={styles.blobMeta}>
                                            <span>{formatSize(blob.size)}</span>
                                            <span>{new Date(blob.uploadedAt).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                    <div className={styles.blobActions}>
                                        <button 
                                            className={styles.actionBtnSmall} 
                                            onClick={() => window.open(blob.url, '_blank')}
                                        >
                                            <i className="ri-external-link-line"></i> Preview
                                        </button>
                                        <button 
                                            className={`${styles.actionBtnSmall} ${styles.deleteBtnSmall}`}
                                            onClick={() => handleDelete(blob.url)}
                                        >
                                            <i className="ri-delete-bin-line"></i>
                                        </button>
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

export default BlobDashboard;
