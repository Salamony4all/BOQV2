import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { del } from '@vercel/blob';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Service to manage file and cloud blob cleanup on session end
 */
class CleanupService {
    constructor() {
        this.sessions = new Map(); // sessionId -> { files: Set, blobs: Set }
        this.cleanupTimeout = 2 * 60 * 60 * 1000; // 2 hours (per user request)
        this.timers = new Map(); // sessionId -> timeout
    }

    getOrCreateSession(sessionId) {
        if (!this.sessions.has(sessionId)) {
            this.sessions.set(sessionId, {
                files: new Set(),
                blobs: new Set()
            });
        }
        return this.sessions.get(sessionId);
    }

    trackFile(sessionId, filePath) {
        const session = this.getOrCreateSession(sessionId);
        session.files.add(filePath);
        this.resetCleanupTimer(sessionId);
    }

    trackBlob(sessionId, url) {
        const session = this.getOrCreateSession(sessionId);
        session.blobs.add(url);
        this.resetCleanupTimer(sessionId);
    }

    resetCleanupTimer(sessionId) {
        if (this.timers.has(sessionId)) {
            clearTimeout(this.timers.get(sessionId));
        }
        const timer = setTimeout(() => {
            this.cleanupSession(sessionId);
        }, this.cleanupTimeout);
        this.timers.set(sessionId, timer);
    }

    async cleanupSession(sessionId) {
        console.log(`[Cleanup] Starting cleanup for session: ${sessionId}`);
        const session = this.sessions.get(sessionId);
        if (!session) return;

        // 1. Cleanup local files
        for (const filePath of session.files) {
            try {
                const exists = await fs.access(filePath).then(() => true).catch(() => false);
                if (exists) {
                    await fs.unlink(filePath);
                    console.log(`[Cleanup] Deleted local file: ${path.basename(filePath)}`);
                }
            } catch (error) {
                console.error(`[Cleanup] Failed to delete file ${filePath}:`, error.message);
            }
        }

        // 2. Cleanup cloud blobs
        if (process.env.BLOB_READ_WRITE_TOKEN) {
            for (const url of session.blobs) {
                try {
                    await del(url);
                    console.log(`[Cleanup] Deleted cloud blob: ${url}`);
                } catch (error) {
                    console.error(`[Cleanup] Failed to delete blob ${url}:`, error.message);
                }
            }
        }

        this.sessions.delete(sessionId);
        if (this.timers.has(sessionId)) {
            clearTimeout(this.timers.get(sessionId));
            this.timers.delete(sessionId);
        }
        console.log(`[Cleanup] Session ${sessionId} cleaned successfully.`);
    }

    async cleanupAll() {
        console.log('[Cleanup] Performing bulk cleanup of all tracked sessions...');
        const sessionIds = Array.from(this.sessions.keys());
        for (const sessionId of sessionIds) {
            await this.cleanupSession(sessionId);
        }

        try {
            const isVercel = process.env.VERCEL === '1';
            const uploadsDir = isVercel ? '/tmp/uploads' : path.join(__dirname, '../uploads');

            const exists = await fs.access(uploadsDir).then(() => true).catch(() => false);
            if (!exists) return;

            const entries = await fs.readdir(uploadsDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name === 'brands') continue;
                const fullPath = path.join(uploadsDir, entry.name);
                try {
                    await fs.rm(fullPath, { recursive: true, force: true });
                } catch (e) { /* silent skip */ }
            }
        } catch (error) {
            console.warn('[Cleanup] Bulk directory cleanup skipped:', error.message);
        }
    }
}

export { CleanupService };
