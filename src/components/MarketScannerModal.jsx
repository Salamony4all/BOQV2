import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { getApiBase } from '../utils/apiBase';
import { useTheme } from '../context/ThemeContext';
import {
  hasDirectSupabaseScanner,
  fetchScannerProjectsDirect,
  fetchNearbyProjectsDirect,
  fetchProjectDetailDirect,
  fetchDigestTabDirect,
  getStaticRegionalCountries,
} from '../utils/scannerSupabaseFallback';
import styles from '../styles/MarketScanner.module.css';

const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

let leafletLoadPromise = null;
function ensureLeafletLoaded() {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.L) return Promise.resolve(window.L);
  if (leafletLoadPromise) return leafletLoadPromise;

  leafletLoadPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }
    const existingScript = document.querySelector(`script[src="${LEAFLET_JS}"]`);
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.L));
      existingScript.addEventListener('error', () => reject(new Error('Failed to load Leaflet')));
      return;
    }
    const script = document.createElement('script');
    script.src = LEAFLET_JS;
    script.async = true;
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error('Failed to load Leaflet map library'));
    document.head.appendChild(script);
  });

  return leafletLoadPromise;
}

const COUNTRY_OPTS = [
  { code: 'ALL', label: 'All GCC / Regional' },
  { code: 'OM', label: '🇴🇲 Oman' },
  { code: 'SA', label: '🇸🇦 Saudi Arabia' },
  { code: 'AE', label: '🇦🇪 UAE' },
  { code: 'QA', label: '🇶🇦 Qatar' },
  { code: 'KW', label: '🇰🇼 Kuwait' },
  { code: 'BH', label: '🇧🇭 Bahrain' },
  { code: 'EG', label: '🇪🇬 Egypt' },
  { code: 'JO', label: '🇯🇴 Jordan' },
];

const SCOPE_OPTS = [
  { id: '', label: 'All Scopes' },
  { id: 'furniture', label: 'Furniture & FF&E' },
  { id: 'residential_kitchen', label: 'Residential Kitchen' },
  { id: 'commercial_kitchen', label: 'Commercial Kitchen' },
  { id: 'sanitary_tiles', label: 'Sanitaryware & Tiles' },
  { id: 'fitouts', label: 'Interior Fit-Outs' },
];

const STAGE_OPTS = ['concept', 'design', 'tender', 'award', 'construction', 'completion', 'handover', 'hold', 'unknown'];

const HUB_JUMPS = [
  { id: 'ALL', label: 'Fit All', lat: null, lng: null, zoom: 5 },
  { id: 'OM', label: '🇴🇲 Oman', lat: 21.8, lng: 57.2, zoom: 6 },
  { id: 'Muscat', label: 'Muscat', lat: 23.588, lng: 58.408, zoom: 11 },
  { id: 'Salalah', label: 'Salalah', lat: 17.015, lng: 54.092, zoom: 11 },
  { id: 'Sohar', label: 'Sohar', lat: 24.365, lng: 56.747, zoom: 11 },
  { id: 'Duqm', label: 'Duqm', lat: 19.697, lng: 57.695, zoom: 11 },
  { id: 'Ibra', label: 'Ibra', lat: 22.691, lng: 58.533, zoom: 11 },
  { id: 'SA', label: '🇸🇦 Riyadh', lat: 24.7136, lng: 46.6753, zoom: 9 },
  { id: 'AE', label: '🇦🇪 Dubai', lat: 25.2048, lng: 55.2708, zoom: 10 },
  { id: 'QA', label: '🇶🇦 Doha', lat: 25.2854, lng: 51.531, zoom: 10 },
];

function formatValue(lead) {
  if (!lead) return 'TBD';
  if (lead.value_note) return lead.value_note;
  if (lead.est_value_omr && Number(lead.est_value_omr) > 0) {
    return `${Number(lead.est_value_omr).toFixed(1)}M ${lead.currency || 'OMR'}`;
  }
  return 'Value TBD';
}

function waNumber(phone = '') {
  return String(phone).replace(/\D/g, '');
}

