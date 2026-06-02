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
            // Use resize=scale to preserve the original Playwright coordinate system.
            // Using resize=remote changes the underlying X11 resolution on connection,
            // which breaks Playwright's coordinate math for 'click' and 'type' actions!
            vnc_url = vnc_url.replace('resize=remote', 'resize=scale');
        }

        return res.json({
            success: true,
            session_id: session_id,
            vnc_url: vnc_url
        });
    } catch (error) {
        console.error('❌ [Tender Setup Route Core Exception]:', error.message);
        if (error.response) console.error('Response data:', error.response.data);
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
        return res.status(404).json({ success: false, error: 'Target tracking profile signature not found.' });
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
    const { session_id, boq_data, page_number, total_pages, provider, provider_model, global_fields } = req.body;

    if (!session_id || !boq_data || !Array.isArray(boq_data)) {
        return res.status(400).json({ error: 'Missing active session signature mapping profile elements.' });
    }

    const pageNum = page_number || 1;
    const numPages = total_pages || 1;

    const sessionCtx = sessionTracker.get(session_id);
    if (sessionCtx) {
        sessionCtx.status = 'executing';
        appendLog(sessionCtx, `📄 Page ${pageNum}/${numPages} — ${boq_data.length} items to fill on this page.`);
    }

    try {
        // Build a compact items summary to reduce prompt token count
        // TEST MODE: Only take the FIRST item to verify if the agent can edit the fields.
        const testBoqData = boq_data.slice(0, 1);
        const itemsSummary = testBoqData.map((item, i) => {
            const anchor = item.item_code ? `Item Code: "${item.item_code}"` : `Item: "${(item.description || '').substring(0, 30)}"`;
            return `${i + 1}. ${anchor} | Rate: ${item.rate}`;
        }).join('\n');

        let globalFieldsInstructions = '';
        if (global_fields && global_fields.length > 0) {
            const fieldsList = global_fields.map(f => `- "${f.name}": Enter "${f.value}"`).join('\n');
            globalFieldsInstructions = `\nAdditionally, for EACH matched row, you must ALSO fill these global fields with the exact specified values:\n${fieldsList}\n`;
        }

        const webhookBase = process.env.WEBHOOK_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3001');
        const functionalAgentPrompt = `You are a precision data-entry agent.
Your task is to enter prices for the following items into the visible table:

${itemsSummary}

⚠️ CRITICAL SYSTEM LIMITATION - READ CAREFULLY ⚠️
The web table is currently in "LOCKED / READ-ONLY" mode. 
There are NO active text input fields on the screen right now. The cells are just plain text.
If you attempt to use the "type" action on a locked cell, the automation will crash and you will fail.

MANDATORY 2-STEP EXECUTION PROTOCOL:
STEP 1: You MUST output a "click" action targeting the item's rate cell. Because the locked cell is just plain text, it does NOT have an \`element_id\`. You MUST use the \`selector\` field with a Playwright locator: \`tr:has-text('ITEM_CODE_HERE') td:nth-child(8)\`. This clicks the 8th column ("Unit Price in Fig") of the matching row.
STEP 2: The system will send you the updated page showing the active input field. ONLY THEN can you output a "type" action to enter the number (using "clear_first": false and the newly generated \`element_id\` of the input box).

JSON OUTPUT FORMAT:
Output ONLY valid, raw JSON. Do not wrap your response in markdown code blocks.

EXAMPLE OF YOUR REQUIRED FIRST STEP (UNLOCKING):
{
  "action": "click",
  "reason": "Clicking the locked rate cell for Item 1.1 to reveal the text input box.",
  "selector": "tr:has-text('Bill No 1.1') td:nth-child(8)",
  "confidence": 1.0
}`;

        let cleanModel = provider_model;
        if (cleanModel && cleanModel.includes(':billed')) {
            cleanModel = cleanModel.replace(':billed', '');
        }

        // Map provider names to auto-browser's accepted values: 'openai', 'claude', 'gemini'
        const providerMap = { google: 'gemini', anthropic: 'claude', openai: 'openai' };
        const cleanProvider = providerMap[provider] || provider || 'gemini';

        if (sessionCtx) appendLog(sessionCtx, `⚠️ Legacy dynamic LLM execution bypassed in favor of deterministic blueprints.`);

        // Simulate local worker progress steps only when real agent webhooks aren't connected
        if (process.env.USE_TELEMETRY_SIMULATOR === 'true') {
            simulateBackgroundTelemetryUpdates(session_id, testBoqData, pageNum, numPages);
        }

        return res.json({ success: true, message: `Page ${pageNum}/${numPages} agent deployed (${testBoqData.length} items - TEST MODE).` });

    } catch (error) {
        console.error('❌ [Tender Execution Configuration Exception Error]:', error.message);
        return res.status(500).json({ error: 'Internal worker exception mapping agent processes.' });
    }
});

// Telemetry Webhook Endpoint for direct Agent callback feedback logging
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
            // Try to load cached blueprint from Supabase first
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
- row_selector: The CSS selector to identify a table row containing an item (use "tr:has-text('ITEM_CODE')" format if applicable).
- rate_column_index: The 1-based index of the column for the "Unit Price in Fig", "Unit Price", "Rate", or "Price". (Make sure to count the columns accurately! For example, if "Unit Price in Fig" is the 8th column, this should be 8).
- requires_click_to_edit: boolean (true if the rate cell is just plain text and needs a click to become an active input field).
- input_selector: The selector for the actual input field (e.g. "input[type='text']" or "input") once active.

