import { useState } from 'react';
import { useCompanyProfile } from '../context/CompanyContext';
import styles from '../styles/PptxTemplateModal.module.css';

export default function PptxTemplateModal({ isOpen, onClose, onExport, isGenerating = false }) {
    const { accentColor, secondaryColor } = useCompanyProfile();
    const [selectedTemplate, setSelectedTemplate] = useState('corporate');

    if (!isOpen) return null;

    // Normalizing colors for swatch previews
    const primaryColor = accentColor || '#0f3e67';
    const accentColorValue = secondaryColor || '#f59e0b';

    const companyColors = {
        primary: primaryColor,
        accent: accentColorValue,
        bg: '#FFFFFF',
        text: '#333333'
    };

    const templates = [
        {
            id: 'corporate',
            name: 'Modern Corporate (Light)',
            desc: 'Clean light slides with custom company branding colors, balanced rectangular grids, and clean headers. Best for professional pitches.',
            font: 'Arial',
            layout: 'Header Bar + Grey Footer',
            isDark: false,
            colors: [
                companyColors.bg,
                companyColors.primary,
                companyColors.accent,
                companyColors.text
            ]
        },
        {
            id: 'dark',
            name: 'Dark Premium (Sleek Dark)',
            desc: 'A premium, modern slate-900 background with high-contrast text, primary accent header shapes, and clean grids. Highly engaging.',
            font: 'Calibri',
            layout: 'Dark Slate Header + Footer',
            isDark: true,
            colors: [
                '#0F172A',
                companyColors.primary,
                companyColors.accent,
                '#E2E8F0'
            ]
        },
        {
            id: 'minimalist',
            name: 'Minimalist Architect (Clean)',
            desc: 'Elegant editorial design with serif typography, thin borders, generous whitespace, and pure white slide backgrounds. Subtle color pops.',
            font: 'Georgia',
            layout: 'Thin Divider Line Header',
            isDark: false,
            colors: [
                '#FFFFFF',
                '#111111',
                companyColors.primary,
                '#222222'
            ]
        },
        {
            id: 'creative',
            name: 'Vibrant Creative (Warm)',
            desc: 'Warm paper-textured background with rich warm charcoal text and vibrant accents. Great for boutique fits and creative projects.',
            font: 'Trebuchet MS',
            layout: 'Warm Flat Header shapes',
            isDark: false,
            colors: [
                '#FAF8F5',
                companyColors.primary,
                companyColors.accent,
                '#2C2520'
            ]
        },
        {
            id: 'tech',
            name: 'Tech Industrial (Steel & Teal)',
            desc: 'Clean layout with cool slate background, steel-blue primary blocks, and bright teal accent lines. Monospace styling for structural info.',
            font: 'Segoe UI',
            layout: 'Steel Blue Header + Teal accent',
            isDark: false,
            colors: [
                '#F1F5F9',
                '#1E293B',
                '#0D9488',
                '#0F172A'
            ]
        }
    ];

    const handleSubmit = () => {
        onExport(selectedTemplate);
    };

    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className={styles.header}>
                    <h2 className={styles.title}>Export Presentation Template</h2>
                    <p className={styles.subtitle}>Select a visual style and color theme for your exported presentation slides</p>
                </div>

                {/* Body */}
                <div className={styles.body}>
                    <div className={styles.templateGrid}>
                        {templates.map((template) => {
                            const isActive = selectedTemplate === template.id;
                            return (
                                <div
                                    key={template.id}
                                    className={`${styles.card} ${isActive ? styles.active : ''}`}
                                    onClick={() => setSelectedTemplate(template.id)}
                                >
                                    {template.isDark && <span className={styles.badge}>Dark</span>}
                                    <div className={styles.cardName}>{template.name}</div>
                                    <div className={styles.cardDesc}>{template.desc}</div>

                                    {/* Swatch Previews */}
                                    <div className={styles.swatchBar}>
                                        {template.colors.map((color, idx) => (
                                            <div
                                                key={idx}
                                                className={styles.swatch}
                                                style={{ backgroundColor: color }}
                                                title={`Color Swatch: ${color}`}
                                            />
                                        ))}
                                    </div>

                                    {/* Style specs */}
                                    <div className={styles.styleDetails}>
                                        <div className={styles.detailRow}>
                                            <span className={styles.detailLabel}>Typography</span>
                                            <span className={styles.detailVal}>{template.font}</span>
                                        </div>
                                        <div className={styles.detailRow}>
                                            <span className={styles.detailLabel}>Layout</span>
                                            <span className={styles.detailVal}>{template.layout}</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Actions */}
                <div className={styles.actions}>
                    <button className={styles.cancelBtn} onClick={onClose} disabled={isGenerating}>
                        Cancel
                    </button>
                    <button className={styles.submitBtn} onClick={handleSubmit} disabled={isGenerating}>
                        {isGenerating ? 'Generating...' : 'Export Presentation'}
                    </button>
                </div>
            </div>
        </div>
    );
}
