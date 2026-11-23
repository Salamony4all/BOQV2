import React, { useState, useEffect, useRef, Fragment } from 'react';
import AddBrandModal from './AddBrandModal';
import CostingModal from './CostingModal';
import SpecialistModal from './SpecialistModal';
import AutoFillSelectModal from './AutoFillSelectModal';
import FitoutAutoFillModal from './FitoutAutoFillModal';
import PlanAnalyzerModal from './PlanAnalyzerModal';
import AIPresentationModal from './AIPresentationModal';
import AIFitoutPresentationModal from './AIFitoutPresentationModal';
import styles from '../styles/MultiBudgetModal.module.css';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import BrandDropdown from './BrandDropdown';
import MultiImageCell from './MultiImageCell';
import ImageGalleryModal from './ImageGalleryModal';
import DesignBuildButton from './DesignBuildButton';
import { findDescColumn, cellImageUrls } from '../utils/boqUtils';
import {
    recategorizeBoqRows,
    resolveSectionDividerMeta,
    drawPdfCategoryDividerPage,
    addPptxCategoryDividerSlide
} from '../utils/boqGroupingUtils';
import {
    FURNITURE_SET_TYPES,
    createEmptySetComponent,
    computeSetParentRollup,
    getSetTypeMeta,
    buildSetComponentMatchQuery,
    convertRowToSet,
    isSystemSetType,
    isMatchedSetItem,
    describeSetItemPrice,
    hasSingleAlternative,
    applySetPlanToRow,
    refreshRowSetPlan,
    summarizeSetOption,
    activateSetOption,
    revertSetToSingle,
    dismissSetOption,
    changeRowSetType,
    withSetOptionItems,
    applyCostingToRowAlternates,
    reidRowSetState
} from '../utils/furnitureSetUtils';

import { useCompanyProfile } from '../context/CompanyContext';
import { useTheme } from '../context/ThemeContext';
import { fixArabic, hasArabic, loadArabicFont } from '../utils/arabicPdfUtils';
import { getApiBase } from '../utils/apiBase';
import { getFullUrl, loadExportImageData } from '../utils/urlUtils';
import { exportRfqByBrandFromTierRows } from '../utils/rfqExportUtils';
import { getBrandColors } from '../utils/themeConfig';
import PlanPreview from './PlanPreview';
import { isPdfPlan } from '../utils/planPicture';

const API_BASE = getApiBase();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const batch = async (items, limit, fn) => {
    for (let i = 0; i < items.length; i += limit) {
        const chunk = items.slice(i, i + limit);
        await Promise.all(chunk.map(fn));
    }
};

class Queue {
    constructor(concurrency = 1) {
        this.concurrency = concurrency;
        this.running = 0;
        this.tasks = [];
    }
    async add(task) {
        return new Promise((resolve, reject) => {
            this.tasks.push(async () => {
                try {
                    const res = await task();
                    resolve(res);
                } catch (e) {
                    reject(e);
                } finally {
                    this.running--;
                    this.next();
                }
            });
            this.next();
        });
    }
    next() {
        while (this.running < this.concurrency && this.tasks.length > 0) {
            this.running++;
            const task = this.tasks.shift();
            task();
        }
    }
}

const globalConcurrencyLimit = 8;
let activeRequests = 0;
const requestQueue = [];

const requestSemaphore = () => {
    if (activeRequests < globalConcurrencyLimit) {
        activeRequests++;
        return Promise.resolve();
    }
    return new Promise(resolve => {
        requestQueue.push(resolve);
    });
};

const releaseSemaphore = () => {
    activeRequests--;
    if (requestQueue.length > 0) {
        activeRequests++;
        const next = requestQueue.shift();
        next();
    }
};

