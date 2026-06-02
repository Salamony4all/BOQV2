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
            console.log(`🧹 [Tender Cleanup] Purged stale session ${id} (age: ${Math.round(age / 1000)}s, status: ${ctx.status})`);
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
                // Node only allows 1 max session. Grab the active one!
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

        // Initialize state defaults inside telemetry map tracking layer
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

        return res.json({
            success: true,
            session_id: session_id,
            vnc_url: vnc_url
        });
    } catch (error) {
        console.error('❌ [Tender Setup Route Core Exception]:', error.message);
        return res.status(502).json({
            success: false,
            error: 'Failed to map browser runtime worker node context. Verify container health states.'
        });
    }
});

/**
 * Route 2: Get Telemetry State Updates
 * GET /api/tender/status/:session_id
 */
router.get('/status/:session_id', (req, res) => {
    const { session_id } = req.params;
    const tracking = sessionTracker.get(session_id);

    if (!tracking) {
        return res.json({
            success: true,
            status: 'executing',
            logs: ['🔄 Syncing telemetry... (Serverless context reset)'],
            error: null
        });
    }

    return res.json({
        success: true,
        status: tracking.status,
        logs: tracking.logs,
        error: tracking.error
    });
});

/**
 * Route 3: Engage LLM Engine Loop
 * POST /api/tender/execute
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
            ctx.error = error_msg || 'Fatal framework abort step execution exception error.';
        }
    }
    return res.json({ success: true });
});

/**
 * Route 4: Map Platform Blueprint
 * POST /api/tender/map-platform
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
We need to fill a table of BoQ items. 
Determine the following fields:
- row_selector: The CSS selector to identify a table row containing an item.
- rate_column_index: The 1-based index of the column for the "Unit Price in Fig", "Unit Price", "Rate", or "Price".
- requires_click_to_edit: boolean.
- input_selector: The selector for the actual input field (e.g. "input[type='text']" or "input") once active.

DOM Outline:
${safeOutline}

CRITICAL INSTRUCTIONS FOR OUTPUT:
- DO NOT include any conversational text, reasoning, or explanations.
- DO NOT use markdown code blocks (e.g., \`\`\`json). 
- You must output ONLY a single, valid, raw JSON object.
`;
        if (ctx) appendLog(ctx, `🤖 Analyzing layout using gemma-4-31b-it proxy...`);
        const llmResult = await callGoogle(
            "You are a strict data-extraction AI. Output ONLY pure valid JSON with no markdown formatting.",
            prompt,
            false,
            "gemma-4-31b-it"
        );

        if (!llmResult || !llmResult.row_selector || !llmResult.input_selector) {
            throw new Error("AI failed to extract a valid blueprint.");
        }

        if (ctx) appendLog(ctx, `✅ Blueprint generated: ${JSON.stringify(llmResult)}`);

        await saveSupabaseBlueprint(domain_name, llmResult);
        if (ctx) appendLog(ctx, `💾 Blueprint securely persisted to Supabase for ${domain_name}.`);

        return res.json({ success: true, blueprint: llmResult });
    } catch (err) {
        console.error("Map Platform Error:", err);
        if (ctx) appendLog(ctx, `❌ Blueprint mapping failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to map platform' });
    }
});

/**
 * Route 5: Execute Bulk Blueprint
 * POST /api/tender/execute-bulk-blueprint
 */
router.post('/execute-bulk-blueprint', async (req, res) => {
    let { session_id, domain_name, boq_data, blueprint } = req.body;
    if (!session_id || !domain_name || !boq_data) return res.status(400).json({ error: 'Missing required parameters' });

    if (!blueprint) {
        blueprint = await getSupabaseBlueprint(domain_name);
        if (!blueprint) {
            return res.status(400).json({ error: "No mapping available for this platform." });
        }
    }

    const ctx = sessionTracker.get(session_id);
    if (ctx) {
        ctx.status = 'executing';
        appendLog(ctx, `⚡ Initiating Target-Sweep Bulk Fill script for ${boq_data.length} items.`);
    }

    (async () => {
        try {
            if (ctx) appendLog(ctx, `📜 Base Rate Column mapped to: ${blueprint.rate_column_index}`);

            for (let i = 0; i < boq_data.length; i++) {
                const item = boq_data[i];
                const anchorTextRaw = item.item_code || item.description.substring(0, 15);
                const anchorText = anchorTextRaw.replace(/'/g, "\\'");

                if (ctx) appendLog(ctx, `✏️ [${i + 1}/${boq_data.length}] Processing item: ${anchorTextRaw}`);

                // THE NEIGHBORHOOD SWEEP ARRAY
                // If there are hidden HTML columns, the visual index shifts. We check the AI's guess, then +1, +2, and -1.
                const columnTargets = [
                    blueprint.rate_column_index,
                    blueprint.rate_column_index + 1,
                    blueprint.rate_column_index + 2,
                    blueprint.rate_column_index - 1
                ];

                let typedSuccessfully = false;

                for (const colIndex of columnTargets) {
                    // :visible ignores hidden ghost tables used for mobile/print layouts
                    const cellSelector = `tr:has-text("${anchorText}"):visible td:nth-child(${colIndex})`;

                    // 1. THE AWAKENING CLICK
                    try {
                        await axios.post(`${AUTO_BROWSER_SERVICE_URL}/sessions/${session_id}/actions/click`, {
                            selector: cellSelector
                        }, { timeout: 2000 });
                        await new Promise(r => setTimeout(r, 400));
                    } catch (e) {
                        // Ignore click timeout, the input might already be exposed
                    }

                    // 2. THE TARGETED TYPE
                    const inputSelector = `${cellSelector} input:visible`;

                    try {
                        await axios.post(`${AUTO_BROWSER_SERVICE_URL}/sessions/${session_id}/actions/type`, {
                            selector: inputSelector,
                            text: item.rate.toString(),
                            clear_first: false
                        }, { timeout: 2500 });

                        typedSuccessfully = true;
                        if (ctx) appendLog(ctx, `✅ Filled Rate in Column ${colIndex}`);
                        break; // Success! Break out of the column sweep loop so we don't overwrite anything else.
                    } catch (err) {
                        // Failed to find an input in THIS specific column. Let the loop try the next column target.
                    }
                }

                if (!typedSuccessfully) {
                    if (ctx) appendLog(ctx, `❌ Failed to find Rate input for ${anchorTextRaw} in any expected column. Skipping to prevent data corruption.`);
                }

                await new Promise(r => setTimeout(r, 200));
            }

            if (ctx) {
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