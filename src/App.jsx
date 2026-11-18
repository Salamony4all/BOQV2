import { useState, useEffect, useRef } from 'react';
import ActionCard from './components/ActionCard';
import ProgressModal from './components/ProgressModal';
import TableViewer from './components/TableViewer';
import MultiBudgetModal from './components/MultiBudgetModal';
import PlanScopeModal from './components/PlanScopeModal';
import CompanySettings from './components/CompanySettings';
import { useCompanyProfile, CompanyProvider } from './context/CompanyContext';
import { ScrapingProvider } from './context/ScrapingContext';
import styles from './styles/App.module.css';
import { useTheme } from './context/ThemeContext';
import PdfModelModal from './components/PdfModelModal';
import ValueEngineeredModal from './components/ValueEngineeredModal';
import CostingModal from './components/CostingModal';
import { MODEL_OPTIONS } from './utils/aiConstants';

import { createClient } from '@supabase/supabase-js';

import { getApiBase } from './utils/apiBase';
import { getBrandLogo, getBrandLogoFallback } from './utils/urlUtils';

const FEATURED_PARTNER_BRANDS = [
  { name: 'NARBUTAS', origin: 'Lithuania • Workstations', aliases: ['narbutas'] },
  { name: 'SEDUS STOLL', origin: 'Germany • Ergonomic', aliases: ['sedus stoll', 'sedus'] },
  { name: 'ARPER', origin: 'Italy • Soft Seating', aliases: ['arper'] },
  { name: 'FREZZA', origin: 'Italy • Executive', aliases: ['frezza'] },
  { name: 'NURUS', origin: 'Turkey • Contract', aliases: ['nurus'] },
  { name: 'TEKNION', origin: 'Canada • Systems', aliases: ['teknion me', 'teknion'] },
  { name: 'LAS MOBILI', origin: 'Italy • Office', aliases: ['las mobili', 'las'] },
  { name: 'DAUPHIN', origin: 'Germany • Task Seating', aliases: ['dauphin', 'dauphin products, collections and more'] },
  { name: 'SOKOA', origin: 'France • Seating', aliases: ['sokoa'] },
  { name: 'B&T DESIGN', origin: 'Turkey • Collaborative', aliases: ['b&t design', 'bt design', 'b&t'] },
  { name: 'OFIFRAN', origin: 'Spain • Executive', aliases: ['ofifran'] },
  { name: 'RIM', origin: 'Czechia • Task & Soft', aliases: ['rim'] },
  { name: 'OTTIMO', origin: 'UAE • Fitout & Office', aliases: ['ottimo furniture', 'ottimo'] },
  { name: 'M&W', origin: 'Systems • Partition & Desk', aliases: ['mw structure test', 'm&w'] },
  { name: 'INTERSTUHL', origin: 'Germany • Performance', aliases: ['interstuhl'] },
  { name: 'PEDRALI', origin: 'Italy • Hospitality', aliases: ['pedrali'] },
  { name: 'HERMAN MILLER', origin: 'USA • Iconic Contract', aliases: ['herman miller'] },
  { name: 'VITRA', origin: 'Switzerland • Design', aliases: ['vitra'] }
];

const findBrandCatalogCount = (brandEntry, allBrands = []) => {
  if (!Array.isArray(allBrands) || allBrands.length === 0) return 0;
  const targets = [brandEntry.name, ...(brandEntry.aliases || [])].map(s => s.toLowerCase().trim());
  let maxCount = 0;
  for (const b of allBrands) {
    const bn = String(b?.name || '').toLowerCase().trim();
    if (!bn) continue;
    const matched = targets.some(t => bn === t || (t.length >= 4 && bn.includes(t)));
    if (matched) {
      const count = Array.isArray(b.products) ? b.products.length : (Number(b.productCount) || 0);
      if (count > maxCount) maxCount = count;
    }
  }
  return maxCount;
};

const API_BASE = getApiBase();
console.debug('[API] Using API_BASE:', API_BASE);

// Intercept all fetch requests to automatically inject user-defined Gemini / AI API keys and models
const originalFetch = window.fetch;
window.fetch = async function (url, options = {}) {
  const urlStr = typeof url === 'string' ? url : (url instanceof URL ? url.toString() : '');
  if (urlStr.includes('/api/')) {
    const stored = localStorage.getItem('boqflow_company_profile');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        const aiSettings = parsed.aiSettings;
        if (aiSettings) {
          const headersToAdd = {
            'x-google-api-key': aiSettings.googleApiKey || '',
            'x-google-free-key': aiSettings.googleFreeKey || '',
            'x-google-active-tier': aiSettings.activeTier || 'free',
            'x-google-model': aiSettings.model || '',
            'x-model-name': aiSettings.model || '',
            'x-ai-provider': aiSettings.engine || 'google',
            'x-provider': aiSettings.engine || 'google',
            'x-openrouter-key': aiSettings.openrouterApiKey || '',
            'x-openrouter-model': aiSettings.model || '',
            'x-nvidia-key': aiSettings.nvidiaApiKey || '',
            'x-nvidia-model': aiSettings.model || '',
            'x-local-url': aiSettings.localLlmUrl || ''
          };

          if (options.headers instanceof Headers) {
            Object.entries(headersToAdd).forEach(([k, v]) => {
              if (v && !options.headers.has(k)) {
                options.headers.set(k, v);
              }
            });
          } else {
            options.headers = {
              ...headersToAdd,
              ...options.headers
            };
          }
        }
      } catch (e) {
        console.error('[Fetch Interceptor] Error parsing profile for headers:', e);
      }
    }
  }
  return originalFetch(url, options);
};

