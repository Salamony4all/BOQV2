/**
 * server/settings.js
 * ─────────────────────────────────────────────────────────────────────────────
 * File-based AI settings store. Bridges browser localStorage → Node.js scripts.
 *
 * The browser saves keys via POST /api/ai/save-settings → this file.
 * The server reads from this file as a fallback when request headers are absent
 * (e.g. benchmark scripts, background jobs, cron tasks).
 *
 * Location: server/data/ai-settings.json  (gitignored — contains real API keys)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_DIR = path.join(__dirname, 'data');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'ai-settings.json');

/** Default empty settings shape */
const DEFAULT_SETTINGS = {
    // Google
    googleApiKey: '',
    googleFreeKey: '',
    activeTier: 'free',
    googleModel: '',

    // OpenRouter
    openrouterApiKey: '',
    openrouterModel: '',
    verifiedOpenRouterModels: [],

    // NVIDIA
    nvidiaApiKey: '',
    nvidiaModel: '',
    verifiedNvidiaModels: [],

    // Common
    engine: 'google',
    model: '',
    verifiedModels: [],

    // Metadata
    savedAt: null,
    savedBy: 'browser'
};

/** Ensure the data directory exists */
function ensureDir() {
    if (!fs.existsSync(SETTINGS_DIR)) {
        fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    }
}

/**
 * Read persisted AI settings from disk.
 * Returns DEFAULT_SETTINGS if file doesn't exist or is corrupted.
 */
export function readSettings() {
    try {
        ensureDir();
        if (!fs.existsSync(SETTINGS_FILE)) {
            return { ...DEFAULT_SETTINGS };
        }
        const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_SETTINGS, ...parsed };
    } catch (err) {
        console.warn('[Settings] Failed to read ai-settings.json:', err.message);
        return { ...DEFAULT_SETTINGS };
    }
}

/**
 * Write AI settings to disk (merge with existing).
 * Sanitizes keys by stripping bracket placeholders.
 */
export function writeSettings(incoming) {
    try {
        ensureDir();
        const existing = readSettings();
        const sanitize = (v) => (typeof v === 'string' ? v.replace(/^\[.*\]$/, '').trim() : v);

        const merged = {
            ...existing,
            ...Object.fromEntries(
                Object.entries(incoming).map(([k, v]) => [k, sanitize(v)])
            ),
            savedAt: new Date().toISOString(),
        };

        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf-8');
        console.log('[Settings] ✅ ai-settings.json updated at', merged.savedAt);
        return { success: true, settings: merged };
    } catch (err) {
        console.error('[Settings] ❌ Failed to write ai-settings.json:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Return a sanitized (key-masked) view of settings for client responses.
 * Never sends real API keys back to the browser.
 */
export function getPublicSettings() {
    const s = readSettings();
    const mask = (k) => {
        if (!k || k.length < 8) return k ? '••••' : '';
        return `${k.substring(0, 4)}••••${k.substring(k.length - 4)}`;
    };
    return {
        hasGoogleApiKey: !!s.googleApiKey,
        hasGoogleFreeKey: !!s.googleFreeKey,
        hasOpenrouterApiKey: !!s.openrouterApiKey,
        hasNvidiaApiKey: !!s.nvidiaApiKey,
        googleApiKeyPreview: mask(s.googleApiKey),
        googleFreeKeyPreview: mask(s.googleFreeKey),
        openrouterApiKeyPreview: mask(s.openrouterApiKey),
        nvidiaApiKeyPreview: mask(s.nvidiaApiKey),
        engine: s.engine,
        model: s.model,
        googleModel: s.googleModel,
        openrouterModel: s.openrouterModel,
        nvidiaModel: s.nvidiaModel,
        activeTier: s.activeTier,
        verifiedModels: s.verifiedModels,
        verifiedOpenRouterModels: s.verifiedOpenRouterModels,
        verifiedNvidiaModels: s.verifiedNvidiaModels,
        savedAt: s.savedAt,
    };
}
