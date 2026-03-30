import { useState, useRef } from 'react';
import { useCompanyProfile } from '../context/CompanyContext';
import styles from '../styles/CompanySettings.module.css';

export default function CompanySettings({ isModal = false, onClose = null }) {
    const {
        companyName,
        website: storedWebsite,
        logo: storedLogo,
        updateProfile,
        processLogoFile,
        clearProfile
    } = useCompanyProfile();

    const [name, setName] = useState(companyName || '');
    const [website, setWebsite] = useState(storedWebsite || '');
    const [logo, setLogo] = useState(storedLogo || null); // This is the logo object {base64, width, height, isLight, whiteLogo}
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const fileInputRef = useRef(null);

    const handleLogoUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setError(null);
        setIsProcessing(true);

        try {
            const logoData = await processLogoFile(file);
            setLogo(logoData);
            setSuccess('Logo uploaded and specifications detected!');
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            setError(err.message);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleRemoveLogo = () => {
        setLogo(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleSave = () => {
        if (!name.trim()) {
            setError('Please enter a company name.');
            return;
        }

        setError(null);
        const result = updateProfile(name.trim(), logo, website.trim());

        if (result.success) {
            setSuccess('Company profile saved successfully!');
            setTimeout(() => {
                setSuccess(null);
                if (onClose) onClose();
            }, 1500);
        } else {
            setError(result.error);
        }
    };

    const handleReset = () => {
        if (window.confirm('Are you sure you want to reset your company profile? This cannot be undone.')) {
            clearProfile();
            setName('');
            setWebsite('');
            setLogo(null);
        }
    };

    const handleSkip = () => {
        updateProfile(name.trim() || 'My Company', logo, website.trim());
        if (onClose) onClose();
    };

    return (
        <div className={isModal ? styles.modalOverlay : styles.settingsPage}>
            <div className={isModal ? styles.modalContent : styles.settingsContainer}>
                {/* Header */}
                <div className={styles.header}>
                    <h2 className={styles.title}>
                        {isModal ? 'Welcome to BOQFLOW' : 'Company Settings'}
                    </h2>
                    {isModal && (
                        <p className={styles.subtitle}>
                            Set up your company profile to personalize your documents
                        </p>
                    )}
                </div>

                {/* Form */}
                <div className={styles.form}>
                    {/* Company Name */}
                    <div className={styles.field}>
                        <label className={styles.label}>Company Name</label>
                        <input
                            type="text"
                            className={styles.input}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Enter your company name"
                            maxLength={100}
                        />
                    </div>

                    {/* Company Website */}
                    <div className={styles.field}>
                        <label className={styles.label}>Company Website</label>
                        <input
                            type="text"
                            className={styles.input}
                            value={website}
                            onChange={(e) => setWebsite(e.target.value)}
                            placeholder="e.g. www.yourcompany.com"
                            maxLength={100}
                        />
                    </div>

                    {/* Company Logo - Simplified to ONE button */}
                    <div className={styles.field}>
                        <label className={styles.label}>
                            Company Logo
                            <span className={styles.hint}>(Max 1MB - Transparent PNG Recommended)</span>
                        </label>

                        <div className={styles.logoSection}>
                            {/* Logo Preview */}
                            <div className={`${styles.logoPreview} ${logo?.isLight ? styles.logoPreviewWhite : ''}`}>
                                {logo ? (
                                    <img src={logo.base64} alt="Company Logo" className={styles.logoImage} />
                                ) : (
                                    <div className={styles.logoPlaceholder}>
                                        <span className={styles.placeholderText}>No Logo</span>
                                    </div>
                                )}
                            </div>

                            {/* Upload Controls */}
                            <div className={styles.logoControls}>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    onChange={handleLogoUpload}
                                    className={styles.fileInput}
                                    id="logo-upload"
                                />
                                <label htmlFor="logo-upload" className={styles.uploadBtn}>
                                    {isProcessing ? 'Detecting...' : logo ? 'Change Logo' : 'Upload Logo'}
                                </label>
                                {logo && (
                                    <div className={styles.detectedSpecs}>
                                        <span className={styles.specItem}>✅ {logo.width}x{logo.height}px</span>
                                        <span className={styles.specItem}>✅ {logo.isLight ? 'Light variant' : 'Dark variant'}</span>
                                        {!logo.isLight && <span className={styles.specItem}>✅ Auto-header version created</span>}
                                        <button
                                            type="button"
                                            className={styles.removeBtnInline}
                                            onClick={handleRemoveLogo}
                                        >
                                            Remove
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Messages */}
                    {error && (
                        <div className={styles.errorMessage}>{error}</div>
                    )}
                    {success && (
                        <div className={styles.successMessage}>{success}</div>
                    )}
                </div>

                {/* Actions */}
                <div className={styles.actions}>
                    {isModal ? (
                        <>
                            <button
                                type="button"
                                className={styles.skipBtn}
                                onClick={handleSkip}
                            >
                                Skip for Now
                            </button>
                            <button
                                type="button"
                                className={styles.saveBtn}
                                onClick={handleSave}
                                disabled={isProcessing}
                            >
                                Save & Continue
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                type="button"
                                className={styles.resetBtn}
                                onClick={handleReset}
                            >
                                Reset Profile
                            </button>
                            <button
                                type="button"
                                className={styles.saveBtn}
                                onClick={handleSave}
                                disabled={isProcessing}
                            >
                                Save Changes
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
