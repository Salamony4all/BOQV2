
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

// Modern workspace images for carousel
const CAROUSEL_IMAGES = [
  'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&q=80', // Modern office
  'https://images.unsplash.com/photo-1497215728101-856f4ea42174?w=800&q=80', // Workspace
  'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=800&q=80', // Interior design
  'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=800&q=80', // Modern furniture
  'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800&q=80', // Sofa design
];

const LOGO_Q_IMAGE = new URL('/geared_q.png', import.meta.url).href;

import { getApiBase } from './utils/apiBase';

const API_BASE = getApiBase();
console.debug('[API] Using API_BASE:', API_BASE);

// Intercept all fetch requests to automatically inject user-defined Gemini API keys
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
          if (options.headers instanceof Headers) {
            options.headers.set('x-google-api-key', aiSettings.googleApiKey || '');
            options.headers.set('x-google-free-key', aiSettings.googleFreeKey || '');
            options.headers.set('x-google-active-tier', aiSettings.activeTier || 'free');
            options.headers.set('x-google-model', aiSettings.model || '');
          } else {
            options.headers = {
              ...options.headers,
              'x-google-api-key': aiSettings.googleApiKey || '',
              'x-google-free-key': aiSettings.googleFreeKey || '',
              'x-google-active-tier': aiSettings.activeTier || 'free',
              'x-google-model': aiSettings.model || ''
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
      {theme === 'dark' ? '☀' : '☾'}
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

  if (aiSettings?.engine !== 'google') return null;

  const models = aiSettings?.verifiedModels && aiSettings.verifiedModels.length > 0
    ? aiSettings.verifiedModels
    : defaultGoogleModels;

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
        title={`Select AI Model (Current: ${currentModel})`}
      >
        🤖
      </button>

      {isOpen && (
        <div className={styles.aiSelectorDropdown}>
          <div className={styles.aiSelectorHeader}>Select AI Model</div>
          <div className={styles.aiSelectorDivider} />
          {models.length === 0 ? (
            <div className={styles.aiSelectorEmpty}>No models. Set API Key in Settings.</div>
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
                {currentModel === m && <span className={styles.aiSelectorCheck}>✓</span>}
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
  const [extractedData, setExtractedData] = useState(null);
  const [error, setError] = useState(null);
  const [isMultiBudgetOpen, setMultiBudgetOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [showLanding, setShowLanding] = useState(true);
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
    
    console.log('🚀 Initializing session:', newSessionId);

    // 1. Cleanup previous session if it existed (from a previous refresh or crash)
    if (oldSessionId && oldSessionId !== newSessionId) {
      console.log('🧹 Requesting cleanup for previous session:', oldSessionId);
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

    // Fetch brands once at the top level
    fetch(apiUrl('/api/brands'))
      .then(res => {
        if (!res.ok) {
          return res.text().then(text => {
             throw new Error(`Server returned ${res.status}: ${text.slice(0, 100)}`);
          });
        }
        return res.json();
      })
      .then(data => setAllBrands(data))
      .catch(err => {
        console.error('Failed to load brands', err);
        setSystemErrors(prev => [...prev, `Cloud Storage Error: ${err.message}`]);
      });

    return () => {
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, []);

  // Image carousel auto-rotate
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentImageIndex((prev) => (prev + 1) % CAROUSEL_IMAGES.length);
    }, 4000);
    return () => clearInterval(interval);
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

  const handleFileUpload = async (file, modelName = null) => {
    // If it's a PDF and no model is selected yet, show the model selection modal
    if (file && file.name.toLowerCase().endsWith('.pdf') && !modelName) {
      setPendingPdfFile(file);
      setIsPdfModalOpen(true);
      return;
    }

    setShowLanding(false);
    setUploading(true);
    setProgress(0);
    setStage('Starting...');
    setError(null);
    setExtractedData(null);

    const isLarge = file.size > 4.4 * 1024 * 1024;
    const useBlob = isLarge && window.location.hostname !== 'localhost';

    try {
      if (useBlob) {
        setStage('Uploading...');

        const fileUrl = await new Promise(async (resolve, reject) => {
          try {
            // Get credentials from server
            const configRes = await fetch(apiUrl('/api/storage/config'));
            const { url: sbUrl, anonKey, bucket } = await configRes.json();
            
            const supabase = createClient(sbUrl, anonKey);
            const filePath = `temp-uploads/${sessionId}/${Date.now()}-${file.name}`;
            
            const { data, error } = await supabase.storage
              .from(bucket)
              .upload(filePath, file, {
                upsert: true,
                onUploadProgress: (e) => {
                   const percent = (e.loaded / e.total) * 100;
                   setStage(`Clould Uploading: ${Math.round(percent)}%`);
                   setProgress(10 + (percent * 0.15)); // Allocate small segment for progress
                }
              });

            if (error) throw error;

            const { data: { publicUrl } } = supabase.storage
              .from(bucket)
              .getPublicUrl(data.path);

            resolve(publicUrl);
          } catch (err) {
            reject(err);
          }
        });

        setStage('Processing...');
        // Now ask the server to process the remote URL
        const res = await fetch(apiUrl('/api/process-blob'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: fileUrl, sessionId })
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(errorData.details || errorData.error || 'Cloud processing failed');
        }
        const response = await res.json();
        setExtractedData(response.data);
        setProgress(100);
        setStage('Complete');
        setTimeout(() => setUploading(false), 500);

      } else {
        // Standard XHR Upload for small files
        setStage('Uploading');
        const formData = new FormData();
        formData.append('file', file);

        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percentComplete = (e.loaded / e.total) * 25;
            setProgress(percentComplete);
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status === 200) {
            const response = JSON.parse(xhr.responseText);
            setExtractedData(response.data);
            setProgress(100);
            setStage(response.isDirectExtraction ? 'Direct Extraction Complete' : 'Extraction Complete');
            setTimeout(() => setUploading(false), 500);
          } else {
            console.error('Upload error details:', xhr.responseText);
            throw new Error('Upload failed');
          }
        });

        xhr.addEventListener('error', () => {
          setError('Network error occurred');
          setUploading(false);
        });

        const uploadUrl = apiUrl('/api/upload');
        console.log('[Upload] uploading to', uploadUrl);
        xhr.open('POST', uploadUrl);
        xhr.setRequestHeader('x-session-id', sessionId);
        xhr.setRequestHeader('x-extraction-mode', 'parallel'); // Request Parallel High-Fidelity Extraction
        if (modelName) {
          xhr.setRequestHeader('x-model-name', modelName);
        }

        const stored = localStorage.getItem('boqflow_company_profile');
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            const aiSettings = parsed.aiSettings;
            if (aiSettings) {
              xhr.setRequestHeader('x-google-api-key', aiSettings.googleApiKey || '');
              xhr.setRequestHeader('x-google-free-key', aiSettings.googleFreeKey || '');
              xhr.setRequestHeader('x-google-active-tier', aiSettings.activeTier || 'free');
            }
          } catch (e) {
            console.error('[XHR Headers] Error reading settings:', e);
          }
        }

        const progressInterval = setInterval(() => {
          setProgress(prev => {
            if (prev < 25) return prev;
            if (prev < 90) return prev + 5;
            return prev;
          });

          if (progress > 25 && progress < 50) setStage('Processing');
          else if (progress >= 50 && progress < 90) setStage('Extracting Tables');
          else if (progress >= 90) setStage('Finalizing');
        }, 300);

        xhr.addEventListener('loadend', () => {
          clearInterval(progressInterval);
        });

        xhr.send(formData);
      }

    } catch (err) {
      console.error('Upload/Process error:', err);
      let errMsg = err.message || 'Failed to process file';


      setError(errMsg);
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
                <span className={styles.logoTextSmall}>BOQ FLOW</span>
              )}
            </div>
            <div style={{ marginLeft: 'auto', marginRight: '1rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
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
                accept=".xls,.xlsx,.pdf,.png,.jpg,.jpeg"
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
                  <span>⚠️ {err}</span>
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
            onClose={() => {
              setIsPdfModalOpen(false);
              setPendingPdfFile(null);
            }}
            onExtract={(modelName) => {
              const file = pendingPdfFile;
              setIsPdfModalOpen(false);
              setPendingPdfFile(null);
              handleFileUpload(file, modelName);
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
      {/* Hamburger Menu - Fixed Top Left */}
      <button className={styles.hamburgerFixed} onClick={onOpenSettings} title="Settings">
        <span className={styles.hamburgerLine}></span>
        <span className={styles.hamburgerLine}></span>
        <span className={styles.hamburgerLine}></span>
      </button>

      {/* Theme Toggle & Model Select - Fixed Top Right */}
      <div style={{ position: 'fixed', top: '20px', right: '20px', zIndex: 10000, display: 'flex', alignItems: 'center', gap: '10px' }}>
        <AiModelSelector defaultGoogleModels={defaultGoogleModels} />
        <ThemeToggle />
      </div>

      {/* Hero Section */}
      <section className={styles.hero}>
        {/* Logo */}
        {/* Logo with Image Q */}
        <div className={styles.logoContainer} onClick={() => window.location.reload()} style={{ cursor: 'pointer' }}>
          {theme === 'dark' && logoWhite ? (
            <img src={logoWhite} alt={companyName} className={styles.landingLogo} />
          ) : logoOriginal ? (
            <img src={logoOriginal} alt={companyName} className={styles.landingLogo} />
          ) : (
            <span className={styles.logoTextSmall} style={{ fontSize: '3rem' }}>
              BOQ FLOW
            </span>
          )}
        </div>

        {/* Main Headline */}
        <h2 className={styles.headline}>
          <span className={styles.headlineAccent}>Automate</span> Your Workflow
        </h2>
        <p className={styles.subheadline}>
          Transform layout drawings and BOQs into professional offers instantly.
          Automate Furniture & Fitout estimation, Multi-Budget alternatives, and PM exports (MAS, MIR, WIR).
        </p>

        {/* Image Carousel */}
        <div className={styles.carouselSection}>
          <div className={styles.carouselWrapper}>
            {CAROUSEL_IMAGES.map((img, idx) => (
              <div
                key={idx}
                className={`${styles.carouselSlide} ${idx === currentImageIndex ? styles.active : ''}`}
              >
                <img src={img} alt={`Workspace ${idx + 1}`} className={styles.carouselImage} />
              </div>
            ))}
          </div>
          {/* Carousel Indicators */}
          <div className={styles.carouselIndicators}>
            {CAROUSEL_IMAGES.map((_, idx) => (
              <button
                key={idx}
                className={`${styles.indicator} ${idx === currentImageIndex ? styles.activeIndicator : ''}`}
                onClick={() => setCurrentImageIndex(idx)}
              />
            ))}
          </div>
        </div>

        {/* CTA Buttons */}
        <div className={styles.ctaGroup}>
          <label className={styles.ctaPrimary}>
            <input
              type="file"
              accept=".xlsx,.xls,.pdf,.png,.jpg,.jpeg"
              style={{ display: 'none' }}
              onChange={(e) => e.target.files[0] && handleFileUpload(e.target.files[0])}
            />
            Upload BOQ
          </label>
          <button className={styles.ctaPrimary} onClick={handleStartNewBOQ}>
            Create New BOQ
          </button>
          <label className={styles.ctaPrimary}>
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              style={{ display: 'none' }}
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files);
                if (files.length > 0) {
                  setCurrentPlanFiles(files);
                  setUploadedPlanFile(files[0]);
                  setIsPlanScopeOpen(true);
                }
                e.target.value = '';
              }}
            />
            Upload Plan
          </label>
        </div>
      </section>

      {/* Stats Section */}
      <section className={styles.statsSection}>
        <div className={styles.stat}>
          <div className={styles.statValue}>10x</div>
          <div className={styles.statLabel}>Faster Processing</div>
        </div>
        <div className={styles.statDivider} />
        <div className={styles.stat}>
          <div className={styles.statValue}>Unlimited</div>
          <div className={styles.statLabel}>Scalability</div>
        </div>
        <div className={styles.statDivider} />
        <div className={styles.stat}>
          <div className={styles.statValue}>100%</div>
          <div className={styles.statLabel}>Accuracy</div>
        </div>
      </section>

      {/* Features Section */}
      <section className={styles.featuresSection}>
        <h2 className={styles.sectionTitle}>Everything You Need</h2>
        <div className={styles.featuresGrid}>
          <div
            className={`${styles.featureCard} ${styles.featureCardFeatured}`}
            onClick={() => setValueEngineeredOpen(true)}
            style={{ cursor: 'pointer', userSelect: 'none' }}
            title="Launch Value Engineered Offer"
          >
            <h3 className={styles.featureTitle}>✨ VALUE ENGINEERED OFFER</h3>
            <p className={styles.featureDesc}>
              Upload your BOQ (Excel/PDF) or Plan drawings, configure category-specific brand preferences, and let the AI produce a single, optimized value-engineered offer — one best-fit product per line item, ready in minutes.
            </p>
          </div>
          <div className={styles.featureCard}>
            <h3 className={styles.featureTitle}>Plan to BOQ</h3>
            <p className={styles.featureDesc}>
              Instantly extract furniture and fitout quantities from layout drawings using specialized AI geometric analysis
            </p>
          </div>
          <div className={styles.featureCard}>
            <h3 className={styles.featureTitle}>Fitout Estimation</h3>
            <p className={styles.featureDesc}>
              Specialized module for glass walls, flooring, and ceiling works with deep internal database synchronization
            </p>
          </div>
          <div className={styles.featureCard}>
            <h3 className={styles.featureTitle}>PM Exports</h3>
            <p className={styles.featureDesc}>
              Professional project management bundle: Export MAS, MIR, WIR, and Delivery Notes in one click
            </p>
          </div>
          <div className={styles.featureCard}>
            <h3 className={styles.featureTitle}>Multi-Budget</h3>
            <p className={styles.featureDesc}>
              Create budgetary, mid-range, and high-end alternatives instantly with automated brand matching
            </p>
          </div>
          <div className={styles.featureCard}>
            <h3 className={styles.featureTitle}>Visual Catalogs</h3>
            <p className={styles.featureDesc}>
              Beautiful PowerPoint and PDF presentations featuring high-resolution product showcases and specs
            </p>
          </div>
          <div className={styles.featureCard}>
            <h3 className={styles.featureTitle}>AI Scraping</h3>
            <p className={styles.featureDesc}>
              Automatically fetch real-time product data, images, and technical specifications from global brand websites
            </p>
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
        onClose={() => setIsPdfModalOpen(false)}
        fileName={pendingPdfFile?.name}
        onExtract={(model) => {
          setIsPdfModalOpen(false);
          handleFileUpload(pendingPdfFile, model);
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
        planPreviewUrl={planPreviewUrl}
        planPreviewType={planPreviewType}
        planPreviewName={planPreviewName}
      />
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
function App() {
  return (
    <CompanyProvider>
      <ScrapingProvider>
        <AppWithSetup />
      </ScrapingProvider>
    </CompanyProvider>
  );
}

export default App;
