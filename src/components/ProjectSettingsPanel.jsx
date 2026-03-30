import { useState, useEffect } from 'react';
import { useProject } from '../context/ProjectContext';
import styles from '../styles/ProjectSettingsPanel.module.css';

const FIELDS = [
    { key: 'projectName', label: 'Project Name', placeholder: 'e.g. Al Rayyan Tower Fit-Out', icon: '🏗️' },
    { key: 'projectNumber', label: 'Project Number', placeholder: 'e.g. PRJ-2026-001', icon: '🔢' },
    { key: 'clientName', label: 'Client / Owner', placeholder: 'e.g. ABC Holding Group', icon: '👤' },
    { key: 'clientLogo', label: 'Client Logo', type: 'image', icon: '🖼️' },
    { key: 'locationZone', label: 'Location / Zone', placeholder: 'e.g. Zone B – Level 3', icon: '📍' },
    { key: 'contractor', label: 'Contractor', placeholder: 'e.g. XYZ Contracting LLC', icon: '🏢', toggleKey: 'includeContractor' },
    { key: 'consultant', label: 'Consultant', placeholder: 'e.g. AECOM Middle East', icon: '📐', toggleKey: 'includeConsultant' },
    { key: 'siteEngineer', label: 'Site Engineer', placeholder: 'e.g. Eng. Ahmed Al-Rashid', icon: '👷' },
    { key: 'issueDate', label: 'Issue Date', placeholder: '', icon: '📅', type: 'date' },
    { key: 'revision', label: 'Revision', placeholder: 'e.g. Rev 0', icon: '🔄' },
    { key: 'mirReference', label: 'MIR Reference / Code', placeholder: 'e.g. MIR-001', icon: '📝' },
    { key: 'wirReference', label: 'WIR Reference / Code', placeholder: 'e.g. WIR-001', icon: '📝' },
    { key: 'brandOrigin', label: 'Brand / Origin (Preset)', placeholder: 'e.g. Sony / Japan', icon: '🏷️' },
    { key: 'unitOfMeasure', label: 'Unit of Measure (Preset)', placeholder: 'e.g. PCS, Nos', icon: '📏' },
    { key: 'originatorName', label: 'Originator Name', placeholder: 'e.g. John Doe', icon: '👤' },
    { key: 'originatorDesignation', label: 'Originator Designation', placeholder: 'e.g. QA/QC Engineer', icon: '📛' },
    { key: 'clientRepName', label: 'Client Rep Name', placeholder: 'e.g. Jane Smith', icon: '👤' },
    { key: 'clientRepDesignation', label: 'Client Rep Designation', placeholder: 'e.g. Project Manager', icon: '📛' },
];

export default function ProjectSettingsPanel({ isOpen, onClose }) {
    const { project, updateProject, resetProject } = useProject();
    const [local, setLocal] = useState({ ...project });
    const [saved, setSaved] = useState(false);

    // Sync when project changes externally or panel reopens
    useEffect(() => {
        if (isOpen) setLocal({ ...project });
    }, [isOpen, project]);

    const handleChange = (key, value) => {
        setLocal(prev => ({ ...prev, [key]: value }));
    };

    const handleSave = () => {
        updateProject(local);
        setSaved(true);
        setTimeout(() => {
            setSaved(false);
            onClose();
        }, 900);
    };

    const handleImageUpload = (key, file) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => handleChange(key, e.target.result);
        reader.readAsDataURL(file);
    };

    const handleReset = () => {
        if (window.confirm('Clear all project settings?')) {
            resetProject();
            setLocal({ ...project });
        }
    };

    const filledCount = FIELDS.filter(f => local[f.key]?.toString().trim()).length;
    const pct = Math.round((filledCount / FIELDS.length) * 100);

    return (
        <>
            {/* Backdrop */}
            <div
                className={`${styles.backdrop} ${isOpen ? styles.backdropVisible : ''}`}
                onClick={onClose}
            />

            {/* Drawer */}
            <div className={`${styles.drawer} ${isOpen ? styles.drawerOpen : ''}`}>
                {/* Header */}
                <div className={styles.drawerHeader}>
                    <div className={styles.headerLeft}>
                        <span className={styles.headerIcon}>☰</span>
                        <div>
                            <h2 className={styles.headerTitle}>Project Settings</h2>
                            <p className={styles.headerSub}>These details appear on all generated documents</p>
                        </div>
                    </div>
                    <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
                </div>

                {/* Completion Bar */}
                <div className={styles.progressSection}>
                    <div className={styles.progressLabel}>
                        <span>Profile Completion</span>
                        <span className={styles.progressPct}>{pct}%</span>
                    </div>
                    <div className={styles.progressTrack}>
                        <div
                            className={styles.progressFill}
                            style={{ width: `${pct}%`, background: pct === 100 ? '#10b981' : '#f59e0b' }}
                        />
                    </div>
                </div>

                {/* Fields */}
                <div className={styles.fieldsScroll}>
                    {FIELDS.map(({ key, label, placeholder, icon, type, toggleKey }) => {
                        const isToggledOff = toggleKey ? local[toggleKey] === false : false;

                        return (
                            <div key={key} className={`${styles.fieldGroup} ${isToggledOff ? styles.fieldGroupDisabled : ''}`}>
                                <div className={styles.fieldHeader}>
                                    <label className={styles.fieldLabel}>
                                        <span className={styles.fieldIcon}>{icon}</span>
                                        {label}
                                    </label>
                                    {toggleKey && (
                                        <button
                                            className={`${styles.toggleBtn} ${isToggledOff ? styles.toggleBtnAdd : styles.toggleBtnRemove}`}
                                            title={isToggledOff ? 'Include in documents' : 'Remove from documents'}
                                            onClick={() => handleChange(toggleKey, isToggledOff)}
                                            type="button"
                                        >
                                            {isToggledOff ? '+ Add' : '× Hide'}
                                        </button>
                                    )}
                                </div>
                                {type === 'image' ? (
                                    <div className={styles.imageUploadWrapper}>
                                        <input
                                            type="file"
                                            accept="image/*"
                                            className={styles.imageInput}
                                            onChange={e => handleImageUpload(key, e.target.files[0])}
                                            disabled={isToggledOff}
                                        />
                                        {local[key] && (
                                            <div className={styles.imagePreview}>
                                                <img src={local[key]} alt="Preview" />
                                                <button
                                                    type="button"
                                                    className={styles.removeImageBtn}
                                                    onClick={() => handleChange(key, '')}
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <input
                                        type={type || 'text'}
                                        className={styles.fieldInput}
                                        value={local[key] || ''}
                                        onChange={e => handleChange(key, e.target.value)}
                                        placeholder={placeholder}
                                        disabled={isToggledOff}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Footer Actions */}
                <div className={styles.drawerFooter}>
                    <button className={styles.resetBtn} onClick={handleReset}>↺ Reset</button>
                    <button
                        className={`${styles.saveBtn} ${saved ? styles.saveBtnSuccess : ''}`}
                        onClick={handleSave}
                    >
                        {saved ? '✓ Saved!' : '💾 Save Settings'}
                    </button>
                </div>
            </div>
        </>
    );
}
