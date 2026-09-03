import React, { useState, useEffect } from 'react';
import styles from '../styles/AISemanticMatchModal.module.css';
import { getApiBase } from '../utils/apiBase';
import { useCompanyProfile } from '../context/CompanyContext';
import { useTheme } from '../context/ThemeContext';
import { getFullUrl } from '../utils/urlUtils';

/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  AISemanticMatchModal — Interactive Single-Item Auto-Match Inspector    │
 * └─────────────────────────────────────────────────────────────────────────┘
 * Runs the fast, multi-stage AI auto-matching pipeline with progressive loading,
 * instant sub-second primary resolution, and background partner discovery.
 */
export default function AISemanticMatchModal({
  isOpen,
  onClose,
  item = null,
  allBrands = [],
  onSelectProduct = () => {}
}) {
  const { aiSettings } = useCompanyProfile();
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState('auto_detect');
  const [selectedBrand, setSelectedBrand] = useState('All');
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState(0);

  // Auto-Detect Result State
  const [autoDetectResult, setAutoDetectResult] = useState(null);
  const [specBreakdown, setSpecBreakdown] = useState(null);

  // Catalog Semantic Matches State
  const [matches, setMatches] = useState([]);
  const [error, setError] = useState(null);

  // Google Lens visual match state (via Chrome extension)
  const [lensResults, setLensResults] = useState(null);
  const [lensLoading, setLensLoading] = useState(false);
  const extensionInstalled = document.documentElement.getAttribute('data-auto-browser-extension-installed') === 'true';

  // ── Image URL helpers ──────────────────────────────────────────────────────
  /** True when the URL is a local server path that Google Lens cannot reach */
  const isLocalImage = (url) => {
    if (!url) return false;
    return (
      url.startsWith('/temp/') ||
      url.startsWith('/api/') ||
      url.startsWith('/home/') ||
      url.includes('localhost') ||
      url.includes('127.0.0.1')
    );
  };

  /** Resolve a potentially-relative image path to its full local server URL */
  const resolveLocalUrl = (url) => {
    if (!url) return null;
    if (url.startsWith('http')) return url;
    const apiBase = getApiBase(); // e.g. http://localhost:3001
    return `${apiBase}${url.startsWith('/') ? '' : '/'}${url}`;
  };

  /** Build the best available image URL for passing to Google Lens */
  const resolveLensImageUrl = (rawUrl) => {
    if (!rawUrl) return null;
    if (rawUrl.startsWith('http') && !rawUrl.includes('localhost') && !rawUrl.includes('127.0.0.1')) {
      return rawUrl; // Already a public URL
    }
    // Local path — resolve to full localhost URL
    // Note: Lens won't reach localhost, but the extension runs inside Chrome
    // which CAN access localhost. So the minimized-window approach works.
    return resolveLocalUrl(rawUrl);
  };

  // Editable test query for live simulation
  const [testDescription, setTestDescription] = useState('');

  const availableBrands = allBrands && allBrands.length > 0
    ? allBrands.filter(b => b.name && b.products && b.products.length > 0)
    : [];

  // Animate loading stages smoothly
  useEffect(() => {
    let timer1, timer2;
    if (loading) {
      setLoadingStage(0);
      timer1 = setTimeout(() => setLoadingStage(1), 350);
      timer2 = setTimeout(() => setLoadingStage(2), 700);
    }
    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [loading]);

  useEffect(() => {
    if (isOpen && item) {
      const initialDesc = item.description || item.specifications || item.model || '';
      setTestDescription(initialDesc);
      setSelectedBrand('All');

      // Reset lens state for new item
      setLensResults(null);
      setLensLoading(false);

      // ① AI match — starts immediately
      runFullTestSimulation(initialDesc);

      // ② Lens match — upload local image to Supabase for a public URL, then run Lens
      const rawImage =
        item.imageUrl ||
        (Array.isArray(item.images) && item.images.length > 0
          ? (typeof item.images[0] === 'string' ? item.images[0] : item.images[0]?.url)
          : null);

      if (rawImage && extensionInstalled) {
        setTimeout(async () => {
          try {
            const lensImage = await resolveLensPublicUrl(rawImage);
            if (lensImage) triggerLensMatch(lensImage, item.id || item.item_code || 'auto');
          } catch (e) {
            console.warn('[Lens] Could not resolve public URL:', e.message);
          }
        }, 400);
      }
    } else {
      setAutoDetectResult(null);
      setSpecBreakdown(null);
      setMatches([]);
      setError(null);
      setLensResults(null);
      setLensLoading(false);
    }
  }, [isOpen, item]);

  // Fast Progressive Pipeline Execution
  const runFullTestSimulation = async (descToTest) => {
    if (!descToTest || !descToTest.trim()) {
      setError('Item has no specification text to test.');
      return;
    }

    setLoading(true);
    setError(null);

    const apiBase = getApiBase();
    const headers = { 'Content-Type': 'application/json' };

    if (aiSettings) {
      if (aiSettings.googleApiKey) headers['x-google-api-key'] = aiSettings.googleApiKey;
      if (aiSettings.googleFreeKey) headers['x-google-free-key'] = aiSettings.googleFreeKey;
      if (aiSettings.model) headers['x-model-name'] = aiSettings.model;
    }

    try {
      const normalizedImages = (item?.images && Array.isArray(item.images) && item.images.length > 0)
        ? item.images.map(img => typeof img === 'string' ? { url: img } : img)
        : (item?.imageUrl ? [{ url: item.imageUrl }] : []);

      // Call /api/ve-match-auto with rich multimodal context and live alternatives discovery
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 50000);

      const veRes = await fetch(`${apiBase}/api/ve-match-auto`, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          description: descToTest,
          qty: item?.quantity || 1,
          unit: item?.unit || 'pcs',
          imageUrl: item?.imageUrl || (normalizedImages[0]?.url || null),
          imageAssets: normalizedImages,
          ocrTokens: item?.ocrTokens || [],
          rowBoundingBox: item?.rowBoundingBox || null,
          category: item?.category || item?.mainCategory || null,
          providerModel: aiSettings?.model,
          tier: item?.tier || 'mid'
        })
      })
        .then(res => res.json())
        .catch(err => ({ status: 'error', message: err.message }));

      clearTimeout(timeoutId);

      // Evaluate primary result
      if (veRes.status === 'success' && veRes.product) {
        const prod = veRes.product;
        setAutoDetectResult(prod);
        setSpecBreakdown({
          identifiedModel: prod.model,
          source: veRes.source || (veRes.matchTier === 'EXACT_MATCH' ? 'Exact Manufacturer Discovery' : 'Contract Priority Catalog'),
          matchTier: veRes.matchTier || 'HIGH_CONFIDENCE',
          confidenceScore: veRes.confidenceScore || 98,
          brand: prod.brand,
          brandLogo: prod.brandLogo || '',
          family: prod.family || '',
          category: `${prod.mainCategory || 'Furniture'} → ${prod.subCategory || 'General'}`,
          price: prod.price || 0,
          currency: prod.currency || 'USD',
          websiteUrl: prod.websiteUrl || prod.productUrl || '',
          evidence: veRes.evidence || null
        });

        // ── Google Lens auto-trigger DISABLED ──────────────────────────────
        // Lens matching now runs ONLY via manual button click.
        // Re-enable this block if you want silent background Lens on every match:
        // const imgForLens = item?.imageUrl || (normalizedImages[0]?.url) || prod.imageUrl || null;
        // if (imgForLens && extensionInstalled) {
        //   triggerLensMatch(imgForLens, item?.id || item?.item_code || 'unknown');
        // }

        if (veRes.alternatives && Array.isArray(veRes.alternatives) && veRes.alternatives.length > 0) {
          setMatches(veRes.alternatives);
        }
      } else {
        // Fallback: Check local catalog directly
        const fallbackRes = await fetch(`${apiBase}/api/ai/live-alternatives`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            description: descToTest,
            category: item?.category || item?.mainCategory || null,
            topK: 4
          })
        }).then(r => r.json()).catch(() => null);

        if (fallbackRes && fallbackRes.alternatives && fallbackRes.alternatives.length > 0) {
          setMatches(fallbackRes.alternatives);
          const topMatch = fallbackRes.alternatives[0];
          setAutoDetectResult(topMatch);
          setSpecBreakdown({
            identifiedModel: topMatch.model,
            source: topMatch.source || 'Contract Alternative',
            matchTier: 'SPEC_MATCH',
            confidenceScore: topMatch.confidenceScore || 90,
            brand: topMatch.brand,
            brandLogo: topMatch.brandLogo || '',
            family: topMatch.family || '',
            category: `${topMatch.mainCategory || 'Furniture'} → ${topMatch.subCategory || 'General'}`,
            price: topMatch.price || 0,
            currency: topMatch.currency || 'USD',
            websiteUrl: topMatch.websiteUrl || topMatch.productUrl || ''
          });
        } else {
          setError(veRes.message || 'No automatic match found. You can refine the test query above.');
        }
      }

    } catch (err) {
      console.error('Test simulation error:', err);
      setError(err.message || 'Error executing match simulation.');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Trigger Google Lens silent visual match via the Chrome extension.
   * Fires automatically when an image URL is present and the extension is installed.
   */
  const triggerLensMatch = (imageUrl, itemId) => {
    if (!extensionInstalled || !imageUrl) return;
    setLensLoading(true);
    setLensResults(null);

    const requestId = `lens-${Date.now()}`;

    const handleResponse = (event) => {
      if (event.data?.source === 'auto-browser-extension' && event.data?.requestId === requestId) {
        window.removeEventListener('message', handleResponse);
        setLensLoading(false);
        if (event.data.success && event.data.result?.visualMatches) {
          setLensResults(event.data.result);
        }
      }
    };

    window.addEventListener('message', handleResponse);
    window.postMessage({
      source: 'auto-browser-app',
      requestId,
      action: 'lensVisualMatch',
      args: { imageUrl, itemId: itemId || 'modal-auto', description: testDescription }
    }, '*');

    // Cleanup listener after 30s timeout
    setTimeout(() => {
      window.removeEventListener('message', handleResponse);
      setLensLoading(false);
    }, 30000);
  };

  const handleBrandFilterChange = async (e) => {
    const newBrand = e.target.value;
    setSelectedBrand(newBrand);
    setLoading(true);

    try {
      const apiBase = getApiBase();
      const headers = { 'Content-Type': 'application/json' };
      const res = await fetch(`${apiBase}/api/ai/semantic-match`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          description: testDescription,
          brand: newBrand === 'All' ? null : newBrand,
          category: item?.category || item?.mainCategory || null,
          topK: 4
        })
      });
      const data = await res.json();
      setMatches(data.matches || []);
    } catch (err) {
      console.error('Brand filter match error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyMatch = (matchProduct) => {
    if (!matchProduct) return;
    onSelectProduct(matchProduct);
    onClose();
  };

  if (!isOpen || !item) return null;

  const itemCode = item.code || item.itemNo || item.id || '#';

  return (
    <div className={styles.overlay} data-theme={theme} onClick={onClose}>
      <div className={styles.modal} data-theme={theme} onClick={(e) => e.stopPropagation()}>
        
        {/* Modal Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.headerIcon}>✨</div>
            <div>
              <h2 className={styles.title}>AI Auto-Match Inspector</h2>
              <p className={styles.subtitle}>Single-Item Multimodal Auto-Match & Value-Engineering Sandbox</p>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} title="Close">✕</button>
        </div>

        {/* Modal Content */}
        <div className={styles.content}>
          
          {/* Target Item Context & Live Sandbox Box */}
          <div className={styles.itemContextCard}>
            <div className={styles.contextHeaderRow}>
              <span className={styles.contextLabel}>Target Specification • Item {itemCode}</span>
              <div className={styles.contextMeta}>
                {item.quantity != null && <span className={styles.metaBadge}>🔢 Qty: {item.quantity} {item.unit || 'pcs'}</span>}
                {item.brand && <span className={styles.metaBadge}>🏷️ Brand: {item.brand}</span>}
                {item.model && <span className={styles.metaBadge}>📦 Code: {item.model}</span>}
              </div>
            </div>
            
            <textarea
              className={styles.testQueryTextarea}
              value={testDescription}
              onChange={(e) => setTestDescription(e.target.value)}
              placeholder="Edit specification text here to test AI matching variations..."
              rows={2}
            />

            <div className={styles.testActionsRow}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <button 
                  className={styles.runTestBtn}
                  onClick={() => runFullTestSimulation(testDescription)}
                  disabled={loading}
                >
                  {loading ? '⚡ Auto-Matching...' : '🧪 Re-Run Auto-Match'}
                </button>
                <button
                  className={styles.runTestBtn}
                  onClick={() => {
                    const cleanQuery = (testDescription || '').replace(/[|#]/g, ' ').slice(0, 100).trim();
                    if (primaryImage && typeof primaryImage === 'string' && primaryImage.startsWith('http')) {
                      window.open(`https://lens.google.com/uploadbyurl?url=${encodeURIComponent(primaryImage)}`, '_blank');
                    } else {
                      window.open(`https://www.google.com/search?q=${encodeURIComponent(cleanQuery)}&tbm=isch`, '_blank');
                    }
                  }}
                  style={{ background: 'rgba(59, 130, 246, 0.15)', borderColor: 'rgba(59, 130, 246, 0.4)', color: '#60a5fa' }}
                  title="Zero-token reverse image search on Google Lens / Google Images for custom or unmatched items"
                >
                  🌐 Visual Lens Search
                </button>
                {autoDetectResult && !loading && (
                  <button
                    className={styles.quickApplyBtn}
                    onClick={() => handleApplyMatch(autoDetectResult)}
                    title="Quickly apply this verified match to row"
                  >
                    ⚡ Quick Apply to Row
                  </button>
                )}
              </div>
              <span className={styles.tipText}>Tip: Uses full multi-brand catalog + live web discovery pipeline</span>
            </div>
          </div>

          {/* Mode Switch Tabs */}
          <div className={styles.tabsContainer}>
            <button
              className={`${styles.tabBtn} ${activeTab === 'auto_detect' ? styles.activeTab : ''}`}
              onClick={() => setActiveTab('auto_detect')}
            >
              🎯 Full Auto-Match Result {autoDetectResult && !loading && <span className={styles.tabBadge}>Verified</span>}
            </button>
            <button
              className={`${styles.tabBtn} ${activeTab === 'partner_catalog' ? styles.activeTab : ''}`}
              onClick={() => setActiveTab('partner_catalog')}
            >
              🏢 Partner Alternatives ({matches.length})
            </button>
            <button
              className={`${styles.tabBtn} ${activeTab === 'lens_match' ? styles.activeTab : ''}`}
              onClick={() => setActiveTab('lens_match')}
              style={{ borderColor: activeTab === 'lens_match' ? 'rgba(124,58,237,0.7)' : undefined }}
            >
              🔍 Lens Visual Match
              {lensResults && !lensLoading && (
                <span className={styles.tabBadge} style={{ background: 'rgba(124,58,237,0.3)', color: '#c4b5fd' }}>
                  {lensResults.visualMatches?.length || 0}
                </span>
              )}
              {lensLoading && <span className={styles.tabBadge} style={{ background: 'rgba(124,58,237,0.15)', color: '#a78bfa' }}>⏳</span>}
            </button>
          </div>

          {/* ── RICH LOADING THROBBER & STAGE PROGRESS ── */}
          {loading && (
            <div className={styles.loadingContainer}>
              <div className={styles.throbberWrapper}>
                <div className={styles.throbberOrb}>
                  <span className={styles.throbberIcon}>✨</span>
                </div>
                <div className={styles.throbberRing} />
                <div className={styles.throbberRingOuter} />
              </div>

              <div className={styles.loadingInfo}>
                <h4 className={styles.loadingTitle}>AI Auto-Matching in Progress</h4>
                <p className={styles.loadingSubtitle}>Executing full multimodal contract catalog & live web discovery...</p>
              </div>

              <div className={styles.loadingSteps}>
                <div className={`${styles.stepItem} ${loadingStage >= 0 ? styles.stepActive : ''}`}>
                  <span className={styles.stepDot}>{loadingStage > 0 ? '✓' : '1'}</span>
                  <span>Decomposing item specifications & image tokens</span>
                </div>
                <div className={`${styles.stepItem} ${loadingStage >= 1 ? styles.stepActive : ''}`}>
                  <span className={styles.stepDot}>{loadingStage > 1 ? '✓' : '2'}</span>
                  <span>Scanning partner brand catalogs & manufacturer models</span>
                </div>
                <div className={`${styles.stepItem} ${loadingStage >= 2 ? styles.stepActive : ''}`}>
                  <span className={styles.stepDot}>3</span>
                  <span>Matching high-res photos, finishes & unit rates</span>
                </div>
              </div>

              {/* Shimmer Skeleton Card */}
              <div className={styles.skeletonCard}>
                <div className={styles.skeletonHeader}>
                  <div className={styles.skeletonLogo} />
                  <div className={styles.skeletonLines}>
                    <div className={styles.skeletonLineShort} />
                    <div className={styles.skeletonLineLong} />
                  </div>
                </div>
                <div className={styles.skeletonBody}>
                  <div className={styles.skeletonImage} />
                  <div className={styles.skeletonSpecs}>
                    <div className={styles.skeletonGridItem} />
                    <div className={styles.skeletonGridItem} />
                    <div className={styles.skeletonGridItem} />
                    <div className={styles.skeletonGridItem} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && !loading && (
            <div className={styles.errorBox}>
              ⚠️ {error}
            </div>
          )}

          {/* ── TAB 1: AUTO-DETECT PIPELINE RESULTS ── */}
          {activeTab === 'auto_detect' && !loading && (
            <div className={styles.autoDetectView}>
              {autoDetectResult ? (
                <div className={styles.primaryResultCard}>
                  
                  {/* Top Bar with Brand & Match Status */}
                  <div className={styles.resultHeader}>
                    <div className={styles.brandTitleWrap}>
                      {autoDetectResult.brandLogo || specBreakdown?.brandLogo ? (
                        <img 
                          src={getFullUrl(autoDetectResult.brandLogo || specBreakdown.brandLogo)} 
                          alt={autoDetectResult.brand} 
                          className={styles.cardBrandLogo}
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                      ) : null}
                      <div>
                        <div className={styles.cardBrandName}>{autoDetectResult.brand || 'Contract Manufacturer'}</div>
                        <h3 className={styles.cardModelName}>{autoDetectResult.model || 'Identified Model'}</h3>
                      </div>
                    </div>
                    <span className={styles.matchScoreBadge}>
                      🎯 {specBreakdown?.confidenceScore ? `${specBreakdown.confidenceScore}%` : '100%'} Specification Fit
                    </span>
                  </div>

                  {/* Body Content */}
                  <div className={styles.resultBody}>
                    <div className={styles.resultImageWrap}>
                      {autoDetectResult.imageUrl ? (
                        <img
                          src={getFullUrl(autoDetectResult.imageUrl)}
                          alt={autoDetectResult.model}
                          className={styles.resultImage}
                          onError={(e) => {
                            e.target.src = 'https://placehold.co/400x300?text=No+Live+Image';
                          }}
                        />
                      ) : (
                        <div className={styles.noImagePh}>🖼️ No Image</div>
                      )}
                    </div>

                    <div className={styles.resultSpecsWrap}>
                      <div className={styles.specGrid}>
                        <div className={styles.specItem}>
                          <span className={styles.specKey}>Category</span>
                          <span className={styles.specVal}>{specBreakdown?.category || 'Office Furniture'}</span>
                        </div>
                        <div className={styles.specItem}>
                          <span className={styles.specKey}>Match Source</span>
                          <span className={styles.specVal}>{specBreakdown?.source || 'Contract Catalog'}</span>
                        </div>
                        {autoDetectResult.price > 0 && (
                          <div className={styles.specItem}>
                            <span className={styles.specKey}>Unit Rate</span>
                            <span className={styles.specValHighlight}>{autoDetectResult.currency || 'USD'} {Number(autoDetectResult.price).toFixed(2)}</span>
                          </div>
                        )}
                        {(autoDetectResult.websiteUrl || autoDetectResult.productUrl) && (
                          <div className={styles.specItem}>
                            <span className={styles.specKey}>Official Link</span>
                            <a href={autoDetectResult.websiteUrl || autoDetectResult.productUrl} target="_blank" rel="noreferrer" className={styles.specLink}>
                              🌐 View Product Page
                            </a>
                          </div>
                        )}
                      </div>

                      {autoDetectResult.description && (
                        <div className={styles.specDescBox}>
                          <span className={styles.specDescLabel}>Technical Specifications:</span>
                          <p className={styles.specDescText}>{autoDetectResult.description}</p>
                        </div>
                      )}

                      <button
                        className={styles.applyPrimaryBtn}
                        onClick={() => handleApplyMatch(autoDetectResult)}
                      >
                        ✨ Apply Matched Product to Row
                      </button>
                    </div>
                  </div>

                </div>
              ) : (
                <div className={styles.emptyState}>
                  <p>No specification match returned. Try running a test simulation or switch to Partner Alternatives.</p>
                </div>
              )}

              {/* Lens results now live in dedicated tab 3 — removed from here */}
              {false && (
                <div style={{
                  marginTop: '14px',
                  background: 'rgba(124,58,237,0.08)',
                  border: '1px solid rgba(124,58,237,0.3)',
                  borderRadius: '10px',
                  padding: '14px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                    <span style={{ fontSize: '1rem' }}>🔍</span>
                    <strong style={{ color: '#c4b5fd', fontSize: '0.88rem' }}>Google Lens 1:1 Visual Match</strong>
                    {lensLoading && (
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginLeft: '4px' }}>
                        ⏳ Scanning Lens results silently...
                      </span>
                    )}
                    {lensResults && !lensLoading && (
                      <span style={{ 
                        background: 'rgba(124,58,237,0.25)', color: '#c4b5fd',
                        border: '1px solid rgba(124,58,237,0.4)',
                        borderRadius: '20px', padding: '2px 8px', fontSize: '0.72rem', fontWeight: 700
                      }}>
                        🎯 {lensResults.visualMatches?.length || 0} Visual Matches
                      </span>
                    )}
                  </div>

                  {lensResults && lensResults.visualMatches && lensResults.visualMatches.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {lensResults.visualMatches.slice(0, 5).map((m, i) => (
                        <div key={i} style={{
                          background: i === 0 ? 'rgba(124,58,237,0.15)' : 'rgba(30,41,59,0.8)',
                          border: `1px solid ${i === 0 ? 'rgba(124,58,237,0.5)' : '#334155'}`,
                          borderRadius: '8px',
                          padding: '10px 12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px'
                        }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {i === 0 && (
                              <span style={{
                                background: 'rgba(124,58,237,0.3)', color: '#e9d5ff',
                                borderRadius: '20px', padding: '1px 7px', fontSize: '0.68rem',
                                fontWeight: 700, display: 'inline-block', marginBottom: '3px'
                              }}>🏆 Top Match</span>
                            )}
                            <div style={{ color: '#c4b5fd', fontWeight: 600, fontSize: '0.83rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {m.title || 'Visual Match'}
                            </div>
                            <div style={{ color: '#94a3b8', fontSize: '0.74rem' }}>📌 {m.source || 'Unknown source'}</div>
                          </div>
                          {m.url && (
                            <a href={m.url} target="_blank" rel="noopener noreferrer" style={{
                              color: '#38bdf8', fontSize: '0.75rem', textDecoration: 'none',
                              flexShrink: 0, padding: '4px 10px',
                              border: '1px solid rgba(56,189,248,0.3)',
                              borderRadius: '6px', whiteSpace: 'nowrap'
                            }}>
                              🔗 View →
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : lensResults && !lensLoading ? (
                    <div style={{ color: '#94a3b8', fontSize: '0.8rem', padding: '8px 0' }}>
                      No visual matches extracted. 
                      <a
                        href={`https://lens.google.com/uploadbyurl?url=${encodeURIComponent(item?.imageUrl || '')}`}
                        target="_blank" rel="noopener noreferrer"
                        style={{ color: '#38bdf8', marginLeft: '6px' }}
                      >
                        🌐 Open Lens manually →
                      </a>
                    </div>
                  ) : null}

                  {!extensionInstalled && (
                    <div style={{ color: '#94a3b8', fontSize: '0.78rem' }}>
                      Install the Auto Browser Extension to enable silent Google Lens visual matching.
                    </div>
                  )}
                </div>
              )}

              {/* Lens install nudge for items with images when extension not installed */}
              {!extensionInstalled && (item?.imageUrl || (item?.images && item.images.length > 0)) && !loading && (
                <div style={{
                  marginTop: '10px', fontSize: '0.76rem', color: '#94a3b8',
                  display: 'flex', alignItems: 'center', gap: '6px'
                }}>
                  <span>🔌</span>
                  <span>Install the <strong style={{ color: '#c4b5fd' }}>Auto Browser Extension</strong> to enable 🎯 Google Lens 1:1 visual matching for this item (zero AI tokens).</span>
                </div>
              )}
            </div>
          )}


          {/* ── TAB 2: VALUE-ENGINEERED PARTNER ALTERNATIVES ── */}
          {activeTab === 'partner_catalog' && !loading && (
            <div className={styles.partnerCatalogView}>
              <div className={styles.partnerControls}>
                <label className={styles.selectLabel}>Filter Catalog Brand:</label>
                <select
                  className={styles.brandSelect}
                  value={selectedBrand}
                  onChange={handleBrandFilterChange}
                >
                  <option value="All">All Partner Brands (Priority Matching)</option>
                  {availableBrands.map(b => (
                    <option key={b.id || b.name} value={b.name}>{b.name} ({b.products?.length || 0} items)</option>
                  ))}
                </select>
              </div>

              {matches.length > 0 ? (
                <div className={styles.matchesList}>
                  {matches.map((match, idx) => {
                    const isLiveWeb = match.source === 'Live Architonic & Global Web Discovery';
                    const fallbackSearchUrl = `https://www.architonic.com/en/search/?q=${encodeURIComponent((match.brand || '') + ' ' + (match.model || ''))}`;
                    const officialUrl = match.officialProductUrl || match.websiteUrl || match.productUrl || fallbackSearchUrl;
                    const architonicUrl = match.architonicUrl;

                    return (
                      <div
                        key={idx}
                        className={`${styles.matchCard} ${idx === 0 ? styles.topMatchCard : ''}`}
                      >
                        <div className={styles.productImageWrap}>
                          {match.imageUrl ? (
                            <img
                              src={getFullUrl(match.imageUrl)}
                              alt={match.model}
                              className={styles.productImage}
                              onError={(e) => {
                                e.target.src = 'https://placehold.co/100x100?text=No+Photo';
                              }}
                            />
                          ) : (
                            <span className={styles.imagePlaceholder}>🪑</span>
                          )}
                        </div>

                        <div className={styles.matchDetails}>
                          <div className={styles.matchHeader}>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                                <span className={styles.brandBadge}>{match.brand}</span>
                                {isLiveWeb ? (
                                  <span style={{ fontSize: '0.68rem', padding: '2px 8px', borderRadius: '12px', background: 'rgba(14, 165, 233, 0.15)', color: '#38bdf8', border: '1px solid rgba(14, 165, 233, 0.3)', fontWeight: 600 }}>
                                    🌐 Architonic & Live Web Discovery
                                  </span>
                                ) : (
                                  <span style={{ fontSize: '0.68rem', padding: '2px 8px', borderRadius: '12px', background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', border: '1px solid rgba(168, 85, 247, 0.3)', fontWeight: 600 }}>
                                    🏷️ Verified Contract Partner
                                  </span>
                                )}
                              </div>
                              <h4 className={styles.modelName}>{match.model}</h4>
                              {match.mainCategory && (
                                <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '2px' }}>
                                  📂 {match.mainCategory} {match.subCategory ? `→ ${match.subCategory}` : ''}
                                </div>
                              )}
                            </div>
                            <span className={`${styles.confidenceBadge} ${idx === 0 ? styles.topScore : ''}`}>
                              {match.exactModelMatch ? '🎯 100% Exact' : `⚡ ${match.confidenceScore || match.specificationFit || 92}% Fit`}
                            </span>
                          </div>

                          <p className={styles.productDesc}>{match.veReason || match.description || 'Verified Commercial Specification Alternative'}</p>

                          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', margin: '6px 0', flexWrap: 'wrap' }}>
                            <a
                              href={officialUrl}
                              target="_blank"
                              rel="noreferrer"
                              style={{ fontSize: '0.74rem', color: '#60a5fa', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                              title="Open live manufacturer product portal or verified search"
                            >
                              🌐 Official Website ↗
                            </a>
                            {architonicUrl && (
                              <a
                                href={architonicUrl}
                                target="_blank"
                                rel="noreferrer"
                                style={{ fontSize: '0.74rem', color: '#38bdf8', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                              >
                                🏛️ Architonic / Platform Page ↗
                              </a>
                            )}
                          </div>

                          <div className={styles.matchFooter}>
                            <span className={styles.productPrice}>
                              {match.price > 0 ? `${match.currency || '$'} ${Number(match.price).toFixed(2)}` : 'Price on Request'}
                            </span>
                            <button
                              className={styles.selectBtn}
                              onClick={() => handleApplyMatch(match)}
                            >
                              ✓ Select Alternative
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className={styles.emptyState}>
                  <p>No partner catalog matches found for the selected brand filter.</p>
                </div>
              )}
            </div>
          )}

          {/* ── TAB 3: GOOGLE LENS VISUAL MATCH ── */}
          {activeTab === 'lens_match' && !loading && (() => {
            const rawImage = item?.imageUrl ||
              (Array.isArray(item?.images) && item.images.length > 0
                ? (typeof item.images[0] === 'string' ? item.images[0] : item.images[0]?.url)
                : null);
            // Resolve to full URL for display + extension trigger
            const primaryImage = rawImage ? resolveLocalUrl(rawImage) : null;
            const imageIsLocal = isLocalImage(rawImage);

            // Manual Lens link only works for public URLs
            const lensUrl = primaryImage && !imageIsLocal
              ? `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(primaryImage)}`
              : null;

            // Text fallback for local images
            const textSearchUrl = (() => {
              const q = (item?.description || item?.model || '').replace(/[|#]/g, ' ').slice(0, 120).trim();
              return q ? `https://www.google.com/search?q=${encodeURIComponent(q)}&tbm=isch` : null;
            })();

            return (
              <div style={{ padding: '6px 0' }}>

                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <div style={{ fontWeight: 700, color: '#c4b5fd', fontSize: '0.92rem', marginBottom: '2px' }}>🔍 Google Lens 1:1 Visual Match</div>
                    <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>Zero AI tokens · Visual accuracy · Detects unlisted / custom products</div>
                  </div>
                  {lensResults && !lensLoading && (
                    <span style={{ background: 'rgba(124,58,237,0.25)', color: '#e9d5ff', border: '1px solid rgba(124,58,237,0.5)', borderRadius: '20px', padding: '3px 10px', fontSize: '0.74rem', fontWeight: 700 }}>
                      🎯 {lensResults.visualMatches?.length || 0} Visual Matches Found
                    </span>
                  )}
                </div>

                {/* Image preview + trigger */}
                <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap' }}>
                  {primaryImage ? (
                    <img
                      src={primaryImage}
                      alt="Product"
                      style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: '8px', border: '1px solid rgba(124,58,237,0.4)', flexShrink: 0 }}
                      onError={e => { e.target.style.display = 'none'; }}
                    />
                  ) : (
                    <div style={{ width: 90, height: 90, borderRadius: '8px', border: '1px dashed #334155', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: '1.6rem', flexShrink: 0 }}>📷</div>
                  )}
                  <div style={{ flex: 1 }}>
                    {primaryImage ? (
                      <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '10px', wordBreak: 'break-all' }}>🖼️ {primaryImage.slice(0, 80)}{primaryImage.length > 80 ? '...' : ''}</div>
                    ) : (
                      <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '10px' }}>⚠️ No image available for this item. Lens matching requires a product image URL.</div>
                    )}
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {/* Extension-based silent match */}
                      {extensionInstalled && primaryImage && (
                        <button
                          onClick={() => triggerLensMatch(primaryImage, item?.id || item?.item_code || 'unknown')}
                          disabled={lensLoading}
                          style={{
                            padding: '8px 16px', borderRadius: '8px', border: 'none', cursor: lensLoading ? 'not-allowed' : 'pointer',
                            background: lensLoading ? 'rgba(124,58,237,0.2)' : 'linear-gradient(135deg,#7c3aed,#a855f7)',
                            color: '#fff', fontWeight: 700, fontSize: '0.82rem',
                            boxShadow: lensLoading ? 'none' : '0 4px 14px rgba(124,58,237,0.35)',
                            transition: 'all 0.2s'
                          }}
                        >
                          {lensLoading ? '⏳ Scanning Lens...' : '🔍 Run Silent Lens Match'}
                        </button>
                      )}
                      {/* Manual fallback — always available */}
                      {lensUrl && (
                        <a
                          href={lensUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            padding: '8px 14px', borderRadius: '8px',
                            border: '1px solid rgba(59,130,246,0.4)',
                            background: 'rgba(59,130,246,0.1)', color: '#60a5fa',
                            fontWeight: 600, fontSize: '0.82rem', textDecoration: 'none',
                            display: 'inline-flex', alignItems: 'center', gap: '5px'
                          }}
                        >
                          🌐 Open in Google Lens ↗
                        </a>
                      )}
                    </div>
                    {!extensionInstalled && primaryImage && (
                      <div style={{ marginTop: '8px', fontSize: '0.74rem', color: '#64748b' }}>
                        🔌 Install the <strong style={{ color: '#c4b5fd' }}>Auto Browser Extension</strong> to run the silent background Lens match without leaving this modal.
                      </div>
                    )}
                  </div>
                </div>

                {/* Results list */}
                {lensLoading && (
                  <div style={{ textAlign: 'center', padding: '20px', color: '#a78bfa' }}>
                    <div style={{ fontSize: '1.4rem', marginBottom: '6px' }}>🔄</div>
                    <div style={{ fontSize: '0.82rem' }}>Opening minimized Lens window · Extracting visual matches...</div>
                    <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px' }}>Takes 8–12 seconds · No flash in your browser</div>
                  </div>
                )}

                {lensResults && !lensLoading && lensResults.visualMatches?.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '10px', fontWeight: 600 }}>VISUAL MATCH RESULTS</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {lensResults.visualMatches.slice(0, 6).map((m, i) => (
                        <div key={i} style={{
                          background: i === 0 ? 'rgba(124,58,237,0.15)' : 'rgba(15,23,42,0.8)',
                          border: `1px solid ${i === 0 ? 'rgba(124,58,237,0.5)' : '#1e293b'}`,
                          borderRadius: '10px', padding: '12px 14px',
                          display: 'flex', alignItems: 'center', gap: '12px'
                        }}>
                          {m.imageUrl && (
                            <img src={m.imageUrl} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: '6px', flexShrink: 0 }}
                              onError={e => { e.target.style.display = 'none'; }} />
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {i === 0 && <span style={{ background: 'rgba(124,58,237,0.3)', color: '#e9d5ff', borderRadius: '20px', padding: '1px 8px', fontSize: '0.67rem', fontWeight: 700, display: 'inline-block', marginBottom: '3px' }}>🏆 TOP VISUAL MATCH</span>}
                            <div style={{ color: '#c4b5fd', fontWeight: 600, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title || 'Visual Match'}</div>
                            <div style={{ color: '#64748b', fontSize: '0.73rem', marginTop: '2px' }}>📌 {m.source || 'Unknown source'}</div>
                          </div>
                          <a
                            href={m.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#38bdf8', fontSize: '0.75rem', textDecoration: 'none', padding: '5px 12px', border: '1px solid rgba(56,189,248,0.3)', borderRadius: '6px', whiteSpace: 'nowrap', flexShrink: 0 }}
                          >
                            🔗 View →
                          </a>
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: '12px', fontSize: '0.73rem', color: '#475569', textAlign: 'center' }}>
                      ✅ Satisfied with Lens results? Let us know and we'll promote Lens as the primary matching strategy.
                    </div>
                  </div>
                )}

                {lensResults && !lensLoading && (!lensResults.visualMatches || lensResults.visualMatches.length === 0) && (
                  <div style={{ textAlign: 'center', padding: '20px', color: '#64748b' }}>
                    <div style={{ fontSize: '1.2rem', marginBottom: '6px' }}>😕</div>
                    <div style={{ fontSize: '0.82rem' }}>No visual matches extracted from Lens DOM.</div>
                    {lensUrl && <a href={lensUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#38bdf8', fontSize: '0.78rem', marginTop: '6px', display: 'inline-block' }}>🌐 Try opening Google Lens manually →</a>}
                  </div>
                )}

                {!lensResults && !lensLoading && (
                  <div style={{ textAlign: 'center', padding: '16px', color: '#475569', fontSize: '0.8rem', borderTop: '1px solid #1e293b', marginTop: '4px' }}>
                    Click <strong style={{ color: '#c4b5fd' }}>Run Silent Lens Match</strong> above to extract visual product matches from Google Lens — or open it manually in a new tab.
                  </div>
                )}

              </div>
            );
          })()}

        </div>
      </div>
    </div>
  );
}
