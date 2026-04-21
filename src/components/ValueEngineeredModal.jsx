import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import AIPresentationModal from './AIPresentationModal';
import TableViewer from './TableViewer';
import styles from '../styles/ValueEngineeredModal.module.css';
import mbs from '../styles/MultiBudgetModal.module.css';
import { useCompanyProfile } from '../context/CompanyContext';
import { useTheme } from '../context/ThemeContext';
import { getApiBase } from '../utils/apiBase';
import { getFullUrl } from '../utils/urlUtils';

const API_BASE = getApiBase();

/**
 * Converts the VE flat rows[] array into the { tables } format that TableViewer expects.
 * Each VE row becomes a table row with cells matching the header columns.
 */
const VE_TABLE_HEADER = ['#', 'Image', 'Description', 'Brand', 'Model', 'Qty', 'Unit', 'Rate', 'Amount'];

function veRowsToTableViewerData(rows) {
    if (!rows || rows.length === 0) return null;
    const tableRows = rows.map((row) => ({
        cells: [
            { value: String(row.sn || '') },
            {
                value: '',
                images: row.brandImage
                    ? [{ url: row.brandImage }]
                    : row.imageRef
                        ? [{ url: row.imageRef }]
                        : []
            },
            { value: row.description || '' },
            { value: row.selectedBrand || '' },
            { value: row.selectedModel || '' },
            { value: String(row.qty || '') },
            { value: String(row.unit || '') },
            { value: String(row.rate || '') },
            { value: String(row.amount || '') },
        ]
    }));
    return {
        tables: [{
            title: 'VALUE ENGINEERED OFFER',
            header: VE_TABLE_HEADER,
            rows: tableRows
        }]
    };
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const batch = async (items, limit, fn) => {
    for (let i = 0; i < items.length; i += limit) {
        const chunk = items.slice(i, i + limit);
        await Promise.all(chunk.map(fn));
    }
};

// -- Utility: detect header rows that should not be AI-matched --
const isHeaderRow = (desc, row = {}) => {
    if (!desc || desc.trim() === '') return true;
    const normalized = desc.trim().toLowerCase();
    if (/^\[.*?\]/.test(normalized)) return false;
    const hasData = String(row.qty || '').trim() || String(row.unit || '').trim();
    if (hasData) return false;
    const exactHeaders = [
        'item', 'description', 'desc', 'quantity', 'qty', 'unit', 'uom',
        'rate', 'price', 'total', 'amount', 's.n.', 'sn', 'sr.no', 'id',
        'ref', 'area', 'specification', 'remarks', 'location',
        'subtotal', 'total amount', 'grand total', 'net total'
    ];
    if (exactHeaders.some(kw => normalized === kw || normalized.startsWith(kw + ' '))) return true;
    if (/^(location|area|floor|block|zone|room|item\s*no|s\.no|ref)$/i.test(normalized)) return true;
    if (/^(group|type|section|category|list)\s+of\s/i.test(normalized)) return true;
    return false;
};

// -- Category keyword maps for advanced mode matching --
const CATEGORY_KEYWORDS = {
    desking: ['desk', 'workstation', 'meeting table', 'conference table', 'table', 'bench', 'height adjustable', 'sit stand'],
    seating: ['chair', 'task chair', 'executive chair', 'operational chair', 'directional chair', 'office seating', 'stool'],
    softSeating: ['sofa', 'lounge', 'soft seating', 'armchair', 'public seating', 'couch', 'bench seating', 'ottoman'],
    accessories: ['lighting', 'acoustic', 'pod', 'electrification', 'screen', 'partition', 'accessory', 'cable', 'monitor arm', 'pedestal']
};

const CATEGORY_ICONS = {
    desking: '🖥️',
    seating: '💺',
    softSeating: '🛋️',
    accessories: '⚡'
};

const CATEGORY_LABELS = {
    desking: 'DESKING',
    seating: 'SEATING',
    softSeating: 'SOFT SEATING',
    accessories: 'ACCESSORIES'
};

const CATEGORY_HINTS = {
    desking: 'Desks, workstations, meeting & conference tables, height-adjustable',
    seating: 'Task chairs, executive chairs, operational & directional chairs',
    softSeating: 'Sofas, lounge seating, armchairs, public seating, ottomans',
    accessories: 'Lighting, acoustic pods, electrifications, partitions'
};

const CATEGORY_DEFAULTS = {
    desking: 'NARBUTAS',
    seating: 'SEDUS',
    softSeating: 'B&T DESIGN',
    accessories: 'NARBUTAS'
};

// Detect which category an item description belongs to (for advanced mode)
const inferCategory = (description) => {
    const lower = (description || '').toLowerCase();
    for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        if (keywords.some(kw => lower.includes(kw))) return cat;
    }
    return null;
};


