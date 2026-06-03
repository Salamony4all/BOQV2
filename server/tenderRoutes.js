import express from 'express';
import axios from 'axios';
import { supabase, getSupabaseBlueprint, saveSupabaseBlueprint } from './utils/supabaseStorage.js';
import { callGoogle } from './utils/llmUtils.js';

const router = express.Router();

const AUTO_BROWSER_SERVICE_URL = process.env.AUTO_BROWSER_URL || 'http://auto-browser-container:8000';
const BROWSER_GATEWAY_TOKEN = process.env.BROWSER_GATEWAY_TOKEN || '';
const AUTO_BROWSER_HEADERS = BROWSER_GATEWAY_TOKEN ? { Authorization: `Bearer ${BROWSER_GATEWAY_TOKEN}` } : {};

// In-Memory Telemetry Tracker for Background Loop Updates
const sessionTracker = new Map();

const MAX_SESSION_LOGS = 200;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const COMPLETED_TTL_MS = 10 * 60 * 1000; // 10 minutes for finished sessions

// Helper: append a log entry and cap the array to prevent memory bloat
function appendLog(ctx, message) {
    ctx.logs.push(message);
    if (ctx.logs.length > MAX_SESSION_LOGS) {
        ctx.logs = ctx.logs.slice(-MAX_SESSION_LOGS);
    }
}

// Periodic cleanup of stale sessions to prevent memory leaks
setInterval(() => {
    const now = Date.now();
    for (const [id, ctx] of sessionTracker) {
        const age = now - ctx.createdAt;
        const isTerminal = ctx.status === 'completed' || ctx.status === 'failed';
        if (age > SESSION_TTL_MS || (isTerminal && age > COMPLETED_TTL_MS)) {
            sessionTracker.delete(id);
            console.log(`🧹 [Tender Cleanup] Purged stale session ${id}`);
        }
    }
}, 5 * 60 * 1000);

/**
 * Route 1: Allocate Context Node
 */
router.post('/setup', async (req, res) => {
    try {
        console.log(`🌐 [Tender Router] Provisioning isolated execution container profile instance...`);

        let session_id;
        let vnc_url;

        try {
            console.log('Tender setup auth present:', !!BROWSER_GATEWAY_TOKEN, 'AUTO_BROWSER_SERVICE_URL=', AUTO_BROWSER_SERVICE_URL);
            const response = await axios.post(
                `${AUTO_BROWSER_SERVICE_URL}/sessions`,
                {},
                { timeout: 25000, headers: AUTO_BROWSER_HEADERS }
            );
            session_id = response.data.id;
            vnc_url = response.data.takeover_url;

            // Navigate to target URL in background to prevent slow portals from failing the setup response
            axios.post(
                `${AUTO_BROWSER_SERVICE_URL}/sessions/${session_id}/actions/navigate`,
                { url: "https://etendering.tenderboard.gov.om/product/publicDash?CTRL_STRDIRECTION=LTR" },
                { headers: AUTO_BROWSER_HEADERS }
            ).catch(err => {
                console.warn("[Tender Router] Background navigation trigger warning:", err.message);
            });
        } catch (postError) {
            if (postError.response && postError.response.status === 409) {
                const getResponse = await axios.get(`${AUTO_BROWSER_SERVICE_URL}/sessions`, { headers: AUTO_BROWSER_HEADERS });
                if (getResponse.data && getResponse.data.length > 0) {
                    session_id = getResponse.data[0].id;
                    vnc_url = getResponse.data[0].takeover_url;
                } else {
                    throw new Error("409 Conflict but no active sessions found.");
                }
            } else {
                const status = postError.response?.status;
                const data = postError.response?.data;
                console.error('Auto-browser session create failed:', status, data || postError.message);
                throw postError;
            }
        }

        sessionTracker.set(session_id, {
            status: 'ready',
            logs: ['📡 Secure web layer browser handoff profile allocated successfully.'],
            error: null,
            createdAt: Date.now()
        });

        if (vnc_url && vnc_url.includes('127.0.0.1:6080')) {
            const publicVncBase = process.env.AUTO_BROWSER_VNC_URL || 'https://browser-node-production.up.railway.app';
            vnc_url = vnc_url.replace('http://127.0.0.1:6080', publicVncBase);
            vnc_url = vnc_url.replace('resize=remote', 'resize=scale');
        }

        return res.json({ success: true, session_id: session_id, vnc_url: vnc_url });
    } catch (error) {
        return res.status(502).json({ success: false, error: 'Failed to map browser runtime worker node context.' });
    }
});

/**
 * Route 2: Get Telemetry State Updates
 */
