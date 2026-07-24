import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { deleteFromSupabase, supabase, supabaseAdmin } from './utils/supabaseStorage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Destructive storage ops (list+remove) must use the service-role admin client
// so they aren't blocked by Storage RLS on Vercel. Anon client can read a
// public bucket but cannot delete, which silently left extracted-images behind.
const admin = () => supabaseAdmin || supabase;

/**
 * Service to manage file and cloud blob cleanup on session end
 */
class CleanupService {
    constructor() {
        this.sessions = new Map(); // sessionId -> { files: Set, folders: Set, cloudFolders: Set, blobs: Map<url, {path, bucket}> }
        this.cleanupTimeout = 2 * 60 * 60 * 1000; // 2 hours
        this.timers = new Map(); // sessionId -> timeout

        // Start deep cleanup interval (every 3 hours). Runs on all hosts
        // including Vercel — the sweep targets Supabase `assets` bucket only
        // (no local/blobs), so the serverless timer concern is moot. Images
        // are also age-deleted by /api/reset's cleanupAll().
        this.deepCleanupInterval = setInterval(() => {
            this.performDeepCloudCleanup().catch(err =>
                console.error('[Cleanup] Deep cleanup error:', err)
            );
        }, 3 * 60 * 60 * 1000);
    }

    getOrCreateSession(sessionId) {
        if (!sessionId) return null;
        if (!this.sessions.has(sessionId)) {
            this.sessions.set(sessionId, {
                files: new Set(),
                folders: new Set(),
                cloudFolders: new Set(),
                blobs: new Map()
            });
        }
        return this.sessions.get(sessionId);
    }

    trackFile(sessionId, filePath) {
        const session = this.getOrCreateSession(sessionId);
        if (!session) return;
        session.files.add(filePath);
        this.resetCleanupTimer(sessionId);
    }

    trackFolder(sessionId, folderPath) {
        const session = this.getOrCreateSession(sessionId);
        if (!session) return;
        session.folders.add(folderPath);
        this.resetCleanupTimer(sessionId);
    }

    trackCloudFolder(sessionId, bucket, folderPath) {
        const session = this.getOrCreateSession(sessionId);
        if (!session) return;
        session.cloudFolders.add({ bucket, path: folderPath });
        this.resetCleanupTimer(sessionId);
    }

    /**
     * @param {string} sessionId 
     * @param {string|Object} blobData - Either a URL string or { url, path, bucket }
     */
    trackBlob(sessionId, blobData) {
        const session = this.getOrCreateSession(sessionId);
        if (!session) return;

        if (typeof blobData === 'string') {
            // Legacy support or fallback
            session.blobs.set(blobData, { url: blobData });
        } else {
            session.blobs.set(blobData.url, {
                url: blobData.url,
                path: blobData.path,
                bucket: blobData.bucket || 'assets'
            });
        }
        this.resetCleanupTimer(sessionId);
    }

    resetCleanupTimer(sessionId) {
        if (!sessionId) return;
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

        // 2. Cleanup cloud assets
        for (const [url, meta] of session.blobs) {
            try {
                if (supabase && url.includes('supabase.co')) {
                    let bucket = meta.bucket || 'assets';
                    let filePath = meta.path;

                    // Fallback to URL parsing if path is missing
                    if (!filePath) {
                        const parts = url.split(`/${bucket}/`);
                        if (parts.length > 1) {
                            // Strip query params if any
                            filePath = parts[1].split('?')[0];
                        }
                    }

                    if (filePath) {
                        await deleteFromSupabase(bucket, filePath);
                        console.log(`[Cleanup] Deleted Supabase asset: ${filePath} from ${bucket}`);
                    }
                }
            } catch (error) {
                console.error(`[Cleanup] Failed to delete blob ${url}:`, error.message);
            }
        }

        // 3. Cleanup cloud folders
        const client = admin();
        for (const cloudFolder of session.cloudFolders) {
            try {
                if (client) {
                    const { data: files } = await client.storage.from(cloudFolder.bucket).list(cloudFolder.path);
                    if (files && files.length > 0) {
                        const paths = files.map(f => `${cloudFolder.path}/${f.name}`);
                        const { error: rmErr } = await client.storage.from(cloudFolder.bucket).remove(paths);
                        if (rmErr) console.warn(`[Cleanup] remove failed (${cloudFolder.path}):`, rmErr.message);
                    }
                    console.log(`[Cleanup] Deleted Supabase folder: ${cloudFolder.path}`);
                }
            } catch (error) {
                console.error(`[Cleanup] Failed to delete cloud folder ${cloudFolder.path}:`, error.message);
            }
        }

        // 4. Cleanup local folders
        for (const folderPath of session.folders) {
            try {
                const exists = await fs.access(folderPath).then(() => true).catch(() => false);
                if (exists) {
                    await fs.rm(folderPath, { recursive: true, force: true });
                    console.log(`[Cleanup] Deleted local folder: ${path.basename(folderPath)}`);
                }
            } catch (error) {
                console.error(`[Cleanup] Failed to delete folder ${folderPath}:`, error.message);
            }
        }

        this.sessions.delete(sessionId);
        if (this.timers.has(sessionId)) {
            clearTimeout(this.timers.get(sessionId));
            this.timers.delete(sessionId);
        }
        console.log(`[Cleanup] Session ${sessionId} cleaned successfully.`);
    }