export default function MultiBudgetModal({ isOpen, onClose, originalTables, onApplyFlow, seededItems = null, onUploadBoq, onUploadPlan, planPreviewUrl = null, planPreviewType = null, planPreviewName = null, onOpenValueEngineer }) {
    const profile = useCompanyProfile();
    const { theme } = useTheme();
    const { companyName, logoWhite, logoOriginal, logoBlue, website, updateProfile, processLogoFile, accentColor, secondaryColor, aiSettings } = profile;
    const [activeTier, setActiveTier] = useState('mid');
    const [previewImage, setPreviewImage] = useState(null);
    const [previewLogo, setPreviewLogo] = useState(null);
    const [previewBrand, setPreviewBrand] = useState(null);
    const [previewModel, setPreviewModel] = useState(null);
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
    const [isFurnitureAutoFilling, setIsFurnitureAutoFilling] = useState(false);
    const [isFitoutAutoFilling, setIsFitoutAutoFilling] = useState(false);
    const [isAutoFillSelectOpen, setIsAutoFillSelectOpen] = useState(false);
    const [isFitoutAutoFillOpen, setIsFitoutAutoFillOpen] = useState(false);
    const [furnitureProgress, setFurnitureProgress] = useState({
        budgetary: { current: 0, total: 0 },
        mid: { current: 0, total: 0 },
        high: { current: 0, total: 0 }
    });
    const [fitoutProgress, setFitoutProgress] = useState({
        budgetary: { current: 0, total: 0 },
        mid: { current: 0, total: 0 },
        high: { current: 0, total: 0 }
    });
    const [furnitureBatchResult, setFurnitureBatchResult] = useState(null);
    const [fitoutBatchResult, setFitoutBatchResult] = useState(null);

    const [isPlanAnalyzerOpen, setIsPlanAnalyzerOpen] = useState(false);
    const [isConsolidated, setIsConsolidated] = useState(false);
    const [recategorizeMode, setRecategorizeMode] = useState('original');
    const [matchingSetRowId, setMatchingSetRowId] = useState(null);
    const [setExportMode, setSetExportMode] = useState('lump_sum');
    const [exportSetOptions, setExportSetOptions] = useState(false);
    const [matchingOptionRowId, setMatchingOptionRowId] = useState(null);

    // Applies the set plan to a loaded row: workstations / L-shape desks / folding-table groups become
    // active sets, a single conference / meeting table gets its "set of folding tables" option.
    const attachAutoSetMeta = (baseRow) => applySetPlanToRow(baseRow);
    // One copy of the loaded rows per budget tier, each with its own row / component ids
    const buildTierCopies = (rowsToCopy) => ({
        budgetary: { rows: rowsToCopy.map(r => reidRowSetState(r, r.id + 0)), mode: 'boq' },
        mid: { rows: rowsToCopy.map(r => reidRowSetState(r, r.id + 100000)), mode: 'boq' },
        high: { rows: rowsToCopy.map(r => reidRowSetState(r, r.id + 200000)), mode: 'boq' }
    });
    const [specialistData, setSpecialistData] = useState(null);
    const [enrichingRowId, setEnrichingRowId] = useState(null);
    const [lastAISettings, setLastAISettings] = useState({ brands: [], engine: 'OpenAI', providerModel: null, selectionMode: 'standard', brandsMap: null });
    const [swarm, setSwarm] = useState({
        active: false,
        lanes: {},
        minimized: false
    });

    const isMounted = useRef(true);
    useEffect(() => {
        isMounted.current = true;
        return () => { isMounted.current = false; };
    }, []);

    const VE_UI_CONFIG = {
        desking: { label: 'Desking Agent', color: '#3b82f6', icon: '' },
        seating: { label: 'Seating Agent', color: '#10b981', icon: '' },
        softSeating: { label: 'Soft Seating Agent', color: '#8b5cf6', icon: '' },
        accessories: { label: 'Accessories Agent', color: '#f59e0b', icon: '' }
    };

    const [furnitureStatuses, setFurnitureStatuses] = useState({
        budgetary: { active: false, status: 'idle', currentItem: null, brand: '', model: '', image: null, minimized: false },
        mid: { active: false, status: 'idle', currentItem: null, brand: '', model: '', image: null, minimized: false },
        high: { active: false, status: 'idle', currentItem: null, brand: '', model: '', image: null, minimized: false }
    });
    const [fitoutStatuses, setFitoutStatuses] = useState({
        budgetary: { active: false, status: 'idle', currentItem: null, brand: '', model: '', image: null, minimized: false },
        mid: { active: false, status: 'idle', currentItem: null, brand: '', model: '', image: null, minimized: false },
        high: { active: false, status: 'idle', currentItem: null, brand: '', model: '', image: null, minimized: false }
    });

    const updateFurnitureStatus = (tier, delta) => {
        setFurnitureStatuses(prev => ({ ...prev, [tier]: { ...prev[tier], ...delta } }));
    };
    const updateFitoutStatus = (tier, delta) => {
        setFitoutStatuses(prev => ({ ...prev, [tier]: { ...prev[tier], ...delta } }));
    };

    const [tierData, setTierData] = useState({
        budgetary: null,
        mid: null,
        high: null
    });

    const [pendingSeedTier, setPendingSeedTier] = useState(null);

    useEffect(() => {
        if (seededItems && seededItems.length > 0) {
            const newRows = seededItems.map((item, i) => {
                const rawDesc = String(item.description || item.Description || '').replace(/^(\s*\[[^\]]+\]\s*)+/, '').trim();
                const loc = item.location || item.Location || 'General';
                const code = item.code || '';

                return attachAutoSetMeta({
                    id: Date.now() + i,
                    sn: i + 1,
                    imageRef: null,
                    brandImage: '', brandDesc: '',
                    description: rawDesc,
                    code: code,
                    location: loc,
                    scope: item.scope || item.Scope || '',
                    categoryHint: item.categoryHint || '',
                    qty: item.qty || item.QTY,
                    unit: item.unit || item.Unit || 'Nos',
                    rate: '',
                    amount: '',
                    selectedBrand: '', selectedMainCat: '', selectedSubCat: '', selectedFamily: '', selectedModel: ''
                });
            });

            setRecategorizeMode('item');
            setTierData(buildTierCopies(newRows));
        }
    }, [seededItems]);

    useEffect(() => {
        if (pendingSeedTier && originalTables && originalTables.length > 0) {
            const rows = buildBoqRows(originalTables);
            setRecategorizeMode(originalTables[0]?.recategorizeMode || 'original');
            setTierData(prev => ({
                ...prev,
                [pendingSeedTier]: { rows, mode: 'boq' }
            }));
            setPendingSeedTier(null);
        }
    }, [originalTables, pendingSeedTier]);

    const tierDataRef = useRef(tierData);
    useEffect(() => { tierDataRef.current = tierData; }, [tierData]);

    const [brands, setBrands] = useState([]);
    const [isAddBrandOpen, setIsAddBrandOpen] = useState(false);
    const [openBrandDropdown, setOpenBrandDropdown] = useState(null);

    const boqInputRef = useRef(null);
    const planInputRef = useRef(null);

    const [isCostingOpen, setIsCostingOpen] = useState(false);
    const [costingFactors, setCostingFactors] = useState({
        profit: 0,
        freight: 0,
        customs: 0,
        installation: 0,
        vat: 5,
        fromCurrency: 'USD',
        toCurrency: 'OMR',
        exchangeRate: 0.385
    });

    const isHeaderRow = (desc, row = {}) => {
        if (!desc || desc.trim() === '') return true;
        const normalized = desc.trim().toLowerCase();
        if (/^\[.*?\]/.test(normalized)) return false;
        const hasData = String(row.qty || '').trim() || String(row.unit || '').trim() || String(row.rate || '').trim();
        if (hasData) return false;
        const exactHeaders = ['item', 'description', 'desc', 'quantity', 'qty', 'unit', 'uom', 'rate', 'price', 'total', 'amount', 's.n.', 'sn', 'sr.no', 'sr no', 'id', 'ref', 'area', 'specification', 'specifications', 'remarks', 'location', 'description and area', 'description & area', 'room', 'floor', 'block', 'zone', 'subtotal', 'total amount', 'grand total', 'net total', 'discount'];
        if (exactHeaders.some(kw => normalized === kw || normalized.startsWith(kw + ' '))) return true;
        if (/^(location|area|floor|block|zone|room|item\s*no|s\.no|ref)$/i.test(normalized)) return true;
        if (/^(group|type|section|category|list)\s+of\s/i.test(normalized)) return true;
        return false;
    };

    const normalizeBrandName = (name) => {
        const clean = String(name || '').replace(/\s+/g, ' ').trim();
        return clean || 'Unnamed Brand';
    };

    const fetchBrands = () => {
        fetch(`${API_BASE}/api/brands`)
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) {
                    const cleaned = data.map(brand => ({ ...brand, name: normalizeBrandName(brand.name) }));
                    setBrands(cleaned);
                    setTierData(prev => {
                        const newState = { ...prev };
                        ['budgetary', 'mid', 'high'].forEach(tierName => {
                            const tier = newState[tierName];
                            if (tier && tier.rows) {
                                const newRows = tier.rows.map(row => {
                                    if (row.selectedBrand && row.selectedModel) {
                                        const brand = cleaned.find(b => b.name === row.selectedBrand);
                                        if (brand && brand.products) {
                                            let product = brand.products.find(p =>
                                                (p.productUrl && p.productUrl === row.selectedModelUrl) ||
                                                (p.model === row.selectedModel && p.productUrl === row.selectedModelUrl) ||
                                                (p.model === row.selectedModel)
                                            );
                                            const currentRate = parseFloat(row.rate || 0);
                                            if (product && parseFloat(product.price) > 0 && currentRate === 0) {
                                                const basePrice = parseFloat(product.price);
                                                const updatedRow = { ...row, rate: basePrice.toFixed(2), basePrice: basePrice };
                                                if (!updatedRow.brandDesc && product.description) {
                                                    updatedRow.brandDesc = product.description;
                                                }
                                                return updatedRow;
                                            }
                                        }
                                    }
                                    return row;
                                });
                                newState[tierName] = { ...tier, rows: newRows };
                            }
                        });
                        return newState;
                    });
                }
            })
            .catch(err => console.error('Failed to load brands', err));
    };

    useEffect(() => { fetchBrands(); }, []);
    if (!isOpen) return null;

    const findCol = (header, regex) => {
        if (!header) return -1;
        return header.findIndex(h => h && regex.test(String(h)));
    };

    const buildBoqRows = (tables = originalTables) => {
        if (!tables || tables.length === 0) return [];
        const sourceTable = tables[0];
        const header = sourceTable.header || [];
        let idxDesc = findDescColumn(header, sourceTable.rows);
        let idxQty = findCol(header, /^(?!.*(rate|price|amount)).*(qty|quantity)/i);
        if (idxQty === -1) idxQty = findCol(header, /qty|quantity/i);
        const idxUnit = findCol(header, /unit|uom/i);
        const idxRate = findCol(header, /rate|price/i);
        let idxScope = findCol(header, /^scope$/i);
        if (idxScope === -1) idxScope = findCol(header, /scope|category|trade/i);
        const idxLoc = findCol(header, /^(location|room|zone|area)$/i);
        let idxTotal = findCol(header, /^(?!.*(qty|quantity)).*(total|amount)/i);
        if (idxTotal === -1) idxTotal = findCol(header, /amount|total/i);

        return sourceTable.rows.map((row, i) => {
            const getVal = (idx) => {
                if (idx === -1 || !row.cells[idx]) return '';
                const cell = row.cells[idx];
                if (cell.richText && Array.isArray(cell.richText)) return cell.richText.map(t => t.text || '').join('').trim();
                const v = cell.value;
                if (v === null || v === undefined) return '';
                if (typeof v === 'object') {
                    if (v.text) return String(v.text).trim();
                    if (v.result !== undefined) return String(v.result).trim();
                    return '';
                }
                return String(v).trim();
            };
            const imageRefs = cellImageUrls(row);
            const rawDesc = String(getVal(idxDesc) || (idxDesc === -1 ? row.cells[1]?.value : '') || '')
                .replace(/^(\s*\[[^\]]+\]\s*)+/, '')
                .trim();
            const locVal = getVal(idxLoc);
            return attachAutoSetMeta({
                id: Date.now() + i,
                sn: i + 1,
                imageRef: imageRefs[0] || null,
                imageRefs,
                brandImage: '', brandDesc: '',
                scope: getVal(idxScope) || 'Furniture',
                location: locVal || '',
                description: rawDesc,
                qty: getVal(idxQty),
                unit: getVal(idxUnit),
                rate: getVal(idxRate),
                amount: getVal(idxTotal),
                selectedBrand: '', selectedMainCat: '', selectedSubCat: '', selectedFamily: '', selectedModel: ''
            });
        });
    };

    const handleGenerateFromBoq = () => {
        if (!originalTables || originalTables.length === 0) {
            alert("No extracted BOQ data found. Please Upload BOQ first.");
            return;
        }
        setRecategorizeMode(originalTables[0]?.recategorizeMode || 'original');
        setTierData(prev => ({ ...prev, [activeTier]: { rows: buildBoqRows(originalTables), mode: 'boq' } }));
    };

    const handleUploadBoqTrigger = () => { setPendingSeedTier(activeTier); if (boqInputRef.current) boqInputRef.current.click(); };
    const handleUploadPlanTrigger = () => { if (planInputRef.current) planInputRef.current.click(); };

    const handleCreateNewBoq = () => {
        const emptyRows = Array(10).fill().map((_, i) => ({
            id: Date.now() + i, sn: i + 1, imageRef: null, brandImage: '', brandImages: [], brandDesc: '', description: '', qty: '', unit: '', rate: '', amount: '',
            selectedBrand: '', selectedMainCat: '', selectedSubCat: '', selectedFamily: '', selectedModel: '',
            setType: 'single', setItems: [], setExpanded: false
        }));
        setRecategorizeMode('original');
        setTierData(prev => ({ ...prev, [activeTier]: { rows: emptyRows, mode: 'new' } }));
    };

    const handleAddBrand = () => setIsAddBrandOpen(true);
    const handleBrandAdded = (newBrand) => setBrands(prev => [...prev, newBrand]);

    const handlePlanApplied = (planItems) => {
        if (!planItems || planItems.length === 0) return;
        const newRows = planItems.map((item, i) => attachAutoSetMeta({
            id: Date.now() + i, sn: i + 1, imageRef: null, brandImage: '', brandDesc: '',
            description: String(item.description || '').replace(/^(\s*\[[^\]]+\]\s*)+/, '').trim(), location: item.location || '', code: item.code || '', scope: item.scope || '', qty: item.qty, unit: item.unit || 'Nos', rate: '', amount: '', selectedBrand: '', selectedMainCat: '', selectedSubCat: '', selectedFamily: '', selectedModel: ''
        }));
        setRecategorizeMode('item');
        setTierData(buildTierCopies(newRows));
    };

    const handleManualEnrich = async (row, index, tierKey = activeTier) => {
        const targetTier = tierKey || activeTier;
        const brandName = prompt("Enter Brand Name (e.g., Herman Miller):", row.selectedBrand || "");
        if (!brandName) return;
        const modelName = prompt("Enter Model Name (e.g., Aeron):", row.selectedModel || "");
        if (!modelName) return;

        setEnrichingRowId(row.id);
        try {
            const response = await fetch(`${API_BASE}/api/models/enrich`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ brandName, modelName, budgetTier: targetTier })
            });
            const data = await response.json();

            if (data.status === 'success' && data.product) {
                const p = data.product;
                setTierData(prev => {
                    const tier = prev[targetTier];
                    if (!tier || !tier.rows) return prev;
                    const newRows = tier.rows.map((r, i) => i === index ? {
                        ...r,
                        selectedBrand: p.brand || brandName,
                        selectedModel: p.model || modelName,
                        selectedModelUrl: p.productUrl || r.selectedModelUrl || '',
                        brandImage: p.imageUrl || r.brandImage || '',
                        brandLogo: p.brandLogo || r.brandLogo || '',
                        brandDesc: p.description || r.brandDesc || '',
                        rate: p.price > 0 ? Number(p.price).toFixed(2) : r.rate,
                        basePrice: p.price > 0 ? Number(p.price) : r.basePrice,
                        selectedMainCat: p.mainCategory || r.selectedMainCat || '',
                        selectedSubCat: p.subCategory || r.selectedSubCat || '',
                        aiStatus: 'success',
                        aiResult: { product: p, status: 'success', brand: p.brand || brandName }
                    } : r);
                    return { ...prev, [targetTier]: { ...tier, rows: newRows } };
                });
                fetchBrands();
                alert(`Successfully enriched and saved ${p.model || modelName} to ${p.brand || brandName} database!`);
            } else {
                alert(`Enrichment failed: ${data.message || 'Product not found.'}`);
            }
        } catch (err) {
            alert(`Enrichment Error: ${err.message}`);
        } finally {
            setEnrichingRowId(null);
        }
    };

    const getUniqueValues = (items, keyPath) => {
        if (!items || items.length === 0) return [];
        const results = [...new Set(items.map(i => {
            const parts = keyPath.split('.');
            let val = i;
            for (const part of parts) { val = val?.[part]; }
            return val;
        }).filter(Boolean))];
        return results;
    };

    // Map displayed table order (under active Recategorize mode: Item wise or Room wise) back to raw tier row indices
    const getDisplayOrderedIndices = (tierRows, predicate) => {
        const ordered = recategorizeBoqRows(tierRows || [], recategorizeMode);
        const idToIndex = new Map((tierRows || []).map((r, i) => [String(r.id), i]));
        return ordered
            .map(r => idToIndex.get(String(r.id)))
            .filter(i => i !== undefined && predicate(tierRows[i], i));
    };

    const handleAutoFillAI = () => {
        const anyTierHasRows = ['budgetary', 'mid', 'high'].some(k => tierData[k]?.rows?.length > 0);
        if (!anyTierHasRows) {
            const rows = buildBoqRows();
            if (!rows.length) { console.warn("No data available to auto-fill."); return; }
            setTierData({
                budgetary: { rows: rows.map(r => ({ ...r, id: r.id + 0 })), mode: 'boq' },
                mid: { rows: rows.map(r => ({ ...r, id: r.id + 100000 })), mode: 'boq' },
                high: { rows: rows.map(r => ({ ...r, id: r.id + 200000 })), mode: 'boq' }
            });
        } else {
            const rows = buildBoqRows();
            setTierData(prev => ({
                budgetary: prev.budgetary?.rows?.length ? prev.budgetary : { rows: rows.map(r => ({ ...r, id: r.id + 0 })), mode: 'boq' },
                mid: prev.mid?.rows?.length ? prev.mid : { rows: rows.map(r => ({ ...r, id: r.id + 100000 })), mode: 'boq' },
                high: prev.high?.rows?.length ? prev.high : { rows: rows.map(r => ({ ...r, id: r.id + 200000 })), mode: 'boq' }
            }));
        }
        setIsAutoFillSelectOpen(true);
    };

    const handleFitoutAutoFill = () => setIsFitoutAutoFillOpen(true);

    const executeFitoutAutoFillAI = async (availableBrands, selectedEngine, providerModel = null) => {
        setIsFitoutAutoFillOpen(false);
        setIsFitoutAutoFilling(true);
        setFitoutBatchResult(null);

        const tierKeys = ['budgetary', 'mid', 'high'].filter(k => {
            const hasRows = tierDataRef.current[k]?.rows?.length > 0;
            const hasBrands = availableBrands.some(s => s.endsWith(`|${k}`));
            return hasRows && hasBrands;
        });
        if (tierKeys.length > 1) setActiveTier('comparison');

        let globalStats = { success: 0, error: 0, newlyAdded: 0 };
        const matchCache = new Map();

        const processRow = async (tierKey, rowIndex) => {
            const row = tierDataRef.current[tierKey].rows[rowIndex];
            if (!row || !row.scope?.toUpperCase().includes('FITOUT') || isHeaderRow(row.description, row) || row.selectedBrand) return;
            const rowId = String(row.id);
            updateFitoutStatus(tierKey, { currentItem: row, status: 'identifying', brand: '...', model: 'Matching Fitout...', image: null });

            setTierData(prev => {
                const updatedRows = [...prev[tierKey].rows];
                updatedRows[rowIndex] = { ...updatedRows[rowIndex], aiStatus: 'processing' };
                return { ...prev, [tierKey]: { ...prev[tierKey], rows: updatedRows } };
            });

            try {
                const cleanDesc = (row.description || '').replace(/^\[.*?\]\s*/, '').trim();
                let product = null;
                let newlyAdded = false;
                let currentMatchData = null;

                if (matchCache.has(cleanDesc)) {
                    currentMatchData = matchCache.get(cleanDesc);
                    product = currentMatchData.product;
                    newlyAdded = !!currentMatchData.newlyAdded;
                } else {
                    const brandsForThisTier = availableBrands.filter(s => s.endsWith(`|${tierKey}`)).map(s => s.split('|')[0]);
                    if (brandsForThisTier.length === 0) {
                        setTierData(prev => ({ ...prev, [tierKey]: { ...prev[tierKey], rows: prev[tierKey].rows.map(r => String(r.id) === rowId ? { ...r, aiStatus: null } : r) } }));
                        return;
                    }
                    const response = await fetch(`${API_BASE}/api/auto-match-ai`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ description: cleanDesc, qty: row.qty, unit: row.unit, tier: tierKey, availableBrands: brandsForThisTier, provider: selectedEngine, providerModel, scope: 'Fitout', type: 'fitout' })
                    });
                    currentMatchData = await response.json();
                    if (currentMatchData.status === 'success' && currentMatchData.product) {
                        product = currentMatchData.product;
                        newlyAdded = !!currentMatchData.newlyAdded;
                        matchCache.set(cleanDesc, currentMatchData);
                    }
                }

                if (product) {
                    const finalPrice = Math.ceil(parseFloat(product.price || 0));
                    updateFitoutStatus(tierKey, { status: 'success', brand: product.brand || 'FitOut V2', model: product.model || '', image: product.imageUrl || row.imageRef || null });
                    setTierData(prev => {
                        const next = { ...prev };
                        const updatedRow = { selectedBrand: product.brand || 'FitOut V2', brandDesc: product.description || product.model, brandImage: product.imageUrl || row.imageRef || row.brandImage, selectedModel: product.model, selectedMainCat: product.mainCategory || product.category || 'Partition Wall', selectedSubCat: product.subCategory || 'full height partition wall', selectedFamily: product.family || 'Element', type: 'fitout', rate: finalPrice, aiStatus: 'success', aiResult: currentMatchData };
                        if (next[tierKey]) { next[tierKey].rows = next[tierKey].rows.map((r, idx) => idx === rowIndex ? { ...r, ...updatedRow, amount: r.qty ? (parseFloat(r.qty) * finalPrice) : finalPrice } : r); }
                        [tierKey].forEach(tKey => {
                            if (!next[tKey]) return;
                            next[tKey].rows = next[tKey].rows.map((r) => {
                                const otherClean = (r.description || '').replace(/^\[.*?\]\s*/, '').trim();
                                if (otherClean === cleanDesc && !r.selectedBrand) return { ...r, ...updatedRow, amount: r.qty ? (parseFloat(r.qty) * finalPrice) : finalPrice };
                                return r;
                            });
                        });
                        return next;
                    });
                    globalStats.success++;
                    if (newlyAdded) globalStats.newlyAdded++;
                } else {
                    const newStatus = currentMatchData?.status === 'no_match' ? 'no_match' : 'error';
                    globalStats.error++;
                    updateFitoutStatus(tierKey, { status: newStatus });
                    setTierData(prev => ({ ...prev, [tierKey]: { ...prev[tierKey], rows: prev[tierKey].rows.map(r => String(r.id) === rowId ? { ...r, aiStatus: newStatus, aiError: currentMatchData?.message } : r) } }));
                }
            } catch (e) {
                updateFitoutStatus(tierKey, { status: 'error' });
                globalStats.error++;
                setTierData(prev => ({ ...prev, [tierKey]: { ...prev[tierKey], rows: prev[tierKey].rows.map(r => String(r.id) === rowId ? { ...r, aiStatus: 'error', aiError: e.message } : r) } }));
            }
            setFitoutProgress(prev => ({ ...prev, [tierKey]: { ...prev[tierKey], current: prev[tierKey].current + 1 } }));
            await sleep(1000);
        };

        const processTier = async (tierKey) => {
            updateFitoutStatus(tierKey, { active: true, minimized: false });
            const rows = tierDataRef.current[tierKey].rows || [];
            const workableIndices = getDisplayOrderedIndices(
                rows,
                (r) => r.scope?.toUpperCase().includes('FITOUT') && !isHeaderRow(r.description, r) && !r.selectedBrand
            );
            setFitoutProgress(prev => ({ ...prev, [tierKey]: { current: 0, total: workableIndices.length } }));
            await batch(workableIndices, 3, (idx) => processRow(tierKey, idx));
            updateFitoutStatus(tierKey, { active: false });
        };

        try {
            await Promise.all(tierKeys.map(k => processTier(k)));
            setFitoutBatchResult({ success: globalStats.success, error: globalStats.error, newlyAdded: globalStats.newlyAdded });
        } catch (error) {
            setFitoutBatchResult({ error: 1 });
        } finally {
            setIsFitoutAutoFilling(false);
            setTimeout(() => setFitoutBatchResult(null), 8000);
        }
    };

    /**
     * Merges a backend /api/auto-match-ai product match with any richer local catalog fields
     * without letting unverified or shorter local stubs clobber live website images/descriptions.
     */
    const hydrateMatchedProduct = (result, row) => {
        const match = result.product;
        const matchedBrandName = match.brand || '';
        const localBrandEntry = brands.find(b => b.name && b.name.toLowerCase().trim() === matchedBrandName.toLowerCase().trim());
        const resolvedLogo = match.brandLogo || localBrandEntry?.logo || '';

        let finalBrandDesc = match.description || (match.model ? `Model: ${match.model}` : row.description);
        let finalMainCat = match.mainCategory || 'Office Seating';
        let finalSubCat = String(match.subCategory || 'Staff Chairs');
        let finalFamily = String(match.family || '');
        let finalModel = match.model || '';
        let finalImageUrl = match.imageUrl || '';
        let finalRate = parseFloat(match.price) > 0 ? parseFloat(match.price).toFixed(2) : (row.rate || '0.00');
        let resolvedModelUrl = match.bestModelUrl || match.productUrl || match.websiteUrl || finalImageUrl || '';

        if (localBrandEntry && localBrandEntry.products) {
            const products = localBrandEntry.products;
            const normalize = (s) => String(s || '').toLowerCase().replace(/#\d+/g, '').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
            const target = normalize(finalModel);
            const isSeatTarget = /\b(chair|seating|stool|sofa|armchair)\b/i.test(`${finalMainCat} ${finalSubCat} ${finalModel} ${row.description}`);
            const isDeskTarget = /\b(desk|table|workstation)\b/i.test(`${finalMainCat} ${finalSubCat} ${finalModel} ${row.description}`) && !isSeatTarget;

            const exactMatches = products.filter(p => normalize(p.model) === target);
            const fallbackMatches = exactMatches.length > 0 ? exactMatches : products.filter(p => {
                const nm = normalize(p.model);
                if (!nm || !target) return false;
                if (!(nm.includes(target) || target.includes(nm))) return false;
                const pText = `${p.model || ''} ${p.subCategory || ''} ${p.mainCategory || ''}`.toLowerCase();
                if (isSeatTarget && /\b(desk|table)\b/i.test(pText) && !/\bchair\b/i.test(pText)) return false;
                if (isDeskTarget && /\b(chair|seating|stool)\b/i.test(pText) && !/\b(desk|table)\b/i.test(pText)) return false;
                return true;
            });

            if (fallbackMatches.length > 0) {
                const ranked = fallbackMatches.sort((a, b) => ((b.verified ? 1 : 0) - (a.verified ? 1 : 0)) || ((parseFloat(b.price) || 0) - (parseFloat(a.price) || 0)));
                const bestP = ranked[0];
                finalMainCat = bestP.mainCategory || bestP.category || finalMainCat;
                finalSubCat = bestP.subCategory || finalSubCat;
                finalFamily = finalFamily || bestP.family || '';
                finalModel = bestP.model;
                if (!finalImageUrl && bestP.imageUrl) finalImageUrl = bestP.imageUrl;
                if (parseFloat(finalRate) <= 0 && parseFloat(bestP.price) > 0) finalRate = parseFloat(bestP.price).toFixed(2);
                if (bestP.description && (!finalBrandDesc || bestP.description.length > finalBrandDesc.length)) {
                    finalBrandDesc = bestP.description;
                }
                resolvedModelUrl = bestP.productUrl || bestP.websiteUrl || bestP.imageUrl || resolvedModelUrl || `id_${bestP.id}`;
            }
        }

        if (matchedBrandName && finalModel) {
            setBrands(prev => prev.map(b => {
                if (!b || !b.name || b.name.toLowerCase().trim() !== matchedBrandName.toLowerCase().trim()) return b;
                const existing = b.products || [];
                const mLow = finalModel.toLowerCase().trim();
                const idx = existing.findIndex(p => p && p.model && p.model.toLowerCase().trim() === mLow);
                const nextProd = {
                    model: finalModel,
                    family: finalFamily || 'Collection',
                    mainCategory: finalMainCat,
                    subCategory: finalSubCat,
                    imageUrl: finalImageUrl,
                    productUrl: resolvedModelUrl,
                    price: parseFloat(finalRate) || 0,
                    description: finalBrandDesc
                };
                const updatedProds = idx === -1
                    ? [...existing, nextProd]
                    : existing.map((p, k) => k !== idx ? p : {
                        ...p,
                        imageUrl: finalImageUrl || p.imageUrl || '',
                        productUrl: resolvedModelUrl || p.productUrl || '',
                        price: (parseFloat(finalRate) > 0) ? parseFloat(finalRate) : (p.price || 0),
                        description: finalBrandDesc || p.description || ''
                    });
                return { ...b, logo: resolvedLogo || b.logo || '', products: updatedProds };
            }));
        }

        const basePrice = parseFloat(finalRate) || 0;
        const updatedRow = {
            ...row,
            selectedBrand: matchedBrandName,
            selectedMainCat: finalMainCat,
            selectedSubCat: finalSubCat,
            selectedFamily: finalFamily,
            selectedModel: finalModel,
            selectedModelUrl: resolvedModelUrl,
            brandDesc: finalBrandDesc,
            brandImage: finalImageUrl,
            brandLogo: resolvedLogo,
            type: 'furniture',
            rate: finalRate,
            basePrice,
            amount: (basePrice * (parseFloat(row.qty) || 0)).toFixed(2),
            aiStatus: 'success',
            aiResult: result
        };

        return { updatedRow, matchedBrandName, resolvedLogo, finalModel, finalImageUrl };
    };

    // Brands a tier may use: the last AI selection for that tier, otherwise every furniture brand of the tier
    const getTierBrandNames = (tierKey) => {
        const map = lastAISettings.brandsMap;
        if (lastAISettings.selectionMode === 'standard' && map && !Array.isArray(map) && map[tierKey]) {
            return [map[tierKey]];
        }
        const tierOf = (b) => {
            const t = String(b?.budgetTier || 'mid').toLowerCase();
            return (t === 'high' || t === 'premium') ? 'high' : t === 'budgetary' ? 'budgetary' : 'mid';
        };
        const tierBrands = brands
            .filter(b => b && b.name && b.type !== 'fitout' && !/fitout/i.test(b.name) && tierOf(b) === tierKey)
            .map(b => b.name);
        const selected = (lastAISettings.brands || []).filter(name => tierBrands.includes(name));
        return selected.length > 0 ? selected : tierBrands;
    };

    // Turns one component returned by the system set matcher into a set item
    const buildSetItemFromSystemMatch = (product, sub) => {
        if (product.includedInSystem) {
            // Accessory included in the anchor system: no price of its own (never double-counted), no duplicate photo
            return {
                ...sub,
                selectedBrand: product.brand || '',
                selectedMainCat: product.mainCategory || '',
                selectedSubCat: product.subCategory || '',
                selectedFamily: product.family || '',
                selectedModel: product.model || '',
                selectedModelUrl: product.productUrl || product.websiteUrl || '',
                brandDesc: product.description || product.model || '',
                brandImage: '',
                brandLogo: product.brandLogo || '',
                type: 'furniture',
                rate: '0.00',
                basePrice: 0,
                amount: '0.00',
                aiStatus: 'success',
                aiResult: { status: 'success', product, source: product.matchSource }
            };
        }
        const { updatedRow } = hydrateMatchedProduct({ status: 'success', product, source: product.matchSource }, sub);
        // A cluster product ("Cluster of 4") covers several positions: use the unit count the matcher suggests
        const suggestedQty = parseFloat(product.suggestedQty);
        if (suggestedQty > 0) {
            updatedRow.qty = String(suggestedQty);
            updatedRow.amount = ((parseFloat(updatedRow.basePrice) || 0) * suggestedQty).toFixed(2);
        }
        return { ...updatedRow, aiStatus: 'success' };
    };

    // Resolves a system set (workstation / L-shape desk / folding-table set / conference set) as ONE
    // same-manufacturer system through the backend matcher. Runs OUTSIDE React state updaters and returns
    // the matched components plus the indices that still need a per-component match.
    const resolveSystemSetItems = async ({ parentDescription, items, targetBrand = '', preferredBrand = '', isAuto = true, availableBrands = null, providerModel = null, catalogOnly = false }) => {
        try {
            const res = await fetch(`${API_BASE}/api/ve-match-workstation-set`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    parentDescription,
                    components: items.map(it => ({
                        label: it.label,
                        description: it.description,
                        componentRole: it.componentRole,
                        seatCount: it.seatCount,
                        qty: it.qty,
                        unit: it.unit
                    })),
                    targetBrand,
                    preferredBrand,
                    isAuto,
                    availableBrands,
                    providerModel,
                    catalogOnly
                })
            });
            const data = await res.json();
            if (data.status !== 'success' || !Array.isArray(data.components)) return null;
            const resolvedMap = new Map();
            const unresolvedIndices = [];
            items.forEach((it, idx) => {
                const entry = data.components[idx];
                if (entry && entry.status === 'success' && entry.product) {
                    resolvedMap.set(idx, buildSetItemFromSystemMatch(entry.product, it));
                } else {
                    unresolvedIndices.push(idx);
                }
            });
            return { anchorBrand: data.anchorBrand || '', resolvedMap, unresolvedIndices };
        } catch (err) {
            console.warn('[MultiBudget] System set matcher fallback:', err.message);
            return null;
        }
    };

    // Matches the set alternative of a single-item row ("set of N folding tables" below a conference table)
    // from the tier's brand catalogs. The single-item match of the row is left untouched.
    const matchSetOptionForTier = async (tierKey, rowId, { option = null, description = '', targetBrand = '', preferredBrand = '', isAuto = true, availableBrands = null, providerModel = null } = {}) => {
        const liveRow = tierDataRef.current[tierKey]?.rows?.find(r => String(r.id) === String(rowId));
        const workingOption = option || liveRow?.setOption;
        if (!workingOption || !Array.isArray(workingOption.items) || workingOption.items.length === 0) return false;

        const isSetNow = (r) => Boolean(r.setType && r.setType !== 'single');
        const patchRow = (updater) => setTierData(prev => {
            const curTier = prev[tierKey];
            if (!curTier) return prev;
            return { ...prev, [tierKey]: { ...curTier, rows: curTier.rows.map(r => (String(r.id) === String(rowId) ? updater(r) : r)) } };
        });

        patchRow(r => (isSetNow(r) ? r : withSetOptionItems(
            { ...r, setOption: r.setOption || workingOption },
            (r.setOption || workingOption).items.map(it => ({ ...it, aiStatus: 'processing' }))
        )));

        const resolved = await resolveSystemSetItems({
            parentDescription: description || liveRow?.description || '',
            items: workingOption.items,
            targetBrand,
            preferredBrand: preferredBrand || liveRow?.selectedBrand || '',
            isAuto,
            availableBrands,
            providerModel,
            catalogOnly: true
        });
        if (!isMounted?.current) return false;

        patchRow(r => {
            if (isSetNow(r)) return r; // the user switched to the set while it was being matched
            const base = r.setOption || workingOption;
            const nextItems = base.items.map((it, idx) => (
                resolved && resolved.resolvedMap.has(idx)
                    ? { ...resolved.resolvedMap.get(idx), id: it.id }
                    : { ...it, aiStatus: isMatchedSetItem(it) ? 'success' : 'no_match' }
            ));
            return withSetOptionItems({ ...r, setOption: base }, nextItems);
        });
        return Boolean(resolved && resolved.resolvedMap.size > 0);
    };

    const executeAutoFillAI = async (selectedBrandsOrMap, selectedEngine, providerModel = null, selectionMode = 'standard') => {
        setIsAutoFillSelectOpen(false);
        setIsFurnitureAutoFilling(true);
        setFurnitureBatchResult(null);

        const brandsArray = Array.isArray(selectedBrandsOrMap) ? selectedBrandsOrMap : Object.values(selectedBrandsOrMap).filter(Boolean);
        setLastAISettings({ brands: brandsArray, engine: selectedEngine, providerModel, selectionMode, brandsMap: selectedBrandsOrMap });

        const brandsByTier = { budgetary: [], mid: [], high: [] };
        
        // If selectionMode is standard and we received a map (from our updated AutoFillSelectModal),
        // we use the map's tier assignments directly.
        if (selectionMode === 'standard' && !Array.isArray(selectedBrandsOrMap)) {
            Object.entries(selectedBrandsOrMap).forEach(([tier, bName]) => {
                if (bName && (tier === 'budgetary' || tier === 'mid' || tier === 'high')) {
                    brandsByTier[tier] = [bName];
                }
            });
        } else {
            // Fallback for arrays or other modes (like categorized)
            for (const brandName of brandsArray) {
                const dbEntry = brands.find(b => b.name === brandName);
                const t = (dbEntry?.budgetTier || 'mid').toLowerCase();
                const key = (t === 'high' || t === 'premium') ? 'high' : t === 'budgetary' ? 'budgetary' : 'mid';
                brandsByTier[key].push(brandName);
            }
        }

        const tierKeys = ['budgetary', 'mid', 'high'].filter(k => brandsByTier[k].length > 0 && tierDataRef.current[k]?.rows?.length > 0);
        if (tierKeys.length === 0) { setIsFurnitureAutoFilling(false); return; }

        if (tierKeys.length > 1) { setActiveTier('comparison'); } else { setActiveTier(tierKeys[0]); }

        let globalStats = { success: 0, error: 0, newlyAdded: 0 };
        const queue = new Queue(8);

        // --- PHASE 1: ROUTER ---
        let categoryMap = null;
        const firstTierRows = tierDataRef.current[tierKeys[0]].rows;
        const workableRows = firstTierRows.filter(r => !isHeaderRow(r.description, r) && (!r.scope || !r.scope.toUpperCase().includes('FITOUT')) && r.aiStatus !== 'success');

        if (selectionMode === 'categorized' && workableRows.length > 0) {
            console.log(' [MB AI] Routing items via AI Router...');
            const routingPayload = workableRows.map(r => ({ id: String(r.id), desc: r.description }));

            const getInitialLogo = (cat) => {
                const bName = selectedBrandsOrMap[cat];
                if (!bName) return '';
                const b = brands.find(brand => brand.name === bName);
                return b?.logo ? getFullUrl(b.logo) : '';
            };

            setSwarm({
                active: true, status: 'routing',
                lanes: {
                    desking: { ...VE_UI_CONFIG.desking, id: 'desking', status: 'idle', progress: 0, currentItem: 'Warming up...', brandLogo: getInitialLogo('desking'), brand: selectedBrandsOrMap['desking'] },
                    seating: { ...VE_UI_CONFIG.seating, id: 'seating', status: 'idle', progress: 0, currentItem: 'Warming up...', brandLogo: getInitialLogo('seating'), brand: selectedBrandsOrMap['seating'] },
                    softSeating: { ...VE_UI_CONFIG.softSeating, id: 'softSeating', status: 'idle', progress: 0, currentItem: 'Warming up...', brandLogo: getInitialLogo('softSeating'), brand: selectedBrandsOrMap['softSeating'] },
                    accessories: { ...VE_UI_CONFIG.accessories, id: 'accessories', status: 'idle', progress: 0, currentItem: 'Warming up...', brandLogo: getInitialLogo('accessories'), brand: selectedBrandsOrMap['accessories'] }
                }
            });

            try {
                const routeRes = await fetch(`${API_BASE}/api/ve-route`, { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify({ 
                        items: routingPayload,
                        providerModel
                    }) 
                });
                const routeData = await routeRes.json();
                if (routeData.status === 'success' && routeData.categoryMap?.status !== 'error') {
                    categoryMap = routeData.categoryMap;
                } else {
                    console.error(' [MB AI] Routing failed:', routeData.categoryMap?.error_message);
                    alert("AI Routing failed: " + (routeData.categoryMap?.error_message || "Unknown error"));
                    setIsFurnitureAutoFilling(false);
                    setSwarm({ active: false, lanes: {}, minimized: false });
                    return;
                }
            } catch (err) {
                console.error(' [MB AI] Routing fetch failed:', err);
                alert("Network error during AI Routing.");
                setIsFurnitureAutoFilling(false);
                setSwarm({ active: false, lanes: {}, minimized: false });
                return;
            }
        }

        // --- SINGLE ROW PROCESSOR ---
        const processSingleRow = async (tierKey, rowIndex, activeBrandsForCall, laneId = null) => {
            if (!isMounted?.current) return;
            const row = tierDataRef.current[tierKey].rows[rowIndex];
            if (!row || row.aiStatus === 'success') return;

            await queue.add(async () => {
                if (!isMounted?.current) return;
                await requestSemaphore();

                try {
                    if (laneId) { setSwarm(prev => ({ ...prev, lanes: { ...prev?.lanes, [laneId]: { ...prev?.lanes?.[laneId], status: 'identifying', currentItem: row.description, tier: tierKey } } })); }
                    updateFurnitureStatus(tierKey, { currentItem: row, status: 'identifying', brand: '...', model: 'Finding match...', image: null });
                    setTierData(prev => {
                        const updatedRows = [...prev[tierKey].rows];
                        updatedRows[rowIndex] = { ...updatedRows[rowIndex], aiStatus: 'processing' };
                        return { ...prev, [tierKey]: { ...prev[tierKey], rows: updatedRows } };
                    });

                    // ── FURNITURE SET / WORKSTATION / L-SHAPE DESK / FOLDING CONFERENCE DECOMPOSED MATCHING ──
                    // Re-evaluate the set plan so descriptions typed or edited after loading are recognised:
                    // active sets are matched as sets, single conference tables keep their folding-set option.
                    const plannedRow = refreshRowSetPlan(row);
                    const workingSetType = plannedRow.setType || 'single';
                    const workingSetItems = Array.isArray(plannedRow.setItems) ? plannedRow.setItems : [];
                    const plannedOption = (workingSetType === 'single' && plannedRow.setOption?.items?.length > 0) ? plannedRow.setOption : null;
                    const singleBrandTarget = selectionMode === 'single' && Array.isArray(activeBrandsForCall) && activeBrandsForCall.length === 1 ? activeBrandsForCall[0] : '';

                    if (workingSetType && workingSetType !== 'single' && workingSetItems.length > 0) {
                        const setMeta = getSetTypeMeta(workingSetType);
                        const subIndices = workingSetItems.map((_, idx) => idx);
                        let subMatched = 0;
                        let lastBrand = '';
                        let lastLogo = '';
                        let lastModel = '';
                        let lastImage = '';

                        setTierData(prev => {
                            const updatedRows = [...prev[tierKey].rows];
                            updatedRows[rowIndex] = {
                                ...plannedRow,
                                aiStatus: 'processing',
                                setItems: workingSetItems.map(it => ({ ...it, aiStatus: 'processing' }))
                            };
                            return { ...prev, [tierKey]: { ...prev[tierKey], rows: updatedRows } };
                        });

                        let remainingIndices = [...subIndices];
                        if (isSystemSetType(workingSetType)) {
                            // Resolved OUTSIDE the state updater so the unresolved components and the
                            // anchor brand are known before the per-component fallback starts.
                            const sysResolved = await resolveSystemSetItems({
                                parentDescription: row.description,
                                items: workingSetItems,
                                targetBrand: singleBrandTarget,
                                isAuto: selectionMode !== 'single',
                                availableBrands: activeBrandsForCall,
                                providerModel
                            });
                            if (sysResolved && isMounted?.current) {
                                sysResolved.resolvedMap.forEach((item) => {
                                    subMatched++;
                                    lastBrand = item.selectedBrand || lastBrand;
                                    lastLogo = item.brandLogo || lastLogo;
                                    lastModel = item.selectedModel || lastModel;
                                    lastImage = item.brandImage || lastImage;
                                });
                                if (sysResolved.anchorBrand) lastBrand = sysResolved.anchorBrand;
                                setTierData(prev => {
                                    const curTier = prev[tierKey];
                                    if (!curTier) return prev;
                                    const nextRows = curTier.rows.map(r => {
                                        if (String(r.id) !== String(row.id)) return r;
                                        const baseItems = (r.setItems && r.setItems.length > 0) ? r.setItems : workingSetItems;
                                        const nextItems = baseItems.map((it, idx) => (sysResolved.resolvedMap.has(idx) ? sysResolved.resolvedMap.get(idx) : it));
                                        return computeSetParentRollup({ ...r, setType: workingSetType }, nextItems);
                                    });
                                    return { ...prev, [tierKey]: { ...curTier, rows: nextRows } };
                                });
                                remainingIndices = sysResolved.unresolvedIndices;
                            }
                        }

                        // Lock ONE single manufacturer across all components of this set (Anchor Brand from workstation or first matched component)
                        let lockedSetBrand = lastBrand || singleBrandTarget;

                        const runMultiBudgetSubMatch = async (sIdx) => {
                            // The ref can lag one render behind the state update above: fall back to the planned components
                            const liveRow = tierDataRef.current[tierKey]?.rows?.[rowIndex];
                            const liveParent = liveRow?.setItems?.[sIdx] ? liveRow : { ...plannedRow, setItems: workingSetItems };
                            const sub = liveParent?.setItems?.[sIdx];
                            if (!sub || !isMounted?.current) return;
                            const queryDesc = buildSetComponentMatchQuery(sub, liveParent, setMeta);
                            if (!queryDesc) return;
                            const subSizeCtx = [sub.qty && `Qty: ${sub.qty}`, sub.unit && `Unit: ${sub.unit}`].filter(Boolean).join(', ');
                            const subEnrichedDesc = subSizeCtx ? `${queryDesc} | ${subSizeCtx}` : queryDesc;
                            const hasInheritedBrand = /\b(?:supplier|brand)\s*:/i.test(queryDesc);
                            const scopedBrands = lockedSetBrand ? [lockedSetBrand] : activeBrandsForCall;

                            try {
                                const subRes = await fetch(`${API_BASE}${lockedSetBrand ? '/api/ve-match' : (hasInheritedBrand ? '/api/ve-match-auto' : '/api/auto-match-ai')}`, {
                                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(lockedSetBrand ? {
                                        description: subEnrichedDesc,
                                        qty: sub.qty || '1',
                                        unit: sub.unit || 'Nos',
                                        brand: lockedSetBrand,
                                        tier: tierKey,
                                        providerModel
                                    } : hasInheritedBrand ? {
                                        description: subEnrichedDesc,
                                        qty: sub.qty || '1',
                                        unit: sub.unit || 'Nos',
                                        tier: tierKey,
                                        providerModel
                                    } : {
                                        description: subEnrichedDesc,
                                        tier: tierKey,
                                        availableBrands: scopedBrands,
                                        brandCategoryRules: selectionMode === 'categorized' ? selectedBrandsOrMap : null,
                                        provider: selectedEngine,
                                        providerModel,
                                        scope: row.scope,
                                        type: 'furniture'
                                    })
                                });
                                const subData = await subRes.json();
                                if (!isMounted?.current) return;

                                if (subData.status === 'success' && subData.product) {
                                    if (subData.source === 'ai-discovery-hardened') globalStats.newlyAdded++;
                                    const { updatedRow: hydratedSub, matchedBrandName, resolvedLogo, finalModel, finalImageUrl } = hydrateMatchedProduct(subData, sub);
                                    subMatched++;
                                    if (!lockedSetBrand && matchedBrandName) lockedSetBrand = matchedBrandName;
                                    lastBrand = matchedBrandName;
                                    lastLogo = resolvedLogo;
                                    lastModel = finalModel;
                                    lastImage = finalImageUrl;

                                    setTierData(prev => {
                                        const curTier = prev[tierKey];
                                        if (!curTier) return prev;
                                        const nextRows = curTier.rows.map(r => {
                                            if (String(r.id) !== String(row.id)) return r;
                                            const nextItems = (r.setItems || []).map((it, idx) => idx === sIdx ? { ...it, ...hydratedSub, aiStatus: 'success' } : it);
                                            return computeSetParentRollup(r, nextItems);
                                        });
                                        return { ...prev, [tierKey]: { ...curTier, rows: nextRows } };
                                    });
                                } else {
                                    setTierData(prev => {
                                        const curTier = prev[tierKey];
                                        if (!curTier) return prev;
                                        const nextRows = curTier.rows.map(r => {
                                            if (String(r.id) !== String(row.id)) return r;
                                            const nextItems = (r.setItems || []).map((it, idx) => idx === sIdx ? { ...it, aiStatus: subData.status === 'no_match' ? 'no_match' : 'error' } : it);
                                            return computeSetParentRollup(r, nextItems);
                                        });
                                        return { ...prev, [tierKey]: { ...curTier, rows: nextRows } };
                                    });
                                }
                            } catch {
                                setTierData(prev => {
                                    const curTier = prev[tierKey];
                                    if (!curTier) return prev;
                                    const nextRows = curTier.rows.map(r => {
                                        if (String(r.id) !== String(row.id)) return r;
                                        const nextItems = (r.setItems || []).map((it, idx) => idx === sIdx ? { ...it, aiStatus: 'error' } : it);
                                        return computeSetParentRollup(r, nextItems);
                                    });
                                    return { ...prev, [tierKey]: { ...curTier, rows: nextRows } };
                                });
                            }
                        };

                        // Match Component 0 first when brand isn't locked yet so remaining components stay strictly from the SAME manufacturer
                        if (!lockedSetBrand && remainingIndices.length > 1) {
                            const firstIdx = remainingIndices.shift();
                            await runMultiBudgetSubMatch(firstIdx);
                        }
                        await batch(remainingIndices, 3, runMultiBudgetSubMatch);

                        if (subMatched > 0) {
                            updateFurnitureStatus(tierKey, { status: 'success', brand: lastBrand || setMeta.label, model: `${setMeta.shortLabel} (${subMatched}/${subIndices.length})`, image: lastImage || null });
                            if (laneId) {
                                setSwarm(prev => {
                                    const lane = prev?.lanes?.[laneId];
                                    if (!lane) return prev;
                                    const newCurrent = (lane.current || 0) + 1;
                                    return { ...prev, lanes: { ...prev?.lanes, [laneId]: { ...lane, status: 'ready', brand: lastBrand || setMeta.label, brandLogo: lastLogo ? getFullUrl(lastLogo) : '', model: `${setMeta.shortLabel} (${subMatched}/${subIndices.length})`, image: lastImage, progress: lane.total > 0 ? Math.min(100, Math.round((newCurrent / lane.total) * 100)) : 100, current: newCurrent } } };
                                });
                            }
                            globalStats.success++;
                        } else {
                            updateFurnitureStatus(tierKey, { status: 'error' });
                            globalStats.error++;
                        }
                        return;
                    }

                    // Single item with a set alternative detected just now: show its option below the row
                    if (plannedOption && plannedOption !== row.setOption) {
                        setTierData(prev => ({ ...prev, [tierKey]: { ...prev[tierKey], rows: prev[tierKey].rows.map(r => String(r.id) === String(row.id) ? { ...r, setOption: plannedOption } : r) } }));
                    }
                    // Additional option below the single item (e.g. set of folding tables), same manufacturer preferred
                    const runOptionMatch = async (preferredBrand = '') => {
                        if (!plannedOption) return;
                        try {
                            await matchSetOptionForTier(tierKey, row.id, {
                                option: plannedOption,
                                description: row.description,
                                targetBrand: singleBrandTarget,
                                preferredBrand,
                                isAuto: selectionMode !== 'single',
                                availableBrands: activeBrandsForCall,
                                providerModel
                            });
                        } catch (optErr) {
                            console.warn('[MultiBudget] Set option match skipped:', optErr.message);
                        }
                    };

                    const sizeContext = [row.qty && `Qty: ${row.qty}`, row.unit && `Unit: ${row.unit}`].filter(Boolean).join(', ');
                    const enrichedDesc = sizeContext ? `${row.description} | ${sizeContext}` : row.description;

                    const response = await fetch(`${API_BASE}/api/auto-match-ai`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ description: enrichedDesc, tier: tierKey, availableBrands: activeBrandsForCall, brandCategoryRules: selectionMode === 'categorized' ? selectedBrandsOrMap : null, provider: selectedEngine, providerModel, scope: row.scope, type: 'furniture' })
                    });
                    const result = await response.json();

                    if (!isMounted?.current) return;

                    if (result.status === 'success' && result.product) {
                        if (result.source === 'ai-discovery-hardened') globalStats.newlyAdded++;
                        const { updatedRow, matchedBrandName, resolvedLogo, finalModel, finalImageUrl } = hydrateMatchedProduct(result, plannedRow);
                        updateFurnitureStatus(tierKey, { status: 'success', brand: matchedBrandName, model: finalModel, image: finalImageUrl || null });
                        setTierData(prev => ({ ...prev, [tierKey]: { ...prev[tierKey], rows: prev[tierKey].rows.map(r => String(r.id) === String(row.id) ? updatedRow : r) } }));

                        if (laneId) {
                            setSwarm(prev => {
                                const lane = prev?.lanes?.[laneId];
                                if (!lane) return prev;
                                const newCurrent = (lane.current || 0) + 1;
                                return { ...prev, lanes: { ...prev?.lanes, [laneId]: { ...lane, status: 'ready', brand: matchedBrandName, brandLogo: resolvedLogo ? getFullUrl(resolvedLogo) : '', model: finalModel, image: finalImageUrl, progress: lane.total > 0 ? Math.min(100, Math.round((newCurrent / lane.total) * 100)) : 100, current: newCurrent } } };
                            });
                        }
                        globalStats.success++;
                        await runOptionMatch(matchedBrandName);
                    } else {
                        const newStatus = result.status === 'no_match' ? 'no_match' : 'error';
                        updateFurnitureStatus(tierKey, { status: newStatus });
                        setTierData(prev => ({ ...prev, [tierKey]: { ...prev[tierKey], rows: prev[tierKey].rows.map(r => String(r.id) === String(row.id) ? { ...r, aiStatus: newStatus, aiError: result.message } : r) } }));
                        if (laneId) {
                            setSwarm(prev => {
                                const lane = prev?.lanes?.[laneId];
                                if (!lane) return prev;
                                const newCurrent = (lane.current || 0) + 1;
                                return { ...prev, lanes: { ...prev?.lanes, [laneId]: { ...lane, status: 'error', progress: lane.total > 0 ? Math.min(100, Math.round((newCurrent / lane.total) * 100)) : 100, current: newCurrent } } };
                            });
                        }
                        globalStats.error++;
                        await runOptionMatch();
                    }
                } catch (error) {
                    console.error("Row processing error:", error);
                    updateFurnitureStatus(tierKey, { status: 'error' });
                    setTierData(prev => ({ ...prev, [tierKey]: { ...prev[tierKey], rows: prev[tierKey].rows.map(r => String(r.id) === String(row.id) ? { ...r, aiStatus: 'error', aiError: error.message } : r) } }));
                    if (laneId) {
                        setSwarm(prev => {
                            const lane = prev?.lanes?.[laneId];
                            if (!lane) return prev;
                            const newCurrent = (lane.current || 0) + 1;
                            return { ...prev, lanes: { ...prev?.lanes, [laneId]: { ...lane, status: 'error', current: newCurrent } } };
                        });
                    }
                    globalStats.error++;
                } finally {
                    releaseSemaphore();
                    setFurnitureProgress(prev => ({ ...prev, [tierKey]: { ...prev[tierKey], current: prev[tierKey].current + 1 } }));
                    await sleep(25);
                }
            });
        };

        // --- PHASE 2: SWARM EXECUTION ---
        const swarmPromises = [];

        if (selectionMode === 'categorized' && categoryMap && categoryMap.status !== 'error') {
            const activeLanes = {};
            const categoryKeys = ['desking', 'seating', 'softSeating', 'accessories'];

            categoryKeys.forEach(catKey => {
                const itemIds = categoryMap[catKey] || [];
                if (itemIds.length === 0) return;
                const targetBrand = selectedBrandsOrMap[catKey];
                if (!targetBrand) return;

                const stringItemIds = itemIds.map(String);
                let laneTotalItems = 0;

                tierKeys.forEach(tierKey => {
                    if (brandsByTier[tierKey].includes(targetBrand)) {
                        const tierWorkableIndices = workableRows.map(r => tierDataRef.current[tierKey].rows.findIndex(row => row.id === r.id));
                        laneTotalItems += tierWorkableIndices.filter(idx => idx !== -1 && stringItemIds.includes(String(tierDataRef.current[tierKey].rows[idx].id))).length;
                    }
                });

                if (laneTotalItems > 0) {
                    const localBrand = brands.find(b => b.name === targetBrand);
                    activeLanes[catKey] = { id: catKey, label: VE_UI_CONFIG[catKey]?.label || catKey, status: 'active', current: 0, total: laneTotalItems, progress: 0, brand: targetBrand, brandLogo: localBrand?.logo ? getFullUrl(localBrand.logo) : '', currentItem: null };
                }
            });

            setSwarm({ active: true, status: 'processing', lanes: activeLanes });

            categoryKeys.forEach(catKey => {
                const itemIds = categoryMap[catKey] || [];
                if (itemIds.length === 0) return;
                const targetBrand = selectedBrandsOrMap[catKey];
                if (!targetBrand) return;

                const stringItemIds = itemIds.map(String);

                tierKeys.forEach(tierKey => {
                    updateFurnitureStatus(tierKey, { active: true, minimized: false });
                    const tierRows = tierDataRef.current[tierKey].rows;

                    const catWorkableIndices = getDisplayOrderedIndices(
                        tierRows,
                        (r) => !isHeaderRow(r.description, r) && r.aiStatus !== 'success' && (!r.scope || !r.scope.toUpperCase().includes('FITOUT')) && stringItemIds.includes(String(r.id))
                    );

                    if (catWorkableIndices.length > 0 && brandsByTier[tierKey].includes(targetBrand)) {
                        setFurnitureProgress(prev => ({ ...prev, [tierKey]: { current: 0, total: (prev[tierKey].total || 0) + catWorkableIndices.length } }));
                        const processCategoryBatch = async () => { await batch(catWorkableIndices, 3, async (idx) => { await processSingleRow(tierKey, idx, [targetBrand], catKey); }); };
                        swarmPromises.push(processCategoryBatch());
                    }
                });
            });

        } else {
            tierKeys.forEach(tierKey => {
                updateFurnitureStatus(tierKey, { active: true, minimized: false });
                const rows = tierDataRef.current[tierKey].rows || [];
                const workableIndices = getDisplayOrderedIndices(
                    rows,
                    (r) => !isHeaderRow(r.description, r) && r.aiStatus !== 'success' && (!r.scope || !r.scope.toUpperCase().includes('FITOUT'))
                );

                setFurnitureProgress(prev => ({ ...prev, [tierKey]: { current: 0, total: workableIndices.length } }));

                const processTierFallback = async () => { await batch(workableIndices, 3, async (idx) => { await processSingleRow(tierKey, idx, brandsByTier[tierKey], null); }); };
                swarmPromises.push(processTierFallback());
            });
        }

        try {
            await Promise.all(swarmPromises);
            setFurnitureBatchResult({ success: globalStats.success, error: globalStats.error, newlyAdded: globalStats.newlyAdded });
        } catch (error) {
            console.error("Swarm execution failed:", error);
            setFurnitureBatchResult({ error: 1 });
        } finally {
            for (const tierKey of tierKeys) { updateFurnitureStatus(tierKey, { active: false }); }
            setIsFurnitureAutoFilling(false);
            setSwarm(prev => prev ? { ...prev, active: false } : { active: false, lanes: {}, minimized: false });
            setTimeout(() => setFurnitureBatchResult(null), 8000);
            fetchBrands();
        }
    };

    const handleRetryRow = async (rowIndex, forcedBrands = null, forcedEngine = null) => {
        const tierKey = activeTier;
        const tier = tierDataRef.current[tierKey];
        if (!tier) return;
        const row = tier.rows[rowIndex];
        if (!row) return;

        const brandsToUse = forcedBrands || lastAISettings.brands || [];
        const engineToUse = forcedEngine || lastAISettings.engine || 'OpenAI';
        const modelToUse = lastAISettings.providerModel;
        const isFitout = row.scope?.toUpperCase().includes('FITOUT');

        setTierData(prev => {
            const newRows = [...prev[tierKey].rows];
            newRows[rowIndex] = { ...newRows[rowIndex], aiStatus: 'processing', aiError: null };
            return { ...prev, [tierKey]: { ...prev[tierKey], rows: newRows } };
        });

        if (isFitout) {
            updateFitoutStatus(tierKey, { status: 'identifying', currentItem: row, brand: '...', model: 'Matching Fitout...', image: null });
            try {
                const brandsForThisTier = brandsToUse.filter(s => s.endsWith(`|${tierKey}`)).map(s => s.split('|')[0]);
                const cleanDesc = (row.description || '').replace(/^\[.*?\]\s*/, '').trim();

                const response = await fetch(`${API_BASE}/api/auto-match-ai`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ description: cleanDesc, qty: row.qty, unit: row.unit, tier: tierKey, availableBrands: brandsForThisTier, provider: engineToUse, providerModel: modelToUse, scope: 'Fitout', type: 'fitout' })
                });

                const result = await response.json();
                if (result.status === 'success' && result.product) {
                    const product = result.product;
                    const finalPrice = Math.ceil(parseFloat(product.price || 0));
                    updateFitoutStatus(tierKey, { status: 'success', brand: product.brand || 'FitOut V2', model: product.model || '', image: product.imageUrl || row.imageRef || null });

                    setTierData(prev => {
                        const newRows = [...prev[tierKey].rows];
                        newRows[rowIndex] = { ...newRows[rowIndex], selectedBrand: product.brand || 'FitOut V2', brandDesc: product.description || product.model, brandImage: product.imageUrl || null, brandLogo: '', type: 'fitout', rate: finalPrice.toFixed(2), amount: (finalPrice * (parseFloat(row.qty) || 0)).toFixed(2), aiStatus: 'success', aiResult: result };
                        return { ...prev, [tierKey]: { ...prev[tierKey], rows: newRows } };
                    });
                } else {
                    const newStatus = result.status === 'no_match' ? 'no_match' : 'error';
                    updateFitoutStatus(tierKey, { status: newStatus });
                    setTierData(prev => ({ ...prev, [tierKey]: { ...prev[tierKey], rows: prev[tierKey].rows.map(r => String(r.id) === String(row.id) ? { ...r, aiStatus: newStatus, aiError: result.message } : r) } }));
                }
            } catch (error) {
                console.error("Retry Fitout Error:", error);
                updateFitoutStatus(tierKey, { status: 'error' });
                setTierData(prev => {
                    const newRows = [...prev[tierKey].rows];
                    newRows[rowIndex] = { ...newRows[rowIndex], aiStatus: 'error', aiError: error.message };
                    return { ...prev, [tierKey]: { ...prev[tierKey], rows: newRows } };
                });
            }
        } else {
            updateFurnitureStatus(tierKey, { status: 'identifying', currentItem: row, brand: '...', model: 'Finding match...', image: null });

            const brandsByTier = { budgetary: [], mid: [], high: [] };
            for (const brandName of brandsToUse) {
                const dbEntry = brands.find(b => b.name === brandName);
                const t = (dbEntry?.budgetTier || 'mid').toLowerCase();
                const key = (t === 'high' || t === 'premium') ? 'high' : t === 'budgetary' ? 'budgetary' : 'mid';
                brandsByTier[key].push(brandName);
            }

            const sizeContext = [row.qty && `Qty: ${row.qty}`, row.unit && `Unit: ${row.unit}`].filter(Boolean).join(', ');
            const enrichedDesc = sizeContext ? `${row.description} | ${sizeContext}` : row.description;

            try {
                const response = await fetch(`${API_BASE}/api/auto-match-ai`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ description: enrichedDesc, tier: tierKey, availableBrands: brandsByTier[tierKey], brandCategoryRules: lastAISettings.selectionMode === 'categorized' ? lastAISettings.brandsMap : null, provider: engineToUse, providerModel: modelToUse, scope: row.scope, type: 'furniture' })
                });

                const result = await response.json();
                if (result.status === 'success' && result.product) {
                    const { updatedRow, matchedBrandName, finalModel, finalImageUrl } = hydrateMatchedProduct(result, row);
                    updateFurnitureStatus(tierKey, { status: 'success', brand: matchedBrandName, model: finalModel, image: finalImageUrl || null });
                    setTierData(prev => ({ ...prev, [tierKey]: { ...prev[tierKey], rows: prev[tierKey].rows.map(r => String(r.id) === String(row.id) ? updatedRow : r) } }));
                } else {
                    const newStatus = result.status === 'no_match' ? 'no_match' : 'error';
                    updateFurnitureStatus(tierKey, { status: newStatus });
                    setTierData(prev => ({ ...prev, [tierKey]: { ...prev[tierKey], rows: prev[tierKey].rows.map(r => String(r.id) === String(row.id) ? { ...r, aiStatus: newStatus, aiError: result.message } : r) } }));
                }
            } catch (error) {
                console.error("Retry Furniture Error:", error);
                updateFurnitureStatus(tierKey, { status: 'error' });
                setTierData(prev => ({ ...prev, [tierKey]: { ...prev[tierKey], rows: prev[tierKey].rows.map(r => String(r.id) === String(row.id) ? { ...r, aiStatus: 'error', aiError: error.message } : r) } }));
            }
        }
    };

    const applyProductFieldChange = (target, field, value) => {
        const row = { ...target };

        if (field === 'selectedBrand') {
            row.selectedBrand = value;
            row.selectedMainCat = '';
            row.selectedSubCat = '';
            row.selectedFamily = '';
            row.selectedModel = '';
            row.brandImage = '';
            row.brandDesc = '';
            const brand = brands.find(b => b.name === value);
            row.brandLogo = brand?.logo || '';
        }
        else if (field === 'selectedMainCat') {
            row.selectedMainCat = value;
            row.selectedSubCat = '';
            row.selectedFamily = '';
            row.selectedModel = '';
        }
        else if (field === 'selectedSubCat') {
            row.selectedSubCat = value;
            row.selectedFamily = '';
            row.selectedModel = '';
        }
        else if (field === 'selectedFamily') {
            row.selectedFamily = value;
            row.selectedModel = '';
        }
        else if (field === 'selectedModel') {
            const { model, url, rawUrl } = value;
            const lookupUrl = rawUrl !== undefined ? rawUrl : url;
            row.selectedModel = model;
            row.selectedModelUrl = lookupUrl || url;

            const brand = brands.find(b => b.name === row.selectedBrand);
            if (brand && brand.products) {
                let product = brand.products.find(p =>
                    p.model === model &&
                    ((p.productUrl && p.productUrl === lookupUrl) || (p.imageUrl && p.imageUrl === lookupUrl))
                ) || brand.products.find(p =>
                    lookupUrl && ((p.productUrl && p.productUrl === lookupUrl) || (p.imageUrl && p.imageUrl === lookupUrl))
                );

                if (!product) {
                    const candidates = brand.products.filter(p =>
                        (p.normalization?.category || p.mainCategory) === row.selectedMainCat &&
                        (!row.selectedSubCat || (p.normalization?.subCategory || p.subCategory) === row.selectedSubCat) &&
                        (!row.selectedFamily || !p.family || p.family === row.selectedFamily) &&
                        p.model === model
                    );
                    const fallbackCandidates = candidates.length > 0 ? candidates : brand.products.filter(p => p.model === model);
                    if (fallbackCandidates.length > 0) {
                        if (url && url.startsWith('model_')) {
                            const parts = url.split('_');
                            const possibleIndex = parts.length >= 3 ? parseInt(parts[parts.length - 1]) : NaN;
                            product = (!isNaN(possibleIndex) && fallbackCandidates[possibleIndex]) ? fallbackCandidates[possibleIndex] : fallbackCandidates[0];
                        } else {
                            product = fallbackCandidates[0];
                        }
                    }
                }

                if (product) {
                    row.brandDesc = product.description || product.model;
                    row.brandImage = product.imageUrl || '';
                    row.selectedModelUrl = product.productUrl || product.imageUrl || row.selectedModelUrl;
                    const basePrice = parseFloat(product.price) || 0;
                    row.rate = basePrice > 0 ? basePrice.toFixed(2) : row.rate;
                    row.basePrice = basePrice;

                    const currentQty = parseFloat(row.qty) || 0;
                    if (currentQty > 0 && basePrice > 0) {
                        row.amount = (currentQty * basePrice).toFixed(2);
                    }

                    if (!row.unit) row.unit = 'Nos';
                }
            }
        }

        const autoSelectNextLevel = (currentRow) => {
            const activeBrand = brands.find(b => b.name === currentRow.selectedBrand);
            if (!activeBrand || !activeBrand.products) return;

            const brandProducts = activeBrand.products;

            if (currentRow.selectedBrand && !currentRow.selectedMainCat) {
                const mainCats = Array.from(new Set(brandProducts.flatMap(p => [p.normalization?.category, p.mainCategory]).filter(Boolean))).filter(v => v !== 'null' && v !== 'undefined');
                if (mainCats && mainCats.length === 1) {
                    currentRow.selectedMainCat = mainCats[0];
                    autoSelectNextLevel(currentRow);
                    return;
                }
            }

            if (currentRow.selectedMainCat && !currentRow.selectedSubCat) {
                const matchingByMain = brandProducts.filter(p => (p.normalization?.category || p.mainCategory) === currentRow.selectedMainCat);
                const subCats = Array.from(new Set(matchingByMain.flatMap(p => [p.normalization?.subCategory, p.subCategory]).filter(Boolean))).filter(v => v !== 'null' && v !== 'undefined');
                if (subCats && subCats.length === 1) {
                    currentRow.selectedSubCat = subCats[0];
                    autoSelectNextLevel(currentRow);
                    return;
                }
            }

            if (currentRow.selectedSubCat && !currentRow.selectedFamily) {
                const matchingBySub = brandProducts.filter(p =>
                    (p.normalization?.category || p.mainCategory) === currentRow.selectedMainCat &&
                    (p.normalization?.subCategory || p.subCategory) === currentRow.selectedSubCat
                );
                const families = getUniqueValues(matchingBySub, 'family');
                if (families && families.length === 1) {
                    currentRow.selectedFamily = families[0];
                    autoSelectNextLevel(currentRow);
                    return;
                }
            }

            if (currentRow.selectedFamily && !currentRow.selectedModel) {
                const allRawModels = brandProducts.filter(p =>
                    (p.normalization?.category || p.mainCategory) === currentRow.selectedMainCat &&
                    (p.normalization?.subCategory || p.subCategory) === currentRow.selectedSubCat &&
                    p.family === currentRow.selectedFamily
                );

                const variants = [];
                const seenUids = new Set();
                allRawModels.forEach(p => {
                    const uid = p.productUrl || p.imageUrl || `id_${p.id || Math.random()}`;
                    if (!seenUids.has(uid)) {
                        seenUids.add(uid);
                        variants.push(p);
                    }
                });

                if (variants.length === 1) {
                    const product = variants[0];
                    const uniqueVal = product.productUrl || product.imageUrl || `model_${product.model}_0`;

                    currentRow.selectedModel = product.model;
                    currentRow.selectedModelUrl = uniqueVal;
                    currentRow.brandDesc = product.description || product.model;
                    currentRow.brandImage = product.imageUrl || '';
                    const basePrice = parseFloat(product.price) || 0;
                    currentRow.rate = basePrice > 0 ? basePrice.toFixed(2) : currentRow.rate;
                    currentRow.basePrice = basePrice;
                    if (parseFloat(currentRow.qty) > 0 && basePrice > 0) {
                        currentRow.amount = (parseFloat(currentRow.qty) * basePrice).toFixed(2);
                    }
                    if (!currentRow.unit) currentRow.unit = 'Nos';
                }
            }
        };

        if (['selectedBrand', 'selectedMainCat', 'selectedSubCat', 'selectedFamily'].includes(field)) {
            autoSelectNextLevel(row);
        }
        else if (field === 'selectedModel') {
            // handled above
        }
        else {
            row[field] = value;
            if (field === 'qty' || field === 'rate') {
                const q = field === 'qty' ? parseFloat(value) : parseFloat(row.qty);
                const r = field === 'rate' ? parseFloat(value) : parseFloat(row.rate);
                if (!isNaN(q) && !isNaN(r)) {
                    row.amount = (q * r).toFixed(2);
                }
                if (field === 'rate' && !isNaN(r)) {
                    row.basePrice = r;
                }
            }
        }

        return row;
    };

    const handleCellChange = (rowIndex, field, value) => {
        setTierData(prev => {
            const tier = prev[activeTier];
            if (!tier) return prev;
            const newRows = [...tier.rows];
            const updatedRow = applyProductFieldChange(newRows[rowIndex], field, value);
            if (field === 'qty' && updatedRow.setType && updatedRow.setType !== 'single' && updatedRow.setItems?.length > 0) {
                newRows[rowIndex] = computeSetParentRollup(updatedRow, updatedRow.setItems);
            } else {
                newRows[rowIndex] = updatedRow;
            }
            return { ...prev, [activeTier]: { ...tier, rows: newRows } };
        });
    };

    const updateActiveTierRow = (rowIndex, updater) => {
        setTierData(prev => {
            const tier = prev[activeTier];
            if (!tier || !tier.rows?.[rowIndex]) return prev;
            const newRows = tier.rows.map((r, i) => (i === rowIndex ? updater(r) : r));
            return { ...prev, [activeTier]: { ...tier, rows: newRows } };
        });
    };

    // 'single' keeps the set as the option below the row; any other type (re)builds the components
    const handleSetTypeChange = (rowIndex, newSetType) => updateActiveTierRow(rowIndex, r => changeRowSetType(r, newSetType));

    // Single item ⇄ set alternative (both matches are kept, so switching is lossless)
    const handleUseSetOption = (rowIndex) => updateActiveTierRow(rowIndex, r => activateSetOption(r));
    const handleUseSingleItem = (rowIndex) => updateActiveTierRow(rowIndex, r => revertSetToSingle(r));
    const handleDismissSetOption = (rowIndex) => updateActiveTierRow(rowIndex, r => dismissSetOption(r));
    const handleToggleOptionExpand = (rowIndex) => updateActiveTierRow(rowIndex, r => (
        r.setOption ? { ...r, setOption: { ...r.setOption, expanded: !r.setOption.expanded } } : r
    ));
    const handleConvertToSet = (rowIndex) => updateActiveTierRow(rowIndex, r => convertRowToSet(r));

    const handleMatchSetOption = async (rowIndex) => {
        const tierKey = activeTier;
        const row = tierDataRef.current[tierKey]?.rows?.[rowIndex];
        if (!row || !row.setOption || matchingOptionRowId) return;
        setMatchingOptionRowId(row.id);
        try {
            await matchSetOptionForTier(tierKey, row.id, {
                description: row.description,
                availableBrands: getTierBrandNames(tierKey),
                providerModel: lastAISettings.providerModel || aiSettings?.model
            });
        } finally {
            setMatchingOptionRowId(null);
        }
    };

    const handleToggleSetExpand = (rowIndex) => {
        setTierData(prev => {
            const tier = prev[activeTier];
            if (!tier || !tier.rows?.[rowIndex]) return prev;
            const newRows = tier.rows.map((r, i) => i === rowIndex ? { ...r, setExpanded: !r.setExpanded } : r);
            return { ...prev, [activeTier]: { ...tier, rows: newRows } };
        });
    };

    const handleSetSubItemChange = (rowIndex, subIndex, field, value) => {
        setTierData(prev => {
            const tier = prev[activeTier];
            if (!tier || !tier.rows?.[rowIndex]) return prev;
            const newRows = [...tier.rows];
            const parent = { ...newRows[rowIndex] };
            const currentItems = Array.isArray(parent.setItems) ? [...parent.setItems] : [];
            if (!currentItems[subIndex]) return prev;

            const updatedSub = applyProductFieldChange(currentItems[subIndex], field, value);
            if (field === 'description') updatedSub.label = value;
            // A manually edited quantity replaces the parsed seat count used for cluster-size matching
            if (field === 'qty') updatedSub.seatCount = undefined;
            currentItems[subIndex] = updatedSub;
            newRows[rowIndex] = computeSetParentRollup(parent, currentItems);
            return { ...prev, [activeTier]: { ...tier, rows: newRows } };
        });
    };

    const handleAddSetSubItem = (rowIndex, afterSubIndex = null) => {
        setTierData(prev => {
            const tier = prev[activeTier];
            if (!tier || !tier.rows?.[rowIndex]) return prev;
            const newRows = [...tier.rows];
            const parent = { ...newRows[rowIndex] };
            const currentItems = Array.isArray(parent.setItems) ? [...parent.setItems] : [];
            const insertAt = afterSubIndex !== null ? afterSubIndex + 1 : currentItems.length;
            currentItems.splice(insertAt, 0, createEmptySetComponent(parent.id, currentItems.length, {
                label: `Component ${currentItems.length + 1}`,
                description: '',
                qty: '1',
                unit: 'Nos'
            }));
            newRows[rowIndex] = computeSetParentRollup({ ...parent, setExpanded: true }, currentItems);
            return { ...prev, [activeTier]: { ...tier, rows: newRows } };
        });
    };

    const handleRemoveSetSubItem = (rowIndex, subIndex) => {
        setTierData(prev => {
            const tier = prev[activeTier];
            if (!tier || !tier.rows?.[rowIndex]) return prev;
            const newRows = [...tier.rows];
            const parent = { ...newRows[rowIndex] };
            const nextItems = (parent.setItems || []).filter((_, i) => i !== subIndex);
            newRows[rowIndex] = nextItems.length === 0
                ? { ...revertSetToSingle(parent), setOption: null }
                : computeSetParentRollup(parent, nextItems);
            return { ...prev, [activeTier]: { ...tier, rows: newRows } };
        });
    };

    const handleMatchSingleSet = async (rowIndex, onlySubIndex = null) => {
        const tierKey = activeTier;
        const parent = tierDataRef.current[tierKey]?.rows?.[rowIndex];
        if (!parent || !Array.isArray(parent.setItems) || parent.setItems.length === 0) return;

        const targetIndices = onlySubIndex !== null ? [onlySubIndex] : parent.setItems.map((_, idx) => idx);
        const setMeta = getSetTypeMeta(parent.setType);
        const tierBrandNames = getTierBrandNames(tierKey);
        const matchProviderModel = lastAISettings.providerModel || aiSettings?.model;

        setMatchingSetRowId(parent.id);
        setTierData(prev => {
            const curTier = prev[tierKey];
            if (!curTier || !curTier.rows?.[rowIndex]) return prev;
            const nextRows = [...curTier.rows];
            const cur = nextRows[rowIndex];
            const marked = (cur.setItems || []).map((it, idx) => targetIndices.includes(idx) ? { ...it, aiStatus: 'processing' } : it);
            nextRows[rowIndex] = computeSetParentRollup({ ...cur, setExpanded: true }, marked);
            return { ...prev, [tierKey]: { ...curTier, rows: nextRows } };
        });

        try {
            let remainingIndices = [...targetIndices];

            // The whole set is first resolved as ONE same-manufacturer system from the tier's brands
            let lockedSetBrand = '';
            if (onlySubIndex === null && isSystemSetType(parent.setType)) {
                const sysResolved = await resolveSystemSetItems({
                    parentDescription: parent.description,
                    items: parent.setItems,
                    isAuto: true,
                    availableBrands: tierBrandNames,
                    providerModel: matchProviderModel
                });
                if (sysResolved) {
                    lockedSetBrand = sysResolved.anchorBrand || '';
                    setTierData(prev => {
                        const curTier = prev[tierKey];
                        if (!curTier || !curTier.rows?.[rowIndex]) return prev;
                        const nextRows = [...curTier.rows];
                        const cur = nextRows[rowIndex];
                        const nextItems = (cur.setItems || []).map((it, idx) => (
                            sysResolved.resolvedMap.has(idx) ? { ...sysResolved.resolvedMap.get(idx), id: it.id } : it
                        ));
                        nextRows[rowIndex] = computeSetParentRollup(cur, nextItems);
                        return { ...prev, [tierKey]: { ...curTier, rows: nextRows } };
                    });
                    remainingIndices = sysResolved.unresolvedIndices;
                }
            } else if (onlySubIndex !== null) {
                // Re-matching one component keeps the manufacturer already used by the rest of the set
                lockedSetBrand = (parent.setItems.find((it, idx) => idx !== onlySubIndex && it.selectedBrand)?.selectedBrand) || '';
            }

            const runMbSubMatch = async (sIdx) => {
                const liveRow = tierDataRef.current[tierKey]?.rows?.[rowIndex];
                const liveParent = liveRow?.setItems?.[sIdx] ? liveRow : parent;
                const sub = liveParent?.setItems?.[sIdx];
                if (!sub) return;
                const queryDesc = buildSetComponentMatchQuery(sub, liveParent, setMeta);
                if (!queryDesc) return;

                try {
                    // Same manufacturer as the rest of the set when known, otherwise the tier's own brands
                    const res = await fetch(`${API_BASE}${lockedSetBrand ? '/api/ve-match' : '/api/auto-match-ai'}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(lockedSetBrand ? {
                            description: queryDesc,
                            qty: sub.qty || '1',
                            unit: sub.unit || 'Nos',
                            brand: lockedSetBrand,
                            tier: tierKey,
                            providerModel: matchProviderModel
                        } : {
                            description: queryDesc,
                            tier: tierKey,
                            availableBrands: tierBrandNames,
                            provider: lastAISettings.engine || 'OpenAI',
                            providerModel: matchProviderModel,
                            scope: liveParent.scope,
                            type: 'furniture'
                        })
                    });
                    const data = await res.json();
                    if (data.status === 'success' && data.product) {
                        const { updatedRow: hydratedSub, matchedBrandName } = hydrateMatchedProduct(data, sub);
                        if (!lockedSetBrand && matchedBrandName) lockedSetBrand = matchedBrandName;
                        setTierData(prev => {
                            const curTier = prev[tierKey];
                            if (!curTier || !curTier.rows?.[rowIndex]) return prev;
                            const nextRows = [...curTier.rows];
                            const cur = nextRows[rowIndex];
                            const nextItems = (cur.setItems || []).map((it, idx) => idx === sIdx ? { ...it, ...hydratedSub, aiStatus: 'success' } : it);
                            nextRows[rowIndex] = computeSetParentRollup(cur, nextItems);
                            return { ...prev, [tierKey]: { ...curTier, rows: nextRows } };
                        });
                    } else {
                        setTierData(prev => {
                            const curTier = prev[tierKey];
                            if (!curTier || !curTier.rows?.[rowIndex]) return prev;
                            const nextRows = [...curTier.rows];
                            const cur = nextRows[rowIndex];
                            const nextItems = (cur.setItems || []).map((it, idx) => idx === sIdx ? { ...it, aiStatus: data.status === 'no_match' ? 'no_match' : 'error' } : it);
                            nextRows[rowIndex] = computeSetParentRollup(cur, nextItems);
                            return { ...prev, [tierKey]: { ...curTier, rows: nextRows } };
                        });
                    }
                } catch {
                    setTierData(prev => {
                        const curTier = prev[tierKey];
                        if (!curTier || !curTier.rows?.[rowIndex]) return prev;
                        const nextRows = [...curTier.rows];
                        const cur = nextRows[rowIndex];
                        const nextItems = (cur.setItems || []).map((it, idx) => idx === sIdx ? { ...it, aiStatus: 'error' } : it);
                        nextRows[rowIndex] = computeSetParentRollup(cur, nextItems);
                        return { ...prev, [tierKey]: { ...curTier, rows: nextRows } };
                    });
                }
            };

            if (!lockedSetBrand && remainingIndices.length > 1) {
                const firstIdx = remainingIndices.shift();
                await runMbSubMatch(firstIdx);
            }
            await batch(remainingIndices, 3, runMbSubMatch);
        } finally {
            setMatchingSetRowId(null);
        }
    };

    const handleAddRow = (index) => {
        setTierData(prev => {
            const tier = prev[activeTier];
            if (!tier) return prev;
            const newRows = [...tier.rows];
            newRows.splice(index + 1, 0, {
                id: Date.now(),
                sn: newRows.length + 2,
                imageRef: null,
                brandImage: '', brandImages: [], brandDesc: '', description: '', qty: '', unit: '', rate: '', amount: '',
                selectedBrand: '', selectedMainCat: '', selectedSubCat: '', selectedFamily: '', selectedModel: '',
                setType: 'single', setItems: [], setExpanded: false
            });
            newRows.forEach((r, i) => r.sn = i + 1);
            return { ...prev, [activeTier]: { ...tier, rows: newRows } };
        });
    };

    const handleRemoveRow = (index) => {
        setTierData(prev => {
            const tier = prev[activeTier];
            if (!tier) return prev;
            const newRows = [...tier.rows];
            newRows.splice(index, 1);
            newRows.forEach((r, i) => r.sn = i + 1);
            return { ...prev, [activeTier]: { ...tier, rows: newRows } };
        });
    };

    const handleClearRowMatch = (rowIndex) => {
        setTierData(prev => {
            const tier = prev[activeTier];
            if (!tier) return prev;
            const newRows = [...tier.rows];
            newRows[rowIndex] = {
                ...newRows[rowIndex],
                selectedBrand: '', brandLogo: '', brandImage: '', brandDesc: '',
                selectedMainCat: '', selectedSubCat: '', selectedFamily: '',
                selectedModel: '', selectedModelUrl: '',
                rate: '0.00', basePrice: 0, amount: 0
            };
            return { ...prev, [activeTier]: { ...tier, rows: newRows } };
        });
    };

    /**
     * The offer table of the active tier, as Apply Costing hands it over (and as the
     * Design & Build button sends it, with the rows' pictures and chosen products).
     */
    const offerTablesFor = (rows) => {
        const exportRows = recategorizeBoqRows(rows, recategorizeMode);
        const formattedRows = exportRows.flatMap((row, idx) => {
            const parentSn = String(row.sn || idx + 1);
            const rateValNum = parseFloat(row.rate);
            const qtyValNum = parseFloat(row.qty);
            const amount = (Number.isFinite(rateValNum) && rateValNum > 0 && Number.isFinite(qtyValNum))
                ? (qtyValNum * rateValNum).toFixed(2)
                : (row.amount || '0.00');
            const isSetRow = row.setType && row.setType !== 'single' && Array.isArray(row.setItems) && row.setItems.length > 0;
            const parentImages = (isSetRow && row.brandImages?.length)
                ? row.brandImages.map(u => ({ url: u }))
                : (row.brandImage
                    ? [{ url: row.brandImage }]
                    : (row.imageRefs?.length ? row.imageRefs : (row.imageRef ? [row.imageRef] : [])).map(u => ({ url: u })));

            const parentExport = {
                // the BOQ line's own words (sizes, kind) for Design & Build to match drawn furniture
                sourceDescription: row.description || '',
                // chosen model and its page, for Design & Build's FF&E schedule and catalogue links
                selectedModel: row.selectedModel || '',
                productUrl: row.selectedModelUrl || '',
                location: row.location || '',
                scope: row.scope || '',
                code: row.code || '',
                categoryHint: row.categoryHint || '',
                selectedBrand: row.selectedBrand || '',
                selectedMainCat: row.selectedMainCat || '',
                selectedSubCat: row.selectedSubCat || '',
                sectionLabel: row.sectionLabel || '',
                sectionCategory: row.sectionCategory || '',
                sectionSubheader: row.sectionSubheader || '',
                submissionTitle: row.submissionTitle || '',
                setType: row.setType || 'single',
                setItems: isSetRow ? row.setItems : undefined,
                cells: [
                    { value: parentSn },
                    {
                        value: '',
                        image: (isSetRow && row.brandImages?.[0]) || row.brandImage || row.imageRef,
                        images: parentImages
                    },
                    { value: row.brandDesc || row.description || 'N/A' },
                    { value: row.qty || '0' },
                    { value: row.unit || 'Nos' },
                    { value: row.rate || '0' },
                    { value: isNaN(parseFloat(amount)) ? '0' : amount }
                ]
            };

            // Optional line for the row's inactive alternative (set option below a single item,
            // or the single item kept beside an active set). Never counted in totals.
            const optionExports = [];
            if (exportSetOptions) {
                const rowMeta = {
                    location: row.location || '',
                    scope: row.scope || '',
                    code: row.code || '',
                    categoryHint: row.categoryHint || '',
                    sectionLabel: row.sectionLabel || '',
                    sectionCategory: row.sectionCategory || '',
                    sectionSubheader: row.sectionSubheader || '',
                    submissionTitle: row.submissionTitle || '',
                    isOptionRow: true
                };
                const optionSummary = !isSetRow && row.setOption ? summarizeSetOption(row.setOption, row.qty) : null;
                if (optionSummary && optionSummary.matchedCount > 0) {
                    const optionLines = row.setOption.items.map(it =>
                        `• ${it.qty || 1} ${it.unit || 'Nos'} × ${[it.selectedBrand, it.selectedModel].filter(Boolean).join(' — ') || it.label}`
                    );
                    optionExports.push({
                        ...rowMeta,
                        selectedBrand: optionSummary.brands[0] || '',
                        selectedMainCat: optionSummary.typeLabel,
                        selectedSubCat: `${optionSummary.itemCount} Components`,
                        cells: [
                            { value: `${parentSn} (Option)` },
                            { value: '', image: optionSummary.images[0] || null, images: optionSummary.images.map(u => ({ url: u })) },
                            { value: [`OPTION for item ${parentSn} — ${optionSummary.label}`, ...optionLines].join('\n') },
                            { value: row.qty || '1' },
                            { value: 'Set' },
                            { value: optionSummary.hasPrice ? optionSummary.ratePerSet.toFixed(2) : '0' },
                            { value: 'Optional' }
                        ]
                    });
                } else if (isSetRow && hasSingleAlternative(row)) {
                    const alt = row.singleAlt;
                    optionExports.push({
                        ...rowMeta,
                        selectedBrand: alt.selectedBrand || '',
                        selectedMainCat: alt.selectedMainCat || '',
                        selectedSubCat: alt.selectedSubCat || '',
                        cells: [
                            { value: `${parentSn} (Option)` },
                            { value: '', image: alt.brandImage || null, images: alt.brandImage ? [{ url: alt.brandImage }] : [] },
                            { value: `OPTION for item ${parentSn} — Single item: ${alt.brandDesc || [alt.selectedBrand, alt.selectedModel].filter(Boolean).join(' — ')}` },
                            { value: row.qty || '1' },
                            { value: row.unit || 'Nos' },
                            { value: alt.rate || '0' },
                            { value: 'Optional' }
                        ]
                    });
                }
            }

            if (!isSetRow || setExportMode !== 'include_sub_items') {
                return [parentExport, ...optionExports];
            }

            const subExports = row.setItems.map((sub, sIdx) => ({
                location: row.location || '',
                scope: row.scope || '',
                code: row.code || '',
                categoryHint: row.categoryHint || '',
                selectedBrand: sub.selectedBrand || '',
                selectedMainCat: sub.selectedMainCat || '',
                selectedSubCat: sub.selectedSubCat || '',
                sectionLabel: row.sectionLabel || '',
                sectionCategory: row.sectionCategory || '',
                sectionSubheader: row.sectionSubheader || '',
                submissionTitle: row.submissionTitle || '',
                isSetSubItem: true,
                cells: [
                    { value: `${parentSn}.${sIdx + 1}` },
                    {
                        value: '',
                        image: sub.brandImage || null,
                        images: sub.brandImage ? [{ url: sub.brandImage }] : []
                    },
                    { value: `↳ ${sub.label || sub.description}${sub.brandDesc ? ` — ${sub.brandDesc}` : ''}` },
                    { value: sub.qty || '1' },
                    { value: sub.unit || 'Nos' },
                    { value: sub.rate || '0' },
                    { value: 'Included' }
                ]
            }));

            return [parentExport, ...subExports, ...optionExports];
        });
        return [{
            sheetName: `New BOQ - ${activeTier.charAt(0).toUpperCase() + activeTier.slice(1)} Tier`,
            header: ['Sr.', 'Image', 'Description', 'Qty', 'Unit', 'Rate', 'Amount'],
            columnCount: 7,
            recategorizeMode,
            rows: formattedRows
        }];
    };

    const handleApplyCosting = (factors) => {
        setCostingFactors(factors);
        setIsCostingOpen(false);

        const activeTierData = tierData[activeTier];
        if (!activeTierData) return;

        const markup = 1 + (factors.profit + factors.freight + factors.customs + factors.installation) / 100;
        const costMultiplier = markup * factors.exchangeRate;

        const updatedRows = activeTierData.rows.map(sourceRow => {
            // Inactive alternates (set option / single-item snapshot) are costed with the same factors
            const row = applyCostingToRowAlternates(sourceRow, costMultiplier);
            if (row.setType && row.setType !== 'single' && Array.isArray(row.setItems) && row.setItems.length > 0) {
                const costedSubs = row.setItems.map(sub => {
                    const subBase = parseFloat(sub.basePrice) || 0;
                    if (subBase > 0) {
                        const costedSubRate = subBase * markup * factors.exchangeRate;
                        const subQty = parseFloat(sub.qty) || 0;
                        return { ...sub, rate: costedSubRate.toFixed(2), amount: (costedSubRate * subQty).toFixed(2) };
                    }
                    return sub;
                });
                const rolled = computeSetParentRollup(row, costedSubs);
                if (rolled.basePrice && rolled.basePrice > 0 && !costedSubs.some(s => parseFloat(s.basePrice) > 0)) {
                    const costedPrice = rolled.basePrice * markup * factors.exchangeRate;
                    return { ...rolled, rate: costedPrice.toFixed(2), amount: (costedPrice * (parseFloat(rolled.qty) || 1)).toFixed(2) };
                }
                return rolled;
            }
            if (row.basePrice && row.basePrice > 0) {
                const costedPrice = row.basePrice * markup * factors.exchangeRate;
                const costedRateStr = costedPrice.toFixed(2);
                const qtyNum = parseFloat(row.qty);
                const finalAmount = (Number.isFinite(qtyNum) ? qtyNum * parseFloat(costedRateStr) : 0).toFixed(2);
                return { ...row, rate: costedRateStr, amount: finalAmount };
            }
            return row;
        });

        setTierData(prev => ({
            ...prev,
            [activeTier]: { ...activeTierData, rows: updatedRows }
        }));

        if (onApplyFlow) {
            const formattedData = {
                costingFactors: factors,
                recategorizeMode,
                setExportMode,
                exportSetOptions,
                tables: offerTablesFor(updatedRows)
            };
            onApplyFlow(formattedData);
        }
    };

    const getImageData = async (url, options = {}) => {
        return loadExportImageData(url, options);
    };

    const handleExportRFQ = async () => {
        const tier = tierData[activeTier];
        if (!tier || !tier.rows.length) return alert('No data to export');
        try {
            await exportRfqByBrandFromTierRows(tier.rows, {
                allBrands: brands,
                project: { projectName: `${activeTier.toUpperCase()} Tier Offer` },
                companyName,
                logoUrl: logoOriginal || logoBlue || logoWhite || '',
                accentColor,
                secondaryColor,
                filenamePrefix: `RFQ_${activeTier.toUpperCase()}_By_Brand`
            });
        } catch (err) {
            console.error('[MultiBudget RFQ Export] Failed:', err);
            alert(`Failed to generate Brand RFQ pack: ${err?.message || 'Unknown error'}`);
        }
    };

    const calcFitSize = (imgW, imgH, maxW, maxH) => {
        const ratio = Math.min(maxW / imgW, maxH / imgH);
        return { w: imgW * ratio, h: imgH * ratio };
    };
    const handleExportPDF = async () => {
        const tier = tierData[activeTier];
        if (!tier || !tier.rows.length) return alert('No data to export');

        const isBoqMode = tier.mode === 'boq';
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();

        const arabicLoaded = await loadArabicFont(doc);
        const processText = (txt) => (arabicLoaded && hasArabic(txt)) ? fixArabic(txt) : String(txt || '');

        const brandPalette = getBrandColors(accentColor, secondaryColor);
        const colors = {
            primary: brandPalette.primaryRgb,
            accent: brandPalette.accentRgb,
            text: brandPalette.textRgb,
            lightText: brandPalette.lightTextRgb,
            white: [255, 255, 255],
            lightBg: brandPalette.lightBgRgb,
            border: brandPalette.borderRgb
        };

        doc.setFillColor(...colors.primary);
        doc.rect(0, 0, pageWidth, 45, 'F');
        doc.setFillColor(...colors.accent);
        doc.rect(0, 45, pageWidth, 2, 'F');

        doc.setTextColor(...colors.white);
        doc.setFontSize(22);
        doc.setFont('helvetica', 'bold');
        if (arabicLoaded) doc.setFont('Almarai', 'bold');
        doc.text(processText(`${activeTier.toUpperCase()} TIER OFFER`), 15, 20);

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        if (arabicLoaded) doc.setFont('Almarai', 'normal');

        const projName = planPreviewName || 'Standard Project';
        doc.text(processText(`Project: ${projName}`), 15, 28);
        doc.text(processText(`Reference: BOQ-${Math.floor(1000 + Math.random() * 9000)}`), 15, 33);
        doc.text(processText(`Date: ${new Date().toLocaleDateString()}`), 15, 38);

        const logoToUse = logoWhite || logoOriginal || logoBlue;
        if (logoToUse) {
            try {
                const docLogo = await getImageData(logoToUse, { format: 'image/png', maxWidth: 800 });
                if (docLogo) {
                    const logoFit = calcFitSize(docLogo.width, docLogo.height, 55, 28);
                    doc.addImage(docLogo.dataUrl, 'PNG', pageWidth - 15 - logoFit.w, 8, logoFit.w, logoFit.h);
                }
            } catch (e) { }
        }

        const header = isBoqMode
            ? ['Sr.', 'Location', 'Scope', 'Ref Image', 'Original Desc', 'Brand Image', 'Brand Desc', 'Qty', 'Unit', 'Rate', 'Amount']
            : ['Sr.', 'Location', 'Scope', 'Image', 'Description', 'Qty', 'Unit', 'Rate', 'Amount'];

        const processedHeader = header.map(h => processText(h));

        const exportRows = recategorizeBoqRows(tier.rows, recategorizeMode);
        const imageDataMap = {};
        for (let i = 0; i < exportRows.length; i++) {
            const row = exportRows[i];
            if (row.imageRef) {
                try {
                    const url = getFullUrl(row.imageRef);
                    const result = await getImageData(url, { maxWidth: 600, format: 'image/jpeg' });
                    if (result) imageDataMap[`ref_${i}`] = result;
                } catch (e) { }
            }
            if (row.brandImage) {
                try {
                    const result = await getImageData(row.brandImage, { maxWidth: 800, format: 'image/jpeg' });
                    if (result) imageDataMap[`brand_${i}`] = result;
                } catch (e) { }
            }
            if (row.brandLogo) {
                try {
                    const result = await getImageData(row.brandLogo, { format: 'image/png', maxWidth: 400 });
                    if (result) imageDataMap[`logo_${i}`] = result;
                } catch (e) { }
            }
        }

        const body = [];
        const bodyMeta = [];
        let lastSection = '';
        exportRows.forEach((row, i) => {
            if (row.sectionLabel && row.sectionLabel !== lastSection) {
                lastSection = row.sectionLabel;
                body.push([{
                    content: processText(row.sectionLabel),
                    colSpan: header.length,
                    styles: {
                        fillColor: [254, 243, 199],
                        textColor: [15, 62, 103],
                        fontStyle: 'bold',
                        fontSize: 7.5,
                        halign: 'left',
                        cellPadding: 2
                    }
                }]);
                bodyMeta.push({ isSubheader: true, rowIdx: -1 });
            }

            const fmtCellMoney = (v) => {
                const n = parseFloat(String(v ?? '').replace(/,/g, ''));
                return Number.isFinite(n)
                    ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : String(v || '');
            };
            const rawAmt = row.amount || (parseFloat(row.qty || 0) * parseFloat(row.rate || 0));
            const amount = fmtCellMoney(rawAmt);
            const rateDisplay = row.rate ? fmtCellMoney(row.rate) : '';
            if (isBoqMode) {
                body.push([
                    row.sn,
                    processText(row.location || '-'),
                    processText(row.scope || '-'),
                    '',
                    processText(row.description),
                    '',
                    processText(row.brandDesc),
                    row.qty || '',
                    row.unit || '',
                    rateDisplay,
                    amount
                ]);
            } else {
                body.push([
                    row.sn,
                    processText(row.location || '-'),
                    processText(row.scope || '-'),
                    '',
                    processText(row.brandDesc),
                    row.qty || '',
                    row.unit || '',
                    rateDisplay,
                    amount
                ]);
            }
            bodyMeta.push({ isSubheader: false, rowIdx: i });
        });

        autoTable(doc, {
            startY: 55,
            head: [processedHeader],
            body: body,
            theme: 'striped',
            headStyles: {
                fillColor: colors.primary,
                textColor: colors.white,
                fontStyle: 'bold',
                halign: 'center',
                minCellHeight: 8,
                fontSize: 7.5
            },
            alternateRowStyles: {
                fillColor: [250, 251, 253]
            },
            tableWidth: 'auto',
            styles: {
                fontSize: 6.5,
                cellPadding: 1.2,
                overflow: 'linebreak',
                valign: 'middle',
                font: arabicLoaded ? 'Almarai' : 'helvetica',
                lineWidth: 0.1,
                lineColor: colors.border
            },
            columnStyles: isBoqMode ? {
                0: { cellWidth: 6 },
                1: { cellWidth: 14 },
                2: { cellWidth: 12 },
                3: { cellWidth: 20 },
                4: { cellWidth: 26 },
                5: { cellWidth: 20 },
                6: { cellWidth: 26 },
                7: { cellWidth: 8, halign: 'center' },
                8: { cellWidth: 8, halign: 'center' },
                9: { cellWidth: 14, halign: 'right' },
                10: { cellWidth: 16, halign: 'right' }
            } : {
                0: { cellWidth: 8 },
                1: { cellWidth: 22 },
                2: { cellWidth: 18 },
                3: { cellWidth: 35 },
                4: { cellWidth: 50 },
                5: { cellWidth: 12, halign: 'center' },
                6: { cellWidth: 12, halign: 'center' },
                7: { cellWidth: 16, halign: 'right' },
                8: { cellWidth: 18, halign: 'right' }
            },
            didDrawCell: (data) => {
                if (data.section === 'body') {
                    const meta = bodyMeta[data.row.index];
                    if (!meta || meta.isSubheader) return;
                    const rowIdx = meta.rowIdx;
                    const refImgCol = isBoqMode ? 3 : -1;
                    const brandImgCol = isBoqMode ? 5 : 3;

                    if (data.column.index === refImgCol && imageDataMap[`ref_${rowIdx}`]) {
                        const img = imageDataMap[`ref_${rowIdx}`];
                        const fit = calcFitSize(img.width, img.height, data.cell.width - 2, data.cell.height - 2);
                        const x = data.cell.x + (data.cell.width - fit.w) / 2;
                        const y = data.cell.y + (data.cell.height - fit.h) / 2;
                        doc.addImage(img.dataUrl, 'JPEG', x, y, fit.w, fit.h, undefined, 'MEDIUM');
                    }

                    if (data.column.index === brandImgCol) {
                        const hasLogo = imageDataMap[`logo_${rowIdx}`];
                        const hasBrandImg = imageDataMap[`brand_${rowIdx}`];

                        const logoHeight = 5;
                        const padding = 1;
                        const gap = 0.5;

                        if (hasLogo) {
                            const logoImg = imageDataMap[`logo_${rowIdx}`];
                            const logoFit = calcFitSize(logoImg.width, logoImg.height, data.cell.width - 2, logoHeight);
                            const logoX = data.cell.x + (data.cell.width - logoFit.w) / 2;
                            const logoY = data.cell.y + padding;
                            doc.addImage(logoImg.dataUrl, 'PNG', logoX, logoY, logoFit.w, logoFit.h);
                        }

                        if (hasBrandImg) {
                            const img = imageDataMap[`brand_${rowIdx}`];
                            const imgStartY = hasLogo ? (data.cell.y + logoHeight + gap + padding) : (data.cell.y + padding);
                            const availableHeight = hasLogo
                                ? (data.cell.height - logoHeight - gap - padding * 2)
                                : (data.cell.height - padding * 2);
                            const fit = calcFitSize(img.width, img.height, data.cell.width - 2, availableHeight);
                            const x = data.cell.x + (data.cell.width - fit.w) / 2;
                            const y = imgStartY + (availableHeight - fit.h) / 2;
                            doc.addImage(img.dataUrl, 'JPEG', x, y, fit.w, fit.h, undefined, 'MEDIUM');
                        }
                    }
                }
            },
            didParseCell: (data) => {
                if (data.section === 'body') {
                    const meta = bodyMeta[data.row.index];
                    if (!meta || meta.isSubheader) {
                        data.cell.styles.minCellHeight = 8;
                        return;
                    }
                    const refImgCol = isBoqMode ? 3 : -1;
                    const brandImgCol = isBoqMode ? 5 : 3;
                    if (data.column.index === brandImgCol) {
                        data.cell.styles.minCellHeight = 32;
                    } else if (data.column.index === refImgCol) {
                        data.cell.styles.minCellHeight = 22;
                    }
                }
            },
            didDrawPage: () => {
                // Footer + "Page X of Y" stamped cleanly across all pages after table completes
            }
        });

        const subtotal = tier.rows.reduce((sum, row) => sum + (parseFloat(row.qty || 0) * parseFloat(row.rate || 0)), 0);
        const vatAmount = subtotal * ((costingFactors.vat || 0) / 100);
        const grandTotal = subtotal + vatAmount;

        let finalY = doc.lastAutoTable.finalY + 15;
        const summaryWidth = 85;
        const summaryX = pageWidth - summaryWidth - 15;

        if (finalY + 80 > pageHeight) {
            doc.addPage();
            finalY = 20;
        }

        doc.setFillColor(240, 240, 240);
        doc.rect(summaryX + 1, finalY + 1, summaryWidth, 35, 'F');
        doc.setFillColor(...colors.white);
        doc.setDrawColor(...colors.border);
        doc.rect(summaryX, finalY, summaryWidth, 35, 'FD');

        doc.setFontSize(10);
        doc.setTextColor(...colors.text);
        doc.setFont('helvetica', 'normal');
        if (arabicLoaded) doc.setFont('Almarai', 'normal');

        const formatCurr = (val) => {
            return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
        };

        doc.text(processText('Subtotal'), summaryX + 5, finalY + 8);
        doc.text(`${formatCurr(subtotal)} ${costingFactors.toCurrency}`, pageWidth - 20, finalY + 8, { align: 'right' });

        doc.setFontSize(9);
        doc.setTextColor(...colors.lightText);
        doc.text(processText(`VAT (${costingFactors.vat}%)`), summaryX + 5, finalY + 15);
        doc.text(`${formatCurr(vatAmount)} ${costingFactors.toCurrency}`, pageWidth - 20, finalY + 15, { align: 'right' });

        doc.setDrawColor(...colors.border);
        doc.line(summaryX + 5, finalY + 19, pageWidth - 20, finalY + 19);

        doc.setTextColor(...colors.primary);
        doc.setFontSize(13);
        doc.setFont('helvetica', 'bold');
        if (arabicLoaded) doc.setFont('Almarai', 'bold');
        doc.text(processText('GRAND TOTAL'), summaryX + 5, finalY + 28);
        doc.text(`${formatCurr(grandTotal)} ${costingFactors.toCurrency}`, pageWidth - 20, finalY + 28, { align: 'right' });

        const sigY = finalY + 50;
        doc.setDrawColor(...colors.border);
        doc.setLineWidth(0.2);

        doc.line(15, sigY, 85, sigY);
        doc.setFontSize(8);
        doc.setTextColor(...colors.lightText);
        doc.setFont('helvetica', 'normal');
        if (arabicLoaded) doc.setFont('Almarai', 'normal');
        doc.text(processText('Authorized Signature'), 15, sigY + 5);
        doc.text(processText(companyName), 15, sigY + 9);

        doc.line(pageWidth - 85, sigY, pageWidth - 15, sigY);
        doc.text(processText('Client Acceptance'), pageWidth - 85, sigY + 5);
        doc.text(processText('Sign & Date'), pageWidth - 85, sigY + 9);

        doc.setFontSize(8);
        doc.setTextColor(...colors.lightText);
        doc.text(processText('Notes:'), 15, sigY + 25);
        doc.text(processText('1. This offer is valid for 15 days from the date of issue.'), 15, sigY + 30);
        doc.text(processText('2. Prices are subject to final site measurement and confirmation.'), 15, sigY + 34);

        const totalPages = doc.internal.getNumberOfPages();
        const footerText = [companyName, website].filter(Boolean).join('  |  ') || 'BOQ FLOW';
        for (let p = 1; p <= totalPages; p++) {
            doc.setPage(p);
            doc.setDrawColor(...colors.accent);
            doc.setLineWidth(0.4);
            doc.line(15, pageHeight - 13, pageWidth - 15, pageHeight - 13);
            doc.setFontSize(7.5);
            doc.setTextColor(...colors.lightText);
            doc.setFont(arabicLoaded && hasArabic(footerText) ? 'Almarai' : 'helvetica', 'normal');
            doc.text(processText(footerText), 15, pageHeight - 7.5);
            doc.setFont('helvetica', 'normal');
            doc.text(`Page ${p} of ${totalPages}`, pageWidth - 15, pageHeight - 7.5, { align: 'right' });
        }

        doc.save(`MultiBudget_${activeTier}_Offer.pdf`);
    };

    const handleExportExcel = async () => {
        const tier = tierData[activeTier];
        if (!tier || !tier.rows.length) return alert('No data to export');

        const ExcelJS = (await import('exceljs')).default;
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'BOQFlow';
        workbook.created = new Date();

        const brandPalette = getBrandColors(accentColor, secondaryColor);
        const primaryArgb = brandPalette.primary || '0F3E67';
        const accentArgb = brandPalette.accent || 'F5A623';

        const ws = workbook.addWorksheet(`${activeTier} Tier`, {
            properties: { tabColor: { argb: accentArgb } },
            pageSetup: {
                orientation: 'landscape',
                paperSize: 9,
                fitToPage: true,
                fitToWidth: 1,
                fitToHeight: 0
            }
        });
        const isBoqMode = tier.mode === 'boq';

        ws.addRow(['']);
        ws.addRow(['', '', '', '', '', '', '', '', '']);
        ws.addRow(['', '', '', '', '', '', '', '', '']);
        ws.mergeCells('A2:E2');
        const titleCell = ws.getCell('A2');
        titleCell.value = `${activeTier.toUpperCase()} TIER COMMERCIAL OFFER`;
        titleCell.font = { name: 'Calibri', bold: true, size: 15, color: { argb: primaryArgb } };

        ws.getCell('A3').value = `${companyName || 'BOQFLOW'}  |  Generated: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`;
        ws.getCell('A3').font = { name: 'Calibri', italic: true, size: 10, color: { argb: '64748B' } };

        const excelLogo = logoOriginal || logoBlue || logoWhite;
        if (excelLogo) {
            try {
                const logoData = await getImageData(excelLogo, { format: 'image/png', maxWidth: 600 });
                if (logoData) {
                    const logoId = workbook.addImage({
                        base64: logoData.dataUrl.split(',')[1],
                        extension: 'png'
                    });

                    const lastColIndex = isBoqMode ? 11 : 9;
                    const logoFit = calcFitSize(logoData.width, logoData.height, 140, 50);
                    ws.addImage(logoId, {
                        tl: { col: lastColIndex - 2, row: 0.1 },
                        ext: { width: logoFit.w, height: logoFit.h }
                    });
                }
            } catch (e) { console.error("Excel Logo Error:", e); }
        }

        ws.addRow(['']);

        const header = isBoqMode
            ? ['Sr.', 'Location', 'Scope', 'Ref Image', 'Original Desc', 'Brand Image', 'Brand Desc', 'Qty', 'Unit', 'Rate', 'Amount']
            : ['Sr.', 'Location', 'Scope', 'Image', 'Description', 'Qty', 'Unit', 'Rate', 'Amount'];

        ws.columns = isBoqMode
            ? [
                { width: 6 },
                { width: 15 },
                { width: 12 },
                { width: 15 },
                { width: 35 },
                { width: 18 },
                { width: 35 },
                { width: 8 },
                { width: 8 },
                { width: 12 },
                { width: 14 }
            ]
            : [
                { width: 6 },
                { width: 15 },
                { width: 15 },
                { width: 18 },
                { width: 55 },
                { width: 10 },
                { width: 10 },
                { width: 14 },
                { width: 16 }
            ];

        const hasAr = header.some(h => hasArabic(h)) || tier.rows.some(r => hasArabic(r.description) || hasArabic(r.brandDesc));

        const headerRow = ws.addRow(header);
        headerRow.height = 26;
        headerRow.eachCell(cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: primaryArgb } };
            cell.font = { name: 'Calibri', color: { argb: 'FFFFFF' }, bold: true, size: 10.5 };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            cell.border = {
                top: { style: 'thin', color: { argb: primaryArgb } },
                bottom: { style: 'medium', color: { argb: accentArgb } },
                left: { style: 'thin', color: { argb: '334155' } },
                right: { style: 'thin', color: { argb: '334155' } }
            };
        });
        ws.views = [{ state: 'frozen', ySplit: headerRow.number, rightToLeft: hasAr }];

        const qtyColNum = isBoqMode ? 8 : 6;
        const rateColNum = isBoqMode ? 10 : 8;
        const amountColNum = isBoqMode ? 11 : 9;
        const amountLetter = isBoqMode ? 'K' : 'I';

        const exportExcelRows = recategorizeBoqRows(tier.rows, recategorizeMode);
        const firstDataRow = headerRow.number + 1;
        let lastExcelSection = '';

        for (let i = 0; i < exportExcelRows.length; i++) {
            const row = exportExcelRows[i];

            if (row.sectionLabel && row.sectionLabel !== lastExcelSection) {
                lastExcelSection = row.sectionLabel;
                const secRow = ws.addRow([row.sectionLabel]);
                secRow.height = 24;
                ws.mergeCells(secRow.number, 1, secRow.number, header.length);
                const secCell = secRow.getCell(1);
                secCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF3C7' } };
                secCell.font = { bold: true, size: 11, color: { argb: '0F3E67' } };
                secCell.alignment = { vertical: 'middle', horizontal: 'left' };
                secCell.border = {
                    top: { style: 'thin', color: { argb: 'F59E0B' } },
                    bottom: { style: 'thin', color: { argb: 'F59E0B' } }
                };
            }

            const brandName = (row.selectedBrand || '').replace(/Explore collections by/i, '').trim();

            const qtyStr = String(row.qty || '').trim();
            const cleanQty = qtyStr.replace(/[^0-9.-]/g, '');
            const parsedQty = parseFloat(cleanQty);
            const qtyVal = isNaN(parsedQty) ? '' : parsedQty;

            const rateStr = String(row.rate || '').trim();
            const cleanRate = rateStr.replace(/[^0-9.-]/g, '');
            const parsedRate = parseFloat(cleanRate);
            const rateVal = isNaN(parsedRate) ? '' : parsedRate;

            const dataRow = isBoqMode
                ? [
                    row.sn,
                    row.location || '-',
                    row.scope || '-',
                    '',
                    row.description || '',
                    '',
                    row.brandDesc || '',
                    qtyVal,
                    row.unit || '',
                    rateVal,
                    '' // amount placeholder
                ]
                : [
                    row.sn,
                    row.location || '-',
                    row.scope || '-',
                    '',
                    row.brandDesc || '',
                    qtyVal,
                    row.unit || '',
                    rateVal,
                    '' // amount placeholder
                ];

            const excelRow = ws.addRow(dataRow);
            const rowNumber = excelRow.number;
            const longestText = Math.max(String(row.description || '').length, String(row.brandDesc || '').length);
            const estLines = Math.max(2, Math.ceil(longestText / (isBoqMode ? 36 : 52)));
            const rowH = Math.max(76, Math.min(200, estLines * 14.5 + 10));
            excelRow.height = rowH;

            const qtyColLetter = isBoqMode ? 'H' : 'F';
            const rateColLetter = isBoqMode ? 'J' : 'H';
            excelRow.getCell(amountColNum).value = {
                formula: `${qtyColLetter}${rowNumber}*${rateColLetter}${rowNumber}`,
                result: (typeof qtyVal === 'number' && typeof rateVal === 'number') ? qtyVal * rateVal : 0
            };

            const zebraBg = i % 2 === 1 ? 'F8FAFC' : 'FFFFFF';
            excelRow.eachCell((cell, colNumber) => {
                cell.font = { name: 'Calibri', size: 10, color: { argb: '1E293B' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebraBg } };
                cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
                cell.border = {
                    top: { style: 'thin', color: { argb: 'E2E8F0' } },
                    bottom: { style: 'thin', color: { argb: 'E2E8F0' } },
                    left: { style: 'thin', color: { argb: 'E2E8F0' } },
                    right: { style: 'thin', color: { argb: 'E2E8F0' } }
                };
                if (colNumber === qtyColNum) {
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                    cell.numFmt = '#,##0';
                } else if (colNumber === rateColNum || colNumber === amountColNum) {
                    cell.alignment = { vertical: 'middle', horizontal: 'right' };
                    cell.numFmt = '#,##0.00';
                } else if ([2, 3, 5, 7].includes(colNumber)) {
                    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
                }
            });

            if (isBoqMode && row.imageRef) {
                try {
                    const refUrl = getFullUrl(row.imageRef);
                    const imgData = await getImageData(refUrl, { maxWidth: 800, format: 'image/jpeg', quality: 0.95 });
                    if (imgData) {
                        const imageId = workbook.addImage({
                            base64: imgData.dataUrl.split(',')[1],
                            extension: 'jpeg'
                        });
                        const fit = calcFitSize(imgData.width, imgData.height, 100, 70);
                        const colWidthPx = 15 * 7.5;
                        const colOffset = Math.max(0, (colWidthPx - fit.w) / 2) / colWidthPx;
                        const fitHPoints = fit.h * 0.75;
                        const rowOffset = Math.max(0, (75 - fitHPoints) / 2) / 75;
                        ws.addImage(imageId, {
                            tl: { col: 3 + colOffset, row: rowNumber - 1 + rowOffset },
                            ext: { width: fit.w, height: fit.h }
                        });
                    }
                } catch (e) { console.log('Ref image error:', e); }
            }

            const brandImgCol = isBoqMode ? 5 : 3;

            if (row.brandLogo) {
                try {
                    const logoData = await getImageData(row.brandLogo, { maxWidth: 400, format: 'image/png' });
                    if (logoData) {
                        const logoId = workbook.addImage({
                            base64: logoData.dataUrl.split(',')[1],
                            extension: 'png'
                        });
                        const logoFit = calcFitSize(logoData.width, logoData.height, 60, 20);
                        const colWidthPx = 18 * 7.5;
                        const colOffset = Math.max(0, (colWidthPx - logoFit.w) / 2) / colWidthPx;
                        ws.addImage(logoId, {
                            tl: { col: brandImgCol + colOffset, row: rowNumber - 1 + 0.05 },
                            ext: { width: logoFit.w, height: logoFit.h }
                        });
                    }
                } catch (e) { console.log('Logo error:', e); }
            }

            if (row.brandImage) {
                try {
                    const brandImgData = await getImageData(row.brandImage, { maxWidth: 800, format: 'image/jpeg', quality: 0.95 });
                    if (brandImgData) {
                        const brandId = workbook.addImage({
                            base64: brandImgData.dataUrl.split(',')[1],
                            extension: 'jpeg'
                        });
                        const imgFit = calcFitSize(brandImgData.width, brandImgData.height, 120, 50);
                        const colWidthPx = 18 * 7.5;
                        const colOffset = Math.max(0, (colWidthPx - imgFit.w) / 2) / colWidthPx;
                        ws.addImage(brandId, {
                            tl: { col: brandImgCol + colOffset, row: rowNumber - 1 + 0.3 },
                            ext: { width: imgFit.w, height: imgFit.h }
                        });
                    }
                } catch (e) { console.log('Brand image error:', e); }
            }
        }

        const subtotal = exportExcelRows.reduce((sum, row) => {
            const qtyStr = String(row.qty || '').trim();
            const cleanQty = qtyStr.replace(/[^0-9.-]/g, '');
            const parsedQty = parseFloat(cleanQty);
            const qtyVal = isNaN(parsedQty) ? 0 : parsedQty;

            const rateStr = String(row.rate || '').trim();
            const cleanRate = rateStr.replace(/[^0-9.-]/g, '');
            const parsedRate = parseFloat(cleanRate);
            const rateVal = isNaN(parsedRate) ? 0 : parsedRate;

            return sum + (qtyVal * rateVal);
        }, 0);
        const vatAmount = subtotal * ((costingFactors.vat || 0) / 100);
        const grandTotal = subtotal + vatAmount;

        const lastDataRow = ws.lastRow ? ws.lastRow.number : firstDataRow;
        ws.addRow([]);
        const valColNum = amountColNum;
        const labelColNum = rateColNum;

        const stRow = ws.addRow([]);
        stRow.getCell(labelColNum).value = 'Subtotal';
        stRow.getCell(valColNum).value = {
            formula: `SUM(${amountLetter}${firstDataRow}:${amountLetter}${lastDataRow})`,
            result: subtotal
        };
        stRow.getCell(valColNum).numFmt = '#,##0.00 " ' + costingFactors.toCurrency + '"';
        stRow.getCell(labelColNum).font = { bold: true };
        stRow.getCell(labelColNum).alignment = { horizontal: 'right' };
        stRow.getCell(valColNum).alignment = { horizontal: 'right' };

        const vRow = ws.addRow([]);
        vRow.getCell(labelColNum).value = `VAT (${costingFactors.vat}%)`;
        vRow.getCell(valColNum).value = {
            formula: `${amountLetter}${stRow.number}*${costingFactors.vat}/100`,
            result: vatAmount
        };
        vRow.getCell(valColNum).numFmt = '#,##0.00 " ' + costingFactors.toCurrency + '"';
        vRow.getCell(labelColNum).font = { bold: true };
        vRow.getCell(labelColNum).alignment = { horizontal: 'right' };
        vRow.getCell(valColNum).alignment = { horizontal: 'right' };

        const gtRow = ws.addRow([]);
        gtRow.getCell(labelColNum).value = 'GRAND TOTAL';
        gtRow.getCell(valColNum).value = {
            formula: `${amountLetter}${stRow.number}+${amountLetter}${vRow.number}`,
            result: grandTotal
        };
        gtRow.getCell(valColNum).numFmt = '#,##0.00 " ' + costingFactors.toCurrency + '"';
        gtRow.height = 30;

        [gtRow.getCell(labelColNum), gtRow.getCell(valColNum)].forEach(cell => {
            cell.font = { name: 'Calibri', bold: true, size: 13, color: { argb: 'FFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: primaryArgb } };
            cell.alignment = { vertical: 'middle', horizontal: 'right' };
            cell.border = {
                top: { style: 'medium', color: { argb: accentArgb } },
                bottom: { style: 'medium', color: { argb: accentArgb } },
                left: { style: 'medium', color: { argb: accentArgb } },
                right: { style: 'medium', color: { argb: accentArgb } }
            };
        });

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const { saveAs } = await import('file-saver');
        saveAs(blob, `MultiBudget_${activeTier}_Offer.xlsx`);
    };

    const handleExportPPTX = async () => {
        const tier = tierData[activeTier];
        if (!tier || !tier.rows.length) return alert('No data to export');

        const PptxGenJS = (await import('pptxgenjs')).default;
        const pres = new PptxGenJS();
        const isBoqMode = tier.mode === 'boq';

        const brandPalette = getBrandColors(accentColor, secondaryColor);
        const colors = {
            primary: brandPalette.primary || '0F3E67',
            accent: brandPalette.accent || 'F5A623',
            text: brandPalette.text || '2D3748',
            lightText: brandPalette.lightText || '718096',
            lightBg: brandPalette.lightBg || 'F7FAFC',
            white: 'FFFFFF',
            border: brandPalette.border || 'E2E8F0'
        };

        pres.defineSlideMaster({
            title: 'PREMIUM_MASTER',
            background: { color: colors.white },
            objects: []
        });

        const drawSlideDecorations = (slideObj) => {
            slideObj.addShape('rect', { x: 0, y: 0, w: '100%', h: 0.75, fill: { color: colors.primary } });
            slideObj.addShape('rect', { x: 0, y: 0.75, w: '100%', h: 0.06, fill: { color: colors.accent } });
            slideObj.addShape('rect', { x: 0, y: 5.2, w: '100%', h: 0.3, fill: { color: colors.lightBg } });
        };

        const titleSlide = pres.addSlide({ masterName: 'PREMIUM_MASTER' });
        drawSlideDecorations(titleSlide);
        titleSlide.addText('PROJECT PROPOSAL', {
            x: 0.3, y: 0.2, w: 4, h: 0.4, fontSize: 14, bold: true, color: colors.white
        });

        titleSlide.addShape('rect', {
            x: 0, y: 1.5, w: '100%', h: 2.5, fill: { color: colors.lightBg }
        });

        titleSlide.addText(`Multi-Budget Offer`, {
            x: 1, y: 1.8, w: 8, h: 0.6, fontSize: 36, bold: true, color: colors.primary, align: 'center'
        });
        titleSlide.addText(`${activeTier.toUpperCase()} TIER`, {
            x: 1, y: 2.4, w: 8, h: 0.5, fontSize: 24, color: colors.accent, align: 'center', bold: true
        });

        const projName = planPreviewName || 'Standard Project';
        titleSlide.addText(`Project: ${projName}`, {
            x: 1, y: 3.2, w: 8, h: 0.3, fontSize: 14, color: colors.text, align: 'center'
        });
        titleSlide.addText(`Date: ${new Date().toLocaleDateString()} | Reference: BOQ-${Math.floor(1000 + Math.random() * 9000)}`, {
            x: 1, y: 3.5, w: 8, h: 0.3, fontSize: 11, color: colors.lightText, align: 'center'
        });

        const titleSlideLogo = logoWhite || logoOriginal || logoBlue;
        if (titleSlideLogo) {
            try {
                const logoImg = await getImageData(titleSlideLogo, { format: 'image/png', maxWidth: 400 });
                if (logoImg) {
                    const fit = calcFitSize(logoImg.width, logoImg.height, 1.3 * 96, 0.45 * 96);
                    const fitW = fit.w / 96;
                    const fitH = fit.h / 96;
                    titleSlide.addImage({
                        data: logoImg.dataUrl,
                        x: 8.4 + (1.3 - fitW) / 2, y: 0.15 + (0.45 - fitH) / 2, w: fitW, h: fitH
                    });
                }
            } catch (e) { }
        }

        let coverLogoImg = null;
        if (titleSlideLogo) {
            try {
                coverLogoImg = await getImageData(titleSlideLogo, { format: 'image/png', maxWidth: 400 });
            } catch (e) { }
        }

        const pptxRows = recategorizeBoqRows(
            tier.rows.filter(r => r.brandImage || r.brandDesc),
            recategorizeMode
        );
        let itemNum = 1;
        let lastPptxSection = '';
        for (let rIdx = 0; rIdx < pptxRows.length; rIdx++) {
            const row = pptxRows[rIdx];
            if (row.sectionLabel && row.sectionLabel !== lastPptxSection) {
                lastPptxSection = row.sectionLabel;
                const secRows = pptxRows.filter(x => x.sectionLabel === lastPptxSection);
                const divMeta = resolveSectionDividerMeta(secRows, lastPptxSection);
                addPptxCategoryDividerSlide(pres, {
                    masterName: 'PREMIUM_MASTER',
                    categoryTitle: divMeta.categoryTitle,
                    subheaderTitle: divMeta.subheaderTitle,
                    itemCount: divMeta.itemCount,
                    colors,
                    drawSlideDecorations,
                    logoData: coverLogoImg,
                    calcFitSize,
                    projectName: projName
                });
            }

            const slide = pres.addSlide({ masterName: 'PREMIUM_MASTER' });
            drawSlideDecorations(slide);
            const brandName = (row.selectedBrand || '').replace(/Explore collections by/i, '').trim();

            const descForHeader = (row.brandDesc || '');
            const firstLineHeader = descForHeader.split(/[\n*•]/)[0].trim();
            const headerTitle = firstLineHeader.length > 45 ? firstLineHeader.substring(0, 42) + '...' : firstLineHeader;

            slide.addText(`Item ${itemNum}: ${headerTitle}`, {
                x: 0.3, y: 0.1, w: 7.5, h: 0.38, fontSize: 12, bold: true, color: colors.white, valign: 'middle'
            });
            if (row.submissionTitle) {
                slide.addText(row.submissionTitle, {
                    x: 0.3, y: 0.46, w: 7.5, h: 0.22, fontSize: 8.5, bold: true, color: colors.accent
                });
            }

            const slideLogo = logoWhite || logoOriginal || logoBlue;
            if (slideLogo) {
                try {
                    const logoImg = await getImageData(slideLogo, { format: 'image/png', maxWidth: 400 });
                    if (logoImg) {
                        const fit = calcFitSize(logoImg.width, logoImg.height, 1.3 * 96, 0.45 * 96);
                        const fitW = fit.w / 96;
                        const fitH = fit.h / 96;
                        slide.addImage({
                            data: logoImg.dataUrl,
                            x: 8.4 + (1.3 - fitW) / 2, y: 0.15 + (0.45 - fitH) / 2, w: fitW, h: fitH
                        });
                    }
                } catch (e) { }
            }

            const leftX = 0.3;
            let leftY = 1.0;
            const leftWidth = 4.5;

            if (isBoqMode && row.imageRef) {
                const refUrl = getFullUrl(row.imageRef);
                try {
                    const refImg = await getImageData(refUrl);
                    if (refImg) {
                        slide.addText('Reference Image', { x: leftX, y: leftY, w: 1.5, h: 0.2, fontSize: 8, color: colors.lightText });
                        slide.addShape('rect', {
                            x: leftX, y: leftY + 0.2, w: 1.4, h: 1.0,
                            fill: { color: colors.lightBg }, line: { color: colors.border, pt: 0.5 }
                        });
                        slide.addImage({ data: refImg.dataUrl, x: leftX + 0.05, y: leftY + 0.25, w: 1.3, h: 0.9, sizing: { type: 'contain', w: 1.3, h: 0.9 } });
                        leftY += 1.35;
                    }
                } catch (e) { }
            }

            if (brandName) {
                slide.addShape('roundRect', {
                    x: leftX, y: leftY, w: 2.5, h: 0.4,
                    fill: { color: colors.lightBg }, line: { color: colors.primary, pt: 1 }
                });
                slide.addText(brandName.substring(0, 22), {
                    x: leftX + 0.15, y: leftY + 0.08, w: 2.3, h: 0.25, fontSize: 10, bold: true, color: colors.primary, align: 'center'
                });
                leftY += 0.5;
            }

            if (row.brandLogo) {
                try {
                    const brandLogoImg = await getImageData(row.brandLogo);
                    if (brandLogoImg) {
                        slide.addImage({
                            data: brandLogoImg.dataUrl,
                            x: leftX + (leftWidth - 1.0) / 2, y: leftY - 0.1,
                            w: 1.0, h: 0.35, sizing: { type: 'contain', w: 1.0, h: 0.35 }
                        });
                        leftY += 0.3;
                    }
                } catch (e) { }
            }

            const imgContainerH = 3.0;
            slide.addShape('rect', {
                x: leftX, y: leftY, w: leftWidth, h: imgContainerH,
                fill: { color: colors.white }, line: { color: colors.border, pt: 1 }
            });

            if (row.brandImage) {
                try {
                    const brandImg = await getImageData(row.brandImage);
                    if (brandImg) {
                        const maxW = (leftWidth - 0.2) * 96;
                        const maxH = (imgContainerH - 0.2) * 96;
                        const fit = calcFitSize(brandImg.width, brandImg.height, maxW, maxH);
                        const imgW = fit.w / 96;
                        const imgH = fit.h / 96;
                        const imgX = leftX + (leftWidth - imgW) / 2;
                        const imgY = leftY + (imgContainerH - imgH) / 2;
                        slide.addImage({ data: brandImg.dataUrl, x: imgX, y: imgY, w: imgW, h: imgH });
                    }
                } catch (e) { }
            }

            const rightX = 5.0;
            let rightY = 1.0;
            const rightWidth = 4.7;

            slide.addText('Product Details', {
                x: rightX, y: rightY, w: rightWidth, h: 0.35, fontSize: 16, bold: true, color: colors.primary
            });
            rightY += 0.45;

            slide.addShape('line', {
                x: rightX, y: rightY, w: rightWidth, h: 0,
                line: { color: colors.accent, pt: 2 }
            });
            rightY += 0.15;

            slide.addText('Description:', {
                x: rightX, y: rightY, w: rightWidth, h: 0.25, fontSize: 10, bold: true, color: colors.primary
            });
            rightY += 0.25;

            const fullDescription = (row.brandDesc || 'N/A').trim();
            const maxDescY = 4.7;
            const availableH = maxDescY - rightY;
            const estDescLines = Math.ceil(fullDescription.length / 55) + (fullDescription.match(/[\n*•]/g) || []).length;
            const descBoxHeight = Math.min(availableH, Math.max(0.4, estDescLines * 0.14));

            slide.addText(fullDescription, {
                x: rightX, y: rightY, w: rightWidth, h: descBoxHeight,
                fontSize: 9, color: colors.text, valign: 'top',
                wrap: true, shrinkText: true
            });
            rightY += descBoxHeight + 0.08;

            // Brand and Qty side-by-side above the footer
            const footerY = 4.65;
            slide.addText('Brand:', {
                x: rightX, y: footerY, w: 0.75, h: 0.35, fontSize: 9, bold: true, color: colors.primary, valign: 'middle'
            });
            slide.addText(brandName || 'N/A', {
                x: rightX + 0.75, y: footerY, w: 1.65, h: 0.35, fontSize: 9, color: colors.text, valign: 'middle'
            });

            slide.addText('Qty:', {
                x: rightX + 2.5, y: footerY, w: 0.5, h: 0.35, fontSize: 9, bold: true, color: colors.primary, valign: 'middle'
            });
            slide.addText(String(row.qty || 'As per BOQ'), {
                x: rightX + 3.0, y: footerY, w: 1.7, h: 0.35, fontSize: 9, color: colors.text, valign: 'middle'
            });

            slide.addText('Warranty', {
                x: 0.3, y: 4.65, w: 1.0, h: 0.2, fontSize: 9, bold: true, color: colors.primary
            });
            slide.addText('As per manufacturer - 5 years', {
                x: 0.3, y: 4.85, w: 2.0, h: 0.18, fontSize: 8, color: colors.lightText
            });

            slide.addText(`${itemNum} / ${tier.rows.filter(r => r.brandImage || r.brandDesc).length}`, {
                x: 9, y: 5.25, w: 0.8, h: 0.2, fontSize: 8, color: colors.lightText, align: 'right'
            });

            itemNum++;
        }

        const subtotal = tier.rows.reduce((sum, row) => sum + (parseFloat(row.qty || 0) * parseFloat(row.rate || 0)), 0);
        const vatAmount = subtotal * ((costingFactors.vat || 0) / 100);
        const grandTotal = subtotal + vatAmount;
        const formatCurr = (val) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);

        const summarySlide = pres.addSlide({ masterName: 'PREMIUM_MASTER' });
        drawSlideDecorations(summarySlide);
        summarySlide.addText('OFFER SUMMARY', {
            x: 0.3, y: 0.2, w: 4, h: 0.4, fontSize: 14, bold: true, color: colors.white
        });

        summarySlide.addText('Financial Overview', {
            x: 0.5, y: 1.2, w: 5, h: 0.5, fontSize: 24, bold: true, color: colors.primary
        });

        summarySlide.addShape('rect', {
            x: 0.5, y: 1.8, w: 9, h: 2.5, fill: { color: colors.lightBg }, line: { color: colors.border, pt: 1 }
        });

        const summaryItems = [
            { label: 'Subtotal:', value: `${formatCurr(subtotal)} ${costingFactors.toCurrency}`, bold: false },
            { label: `VAT (${costingFactors.vat}%):`, value: `${formatCurr(vatAmount)} ${costingFactors.toCurrency}`, bold: false },
            { label: 'GRAND TOTAL:', value: `${formatCurr(grandTotal)} ${costingFactors.toCurrency}`, bold: true, color: colors.primary, size: 20 }
        ];

        let summY = 2.2;
        summaryItems.forEach(item => {
            summarySlide.addText(item.label, {
                x: 1.0, y: summY, w: 3, h: 0.4, fontSize: item.size || 14, bold: item.bold, color: colors.text
            });
            summarySlide.addText(item.value, {
                x: 4.5, y: summY, w: 4.5, h: 0.4, fontSize: item.size || 14, bold: item.bold, color: item.color || colors.text, align: 'right'
            });
            summY += item.bold ? 0.7 : 0.5;
        });

        summarySlide.addText('Terms & Conditions:', {
            x: 0.5, y: 4.4, w: 4, h: 0.2, fontSize: 9, bold: true, color: colors.text
        });
        summarySlide.addText('• This offer is valid for 15 days.\n• Prices include delivery and installation unless otherwise stated.', {
            x: 0.5, y: 4.6, w: 5, h: 0.4, fontSize: 8, color: colors.lightText
        });

        if (website) {
            summarySlide.addText(`Visit us at: ${website}`, {
                x: 6, y: 4.6, w: 3.5, h: 0.3, fontSize: 10, color: colors.primary, align: 'right', bold: true
            });
        }

        pres.writeFile({ fileName: `MultiBudget_${activeTier}_Presentation.pptx` });
    };

    const handleExportPresentationPDF = async () => {
        const tier = tierData[activeTier];
        if (!tier || !tier.rows.length) return alert('No data to export');

        const doc = new jsPDF({ orientation: 'landscape' });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();

        const arabicLoaded = await loadArabicFont(doc);
        const processText = (txt) => (arabicLoaded && hasArabic(txt)) ? fixArabic(txt) : String(txt || '');
        const isBoqMode = tier.mode === 'boq';
        const totalItems = tier.rows.filter(r => r.brandImage || r.brandDesc).length;

        const colors = {
            primary: [30, 95, 168],
            accent: [245, 166, 35],
            text: [45, 55, 72],
            lightText: [113, 128, 150],
            lightBg: [247, 250, 252],
            white: [255, 255, 255],
            border: [226, 232, 240]
        };

        const presPdfRows = recategorizeBoqRows(
            tier.rows.filter(r => r.brandImage || r.brandDesc),
            recategorizeMode
        );
        const presPdfLogoUrl = logoWhite || logoOriginal || logoBlue;
        let presPdfLogoData = null;
        if (presPdfLogoUrl) {
            try { presPdfLogoData = await getImageData(presPdfLogoUrl, { format: 'image/png', maxWidth: 400 }); } catch { }
        }

        let itemNum = 1;
        let pdfPageStarted = false;
        let lastPresSection = '';

        for (const row of presPdfRows) {
            if (row.sectionLabel && row.sectionLabel !== lastPresSection) {
                lastPresSection = row.sectionLabel;
                const secRows = presPdfRows.filter(x => x.sectionLabel === lastPresSection);
                const divMeta = resolveSectionDividerMeta(secRows, lastPresSection);
                if (pdfPageStarted) doc.addPage();
                pdfPageStarted = true;
                drawPdfCategoryDividerPage(doc, {
                    categoryTitle: divMeta.categoryTitle,
                    subheaderTitle: divMeta.subheaderTitle,
                    itemCount: divMeta.itemCount,
                    submissionType: 'PRODUCT PRESENTATION',
                    project: { projectName: planPreviewName || '' },
                    companyName: profile?.companyName || '',
                    colors,
                    headerLogoData: presPdfLogoData,
                    calcFitSize,
                    processText
                });
            }

            if (pdfPageStarted) doc.addPage();
            pdfPageStarted = true;
            const brandName = (row.selectedBrand || '').replace(/Explore collections by/i, '').trim();

            doc.setFillColor(...colors.primary);
            doc.rect(0, 0, pageWidth, 55, 'F');
            doc.setFillColor(...colors.accent);
            doc.rect(0, 55, pageWidth, 2.5, 'F');

            doc.setTextColor(...colors.white);
            doc.setFontSize(11);
            doc.setFont(arabicLoaded ? 'Almarai' : 'helvetica', 'bold');
            const fullTitle = `Item ${itemNum}: ${row.brandDesc || ''}`;
            const titleLines = doc.splitTextToSize(processText(fullTitle), pageWidth - 90);
            let currentTitleY = 22;
            titleLines.slice(0, 2).forEach(tl => {
                doc.text(tl, 10, currentTitleY);
                currentTitleY += 8;
            });
            if (row.submissionTitle) {
                doc.setTextColor(...colors.accent);
                doc.setFontSize(9);
                doc.text(processText(row.submissionTitle), 10, 48);
            }

            const presentationLogo = logoWhite || logoOriginal || logoBlue;
            if (presentationLogo) {
                try {
                    const docLogo = await getImageData(presentationLogo, { format: 'image/png', maxWidth: 400 });
                    if (docLogo) {
                        const fit = calcFitSize(docLogo.width, docLogo.height, 80, 28);
                        doc.addImage(docLogo.dataUrl, 'PNG', pageWidth - fit.w - 10, 8, fit.w, fit.h);
                    }
                } catch (e) { }
            }

            const leftX = 10;
            let leftY = 62;
            const leftWidth = 120;

            if (isBoqMode && row.imageRef) {
                const refUrl = getFullUrl(row.imageRef);
                try {
                    const refImg = await getImageData(refUrl, { maxWidth: 600, format: 'image/jpeg', quality: 0.9 });
                    if (refImg) {
                        doc.setTextColor(...colors.lightText);
                        doc.setFontSize(7);
                        doc.setFont('helvetica', 'normal');
                        doc.text('Reference Image', leftX, leftY);
                        leftY += 2;

                        doc.setFillColor(...colors.lightBg);
                        doc.setDrawColor(...colors.border);
                        doc.rect(leftX, leftY, 35, 25, 'FD');
                        const fit = calcFitSize(refImg.width, refImg.height, 31, 21);
                        const refX = leftX + (35 - fit.w) / 2;
                        const refY = leftY + (25 - fit.h) / 2;
                        doc.addImage(refImg.dataUrl, 'JPEG', refX, refY, fit.w, fit.h);
                        leftY += 30;
                    }
                } catch (e) { }
            }

            if (brandName) {
                doc.setFillColor(...colors.lightBg);
                doc.setDrawColor(...colors.primary);
                doc.setLineWidth(0.5);
                doc.rect(leftX, leftY, 60, 12, 'FD');

                doc.setTextColor(...colors.primary);
                doc.setFontSize(9);
                doc.setFont('helvetica', 'bold');
                doc.text(brandName.substring(0, 30), leftX + 30, leftY + 7.5, { align: 'center' });
                leftY += 15;
            }

            const imgContainerW = leftWidth;
            if (row.brandLogo) {
                try {
                    const brandLogoImg = await getImageData(row.brandLogo, { maxWidth: 400, format: 'image/png' });
                    if (brandLogoImg) {
                        const fit = calcFitSize(brandLogoImg.width, brandLogoImg.height, 30, 12);
                        const logoX = leftX + (imgContainerW - fit.w) / 2;
                        doc.addImage(brandLogoImg.dataUrl, 'PNG', logoX, leftY - 12, fit.w, fit.h);
                    }
                } catch (e) { }
            }

            const imgContainerH = isBoqMode ? 100 : 130;
            doc.setFillColor(...colors.white);
            doc.setDrawColor(...colors.border);
            doc.setLineWidth(0.5);
            doc.rect(leftX, leftY, imgContainerW, imgContainerH, 'FD');

            if (row.brandImage) {
                try {
                    const brandImg = await getImageData(row.brandImage, { maxWidth: 1000, format: 'image/jpeg', quality: 0.95 });
                    if (brandImg) {
                        const fit = calcFitSize(brandImg.width, brandImg.height, imgContainerW - 8, imgContainerH - 8);
                        const imgX = leftX + (imgContainerW - fit.w) / 2;
                        const imgY = leftY + (imgContainerH - fit.h) / 2;
                        doc.addImage(brandImg.dataUrl, 'JPEG', imgX, imgY, fit.w, fit.h);
                    }
                } catch (e) { }
            }

            const rightX = 145;
            let rightY = 28;
            const rightWidth = 135;

            doc.setTextColor(...colors.primary);
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.text('Product Details', rightX, rightY);
            rightY += 4;

            doc.setFillColor(...colors.accent);
            doc.rect(rightX, rightY, 50, 1.5, 'F');
            rightY += 8;

            doc.setTextColor(...colors.text);
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.text('Description:', rightX, rightY);
            rightY += 5;

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            const descLines = doc.splitTextToSize(processText(row.brandDesc || 'N/A'), rightWidth - 5);
            const displayLines = descLines.slice(0, 12);

            displayLines.forEach((line) => {
                doc.text(line, rightX, rightY);
                rightY += 7;
            });
            rightY += 6;

            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.text('Brand:', rightX, rightY);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...colors.primary);
            doc.text(brandName || 'N/A', rightX + 22, rightY);
            rightY += 10;

            doc.setTextColor(...colors.text);
            doc.setFont('helvetica', 'bold');
            doc.text('Quantity:', rightX, rightY);
            doc.setFont('helvetica', 'normal');
            doc.text(String(row.qty || 'As per BOQ'), rightX + 22, rightY);
            rightY += 14;

            doc.setTextColor(...colors.primary);
            doc.setFont('helvetica', 'bold');
            doc.text('Specifications:', rightX, rightY);
            rightY += 6;

            doc.setTextColor(...colors.text);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            const presentationSpecs = [
                '• Warranty: As per manufacturer',
                '• Installation: Professional installation included',
                '• Returns: Subject to terms and conditions'
            ];
            presentationSpecs.forEach((spec) => {
                doc.text(spec, rightX + 3, rightY);
                rightY += 5.5;
            });
            rightY += 4;

            doc.setFillColor(...colors.lightBg);
            doc.rect(0, pageHeight - 12, pageWidth, 12, 'F');

            doc.setTextColor(...colors.text);
            doc.setFontSize(8);
            doc.setFont('helvetica', 'bold');
            doc.text('Warranty', 10, pageHeight - 6);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...colors.lightText);
            doc.text('As per manufacturer - 5 years', 10, pageHeight - 2);

            doc.setTextColor(...colors.lightText);
            doc.setFontSize(8);
            doc.text(`${itemNum} / ${totalItems}`, pageWidth - 20, pageHeight - 4);
            const footVal = profile.website || profile.companyName || 'BOQ FLOW';
            const footIsAr = hasArabic(footVal);
            doc.setFont(footIsAr && arabicLoaded ? 'Almarai' : 'helvetica', 'normal');
            doc.text(footIsAr ? fixArabic(footVal) : footVal, pageWidth / 2, pageHeight - 4, { align: 'center' });

            itemNum++;
        }

        doc.save(`MultiBudget_${activeTier}_Presentation.pdf`);
    };

    const handleExportMAS = async () => {
        const tier = tierData[activeTier];
        if (!tier || !tier.rows.length) return alert('No data to export');

        const doc = new jsPDF();
        const arabicLoaded = await loadArabicFont(doc);
        const processText = (txt) => (arabicLoaded && hasArabic(txt)) ? fixArabic(txt) : String(txt || '');

        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const isBoqMode = tier.mode === 'boq';
        const totalItems = tier.rows.filter(r => r.brandImage || r.brandDesc).length;

        const brandPalette = getBrandColors(accentColor, secondaryColor);
        const colors = {
            primary: brandPalette.primaryRgb,
            accent: brandPalette.accentRgb,
            text: brandPalette.textRgb,
            lightText: brandPalette.lightTextRgb,
            lightBg: brandPalette.lightBgRgb,
            white: [255, 255, 255],
            border: brandPalette.borderRgb,
            success: [16, 185, 129]
        };

        const masRows = recategorizeBoqRows(
            tier.rows.filter(r => r.brandImage || r.brandDesc),
            recategorizeMode
        );
        const masHeaderLogoUrl = logoOriginal || logoBlue || logoWhite;
        let masHeaderLogoData = null;
        if (masHeaderLogoUrl) {
            try { masHeaderLogoData = await getImageData(masHeaderLogoUrl, { format: 'image/png', maxWidth: 400 }); } catch { }
        }

        let itemNum = 1;
        let masPageStarted = false;
        let lastMasSection = '';

        for (const row of masRows) {
            if (row.sectionLabel && row.sectionLabel !== lastMasSection) {
                lastMasSection = row.sectionLabel;
                const secRows = masRows.filter(x => x.sectionLabel === lastMasSection);
                const divMeta = resolveSectionDividerMeta(secRows, lastMasSection);
                if (masPageStarted) doc.addPage();
                masPageStarted = true;
                drawPdfCategoryDividerPage(doc, {
                    categoryTitle: divMeta.categoryTitle,
                    subheaderTitle: divMeta.subheaderTitle,
                    itemCount: divMeta.itemCount,
                    submissionType: 'MATERIAL APPROVAL SHEET (MAS)',
                    project: { projectName: planPreviewName || '' },
                    companyName: profile?.companyName || '',
                    colors,
                    headerLogoData: masHeaderLogoData,
                    calcFitSize,
                    processText
                });
            }

            if (masPageStarted) doc.addPage();
            masPageStarted = true;
            const brandName = (row.selectedBrand || '').replace(/Explore collections by/i, '').trim();

            doc.setFillColor(...colors.primary);
            doc.rect(0, 0, pageWidth, 45, 'F');
            doc.setFillColor(...colors.accent);
            doc.rect(0, 45, pageWidth, 2, 'F');

            doc.setTextColor(...colors.white);
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.text('MATERIAL APPROVAL SHEET', pageWidth / 2, 28, { align: 'center' });

            const masLogo = logoOriginal || logoBlue || logoWhite;
            if (masLogo) {
                try {
                    const docLogo = await getImageData(masLogo, { format: 'image/png', maxWidth: 400 });
                    if (docLogo) {
                        const fit = calcFitSize(docLogo.width, docLogo.height, 80, 28);
                        doc.addImage(docLogo.dataUrl, 'PNG', pageWidth - fit.w - 10, 8, fit.w, fit.h);
                    }
                } catch (e) { }
            }

            doc.setFillColor(...colors.lightBg);
            doc.rect(0, 47, pageWidth, 14, 'F');
            doc.setDrawColor(...colors.border);
            doc.line(0, 61, pageWidth, 61);

            doc.setTextColor(...colors.text);
            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            doc.text(`Document No: MAS-${String(itemNum).padStart(3, '0')}`, 10, 52);
            doc.text(`Date: ${new Date().toLocaleDateString()}`, 10, 57);
            doc.text(`Item: ${itemNum} of ${totalItems}`, pageWidth / 2, 52, { align: 'center' });
            doc.setFont('helvetica', 'bold');
            doc.text(`Brand: ${brandName || 'N/A'}`, pageWidth - 10, 54, { align: 'right' });

            let refImgOffset = 0;
            if (isBoqMode && row.imageRef) {
                const apiBase = getApiBase();
                const refUrl = row.imageRef.startsWith('http') ? row.imageRef : `${apiBase}${row.imageRef}`;
                try {
                    const refImg = await getImageData(refUrl);
                    if (refImg) {
                        doc.setTextColor(...colors.lightText);
                        doc.setFontSize(7);
                        doc.setFont('helvetica', 'normal');
                        doc.text('Reference:', pageWidth - 35, 64);

                        doc.setFillColor(...colors.lightBg);
                        doc.setDrawColor(...colors.border);
                        doc.roundedRect(pageWidth - 35, 66, 30, 22, 1, 1, 'FD');
                        const fit = calcFitSize(refImg.width, refImg.height, 28, 20);
                        const refX = pageWidth - 35 + (30 - fit.w) / 2;
                        const refY = 66 + (22 - fit.h) / 2;
                        doc.addImage(refImg.dataUrl, 'JPEG', refX, refY, fit.w, fit.h);
                    }
                } catch (e) { }
            }

            let imgY = 66;
            const imgContainerW = 90;
            const imgContainerH = 65;
            const imgContainerX = (pageWidth - imgContainerW) / 2 - (isBoqMode ? 15 : 0);

            let loadedBrandLogo = null;
            if (row.brandLogo) {
                try {
                    loadedBrandLogo = await getImageData(row.brandLogo, { format: 'image/png', maxWidth: 400 });
                } catch (e) { }
            }

            if (loadedBrandLogo || brandName) {
                const badgeW = 68;
                const badgeX = imgContainerX + (imgContainerW - badgeW) / 2;
                doc.setFillColor(...colors.white);
                doc.setDrawColor(...colors.primary);
                doc.setLineWidth(0.35);
                doc.roundedRect(badgeX, imgY, badgeW, 11, 2, 2, 'FD');

                if (loadedBrandLogo) {
                    const fit = calcFitSize(loadedBrandLogo.width, loadedBrandLogo.height, 44, 8);
                    const logoX = badgeX + (badgeW - fit.w) / 2;
                    const logoY = imgY + (11 - fit.h) / 2;
                    doc.addImage(loadedBrandLogo.dataUrl, 'PNG', logoX, logoY, fit.w, fit.h);
                } else {
                    doc.setTextColor(...colors.primary);
                    doc.setFontSize(8.5);
                    doc.setFont('helvetica', 'bold');
                    doc.text(brandName.substring(0, 35), badgeX + badgeW / 2, imgY + 7, { align: 'center' });
                }
                imgY += 13;
            }

            doc.setFillColor(...colors.white);
            doc.setDrawColor(...colors.border);
            doc.setLineWidth(0.5);
            doc.roundedRect(imgContainerX, imgY, imgContainerW, imgContainerH, 3, 3, 'FD');

            if (row.brandImage) {
                try {
                    const brandImg = await getImageData(row.brandImage);
                    if (brandImg) {
                        const fit = calcFitSize(brandImg.width, brandImg.height, imgContainerW - 8, imgContainerH - 8);
                        const imgX = imgContainerX + (imgContainerW - fit.w) / 2;
                        const imgYPos = imgY + (imgContainerH - fit.h) / 2;
                        doc.addImage(brandImg.dataUrl, 'JPEG', imgX, imgYPos, fit.w, fit.h);
                    }
                } catch (e) { }
            }
            imgY += imgContainerH + 8;

            autoTable(doc, {
                startY: imgY,
                margin: { left: 15, right: 15 },
                head: [[processText('Specification'), processText('Details')]],
                body: [
                    [processText('Product Description'), processText(row.brandDesc)],
                    [processText('Brand / Manufacturer'), processText(brandName)],
                    [processText('Quantity Required'), processText(row.qty)],
                    [processText('Unit Rate'), row.rate ? `${row.rate}` : 'TBD'],
                    [processText('Origin'), processText('As per manufacturer specification')],
                    [processText('Warranty Period'), processText('As per manufacturer standard warranty')],
                    [processText('Lead Time'), processText('Subject to confirmation')],
                    [processText('Installation'), processText('Professional installation included')]
                ],
                theme: 'plain',
                styles: {
                    fontSize: 9,
                    cellPadding: 4,
                    lineColor: colors.border,
                    lineWidth: 0.2,
                    font: arabicLoaded ? 'Almarai' : 'helvetica'
                },
                headStyles: {
                    fillColor: colors.primary,
                    textColor: colors.white,
                    fontStyle: 'bold',
                    fontSize: 10,
                    font: arabicLoaded ? 'Almarai' : 'helvetica',
                    cellPadding: 1.5,
                    minCellHeight: 7
                },
                bodyStyles: {
                    textColor: colors.text
                },
                columnStyles: {
                    0: { fontStyle: 'bold', cellWidth: 55, fillColor: colors.lightBg },
                    1: { cellWidth: 'auto' }
                },
                alternateRowStyles: {
                    fillColor: [255, 255, 255]
                }
            });

            let approvalY = doc.lastAutoTable.finalY + 10;
            if (approvalY + 32 > pageHeight - 12) {
                doc.addPage();
                approvalY = 24;
            }

            doc.setFillColor(...colors.lightBg);
            doc.rect(15, approvalY, pageWidth - 30, 30, 'F');
            doc.setDrawColor(...colors.border);
            doc.rect(15, approvalY, pageWidth - 30, 30, 'S');

            doc.setTextColor(...colors.primary);
            doc.setFontSize(9);
            doc.setFont('helvetica', 'bold');
            doc.text('APPROVAL SIGNATURES', 20, approvalY + 6);

            const boxWidth = (pageWidth - 50) / 3;
            const signatureLabels = ['Prepared By', 'Reviewed By', 'Approved By'];
            signatureLabels.forEach((label, i) => {
                const boxX = 20 + i * (boxWidth + 5);
                doc.setDrawColor(...colors.border);
                doc.rect(boxX, approvalY + 10, boxWidth, 16, 'S');
                doc.setTextColor(...colors.lightText);
                doc.setFontSize(7);
                doc.setFont('helvetica', 'normal');
                doc.text(label, boxX + 2, approvalY + 14);
                doc.text('Signature: ________________', boxX + 2, approvalY + 22);
            });

            doc.setFillColor(...colors.lightBg);
            doc.rect(0, pageHeight - 10, pageWidth, 10, 'F');

            doc.setTextColor(...colors.lightText);
            doc.setFontSize(7);
            doc.setFont('helvetica', 'normal');
            doc.text('Material Approval purposes only.', 10, pageHeight - 4);
            const masFoot = profile.website || profile.companyName || '';
            const masIsAr = hasArabic(masFoot);
            doc.setFont(masIsAr && arabicLoaded ? 'Almarai' : 'helvetica', 'normal');
            doc.text(`${masIsAr ? fixArabic(masFoot) : masFoot} | Page ${itemNum} of ${totalItems}`, pageWidth - 10, pageHeight - 4, { align: 'right' });

            itemNum++;
        }

        doc.save(`MultiBudget_${activeTier}_MAS.pdf`);
    };

    const renderTable = (tier) => {
        if (!tier) return null;
        const { rows, mode } = tier;
        const isBoqMode = mode === 'boq';

        const subtotal = rows.reduce((acc, row) => {
            const amount = parseFloat(row.amount || (parseFloat(row.qty || 0) * parseFloat(row.rate || 0)) || 0);
            return acc + (isNaN(amount) ? 0 : amount);
        }, 0);
        const vatAmount = subtotal * ((costingFactors.vat || 0) / 100);
        const grandTotal = subtotal + vatAmount;

        return (
            <table className={styles.budgetTable}>
                <thead>
                    <tr>
                        <th style={{ width: '40px', textAlign: 'center' }}>Sl</th>
                        {isBoqMode && <th style={{ width: '72px', textAlign: 'center' }}>Ref Img</th>}
                        {isBoqMode && <th style={{ width: '220px', textAlign: 'left' }}>Original Desc</th>}
                        <th style={{ width: '60px', textAlign: 'center' }}>Scope</th>
                        <th style={{ width: '80px', textAlign: 'center' }}>Brand Img</th>
                        <th style={{ width: '160px', textAlign: 'left' }}>Brand Desc</th>
                        <th style={{ width: '60px', textAlign: 'center' }}>Qty</th>
                        <th style={{ width: '60px', textAlign: 'center' }}>Unit</th>
                        <th style={{ width: '80px', textAlign: 'right' }}>Rate</th>
                        <th style={{ width: '90px', textAlign: 'right' }}>Amount</th>
                        <th style={{ width: '200px', textAlign: 'left' }}>Product Selection</th>
                        <th style={{ width: '40px', textAlign: 'center' }}>Action</th>
                    </tr>
                </thead>
                <tbody>
                    {(() => {
                        let displayRows = [...rows];

                        if (isConsolidated && recategorizeMode === 'item') {
                            const consolidated = {};
                            displayRows.forEach(row => {
                                const scopeValue = (row.scope || 'Furniture').trim().toLowerCase();
                                const key = (row.brandDesc || row.description || 'N/A').trim().toLowerCase() + '::' + scopeValue;
                                if (!consolidated[key]) {
                                    consolidated[key] = { ...row, qty: 0, location: 'Consolidated', id: `cons_${key}` };
                                }
                                consolidated[key].qty += parseFloat(row.qty || 0);
                            });
                            displayRows = Object.values(consolidated);
                        }

                        const groupedRows = recategorizeBoqRows(displayRows, recategorizeMode);

                        return groupedRows.map((row, gIdx) => {
                            const prevRow = gIdx > 0 ? groupedRows[gIdx - 1] : null;
                            const showSubheader = row.sectionLabel && (!prevRow || prevRow.sectionLabel !== row.sectionLabel);
                            let originalIndex = -1;
                            if (isConsolidated && recategorizeMode === 'item' && String(row.id).startsWith('cons_')) {
                                const displayKey = String(row.id).replace('cons_', '');
                                originalIndex = rows.findIndex(r => {
                                    const rScope = (r.scope || 'Furniture').trim().toLowerCase();
                                    const rKey = (r.brandDesc || r.description || 'N/A').trim().toLowerCase() + '::' + rScope;
                                    return rKey === displayKey;
                                });
                            } else {
                                originalIndex = rows.findIndex(r => String(r.id) === String(row.id));
                            }

                            return (
                                <Fragment key={row.id || gIdx}>
                                    {showSubheader && (
                                        <tr className={styles.locationDivider}>
                                            <td colSpan={isBoqMode ? 12 : 10}>
                                                <div className={styles.locationDividerText} style={{ textTransform: 'uppercase', fontSize: '0.92rem' }}>
                                                    {row.sectionLabel}
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                    {renderRow(row, row.sn || gIdx + 1, isBoqMode, originalIndex)}
                                </Fragment>
                            );
                        });
                    })()}
                </tbody>
                <tfoot>
                    <tr className={styles.summarySubtotalRow}>
                        <td colSpan={isBoqMode ? 8 : 6} style={{ textAlign: 'right', fontWeight: 'bold' }}>Subtotal ({costingFactors.toCurrency}):</td>
                        <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{subtotal.toFixed(2)}</td>
                        <td colSpan={2}></td>
                    </tr>
                    <tr className={styles.summaryVatRow}>
                        <td colSpan={isBoqMode ? 8 : 6} style={{ textAlign: 'right' }}>VAT ({costingFactors.vat}%):</td>
                        <td style={{ textAlign: 'right' }}>{vatAmount.toFixed(2)}</td>
                        <td colSpan={2}></td>
                    </tr>
                    <tr className={styles.summaryGrandTotalRow}>
                        <td colSpan={isBoqMode ? 8 : 6} style={{ textAlign: 'right', fontWeight: 'bold', fontSize: '1.2em' }}>Grand Total:</td>
                        <td style={{ textAlign: 'right', fontWeight: 'bold', fontSize: '1.2em', color: '#f5a623' }}>{grandTotal.toFixed(2)}</td>
                        <td colSpan={2}></td>
                    </tr>
                </tfoot>
            </table>
        );
    };

    const buildBrandSelectorData = (item) => {
        const activeBrand = brands.find(b => {
            if (b.type === 'fitout' || b.name === 'FitOut V2') {
                return b.name === item.selectedBrand && (b.budgetTier === activeTier || !b.budgetTier);
            }
            return b.name === item.selectedBrand;
        }) || brands.find(b => b.name === item.selectedBrand);
        let brandProducts = activeBrand?.products ? [...activeBrand.products] : [];

        if (item.selectedModel) {
            const hasModel = brandProducts.some(p => p && p.model && p.model.toLowerCase().trim() === String(item.selectedModel).toLowerCase().trim());
            if (!hasModel) {
                brandProducts.unshift({
                    model: item.selectedModel,
                    mainCategory: item.selectedMainCat || 'Furniture',
                    subCategory: item.selectedSubCat || 'General',
                    family: item.selectedFamily || 'Standard',
                    productUrl: item.selectedModelUrl || item.brandImage || '',
                    imageUrl: item.brandImage || '',
                    description: item.brandDesc || item.selectedModel,
                    price: item.rate || 0
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
        if (item.selectedMainCat && !mainCats.some(c => c.toLowerCase().trim() === String(item.selectedMainCat).toLowerCase().trim())) {
            mainCats.push(item.selectedMainCat);
        }

        const matchingByMain = brandProducts.filter(p => {
            if (!item.selectedMainCat) return true;
            const pCat = String(p.mainCategory || p.category || p.normalization?.category || '').toLowerCase().trim();
            const rowCat = String(item.selectedMainCat).toLowerCase().trim();
            return pCat === rowCat || pCat.includes(rowCat) || rowCat.includes(pCat);
        });

        const subCats = mergeUnique(matchingByMain, 'subCategory', 'normalization.subCategory');
        if (item.selectedSubCat && !subCats.some(s => s.toLowerCase().trim() === String(item.selectedSubCat).toLowerCase().trim())) {
            subCats.push(item.selectedSubCat);
        }

        const families = Array.from(new Set(brandProducts.filter(p => {
            const pCat = String(p.mainCategory || p.category || '').toLowerCase().trim();
            const rowCat = String(item.selectedMainCat || '').toLowerCase().trim();
            const pSub = String(p.subCategory || '').toLowerCase().trim();
            const rowSub = String(item.selectedSubCat || '').toLowerCase().trim();
            const catMatch = !rowCat || pCat === rowCat || pCat.includes(rowCat) || rowCat.includes(pCat);
            const subMatch = !rowSub || pSub === rowSub || pSub.includes(rowSub) || rowSub.includes(pSub);
            return catMatch && subMatch;
        }).map(p => p.family).filter(Boolean))).sort();

        let allRawModels = brandProducts.filter(p => {
            const pCat = String(p.mainCategory || p.category || '').toLowerCase().trim();
            const rowCat = String(item.selectedMainCat || '').toLowerCase().trim();
            const pSub = String(p.subCategory || '').toLowerCase().trim();
            const rowSub = String(item.selectedSubCat || '').toLowerCase().trim();
            const catMatch = !rowCat || pCat === rowCat || pCat.includes(rowCat) || rowCat.includes(pCat);
            const subMatch = !rowSub || pSub === rowSub || pSub.includes(rowSub) || rowSub.includes(pSub);
            return catMatch && subMatch;
        });

        if (allRawModels.length === 0 && brandProducts.length > 0) {
            allRawModels = brandProducts;
        }

        const rawModels = [];
        const seenUids = new Set();
        allRawModels.forEach(p => {
            const mKey = String(p.model || '').toLowerCase().trim();
            const uid = `${p.productUrl || p.imageUrl || `id_${p.id || ''}`}::${mKey}`;
            if (!seenUids.has(uid)) {
                seenUids.add(uid);
                rawModels.push(p);
            }
        });

        const modelGroups = {};
        rawModels.forEach(p => {
            const mKey = p.model || 'Standard';
            if (!modelGroups[mKey]) modelGroups[mKey] = [];
            modelGroups[mKey].push(p);
        });

        const modelOptions = [];
        Object.entries(modelGroups).forEach(([modelName, items]) => {
            items.forEach((entry, i) => {
                const catSnippet = entry.subCategory || entry.mainCategory || 'Misc';
                const snippet = entry.description ? entry.description.substring(0, 25) + '...' : `Variant ${i + 1}`;
                const rawUrl = entry.productUrl || entry.imageUrl || '';
                const uniqueVal = rawUrl ? `${rawUrl}::${modelName}::${i}` : `model_${modelName}_${i}`;
                modelOptions.push({
                    value: uniqueVal,
                    rawUrl,
                    label: items.length > 1 ? `[${catSnippet}] ${modelName} (${snippet})` : `[${catSnippet}] ${modelName}`,
                    rawModel: modelName
                });
            });
        });

        if (item.selectedModel && !modelOptions.some(o => o.rawModel && o.rawModel.toLowerCase().trim() === String(item.selectedModel).toLowerCase().trim())) {
            const rawUrl = item.selectedModelUrl || item.brandImage || '';
            const uid = rawUrl ? `${rawUrl}::${item.selectedModel}::0` : `model_${item.selectedModel}`;
            modelOptions.unshift({ value: uid, rawUrl, label: item.selectedModel, rawModel: item.selectedModel });
        }

        return { mainCats, subCats, families, modelOptions };
    };

    const renderSetSubRow = (parentRow, parentIndex, sub, subIndex, parentSn, isBoqMode) => {
        const { mainCats, subCats, families, modelOptions } = buildBrandSelectorData(sub);
        const subStatusClass = sub.aiStatus === 'processing' ? styles.aiPulse : sub.aiStatus === 'success' ? styles.aiGlow : sub.aiStatus === 'error' ? styles.aiErrorBorder : '';
        const subAmount = sub.rate && parseFloat(sub.rate) > 0
            ? (parseFloat(sub.qty || 0) * parseFloat(sub.rate || 0)).toFixed(2)
            : (sub.amount || '');

        return (
            <tr key={sub.id} className={`${styles.setSubRow} ${subStatusClass}`}>
                <td style={{ textAlign: 'center', verticalAlign: 'middle', minWidth: 40 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                        <span className={styles.setSubSn}>{parentSn}.{subIndex + 1}</span>
                        {sub.aiStatus === 'success' && sub.aiResult && (
                            <button className={styles.specialistBtn} onClick={() => setSpecialistData(sub.aiResult)} title="Component AI Detail">AI</button>
                        )}
                    </div>
                </td>
                {isBoqMode && (
                    <td style={{ verticalAlign: 'middle', minWidth: 80, textAlign: 'center' }}>
                        <div className={styles.setSubSlotBadge} title="Set Component">Item {subIndex + 1}</div>
                    </td>
                )}
                {isBoqMode && (
                    <td style={{ verticalAlign: 'middle', minWidth: 220 }}>
                        <textarea
                            className={styles.cellInput}
                            value={sub.description}
                            onChange={(e) => handleSetSubItemChange(parentIndex, subIndex, 'description', e.target.value)}
                            style={{ minHeight: '54px', resize: 'vertical', width: '100%' }}
                            placeholder="Component spec (e.g. Workstation Screen / Corner Module)..."
                        />
                    </td>
                )}
                <td style={{ verticalAlign: 'middle', textAlign: 'center', minWidth: 60 }}>
                    <span className={`${styles.rowScopeTag} ${styles.furnitureTag}`} style={{ opacity: 0.75, fontSize: '0.62rem' }}>Part</span>
                </td>
                <td style={{ verticalAlign: 'middle', minWidth: 80, textAlign: 'center' }}>
                    <MultiImageCell
                        images={sub.brandImage ? [sub.brandImage] : []}
                        singleMode={true}
                        cellId={`mb_${activeTier}_sub_brand_${sub.id}`}
                        brandLogo={sub.brandLogo}
                        altPrefix={sub.selectedModel || sub.label || 'Component'}
                        itemTitle={`${sub.selectedBrand || 'Brand'} ${sub.selectedModel || ''}`}
                        size={58}
                        onImagesChange={(newImgs) => handleSetSubItemChange(parentIndex, subIndex, 'brandImage', newImgs[0] || '')}
                        onPreview={(imgs, targetIdx) => {
                            setGalleryModal({
                                isOpen: true,
                                images: imgs,
                                initialIndex: targetIdx,
                                title: sub.selectedModel || sub.label || 'Set Component',
                                subtitle: sub.brandDesc || sub.description,
                                tierName: activeTier,
                                brandLogo: sub.brandLogo,
                                brandName: sub.selectedBrand
                            });
                        }}
                    />
                </td>
                <td style={{ verticalAlign: 'middle', minWidth: 160 }}>
                    <textarea
                        className={styles.cellInput}
                        value={sub.brandDesc}
                        onChange={(e) => handleSetSubItemChange(parentIndex, subIndex, 'brandDesc', e.target.value)}
                        style={{ minHeight: '54px', resize: 'vertical', width: '100%' }}
                        placeholder="Component product details..."
                    />
                </td>
                <td style={{ verticalAlign: 'middle', minWidth: 60 }}>
                    <input className={styles.cellInput} value={sub.qty} onChange={(e) => handleSetSubItemChange(parentIndex, subIndex, 'qty', e.target.value)} style={{ textAlign: 'center' }} />
                </td>
                <td style={{ verticalAlign: 'middle', minWidth: 60 }}>
                    <input className={styles.cellInput} value={sub.unit} onChange={(e) => handleSetSubItemChange(parentIndex, subIndex, 'unit', e.target.value)} />
                </td>
                <td style={{ verticalAlign: 'middle', minWidth: 80 }}>
                    <input className={styles.cellInput} value={sub.rate} onChange={(e) => handleSetSubItemChange(parentIndex, subIndex, 'rate', e.target.value)} style={{ textAlign: 'right' }} placeholder="0.00" />
                </td>
                <td style={{ verticalAlign: 'middle', minWidth: 90 }}>
                    <input
                        type="text"
                        value={subAmount}
                        onChange={(e) => handleSetSubItemChange(parentIndex, subIndex, 'amount', e.target.value)}
                        className={styles.cellInput}
                        style={{ textAlign: 'right', opacity: sub.rate && parseFloat(sub.rate) > 0 ? 0.7 : 1 }}
                        disabled={!!(sub.rate && parseFloat(sub.rate) > 0)}
                        placeholder="0.00"
                    />
                </td>
                <td style={{ verticalAlign: 'middle', minWidth: 215 }}>
                    <div className={styles.dropdownStack}>
                        <div className={styles.brandDropdownContainer}>
                            {sub.aiStatus === 'processing' ? (
                                <div className={styles.aiLoadingCell}><div className={styles.tinySpinner} /><span style={{ fontSize: '0.72rem' }}>Matching…</span></div>
                            ) : (
                                <BrandDropdown
                                    brands={brands.map(b => ({ ...b, logo: getFullUrl(b.logo || b.imageUrl) }))}
                                    selectedBrands={sub.selectedBrand}
                                    onSelect={(brand) => handleSetSubItemChange(parentIndex, subIndex, 'selectedBrand', brand.name)}
                                    placeholder="Select Brand..."
                                />
                            )}
                        </div>
                        {sub.selectedBrand && (
                            <select className={styles.productSelect} value={sub.selectedMainCat || ''} onChange={(e) => handleSetSubItemChange(parentIndex, subIndex, 'selectedMainCat', e.target.value)}>
                                <option value="">Category...</option>
                                {(mainCats || []).map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        )}
                        {(sub.selectedMainCat || (subCats || []).length > 0) && (
                            <select className={styles.productSelect} value={sub.selectedSubCat || ''} onChange={(e) => handleSetSubItemChange(parentIndex, subIndex, 'selectedSubCat', e.target.value)}>
                                <option value="">Sub-Category...</option>
                                {(subCats || []).map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        )}
                        {(families || []).length > 0 && (
                            <select className={styles.productSelect} value={sub.selectedFamily || ''} onChange={(e) => handleSetSubItemChange(parentIndex, subIndex, 'selectedFamily', e.target.value)}>
                                <option value="">Family...</option>
                                {(families || []).map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        )}
                        {(sub.selectedSubCat || (modelOptions || []).length > 0) && (
                            <select
                                className={styles.productSelect}
                                value={
                                    (modelOptions.find(o => o.rawModel === sub.selectedModel && (!sub.selectedModelUrl || o.rawUrl === sub.selectedModelUrl))?.value) ||
                                    (modelOptions.find(o => o.rawModel === sub.selectedModel)?.value) ||
                                    (modelOptions.find(o => o.value === sub.selectedModelUrl || (o.rawUrl && o.rawUrl === sub.selectedModelUrl))?.value) ||
                                    ''
                                }
                                onChange={(e) => {
                                    const opt = modelOptions.find(o => o.value === e.target.value);
                                    handleSetSubItemChange(parentIndex, subIndex, 'selectedModel', { model: opt?.rawModel || '', url: e.target.value, rawUrl: opt?.rawUrl || '' });
                                }}
                            >
                                <option value="">Model Variant...</option>
                                {modelOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                            </select>
                        )}
                    </div>
                </td>
                <td style={{ verticalAlign: 'middle', textAlign: 'center', minWidth: 40 }}>
                    <div className={styles.actionCell}>
                        <button
                            className={styles.setActionMiniBtn}
                            onClick={() => handleMatchSingleSet(parentIndex, subIndex)}
                            disabled={isFurnitureAutoFilling || matchingSetRowId === parentRow.id}
                            title="AI Match this component"
                        >
                            ⚡
                        </button>
                        <button className={`${styles.actionBtn} ${styles.addBtn}`} onClick={() => handleAddSetSubItem(parentIndex, subIndex)} title="Add component below">+</button>
                        <button className={`${styles.actionBtn} ${styles.removeBtn}`} onClick={() => handleRemoveSetSubItem(parentIndex, subIndex)} title="Remove component">×</button>
                    </div>
                </td>
            </tr>
        );
    };

    // Strip shown directly BELOW a row: the additional set option of a single item
    // ("set of N folding tables"), or the controls of an active set with its single-item alternative.
    const renderSetStrip = (row, index, isSetRow, isBoqMode) => {
        const setItems = Array.isArray(row.setItems) ? row.setItems : [];
        const stripColSpan = isBoqMode ? 12 : 10;

        if (isSetRow) {
            const matchedSetCount = setItems.filter(isMatchedSetItem).length;
            const alt = hasSingleAlternative(row) ? row.singleAlt : null;
            const altRate = parseFloat(alt?.rate) || 0;
            return (
                <tr className={`${styles.setOptionRow} ${styles.setOptionRowActive}`}>
                    <td colSpan={stripColSpan}>
                        <div className={styles.setOptionStrip}>
                            <span className={`${styles.setOptionBadge} ${styles.setOptionBadgeActive}`}>Set</span>
                            <select
                                className={`${styles.setTypeSelect} ${styles.setTypeSelectActive} ${styles.setStripSelect}`}
                                value={row.setType}
                                onChange={(e) => handleSetTypeChange(index, e.target.value)}
                                title="Set type — choose Single Item to match this row as one product"
                            >
                                {FURNITURE_SET_TYPES.map(st => (
                                    <option key={st.id} value={st.id}>{st.id === 'single' ? 'Single Item' : st.label}</option>
                                ))}
                            </select>
                            <button type="button" className={styles.setToggleBtn} onClick={() => handleToggleSetExpand(index)}>
                                <span>{row.setExpanded ? '▾' : '▸'} {setItems.length} item{setItems.length === 1 ? '' : 's'}</span>
                                <span style={{ opacity: 0.85, fontSize: '0.67rem' }}>{matchedSetCount}/{setItems.length} matched</span>
                            </button>
                            <button
                                type="button"
                                className={styles.setActionMiniBtn}
                                onClick={() => handleMatchSingleSet(index)}
                                disabled={isFurnitureAutoFilling || matchingSetRowId === row.id}
                                title="AI match all components of this set from one manufacturer of this tier"
                            >
                                {matchingSetRowId === row.id ? 'Matching…' : '⚡ Match set'}
                            </button>
                            <button type="button" className={styles.setActionMiniBtn} onClick={() => handleAddSetSubItem(index)} title="Add a component to this set">
                                + Item
                            </button>
                            <span className={styles.setOptionSpacer} />
                            <span className={styles.setOptionMeta} title="Alternative: match this row as one single product">
                                {alt
                                    ? `Option: single item — ${[alt.selectedBrand, alt.selectedModel].filter(Boolean).join(' ')}${altRate > 0 ? ` · ${altRate.toFixed(2)}` : ''}`
                                    : 'Option: single item'}
                            </span>
                            <button type="button" className={styles.setActionMiniBtn} onClick={() => handleUseSingleItem(index)} disabled={isFurnitureAutoFilling} title="Match this row as a single item (the set stays available as an option)">
                                Use single item
                            </button>
                        </div>
                    </td>
                </tr>
            );
        }

        const option = row.setOption;
        const summary = summarizeSetOption(option, row.qty);
        const singleAmount = (parseFloat(row.rate) || 0) * (parseFloat(row.qty) || 0);
        const isMatchingOption = matchingOptionRowId === row.id || summary.status === 'processing';
        const statusText = isMatchingOption
            ? 'Matching…'
            : summary.matchedCount > 0
                ? `${summary.brands.join(' / ')} — ${summary.models.slice(0, 2).join(' + ')}${summary.models.length > 2 ? ` +${summary.models.length - 2}` : ''}`
                : summary.status === 'error'
                    ? 'No catalog match in this tier\u2019s brands'
                    : 'Not matched yet';
        return (
            <tr className={styles.setOptionRow}>
                <td colSpan={stripColSpan}>
                    <div className={styles.setOptionStrip}>
                        <span className={styles.setOptionBadge}>+ Option</span>
                        <span className={styles.setOptionTitle}>{summary.label}</span>
                        <span className={styles.setOptionMeta} title={statusText}>{statusText}</span>
                        {summary.hasPrice && (
                            <span className={styles.setOptionPrice} title="Rate of one set · amount for the row quantity">
                                {summary.ratePerSet.toFixed(2)} / set · {summary.amount.toFixed(2)}
                                {singleAmount > 0 ? ` (${summary.amount >= singleAmount ? '+' : '−'}${Math.abs(summary.amount - singleAmount).toFixed(2)} vs single)` : ''}
                            </span>
                        )}
                        {summary.unpricedCount > 0 && !isMatchingOption && (
                            <span className={styles.setOptionMeta} title="Matched components without a catalog price are not part of the set rate">
                                {summary.hasPrice ? `excl. ${summary.unpricedCount} unpriced` : 'no catalog price'}
                            </span>
                        )}
                        <span className={styles.setOptionSpacer} />
                        <button type="button" className={styles.setActionMiniBtn} onClick={() => handleToggleOptionExpand(index)}>
                            {option.expanded ? '▾' : '▸'} {summary.itemCount} item{summary.itemCount === 1 ? '' : 's'}
                        </button>
                        <button
                            type="button"
                            className={styles.setActionMiniBtn}
                            onClick={() => handleMatchSetOption(index)}
                            disabled={isFurnitureAutoFilling || isMatchingOption || Boolean(matchingOptionRowId)}
                            title="Match this option from this tier's brand catalogs"
                        >
                            ⚡ Match option
                        </button>
                        <button
                            type="button"
                            className={styles.setOptionPrimaryBtn}
                            onClick={() => handleUseSetOption(index)}
                            disabled={isFurnitureAutoFilling || isMatchingOption}
                            title="Price this row as the set (the single item stays available as an option)"
                        >
                            Use this set
                        </button>
                        <button type="button" className={styles.setOptionDismissBtn} onClick={() => handleDismissSetOption(index)} title="Remove this option">×</button>
                    </div>
                    {option.expanded && (
                        <div className={styles.setOptionDetails}>
                            {option.items.map((it, itIdx) => {
                                return (
                                    <div key={it.id || itIdx} className={styles.setOptionItem}>
                                        {it.brandImage
                                            ? <img className={styles.setOptionItemThumb} src={getFullUrl(it.brandImage)} alt="" onError={(e) => { e.target.style.visibility = 'hidden'; }} />
                                            : <span className={styles.setOptionItemThumb} />}
                                        <span className={styles.setOptionItemQty}>{it.qty} {it.unit || 'Nos'}</span>
                                        <span className={styles.setOptionItemText}>
                                            <strong>{it.label || it.description}</strong>
                                            <span>{isMatchedSetItem(it) ? [it.selectedBrand, it.selectedModel].filter(Boolean).join(' — ') : (it.aiStatus === 'processing' ? 'Matching…' : 'Not matched')}</span>
                                        </span>
                                        <span className={styles.setOptionItemPrice}>{describeSetItemPrice(it)}</span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </td>
            </tr>
        );
    };

    const renderRow = (row, sn, isBoqMode, index) => {
        const isSetRow = Boolean(row.setType && row.setType !== 'single');
        const setItems = Array.isArray(row.setItems) ? row.setItems : [];
        const hasSetOption = !isSetRow && Boolean(row.setOption && row.setOption.items?.length > 0);
        const isFurnitureRow = !String(row.scope || '').toUpperCase().includes('FITOUT');
        // Consolidated display rows are aggregates of several BOQ rows: set controls only apply to real rows
        const isRealRow = index !== -1 && !String(row.id).startsWith('cons_');
        const { mainCats, subCats, families, modelOptions } = !isSetRow
            ? buildBrandSelectorData(row)
            : { mainCats: [], subCats: [], families: [], modelOptions: [] };

        const rowStatusClass = row.aiStatus === 'processing' ? styles.aiPulse :
            row.aiStatus === 'success' ? styles.aiGlow :
                row.aiStatus === 'error' ? styles.aiErrorBorder : '';
        const displayBrandImages = row.brandImages?.length
            ? row.brandImages
            : (row.brandImage ? [row.brandImage] : []);

        return (
            <Fragment key={row.id}>
                <tr className={`${rowStatusClass} ${row.aiStatus === 'skipped' ? styles.skippedRow : ''}`}>
                    <td style={{ textAlign: 'center', verticalAlign: 'middle', minWidth: 40, fontSize: '0.78rem', color: 'var(--text-muted,#94a3b8)', fontWeight: 600 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                            {sn}
                            {isSetRow && (
                                <span className={styles.setBadge} title={getSetTypeMeta(row.setType).label}>SET</span>
                            )}
                            {row.aiStatus === 'success' && row.aiResult && (
                                <button
                                    className={styles.specialistBtn}
                                    onClick={() => setSpecialistData(row.aiResult)}
                                    title="AI Detail"
                                >
                                    AI
                                </button>
                            )}
                            {row.aiStatus === 'no_match' && (
                                <button
                                    className={styles.specialistBtn}
                                    style={{ backgroundColor: '#2ba4e0' }}
                                    onClick={() => handleManualEnrich(row, index, activeTier)}
                                    disabled={enrichingRowId === row.id}
                                    title="Discover Online & Harden DB"
                                >
                                    {enrichingRowId === row.id ? '...' : 'Search Online'}
                                </button>
                            )}
                        </div>
                    </td>

                    {isBoqMode && (
                        <td style={{ verticalAlign: 'middle', minWidth: 80, textAlign: 'center' }}>
                            <MultiImageCell
                                images={row.imageRefs?.length ? row.imageRefs : (row.imageRef ? [row.imageRef] : [])}
                                cellId={`mb_${activeTier}_ref_${row.id || index}`}
                                altPrefix="Ref"
                                itemTitle={row.description || `Item #${row.sn}`}
                                size={68}
                                onImagesChange={(newImgs) => {
                                    setTierData(prev => {
                                        const newState = { ...prev };
                                        const tier = newState[activeTier];
                                        if (!tier || !tier.rows) return prev;
                                        const newRows = [...tier.rows];
                                        newRows[index] = {
                                            ...newRows[index],
                                            imageRefs: newImgs,
                                            imageRef: newImgs[0] || null
                                        };
                                        newState[activeTier] = { ...tier, rows: newRows };
                                        return newState;
                                    });
                                }}
                                onPreview={(imgs, targetIdx) => {
                                    setGalleryModal({
                                        isOpen: true,
                                        images: imgs,
                                        initialIndex: targetIdx,
                                        title: `Reference Images (${targetIdx + 1}/${imgs.length})`,
                                        subtitle: row.description || `Item #${row.sn}`,
                                        tierName: activeTier,
                                        rowIndex: index,
                                        targetField: 'ref',
                                        brandLogo: null,
                                        brandName: 'Original Specification'
                                    });
                                }}
                            />
                        </td>
                    )}

                    {isBoqMode && (
                        <td style={{ verticalAlign: 'middle', minWidth: 220 }}>
                            <textarea
                                className={styles.cellInput}
                                value={row.description}
                                onChange={(e) => handleCellChange(index, 'description', e.target.value)}
                                style={{ minHeight: '72px', resize: 'vertical', width: '100%' }}
                            />
                        </td>
                    )}

                    <td style={{ verticalAlign: 'middle', textAlign: 'center', minWidth: 60 }}>
                        <span className={`${styles.rowScopeTag} ${row.scope?.toLowerCase().includes('fitout') ? styles.fitoutTag : styles.furnitureTag}`}>
                            {row.scope || 'Furniture'}
                        </span>
                    </td>

                    <td style={{ verticalAlign: 'middle', minWidth: 80, textAlign: 'center' }}>
                        <MultiImageCell
                            images={displayBrandImages}
                            singleMode={false}
                            cellId={`mb_${activeTier}_brand_${row.id || index}`}
                            brandLogo={row.brandLogo}
                            altPrefix={row.selectedModel || "Product"}
                            itemTitle={`${row.selectedBrand || 'Brand'} ${row.selectedModel || ''}`}
                            size={68}
                            onImagesChange={(newImgs) => {
                                setTierData(prev => {
                                    const newState = { ...prev };
                                    const tier = newState[activeTier];
                                    if (!tier || !tier.rows) return prev;
                                    const newRows = [...tier.rows];
                                    newRows[index] = {
                                        ...newRows[index],
                                        brandImage: newImgs[0] || '',
                                        brandImages: newImgs
                                    };
                                    newState[activeTier] = { ...tier, rows: newRows };
                                    return newState;
                                });
                            }}
                            onPreview={(imgs, targetIdx) => {
                                setGalleryModal({
                                    isOpen: true,
                                    images: imgs,
                                    initialIndex: targetIdx,
                                    title: isSetRow ? `${getSetTypeMeta(row.setType).label} (${targetIdx + 1}/${imgs.length})` : (row.selectedModel || 'Matched Product'),
                                    subtitle: row.brandDesc || row.description,
                                    tierName: activeTier,
                                    rowIndex: index,
                                    targetField: 'brand',
                                    brandLogo: row.brandLogo,
                                    brandName: row.selectedBrand
                                });
                            }}
                        />
                    </td>

                    <td style={{ verticalAlign: 'middle', minWidth: 160 }}>
                        <textarea
                            className={styles.cellInput}
                            value={row.brandDesc}
                            onChange={(e) => handleCellChange(index, 'brandDesc', e.target.value)}
                            style={{ minHeight: '72px', resize: 'vertical', width: '100%' }}
                            placeholder={isSetRow ? 'Itemized set rollup summary…' : 'Product details...'}
                        />
                    </td>

                    <td style={{ verticalAlign: 'middle', minWidth: 60 }}>
                        <input className={styles.cellInput} value={row.qty} onChange={(e) => handleCellChange(index, 'qty', e.target.value)} style={{ textAlign: 'center' }} />
                    </td>
                    <td style={{ verticalAlign: 'middle', minWidth: 60 }}>
                        <input className={styles.cellInput} value={row.unit} onChange={(e) => handleCellChange(index, 'unit', e.target.value)} />
                    </td>
                    <td style={{ verticalAlign: 'middle', minWidth: 80 }}>
                        <input className={styles.cellInput} value={row.rate} onChange={(e) => handleCellChange(index, 'rate', e.target.value)} style={{ textAlign: 'right' }} />
                    </td>
                    <td style={{ verticalAlign: 'middle', minWidth: 90 }}>
                        <input
                            type="text"
                            value={row.rate && parseFloat(row.rate) > 0
                                ? (parseFloat(row.qty || 0) * parseFloat(row.rate || 0)).toFixed(2)
                                : (row.amount || '')}
                            onChange={(e) => handleCellChange(index, 'amount', e.target.value)}
                            className={styles.cellInput}
                            style={{ textAlign: 'right', opacity: row.rate && parseFloat(row.rate) > 0 ? 0.7 : 1 }}
                            disabled={!!(row.rate && parseFloat(row.rate) > 0)}
                            placeholder="0.00"
                        />
                    </td>

                    <td style={{ verticalAlign: 'middle', minWidth: 215 }}>
                        <div className={styles.dropdownStack}>
                            {isSetRow ? (
                                <>
                                    {row.aiStatus === 'processing' ? (
                                        <div className={styles.aiLoadingCell}>
                                            <div className={styles.tinySpinner} />
                                            <span style={{ fontSize: '0.72rem' }}>Matching set…</span>
                                        </div>
                                    ) : (
                                        <div className={styles.setRollupMeta} title={[row.selectedBrand, row.selectedModel].filter(Boolean).join(' — ')}>
                                            {row.selectedBrand || 'Set not matched yet'}
                                        </div>
                                    )}
                                    <div className={styles.setRollupHint}>
                                        {getSetTypeMeta(row.setType).shortLabel} · {setItems.filter(isMatchedSetItem).length}/{setItems.length} components — see the set bar below
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className={styles.brandDropdownContainer}>
                                        {row.aiStatus === 'processing' ? (
                                            <div className={styles.aiLoadingCell}>
                                                <div className={styles.tinySpinner} />
                                                <span style={{ fontSize: '0.72rem' }}>AI Matching…</span>
                                            </div>
                                        ) : (
                                            <BrandDropdown
                                                brands={brands.map(b => ({
                                                    ...b,
                                                    logo: getFullUrl(b.logo || b.imageUrl)
                                                }))}
                                                selectedBrands={row.selectedBrand}
                                                onSelect={(brand) => handleCellChange(index, 'selectedBrand', brand.name)}
                                                placeholder="Select Brand..."
                                            />
                                        )}
                                    </div>
                                    {row.selectedBrand && (
                                        <select className={styles.productSelect} value={row.selectedMainCat || ''} onChange={(e) => handleCellChange(index, 'selectedMainCat', e.target.value)}>
                                            <option value="">Category...</option>
                                            {(mainCats || []).map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    )}
                                    {(row.selectedMainCat || (subCats || []).length > 0) && (
                                        <select className={styles.productSelect} value={row.selectedSubCat || ''} onChange={(e) => handleCellChange(index, 'selectedSubCat', e.target.value)}>
                                            <option value="">Sub-Category...</option>
                                            {(subCats || []).map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    )}
                                    {(families || []).length > 0 && (
                                        <select className={styles.productSelect} value={row.selectedFamily || ''} onChange={(e) => handleCellChange(index, 'selectedFamily', e.target.value)}>
                                            <option value="">Family...</option>
                                            {(families || []).map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    )}
                                    {(row.selectedSubCat || (modelOptions || []).length > 0) && (
                                        <select
                                            className={styles.productSelect}
                                            value={
                                                (modelOptions.find(o => o.rawModel === row.selectedModel && (!row.selectedModelUrl || o.rawUrl === row.selectedModelUrl))?.value) ||
                                                (modelOptions.find(o => o.rawModel === row.selectedModel)?.value) ||
                                                (modelOptions.find(o => o.value === row.selectedModelUrl || (o.rawUrl && o.rawUrl === row.selectedModelUrl))?.value) ||
                                                ''
                                            }
                                            onChange={(e) => {
                                                const opt = modelOptions.find(o => o.value === e.target.value);
                                                handleCellChange(index, 'selectedModel', {
                                                    model: opt?.rawModel || '',
                                                    url: e.target.value,
                                                    rawUrl: opt?.rawUrl || ''
                                                });
                                            }}
                                        >
                                            <option value="">Model Variant...</option>
                                            {modelOptions.map(opt => (
                                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                                            ))}
                                        </select>
                                    )}
                                </>
                            )}
                        </div>
                    </td>

                    <td style={{ verticalAlign: 'middle', textAlign: 'center', minWidth: 40 }}>
                        <div className={styles.actionCell}>
                            <button className={`${styles.actionBtn} ${styles.addBtn}`} onClick={() => handleAddRow(index)}>+</button>
                            <button className={`${styles.actionBtn} ${styles.removeBtn}`} onClick={() => handleRemoveRow(index)}>×</button>
                        </div>
                        {isRealRow && !isSetRow && !hasSetOption && isFurnitureRow && String(row.description || '').trim() && (
                            <div className={styles.setConvertWrap}>
                                <button
                                    type="button"
                                    className={styles.setConvertBtn}
                                    onClick={() => handleConvertToSet(index)}
                                    disabled={isFurnitureAutoFilling}
                                    title="Match this row as a furniture set (several components) instead of a single item"
                                >
                                    Set
                                </button>
                            </div>
                        )}
                    </td>
                </tr>
                {isRealRow && (isSetRow || hasSetOption) && renderSetStrip(row, index, isSetRow, isBoqMode)}
                {isRealRow && isSetRow && row.setExpanded && setItems.map((sub, sIdx) =>
                    renderSetSubRow(row, index, sub, sIdx, sn, isBoqMode)
                )}
            </Fragment>
        );
    };

    const renderComparisonTable = () => {
        const budgetaryRows = tierData.budgetary?.rows || [];
        const midRows = tierData.mid?.rows || [];
        const highRows = tierData.high?.rows || [];

        const sampleRows = budgetaryRows.length > 0 ? budgetaryRows : midRows.length > 0 ? midRows : highRows;

        if (sampleRows.length === 0) return (
            <div className={styles.emptyState}>
                <div style={{ fontSize: '3rem', opacity: 0.2 }}></div>
                <div style={{ marginTop: '1rem' }}>No data to compare. Select products for each tier first.</div>
            </div>
        );

        return (
            <table className={styles.comparisonTable}>
                <thead>
                    <tr>
                        <th style={{ width: '15%' }}>Original Item</th>
                        <th style={{ width: '28.33%' }} className={`${styles.tierHeader} ${styles.tierBudgetary}`}> Budgetary</th>
                        <th style={{ width: '28.33%' }} className={`${styles.tierHeader} ${styles.tierMid}`}> Mid-Range</th>
                        <th style={{ width: '28.33%' }} className={`${styles.tierHeader} ${styles.tierHigh}`}> High-End</th>
                    </tr>
                </thead>
                <tbody>
                    {(() => {
                        const groupedCompRows = recategorizeBoqRows(sampleRows, recategorizeMode);
                        return groupedCompRows.map((row, i) => {
                            const prevRow = i > 0 ? groupedCompRows[i - 1] : null;
                            const showSubheader = row.sectionLabel && (!prevRow || prevRow.sectionLabel !== row.sectionLabel);
                            const origIndex = sampleRows.findIndex(sr => String(sr.id) === String(row.id));
                            return (
                                <Fragment key={row.id || row.sn || i}>
                                    {showSubheader && (
                                        <tr className={styles.locationDivider}>
                                            <td colSpan={4}>
                                                <div className={styles.locationDividerText} style={{ textTransform: 'uppercase', fontSize: '0.9rem' }}>
                                                    {row.sectionLabel}
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                    <tr>
                                        <td className={styles.compName}>
                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                                                {row.imageRef && (
                                                    <img
                                                        src={getFullUrl(row.imageRef)}
                                                        className={styles.compImg}
                                                        style={{ height: '50px', width: '50px', minWidth: '50px', objectFit: 'cover', borderRadius: '4px', cursor: 'zoom-in' }}
                                                        onClick={() => {
                                                            setPreviewImage(getFullUrl(row.imageRef));
                                                            setPreviewLogo(null);
                                                            setPreviewBrand('Original Reference');
                                                            setPreviewModel(row.description);
                                                        }}
                                                    />
                                                )}
                                                <div style={{ flex: 1 }}>
                                                    <strong>#{row.sn}</strong>
                                                    <p style={{ marginTop: '3px', fontSize: '0.65rem', color: 'var(--text-secondary)' }}>{row.description}</p>
                                                </div>
                                            </div>
                                        </td>
                                        {['budgetary', 'mid', 'high'].map(tierKey => {
                                            const tierRowsList = tierData[tierKey]?.rows || [];
                                            const match = (origIndex !== -1 && tierRowsList[origIndex])
                                                ? tierRowsList[origIndex]
                                                : tierRowsList.find(tr => String(tr.sn) === String(row.sn));
                                            return (
                                                <td key={tierKey}>
                                                    {match && match.aiStatus === 'processing' ? (
                                                        <div className={styles.aiLoadingCell} style={{ padding: '20px' }}>
                                                            <div className={styles.tinySpinner}></div>
                                                            <span style={{ fontSize: '0.7rem' }}>AI Searching...</span>
                                                        </div>
                                                    ) : match && match.selectedBrand ? (
                                                        <div className={styles.comparisonCell}>
                                                            {match.brandImage && (
                                                                <img
                                                                    src={getFullUrl(match.brandImage)}
                                                                    alt={match.selectedModel || ''}
                                                                    className={styles.compImg}
                                                                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                                                    onClick={() => {
                                                                        setPreviewImage(getFullUrl(match.brandImage));
                                                                        setPreviewLogo(getFullUrl(match.brandLogo));
                                                                        setPreviewBrand(match.selectedBrand);
                                                                        setPreviewModel(match.selectedModel);
                                                                    }}
                                                                    style={{ cursor: 'zoom-in' }}
                                                                />
                                                            )}
                                                            <div className={styles.compName}>
                                                                {match.selectedBrand} - {match.selectedModel}
                                                            </div>
                                                            <div className={styles.compPrice}>
                                                                <span>{match.rate}</span>
                                                                <span>{costingFactors.toCurrency}</span>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className={styles.compNoMatch}>No match selected</div>
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                </Fragment>
                            );
                        });
                    })()}
                </tbody>
            </table>
        );
    };

    const renderActiveView = () => {
        if (activeTier === 'comparison') return renderComparisonTable();
        const currentData = tierData[activeTier];
        if (!currentData) {
            return (
                <div style={{ flex: 1, display: 'flex', width: '100%', height: '100%', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
                    <div style={{ fontSize: '3rem', opacity: 0.2 }}>BOQ</div>
                    <div style={{ marginTop: '1rem' }}>No table data yet. Click "Generate from BOQ" or "Create New BOQ".</div>
                </div>
            );
        }
        return renderTable(currentData);
    };

    return (
        <Fragment>
            <div className={styles.overlay} onClick={onClose}>
                <div className={`${styles.modalContainer} ${theme === 'light' ? styles.light : ''}`} onClick={e => e.stopPropagation()}>

                    <div className={styles.header}>
                        <div className={styles.title}>
                             Multi-Budget Offers
                        </div>
                        <button className={styles.closeBtn} onClick={onClose}>×</button>
                    </div>

                    <div className={styles.content}>

                        <div className={styles.topSection}>
                            <div className={styles.mainActions}>
                                <button className={`${styles.actionCard} ${styles.uploadBoqBtn}`} onClick={handleUploadBoqTrigger}>
                                    <span style={{ fontSize: '1.4rem' }}></span>
                                    <span>Upload BOQ</span>
                                </button>
                                <button className={`${styles.actionCard} ${styles.genBoqBtn}`} onClick={handleGenerateFromBoq}>
                                    <span style={{ fontSize: '1.4rem' }}></span>
                                    <span>Generate from BOQ</span>
                                </button>
                                <button className={`${styles.actionCard} ${styles.genPlanBtn}`} onClick={handleUploadPlanTrigger}>
                                    <span style={{ fontSize: '1.4rem' }}></span>
                                    <span>Upload Plan</span>
                                </button>
                                <button className={`${styles.actionCard} ${styles.createNewBtn}`} onClick={handleCreateNewBoq}>
                                    <span style={{ fontSize: '1.4rem' }}></span>
                                    <span>Create New BOQ</span>
                                </button>

                                {planPreviewUrl && (
                                    <button className={`${styles.actionCard} ${styles.planPreviewBtn}`} onClick={() => setPlanPreviewOpen(true)}>
                                        <div className={styles.planPreviewThumb}>
                                            {planPreviewType === 'application/pdf' ? (
                                                <span className={styles.planPreviewPdfIcon} role="img" aria-label="PDF"></span>
                                            ) : (
                                                <img src={planPreviewUrl} alt={planPreviewName || 'Plan preview'} className={styles.planPreviewThumbImg} />
                                            )}
                                        </div>
                                        <span>Preview Plan</span>
                                    </button>
                                )}
                                <button className={`${styles.actionCard} ${styles.consolidateBtn} ${isConsolidated ? styles.consolidateBtnActive : ''}`} onClick={() => { const next = !isConsolidated; setIsConsolidated(next); if (next) setRecategorizeMode('item'); }}>
                                    <span style={{ fontSize: '1.4rem' }}>{isConsolidated ? '' : ''}</span>
                                    <span>{isConsolidated ? 'Consolidated' : 'Consolidate Items'}</span>
                                </button>
                                <div className={styles.recatControlCard} title="Keep uploaded BOQ order as-is or group by Item wise / Room wise">
                                    <span className={styles.recatLabel}>Recategorize</span>
                                    <select
                                        className={styles.recatSelect}
                                        value={recategorizeMode}
                                        onChange={(e) => {
                                            const mode = e.target.value;
                                            setRecategorizeMode(mode);
                                            if (mode !== 'item') setIsConsolidated(false);
                                        }}
                                        aria-label="Recategorize BOQ"
                                    >
                                        <option value="original">Original Order (As Is)</option>
                                        <option value="item">Item wise</option>
                                        <option value="room">Room wise</option>
                                    </select>
                                </div>
                                <button className={`${styles.actionCard} ${styles.addBrandBtn}`} onClick={handleAddBrand}>
                                    <span style={{ fontSize: '1.4rem' }}></span>
                                    <span>Add Brand</span>
                                </button>
                                <button
                                    className={`${styles.actionCard} ${styles.aiAutoFillBtn} ${isFurnitureAutoFilling ? styles.aiAutoFilling : ''}`}
                                    onClick={handleAutoFillAI}
                                    disabled={isFurnitureAutoFilling}
                                >
                                    <span style={{ fontSize: '1.4rem' }}></span>
                                    <span>
                                        {isFurnitureAutoFilling
                                            ? `AI FURNITURE${furnitureProgress.budgetary?.total > 0 ? ` (${furnitureProgress.budgetary.current}/${furnitureProgress.budgetary.total})` : '...'}`
                                            : 'AI FURNITURE'
                                        }
                                    </span>
                                </button>
                                <button
                                    className={`${styles.actionCard} ${styles.fitoutAutoFillBtn} ${isFitoutAutoFilling ? styles.fitoutAutoFilling : ''}`}
                                    onClick={handleFitoutAutoFill}
                                    disabled={isFitoutAutoFilling}
                                >
                                    <span style={{ fontSize: '1.4rem' }}></span>
                                    <span>
                                        {isFitoutAutoFilling
                                            ? `AI FITOUT${fitoutProgress.budgetary?.total > 0 ? ` (${fitoutProgress.budgetary.current}/${fitoutProgress.budgetary.total})` : '...'}`
                                            : 'AI FITOUT'
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
                                    if (e.target.files && e.target.files[0]) {
                                        onUploadBoq(e.target.files[0]);
                                    }
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
                                    if (e.target.files && e.target.files.length > 0) {
                                        onUploadPlan(e.target.files);
                                    }
                                    e.target.value = '';
                                }}
                            />

                            <div className={styles.tabsContainer}>
                                <div className={styles.topTabs}>
                                    <button className={`${styles.tab} ${activeTier === 'budgetary' ? styles.activeTabBudgetary : ''}`} onClick={() => setActiveTier('budgetary')}>
                                        Budgetary
                                    </button>
                                    <button className={`${styles.tab} ${activeTier === 'mid' ? styles.activeTabMid : ''}`} onClick={() => setActiveTier('mid')}>
                                        Mid-Range
                                    </button>
                                    <button className={`${styles.tab} ${activeTier === 'high' ? styles.activeTabHigh : ''}`} onClick={() => setActiveTier('high')}>
                                        High-End
                                    </button>
                                </div>
                                <div className={styles.bottomTabs}>
                                    <button className={`${styles.tab} ${styles.comparisonTab} ${activeTier === 'comparison' ? styles.activeTabComparison : ''}`} onClick={() => setActiveTier('comparison')}>
                                        Comparison View
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className={styles.tableContainer}>
                            {furnitureBatchResult && (
                                <div className={`${styles.aiBatchNotification} ${furnitureBatchResult.error > 0 ? styles.aiBatchNotificationError : styles.aiBatchNotificationSuccess}`}>
                                    <span>
                                        Furniture Batch Complete — <strong>{furnitureBatchResult.success || 0}</strong> matched, <strong>{furnitureBatchResult.error || 0}</strong> failed
                                        {furnitureBatchResult.newlyAdded > 0 && ` (${furnitureBatchResult.newlyAdded} new brands added)`}
                                    </span>
                                    <button className={styles.notificationClose} onClick={() => setFurnitureBatchResult(null)}>×</button>
                                </div>
                            )}
                            {fitoutBatchResult && (
                                <div className={`${styles.aiBatchNotification} ${fitoutBatchResult.error > 0 ? styles.aiBatchNotificationError : styles.aiBatchNotificationSuccess}`}>
                                    <span>
                                        Fitout Batch Complete — <strong>{fitoutBatchResult.success || 0}</strong> matched, <strong>{fitoutBatchResult.error || 0}</strong> failed
                                        {fitoutBatchResult.newlyAdded > 0 && ` (${fitoutBatchResult.newlyAdded} new brands added)`}
                                    </span>
                                    <button className={styles.notificationClose} onClick={() => setFitoutBatchResult(null)}>×</button>
                                </div>
                            )}

                            <div className={styles.tableScrollWrapper}>
                                {renderActiveView()}
                            </div>
                        </div>
                    </div>

                    <div className={styles.footer}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '0.75rem', flexWrap: 'wrap' }}>
                            {(tierData[activeTier]?.rows || []).some(r => (r.setType && r.setType !== 'single') || r.setOption) ? (
                                <div className={styles.setExportControl}>
                                    <span>Sets ({(tierData[activeTier]?.rows || []).filter(r => r.setType && r.setType !== 'single').length}):</span>
                                    <select
                                        className={styles.setExportSelect}
                                        value={setExportMode}
                                        onChange={e => setSetExportMode(e.target.value)}
                                        title="How set rows are written into the offer"
                                    >
                                        <option value="lump_sum">One line per set (keeps BOQ rows)</option>
                                        <option value="include_sub_items">Set line + components (12.1, 12.2…)</option>
                                    </select>
                                    <label className={styles.setExportCheck} title="Adds each matched alternative (e.g. set of folding tables) as an extra line marked Optional — not counted in totals">
                                        <input type="checkbox" checked={exportSetOptions} onChange={e => setExportSetOptions(e.target.checked)} />
                                        Include options as optional lines
                                    </label>
                                </div>
                            ) : <div />}
                            <button className={styles.applyCostingBtn} onClick={() => setIsCostingOpen(true)}>
                                Apply Costing & Review
                            </button>
                        </div>

                        <div style={{ width: '100%', borderTop: '1px solid rgba(255,255,255,0.1)' }} />

                        <div className={styles.exportGroup}>
                            <DesignBuildButton
                                compact
                                getTables={() => offerTablesFor(tierData[activeTier]?.rows || [])}
                                title={`${{ budgetary: 'Budgetary', mid: 'Mid-Range', high: 'High-End' }[activeTier] || 'Multi-Budget'} offer`}
                            />
                            <button className={styles.exportBtn} onClick={handleExportPDF}>Offer PDF</button>
                            <button className={styles.exportBtn} onClick={handleExportExcel}>Offer Excel</button>
                            <button className={styles.exportBtn} onClick={handleExportPPTX}>Presentation</button>
                            <button className={styles.exportBtn} onClick={handleExportPresentationPDF}>PDF</button>
                            <button className={styles.exportBtn} onClick={handleExportMAS}>MAS</button>
                            <button
                                className={styles.exportBtn}
                                onClick={handleExportRFQ}
                                style={{ background: 'linear-gradient(135deg, #92400e 0%, #d97706 100%)', color: '#fff', borderColor: '#f59e0b' }}
                                title="Split active tier BOQ by Brand into ready-to-send Supplier RFQ Excel sheets (ZIP pack)"
                            >
                                RFQ by Brand
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {previewImage && (
                <div className={styles.previewOverlay} onClick={(e) => { e.stopPropagation(); setPreviewImage(null); setPreviewLogo(null); setPreviewBrand(null); setPreviewModel(null); }}>
                    <div className={styles.previewContent} onClick={e => e.stopPropagation()}>
                        <div className={styles.previewMain}>
                            {previewLogo && (
                                <div className={styles.previewLogoBadge}>
                                    <img
                                        src={getFullUrl(previewLogo)}
                                        alt="brand logo"
                                        className={styles.previewBadgeLogo}
                                        style={{ objectFit: 'contain', background: 'white', padding: '4px', borderRadius: '4px', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}
                                        onError={(e) => { e.target.parentNode.style.display = 'none'; }}
                                    />
                                </div>
                            )}
                            <img
                                src={previewImage}
                                alt="Full view"
                                className={styles.previewImage}
                                onError={(e) => {
                                    e.target.src = 'https://placehold.co/600x400?text=Image+Not+Available';
                                }}
                            />
                        </div>

                        <div className={styles.previewFooter}>
                            <div className={styles.previewDetails}>
                                <div className={styles.previewTitle}>{previewBrand || 'Product View'}</div>
                                <div className={styles.previewSubtitle}>{previewModel || ''}</div>
                            </div>
                            <button
                                className={styles.previewCloseBtn}
                                onClick={() => { setPreviewImage(null); setPreviewLogo(null); setPreviewBrand(null); setPreviewModel(null); }}
                            >
                                <i className="ri-close-line"></i>
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {planPreviewOpen && planPreviewUrl && (
                <div className={styles.previewOverlay} onClick={() => setPlanPreviewOpen(false)}>
                    <div className={styles.previewContent} onClick={e => e.stopPropagation()}>
                        <div className={styles.previewMain}>
                            {isPdfPlan(planPreviewType, planPreviewName) ? (
                                <PlanPreview
                                    url={planPreviewUrl}
                                    type={planPreviewType}
                                    name={planPreviewName}
                                    className={styles.previewImage}
                                    fallbackClassName={styles.previewFallback}
                                />
                            ) : (
                                <img
                                    src={planPreviewUrl}
                                    alt={planPreviewName || 'Plan preview'}
                                    className={styles.previewImage}
                                    onError={(e) => {
                                        e.target.src = 'https://placehold.co/900x600?text=Preview+Not+Available';
                                    }}
                                />
                            )}
                        </div>

                        <div className={styles.previewFooter}>
                            <div className={styles.previewDetails}>
                                <div className={styles.previewTitle}>Uploaded Plan</div>
                                <div className={styles.previewSubtitle}>{planPreviewName || ''}</div>
                            </div>
                            <button
                                className={styles.previewCloseBtn}
                                onClick={() => setPlanPreviewOpen(false)}
                            >
                                <i className="ri-close-line"></i>
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {galleryModal.isOpen && (
                <ImageGalleryModal
                    images={galleryModal.images}
                    initialIndex={galleryModal.initialIndex}
                    title={galleryModal.title}
                    subtitle={galleryModal.subtitle}
                    brandLogo={galleryModal.brandLogo}
                    brandName={galleryModal.brandName}
                    onRemoveImage={galleryModal.rowIndex !== undefined && galleryModal.rowIndex !== null ? (removedIdx) => {
                        const tier = galleryModal.tierName || activeTier;
                        const rowIdx = galleryModal.rowIndex;
                        const isRef = galleryModal.targetField === 'ref';
                        const currentImgs = (Array.isArray(galleryModal.images) ? galleryModal.images : [galleryModal.images])
                            .map(img => (typeof img === 'string' ? img : (img?.url || img?.data || img?.src || '')))
                            .filter(Boolean);
                        const updated = currentImgs.filter((_, idx) => idx !== removedIdx);

                        setTierData(prev => {
                            const newState = { ...prev };
                            const targetTier = newState[tier];
                            if (!targetTier || !targetTier.rows) return prev;
                            const newRows = [...targetTier.rows];
                            if (isRef) {
                                newRows[rowIdx] = {
                                    ...newRows[rowIdx],
                                    imageRefs: updated,
                                    imageRef: updated[0] || null
                                };
                            } else {
                                newRows[rowIdx] = {
                                    ...newRows[rowIdx],
                                    brandImage: updated[0] || ''
                                };
                            }
                            newState[tier] = { ...targetTier, rows: newRows };
                            return newState;
                        });
                        setGalleryModal(prev => ({ ...prev, images: updated }));
                    } : null}
                    onClose={() => setGalleryModal(prev => ({ ...prev, isOpen: false }))}
                />
            )}
            <AddBrandModal
                isOpen={isAddBrandOpen}
                onClose={() => setIsAddBrandOpen(false)}
                onBrandAdded={handleBrandAdded}
                onBrandUpdated={fetchBrands}
            />
            <SpecialistModal
                isOpen={!!specialistData}
                onClose={() => setSpecialistData(null)}
                data={specialistData}
            />
            <AutoFillSelectModal
                isOpen={isAutoFillSelectOpen}
                onClose={() => setIsAutoFillSelectOpen(false)}
                allBrands={brands}
                activeTier={activeTier}
                onConfirm={executeAutoFillAI}
            />
            <FitoutAutoFillModal
                isOpen={isFitoutAutoFillOpen}
                onClose={() => setIsFitoutAutoFillOpen(false)}
                allBrands={brands}
                activeTier={activeTier}
                onConfirm={executeFitoutAutoFillAI}
            />
            <CostingModal
                isOpen={isCostingOpen}
                onClose={() => setIsCostingOpen(false)}
                initialFactors={costingFactors}
                onApply={handleApplyCosting}
            />
            <PlanAnalyzerModal
                isOpen={isPlanAnalyzerOpen}
                onClose={() => setIsPlanAnalyzerOpen(false)}
                onApply={handlePlanApplied}
                allBrands={brands}
            />
            {(() => {
                const getActiveModals = (statuses, type, batchResult, progress, setStatuses, setBatchResult) => {
                    const activeTiers = ['budgetary', 'mid', 'high'].filter(k => statuses[k]?.active);
                    if (activeTiers.length > 0) {
                        return [{
                            type,
                            isSwarm: true,
                            activeTiers,
                            statuses,
                            progress,
                            setStatuses,
                            setBatchResult,
                            isResult: false
                        }];
                    }
                    if (batchResult) {
                        return [{
                            type,
                            tier: 'mid',
                            status: {},
                            batchResult,
                            progress,
                            setStatuses,
                            setBatchResult,
                            isResult: true
                        }];
                    }
                    return [];
                };

                const furnitureModals = (swarm && swarm.active) ? [] : getActiveModals(furnitureStatuses, 'furniture', furnitureBatchResult, furnitureProgress, setFurnitureStatuses, setFurnitureBatchResult);
                const fitoutModals = getActiveModals(fitoutStatuses, 'fitout', fitoutBatchResult, fitoutProgress, setFitoutStatuses, setFitoutBatchResult);

                const globalModals = [...furnitureModals, ...fitoutModals];
                if (swarm && swarm.active) {
                    globalModals.push({
                        type: 'furniture',
                        isSwarm: true,
                        swarm: swarm,
                        isResult: false,
                        displayStatus: { minimized: false },
                        displayTier: 'high', // Default to high for premium visuals if available
                        progress: 0
                    });
                }

                return globalModals.map((modalData, idx) => {
                    if (modalData.isSwarm && modalData.swarm) {
                        return (
                            <AIPresentationModal
                                key="swarm-discovery"
                                type="furniture"
                                isOpen={true}
                                onClose={() => setSwarm({ active: false, lanes: {} })}
                                onToggleMinimize={(val) => {
                                    setSwarm(prev => ({ ...prev, minimized: val }));
                                    setFurnitureStatuses(prev => {
                                        const next = { ...prev };
                                        Object.keys(prev).forEach(t => {
                                            if (prev[t].active) next[t] = { ...next[t], minimized: val };
                                        });
                                        return next;
                                    });
                                }}
                                swarm={modalData.swarm}
                                isMinimized={modalData.swarm.minimized}
                                alignment="center"
                                title="Multi Budget AI Engine Active"
                            />
                        );
                    }
                    const { type, isSwarm, activeTiers, statuses, tier: singleTier, status: singleStatus, progress, setStatuses, setBatchResult, isResult, batchResult: bRes } = modalData;
                    const ModalComponent = type === 'fitout' ? AIFitoutPresentationModal : AIPresentationModal;

                    const displayTier = isSwarm ? activeTiers[0] : singleTier;
                    const displayStatus = isSwarm ? statuses[displayTier] : singleStatus;
                    const displayProgress = progress[displayTier]?.total > 0 ? (progress[displayTier].current / progress[displayTier].total) * 100 : 0;

                    let localSwarm = null;
                    if (isSwarm) {
                        localSwarm = {
                            lanes: {}
                        };
                        activeTiers.forEach(t => {
                            const s = statuses[t];
                            let localBrand = brands.find(b => b.name === s.brand);
                            
                            // Fallback: If no brand matched yet, show the logo of the first brand assigned to this tier
                            if (!localBrand && lastAISettings?.brands) {
                                localBrand = brands.find(b => 
                                    lastAISettings.brands.includes(b.name) && 
                                    (b.budgetTier?.toLowerCase() === t || (t === 'budgetary' && b.budgetTier?.toLowerCase() === 'budgetary'))
                                );
                            }

                            localSwarm.lanes[t] = {
                                id: t,
                                label: t === 'budgetary' ? 'BUDGETARY' : t.toUpperCase() + ' TIER',
                                status: s.status,
                                progress: progress[t]?.total > 0 ? (progress[t].current / progress[t].total) * 100 : 0,
                                currentItem: s.currentItem,
                                brand: s.brand,
                                brandLogo: localBrand?.logo ? getFullUrl(localBrand.logo) : '',
                                model: s.model,
                                image: s.image
                            };
                        });
                    }

                    let alignment = 'center';
                    if (globalModals.length > 1 && !displayStatus.minimized) {
                        if (globalModals.length === 2) {
                            alignment = idx === 0 ? 'left' : 'right';
                        } else if (globalModals.length === 3) {
                            if (idx === 0) alignment = 'left';
                            if (idx === 1) alignment = 'center-narrow';
                            if (idx === 2) alignment = 'right';
                        }
                    }

                    const minimizedOffset = idx * 340 + 24;

                    return (
                        <ModalComponent
                            key={`${type}-${displayTier}-${isResult ? 'result' : 'discovery'}`}
                            type={type}
                            isOpen={true}
                            onClose={() => {
                                if (isResult) {
                                    setBatchResult(null);
                                } else if (isSwarm) {
                                    setStatuses(prev => {
                                        const next = { ...prev };
                                        activeTiers.forEach(t => {
                                            next[t] = { ...next[t], active: false };
                                        });
                                        return next;
                                    });
                                } else {
                                    setStatuses(prev => ({ ...prev, [displayTier]: { ...prev[displayTier], active: false } }));
                                }
                            }}
                            tier={displayTier}
                            alignment={alignment}
                            currentItem={displayStatus.currentItem}
                            batchResult={isResult ? bRes : null}
                            brand={displayStatus.brand}
                            foundModel={displayStatus.model}
                            foundImage={displayStatus.image}
                            progress={displayProgress}
                            status={displayStatus.status}
                            isMinimized={displayStatus.minimized}
                            onToggleMinimize={(val) => {
                                if (isResult) return;
                                if (isSwarm) {
                                    setStatuses(prev => {
                                        const next = { ...prev };
                                        activeTiers.forEach(t => {
                                            next[t] = { ...next[t], minimized: val };
                                        });
                                        return next;
                                    });
                                } else {
                                    setStatuses(prev => ({ ...prev, [displayTier]: { ...prev[displayTier], minimized: val } }));
                                }
                            }}
                            minimizedOffset={minimizedOffset}
                            swarm={localSwarm}
                            title="Multi Budget AI Engine Active"
                        />
                    );
                });
            })()}
        </Fragment>
    );
}