DOM Outline:
${safeOutline}

CRITICAL INSTRUCTIONS FOR OUTPUT:
- DO NOT include any conversational text, reasoning, or explanations.
- DO NOT use markdown code blocks (e.g., \`\`\`json). 
- DO NOT output your internal thinking process.
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
            throw new Error("AI failed to extract a valid blueprint. The page might be empty, black, or still loading in the container.");
        }

        if (ctx) appendLog(ctx, `✅ Blueprint generated: ${JSON.stringify(llmResult)}`);

        // Save new blueprint to Supabase for future use
        const saved = await saveSupabaseBlueprint(domain_name, llmResult);
        if (saved && ctx) appendLog(ctx, `💾 Blueprint securely persisted to Supabase for ${domain_name}.`);

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
            return res.status(400).json({ error: "No mapping available for this platform. Please click 'Map platform' first." });
        }
    }

    const ctx = sessionTracker.get(session_id);
    if (ctx) {
        ctx.status = 'executing';
        appendLog(ctx, `⚡ Initiating deterministic Bulk Fill script for ${boq_data.length} items using provided Blueprint.`);
    }

    // Fire and forget deterministic execution loop
    (async () => {
        try {
            if (ctx) appendLog(ctx, `📜 Blueprint Loaded! Click-to-edit: ${blueprint.requires_click_to_edit}`);

            for (let i = 0; i < boq_data.length; i++) {
                const item = boq_data[i];
                const anchorTextRaw = item.item_code || item.description.substring(0, 15);
                const anchorText = anchorTextRaw.replace(/'/g, "\\'"); // Escape single quotes for Playwright selector safely
                if (ctx) appendLog(ctx, `✏️ [${i + 1}/${boq_data.length}] Processing item: ${anchorTextRaw}`);

                let targetCellSelector = blueprint.row_selector;

                // Auto Browser uses Playwright natively, so Playwright selectors like :has-text() are FULLY supported.
                // We just need to inject the specific ITEM_CODE for this row.
                if (targetCellSelector.includes('ITEM_CODE')) {
                    targetCellSelector = targetCellSelector.replace('ITEM_CODE', anchorText);
                } else if (!targetCellSelector || targetCellSelector === 'tr') {
                    targetCellSelector = `tr:nth-of-type(${i + 2})`;
                }

                targetCellSelector = `${targetCellSelector} td:nth-child(${blueprint.rate_column_index})`;

                // ALWAYS click the cell first, regardless of what the LLM guessed. 
                // Many grids require a click to activate the input, and if skipped, the input remains 
                // hidden (`display: none`), causing Playwright to timeout with "element is not visible".
                try {
                    await axios.post(`${AUTO_BROWSER_SERVICE_URL}/sessions/${session_id}/actions/click`, {
                        selector: targetCellSelector
                    });
                    await new Promise(r => setTimeout(r, 400));
                } catch (e) {
                    console.warn(`Click failed for ${targetCellSelector}, continuing to type...`);
                }

                let inputSelector = blueprint.input_selector;
                if (!inputSelector.includes(':visible')) {
                    // Split by comma in case of multiple selectors and append :visible to each
                    inputSelector = inputSelector.split(',').map(s => s.trim() + ':visible').join(', ');
                }
                const complexSelector = `${targetCellSelector} ${inputSelector}`;

                // --- THE GLOBAL XPATH FALLBACK FIX ---
                try {
                    await axios.post(`${AUTO_BROWSER_SERVICE_URL}/sessions/${session_id}/actions/type`, {
                        selector: complexSelector,
                        text: item.rate.toString(),
                        clear_first: false
                    });
                } catch (err) {
                    if (ctx) appendLog(ctx, `⚠️ Primary selector failed. Engaging standard CSS row-scoped fallback...`);
                    
                    // Fallback 1: Assume 1 header row, scope input to the (i+2)th row
                    const fallbackSelector1 = `tr:nth-of-type(${i + 2}) input[type='text']:visible, tr:nth-of-type(${i + 2}) input:not([type='hidden']):visible`;
                    
                    try {
                        await axios.post(`${AUTO_BROWSER_SERVICE_URL}/sessions/${session_id}/actions/type`, {
                            selector: fallbackSelector1,
                            text: item.rate.toString(),
                            clear_first: false
                        });
                    } catch (err2) {
                        // Fallback 2: Assume tbody resets the row count, scope to (i+1)th row in tbody
                        const fallbackSelector2 = `tbody tr:nth-of-type(${i + 1}) input[type='text']:visible, tbody tr:nth-of-type(${i + 1}) input:not([type='hidden']):visible`;
                        
                        try {
                            await axios.post(`${AUTO_BROWSER_SERVICE_URL}/sessions/${session_id}/actions/type`, {
                                selector: fallbackSelector2,
                                text: item.rate.toString(),
                                clear_first: false
                            });
                        } catch (err3) {
                            if (ctx) appendLog(ctx, `❌ Failed to type for item: ${anchorTextRaw}. Skipping to next.`);
                            console.warn(`All fallbacks failed for item ${anchorTextRaw}`);
                            continue; // Skip to the next item instead of crashing the entire loop
                        }
                    }
                }

                await new Promise(r => setTimeout(r, 400));
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
            appendLog(ctx, `✅ Page ${pageNum}/${numPages} completed. ${boqData.length} items filled.`);
            ctx.status = 'completed';
            clearInterval(interval);
        }
    }, 4000);
}

export default router;