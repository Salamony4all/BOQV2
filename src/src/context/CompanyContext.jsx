import { createContext, useContext, useState, useEffect, useCallback } from 'react';

// Create the context
const CompanyContext = createContext(null);

// Storage key
const STORAGE_KEY = 'boqflow_company_profile';

// Default empty profile
const DEFAULT_PROFILE = {
    companyName: '',
    website: '',
    logo: null, // { base64, width, height, isLight, whiteLogo }
    setupComplete: false
};

// Provider component
export function CompanyProvider({ children }) {
    const [profile, setProfile] = useState(DEFAULT_PROFILE);
    const [isLoading, setIsLoading] = useState(true);
    const [showSetupModal, setShowSetupModal] = useState(false);

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
                setProfile(parsed);
                setShowSetupModal(!parsed.setupComplete);
            } else {
                setShowSetupModal(true);
            }
        } catch (error) {
            console.error('Failed to load company profile:', error);
            setShowSetupModal(true);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Save profile to localStorage
    const saveProfile = useCallback((newProfile) => {
        try {
            const profileToSave = { ...newProfile, setupComplete: true };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(profileToSave));
            setProfile(profileToSave);
            setShowSetupModal(false);
            return { success: true };
        } catch (error) {
            console.error('Failed to save company profile:', error);
            // Check if it's a quota error
            if (error.name === 'QuotaExceededError') {
                return { success: false, error: 'Storage quota exceeded. Please use a smaller logo.' };
            }
            return { success: false, error: 'Failed to save profile.' };
        }
    }, []);

    // Update company name
    const updateCompanyName = useCallback((name) => {
        const updated = { ...profile, companyName: name };
        return saveProfile(updated);
    }, [profile, saveProfile]);

    // Update profile
    const updateProfile = useCallback((name, logoData, website) => {
        const updated = {
            ...profile,
            companyName: name,
            website: website !== undefined ? website : profile.website,
            logo: logoData !== undefined ? logoData : profile.logo
        };
        return saveProfile(updated);
    }, [profile, saveProfile]);

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

                    resolve({
                        base64,
                        width,
                        height,
                        isLight,
                        whiteLogo
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
        logoBlue: profile.logo?.base64,
        logoOriginal: profile.logo?.base64,
        setupComplete: profile.setupComplete,

        // State
        isLoading,
        showSetupModal,
        setShowSetupModal,

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
