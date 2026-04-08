/**
 * BrandSyncPanel Component
 * 
 * Admin panel for syncing local brands database to Vercel Blob storage.
 * Shows sync status and history.
 */

import { useState, useEffect } from 'react';
import styles from '../styles/BlobDashboard.module.css';
import { getApiBase } from '../utils/apiBase';

const BrandSyncPanel = ({ onClose }) => {
  const [syncStatus, setSyncStatus] = useState('idle');
  const [statusData, setStatusData] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [loading, setLoading] = useState(true);

  const API_BASE = getApiBase();

  // Fetch initial sync status
  useEffect(() => {
    fetchSyncStatus();
  }, []);

  const fetchSyncStatus = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/brands/sync/status`);
      const data = await res.json();
      setStatusData(data);
    } catch (err) {
      console.error('Failed to fetch sync status:', err);
    } finally {
      setLoading(false);
    }
  };

  const triggerSync = async () => {
    try {
      setSyncStatus('syncing');
      setSyncResult(null);

      const res = await fetch(`${API_BASE}/api/brands/sync/to-blob`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await res.json();

      if (!res.ok) {
        setSyncStatus('error');
        setSyncResult({ status: 'error', message: data.error });
        return;
      }

      setSyncStatus('success');
      setSyncResult(data);
      
      // Refresh status after sync
      setTimeout(() => fetchSyncStatus(), 1000);
    } catch (err) {
      setSyncStatus('error');
      setSyncResult({ status: 'error', message: err.message });
    }
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button onClick={onClose} className={styles.backBtn} title="Back">←</button>
          <h1 className={styles.title}>Brands Database Sync</h1>
        </div>
        <button 
          onClick={onClose}
          className={styles.refreshBtn}
          title="Close"
        >
          ✕
        </button>
      </header>

      {loading ? (
        <div className={styles.loading}>Loading sync status...</div>
      ) : (
        <>
          {/* Status Card */}
          {statusData && (
            <div style={{ padding: '2rem' }}>
              <div style={{ marginBottom: '2rem', padding: '1rem', backgroundColor: '#1a1f3a', borderRadius: '8px', border: '1px solid #444' }}>
                <h2 style={{ marginTop: 0, color: '#fff' }}>📦 Storage Status</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
                  <div>
                    <div style={{ color: '#888', fontSize: '0.9rem' }}>Local Brands</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#4ade80' }}>
                      {statusData.localCount || 0}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#888', fontSize: '0.9rem' }}>Blob Storage</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: statusData.synced ? '#4ade80' : '#f97316' }}>
                      {statusData.blobCount || 0}
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: '1rem', padding: '0.5rem', backgroundColor: statusData.synced ? '#065f46' : '#7c2d12', borderRadius: '4px', color: statusData.synced ? '#86efac' : '#fed7aa' }}>
                  {statusData.synced ? '✅ Database is synced' : '⚠️ Database is out of sync'}
                </div>
              </div>

              {/* Sync Button */}
              <button
                onClick={triggerSync}
                disabled={syncStatus === 'syncing'}
                style={{
                  padding: '0.75rem 1.5rem',
                  fontSize: '1rem',
                  backgroundColor: syncStatus === 'syncing' ? '#666' : '#3b82f6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: syncStatus === 'syncing' ? 'not-allowed' : 'pointer',
                  marginBottom: '2rem'
                }}
              >
                {syncStatus === 'syncing' ? '⏳ Syncing...' : '🔄 Sync Now'}
              </button>

              {/* Sync Result */}
              {syncResult && (
                <div style={{
                  padding: '1rem',
                  backgroundColor: syncStatus === 'success' ? '#065f46' : '#7c2d12',
                  color: syncStatus === 'success' ? '#86efac' : '#fed7aa',
                  borderRadius: '6px',
                  marginTop: '1rem'
                }}>
                  <h3 style={{ marginTop: 0 }}>
                    {syncStatus === 'success' ? '✅ Sync Successful' : '❌ Sync Failed'}
                  </h3>
                  <p>{syncResult.message || syncResult.error}</p>
                  {syncResult.synced !== undefined && (
                    <p>Synced: {syncResult.synced}/{syncResult.total} files</p>
                  )}
                </div>
              )}

              {/* Blob Files List (if available) */}
              {statusData.blobs && statusData.blobs.length > 0 && (
                <div style={{ marginTop: '2rem' }}>
                  <h3 style={{ color: '#fff' }}>📋 Synced Brand Files</h3>
                  <div style={{ overflowY: 'auto', maxHeight: '300px' }}>
                    {statusData.blobs.map((blob, idx) => (
                      <div key={idx} style={{
                        padding: '0.75rem',
                        backgroundColor: '#1a1f3a',
                        borderBottom: '1px solid #333',
                        fontSize: '0.9rem',
                        color: '#bbb'
                      }}>
                        <div style={{ fontWeight: 'bold', color: '#fff' }}>
                          {blob.pathname.replace('brands-db/', '')}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: '#888' }}>
                          {(blob.size / 1024).toFixed(2)} KB
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default BrandSyncPanel;
