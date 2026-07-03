// popup.js - Extension Popup Controller
document.addEventListener("DOMContentLoaded", () => {
    const connStatusEl = document.getElementById("conn_status");
    const targetUrlEl = document.getElementById("target_url");
    const boqStatusEl = document.getElementById("boq_status");
    const btnFill = document.getElementById("btn_fill");
    const logsEl = document.getElementById("logs");

    const addLog = (text) => {
        logsEl.innerHTML += `\n> ${text}`;
        logsEl.scrollTop = logsEl.scrollHeight;
    };

    // Load state from local storage and update UI
    const updateUI = () => {
        chrome.storage.local.get(["automationTabId", "targetUrl", "boqData", "currentPage", "totalPages", "blueprint", "domainName"], async (data) => {
            let isConnected = false;
            
            if (data.automationTabId) {
                try {
                    // Check if tab still exists
                    await chrome.tabs.get(data.automationTabId);
                    isConnected = true;
                } catch (e) {
                    // Tab was closed
                    chrome.storage.local.set({ automationTabId: null, targetUrl: null });
                }
            }

            if (isConnected) {
                connStatusEl.innerText = "Connected";
                connStatusEl.className = "value active";
                targetUrlEl.innerText = data.domainName || "Oman Tender Board";
            } else {
                connStatusEl.innerText = "Disconnected";
                connStatusEl.className = "value";
                targetUrlEl.innerText = "-";
                btnFill.disabled = true;
            }

            if (data.boqData && data.boqData.length > 0) {
                boqStatusEl.innerText = `Page ${data.currentPage} of ${data.totalPages} (${data.boqData.length} items)`;
                if (isConnected) {
                    btnFill.disabled = false;
                }
            } else {
                boqStatusEl.innerText = "Awaiting synchronization...";
                btnFill.disabled = true;
            }
        });
    };

    updateUI();

    // Listen for progress updates sent from background script
    chrome.runtime.onMessage.addListener((message) => {
        if (message.event === "progress") {
            addLog(message.data.text);
        } else if (message.event === "tabClosed") {
            addLog("⚠️ Connection lost: Target portal tab was closed.");
            updateUI();
        }
    });

    // Standalone Auto-Mapping Executor
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
                        for (const child of node.children) {
                            traverse(child, depth + 1);
                        }
                    };
                    traverse(document.body);
                    return elements.join("\\n");
                `;

                // Execute script via background service worker
                chrome.runtime.sendMessage({ 
                    action: "executeScript", 
                    args: { code: domScript } 
                }, async (response) => {
                    if (!response || !response.success) {
                        addLog(`🛑 DOM extraction failed: ${response?.error || 'Unknown error'}`);
                        if (onComplete) onComplete(null);
                        return;
                    }

                    const domOutline = response.result;
                    addLog("✅ DOM extracted. Sending to AI engine for parsing...");

                    // Fetch mapping from dynamic backend API
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

    // Helper to ensure blueprint is mapped before running actions
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

    // Handle Bulk Fill button click
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

                const report = (text) => {
                    window.postMessage({ source: "auto-browser-target-page", data: { text } }, "*");
                };

                report("🚀 Starting popup-initiated bulk fill...");
                
                // Fill global fields using smart finder helper
                const findGlobalInput = (labelOrSelector) => {
                    try {
                        const el = document.querySelector(labelOrSelector);
                        if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) {
                            return el;
                        }
                    } catch (e) {}

                    const cleanLabel = labelOrSelector.toLowerCase().trim();
                    const labels = Array.from(document.querySelectorAll('label'));
                    for (const label of labels) {
                        if (label.textContent.toLowerCase().includes(cleanLabel)) {
                            if (label.htmlFor) {
                                const el = document.getElementById(label.htmlFor);
                                if (el) return el;
                            }
                            const nested = label.querySelector('input, select, textarea');
                            if (nested) return nested;
                            
                            let next = label.nextElementSibling;
                            while (next) {
                                if (next.tagName === 'INPUT' || next.tagName === 'SELECT' || next.tagName === 'TEXTAREA') {
                                    return next;
                                }
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
                        if (name.includes(cleanLabel) || id.includes(cleanLabel) || placeholder.includes(cleanLabel)) {
                            return input;
                        }
                    }
                    return null;
                };

                for (const field of globalFields) {
                    try {
                        const el = findGlobalInput(field.name);
                        if (el) {
                            el.focus();
                            el.value = field.value;
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                            report("✏️ Filled global field: " + field.name + " -> " + field.value);
                        } else {
                            report("⚠️ Global field input target not found: " + field.name);
                        }
                    } catch (e) {
                        console.warn(e);
                    }
                }

                const rows = document.querySelectorAll(rowSelector);
                let successCount = 0;
                let failCount = 0;

                for (let i = 0; i < Math.min(rows.length, boqData.length); i++) {
                    const row = rows[i];
                    const item = boqData[i];
                    const priceValue = (item.rate || item.unit_price || 0).toString();
                    const label = item.item_code || (item.description ? item.description.substring(0, 15) : "Row " + (i + 1));
                    
                    try {
                        if (requiresClickToEdit) {
                            row.scrollIntoView({ block: 'center' });
                            row.click();
                            await new Promise(r => setTimeout(r, 200));
                        }
                        const input = row.querySelector(inputSelector);
                        if (input) {
                            input.scrollIntoView({ block: 'center' });
                            input.focus();
                            input.value = priceValue;
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                            input.blur();
                            successCount++;
                            report("✅ [" + (i + 1) + "/" + boqData.length + "] Filled: " + label + " -> " + priceValue);
                        } else {
                            failCount++;
                            report("⚠️ [" + (i + 1) + "/" + boqData.length + "] Target input missing: " + label);
                        }
                    } catch (err) {
                        failCount++;
                        report("⚠️ [" + (i + 1) + "/" + boqData.length + "] Error: " + err.message);
                    }
                    await new Promise(r => setTimeout(r, 150));
                }
                return { successCount, failCount };
            `;

            chrome.runtime.sendMessage({
                action: "executeScript",
                args: { code: fillScript }
            }, (response) => {
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
});
