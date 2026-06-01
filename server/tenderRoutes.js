import express from 'express';
import axios from 'axios';

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
            // Force noVNC to resize the remote server to our iframe's exact dimensions instead of just scaling a static resolution
            vnc_url = vnc_url.replace('resize=scale', 'resize=remote');
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
        appendLog(sessionCtx, `\u{1F4C4} Page ${pageNum}/${numPages} \u2014 ${boq_data.length} items to fill on this page.`);
    }

    try {
        // Build a compact items summary to reduce prompt token count
        const itemsSummary = boq_data.map((item, i) => {
            const anchor = item.item_code ? `Item Code: "${item.item_code}"` : `Item: "${(item.description || '').substring(0, 30)}"`;
            return `${i + 1}. ${anchor} | Rate: ${item.rate}`;
        }).join('\n');

        let globalFieldsInstructions = '';
        if (global_fields && global_fields.length > 0) {
            const fieldsList = global_fields.map(f => `- "${f.name}": Enter "${f.value}"`).join('\n');
            globalFieldsInstructions = `\nAdditionally, for EACH matched row, you must ALSO fill these global fields with the exact specified values:\n${fieldsList}\n`;
        }

        const webhookBase = process.env.WEBHOOK_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3001');
        
        const functionalAgentPrompt = `You are an intelligent data-entry agent controlling a live browser session.
Your task is to fill a web form or table on the CURRENTLY VISIBLE page with the provided data.

Items to fill on this page (${boq_data.length} rows):
${itemsSummary}

Workflow:
1. Analyze the visible page to identify the data entry grid, table, or form.
2. For each item in the list above, find its matching row or section based on the description, code, or context.
3. Locate the appropriate input field for entering the "Rate in figures" (or unit price) for that match. Ensure you choose the actual empty input box, NOT the text label or the row container!
4. Use the \`type\` action directly to enter the numeric Rate value into the input field. YOU MUST SET \`"clear_first": false\` in your action JSON to prevent a bug that selects the entire page text. ${globalFieldsInstructions ? 'Then, find the input fields for the global fields listed below and type their exact values for this row, also using `"clear_first": false`.' : ''}
5. After filling all matched rows, look for a "Save", "Partially Save", or "Next" button and click it to persist progress.
6. Report completion via POST to ${webhookBase}/api/tender/webhook-update with body: {"session_id": "${session_id}", "is_complete": true, "message": "Page ${pageNum} filled successfully (${boq_data.length} items)"}
${globalFieldsInstructions}
CRITICAL RULES:
- Be highly adaptable: The website structure, column names, and language may vary. Look for contextual clues indicating where the price should be entered.
- NEVER target a non-input element with the \`type\` action. If you try to type into a generic cell or label, it will select all text on the page and fail. Make absolutely sure the \`element_id\` points to an input field.
- ALWAYS set \`"clear_first": false\` when typing, otherwise you will trigger a catastrophic page selection error!
- NEVER guess or hallucinate CSS selectors. You MUST use the \`element_id\` (data-operator-id) provided in your state representation for all target elements.
- Only fill rows visible on the current page. Do not navigate to other pages.
- If an item doesn't have an exact or close match, skip it.
- Type numbers carefully \u2014 no currency symbols, just the numeric value.

JSON OUTPUT FORMAT:
You must output ONLY valid, raw JSON. 
DO NOT wrap your response in markdown code blocks (e.g. \`\`\`json). 
DO NOT include any conversational text before or after the JSON.`;

        let cleanModel = provider_model;
        if (cleanModel && cleanModel.includes(':billed')) {
            cleanModel = cleanModel.replace(':billed', '');
        }

        // Map provider names to auto-browser's accepted values: 'openai', 'claude', 'gemini'
        const providerMap = { google: 'gemini', anthropic: 'claude', openai: 'openai' };
        const cleanProvider = providerMap[provider] || provider || 'gemini';

        // Direct fire-and-forget backplane proxy eliminates server connection boundary drops
        axios.post(`${AUTO_BROWSER_SERVICE_URL}/sessions/${session_id}/agent/jobs/run`, {
            goal: functionalAgentPrompt,
            provider: cleanProvider,
            provider_model: cleanModel,
            max_steps: 20
        }).catch(err => {
            const rejectionBody = err.response && err.response.data ? JSON.stringify(err.response.data).substring(0, 500) : 'No response body';
            console.error(`\u26A0\uFE0F [Tender Agent] Error from auto-browser \u2014 Status: ${err.response ? err.response.status : 'N/A'} | Body: ${rejectionBody}`);
            const ctx = sessionTracker.get(session_id);
            if (ctx) {
                ctx.status = 'failed';
                ctx.error = `Auto-browser rejected (${err.response ? err.response.status : 'network'}): ${rejectionBody}`;
                appendLog(ctx, `\u274C Agent deployment failed: ${err.message}`);
            }
        });

        // Simulate local worker progress steps only when real agent webhooks aren't connected
        if (process.env.USE_TELEMETRY_SIMULATOR === 'true') {
            simulateBackgroundTelemetryUpdates(session_id, boq_data, pageNum, numPages);
        }

        return res.json({ success: true, message: `Page ${pageNum}/${numPages} agent deployed (${boq_data.length} items).` });

    } catch (error) {
        console.error('\u274C [Tender Execution Configuration Exception Error]:', error.message);
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
            appendLog(ctx, `\u270F\uFE0F [Page ${pageNum}] Filling [${index + 1}/${boqData.length}]: "${item.description.substring(0, 30)}..." \u2192 Rate: ${item.rate}`);
            index++;
        } else if (index === boqData.length) {
            appendLog(ctx, `\uD83E\uDDEE [Page ${pageNum}] Clicking "Partially Save" to persist page progress...`);
            index++;
        } else {
            appendLog(ctx, `\u2705 Page ${pageNum}/${numPages} completed. ${boqData.length} items filled.`);
            ctx.status = 'completed';
            clearInterval(interval);
        }
    }, 4000);
}

export default router;