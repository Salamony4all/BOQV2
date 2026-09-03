// popup.js - Extension Popup Controller
// Script loads at end of <body> — DOM is already ready, no DOMContentLoaded needed.

(function initPopup() {
    // ── Element refs ─────────────────────────────────────────────────────────
    const connStatusEl = document.getElementById("conn_status");
    const targetUrlEl  = document.getElementById("target_url");
    const boqStatusEl  = document.getElementById("boq_status");
    const btnFill      = document.getElementById("btn_fill");
    const logsEl       = document.getElementById("logs");
    const tab1Btn      = document.getElementById("tab1_btn");
    const tab2Btn      = document.getElementById("tab2_btn");
    const btnLens      = document.getElementById("btn_lens_search");
    const lensInput    = document.getElementById("lens_img_url");
    const lensStatus   = document.getElementById("lens_status");
    const lensResults  = document.getElementById("lens_results");

    // ── Logging ──────────────────────────────────────────────────────────────
    const addLog = (text) => {
        if (!logsEl) return;
        logsEl.innerHTML += `\n> ${text}`;
        logsEl.scrollTop = logsEl.scrollHeight;
    };

    // ── Tab Switching ─────────────────────────────────────────────────────────
    function switchTab(tabId) {
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        const panel = document.getElementById(tabId);
        const btn   = document.getElementById(tabId + '_btn');
        if (panel) panel.classList.add('active');
        if (btn)   btn.classList.add('active');
    }

    if (tab1Btn) tab1Btn.addEventListener('click', () => switchTab('tab1'));
    if (tab2Btn) tab2Btn.addEventListener('click', () => switchTab('tab2'));

    // ── UI State ─────────────────────────────────────────────────────────────
    const updateUI = () => {
        chrome.storage.local.get(["automationTabId", "targetUrl", "boqData", "currentPage", "totalPages", "blueprint", "domainName"], async (data) => {
            let isConnected = false;

            if (data.automationTabId) {
                try {
                    await chrome.tabs.get(data.automationTabId);
                    isConnected = true;
                } catch (e) {
                    chrome.storage.local.set({ automationTabId: null, targetUrl: null });
                }
            }

            if (connStatusEl) {
                connStatusEl.innerText = isConnected ? "Connected" : "Disconnected";
                connStatusEl.className = isConnected ? "value active" : "value";
            }
            if (targetUrlEl) targetUrlEl.innerText = isConnected ? (data.domainName || "Oman Tender Board") : "-";
            if (btnFill) btnFill.disabled = true;

            if (data.boqData && data.boqData.length > 0) {
                if (boqStatusEl) boqStatusEl.innerText = `Page ${data.currentPage} of ${data.totalPages} (${data.boqData.length} items)`;
                if (isConnected && btnFill) btnFill.disabled = false;
            } else {
                if (boqStatusEl) boqStatusEl.innerText = "Awaiting synchronization...";
            }
        });
    };

    updateUI();

    // ── Extension message listener ────────────────────────────────────────────
    chrome.runtime.onMessage.addListener((message) => {
        if (message.event === "progress") {
            addLog(message.data.text);
        } else if (message.event === "tabClosed") {
            addLog("⚠️ Connection lost: Target portal tab was closed.");
            updateUI();
        }
    });

    // ── Auto Mapping ──────────────────────────────────────────────────────────
    const runAutoMapping = (onComplete) => {
        chrome.storage.local.get(["automationTabId", "domainName", "aiSettings", "apiBase"], async (data) => {
            if (!data.automationTabId) {
                addLog("🛑 Error: No connected portal tab found.");
                if (onComplete) onComplete(null);
                return;
            }

            try {
                addLog("🔌 Extracting DOM structure from portal tab...");
                const domScript = `
                    const elements = [];
                    const traverse = (node, depth = 0) => {
                        if (depth > 12) return;
                        const tag = node.tagName?.toLowerCase();
                        if (!tag) return;
                        const isInput = tag === 'input' || tag === 'select' || tag === 'textarea';
                        const isTableOrRow = tag === 'table' || tag === 'tr' || tag === 'th' || tag === 'td';
                        const isContainer = tag === 'form' || tag === 'div' || tag === 'section';
                        if (isInput || isTableOrRow || (isContainer && (node.id || node.className))) {
                            let info = "  ".repeat(depth) + "<" + tag;
                            if (node.id) info += ' id="' + node.id + '"';
                            if (node.className) info += ' class="' + node.className + '"';
                            if (node.name) info += ' name="' + node.name + '"';
                            if (node.type) info += ' type="' + node.type + '"';
                            if (node.placeholder) info += ' placeholder="' + node.placeholder + '"';
                            if (node.readOnly) info += ' readonly';
                            if (node.disabled) info += ' disabled';
                            info += ">";
                            if (tag === 'th' || tag === 'td' || tag === 'label') {
                                const text = node.innerText?.trim().substring(0, 50);
                                if (text) info += " " + text + " </" + tag + ">";
                            }
                            elements.push(info);
                        }
                        for (const child of node.children) { traverse(child, depth + 1); }
                    };
                    traverse(document.body);
                    return elements.join("\\n");
                `;

                chrome.runtime.sendMessage({ action: "executeScript", args: { code: domScript } }, async (response) => {
                    if (!response || !response.success) {
                        addLog(`🛑 DOM extraction failed: ${response?.error || 'Unknown error'}`);
                        if (onComplete) onComplete(null);
                        return;
                    }

                    const domOutline = response.result;
                    addLog("✅ DOM extracted. Sending to AI engine for parsing...");

                    try {
                        const ai = data.aiSettings || {};
                        const apiBaseUrl = data.apiBase || "http://localhost:3001";
                        const apiRes = await fetch(`${apiBaseUrl}/api/tender/map-platform`, {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "x-google-api-key": ai.googleApiKey || "",
                                "x-google-free-key": ai.googleFreeKey || "",
                                "x-google-active-tier": ai.activeTier || "free",
                                "x-google-model": ai.model || ""
                            },
                            body: JSON.stringify({
                                domain_name: data.domainName || "etendering.tenderboard.gov.om",
                                force_remap: true,
                                dom_outline: domOutline
                            })
                        });
                        const apiData = await apiRes.json();
                        if (apiData.success) {
                            chrome.storage.local.set({ blueprint: apiData.blueprint }, () => {
                                addLog("✅ Platform successfully mapped! Blueprint loaded.");
                                if (onComplete) onComplete(apiData.blueprint);
                            });
                        } else {
                            addLog(`🛑 AI Mapping Error: ${apiData.error || 'Server rejected request'}`);
                            if (onComplete) onComplete(null);
                        }
                    } catch (err) {
                        addLog(`🛑 Backend API Connection Error: ${err.message}`);
                        if (onComplete) onComplete(null);
                    }
                });
            } catch (err) {
                addLog(`🛑 Mapping process exception: ${err.message}`);
                if (onComplete) onComplete(null);
            }
        });
    };

    const ensureBlueprintAndRun = (callback) => {
        chrome.storage.local.get(["blueprint"], (data) => {
            if (data.blueprint) {
                callback(data.blueprint);
            } else {
                addLog("🔍 Blueprint not found. Automatically mapping platform first...");
                runAutoMapping((blueprint) => {
                    if (blueprint) {
                        callback(blueprint);
                    } else {
                        addLog("🛑 Automatic platform mapping failed. Cannot run bulk autofill.");
                        updateUI();
                    }
                });
            }
        });
    };

    // ── Bulk Fill Button ──────────────────────────────────────────────────────
    if (btnFill) {
        btnFill.addEventListener("click", () => {
            btnFill.disabled = true;

            ensureBlueprintAndRun((activeBlueprint) => {
                addLog("🚀 Injecting bulk auto-fill script into portal page...");

                chrome.storage.local.get(["boqData", "globalFields"], (data) => {
                    if (!data.boqData) {
                        addLog("🛑 Error: Missing BOQ data.");
                        updateUI();
                        return;
                    }

                    const fillScript = `
                        const rowSelector = ${JSON.stringify(activeBlueprint.row_selector)};
                        const inputSelector = ${JSON.stringify(activeBlueprint.input_selector)};
                        const requiresClickToEdit = ${Boolean(activeBlueprint.requires_click_to_edit)};
                        const boqData = ${JSON.stringify(data.boqData)};
                        const globalFields = ${JSON.stringify(data.globalFields || [])};

                        const report = (text) => { window.postMessage({ source: "auto-browser-target-page", data: { text } }, "*"); };

                        report("🚀 Starting popup-initiated bulk fill...");

                        const findGlobalInput = (labelOrSelector) => {
                            try {
                                const el = document.querySelector(labelOrSelector);
                                if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return el;
                            } catch (e) {}
                            const cleanLabel = labelOrSelector.toLowerCase().trim();
                            const labels = Array.from(document.querySelectorAll('label'));
                            for (const label of labels) {
                                if (label.textContent.toLowerCase().includes(cleanLabel)) {
                                    if (label.htmlFor) { const el = document.getElementById(label.htmlFor); if (el) return el; }
                                    const nested = label.querySelector('input, select, textarea');
                                    if (nested) return nested;
                                    let next = label.nextElementSibling;
                                    while (next) {
                                        if (next.tagName === 'INPUT' || next.tagName === 'SELECT' || next.tagName === 'TEXTAREA') return next;
                                        const input = next.querySelector('input, select, textarea');
                                        if (input) return input;
                                        next = next.nextElementSibling;
                                    }
                                }
                            }
                            const inputs = Array.from(document.querySelectorAll('input, select, textarea'));
                            for (const input of inputs) {
                                const name = (input.name || '').toLowerCase();
                                const id = (input.id || '').toLowerCase();
                                const placeholder = (input.placeholder || '').toLowerCase();
                                if (name.includes(cleanLabel) || id.includes(cleanLabel) || placeholder.includes(cleanLabel)) return input;
                            }
                            return null;
                        };

                        for (const field of globalFields) {
                            try {
                                const el = findGlobalInput(field.name);
                                if (el) {
                                    el.focus(); el.value = field.value;
                                    el.dispatchEvent(new Event('input', { bubbles: true }));
                                    el.dispatchEvent(new Event('change', { bubbles: true }));
                                    report("✏️ Filled global field: " + field.name + " -> " + field.value);
                                } else { report("⚠️ Global field input target not found: " + field.name); }
                            } catch (e) { console.warn(e); }
                        }

                        const rows = document.querySelectorAll(rowSelector);
                        let successCount = 0, failCount = 0;

                        for (let i = 0; i < Math.min(rows.length, boqData.length); i++) {
                            const row = rows[i];
                            const item = boqData[i];
                            const priceValue = (item.rate || item.unit_price || 0).toString();
                            const label = item.item_code || (item.description ? item.description.substring(0, 15) : "Row " + (i + 1));
                            try {
                                if (requiresClickToEdit) { row.scrollIntoView({ block: 'center' }); row.click(); await new Promise(r => setTimeout(r, 200)); }
                                const input = row.querySelector(inputSelector);
                                if (input) {
                                    input.scrollIntoView({ block: 'center' }); input.focus();
                                    input.value = priceValue;
                                    input.dispatchEvent(new Event('input', { bubbles: true }));
                                    input.dispatchEvent(new Event('change', { bubbles: true }));
                                    input.blur();
                                    successCount++;
                                    report("✅ [" + (i+1) + "/" + boqData.length + "] Filled: " + label + " -> " + priceValue);
                                } else {
                                    failCount++;
                                    report("⚠️ [" + (i+1) + "/" + boqData.length + "] Target input missing: " + label);
                                }
                            } catch (err) { failCount++; report("⚠️ [" + (i+1) + "/" + boqData.length + "] Error: " + err.message); }
                            await new Promise(r => setTimeout(r, 150));
                        }
                        return { successCount, failCount };
                    `;

                    chrome.runtime.sendMessage({ action: "executeScript", args: { code: fillScript } }, (response) => {
                        if (response && response.success) {
                            const res = response.result;
                            addLog(`🎉 Done! Filled: ${res.successCount}, Failed/Readonly: ${res.failCount}`);
                        } else {
                            addLog(`🛑 Execution Error: ${response?.error || 'Script execution crashed'}`);
                        }
                        updateUI();
                    });
                });
            });
        });
    }

    // ── Lens Visual Matcher ───────────────────────────────────────────────────
    if (btnLens) {
        btnLens.addEventListener('click', async () => {
            const imageUrl = (lensInput.value || '').trim();
            if (!imageUrl) {
                lensStatus.textContent = '⚠️ Please paste an image URL first.';
                return;
            }

            btnLens.disabled = true;
            btnLens.textContent = '⏳ Searching via Google Lens...';
            lensStatus.textContent = '🔄 Opening Lens tab silently in background...';
            lensResults.innerHTML = '';

            try {
                const response = await new Promise((resolve) => {
                    chrome.runtime.sendMessage({ action: 'lensVisualMatch', args: { imageUrl, itemId: 'popup-manual' } }, resolve);
                });

                if (response && response.success && response.result && response.result.visualMatches) {
                    const matches = response.result.visualMatches;
                    lensStatus.textContent = `✅ Found ${matches.length} visual match${matches.length !== 1 ? 'es' : ''} via Google Lens`;
                    if (matches.length === 0) {
                        lensResults.innerHTML = '<div style="color:#94a3b8;font-size:0.78rem;padding:8px;">No visual matches found. Try opening Lens manually.</div>';
                    } else {
                        lensResults.innerHTML = matches.map((m, i) => `
                            <div class="lens-result-card">
                                <div class="lens-result-title">${i === 0 ? '🏆 ' : ''}${m.title || 'Product Match'}</div>
                                <div class="lens-result-source">📌 ${m.source || 'Unknown source'}</div>
                                <a class="lens-result-link" href="${m.url}" target="_blank" rel="noopener">🔗 View Product →</a>
                            </div>
                        `).join('');
                    }
                } else {
                    lensStatus.textContent = `❌ Lens search failed: ${response?.error || 'Unknown error'}`;
                    const fallbackUrl = `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(imageUrl)}`;
                    lensResults.innerHTML = `<a class="lens-result-link" href="${fallbackUrl}" target="_blank" rel="noopener">🌐 Open in Google Lens manually →</a>`;
                }
            } catch (e) {
                lensStatus.textContent = `❌ Error: ${e.message}`;
            } finally {
                btnLens.disabled = false;
                btnLens.textContent = '🔍 Run Lens Visual Match';
            }
        });
    }

})(); // end initPopup
