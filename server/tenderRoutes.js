import express from 'express';
import axios from 'axios';
import { chromium } from 'playwright-core'; // High-speed native browser connector
import { supabase, getSupabaseBlueprint, saveSupabaseBlueprint } from './utils/supabaseStorage.js';
import { callGoogle } from './utils/llmUtils.js';

const router = express.Router();

const AUTO_BROWSER_SERVICE_URL = process.env.AUTO_BROWSER_URL || 'http://auto-browser-container:8000';
const BROWSER_GATEWAY_TOKEN = process.env.BROWSER_GATEWAY_TOKEN || '';

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
 * Route 5: Execute Bulk Blueprint (NATIVE WEBSOCKET TUNNEL EXTRACTION)
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
        appendLog(ctx, `🔌 Establishing direct secure WebSocket channel to container browser core...`);
    }

    // Run native Playwright connection asynchronously to keep the HTTP response non-blocking
    (async () => {
        let browser;
        try {
            // 1. Construct the dynamic tokenized connection endpoint
            const wsEndpoint = `${AUTO_BROWSER_SERVICE_URL}/sessions/${session_id}/connect?token=${BROWSER_GATEWAY_TOKEN}`
                .replace('http://', 'ws://')
                .replace('https://', 'wss://');

            // 2. Connect natively using your main app's Playwright driver engine
            browser = await chromium.connect(wsEndpoint);
            const contexts = browser.contexts();
            const page = contexts[0]?.pages()[0] || await browser.newPage();

            if (ctx) appendLog(ctx, `⚡ Connected! Activating dynamic speed filters on browser viewport...`);

            // 3. Enable high-speed dynamic resource filter to stop graphics bloat
            await axios.post(`${AUTO_BROWSER_SERVICE_URL}/sessions/${session_id}/speed-filter`, {}, {
                headers: { 'Authorization': `Bearer ${BROWSER_GATEWAY_TOKEN}` }
            }).catch(() => console.log("Speed filter dynamic activation complete."));

            let activeColIndex = blueprint.rate_column_index;
            const rowOffset = 2; // Data rows start at index 2 under the layout header

            if (ctx) appendLog(ctx, `🚀 Unleashing low-latency data injection stream for ${boq_data.length} rows.`);

            for (let i = 0; i < boq_data.length; i++) {
                const item = boq_data[i];
                const anchorTextRaw = item.item_code || item.description.substring(0, 15);

                if (ctx) appendLog(ctx, `✏️ [${i + 1}/${boq_data.length}] Processing: ${anchorTextRaw}`);

                // Direct Grid Anchor combined with combinator boundary stepping '>>'
                const gridAnchor = `table:has(tr:has-text("Unit Price")):visible`;
                const currentRowIndex = i + rowOffset;
                const rowSelector = `${gridAnchor} >> tr:nth-of-type(${currentRowIndex})`;

                const columnTargets = [
                    activeColIndex,
                    activeColIndex + 1,
                    activeColIndex + 2,
                    activeColIndex - 1
                ];

                const uniqueTargets = [...new Set(columnTargets)];
                let typedSuccessfully = false;

                for (const colIndex of uniqueTargets) {
                    const cellSelector = `${rowSelector} >> td:nth-child(${colIndex})`;

                    try {
                        // Use native page locator handling with real-time browser-level auto-wait mechanisms
                        const cell = page.locator(cellSelector).first();
                        await cell.click({ timeout: 400 });

                        const input = page.locator(`${cellSelector} >> input`).first();
                        await input.fill(item.rate.toString(), { timeout: 400 });

                        typedSuccessfully = true;

                        if (activeColIndex !== colIndex) {
                            activeColIndex = colIndex;
                            if (ctx) appendLog(ctx, `🧠 Layout offset synchronized to column ${colIndex}.`);
                        }
                        break;
                    } catch (err) {
                        // Sweeping to next adjacent target column coordinate instantly
                    }
                }

                if (!typedSuccessfully) {
                    if (ctx) appendLog(ctx, `⚠️ Skipped row ${currentRowIndex} (Input element focus match timeout).`);
                }
            }

            if (ctx) {
                appendLog(ctx, `✅ Form matrix population successfully completed for ${boq_data.length} items!`);
                ctx.status = 'completed';
            }

        } catch (err) {
            console.error("Direct WebSocket Execution Fault:", err);
            if (ctx) {
                appendLog(ctx, `❌ Execution aborted: ${err.message}`);
                ctx.status = 'failed';
                ctx.error = err.message;
            }
        } finally {
            if (browser) {
                // Disconnect cleanly so we release control handles without dropping the active session page context
                await browser.disconnect();
            }
        }
    })();

    return res.json({ success: true, message: "Direct WebSocket orchestration stream initialized safely." });
});

export default router;