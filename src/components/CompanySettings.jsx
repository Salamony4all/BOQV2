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
    
    // Google Keys
    const [googleApiKey, setGoogleApiKey] = useState(storedAiSettings?.googleApiKey || '');
    const [googleFreeKey, setGoogleFreeKey] = useState(storedAiSettings?.googleFreeKey || '');
    const [activeTier, setActiveTier] = useState(storedAiSettings?.activeTier || 'free');
    const [verifiedModels, setVerifiedModels] = useState(storedAiSettings?.verifiedModels || []);
    const [defaultGoogleModels, setDefaultGoogleModels] = useState([]);
    
    // OpenRouter Keys
    const [openrouterApiKey, setOpenrouterApiKey] = useState(storedAiSettings?.openrouterApiKey || '');
    const [isEditingOpenrouterKey, setIsEditingOpenrouterKey] = useState(!storedAiSettings?.openrouterApiKey);
    const [tempOpenrouterKey, setTempOpenrouterKey] = useState('');
    const [showOpenrouterKey, setShowOpenrouterKey] = useState(false);
    const [verifiedOpenRouterModels, setVerifiedOpenRouterModels] = useState(storedAiSettings?.verifiedOpenRouterModels || []);

    // NVIDIA Keys
    const [nvidiaApiKey, setNvidiaApiKey] = useState(storedAiSettings?.nvidiaApiKey || '');
    const [isEditingNvidiaKey, setIsEditingNvidiaKey] = useState(!storedAiSettings?.nvidiaApiKey);
    const [tempNvidiaKey, setTempNvidiaKey] = useState('');
    const [showNvidiaKey, setShowNvidiaKey] = useState(false);
    const [verifiedNvidiaModels, setVerifiedNvidiaModels] = useState(storedAiSettings?.verifiedNvidiaModels || []);

    // Key testing and visibility states
    const [showApiKey, setShowApiKey] = useState(false);
    const [showFreeKey, setShowFreeKey] = useState(false);
    const [testingProvider, setTestingProvider] = useState(null); // 'google' | 'openrouter' | 'nvidia' | null
    const [providerErrors, setProviderErrors] = useState({ google: null, openrouter: null, nvidia: null });
    const [providerSuccesses, setProviderSuccesses] = useState({ google: null, openrouter: null, nvidia: null });
    const [modelSearchQuery, setModelSearchQuery] = useState('');
    
    // UI State
    const [expandedSection, setExpandedSection] = useState(null); // 'branding', 'ai', or null for collapsed
    const [isEditingFreeKey, setIsEditingFreeKey] = useState(!storedAiSettings?.googleFreeKey);
    const [isEditingBilledKey, setIsEditingBilledKey] = useState(!storedAiSettings?.googleApiKey);
    const [tempFreeKey, setTempFreeKey] = useState('');
    const [tempBilledKey, setTempBilledKey] = useState('');
    const [isSavingKey, setIsSavingKey] = useState(null);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [isProcessing, setIsProcessing] = useState(false);
    
    const fileInputRef = useRef(null);
    const isInitializedRef = useRef(false);

    // Sync from context when it loads initially
    useEffect(() => {
        if (!isInitializedRef.current && storedAiSettings) {
            if (companyName) setName(companyName);
            if (storedWebsite) setWebsite(storedWebsite);
            if (storedLogo) setLogo(storedLogo);
            if (storedAiSettings.engine) setSelectedEngine(storedAiSettings.engine);
            if (storedAiSettings.model) setSelectedModel(storedAiSettings.model);
            if (storedAiSettings.googleApiKey !== undefined) {
                setGoogleApiKey(storedAiSettings.googleApiKey);
                setIsEditingBilledKey(!storedAiSettings.googleApiKey);
            }
            if (storedAiSettings.googleFreeKey !== undefined) {
                setGoogleFreeKey(storedAiSettings.googleFreeKey);
                setIsEditingFreeKey(!storedAiSettings.googleFreeKey);
            }
            if (storedAiSettings.activeTier !== undefined) setActiveTier(storedAiSettings.activeTier);
            if (storedAiSettings.verifiedModels !== undefined) setVerifiedModels(storedAiSettings.verifiedModels);

            if (storedAiSettings.openrouterApiKey !== undefined) {
                setOpenrouterApiKey(storedAiSettings.openrouterApiKey);
                setIsEditingOpenrouterKey(!storedAiSettings.openrouterApiKey);
            }
            if (storedAiSettings.verifiedOpenRouterModels !== undefined) {
                setVerifiedOpenRouterModels(storedAiSettings.verifiedOpenRouterModels);
            }

            if (storedAiSettings.nvidiaApiKey !== undefined) {
                setNvidiaApiKey(storedAiSettings.nvidiaApiKey);
                setIsEditingNvidiaKey(!storedAiSettings.nvidiaApiKey);
            }
            if (storedAiSettings.verifiedNvidiaModels !== undefined) {
                setVerifiedNvidiaModels(storedAiSettings.verifiedNvidiaModels);
            }
            isInitializedRef.current = true;
        }
    }, [companyName, storedWebsite, storedLogo, storedAiSettings]);

    const handleSelectEngine = (engineId) => {
        setSelectedEngine(engineId);
        let newModel = selectedModel;
        if (engineId === 'google') {
            const list = verifiedModels.length > 0 ? verifiedModels : defaultGoogleModels;
            if (!list.includes(selectedModel)) newModel = list[0];
        } else if (engineId === 'openrouter') {
            const list = verifiedOpenRouterModels.length > 0 ? verifiedOpenRouterModels : (MODEL_OPTIONS.openrouter || []);
            if (!list.includes(selectedModel)) newModel = list.find(m => m.includes('gemini-2.5-flash') || m.includes('gemini-2.0-flash')) || list[0];
        } else if (engineId === 'nvidia') {
            const list = verifiedNvidiaModels.length > 0 ? verifiedNvidiaModels : (MODEL_OPTIONS.nvidia || []);
            if (!list.includes(selectedModel)) newModel = list.find(m => m.includes('gemma-4-31b') || m.includes('llama-3.3-70b')) || list[0];
        }
        setSelectedModel(newModel);
        updateAiSettings({ engine: engineId, model: newModel });
    };

    // Fall back to env keys on mount if empty
    useEffect(() => {
        const fetchEnvKeys = async () => {
            try {
                const res = await fetch('/api/ai/env-keys');
                if (res.ok) {
                    const data = await res.json();
                    if (!googleApiKey && data.googleApiKey) {
                        setGoogleApiKey(data.googleApiKey);
                        setIsEditingBilledKey(false);
                    }
                    if (!googleFreeKey && data.googleFreeKey) {
                        setGoogleFreeKey(data.googleFreeKey);
                        setIsEditingFreeKey(false);
                    }
                    if (!openrouterApiKey && data.openrouterApiKey) {
                        setOpenrouterApiKey(data.openrouterApiKey);
                        setIsEditingOpenrouterKey(false);
                    }
                    if (!nvidiaApiKey && data.nvidiaApiKey) {
                        setNvidiaApiKey(data.nvidiaApiKey);
                        setIsEditingNvidiaKey(false);
                    }
                }
            } catch (err) {
                console.warn('[CompanySettings] Failed to fetch fallback env keys:', err);
            }
        };
        
        fetchEnvKeys();
    }, []);

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
        } else if (selectedEngine === 'openrouter') {
            const list = verifiedOpenRouterModels.length > 0 ? verifiedOpenRouterModels : MODEL_OPTIONS.openrouter;
            if (list && !list.includes(selectedModel)) {
                setSelectedModel(list[0]);
            }
        } else if (selectedEngine === 'nvidia') {
            const list = verifiedNvidiaModels.length > 0 ? verifiedNvidiaModels : MODEL_OPTIONS.nvidia;
            if (list && !list.includes(selectedModel)) {
                setSelectedModel(list[0]);
            }
        } else {
            const options = MODEL_OPTIONS[selectedEngine];
            if (options && !options.includes(selectedModel)) {
                setSelectedModel(options[0]);
            }
        }
    }, [selectedEngine, verifiedModels, defaultGoogleModels, verifiedOpenRouterModels, verifiedNvidiaModels]);

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

    const getMaskedKeyPreview = (key) => {
        if (!key) return '';
        if (key.length <= 8) return '••••';
        return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
    };

    const handleTestKey = async (provider) => {
        const targetProvider = (typeof provider === 'string' && provider) ? provider : selectedEngine;
        setSelectedEngine(targetProvider);
        setTestingProvider(targetProvider);
        setProviderErrors(prev => ({ ...prev, [targetProvider]: null }));
        setProviderSuccesses(prev => ({ ...prev, [targetProvider]: null }));
        
        let activeKey = '';
        if (targetProvider === 'google') {
            activeKey = activeTier === 'free' 
                ? (isEditingFreeKey ? tempFreeKey : googleFreeKey) 
                : (isEditingBilledKey ? tempBilledKey : googleApiKey);
            if (!activeKey) {
                setProviderErrors(prev => ({ ...prev, google: `Please enter a key for the selected ${activeTier === 'free' ? 'Free' : 'Billed'} tier first.` }));
                setTestingProvider(null);
                return;
            }
        } else if (targetProvider === 'openrouter') {
            activeKey = isEditingOpenrouterKey ? tempOpenrouterKey : openrouterApiKey;
            if (!activeKey) {
                setProviderErrors(prev => ({ ...prev, openrouter: 'Please enter an OpenRouter API key first.' }));
                setTestingProvider(null);
                return;
            }
        } else if (targetProvider === 'nvidia') {
            activeKey = isEditingNvidiaKey ? tempNvidiaKey : nvidiaApiKey;
            if (!activeKey) {
                setProviderErrors(prev => ({ ...prev, nvidia: 'Please enter an NVIDIA NIM API key first.' }));
                setTestingProvider(null);
                return;
            }
        }
        
        try {
            const response = await fetch('/api/ai/verify-provider-key', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider: targetProvider,
                    apiKey: activeKey,
                    tier: activeTier
                })
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || `Verification failed with HTTP ${response.status}`);
            }
            
            const models = data.models || [];
            if (models.length === 0) {
                throw new Error('No compatible models were found for this key.');
            }
            
            if (targetProvider === 'google') {
                setVerifiedModels(models);
                setProviderSuccesses(prev => ({ ...prev, google: `Successfully verified Google Gemini key! Found ${models.length} authorized models.` }));
                const finalFreeKey = isEditingFreeKey ? tempFreeKey : googleFreeKey;
                const finalApiKey = isEditingBilledKey ? tempBilledKey : googleApiKey;
                const newModel = models.includes(selectedModel) ? selectedModel : models[0];
                setSelectedModel(newModel);
                updateAiSettings({
                    engine: 'google',
                    googleApiKey: finalApiKey,
                    googleFreeKey: finalFreeKey,
                    activeTier,
                    verifiedModels: models,
                    model: newModel
                });
                if (isEditingFreeKey && tempFreeKey) {
                    setGoogleFreeKey(tempFreeKey);
                    setIsEditingFreeKey(false);
                    setTempFreeKey('');
                }
                if (isEditingBilledKey && tempBilledKey) {
                    setGoogleApiKey(tempBilledKey);
                    setIsEditingBilledKey(false);
                    setTempBilledKey('');
                }
            } else if (targetProvider === 'openrouter') {
                setVerifiedOpenRouterModels(models);
                setProviderSuccesses(prev => ({ ...prev, openrouter: `Successfully verified OpenRouter key! Found ${models.length} authorized models.` }));
                const finalKey = isEditingOpenrouterKey ? tempOpenrouterKey : openrouterApiKey;
                const newModel = models.includes(selectedModel) 
                    ? selectedModel 
                    : (models.find(m => m.includes('gemini-2.5-flash') || m.includes('gemini-2.0-flash')) || models[0]);
                setSelectedModel(newModel);
                updateAiSettings({
                    engine: 'openrouter',
                    openrouterApiKey: finalKey,
                    verifiedOpenRouterModels: models,
                    model: newModel
                });
                if (isEditingOpenrouterKey && tempOpenrouterKey) {
                    setOpenrouterApiKey(tempOpenrouterKey);
                    setIsEditingOpenrouterKey(false);
                    setTempOpenrouterKey('');
                }
            } else if (targetProvider === 'nvidia') {
                setVerifiedNvidiaModels(models);
                setProviderSuccesses(prev => ({ ...prev, nvidia: `Successfully verified NVIDIA key! Found ${models.length} authorized models.` }));
                const finalKey = isEditingNvidiaKey ? tempNvidiaKey : nvidiaApiKey;
                const newModel = models.includes(selectedModel)
                    ? selectedModel
                    : (models.find(m => m.includes('gemma-4-31b') || m.includes('llama-3.3-70b')) || models[0]);
                setSelectedModel(newModel);
                updateAiSettings({
                    engine: 'nvidia',
                    nvidiaApiKey: finalKey,
                    verifiedNvidiaModels: models,
                    model: newModel
                });
                if (isEditingNvidiaKey && tempNvidiaKey) {
                    setNvidiaApiKey(tempNvidiaKey);
                    setIsEditingNvidiaKey(false);
                    setTempNvidiaKey('');
                }
            }
        } catch (err) {
            console.error(`[${targetProvider} Key Verification Error]:`, err);
            setProviderErrors(prev => ({ ...prev, [targetProvider]: err.message || 'Verification failed. Please check your network and API key.' }));
        } finally {
            setTestingProvider(null);
        }
    };

    const handleSaveApiKey = async (tier, newKey) => {
        setIsSavingKey(tier);
        setError(null);
        setSuccess(null);
        try {
            let updatePayload = {};
            if (tier === 'free') {
                updatePayload = { googleFreeKey: newKey };
            } else if (tier === 'billed') {
                updatePayload = { googleApiKey: newKey };
            } else if (tier === 'openrouter') {
                updatePayload = { openrouterApiKey: newKey };
            } else if (tier === 'nvidia') {
                updatePayload = { nvidiaApiKey: newKey };
            }

            const result = await updateAiSettings(updatePayload);
            if (result.success) {
                if (tier === 'free') {
                    setGoogleFreeKey(newKey);
                    setIsEditingFreeKey(false);
                    setTempFreeKey('');
                } else if (tier === 'billed') {
                    setGoogleApiKey(newKey);
                    setIsEditingBilledKey(false);
                    setTempBilledKey('');
                } else if (tier === 'openrouter') {
                    setOpenrouterApiKey(newKey);
                    setIsEditingOpenrouterKey(false);
                    setTempOpenrouterKey('');
                } else if (tier === 'nvidia') {
                    setNvidiaApiKey(newKey);
                    setIsEditingNvidiaKey(false);
                    setTempNvidiaKey('');
                }
                setSuccess(`${tier.toUpperCase()} API Key saved successfully!`);
                setTimeout(() => setSuccess(null), 3000);
            } else {
                setError(result.error || 'Failed to save API key.');
            }
        } catch (err) {
            setError(err.message || 'An error occurred while saving.');
        } finally {
            setIsSavingKey(null);
        }
    };

    const handleSave = async () => {
        setIsProcessing(true);
        setError('');
        setSuccess('');

        const finalFreeKey = isEditingFreeKey ? tempFreeKey : googleFreeKey;
        const finalApiKey = isEditingBilledKey ? tempBilledKey : googleApiKey;
        const finalOpenRouterKey = isEditingOpenrouterKey ? tempOpenrouterKey : openrouterApiKey;
        const finalNvidiaKey = isEditingNvidiaKey ? tempNvidiaKey : nvidiaApiKey;

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
                googleApiKey: finalApiKey,
                googleFreeKey: finalFreeKey,
                openrouterApiKey: finalOpenRouterKey,
                nvidiaApiKey: finalNvidiaKey,
                activeTier,
                verifiedModels,
                verifiedOpenRouterModels,
                verifiedNvidiaModels
            });

            if (result.success) {
                if (isEditingFreeKey && tempFreeKey) {
                    setGoogleFreeKey(tempFreeKey);
                    setIsEditingFreeKey(false);
                    setTempFreeKey('');
                }
                if (isEditingBilledKey && tempBilledKey) {
                    setGoogleApiKey(tempBilledKey);
                    setIsEditingBilledKey(false);
                    setTempBilledKey('');
                }
                if (isEditingOpenrouterKey && tempOpenrouterKey) {
                    setOpenrouterApiKey(tempOpenrouterKey);
                    setIsEditingOpenrouterKey(false);
                    setTempOpenrouterKey('');
                }
                if (isEditingNvidiaKey && tempNvidiaKey) {
                    setNvidiaApiKey(tempNvidiaKey);
                    setIsEditingNvidiaKey(false);
                    setTempNvidiaKey('');
                }
                
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
                                <h3><i className={styles.brandingIcon}></i> Company & Branding</h3>
                                <span className={styles.chevron}></span>
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
                                <h3><i className={styles.aiIcon}></i> Global AI Settings</h3>
                                <span className={styles.chevron}></span>
                            </div>
                            <div className={styles.sectionContent}>
                                <div className={styles.field}>
                                    <label className={styles.label}>Primary AI Provider</label>
                                    <div className={styles.aiGrid}>
                                        {AI_ENGINES.map(engine => (
                                            <div 
                                                key={engine.id}
                                                className={`${styles.engineCard} ${selectedEngine === engine.id ? styles.active : ''}`}
                                                onClick={() => handleSelectEngine(engine.id)}
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

                                {/* GOOGLE GEMINI CONFIGURATION */}
                                {selectedEngine === 'google' && (
                                    <div style={{ marginTop: '16px', marginBottom: '24px', padding: '18px', background: theme === 'dark' ? 'rgba(26, 115, 232, 0.04)' : 'rgba(26, 115, 232, 0.03)', borderRadius: '12px', border: '1px solid rgba(26, 115, 232, 0.25)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                                            <span style={{ fontSize: '1.2rem' }}></span>
                                            <h4 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700, color: theme === 'dark' ? '#93c5fd' : '#1d4ed8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                Google Gemini API Configuration
                                            </h4>
                                        </div>
                                        
                                        <div style={{ animation: 'slideDown 0.3s ease-out' }}>
                                            {/* Free Tier Key */}
                                            <div className={styles.field} style={{ marginBottom: '14px' }}>
                                                <label className={styles.label} style={{ fontSize: '0.75rem' }}>Free Tier API Key (Vertex / AI Studio)</label>
                                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                                    <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
                                                        <input
                                                            type={isEditingFreeKey ? (showFreeKey ? 'text' : 'password') : 'text'}
                                                            className={styles.input}
                                                            value={isEditingFreeKey ? tempFreeKey : getMaskedKeyPreview(googleFreeKey)}
                                                            onChange={(e) => isEditingFreeKey && setTempFreeKey(e.target.value)}
                                                            placeholder={isEditingFreeKey ? "Enter Google Free Tier API Key" : "No key configured"}
                                                            disabled={!isEditingFreeKey}
                                                            style={{ 
                                                                paddingRight: isEditingFreeKey ? '45px' : '12px', 
                                                                width: '100%',
                                                                backgroundColor: !isEditingFreeKey ? 'rgba(255, 255, 255, 0.03)' : 'var(--input-bg)',
                                                                color: !isEditingFreeKey ? 'var(--text-secondary)' : 'var(--text-primary)',
                                                                cursor: !isEditingFreeKey ? 'not-allowed' : 'text',
                                                                opacity: !isEditingFreeKey ? 0.75 : 1
                                                            }}
                                                        />
                                                        {isEditingFreeKey && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setShowFreeKey(!showFreeKey)}
                                                                style={{ position: 'absolute', right: '12px', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.1rem' }}
                                                            >
                                                                {showFreeKey ? '' : ''}
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                        {isEditingFreeKey ? (
                                                            <>
                                                                <button
                                                                    type="button"
                                                                    className={styles.saveBtn}
                                                                    onClick={() => handleSaveApiKey('free', tempFreeKey)}
                                                                    disabled={isSavingKey === 'free' || !tempFreeKey}
                                                                    style={{
                                                                        padding: '10px 16px',
                                                                        borderRadius: '10px',
                                                                        border: 'none',
                                                                        background: tempFreeKey 
                                                                            ? 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)' 
                                                                            : 'rgba(255, 255, 255, 0.05)',
                                                                        color: tempFreeKey ? '#fff' : 'var(--text-secondary)',
                                                                        fontWeight: '600',
                                                                        cursor: tempFreeKey ? 'pointer' : 'not-allowed',
                                                                        fontSize: '0.85rem',
                                                                        whiteSpace: 'nowrap',
                                                                        height: '42px',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        justifyContent: 'center',
                                                                        minWidth: '70px'
                                                                    }}
                                                                >
                                                                    {isSavingKey === 'free' ? '...' : 'Save'}
                                                                </button>
                                                                {googleFreeKey && (
                                                                    <button
                                                                        type="button"
                                                                        className={styles.skipBtn}
                                                                        onClick={() => {
                                                                            setIsEditingFreeKey(false);
                                                                            setTempFreeKey('');
                                                                        }}
                                                                        style={{
                                                                            padding: '10px 12px',
                                                                            borderRadius: '10px',
                                                                            border: '1px solid var(--border-color)',
                                                                            color: 'var(--text-secondary)',
                                                                            fontWeight: '500',
                                                                            cursor: 'pointer',
                                                                            fontSize: '0.85rem',
                                                                            height: '42px',
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            justifyContent: 'center'
                                                                        }}
                                                                    >
                                                                        Cancel
                                                                    </button>
                                                                )}
                                                            </>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                className={styles.saveBtn}
                                                                onClick={() => {
                                                                    setIsEditingFreeKey(true);
                                                                    setTempFreeKey('');
                                                                }}
                                                                style={{
                                                                    padding: '10px 16px',
                                                                    borderRadius: '10px',
                                                                    border: 'none',
                                                                    background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                                                                    color: '#fff',
                                                                    fontWeight: '600',
                                                                    cursor: 'pointer',
                                                                    fontSize: '0.85rem',
                                                                    whiteSpace: 'nowrap',
                                                                    height: '42px',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    justifyContent: 'center',
                                                                    minWidth: '70px'
                                                                }}
                                                            >
                                                                Change
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Billed Tier Key */}
                                            <div className={styles.field} style={{ marginBottom: '14px' }}>
                                                <label className={styles.label} style={{ fontSize: '0.75rem' }}>Billed Tier API Key (Production / High RPM)</label>
                                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                                    <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
                                                        <input
                                                            type={isEditingBilledKey ? (showApiKey ? 'text' : 'password') : 'text'}
                                                            className={styles.input}
                                                            value={isEditingBilledKey ? tempBilledKey : getMaskedKeyPreview(googleApiKey)}
                                                            onChange={(e) => isEditingBilledKey && setTempBilledKey(e.target.value)}
                                                            placeholder={isEditingBilledKey ? "Enter Google Billed Tier API Key" : "No key configured"}
                                                            disabled={!isEditingBilledKey}
                                                            style={{ 
                                                                paddingRight: isEditingBilledKey ? '45px' : '12px', 
                                                                width: '100%',
                                                                backgroundColor: !isEditingBilledKey ? 'rgba(255, 255, 255, 0.03)' : 'var(--input-bg)',
                                                                color: !isEditingBilledKey ? 'var(--text-secondary)' : 'var(--text-primary)',
                                                                cursor: !isEditingBilledKey ? 'not-allowed' : 'text',
                                                                opacity: !isEditingBilledKey ? 0.75 : 1
                                                            }}
                                                        />
                                                        {isEditingBilledKey && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setShowApiKey(!showApiKey)}
                                                                style={{ position: 'absolute', right: '12px', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.1rem' }}
                                                            >
                                                                {showApiKey ? '' : ''}
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                        {isEditingBilledKey ? (
                                                            <>
                                                                <button
                                                                    type="button"
                                                                    className={styles.saveBtn}
                                                                    onClick={() => handleSaveApiKey('billed', tempBilledKey)}
                                                                    disabled={isSavingKey === 'billed' || !tempBilledKey}
                                                                    style={{
                                                                        padding: '10px 16px',
                                                                        borderRadius: '10px',
                                                                        border: 'none',
                                                                        background: tempBilledKey 
                                                                            ? 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)' 
                                                                            : 'rgba(255, 255, 255, 0.05)',
                                                                        color: tempBilledKey ? '#fff' : 'var(--text-secondary)',
                                                                        fontWeight: '600',
                                                                        cursor: tempBilledKey ? 'pointer' : 'not-allowed',
                                                                        fontSize: '0.85rem',
                                                                        whiteSpace: 'nowrap',
                                                                        height: '42px',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        justifyContent: 'center',
                                                                        minWidth: '70px'
                                                                    }}
                                                                >
                                                                    {isSavingKey === 'billed' ? '...' : 'Save'}
                                                                </button>
                                                                {googleApiKey && (
                                                                    <button
                                                                        type="button"
                                                                        className={styles.skipBtn}
                                                                        onClick={() => {
                                                                            setIsEditingBilledKey(false);
                                                                            setTempBilledKey('');
                                                                        }}
                                                                        style={{
                                                                            padding: '10px 12px',
                                                                            borderRadius: '10px',
                                                                            border: '1px solid var(--border-color)',
                                                                            color: 'var(--text-secondary)',
                                                                            fontWeight: '500',
                                                                            cursor: 'pointer',
                                                                            fontSize: '0.85rem',
                                                                            height: '42px',
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            justifyContent: 'center'
                                                                        }}
                                                                    >
                                                                        Cancel
                                                                    </button>
                                                                )}
                                                            </>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                className={styles.saveBtn}
                                                                onClick={() => {
                                                                    setIsEditingBilledKey(true);
                                                                    setTempBilledKey('');
                                                                }}
                                                                style={{
                                                                    padding: '10px 16px',
                                                                    borderRadius: '10px',
                                                                    border: 'none',
                                                                    background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                                                                    color: '#fff',
                                                                    fontWeight: '600',
                                                                    cursor: 'pointer',
                                                                    fontSize: '0.85rem',
                                                                    whiteSpace: 'nowrap',
                                                                    height: '42px',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    justifyContent: 'center',
                                                                    minWidth: '70px'
                                                                }}
                                                            >
                                                                Change
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Active Tier Selector */}
                                            <div className={styles.field} style={{ marginBottom: '14px' }}>
                                                <label className={styles.label} style={{ fontSize: '0.75rem' }}>Active Tier Preference</label>
                                                <select
                                                    value={activeTier}
                                                    onChange={(e) => setActiveTier(e.target.value)}
                                                    className={styles.modelSelect}
                                                    style={{ width: '100%', marginTop: '4px' }}
                                                >
                                                    <option value="free">Free Tier Key</option>
                                                    <option value="billed">Billed Tier Key</option>
                                                </select>
                                            </div>

                                            {/* Test Google key */}
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                                <button
                                                    type="button"
                                                    className={styles.saveBtn}
                                                    onClick={() => handleTestKey('google')}
                                                    disabled={testingProvider === 'google'}
                                                    style={{
                                                        background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                                                        boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.25)',
                                                        width: '100%',
                                                        padding: '10px',
                                                        fontWeight: 600
                                                    }}
                                                >
                                                    {testingProvider === 'google' ? 'Verifying Google Gemini Key...' : 'Test Google Gemini Key & Detect Models'}
                                                </button>
                                                
                                                {providerErrors.google && <div style={{ color: '#ef4444', fontSize: '0.8rem', padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)' }}> {providerErrors.google}</div>}
                                                {providerSuccesses.google && <div style={{ color: '#10b981', fontSize: '0.8rem', padding: '8px 12px', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.2)' }}> {providerSuccesses.google}</div>}

                                                {/* Google Verified Models Display */}
                                                <div 
                                                    style={{ 
                                                        marginTop: '12px', 
                                                        padding: '14px', 
                                                        background: theme === 'dark' ? 'rgba(26, 115, 232, 0.05)' : 'rgba(26, 115, 232, 0.03)', 
                                                        borderRadius: '10px', 
                                                        border: theme === 'dark' ? '1px dashed rgba(26, 115, 232, 0.35)' : '1px dashed rgba(26, 115, 232, 0.45)',
                                                        boxShadow: 'inset 0 0 12px rgba(26, 115, 232, 0.05)'
                                                    }}
                                                >
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: theme === 'dark' ? '#93c5fd' : '#1d4ed8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                             Verified Google Gemini Models
                                                        </div>
                                                        <span style={{ fontSize: '0.7rem', padding: '2px 8px', background: theme === 'dark' ? 'rgba(26, 115, 232, 0.25)' : 'rgba(26, 115, 232, 0.12)', color: theme === 'dark' ? '#bfdbfe' : '#1d4ed8', borderRadius: '20px', fontWeight: 600 }}>
                                                            {(verifiedModels.length > 0 ? verifiedModels : defaultGoogleModels).length} Models
                                                        </span>
                                                    </div>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxHeight: '130px', overflowY: 'auto', padding: '2px', scrollbarWidth: 'thin' }}>
                                                        {(verifiedModels.length > 0 ? verifiedModels : defaultGoogleModels).map(m => (
                                                            <span
                                                                key={m}
                                                                onClick={() => setSelectedModel(m)}
                                                                style={{
                                                                    fontSize: '0.7rem',
                                                                    padding: '4px 10px',
                                                                    background: selectedModel === m ? 'rgba(26, 115, 232, 0.35)' : (theme === 'dark' ? 'rgba(26, 115, 232, 0.12)' : 'rgba(26, 115, 232, 0.06)'),
                                                                    color: selectedModel === m ? '#fff' : (theme === 'dark' ? '#bfdbfe' : '#1e40af'),
                                                                    borderRadius: '8px',
                                                                    border: selectedModel === m ? '1.5px solid #2563eb' : (theme === 'dark' ? '1px solid rgba(26, 115, 232, 0.25)' : '1px solid rgba(26, 115, 232, 0.2)'),
                                                                    transition: 'all 0.2s ease',
                                                                    cursor: 'pointer',
                                                                    fontWeight: selectedModel === m ? 700 : 500
                                                                }}
                                                                title="Click to select this model"
                                                            >
                                                                {selectedModel === m ? ' ' : ''}{m}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* OPENROUTER CONFIGURATION */}
                                {selectedEngine === 'openrouter' && (
                                    <div style={{ marginTop: '16px', marginBottom: '24px', padding: '18px', background: theme === 'dark' ? 'rgba(99, 102, 241, 0.04)' : 'rgba(99, 102, 241, 0.03)', borderRadius: '12px', border: '1px solid rgba(99, 102, 241, 0.3)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                                            <span style={{ fontSize: '1.2rem' }}></span>
                                            <h4 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700, color: theme === 'dark' ? '#a5b4fc' : '#4f46e5', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                OpenRouter API Gateway Configuration
                                            </h4>
                                        </div>
                                        
                                        <div style={{ animation: 'slideDown 0.3s ease-out' }}>
                                            <div className={styles.field} style={{ marginBottom: '14px' }}>
                                                <label className={styles.label} style={{ fontSize: '0.75rem' }}>OpenRouter API Key</label>
                                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                                    <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
                                                        <input
                                                            type={isEditingOpenrouterKey ? (showOpenrouterKey ? 'text' : 'password') : 'text'}
                                                            className={styles.input}
                                                            value={isEditingOpenrouterKey ? tempOpenrouterKey : getMaskedKeyPreview(openrouterApiKey)}
                                                            onChange={(e) => isEditingOpenrouterKey && setTempOpenrouterKey(e.target.value)}
                                                            placeholder={isEditingOpenrouterKey ? "sk-or-v1-..." : "No key configured"}
                                                            disabled={!isEditingOpenrouterKey}
                                                            style={{ 
                                                                paddingRight: isEditingOpenrouterKey ? '45px' : '12px', 
                                                                width: '100%',
                                                                backgroundColor: !isEditingOpenrouterKey ? 'rgba(255, 255, 255, 0.03)' : 'var(--input-bg)',
                                                                color: !isEditingOpenrouterKey ? 'var(--text-secondary)' : 'var(--text-primary)',
                                                                cursor: !isEditingOpenrouterKey ? 'not-allowed' : 'text',
                                                                opacity: !isEditingOpenrouterKey ? 0.75 : 1
                                                            }}
                                                        />
                                                        {isEditingOpenrouterKey && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setShowOpenrouterKey(!showOpenrouterKey)}
                                                                style={{ position: 'absolute', right: '12px', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.1rem' }}
                                                            >
                                                                {showOpenrouterKey ? '' : ''}
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                        {isEditingOpenrouterKey ? (
                                                            <>
                                                                <button
                                                                    type="button"
                                                                    className={styles.saveBtn}
                                                                    onClick={() => handleSaveApiKey('openrouter', tempOpenrouterKey)}
                                                                    disabled={isSavingKey === 'openrouter' || !tempOpenrouterKey}
                                                                    style={{
                                                                        padding: '10px 16px',
                                                                        borderRadius: '10px',
                                                                        border: 'none',
                                                                        background: tempOpenrouterKey 
                                                                            ? 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' 
                                                                            : 'rgba(255, 255, 255, 0.05)',
                                                                        color: tempOpenrouterKey ? '#fff' : 'var(--text-secondary)',
                                                                        fontWeight: '600',
                                                                        cursor: tempOpenrouterKey ? 'pointer' : 'not-allowed',
                                                                        fontSize: '0.85rem',
                                                                        whiteSpace: 'nowrap',
                                                                        height: '42px',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        justifyContent: 'center',
                                                                        minWidth: '70px'
                                                                    }}
                                                                >
                                                                    {isSavingKey === 'openrouter' ? '...' : 'Save'}
                                                                </button>
                                                                {openrouterApiKey && (
                                                                    <button
                                                                        type="button"
                                                                        className={styles.skipBtn}
                                                                        onClick={() => {
                                                                            setIsEditingOpenrouterKey(false);
                                                                            setTempOpenrouterKey('');
                                                                        }}
                                                                        style={{
                                                                            padding: '10px 12px',
                                                                            borderRadius: '10px',
                                                                            border: '1px solid var(--border-color)',
                                                                            color: 'var(--text-secondary)',
                                                                            fontWeight: '500',
                                                                            cursor: 'pointer',
                                                                            fontSize: '0.85rem',
                                                                            height: '42px',
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            justifyContent: 'center'
                                                                        }}
                                                                    >
                                                                        Cancel
                                                                    </button>
                                                                )}
                                                            </>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                className={styles.saveBtn}
                                                                onClick={() => {
                                                                    setIsEditingOpenrouterKey(true);
                                                                    setTempOpenrouterKey('');
                                                                }}
                                                                style={{
                                                                    padding: '10px 16px',
                                                                    borderRadius: '10px',
                                                                    border: 'none',
                                                                    background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                                                                    color: '#fff',
                                                                    fontWeight: '600',
                                                                    cursor: 'pointer',
                                                                    fontSize: '0.85rem',
                                                                    whiteSpace: 'nowrap',
                                                                    height: '42px',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    justifyContent: 'center',
                                                                    minWidth: '70px'
                                                                }}
                                                            >
                                                                Change
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Test OpenRouter key */}
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                                <button
                                                    type="button"
                                                    className={styles.saveBtn}
                                                    onClick={() => handleTestKey('openrouter')}
                                                    disabled={testingProvider === 'openrouter'}
                                                    style={{
                                                        background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                                                        boxShadow: '0 4px 6px -1px rgba(99, 102, 241, 0.25)',
                                                        width: '100%',
                                                        padding: '10px',
                                                        fontWeight: 600
                                                    }}
                                                >
                                                    {testingProvider === 'openrouter' ? 'Verifying OpenRouter Key...' : 'Test OpenRouter Key & Detect Models'}
                                                </button>
                                                
                                                {providerErrors.openrouter && <div style={{ color: '#ef4444', fontSize: '0.8rem', padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)' }}> {providerErrors.openrouter}</div>}
                                                {providerSuccesses.openrouter && <div style={{ color: '#10b981', fontSize: '0.8rem', padding: '8px 12px', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.2)' }}> {providerSuccesses.openrouter}</div>}

                                                {/* OpenRouter Verified Models Display */}
                                                <div 
                                                    style={{ 
                                                        marginTop: '12px', 
                                                        padding: '14px', 
                                                        background: theme === 'dark' ? 'rgba(99, 102, 241, 0.05)' : 'rgba(99, 102, 241, 0.03)', 
                                                        borderRadius: '10px', 
                                                        border: theme === 'dark' ? '1px dashed rgba(99, 102, 241, 0.35)' : '1px dashed rgba(99, 102, 241, 0.45)',
                                                        boxShadow: 'inset 0 0 12px rgba(99, 102, 241, 0.05)'
                                                    }}
                                                >
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: theme === 'dark' ? '#a5b4fc' : '#4f46e5', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                             Authorized OpenRouter Models
                                                        </div>
                                                        <span style={{ fontSize: '0.7rem', padding: '2px 8px', background: theme === 'dark' ? 'rgba(99, 102, 241, 0.25)' : 'rgba(99, 102, 241, 0.12)', color: theme === 'dark' ? '#c7d2fe' : '#4f46e5', borderRadius: '20px', fontWeight: 600 }}>
                                                            {(verifiedOpenRouterModels.length > 0 ? verifiedOpenRouterModels : (MODEL_OPTIONS.openrouter || [])).length} Models
                                                        </span>
                                                    </div>

                                                    {/* Search Filter for models */}
                                                    {(verifiedOpenRouterModels.length > 10 || (MODEL_OPTIONS.openrouter || []).length > 10) && (
                                                        <input 
                                                            type="text"
                                                            placeholder=" Search OpenRouter models (e.g. gemini, claude, llama, deepseek)..."
                                                            value={modelSearchQuery}
                                                            onChange={(e) => setModelSearchQuery(e.target.value)}
                                                            style={{
                                                                width: '100%',
                                                                padding: '6px 10px',
                                                                marginBottom: '10px',
                                                                fontSize: '0.78rem',
                                                                borderRadius: '6px',
                                                                border: '1px solid var(--border-color)',
                                                                background: 'var(--input-bg)',
                                                                color: 'var(--text-primary)'
                                                            }}
                                                        />
                                                    )}

                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxHeight: '140px', overflowY: 'auto', padding: '2px', scrollbarWidth: 'thin' }}>
                                                        {(verifiedOpenRouterModels.length > 0 ? verifiedOpenRouterModels : (MODEL_OPTIONS.openrouter || []))
                                                            .filter(m => !modelSearchQuery || m.toLowerCase().includes(modelSearchQuery.toLowerCase()))
                                                            .slice(0, 100)
                                                            .map(m => (
                                                                <span
                                                                    key={m}
                                                                    onClick={() => setSelectedModel(m)}
                                                                    style={{
                                                                        fontSize: '0.7rem',
                                                                        padding: '4px 10px',
                                                                        background: selectedModel === m ? 'rgba(99, 102, 241, 0.35)' : (theme === 'dark' ? 'rgba(99, 102, 241, 0.12)' : 'rgba(99, 102, 241, 0.06)'),
                                                                        color: selectedModel === m ? '#fff' : (theme === 'dark' ? '#c7d2fe' : '#4338ca'),
                                                                        borderRadius: '8px',
                                                                        border: selectedModel === m ? '1.5px solid #6366f1' : (theme === 'dark' ? '1px solid rgba(99, 102, 241, 0.25)' : '1px solid rgba(99, 102, 241, 0.2)'),
                                                                        transition: 'all 0.2s ease',
                                                                        cursor: 'pointer',
                                                                        fontWeight: selectedModel === m ? 700 : 500
                                                                    }}
                                                                    title="Click to select this model"
                                                                >
                                                                    {selectedModel === m ? ' ' : ''}{m}
                                                                </span>
                                                            ))}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* NVIDIA NIM CONFIGURATION */}
                                {selectedEngine === 'nvidia' && (
                                    <div style={{ marginTop: '16px', marginBottom: '24px', padding: '18px', background: theme === 'dark' ? 'rgba(118, 185, 0, 0.04)' : 'rgba(118, 185, 0, 0.03)', borderRadius: '12px', border: '1px solid rgba(118, 185, 0, 0.3)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                                            <span style={{ fontSize: '1.2rem' }}></span>
                                            <h4 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700, color: theme === 'dark' ? '#bef264' : '#65a30d', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                NVIDIA NIM API Configuration
                                            </h4>
                                        </div>
                                        
                                        <div style={{ animation: 'slideDown 0.3s ease-out' }}>
                                            <div className={styles.field} style={{ marginBottom: '14px' }}>
                                                <label className={styles.label} style={{ fontSize: '0.75rem' }}>NVIDIA NIM API Key</label>
                                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                                    <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
                                                        <input
                                                            type={isEditingNvidiaKey ? (showNvidiaKey ? 'text' : 'password') : 'text'}
                                                            className={styles.input}
                                                            value={isEditingNvidiaKey ? tempNvidiaKey : getMaskedKeyPreview(nvidiaApiKey)}
                                                            onChange={(e) => isEditingNvidiaKey && setTempNvidiaKey(e.target.value)}
                                                            placeholder={isEditingNvidiaKey ? "nvapi-..." : "No key configured"}
                                                            disabled={!isEditingNvidiaKey}
                                                            style={{ 
                                                                paddingRight: isEditingNvidiaKey ? '45px' : '12px', 
                                                                width: '100%',
                                                                backgroundColor: !isEditingNvidiaKey ? 'rgba(255, 255, 255, 0.03)' : 'var(--input-bg)',
                                                                color: !isEditingNvidiaKey ? 'var(--text-secondary)' : 'var(--text-primary)',
                                                                cursor: !isEditingNvidiaKey ? 'not-allowed' : 'text',
                                                                opacity: !isEditingNvidiaKey ? 0.75 : 1
                                                            }}
                                                        />
                                                        {isEditingNvidiaKey && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setShowNvidiaKey(!showNvidiaKey)}
                                                                style={{ position: 'absolute', right: '12px', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.1rem' }}
                                                            >
                                                                {showNvidiaKey ? '' : ''}
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                        {isEditingNvidiaKey ? (
                                                            <>
                                                                <button
                                                                    type="button"
                                                                    className={styles.saveBtn}
                                                                    onClick={() => handleSaveApiKey('nvidia', tempNvidiaKey)}
                                                                    disabled={isSavingKey === 'nvidia' || !tempNvidiaKey}
                                                                    style={{
                                                                        padding: '10px 16px',
                                                                        borderRadius: '10px',
                                                                        border: 'none',
                                                                        background: tempNvidiaKey 
                                                                            ? 'linear-gradient(135deg, #76b900 0%, #5d9300 100%)' 
                                                                            : 'rgba(255, 255, 255, 0.05)',
                                                                        color: tempNvidiaKey ? '#fff' : 'var(--text-secondary)',
                                                                        fontWeight: '600',
                                                                        cursor: tempNvidiaKey ? 'pointer' : 'not-allowed',
                                                                        fontSize: '0.85rem',
                                                                        whiteSpace: 'nowrap',
                                                                        height: '42px',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        justifyContent: 'center',
                                                                        minWidth: '70px'
                                                                    }}
                                                                >
                                                                    {isSavingKey === 'nvidia' ? '...' : 'Save'}
                                                                </button>
                                                                {nvidiaApiKey && (
                                                                    <button
                                                                        type="button"
                                                                        className={styles.skipBtn}
                                                                        onClick={() => {
                                                                            setIsEditingNvidiaKey(false);
                                                                            setTempNvidiaKey('');
                                                                        }}
                                                                        style={{
                                                                            padding: '10px 12px',
                                                                            borderRadius: '10px',
                                                                            border: '1px solid var(--border-color)',
                                                                            color: 'var(--text-secondary)',
                                                                            fontWeight: '500',
                                                                            cursor: 'pointer',
                                                                            fontSize: '0.85rem',
                                                                            height: '42px',
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            justifyContent: 'center'
                                                                        }}
                                                                    >
                                                                        Cancel
                                                                    </button>
                                                                )}
                                                            </>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                className={styles.saveBtn}
                                                                onClick={() => {
                                                                    setIsEditingNvidiaKey(true);
                                                                    setTempNvidiaKey('');
                                                                }}
                                                                style={{
                                                                    padding: '10px 16px',
                                                                    borderRadius: '10px',
                                                                    border: 'none',
                                                                    background: 'linear-gradient(135deg, #76b900 0%, #5d9300 100%)',
                                                                    color: '#fff',
                                                                    fontWeight: '600',
                                                                    cursor: 'pointer',
                                                                    fontSize: '0.85rem',
                                                                    whiteSpace: 'nowrap',
                                                                    height: '42px',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    justifyContent: 'center',
                                                                    minWidth: '70px'
                                                                }}
                                                            >
                                                                Change
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Test NVIDIA key */}
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                                <button
                                                    type="button"
                                                    className={styles.saveBtn}
                                                    onClick={() => handleTestKey('nvidia')}
                                                    disabled={testingProvider === 'nvidia'}
                                                    style={{
                                                        background: 'linear-gradient(135deg, #76b900 0%, #5d9300 100%)',
                                                        boxShadow: '0 4px 6px -1px rgba(118, 185, 0, 0.25)',
                                                        width: '100%',
                                                        padding: '10px',
                                                        fontWeight: 600
                                                    }}
                                                >
                                                    {testingProvider === 'nvidia' ? 'Verifying NVIDIA Key...' : 'Test NVIDIA Key & Detect Models'}
                                                </button>
                                                
                                                {providerErrors.nvidia && <div style={{ color: '#ef4444', fontSize: '0.8rem', padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)' }}> {providerErrors.nvidia}</div>}
                                                {providerSuccesses.nvidia && <div style={{ color: '#10b981', fontSize: '0.8rem', padding: '8px 12px', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.2)' }}> {providerSuccesses.nvidia}</div>}

                                                {/* NVIDIA Verified Models Display */}
                                                <div 
                                                    style={{ 
                                                        marginTop: '12px', 
                                                        padding: '14px', 
                                                        background: theme === 'dark' ? 'rgba(118, 185, 0, 0.05)' : 'rgba(118, 185, 0, 0.03)', 
                                                        borderRadius: '10px', 
                                                        border: theme === 'dark' ? '1px dashed rgba(118, 185, 0, 0.35)' : '1px dashed rgba(118, 185, 0, 0.45)',
                                                        boxShadow: 'inset 0 0 12px rgba(118, 185, 0, 0.05)'
                                                    }}
                                                >
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: theme === 'dark' ? '#bef264' : '#65a30d', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                             Authorized NVIDIA Models
                                                        </div>
                                                        <span style={{ fontSize: '0.7rem', padding: '2px 8px', background: theme === 'dark' ? 'rgba(118, 185, 0, 0.25)' : 'rgba(118, 185, 0, 0.12)', color: theme === 'dark' ? '#ecfccb' : '#4d7c0f', borderRadius: '20px', fontWeight: 600 }}>
                                                            {(verifiedNvidiaModels.length > 0 ? verifiedNvidiaModels : (MODEL_OPTIONS.nvidia || [])).length} Models
                                                        </span>
                                                    </div>

                                                    {/* Search Filter for models */}
                                                    {(verifiedNvidiaModels.length > 10 || (MODEL_OPTIONS.nvidia || []).length > 10) && (
                                                        <input 
                                                            type="text"
                                                            placeholder=" Search NVIDIA models (e.g. gemma, llama, nemotron)..."
                                                            value={modelSearchQuery}
                                                            onChange={(e) => setModelSearchQuery(e.target.value)}
                                                            style={{
                                                                width: '100%',
                                                                padding: '6px 10px',
                                                                marginBottom: '10px',
                                                                fontSize: '0.78rem',
                                                                borderRadius: '6px',
                                                                border: '1px solid var(--border-color)',
                                                                background: 'var(--input-bg)',
                                                                color: 'var(--text-primary)'
                                                            }}
                                                        />
                                                    )}

                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxHeight: '140px', overflowY: 'auto', padding: '2px', scrollbarWidth: 'thin' }}>
                                                        {(verifiedNvidiaModels.length > 0 ? verifiedNvidiaModels : (MODEL_OPTIONS.nvidia || []))
                                                            .filter(m => !modelSearchQuery || m.toLowerCase().includes(modelSearchQuery.toLowerCase()))
                                                            .slice(0, 100)
                                                            .map(m => (
                                                                <span
                                                                    key={m}
                                                                    onClick={() => setSelectedModel(m)}
                                                                    style={{
                                                                        fontSize: '0.7rem',
                                                                        padding: '4px 10px',
                                                                        background: selectedModel === m ? 'rgba(118, 185, 0, 0.35)' : (theme === 'dark' ? 'rgba(118, 185, 0, 0.12)' : 'rgba(118, 185, 0, 0.06)'),
                                                                        color: selectedModel === m ? '#fff' : (theme === 'dark' ? '#ecfccb' : '#3f6212'),
                                                                        borderRadius: '8px',
                                                                        border: selectedModel === m ? '1.5px solid #76b900' : (theme === 'dark' ? '1px solid rgba(118, 185, 0, 0.25)' : '1px solid rgba(118, 185, 0, 0.2)'),
                                                                        transition: 'all 0.2s ease',
                                                                        cursor: 'pointer',
                                                                        fontWeight: selectedModel === m ? 700 : 500
                                                                    }}
                                                                    title="Click to select this model"
                                                                >
                                                                    {selectedModel === m ? ' ' : ''}{m}
                                                                </span>
                                                            ))}
                                                    </div>
                                                </div>
                                            </div>
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
                                        ) : selectedEngine === 'openrouter' ? (
                                            (verifiedOpenRouterModels && verifiedOpenRouterModels.length > 0 ? verifiedOpenRouterModels : (MODEL_OPTIONS.openrouter || [])).map(m => (
                                                <option key={m} value={m}>{m}</option>
                                            ))
                                        ) : selectedEngine === 'nvidia' ? (
                                            (verifiedNvidiaModels && verifiedNvidiaModels.length > 0 ? verifiedNvidiaModels : (MODEL_OPTIONS.nvidia || [])).map(m => (
                                                <option key={m} value={m}>{m}</option>
                                            ))
                                        ) : (
                                            MODEL_OPTIONS[selectedEngine]?.map(m => <option key={m} value={m}>{m}</option>)
                                        )}
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* SECTION 3: BRANDS & DATABASE */}
                        <div className={`${styles.section} ${expandedSection === 'brands' ? styles.expanded : ''}`}>
                            <div className={styles.sectionHeader} onClick={() => toggleSection('brands')}>
                                <h3><i className={styles.brandsIcon}></i> Brands & Database</h3>
                                <span className={styles.chevron}></span>
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