const apiUrl = (path) => {
  // If a base is configured, join it with the path.
  // Otherwise, use a relative path to allow the dev server proxy to work.
  const base = API_BASE || '';
  const finalPath = path.startsWith('/') ? path : `/${path}`;
  const url = base ? `${base}${finalPath}` : finalPath;

  // Sanity check: avoid generating invalid URLs like ":3001/..."
  if (url.startsWith(':')) {
    console.warn('[API] Generated invalid API URL, falling back to localhost:', url);
    return `http://localhost:3001${finalPath}`;
  }

  return url;
};
// Theme Toggle Component
const ThemeToggle = () => {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      style={{
        background: theme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)',
        border: theme === 'dark' ? '1px solid rgba(255, 255, 255, 0.2)' : '1px solid rgba(0, 0, 0, 0.1)',
        borderRadius: '50%',
        width: '40px',
        height: '40px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color: theme === 'dark' ? '#fbbf24' : '#d97706', // Darker amber for light mode visibility
        fontSize: '1.2rem',
        zIndex: 100,
        backdropFilter: 'blur(5px)',
        transition: 'all 0.2s',
        boxShadow: theme === 'dark' ? 'none' : '0 2px 5px rgba(0,0,0,0.05)'
      }}
      title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
    >
      {theme === 'dark' ? (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
};

// AI Model Selector Component
const AiModelSelector = ({ defaultGoogleModels }) => {
  const { aiSettings, updateAiSettings } = useCompanyProfile();
  const { theme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const currentEngine = aiSettings?.engine || 'google';
  const models = currentEngine === 'google'
    ? (aiSettings?.verifiedModels && aiSettings.verifiedModels.length > 0 ? aiSettings.verifiedModels : defaultGoogleModels)
    : currentEngine === 'openrouter' && aiSettings?.verifiedOpenRouterModels && aiSettings.verifiedOpenRouterModels.length > 0
    ? aiSettings.verifiedOpenRouterModels
    : currentEngine === 'nvidia' && aiSettings?.verifiedNvidiaModels && aiSettings.verifiedNvidiaModels.length > 0
    ? aiSettings.verifiedNvidiaModels
    : (MODEL_OPTIONS[currentEngine] || []);

  const currentModel = aiSettings?.model || '';

  return (
    <div ref={dropdownRef} className={styles.aiSelectorWrapper}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: theme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)',
          border: theme === 'dark' ? '1px solid rgba(255, 255, 255, 0.2)' : '1px solid rgba(0, 0, 0, 0.1)',
          borderRadius: '50%',
          width: '40px',
          height: '40px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: theme === 'dark' ? '#fbbf24' : '#6d28d9', // Amber in dark mode, deep purple in light mode
          fontSize: '1.2rem',
          zIndex: 100,
          backdropFilter: 'blur(5px)',
          transition: 'all 0.2s',
          boxShadow: theme === 'dark' ? 'none' : '0 2px 5px rgba(0,0,0,0.05)',
          padding: 0
        }}
        title={`Select AI Model (${currentEngine}: ${currentModel})`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <rect x="9" y="9" width="6" height="6" />
          <line x1="9" y1="1" x2="9" y2="4" />
          <line x1="15" y1="1" x2="15" y2="4" />
          <line x1="9" y1="20" x2="9" y2="23" />
          <line x1="15" y1="20" x2="15" y2="23" />
          <line x1="20" y1="9" x2="23" y2="9" />
          <line x1="20" y1="14" x2="23" y2="14" />
          <line x1="1" y1="9" x2="4" y2="9" />
          <line x1="1" y1="14" x2="4" y2="14" />
        </svg>
      </button>

      {isOpen && (
        <div className={styles.aiSelectorDropdown}>
          <div className={styles.aiSelectorHeader}>Select AI Model ({currentEngine.toUpperCase()})</div>
          <div className={styles.aiSelectorDivider} />
          {models.length === 0 ? (
            <div className={styles.aiSelectorEmpty}>No models available for {currentEngine}.</div>
          ) : (
            models.map(m => (
              <button
                key={m}
                onClick={() => {
                  updateAiSettings({ model: m });
                  setIsOpen(false);
                }}
                className={`${styles.aiSelectorOption} ${currentModel === m ? styles.aiSelectorOptionActive : ''}`}
              >
                <span>{m}</span>
                {currentModel === m && <span className={styles.aiSelectorCheck}><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg></span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

function AppContent({ onOpenSettings }) {
  const { 
    logoOriginal, 
    logoWhite, 
    companyName, 
    aiSettings, 
    accentColor, 
    secondaryColor,
    updateAiSettings
  } = useCompanyProfile();
  const { theme } = useTheme();

  // Update document title dynamically
  useEffect(() => {
    if (companyName) {
      document.title = `${companyName} | Intelligent Estimator`;
    }
  }, [companyName]);
  const [defaultGoogleModels, setDefaultGoogleModels] = useState([]);

  // Fetch available models from server on mount
  useEffect(() => {
    fetch(apiUrl('/api/models/available'))
      .then(res => {
        if (res.ok) return res.json();
        throw new Error('Failed to fetch available models');
      })
      .then(data => {
        if (data.google && Array.isArray(data.google)) {
          setDefaultGoogleModels(data.google);
        }
      })
      .catch(err => console.warn('[App] Could not load available models:', err));
  }, []);

  const [sessionId, setSessionId] = useState(() => {
    // Generate initial ID, but it will be managed in useEffect
    return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  });
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [stageDetail, setStageDetail] = useState('');
  const [extractedData, setExtractedData] = useState(null);
  const [error, setError] = useState(null);
  const [isMultiBudgetOpen, setMultiBudgetOpen] = useState(false);
  const [showLanding, setShowLanding] = useState(true);
  const landingBoqInputRef = useRef(null);
  const landingPlanInputRef = useRef(null);
  const [isPlanScopeOpen, setIsPlanScopeOpen] = useState(false);
  const [seededPlanItems, setSeededPlanItems] = useState(null);
  const [allBrands, setAllBrands] = useState([]);
  const [currentPlanFiles, setCurrentPlanFiles] = useState([]);
  const [uploadedPlanFile, setUploadedPlanFile] = useState(null);
  const [planPreviewUrl, setPlanPreviewUrl] = useState(null);
  const [planPreviewType, setPlanPreviewType] = useState(null);
  const [planPreviewName, setPlanPreviewName] = useState(null);
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);
  const [pendingPdfFile, setPendingPdfFile] = useState(null);
  const [pendingPdfFiles, setPendingPdfFiles] = useState(null);
  const [isGlobalDragging, setIsGlobalDragging] = useState(false);
  const [isValueEngineeredOpen, setValueEngineeredOpen] = useState(false);
  const [isCostingOpen, setIsCostingOpen] = useState(false);
  const [pendingVeData, setPendingVeData] = useState(null);
  const [systemErrors, setSystemErrors] = useState([]);

  // Reset environment on app load
  useEffect(() => {
    const oldSessionId = sessionStorage.getItem('boq_session_id');
    const newSessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    
    setSessionId(newSessionId);
    sessionStorage.setItem('boq_session_id', newSessionId);
    
    console.log(' Initializing session:', newSessionId);

    // 1. Cleanup previous session if it existed (from a previous refresh or crash)
    if (oldSessionId && oldSessionId !== newSessionId) {
      console.log(' Requesting cleanup for previous session:', oldSessionId);
      fetch(apiUrl('/api/cleanup/session'), { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: oldSessionId })
      }).catch(err => console.warn('[App] Previous session cleanup failed:', err));
    }

    // 2. Register beforeunload to cleanup current session on close/refresh
    const handleUnload = () => {
      const currentSid = sessionStorage.getItem('boq_session_id');
      if (currentSid) {
        // navigator.sendBeacon is more reliable for cleanup on close
        const url = apiUrl('/api/cleanup/session');
        const data = JSON.stringify({ sessionId: currentSid });
        const blob = new Blob([data], { type: 'application/json' });
        navigator.sendBeacon(url, blob);
      }
    };

    window.addEventListener('beforeunload', handleUnload);

    // Fetch brands once at the top level — feeds allBrands prop consumers
    // (ValueEngineeredModal via App + TableViewer). MultiBudgetModal fetches
    // its own copy; names are normalized identically here so both agree.
    fetch(apiUrl('/api/brands'))
      .then(res => {
        if (!res.ok) {
          return res.text().then(text => {
            throw new Error(`Server returned ${res.status}: ${text.slice(0, 100)}`);
          });
        }
        return res.json();
      })
      .then(data => {
        if (Array.isArray(data)) {
          setAllBrands(data.map(b => ({ ...b, name: String(b.name || '').replace(/\s+/g, ' ').trim() || 'Unnamed Brand' })));
        }
      })
      .catch(err => {
        console.error('Failed to load brands', err);
        setSystemErrors(prev => [...prev, `Cloud Storage Error: ${err.message}`]);
      });

    return () => {
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, []);

  // Generate preview URL for the uploaded plan file
  useEffect(() => {
    if (!uploadedPlanFile) return undefined;

    const objectUrl = URL.createObjectURL(uploadedPlanFile);
    setPlanPreviewUrl(objectUrl);
    setPlanPreviewType(uploadedPlanFile.type || '');
    setPlanPreviewName(uploadedPlanFile.name || 'Uploaded plan');

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [uploadedPlanFile]);

// Helper for XHR-based upload to Supabase Storage with real-time byte-level progress
function uploadToSupabaseWithProgress({ sbUrl, anonKey, bucket, filePath, file, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const cleanSbUrl = sbUrl.replace(/\/$/, '');
    const uploadEndpoint = `${cleanSbUrl}/storage/v1/object/${bucket}/${filePath}`;

    xhr.open('POST', uploadEndpoint);
    xhr.setRequestHeader('Authorization', `Bearer ${anonKey}`);
    xhr.setRequestHeader('apikey', anonKey);
    xhr.setRequestHeader('x-upsert', 'true');
    if (file.type) {
      xhr.setRequestHeader('Content-Type', file.type);
    }

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(e.loaded, e.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const publicUrl = `${cleanSbUrl}/storage/v1/object/public/${bucket}/${filePath}`;
        resolve(publicUrl);
      } else {
        let errMessage = 'Storage upload failed';
        try {
          const res = JSON.parse(xhr.responseText);
          errMessage = res.message || res.error || errMessage;
        } catch (e) {}
        reject(new Error(errMessage));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during cloud upload'));
    xhr.ontimeout = () => reject(new Error('Cloud upload timed out'));

    xhr.send(file);
  });
}

  // Global drag-and-drop support for multi-file PDF / Excel BOQ ingestion
  useEffect(() => {
    let dragCounter = 0;

    const handleDragEnter = (e) => {
      e.preventDefault();
      dragCounter++;
      if (e.dataTransfer?.types && Array.from(e.dataTransfer.types).includes('Files')) {
        setIsGlobalDragging(true);
      }
    };

    const handleDragOver = (e) => {
      e.preventDefault();
    };

    const handleDragLeave = (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        setIsGlobalDragging(false);
      }
    };

    const handleDrop = (e) => {
      e.preventDefault();
      dragCounter = 0;
      setIsGlobalDragging(false);
      const dropped = Array.from(e.dataTransfer?.files || []).filter(Boolean);
      if (dropped.length > 0) {
        handleFileUpload(dropped);
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);

  const handleFileUpload = async (fileOrFiles, modelName = null, pipeline = null, options = null) => {
    // Normalize input to array of files
    const rawFiles = Array.isArray(fileOrFiles)
      ? fileOrFiles
      : (fileOrFiles instanceof FileList ? Array.from(fileOrFiles) : (fileOrFiles ? [fileOrFiles] : []));
    const files = rawFiles.filter(Boolean);

    if (files.length === 0) return;

    // Check if any file is PDF and pipeline not yet chosen
    const hasPdf = files.some(f => f.name.toLowerCase().endsWith('.pdf'));
    if (hasPdf && !pipeline) {
      setPendingPdfFiles(files);
      setPendingPdfFile(files[0]);
      setIsPdfModalOpen(true);
      return;
    }

    setShowLanding(false);
    setUploading(true);
    setProgress(0);
    setError(null);
    setExtractedData(null);

    const totalFiles = files.length;
    const allExtractedTables = [];

    try {
      for (let i = 0; i < totalFiles; i++) {
        const file = files[i];
        const fileIdxStr = totalFiles > 1 ? `[File ${i + 1}/${totalFiles}] ` : '';
        const baseProgress = (i / totalFiles) * 100;
        const progressSlice = (1 / totalFiles) * 100;

        setStage(`${fileIdxStr}Uploading ${file.name}`);
        setStageDetail(`0 MB of ${(file.size / (1024 * 1024)).toFixed(1)} MB`);

        const isLarge = file.size > 4.4 * 1024 * 1024;
        const useBlob = isLarge && window.location.hostname !== 'localhost';

        let singleFileData = null;

        if (useBlob) {
          // Upload to Supabase Storage with XHR
          const fileUrl = await new Promise(async (resolve, reject) => {
            try {
              const configRes = await fetch(apiUrl('/api/storage/config'));
              const { url: sbUrl, anonKey, bucket } = await configRes.json();
              const filePath = `temp-uploads/${sessionId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

              const publicUrl = await uploadToSupabaseWithProgress({
                sbUrl,
                anonKey,
                bucket,
                filePath,
                file,
                onProgress: (loaded, total) => {
                  const pct = (loaded / total) * 100;
                  const currentFileProgress = baseProgress + (pct / 100) * (progressSlice * 0.5);
                  setProgress(Math.round(currentFileProgress));
                  const loadedMb = (loaded / (1024 * 1024)).toFixed(1);
                  const totalMb = (total / (1024 * 1024)).toFixed(1);
                  setStage(`${fileIdxStr}Uploading to Cloud`);
                  setStageDetail(`${loadedMb} MB / ${totalMb} MB (${Math.round(pct)}%)`);
                }
              });
              resolve(publicUrl);
            } catch (err) {
              reject(err);
            }
          });

          // Phase 2 extraction for this file
          setStage(`${fileIdxStr}Extracting Data & Images`);
          setStageDetail('Parsing page layout & table boundaries...');
          setProgress(Math.round(baseProgress + progressSlice * 0.55));

          const extractionModeHeader =
            pipeline === 'docling' ? 'docling' :
            pipeline === 'paddle'  ? 'paddle'  :
            pipeline === 'opendataloader' ? 'opendataloader' :
            pipeline === 'wordcom_vercel' ? 'wordcom_vercel' :
            pipeline === 'wordcom_v22' ? 'wordcom_v22' :
            pipeline === 'wordcom' ? 'wordcom' :
            'parallel';

          const blobHeaders = {
            'Content-Type': 'application/json',
            'x-session-id': sessionId,
            'x-extraction-mode': extractionModeHeader
          };
          if (options?.doclingOcr) blobHeaders['x-docling-ocr'] = '1';
          if (modelName) blobHeaders['x-model-name'] = modelName;

          const storedProfile = localStorage.getItem('boqflow_company_profile');
          if (storedProfile) {
            try {
              const parsed = JSON.parse(storedProfile);
              const aiSettings = parsed?.aiSettings;
              if (aiSettings) {
                blobHeaders['x-google-api-key'] = aiSettings.googleApiKey || '';
                blobHeaders['x-google-free-key'] = aiSettings.googleFreeKey || '';
                blobHeaders['x-google-active-tier'] = aiSettings.activeTier || 'free';
                blobHeaders['x-google-model'] = aiSettings.model || '';
                blobHeaders['x-ai-provider'] = aiSettings.engine || 'google';
                blobHeaders['x-provider'] = aiSettings.engine || 'google';
                blobHeaders['x-openrouter-key'] = aiSettings.openrouterApiKey || '';
                blobHeaders['x-openrouter-model'] = aiSettings.model || '';
                blobHeaders['x-nvidia-key'] = aiSettings.nvidiaApiKey || '';
                blobHeaders['x-nvidia-model'] = aiSettings.model || '';
              }
            } catch (e) {}
          }

          const res = await fetch(apiUrl('/api/process-blob'), {
            method: 'POST',
            headers: blobHeaders,
            body: JSON.stringify({
              url: fileUrl,
              sessionId,
              fileName: file.name,
              fileType: file.type,
              pipeline: extractionModeHeader,
              options,
              modelName
            })
          });

          if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.details || errorData.error || `Processing failed for ${file.name}`);
          }
          const response = await res.json();
          singleFileData = response.data;
        } else {
          // Standard upload for small file
          singleFileData = await new Promise((resolve, reject) => {
            const formData = new FormData();
            formData.append('file', file);
            if (options && typeof options === 'object') {
              formData.append('options', JSON.stringify(options));
            }

            const xhr = new XMLHttpRequest();
            xhr.upload.addEventListener('progress', (e) => {
              if (e.lengthComputable) {
                const pct = (e.loaded / e.total) * 100;
                const currentFileProgress = baseProgress + (pct / 100) * (progressSlice * 0.5);
                setProgress(Math.round(currentFileProgress));
                const loadedMb = (e.loaded / (1024 * 1024)).toFixed(1);
                const totalMb = (e.total / (1024 * 1024)).toFixed(1);
                setStage(`${fileIdxStr}Uploading File`);
                setStageDetail(`${loadedMb} MB / ${totalMb} MB (${Math.round(pct)}%)`);
              }
            });

            xhr.addEventListener('load', () => {
              if (xhr.status === 200) {
                try {
                  const response = JSON.parse(xhr.responseText);
                  resolve(response.data);
                } catch (e) {
                  reject(new Error(`Failed to parse response for ${file.name}`));
                }
              } else {
                reject(new Error(`Upload failed for ${file.name}`));
              }
            });
            xhr.addEventListener('error', () => reject(new Error(`Network error on ${file.name}`)));

            const extractionModeHeader =
              pipeline === 'docling' ? 'docling' :
              pipeline === 'paddle'  ? 'paddle'  :
              pipeline === 'opendataloader' ? 'opendataloader' :
              pipeline === 'wordcom_vercel' ? 'wordcom_vercel' :
              pipeline === 'wordcom_v22' ? 'wordcom_v22' :
              pipeline === 'wordcom' ? 'wordcom' :
              'wordcom_v22';

            xhr.open('POST', apiUrl('/api/upload'));
            xhr.setRequestHeader('x-session-id', sessionId);
            xhr.setRequestHeader('x-extraction-mode', extractionModeHeader);
            if (options?.doclingOcr) xhr.setRequestHeader('x-docling-ocr', '1');
            if (modelName) xhr.setRequestHeader('x-model-name', modelName);

            const stored = localStorage.getItem('boqflow_company_profile');
            if (stored) {
              try {
                const parsed = JSON.parse(stored);
                const aiSettings = parsed.aiSettings;
                if (aiSettings) {
                  xhr.setRequestHeader('x-google-api-key', aiSettings.googleApiKey || '');
                  xhr.setRequestHeader('x-google-free-key', aiSettings.googleFreeKey || '');
                  xhr.setRequestHeader('x-google-active-tier', aiSettings.activeTier || 'free');
                  if (!modelName && aiSettings.model) {
                    xhr.setRequestHeader('x-model-name', aiSettings.model);
                  }
                  xhr.setRequestHeader('x-google-model', aiSettings.model || '');
                  xhr.setRequestHeader('x-ai-provider', aiSettings.engine || 'google');
                  xhr.setRequestHeader('x-provider', aiSettings.engine || 'google');
                  xhr.setRequestHeader('x-openrouter-key', aiSettings.openrouterApiKey || '');
                  xhr.setRequestHeader('x-openrouter-model', aiSettings.model || '');
                  xhr.setRequestHeader('x-nvidia-key', aiSettings.nvidiaApiKey || '');
                  xhr.setRequestHeader('x-nvidia-model', aiSettings.model || '');
                }
              } catch (e) {}
            }

            xhr.send(formData);
          });
        }

        // Process and concatenate tables from this file
        if (singleFileData?.tables && Array.isArray(singleFileData.tables)) {
          singleFileData.tables.forEach((t, tIdx) => {
            const cleanFileName = file.name.replace(/\.[^/.]+$/, '');
            const sheetLabel = t.sheetName 
              ? (totalFiles > 1 ? `[${cleanFileName}] ${t.sheetName}` : t.sheetName)
              : (totalFiles > 1 ? `[${cleanFileName}] Section ${tIdx + 1}` : `Section ${tIdx + 1}`);
            
            allExtractedTables.push({
              ...t,
              sourceFileName: file.name,
              sheetName: sheetLabel
            });
          });
        }

        setProgress(Math.round(baseProgress + progressSlice));
      }

      if (allExtractedTables.length === 0) {
        throw new Error('No tabular data could be extracted from the uploaded document(s).');
      }

      setProgress(100);
      setStage(totalFiles > 1 ? 'Batch BOQ Consolidated!' : 'Direct Extraction Complete');
      setStageDetail(`Successfully extracted ${allExtractedTables.length} table(s) across ${totalFiles} file(s)`);
      setExtractedData({ tables: allExtractedTables, isDirectExtraction: true });
      setTimeout(() => setUploading(false), 600);

    } catch (err) {
      console.error('Batch Upload/Process error:', err);
      setError(err.message || 'Failed to process batch files');
      setUploading(false);
    }
  };


  const handlePlanUpload = (files) => {
    const fileArray = Array.from(files);
    if (fileArray.length > 0) {
      setCurrentPlanFiles(fileArray);
      setUploadedPlanFile(fileArray[0]);
      setIsPlanScopeOpen(true);
    }
  };

  const handlePlanAnalyze = async (scope, provider = aiSettings?.engine || 'google', providerModel = aiSettings?.model) => {
    if (!currentPlanFiles || currentPlanFiles.length === 0) return;

    setIsPlanScopeOpen(false);
    setShowLanding(false);
    setUploading(true);
    setProgress(10);
    setStage('Initializing AI Engine...');
    setError(null);

    const includeFitout = scope === 'both';

    try {
      setStage('Analyzing Geometric Data...');
      setProgress(30);

      const formData = new FormData();
      Array.from(currentPlanFiles).forEach((file) => {
        formData.append('files', file);
      });
      formData.append('includeFitout', includeFitout);

      // Heartbeat for progress bar
      const interval = setInterval(() => {
        setProgress(prev => (prev < 90 ? prev + 1 : prev));
      }, 500);

      formData.append('provider', provider);
      formData.append('providerModel', providerModel);

      const response = await fetch(apiUrl('/api/analyze-plan'), {
        method: 'POST',
        body: formData
      });

      clearInterval(interval);

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const errorMessage = errData.error?.toString().trim() || 'Plan analysis failed';
        throw new Error(errorMessage);
      }

      const data = await response.json();
      if (data && data.items) {
        setSeededPlanItems(data.items);
        
        // Format the extracted items into a table so TableViewer can display them directly
        const planTable = {
          sheetName: "Plan Analysis",
          columnCount: 4,
          header: ["Location", "Code", "Description", "QTY"],
          rows: data.items.map(item => ({
            cells: [
              { value: item.location || item.Location || "General" },
              { value: item.code || "" },
              { value: item.description || item.Description || "" },
              { value: item.qty || item.QTY || "1" }
            ]
          })),
          extractedSummary: {
            totalAmount: 0
          }
        };

        setExtractedData({ tables: [planTable] });
        setProgress(100);
        setStage('Extraction Complete');
        
        setTimeout(() => {
          setUploading(false);
          // Removed automatic setMultiBudgetOpen(true) to allow user-controlled routing
        }, 500);
      } else {
        throw new Error('No items detected in the provided drawings.');
      }
    } catch (err) {
      console.error('Plan analysis error:', err);
      setError(err.message);
      setUploading(false);
    } finally {
      setCurrentPlanFiles([]);
    }
  };

  const handleStartNewBOQ = () => {
    setShowLanding(false);
    setMultiBudgetOpen(true);
  };

  const handleLoadSampleBoq = () => {
    const sampleTable = {
      sheetName: 'Corporate Office Furniture Schedule (Sample)',
      columnCount: 9,
      header: ['Item No', 'Code', 'Image', 'Description', 'Brand', 'Qty', 'Unit', 'Rate', 'Amount'],
      rows: [
        {
          cells: [
            { value: '1' },
            { value: 'WS-01' },
            {
              value: '',
              image: 'https://media.architonic.com/m-on/10001981/product/20727055/narbutas_zedo-desk_b19f7496.jpeg?format=webp&quality=75',
              images: ['https://media.architonic.com/m-on/10001981/product/20727055/narbutas_zedo-desk_b19f7496.jpeg?format=webp&quality=75']
            },
            { value: 'Executive L-Shape Desk with Integrated Return Credenza & Cable Tray | Size: 2000x1800x750mm | Finish: Natural Oak Veneer & Matte Anthracite Base' },
            { value: 'LAS / Narbutas' },
            { value: '4' },
            { value: 'Nos' },
            { value: '1450.00' },
            { value: '5800.00' }
          ]
        },
        {
          cells: [
            { value: '2' },
            { value: 'CH-01' },
            {
              value: '',
              image: 'https://media.architonic.com/m-on/3100165/product/20088118/sedus-stoll_black-dot-air_d69097f7.jpeg?format=webp&quality=75',
              images: ['https://media.architonic.com/m-on/3100165/product/20088118/sedus-stoll_black-dot-air_d69097f7.jpeg?format=webp&quality=75']
            },
            { value: 'Ergonomic High-Back Task Chair with Synchronized Mechanism, 4D Armrests, Lumbar Support & Breathable Black Mesh Back | 5-Star Aluminum Base' },
            { value: 'Sedus / Interstuhl' },
            { value: '36' },
            { value: 'Nos' },
            { value: '420.00' },
            { value: '15120.00' }
          ]
        },
        {
          cells: [
            { value: '3' },
            { value: 'WS-02' },
            {
              value: '',
              image: 'https://media.architonic.com/m-on/10001981/product/20264116/narbutas_nova-u-desks_602d9b06.jpeg?format=webp&quality=75',
              images: ['https://media.architonic.com/m-on/10001981/product/20264116/narbutas_nova-u-desks_602d9b06.jpeg?format=webp&quality=75']
            },
            { value: '4-Person Cluster Bench Workstation with Fabric Acoustic Divider Screens & Flip-Top Power/Data Access | Size: 2800x1400x750mm' },
            { value: 'Narbutas' },
            { value: '8' },
            { value: 'Cluster' },
            { value: '1890.00' },
            { value: '15120.00' }
          ]
        },
        {
          cells: [
            { value: '4' },
            { value: 'MT-01' },
            {
              value: '',
              image: 'https://media.architonic.com/m-on/10001981/product/20732677/narbutas_arqus-meeting-table_7de65d9c.jpeg?format=webp&quality=75',
              images: ['https://media.architonic.com/m-on/10001981/product/20732677/narbutas_arqus-meeting-table_7de65d9c.jpeg?format=webp&quality=75']
            },
            { value: 'Boardroom Conference Table for 12 Pax with Concealed Wire Management & Dual Flip-Up Media Connectivity Boxes | Size: 3800x1400x750mm' },
            { value: 'LAS / Frezza' },
            { value: '2' },
            { value: 'Nos' },
            { value: '2650.00' },
            { value: '5300.00' }
          ]
        },
        {
          cells: [
            { value: '5' },
            { value: 'LS-01' },
            {
              value: '',
              image: 'https://media.architonic.com/m-on/3100165/product/1215599/sedus-stoll_sweetspot_7973a795.jpeg?format=webp&quality=75',
              images: ['https://media.architonic.com/m-on/3100165/product/1215599/sedus-stoll_sweetspot_7973a795.jpeg?format=webp&quality=75']
            },
            { value: 'Reception & Breakout Upholstered Lounge Armchair on Sled Base | Commercial Grade Cat-B Bouclé Fabric | Size: 740x680x780mm' },
            { value: 'Arper / B&T Design' },
            { value: '12' },
            { value: 'Nos' },
            { value: '580.00' },
            { value: '6960.00' }
          ]
        },
        {
          cells: [
            { value: '6' },
            { value: 'ST-01' },
            {
              value: '',
              image: 'https://media.architonic.com/m-on/10001981/product/20727035/narbutas_combus-shelving-system_b877ef07.jpeg?format=webp&quality=75',
              images: ['https://media.architonic.com/m-on/10001981/product/20727035/narbutas_combus-shelving-system_b877ef07.jpeg?format=webp&quality=75']
            },
            { value: 'Medium Height Hinged-Door Storage Cabinet with Soft-Close Hinges, Lock & 3 Adjustable Melamine Shelves | Size: 800x420x1100mm' },
            { value: 'LAS / Ottimo' },
            { value: '14' },
            { value: 'Nos' },
            { value: '390.00' },
            { value: '5460.00' }
          ]
        }
      ],
      extractedSummary: {
        totalRate: 7380,
        totalAmount: 53760,
        totalQty: 76,
        itemCount: 6
      }
    };
    setExtractedData({ tables: [sampleTable] });
    setShowLanding(false);
  };

  const handleMultiBudgetApply = (data) => {
    setExtractedData(data);
    setMultiBudgetOpen(false);
    // Smooth scroll will be handled by useEffect
  };

  const handlePlanSelect = (items) => {
    setSeededPlanItems(items);
    setShowLanding(false); // Move to app view
    setMultiBudgetOpen(true);
  };

  // Smooth scroll to top of results when data appears
  useEffect(() => {
    if (extractedData) {
      setTimeout(() => {
        window.scrollTo({
          top: 0,
          behavior: 'smooth'
        });
      }, 100);
    }
  }, [extractedData]);

  // If we have extracted data or explicitly left landing, show the main app
  if (!showLanding || extractedData) {
    return (
      <div className={styles.app}>
        <div className={styles.container}>
          <header className={styles.headerCompact}>
            <button className={styles.hamburgerBtn} onClick={onOpenSettings} title="Settings">
              <span className={styles.hamburgerLine}></span>
              <span className={styles.hamburgerLine}></span>
              <span className={styles.hamburgerLine}></span>
            </button>
            <div className={styles.logoSmall} onClick={() => { setShowLanding(true); setExtractedData(null); setSeededPlanItems(null); }}>
              {theme === 'dark' && logoWhite ? (
                <img src={logoWhite} alt={companyName} className={styles.headerLogo} />
              ) : logoOriginal ? (
                <img src={logoOriginal} alt={companyName} className={styles.headerLogo} />
              ) : (
                <span className={styles.logoTextSmall}>{companyName || 'BOQ FLOW'}</span>
              )}
            </div>
            <div style={{ marginLeft: 'auto', marginRight: '1rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                type="button"
                onClick={onOpenSettings}
                className={styles.extensionDownloadBtn}
                title="Upload your company logo, set brand colors, and configure AI models"
              >
                <i className="ri-building-2-line" style={{ fontSize: '14px' }} />
                <span>{logoOriginal || logoWhite ? 'Company Branding' : 'Add Company Logo'}</span>
              </button>
              <a
                href="/extension.zip"
                download="AutoBrowserBridge-Extension.zip"
                className={styles.extensionDownloadBtn}
                title="Download the Auto Browser Extension to enable silent Google Lens matching, Tender Board autofill, and portal automation"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                <span>Extension</span>
              </a>
              <AiModelSelector defaultGoogleModels={defaultGoogleModels} />
              <ThemeToggle />
            </div>
          </header>

          {!extractedData && (
            <div className={styles.homeCardGrid}>
              {/* 1. UPLOAD BOQ CARD */}
              {/* 1. UNIVERSAL UPLOAD BOQ CARD */}
              <ActionCard
                title="UPLOAD BOQ"
                iconText="BOQ"
                hint="High-Fidelity Extraction (Excel/PDF/Image)"
                formats="Supports Excel, PDF, PNG, JPG"
                accept=".xls,.xlsx,.xlsb,.pdf,.png,.jpg,.jpeg"
                disabled={uploading}
                onSelect={handleFileUpload}
              />

              {/* 2. UPLOAD PLAN (LAYOUT) CARD */}
              <ActionCard
                title="UPLOAD PLAN"
                iconText="PLAN"
                hint="Extract items from layout"
                formats="Supports PDF, PNG, JPG (Multiple files)"
                accept=".pdf,.png,.jpg,.jpeg"
                multiple={true}
                disabled={uploading}
                onSelect={handlePlanUpload}
              />

              {/* 3. NEW BOQ CARD */}
              <ActionCard
                title="NEW BOQ"
                iconText="NEW"
                hint="Start from scratch"
                disabled={uploading}
                onSelect={() => setMultiBudgetOpen(true)}
              />
            </div>
          )}

          {systemErrors.length > 0 && (
            <div className={styles.systemErrorBanner}>
              {systemErrors.map((err, idx) => (
                <div key={idx} className={styles.systemErrorItem}>
                  <span> {err}</span>
                  <button onClick={() => setSystemErrors(prev => prev.filter((_, i) => i !== idx))}>×</button>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className={styles.error}>
              {error}
            </div>
          )}

          {extractedData && (
            <TableViewer 
              data={extractedData} 
              allBrands={allBrands}
              seededItems={seededPlanItems}
              onUploadBoq={handleFileUpload}
              onUploadPlan={handlePlanUpload}
              planPreviewUrl={planPreviewUrl}
              planPreviewType={planPreviewType}
              planPreviewName={planPreviewName}
            />
          )}

          <MultiBudgetModal
            isOpen={isMultiBudgetOpen}
            onClose={() => setMultiBudgetOpen(false)}
            originalTables={extractedData?.tables || null}
            onApplyFlow={handleMultiBudgetApply}
            seededItems={seededPlanItems}
            onUploadBoq={handleFileUpload}
            onUploadPlan={handlePlanUpload}
            planPreviewUrl={planPreviewUrl}
            planPreviewType={planPreviewType}
            planPreviewName={planPreviewName}
            onOpenValueEngineer={() => setValueEngineeredOpen(true)}
          />

          <PlanScopeModal
            isOpen={isPlanScopeOpen}
            onClose={() => {
              setIsPlanScopeOpen(false);
              setCurrentPlanFiles([]);
              setPlanPreviewUrl(null);
              setPlanPreviewType(null);
              setPlanPreviewName(null);
            }}
            onSelect={handlePlanAnalyze}
          />
          
          <PdfModelModal
            isOpen={isPdfModalOpen}
            fileName={
              pendingPdfFiles && pendingPdfFiles.length > 1
                ? `${pendingPdfFiles.length} PDF Documents (Batch)`
                : pendingPdfFile?.name
            }
            onClose={() => {
              setIsPdfModalOpen(false);
              setPendingPdfFile(null);
              setPendingPdfFiles(null);
            }}
            onExtract={(modelName, pipeline, options) => {
              const filesToProcess = pendingPdfFiles || (pendingPdfFile ? [pendingPdfFile] : []);
              setIsPdfModalOpen(false);
              setPendingPdfFile(null);
              setPendingPdfFiles(null);
              handleFileUpload(filesToProcess, modelName, pipeline, options);
            }}
          />
        </div>

        <ValueEngineeredModal
            isOpen={isValueEngineeredOpen}
            onClose={() => setValueEngineeredOpen(false)}
            allBrands={allBrands}
            originalTables={extractedData?.tables || []}
            seededItems={seededPlanItems}
            onUploadBoq={handleFileUpload}
            onUploadPlan={handlePlanUpload}
            planPreviewUrl={planPreviewUrl}
            planPreviewType={planPreviewType}
            planPreviewName={planPreviewName}
            onApply={(data) => {
                setExtractedData(data);
                setValueEngineeredOpen(false);
                setShowLanding(false);
            }}
        />

        <CostingModal
          isOpen={isCostingOpen}
          onClose={() => setIsCostingOpen(false)}
          onApply={(factors) => {
            if (pendingVeData) {
              setExtractedData({
                ...pendingVeData,
                costingFactors: factors
              });
              setPendingVeData(null);
              setShowLanding(false); // Ensure we leave landing if triggered from there
            }
            setIsCostingOpen(false);
          }}
        />

        <ProgressModal
          isOpen={uploading}
          progress={progress}
          stage={stage}
          stageDetail={stageDetail}
          planPreviewUrl={planPreviewUrl}
          planPreviewType={planPreviewType}
          planPreviewName={planPreviewName}
        />
      </div>
    );
  }

  // Landing Page
  return (
    <div className={styles.landingPage}>
      {/* Sticky Glassmorphic Top Navbar */}
      <header className={styles.landingNavbar}>
        <div className={styles.landingNavInner}>
          <div className={styles.landingNavLeft}>
            <button className={styles.hamburgerBtn} onClick={onOpenSettings} title="Settings">
              <span className={styles.hamburgerLine}></span>
              <span className={styles.hamburgerLine}></span>
              <span className={styles.hamburgerLine}></span>
            </button>
            <div className={styles.landingNavBrand} onClick={() => window.location.reload()} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && window.location.reload()}>
              {(theme === 'dark' && logoWhite) || logoOriginal ? (
                <img
                  src={theme === 'dark' && logoWhite ? logoWhite : logoOriginal}
                  alt={companyName || 'BOQ FLOW'}
                  className={styles.landingNavLogoImg}
                />
              ) : (
                <>
                  <img src="/geared_q.png" alt="BOQ Flow" className={styles.landingNavMark} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                  <div className={styles.landingNavBrandText}>
                    <span className={styles.logoTextSmall}>{companyName || 'BOQ FLOW'}</span>
                    <span className={styles.landingNavBrandBadge}>AI ESTIMATION SUITE</span>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className={styles.landingNavRight}>
            <button
              type="button"
              onClick={onOpenSettings}
              className={styles.extensionDownloadBtn}
              title="Upload your company logo, set brand colors, and configure AI models"
            >
              <i className="ri-building-2-line" style={{ fontSize: '14px' }} />
              <span>{logoOriginal || logoWhite ? 'Company Branding' : 'Add Company Logo'}</span>
            </button>
            <a
              href="/extension.zip"
              download="AutoBrowserBridge-Extension.zip"
              className={styles.extensionDownloadBtn}
              title="Download the Auto Browser Extension to enable silent Google Lens matching, Tender Board autofill, and portal automation"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              <span>Extension</span>
            </a>
            <AiModelSelector defaultGoogleModels={defaultGoogleModels} />
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className={styles.hero}>
        {/* Eyebrow Badge */}
        <div className={styles.heroBadge}>
          <i className="ri-sparkling-2-fill" />
          <span>AI FURNITURE &amp; FITOUT ESTIMATION WORKSPACE</span>
        </div>

        {/* Company Logo / Brand Identity */}
        <div className={styles.logoContainer} onClick={() => window.location.reload()} style={{ cursor: 'pointer' }}>
          {theme === 'dark' && logoWhite ? (
            <img src={logoWhite} alt={companyName} className={styles.landingLogo} />
          ) : logoOriginal ? (
            <img src={logoOriginal} alt={companyName} className={styles.landingLogo} />
          ) : (
            <div className={styles.heroWordmark}>
              <span className={styles.heroWordmarkIcon}><i className="ri-layout-masonry-fill" /></span>
              <span className={styles.logoTextBlue}>BOQ</span>
              <span className={styles.logoTextGold}>FLOW</span>
            </div>
          )}
        </div>

        {/* Main Headline */}
        <h1 className={styles.headline}>
          Turn Layout Drawings &amp; Tender BOQs Into{' '}
          <span className={styles.headlineAccent}>Branded Offers</span> in Minutes
        </h1>
        <p className={styles.subheadline}>
          Purpose-built for corporate furniture suppliers and fitout estimators. Read layout drawings,
          match tender specifications to your partner brands, and export live-formula Excel BOQs,
          PPTX showcases, and MAS/MIR submittals in one click.
        </p>

        {/* Estimator Pillar Pills */}
        <div className={styles.estimatorPills}>
          <span className={styles.estimatorPill}>
            <i className="ri-checkbox-circle-fill" /> AI Drawing &amp; PDF Schedule Takeoff
          </span>
          <span className={styles.estimatorPill}>
            <i className="ri-checkbox-circle-fill" /> Live-Formula Excel, PPTX &amp; MAS
          </span>
          <span className={styles.estimatorPill}>
            <i className="ri-checkbox-circle-fill" /> Instant VE &amp; 3-Tier Brand Matching
          </span>
        </div>

        {/* Above-the-Fold CTA Buttons */}
        <div className={styles.ctaGroup}>
          <label className={styles.ctaPrimary}>
            <input
              ref={landingBoqInputRef}
              type="file"
              accept=".xlsx,.xls,.xlsb,.pdf,.png,.jpg,.jpeg"
              style={{ display: 'none' }}
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files || []).filter(Boolean);
                if (files.length > 0) {
                  handleFileUpload(files);
                }
                e.target.value = '';
              }}
            />
            <i className="ri-file-upload-line" />
            <span>
              <strong>Upload BOQ</strong>
              <small className={styles.ctaSub}>Excel • PDF • Spec Schedule</small>
            </span>
          </label>

          <label className={styles.ctaPlan}>
            <input
              ref={landingPlanInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              style={{ display: 'none' }}
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files || []).filter(Boolean);
                if (files.length > 0) {
                  setCurrentPlanFiles(files);
                  setUploadedPlanFile(files[0]);
                  setIsPlanScopeOpen(true);
                }
                e.target.value = '';
              }}
            />
            <i className="ri-draft-line" />
            <span>
              <strong>Upload Floor Plan</strong>
              <small className={styles.ctaSub}>CAD PDF • Layout Image</small>
            </span>
          </label>

          <button type="button" className={styles.ctaSecondary} onClick={handleStartNewBOQ}>
            <i className="ri-equalizer-line" />
            <span>
              <strong>3-Tier / New BOQ</strong>
              <small className={styles.ctaSub}>Budget • Mid • High Offers</small>
            </span>
          </button>

          <button type="button" className={styles.ctaDemo} onClick={handleLoadSampleBoq}>
            <i className="ri-play-circle-fill" />
            <span>
              <strong>Try Sample Office Tender</strong>
              <small className={styles.ctaSub}>Instant 1-Click Live Demo</small>
            </span>
          </button>
        </div>

        {/* 3-Step Interactive Workflow Showcase */}
        <div className={styles.pipelineShowcase}>
          <div
            className={styles.pipelineCard}
            onClick={() => landingBoqInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && landingBoqInputRef.current?.click()}
          >
            <div className={styles.pipelineCardTop}>
              <span className={styles.pipelineStepBadge}>STEP 01 • INGEST</span>
              <span className={styles.pipelineIcon}><i className="ri-file-search-line" /></span>
            </div>
            <h3 className={styles.pipelineTitle}>PDF Schedules, Spec Cards &amp; Drawings</h3>
            <p className={styles.pipelineDesc}>
              Extracts multi-page BOQs, LF-code specification sheets, dimensions, finishes, and
              embedded reference images—or counts furniture directly from floor plans.
            </p>
            <div className={styles.pipelineTags}>
              <span className={styles.pipelineTag}>PDF V22 Spatial</span>
              <span className={styles.pipelineTag}>Excel (.xlsx/.xls/.xlsb)</span>
              <span className={styles.pipelineTag}>Floor Plans</span>
            </div>
          </div>

          <div className={styles.pipelineConnector} aria-hidden="true">
            <i className="ri-arrow-right-line" />
          </div>

          <div
            className={styles.pipelineCard}
            onClick={() => setValueEngineeredOpen(true)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setValueEngineeredOpen(true)}
          >
            <div className={styles.pipelineCardTop}>
              <span className={styles.pipelineStepBadge}>STEP 02 • AI MATCH &amp; COST</span>
              <span className={styles.pipelineIcon}><i className="ri-cpu-line" /></span>
            </div>
            <h3 className={styles.pipelineTitle}>Partner Catalogs, VE &amp; 3-Tier Pricing</h3>
            <p className={styles.pipelineDesc}>
              Matches generic or specified items against 50+ contract brands (or via Google Lens
              1:1 visual search) with live Profit, Freight, Customs, and Currency conversion.
            </p>
            <div className={styles.pipelineTags}>
              <span className={styles.pipelineTag}>Budget / Mid / High</span>
              <span className={styles.pipelineTag}>Google Lens 1:1</span>
              <span className={styles.pipelineTag}>EUR/USD → AED/OMR</span>
            </div>
          </div>

          <div className={styles.pipelineConnector} aria-hidden="true">
            <i className="ri-arrow-right-line" />
          </div>

          <div
            className={styles.pipelineCard}
            onClick={handleLoadSampleBoq}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handleLoadSampleBoq()}
          >
            <div className={styles.pipelineCardTop}>
              <span className={styles.pipelineStepBadge}>STEP 03 • SUBMITTALS</span>
              <span className={styles.pipelineIcon}><i className="ri-slideshow-3-line" /></span>
            </div>
            <h3 className={styles.pipelineTitle}>Branded Excel, PPTX &amp; MAS Submittals</h3>
            <p className={styles.pipelineDesc}>
              Exports client-ready Excel offers with live formulas, 16:9 widescreen PowerPoint
              product showcases, Material Approval Sheets (MAS), MIR, WIR, and Delivery Notes.
            </p>
            <div className={styles.pipelineTags}>
              <span className={styles.pipelineTag}>Live Excel Formulas</span>
              <span className={styles.pipelineTag}>5 PPTX Themes</span>
              <span className={styles.pipelineTag}>MAS / MIR / WIR</span>
            </div>
          </div>
        </div>
      </section>

      {/* Pre-Integrated Contract Catalogs Logo Grid */}
      <section className={styles.brandTrustSection}>
        <div className={styles.brandSectionHeader}>
          <span className={styles.brandSectionEyebrow}>PRE-INTEGRATED COMMERCIAL FURNITURE ECOSYSTEM</span>
          <h2 className={styles.brandSectionTitle}>50+ Partner Contract Brands &amp; Live Web Harvester</h2>
          <p className={styles.brandSectionSub}>
            Match tender specifications directly against verified European, Turkish, and North American catalogs — or harvest any manufacturer URL on demand.
          </p>
        </div>

        <div className={styles.brandLogoGrid}>
          {FEATURED_PARTNER_BRANDS.map((brandItem) => {
            const count = findBrandCatalogCount(brandItem, allBrands);
            return (
              <div
                key={brandItem.name}
                className={styles.brandLogoCard}
                onClick={onOpenSettings}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && onOpenSettings()}
                title={`${brandItem.name} — ${brandItem.origin}${count > 0 ? ` (${count} catalog items)` : ''}`}
              >
                <div className={styles.brandLogoWell}>
                  <img
                    src={getBrandLogo(brandItem)}
                    alt={brandItem.name}
                    className={styles.brandLogoImg}
                    loading="lazy"
                    onError={(e) => {
                      e.currentTarget.onerror = null;
                      e.currentTarget.src = getBrandLogoFallback(brandItem.name);
                    }}
                  />
                </div>
                <div className={styles.brandCardInfo}>
                  <span className={styles.brandCardName}>{brandItem.name}</span>
                  <span className={styles.brandCardMeta}>
                    {count > 0 ? `${count} items • ` : ''}{brandItem.origin}
                  </span>
                </div>
              </div>
            );
          })}

          <button
            type="button"
            className={styles.brandLogoCardAction}
            onClick={onOpenSettings}
          >
            <span className={styles.brandActionIcon}><i className="ri-add-circle-line" /></span>
            <span className={styles.brandCardName}>+ Add Any Brand URL</span>
            <span className={styles.brandCardMeta}>Live AI Catalog Harvester</span>
          </button>
        </div>
      </section>

      {/* Stats Section */}
      <section className={styles.statsSection}>
        <div className={styles.stat}>
          <div className={styles.statIcon}><i className="ri-flashlight-fill" /></div>
          <div className={styles.statValue}>10x</div>
          <div className={styles.statLabel}>Faster Tender Turnaround</div>
        </div>
        <div className={styles.statDivider} />
        <div className={styles.stat}>
          <div className={styles.statIcon}><i className="ri-award-line" /></div>
          <div className={styles.statValue}>50+</div>
          <div className={styles.statLabel}>Integrated Contract Brands</div>
        </div>
        <div className={styles.statDivider} />
        <div className={styles.stat}>
          <div className={styles.statIcon}><i className="ri-file-list-3-line" /></div>
          <div className={styles.statValue}>7-in-1</div>
          <div className={styles.statLabel}>Excel, PPTX, Offer, MAS, MIR, WIR &amp; DN</div>
        </div>
        <div className={styles.statDivider} />
        <div className={styles.stat}>
          <div className={styles.statIcon}><i className="ri-palette-line" /></div>
          <div className={styles.statValue}>100%</div>
          <div className={styles.statLabel}>White-Label Your Company Logo</div>
        </div>
      </section>

      {/* Features Section */}
      <section className={styles.featuresSection}>
        <h2 className={styles.sectionTitle}>Everything Your Estimation Team Needs</h2>
        <div className={styles.featuresGrid}>
          <div
            className={`${styles.featureCard} ${styles.featureCardFeatured}`}
            onClick={() => setValueEngineeredOpen(true)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setValueEngineeredOpen(true)}
            title="Launch Value Engineered Offer"
          >
            <div className={styles.featureIconWrap}>
              <i className="ri-vip-diamond-line" />
            </div>
            <h3 className={styles.featureTitle}>VALUE ENGINEERED OFFER</h3>
            <p className={styles.featureDesc}>
              Upload your BOQ (Excel/PDF) or Plan drawings, configure category-specific brand preferences, and let the AI produce a single, optimized value-engineered offer — one best-fit product per line item, ready in minutes.
            </p>
            <span className={styles.featureActionHint}>
              Launch AI Value Engineer <i className="ri-arrow-right-line" />
            </span>
          </div>

          <div
            className={styles.featureCard}
            onClick={() => landingPlanInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && landingPlanInputRef.current?.click()}
          >
            <div className={styles.featureIconWrap}><i className="ri-compasses-2-line" /></div>
            <h3 className={styles.featureTitle}>Plan to BOQ (Drawing Takeoff)</h3>
            <p className={styles.featureDesc}>
              Instantly extract furniture and fitout quantities room-by-room from layout drawings using specialized AI geometric analysis.
            </p>
            <span className={styles.featureActionHint}>Upload Floor Plan <i className="ri-arrow-right-line" /></span>
          </div>

          <div
            className={styles.featureCard}
            onClick={() => setMultiBudgetOpen(true)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setMultiBudgetOpen(true)}
          >
            <div className={styles.featureIconWrap}><i className="ri-layers-line" /></div>
            <h3 className={styles.featureTitle}>Multi-Budget (3-Tier Offers)</h3>
            <p className={styles.featureDesc}>
              Create Budgetary, Mid-Range, and High-End alternatives side-by-side instantly with automated brand matching.
            </p>
            <span className={styles.featureActionHint}>Open 3-Tier Workspace <i className="ri-arrow-right-line" /></span>
          </div>

          <div
            className={styles.featureCard}
            onClick={handleLoadSampleBoq}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handleLoadSampleBoq()}
          >
            <div className={styles.featureIconWrap}><i className="ri-slideshow-line" /></div>
            <h3 className={styles.featureTitle}>Visual PPTX &amp; PDF Catalogs</h3>
            <p className={styles.featureDesc}>
              Generate 5-theme widescreen PowerPoint presentations and client-ready commercial offers featuring high-resolution product images.
            </p>
            <span className={styles.featureActionHint}>Try Sample Export <i className="ri-arrow-right-line" /></span>
          </div>

          <div
            className={styles.featureCard}
            onClick={handleLoadSampleBoq}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handleLoadSampleBoq()}
          >
            <div className={styles.featureIconWrap}><i className="ri-file-shield-2-line" /></div>
            <h3 className={styles.featureTitle}>PM Submittals (MAS, MIR, WIR)</h3>
            <p className={styles.featureDesc}>
              Complete project management submittal bundle: Export MAS, MIR, WIR, Delivery Notes, and live-formula Excel sheets in one click.
            </p>
            <span className={styles.featureActionHint}>Preview Submittals <i className="ri-arrow-right-line" /></span>
          </div>

          <div
            className={styles.featureCard}
            onClick={() => setMultiBudgetOpen(true)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setMultiBudgetOpen(true)}
          >
            <div className={styles.featureIconWrap}><i className="ri-building-4-line" /></div>
            <h3 className={styles.featureTitle}>Fitout &amp; Joinery Estimation</h3>
            <p className={styles.featureDesc}>
              Specialized module for partitions, acoustic walls, flooring, and ceiling works with internal catalog database synchronization.
            </p>
            <span className={styles.featureActionHint}>Open Fitout Builder <i className="ri-arrow-right-line" /></span>
          </div>

          <div
            className={styles.featureCard}
            onClick={onOpenSettings}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && onOpenSettings()}
          >
            <div className={styles.featureIconWrap}><i className="ri-global-line" /></div>
            <h3 className={styles.featureTitle}>White-Label &amp; AI Brand Scraper</h3>
            <p className={styles.featureDesc}>
              Upload your company logo and harvest live product catalogs, images, and technical specs from any manufacturer website.
            </p>
            <span className={styles.featureActionHint}>Configure Branding &amp; Brands <i className="ri-arrow-right-line" /></span>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.footerLogo}>BOQ FLOW</div>
        <p className={styles.footerText}>
          Intelligent BOQ Extraction, Costing & Proposal Engine
        </p>
      </footer>

      <MultiBudgetModal
        isOpen={isMultiBudgetOpen}
        onClose={() => setMultiBudgetOpen(false)}
        originalTables={extractedData?.tables || null}
        onApplyFlow={handleMultiBudgetApply}
        seededItems={seededPlanItems}
        onUploadBoq={handleFileUpload}
        onUploadPlan={handlePlanUpload}
        planPreviewUrl={planPreviewUrl}
        planPreviewType={planPreviewType}
        planPreviewName={planPreviewName}
      />

      <PlanScopeModal
        isOpen={isPlanScopeOpen}
        onClose={() => {
          setIsPlanScopeOpen(false);
          setCurrentPlanFiles([]);
          setUploadedPlanFile(null);
          setPlanPreviewUrl(null);
          setPlanPreviewType(null);
          setPlanPreviewName(null);
        }}
        onSelect={handlePlanAnalyze}
      />

      <PdfModelModal
        isOpen={isPdfModalOpen}
        fileName={pendingPdfFile?.name}
        onClose={() => {
          setIsPdfModalOpen(false);
          setPendingPdfFile(null);
        }}
        onExtract={(model, pipeline, options) => {
          setIsPdfModalOpen(false);
          handleFileUpload(pendingPdfFiles || pendingPdfFile, model, pipeline, options);
          setPendingPdfFile(null);
          setPendingPdfFiles(null);
        }}
      />

      <ValueEngineeredModal
        isOpen={isValueEngineeredOpen}
        onClose={() => setValueEngineeredOpen(false)}
        originalTables={extractedData?.tables || []}
        allBrands={allBrands}
        seededItems={seededPlanItems}
        onUploadBoq={handleFileUpload}
        onUploadPlan={handlePlanUpload}
        planPreviewUrl={planPreviewUrl}
        planPreviewType={planPreviewType}
        planPreviewName={planPreviewName}
        onApply={(data) => {
          setExtractedData(data);
          setValueEngineeredOpen(false);
          setShowLanding(false);
        }}
      />

      <CostingModal
        isOpen={isCostingOpen}
        onClose={() => setIsCostingOpen(false)}
        onApply={(factors) => {
          if (pendingVeData) {
            setExtractedData({
              ...pendingVeData,
              costingFactors: factors
            });
            setPendingVeData(null);
            setShowLanding(false);
          }
          setIsCostingOpen(false);
        }}
      />

      <ProgressModal
        isOpen={uploading}
        progress={progress}
        stage={stage}
        stageDetail={stageDetail}
        planPreviewUrl={planPreviewUrl}
        planPreviewType={planPreviewType}
        planPreviewName={planPreviewName}
      />

      {isGlobalDragging && (
        <div className={styles.dragDropOverlay}>
          <div className={styles.dragDropIcon}></div>
          <h2 className={styles.dragDropTitle}>Drop BOQ Files Here</h2>
          <p className={styles.dragDropSub}>
            Drop one or multiple PDF / Excel BOQ documents to process and consolidate
          </p>
        </div>
      )}
    </div>
  );
}

// Wrapper component that includes the setup modal
function AppWithSetup() {
  const { showSetupModal, setShowSetupModal, isLoading } = useCompanyProfile();

  if (isLoading) {
    return (
      <div className={styles.loadingScreen}>
        <div className={styles.loadingContent}>
          <h1 className={styles.loadingLogo}>BOQ FLOW</h1>
          <p className={styles.loadingText}>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <AppContent onOpenSettings={() => setShowSetupModal(true)} />
      {showSetupModal && (
        <CompanySettings
          isModal={true}
          onClose={() => setShowSetupModal(false)}
        />
      )}
    </>
  );
}

// Main App component with all providers
// Note: CompanyProvider and ThemeProvider are supplied by main.jsx
function App() {
  return (
    <ScrapingProvider>
      <AppWithSetup />
    </ScrapingProvider>
  );
}

export default App;
