
import { useState, useEffect } from 'react';
import { upload as blobUpload } from '@vercel/blob/client';
import FileUpload from './components/FileUpload';
import ProgressModal from './components/ProgressModal';
import TableViewer from './components/TableViewer';
import MultiBudgetModal from './components/MultiBudgetModal';
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

  // Reset environment on app load
  useEffect(() => {
    fetch(apiUrl('/api/reset'), { method: 'POST' })
      .then(() => console.log('Environment reset complete'))
      .catch(console.error);
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

  const handleStartNewBOQ = () => {
    setShowLanding(false);
    setMultiBudgetOpen(true);
  };

  const handleMultiBudgetApply = (data) => {
    setExtractedData(data);
    setMultiBudgetOpen(false);
    // Smooth scroll will be handled by useEffect
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
              <div className={styles.logoSmall} onClick={() => { setShowLanding(true); setExtractedData(null); }}>
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
                <div className={styles.cardWrapper}>
                  <FileUpload
                    onFileSelect={handleFileUpload}
                    disabled={uploading}
                    title="UPLOAD BOQ"
                  />
                </div>

                <div className={styles.newBoqCard} onClick={() => setMultiBudgetOpen(true)}>
                  <div className={styles.cardTitle}>NEW BOQ</div>
                  <div className={styles.cardHint}>Start from scratch</div>
                </div>
              </div>
            )}

            {error && (
              <div className={styles.error}>
                {error}
              </div>
            )}

            {extractedData && (
              <TableViewer data={extractedData} />
            )}

            <MultiBudgetModal
              isOpen={isMultiBudgetOpen}
              onClose={() => setMultiBudgetOpen(false)}
              originalTables={extractedData?.tables || null}
              onApplyFlow={handleMultiBudgetApply}
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
            <img src="/geared_q.png" alt="Q" className={styles.logoImage} />
            <span className={styles.logoTextGold}>FLOW</span>
          </div>

          {/* Main Headline */}
          <h2 className={styles.headline}>
            <span className={styles.headlineAccent}>Automate</span> Your Workflow
          </h2>
          <p className={styles.subheadline}>
            Transform your Bill of Quantities processing with intelligent automation,
            multi-budget alternatives, and professional offer generation
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
            <button className={styles.ctaSecondary} onClick={handleStartNewBOQ}>
              Create New BOQ
            </button>
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
            <div className={styles.featureCard}>
              <h3 className={styles.featureTitle}>Create Offers</h3>
              <p className={styles.featureDesc}>
                Generate professional PDF and Excel offers with branded layouts and custom pricing
              </p>
            </div>
            <div className={styles.featureCard}>
              <h3 className={styles.featureTitle}>Presentations</h3>
              <p className={styles.featureDesc}>
                Beautiful PowerPoint and PDF presentations with product showcases
              </p>
            </div>
            <div className={styles.featureCard}>
              <h3 className={styles.featureTitle}>MAS Documents</h3>
              <p className={styles.featureDesc}>
                Material Approval Sheets with approval workflows and specifications
              </p>
            </div>
            <div className={styles.featureCard}>
              <h3 className={styles.featureTitle}>Multi-Budget</h3>
              <p className={styles.featureDesc}>
                Create budgetary, mid-range, and high-end alternatives instantly
              </p>
            </div>
            <div className={styles.featureCard}>
              <h3 className={styles.featureTitle}>Product Scrapping</h3>
              <p className={styles.featureDesc}>
                Automatically fetch product data, images, and specifications from brand websites
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
