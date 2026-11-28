import { useState, useEffect, useCallback } from 'react';
import { getApiBase } from '../utils/apiBase';
import {
  hasDirectSupabaseScanner,
  fetchScannerStatsDirect,
  fetchScannerProjectsDirect,
} from '../utils/scannerSupabaseFallback';
import styles from '../styles/MarketScanner.module.css';

const COUNTRY_CHIPS = [
  { code: 'ALL', label: 'All GCC', flag: '🌍' },
  { code: 'OM', label: 'Oman', flag: '🇴🇲' },
  { code: 'SA', label: 'Saudi Arabia', flag: '🇸🇦' },
  { code: 'AE', label: 'UAE', flag: '🇦🇪' },
  { code: 'QA', label: 'Qatar', flag: '🇶🇦' },
  { code: 'KW', label: 'Kuwait', flag: '🇰🇼' },
  { code: 'BH', label: 'Bahrain', flag: '🇧🇭' },
  { code: 'EG', label: 'Egypt', flag: '🇪🇬' },
  { code: 'JO', label: 'Jordan', flag: '🇯🇴' },
];

const SCOPE_CHIPS = [
  { id: '', label: 'All Scopes' },
  { id: 'furniture', label: 'Furniture & FF&E' },
  { id: 'residential_kitchen', label: 'Res. Kitchen' },
  { id: 'commercial_kitchen', label: 'Com. Kitchen' },
  { id: 'sanitary_tiles', label: 'Sanitary & Tiles' },
  { id: 'fitouts', label: 'Fit-Outs' },
];

const SCOPE_LABELS = {
  furniture: 'Furniture',
  residential_kitchen: 'Res. Kitchen',
  commercial_kitchen: 'Com. Kitchen',
  sanitary_tiles: 'Sanitary & Tiles',
  fitouts: 'Fit-Outs',
};

function formatLeadValue(lead) {
  if (lead?.value_note) return lead.value_note;
  if (lead?.est_value_omr && Number(lead.est_value_omr) > 0) {
    return `${Number(lead.est_value_omr).toFixed(1)}M ${lead.currency || 'OMR'}`;
  }
  return 'Value TBD';
}