    /**
     * Recursively wipes the Supabase `assets/extracted-images` folder — the
     * "extracted assets" folder where extraction images are uploaded. Unlike
     * the flat-file orphan sweep, this recurses into session subfolders
     * (extracted-images/{sessionId}/img.png), which is where Vercel-uploaded
     * images actually live. Used on startup / refresh / reset.
     */
    async cleanupExtractedImages(bucket = 'assets', rootFolder = 'extracted-images') {
        if (!supabase) return;
        const client = admin();
        if (!client) return;
        try {
            const { data: items, error } = await client.storage.from(bucket).list(rootFolder);
            if (error) { console.warn(`[Cleanup] Could not list ${rootFolder}:`, error.message); return; }
            if (!items || items.length === 0) return;

            for (const item of items) {
                if (!item.id) {
                    // Subfolder (session folder) — recurse into its files
                    const { data: subFiles } = await client.storage.from(bucket).list(`${rootFolder}/${item.name}`);
                    if (subFiles && subFiles.length > 0) {
                        const paths = subFiles.map(f => `${rootFolder}/${item.name}/${f.name}`);
                        const { error: rmErr } = await client.storage.from(bucket).remove(paths);
                        if (rmErr) console.warn(`[Cleanup] remove failed (${rootFolder}/${item.name}):`, rmErr.message);
                    }
                } else {
                    // Flat file directly under the root
                    const { error: rmErr } = await client.storage.from(bucket).remove([`${rootFolder}/${item.name}`]);
                    if (rmErr) console.warn(`[Cleanup] remove failed (${rootFolder}/${item.name}):`, rmErr.message);
                }
            }
            console.log(`[Cleanup] 🗑️ Wiped extracted-images folder (${items.length} top-level entries).`);
        } catch (err) {
            console.error('[Cleanup] extracted-images wipe failed:', err.message);
        }
    }

