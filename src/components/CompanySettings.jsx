import { useState, useRef, useEffect } from 'react';
import { useCompanyProfile } from '../context/CompanyContext';
import { useTheme } from '../context/ThemeContext';
import { AI_ENGINES, MODEL_OPTIONS, DEFAULT_AI_SETTINGS } from '../utils/aiConstants';
import styles from '../styles/CompanySettings.module.css';
import BrandManagement from './BrandManagement';

export default function CompanySettings({ isModal = false, onClose = null }) {
    const {
        companyName,
        website: storedWebsite,
        logo: storedLogo,
        logoOriginal,
        logoWhite,
        aiSettings: storedAiSettings,
        accentColor: initialAccent,
        secondaryColor: initialSecondary,
        updateProfile,
        updateAiSettings,
        updateAllSettings,
        processLogoFile,
        clearProfile
    } = useCompanyProfile();
    const { theme } = useTheme();

    // Local State
    const [name, setName] = useState(companyName || 'BOQ FLOW');
    const [website, setWebsite] = useState(storedWebsite || '');
    const [logo, setLogo] = useState(storedLogo || {
        base64: logoOriginal || '',
        width: 1561,
        height: 865,
        isLight: false,
        whiteLogo: logoWhite || ''
    });
    const [accentColor, setAccentColor] = useState(initialAccent || '#0f3e67');
    const [secondaryColor, setSecondaryColor] = useState(initialSecondary || '#f59e0b');

    // AI Settings State
    const [selectedEngine, setSelectedEngine] = useState(storedAiSettings?.engine || DEFAULT_AI_SETTINGS.engine);
    const [selectedModel, setSelectedModel] = useState(storedAiSettings?.model || DEFAULT_AI_SETTINGS.model);
    const [googleApiKey, setGoogleApiKey] = useState(storedAiSettings?.googleApiKey || '');
    const [googleFreeKey, setGoogleFreeKey] = useState(storedAiSettings?.googleFreeKey || '');
    const [activeTier, setActiveTier] = useState(storedAiSettings?.activeTier || 'free');
    const [verifiedModels, setVerifiedModels] = useState(storedAiSettings?.verifiedModels || []);
    const [defaultGoogleModels, setDefaultGoogleModels] = useState([]);
    
    // Key testing and visibility states
    const [showApiKey, setShowApiKey] = useState(false);
    const [showFreeKey, setShowFreeKey] = useState(false);
    const [isTestingKey, setIsTestingKey] = useState(false);
    const [testError, setTestError] = useState(null);
    const [testSuccess, setTestSuccess] = useState(null);
    
    // UI State
    const [expandedSection, setExpandedSection] = useState(null); // 'branding', 'ai', or null for collapsed
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [isProcessing, setIsProcessing] = useState(false);
    
    const fileInputRef = useRef(null);

    // Sync from context when it loads
    useEffect(() => {
        if (companyName) setName(companyName);
        if (storedWebsite) setWebsite(storedWebsite);
        if (storedLogo) setLogo(storedLogo);
        if (storedAiSettings?.engine) setSelectedEngine(storedAiSettings.engine);
        if (storedAiSettings?.model) setSelectedModel(storedAiSettings.model);
        if (storedAiSettings?.googleApiKey !== undefined) setGoogleApiKey(storedAiSettings.googleApiKey);
        if (storedAiSettings?.googleFreeKey !== undefined) setGoogleFreeKey(storedAiSettings.googleFreeKey);
        if (storedAiSettings?.activeTier !== undefined) setActiveTier(storedAiSettings.activeTier);
        if (storedAiSettings?.verifiedModels !== undefined) setVerifiedModels(storedAiSettings.verifiedModels);
    }, [companyName, storedWebsite, storedLogo, storedAiSettings]);

    // Fall back to env keys on mount if empty
    useEffect(() => {
        const fetchEnvKeys = async () => {
            try {
                const res = await fetch('/api/ai/env-keys');
                if (res.ok) {
                    const data = await res.json();
                    if (!googleApiKey && data.googleApiKey) {
                        setGoogleApiKey(data.googleApiKey);
                    }
                    if (!googleFreeKey && data.googleFreeKey) {
                        setGoogleFreeKey(data.googleFreeKey);
                    }
                }
            } catch (err) {
                console.warn('[CompanySettings] Failed to fetch fallback env keys:', err);
            }
        };
        
        if (!googleApiKey || !googleFreeKey) {
            fetchEnvKeys();
        }
    }, [googleApiKey, googleFreeKey]);

    // Fetch default Google models from server on mount
    useEffect(() => {
        const fetchAvailableModels = async () => {
            try {
                const res = await fetch('/api/models/available');
                if (res.ok) {
                    const data = await res.json();
                    if (data.google && Array.isArray(data.google)) {
                        setDefaultGoogleModels(data.google);
                    }
                }
            } catch (err) {
                console.warn('[CompanySettings] Failed to fetch default models:', err);
            }
        };
        fetchAvailableModels();
    }, []);

    // Update model when engine changes
    useEffect(() => {
        if (selectedEngine === 'google') {
            const cleanModel = selectedModel.replace(':billed', '');
            const modelsList = verifiedModels.length > 0 ? verifiedModels : defaultGoogleModels;
            
            if (modelsList.length > 0 && !modelsList.includes(cleanModel)) {
                setSelectedModel(modelsList[0]);
            }
        } else {
            const options = MODEL_OPTIONS[selectedEngine];
            if (options && !options.includes(selectedModel)) {
                setSelectedModel(options[0]);
            }
        }
    }, [selectedEngine, verifiedModels, defaultGoogleModels]);

    const handleLogoUpload = async (e, type = 'original') => {
        const file = e.target.files?.[0];
        if (!file) return;

        setError(null);
        setIsProcessing(true);

        try {
            const logoData = await processLogoFile(file);
            setLogo(prev => {
                const current = prev || storedLogo || {};
                if (type === 'white') {
                    return {
                        ...current,
                        whiteLogo: logoData.base64,
                        base64: current.base64 || logoData.base64,
                        width: current.width || logoData.width,
                        height: current.height || logoData.height,
                        isLight: true // Manual white logo is always light
                    };
                } else {
                    if (logoData.detectedColor && accentColor === initialAccent) {
                        setAccentColor(logoData.detectedColor);
                    }
                    return {
                        ...current,
                        base64: logoData.base64,
                        // Only use auto-generated white logo if no manual one exists
                        whiteLogo: (current.whiteLogo && current.whiteLogo !== storedLogo?.whiteLogo) 
                            ? current.whiteLogo 
                            : logoData.whiteLogo,
                        width: logoData.width,
                        height: logoData.height,
                        isLight: logoData.isLight
                    };
                }
            });
            
            setSuccess(`${type === 'white' ? 'White' : 'Colored'} logo uploaded!`);
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            setError(err.message);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleRemoveLogo = (type = 'both') => {
        if (type === 'both') {
            setLogo(null);
        } else if (type === 'white') {
            setLogo(prev => ({ ...prev, whiteLogo: null }));
        } else {
            setLogo(prev => ({ ...prev, base64: null }));
        }
        
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleTestKey = async () => {
        setIsTestingKey(true);
        setTestError(null);
        setTestSuccess(null);
        
        const activeKey = activeTier === 'free' ? googleFreeKey : googleApiKey;
        
        if (!activeKey) {
            setTestError(`Please enter a key for the selected ${activeTier === 'free' ? 'Free' : 'Billed'} tier first.`);
            setIsTestingKey(false);
            return;
        }
        
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${activeKey}`);
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                const errMsg = errData.error?.message || `HTTP ${response.status}: ${response.statusText}`;
                throw new Error(errMsg);
            }
            
            const data = await response.json();
            if (!data.models || !Array.isArray(data.models)) {
                throw new Error('Invalid response structure from Google API.');
            }
            
            const filtered = data.models
                .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
                .map(m => m.name.replace(/^models\//, ''));
                
            if (filtered.length === 0) {
                throw new Error('No models supporting content generation were found for this key.');
            }
            
            setVerifiedModels(filtered);
            setTestSuccess(`Successfully verified key! Found ${filtered.length} authorized models.`);
            
            // Automatically save verifiedModels and keys to context
            updateAiSettings({
                googleApiKey,
                googleFreeKey,
                activeTier,
                verifiedModels: filtered
            });
        } catch (err) {
            console.error('[Key Verification Error]:', err);
            setTestError(err.message || 'Verification failed. Please check your network and API key.');
        } finally {
            setIsTestingKey(false);
        }
    };

    const handleSave = async () => {
        setIsProcessing(true);
        setError('');
        setSuccess('');

        try {
            // Save everything at once to avoid race conditions and multiple re-renders
            const result = await updateAllSettings({
                name: name.trim() || undefined,
                logo: logo,
                website: website.trim(),
                colors: {
                    primary: accentColor,
                    secondary: secondaryColor
                }
            }, {
                engine: selectedEngine,
                model: selectedModel,
                googleApiKey,
                googleFreeKey,
                activeTier,
                verifiedModels
            });

            if (result.success) {
                setSuccess('Settings saved successfully!');
                
                // Keep success message visible for a bit then close if it was a modal
                setTimeout(() => {
                    if (isModal) {
                        onClose();
                    } else {
                        setSuccess('');
                    }
                }, 1500);
            } else {
                setError(result.error || 'Failed to save settings.');
            }
        } catch (err) {
            setError(err.message || 'An error occurred while saving.');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleReset = () => {
        if (window.confirm('Are you sure you want to reset your configuration? This cannot be undone.')) {
            clearProfile();
            setName('');
            setWebsite('');
            setLogo(null);
            setSelectedEngine(DEFAULT_AI_SETTINGS.engine);
            setSelectedModel(DEFAULT_AI_SETTINGS.model);
        }
    };

    const toggleSection = (section) => {
        setExpandedSection(prev => prev === section ? null : section);
    };

    return (
        <div className={isModal ? styles.modalOverlay : styles.settingsPage} onClick={onClose}>
            <div className={isModal ? styles.modalContent : styles.settingsContainer} onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className={styles.header}>
                    <h2 className={styles.title}>
                        {isModal ? 'System Configuration' : 'Company & AI Settings'}
                    </h2>
                    <p className={styles.subtitle}>
                        Manage your company branding and global AI preferences
                    </p>
                </div>

                {/* Form Sections */}
                <div className={styles.form}>
                    <div className={styles.sections}>
                        
                        {/* SECTION 1: BRANDING */}
                        <div className={`${styles.section} ${expandedSection === 'branding' ? styles.expanded : ''}`}>
                            <div className={styles.sectionHeader} onClick={() => toggleSection('branding')}>
                                <h3><i className={styles.brandingIcon}>🏢</i> Company & Branding</h3>
                                <span className={styles.chevron}>▼</span>
                            </div>
                            <div className={styles.sectionContent}>
                                <div className={styles.field}>
                                    <label className={styles.label}>Company Name</label>
                                    <input
                                        type="text"
                                        className={styles.input}
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder="Enter your company name"
                                    />
                                </div>

                                <div className={styles.field}>
                                    <label className={styles.label}>Company Website</label>
                                    <input
                                        type="text"
                                        className={styles.input}
                                        value={website}
                                        onChange={(e) => setWebsite(e.target.value)}
                                        placeholder="e.g. www.alshaya.com"
                                    />
                                </div>

                                <div className={styles.field}>
                                    <label className={styles.label}>Logos</label>
                                    <p className={styles.labelHint}>Upload your company logo in both colored and white versions for use across different themes and exports.</p>
                                    <div className={styles.logoGrid}>
                                        <div className={styles.logoSlot}>
                                            <span className={styles.slotLabel}>Original / Colored</span>
                                            <div className={`${styles.logoPreview} ${styles.logoPreviewLight}`}>
                                                {logo?.base64 && <img src={logo.base64} alt="Colored" className={styles.logoImage} />}
                                            </div>
                                            <div className={styles.slotControls}>
                                                <input type="file" accept="image/*" id="logo-c" className={styles.fileInput} onChange={(e) => handleLogoUpload(e, 'original')} />
                                                <label htmlFor="logo-c" className={styles.uploadBtnSmall}>{logo?.base64 ? 'Change' : 'Upload'}</label>
                                                {logo?.base64 && <button className={styles.removeLink} onClick={() => handleRemoveLogo('original')}>Remove</button>}
                                            </div>
                                        </div>
                                        <div className={styles.logoSlot}>
                                            <span className={styles.slotLabel}>White (Knockout)</span>
                                            <div className={`${styles.logoPreview} ${styles.logoPreviewDark}`}>
                                                {logo?.whiteLogo && <img src={logo.whiteLogo} alt="White" className={styles.logoImage} />}
                                            </div>
                                            <div className={styles.slotControls}>
                                                <input type="file" accept="image/*" id="logo-w" className={styles.fileInput} onChange={(e) => handleLogoUpload(e, 'white')} />
                                                <label htmlFor="logo-w" className={styles.uploadBtnSmall}>{logo?.whiteLogo ? 'Change' : 'Upload'}</label>
                                                {logo?.whiteLogo && <button className={styles.removeLink} onClick={() => handleRemoveLogo('white')}>Remove</button>}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* SECTION 2: AI CONFIGURATION */}
                        <div className={`${styles.section} ${expandedSection === 'ai' ? styles.expanded : ''}`}>
                            <div className={styles.sectionHeader} onClick={() => toggleSection('ai')}>
                                <h3><i className={styles.aiIcon}>🤖</i> Global AI Settings</h3>
                                <span className={styles.chevron}>▼</span>
                            </div>
                            <div className={styles.sectionContent}>
                                <div className={styles.field}>
                                    <label className={styles.label}>Primary AI Provider</label>
                                    <div className={styles.aiGrid}>
                                        {AI_ENGINES.map(engine => (
                                            <div 
                                                key={engine.id}
                                                className={`${styles.engineCard} ${selectedEngine === engine.id ? styles.active : ''}`}
                                                onClick={() => setSelectedEngine(engine.id)}
                                            >
                                                <div className={styles.engineIcon} style={{ background: engine.color }}>{engine.icon}</div>
                                                <div className={styles.engineInfo}>
                                                    <div className={styles.engineName}>{engine.name}</div>
                                                    <div className={styles.engineDesc}>{engine.desc}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {selectedEngine === 'google' && (
                                    <div style={{ marginTop: '16px', marginBottom: '24px', padding: '16px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                                        <h4 style={{ margin: '0 0 16px 0', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Google API Credentials</h4>
                                        
                                        {/* Free Tier Key */}
                                        <div className={styles.field} style={{ marginBottom: '16px' }}>
                                            <label className={styles.label} style={{ fontSize: '0.75rem' }}>Free Tier API Key</label>
                                            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                                <input
                                                    type={showFreeKey ? 'text' : 'password'}
                                                    className={styles.input}
                                                    value={googleFreeKey}
                                                    onChange={(e) => setGoogleFreeKey(e.target.value)}
                                                    placeholder="Enter Google Free Tier API Key"
                                                    style={{ paddingRight: '45px' }}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setShowFreeKey(!showFreeKey)}
                                                    style={{ position: 'absolute', right: '12px', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.1rem' }}
                                                >
                                                    {showFreeKey ? '👁️' : '👁️‍🗨️'}
                                                </button>
                                            </div>
                                        </div>

                                        {/* Billed Tier Key */}
                                        <div className={styles.field} style={{ marginBottom: '16px' }}>
                                            <label className={styles.label} style={{ fontSize: '0.75rem' }}>Billed Tier API Key</label>
                                            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                                <input
                                                    type={showApiKey ? 'text' : 'password'}
                                                    className={styles.input}
                                                    value={googleApiKey}
                                                    onChange={(e) => setGoogleApiKey(e.target.value)}
                                                    placeholder="Enter Google Billed Tier API Key"
                                                    style={{ paddingRight: '45px' }}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setShowApiKey(!showApiKey)}
                                                    style={{ position: 'absolute', right: '12px', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.1rem' }}
                                                >
                                                    {showApiKey ? '👁️' : '👁️‍🗨️'}
                                                </button>
                                            </div>
                                        </div>

                                        {/* Active Tier Selector */}
                                        <div className={styles.field} style={{ marginBottom: '16px' }}>
                                            <label className={styles.label} style={{ fontSize: '0.75rem' }}>Active Tier Preference</label>
                                            <select
                                                value={activeTier}
                                                onChange={(e) => setActiveTier(e.target.value)}
                                                className={styles.modelSelect}
                                                style={{ width: '100%', marginTop: '6px' }}
                                            >
                                                <option value="free">Free Tier Key</option>
                                                <option value="billed">Billed Tier Key</option>
                                            </select>
                                        </div>

                                        {/* Test active key */}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                            <button
                                                type="button"
                                                className={styles.saveBtn}
                                                onClick={handleTestKey}
                                                disabled={isTestingKey}
                                                style={{
                                                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                                                    boxShadow: '0 4px 6px -1px rgba(16, 185, 129, 0.2)',
                                                    width: '100%',
                                                    padding: '10px'
                                                }}
                                            >
                                                {isTestingKey ? 'Verifying Key...' : 'Test Active Key'}
                                            </button>
                                            
                                            {testError && <div style={{ color: '#ef4444', fontSize: '0.8rem', padding: '6px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '6px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>⚠️ {testError}</div>}
                                            {testSuccess && <div style={{ color: '#10b981', fontSize: '0.8rem', padding: '6px', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '6px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>✅ {testSuccess}</div>}

                                            {/* Verified Models Display */}
                                            {verifiedModels && verifiedModels.length > 0 && (
                                                <div 
                                                    style={{ 
                                                        marginTop: '16px', 
                                                        padding: '16px', 
                                                        background: theme === 'dark' ? 'rgba(139, 92, 246, 0.03)' : 'rgba(139, 92, 246, 0.02)', 
                                                        borderRadius: '12px', 
                                                        border: theme === 'dark' ? '1px dashed rgba(139, 92, 246, 0.3)' : '1px dashed rgba(139, 92, 246, 0.45)',
                                                        boxShadow: 'inset 0 0 12px rgba(139, 92, 246, 0.05)',
                                                        animation: 'fadeIn 0.3s ease-in-out'
                                                    }}
                                                >
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: theme === 'dark' ? '#c084fc' : '#6d28d9', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                            ✓ Verified Models List
                                                        </div>
                                                        <span style={{ fontSize: '0.7rem', padding: '2px 6px', background: theme === 'dark' ? 'rgba(139, 92, 246, 0.2)' : 'rgba(139, 92, 246, 0.1)', color: theme === 'dark' ? '#e9d5ff' : '#6d28d9', borderRadius: '20px', fontWeight: 600 }}>
                                                            {verifiedModels.length} Models
                                                        </span>
                                                    </div>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxHeight: '120px', overflowY: 'auto', padding: '2px', scrollbarWidth: 'thin' }}>
                                                        {verifiedModels.map(m => (
                                                            <span
                                                                key={m}
                                                                style={{
                                                                    fontSize: '0.7rem',
                                                                    padding: '4px 10px',
                                                                    background: theme === 'dark' ? 'rgba(139, 92, 246, 0.1)' : 'rgba(139, 92, 246, 0.06)',
                                                                    color: theme === 'dark' ? '#e9d5ff' : '#5b21b6',
                                                                    borderRadius: '8px',
                                                                    border: theme === 'dark' ? '1px solid rgba(139, 92, 246, 0.2)' : '1px solid rgba(139, 92, 246, 0.25)',
                                                                    transition: 'all 0.2s ease',
                                                                    cursor: 'default'
                                                                }}
                                                                onMouseOver={(e) => {
                                                                    e.currentTarget.style.background = theme === 'dark' ? 'rgba(139, 92, 246, 0.2)' : 'rgba(139, 92, 246, 0.12)';
                                                                    e.currentTarget.style.borderColor = theme === 'dark' ? 'rgba(139, 92, 246, 0.4)' : 'rgba(139, 92, 246, 0.45)';
                                                                }}
                                                                onMouseOut={(e) => {
                                                                    e.currentTarget.style.background = theme === 'dark' ? 'rgba(139, 92, 246, 0.1)' : 'rgba(139, 92, 246, 0.06)';
                                                                    e.currentTarget.style.borderColor = theme === 'dark' ? 'rgba(139, 92, 246, 0.2)' : 'rgba(139, 92, 246, 0.25)';
                                                                }}
                                                            >
                                                                {m}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                <div className={styles.field}>
                                    <label className={styles.label}>Default Model</label>
                                    <select 
                                        className={styles.modelSelect}
                                        value={selectedModel}
                                        onChange={(e) => setSelectedModel(e.target.value)}
                                    >
                                        {selectedEngine === 'google' ? (
                                            (verifiedModels && verifiedModels.length > 0 ? verifiedModels : defaultGoogleModels).map(m => (
                                                <option key={m} value={m}>{m}</option>
                                            ))
                                        ) : (
                                            MODEL_OPTIONS[selectedEngine]?.map(m => <option key={m} value={m}>{m}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* SECTION 3: BRANDS & DATABASE */}
                        <div className={`${styles.section} ${expandedSection === 'brands' ? styles.expanded : ''}`}>
                            <div className={styles.sectionHeader} onClick={() => toggleSection('brands')}>
                                <h3><i className={styles.brandsIcon}>🔖</i> Brands & Database</h3>
                                <span className={styles.chevron}>▼</span>
                            </div>
                            <div className={styles.sectionContent}>
                                <BrandManagement isStandalone={true} />
                            </div>
                        </div>

                    </div>

                    {/* Messages */}
                    {error && <div className={styles.errorMessage}>{error}</div>}
                    {success && <div className={styles.successMessage}>{success}</div>}
                </div>

                {/* Actions */}
                <div className={styles.actions}>
                    <button className={styles.resetBtn} onClick={handleReset}>Reset All</button>
                    <div className={styles.rightActions}>
                        <button className={styles.saveBtn} onClick={handleSave} disabled={isProcessing}>
                            {isProcessing ? 'Saving...' : 'Save Settings'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
