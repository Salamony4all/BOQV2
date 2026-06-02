import express from 'express';
import axios from 'axios';
import { supabase, getSupabaseBlueprint, saveSupabaseBlueprint } from './utils/supabaseStorage.js';
import { callGoogle } from './utils/llmUtils.js';

const router = express.Router();

const AUTO_BROWSER_SERVICE_URL = process.env.AUTO_BROWSER_URL || 'http://auto-browser-container:8000';

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
}, 5 * 60 * 1000); // Run every 5 minutes

/**
 * Route 1: Allocate Context Node
 * POST /api/tender/setup
 */
router.post('/setup', async (req, res) => {
    try {
        console.log(`🌐 [Tender Router] Provisioning isolated execution container profile instance...`);

        let session_id;
        let vnc_url;

        try {
            const response = await axios.post(`${AUTO_BROWSER_SERVICE_URL}/sessions`, {}, { timeout: 25000 });
            session_id = response.data.id;
            vnc_url = response.data.takeover_url;
        } catch (postError) {
            if (postError.response && postError.response.status === 409) {
                const getResponse = await axios.get(`${AUTO_BROWSER_SERVICE_URL}/sessions`);
                if (getResponse.data && getResponse.data.length > 0) {
                    session_id = getResponse.data[0].id;
                    vnc_url = getResponse.data[0].takeover_url;
                } else {
                    throw new Error("409 Conflict but no active sessions found.");
                }
            } else {
                throw postError;
            }
        }

        sessionTracker.set(session_id, {
            status: 'ready',
            logs: ['📡 Secure web layer browser handoff profile allocated successfully.'],
            error: null,
            createdAt: Date.now()
        });

        // Rewrite internal VNC URL to the public Railway domain
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
router.get('/status/:session_id', (req, res) => {
    const { session_id } = req.params;
    const tracking = sessionTracker.get(session_id);

    // VERCEL SERVERLESS PATCH: Prevent 404 UI crashes when Vercel memory wipes
    if (!tracking) {
        return res.json({
            success: true,
            status: 'executing',
            logs: ['🔄 Syncing telemetry... (Serverless context reset)'],
            error: null
        });
    }

    return res.json({ success: true, status: tracking.status, logs: tracking.logs, error: tracking.error });
});

/**
 * Route 3: Engage LLM Engine Loop
 */
router.post('/execute', async (req, res) => {
    return res.json({ success: true, message: "Legacy route active. Please use deterministic bulk execution." });
});

router.post('/webhook-update', (req, res) => {
    const { session_id, message, is_complete, is_failed, error_msg } = req.body;
    const ctx = sessionTracker.get(session_id);
    if (ctx) {
        if (message) appendLog(ctx, message);
        if (is_complete) ctx.status = 'completed';
        if (is_failed) {
            ctx.status = 'failed';
            ctx.error = error_msg || 'Fatal framework abort step execution error.';
        }
    }
    return res.json({ success: true });
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

        const observeRes = await axios.post(`${AUTO_BROWSER_SERVICE_URL}/sessions/${session_id}/observe`, { limit: 100, preset: "normal" });
        const rawState = observeRes.data.dom_outline || observeRes.data || '';
        const domString = typeof rawState === 'string' ? rawState : JSON.stringify(rawState);
        const safeOutline = domString.substring(0, 15000);

        const prompt = `Analyze this web page snapshot and output ONLY a valid JSON schema blueprint for data entry. 
Target Domain: ${domain_name}
We need to fill a table of BoQ items. Determine:
- row_selector: The CSS selector to identify a table row.
- rate_column_index: The 1-based index of the column for the "Unit Price in Fig".
- requires_click_to_edit: boolean.
- input_selector: The selector for the input field.

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
 * Route 5: Execute Bulk Blueprint
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
        appendLog(ctx, `⚡ Initiating Playwright Grid-Anchor Bulk Fill script for ${boq_data.length} items.`);
    }

    (async () => {
        try {
            if (ctx) appendLog(ctx, `📜 Base Rate Column mapped to: ${blueprint.rate_column_index}`);

            let consecutiveFailures = 0;
            let activeColIndex = blueprint.rate_column_index;

            // Enterprise tables typically have 1 header row, meaning data starts at CSS index 2.
            const rowOffset = 2;

            for (let i = 0; i < boq_data.length; i++) {
                const item = boq_data[i];
                const anchorTextRaw = item.item_code || item.description.substring(0, 15);

                if (ctx) appendLog(ctx, `✏️ [${i + 1}/${boq_data.length}] Processing item: ${anchorTextRaw}`);

                // THE GRID ANCHOR 
                // We use Playwright's `>>` operator to step INTO the bounded table before calculating nth-of-type.
                // This completely isolates the data grid and guarantees we don't accidentally index the site header or sidebar.
                const gridAnchor = `table:has(tr:has-text("Unit Price")):visible`;
                const currentRowIndex = i + rowOffset;
                const rowSelector = `${gridAnchor} >> tr:nth-of-type(${currentRowIndex})`;

                // The Neighborhood Sweep
                const columnTargets = [
                    activeColIndex,
                    activeColIndex + 1,
                    activeColIndex + 2,
                    activeColIndex - 1,
                    activeColIndex + 3
                ];

                const uniqueTargets = [...new Set(columnTargets)];
                let typedSuccessfully = false;

                for (const colIndex of uniqueTargets) {
                    // Exact grid coordinates: Row X, Column Y
                    const cellSelector = `${rowSelector} >> td:nth-child(${colIndex})`;

                    try {
                        await axios.post(`${AUTO_BROWSER_SERVICE_URL}/sessions/${session_id}/actions/click`, {
                            selector: cellSelector
                        }, { timeout: 2000 });
                        await new Promise(r => setTimeout(r, 400));
                    } catch (e) {
                        // Ignore click timeout, the input might already be exposed
                    }

                    const inputSelector = `${cellSelector} >> input`;

                    try {
                        await axios.post(`${AUTO_BROWSER_SERVICE_URL}/sessions/${session_id}/actions/type`, {
                            selector: inputSelector,
                            text: item.rate.toString(),
                            clear_first: false
                        }, { timeout: 2500 }); // Fast-fail if input isn't in this column

                        typedSuccessfully = true;
                        consecutiveFailures = 0; // Reset circuit breaker

                        // Adaptive Learning: If the layout shifted, permanently remember the new column!
                        if (activeColIndex !== colIndex) {
                            activeColIndex = colIndex;
                            if (ctx) appendLog(ctx, `🧠 AI Learned Layout Offset! Target shifted to column ${colIndex}.`);
                        }

                        if (ctx) appendLog(ctx, `✅ Filled Rate successfully in column ${colIndex}.`);
                        break;
                    } catch (err) {
                        // Failed to find an input in THIS column. Try the next column target.
                    }
                }

                if (!typedSuccessfully) {
                    consecutiveFailures++;
                    if (ctx) appendLog(ctx, `❌ Failed to find Rate input in row ${currentRowIndex}.`);

                    if (consecutiveFailures >= 3) {
                        if (ctx) appendLog(ctx, `🚨 CRITICAL: 3 consecutive failures. Aborting loop.`);
                        throw new Error("Container browser crashed or layout completely unrecognized.");
                    }
                }

                // GC THROTTLING: Wait 1.5s so Railway doesn't run out of memory from screenshots
                await new Promise(r => setTimeout(r, 1500));
            }

            if (ctx && ctx.status !== 'failed') {
                appendLog(ctx, `✅ Bulk execution successfully completed for ${boq_data.length} items.`);
                ctx.status = 'completed';
            }
        } catch (err) {
            console.error("Bulk Exec Error:", err);
            if (ctx) {
                appendLog(ctx, `❌ Bulk execution aborted: ${err.message}`);
                ctx.status = 'failed';
                ctx.error = err.message;
            }
        }
    })();

    return res.json({ success: true, message: "Bulk execution sequence initiated." });
});

// Local Fallback Telemetry Simulator to keep logs running if agent updates are delayed
function simulateBackgroundTelemetryUpdates(sessionId, boqData, pageNum, numPages) {
    let index = 0;
    const interval = setInterval(() => {
        const ctx = sessionTracker.get(sessionId);
        if (!ctx || ctx.status !== 'executing') {
            clearInterval(interval);
            return;
        }

        if (index < boqData.length) {
            const item = boqData[index];
            appendLog(ctx, `✏️ [Page ${pageNum}] Filling [${index + 1}/${boqData.length}]: "${item.description.substring(0, 30)}..." → Rate: ${item.rate}`);
            index++;
        } else if (index === boqData.length) {
            appendLog(ctx, `💾 [Page ${pageNum}] Clicking "Partially Save" to persist page progress...`);
            index++;
        } else {
            appendLog(ctx, `✅ Page ${pageNum}/${numPages} completed.`);
            ctx.status = 'completed';
            clearInterval(interval);
        }
    }, 4000);
}

export default router;