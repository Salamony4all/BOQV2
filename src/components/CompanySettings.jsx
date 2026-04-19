import { useState, useRef, useEffect } from 'react';
import { useCompanyProfile } from '../context/CompanyContext';
import { useTheme } from '../context/ThemeContext';
import { AI_ENGINES, MODEL_OPTIONS, DEFAULT_AI_SETTINGS } from '../utils/aiConstants';
import styles from '../styles/CompanySettings.module.css';

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
    const [accentColor, setAccentColor] = useState(initialAccent || '#3b82f6');
    const [secondaryColor, setSecondaryColor] = useState(initialSecondary || '#f59e0b');

    // AI Settings State
    const [selectedEngine, setSelectedEngine] = useState(storedAiSettings?.engine || DEFAULT_AI_SETTINGS.engine);
    const [selectedModel, setSelectedModel] = useState(storedAiSettings?.model || DEFAULT_AI_SETTINGS.model);
    
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
    }, [companyName, storedWebsite, storedLogo, storedAiSettings]);

    // Update model when engine changes
    useEffect(() => {
        if (selectedEngine === 'google') {
            // Default to gemma-4-31b-it if engine is google
            if (!MODEL_OPTIONS.google.gemini.concat(MODEL_OPTIONS.google.gemma).concat(MODEL_OPTIONS.google.paid).includes(selectedModel)) {
                setSelectedModel(DEFAULT_AI_SETTINGS.model);
            }
        } else {
            const options = MODEL_OPTIONS[selectedEngine];
            if (options && !options.includes(selectedModel)) {
                setSelectedModel(options[0]);
            }
        }
    }, [selectedEngine]);

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
                model: selectedModel
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
                                <h3><i>🏢</i> Company & Branding</h3>
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
                                <h3><i>🤖</i> Global AI Settings</h3>
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

                                <div className={styles.field}>
                                    <label className={styles.label}>Default Model</label>
                                    <select 
                                        className={styles.modelSelect}
                                        value={selectedModel}
                                        onChange={(e) => setSelectedModel(e.target.value)}
                                    >
                                        {selectedEngine === 'google' ? (
                                            <>
                                                <optgroup label="Free Tier (Gemma Models)">
                                                    {MODEL_OPTIONS.google.gemma.map(m => <option key={m} value={m}>{m}</option>)}
                                                </optgroup>
                                                <optgroup label="Free Tier (Gemini 1, 2, 3 Models)">
                                                    {MODEL_OPTIONS.google.gemini.map(m => <option key={m} value={m}>{m}</option>)}
                                                </optgroup>
                                                <optgroup label="Paid Tier (Gemini 1, 2, 3 Paid API)">
                                                    {MODEL_OPTIONS.google.paid.map(m => <option key={m} value={m}>{m}</option>)}
                                                </optgroup>
                                            </>
                                        ) : (
                                            MODEL_OPTIONS[selectedEngine]?.map(m => <option key={m} value={m}>{m}</option>)
                                        )}
                                    </select>
                                </div>
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
