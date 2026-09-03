import React, { useState, useEffect, useRef, useMemo } from 'react';
import AIPresentationModal from './AIPresentationModal';
import SpecialistModal from './SpecialistModal';
import CostingModal from './CostingModal';
import BrandDropdown from './BrandDropdown';
import MultiImageCell from './MultiImageCell';
import ImageGalleryModal from './ImageGalleryModal';
import styles from '../styles/ValueEngineeredModal.module.css';
import mbs from '../styles/MultiBudgetModal.module.css';
import afStyles from '../styles/AutoFillSelectModal.module.css';
import { useCompanyProfile } from '../context/CompanyContext';
import { useTheme } from '../context/ThemeContext';
import { getApiBase } from '../utils/apiBase';
import { getFullUrl } from '../utils/urlUtils';
import { findDescColumn, cellImageUrls } from '../utils/boqUtils';

const API_BASE = getApiBase();

const VE_UI_CONFIG = {
    labels: { desking: 'Desking', seating: 'Seating', softSeating: 'Soft Seating', accessories: 'Accessories' },
    hints: {
        desking: 'Desks, workstations, meeting & conference tables',
        seating: 'Task chairs, executive chairs, operational chairs',
        softSeating: 'Sofas, lounge seating, armchairs, ottomans',
        accessories: 'Lighting, acoustic pods, electrifications'
    }
};

const VE_TABLE_HEADER = ['#', 'Image', 'Description', 'Brand', 'Model', 'Qty', 'Unit', 'Rate', 'Amount'];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const batch = async (items, limit, fn) => {
    for (let i = 0; i < items.length; i += limit) {
        const chunk = items.slice(i, i + limit);
        await Promise.all(chunk.map(fn));
    }
};

const isHeaderRow = (desc, row = {}) => {
    if (!desc || desc.trim() === '') return true;
    const normalized = desc.trim().toLowerCase();
    if (/^\[.*?\]/.test(normalized)) return false;
    const hasData = String(row.qty || '').trim() || String(row.unit || '').trim();
    if (hasData) return false;
    const exactHeaders = ['item', 'description', 'desc', 'quantity', 'qty', 'unit', 'uom', 'rate', 'price', 'total', 'amount', 's.n.', 'sn', 'sr.no', 'id', 'ref', 'area', 'specification', 'remarks', 'location', 'subtotal', 'total amount', 'grand total', 'net total'];
    if (exactHeaders.some(kw => normalized === kw || normalized.startsWith(kw + ' '))) return true;
    if (/^(location|area|floor|block|zone|room|item\s*no|s\.no|ref)$/i.test(normalized)) return true;
    if (/^(group|type|section|category|list)\s+of\s/i.test(normalized)) return true;
    return false;
};

