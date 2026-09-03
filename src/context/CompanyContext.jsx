import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import ALSHAYA_COLOR from '../assets/alshaya-color.png';
import ALSHAYA_WHITE from '../assets/alshaya-white.png';
import { DEFAULT_AI_SETTINGS, MODEL_OPTIONS } from '../utils/aiConstants';

// Create the context
const CompanyContext = createContext(null);

// Storage key
const STORAGE_KEY = 'boqflow_company_profile';

const DEFAULT_PROFILE = {
    companyName: 'BOQ FLOW',
    website: '',
    logo: {
        base64: ALSHAYA_COLOR,
        width: 1561,
        height: 865,
        isLight: false,
        whiteLogo: ALSHAYA_WHITE
    },
    aiSettings: {
        engine: DEFAULT_AI_SETTINGS.engine,
        model: DEFAULT_AI_SETTINGS.model,
        googleApiKey: '',
        googleFreeKey: '',
        openrouterApiKey: '',
        nvidiaApiKey: '',
        activeTier: 'free',
        verifiedModels: [],
        verifiedOpenRouterModels: [],
        verifiedNvidiaModels: []
    },
    accentColor: '#0f3e67', // Default dark blue
    secondaryColor: '#f59e0b', // Default gold
    setupComplete: true
};

// Provider component
export function CompanyProvider({ children }) {
    const [profile, setProfile] = useState(DEFAULT_PROFILE);
    const [isLoading, setIsLoading] = useState(false);
    const [showSetupModal, setShowSetupModal] = useState(false);

    // Apply colors to CSS variables
    const applyThemeColors = useCallback((primary, secondary) => {
        if (!primary) return;
        let finalPrimary = primary;
        const clean = primary.trim().replace('#', '').toUpperCase();
        if (clean === '3B82F6' || clean === 'RGB(59, 130, 246)' || clean === '1E5FA8' || clean === '2563EB') {
            finalPrimary = '#0f3e67';
        }
        document.documentElement.style.setProperty('--primary', finalPrimary);
        if (secondary) document.documentElement.style.setProperty('--accent', secondary);
        
        // Generate a slightly darker version for hover states if possible
        try {
            document.documentElement.style.setProperty('--primary-dark', finalPrimary === '#0f3e67' ? '#0b2d4b' : finalPrimary);
        } catch (e) {}
    }, []);

    // Load profile from localStorage on mount
    useEffect(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                // Migration support for old logoWhite/logoBlue structure
                if (parsed.logoWhite || parsed.logoBlue) {
                    parsed.logo = {
                        base64: parsed.logoBlue || parsed.logoWhite,
                        width: 200, // fallback
                        height: 50,  // fallback
                        isLight: !!parsed.logoWhite && !parsed.logoBlue,
                        whiteLogo: parsed.logoWhite || parsed.logoBlue
                    };
                    delete parsed.logoWhite;
                    delete parsed.logoBlue;
                }
                // Merge with defaults to ensure missing fields (like website) are filled
                // HOWEVER, if a profile was already saved, we don't want to revert the logo to default
                const integratedProfile = {
                    ...DEFAULT_PROFILE,
                    ...parsed,
                    companyName: parsed.companyName || DEFAULT_PROFILE.companyName,
                    website: (parsed.website !== undefined) ? parsed.website : DEFAULT_PROFILE.website,
                    // Only use default logo if the parsed one is completely missing or empty and no profile existed
                    logo: (parsed.logo && (parsed.logo.base64 || parsed.logo.whiteLogo)) 
                        ? parsed.logo 
                        : (parsed.setupComplete ? parsed.logo : DEFAULT_PROFILE.logo),
                    aiSettings: parsed.aiSettings ? { ...DEFAULT_PROFILE.aiSettings, ...parsed.aiSettings } : DEFAULT_PROFILE.aiSettings,
                    accentColor: parsed.accentColor || DEFAULT_PROFILE.accentColor,
                    secondaryColor: parsed.secondaryColor || DEFAULT_PROFILE.secondaryColor
                };

                // Validate AI settings model
                if (integratedProfile.aiSettings.engine === 'google') {
                    const cleanModel = (integratedProfile.aiSettings.model || '').replace(':billed', '');
                    const verifiedList = integratedProfile.aiSettings.verifiedModels || [];
                    if (verifiedList.length > 0 && !verifiedList.includes(cleanModel)) {
                        console.warn(`[Migration] Model "${integratedProfile.aiSettings.model}" is not in the verified list. Resetting to default: ${verifiedList[0]}`);
                        integratedProfile.aiSettings.model = verifiedList[0];
                    }
                } else if (MODEL_OPTIONS && MODEL_OPTIONS[integratedProfile.aiSettings.engine]) {
                    if (!MODEL_OPTIONS[integratedProfile.aiSettings.engine].includes(integratedProfile.aiSettings.model)) {
                         integratedProfile.aiSettings.model = MODEL_OPTIONS[integratedProfile.aiSettings.engine][0];
                    }
                }

                setProfile(integratedProfile);
                applyThemeColors(integratedProfile.accentColor, integratedProfile.secondaryColor);
                setShowSetupModal(false); // Hidden by default as requested
            } else {
                // If no profile is stored, use the defaults
                applyThemeColors(DEFAULT_PROFILE.accentColor, DEFAULT_PROFILE.secondaryColor);
                setShowSetupModal(false);
            }
        } catch (error) {
            console.error('Failed to load company profile:', error);
            setShowSetupModal(false);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Save profile to localStorage and sync AI settings to server file store
    const saveProfile = useCallback((newProfile, shouldCloseModal = true) => {
        try {
            const profileToSave = { ...newProfile, setupComplete: true };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(profileToSave));
            setProfile(profileToSave);
            applyThemeColors(profileToSave.accentColor, profileToSave.secondaryColor);
            if (shouldCloseModal) {
                setShowSetupModal(false);
            }

            // Persist AI settings to server file store (bridges localStorage → Node.js scripts)
            if (profileToSave.aiSettings) {
                const ai = profileToSave.aiSettings;
                const serverPort = window.location.port || '3001';
                const baseUrl = `${window.location.protocol}//${window.location.hostname}:${serverPort}`;
                fetch(`${baseUrl}/api/ai/save-settings`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        engine: ai.engine || 'google',
                        model: ai.model || '',
                        googleApiKey: ai.googleApiKey || '',
                        googleFreeKey: ai.googleFreeKey || '',
                        googleModel: ai.model || '',
                        activeTier: ai.activeTier || 'free',
                        openrouterApiKey: ai.openrouterApiKey || '',
                        openrouterModel: (ai.engine === 'openrouter' ? ai.model : '') || '',
                        verifiedOpenRouterModels: ai.verifiedOpenRouterModels || [],
                        nvidiaApiKey: ai.nvidiaApiKey || '',
                        nvidiaModel: (ai.engine === 'nvidia' ? ai.model : '') || '',
                        verifiedNvidiaModels: ai.verifiedNvidiaModels || [],
                        verifiedModels: ai.verifiedModels || [],
                        savedBy: 'browser',
                    }),
                }).catch((err) => {
                    console.warn('[CompanyContext] Could not sync AI settings to server:', err.message);
                });
            }

            return { success: true };
        } catch (error) {
            console.error('Failed to save company profile:', error);
            if (error.name === 'QuotaExceededError') {
                return { success: false, error: 'Storage quota exceeded. Please use a smaller logo (max 1MB per image).' };
            }
            return { success: false, error: 'Failed to save profile.' };
        }
    }, [applyThemeColors]);


    // Update company name
    const updateCompanyName = useCallback((name) => {
        setProfile(prev => {
            const updated = { ...prev, companyName: name };
            saveProfile(updated);
            return updated;
        });
        return { success: true };
    }, [saveProfile]);

    // Update profile (Unified method)
    const updateProfile = useCallback((name, logoData, website, colors) => {
        let result = { success: true };
        setProfile(prev => {
            const updated = {
                ...prev,
                companyName: name || prev.companyName,
                website: website !== undefined ? website : prev.website,
                logo: logoData !== undefined ? logoData : prev.logo,
                accentColor: colors?.primary || prev.accentColor,
                secondaryColor: colors?.secondary || prev.secondaryColor
            };
            result = saveProfile(updated);
            return updated;
        });
        return result;
    }, [saveProfile]);

    // Update all settings at once (to avoid race conditions)
    const updateAllSettings = useCallback((profileData, aiData) => {
        let result = { success: true };
        setProfile(prev => {
            const updated = {
                ...prev,
                companyName: profileData.name || prev.companyName,
                website: profileData.website !== undefined ? profileData.website : prev.website,
                logo: profileData.logo !== undefined ? profileData.logo : prev.logo,
                accentColor: profileData.colors?.primary || prev.accentColor,
                secondaryColor: profileData.colors?.secondary || prev.secondaryColor,
                aiSettings: { ...prev.aiSettings, ...aiData }
            };
            result = saveProfile(updated);
            return updated;
        });
        return result;
    }, [saveProfile]);

    // Clear profile (reset)
    const clearProfile = useCallback(() => {
        try {
            localStorage.removeItem(STORAGE_KEY);
            setProfile(DEFAULT_PROFILE);
            setShowSetupModal(true);
            return { success: true };
        } catch (error) {
            return { success: false, error: 'Failed to clear profile.' };
        }
    }, []);

    // Convert file to Base64 with INTELLIGENT DETECTION of specifications
    const processLogoFile = useCallback((file) => {
        return new Promise((resolve, reject) => {
            const MAX_SIZE = 1 * 1024 * 1024; // 1MB

            if (file.size > MAX_SIZE) {
                reject(new Error(`Logo file too large. Maximum size is 1MB. Your file is ${(file.size / 1024).toFixed(1)}KB.`));
                return;
            }

            if (!file.type.startsWith('image/')) {
                reject(new Error('Please upload an image file (PNG, JPG, SVG, etc.)'));
                return;
            }

            const reader = new FileReader();
            reader.onload = () => {
                const base64 = reader.result;
                const img = new Image();
                img.onload = () => {
                    const width = img.width;
                    const height = img.height;

                    // Create canvas to analyze and process
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);

                    // 1. Detect Brightness (Is it a light or dark logo?)
                    const imageData = ctx.getImageData(0, 0, width, height).data;
                    let r = 0, g = 0, b = 0, alphaCount = 0;

                    // Sample pixels (every 4th pixel for speed)
                    for (let i = 0; i < imageData.length; i += 16) {
                        const a = imageData[i + 3];
                        if (a > 20) { // Only consider non-transparent pixels
                            r += imageData[i];
                            g += imageData[i + 1];
                            b += imageData[i + 2];
                            alphaCount++;
                        }
                    }

                    const avgBrightness = alphaCount > 0 ? (r + g + b) / (3 * alphaCount) : 128;
                    const isLight = avgBrightness > 180;

                    // 2. Generate White Variant for Blue/Dark backgrounds
                    // If the original is already light, whiteLogo is the original.
                    // If the original is dark, we generate a white version.
                    let whiteLogo;
                    if (isLight) {
                        whiteLogo = base64;
                    } else {
                        ctx.clearRect(0, 0, width, height);
                        ctx.drawImage(img, 0, 0);
                        ctx.globalCompositeOperation = 'source-in';
                        ctx.fillStyle = 'white';
                        ctx.fillRect(0, 0, width, height);
                        whiteLogo = canvas.toDataURL('image/png');
                    }
                    
                    // 3. Extract Dominant Color for UI
                    let primaryColor = '#0f3e67'; // Default
                    if (alphaCount > 0) {
                        const rAvg = Math.round(r / alphaCount);
                        const gAvg = Math.round(g / alphaCount);
                        const bAvg = Math.round(b / alphaCount);
                        primaryColor = `rgb(${rAvg}, ${gAvg}, ${bAvg})`;
                    }

                    resolve({
                        base64,
                        width,
                        height,
                        isLight,
                        whiteLogo,
                        detectedColor: primaryColor
                    });
                };
                img.onerror = () => reject(new Error('Failed to process image data.'));
                img.src = base64;
            };
            reader.onerror = () => reject(new Error('Failed to read the logo file.'));
            reader.readAsDataURL(file);
        });
    }, []);

    const value = {
        // Profile data
        companyName: profile.companyName,
        website: profile.website || '',
        logo: profile.logo,
        logoWhite: profile.logo?.whiteLogo,
        logoOriginal: profile.logo?.base64,
        logoBlue: profile.logo?.base64, // Keep for backward compatibility
        logoVariants: profile.logo, // Provide the full logo object
        accentColor: profile.accentColor,
        secondaryColor: profile.secondaryColor,
        setupComplete: profile.setupComplete,

        // State
        isLoading,
        showSetupModal,
        setShowSetupModal,

        // AI Settings
        aiSettings: profile.aiSettings || DEFAULT_AI_SETTINGS,
        updateAiSettings: (settings) => {
            let result = { success: true };
            setProfile(prev => {
                const updated = {
                    ...prev,
                    aiSettings: { ...prev.aiSettings, ...settings }
                };
                result = saveProfile(updated, false);
                return updated;
            });
            return result;
        },
        updateAllSettings,

        // Actions
        updateCompanyName,
        updateProfile,
        clearProfile,
        processLogoFile
    };

    return (
        <CompanyContext.Provider value={value}>
            {children}
        </CompanyContext.Provider>
    );
}

// Custom hook to use the company profile
export function useCompanyProfile() {
    const context = useContext(CompanyContext);
    if (!context) {
        throw new Error('useCompanyProfile must be used within a CompanyProvider');
    }
    return context;
}

export default CompanyContext;