export default function MarketScannerModal({
  isOpen,
  onClose,
  initialLeadId = null,
  initialTab = 'radar',
  initialCountry = 'ALL',
  initialScope = '',
  onEstimateLead,
}) {
  const apiBase = getApiBase();
  const { theme } = useTheme();

  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 860 : false));
  const [activeTab, setActiveTab] = useState(initialTab || 'radar');
  const [mobilePane, setMobilePane] = useState('map'); // 'map' | 'list'
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const [country, setCountry] = useState(initialCountry || 'ALL');
  const [scope, setScope] = useState(initialScope || '');
  const [stageFilter, setStageFilter] = useState('');
  const [sortBy, setSortBy] = useState('heat');
  const [searchQ, setSearchQ] = useState('');

  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [selectedLeadId, setSelectedLeadId] = useState(initialLeadId);
  const [fullInspectorOpen, setFullInspectorOpen] = useState(Boolean(initialLeadId));
  const [inspectorDetail, setInspectorDetail] = useState(null);
  const [inspectorLoading, setInspectorLoading] = useState(false);

  const [mapStyle, setMapStyle] = useState('street'); // 'street' | 'satellite' | 'terrain'
  const [activeHub, setActiveHub] = useState('ALL');
  const [nearMe, setNearMe] = useState(null);
  const [toast, setToast] = useState('');
  const [busyAction, setBusyAction] = useState('');

  // Digest & Portals state
  const [top10, setTop10] = useState([]);
  const [digestMd, setDigestMd] = useState('');
  const [digestHistory, setDigestHistory] = useState([]);
  const [digestCfg, setDigestCfg] = useState({ enabled: true, auto_enrich_top: true, webhook_url: '' });
  const [countriesData, setCountriesData] = useState([]);

  // Add Contact form state
  const [showAddContact, setShowAddContact] = useState(false);
  const [newContact, setNewContact] = useState({ person_name: '', role: '', company: '', phone: '', email: '' });

  // Leaflet refs
  const mapElRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);
  const markersLayerRef = useRef(null);
  const searchInputRef = useRef(null);
  const [mapReadyTick, setMapReadyTick] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(max-width: 860px)');
    const onChange = (e) => setIsMobile(e.matches);
    setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Sync props when opened with specific context
  useEffect(() => {
    if (!isOpen) return;
    if (initialTab) setActiveTab(initialTab);
    if (initialCountry) setCountry(initialCountry);
    if (initialScope !== undefined) setScope(initialScope);
    if (initialLeadId) {
      setSelectedLeadId(initialLeadId);
      setFullInspectorOpen(true);
    } else {
      setFullInspectorOpen(false);
    }
  }, [isOpen, initialTab, initialCountry, initialScope, initialLeadId]);

  const activeFilterCount = (country !== 'ALL' ? 1 : 0) + (scope ? 1 : 0) + (stageFilter ? 1 : 0);
  const hasActiveFilters = Boolean(country !== 'ALL' || scope || stageFilter || searchQ.trim() || nearMe);

  const handleResetFilters = () => {
    setCountry('ALL');
    setScope('');
    setStageFilter('');
    setSearchQ('');
    setNearMe(null);
  };

  const selectedPreviewLead = useMemo(
    () => projects.find((p) => Number(p.id) === Number(selectedLeadId)) || inspectorDetail,
    [projects, selectedLeadId, inspectorDetail],
  );

  const fetchProjects = useCallback(async () => {
    if (!isOpen) return;
    setLoading(true);
    setLoadError('');
    try {
      if (nearMe) {
        const params = new URLSearchParams({
          lat: String(nearMe.lat),
          lng: String(nearMe.lng),
          radiusKm: String(nearMe.radiusKm),
          country,
          scope,
        });
        const res = await fetch(`${apiBase}/api/scanner/projects/nearby?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data?.projects)) throw new Error('Invalid scanner response');
        setProjects(data.projects);
      } else {
        const params = new URLSearchParams({
          country,
          scope,
          stage: stageFilter,
          sort: sortBy,
          q: searchQ,
          limit: '200',
        });
        const res = await fetch(`${apiBase}/api/scanner/projects?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data?.projects)) throw new Error('Invalid scanner response');
        setProjects(data.projects);
      }
    } catch (apiErr) {
      if (hasDirectSupabaseScanner()) {
        try {
          const directProjects = nearMe
            ? (await fetchNearbyProjectsDirect({
              lat: nearMe.lat,
              lng: nearMe.lng,
              radiusKm: nearMe.radiusKm,
              country,
              scope,
            })).projects
            : await fetchScannerProjectsDirect({
              country,
              scope,
              stage: stageFilter,
              sort: sortBy,
              q: searchQ,
              limit: 200,
            });
          setProjects(directProjects);
          setLoadError('');
          return;
        } catch (sbErr) {
          const msg = sbErr.message || apiErr.message || 'Scanner feed unavailable';
          setLoadError(msg);
          setToast(`Failed to load leads: ${msg}`);
          return;
        }
      }
      const msg = apiErr.message || 'Scanner feed unavailable';
      setLoadError(msg);
      setToast(`Failed to load leads: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [isOpen, apiBase, nearMe, country, scope, stageFilter, sortBy, searchQ]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const loadLeadDetail = useCallback(async (leadId) => {
    if (!leadId) {
      setInspectorDetail(null);
      return;
    }
    setInspectorLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/scanner/projects/${leadId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setInspectorDetail(data.project || data);
    } catch {
      if (hasDirectSupabaseScanner()) {
        try {
          const directDetail = await fetchProjectDetailDirect(leadId);
          if (directDetail) {
            setInspectorDetail(directDetail);
            return;
          }
        } catch {
          // keep existing preview data
        }
      }
    } finally {
      setInspectorLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    if (isOpen && selectedLeadId) {
      loadLeadDetail(selectedLeadId);
    } else {
      setInspectorDetail(null);
    }
  }, [isOpen, selectedLeadId, loadLeadDetail]);

  const loadDigestTab = useCallback(async () => {
    try {
      const [tRes, hRes, cRes] = await Promise.all([
        fetch(`${apiBase}/api/scanner/digest/top10?country=${encodeURIComponent(country)}`),
        fetch(`${apiBase}/api/scanner/digest/history`),
        fetch(`${apiBase}/api/scanner/digest/config`),
      ]);
      if (!tRes.ok || !hRes.ok || !cRes.ok) throw new Error('Digest API unavailable');
      const [tData, hData, cData] = await Promise.all([tRes.json(), hRes.json(), cRes.json()]);
      setTop10(Array.isArray(tData.top10) ? tData.top10 : []);
      const hist = Array.isArray(hData.digests) ? hData.digests : [];
      setDigestHistory(hist);
      if (hist[0]?.digest_md) setDigestMd(hist[0].digest_md);
      if (cData?.config) setDigestCfg(cData.config);
    } catch {
      if (hasDirectSupabaseScanner()) {
        try {
          const direct = await fetchDigestTabDirect({ country });
          setTop10(direct.top10);
          setDigestHistory(direct.digests);
          if (direct.digests[0]?.digest_md) setDigestMd(direct.digests[0].digest_md);
          if (direct.config) setDigestCfg(direct.config);
        } catch { /* ignore */ }
      }
    }
  }, [apiBase, country]);

  // The saved webhook address is never sent to the browser, so the field starts empty:
  // saving with it empty keeps the saved address, a new value replaces it.
  const saveDigestConfig = useCallback(async (cfg, okMessage) => {
    try {
      const res = await fetch(`${apiBase}/api/scanner/digest/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.config) throw new Error(data?.error || `HTTP ${res.status}`);
      setDigestCfg(data.config);
      setToast(okMessage);
    } catch (err) {
      setToast(`Digest configuration not saved: ${err.message}`);
    }
  }, [apiBase]);

  const loadPortalsTab = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/scanner/regional/countries`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data?.countries)) throw new Error('Invalid portals response');
      setCountriesData(data.countries);
    } catch {
      setCountriesData(getStaticRegionalCountries());
    }
  }, [apiBase]);

  useEffect(() => {
    if (!isOpen) return;
    if (activeTab === 'digest') loadDigestTab();
    if (activeTab === 'portals') loadPortalsTab();
  }, [isOpen, activeTab, loadDigestTab, loadPortalsTab]);

  // Keyboard shortcuts (Escape closes Inspector -> Preview -> Modal; / focuses search)
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (e.key === 'Escape') {
        if (fullInspectorOpen) {
          setFullInspectorOpen(false);
          if (!isMobile) setSelectedLeadId(null);
        } else if (selectedLeadId) {
          setSelectedLeadId(null);
        } else {
          onClose?.();
        }
      } else if (e.key === '/' && tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, fullInspectorOpen, selectedLeadId, isMobile, onClose]);

  // Initialize Leaflet Map once per radar view open (StrictMode + ResizeObserver safe)
  useEffect(() => {
    if (!isOpen || activeTab !== 'radar' || !mapElRef.current) return undefined;
    let cancelled = false;
    let resizeObs = null;

    ensureLeafletLoaded()
      .then((L) => {
        if (cancelled || !mapElRef.current) return;
        if (mapInstanceRef.current) {
          mapInstanceRef.current.remove();
          mapInstanceRef.current = null;
        }
        const map = L.map(mapElRef.current, { center: [22.8, 56.8], zoom: 6, zoomControl: true });
        markersLayerRef.current = L.layerGroup().addTo(map);
        mapInstanceRef.current = map;
        setMapReadyTick((t) => t + 1);
        requestAnimationFrame(() => map.invalidateSize({ animate: false }));

        if (typeof ResizeObserver !== 'undefined') {
          resizeObs = new ResizeObserver(() => {
            map.invalidateSize({ animate: false });
          });
          resizeObs.observe(mapElRef.current);
        }
      })
      .catch((err) => {
        if (!cancelled) setToast(`Map unavailable: ${err.message}`);
      });

    return () => {
      cancelled = true;
      resizeObs?.disconnect();
      setMapReadyTick(0);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        tileLayerRef.current = null;
        markersLayerRef.current = null;
      }
    };
  }, [isOpen, activeTab]);

  // Ensure Leaflet redraws cleanly whenever mobile toggles back to Map view
  useEffect(() => {
    if (isOpen && activeTab === 'radar' && mobilePane === 'map') {
      const id = setTimeout(() => mapInstanceRef.current?.invalidateSize({ animate: false }), 80);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [isOpen, activeTab, mobilePane]);

  // Zero-key Esri basemaps synced to theme: Dark Gray Canvas (dark street), World Street (light street),
  // Hybrid Imagery + Boundaries/Places Labels (satellite), World Topo (terrain)
  useEffect(() => {
    const map = mapInstanceRef.current;
    const L = window.L;
    if (!isOpen || activeTab !== 'radar' || !map || !L) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
      tileLayerRef.current = null;
    }

    if (mapStyle === 'satellite') {
      const imagery = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Tiles &copy; Esri', maxNativeZoom: 17, maxZoom: 19 },
      );
      const refLabels = L.tileLayer(
        'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        { maxNativeZoom: 16, maxZoom: 19, opacity: 0.92 },
      );
      tileLayerRef.current = L.layerGroup([imagery, refLabels]).addTo(map);
    } else if (mapStyle === 'terrain') {
      tileLayerRef.current = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Tiles &copy; Esri', maxNativeZoom: 17, maxZoom: 19 },
      ).addTo(map);
    } else if (theme === 'dark') {
      const darkBase = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Tiles &copy; Esri', maxNativeZoom: 16, maxZoom: 19 },
      );
      const darkLabels = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
        { maxNativeZoom: 16, maxZoom: 19, opacity: 0.95 },
      );
      tileLayerRef.current = L.layerGroup([darkBase, darkLabels]).addTo(map);
    } else {
      tileLayerRef.current = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Tiles &copy; Esri', maxNativeZoom: 17, maxZoom: 19 },
      ).addTo(map);
    }
  }, [isOpen, activeTab, mapStyle, theme, mapReadyTick]);

  // Plot custom HTML Radar Pins with Golden-Angle dispersion
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layer = markersLayerRef.current;
    const L = window.L;
    if (!isOpen || activeTab !== 'radar' || !map || !layer || !L) return;

    layer.clearLayers();
    const coordSeen = new Map();
    const bounds = [];

    for (const lead of projects) {
      const baseLat = Number(lead.lat);
      const baseLng = Number(lead.lon ?? lead.lng);
      if (!Number.isFinite(baseLat) || !Number.isFinite(baseLng)) continue;

      const key = `${baseLat.toFixed(3)},${baseLng.toFixed(3)}`;
      const idx = coordSeen.get(key) || 0;
      coordSeen.set(key, idx + 1);

      let lat = baseLat;
      let lng = baseLng;
      if (idx > 0) {
        const angle = idx * 2.39996;
        const radius = 0.008 * Math.sqrt(idx);
        lat += radius * Math.cos(angle);
        lng += radius * Math.sin(angle);
      }
      bounds.push([lat, lng]);

      const isSelected = Number(selectedLeadId) === Number(lead.id);
      const pinClasses = [
        styles.radarPin,
        isSelected
          ? styles.radarPinSelected
          : (lead.heat_score >= 70 ? styles.radarPinHot : (lead.stage === 'tender' ? styles.radarPinTender : '')),
      ].filter(Boolean).join(' ');

      const icon = L.divIcon({
        className: styles.radarPinWrapper,
        html: `<span class="${pinClasses}"></span>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });

      const marker = L.marker([lat, lng], { icon, zIndexOffset: isSelected ? 600 : (lead.heat_score >= 70 ? 200 : 0) });
      marker.bindTooltip(`${lead.flag} ${lead.title} (Heat ${lead.heat_score})`, { direction: 'top' });
      marker.on('click', () => {
        setSelectedLeadId(lead.id);
        setFullInspectorOpen(!isMobile);
      });
      marker.addTo(layer);
    }

    if (nearMe && Number.isFinite(nearMe.lat) && Number.isFinite(nearMe.lng)) {
      L.circle([nearMe.lat, nearMe.lng], {
        radius: nearMe.radiusKm * 1000,
        color: '#10b981',
        fillColor: '#10b981',
        fillOpacity: 0.1,
      }).addTo(layer);
    }

    if (bounds.length > 0 && !selectedLeadId && activeHub === 'ALL') {
      try {
        map.fitBounds(bounds, { padding: [36, 36], maxZoom: 11 });
      } catch { /* ignore */ }
    }
  }, [isOpen, activeTab, projects, selectedLeadId, nearMe, isMobile, activeHub, mapReadyTick]);

  // Group leads by Source for scrollable list
  const groupedLeads = useMemo(() => {
    const groups = {
      'Oman Tender Board': [],
      'GCC Regional Intelligence': [],
      'Other Opportunities': [],
    };
    for (const p of projects) {
      if (p.source_name === 'Oman Tender Board') groups['Oman Tender Board'].push(p);
      else if (p.source_name === 'BNC Network' || /BNC|GCC/i.test(p.source_name || '')) groups['GCC Regional Intelligence'].push(p);
      else groups['Other Opportunities'].push(p);
    }
    return Object.entries(groups).filter(([, arr]) => arr.length > 0);
  }, [projects]);

  const handleSelectLeadFromList = (lead) => {
    setSelectedLeadId(lead.id);
    setFullInspectorOpen(true);
    const map = mapInstanceRef.current;
    if (map && Number.isFinite(lead.lat) && Number.isFinite(lead.lon ?? lead.lng)) {
      map.flyTo([lead.lat, lead.lon ?? lead.lng], 11, { duration: 0.7 });
    }
  };

  const handleFitBounds = () => {
    setActiveHub('ALL');
    const map = mapInstanceRef.current;
    if (!map || projects.length === 0) return;
    const pts = projects
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon ?? p.lng))
      .map((p) => [p.lat, p.lon ?? p.lng]);
    if (pts.length > 0) map.fitBounds(pts, { padding: [36, 36], maxZoom: 11 });
  };

  const handleHubJump = (hub) => {
    setActiveHub(hub.id);
    if (hub.id === 'ALL' || !Number.isFinite(hub.lat)) {
      handleFitBounds();
      return;
    }
    mapInstanceRef.current?.flyTo([hub.lat, hub.lng], hub.zoom, { duration: 0.65 });
  };

  const handleNearMe = () => {
    if (!navigator.geolocation) {
      setToast('Geolocation not supported by this browser.');
      return;
    }
    setBusyAction('geo');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusyAction('');
        setNearMe({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          radiusKm: 60,
        });
        setMobilePane('map');
        mapInstanceRef.current?.flyTo([pos.coords.latitude, pos.coords.longitude], 10);
        setToast('Showing opportunities within 60km of your location');
      },
      (err) => {
        setBusyAction('');
        setToast(`GPS permission declined or unavailable (${err.message})`);
      },
      { timeout: 8000 },
    );
  };

  const runLiveAction = async (kind) => {
    if (busyAction) return;
    setBusyAction(kind);
    try {
      if (kind === 'scan') {
        const res = await fetch(`${apiBase}/api/scanner/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'standard', country }),
        });
        const data = await res.json();
        setToast(`Live Scan finished: ${data.discovered || 0} feeds checked (${data.inserted || 0} new, ${data.updated || 0} updated)`);
        await fetchProjects();
      } else if (kind === 'observer') {
        const res = await fetch(`${apiBase}/api/scanner/observer/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 12 }),
        });
        const data = await res.json();
        setToast(`Observer checked ${data.checked || 0} active leads (${data.changes || 0} stage updates detected)`);
        await fetchProjects();
      } else if (kind === 'digest') {
        const res = await fetch(`${apiBase}/api/scanner/digest/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ country, autoEnrich: true, notify: true }),
        });
        const data = await res.json();
        if (data?.digest?.digest_md) setDigestMd(data.digest.digest_md);
        if (Array.isArray(data?.top10)) setTop10(data.top10);
        setToast(`Generated Top ${data?.top10?.length || 10} Daily AI Digest`);
        await loadDigestTab();
      }
    } catch (err) {
      setToast(`Action failed: ${err.message}`);
    } finally {
      setBusyAction('');
    }
  };

  const handleEnrichLead = async (leadId) => {
    setBusyAction('enrich');
    try {
      const res = await fetch(`${apiBase}/api/scanner/projects/${leadId}/enrich`, { method: 'POST' });
      const data = await res.json();
      setInspectorDetail(data.project || data);
      setToast('AI executive brief & web contact cross-reference refreshed');
      fetchProjects();
    } catch (err) {
      setToast(`Enrich failed: ${err.message}`);
    } finally {
      setBusyAction('');
    }
  };

  const handlePatchLead = async (leadId, patch) => {
    try {
      const res = await fetch(`${apiBase}/api/scanner/projects/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      setInspectorDetail(data.project || data);
      fetchProjects();
    } catch (err) {
      setToast(`Update failed: ${err.message}`);
    }
  };

  const handleCreateContact = async (e) => {
    e.preventDefault();
    if (!inspectorDetail?.id) return;
    try {
      const res = await fetch(`${apiBase}/api/scanner/projects/${inspectorDetail.id}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newContact),
      });
      const data = await res.json();
      setInspectorDetail(data.project || inspectorDetail);
      setShowAddContact(false);
      setNewContact({ person_name: '', role: '', company: '', phone: '', email: '' });
      setToast('Contact saved to Supabase');
    } catch (err) {
      setToast(`Contact save failed: ${err.message}`);
    }
  };

  const handleExportCsv = () => {
    const cols = ['id', 'country_name', 'city', 'governorate', 'stage', 'heat_score', 'title', 'client', 'contractor', 'est_value_omr', 'value_note', 'source_url'];
    const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [
      cols.join(','),
      ...projects.map((p) => cols.map((c) => escape(p[c])).join(',')),
    ].join('\n');
    const blob = new Blob([rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gcc-market-radar-${country.toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadDigestMd = () => {
    if (!digestMd) return;
    const blob = new Blob([digestMd], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `top10-tender-digest-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  return (
    <div
      className={styles.modalBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label="GCC & Oman Construction Market Radar"
      onDragEnter={(e) => e.stopPropagation()}
      onDragOver={(e) => e.stopPropagation()}
      onDrop={(e) => e.stopPropagation()}
    >
      <div className={styles.modalShell}>
        {/* Top Command Header */}
        <div className={styles.modalTopBar}>
          <div className={styles.modalTitleGroup}>
            <h2 className={styles.modalTitleText}>
              <span className={styles.liveDot} />
              <span>GCC &amp; Oman Market Radar</span>
            </h2>

            <div className={styles.modeTabs}>
              <button
                type="button"
                className={`${styles.modeTabBtn} ${activeTab === 'radar' ? styles.modeTabBtnActive : ''}`}
                onClick={() => setActiveTab('radar')}
              >
                🗺️ Radar ({projects.length})
              </button>
              <button
                type="button"
                className={`${styles.modeTabBtn} ${activeTab === 'digest' ? styles.modeTabBtnActive : ''}`}
                onClick={() => setActiveTab('digest')}
              >
                🌟 Top 10 Digest
              </button>
              <button
                type="button"
                className={`${styles.modeTabBtn} ${activeTab === 'portals' ? styles.modeTabBtnActive : ''}`}
                onClick={() => setActiveTab('portals')}
              >
                🏛️ Portals
              </button>
            </div>
          </div>

          <div className={styles.topActionBtns}>
            <button
              type="button"
              className={`${styles.actionPill} ${styles.actionPillPrimary}`}
              onClick={() => runLiveAction('scan')}
              disabled={Boolean(busyAction)}
            >
              <span>{busyAction === 'scan' ? '⟳ Scanning...' : '⟳ Live Scan'}</span>
            </button>
            <button
              type="button"
              className={styles.actionPill}
              onClick={() => runLiveAction('observer')}
              disabled={Boolean(busyAction)}
              title="Run 12-lead chunked observer refresh"
            >
              <span>{busyAction === 'observer' ? '👁️ Checking...' : '👁️ Observer'}</span>
            </button>
            <button type="button" className={styles.actionPill} onClick={handleExportCsv}>
              <span>⬇ CSV</span>
            </button>
            <button type="button" className={styles.closeModalBtn} onClick={onClose} title="Close Radar (Esc)">
              ✕
            </button>
          </div>
        </div>

        {toast && (
          <div className={styles.toastBar}>
            <span>{toast}</span>
            <button type="button" onClick={() => setToast('')} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 800 }}>×</button>
          </div>
        )}

        {/* Filter Bar (collapsible select row on mobile) */}
        {activeTab === 'radar' && (
          <div className={styles.filterToolbar}>
            <div className={styles.mobileSearchLine}>
              <input
                ref={searchInputRef}
                type="search"
                className={styles.searchInput}
                placeholder="Search tenders, hospitals, Wilayat, client... (/)"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
              />
              <button
                type="button"
                className={styles.filterToggleBtn}
                onClick={() => setMobileFiltersOpen((v) => !v)}
              >
                <span>🎛️ Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</span>
              </button>
            </div>

            <div className={`${styles.filterSelectsRow} ${mobileFiltersOpen ? styles.filterSelectsOpen : ''}`}>
              <select className={styles.selectInput} value={country} onChange={(e) => { setCountry(e.target.value); setNearMe(null); }}>
                {COUNTRY_OPTS.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
              <select className={styles.selectInput} value={scope} onChange={(e) => setScope(e.target.value)}>
                {SCOPE_OPTS.map((s) => <option key={s.id || 'all'} value={s.id}>{s.label}</option>)}
              </select>
              <select className={styles.selectInput} value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
                <option value="">All Stages</option>
                {STAGE_OPTS.map((st) => <option key={st} value={st}>{st.toUpperCase()}</option>)}
              </select>
              <select className={styles.selectInput} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="heat">Sort: Heat Score</option>
                <option value="value">Sort: Est. Value</option>
                <option value="deadline">Sort: Bid Deadline</option>
                <option value="updated">Sort: Recently Seen</option>
              </select>
              {nearMe && (
                <button type="button" className={styles.actionPill} onClick={() => setNearMe(null)}>
                  ✕ Clear {nearMe.radiusKm}km Radius
                </button>
              )}
            </div>
          </div>
        )}

        {/* Mobile Docked Map <-> List Switcher (above split pane so zero map overlap) */}
        {activeTab === 'radar' && (
          <div className={styles.mobilePaneToggle}>
            <button
              type="button"
              className={`${styles.mobilePaneBtn} ${mobilePane === 'map' ? styles.mobilePaneBtnActive : ''}`}
              onClick={() => setMobilePane('map')}
            >
              🗺️ Map
            </button>
            <button
              type="button"
              className={`${styles.mobilePaneBtn} ${mobilePane === 'list' ? styles.mobilePaneBtnActive : ''}`}
              onClick={() => setMobilePane('list')}
            >
              📋 List ({projects.length})
            </button>
          </div>
        )}

        {/* TAB 1: Geospatial Radar Split */}
        {activeTab === 'radar' && (
          <div className={styles.modalBodySplit}>
            <div className={`${styles.leadListPane} ${isMobile && mobilePane !== 'list' ? styles.mobileHiddenPane : ''}`}>
              {loading && projects.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading leads...</div>
              ) : loadError && projects.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                  <span>Unable to reach scanner feed ({loadError}).</span>
                  <button type="button" className={styles.btnEstimate} onClick={fetchProjects}>
                    Retry
                  </button>
                </div>
              ) : groupedLeads.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                  <span>No leads match current filters.</span>
                  {hasActiveFilters && (
                    <button type="button" className={styles.btnInspect} onClick={handleResetFilters}>
                      Reset All Filters
                    </button>
                  )}
                </div>
              ) : (
                groupedLeads.map(([groupName, groupItems]) => (
                  <div key={groupName}>
                    <div className={styles.groupHeader}>
                      <span>{groupName}</span>
                      <span>{groupItems.length}</span>
                    </div>
                    {groupItems.map((lead) => (
                      <div
                        key={lead.id}
                        className={`${styles.compactLeadItem} ${Number(selectedLeadId) === Number(lead.id) ? styles.compactLeadItemActive : ''}`}
                        onClick={() => handleSelectLeadFromList(lead)}
                      >
                        <div className={styles.leadCardHead}>
                          <span className={styles.countryLoc}>
                            {lead.flag} {lead.city || lead.country_name}
                            {lead.governorate && lead.governorate !== lead.city ? ` (${lead.governorate})` : ''}
                            {lead.distance_km !== undefined ? ` · ${lead.distance_km}km` : ''}
                          </span>
                          <span className={`${styles.heatPill} ${lead.heat_score >= 70 ? styles.heatHot : styles.heatWarm}`}>
                            {lead.heat_score >= 70 ? '🔥' : '⚡'} {lead.heat_score}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.84rem', fontWeight: 700, margin: '4px 0', color: 'var(--text-primary)' }}>
                          {lead.title}
                        </div>
                        {lead.ar_title && lead.ar_title !== lead.title && (
                          <div dir="rtl" className={styles.arabicSubtitle} title={lead.ar_title}>
                            {lead.ar_title}
                          </div>
                        )}
                        {(lead.client || lead.reference_no || lead.deadline) && (
                          <div className={styles.leadSubMeta}>
                            {[
                              lead.client,
                              lead.reference_no ? `Ref: ${lead.reference_no}` : '',
                              lead.deadline ? `Closes ${lead.deadline}` : '',
                            ].filter(Boolean).join(' · ')}
                          </div>
                        )}
                        <div className={styles.tagsWrap} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                          <div className={styles.tagsWrap}>
                            <span className={styles.stageBadge}>{lead.stage}</span>
                            <span className={styles.scopeBadge}>{formatValue(lead)}</span>
                          </div>
                          <button
                            type="button"
                            className={styles.btnEstimate}
                            onClick={(e) => {
                              e.stopPropagation();
                              onEstimateLead?.(lead);
                            }}
                            title="Reserve project metadata in BOQ Flow to upload tender BOQ or drawings"
                          >
                            Start BOQ →
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>

            <div className={`${styles.mapPane} ${isMobile && mobilePane !== 'map' ? styles.mobileHiddenPane : ''}`}>
              <div ref={mapElRef} className={styles.mapContainer} />

              <div className={styles.mapFloatingControls}>
                <button
                  type="button"
                  className={`${styles.mapBtn} ${mapStyle === 'street' ? styles.mapBtnActive : ''}`}
                  onClick={() => setMapStyle('street')}
                >
                  Street
                </button>
                <button
                  type="button"
                  className={`${styles.mapBtn} ${mapStyle === 'satellite' ? styles.mapBtnActive : ''}`}
                  onClick={() => setMapStyle('satellite')}
                >
                  Satellite
                </button>
                <button
                  type="button"
                  className={`${styles.mapBtn} ${mapStyle === 'terrain' ? styles.mapBtnActive : ''}`}
                  onClick={() => setMapStyle('terrain')}
                >
                  Terrain
                </button>
                <button type="button" className={styles.mapBtn} onClick={handleFitBounds}>
                  Fit All
                </button>
                <button
                  type="button"
                  className={`${styles.mapBtn} ${nearMe ? styles.mapBtnActive : ''}`}
                  onClick={handleNearMe}
                >
                  📍 Near Me
                </button>
              </div>

              <div className={styles.mapBottomOverlay}>
                {/* Mobile Two-Stage Floating Preview Card on Pin Tap */}
                {isMobile && selectedLeadId && !fullInspectorOpen && selectedPreviewLead && (
                  <div className={styles.mapPreviewCard}>
                    <div className={styles.leadCardHead}>
                      <span className={styles.countryLoc}>
                        {selectedPreviewLead.flag} {selectedPreviewLead.city || selectedPreviewLead.country_name}
                        {selectedPreviewLead.governorate ? ` · ${selectedPreviewLead.governorate}` : ''}
                      </span>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <span className={`${styles.heatPill} ${selectedPreviewLead.heat_score >= 70 ? styles.heatHot : styles.heatWarm}`}>
                          {selectedPreviewLead.heat_score >= 70 ? '🔥' : '⚡'} {selectedPreviewLead.heat_score}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedLeadId(null)}
                          style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '1rem', cursor: 'pointer', padding: '0 4px' }}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {selectedPreviewLead.title}
                    </div>
                    {selectedPreviewLead.ar_title && selectedPreviewLead.ar_title !== selectedPreviewLead.title && (
                      <div dir="rtl" className={styles.arabicSubtitle}>
                        {selectedPreviewLead.ar_title}
                      </div>
                    )}
                    {(selectedPreviewLead.client || selectedPreviewLead.reference_no) && (
                      <div className={styles.leadSubMeta}>
                        {[
                          selectedPreviewLead.client,
                          selectedPreviewLead.reference_no ? `Ref: ${selectedPreviewLead.reference_no}` : '',
                        ].filter(Boolean).join(' · ')}
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                      <span className={styles.stageBadge}>{selectedPreviewLead.stage} · {formatValue(selectedPreviewLead)}</span>
                      <div className={styles.cardBtns}>
                        <button type="button" className={styles.btnInspect} onClick={() => setFullInspectorOpen(true)}>
                          Inspect Details
                        </button>
                        <button type="button" className={styles.btnEstimate} onClick={() => onEstimateLead?.(selectedPreviewLead)}>
                          Start BOQ →
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <div className={styles.mapLegendPill}>
                  <span><i className={styles.legendDot} style={{ background: '#ef4444' }} />Hot 70+</span>
                  <span><i className={styles.legendDot} style={{ background: '#10b981' }} />Tender</span>
                  <span><i className={styles.legendDot} style={{ background: '#3b82f6' }} />Tracked</span>
                </div>

                <div className={styles.mapHubBar} aria-label="Quick map jump regions">
                  {HUB_JUMPS.map((hub) => (
                    <button
                      key={hub.id}
                      type="button"
                      className={`${styles.mapHubBtn} ${activeHub === hub.id ? styles.mapHubBtnActive : ''}`}
                      onClick={() => handleHubJump(hub)}
                    >
                      {hub.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Desktop Slide-Over / Mobile Bottom-Sheet Inspector */}
            {selectedLeadId && fullInspectorOpen && (
              <aside className={styles.inspectorDrawer}>
                <div className={styles.sheetHandle} aria-hidden="true" />
                <div className={styles.inspectorHead}>
                  <div>
                    <div className={styles.countryLoc}>
                      <span>{inspectorDetail?.flag || '🌍'}</span>
                      <span>{inspectorDetail?.city || inspectorDetail?.country_name || 'Loading...'}</span>
                      {inspectorDetail?.reference_no && <span>· {inspectorDetail.reference_no}</span>}
                    </div>
                    <h3 style={{ fontSize: '0.96rem', fontWeight: 800, margin: '4px 0 0', color: 'var(--text-primary)' }}>
                      {inspectorDetail?.title || 'Loading lead details...'}
                    </h3>
                    {inspectorDetail?.ar_title && inspectorDetail.ar_title !== inspectorDetail.title && (
                      <div dir="rtl" className={styles.arabicSubtitle} style={{ WebkitLineClamp: 3 }}>
                        {inspectorDetail.ar_title}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className={styles.closeModalBtn}
                    onClick={() => {
                      setFullInspectorOpen(false);
                      if (!isMobile) setSelectedLeadId(null);
                    }}
                  >
                    ✕
                  </button>
                </div>

                {inspectorLoading && !inspectorDetail ? (
                  <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading lead profile...</div>
                ) : inspectorDetail && (
                  <>
                    <div className={styles.inspectorBody}>
                      <div className={styles.inspectorSection}>
                        <div className={styles.inspectorSectionTitle}>
                          <span>Opportunity Snapshot</span>
                          <span>Heat {inspectorDetail.heat_score}/100</span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.78rem' }}>
                          <div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.68rem' }}>Stage</div>
                            <select
                              className={styles.selectInput}
                              style={{ width: '100%', marginTop: '2px' }}
                              value={inspectorDetail.stage || 'unknown'}
                              onChange={(e) => handlePatchLead(inspectorDetail.id, { stage: e.target.value })}
                            >
                              {STAGE_OPTS.map((st) => <option key={st} value={st}>{st.toUpperCase()}</option>)}
                            </select>
                          </div>
                          <div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.68rem' }}>BOQ Status</div>
                            <select
                              className={styles.selectInput}
                              style={{ width: '100%', marginTop: '2px' }}
                              value={inspectorDetail.boq_status || 'new'}
                              onChange={(e) => handlePatchLead(inspectorDetail.id, { boq_status: e.target.value })}
                            >
                              <option value="new">New Lead</option>
                              <option value="estimating">Estimating</option>
                              <option value="quoted">Quoted</option>
                              <option value="submitted">Submitted</option>
                            </select>
                          </div>
                          <div><strong>Est. Value:</strong> {formatValue(inspectorDetail)}</div>
                          <div><strong>VAT Rate:</strong> {inspectorDetail.vat_percent ?? 5}% ({inspectorDetail.currency})</div>
                          {inspectorDetail.governorate && <div style={{ gridColumn: '1 / -1' }}><strong>Governorate:</strong> {inspectorDetail.governorate}</div>}
                          <div style={{ gridColumn: '1 / -1' }}><strong>Client:</strong> {inspectorDetail.client || 'TBD'}</div>
                          {inspectorDetail.contractor && <div style={{ gridColumn: '1 / -1' }}><strong>Contractor:</strong> {inspectorDetail.contractor}</div>}
                          {inspectorDetail.consultant && <div style={{ gridColumn: '1 / -1' }}><strong>Consultant:</strong> {inspectorDetail.consultant}</div>}
                          {inspectorDetail.deadline && <div style={{ gridColumn: '1 / -1' }}><strong>Bid Closing:</strong> {inspectorDetail.deadline}</div>}
                          {inspectorDetail.tender_type && (
                            <div style={{ gridColumn: '1 / -1' }}>
                              <strong>Tender Type:</strong> {inspectorDetail.tender_type}
                              {inspectorDetail.fee_omr ? ` · Doc Fee ${inspectorDetail.fee_omr} OMR` : ''}
                            </div>
                          )}
                        </div>
                        {inspectorDetail.source_url && (
                          <a
                            href={inspectorDetail.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className={styles.contactLinkBtn}
                            style={{ marginTop: '0.6rem' }}
                          >
                            <span>Open Official Source ↗</span>
                          </a>
                        )}
                      </div>

                      <div className={styles.inspectorSection}>
                        <div className={styles.inspectorSectionTitle}>
                          <span>AI Executive Brief</span>
                          <button
                            type="button"
                            className={styles.btnInspect}
                            onClick={() => handleEnrichLead(inspectorDetail.id)}
                            disabled={busyAction === 'enrich'}
                          >
                            {busyAction === 'enrich' ? 'Enriching...' : '✦ Refresh AI Brief'}
                          </button>
                        </div>
                        <p style={{ fontSize: '0.8rem', lineHeight: 1.48, margin: 0, color: 'var(--text-primary)' }}>
                          {inspectorDetail.ai_brief || inspectorDetail.summary || 'Click Refresh AI Brief to cross-reference GCC sources and extract procurement intelligence.'}
                        </p>
                      </div>

                      <div className={styles.inspectorSection}>
                        <div className={styles.inspectorSectionTitle}>
                          <span>Verified Contacts ({inspectorDetail.contacts?.length || 0})</span>
                          <button
                            type="button"
                            className={styles.btnInspect}
                            onClick={() => setShowAddContact((v) => !v)}
                          >
                            {showAddContact ? 'Cancel' : '+ Add Contact'}
                          </button>
                        </div>

                        {showAddContact && (
                          <form onSubmit={handleCreateContact} style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '0.65rem' }}>
                            <input className={styles.searchInput} placeholder="Full Name" value={newContact.person_name} onChange={(e) => setNewContact({ ...newContact, person_name: e.target.value })} required />
                            <input className={styles.searchInput} placeholder="Role (e.g. Procurement Manager)" value={newContact.role} onChange={(e) => setNewContact({ ...newContact, role: e.target.value })} />
                            <input className={styles.searchInput} placeholder="Phone (+968 ...)" value={newContact.phone} onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })} />
                            <input className={styles.searchInput} placeholder="Email" value={newContact.email} onChange={(e) => setNewContact({ ...newContact, email: e.target.value })} />
                            <button type="submit" className={styles.btnEstimate}>Save Contact</button>
                          </form>
                        )}

                        {(inspectorDetail.contacts || []).length === 0 ? (
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>No direct contacts yet. Click Refresh AI Brief or add manually.</div>
                        ) : (
                          (inspectorDetail.contacts || []).map((c) => {
                            const digits = waNumber(c.phone);
                            return (
                              <div key={c.id || c.contact_key} className={styles.contactCard}>
                                <div style={{ fontSize: '0.8rem', fontWeight: 700 }}>{c.name || c.org || 'Procurement Desk'}</div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                                  {[c.role, c.org].filter(Boolean).join(' · ') || c.source}
                                </div>
                                <div className={styles.contactActions}>
                                  {c.phone && <a href={`tel:${c.phone}`} className={styles.contactLinkBtn}>📞 Call</a>}
                                  {digits.length >= 8 && (
                                    <a href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer" className={styles.contactLinkBtn}>
                                      💬 WhatsApp
                                    </a>
                                  )}
                                  {c.email && <a href={`mailto:${c.email}`} className={styles.contactLinkBtn}>✉️ Email</a>}
                                  {c.website && <a href={c.website} target="_blank" rel="noreferrer" className={styles.contactLinkBtn}>🌐 Portal</a>}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>

                      {(inspectorDetail.updates || []).length > 0 && (
                        <div className={styles.inspectorSection}>
                          <div className={styles.inspectorSectionTitle}><span>Recent Signal History</span></div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '0.75rem' }}>
                            {(inspectorDetail.updates || []).slice(0, 6).map((u) => (
                              <div key={u.id} style={{ color: 'var(--text-secondary)' }}>
                                <strong style={{ color: 'var(--text-primary)' }}>{u.kind || u.field}:</strong> {u.note || `${u.old_value} → ${u.new_value}`}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className={styles.inspectorFoot}>
                      <button
                        type="button"
                        className={styles.estimateBigBtn}
                        onClick={() => onEstimateLead?.(inspectorDetail)}
                      >
                        📌 Reserve Project &amp; Upload BOQ / Drawings →
                      </button>
                    </div>
                  </>
                )}
              </aside>
            )}
          </div>
        )}

        {/* TAB 2: Top 10 Daily Digest */}
        {activeTab === 'digest' && (
          <div className={styles.fullScrollPane}>
            <div className={styles.digestGrid}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800 }}>Top 10 Highest-Converting Opportunities</h3>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      className={`${styles.actionPill} ${styles.actionPillPrimary}`}
                      onClick={() => runLiveAction('digest')}
                      disabled={busyAction === 'digest'}
                    >
                      {busyAction === 'digest' ? 'Generating...' : '✦ Run AI Digest Now'}
                    </button>
                    {digestMd && (
                      <button type="button" className={styles.actionPill} onClick={handleDownloadDigestMd}>
                        ⬇ Download .md
                      </button>
                    )}
                  </div>
                </div>

                {top10.map((lead, idx) => (
                  <div key={lead.id} className={styles.compactLeadItem}>
                    <div className={styles.leadCardHead}>
                      <span className={styles.countryLoc}>
                        <strong>#{idx + 1}</strong> · {lead.flag} {lead.city || lead.country_name}
                      </span>
                      <span className={`${styles.heatPill} ${styles.heatHot}`}>🔥 {lead.heat_score}</span>
                    </div>
                    <div style={{ fontSize: '0.88rem', fontWeight: 700, margin: '4px 0' }}>{lead.title}</div>
                    {lead.ar_title && lead.ar_title !== lead.title && (
                      <div dir="rtl" className={styles.arabicSubtitle}>
                        {lead.ar_title}
                      </div>
                    )}
                    {(lead.client || lead.reference_no || lead.deadline) && (
                      <div className={styles.leadSubMeta}>
                        {[
                          lead.client,
                          lead.reference_no ? `Ref: ${lead.reference_no}` : '',
                          lead.deadline ? `Closes ${lead.deadline}` : '',
                        ].filter(Boolean).join(' · ')}
                      </div>
                    )}
                    <div className={styles.tagsWrap} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                      <div className={styles.tagsWrap}>
                        <span className={styles.stageBadge}>{lead.stage}</span>
                        <span className={styles.scopeBadge}>{formatValue(lead)}</span>
                        <span className={styles.scopeBadge}>{lead.contact_count} contacts</span>
                      </div>
                      <div className={styles.cardBtns}>
                        <button
                          type="button"
                          className={styles.btnInspect}
                          onClick={() => { setActiveTab('radar'); setSelectedLeadId(lead.id); setFullInspectorOpen(true); }}
                        >
                          Inspect
                        </button>
                        <button
                          type="button"
                          className={styles.btnEstimate}
                          onClick={() => onEstimateLead?.(lead)}
                        >
                          Start BOQ →
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                <div className={styles.inspectorSection}>
                  <div className={styles.inspectorSectionTitle}><span>Executive Digest Markdown</span></div>
                  <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.76rem', color: 'var(--text-secondary)', margin: 0, maxHeight: '260px', overflowY: 'auto' }}>
                    {digestMd || 'Click "Run AI Digest Now" to generate and archive a fresh Top 10 Daily Digest into Supabase.'}
                  </pre>
                </div>

                <div className={styles.inspectorSection}>
                  <div className={styles.inspectorSectionTitle}><span>Digest Webhook &amp; Alerts Config</span></div>
                  <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                    Slack / Teams / Discord Webhook URL (optional)
                  </label>
                  <input
                    className={styles.searchInput}
                    style={{ width: '100%', marginBottom: '8px' }}
                    placeholder={digestCfg.webhook_set
                      ? `Saved (${digestCfg.webhook_host || 'webhook'}) — paste a new URL to replace it`
                      : 'https://hooks.slack.com/services/...'}
                    value={digestCfg.webhook_url || ''}
                    onChange={(e) => setDigestCfg({ ...digestCfg, webhook_url: e.target.value })}
                  />
                  <button
                    type="button"
                    className={styles.btnEstimate}
                    onClick={() => saveDigestConfig(digestCfg, 'Digest configuration saved to Supabase')}
                  >
                    Save Config
                  </button>
                  {digestCfg.webhook_set && (
                    <button
                      type="button"
                      className={styles.contactLinkBtn}
                      style={{ marginLeft: '8px', cursor: 'pointer' }}
                      onClick={() => saveDigestConfig({ ...digestCfg, webhook_url: '', clear_webhook: true }, 'Digest webhook removed')}
                    >
                      Remove webhook
                    </button>
                  )}
                </div>

                {digestHistory.length > 0 && (
                  <div className={styles.inspectorSection}>
                    <div className={styles.inspectorSectionTitle}><span>Archived Digests ({digestHistory.length})</span></div>
                    {digestHistory.slice(0, 5).map((d) => (
                      <div
                        key={d.id}
                        style={{ fontSize: '0.76rem', padding: '5px 0', cursor: 'pointer', borderBottom: '1px solid var(--border-color)' }}
                        onClick={() => setDigestMd(d.digest_md || d.summary_text || '')}
                      >
                        <strong>{d.title}</strong> ({d.leads_count} leads)
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: GCC Procurement Portals Directory */}
        {activeTab === 'portals' && (
          <div className={styles.fullScrollPane}>
            <div className={styles.portalsGrid}>
              {countriesData.map((c) => (
                <div key={c.code} className={styles.inspectorSection}>
                  <div className={styles.inspectorSectionTitle}>
                    <span>{c.flag} {c.name}</span>
                    <span>VAT {c.vatPercent}% · {c.currency}</span>
                  </div>
                  {(c.platforms || []).map((plat) => (
                    <div key={plat.id} className={styles.contactCard}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                        <strong style={{ fontSize: '0.82rem' }}>{plat.name}</strong>
                        <span className={styles.scopeBadge}>{plat.category}</span>
                      </div>
                      <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', margin: '4px 0 6px' }}>{plat.desc}</div>
                      <a href={plat.url} target="_blank" rel="noreferrer" className={styles.contactLinkBtn}>
                        Open Portal ↗
                      </a>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
