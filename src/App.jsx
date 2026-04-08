
import { useState, useEffect } from 'react';
import { upload as blobUpload } from '@vercel/blob/client';
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

function AppContent({ onOpenSettings }) {
  const { logoWhite, companyName } = useCompanyProfile();
  const [sessionId] = useState(() => Math.random().toString(36).substring(7));
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

  // Reset environment on app load
  useEffect(() => {
    fetch(apiUrl('/api/reset'), { method: 'POST' })
      .then(() => console.log('Environment reset complete'))
      .catch(console.error);
    
    // Fetch brands once at the top level
    fetch(apiUrl('/api/brands'))
      .then(res => res.json())
      .then(data => setAllBrands(data))
      .catch(err => console.error('Failed to load brands', err));
  }, []);

  // Image carousel auto-rotate
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentImageIndex((prev) => (prev + 1) % CAROUSEL_IMAGES.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);
  const handleFileUpload = async (file) => {
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

        // Direct Client-Side Upload to Free Temp Storage (Bypasses Vercel Blob Limits)
        const fileUrl = await new Promise((resolve, reject) => {
          const formData = new FormData();
          formData.append('file', file);

          const xhr = new XMLHttpRequest();
          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
              setProgress((e.loaded / e.total) * 50); // First 50% is upload
            }
          });

          xhr.addEventListener('load', () => {
            if (xhr.status === 200 || xhr.status === 201) {
              try {
                const response = JSON.parse(xhr.responseText);
                // Convert to direct download format
                resolve(response.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/'));
              } catch (e) {
                reject(new Error('Failed to parse upload provider response'));
              }
            } else {
              reject(new Error(`Cloud upload failed: ${xhr.status}`));
            }
          });

          xhr.addEventListener('error', () => reject(new Error('Network error during cloud upload')));
          xhr.open('POST', 'https://tmpfiles.org/api/v1/upload');
          xhr.send(formData);
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
            setStage('Complete');
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

      // If it's a fetch error during the token phase
      if (err.name === 'BlobError' || errMsg.includes('token')) {
        errMsg = `Vercel Storage Error: ${errMsg}. Check browser console for details.`;
      }

      setError(errMsg);
      setUploading(false);
    }
  };

  const handlePlanAnalyze = async (scope, provider = 'google', providerModel = 'gemini-2.5-flash') => {
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
      currentPlanFiles.forEach((file) => {
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
        throw new Error(errData.error || 'Plan analysis failed');
      }

      const data = await response.json();
      if (data && data.items) {
        setSeededPlanItems(data.items);
        setProgress(100);
        setStage('Extraction Complete');
        setTimeout(() => {
          setUploading(false);
          setMultiBudgetOpen(true);
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
                {logoWhite ? (
                  <img src={logoWhite} alt={companyName} className={styles.headerLogo} />
                ) : (
                  <span className={styles.logoTextSmall}>{companyName || 'BOQFLOW'}</span>
                )}
              </div>
              <div style={{ marginLeft: 'auto', marginRight: '1rem' }}>
                <ThemeToggle />
              </div>
            </header>

            {!extractedData && (
              <div className={styles.homeCardGrid}>
                {/* 1. UPLOAD BOQ CARD */}
                <ActionCard
                  title="UPLOAD BOQ"
                  iconText="BOQ"
                  hint="or click to browse"
                  formats="Supports .xls and .xlsx files (max 50MB)"
                  accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
                  onSelect={(files) => {
                    if (files && files.length > 0) {
                      setCurrentPlanFiles(files);
                      setIsPlanScopeOpen(true);
                    }
                  }}
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

            {error && (
              <div className={styles.error}>
                {error}
              </div>
            )}

            {extractedData && (
              <TableViewer data={extractedData} allBrands={allBrands} />
            )}

            <MultiBudgetModal
              isOpen={isMultiBudgetOpen}
              onClose={() => setMultiBudgetOpen(false)}
              originalTables={extractedData?.tables || null}
              onApplyFlow={handleMultiBudgetApply}
              seededItems={seededPlanItems}
            />

            <PlanScopeModal
              isOpen={isPlanScopeOpen}
              onClose={() => {
                setIsPlanScopeOpen(false);
                setCurrentPlanFiles([]);
              }}
              onSelect={handlePlanAnalyze}
            />
          </div>

          <ProgressModal
            isOpen={uploading}
            progress={progress}
            stage={stage}
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

        {/* Theme Toggle - Fixed Top Right */}
        <div style={{ position: 'fixed', top: '20px', right: '20px', zIndex: 100 }}>
          <ThemeToggle />
        </div>

        {/* Hero Section */}
        <section className={styles.hero}>
          {/* Logo */}
          {/* Logo with Image Q */}
          <div className={styles.logoContainer}>
            <span className={styles.logoTextBlue}>BO</span>
            <img
              src={LOGO_Q_IMAGE}
              alt="Q"
              className={styles.logoImage}
              onError={(event) => event.currentTarget.style.display = 'none'}
            />
            <span className={styles.logoTextGold}>FLOW</span>
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
                accept=".xlsx,.xls,.pdf"
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
            <div className={`${styles.featureCard} ${styles.featureCardFeatured}`}>
              <h3 className={styles.featureTitle}>✨ AI Match & Autofill</h3>
              <p className={styles.featureDesc}>
                Revolutionize your workflow with intelligent brand synchronization. Our engine automatically matches items to your preferred manufacturers, autofills missing technical specs, and optimizes product costs across multiple budget tiers simultaneously.
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
          <div className={styles.footerLogo}>BOQFLOW</div>
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
          onUploadPlan={(files) => {
            if (files && files.length > 0) {
              setCurrentPlanFiles(files);
              setIsPlanScopeOpen(true);
            }
          }}
        />

        <PlanScopeModal
          isOpen={isPlanScopeOpen}
          onClose={() => {
            setIsPlanScopeOpen(false);
            setCurrentPlanFile(null);
          }}
          onSelect={handlePlanAnalyze}
        />

        <ProgressModal
          isOpen={uploading}
          progress={progress}
          stage={stage}
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
          <h1 className={styles.loadingLogo}>BOQFLOW</h1>
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