    /**
     * Scans Supabase storage for abandoned files that aren't in active memory
     * This catches files from previous server runs or crashed sessions.
     */
    async performDeepCloudCleanup() {
        if (!supabase && !supabaseAdmin) return;
        const client = admin();
        if (!client) return;
        console.log('[Cleanup] 🔍 Starting Deep Cloud Cleanup scan...');

        try {
            const bucket = 'assets';
            const rootFolders = ['temp-uploads', 'extracted-images', 'manual-upload', 'vision-crops'];

            for (const rootFolder of rootFolders) {
                const { data: sessionFolders, error: listError } = await client.storage.from(bucket).list(rootFolder);

                if (listError) {
                    console.warn(`[Cleanup] Could not list ${rootFolder}:`, listError.message);
                    continue;
                }
                if (!sessionFolders) continue;

                for (const item of sessionFolders) {
                    // Case 1: Item is a SUBFOLDER (no id) — check if it's an old session folder
                    if (!item.id && !this.sessions.has(item.name)) {

                        // Check if it looks like a temporary session folder or is old
                        const isSessionFolder = item.name.startsWith('sess-') || item.name.length > 20;
                        const isOld = (Date.now() - new Date(item.created_at).getTime()) > 2 * 60 * 60 * 1000; // 2 hours

                        if (isSessionFolder && isOld) {
                            console.log(`[Cleanup] 🗑️ Deep cleaning abandoned session folder: ${rootFolder}/${item.name}`);

                            // List files in folder
                            const { data: files } = await client.storage.from(bucket).list(`${rootFolder}/${item.name}`);
                            if (files && files.length > 0) {
                                const pathsToDelete = files.map(f => `${rootFolder}/${item.name}/${f.name}`);
                                const { error: rmErr } = await client.storage.from(bucket).remove(pathsToDelete);
                                if (rmErr) console.warn(`[Cleanup] remove failed (${rootFolder}/${item.name}):`, rmErr.message);
                                else console.log(`[Cleanup] Deleted ${pathsToDelete.length} files from ${rootFolder}/${item.name}`);
                            }
                        }
                    }
                    // Case 2: Item is a FLAT FILE (has id) — delete if older than 2 hours
                    // This catches orphaned extracted-images that aren't in session subfolders
                    else if (item.id && item.created_at) {
                        const fileAge = Date.now() - new Date(item.created_at).getTime();
                        if (fileAge > 2 * 60 * 60 * 1000) { // 2 hours
                            const { error: rmErr } = await client.storage.from(bucket).remove([`${rootFolder}/${item.name}`]);
                            if (rmErr) console.warn(`[Cleanup] remove failed (${rootFolder}/${item.name}):`, rmErr.message);
                            else console.log(`[Cleanup] 🗑️ Removed orphaned flat file: ${rootFolder}/${item.name} (age: ${Math.round(fileAge / 60000)}min)`);
                        }
                    }
                }
            }
            console.log('[Cleanup] ✅ Deep Cloud Cleanup finished.');
        } catch (error) {
            console.error('[Cleanup] Deep cleanup failed:', error.message);
        }
    }

    async cleanupAll() {
        console.log('[Cleanup] Performing bulk cleanup of all tracked sessions...');
        const sessionIds = Array.from(this.sessions.keys());
        for (const sessionId of sessionIds) {
            await this.cleanupSession(sessionId);
        }

        // FORCE WIPE ROOT STORAGE DIRECTORIES IN SUPABASE (Handles stateless instances/Vercel boots)
        if (supabase || supabaseAdmin) {
            const client = admin();
            if (client) {
                console.log('[Cleanup] 🌀 Executing complete target folder evacuation in Supabase assets...');
                const bucket = 'assets';
                const rootFolders = ['temp-uploads', 'extracted-images', 'manual-upload', 'vision-crops'];

                for (const rootFolder of rootFolders) {
                    try {
                        const { data: items } = await client.storage.from(bucket).list(rootFolder);
                        if (items && items.length > 0) {
                            for (const item of items) {
                                if (!item.id) { // This item is a subfolder directory
                                    const { data: subFiles } = await client.storage.from(bucket).list(`${rootFolder}/${item.name}`);
                                    if (subFiles && subFiles.length > 0) {
                                        const paths = subFiles.map(f => `${rootFolder}/${item.name}/${f.name}`);
                                        const { error: rmErr } = await client.storage.from(bucket).remove(paths);
                                        if (rmErr) console.warn(`[Cleanup] remove failed (${rootFolder}/${item.name}):`, rmErr.message);
                                    }
                                } else { // This item is a file directly inside root folder
                                    const { error: rmErr } = await client.storage.from(bucket).remove([`${rootFolder}/${item.name}`]);
                                    if (rmErr) console.warn(`[Cleanup] remove failed (${rootFolder}/${item.name}):`, rmErr.message);
                                }
                            }
                            console.log(`[Cleanup] Successfully evacuated root bucket directory: ${rootFolder}`);
                        }
                    } catch (err) {
                        console.error(`[Cleanup] Core folder evacuation bypassed for ${rootFolder}:`, err.message);
                    }
                }
            }
        }

        // Clean deep cloud too
        await this.performDeepCloudCleanup();

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