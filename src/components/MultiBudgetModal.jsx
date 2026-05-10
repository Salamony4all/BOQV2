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

import { useCompanyProfile } from '../context/CompanyContext';
import { useTheme } from '../context/ThemeContext';
import { fixArabic, hasArabic, loadArabicFont } from '../utils/arabicPdfUtils';
import { getApiBase } from '../utils/apiBase';
import { getFullUrl } from '../utils/urlUtils';

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
    const { companyName, logoWhite, logoOriginal, logoBlue, website, updateProfile, processLogoFile } = profile;
    const [activeTier, setActiveTier] = useState('mid');
    const [previewImage, setPreviewImage] = useState(null);
    const [previewLogo, setPreviewLogo] = useState(null);
    const [previewBrand, setPreviewBrand] = useState(null);
    const [previewModel, setPreviewModel] = useState(null);
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
        desking: { label: 'Desking Agent', color: '#3b82f6', icon: '💻' },
        seating: { label: 'Seating Agent', color: '#10b981', icon: '🪑' },
        softSeating: { label: 'Soft Seating Agent', color: '#8b5cf6', icon: '🛋️' },
        accessories: { label: 'Accessories Agent', color: '#f59e0b', icon: '📎' }
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
                const desc = item.description || item.Description || '';
                const loc = item.location || item.Location || 'General';
                const code = item.code || '';
                const displayDesc = code ? `[${code}] ${desc}` : `[${loc}] ${desc}`;

                return {
                    id: Date.now() + i,
                    sn: i + 1,
                    imageRef: null,
                    brandImage: '', brandDesc: '',
                    description: displayDesc,
                    code: code,
                    location: loc,
                    scope: item.scope || item.Scope || '',
                    qty: item.qty || item.QTY,
                    unit: item.unit || item.Unit || 'Nos',
                    rate: '',
                    amount: '',
                    selectedBrand: '', selectedMainCat: '', selectedSubCat: '', selectedFamily: '', selectedModel: ''
                };
            });

            setTierData({
                budgetary: { rows: newRows.map(r => ({ ...r, id: r.id + 0 })), mode: 'boq' },
                mid: { rows: newRows.map(r => ({ ...r, id: r.id + 100000 })), mode: 'boq' },
                high: { rows: newRows.map(r => ({ ...r, id: r.id + 200000 })), mode: 'boq' }
            });
        }
    }, [seededItems]);

    useEffect(() => {
        if (pendingSeedTier && originalTables && originalTables.length > 0) {
            const rows = buildBoqRows(originalTables);
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
        let idxDesc = findCol(header, /description|desc/i);
        if (idxDesc === -1) idxDesc = 1;
        let idxQty = findCol(header, /^(?!.*(rate|price|amount)).*(qty|quantity)/i);
        if (idxQty === -1) idxQty = findCol(header, /qty|quantity/i);
        const idxUnit = findCol(header, /unit|uom/i);
        const idxRate = findCol(header, /rate|price/i);
        const idxScope = findCol(header, /scope|zone|area|location/i);
        let idxTotal = findCol(header, /^(?!.*(qty|quantity)).*(total|amount)/i);
        if (idxTotal === -1) idxTotal = findCol(header, /amount|total/i);

        return sourceTable.rows.map((row, i) => {
            const getVal = (idx) => (idx !== -1 && row.cells[idx]) ? (row.cells[idx].value || '') : '';
            const imageCell = row.cells.find(c => c.image || (c.images && c.images.length > 0));
            let imgSrc = imageCell ? (imageCell.image || imageCell.images[0]) : null;
            if (imgSrc && typeof imgSrc === 'object' && imgSrc.url) imgSrc = imgSrc.url;
            if (imgSrc && !imgSrc.startsWith('http') && !imgSrc.startsWith('/')) imgSrc = '/' + imgSrc;
            return {
                id: Date.now() + i,
                sn: i + 1,
                imageRef: imgSrc,
                brandImage: '', brandDesc: '',
                scope: getVal(idxScope) || 'Furniture',
                description: getVal(idxDesc) || (idxDesc === -1 ? row.cells[1]?.value : ''),
                qty: getVal(idxQty),
                unit: getVal(idxUnit),
                rate: getVal(idxRate),
                amount: getVal(idxTotal),
                selectedBrand: '', selectedMainCat: '', selectedSubCat: '', selectedFamily: '', selectedModel: ''
            };
        });
    };

    const handleGenerateFromBoq = () => {
        if (!originalTables || originalTables.length === 0) {
            alert("No extracted BOQ data found. Please Upload BOQ first.");
            return;
        }
        setTierData(prev => ({ ...prev, [activeTier]: { rows: buildBoqRows(originalTables), mode: 'boq' } }));
    };

    const handleUploadBoqTrigger = () => { setPendingSeedTier(activeTier); if (boqInputRef.current) boqInputRef.current.click(); };
    const handleUploadPlanTrigger = () => { if (planInputRef.current) planInputRef.current.click(); };

    const handleCreateNewBoq = () => {
        const emptyRows = Array(10).fill().map((_, i) => ({
            id: Date.now() + i, sn: i + 1, imageRef: null, brandImage: '', brandDesc: '', description: '', qty: '', unit: '', rate: '', amount: '',
            selectedBrand: '', selectedMainCat: '', selectedSubCat: '', selectedFamily: '', selectedModel: ''
        }));
        setTierData(prev => ({ ...prev, [activeTier]: { rows: emptyRows, mode: 'new' } }));
    };

    const handleAddBrand = () => setIsAddBrandOpen(true);
    const handleBrandAdded = (newBrand) => setBrands(prev => [...prev, newBrand]);

    const handlePlanApplied = (planItems) => {
        if (!planItems || planItems.length === 0) return;
        const newRows = planItems.map((item, i) => ({
            id: Date.now() + i, sn: i + 1, imageRef: null, brandImage: '', brandDesc: '',
            description: `[${item.location}] ${item.description.replace(/^(\[.*?\]\s*)+/, '').trim()}`, location: item.location, scope: item.scope, qty: item.qty, unit: item.unit || 'Nos', rate: '', amount: '', selectedBrand: '', selectedMainCat: '', selectedSubCat: '', selectedFamily: '', selectedModel: ''
        }));
        setTierData({
            budgetary: { rows: newRows.map(r => ({ ...r, id: r.id + 0 })), mode: 'boq' },
            mid: { rows: newRows.map(r => ({ ...r, id: r.id + 100000 })), mode: 'boq' },
            high: { rows: newRows.map(r => ({ ...r, id: r.id + 200000 })), mode: 'boq' }
        });
    };

    const getUniqueValues = (items, keyPath) => {
        if (!items || items.length === 0) return null;
        const results = [...new Set(items.map(i => {
            const parts = keyPath.split('.');
            let val = i;
            for (const part of parts) { val = val?.[part]; }
            return val;
        }).filter(Boolean))];
        return results.length > 0 ? results : null;
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
            const workableIndices = rows.map((r, i) => i).filter(i => rows[i].scope?.toUpperCase().includes('FITOUT') && !isHeaderRow(rows[i].description, rows[i]) && !rows[i].selectedBrand);
            setFitoutProgress(prev => ({ ...prev, [tierKey]: { current: 0, total: workableIndices.length } }));
            await batch(workableIndices, 5, (idx) => processRow(tierKey, idx));
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
            console.log('🚀 [MB AI] Routing items via AI Router...');
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
                    console.error('❌ [MB AI] Routing failed:', routeData.categoryMap?.error_message);
                    alert("AI Routing failed: " + (routeData.categoryMap?.error_message || "Unknown error"));
                    setIsFurnitureAutoFilling(false);
                    setSwarm({ active: false, lanes: {}, minimized: false });
                    return;
                }
            } catch (err) {
                console.error('❌ [MB AI] Routing fetch failed:', err);
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

                    const sizeContext = [row.qty && `Qty: ${row.qty}`, row.unit && `Unit: ${row.unit}`].filter(Boolean).join(', ');
                    const enrichedDesc = sizeContext ? `${row.description} | ${sizeContext}` : row.description;

                    const response = await fetch(`${API_BASE}/api/auto-match-ai`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ description: enrichedDesc, tier: tierKey, availableBrands: activeBrandsForCall, brandCategoryRules: selectionMode === 'categorized' ? selectedBrandsOrMap : null, provider: selectedEngine, providerModel, scope: row.scope, type: 'furniture' })
                    });
                    const result = await response.json();

                    if (!isMounted?.current) return;

                    if (result.status === 'success' && result.product) {
                        const match = result.product;
                        const matchedBrandName = match.brand || '';
                        updateFurnitureStatus(tierKey, { status: 'success', brand: matchedBrandName, model: match.model || '', image: match.imageUrl || null });

                        const localBrandEntry = brands.find(b => b.name.toLowerCase().trim() === matchedBrandName.toLowerCase().trim());
                        const resolvedLogo = localBrandEntry?.logo || '';
                        if (result.source === 'ai-discovery-hardened') globalStats.newlyAdded++;

                        let finalBrandDesc = match.description || (match.model ? `Model: ${match.model}` : row.description);
                        let finalMainCat = match.mainCategory || 'Office Seating';
                        let finalSubCat = String(match.subCategory || 'Staff Chairs');
                        let finalFamily = String(match.family || '');
                        let finalModel = match.model || '';
                        let finalImageUrl = match.imageUrl || '';
                        let finalRate = parseFloat(match.price) > 0 ? parseFloat(match.price).toFixed(2) : (row.rate || '0.00');

                        if (localBrandEntry && localBrandEntry.products) {
                            const products = localBrandEntry.products;
                            const normalize = (s) => String(s || '').toLowerCase().replace(/#\d+/g, '').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
                            const target = normalize(finalModel);
                            const matches = products.filter(p => normalize(p.model).includes(target) || target.includes(normalize(p.model)));
                            if (matches.length > 0) {
                                const ranked = matches.sort((a, b) => (parseFloat(b.price) || 0) - (parseFloat(a.price) || 0));
                                const bestP = ranked[0];
                                finalMainCat = bestP.mainCategory || bestP.category || finalMainCat;
                                finalSubCat = bestP.subCategory || finalSubCat;
                                finalFamily = bestP.family || '';
                                finalModel = bestP.model;
                                finalImageUrl = bestP.imageUrl || finalImageUrl;
                                if (parseFloat(bestP.price) > 0) finalRate = parseFloat(bestP.price).toFixed(2);
                                if (bestP.description) finalBrandDesc = bestP.description;
                                match.bestModelUrl = bestP.productUrl || bestP.imageUrl || `id_${bestP.id}`;
                            }
                        }

                        const updatedRow = { ...row, selectedBrand: matchedBrandName, selectedMainCat: finalMainCat, selectedSubCat: finalSubCat, selectedFamily: finalFamily, selectedModel: finalModel, selectedModelUrl: match.bestModelUrl || match.productUrl || finalImageUrl, brandDesc: finalBrandDesc, brandImage: finalImageUrl, brandLogo: resolvedLogo, type: 'furniture', rate: finalRate, amount: (parseFloat(finalRate) * (parseFloat(row.qty) || 0)).toFixed(2), aiStatus: 'success', aiResult: result };
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
                    await sleep(400);
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

                    const catWorkableIndices = tierRows.map((r, i) => i).filter(i => !isHeaderRow(tierRows[i].description, tierRows[i]) && tierRows[i].aiStatus !== 'success' && (!tierRows[i].scope || !tierRows[i].scope.toUpperCase().includes('FITOUT')) && stringItemIds.includes(String(tierRows[i].id)));

                    if (catWorkableIndices.length > 0 && brandsByTier[tierKey].includes(targetBrand)) {
                        setFurnitureProgress(prev => ({ ...prev, [tierKey]: { current: 0, total: (prev[tierKey].total || 0) + catWorkableIndices.length } }));
                        const processCategoryBatch = async () => { await Promise.all(catWorkableIndices.map(async (idx) => { await processSingleRow(tierKey, idx, [targetBrand], catKey); })); };
                        swarmPromises.push(processCategoryBatch());
                    }
                });
            });

        } else {
            tierKeys.forEach(tierKey => {
                updateFurnitureStatus(tierKey, { active: true, minimized: false });
                const rows = tierDataRef.current[tierKey].rows || [];
                const workableIndices = rows.map((r, i) => i).filter(i => !isHeaderRow(rows[i].description, rows[i]) && rows[i].aiStatus !== 'success' && (!rows[i].scope || !rows[i].scope.toUpperCase().includes('FITOUT')));

                setFurnitureProgress(prev => ({ ...prev, [tierKey]: { current: 0, total: workableIndices.length } }));

                const processTierFallback = async () => { await Promise.all(workableIndices.map(async (idx) => { await processSingleRow(tierKey, idx, brandsByTier[tierKey], null); })); };
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
                    const match = result.product;
                    const matchedBrandName = match.brand || '';

                    updateFurnitureStatus(tierKey, { status: 'success', brand: matchedBrandName, model: match.model || '', image: match.imageUrl || null });

                    const localBrandEntry = brands.find(b => b.name.toLowerCase().trim() === matchedBrandName.toLowerCase().trim());
                    const resolvedLogo = localBrandEntry?.logo || '';

                    let finalBrandDesc = match.description || (match.model ? `Model: ${match.model}` : row.description);
                    let finalMainCat = match.mainCategory || 'Office Seating';
                    let finalSubCat = String(match.subCategory || 'Staff Chairs');
                    let finalFamily = String(match.family || '');
                    let finalModel = match.model || '';
                    let finalImageUrl = match.imageUrl || '';
                    let finalRate = parseFloat(match.price) > 0 ? parseFloat(match.price).toFixed(2) : (row.rate || '0.00');

                    if (localBrandEntry && localBrandEntry.products) {
                        const products = localBrandEntry.products;
                        const normalize = (s) => String(s || '').toLowerCase().replace(/#\d+/g, '').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
                        const target = normalize(finalModel);
                        const matches = products.filter(p => normalize(p.model).includes(target) || target.includes(normalize(p.model)));

                        if (matches.length > 0) {
                            const ranked = matches.sort((a, b) => (parseFloat(b.price) || 0) - (parseFloat(a.price) || 0));
                            const bestP = ranked[0];
                            finalMainCat = bestP.mainCategory || bestP.category || finalMainCat;
                            finalSubCat = bestP.subCategory || finalSubCat;
                            finalFamily = bestP.family || '';
                            finalModel = bestP.model;
                            finalImageUrl = bestP.imageUrl || finalImageUrl;
                            if (parseFloat(bestP.price) > 0) finalRate = parseFloat(bestP.price).toFixed(2);
                            if (bestP.description) finalBrandDesc = bestP.description;
                            match.bestModelUrl = bestP.productUrl || bestP.imageUrl || `id_${bestP.id}`;
                        }
                    }

                    const updatedRow = { ...row, selectedBrand: matchedBrandName, selectedMainCat: finalMainCat, selectedSubCat: finalSubCat, selectedFamily: finalFamily, selectedModel: finalModel, selectedModelUrl: match.bestModelUrl || match.productUrl || finalImageUrl, brandDesc: finalBrandDesc, brandImage: finalImageUrl, brandLogo: resolvedLogo, type: 'furniture', rate: finalRate, amount: (parseFloat(finalRate) * (parseFloat(row.qty) || 0)).toFixed(2), aiStatus: 'success', aiResult: result };
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

    const handleCellChange = (rowIndex, field, value) => {
        setTierData(prev => {
            const tier = prev[activeTier];
            if (!tier) return prev;
            const newRows = [...tier.rows];
            const row = { ...newRows[rowIndex] };

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
                const { model, url } = value;
                row.selectedModel = model;
                row.selectedModelUrl = url;

                const brand = brands.find(b => b.name === row.selectedBrand);
                if (brand && brand.products) {
                    let product = brand.products.find(p =>
                        (p.productUrl && p.productUrl === url) ||
                        (p.imageUrl && p.imageUrl === url)
                    );

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
                                    if (!isNaN(possibleIndex) && candidates[possibleIndex]) {
                                        product = candidates[possibleIndex];
                                    } else {
                                        product = candidates[0];
                                    }
                                } else {
                                    product = candidates[0];
                                }
                            } else {
                                product = candidates[0];
                            }
                        }
                    }

                    if (product) {
                        row.brandDesc = product.description || product.model;
                        row.brandImage = product.imageUrl || '';
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
            }
            else {
                row[field] = value;
                if (field === 'qty' || field === 'rate') {
                    const q = field === 'qty' ? parseFloat(value) : parseFloat(row.qty);
                    const r = field === 'rate' ? parseFloat(value) : parseFloat(row.rate);
                    if (!isNaN(q) && !isNaN(r)) {
                        row.amount = (q * r).toFixed(2);
                    }
                }
            }

            newRows[rowIndex] = row;
            return { ...prev, [activeTier]: { ...tier, rows: newRows } };
        });
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
                brandImage: '', brandDesc: '', description: '', qty: '', unit: '', rate: '', amount: '',
                selectedBrand: '', selectedMainCat: '', selectedSubCat: '', selectedFamily: '', selectedModel: ''
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

    const handleApplyCosting = (factors) => {
        setCostingFactors(factors);
        setIsCostingOpen(false);

        const activeTierData = tierData[activeTier];
        if (!activeTierData) return;

        const updatedRows = activeTierData.rows.map(row => {
            if (row.basePrice && row.basePrice > 0) {
                const markup = 1 + (factors.profit + factors.freight + factors.customs + factors.installation) / 100;
                const costedPrice = row.basePrice * markup * factors.exchangeRate;
                return { ...row, rate: costedPrice.toFixed(2) };
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
                tables: [{
                    sheetName: `New BOQ - ${activeTier.charAt(0).toUpperCase() + activeTier.slice(1)} Tier`,
                    header: ['Sr.', 'Image', 'Description', 'Qty', 'Unit', 'Rate', 'Amount'],
                    columnCount: 7,
                    rows: updatedRows.map(row => {
                        const amount = row.amount || (parseFloat(row.qty || 0) * parseFloat(row.rate || 0)).toFixed(2);
                        return {
                            cells: [
                                { value: row.sn },
                                {
                                    value: '',
                                    image: row.brandImage || row.imageRef,
                                    images: row.brandImage ? [{ url: row.brandImage }] : row.imageRef ? [{ url: row.imageRef }] : []
                                },
                                { value: row.brandDesc || row.description || 'N/A' },
                                { value: row.qty || '0' },
                                { value: row.unit || 'Nos' },
                                { value: row.rate || '0' },
                                { value: isNaN(parseFloat(amount)) ? '0' : amount }
                            ]
                        };
                    })
                }]
            };
            onApplyFlow(formattedData);
        }
    };

    const getImageData = async (url, options = {}) => {
        if (!url) return null;
        const maxWidth = options.maxWidth || 1000;
        const format = options.format || 'image/jpeg';
        const quality = options.quality || 0.85;
        const isExternal = url.startsWith('http') && !url.includes('localhost:3001') && !url.includes(window.location.hostname);

        const loadImageToCanvas = (imgSrc) => {
            return new Promise((resolve) => {
                const img = new Image();
                img.crossOrigin = "Anonymous";
                img.onload = () => {
                    const canvas = document.createElement("canvas");
                    const ratio = Math.min(1, maxWidth / img.width);
                    canvas.width = img.width * ratio;
                    canvas.height = img.height * ratio;
                    const ctx = canvas.getContext("2d");
                    if (format === 'image/jpeg') {
                        ctx.fillStyle = "#FFFFFF";
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                    } else {
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                    }
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve({ dataUrl: canvas.toDataURL(format, quality), width: canvas.width, height: canvas.height });
                };
                img.onerror = () => resolve(null);
                img.src = imgSrc;
            });
        };

        if (isExternal) {
            try {
                const proxyUrl = `${API_BASE}/api/image-proxy?url=${encodeURIComponent(url)}`;
                const response = await fetch(proxyUrl);
                if (!response.ok) return null;
                const blob = await response.blob();
                const blobUrl = URL.createObjectURL(blob);
                const result = await loadImageToCanvas(blobUrl);
                URL.revokeObjectURL(blobUrl);
                return result;
            } catch (e) {
                console.warn('Image proxy fetch failed:', e);
                return null;
            }
        } else {
            return loadImageToCanvas(url);
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

        const colors = {
            primary: [30, 95, 168],
            accent: [245, 166, 35],
            text: [51, 51, 51],
            lightText: [100, 116, 139],
            white: [255, 255, 255],
            lightBg: [248, 250, 252],
            border: [226, 232, 240]
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

        const imageDataMap = {};
        for (let i = 0; i < tier.rows.length; i++) {
            const row = tier.rows[i];
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

        const body = tier.rows.map((row, i) => {
            const amount = row.amount || (parseFloat(row.qty || 0) * parseFloat(row.rate || 0)).toFixed(2);
            if (isBoqMode) {
                return [
                    row.sn,
                    processText(row.location || '-'),
                    processText(row.scope || '-'),
                    '',
                    processText(row.description),
                    '',
                    processText(row.brandDesc),
                    row.qty || '',
                    row.unit || '',
                    row.rate || '',
                    amount
                ];
            } else {
                return [
                    row.sn,
                    processText(row.location || '-'),
                    processText(row.scope || '-'),
                    '',
                    processText(row.brandDesc),
                    row.qty || '',
                    row.unit || '',
                    row.rate || '',
                    amount
                ];
            }
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
                    const rowIdx = data.row.index;
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
                    const refImgCol = isBoqMode ? 3 : -1;
                    const brandImgCol = isBoqMode ? 5 : 3;
                    if (data.column.index === brandImgCol) {
                        data.cell.styles.minCellHeight = 32;
                    } else if (data.column.index === refImgCol) {
                        data.cell.styles.minCellHeight = 22;
                    }
                }
            },
            didDrawPage: (data) => {
                const str = "Page " + doc.internal.getNumberOfPages();
                doc.setFontSize(8);
                doc.setTextColor(...colors.lightText);
                doc.text(str, pageWidth / 2, pageHeight - 10, { align: 'center' });
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

        doc.setFontSize(8);
        doc.setTextColor(...colors.lightText);
        doc.setFont('helvetica', 'normal');
        if (arabicLoaded) doc.setFont('Almarai', 'normal');
        const footerText = website ? `${companyName} | ${website}` : companyName;
        doc.text(processText(footerText), pageWidth / 2, pageHeight - 10, { align: 'center' });

        doc.save(`MultiBudget_${activeTier}_Offer.pdf`);
    };

    const handleExportExcel = async () => {
        const tier = tierData[activeTier];
        if (!tier || !tier.rows.length) return alert('No data to export');

        const ExcelJS = (await import('exceljs')).default;
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'BOQFlow';
        workbook.created = new Date();

        const ws = workbook.addWorksheet(`${activeTier} Tier`, {
            properties: { tabColor: { argb: 'F5A623' } }
        });
        const isBoqMode = tier.mode === 'boq';

        ws.addRow(['']);
        ws.addRow(['', '', '', '', '', '', '', '', '']);
        ws.addRow(['', '', '', '', '', '', '', '', '']);
        ws.mergeCells('A2:C2');
        const titleCell = ws.getCell('A2');
        titleCell.value = `${activeTier.toUpperCase()} TIER OFFER`;
        titleCell.font = { bold: true, size: 14, color: { argb: '1E5FA8' } };

        ws.getCell('A3').value = `Generated on: ${new Date().toLocaleDateString()}`;
        ws.getCell('A3').font = { italic: true, size: 10, color: { argb: '64748B' } };

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
        if (hasAr) {
            ws.views = [{ rightToLeft: true }];
        }

        const headerRow = ws.addRow(header);
        headerRow.height = 25;
        headerRow.eachCell(cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E5FA8' } };
            cell.font = { color: { argb: 'FFFFFF' }, bold: true, size: 11 };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            cell.border = {
                top: { style: 'thin', color: { argb: '1E5FA8' } },
                bottom: { style: 'medium', color: { argb: 'F5A623' } }
            };
        });

        for (let i = 0; i < tier.rows.length; i++) {
            const row = tier.rows[i];
            const amount = (parseFloat(row.qty || 0) * parseFloat(row.rate || 0)).toFixed(2);
            const brandName = (row.selectedBrand || '').replace(/Explore collections by/i, '').trim();

            const dataRow = isBoqMode
                ? [
                    row.sn,
                    row.location || '-',
                    row.scope || '-',
                    '',
                    row.description || '',
                    '',
                    row.brandDesc || '',
                    row.qty || '',
                    row.unit || '',
                    row.rate || '',
                    amount
                ]
                : [
                    row.sn,
                    row.location || '-',
                    row.scope || '-',
                    '',
                    row.brandDesc || '',
                    row.qty || '',
                    row.unit || '',
                    row.rate || '',
                    amount
                ];

            const excelRow = ws.addRow(dataRow);
            const rowNumber = excelRow.number;
            excelRow.height = 75;

            excelRow.eachCell((cell, colNumber) => {
                cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
                cell.border = {
                    bottom: { style: 'thin', color: { argb: 'E2E8F0' } }
                };
                if ([2, 3, 5, 7].includes(colNumber)) {
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
                        ws.addImage(imageId, {
                            tl: { col: 3.05, row: rowNumber - 1 + 0.1 },
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
                        ws.addImage(logoId, {
                            tl: { col: brandImgCol + 0.1, row: rowNumber - 1 + 0.05 },
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
                        ws.addImage(brandId, {
                            tl: { col: brandImgCol + 0.05, row: rowNumber - 1 + 0.3 },
                            ext: { width: imgFit.w, height: imgFit.h }
                        });
                    }
                } catch (e) { console.log('Brand image error:', e); }
            }
        }
        const subtotal = tier.rows.reduce((sum, row) => sum + (parseFloat(row.qty || 0) * parseFloat(row.rate || 0)), 0);
        const vatAmount = subtotal * ((costingFactors.vat || 0) / 100);
        const grandTotal = subtotal + vatAmount;

        ws.addRow([]);
        let summaryStartCol = isBoqMode ? 8 : 6;

        const stRow = ws.addRow([]);
        stRow.getCell(summaryStartCol).value = 'Subtotal';
        stRow.getCell(summaryStartCol + 1).value = subtotal;
        stRow.getCell(summaryStartCol + 1).numFmt = '#,##0.00 " ' + costingFactors.toCurrency + '"';
        stRow.getCell(summaryStartCol).font = { bold: true };
        stRow.getCell(summaryStartCol + 1).alignment = { horizontal: 'right' };

        const vRow = ws.addRow([]);
        vRow.getCell(summaryStartCol).value = `VAT (${costingFactors.vat}%)`;
        vRow.getCell(summaryStartCol + 1).value = vatAmount;
        vRow.getCell(summaryStartCol + 1).numFmt = '#,##0.00 " ' + costingFactors.toCurrency + '"';
        vRow.getCell(summaryStartCol + 1).alignment = { horizontal: 'right' };

        const gtRow = ws.addRow([]);
        gtRow.getCell(summaryStartCol).value = 'GRAND TOTAL';
        gtRow.getCell(summaryStartCol + 1).value = grandTotal;
        gtRow.getCell(summaryStartCol + 1).numFmt = '#,##0.00 " ' + costingFactors.toCurrency + '"';
        gtRow.height = 30;

        [gtRow.getCell(summaryStartCol), gtRow.getCell(summaryStartCol + 1)].forEach(cell => {
            cell.font = { bold: true, size: 14, color: { argb: 'FFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E5FA8' } };
            cell.alignment = { vertical: 'middle', horizontal: 'right' };
            cell.border = {
                top: { style: 'medium', color: { argb: 'F5A623' } },
                bottom: { style: 'medium', color: { argb: 'F5A623' } },
                left: { style: 'medium', color: { argb: 'F5A623' } },
                right: { style: 'medium', color: { argb: 'F5A623' } }
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

        const colors = {
            primary: '1E5FA8',
            accent: 'F5A623',
            text: '2D3748',
            lightText: '718096',
            lightBg: 'F7FAFC',
            white: 'FFFFFF',
            border: 'E2E8F0'
        };

        pres.defineSlideMaster({
            title: 'PREMIUM_MASTER',
            background: { color: colors.white },
            objects: [
                { rect: { x: 0, y: 0, w: '100%', h: 0.75, fill: { color: colors.primary } } },
                { rect: { x: 0, y: 0.75, w: '100%', h: 0.06, fill: { color: colors.accent } } },
                { rect: { x: 0, y: 5.2, w: '100%', h: 0.3, fill: { color: colors.lightBg } } }
            ]
        });

        const titleSlide = pres.addSlide({ masterName: 'PREMIUM_MASTER' });
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
        } else {
            titleSlide.addText('LOGO', { x: 8.3, y: 0.25, w: 1.5, h: 0.3, fontSize: 10, color: colors.lightText, align: 'center' });
        }

        let itemNum = 1;
        for (const row of tier.rows) {
            if (!row.brandImage && !row.brandDesc) continue;
            const slide = pres.addSlide({ masterName: 'PREMIUM_MASTER' });
            const brandName = (row.selectedBrand || '').replace(/Explore collections by/i, '').trim();

            const descForHeader = (row.brandDesc || '');
            const firstLineHeader = descForHeader.split(/[\n*•]/)[0].trim();
            const headerTitle = firstLineHeader.length > 45 ? firstLineHeader.substring(0, 42) + '...' : firstLineHeader;

            slide.addText(`Item ${itemNum}: ${headerTitle}`, {
                x: 0.3, y: 0.15, w: 7.5, h: 0.4, fontSize: 12, bold: true, color: colors.white, valign: 'middle'
            });

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
            } else {
                slide.addText('LOGO', { x: 8.3, y: 0.25, w: 1.5, h: 0.3, fontSize: 10, color: colors.lightText, align: 'center' });
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
                x: rightX, y: rightY, w: rightWidth, h: 0.25, fontSize: 10, bold: true, color: colors.text
            });
            rightY += 0.25;

            const fullDescription = (row.brandDesc || 'N/A').trim();
            const maxDescY = 3.2;
            const availableH = maxDescY - rightY;
            const estDescLines = Math.ceil(fullDescription.length / 55) + (fullDescription.match(/[\n*•]/g) || []).length;
            const descBoxHeight = Math.min(availableH, Math.max(0.4, estDescLines * 0.14));

            slide.addText(fullDescription, {
                x: rightX, y: rightY, w: rightWidth, h: descBoxHeight,
                fontSize: 9, color: colors.text, valign: 'top',
                wrap: true, shrinkText: true
            });
            rightY += descBoxHeight + 0.08;

            const maxContentY = 4.4;

            if (rightY < maxContentY - 0.25) {
                slide.addText('Brand:', {
                    x: rightX, y: rightY, w: 0.7, h: 0.2, fontSize: 9, bold: true, color: colors.text
                });
                slide.addText(brandName || 'N/A', {
                    x: rightX + 0.55, y: rightY, w: rightWidth - 0.55, h: 0.2, fontSize: 9, color: colors.primary
                });
                rightY += 0.25;
            }

            if (rightY < maxContentY - 0.25) {
                slide.addText('Quantity:', {
                    x: rightX, y: rightY, w: 0.8, h: 0.2, fontSize: 9, bold: true, color: colors.text
                });
                slide.addText(String(row.qty || 'As per BOQ'), {
                    x: rightX + 0.7, y: rightY, w: rightWidth - 0.7, h: 0.2, fontSize: 9, color: colors.text
                });
                rightY += 0.28;
            }

            if (rightY < maxContentY - 0.35) {
                slide.addText('Specifications:', {
                    x: rightX, y: rightY, w: rightWidth, h: 0.2, fontSize: 9, bold: true, color: colors.primary
                });
                rightY += 0.22;

                const specsH = Math.min(maxContentY - rightY, 0.4);
                slide.addText('• Warranty: As per manufacturer', {
                    x: rightX + 0.1, y: rightY, w: rightWidth - 0.1, h: specsH, fontSize: 8, color: colors.text
                });
            }

            slide.addText('Warranty', {
                x: 0.3, y: 4.65, w: 1.0, h: 0.2, fontSize: 9, bold: true, color: colors.text
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

        let itemNum = 1;

        for (const row of tier.rows) {
            if (!row.brandImage && !row.brandDesc) continue;
            if (itemNum > 1) doc.addPage();
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
            let currentTitleY = 25;
            titleLines.slice(0, 2).forEach(tl => {
                doc.text(tl, 10, currentTitleY);
                currentTitleY += 8;
            });

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

        const colors = {
            primary: [43, 164, 224],
            accent: [245, 158, 11],
            text: [51, 65, 85],
            lightText: [100, 116, 139],
            lightBg: [248, 250, 252],
            white: [255, 255, 255],
            border: [203, 213, 225],
            success: [16, 185, 129]
        };

        let itemNum = 1;

        for (const row of tier.rows) {
            if (!row.brandImage && !row.brandDesc) continue;
            if (itemNum > 1) doc.addPage();
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

            if (brandName) {
                const badgeW = 65;
                const badgeX = imgContainerX + (imgContainerW - badgeW) / 2;
                doc.setFillColor(...colors.lightBg);
                doc.setDrawColor(...colors.primary);
                doc.setLineWidth(0.4);
                doc.roundedRect(badgeX, imgY, badgeW, 10, 2, 2, 'FD');

                doc.setTextColor(...colors.primary);
                doc.setFontSize(8);
                doc.setFont('helvetica', 'bold');
                doc.text(brandName.substring(0, 35), badgeX + badgeW / 2, imgY + 6.5, { align: 'center' });
                imgY += 12;
            }

            if (row.brandLogo) {
                try {
                    const brandLogoImg = await getImageData(row.brandLogo);
                    if (brandLogoImg) {

                        const fit = calcFitSize(brandLogoImg.width, brandLogoImg.height, 30, 8);
                        const logoX = imgContainerX + (imgContainerW - fit.w) / 2;
                        doc.addImage(brandLogoImg.dataUrl, 'JPEG', logoX, imgY - 10, fit.w, fit.h);
                    }
                } catch (e) { }
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

            const approvalY = doc.lastAutoTable.finalY + 10;

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

                        if (isConsolidated) {
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

                        const allScopesSet = new Set(displayRows.map(r => r.scope || 'Furniture'));
                        let scopes = Array.from(allScopesSet);

                        scopes.sort((a, b) => {
                            const aUpper = a.toUpperCase();
                            const bUpper = b.toUpperCase();
                            if (aUpper.includes('FITOUT') && bUpper.includes('FURNITURE')) return -1;
                            if (aUpper.includes('FURNITURE') && bUpper.includes('FITOUT')) return 1;
                            return a.localeCompare(b);
                        });

                        let globalSn = 1;

                        return scopes.map(scopeLabel => {
                            const scopeRows = displayRows.filter(r => (r.scope || 'Furniture') === scopeLabel);

                            if (scopeRows.length === 0) return null;

                            return (
                                <Fragment key={scopeLabel}>
                                    <tr className={styles.locationDivider}>
                                        <td colSpan={isBoqMode ? 12 : 10}>
                                            <div className={styles.locationDividerText} style={{ textTransform: 'uppercase', fontSize: '1.2em' }}>
                                                {scopeLabel} WORKS
                                            </div>
                                        </td>
                                    </tr>
                                    {scopeRows.map((row) => {
                                        let originalIndex = -1;
                                        if (isConsolidated && String(row.id).startsWith('cons_')) {
                                            const displayKey = String(row.id).replace('cons_', '');
                                            originalIndex = rows.findIndex(r => {
                                                const rScope = (r.scope || 'Furniture').trim().toLowerCase();
                                                const rKey = (r.brandDesc || r.description || 'N/A').trim().toLowerCase() + '::' + rScope;
                                                return rKey === displayKey;
                                            });
                                        } else {
                                            originalIndex = rows.findIndex(r => String(r.id) === String(row.id));
                                        }
                                        return renderRow(row, globalSn++, isBoqMode, originalIndex);
                                    })}
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

    const renderRow = (row, sn, isBoqMode, index) => {
        const refImgSrc = getFullUrl(row.imageRef);

        const activeBrand = brands.find(b => {
            if (b.type === 'fitout' || b.name === 'FitOut V2') {
                return b.name === row.selectedBrand && (b.budgetTier === activeTier || !b.budgetTier);
            }
            return b.name === row.selectedBrand;
        }) || brands.find(b => b.name === row.selectedBrand);
        const brandProducts = activeBrand?.products || [];

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

        const mainCats = mergeUnique(brandProducts, 'normalization.category', 'mainCategory');
        const matchingByMain = brandProducts.filter(p => (p.normalization?.category || p.mainCategory) === row.selectedMainCat);
        const subCats = mergeUnique(matchingByMain, 'normalization.subCategory', 'subCategory');
        const families = getUniqueValues(brandProducts.filter(p =>
            (p.normalization?.category || p.mainCategory) === row.selectedMainCat &&
            (p.normalization?.subCategory || p.subCategory) === row.selectedSubCat
        ), 'family');

        const allRawModels = brandProducts.filter(p =>
            (p.normalization?.category || p.mainCategory) === row.selectedMainCat &&
            (p.normalization?.subCategory || p.subCategory) === row.selectedSubCat &&
            (p.family || '') === (row.selectedFamily || '')
        );

        const rawModels = [];
        const seenUids = new Set();
        allRawModels.forEach(p => {
            const uid = p.productUrl || p.imageUrl || `id_${p.id || Math.random()}`;
            if (!seenUids.has(uid)) {
                seenUids.add(uid);
                rawModels.push(p);
            }
        });

        const modelGroups = {};
        rawModels.forEach(p => {
            if (!modelGroups[p.model]) modelGroups[p.model] = [];
            modelGroups[p.model].push(p);
        });

        const modelOptions = [];
        Object.entries(modelGroups).forEach(([modelName, items]) => {
            items.forEach((item, i) => {
                const catSnippet = item.subCategory || item.mainCategory || 'Misc';
                const snippet = item.description ? item.description.substring(0, 25) + '...' : `Variant ${i + 1}`;
                const uniqueVal = item.productUrl || item.imageUrl || `model_${modelName}_${i}`;
                modelOptions.push({
                    value: uniqueVal,
                    label: items.length > 1 ? `[${catSnippet}] ${modelName} (${snippet})` : `[${catSnippet}] ${modelName}`,
                    rawModel: modelName
                });
            });
        });

        const rowStatusClass = row.aiStatus === 'processing' ? styles.aiPulse :
            row.aiStatus === 'success' ? styles.aiGlow :
                row.aiStatus === 'error' ? styles.aiErrorBorder : '';

        return (
            <tr key={row.id} className={`${rowStatusClass} ${row.aiStatus === 'skipped' ? styles.skippedRow : ''}`}>
                <td style={{ textAlign: 'center', verticalAlign: 'middle', minWidth: 40, fontSize: '0.78rem', color: 'var(--text-muted,#94a3b8)', fontWeight: 600 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                        {sn}
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
                    <td style={{ verticalAlign: 'middle', minWidth: 72 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                            {row.imageRef ? (
                                <div className={styles.tableImgContainer}>
                                    <img
                                        src={refImgSrc}
                                        alt="ref"
                                        className={styles.tableImg}
                                        onClick={(e) => {
                                            if (e.target.dataset.broken === 'true') return;
                                            setPreviewImage(refImgSrc);
                                            setPreviewLogo(null);
                                            setPreviewBrand('Original Reference');
                                            setPreviewModel(row.description);
                                        }}
                                        onError={(e) => {
                                            e.target.dataset.broken = 'true';
                                            e.target.style.opacity = '0.3';
                                            e.target.style.filter = 'grayscale(1)';
                                            e.target.title = 'Image not available (session expired – re-upload to refresh)';
                                        }}
                                    />
                                    {row.aiStatus === 'processing' && <div className={styles.rowScanner}></div>}
                                </div>
                            ) : (
                                <div className={styles.tableImgContainer} style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                                    No Img
                                    {row.aiStatus === 'processing' && <div className={styles.rowScanner}></div>}
                                </div>
                            )}
                        </div>
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

                <td style={{ verticalAlign: 'middle', minWidth: 80 }}>
                    <div className={styles.brandImageCell}>
                        {row.brandLogo && (
                            <div className={styles.brandLogoBadge}>
                                <img
                                    src={getFullUrl(row.brandLogo)}
                                    alt=""
                                    className={styles.badgeLogo}
                                    onError={(e) => { e.target.style.display = 'none'; }}
                                />
                            </div>
                        )}
                        {row.brandImage ? (
                            <div className={styles.tableImgContainer}>
                                <img
                                    src={getFullUrl(row.brandImage)}
                                    alt="brand"
                                    className={styles.tableImg}
                                    onClick={(e) => {
                                        if (e.target.dataset.broken === 'true') return;
                                        setPreviewImage(getFullUrl(row.brandImage));
                                        setPreviewLogo(getFullUrl(row.brandLogo));
                                        setPreviewBrand(row.selectedBrand);
                                        setPreviewModel(row.selectedModel);
                                    }}
                                    onError={(e) => {
                                        e.target.dataset.broken = 'true';
                                        e.target.style.opacity = '0.3';
                                        e.target.style.filter = 'grayscale(1)';
                                    }}
                                />
                                {row.aiStatus === 'processing' && <div className={styles.rowScanner}></div>}
                            </div>
                        ) : (
                            <div className={styles.tableImgContainer} style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                                {row.aiStatus === 'processing' ? 'Searching...' : 'Select'}
                                {row.aiStatus === 'processing' && <div className={styles.rowScanner}></div>}
                            </div>
                        )}
                    </div>
                </td>

                <td style={{ verticalAlign: 'middle', minWidth: 160 }}>
                    <textarea
                        className={styles.cellInput}
                        value={row.brandDesc}
                        onChange={(e) => handleCellChange(index, 'brandDesc', e.target.value)}
                        style={{ minHeight: '72px', resize: 'vertical', width: '100%' }}
                        placeholder="Product details..."
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

                <td style={{ verticalAlign: 'middle', minWidth: 200 }}>
                    <div className={styles.dropdownStack}>
                        <div className={styles.brandDropdownContainer}>
                            {row.aiStatus === 'processing' ? (
                                <div className={styles.aiLoadingCell}>
                                    <div className={styles.tinySpinner} />
                                    <span style={{ fontSize: '0.72rem' }}>AI Matching…</span>
                                </div>
                            ) : (
                                <BrandDropdown
                                    brands={brands.filter(b => {
                                        const bTier = (b.budgetTier || 'mid').toLowerCase();
                                        const aTier = activeTier.toLowerCase();
                                        let tierMatch = false;
                                        if (aTier === 'budgetary') tierMatch = ['budgetary', 'low'].includes(bTier);
                                        else if (aTier === 'high') tierMatch = ['high', 'high-end', 'premium'].includes(bTier);
                                        else tierMatch = !['budgetary', 'low', 'high', 'high-end', 'premium'].includes(bTier);

                                        if (!tierMatch) return false;

                                        const rowScope = (row.scope || 'Furniture').toLowerCase();
                                        const brandType = (b.type || (b.name.toLowerCase().includes('fitout') ? 'fitout' : 'furniture')).toLowerCase();

                                        if (rowScope.includes('fitout')) {
                                            return brandType === 'fitout';
                                        } else {
                                            return brandType !== 'fitout';
                                        }
                                    }).map(b => ({
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
                            <select className={styles.productSelect} value={row.selectedMainCat} onChange={(e) => handleCellChange(index, 'selectedMainCat', e.target.value)}>
                                <option value="">Category...</option>
                                {(mainCats || []).map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        )}
                        {row.selectedMainCat && (
                            <select className={styles.productSelect} value={row.selectedSubCat} onChange={(e) => handleCellChange(index, 'selectedSubCat', e.target.value)}>
                                <option value="">Sub-Category...</option>
                                {(subCats || []).map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        )}
                        {row.selectedSubCat && (
                            <select className={styles.productSelect} value={row.selectedFamily} onChange={(e) => handleCellChange(index, 'selectedFamily', e.target.value)}>
                                <option value="">Family...</option>
                                {(families || []).map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        )}
                        {row.selectedFamily && (
                            <select
                                className={styles.productSelect}
                                value={row.selectedModelUrl || ''}
                                onChange={(e) => {
                                    const opt = modelOptions.find(o => o.value === e.target.value);
                                    handleCellChange(index, 'selectedModel', {
                                        model: opt?.rawModel || '',
                                        url: e.target.value
                                    });
                                }}
                            >
                                <option value="">Model Variant...</option>
                                {modelOptions.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        )}
                    </div>
                </td>

                <td style={{ verticalAlign: 'middle', textAlign: 'center', minWidth: 40 }}>
                    <div className={styles.actionCell}>
                        <button className={`${styles.actionBtn} ${styles.addBtn}`} onClick={() => handleAddRow(index)}>+</button>
                        <button className={`${styles.actionBtn} ${styles.removeBtn}`} onClick={() => handleRemoveRow(index)}>×</button>
                    </div>
                </td>
            </tr>
        );
    };

    const renderComparisonTable = () => {
        const budgetaryRows = tierData.budgetary?.rows || [];
        const midRows = tierData.mid?.rows || [];
        const highRows = tierData.high?.rows || [];

        const sampleRows = budgetaryRows.length > 0 ? budgetaryRows : midRows.length > 0 ? midRows : highRows;

        if (sampleRows.length === 0) return (
            <div className={styles.emptyState}>
                <div style={{ fontSize: '3rem', opacity: 0.2 }}>🔍</div>
                <div style={{ marginTop: '1rem' }}>No data to compare. Select products for each tier first.</div>
            </div>
        );

        return (
            <table className={styles.comparisonTable}>
                <thead>
                    <tr>
                        <th style={{ width: '15%' }}>Original Item</th>
                        <th style={{ width: '28.33%' }} className={`${styles.tierHeader} ${styles.tierBudgetary}`}>💰 Budgetary</th>
                        <th style={{ width: '28.33%' }} className={`${styles.tierHeader} ${styles.tierMid}`}>⭐ Mid-Range</th>
                        <th style={{ width: '28.33%' }} className={`${styles.tierHeader} ${styles.tierHigh}`}>👑 High-End</th>
                    </tr>
                </thead>
                <tbody>
                    {sampleRows.map((row, i) => (
                        <tr key={row.sn || i}>
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
                                const match = tierData[tierKey]?.rows[i];
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
                                                        alt=""
                                                        className={styles.compImg}
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
                    ))}
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
                            💰 Multi-Budget Offers
                        </div>
                        <button className={styles.closeBtn} onClick={onClose}>×</button>
                    </div>

                    <div className={styles.content}>

                        <div className={styles.topSection}>
                            <div className={styles.mainActions}>
                                <button className={`${styles.actionCard} ${styles.uploadBoqBtn}`} onClick={handleUploadBoqTrigger}>
                                    <span style={{ fontSize: '1.4rem' }}>📤</span>
                                    <span>Upload BOQ</span>
                                </button>
                                <button className={`${styles.actionCard} ${styles.genBoqBtn}`} onClick={handleGenerateFromBoq}>
                                    <span style={{ fontSize: '1.4rem' }}>📋</span>
                                    <span>Generate from BOQ</span>
                                </button>
                                <button className={`${styles.actionCard} ${styles.genPlanBtn}`} onClick={handleUploadPlanTrigger}>
                                    <span style={{ fontSize: '1.4rem' }}>📐</span>
                                    <span>Upload Plan</span>
                                </button>
                                <button className={`${styles.actionCard} ${styles.createNewBtn}`} onClick={handleCreateNewBoq}>
                                    <span style={{ fontSize: '1.4rem' }}>➕</span>
                                    <span>Create New BOQ</span>
                                </button>

                                {planPreviewUrl && (
                                    <button className={`${styles.actionCard} ${styles.planPreviewBtn}`} onClick={() => setPlanPreviewOpen(true)}>
                                        <div className={styles.planPreviewThumb}>
                                            {planPreviewType === 'application/pdf' ? (
                                                <span className={styles.planPreviewPdfIcon} role="img" aria-label="PDF">📄</span>
                                            ) : (
                                                <img src={planPreviewUrl} alt={planPreviewName || 'Plan preview'} className={styles.planPreviewThumbImg} />
                                            )}
                                        </div>
                                        <span>Preview Plan</span>
                                    </button>
                                )}
                                <button className={`${styles.actionCard} ${styles.consolidateBtn} ${isConsolidated ? styles.consolidateBtnActive : ''}`} onClick={() => setIsConsolidated(!isConsolidated)}>
                                    <span style={{ fontSize: '1.4rem' }}>{isConsolidated ? '🏠' : '📦'}</span>
                                    <span>{isConsolidated ? 'Room Wise' : 'Consolidate Items'}</span>
                                </button>
                                <button className={`${styles.actionCard} ${styles.addBrandBtn}`} onClick={handleAddBrand}>
                                    <span style={{ fontSize: '1.4rem' }}>🏢</span>
                                    <span>Add Brand</span>
                                </button>
                                <button
                                    className={`${styles.actionCard} ${styles.aiAutoFillBtn} ${isFurnitureAutoFilling ? styles.aiAutoFilling : ''}`}
                                    onClick={handleAutoFillAI}
                                    disabled={isFurnitureAutoFilling}
                                >
                                    <span style={{ fontSize: '1.4rem' }}>✨</span>
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
                                    <span style={{ fontSize: '1.4rem' }}>🛠️</span>
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
                        <button className={styles.applyCostingBtn} onClick={() => setIsCostingOpen(true)}>
                            Apply Costing & Review
                        </button>

                        <div style={{ width: '100%', borderTop: '1px solid rgba(255,255,255,0.1)' }} />

                        <div className={styles.exportGroup}>
                            <button className={styles.exportBtn} onClick={handleExportPDF}>Offer PDF</button>
                            <button className={styles.exportBtn} onClick={handleExportExcel}>Offer Excel</button>
                            <button className={styles.exportBtn} onClick={handleExportPPTX}>Presentation</button>
                            <button className={styles.exportBtn} onClick={handleExportPresentationPDF}>PDF</button>
                            <button className={styles.exportBtn} onClick={handleExportMAS}>MAS</button>
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
                            {planPreviewType === 'application/pdf' ? (
                                <object data={planPreviewUrl} type="application/pdf" className={styles.previewImage}>
                                    <div className={styles.previewFallback}>PDF preview unavailable</div>
                                </object>
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