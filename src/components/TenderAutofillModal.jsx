import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useCompanyProfile } from '../context/CompanyContext';
import styles from '../styles/TableViewer.module.css';

// Removed hardcoded ITEMS_PER_PAGE to use state
function TenderAutofillModal({ isOpen, onClose, tables, apiBase }) {
    const { aiSettings } = useCompanyProfile();
    const [domainName, setDomainName] = useState('etendering.tenderboard.gov.om');
    const [isSandbox, setIsSandbox] = useState(false);
    
    const [tenderStatus, setTenderStatus] = useState('idle'); // idle, loading_browser, ready, executing, page_done, completed, error
    const [sessionInfo, setSessionInfo] = useState({ id: null, vncUrl: null });
    const [errorMessage, setErrorMessage] = useState('');
    const [logs, setLogs] = useState([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(50);
    const [completedPages, setCompletedPages] = useState(new Set());
    const [globalFields, setGlobalFields] = useState([{ name: '', value: '' }]);
    const [blueprint, setBlueprint] = useState(null);
    const [extensionInstalled, setExtensionInstalled] = useState(false);
    const [useExtension, setUseExtension] = useState(false);
    const logEndRef = useRef(null);
    const pollingRef = useRef(null);

    const sendExtensionCommand = (action, args) => {
        return new Promise((resolve, reject) => {
            const requestId = Math.random().toString(36).substring(2);
            const handleMessage = (event) => {
                if (event.data && event.data.source === "auto-browser-extension" && event.data.requestId === requestId) {
                    window.removeEventListener("message", handleMessage);
                    if (event.data.success) {
                        resolve(event.data.result);
                    } else {
                        reject(new Error(event.data.error || "Extension action failed"));
                    }
                }
            };
            window.addEventListener("message", handleMessage);
            window.postMessage({
                source: "auto-browser-app",
                requestId,
                action,
                args
            }, "*");
        });
    };

    // Pre-compute all BOQ payload items from table data
    const payloadData = useMemo(() => {
        return (tables || []).flatMap(table => {
            const header = table.header || [];
            const itemCodeIdx = header.findIndex(h => /code|bill.*no|item.*no/i.test(h));
            const descIdx = header.findIndex(h => /description|desc|disc|product/i.test(h));
            const qtyIdx = header.findIndex(h => /qty|quantity|qt/i.test(h));
            const rateIdx = header.findIndex(h => /rate|price|unit.*price|unit.*rate/i.test(h));

            return (table.rows || [])
                .filter(r => r && r.cells && !r.isHeader && !r.isSummary)
                .map(row => {
                    const itemCodeVal = itemCodeIdx !== -1 ? String(row.cells[itemCodeIdx]?.value || '').trim() : '';
                    const descVal = descIdx !== -1 ? String(row.cells[descIdx]?.value || '').trim() : '';
                    const qtyVal = qtyIdx !== -1 ? parseFloat(String(row.cells[qtyIdx]?.value || '').replace(/,/g, '')) : 0;
                    const rateVal = rateIdx !== -1 ? parseFloat(String(row.cells[rateIdx]?.value || '').replace(/,/g, '')) : 0;

                    if (!itemCodeVal && !descVal && !qtyVal && !rateVal) return null;
                    return { item_code: itemCodeVal, description: descVal, quantity: isNaN(qtyVal) ? 0 : qtyVal, rate: isNaN(rateVal) ? 0 : rateVal };
                })
                .filter(Boolean);
        });
    }, [tables]);

    // Detect Chrome Extension and listen to its events
    useEffect(() => {
        const checkExtension = () => {
            if (document.documentElement.hasAttribute("data-auto-browser-extension-installed")) {
                setExtensionInstalled(true);
                setUseExtension(true);
            }
        };
        checkExtension();

        // Listen for extension load ready event
        window.addEventListener("AutoBrowserExtensionReady", checkExtension);

        // Listen for progress events from background worker
        const handleExtensionEvent = (event) => {
            if (event.data && event.data.source === "auto-browser-extension-event") {
                if (event.data.event === "progress") {
                    setLogs(prev => [...prev, event.data.data.text]);
                } else if (event.data.event === "tabClosed") {
                    setLogs(prev => [...prev, "⚠️ Connection lost: The Tender Board browser tab was closed."]);
                    setTenderStatus('idle');
                    setSessionInfo({ id: null, vncUrl: null });
                }
            }
        };
        window.addEventListener("message", handleExtensionEvent);
        return () => {
            window.removeEventListener("AutoBrowserExtensionReady", checkExtension);
            window.removeEventListener("message", handleExtensionEvent);
        };
    }, []);

    // Synchronize BOQ data and AI settings to Extension Storage whenever they change
    useEffect(() => {
        if (extensionInstalled && sessionInfo.id === "extension-session") {
            if (payloadData.length > 0) {
                const startIdx = (currentPage - 1) * itemsPerPage;
                const endIdx = startIdx + itemsPerPage;
                const pageData = payloadData.slice(startIdx, endIdx);
                
                sendExtensionCommand("saveBoqData", {
                    boqData: pageData,
                    currentPage,
                    totalPages,
                    globalFields,
                    domainName,
                    apiBase: apiBase || window.location.origin
                }).catch(err => console.warn("Failed to sync BOQ data to extension:", err));
            }

            try {
                const stored = localStorage.getItem('boqflow_company_profile');
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (parsed.aiSettings) {
                        sendExtensionCommand("saveAiSettings", { aiSettings: parsed.aiSettings })
                            .catch(err => console.warn("Failed to sync AI settings to extension:", err));
                    }
                }
            } catch (e) {
                console.error("Failed to parse company profile for extension sync:", e);
            }
        }
    }, [extensionInstalled, sessionInfo.id, payloadData, currentPage, itemsPerPage, globalFields, domainName, isOpen]);

    // Synchronize Blueprint to Extension Storage whenever it changes
    useEffect(() => {
        if (extensionInstalled && sessionInfo.id === "extension-session" && blueprint) {
            sendExtensionCommand("saveBlueprint", { blueprint })
                .catch(err => console.warn("Failed to sync blueprint to extension:", err));
        }
    }, [extensionInstalled, sessionInfo.id, blueprint]);


    const totalPages = Math.ceil(payloadData.length / itemsPerPage) || 1;

    // Auto-scroll the agent log console
    useEffect(() => {
        if (logEndRef.current) {
            logEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs]);

    // Cleanup polling on unmount or closure
    useEffect(() => {
        if (isOpen) {
            setupTenderSession();
        } else {
            stopPolling();
            setTenderStatus('idle');
            setSessionInfo({ id: null, vncUrl: null });
            setErrorMessage('');
            setLogs([]);
            setCurrentPage(1);
            setCompletedPages(new Set());
        }
    }, [isOpen]);

    const startPolling = (sessionId, deployedPage, numPages) => {
        const poll = async () => {
            try {
                const response = await fetch(`${apiBase}/api/tender/status/${sessionId}`);
                const data = await response.json();

                if (data.success) {
                    setLogs((data.logs || []).slice(-150));
                    if (data.status === 'completed') {
                        // Mark this page as completed
                        setCompletedPages(prev => {
                            const next = new Set(prev);
                            next.add(deployedPage);
                            return next;
                        });

                        if (deployedPage >= numPages) {
                            // All pages done
                            setTenderStatus('completed');
                        } else {
                            // More pages remain — go back to ready, advance page
                            setCurrentPage(deployedPage + 1);
                            setTenderStatus('ready');
                        }
                        return;
                    } else if (data.status === 'failed') {
                        setTenderStatus('error');
                        setErrorMessage(data.error || 'Agent encountered a fatal execution loop mismatch.');
                        return;
                    }
                }
            } catch (err) {
                console.warn('⚠️ Log sync polling error:', err);
            }
            // Next poll starts only after the current one completes
            pollingRef.current = setTimeout(poll, 2500);
        };
        poll();
    };

    const stopPolling = () => {
        if (pollingRef.current) {
            clearTimeout(pollingRef.current);
            pollingRef.current = null;
        }
    };

    const setupTenderSession = async () => {
        setTenderStatus('loading_browser');
        if (useExtension) {
            try {
                setLogs(prev => [...prev, `🔌 Extension mode active. Connecting to ${isSandbox ? 'Mock Portal Sandbox' : 'Chrome Extension'}...`]);
                const targetUrl = isSandbox 
                    ? `${window.location.origin}/mock-portal.html` 
                    : "https://etendering.tenderboard.gov.om/product/publicDash?CTRL_STRDIRECTION=LTR";
                const res = await sendExtensionCommand("connect", { url: targetUrl });
                setSessionInfo({ id: "extension-session", vncUrl: null });
                setLogs(prev => [...prev, `✅ Browser tab connected successfully! (Tab ID: ${res.tabId})`]);
                setTenderStatus('ready');
            } catch (err) {
                setErrorMessage(`Extension Connection Error: ${err.message}`);
                setTenderStatus('error');
            }
            return;
        }

        try {
            const response = await fetch(`${apiBase}/api/tender/setup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await response.json();

            if (data.success) {
                setSessionInfo({ id: data.session_id, vncUrl: data.vnc_url });
                setTenderStatus('ready');
            } else {
                throw new Error(data.error || 'Failed to initialize remote browser environment.');
            }
        } catch (err) {
            setErrorMessage(err.message);
            setTenderStatus('error');
        }
    };

    const handleMapPlatform = async () => {
        setLogs(prev => [...prev, `🔍 Mapping platform for ${domainName}...`]);
        try {
            let domOutline = null;
            if (useExtension) {
                setLogs(prev => [...prev, "🔌 Extracting DOM structure from target tab via Extension..."]);
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
                domOutline = await sendExtensionCommand("executeScript", { code: domScript });
                setLogs(prev => [...prev, `✅ DOM outline extracted successfully. Sending to AI for mapping...`]);
            }

            const response = await fetch(`${apiBase}/api/tender/map-platform`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    session_id: useExtension ? undefined : sessionInfo.id, 
                    domain_name: domainName, 
                    force_remap: true,
                    dom_outline: domOutline || undefined
                })
            });
            const data = await response.json();
            if (data.success) {
                setBlueprint(data.blueprint);
                setLogs(prev => [...prev, `✅ Platform successfully mapped and blueprint stored.`]);
                return data.blueprint;
            } else {
                throw new Error(data.error || 'Failed to map platform.');
            }
        } catch (err) {
            setErrorMessage(err.message);
            setTenderStatus('error');
            return null;
        }
    };

    const handleExecuteBulkRun = async () => {
        const startIdx = (currentPage - 1) * itemsPerPage;
        const endIdx = startIdx + itemsPerPage;
        const pageData = payloadData.slice(startIdx, endIdx);

        if (pageData.length === 0) {
            setErrorMessage('No BOQ data found for this page chunk.');
            setTenderStatus('error');
            return;
        }

        setTenderStatus('executing');

        let activeBlueprint = blueprint;
        if (!activeBlueprint) {
            setLogs(prev => [...prev, `🔍 Blueprint not found. Automatically mapping platform first...`]);
            activeBlueprint = await handleMapPlatform();
            if (!activeBlueprint) {
                setErrorMessage('Automatic platform mapping failed. Cannot run bulk autofill.');
                setTenderStatus('error');
                return;
            }
        }

        setLogs(prev => [...prev, `🚀 Deploying bulk script for Page ${currentPage}/${totalPages} (${pageData.length} items)...`]);

        if (useExtension) {
            try {
                const fillScript = `
                    const rowSelector = ${JSON.stringify(activeBlueprint.row_selector)};
                    const inputSelector = ${JSON.stringify(activeBlueprint.input_selector)};
                    const requiresClickToEdit = ${Boolean(activeBlueprint.requires_click_to_edit)};
                    const boqData = ${JSON.stringify(pageData)};
                    const globalFields = ${JSON.stringify(globalFields.filter(f => f.name.trim() !== ''))};

                    const report = (text) => {
                        window.postMessage({ source: "auto-browser-target-page", data: { text } }, "*");
                    };

                    report("🚀 Starting bulk fill of " + boqData.length + " items directly in page...");

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
                            console.warn("Global field fill error:", e);
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
                                report("⚠️ [" + (i + 1) + "/" + boqData.length + "] Failed to find input inside row: " + label);
                            }
                        } catch (err) {
                            failCount++;
                            report("⚠️ [" + (i + 1) + "/" + boqData.length + "] Error filling row " + label + ": " + err.message);
                        }
                        await new Promise(r => setTimeout(r, 150));
                    }
                    return { successCount, failCount };
                `;
                const res = await sendExtensionCommand("executeScript", { code: fillScript });
                
                setCompletedPages(prev => {
                    const next = new Set(prev);
                    next.add(currentPage);
                    return next;
                });
                
                setLogs(prev => [
                    ...prev, 
                    `🎉 Chunk completed successfully!`,
                    `📈 Filled rows: ${res.successCount}`,
                    `⚠️ Failed/Readonly: ${res.failCount}`
                ]);

                if (currentPage >= totalPages) {
                    setTenderStatus('completed');
                } else {
                    setCurrentPage(currentPage + 1);
                    setTenderStatus('ready');
                }
            } catch (err) {
                setErrorMessage(err.message);
                setTenderStatus('error');
            }
            return;
        }

        try {
            const response = await fetch(`${apiBase}/api/tender/execute-bulk-blueprint`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: sessionInfo.id,
                    domain_name: domainName,
                    boq_data: pageData,
                    blueprint: activeBlueprint,
                    page_number: currentPage,
                    total_pages: totalPages,
                    global_fields: globalFields.filter(f => f.name.trim() !== '')
                })
            });

            const result = await response.json();
            if (result.success) {
                startPolling(sessionInfo.id, currentPage, totalPages);
            } else {
                throw new Error(result.error || 'Bulk execution deployment rejected.');
            }
        } catch (err) {
            setErrorMessage(err.message);
            setTenderStatus('error');
        }
    };

    if (!isOpen) return null;

    const allPagesDone = completedPages.size >= totalPages;

    return (
        <div className={styles.modalOverlay} onClick={onClose} style={{ paddingTop: '90px', paddingBottom: '20px' }}>
            <div className={styles.modalContent} onClick={e => e.stopPropagation()} style={{ width: '98%', height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column', maxWidth: '1800px', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)', position: 'relative' }}>

                {/* Compact Close Button */}
                <button className={styles.innerCloseButton} onClick={onClose} style={{ position: 'absolute', right: '16px', top: '16px', zIndex: 100, color: '#f8fafc', fontSize: '1.8rem', background: 'rgba(0,0,0,0.5)', border: 'none', cursor: 'pointer', padding: '0 8px', borderRadius: '6px', lineHeight: 1 }}>×</button>

                {/* Layout Body Splits */}
                <div style={{ flex: 1, backgroundColor: '#0f172a', display: 'flex', position: 'relative', minHeight: 0 }}>

                    {/* Left Sidebar: Global Fields */}
                    <div style={{ width: '320px', borderRight: '1px solid #334155', display: 'flex', flexDirection: 'column', backgroundColor: '#1e293b' }}>
                        <div style={{ padding: '20px 16px', borderBottom: '1px solid #334155' }}>
                            <h3 style={{ margin: '0 0 8px 0', color: '#f8fafc', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span>📋</span> Global Fields
                            </h3>
                            <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.8rem', lineHeight: 1.4 }}>
                                Define required fields (e.g. Manufacturer, Delivery Schedule) to be filled with the exact same value across <strong>all rows</strong>.
                            </p>
                        </div>
                        <div style={{ padding: '16px', flex: 1, overflowY: 'auto' }}>
                            {globalFields.map((field, idx) => (
                                <div key={idx} style={{ marginBottom: '16px', background: '#0f172a', padding: '12px', borderRadius: '8px', border: '1px solid #334155' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                        <label style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>Field {idx + 1}</label>
                                        {globalFields.length > 1 && (
                                            <button 
                                                onClick={() => setGlobalFields(globalFields.filter((_, i) => i !== idx))}
                                                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.8rem', padding: 0 }}
                                            >Remove</button>
                                        )}
                                    </div>
                                    <input 
                                        type="text" 
                                        placeholder="Column Name (e.g. Manufacturer/ Country)" 
                                        value={field.name}
                                        onChange={e => {
                                            const newFields = [...globalFields];
                                            newFields[idx].name = e.target.value;
                                            setGlobalFields(newFields);
                                        }}
                                        style={{ width: '100%', padding: '8px 10px', marginBottom: '10px', backgroundColor: '#1e293b', border: '1px solid #475569', color: '#f8fafc', borderRadius: '6px', fontSize: '0.85rem', outline: 'none' }}
                                    />
                                    <input 
                                        type="text" 
                                        placeholder="Value to fill (e.g. Oman)" 
                                        value={field.value}
                                        onChange={e => {
                                            const newFields = [...globalFields];
                                            newFields[idx].value = e.target.value;
                                            setGlobalFields(newFields);
                                        }}
                                        style={{ width: '100%', padding: '8px 10px', backgroundColor: '#1e293b', border: '1px solid #475569', color: '#f8fafc', borderRadius: '6px', fontSize: '0.85rem', outline: 'none' }}
                                    />
                                </div>
                            ))}
                            <button 
                                onClick={() => setGlobalFields([...globalFields, { name: '', value: '' }])}
                                style={{ width: '100%', padding: '10px', background: 'transparent', border: '1px dashed #475569', color: '#cbd5e1', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, transition: 'all 0.2s', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px' }}
                                onMouseOver={e => { e.currentTarget.style.borderColor = '#38bdf8'; e.currentTarget.style.color = '#38bdf8'; e.currentTarget.style.background = 'rgba(56, 189, 248, 0.05)'; }}
                                onMouseOut={e => { e.currentTarget.style.borderColor = '#475569'; e.currentTarget.style.color = '#cbd5e1'; e.currentTarget.style.background = 'transparent'; }}
                            >
                                <span>+</span> Add Another Field
                            </button>
                        </div>

                        {/* Automation Mode Selector */}
                        <div style={{ padding: '16px', borderTop: '1px solid #334155', backgroundColor: '#1e293b' }}>
                            <h3 style={{ margin: '0 0 8px 0', color: '#f8fafc', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span>⚙️</span> Automation Mode
                            </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #334155', paddingBottom: '8px' }}>
                                    <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>
                                        {extensionInstalled ? '🔌 Extension Detected' : '⚠️ Extension Missing'}
                                    </span>
                                    <a 
                                        href="/extension.zip" 
                                        download="extension.zip"
                                        title="Download Extension ZIP package for updates"
                                        style={{ fontSize: '0.75rem', color: '#38bdf8', textDecoration: 'underline', fontWeight: 600 }}
                                    >
                                        Download ZIP
                                    </a>
                                </div>
                                {extensionInstalled && (
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                                        <span style={{ fontSize: '0.8rem', color: '#cbd5e1', fontWeight: 500 }}>
                                            Use Chrome Extension
                                        </span>
                                        <label style={{ position: 'relative', display: 'inline-block', width: '38px', height: '20px', margin: 0 }}>
                                            <input 
                                                type="checkbox" 
                                                checked={useExtension} 
                                                onChange={e => {
                                                    setUseExtension(e.target.checked);
                                                    setTenderStatus('idle');
                                                    setSessionInfo({ id: null, vncUrl: null });
                                                    setLogs(prev => [...prev, `🔄 Switched mode: ${e.target.checked ? 'Chrome Extension' : 'Server Controller'}`]);
                                                }}
                                                style={{ opacity: 0, width: 0, height: 0 }}
                                            />
                                            <span style={{
                                                position: 'absolute', cursor: 'pointer', inset: 0, backgroundColor: useExtension ? '#10b981' : '#475569',
                                                borderRadius: '20px', transition: '0.3s',
                                                display: 'flex', alignItems: 'center'
                                            }}>
                                                <span style={{
                                                    height: '14px', width: '14px', left: useExtension ? '20px' : '4px',
                                                    backgroundColor: 'white', borderRadius: '50%',
                                                    position: 'absolute', transition: '0.3s'
                                                }} />
                                            </span>
                                        </label>
                                    </div>
                                )}
                                {extensionInstalled && (
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #334155', paddingTop: '8px', marginTop: '4px' }}>
                                        <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>
                                            🎯 Sandbox Mode (Test)
                                        </span>
                                        <label style={{ position: 'relative', display: 'inline-block', width: '38px', height: '20px', margin: 0 }}>
                                            <input 
                                                type="checkbox" 
                                                checked={isSandbox} 
                                                onChange={e => {
                                                    setIsSandbox(e.target.checked);
                                                    setDomainName(e.target.checked ? 'localhost' : 'etendering.tenderboard.gov.om');
                                                    setTenderStatus('idle');
                                                    setSessionInfo({ id: null, vncUrl: null });
                                                    setLogs(prev => [...prev, `🔄 Target portal switched to: ${e.target.checked ? 'Mock Sandbox' : 'Oman Tender Board (Live)'}`]);
                                                }}
                                                style={{ opacity: 0, width: 0, height: 0 }}
                                            />
                                            <span style={{
                                                position: 'absolute', cursor: 'pointer', inset: 0, backgroundColor: isSandbox ? '#f59e0b' : '#475569',
                                                borderRadius: '20px', transition: '0.3s',
                                                display: 'flex', alignItems: 'center'
                                            }}>
                                                <span style={{
                                                    height: '14px', width: '14px', left: isSandbox ? '20px' : '4px',
                                                    backgroundColor: 'white', borderRadius: '50%',
                                                    position: 'absolute', transition: '0.3s'
                                                }} />
                                            </span>
                                        </label>
                                    </div>
                                )}
                                {!extensionInstalled && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        <a 
                                            href="/extension.zip" 
                                            download="extension.zip"
                                            style={{
                                                display: 'block',
                                                width: '100%',
                                                padding: '10px',
                                                backgroundColor: '#38bdf8',
                                                color: '#0f172a',
                                                textAlign: 'center',
                                                borderRadius: '6px',
                                                fontWeight: 'bold',
                                                fontSize: '0.85rem',
                                                textDecoration: 'none',
                                                boxShadow: '0 4px 12px rgba(56, 189, 248, 0.2)',
                                                transition: 'all 0.15s ease'
                                            }}
                                            onMouseOver={e => { e.currentTarget.style.backgroundColor = '#7dd3fc'; }}
                                            onMouseOut={e => { e.currentTarget.style.backgroundColor = '#38bdf8'; }}
                                        >
                                            📥 Install Extension (Download ZIP)
                                        </a>
                                        <div style={{ fontSize: '0.75rem', color: '#cbd5e1', lineHeight: 1.4, padding: '10px', background: '#0f172a', borderRadius: '6px', border: '1px solid #334155' }}>
                                            <strong>Quick Install Steps:</strong>
                                            <ol style={{ margin: '6px 0 0 0', paddingLeft: '16px' }}>
                                                <li>Download & extract the ZIP file.</li>
                                                <li>Open Chrome and navigate to <code>chrome://extensions/</code>.</li>
                                                <li>Enable <strong>Developer mode</strong> (top-right).</li>
                                                <li>Click <strong>Load unpacked</strong> (top-left) and select the extracted folder.</li>
                                            </ol>
                                        </div>
                                    </div>
                                )}
                                {extensionInstalled && (
                                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', lineHeight: 1.4 }}>
                                        {useExtension ? 'Routing automation directly inside your active browser tab.' : 'Routing automation through FastAPI server.'}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Session Fill Progress checklist */}
                        <div style={{ padding: '16px', borderTop: '1px solid #334155', backgroundColor: '#1e293b' }}>
                            <h3 style={{ margin: '0 0 12px 0', color: '#f8fafc', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span>📊</span> Fill Progress
                            </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
                                {Array.from({ length: totalPages }, (_, i) => {
                                    const pageNum = i + 1;
                                    const isCompleted = completedPages.has(pageNum);
                                    const isActive = pageNum === currentPage;
                                    const isExecuting = isActive && tenderStatus === 'executing';
                                    
                                    const startIdx = i * itemsPerPage;
                                    const endIdx = Math.min(startIdx + itemsPerPage, payloadData.length);
                                    const rangeText = itemsPerPage === 99999 ? `All (${payloadData.length} items)` : `Items ${startIdx + 1}-${endIdx}`;

                                    let statusIcon = '⏳';
                                    let statusColor = '#94a3b8';
                                    let statusText = 'Pending';

                                    if (isCompleted) {
                                        statusIcon = '✅';
                                        statusColor = '#34d399';
                                        statusText = 'Completed';
                                    } else if (isExecuting) {
                                        statusIcon = '🔄';
                                        statusColor = '#38bdf8';
                                        statusText = 'Executing...';
                                    } else if (isActive) {
                                        statusIcon = '⚡';
                                        statusColor = '#f59e0b';
                                        statusText = 'Current Page';
                                    }

                                    return (
                                        <div 
                                            key={pageNum} 
                                            style={{ 
                                                display: 'flex', 
                                                alignItems: 'center', 
                                                justifyContent: 'space-between', 
                                                padding: '8px 12px', 
                                                borderRadius: '6px', 
                                                backgroundColor: isActive ? 'rgba(56, 189, 248, 0.08)' : '#0f172a',
                                                border: `1px solid ${isActive ? '#38bdf8' : '#334155'}`,
                                                fontSize: '0.8rem',
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                <span style={{ color: '#f8fafc', fontWeight: 600 }}>Page {pageNum}</span>
                                                <span style={{ color: '#64748b', fontSize: '0.7rem' }}>{rangeText}</span>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: statusColor, fontWeight: 500 }}>
                                                <span>{statusIcon}</span>
                                                <span>{statusText}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Log Console Dashboard or VNC Viewport */}
                    <div style={{ flex: 1, position: 'relative', background: '#0b1121', display: 'flex', flexDirection: 'column' }}>
                        {useExtension ? (
                            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
                                {/* Console Header */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', backgroundColor: '#0f172a', borderBottom: '1px solid #1e293b' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: sessionInfo.id ? '#10b981' : '#ef4444' }} />
                                        <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#38bdf8', fontWeight: 600 }}>
                                            Client-Side Automation Console ({isSandbox ? 'Mock Sandbox' : 'Live Portal'})
                                        </h3>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button 
                                            onClick={setupTenderSession} 
                                            style={{ padding: '6px 12px', background: '#1e293b', border: '1px solid #334155', color: '#cbd5e1', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
                                        >
                                            🔌 Reconnect Tab
                                        </button>
                                        <button 
                                            onClick={() => setLogs([])} 
                                            style={{ padding: '6px 12px', background: '#1e293b', border: '1px solid #334155', color: '#ef4444', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
                                        >
                                            🧹 Clear Console
                                        </button>
                                    </div>
                                </div>

                                {/* Console Logs Window */}
                                <div style={{ flex: 1, padding: '20px', overflowY: 'auto', fontFamily: 'Courier New, Courier, monospace', fontSize: '0.85rem', color: '#e2e8f0', display: 'flex', flexDirection: 'column', gap: '6px', backgroundColor: '#090f1d' }}>
                                    {logs.length === 0 ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#475569', textAlign: 'center' }}>
                                            <span style={{ fontSize: '2rem', marginBottom: '8px' }}>🤖</span>
                                            <p style={{ margin: 0 }}>Console ready. Click "Execute Bulk Fill" to ignite the pipeline.</p>
                                        </div>
                                    ) : (
                                        logs.map((log, i) => {
                                            let color = '#38bdf8'; // Blue for info
                                            if (log.includes('✅')) color = '#34d399'; // Green for success
                                            if (log.includes('🛑') || log.includes('Failed') || log.includes('Error')) color = '#f87171'; // Red for errors
                                            if (log.includes('⚠️')) color = '#fbbf24'; // Yellow for warnings
                                            if (log.includes('✏️')) color = '#c084fc'; // Purple for fills

                                            return (
                                                <div key={i} style={{ lineBreak: 'anywhere', whiteSpace: 'pre-wrap', color }}>
                                                    <span style={{ color: '#475569', marginRight: '8px' }}>[{new Date().toLocaleTimeString()}]</span>
                                                    {log}
                                                </div>
                                            );
                                        })
                                    )}
                                    <div ref={logEndRef} />
                                </div>
                            </div>
                        ) : (
                            <>
                                {tenderStatus === 'loading_browser' && (
                                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: '#94a3b8' }}>
                                        <div style={{ fontSize: '2rem', marginBottom: '12px', animation: 'pulse 1.5s infinite' }}>🛸</div>
                                        <p style={{ margin: 0, fontSize: '0.9rem' }}>Provisioning secure isolated Chrome container runtime display via internal network...</p>
                                    </div>
                                )}

                                {tenderStatus === 'error' && (
                                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: '#f87171', padding: '20px', textAlign: 'center' }}>
                                        <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>🛑</div>
                                        <p style={{ margin: '0 0 6px 0', fontSize: '1rem', fontWeight: 'bold' }}>Execution Engine Dropped Thread</p>
                                        <p style={{ margin: '0 0 16px 0', color: '#64748b', fontSize: '0.85rem', maxWidth: '400px' }}>{errorMessage}</p>
                                        <button onClick={setupTenderSession} style={{ padding: '8px 20px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem' }}>Re-allocate Node Context</button>
                                    </div>
                                )}

                                {(tenderStatus === 'ready' || tenderStatus === 'executing' || tenderStatus === 'completed') && (
                                    sessionInfo.vncUrl ? (
                                        <div style={{ width: '100%', height: '100%', overflow: 'hidden', background: '#ffffff' }}>
                                            <iframe
                                                src={sessionInfo.vncUrl.replace('resize=remote', 'resize=scale').includes('resize=scale') ? sessionInfo.vncUrl.replace('resize=remote', 'resize=scale') : `${sessionInfo.vncUrl}&resize=scale`}
                                                style={{ width: '100%', height: '100%', border: 'none' }}
                                                title="Oman Tender Board Mirror Session Stream"
                                                allowFullScreen
                                            />
                                        </div>
                                    ) : (
                                        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: '#cbd5e1', padding: '20px', textAlign: 'center', background: '#0b1121' }}>
                                            <div style={{ fontSize: '3rem', marginBottom: '16px' }}>💻</div>
                                            <p style={{ margin: '0 0 6px 0', fontSize: '1.2rem', fontWeight: 'bold', color: '#38bdf8' }}>Local Browser Connected</p>
                                            <p style={{ margin: '0 0 20px 0', color: '#94a3b8', fontSize: '0.9rem', maxWidth: '500px' }}>
                                                The controller is taking over your local Google Chrome window via Remote Debugging. You can view, interact, and log in directly in the popped Chrome tab.
                                            </p>
                                            <div style={{ display: 'flex', gap: '12px' }}>
                                                <button onClick={setupTenderSession} style={{ padding: '10px 20px', background: '#1e293b', border: '1px solid #475569', color: '#cbd5e1', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
                                                    🔄 Reconnect Browser
                                                </button>
                                            </div>
                                        </div>
                                    )
                                )}
                            </>
                        )}
                    </div>
                </div>

                {/* Footer Controls Layout */}
                <div style={{ padding: '12px 24px', background: '#1e293b', borderTop: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>

                    {/* Left: Latest Telemetry Event */}
                    <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                        <div style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 'bold', marginBottom: '4px' }}>
                            <span style={{ color: '#f59e0b' }}>💡 Auto-Fill Agent</span> | {payloadData.length} items mapped
                        </div>
                        <div style={{ fontFamily: 'monospace', fontSize: '0.9rem', color: '#38bdf8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {logs.length > 0 ? `> ${logs[logs.length - 1]}` : '> Awaiting pipeline ignition sequence...'}
                        </div>
                    </div>

                    {/* Middle: Pagination and Chunking Controls */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', backgroundColor: '#0f172a', padding: '6px 16px', borderRadius: '8px', border: '1px solid #334155', flexShrink: 0 }}>
                        {/* Chunk Size Dropdown */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ color: '#94a3b8', fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase' }}>Chunk:</span>
                            <select
                                value={itemsPerPage === 99999 ? 'all' : itemsPerPage}
                                onChange={e => {
                                    const val = e.target.value;
                                    if (val === 'all') {
                                        setItemsPerPage(99999);
                                    } else {
                                        setItemsPerPage(Number(val));
                                    }
                                    setCurrentPage(1);
                                    setCompletedPages(new Set());
                                    if (tenderStatus === 'completed') {
                                        setTenderStatus('ready');
                                    }
                                }}
                                disabled={tenderStatus === 'executing'}
                                style={{
                                    backgroundColor: '#1e293b',
                                    border: '1px solid #475569',
                                    color: '#f8fafc',
                                    borderRadius: '6px',
                                    padding: '4px 8px',
                                    fontSize: '0.85rem',
                                    outline: 'none',
                                    cursor: tenderStatus === 'executing' ? 'not-allowed' : 'pointer'
                                }}
                            >
                                <option value="20">20 rows</option>
                                <option value="50">50 rows</option>
                                <option value="100">100 rows</option>
                                <option value="all">All (Auto Match)</option>
                            </select>
                        </div>

                        {/* Vertical Separator */}
                        <div style={{ width: '1px', height: '16px', backgroundColor: '#334155' }} />

                        {/* Page Navigator */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button
                                onClick={() => {
                                    if (currentPage > 1) {
                                        setCurrentPage(currentPage - 1);
                                        if (tenderStatus === 'completed') {
                                            setTenderStatus('ready');
                                        }
                                    }
                                }}
                                disabled={currentPage === 1 || tenderStatus === 'executing'}
                                style={{
                                    background: 'transparent',
                                    border: '1px solid #475569',
                                    color: (currentPage === 1 || tenderStatus === 'executing') ? '#475569' : '#cbd5e1',
                                    borderRadius: '4px',
                                    padding: '2px 8px',
                                    cursor: (currentPage === 1 || tenderStatus === 'executing') ? 'not-allowed' : 'pointer',
                                    fontSize: '0.85rem',
                                    transition: 'all 0.15s ease'
                                }}
                            >
                                ◀
                            </button>
                            <span style={{ color: '#cbd5e1', fontSize: '0.85rem', minWidth: '85px', textAlign: 'center' }}>
                                Page {currentPage} of {totalPages}
                            </span>
                            <button
                                onClick={() => {
                                    if (currentPage < totalPages) {
                                        setCurrentPage(currentPage + 1);
                                        if (tenderStatus === 'completed') {
                                            setTenderStatus('ready');
                                        }
                                    }
                                }}
                                disabled={currentPage === totalPages || tenderStatus === 'executing'}
                                style={{
                                    background: 'transparent',
                                    border: '1px solid #475569',
                                    color: (currentPage === totalPages || tenderStatus === 'executing') ? '#475569' : '#cbd5e1',
                                    borderRadius: '4px',
                                    padding: '2px 8px',
                                    cursor: (currentPage === totalPages || tenderStatus === 'executing') ? 'not-allowed' : 'pointer',
                                    fontSize: '0.85rem',
                                    transition: 'all 0.15s ease'
                                }}
                            >
                                ▶
                            </button>
                        </div>
                    </div>

                    {/* Right: Deploy Buttons */}
                    <div style={{ display: 'flex', gap: '12px', flexShrink: 0, alignItems: 'center' }}>
                        {tenderStatus === 'completed' && (
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '8px 12px',
                                background: 'rgba(16, 185, 129, 0.15)',
                                border: '1px solid rgba(16, 185, 129, 0.3)',
                                borderRadius: '6px',
                                color: '#34d399',
                                fontSize: '0.85rem',
                                fontWeight: 600,
                                animation: 'fadeInUp 0.3s ease-out'
                            }}>
                                <span>✅</span> Bulk fill done!
                            </div>
                        )}
                        <button
                            onClick={setupTenderSession}
                            disabled={tenderStatus === 'executing'}
                            style={{
                                padding: '12px 20px',
                                background: 'transparent',
                                color: tenderStatus === 'executing' ? '#475569' : '#e2e8f0',
                                border: `1px solid ${tenderStatus === 'executing' ? '#334155' : '#475569'}`,
                                borderRadius: '6px',
                                cursor: tenderStatus === 'executing' ? 'not-allowed' : 'pointer',
                                fontWeight: 600,
                                fontSize: '0.95rem',
                                transition: 'all 0.15s ease'
                            }}
                        >
                            🔌 {sessionInfo.id ? 'Reconnect Browser' : 'Connect Browser'}
                        </button>

                        <button
                            onClick={handleExecuteBulkRun}
                            disabled={tenderStatus !== 'ready' && tenderStatus !== 'completed'}
                            style={{
                                padding: '12px 28px',
                                background: (tenderStatus === 'ready' || tenderStatus === 'completed') ? '#10b981' : '#1e293b',
                                color: (tenderStatus === 'ready' || tenderStatus === 'completed') ? '#ffffff' : '#475569',
                                border: (tenderStatus === 'ready' || tenderStatus === 'completed') ? 'none' : '1px solid #334155',
                                borderRadius: '6px',
                                cursor: (tenderStatus === 'ready' || tenderStatus === 'completed') ? 'pointer' : 'not-allowed',
                                fontWeight: 600,
                                fontSize: '0.95rem',
                                transition: 'all 0.15s ease',
                                whiteSpace: 'nowrap',
                                boxShadow: (tenderStatus === 'ready' || tenderStatus === 'completed') ? '0 4px 12px rgba(16, 185, 129, 0.3)' : 'none'
                            }}
                        >
                            {tenderStatus === 'executing' ? `⏳ Running Script...` : `Execute Bulk Fill ⚡`}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default TenderAutofillModal;