export default function LandingRadarSection({
  onOpenScanner,
  onEstimateLead,
  onScannerStats,
}) {
  const apiBase = getApiBase();
  const [country, setCountry] = useState('ALL');
  const [scope, setScope] = useState('');
  const [stats, setStats] = useState(null);
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState('');

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/scanner/stats`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data || typeof data.total_projects !== 'number') throw new Error('Invalid stats response');
      setStats(data);
      onScannerStats?.(data);
    } catch {
      if (hasDirectSupabaseScanner()) {
        try {
          const fallbackStats = await fetchScannerStatsDirect({ country: 'ALL' });
          setStats(fallbackStats);
          onScannerStats?.(fallbackStats);
        } catch {
          // silent fallback
        }
      }
    }
  }, [apiBase, onScannerStats]);

  const loadLeads = useCallback(async (c = country, s = scope) => {
    setLoading(true);
    setLoadError('');
    try {
      const params = new URLSearchParams({ limit: '6', sort: 'heat' });
      if (c && c !== 'ALL') params.set('country', c);
      if (s) params.set('scope', s);
      const res = await fetch(`${apiBase}/api/scanner/projects?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data?.projects)) throw new Error('Invalid scanner feed response');
      setLeads(data.projects);
    } catch (apiErr) {
      if (hasDirectSupabaseScanner()) {
        try {
          const directLeads = await fetchScannerProjectsDirect({ country: c, scope: s, sort: 'heat', limit: 6 });
          setLeads(directLeads);
          setLoadError('');
          return;
        } catch (sbErr) {
          setLoadError(sbErr.message || apiErr.message || 'Scanner feed unavailable');
        }
      } else {
        setLoadError(apiErr.message || 'Scanner feed unavailable');
      }
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }, [apiBase, country, scope]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    loadLeads(country, scope);
  }, [country, scope, loadLeads]);

  const handleLiveScan = async () => {
    if (scanning) return;
    setScanning(true);
    setScanMsg('');
    try {
      const res = await fetch(`${apiBase}/api/scanner/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'standard', country }),
      });
      const data = await res.json();
      if (data?.ok) {
        setScanMsg(`Scanned ${data.discovered || 0} feeds (${data.inserted || 0} new, ${data.updated || 0} updated)`);
        await Promise.all([loadStats(), loadLeads(country, scope)]);
      } else {
        setScanMsg(data?.error || 'Live scan completed with partial results');
      }
    } catch (err) {
      setScanMsg(`Scan unavailable: ${err.message}`);
    } finally {
      setScanning(false);
    }
  };

  return (
    <section className={styles.landingRadarWrap} aria-label="Live GCC and Oman Tender Radar">
      <div className={styles.landingRadarCard}>
        <div className={styles.radarTopHeader}>
          <div>
            <div className={styles.eyebrowPill}>
              <span className={styles.liveDot} />
              <span>LIVE GCC &amp; OMAN TENDER RADAR · SUPABASE CLOUD</span>
            </div>
            <h2 className={styles.radarTitle}>Discover Active Fit-Out &amp; FF&amp;E Leads Before Bidding Closes</h2>
            <p className={styles.radarSubtitle}>
              Inspect live Oman Tender Board &amp; GCC projects, pull verified client contacts, and auto-populate your BOQ in one click.
            </p>
          </div>

          <div className={styles.kpiStrip}>
            <div className={styles.kpiPill}>
              <span className={styles.kpiValue}>{stats?.total_projects ?? '—'}</span>
              <span className={styles.kpiLabel}>Active Projects</span>
            </div>
            <div className={styles.kpiPill}>
              <span className={styles.kpiValue} style={{ color: '#fbbf24' }}>{stats?.hot_leads ?? '—'}</span>
              <span className={styles.kpiLabel}>Hot Leads</span>
            </div>
            <div className={styles.kpiPill}>
              <span className={styles.kpiValue} style={{ color: '#34d399' }}>{stats?.verified_contacts ?? '—'}</span>
              <span className={styles.kpiLabel}>Verified Contacts</span>
            </div>
            <div className={styles.kpiPill}>
              <span className={styles.kpiValue}>{stats?.countries_covered ?? 8}</span>
              <span className={styles.kpiLabel}>GCC Markets</span>
            </div>
          </div>
        </div>

        <div className={styles.filterBars}>
          <div className={styles.chipRow}>
            {COUNTRY_CHIPS.map((c) => (
              <button
                key={c.code}
                type="button"
                onClick={() => setCountry(c.code)}
                className={`${styles.filterChip} ${country === c.code ? styles.filterChipActive : ''}`}
              >
                <span>{c.flag}</span>
                <span>{c.label}</span>
              </button>
            ))}
          </div>

          <div className={styles.chipRow}>
            {SCOPE_CHIPS.map((s) => (
              <button
                key={s.id || 'all'}
                type="button"
                onClick={() => setScope(s.id)}
                className={`${styles.filterChip} ${scope === s.id ? styles.scopeChipActive : ''}`}
              >
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        </div>

        {scanMsg && (
          <div className={styles.toastBar} style={{ borderRadius: '10px', marginBottom: '0.9rem' }}>
            <span>{scanMsg}</span>
            <button type="button" onClick={() => setScanMsg('')} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>×</button>
          </div>
        )}

        <div className={styles.cardsGrid}>
          {loading && leads.length === 0 ? (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
              Loading live Supabase tender intelligence...
            </div>
          ) : loadError && leads.length === 0 ? (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
              <span>Unable to reach scanner feed ({loadError}).</span>
              <button type="button" className={styles.btnEstimate} onClick={() => loadLeads(country, scope)}>
                Retry
              </button>
            </div>
          ) : leads.length === 0 ? (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
              No matching leads for this filter combination. Try widening your country or scope selection.
            </div>
          ) : (
            leads.map((lead) => (
              <article key={lead.id} className={styles.leadCard}>
                <div>
                  <div className={styles.leadCardHead}>
                    <span className={styles.countryLoc}>
                      <span>{lead.flag}</span>
                      <span>{lead.city || lead.country_name}</span>
                    </span>
                    <span className={`${styles.heatPill} ${lead.heat_score >= 70 ? styles.heatHot : styles.heatWarm}`}>
                      <span>{lead.heat_score >= 70 ? '🔥' : '⚡'}</span>
                      <span>{lead.heat_score}</span>
                    </span>
                  </div>

                  <h3 className={styles.leadTitle} title={lead.title}>{lead.title}</h3>
                  {lead.ar_title && lead.ar_title !== lead.title && (
                    <div dir="rtl" className={styles.arabicSubtitle} title={lead.ar_title}>
                      {lead.ar_title}
                    </div>
                  )}
                  <div className={styles.leadMetaLine}>
                    {[
                      lead.client || lead.main_contractor || lead.source_name || 'GCC Opportunity',
                      lead.reference_no ? `Ref: ${lead.reference_no}` : '',
                    ].filter(Boolean).join(' · ')}
                  </div>

                  <div className={styles.tagsWrap} style={{ marginTop: '0.5rem' }}>
                    <span className={styles.stageBadge}>{lead.stage}</span>
                    {(lead.scopes || []).slice(0, 2).map((sc) => (
                      <span key={sc} className={styles.scopeBadge}>{SCOPE_LABELS[sc] || sc}</span>
                    ))}
                  </div>
                </div>

                <div className={styles.leadCardFoot}>
                  <div>
                    <div className={styles.valMeta}>{formatLeadValue(lead)}</div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                      {lead.contact_count > 0 ? `${lead.contact_count} verified contacts` : (lead.source_name || 'Radar')}
                    </div>
                  </div>
                  <div className={styles.cardBtns}>
                    <button
                      type="button"
                      className={styles.btnInspect}
                      onClick={() => onOpenScanner?.({ leadId: lead.id, country, scope })}
                    >
                      Inspect
                    </button>
                    <button
                      type="button"
                      className={styles.btnEstimate}
                      onClick={() => onEstimateLead?.(lead)}
                      title="Reserve this lead in BOQ Flow and upload its official tender BOQ or drawings"
                    >
                      Start BOQ →
                    </button>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>

        <div className={styles.radarFooterActions}>
          <button
            type="button"
            className={styles.openFullBtn}
            onClick={() => onOpenScanner?.({ country, scope })}
          >
            <i className="ri-radar-line" />
            <span>Open Full Geospatial Radar &amp; Top 10 Digest</span>
          </button>

          <button
            type="button"
            className={styles.scanNowBtn}
            onClick={handleLiveScan}
            disabled={scanning}
          >
            <i className={scanning ? 'ri-loader-4-line' : 'ri-refresh-line'} />
            <span>{scanning ? 'Scanning Live Portals...' : 'Scan Live Portals'}</span>
          </button>
        </div>
      </div>
    </section>
  );
}