router.get('/status/:session_id', async (req, res) => {
    const { session_id } = req.params;
    try {
        // Query the auto-browser server for current session summary which contains the persistent bulk_fill state
        const response = await axios.get(
            `${AUTO_BROWSER_SERVICE_URL}/sessions/${session_id}`,
            { headers: AUTO_BROWSER_HEADERS, timeout: 5000 }
        );
        const sessionData = response.data;

        if (sessionData && sessionData.metadata && sessionData.metadata.bulk_fill) {
            const bf = sessionData.metadata.bulk_fill;
            return res.json({
                success: true,
                status: bf.status, // 'executing', 'completed', 'failed'
                logs: bf.logs || [],
                error: bf.error || null
            });
        }
    } catch (err) {
        console.warn(`[Tender Router] Telemetry sync from Railway failed: ${err.message}`);
    }

    const tracking = sessionTracker.get(session_id);
    if (tracking) {
        return res.json({ success: true, status: tracking.status, logs: tracking.logs, error: tracking.error });
    }

    return res.json({
        success: true,
        status: 'executing',
        logs: ['🔄 Syncing telemetry... (Serverless context reset)'],
        error: null
    });
});

/**
 * Route 4: Map Platform Blueprint
 */
router.post('/map-platform', async (req, res) => {
    const { session_id, domain_name, force_remap } = req.body;
    if (!session_id || !domain_name) return res.status(400).json({ error: 'Missing session_id or domain_name' });

    const ctx = sessionTracker.get(session_id);
    try {
        if (!force_remap) {
            const existingBlueprint = await getSupabaseBlueprint(domain_name);
            if (existingBlueprint) {
                if (ctx) appendLog(ctx, `✅ Loaded existing blueprint for ${domain_name} from Supabase.`);
                return res.json({ success: true, blueprint: existingBlueprint });
            }
        }

        if (ctx) appendLog(ctx, `🔍 Extracting site DOM blueprint for ${domain_name}...`);

        const observeRes = await axios.post(
            `${AUTO_BROWSER_SERVICE_URL}/sessions/${session_id}/observe`,
            { limit: 100, preset: "normal" },
            { headers: AUTO_BROWSER_HEADERS }
        );
        const rawState = observeRes.data.dom_outline || observeRes.data || '';
        const domString = typeof rawState === 'string' ? rawState : JSON.stringify(rawState);
        const safeOutline = domString.substring(0, 15000);

        const prompt = `Analyze this web page snapshot and output ONLY a valid JSON schema blueprint for data entry. 
Target Domain: ${domain_name}
We need to fill only the "Unit Price In Fig" field for each BoQ row. Determine:
- row_selector: A CSS selector that matches each BoQ data row.
- input_selector: A CSS selector that identifies the editable Unit Price In Fig input inside that row.
- requires_click_to_edit: boolean.

IMPORTANT: Do not return selectors for any other columns or fields.
DOM Outline:
${safeOutline}

CRITICAL: Output ONLY pure valid JSON with no markdown formatting.`;

        if (ctx) appendLog(ctx, `🤖 Analyzing layout using gemma-4-31b-it proxy...`);
        const llmResult = await callGoogle("Output ONLY pure valid JSON.", prompt, false, "gemma-4-31b-it");

        if (!llmResult || !llmResult.row_selector || !llmResult.input_selector) {
            throw new Error("AI failed to extract a valid blueprint.");
        }

        await saveSupabaseBlueprint(domain_name, llmResult);
        if (ctx) appendLog(ctx, `💾 Blueprint securely persisted.`);

        return res.json({ success: true, blueprint: llmResult });
    } catch (err) {
        console.error("Map Platform Error:", err);
        if (ctx) appendLog(ctx, `❌ Blueprint mapping failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to map platform' });
    }
});

/**
 * Route 5: Execute Bulk Blueprint (SERVER-SIDE CDP — Full Speed)
 *
 * Delegates the entire fill loop to the auto-browser controller on Railway,
 * which runs it internally using its already-connected Playwright instance
 * at full CDP speed. Vercel just fires one HTTP POST — no WebSocket needed.
 */
router.post('/execute-bulk-blueprint', async (req, res) => {
    let { session_id, domain_name, boq_data, blueprint } = req.body;
    if (!session_id || !domain_name || !boq_data) return res.status(400).json({ error: 'Missing required parameters' });

    if (!blueprint) {
        blueprint = await getSupabaseBlueprint(domain_name);
        if (!blueprint) return res.status(400).json({ error: "No mapping available for this platform." });
    }

    const ctx = sessionTracker.get(session_id);
    if (ctx) {
        ctx.status = 'executing';
        appendLog(ctx, `🚀 Dispatching bulk fill job to browser engine (${boq_data.length} items)...`);
    }

    const bulkFillPayload = {
        blueprint: {
            row_selector: blueprint.row_selector,
            input_selector: blueprint.input_selector,
            requires_click_to_edit: Boolean(blueprint.requires_click_to_edit)
        },
        items: boq_data.map(item => ({
            label: item.item_code || (item.description ? item.description.substring(0, 30) : ''),
            value: (item.rate || item.unit_price || 0).toString()
        }))
    };

    if (ctx) appendLog(ctx, `📘 Blueprint: ${JSON.stringify(bulkFillPayload.blueprint)}`);

    try {
        // Call the native bulk-fill endpoint. It returns instantly because it executes as a BackgroundTask.
        await axios.post(
            `${AUTO_BROWSER_SERVICE_URL}/sessions/${session_id}/bulk-fill`,
            bulkFillPayload,
            { timeout: 15000, headers: AUTO_BROWSER_HEADERS }
        );

        if (ctx) appendLog(ctx, `🚀 Native bulk fill dispatched successfully on Railway.`);
        return res.json({ success: true, message: "Bulk fill job dispatched to browser engine." });
    } catch (bulkErr) {
        // Fallback to sequential REST action calls if bulk-fill is not available
        const isNotAvailable = bulkErr.response?.status === 404 || bulkErr.response?.status === 405 || bulkErr.code === 'ECONNREFUSED';
        if (isNotAvailable) {
            if (ctx) appendLog(ctx, `⚠️ Native bulk endpoint not available, falling back to sequential action calls...`);

            // Run the sequential fallback asynchronously
            (async () => {
                try {
                    const rowSelector = blueprint.row_selector;
                    const inputSelector = blueprint.input_selector;
                    const requiresClickToEdit = Boolean(blueprint.requires_click_to_edit);

                    let successCount = 0;
                    let failCount = 0;

                    for (let i = 0; i < boq_data.length; i++) {
                        const item = boq_data[i];
                        const priceValue = (item.rate || item.unit_price || 0).toString();
                        const label = item.item_code || (item.description ? item.description.substring(0, 15) : `Row ${i + 1}`);

                        if (ctx) appendLog(ctx, `✏️ [${i + 1}/${boq_data.length}] ${label} → ${priceValue}`);

                        try {
                            const nthRowSelector = `${rowSelector}:nth-child(${i + 1})`;
                            const targetInput = `${nthRowSelector} ${inputSelector}`;

                            if (requiresClickToEdit) {
                                await axios.post(
                                    `${AUTO_BROWSER_SERVICE_URL}/sessions/${session_id}/actions/click`,
                                    { selector: nthRowSelector },
                                    { timeout: 15000, headers: AUTO_BROWSER_HEADERS }
                                );
                                await new Promise(r => setTimeout(r, 200));
                            }

                            await axios.post(
                                `${AUTO_BROWSER_SERVICE_URL}/sessions/${session_id}/actions/type`,
                                { selector: targetInput, text: priceValue, clear_first: true },
                                { timeout: 15000, headers: AUTO_BROWSER_HEADERS }
                            );

                            successCount++;
                            if (ctx) appendLog(ctx, `✅ [${i + 1}/${boq_data.length}] Filled: ${priceValue}`);
                        } catch (err) {
                            failCount++;
                            const msg = err.response?.data?.detail || err.message;
                            if (ctx) appendLog(ctx, `⚠️ [${i + 1}/${boq_data.length}] Failed: ${msg}`);
                        }

                        if (i < boq_data.length - 1) await new Promise(r => setTimeout(r, 100));
                    }

                    if (ctx) {
                        appendLog(ctx, `✅ Sequential fill completed: ${successCount} succeeded, ${failCount} failed.`);
                        ctx.status = failCount === boq_data.length ? 'failed' : 'completed';
                        if (failCount > 0 && failCount < boq_data.length) {
                            ctx.error = `${failCount} items could not be filled.`;
                        }
                    }
                } catch (err) {
                    console.error("Sequential Fill dispatch fault:", err);
                }
            })();

            return res.json({ success: true, message: "Bulk fill job dispatched via sequential fallback." });
        } else {
            console.error("Bulk Fill Dispatch Fault:", bulkErr);
            if (ctx) {
                appendLog(ctx, `❌ Execution aborted: ${bulkErr.message}`);
                ctx.status = 'failed';
                ctx.error = bulkErr.message;
            }
            return res.status(500).json({ error: bulkErr.message });
        }
    }
});

export default router;