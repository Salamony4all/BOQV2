import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useCompanyProfile } from '../context/CompanyContext';
import styles from '../styles/TableViewer.module.css';

// Removed hardcoded ITEMS_PER_PAGE to use state
function TenderAutofillModal({ isOpen, onClose, tables, apiBase }) {
    const { aiSettings } = useCompanyProfile();
    const [tenderStatus, setTenderStatus] = useState('idle'); // idle, loading_browser, ready, executing, page_done, completed, error
    const [sessionInfo, setSessionInfo] = useState({ id: null, vncUrl: null });
    const [errorMessage, setErrorMessage] = useState('');
    const [logs, setLogs] = useState([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(20);
    const [completedPages, setCompletedPages] = useState(new Set());
    const [globalFields, setGlobalFields] = useState([{ name: '', value: '' }]);
    const logEndRef = useRef(null);
    const pollingRef = useRef(null);

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

    const handleStartAutofill = async () => {
        // Slice only the current page's items
        const startIdx = (currentPage - 1) * itemsPerPage;
        const endIdx = startIdx + itemsPerPage;
        const pageData = payloadData.slice(startIdx, endIdx);

        if (pageData.length === 0) {
            setErrorMessage('No BOQ data found for this page chunk.');
            setTenderStatus('error');
            return;
        }

        setTenderStatus('executing');
        setLogs(prev => [...prev, `🚀 Deploying agent for Page ${currentPage}/${totalPages} (${pageData.length} items)...`]);

        try {
            const response = await fetch(`${apiBase}/api/tender/execute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: sessionInfo.id,
                    boq_data: pageData,
                    page_number: currentPage,
                    total_pages: totalPages,
                    provider: aiSettings?.engine,
                    provider_model: aiSettings?.model,
                    global_fields: globalFields.filter(f => f.name.trim() !== '')
                })
            });

            const result = await response.json();
            if (result.success) {
                // Initialize background log stream polling tracker
                startPolling(sessionInfo.id, currentPage, totalPages);
            } else {
                throw new Error(result.error || 'Agent deployment rejected by backend runner.');
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
                    </div>

                    {/* Stream Viewport Frame */}
                    <div style={{ flex: 1, position: 'relative', background: '#0b1121' }}>
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

                        {tenderStatus === 'completed' && allPagesDone && (
                            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: '#34d399', backgroundColor: 'rgba(15, 23, 42, 0.95)', zIndex: 10 }}>
                                <div style={{ fontSize: '3rem', marginBottom: '14px' }}>🏆</div>
                                <p style={{ margin: '0 0 6px 0', fontSize: '1.2rem', fontWeight: 'bold' }}>Tender Form Matrix Fully Synchronized</p>
                                <p style={{ margin: 0, color: '#64748b', fontSize: '0.85rem' }}>All pages completed. {payloadData.length} items filled successfully.</p>
                            </div>
                        )}

                        {(tenderStatus === 'ready' || tenderStatus === 'executing') && sessionInfo.vncUrl && (
                            <div style={{ width: '100%', height: '100%', overflow: 'hidden', background: '#ffffff' }}>
                                <iframe
                                    src={sessionInfo.vncUrl.replace('resize=remote', 'resize=scale').includes('resize=scale') ? sessionInfo.vncUrl.replace('resize=remote', 'resize=scale') : `${sessionInfo.vncUrl}&resize=scale`}
                                    style={{ width: '100%', height: '100%', border: 'none' }}
                                    title="Oman Tender Board Mirror Session Stream"
                                    allowFullScreen
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer Controls Layout */}
                <div style={{ padding: '12px 24px', background: '#1e293b', borderTop: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>

                    {/* Left: Latest Telemetry Event */}
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                        <div style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 'bold', marginBottom: '4px' }}>
                            <span style={{ color: '#f59e0b' }}>💡 Auto-Fill Agent</span> | {payloadData.length} items mapped
                        </div>
                        <div style={{ fontFamily: 'monospace', fontSize: '0.9rem', color: '#38bdf8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {logs.length > 0 ? `> ${logs[logs.length - 1]}` : '> Awaiting pipeline ignition sequence...'}
                        </div>
                    </div>

                    {/* Right: Deploy Button */}
                    <button
                        onClick={handleStartAutofill}
                        disabled={tenderStatus !== 'ready'}
                        style={{
                            padding: '12px 28px',
                            background: tenderStatus === 'ready' ? '#10b981' : '#1e293b',
                            color: tenderStatus === 'ready' ? '#ffffff' : '#475569',
                            border: tenderStatus === 'ready' ? 'none' : '1px solid #334155',
                            borderRadius: '6px',
                            cursor: tenderStatus === 'ready' ? 'pointer' : 'not-allowed',
                            fontWeight: 600,
                            fontSize: '0.95rem',
                            transition: 'all 0.15s ease',
                            whiteSpace: 'nowrap',
                            boxShadow: tenderStatus === 'ready' ? '0 4px 12px rgba(16, 185, 129, 0.3)' : 'none'
                        }}
                    >
                        {tenderStatus === 'executing' ? `⏳ Running Agent...` : `Deploy Autofill ⚡`}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default TenderAutofillModal;