export default function ValueEngineeredModal({
    isOpen, onClose, originalTables, allBrands = [], onApplyFlow, onApply,
    onUploadBoq, onUploadPlan, planPreviewUrl, planPreviewType, planPreviewName,
    seededItems
}) {
    const { aiSettings } = useCompanyProfile();
    const { theme } = useTheme();

    const [rows, setRows] = useState([]);
    const rowsRef = useRef(rows);
    useEffect(() => { rowsRef.current = rows; }, [rows]);
    const lastLoadedTablesRef = useRef(null);

    const [localBrands, setLocalBrands] = useState(allBrands || []);
    useEffect(() => {
        if (allBrands && allBrands.length > 0) {
            setLocalBrands(allBrands);
        }
    }, [allBrands]);

    const [openBrandDropdown, setOpenBrandDropdown] = useState(null);
    const [previewImage, setPreviewImage] = useState(null);
    const [previewLogo, setPreviewLogo] = useState(null);
    const [previewBrand, setPreviewBrand] = useState('');
    const [previewModel, setPreviewModel] = useState('');
    const [galleryModal, setGalleryModal] = useState({
        isOpen: false,
        images: [],
        initialIndex: 0,
        title: '',
        subtitle: '',
        brandLogo: null,
        brandName: null
    });
    const [planPreviewOpen, setPlanPreviewOpen] = useState(false);
    const [specialistData, setSpecialistData] = useState(null);
    const [enrichingRowId, setEnrichingRowId] = useState(null);
    const [isCostingOpen, setIsCostingOpen] = useState(false);
    const [costingFactors, setCostingFactors] = useState(null);

    const [isConfigOpen, setIsConfigOpen] = useState(false);
    const [brandMode, setBrandMode] = useState('simple');
    const [globalBrand, setGlobalBrand] = useState('');
    const [categoryBrands, setCategoryBrands] = useState({
        desking: '', seating: '', softSeating: '', accessories: ''
    });

    const [isDragging, setIsDragging] = useState(false);
    const boqInputRef = useRef(null);
    const planInputRef = useRef(null);

    const [isRunning, setIsRunning] = useState(false);
    const [aiStatus, setAiStatus] = useState({ active: false, status: 'idle', currentItem: null, brand: '', model: '', image: null, minimized: false });
    const [batchResult, setBatchResult] = useState(null);
    const [progress, setProgress] = useState({ current: 0, total: 0 });
    const [swarm, setSwarm] = useState(null); // { lanes: { desking: { status, currentItem, progress, brand }, ... } }
    const [pendingSeed, setPendingSeed] = useState(false);

    useEffect(() => {
        console.log(`[VE Modal] Rendered with ${localBrands?.length || 0} brands`);
        if (localBrands?.length > 0) {
            console.log('[VE Modal] Brand names sample:', localBrands.map(b => b.name).filter(Boolean).slice(0, 5), '...');
        }
    }, [localBrands, isOpen]);

    useEffect(() => {
        if (pendingSeed) {
            if (originalTables && originalTables.length > 0) {
                setRows(buildBoqRows(originalTables));
                setPendingSeed(false);
            } else if (seededItems && seededItems.length > 0) {
                const planRows = seededItems.map((item, i) => ({
                    id: Date.now() + i, sn: i + 1, imageRef: null,
                    brandImage: '', brandDesc: '', description: `[${item.location}] ${item.description}`,
                    qty: item.qty, unit: item.unit, rate: '', amount: '', basePrice: 0,
                    selectedBrand: '', selectedMainCat: '', selectedSubCat: '', selectedFamily: '', selectedModel: '', selectedModelUrl: '', aiStatus: 'idle'
                }));
                setRows(planRows);
                setPendingSeed(false);
            }
        }
    }, [originalTables, seededItems, pendingSeed]);

    const buildBoqRows = (tables) => {
        if (!tables || tables.length === 0) return [];
        const sourceTable = tables[0];
        const header = sourceTable.header || [];
        const findCol = (regex) => header.findIndex(h => h && regex.test(String(h)));

        let idxDesc = findDescColumn(header, sourceTable.rows);
        let idxQty = findCol(/^(?!.*(rate|price|amount)).*(qty|quantity)/i);
        if (idxQty === -1) idxQty = findCol(/qty|quantity/i);
        const idxUnit = findCol(/unit|uom/i);
        const idxRate = findCol(/rate|price/i);
        let idxTotal = findCol(/^(?!.*(qty|quantity)).*(total|amount)/i);
        if (idxTotal === -1) idxTotal = findCol(/amount|total/i);

        const getVal = (row, idx) => {
            if (idx === -1 || !row.cells?.[idx]) return '';
            const cell = row.cells[idx];
            if (cell.richText && Array.isArray(cell.richText)) return cell.richText.map(t => t.text || '').join('').trim();
            const v = cell.value;
            if (v === null || v === undefined) return '';
            if (typeof v === 'object') {
                if (v.text) return String(v.text).trim();       // Hyperlink
                if (v.result !== undefined) return String(v.result).trim(); // Formula
                return '';
            }
            return String(v).trim();
        };

        return sourceTable.rows.map((row, i) => {
            if (!row || !row.cells || row.isHeader || row.isSummary) return null;
            const imageRefs = cellImageUrls(row);

            let rawDesc = getVal(row, idxDesc);
            const extraParts = [];

            // If table has added specification columns (e.g. Type, Finish, Supplier, Size), append them
            if (row.cells && row.cells.length > 0) {
                row.cells.forEach((cell, cIdx) => {
                    if (cIdx !== idxDesc && cIdx !== idxQty && cIdx !== idxUnit && cIdx !== idxRate && cIdx !== idxTotal) {
                        const h = header[cIdx] || '';
                        const val = getVal(row, cIdx);
                        if (val && !['BOQ_ONLY', 'PASS', 'SPEC_NOT_MATCHED'].includes(val) && !rawDesc.toLowerCase().includes(val.toLowerCase())) {
                            if (h && !/^(sl|sn|no|image|ref)/i.test(h)) {
                                extraParts.push(`${h}: ${val}`);
                            } else if (val.startsWith('http') || val.length > 5) {
                                extraParts.push(val);
                            }
                        }
                    }
                });
            }

            if (extraParts.length > 0) {
                rawDesc = [rawDesc, ...extraParts].filter(Boolean).join(' | ');
            }

            return {
                id: Date.now() + i, sn: i + 1, imageRef: imageRefs[0] || null, imageRefs, brandImage: '', brandDesc: '',
                description: rawDesc, qty: getVal(row, idxQty), unit: getVal(row, idxUnit),
                rate: getVal(row, idxRate), amount: getVal(row, idxTotal),
                selectedBrand: '', selectedMainCat: '', selectedSubCat: '', selectedFamily: '', selectedModel: '', selectedModelUrl: '',
                basePrice: 0,
                aiStatus: 'idle'
            };
        }).filter(Boolean);
    };

    const loadDataIntoRows = () => {
        if (seededItems && seededItems.length > 0) {
            const planRows = seededItems.map((item, i) => ({
                id: Date.now() + i, sn: i + 1, imageRef: null,
                brandImage: '', brandDesc: '', description: `[${item.location}] ${item.description}`,
                qty: item.qty, unit: item.unit, rate: '', amount: '', basePrice: 0,
                selectedBrand: '', selectedMainCat: '', selectedSubCat: '', selectedFamily: '', selectedModel: '', selectedModelUrl: '', aiStatus: 'idle'
            }));
            setRows(planRows);
        } else if (originalTables && originalTables.length > 0) {
            setRows(buildBoqRows(originalTables));
        } else {
            setRows([]);
        }
    };

    useEffect(() => {
        if (!isOpen) return;
        const tablesChanged = originalTables && originalTables !== lastLoadedTablesRef.current;
        const shouldLoad = rows.length === 0 || tablesChanged;
        if (shouldLoad) {
            if ((seededItems && seededItems.length > 0) || (originalTables && originalTables.length > 0)) {
                loadDataIntoRows();
                lastLoadedTablesRef.current = originalTables;
            }
        }
    }, [isOpen, seededItems, originalTables]);

    const handleFileSelect = (files) => {
        if (!files || files.length === 0) return;
        setPendingSeed(true);
        if (onUploadBoq) onUploadBoq(files[0]);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            setPendingSeed(true);
            if (onUploadBoq) onUploadBoq(files[0]);
        }
    };

    const handleUploadBoqTrigger = () => { setPendingSeed(true); if (boqInputRef.current) boqInputRef.current.click(); };
    const handleUploadPlanTrigger = () => { setPendingSeed(true); if (planInputRef.current) planInputRef.current.click(); };

    const handleGenerateFromBoq = () => {
        if ((!originalTables || originalTables.length === 0) && (!seededItems || seededItems.length === 0)) {
            alert("No extracted data found. Please Upload a BOQ or Plan first.");
            return;
        }
        loadDataIntoRows();
    };

    const handleCreateNewBoq = () => {
        const emptyRows = Array(10).fill().map((_, i) => ({
            id: Date.now() + i, sn: i + 1, imageRef: null,
            brandImage: '', brandDesc: '', description: '', qty: '', unit: 'Nos', rate: '', amount: '', basePrice: 0,
            selectedBrand: '', selectedMainCat: '', selectedSubCat: '', selectedFamily: '', selectedModel: '', selectedModelUrl: '',
            aiStatus: 'idle'
        }));
        setRows(emptyRows);
    };

    const handleApplyCosting = (factors) => {
        setCostingFactors(factors);
        setIsCostingOpen(false);

        const updatedRows = rows.map(row => {
            if (row.basePrice && row.basePrice > 0) {
                const markup = 1 + (factors.profit + factors.freight + factors.customs + factors.installation) / 100;
                const costedPrice = row.basePrice * markup * factors.exchangeRate;
                const finalAmount = (costedPrice * (parseFloat(row.qty) || 0)).toFixed(2);
                return { ...row, rate: costedPrice.toFixed(2), amount: finalAmount };
            }
            return row;
        });

        setRows(updatedRows);

        if (onApplyFlow || onApply) {
            const formattedData = {
                costingFactors: factors,
                tables: [{
                    sheetName: `Value Engineered Offer`,
                    header: VE_TABLE_HEADER,
                    columnCount: 9,
                    rows: updatedRows.map(row => {
                        const amount = row.amount || (parseFloat(row.qty || 0) * parseFloat(row.rate || 0)).toFixed(2);
                        return {
                            cells: [
                                { value: String(row.sn || '') },
                                {
                                    value: '',
                                    image: row.brandImage || row.imageRef,
                                    images: row.brandImage ? [{ url: row.brandImage }] : (row.imageRefs?.length ? row.imageRefs : (row.imageRef ? [row.imageRef] : [])).map(u => ({ url: u }))
                                },
                                { value: row.brandDesc || row.description || 'N/A' },
                                { value: row.selectedBrand || '' },
                                { value: row.selectedModel || '' },
                                { value: String(row.qty || '0') },
                                { value: String(row.unit || 'Nos') },
                                { value: String(row.rate || '0') },
                                { value: String(isNaN(parseFloat(amount)) ? '0' : amount) }
                            ]
                        };
                    })
                }]
            };
            const applyFn = onApplyFlow || onApply;
            applyFn(formattedData);
            onClose();
        }
    };

    useEffect(() => {
        if (isOpen) {
            // Only load data automatically if we don't have any rows yet
            if (rows.length === 0) {
                loadDataIntoRows();
            }

            setCostingFactors(null);
            setIsConfigOpen(false);
            setIsRunning(false);
            setAiStatus({ active: false, status: 'idle', currentItem: null, brand: '', model: '', image: null, minimized: false });
            setBatchResult(null);
            setProgress({ current: 0, total: 0 });
            setSwarm(null);
        }
    }, [isOpen]); // Only trigger on modal open/close transitions

    if (!isOpen) return null;

    const handleVeCellChange = (rowIndex, field, value) => {
        setRows(prev => {
            const newRows = [...prev];
            const row = { ...newRows[rowIndex] };

            if (field === 'selectedBrand') {
                row.selectedBrand = value;
                row.selectedMainCat = ''; row.selectedSubCat = ''; row.selectedFamily = ''; row.selectedModel = ''; row.selectedModelUrl = ''; row.brandImage = ''; row.brandDesc = ''; row.basePrice = 0;
                const brand = localBrands.find(b => b.name === value);
                row.brandLogo = brand?.logo || '';
            } else if (field === 'selectedMainCat') {
                row.selectedMainCat = value; row.selectedSubCat = ''; row.selectedFamily = ''; row.selectedModel = ''; row.selectedModelUrl = '';
            } else if (field === 'selectedSubCat') {
                row.selectedSubCat = value; row.selectedFamily = ''; row.selectedModel = ''; row.selectedModelUrl = '';
            } else if (field === 'selectedFamily') {
                row.selectedFamily = value; row.selectedModel = ''; row.selectedModelUrl = '';
            } else if (field === 'selectedModel') {
                const { model, url } = value;
                row.selectedModel = model;
                row.selectedModelUrl = url;
                const brand = localBrands.find(b => b.name === row.selectedBrand);
                if (brand?.products) {
                    let product = brand.products.find(p => (p.productUrl && p.productUrl === url) || (p.imageUrl && p.imageUrl === url));
                    if (!product) {
                        const candidates = brand.products.filter(p =>
                            (p.normalization?.category || p.mainCategory) === row.selectedMainCat &&
                            (p.normalization?.subCategory || p.subCategory) === row.selectedSubCat &&
                            p.family === row.selectedFamily &&
                            p.model === model
                        );
                        if (candidates.length > 0) {
                            if (url && url.startsWith('model_')) {
                                const parts = url.split('_');
                                if (parts.length >= 3) {
                                    const possibleIndex = parseInt(parts[parts.length - 1]);
                                    if (!isNaN(possibleIndex) && candidates[possibleIndex]) product = candidates[possibleIndex];
                                    else product = candidates[0];
                                } else product = candidates[0];
                            } else product = candidates[0];
                        }
                    }
                    if (product) {
                        row.brandDesc = product.description || product.model;
                        row.brandImage = product.imageUrl || '';
                        const basePrice = parseFloat(product.price) || 0;
                        if (basePrice > 0) {
                            row.rate = basePrice.toFixed(2);
                            row.basePrice = basePrice;
                        }
                        const qty = parseFloat(row.qty) || 0;
                        if (qty > 0 && basePrice > 0) row.amount = (qty * basePrice).toFixed(2);
                        if (!row.unit) row.unit = 'Nos';
                    }
                }
            } else {
                row[field] = value;
                if (field === 'qty' || field === 'rate') {
                    const q = field === 'qty' ? parseFloat(value) : parseFloat(row.qty);
                    const r = field === 'rate' ? parseFloat(value) : parseFloat(row.rate);
                    if (!isNaN(q) && !isNaN(r)) {
                        row.amount = (q * r).toFixed(2);
                    }
                }
            }

            const autoSelectNextLevel = (currentRow) => {
                const activeBrand = localBrands.find(b => b.name === currentRow.selectedBrand);
                if (!activeBrand || !activeBrand.products) return;
                const brandProducts = activeBrand.products;

                if (currentRow.selectedBrand && !currentRow.selectedMainCat) {
                    const mainCats = Array.from(new Set(brandProducts.flatMap(p => [p.normalization?.category, p.mainCategory]).filter(Boolean))).filter(v => v !== 'null' && v !== 'undefined');
                    if (mainCats && mainCats.length === 1) { currentRow.selectedMainCat = mainCats[0]; autoSelectNextLevel(currentRow); return; }
                }
                if (currentRow.selectedMainCat && !currentRow.selectedSubCat) {
                    const matchingByMain = brandProducts.filter(p => (p.normalization?.category || p.mainCategory) === currentRow.selectedMainCat);
                    const subCats = Array.from(new Set(matchingByMain.flatMap(p => [p.normalization?.subCategory, p.subCategory]).filter(Boolean))).filter(v => v !== 'null' && v !== 'undefined');
                    if (subCats && subCats.length === 1) { currentRow.selectedSubCat = subCats[0]; autoSelectNextLevel(currentRow); return; }
                }
                if (currentRow.selectedSubCat && !currentRow.selectedFamily) {
                    const matchingBySub = brandProducts.filter(p => (p.normalization?.category || p.mainCategory) === currentRow.selectedMainCat && (p.normalization?.subCategory || p.subCategory) === currentRow.selectedSubCat);
                    const families = Array.from(new Set(matchingBySub.map(i => i.family).filter(Boolean))).filter(v => v !== 'null' && v !== 'undefined');
                    if (families && families.length === 1) { currentRow.selectedFamily = families[0]; autoSelectNextLevel(currentRow); return; }
                }
            };

            if (['selectedBrand', 'selectedMainCat', 'selectedSubCat', 'selectedFamily'].includes(field)) {
                autoSelectNextLevel(row);
            }

            newRows[rowIndex] = row;
            return newRows;
        });
    };

    const handleManualEnrich = async (row, index) => {
        const brandName = prompt("Enter Brand Name (e.g., Herman Miller):", row.selectedBrand || "");
        if (!brandName) return;
        const modelName = prompt("Enter Model Name (e.g., Aeron):", row.selectedModel || "");
        if (!modelName) return;

        setEnrichingRowId(row.id);
        try {
            const response = await fetch(`${API_BASE}/api/models/enrich`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ brandName, modelName, budgetTier: 'value-engineered' })
            });
            const data = await response.json();

            if (data.status === 'success' && data.product) {
                const p = data.product;
                setRows(prev => prev.map((r, i) => i === index ? {
                    ...r,
                    selectedBrand: p.brand,
                    selectedModel: p.model,
                    brandImage: p.imageUrl,
                    brandLogo: p.brandLogo || '',
                    rate: p.price > 0 ? p.price.toFixed(2) : r.rate,
                    selectedMainCat: p.mainCategory,
                    selectedSubCat: p.subCategory,
                    aiStatus: 'success',
                    aiResult: { product: p, status: 'success', brand: p.brand }
                } : r));
                alert(`Successfully enriched and saved ${p.model} to ${p.brand} database!`);
            } else {
                alert(`Enrichment failed: ${data.message || 'Product not found.'}`);
            }
        } catch (err) {
            alert(`Enrichment Error: ${err.message}`);
        } finally {
            setEnrichingRowId(null);
        }
    };

    const handleVeAddRow = (afterIndex) => {
        setRows(prev => {
            const next = [...prev];
            next.splice(afterIndex + 1, 0, { id: Date.now(), sn: afterIndex + 2, imageRef: null, brandImage: '', brandDesc: '', brandLogo: '', description: '', qty: '', unit: '', rate: '', amount: '', basePrice: 0, selectedBrand: '', selectedMainCat: '', selectedSubCat: '', selectedFamily: '', selectedModel: '', selectedModelUrl: '', aiStatus: 'idle' });
            return next.map((r, i) => ({ ...r, sn: i + 1 }));
        });
    };

    const handleVeRemoveRow = (index) => setRows(prev => prev.filter((_, i) => i !== index).map((r, i) => ({ ...r, sn: i + 1 })));

    const renderVeRow = (row, index) => {
        const activeBrand = localBrands.find(b => b.name && row.selectedBrand && b.name.toLowerCase().trim() === row.selectedBrand.toLowerCase().trim())
            || localBrands.find(b => b.name && row.selectedBrand && (b.name.toLowerCase().includes(row.selectedBrand.toLowerCase()) || row.selectedBrand.toLowerCase().includes(b.name.toLowerCase())));
        let brandProducts = activeBrand?.products ? [...activeBrand.products] : [];

        // 🌟 Ensure that whatever the row was matched with (model, categories, url) is always present in brandProducts:
        if (row.selectedModel) {
            const hasModel = brandProducts.some(p => p && p.model && p.model.toLowerCase().trim() === String(row.selectedModel).toLowerCase().trim());
            if (!hasModel) {
                brandProducts.unshift({
                    model: row.selectedModel,
                    mainCategory: row.selectedMainCat || 'Furniture',
                    subCategory: row.selectedSubCat || 'General',
                    family: row.selectedFamily || 'Standard',
                    productUrl: row.selectedModelUrl || row.brandImage || '',
                    imageUrl: row.brandImage || '',
                    description: row.brandDesc || row.selectedModel,
                    price: row.rate || row.basePrice || 0
                });
            }
        }

        const mergeUnique = (plist, key1, key2) => {
            const set = new Set();
            plist.forEach(p => {
                const v1 = key1.split('.').reduce((o, i) => o?.[i], p);
                const v2 = key2?.split('.').reduce((o, i) => o?.[i], p);
                if (v1 && v1 !== 'null' && v1 !== 'undefined') set.add(v1);
                if (v2 && v2 !== 'null' && v2 !== 'undefined') set.add(v2);
            });
            return Array.from(set).sort();
        };

        const mainCats = mergeUnique(brandProducts, 'mainCategory', 'category');
        if (row.selectedMainCat && !mainCats.some(c => c.toLowerCase().trim() === String(row.selectedMainCat).toLowerCase().trim())) {
            mainCats.push(row.selectedMainCat);
        }

        const matchingByMain = brandProducts.filter(p => {
            if (!row.selectedMainCat) return true;
            const pCat = String(p.mainCategory || p.category || p.normalization?.category || '').toLowerCase().trim();
            const rowCat = String(row.selectedMainCat).toLowerCase().trim();
            return pCat === rowCat || pCat.includes(rowCat) || rowCat.includes(pCat);
        });

        const subCats = mergeUnique(matchingByMain, 'subCategory', 'normalization.subCategory');
        if (row.selectedSubCat && !subCats.some(s => s.toLowerCase().trim() === String(row.selectedSubCat).toLowerCase().trim())) {
            subCats.push(row.selectedSubCat);
        }

        const families = Array.from(new Set(brandProducts.filter(p => {
            const pCat = String(p.mainCategory || p.category || '').toLowerCase().trim();
            const rowCat = String(row.selectedMainCat || '').toLowerCase().trim();
            const pSub = String(p.subCategory || '').toLowerCase().trim();
            const rowSub = String(row.selectedSubCat || '').toLowerCase().trim();
            const catMatch = !rowCat || pCat === rowCat || pCat.includes(rowCat) || rowCat.includes(pCat);
            const subMatch = !rowSub || pSub === rowSub || pSub.includes(rowSub) || rowSub.includes(pSub);
            return catMatch && subMatch;
        }).map(p => p.family).filter(Boolean))).sort();

        let allRawModels = brandProducts.filter(p => {
            const pCat = String(p.mainCategory || p.category || '').toLowerCase().trim();
            const rowCat = String(row.selectedMainCat || '').toLowerCase().trim();
            const pSub = String(p.subCategory || '').toLowerCase().trim();
            const rowSub = String(row.selectedSubCat || '').toLowerCase().trim();
            const catMatch = !rowCat || pCat === rowCat || pCat.includes(rowCat) || rowCat.includes(pCat);
            const subMatch = !rowSub || pSub === rowSub || pSub.includes(rowSub) || rowSub.includes(pSub);
            return catMatch && subMatch;
        });

        // If category filters are too restrictive and return 0 models, fallback to all models in brand
        if (allRawModels.length === 0 && brandProducts.length > 0) {
            allRawModels = brandProducts;
        }

        const rawModels = [];
        const seenUids = new Set();
        allRawModels.forEach(p => {
            const uid = p.productUrl || p.imageUrl || `id_${p.id || p.model || Math.random()}`;
            if (!seenUids.has(uid)) { seenUids.add(uid); rawModels.push(p); }
        });

        const modelGroups = {};
        rawModels.forEach(p => {
            const mKey = p.model || 'Standard';
            if (!modelGroups[mKey]) modelGroups[mKey] = [];
            modelGroups[mKey].push(p);
        });

        const modelOptions = [];
        Object.entries(modelGroups).forEach(([modelName, items]) => {
            items.forEach((item, i) => {
                const cat = item.subCategory || item.mainCategory || 'Misc';
                const snippet = item.description ? item.description.substring(0, 25) + '...' : `Variant ${i + 1}`;
                const uid = item.productUrl || item.imageUrl || `model_${modelName}_${i}`;
                modelOptions.push({ value: uid, label: items.length > 1 ? `[${cat}] ${modelName} (${snippet})` : `[${cat}] ${modelName}`, rawModel: modelName });
            });
        });

        if (row.selectedModel && !modelOptions.some(o => o.rawModel && o.rawModel.toLowerCase().trim() === String(row.selectedModel).toLowerCase().trim())) {
            const uid = row.selectedModelUrl || row.brandImage || `model_${row.selectedModel}`;
            modelOptions.unshift({ value: uid, label: row.selectedModel, rawModel: row.selectedModel });
        }

        const matchedMainCat = mainCats.find(c => c.toLowerCase().trim() === String(row.selectedMainCat || '').toLowerCase().trim())
            || mainCats.find(c => row.selectedMainCat && (c.toLowerCase().includes(String(row.selectedMainCat).toLowerCase()) || String(row.selectedMainCat).toLowerCase().includes(c.toLowerCase())))
            || (row.selectedMainCat || (mainCats.length === 1 ? mainCats[0] : ''));

        const matchedSubCat = subCats.find(s => s.toLowerCase().trim() === String(row.selectedSubCat || '').toLowerCase().trim())
            || subCats.find(s => row.selectedSubCat && (s.toLowerCase().includes(String(row.selectedSubCat).toLowerCase()) || String(row.selectedSubCat).toLowerCase().includes(s.toLowerCase())))
            || (row.selectedSubCat || (subCats.length === 1 ? subCats[0] : ''));

        const matchedModelOpt = modelOptions.find(o => o.value === row.selectedModelUrl)
            || modelOptions.find(o => o.rawModel && row.selectedModel && o.rawModel.toLowerCase().trim() === String(row.selectedModel).toLowerCase().trim())
            || modelOptions.find(o => o.rawModel && row.selectedModel && (o.rawModel.toLowerCase().includes(String(row.selectedModel).toLowerCase()) || String(row.selectedModel).toLowerCase().includes(o.rawModel.toLowerCase())));
        const currentModelSelectValue = matchedModelOpt ? matchedModelOpt.value : (row.selectedModelUrl || (modelOptions[0]?.value || ''));

        const rowStatusClass = row.aiStatus === 'processing' ? mbs.aiPulse : row.aiStatus === 'success' ? mbs.aiGlow : row.aiStatus === 'error' ? mbs.aiErrorBorder : '';
        const refImages = row.imageRefs?.length ? row.imageRefs : (row.imageRef ? [row.imageRef] : []);

        return (
            <tr key={row.id} className={rowStatusClass}>
                <td style={{ textAlign: 'center', verticalAlign: 'middle', minWidth: 40, fontSize: '0.78rem', color: 'var(--text-muted,#94a3b8)', fontWeight: 600 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                        {row.sn}
                        {row.aiStatus === 'success' && row.aiResult && (
                            <button
                                className={mbs.specialistBtn}
                                onClick={() => setSpecialistData(row.aiResult)}
                                title="AI Detail"
                            >
                                AI
                            </button>
                        )}
                        {row.aiStatus === 'no_match' && (
                            <button
                                className={mbs.specialistBtn}
                                style={{ backgroundColor: '#2ba4e0' }}
                                onClick={() => handleManualEnrich(row, index)}
                                disabled={enrichingRowId === row.id}
                                title="Discover Online & Harden DB"
                            >
                                {enrichingRowId === row.id ? '...' : 'Search Online'}
                            </button>
                        )}
                    </div>
                </td>
                <td style={{ verticalAlign: 'middle', minWidth: 80, textAlign: 'center' }}>
                    <MultiImageCell
                        images={refImages}
                        cellId={`ve_ref_${row.id || index}`}
                        altPrefix="Ref"
                        itemTitle={row.description || `Item #${row.sn}`}
                        size={68}
                        onImagesChange={(newImgs) => {
                            setRows(prevRows => {
                                const next = [...prevRows];
                                next[index] = {
                                    ...next[index],
                                    imageRefs: newImgs,
                                    imageRef: newImgs[0] || null
                                };
                                return next;
                            });
                        }}
                        onPreview={(imgs, targetIdx) => {
                            setGalleryModal({
                                isOpen: true,
                                images: imgs,
                                initialIndex: targetIdx,
                                title: `Reference Images (${targetIdx + 1}/${imgs.length})`,
                                subtitle: row.description || `Item #${row.sn}`,
                                rowIndex: index,
                                targetField: 'ref',
                                brandLogo: null,
                                brandName: 'Original Specification'
                            });
                        }}
                    />
                </td>
                <td style={{ verticalAlign: 'middle', minWidth: 220 }}>
                    <textarea className={mbs.cellInput} value={row.description} onChange={e => handleVeCellChange(index, 'description', e.target.value)} style={{ minHeight: 72, resize: 'vertical', width: '100%' }} />
                </td>
                <td style={{ verticalAlign: 'middle', minWidth: 80, textAlign: 'center' }}>
                    <MultiImageCell
                        images={row.brandImage ? [row.brandImage] : []}
                        singleMode={true}
                        cellId={`ve_brand_${row.id || index}`}
                        brandLogo={row.brandLogo}
                        altPrefix={row.selectedModel || "Product"}
                        itemTitle={`${row.selectedBrand || 'Brand'} ${row.selectedModel || ''}`}
                        size={68}
                        onImagesChange={(newImgs) => {
                            setRows(prevRows => {
                                const next = [...prevRows];
                                next[index] = {
                                    ...next[index],
                                    brandImage: newImgs[0] || ''
                                };
                                return next;
                            });
                        }}
                        onPreview={(imgs, targetIdx) => {
                            setGalleryModal({
                                isOpen: true,
                                images: imgs,
                                initialIndex: targetIdx,
                                title: row.selectedModel || 'Matched Product',
                                subtitle: row.brandDesc || row.description,
                                rowIndex: index,
                                targetField: 'brand',
                                brandLogo: row.brandLogo,
                                brandName: row.selectedBrand
                            });
                        }}
                    />
                </td>
                <td style={{ verticalAlign: 'middle', minWidth: 160 }}>
                    <textarea className={mbs.cellInput} value={row.brandDesc} onChange={e => handleVeCellChange(index, 'brandDesc', e.target.value)} style={{ minHeight: 72, resize: 'vertical', width: '100%' }} placeholder="Product details..." />
                </td>
                <td style={{ verticalAlign: 'middle', minWidth: 60 }}><input className={mbs.cellInput} value={row.qty} onChange={e => handleVeCellChange(index, 'qty', e.target.value)} style={{ textAlign: 'center' }} /></td>
                <td style={{ verticalAlign: 'middle', minWidth: 60 }}><input className={mbs.cellInput} value={row.unit} onChange={e => handleVeCellChange(index, 'unit', e.target.value)} /></td>
                <td style={{ verticalAlign: 'middle', minWidth: 80 }}><input className={mbs.cellInput} value={row.rate} onChange={e => handleVeCellChange(index, 'rate', e.target.value)} style={{ textAlign: 'right' }} /></td>
                <td style={{ verticalAlign: 'middle', minWidth: 90 }}>
                    <input type="text" className={mbs.cellInput} value={row.rate && parseFloat(row.rate) > 0 ? (parseFloat(row.qty || 0) * parseFloat(row.rate || 0)).toFixed(2) : (row.amount || '')} onChange={e => handleVeCellChange(index, 'amount', e.target.value)} style={{ textAlign: 'right', opacity: row.rate && parseFloat(row.rate) > 0 ? 0.7 : 1 }} disabled={!!(row.rate && parseFloat(row.rate) > 0)} placeholder="0.00" />
                </td>
                <td style={{ verticalAlign: 'middle', minWidth: 200 }}>
                    <div className={mbs.dropdownStack}>
                        <div className={mbs.brandDropdownContainer}>
                            {row.aiStatus === 'processing' ? (
                                <div className={mbs.aiLoadingCell}><div className={mbs.tinySpinner} /><span style={{ fontSize: '0.72rem' }}>AI Matching…</span></div>
                            ) : (
                                <BrandDropdown
                                    brands={localBrands.filter(b => b && b.name && !b.name.toLowerCase().includes('fitout'))}
                                    selectedBrands={row.selectedBrand}
                                    onSelect={(b) => handleVeCellChange(index, 'selectedBrand', b.name)}
                                    placeholder="Select Brand…"
                                />
                            )}
                        </div>

                        {row.selectedBrand && (
                            <select className={mbs.productSelect} value={matchedMainCat} onChange={e => handleVeCellChange(index, 'selectedMainCat', e.target.value)}>
                                <option value="">Category…</option>
                                {(mainCats || []).map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        )}
                        {(matchedMainCat || subCats.length > 0) && (
                            <select className={mbs.productSelect} value={matchedSubCat} onChange={e => handleVeCellChange(index, 'selectedSubCat', e.target.value)}>
                                <option value="">Sub-Category…</option>
                                {(subCats || []).map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        )}
                        {(matchedSubCat || modelOptions.length > 0) && (
                            <select className={mbs.productSelect} value={currentModelSelectValue} onChange={e => {
                                const opt = modelOptions.find(o => o.value === e.target.value);
                                handleVeCellChange(index, 'selectedModel', { model: opt?.rawModel || '', url: e.target.value });
                            }}>
                                <option value="">Model Variant…</option>
                                {modelOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                            </select>
                        )}
                    </div>
                </td>
                <td style={{ verticalAlign: 'middle' }}>
                    <div className={mbs.actionCell}>
                        <button className={`${mbs.actionBtn} ${mbs.addBtn}`} onClick={() => handleVeAddRow(index)}>+</button>
                        <button className={`${mbs.actionBtn} ${mbs.removeBtn}`} onClick={() => handleVeRemoveRow(index)}>×</button>
                    </div>
                </td>
            </tr>
        );
    };

    const furnitureBrands = localBrands.filter(b => !b.name?.toLowerCase().includes('fitout'));

    // ─────────────────────────────────────────────────────────────
    // MAIN EXECUTION LOGIC (Router + Swarm Parallelization)
    // ─────────────────────────────────────────────────────────────
    const executeValueEngineeredAI = async () => {
        if (isRunning) return;
        setIsConfigOpen(false);
        setIsRunning(true);
        setBatchResult(null);
        setAiStatus(prev => ({ ...prev, active: true, status: 'routing', currentItem: null, minimized: false }));

        if (rows.length === 0) { setIsRunning(false); setAiStatus(prev => ({ ...prev, active: false })); return; }

        const currentData = rows.map(r => ({ ...r, aiStatus: 'idle' }));
        setRows(currentData);

        const workableRows = currentData.filter(r => !isHeaderRow(r.description, r) && !r.isTotalRow);
        setProgress({ current: 0, total: workableRows.length });
        
        // Initialize Swarm Lanes
        const categoryKeys = brandMode === 'auto_detect' ? ['specifications'] : ['desking', 'seating', 'softSeating', 'accessories'];
        const initialLanes = {};
        for (const catKey of categoryKeys) {
            const label = catKey === 'specifications' ? 'Specification Matcher' : VE_UI_CONFIG.labels[catKey];
            const targetBrand = brandMode === 'simple' ? globalBrand : (brandMode === 'auto_detect' ? 'Auto Detected' : categoryBrands[catKey]);
            const localBrand = localBrands.find(b => b.name === targetBrand);
            initialLanes[catKey] = {
                id: catKey,
                label: label,
                status: 'idle',
                current: 0,
                total: 0,
                progress: 0,
                brand: targetBrand || 'N/A',
                brandLogo: localBrand?.logo ? getFullUrl(localBrand.logo) : '',
                currentItem: null
            };
        }
        setSwarm({ lanes: initialLanes });

        let categoryMap = null;

        // --- PHASE 1: ROUTING ---
        if (brandMode === 'advanced') {
            console.log('🚀 [VE AI] Routing items via AI Router...');
            const routingPayload = workableRows.map(r => ({ id: String(r.id), desc: r.description }));

            try {
                const endpoint = '/api/ve-route';
                const routeRes = await fetch(`${API_BASE}${endpoint}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        items: routingPayload,
                        providerModel: aiSettings?.model
                    })
                });
                const routeData = await routeRes.json();

                if (routeData.status === 'success') {
                    categoryMap = routeData.categoryMap;
                    console.log('✅ [VE AI] Category Map received:', categoryMap);

                    if (categoryMap && categoryMap.status === 'error') {
                        alert("AI Routing failed: " + categoryMap.error_message);
                        setIsRunning(false);
                        setAiStatus(prev => ({ ...prev, active: false }));
                        return;
                    }

                    // Update swarm lanes with total counts from routing
                    setSwarm(prev => {
                        const newLanes = { ...prev.lanes };
                        for (const catKey of categoryKeys) {
                            const itemIds = categoryMap[catKey] || [];
                            newLanes[catKey].total = itemIds.length;
                            newLanes[catKey].status = (itemIds.length > 0 && categoryBrands[catKey]) ? 'active' : 'idle';
                        }
                        return { ...prev, lanes: newLanes };
                    });
                }
            } catch (err) {
                console.error('❌ [VE AI] Routing failed:', err);
                alert("Network error during AI Routing.");
                setIsRunning(false);
                setAiStatus(prev => ({ ...prev, active: false }));
                return;
            }
        } else if (brandMode === 'auto_detect') {
            console.log('🚀 [VE AI] Auto Detect mode active: running Global Brand & Model Pre-Scan...');
            setAiStatus(prev => ({ ...prev, active: true, status: 'routing', currentItem: { description: 'Scanning project schedule for specified contract brands & models...' } }));
            
            try {
                const prescanPayload = workableRows.map(r => ({ id: String(r.id), description: r.description }));
                const prescanRes = await fetch(`${API_BASE}/api/ve-prescan-brands`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        items: prescanPayload,
                        providerModel: aiSettings?.model
                    })
                });
                const prescanData = await prescanRes.json();
                if (prescanData.status === 'success' && prescanData.allBrands) {
                    setLocalBrands(prescanData.allBrands);
                    console.log('✅ [VE Pre-Scan] Successfully synced', prescanData.discoveredBrands?.length || 0, 'discovered brands to catalog.');
                }
            } catch (prescanErr) {
                console.warn('⚠️ [VE Pre-Scan Warning]:', prescanErr.message);
            }

            categoryMap = { specifications: workableRows.map(r => String(r.id)), status: 'success' };
            setSwarm(prev => ({
                ...prev,
                lanes: {
                    specifications: {
                        ...prev.lanes.specifications,
                        total: workableRows.length,
                        status: workableRows.length > 0 ? 'active' : 'idle'
                    }
                }
            }));
            await sleep(400);

        } else {
            // Simple mode: lanes start as active or idle
            setSwarm(prev => {
                const newLanes = { ...prev.lanes };
                for (const catKey of categoryKeys) {
                    newLanes[catKey].status = 'idle';
                    newLanes[catKey].total = workableRows.length;
                }
                return { ...prev, lanes: newLanes };
            });
        }

        let successCount = 0, errorCount = 0;
        const rowsRefCurrent = rowsRef.current;

        // Dynamic category helper for Simple/Advanced modes
        const mapCategoryToKey = (cat) => {
            if (!cat) return 'accessories';
            const c = cat.toLowerCase();
            if (c.includes('desk') || c.includes('table') || c.includes('workstation') || c.includes('meeting') || c.includes('conference')) return 'desking';
            if (c.includes('task chair') || c.includes('executive') || c.includes('operational') || (c.includes('chair') && !c.includes('lounge') && !c.includes('armchair'))) return 'seating';
            if (c.includes('sofa') || c.includes('lounge') || c.includes('armchair') || c.includes('ottoman') || c.includes('couch')) return 'softSeating';
            return 'accessories';
        };

        // Reusable Single-Row Processor
        const processSingleRow = async (rowIndex, targetBrand, categoryScope, laneId = null) => {
            const row = rowsRef.current[rowIndex];
            if (!row || row.aiStatus === 'success') return;

            // If we don't have a laneId (simple mode), default to accessories for initial visualization
            const effectiveLaneId = laneId || (brandMode === 'auto_detect' ? 'specifications' : 'accessories');

            setSwarm(prev => ({
                ...prev,
                lanes: {
                    ...prev?.lanes,
                    [effectiveLaneId]: {
                        ...prev?.lanes?.[effectiveLaneId],
                        status: 'identifying',
                        currentItem: row,
                        brand: targetBrand
                    }
                }
            }));

            setAiStatus(prev => ({ ...prev, status: 'identifying', currentItem: row, brand: targetBrand, model: 'Matching via Search...', image: null }));
            setRows(prev => prev.map((r, i) => i === rowIndex ? { ...r, aiStatus: 'processing' } : r));

            const sizeContext = [row.qty && `Qty: ${row.qty}`, row.unit && `Unit: ${row.unit}`].filter(Boolean).join(', ');
            const enrichedDesc = sizeContext ? `${row.description} | ${sizeContext}` : row.description;

            const isAuto = brandMode === 'auto_detect';
            const payload = {
                description: enrichedDesc,
                qty: row.qty,
                unit: row.unit,
                providerModel: aiSettings?.model,
                ...(row.imageRef && isAuto ? { imageUrl: row.imageRef } : {}),
                ...(!isAuto ? { brand: targetBrand } : {}),
                ...(categoryScope && !isAuto ? { category: categoryScope } : {})
            };

            try {
                const endpoint = isAuto ? '/api/ve-match-auto' : '/api/ve-match';
                const response = await fetch(`${API_BASE}${endpoint}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await response.json();

                if (result.status === 'success' && result.product) {
                    const match = result.product;
                    const localBrand = localBrands.find(b => b.name && b.name.toLowerCase().trim() === String(match.brand || targetBrand).toLowerCase().trim())
                      || localBrands.find(b => b.name && (b.name.toLowerCase().includes(String(match.brand || targetBrand).toLowerCase()) || String(match.brand || targetBrand).toLowerCase().includes(b.name.toLowerCase())));
                    
                    const matchedBrand = localBrand ? localBrand.name : (match.brand || targetBrand);
                    let finalModel = match.model || '';
                    let finalImageUrl = match.imageUrl || '';
                    let finalBrandDesc = match.description || finalModel;
                    let finalRate = parseFloat(match.price) > 0 ? parseFloat(match.price).toFixed(2) : (row.rate || '0.00');
                    let finalBasePrice = parseFloat(match.price) || 0;

                    let resolvedMainCat = match.mainCategory || '';
                    let resolvedSubCat = match.subCategory || '';
                    let resolvedFamily = match.family || '';
                    let resolvedModelUrl = match.websiteUrl || match.productUrl || match.imageUrl || '';

                    // If local brand catalog exists, look up the exact product to sync category/variant UID
                    if (localBrand && localBrand.products && localBrand.products.length > 0) {
                        const localProd = localBrand.products.find(p => p.model && p.model.toLowerCase().trim() === finalModel.toLowerCase().trim())
                          || localBrand.products.find(p => p.model && (p.model.toLowerCase().includes(finalModel.toLowerCase()) || finalModel.toLowerCase().includes(p.model.toLowerCase())));
                        
                        if (localProd) {
                            finalModel = localProd.model || finalModel;
                            resolvedMainCat = localProd.mainCategory || localProd.category || localProd.normalization?.category || resolvedMainCat;
                            resolvedSubCat = localProd.subCategory || localProd.normalization?.subCategory || resolvedSubCat;
                            resolvedFamily = localProd.family || resolvedFamily;
                            resolvedModelUrl = localProd.productUrl || localProd.imageUrl || resolvedModelUrl;
                            finalImageUrl = localProd.imageUrl || (localProd.images && localProd.images[0]) || finalImageUrl;
                            if (localProd.description) finalBrandDesc = localProd.description;
                            if (parseFloat(finalRate) <= 0 && localProd.price > 0) {
                                finalRate = localProd.price.toFixed(2);
                                finalBasePrice = localProd.price;
                            }
                        }
                    }

                    const resolvedLaneId = effectiveLaneId;

                    setSwarm(prev => {
                        const lane = prev?.lanes?.[resolvedLaneId];
                        return {
                            ...prev,
                            lanes: {
                                ...prev?.lanes,
                                [resolvedLaneId]: {
                                    ...lane,
                                    status: 'success',
                                    model: finalModel,
                                    image: finalImageUrl,
                                    total: lane?.total || 0,
                                    progress: (lane?.total > 0 ? Math.min(100, Math.round(((lane.current + 1) / lane.total) * 100)) : 100),
                                    current: (lane?.current || 0) + 1
                                }
                            }
                        };
                    });

                    // Dynamically inject new contract brand or marketplace into localBrands if not already present
                    if (matchedBrand) {
                        setLocalBrands(prev => {
                            const bLower = matchedBrand.toLowerCase().trim();
                            const exists = prev.some(b => b && b.name && b.name.toLowerCase().trim() === bLower);
                            if (exists) {
                                return prev.map(b => {
                                    if (!b || !b.name || b.name.toLowerCase().trim() !== bLower) return b;
                                    const existingProds = b.products || [];
                                    const modelExists = existingProds.some(p => p && p.model && p.model.toLowerCase().trim() === finalModel.toLowerCase().trim());
                                    const updatedProducts = modelExists ? existingProds : [...existingProds, {
                                        model: finalModel,
                                        family: resolvedFamily || 'Collection',
                                        mainCategory: resolvedMainCat,
                                        subCategory: resolvedSubCat,
                                        imageUrl: finalImageUrl,
                                        productUrl: resolvedModelUrl,
                                        price: finalBasePrice,
                                        description: finalBrandDesc
                                    }];
                                    return {
                                        ...b,
                                        logo: b.logo || result.newBrand?.logo || match.brandLogo || '',
                                        products: updatedProducts
                                    };
                                });
                            }
                            return [...prev, {
                                id: result.newBrand?.id || Date.now(),
                                name: matchedBrand,
                                logo: result.newBrand?.logo || match.brandLogo || '',
                                budgetTier: 'mid',
                                products: [{
                                    model: finalModel,
                                    family: resolvedFamily || 'Collection',
                                    mainCategory: resolvedMainCat,
                                    subCategory: resolvedSubCat,
                                    imageUrl: finalImageUrl,
                                    productUrl: resolvedModelUrl,
                                    price: finalBasePrice,
                                    description: finalBrandDesc
                                }]
                            }];
                        });
                    }

                    setAiStatus(prev => ({ ...prev, status: 'success', brand: matchedBrand, model: finalModel, image: finalImageUrl }));
                    setRows(prev => prev.map((r, i) => i === rowIndex ? {
                        ...r,
                        selectedBrand: matchedBrand,
                        selectedMainCat: resolvedMainCat,
                        selectedSubCat: resolvedSubCat,
                        selectedFamily: resolvedFamily,
                        selectedModel: finalModel,
                        selectedModelUrl: resolvedModelUrl,
                        brandImage: finalImageUrl,
                        brandLogo: localBrand?.logo || result.newBrand?.logo || match.brandLogo || '',
                        brandDesc: finalBrandDesc || match.description || finalModel || '',
                        rate: finalRate,
                        basePrice: finalBasePrice,
                        amount: (parseFloat(finalRate) * (parseFloat(r.qty) || 0)).toFixed(2),
                        aiStatus: 'success',
                        matchTier: result.matchTier || (result.confidenceScore >= 95 ? 'EXACT_MATCH' : (result.confidenceScore >= 80 ? 'HIGH_CONFIDENCE' : 'SUGGESTED')),
                        confidenceScore: result.confidenceScore || 95,
                        evidence: result.evidence || match.evidence || null,
                        imageVerification: result.imageVerification || null,
                        aiResult: { ...result, boqDescription: r.description, brand: matchedBrand }
                    } : r));
                    successCount++;

                } else {
                    const resolvedLaneId = effectiveLaneId;
                    setSwarm(prev => {
                        const lane = prev?.lanes?.[resolvedLaneId];
                        return {
                            ...prev,
                            lanes: {
                                ...prev?.lanes,
                                [resolvedLaneId]: {
                                    ...lane,
                                    status: 'error',
                                    total: lane?.total || 0,
                                    progress: (lane?.total > 0 ? Math.min(100, Math.round(((lane.current + 1) / lane.total) * 100)) : 100),
                                    current: (lane?.current || 0) + 1
                                }
                            }
                        };
                    });
                    setRows(prev => prev.map((r, i) => i === rowIndex ? { ...r, aiStatus: result.status === 'no_match' ? 'no_match' : 'error' } : r));
                    errorCount++;
                }
            } catch (err) {
                const resolvedLaneId = effectiveLaneId;
                setSwarm(prev => {
                    const lane = prev?.lanes?.[resolvedLaneId];
                    return {
                        ...prev,
                        lanes: {
                            ...prev?.lanes,
                            [resolvedLaneId]: {
                                ...lane,
                                status: 'error',
                                total: lane?.total || 0,
                                progress: (lane?.total > 0 ? Math.min(100, Math.round(((lane.current + 1) / lane.total) * 100)) : 100),
                                current: (lane?.current || 0) + 1
                            }
                        }
                    };
                });
                setRows(prev => prev.map((r, i) => i === rowIndex ? { ...r, aiStatus: 'error' } : r));
                errorCount++;
            }
            setProgress(prev => ({ ...prev, current: prev.current + 1 }));
            await sleep(15);
        };

        // --- PHASE 2: SWARM EXECUTION ---
        if ((brandMode === 'advanced' || brandMode === 'auto_detect') && categoryMap && categoryMap.status !== 'error') {
            const swarmPromises = [];
            for (const catKey of categoryKeys) {
                const itemIds = categoryMap[catKey] || [];
                if (!itemIds || itemIds.length === 0) continue;

                const targetBrand = brandMode === 'auto_detect' ? 'Auto Detected' : categoryBrands[catKey];
                if (!targetBrand && brandMode !== 'auto_detect') continue;
                if (!targetBrand) continue;

                const stringItemIds = itemIds.map(String);
                const catWorkableIndices = workableRows
                    .filter(r => stringItemIds.includes(String(r.id)))
                    .map(r => rowsRef.current.findIndex(row => row.id === r.id))
                    .filter(idx => idx !== -1);

                if (catWorkableIndices.length > 0) {
                    const processCategoryBatch = async () => {
                        await batch(catWorkableIndices, 8, async (rowIndex) => {
                            await processSingleRow(rowIndex, targetBrand, VE_UI_CONFIG.labels[catKey], catKey);
                        });
                    };
                    swarmPromises.push(processCategoryBatch());
                }
            }

            // Run all category lanes in parallel (The Swarm)
            try {
                setAiStatus(prev => ({ ...prev, status: 'matching' }));
                await Promise.all(swarmPromises);
            } catch (err) {
                console.error("Swarm parallel execution failed:", err);
            }
        } else {
            // SIMPLE MODE (or fallback if routing failed)
            const targetBrand = globalBrand;
            if (targetBrand) {
                const workableIndices = workableRows.map(r => rowsRef.current.findIndex(row => row.id === r.id)).filter(idx => idx !== -1);
                try {
                    await batch(workableIndices, 8, async (rowIndex) => {
                        await processSingleRow(rowIndex, targetBrand, null);
                    });
                } catch (err) {
                    console.error("Simple execution failed:", err);
                }
            }
        }

        setBatchResult({ success: successCount, error: errorCount });
        setIsRunning(false);
        setAiStatus(prev => ({ ...prev, active: false }));
        setTimeout(() => setBatchResult(null), 8000);
    };

    const canStartAI = brandMode === 'auto_detect' ? true : (brandMode === 'simple' ? globalBrand !== '' : Object.values(categoryBrands).some(b => b !== ''));

    return (
        <>
            <div className={mbs.overlay}>
                <div className={`${mbs.modalContainer} ${theme === 'light' ? mbs.light : ''}`} onClick={e => e.stopPropagation()}>

                    <div className={mbs.header}>
                        <div className={mbs.title}>
                            ✨ Value Engineered Offer
                        </div>
                        <button className={mbs.closeBtn} onClick={onClose}>×</button>
                    </div>

                    <div className={mbs.content}>

                        <div className={mbs.topSection}>
                            <div className={mbs.mainActions}>
                                <button className={`${mbs.actionCard} ${mbs.uploadBoqBtn}`} onClick={handleUploadBoqTrigger}>
                                    <span style={{ fontSize: '1.4rem' }}>📤</span>
                                    <span>Upload BOQ</span>
                                </button>
                                <button className={`${mbs.actionCard} ${mbs.genBoqBtn}`} onClick={handleGenerateFromBoq}>
                                    <span style={{ fontSize: '1.4rem' }}>📋</span>
                                    <span>Generate From BOQ</span>
                                </button>
                                <button className={`${mbs.actionCard} ${mbs.genPlanBtn}`} onClick={handleUploadPlanTrigger}>
                                    <span style={{ fontSize: '1.4rem' }}>📐</span>
                                    <span>Upload Plan</span>
                                </button>
                                <button className={`${mbs.actionCard} ${mbs.createNewBtn}`} onClick={handleCreateNewBoq}>
                                    <span style={{ fontSize: '1.4rem' }}>➕</span>
                                    <span>Create New BOQ</span>
                                </button>

                                <button
                                    className={`${mbs.actionCard} ${mbs.aiAutoFillBtn} ${isRunning ? mbs.aiAutoFilling : ''}`}
                                    onClick={() => setIsConfigOpen(true)}
                                    disabled={isRunning}
                                >
                                    <span style={{ fontSize: '1.4rem' }}>✨</span>
                                    <span>
                                        {isRunning
                                            ? `AI RUNNING${progress.total > 0 ? ` (${progress.current}/${progress.total})` : '...'}`
                                            : 'AI VALUE ENGINEER'
                                        }
                                    </span>
                                </button>
                            </div>

                            <input
                                type="file"
                                ref={boqInputRef}
                                style={{ display: 'none' }}
                                accept=".xlsx,.xls,.pdf"
                                onChange={(e) => {
                                    handleFileSelect(e.target.files);
                                    e.target.value = '';
                                }}
                            />
                            <input
                                type="file"
                                ref={planInputRef}
                                style={{ display: 'none' }}
                                multiple
                                accept=".pdf,.jpg,.jpeg,.png"
                                onChange={(e) => {
                                    if (e.target.files && e.target.files.length > 0 && onUploadPlan) {
                                        setPendingSeed(true);
                                        onUploadPlan(e.target.files);
                                    }
                                    e.target.value = '';
                                }}
                            />
                        </div>

                        <div
                            className={`${mbs.tableContainer} ${isDragging ? mbs.dragging : ''}`}
                            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                            onDragLeave={() => setIsDragging(false)}
                            onDrop={handleDrop}
                        >
                            {batchResult && (
                                <div className={`${mbs.aiBatchNotification} ${batchResult.error > 0 ? mbs.aiBatchNotificationError : mbs.aiBatchNotificationSuccess}`}>
                                    <span>
                                        VE Batch Complete — <strong>{batchResult.success || 0}</strong> matched, <strong>{batchResult.error || 0}</strong> failed
                                    </span>
                                    <button className={mbs.notificationClose} onClick={() => setBatchResult(null)}>×</button>
                                </div>
                            )}

                            {rows.length > 0 ? (
                                <div className={mbs.tableScrollWrapper}>
                                    <table className={mbs.budgetTable}>
                                        <thead>
                                            <tr>
                                                <th style={{ width: '50px', textAlign: 'center' }}>Sl</th>
                                                <th style={{ width: '80px', textAlign: 'center' }}>Ref Img</th>
                                                <th style={{ width: '200px', textAlign: 'left' }}>Description</th>
                                                <th style={{ width: '80px', textAlign: 'center' }}>Brand Img</th>
                                                <th style={{ width: '200px', textAlign: 'left' }}>Brand Desc</th>
                                                <th style={{ width: '50px', textAlign: 'center' }}>Qty</th>
                                                <th style={{ width: '50px', textAlign: 'center' }}>Unit</th>
                                                <th style={{ width: '80px', textAlign: 'right' }}>Rate</th>
                                                <th style={{ width: '90px', textAlign: 'right' }}>Amount</th>
                                                <th style={{ width: '180px', textAlign: 'left' }}>Product Selection</th>
                                                <th style={{ width: '60px', textAlign: 'center' }}>Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>{rows.map((row, index) => renderVeRow(row, index))}</tbody>
                                    </table>
                                </div>
                            ) : (
                                <div style={{ flex: 1, display: 'flex', width: '100%', height: '100%', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
                                    <div style={{ fontSize: '3rem', opacity: 0.2 }}>📁</div>
                                    <div style={{ marginTop: '1rem' }}>Drag and Drop BOQ files here, or click "Upload BOQ".</div>
                                </div>
                            )}
                        </div>

                    </div>

                    <div className={mbs.footer}>
                        <button
                            className={mbs.applyCostingBtn}
                            disabled={rows.length === 0}
                            onClick={() => setIsCostingOpen(true)}
                        >
                            Apply Costing & Review
                        </button>
                    </div>
                </div>
            </div>

            {/* Premium Image Preview Overlay */}
            {previewImage && (
                <div className={mbs.previewOverlay} onClick={(e) => { e.stopPropagation(); setPreviewImage(null); setPreviewLogo(null); setPreviewBrand(null); setPreviewModel(null); }}>
                    <div className={mbs.previewContent} onClick={e => e.stopPropagation()}>
                        <div className={mbs.previewMain}>
                            <img
                                src={previewImage}
                                alt={previewModel || "Product Full View"}
                                className={mbs.previewImage}
                                onError={(e) => {
                                    e.target.src = 'https://placehold.co/600x400?text=Image+Not+Available';
                                }}
                            />
                        </div>

                        <div className={mbs.previewFooter}>
                            <div className={mbs.previewDetails} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                {previewLogo && (
                                    <img
                                        src={getFullUrl(previewLogo)}
                                        alt=""
                                        style={{ height: '24px', maxWidth: '80px', objectFit: 'contain', background: 'rgba(255,255,255,0.95)', padding: '2px 6px', borderRadius: '4px' }}
                                        onError={(e) => { e.target.style.display = 'none'; }}
                                    />
                                )}
                                <div>
                                    <div className={mbs.previewTitle}>{previewBrand || 'Product View'}</div>
                                    <div className={mbs.previewSubtitle}>{previewModel || ''}</div>
                                </div>
                            </div>
                            <button
                                className={mbs.previewCloseBtn}
                                onClick={() => { setPreviewImage(null); setPreviewLogo(null); setPreviewBrand(null); setPreviewModel(null); }}
                            >
                                <i className="ri-close-line"></i>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Plan Preview Overlay */}
            {planPreviewOpen && planPreviewUrl && (
                <div className={mbs.previewOverlay} onClick={() => setPlanPreviewOpen(false)}>
                    <div className={mbs.previewContent} onClick={e => e.stopPropagation()}>
                        <div className={mbs.previewMain}>
                            {planPreviewType === 'application/pdf' ? (
                                <object data={planPreviewUrl} type="application/pdf" className={mbs.previewImage}>
                                    <div className={mbs.previewFallback}>PDF preview unavailable</div>
                                </object>
                            ) : (
                                <img
                                    src={planPreviewUrl}
                                    alt={planPreviewName || 'Plan preview'}
                                    className={mbs.previewImage}
                                    onError={(e) => {
                                        e.target.src = 'https://placehold.co/900x600?text=Preview+Not+Available';
                                    }}
                                />
                            )}
                        </div>

                        <div className={mbs.previewFooter}>
                            <div className={mbs.previewDetails}>
                                <div className={mbs.previewTitle}>Uploaded Plan</div>
                                <div className={mbs.previewSubtitle}>{planPreviewName || ''}</div>
                            </div>
                            <button
                                className={mbs.previewCloseBtn}
                                onClick={() => setPlanPreviewOpen(false)}
                            >
                                <i className="ri-close-line"></i>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isConfigOpen && (
                <div className={afStyles.overlay} style={{ zIndex: 99999 }} onClick={() => setIsConfigOpen(false)}>
                    <div className={afStyles.modal} onClick={e => e.stopPropagation()}>
                        <div className={afStyles.header}>
                            <h2>✨ AI Value Engineer Config</h2>
                            <button className={afStyles.closeBtn} onClick={() => setIsConfigOpen(false)}>×</button>
                        </div>

                        <div className={afStyles.content}>
                            <div className={afStyles.section}>
                                <div className={afStyles.brandSectionHeader} style={{ marginBottom: '1rem' }}>
                                    <span className={afStyles.sectionTitle}>Select Target Strategy</span>
                                </div>

                                {/* Premium Auto Detect Toggle */}
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '1rem 1.2rem',
                                    borderRadius: '12px',
                                    background: brandMode === 'auto_detect' ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(168, 85, 247, 0.15) 100%)' : 'rgba(255,255,255,0.02)',
                                    border: brandMode === 'auto_detect' ? '2px solid #8b5cf6' : '1px solid rgba(255,255,255,0.1)',
                                    marginBottom: '1.5rem',
                                    cursor: 'pointer',
                                    transition: 'all 0.3s ease'
                                }} onClick={() => setBrandMode(brandMode === 'auto_detect' ? 'simple' : 'auto_detect')}>
                                    <div style={{ flex: 1, paddingRight: '1rem' }}>
                                        <div style={{ fontWeight: 700, color: brandMode === 'auto_detect' ? '#a855f7' : '#e2e8f0', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1rem' }}>
                                            🤖 Auto Detect Brand & Model
                                            {brandMode === 'auto_detect' && <span style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', color: 'white', fontSize: '0.7rem', padding: '2px 8px', borderRadius: '20px', fontWeight: 600 }}>ACTIVE</span>}
                                        </div>
                                        <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.2rem' }}>
                                            Specification/Model driven Matching: AI will dynamically extract the model and brand from the description.
                                        </div>
                                    </div>
                                    <div style={{
                                        position: 'relative',
                                        width: '48px',
                                        height: '24px',
                                        background: brandMode === 'auto_detect' ? '#8b5cf6' : 'rgba(255,255,255,0.1)',
                                        borderRadius: '12px',
                                        transition: 'all 0.3s'
                                    }}>
                                        <div style={{
                                            position: 'absolute',
                                            top: '2px',
                                            left: brandMode === 'auto_detect' ? '26px' : '2px',
                                            width: '20px',
                                            height: '20px',
                                            background: '#ffffff',
                                            borderRadius: '50%',
                                            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                                            transition: 'all 0.3s'
                                        }} />
                                    </div>
                                </div>

                                <div style={{ 
                                    display: 'flex', 
                                    gap: '1rem', 
                                    marginBottom: '1.5rem',
                                    opacity: brandMode === 'auto_detect' ? 0.4 : 1,
                                    pointerEvents: brandMode === 'auto_detect' ? 'none' : 'auto',
                                    transition: 'all 0.3s'
                                }}>
                                    <div
                                        onClick={() => setBrandMode('simple')}
                                        style={{ flex: 1, padding: '1.2rem', borderRadius: '12px', border: brandMode === 'simple' ? '2px solid #3b82f6' : '1px solid rgba(255,255,255,0.1)', background: brandMode === 'simple' ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.02)', cursor: 'pointer', transition: 'all 0.2s' }}
                                    >
                                        <div style={{ fontWeight: 600, color: brandMode === 'simple' ? '#3b82f6' : '#e2e8f0', marginBottom: '0.4rem' }}>One Brand Match</div>
                                        <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Apply a single brand globally to match all items.</div>
                                    </div>
                                    <div
                                        onClick={() => setBrandMode('advanced')}
                                        style={{ flex: 1, padding: '1.2rem', borderRadius: '12px', border: brandMode === 'advanced' ? '2px solid #8b5cf6' : '1px solid rgba(255,255,255,0.1)', background: brandMode === 'advanced' ? 'rgba(139,92,246,0.1)' : 'rgba(255,255,255,0.02)', cursor: 'pointer', transition: 'all 0.2s' }}
                                    >
                                        <div style={{ fontWeight: 600, color: brandMode === 'advanced' ? '#8b5cf6' : '#e2e8f0', marginBottom: '0.4rem' }}>Categorized Match</div>
                                        <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Assign a different brand per furniture category.</div>
                                    </div>
                                </div>

                                {brandMode === 'simple' && (
                                    <div className={afStyles.tierGroup} style={{ borderColor: '#3b82f660' }}>
                                        <div className={afStyles.tierHeader}>
                                            <div className={afStyles.tierLabel}>
                                                <span className={afStyles.tierDot} style={{ background: '#3b82f6' }} />
                                                <span style={{ color: '#3b82f6' }}>Global Brand Selection</span>
                                            </div>
                                        </div>
                                        <div style={{ padding: '0 1rem 1rem' }}>
                                            <BrandDropdown
                                                brands={furnitureBrands}
                                                selectedBrands={globalBrand}
                                                onSelect={(b) => setGlobalBrand(b.name)}
                                                placeholder="Choose Global Brand..."
                                            />
                                        </div>
                                    </div>
                                )}

                                {brandMode === 'advanced' && Object.keys(VE_UI_CONFIG.labels).map(cat => (
                                    <div key={cat} className={afStyles.tierGroup} style={{ borderColor: '#8b5cf660', marginBottom: '1rem' }}>
                                        <div className={afStyles.tierHeader}>
                                            <div className={afStyles.tierLabel}>
                                                <span className={afStyles.tierDot} style={{ background: '#8b5cf6' }} />
                                                <span style={{ color: '#8b5cf6' }}>{VE_UI_CONFIG.labels[cat]}</span>
                                                <span style={{ marginLeft: '10px', fontSize: '0.75rem', color: '#94a3b8' }}>{VE_UI_CONFIG.hints[cat]}</span>
                                            </div>
                                        </div>
                                        <div style={{ padding: '0 1rem 1rem' }}>
                                            <BrandDropdown
                                                brands={furnitureBrands}
                                                selectedBrands={categoryBrands[cat]}
                                                onSelect={(b) => setCategoryBrands(prev => ({ ...prev, [cat]: b.name }))}
                                                placeholder={`Select Brand for ${VE_UI_CONFIG.labels[cat]}...`}
                                            />
                                        </div>
                                    </div>
                                ))}

                            </div>
                        </div>

                        <div className={afStyles.footer}>
                            <button className={afStyles.btnCancel} onClick={() => setIsConfigOpen(false)}>Cancel</button>
                            <button className={afStyles.btnConfirm} disabled={!canStartAI} onClick={executeValueEngineeredAI}>
                                Start AI Match
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <CostingModal
                isOpen={isCostingOpen}
                onClose={() => setIsCostingOpen(false)}
                initialFactors={costingFactors}
                onApply={handleApplyCosting}
            />

            <SpecialistModal
                isOpen={!!specialistData}
                onClose={() => setSpecialistData(null)}
                data={specialistData}
            />

            {(() => {
                const getActiveModals = () => {
                    if (aiStatus.active) {
                        const itemType = aiStatus.currentItem?.scope?.toLowerCase().includes('fitout') ? 'fitout' : 'furniture';
                        return [{ type: itemType, status: aiStatus, progress: progress, isResult: false }];
                    }
                    if (batchResult) {
                        return [{ type: 'furniture', status: {}, batchResult: batchResult, progress: progress, isResult: true }];
                    }
                    return [];
                };

                const activeModals = getActiveModals();

                return activeModals.map((modalData, idx) => {
                    const { type, status, progress, isResult, batchResult: bRes } = modalData;
                    const alignment = 'center';
                    const minimizedOffset = 24;

                    return (
                        <AIPresentationModal
                            key={`ve-modal-${isResult ? 'result' : 'discovery'}`}
                            type={type}
                            isOpen={true}
                            onClose={() => {
                                if (isResult) setBatchResult(null);
                                else setAiStatus(prev => ({ ...prev, active: false }));
                            }}
                            tier="value-engineered"
                            alignment={alignment}
                            currentItem={status.currentItem}
                            batchResult={isResult ? bRes : null}
                            brand={status.brand}
                            foundModel={status.model}
                            foundImage={status.image}
                            progress={progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0}
                            status={status.status}
                            swarm={swarm}
                            isMinimized={status.minimized}
                            onToggleMinimize={() => setAiStatus(prev => ({ ...prev, minimized: !prev.minimized }))}
                            minimizedOffset={minimizedOffset}
                            title={brandMode === 'auto_detect' ? "Value Engineer - Auto Detect AI Active" : "Value Engineer - Category Based AI Active"}
                        />
                    );
                });
            })()}

            {galleryModal.isOpen && (
                <ImageGalleryModal
                    images={galleryModal.images}
                    initialIndex={galleryModal.initialIndex}
                    title={galleryModal.title}
                    subtitle={galleryModal.subtitle}
                    brandLogo={galleryModal.brandLogo}
                    brandName={galleryModal.brandName}
                    onRemoveImage={galleryModal.rowIndex !== undefined && galleryModal.rowIndex !== null ? (removedIdx) => {
                        const rowIdx = galleryModal.rowIndex;
                        const isRef = galleryModal.targetField === 'ref';
                        const currentImgs = (Array.isArray(galleryModal.images) ? galleryModal.images : [galleryModal.images])
                            .map(img => (typeof img === 'string' ? img : (img?.url || img?.data || img?.src || '')))
                            .filter(Boolean);
                        const updated = currentImgs.filter((_, idx) => idx !== removedIdx);

                        setRows(prevRows => {
                            const next = [...prevRows];
                            if (isRef) {
                                next[rowIdx] = {
                                    ...next[rowIdx],
                                    imageRefs: updated,
                                    imageRef: updated[0] || null
                                };
                            } else {
                                next[rowIdx] = {
                                    ...next[rowIdx],
                                    brandImage: updated[0] || ''
                                };
                            }
                            return next;
                        });
                        setGalleryModal(prev => ({ ...prev, images: updated }));
                    } : null}
                    onClose={() => setGalleryModal(prev => ({ ...prev, isOpen: false }))}
                />
            )}
        </>
    );
}