/**
 * Centralized theme configuration for document generation and UI styles.
 * Use these constants to ensure visual consistency across PDF, Excel, and PPTX exports.
 */

/**
 * Normalizes hex colors for PPTX/PDF engines
 */
export const fixHex = (col) => {
    if (!col) return null;
    let hex = col.trim().replace(/^#/, '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    if (hex.length === 6 || hex.length === 8) return hex.toUpperCase();
    return null;
};

/**
 * Converts Hex to RGB array for jsPDF
 */
export const hexToRgb = (hex) => {
    const cleanHex = fixHex(hex) || 'FFFFFF';
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    return [r, g, b];
};

/**
 * Returns the standardized brand colors object.
 * @param {string} accentColor - Primary brand color (Hex)
 * @param {string} secondaryColor - Secondary/Accent brand color (Hex)
 */
export const getBrandColors = (accentColor, secondaryColor) => {
    let primaryHex = fixHex(accentColor) || '0F3E67';
    if (primaryHex === '3B82F6' || primaryHex === '1E5FA8' || primaryHex === '2563EB') {
        primaryHex = '0F3E67';
    }
    const accentHex = fixHex(secondaryColor) || 'F5A623';

    return {
        primary: primaryHex,
        accent: accentHex,
        text: '333333',
        lightText: '666666',
        border: 'E0E0E0',
        bg: 'FFFFFF',
        lightBg: 'F5F5F5',
        // RGB versions for jsPDF
        primaryRgb: hexToRgb(primaryHex),
        accentRgb: hexToRgb(accentHex),
        textRgb: [51, 51, 51],
        lightTextRgb: [102, 102, 102],
        borderRgb: [224, 224, 224],
        bgRgb: [255, 255, 255],
        lightBgRgb: [245, 245, 245]
    };
};

export const UI_COLORS = {
    costing: '#f59e0b',
    costingBg: 'rgba(245, 158, 11, 0.05)',
    primary: '#3b82f6',
    primaryBg: 'rgba(59, 130, 246, 0.05)',
    danger: '#ef4444',
    success: '#10b981',
    muted: '#94a3b8',
    darkBg: '#1e293b',
    border: '#334155'
};