export default function ValueEngineeredModal({ isOpen, onClose, allBrands = [] }) {
    const { theme } = useTheme();
    const { aiSettings } = useCompanyProfile();

    // ---- STAGE ----
    const [stage, setStage] = useState(1); // 1, 2, 3

    // ---- STAGE 1: Upload ----
    const [uploadedFiles, setUploadedFiles] = useState([]); // { id, file, type: 'excel'|'pdf'|'plan', status: 'processing'|'ready'|'error', progress }
    const [extractedRows, setExtractedRows] = useState([]);
    const [backgroundDone, setBackgroundDone] = useState(false);
    const excelInputRef = useRef(null);
    const pdfInputRef = useRef(null);
    const planInputRef = useRef(null);
    const [draggingCard, setDraggingCard] = useState(null); // 'excel'|'pdf'|'plan'

    // ---- STAGE 2: Brand Config ----
    const [brandMode, setBrandMode] = useState('simple'); // 'simple' | 'advanced'
    const [globalBrand, setGlobalBrand] = useState('');
    const [categoryBrands, setCategoryBrands] = useState({
        desking: CATEGORY_DEFAULTS.desking,
        seating: CATEGORY_DEFAULTS.seating,
        softSeating: CATEGORY_DEFAULTS.softSeating,
        accessories: CATEGORY_DEFAULTS.accessories
    });

    // ---- STAGE 3: Inline BOQ Table ----
    const [rows, setRows] = useState([]); // populated by buildBoqRows on stage entry
    const rowsRef = useRef(rows);
    useEffect(() => { rowsRef.current = rows; }, [rows]);

    const [openBrandDropdown, setOpenBrandDropdown] = useState(null); // index of open brand dropdown
    const [previewImage, setPreviewImage] = useState(null);

    const [isRunning, setIsRunning] = useState(false);
    const [aiStatus, setAiStatus] = useState({
        active: false, status: 'idle', currentItem: null, brand: '', model: '', image: null, minimized: false
    });
    const [batchResult, setBatchResult] = useState(null);
    const [progress, setProgress] = useState({ current: 0, total: 0 });

    // ---- Reset on open ----
    useEffect(() => {
        if (isOpen) {
            setStage(1);
            setUploadedFiles([]);
            setExtractedRows([]);
            setBackgroundDone(false);
            setRows([]);
            setIsRunning(false);
            setAiStatus({ active: false, status: 'idle', currentItem: null, brand: '', model: '', image: null, minimized: false });
            setBatchResult(null);
            setProgress({ current: 0, total: 0 });
            setGlobalBrand('');
            setCategoryBrands({
                desking: CATEGORY_DEFAULTS.desking,
                seating: CATEGORY_DEFAULTS.seating,
                softSeating: CATEGORY_DEFAULTS.softSeating,
                accessories: CATEGORY_DEFAULTS.accessories
            });
        }
    }, [isOpen]);

    // ---- Auto-trigger "Generate from BOQ" when entering Stage 3 ----
    // Populates the inline table from extractedRows (no AI yet — user edits first)
    const executeValueEngineeredAIRef = useRef(null);
    useEffect(() => {
        if (stage === 3 && rows.length === 0 && extractedRows.length > 0) {
            // Seed the inline table immediately from extracted rows
            const seeded = extractedRows.map((r, i) => ({ ...r, id: Date.now() + i, aiStatus: 'idle' }));
            setRows(seeded);
        }
    }, [stage]); // intentionally only stage – single trigger on entry

    if (!isOpen) return null;

    // ================================================
    // STAGE 3: INLINE BOQ CELL / BRAND / MODEL HELPERS
    // ================================================

    /** Cascading cell change with auto-fill for brand logo and model data */
    const handleVeCellChange = (rowIndex, field, value) => {
        setRows(prev => {
            const newRows = [...prev];
            const row = { ...newRows[rowIndex] };

            if (field === 'selectedBrand') {
                row.selectedBrand = value;
                row.selectedMainCat = '';
                row.selectedSubCat = '';
                row.selectedFamily = '';
                row.selectedModel = '';
                row.selectedModelUrl = '';
                row.brandImage = '';
                row.brandDesc = '';
                const brand = allBrands.find(b => b.name === value);
                row.brandLogo = brand?.logo || '';
            } else if (field === 'selectedMainCat') {
                row.selectedMainCat = value;
                row.selectedSubCat = '';
                row.selectedFamily = '';
                row.selectedModel = '';
                row.selectedModelUrl = '';
            } else if (field === 'selectedSubCat') {
                row.selectedSubCat = value;
                row.selectedFamily = '';
                row.selectedModel = '';
                row.selectedModelUrl = '';
            } else if (field === 'selectedFamily') {
                row.selectedFamily = value;
                row.selectedModel = '';
                row.selectedModelUrl = '';
            } else if (field === 'selectedModel') {
                // value is { model, url }
                const { model, url } = value;
                row.selectedModel = model;
                row.selectedModelUrl = url;
                const brand = allBrands.find(b => b.name === row.selectedBrand);
                if (brand?.products) {
                    let product = brand.products.find(p =>
                        (p.productUrl && p.productUrl === url) ||
                        (p.imageUrl && p.imageUrl === url)
                    );
                    if (!product) {
                        product = brand.products.find(p =>
                            (p.normalization?.category || p.mainCategory) === row.selectedMainCat &&
                            (p.normalization?.subCategory || p.subCategory) === row.selectedSubCat &&
                            p.family === row.selectedFamily &&
                            p.model === model
                        ) || brand.products.find(p => p.model === model);
                    }
                    if (product) {
                        row.brandDesc = product.description || product.model;
                        row.brandImage = product.imageUrl || '';
                        const basePrice = parseFloat(product.price) || 0;
                        if (basePrice > 0) row.rate = basePrice.toFixed(2);
                        const qty = parseFloat(row.qty) || 0;
                        if (qty > 0 && basePrice > 0) row.amount = (qty * basePrice).toFixed(2);
                        if (!row.unit) row.unit = 'Nos';
                    }
                }
            } else {
                row[field] = value;
            }

            // Auto-cascade single-option levels — mirrors MultiBudgetModal logic
            const cleanVals = (arr) => arr.filter(v => v && v !== 'null' && v !== 'undefined');
            const autoSelectNextLevel = (r) => {
                const activeBrand = allBrands.find(b => b.name === r.selectedBrand);
                if (!activeBrand?.products) return;
                const bp = activeBrand.products;
                if (r.selectedBrand && !r.selectedMainCat) {
                    const cats = cleanVals([...new Set(bp.flatMap(p => [p.normalization?.category, p.mainCategory]).filter(Boolean))]);
                    if (cats.length === 1) { r.selectedMainCat = cats[0]; autoSelectNextLevel(r); return; }
                }
                if (r.selectedMainCat && !r.selectedSubCat) {
                    const subs = cleanVals([...new Set(bp.filter(p => (p.normalization?.category || p.mainCategory) === r.selectedMainCat).flatMap(p => [p.normalization?.subCategory, p.subCategory]).filter(Boolean))]);
                    if (subs.length === 1) { r.selectedSubCat = subs[0]; autoSelectNextLevel(r); return; }
                }
                if (r.selectedSubCat && !r.selectedFamily) {
                    const fams = cleanVals([...new Set(bp.filter(p =>
                        (p.normalization?.category || p.mainCategory) === r.selectedMainCat &&
                        (p.normalization?.subCategory || p.subCategory) === r.selectedSubCat
                    ).map(p => p.family).filter(Boolean))]);
                    if (fams.length === 1) { r.selectedFamily = fams[0]; autoSelectNextLevel(r); return; }
                }
            };
            autoSelectNextLevel(row);

            newRows[rowIndex] = row;
            return newRows;
        });
    };

    const handleVeAddRow = (afterIndex) => {
        setRows(prev => {
            const next = [...prev];
            next.splice(afterIndex + 1, 0, {
                id: Date.now(),
                sn: afterIndex + 2,
                imageRef: null, brandImage: '', brandDesc: '', brandLogo: '',
                description: '', qty: '', unit: '', rate: '', amount: '',
                selectedBrand: '', selectedMainCat: '', selectedSubCat: '',
                selectedFamily: '', selectedModel: '', selectedModelUrl: '',
                aiStatus: 'idle'
            });
            return next.map((r, i) => ({ ...r, sn: i + 1 }));
        });
    };

    const handleVeRemoveRow = (index) => {
        setRows(prev => prev.filter((_, i) => i !== index).map((r, i) => ({ ...r, sn: i + 1 })));
    };

    /** Render a single inline BOQ row with brand/model dropdowns (mirrors MultiBudgetModal.renderRow) */
    const renderVeRow = (row, index) => {
        const activeBrand = allBrands.find(b => b.name === row.selectedBrand);
        const brandProducts = activeBrand?.products || [];

        const mergeUnique = (plist, k1, k2) => {
            const set = new Set();
            plist.forEach(p => {
                const v1 = k1.split('.').reduce((o, i) => o?.[i], p);
                const v2 = k2?.split('.').reduce((o, i) => o?.[i], p);
                if (v1 && v1 !== 'null') set.add(v1);
                if (v2 && v2 !== 'null') set.add(v2);
            });
            return [...set].sort();
        };

        const mainCats = mergeUnique(brandProducts, 'normalization.category', 'mainCategory');
        const matchingByMain = brandProducts.filter(p => (p.normalization?.category || p.mainCategory) === row.selectedMainCat);
        const subCats = mergeUnique(matchingByMain, 'normalization.subCategory', 'subCategory');
        const families = [...new Set(brandProducts.filter(p =>
            (p.normalization?.category || p.mainCategory) === row.selectedMainCat &&
            (p.normalization?.subCategory || p.subCategory) === row.selectedSubCat
        ).map(p => p.family).filter(Boolean))].sort();

        const rawModels = [];
        const seenUids = new Set();
        brandProducts.filter(p =>
            (p.normalization?.category || p.mainCategory) === row.selectedMainCat &&
            (p.normalization?.subCategory || p.subCategory) === row.selectedSubCat &&
            (p.family || '') === (row.selectedFamily || '')
        ).forEach(p => {
            const uid = p.productUrl || p.imageUrl || `id_${p.id || Math.random()}`;
            if (!seenUids.has(uid)) { seenUids.add(uid); rawModels.push(p); }
        });

        const modelGroups = {};
        rawModels.forEach(p => { if (!modelGroups[p.model]) modelGroups[p.model] = []; modelGroups[p.model].push(p); });
        const modelOptions = [];
        Object.entries(modelGroups).forEach(([modelName, items]) => {
            items.forEach((item, i) => {
                const cat = item.subCategory || item.mainCategory || 'Misc';
                const snippet = item.description ? item.description.substring(0, 25) + '...' : `Variant ${i + 1}`;
                const uid = item.productUrl || item.imageUrl || `model_${modelName}_${i}`;
                modelOptions.push({ value: uid, label: items.length > 1 ? `[${cat}] ${modelName} (${snippet})` : `[${cat}] ${modelName}`, rawModel: modelName });
            });
        });

        const rowStatusClass = row.aiStatus === 'processing' ? mbs.aiPulse : row.aiStatus === 'success' ? mbs.aiGlow : row.aiStatus === 'error' ? mbs.aiErrorBorder : '';
        const refImgSrc = getFullUrl(row.imageRef);

        return (
            <tr key={row.id} className={rowStatusClass}>
                {/* SN */}
                <td style={{ textAlign: 'center', verticalAlign: 'middle', minWidth: 40, fontSize: '0.78rem', color: 'var(--text-muted,#94a3b8)', fontWeight: 600 }}>
                    {row.sn}
                </td>

                {/* Ref Image */}
                <td style={{ verticalAlign: 'middle', minWidth: 72 }}>
                    {row.imageRef ? (
                        <img src={refImgSrc} alt="ref" className={mbs.tableImg}
                            onClick={() => setPreviewImage(refImgSrc)}
                            onError={e => { e.target.style.opacity = '0.3'; }} />
                    ) : (
                        <div className={mbs.imgPlaceholder} style={{ fontSize: '0.65rem' }}>No Img</div>
                    )}
                </td>

                {/* Description */}
                <td style={{ verticalAlign: 'middle', minWidth: 220 }}>
                    <textarea className={mbs.cellInput} value={row.description}
                        onChange={e => handleVeCellChange(index, 'description', e.target.value)}
                        style={{ minHeight: 72, resize: 'vertical', width: '100%' }} />
                </td>

                {/* Brand Image result */}
                <td style={{ verticalAlign: 'middle', minWidth: 80 }}>
                    {row.brandImage ? (
                        <img src={getFullUrl(row.brandImage)} alt="brand" className={mbs.tableImg}
                            onClick={() => setPreviewImage(getFullUrl(row.brandImage))}
                            onError={e => e.target.style.display = 'none'} />
                    ) : (
                        <div className={mbs.imgPlaceholder} style={{ fontSize: '0.65rem' }}>Select</div>
                    )}
                </td>

                {/* Brand description */}
                <td style={{ verticalAlign: 'middle', minWidth: 160 }}>
                    <textarea className={mbs.cellInput} value={row.brandDesc}
                        onChange={e => handleVeCellChange(index, 'brandDesc', e.target.value)}
                        style={{ minHeight: 72, resize: 'vertical', width: '100%' }}
                        placeholder="Product details..." />
                </td>

                {/* Qty */}
                <td style={{ verticalAlign: 'middle', minWidth: 60 }}>
                    <input className={mbs.cellInput} value={row.qty}
                        onChange={e => handleVeCellChange(index, 'qty', e.target.value)}
                        style={{ textAlign: 'center' }} />
                </td>

                {/* Unit */}
                <td style={{ verticalAlign: 'middle', minWidth: 60 }}>
                    <input className={mbs.cellInput} value={row.unit}
                        onChange={e => handleVeCellChange(index, 'unit', e.target.value)} />
                </td>

                {/* Rate */}
                <td style={{ verticalAlign: 'middle', minWidth: 80 }}>
                    <input className={mbs.cellInput} value={row.rate}
                        onChange={e => handleVeCellChange(index, 'rate', e.target.value)}
                        style={{ textAlign: 'right' }} />
                </td>

                {/* Amount (computed) */}
                <td style={{ verticalAlign: 'middle', minWidth: 90 }}>
                    <input type="text" className={mbs.cellInput}
                        value={row.rate && parseFloat(row.rate) > 0
                            ? (parseFloat(row.qty || 0) * parseFloat(row.rate || 0)).toFixed(2)
                            : (row.amount || '')}
                        onChange={e => handleVeCellChange(index, 'amount', e.target.value)}
                        style={{ textAlign: 'right', opacity: row.rate && parseFloat(row.rate) > 0 ? 0.7 : 1 }}
                        disabled={!!(row.rate && parseFloat(row.rate) > 0)}
                        placeholder="0.00" />
                </td>

                {/* Brand + Model dropdowns */}
                <td style={{ verticalAlign: 'middle', minWidth: 200 }}>
                    <div className={mbs.dropdownStack}>
                        {/* Brand trigger */}
                        <div className={mbs.brandDropdownContainer}>
                            {row.aiStatus === 'processing' ? (
                                <div className={mbs.aiLoadingCell}>
                                    <div className={mbs.tinySpinner} />
                                    <span style={{ fontSize: '0.72rem' }}>AI Matching…</span>
                                </div>
                            ) : (
                                <button
                                    className={`${mbs.brandTrigger} ${row.selectedBrand ? mbs.brandSelected : ''}`}
                                    onClick={() => setOpenBrandDropdown(openBrandDropdown === index ? null : index)}
                                >
                                    {row.selectedBrand ? (
                                        <>
                                            {row.brandLogo && (
                                                <img src={getFullUrl(row.brandLogo)} alt="" className={mbs.triggerLogo}
                                                    onError={e => e.target.style.display = 'none'} />
                                            )}
                                            <span className={mbs.triggerText}>{row.selectedBrand}</span>
                                        </>
                                    ) : (
                                        <span className={mbs.triggerPlaceholder}>Select Brand…</span>
                                    )}
                                    <span className={mbs.triggerArrow}>{openBrandDropdown === index ? '▲' : '▼'}</span>
                                </button>
                            )}

                            {openBrandDropdown === index && (
                                <div className={mbs.brandDropdownPanel}>
                                    {allBrands
                                        .filter(b => !b.name?.toLowerCase().includes('fitout'))
                                        .map((b, bIdx) => (
                                            <button key={bIdx} className={mbs.brandOption}
                                                onClick={() => {
                                                    handleVeCellChange(index, 'selectedBrand', b.name);
                                                    setOpenBrandDropdown(null);
                                                }}>
                                                {b.name}
                                            </button>
                                        ))}
                                </div>
                            )}
                        </div>

                        {/* Cascading selects */}
                        {row.selectedBrand && (
                            <select className={mbs.productSelect} value={row.selectedMainCat}
                                onChange={e => handleVeCellChange(index, 'selectedMainCat', e.target.value)}>
                                <option value="">Category…</option>
                                {mainCats.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        )}
                        {row.selectedMainCat && (
                            <select className={mbs.productSelect} value={row.selectedSubCat}
                                onChange={e => handleVeCellChange(index, 'selectedSubCat', e.target.value)}>
                                <option value="">Sub-Category…</option>
                                {subCats.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        )}
                        {row.selectedSubCat && (
                            <select className={mbs.productSelect} value={row.selectedFamily}
                                onChange={e => handleVeCellChange(index, 'selectedFamily', e.target.value)}>
                                <option value="">Family…</option>
                                {families.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        )}
                        {row.selectedFamily && (
                            <select className={mbs.productSelect} value={row.selectedModelUrl || ''}
                                onChange={e => {
                                    const opt = modelOptions.find(o => o.value === e.target.value);
                                    handleVeCellChange(index, 'selectedModel', { model: opt?.rawModel || '', url: e.target.value });
                                }}>
                                <option value="">Model Variant…</option>
                                {modelOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                            </select>
                        )}
                    </div>
                </td>

                {/* Actions */}
                <td style={{ verticalAlign: 'middle' }}>
                    <div className={mbs.actionCell}>
                        <button className={`${mbs.actionBtn} ${mbs.addBtn}`} onClick={() => handleVeAddRow(index)}>+</button>
                        <button className={`${mbs.actionBtn} ${mbs.removeBtn}`} onClick={() => handleVeRemoveRow(index)}>×</button>
                    </div>
                </td>
            </tr>
        );
    };

    // ================================================
    // UTILITIES
    // ================================================

    const furnitureBrands = allBrands.filter(b => !b.name?.toLowerCase().includes('fitout'));

    const getBrandLogo = (brandName) => {
        if (!brandName) return null;
        const found = allBrands.find(b => b.name?.toLowerCase().trim() === brandName.toLowerCase().trim());
        return found?.logo || null;
    };

    const buildBoqRows = (tables) => {
        if (!tables || tables.length === 0) return [];
        const sourceTable = tables[0];
        const header = sourceTable.header || [];

        const findCol = (regex) => header.findIndex(h => h && regex.test(String(h)));

        // Match TableViewer's full description regex: description | desc | disc | item | product
        let idxDesc = findCol(/description|desc|disc|item|product/i);
        if (idxDesc === -1) {
            // Smarter fallback: pick the column with the longest average text (skip SN/numeric columns)
            let bestIdx = 1;
            let bestLen = 0;
            const sampleRows = sourceTable.rows.slice(0, Math.min(5, sourceTable.rows.length));
            header.forEach((h, idx) => {
                if (/qty|quantity|unit|rate|price|amount|total|no\.|sn|#/i.test(String(h))) return;
                const avgLen = sampleRows.reduce((sum, r) => {
                    const v = r.cells?.[idx]?.value;
                    return sum + (v ? String(v).length : 0);
                }, 0) / Math.max(sampleRows.length, 1);
                if (avgLen > bestLen) { bestLen = avgLen; bestIdx = idx; }
            });
            idxDesc = bestIdx;
        }

        let idxQty = findCol(/^(?!.*(rate|price|amount)).*(qty|quantity)/i);
        if (idxQty === -1) idxQty = findCol(/qty|quantity/i);
        const idxUnit = findCol(/unit|uom/i);
        const idxRate = findCol(/rate|price/i);
        let idxTotal = findCol(/^(?!.*(qty|quantity)).*(total|amount)/i);
        if (idxTotal === -1) idxTotal = findCol(/amount|total/i);

        // Robust cell value extractor: handles richText arrays, plain value, or undefined
        const getVal = (row, idx) => {
            if (idx === -1 || !row.cells?.[idx]) return '';
            const cell = row.cells[idx];
            if (cell.richText && Array.isArray(cell.richText)) {
                return cell.richText.map(t => t.text || '').join('').trim();
            }
            return String(cell.value ?? '').trim();
        };

        return sourceTable.rows.map((row, i) => {
            if (!row || !row.cells) return null;
            const imageCell = row.cells.find(c => c.image || (c.images && c.images.length > 0));
            let imgSrc = imageCell ? (imageCell.image || imageCell.images?.[0]) : null;
            if (imgSrc && typeof imgSrc === 'object' && imgSrc.url) imgSrc = imgSrc.url;
            if (imgSrc && typeof imgSrc === 'string' && !imgSrc.startsWith('http') && !imgSrc.startsWith('/')) imgSrc = '/' + imgSrc;

            const desc = getVal(row, idxDesc);

            return {
                id: Date.now() + i,
                sn: i + 1,
                imageRef: imgSrc,
                brandImage: '', brandDesc: '',
                description: desc,
                qty: getVal(row, idxQty),
                unit: getVal(row, idxUnit),
                rate: getVal(row, idxRate),
                amount: getVal(row, idxTotal),
                selectedBrand: '', selectedMainCat: '', selectedSubCat: '', selectedFamily: '', selectedModel: '',
                aiStatus: 'idle'
            };
        }).filter(Boolean);
    };

    // ================================================
    // STAGE 1: FILE UPLOAD
    // ================================================

    const processFileUpload = async (file, type) => {
        const fileId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const fileEntry = { id: fileId, file, name: file.name, type, status: 'processing', progress: 0 };
        setUploadedFiles(prev => [...prev, fileEntry]);

        const updateFile = (delta) => setUploadedFiles(prev =>
            prev.map(f => f.id === fileId ? { ...f, ...delta } : f)
        );

        try {
            const formData = new FormData();
            formData.append('file', file);

            // Simulate progress while uploading
            let fakeProgress = 0;
            const progressInterval = setInterval(() => {
                fakeProgress = Math.min(fakeProgress + 8, 85);
                updateFile({ progress: fakeProgress });
            }, 300);

            const res = await fetch(`${API_BASE}/api/upload`, {
                method: 'POST',
                body: formData,
                headers: {
                    'x-session-id': `ve-${fileId}`,
                    'x-extraction-mode': 'parallel'
                }
            });

            clearInterval(progressInterval);

            if (!res.ok) {
                updateFile({ status: 'error', progress: 0 });
                return;
            }

            updateFile({ progress: 100, status: 'ready' });

            const data = await res.json();
            if (data?.data?.tables) {
                const newRows = buildBoqRows(data.data.tables);
                setExtractedRows(prev => {
                    const combined = [...prev, ...newRows].map((r, i) => ({ ...r, sn: i + 1 }));
                    return combined;
                });
            }
        } catch (err) {
            console.error('Upload error:', err);
            setUploadedFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'error', progress: 0 } : f));
        }
    };

    const handleFileSelect = (files, type) => {
        if (!files || files.length === 0) return;
        Array.from(files).forEach(file => processFileUpload(file, type));
    };

    const handleRemoveFile = (id) => {
        setUploadedFiles(prev => prev.filter(f => f.id !== id));
    };

    const handleDragOver = (e, cardType) => {
        e.preventDefault();
        setDraggingCard(cardType);
    };

    const handleDragLeave = () => setDraggingCard(null);

    const handleDrop = (e, type) => {
        e.preventDefault();
        setDraggingCard(null);
        const files = e.dataTransfer.files;
        if (files.length > 0) handleFileSelect(files, type);
    };

    const getFileIcon = (type) => ({ excel: '📊', pdf: '📄', plan: '📐' }[type] || '📁');

    const totalUploadProgress = uploadedFiles.length === 0 ? 0 :
        Math.round(uploadedFiles.reduce((sum, f) => sum + (f.progress || 0), 0) / uploadedFiles.length);
    const allReady = uploadedFiles.length > 0 && uploadedFiles.every(f => f.status === 'ready' || f.status === 'error');

    // ================================================
    // STAGE 3: AI EXECUTION
    // ================================================

    const executeValueEngineeredAI = async () => {
        executeValueEngineeredAIRef.current = null; // prevent double-fire
        if (isRunning) return;
        setIsRunning(true);
        setBatchResult(null);

        // Always operate on the CURRENT rows — preserves user edits (deletions, changes, etc.)
        // Only fall back to extractedRows if Stage 3 was never seeded yet
        const sourceRows = rows.length > 0 ? rows : extractedRows;
        if (sourceRows.length === 0) {
            setIsRunning(false);
            return;
        }

        // Reset only the aiStatus flags — do NOT re-seed row data (would wipe user edits)
        const seededRows = sourceRows.map(r => ({ ...r, aiStatus: 'idle' }));
        setRows(seededRows);

        const workableIndices = seededRows
            .map((r, i) => i)
            .filter(i => !isHeaderRow(seededRows[i].description, seededRows[i]));

        setProgress({ current: 0, total: workableIndices.length });
        setAiStatus({ active: true, status: 'identifying', currentItem: null, brand: '...', model: 'Starting...', image: null, minimized: false });

        let successCount = 0;
        let errorCount = 0;

        const processRow = async (rowIndex) => {
            const row = rowsRef.current[rowIndex];
            if (!row || row.aiStatus === 'success') return;

            // Determine which brand to use based on mode
            let targetBrand = '';
            let categoryScope = null;

            if (brandMode === 'simple') {
                targetBrand = globalBrand;
            } else {
                // Advanced: detect category by description
                const detected = inferCategory(row.description);
                if (detected) {
                    targetBrand = categoryBrands[detected] || Object.values(categoryBrands)[0] || '';
                    categoryScope = CATEGORY_LABELS[detected];
                } else {
                    // Fallback to first available category brand
                    targetBrand = categoryBrands.desking || Object.values(categoryBrands)[0] || '';
                }
            }

            if (!targetBrand) return;

            setAiStatus(prev => ({
                ...prev,
                status: 'identifying',
                currentItem: row,
                brand: targetBrand,
                model: 'Matching...',
                image: null
            }));

            // Mark row as processing
            setRows(prev => prev.map((r, i) => i === rowIndex ? { ...r, aiStatus: 'processing' } : r));

            const sizeContext = [row.qty && `Qty: ${row.qty}`, row.unit && `Unit: ${row.unit}`].filter(Boolean).join(', ');
            const enrichedDesc = sizeContext ? `${row.description} | ${sizeContext}` : row.description;

            // Build VE payload:
            //   Option 1 (simple)  → brand only, no category
            //   Option 2 (advanced) → brand + category scope
            const payload = {
                description: enrichedDesc,
                qty: row.qty,
                unit: row.unit,
                brand: targetBrand,
                providerModel: aiSettings?.model,
                ...(brandMode === 'advanced' && categoryScope ? { category: categoryScope } : {})
            };

            try {
                const response = await fetch(`${API_BASE}/api/ve-match`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const result = await response.json();

                if (result.status === 'success' && result.product) {
                    const match = result.product;
                    const matchedBrand = match.brand || targetBrand;

                    // Try to resolve against local brand data
                    const localBrand = allBrands.find(b => b.name?.toLowerCase().trim() === matchedBrand.toLowerCase().trim());
                    let finalModel = match.model || '';
                    let finalImageUrl = match.imageUrl || '';
                    let finalBrandDesc = match.description || finalModel;
                    let finalRate = parseFloat(match.price) > 0 ? parseFloat(match.price).toFixed(2) : (row.rate || '0.00');
                    const resolvedLogo = localBrand?.logo || '';

                    // Resolve full category tree so dropdowns render correctly
                    let resolvedMainCat = '';
                    let resolvedSubCat = '';
                    let resolvedFamily = '';
                    let resolvedModelUrl = '';

                    if (localBrand?.products) {
                        const normalize = s => String(s || '').toLowerCase().replace(/#\d+/g, '').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
                        const target = normalize(finalModel);
                        const matched = localBrand.products.filter(p => normalize(p.model).includes(target) || target.includes(normalize(p.model)));
                        if (matched.length > 0) {
                            const best = matched.sort((a, b) => (parseFloat(b.price) || 0) - (parseFloat(a.price) || 0))[0];
                            finalModel = best.model;
                            finalImageUrl = best.imageUrl || finalImageUrl;
                            if (parseFloat(best.price) > 0) finalRate = parseFloat(best.price).toFixed(2);
                            if (best.description) finalBrandDesc = best.description;
                            // Backfill the category tree from the matched product
                            resolvedMainCat = best.normalization?.category || best.mainCategory || '';
                            resolvedSubCat = best.normalization?.subCategory || best.subCategory || '';
                            resolvedFamily = best.family || '';
                            resolvedModelUrl = best.productUrl || best.imageUrl || '';
                        }
                    }

                    setAiStatus(prev => ({
                        ...prev,
                        status: 'success',
                        brand: matchedBrand,
                        model: finalModel,
                        image: finalImageUrl
                    }));

                    setRows(prev => prev.map((r, i) => i === rowIndex ? {
                        ...r,
                        selectedBrand: matchedBrand,
                        selectedMainCat: resolvedMainCat,
                        selectedSubCat: resolvedSubCat,
                        selectedFamily: resolvedFamily,
                        selectedModel: finalModel,
                        selectedModelUrl: resolvedModelUrl,
                        brandImage: finalImageUrl,
                        brandLogo: resolvedLogo,
                        brandDesc: finalBrandDesc,
                        rate: finalRate,
                        amount: (parseFloat(finalRate) * (parseFloat(r.qty) || 0)).toFixed(2),
                        aiStatus: 'success'
                    } : r));

                    successCount++;
                } else {
                    const newStatus = result.status === 'no_match' ? 'no_match' : 'error';
                    setRows(prev => prev.map((r, i) => i === rowIndex ? { ...r, aiStatus: newStatus } : r));
                    if (newStatus === 'error') errorCount++;
                }
            } catch (err) {
                setRows(prev => prev.map((r, i) => i === rowIndex ? { ...r, aiStatus: 'error' } : r));
                errorCount++;
            }

            setProgress(prev => ({ ...prev, current: prev.current + 1 }));
            await sleep(800);
        };

        try {
            await batch(workableIndices, 5, idx => processRow(idx));
            setBatchResult({ success: successCount, error: errorCount });
        } catch (err) {
            setBatchResult({ error: 1 });
        } finally {
            setIsRunning(false);
            setAiStatus(prev => ({ ...prev, active: false }));
            setTimeout(() => setBatchResult(null), 8000);
        }
    };
    // Attach latest fn to ref so the useEffect trigger can call it
    executeValueEngineeredAIRef.current = executeValueEngineeredAI;

    // ================================================
    // RENDER HELPERS
    // ================================================

    const canGoToStage2 = uploadedFiles.length > 0 || extractedRows.length > 0;
    const canGoToStage3 = brandMode === 'simple'
        ? globalBrand !== ''
        : Object.values(categoryBrands).some(b => b !== '');

    // ================================================
    // RENDER
    // ================================================

    return (
        <>
            <div className={styles.overlay}>
                <div className={styles.panel} onClick={e => e.stopPropagation()}>

                    {/* HEADER */}
                    <div className={styles.header}>
                        <div>
                            <div className={styles.headerTitle}>✨ VALUE ENGINEERED OFFER</div>
                            <div className={styles.headerSubtitle}>Upload · Configure · AI Furnish — Single Optimized Result</div>
                        </div>
                        <button className={styles.closeBtn} onClick={onClose}>×</button>
                    </div>

                    {/* STEPPER */}
                    <div className={styles.stepper}>
                        {[
                            { n: 1, label: 'Upload & Preview' },
                            { n: 2, label: 'Brand Configuration' },
                            { n: 3, label: 'AI Furnishing' }
                        ].map((s, idx) => (
                            <React.Fragment key={s.n}>
                                {idx > 0 && (
                                    <div className={`${styles.stepConnector} ${stage > idx ? styles.stepConnectorActive : ''}`} />
                                )}
                                <div
                                    className={`${styles.stepItem} ${stage === s.n ? styles.stepItemActive : ''} ${stage > s.n ? styles.stepItemCompleted : ''}`}
                                    onClick={() => {
                                        if (s.n < stage) setStage(s.n);
                                        if (s.n === 2 && canGoToStage2) setStage(2);
                                        if (s.n === 3 && canGoToStage3) setStage(3);
                                    }}
                                >
                                    <div className={styles.stepNumber}>{stage > s.n ? '✓' : s.n}</div>
                                    <span className={styles.stepLabel}>{s.label}</span>
                                </div>
                            </React.Fragment>
                        ))}
                    </div>

                    {/* BODY */}
                    <div className={styles.body}>

                        {/* ===== STAGE 1: UPLOAD & PREVIEW ===== */}
                        {stage === 1 && (
                            <>
                                {/* Mini nav strip — mirrors footer nav */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                    <button
                                        className={styles.btnBack}
                                        style={{ opacity: 0.35, cursor: 'not-allowed' }}
                                        disabled
                                    >
                                        ← Back
                                    </button>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #94a3b8)', letterSpacing: '0.04em' }}>
                                        Step 1 of 3 — Upload &amp; Preview
                                    </div>
                                    <button
                                        className={styles.btnNext}
                                        onClick={() => setStage(2)}
                                        disabled={!canGoToStage2}
                                    >
                                        Next →
                                    </button>
                                </div>

                                {/* Upload Cards */}
                                <div className={styles.uploadGrid}>
                                    {/* Excel Card */}
                                    <div
                                        className={`${styles.uploadCard} ${draggingCard === 'excel' ? styles.uploadCardDragging : ''}`}
                                        onClick={() => excelInputRef.current?.click()}
                                        onDragOver={e => handleDragOver(e, 'excel')}
                                        onDragLeave={handleDragLeave}
                                        onDrop={e => handleDrop(e, 'excel')}
                                    >
                                        <input ref={excelInputRef} type="file" accept=".xlsx,.xls" multiple style={{ display: 'none' }}
                                            onChange={e => handleFileSelect(e.target.files, 'excel')} />
                                        <div className={styles.uploadCardIcon}>📊</div>
                                        <div className={styles.uploadCardTitle}>Excel</div>
                                        <div className={styles.uploadCardHint}>.xlsx / .xls BOQ spreadsheet</div>
                                    </div>

                                    {/* PDF/Image Card */}
                                    <div
                                        className={`${styles.uploadCard} ${draggingCard === 'pdf' ? styles.uploadCardDragging : ''}`}
                                        onClick={() => pdfInputRef.current?.click()}
                                        onDragOver={e => handleDragOver(e, 'pdf')}
                                        onDragLeave={handleDragLeave}
                                        onDrop={e => handleDrop(e, 'pdf')}
                                    >
                                        <input ref={pdfInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg" multiple style={{ display: 'none' }}
                                            onChange={e => handleFileSelect(e.target.files, 'pdf')} />
                                        <div className={styles.uploadCardIcon}>📄</div>
                                        <div className={styles.uploadCardTitle}>PDF or Image</div>
                                        <div className={styles.uploadCardHint}>.pdf / .png / .jpg — AI extraction</div>
                                    </div>

                                    {/* Plan Card */}
                                    <div
                                        className={`${styles.uploadCard} ${draggingCard === 'plan' ? styles.uploadCardDragging : ''}`}
                                        onClick={() => planInputRef.current?.click()}
                                        onDragOver={e => handleDragOver(e, 'plan')}
                                        onDragLeave={handleDragLeave}
                                        onDrop={e => handleDrop(e, 'plan')}
                                    >
                                        <input ref={planInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg" multiple style={{ display: 'none' }}
                                            onChange={e => handleFileSelect(e.target.files, 'plan')} />
                                        <div className={styles.uploadCardIcon}>📐</div>
                                        <div className={styles.uploadCardTitle}>Plan</div>
                                        <div className={styles.uploadCardHint}>.pdf / .png — BOQ generation from drawings</div>
                                    </div>
                                </div>

                                {/* File List */}
                                {uploadedFiles.length > 0 && (
                                    <div className={styles.fileList}>
                                        <div className={styles.fileListTitle}>
                                            Uploaded Files
                                            <span className={styles.fileListCount}>{uploadedFiles.length}</span>
                                        </div>

                                        {/* Overall progress bar */}
                                        {!allReady && (
                                            <div className={styles.progressBarContainer}>
                                                <div className={styles.progressLabel}>
                                                    <span>Background Processing</span>
                                                    <span>{totalUploadProgress}%</span>
                                                </div>
                                                <div className={styles.progressTrack}>
                                                    <div className={styles.progressFill} style={{ width: `${totalUploadProgress}%` }} />
                                                </div>
                                            </div>
                                        )}

                                        {uploadedFiles.map(f => (
                                            <div key={f.id} className={styles.fileItem}>
                                                <div className={`${styles.fileIcon} ${styles[`fileIcon${f.type.charAt(0).toUpperCase() + f.type.slice(1)}`]}`}>
                                                    {getFileIcon(f.type)}
                                                </div>
                                                <div className={styles.fileName}>{f.name}</div>

                                                {/* Per-file progress if still processing */}
                                                {f.status === 'processing' && (
                                                    <div style={{ flex: 1, maxWidth: 100 }}>
                                                        <div className={styles.progressTrack} style={{ height: 4 }}>
                                                            <div className={styles.progressFill} style={{ width: `${f.progress || 0}%` }} />
                                                        </div>
                                                    </div>
                                                )}

                                                <span className={`${styles.fileStatus} ${styles[`fileStatus${f.status.charAt(0).toUpperCase() + f.status.slice(1)}`]}`}>
                                                    {f.status === 'processing' ? '⚙ Processing...' : f.status === 'ready' ? '✓ Ready' : '✕ Error'}
                                                </span>

                                                <button className={styles.fileRemoveBtn} onClick={() => handleRemoveFile(f.id)}>
                                                    ×
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Preview Table — EDITABLE inline table bound to extractedRows */}
                                {extractedRows.length > 0 && (
                                    <div style={{ marginTop: '1.25rem' }}>
                                        {/* Header bar */}
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                                            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary,#cbd5e1)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                                                📋 Extracted BOQ Preview
                                                <span style={{ marginLeft: '0.6rem', fontWeight: 400, fontSize: '0.72rem', color: 'var(--text-muted,#94a3b8)' }}>
                                                    — edit / remove rows before AI filling
                                                </span>
                                            </div>
                                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted,#94a3b8)' }}>
                                                {extractedRows.length} rows
                                            </span>
                                        </div>

                                        {/* Table */}
                                        <div className={styles.veTableViewerWrap} style={{ overflowX: 'auto', marginTop: 0 }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                                <thead>
                                                    <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '2px solid rgba(255,255,255,0.08)' }}>
                                                        {['#', 'Image', 'Description', 'Qty', 'Unit', 'Rate', ''].map((h, i) => (
                                                            <th key={i} style={{
                                                                padding: '0.5rem 0.6rem',
                                                                textAlign: i >= 3 && i <= 5 ? 'right' : 'left',
                                                                fontWeight: 700,
                                                                color: 'var(--text-muted,#94a3b8)',
                                                                fontSize: '0.7rem',
                                                                whiteSpace: 'nowrap',
                                                                letterSpacing: '0.04em',
                                                                textTransform: 'uppercase'
                                                            }}>{h}</th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {extractedRows.map((row, index) => {
                                                        const refImgSrc = getFullUrl(row.imageRef);
                                                        const updateExtRow = (field, val) =>
                                                            setExtractedRows(prev => prev.map((r, i) => i === index ? { ...r, [field]: val } : r));
                                                        const removeExtRow = () =>
                                                            setExtractedRows(prev => prev.filter((_, i) => i !== index).map((r, j) => ({ ...r, sn: j + 1 })));
                                                        const addExtRow = () =>
                                                            setExtractedRows(prev => {
                                                                const next = [...prev];
                                                                next.splice(index + 1, 0, {
                                                                    id: Date.now(), sn: index + 2,
                                                                    imageRef: null, brandImage: '', brandDesc: '',
                                                                    description: '', qty: '', unit: '', rate: '', amount: '',
                                                                    selectedBrand: '', selectedMainCat: '', selectedSubCat: '',
                                                                    selectedFamily: '', selectedModel: '', selectedModelUrl: '',
                                                                    aiStatus: 'idle'
                                                                });
                                                                return next.map((r, j) => ({ ...r, sn: j + 1 }));
                                                            });
                                                        return (
                                                            <tr key={row.id || index} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                                                {/* # */}
                                                                <td style={{ textAlign: 'center', minWidth: 32, fontSize: '0.72rem', color: 'var(--text-muted,#94a3b8)', fontWeight: 600, verticalAlign: 'middle', padding: '0.4rem 0.5rem' }}>
                                                                    {row.sn}
                                                                </td>
                                                                {/* Image */}
                                                                <td style={{ verticalAlign: 'middle', minWidth: 58, padding: '0.4rem 0.5rem' }}>
                                                                    {row.imageRef ? (
                                                                        <img
                                                                            src={refImgSrc}
                                                                            alt="ref"
                                                                            style={{ width: 46, height: 46, objectFit: 'cover', borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)', cursor: 'zoom-in' }}
                                                                            onClick={() => setPreviewImage && setPreviewImage(refImgSrc)}
                                                                            onError={e => { e.target.style.opacity = '0.3'; }}
                                                                        />
                                                                    ) : (
                                                                        <div style={{ width: 46, height: 46, borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px dashed rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', color: 'var(--text-muted,#94a3b8)' }}>
                                                                            –
                                                                        </div>
                                                                    )}
                                                                </td>
                                                                {/* Description */}
                                                                <td style={{ verticalAlign: 'middle', minWidth: 220, padding: '0.35rem 0.5rem' }}>
                                                                    <textarea
                                                                        className={mbs.cellInput}
                                                                        value={row.description || ''}
                                                                        onChange={e => updateExtRow('description', e.target.value)}
                                                                        style={{ minHeight: 60, resize: 'vertical', width: '100%' }}
                                                                        placeholder="Item description…"
                                                                    />
                                                                </td>
                                                                {/* Qty */}
                                                                <td style={{ verticalAlign: 'middle', minWidth: 52, padding: '0.35rem 0.4rem' }}>
                                                                    <input
                                                                        className={mbs.cellInput}
                                                                        value={row.qty || ''}
                                                                        onChange={e => updateExtRow('qty', e.target.value)}
                                                                        style={{ textAlign: 'right' }}
                                                                    />
                                                                </td>
                                                                {/* Unit */}
                                                                <td style={{ verticalAlign: 'middle', minWidth: 54, padding: '0.35rem 0.4rem' }}>
                                                                    <input
                                                                        className={mbs.cellInput}
                                                                        value={row.unit || ''}
                                                                        onChange={e => updateExtRow('unit', e.target.value)}
                                                                    />
                                                                </td>
                                                                {/* Rate */}
                                                                <td style={{ verticalAlign: 'middle', minWidth: 68, padding: '0.35rem 0.4rem' }}>
                                                                    <input
                                                                        className={mbs.cellInput}
                                                                        value={row.rate || ''}
                                                                        onChange={e => updateExtRow('rate', e.target.value)}
                                                                        style={{ textAlign: 'right' }}
                                                                    />
                                                                </td>
                                                                {/* Actions */}
                                                                <td style={{ verticalAlign: 'middle', padding: '0.35rem 0.4rem' }}>
                                                                    <div className={mbs.actionCell}>
                                                                        <button className={`${mbs.actionBtn} ${mbs.addBtn}`} onClick={addExtRow} title="Insert row below">+</button>
                                                                        <button className={`${mbs.actionBtn} ${mbs.removeBtn}`} onClick={removeExtRow} title="Delete row">×</button>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>

                                        {/* Add row footer */}
                                        <button
                                            onClick={() => setExtractedRows(prev => [...prev, {
                                                id: Date.now(), sn: prev.length + 1,
                                                imageRef: null, brandImage: '', brandDesc: '', description: '',
                                                qty: '', unit: '', rate: '', amount: '',
                                                selectedBrand: '', selectedMainCat: '', selectedSubCat: '',
                                                selectedFamily: '', selectedModel: '', selectedModelUrl: '', aiStatus: 'idle'
                                            }])}
                                            style={{
                                                marginTop: '0.5rem', display: 'block', width: '100%',
                                                padding: '0.4rem', background: 'rgba(255,255,255,0.03)',
                                                border: '1px dashed rgba(255,255,255,0.12)', borderRadius: 8,
                                                color: 'var(--text-muted,#94a3b8)', fontSize: '0.78rem',
                                                cursor: 'pointer', transition: 'background 0.2s'
                                            }}
                                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                        >
                                            + Add Row
                                        </button>
                                    </div>
                                )}

                                {/* Empty state */}
                                {uploadedFiles.length === 0 && (
                                    <div className={styles.emptyState}>
                                        <div className={styles.emptyText}>Upload your BOQ Excel, PDF, or Plan drawings to get started</div>
                                    </div>
                                )}
                            </>
                        )}

                        {/* ===== STAGE 2: BRAND CONFIGURATION ===== */}
                        {stage === 2 && (
                            <>
                                {/* Mode selector */}
                                <div className={styles.modeSelector}>
                                    <div
                                        className={`${styles.modeCard} ${brandMode === 'simple' ? styles.modeCardActive : ''}`}
                                        onClick={() => setBrandMode('simple')}
                                    >
                                        <div className={styles.modeCardTitle}>One Brand Match</div>
                                        <div className={styles.modeCardDesc}>
                                            Apply a single brand globally to match all FF&amp;E items in the uploaded BOQ.
                                        </div>
                                    </div>
                                    <div
                                        className={`${styles.modeCard} ${brandMode === 'advanced' ? styles.modeCardActive : ''}`}
                                        onClick={() => setBrandMode('advanced')}
                                    >
                                        <div className={styles.modeCardTitle}>Categorized Match</div>
                                        <div className={styles.modeCardDesc}>
                                            Assign a different brand per furniture category — Desking, Seating, Soft Seating, Accessories.
                                        </div>
                                    </div>
                                </div>

                                {/* Option 1: Simple brand dropdown */}
                                {brandMode === 'simple' && (
                                    <div className={styles.globalBrandSelect}>
                                        <div className={styles.fileListTitle}>Select Brand</div>
                                        <div className={styles.brandDropdownWrap}>
                                            <select
                                                className={styles.brandDropdown}
                                                value={globalBrand}
                                                onChange={e => setGlobalBrand(e.target.value)}
                                            >
                                                <option value="">— Choose a brand —</option>
                                                {furnitureBrands.map(b => (
                                                    <option key={b.name} value={b.name}>{b.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                        {globalBrand && (
                                            <div className={styles.selectedBrandDisplay}>
                                                {getBrandLogo(globalBrand) && (
                                                    <img
                                                        src={getBrandLogo(globalBrand)}
                                                        alt={globalBrand}
                                                        className={styles.selectedBrandLogo}
                                                        onError={e => e.target.style.display = 'none'}
                                                    />
                                                )}
                                                <div className={styles.selectedBrandName}>{globalBrand}</div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Option 2: Advanced per-category */}
                                {brandMode === 'advanced' && (
                                    <div className={styles.categoryGrid}>
                                        {Object.keys(CATEGORY_LABELS).map(cat => {
                                            const selectedBrand = categoryBrands[cat];
                                            const logo = getBrandLogo(selectedBrand);
                                            return (
                                                <div
                                                    key={cat}
                                                    className={`${styles.categoryCard} ${selectedBrand ? styles.categoryCardSelected : ''}`}
                                                >
                                                    <div className={styles.categoryCardHeader}>
                                                        <span className={styles.categoryName}>{CATEGORY_LABELS[cat]}</span>
                                                    </div>
                                                    <div className={styles.categoryHint}>{CATEGORY_HINTS[cat]}</div>
                                                    <select
                                                        className={styles.categoryBrandDropdown}
                                                        value={selectedBrand}
                                                        onChange={e => setCategoryBrands(prev => ({ ...prev, [cat]: e.target.value }))}
                                                    >
                                                        <option value="">— No brand —</option>
                                                        {/* Pin CATEGORY_DEFAULTS brand at top */}
                                                        {CATEGORY_DEFAULTS[cat] && furnitureBrands.find(b => b.name === CATEGORY_DEFAULTS[cat]) && (
                                                            <option key={`pin-${cat}`} value={CATEGORY_DEFAULTS[cat]}>
                                                                ★ {CATEGORY_DEFAULTS[cat]}
                                                            </option>
                                                        )}
                                                        <option disabled>──────────────</option>
                                                        {furnitureBrands
                                                            .filter(b => b.name !== CATEGORY_DEFAULTS[cat])
                                                            .map(b => (
                                                                <option key={b.name} value={b.name}>{b.name}</option>
                                                            ))}
                                                    </select>
                                                    {selectedBrand && (
                                                        <div className={styles.categoryLogoWrap}>
                                                            {logo ? (
                                                                <img
                                                                    src={logo}
                                                                    alt={selectedBrand}
                                                                    className={styles.categoryLogo}
                                                                    onError={e => e.target.style.display = 'none'}
                                                                />
                                                            ) : (
                                                                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #cbd5e1)', fontWeight: 600 }}>
                                                                    {selectedBrand}
                                                                </span>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </>
                        )}

                        {/* ===== STAGE 3: AI FURNISHING — INLINE BOQ TABLE ===== */}
                        {stage === 3 && (
                            <>
                                {/* Toolbar */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                                    <div style={{ flex: 1, fontSize: '0.82rem', color: 'var(--text-muted,#94a3b8)' }}>
                                        {rows.length > 0
                                            ? `${rows.length} items loaded — select brands manually or run AI Autofill`
                                            : extractedRows.length === 0
                                                ? 'Upload a BOQ in Stage 1 first'
                                                : 'Preparing BOQ…'}
                                    </div>
                                    {rows.length > 0 && (
                                        <>
                                            <button
                                                className={styles.furnishBtn}
                                                style={{ width: 'auto', padding: '0.55rem 1.25rem', fontSize: '0.82rem' }}
                                                onClick={executeValueEngineeredAI}
                                                disabled={isRunning}
                                            >
                                                {isRunning ? '⚙️ AI Running…' : '✨ AI Autofill'}
                                            </button>
                                            <button
                                                className={styles.btnBack}
                                                style={{ fontSize: '0.8rem', padding: '0.55rem 1rem' }}
                                                onClick={() => {
                                                    const reseeded = extractedRows.map((r, i) => ({ ...r, id: Date.now() + i, aiStatus: 'idle' }));
                                                    setRows(reseeded);
                                                    setBatchResult(null);
                                                }}
                                                disabled={isRunning}
                                            >
                                                ↺ Reset
                                            </button>
                                        </>
                                    )}
                                </div>

                                {/* AI progress bar */}
                                {isRunning && (
                                    <div className={styles.progressBarContainer} style={{ marginBottom: '1rem' }}>
                                        <div className={styles.progressLabel}>
                                            <span>AI Matching in Progress</span>
                                            <span>{progress.current} / {progress.total}</span>
                                        </div>
                                        <div className={styles.progressTrack}>
                                            <div className={styles.progressFill}
                                                style={{ width: progress.total > 0 ? `${Math.round((progress.current / progress.total) * 100)}%` : '0%' }} />
                                        </div>
                                    </div>
                                )}

                                {/* Batch result banner */}
                                {batchResult && (
                                    <div style={{
                                        padding: '0.65rem 1.1rem', borderRadius: 8, marginBottom: '0.75rem',
                                        background: batchResult.error > 0 ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)',
                                        border: `1px solid ${batchResult.error > 0 ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'}`,
                                        color: batchResult.error > 0 ? '#ef4444' : '#10b981',
                                        fontSize: '0.8rem', fontWeight: 600
                                    }}>
                                        ✓ {batchResult.success} matched · {batchResult.error} skipped
                                    </div>
                                )}

                                {/* Seeding spinner */}
                                {rows.length === 0 && extractedRows.length > 0 && (
                                    <div className={styles.emptyState}>
                                        <div className={styles.emptyIcon} style={{ fontSize: '2rem', animation: 'spin 1.2s linear infinite' }}>⚙️</div>
                                        <div className={styles.emptyText}>Preparing BOQ table…</div>
                                    </div>
                                )}

                                {/* No upload state */}
                                {rows.length === 0 && extractedRows.length === 0 && (
                                    <div className={styles.emptyState}>
                                        <div className={styles.emptyIcon}>⬆️</div>
                                        <div className={styles.emptyText}>No BOQ uploaded. Go back to Stage 1 and upload a file.</div>
                                    </div>
                                )}

                                {/* ---- INLINE BOQ TABLE ---- */}
                                {rows.length > 0 && (
                                    <div className={styles.veTableViewerWrap} style={{ overflowX: 'auto' }}>
                                        <table style={{
                                            width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem',
                                            tableLayout: 'auto'
                                        }}>
                                            <thead>
                                                <tr style={{
                                                    background: 'var(--surface-alt, rgba(255,255,255,0.04))',
                                                    borderBottom: '2px solid var(--border, rgba(255,255,255,0.08))'
                                                }}>
                                                    {['#', 'Ref', 'Description', 'Brand Match', 'Details', 'Qty', 'Unit', 'Rate', 'Amount', 'Brand / Model Select', ''].map((h, i) => (
                                                        <th key={i} style={{
                                                            padding: '0.55rem 0.6rem',
                                                            textAlign: i >= 5 && i <= 8 ? 'right' : 'left',
                                                            fontWeight: 600,
                                                            color: 'var(--text-secondary,#cbd5e1)',
                                                            fontSize: '0.72rem',
                                                            whiteSpace: 'nowrap',
                                                            letterSpacing: '0.04em'
                                                        }}>{h}</th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rows.map((row, index) => renderVeRow(row, index))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}

                                {/* Lightbox */}
                                {previewImage && (
                                    <div
                                        onClick={() => setPreviewImage(null)}
                                        style={{
                                            position: 'fixed', inset: 0, zIndex: 9999,
                                            background: 'rgba(0,0,0,0.85)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            cursor: 'zoom-out'
                                        }}
                                    >
                                        <img src={previewImage} alt="preview"
                                            style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 12, boxShadow: '0 0 60px rgba(0,0,0,0.8)' }} />
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* FOOTER NAVIGATION */}
                    <div className={styles.footer}>
                        <button
                            className={styles.btnBack}
                            onClick={() => setStage(s => Math.max(1, s - 1))}
                            disabled={stage === 1}
                        >
                            ← Back
                        </button>

                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted, #94a3b8)' }}>
                            Step {stage} of 3
                        </div>

                        {stage < 3 ? (
                            <button
                                className={styles.btnNext}
                                onClick={() => setStage(s => s + 1)}
                                disabled={stage === 1 && !canGoToStage2}
                            >
                                Next →
                            </button>
                        ) : (
                            <button
                                className={styles.btnNext}
                                onClick={onClose}
                            >
                                Close
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* AI PRESENTATION MODAL (real-time matching viz) */}
            <AIPresentationModal
                isOpen={aiStatus.active}
                onClose={() => setAiStatus(prev => ({ ...prev, active: false }))}
                currentItem={aiStatus.currentItem}
                batchResult={batchResult}
                brand={aiStatus.brand}
                foundModel={aiStatus.model}
                foundImage={aiStatus.image}
                progress={progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0}
                status={aiStatus.status}
                tier="value-engineered"
                type="furniture"
                alignment="right"
                isMinimized={aiStatus.minimized}
                onToggleMinimize={() => setAiStatus(prev => ({ ...prev, minimized: !prev.minimized }))}
            />
        </>
    );
}
