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


export default function MultiBudgetModal({ isOpen, onClose, originalTables, onApplyFlow, seededItems = null, onUploadBoq, onUploadPlan }) {
    const profile = useCompanyProfile();
    const { theme } = useTheme();
    const { companyName, logoWhite, logoBlue, website, updateProfile, processLogoFile } = profile;
    const [activeTier, setActiveTier] = useState('mid'); // budgetary, mid, high
    const [previewImage, setPreviewImage] = useState(null); // URL of image to preview
    const [previewLogo, setPreviewLogo] = useState(null); // URL of brand logo for preview
    const [previewBrand, setPreviewBrand] = useState(null);
    const [previewModel, setPreviewModel] = useState(null);
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

    // AI processing states split per type and tier
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

    // State stores data + mode PER TIER
    // Structure: { mid: { rows: [...], mode: 'boq'|'new' }, ... }
    const [tierData, setTierData] = useState({
        budgetary: null,
        mid: null,
        high: null
    });

    // Handle seededItems from props (e.g. from Landing Page Plan Upload)
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
    // Keep a ref that always reflects the latest tierData so async functions
    // can read it after React's state batching (avoids stale closure)
    const tierDataRef = useRef(tierData);
    useEffect(() => { tierDataRef.current = tierData; }, [tierData]);

    // Brand System
    const [brands, setBrands] = useState([]);
    const [isAddBrandOpen, setIsAddBrandOpen] = useState(false);
    const [openBrandDropdown, setOpenBrandDropdown] = useState(null); // row index of open dropdown

    const boqInputRef = useRef(null);
    const planInputRef = useRef(null);

    // Costing System
    const [isCostingOpen, setIsCostingOpen] = useState(false);
    const [costingFactors, setCostingFactors] = useState({
        profit: 0,
        freight: 0,
        customs: 0,
        installation: 0,
        vat: 5, // Default VAT 5%
        fromCurrency: 'USD',
        toCurrency: 'OMR',
        exchangeRate: 0.385
    });

    const normalizeBrandName = (name) => {
        // Normalize whitespace and trim to avoid odd rendering caused by newlines or extra spaces
        const clean = String(name || '').replace(/\s+/g, ' ').trim();
        return clean || 'Unnamed Brand';
    };

    const fetchBrands = () => {
        fetch(`${API_BASE}/api/brands`)
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) {
                    const cleaned = data.map(brand => ({
                        ...brand,
                        name: normalizeBrandName(brand.name)
                    }));

                    setBrands(cleaned);

                    // Auto-update prices in existing rows if they are 0
                    setTierData(prev => {
                        const newState = { ...prev };
                        ['budgetary', 'mid', 'high'].forEach(tierName => {
                            const tier = newState[tierName];
                            if (tier && tier.rows) {
                                const newRows = tier.rows.map(row => {
                                    if (row.selectedBrand && row.selectedModel) {
                                        const brand = cleaned.find(b => b.name === row.selectedBrand);
                                        if (brand && brand.products) {
                                            // Find the product
                                            let product = brand.products.find(p =>
                                                (p.productUrl && p.productUrl === row.selectedModelUrl) ||
                                                (p.model === row.selectedModel && p.productUrl === row.selectedModelUrl) ||
                                                (p.model === row.selectedModel) // Fallback match
                                            );

                                            const currentRate = parseFloat(row.rate || 0);
                                            // Debug log
                                            // console.log(`Checking ${row.selectedModel}: rate=${currentRate}, foundPrice=${product ? product.price : 'none'}`);

                                            // Relaxed condition: if rate is 0 or missing, and we have a price
                                            if (product && parseFloat(product.price) > 0 && currentRate === 0) {
                                                const basePrice = parseFloat(product.price);
                                                console.log(`Auto-updating ${row.selectedModel} price to ${basePrice}`);

                                                // Protected update: don't overwrite AI matches that already have descriptions
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

    useEffect(() => {
        fetchBrands();
    }, []);

    if (!isOpen) return null;

    const findCol = (header, regex) => {
        if (!header) return -1;
        return header.findIndex(h => h && regex.test(String(h)));
    };

    const buildBoqRows = () => {
        if (!originalTables || originalTables.length === 0) return [];
        const sourceTable = originalTables[0];
        const header = sourceTable.header || [];

        let idxDesc = findCol(header, /description|desc/i);
        if (idxDesc === -1) idxDesc = 1; // Fallback to column 2 if not found

        // Improve Qty detection: prioritize "Qty/Quantity" but ignore if it's clearly a rate/price column
        let idxQty = findCol(header, /^(?!.*(rate|price|amount)).*(qty|quantity)/i);
        if (idxQty === -1) idxQty = findCol(header, /qty|quantity/i);

        const idxUnit = findCol(header, /unit|uom/i);
        const idxRate = findCol(header, /rate|price/i);

        // Improve Total detection: prioritize "Total/Amount" but ignore if it's a qty column
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
        if (boqInputRef.current) {
            boqInputRef.current.click();
        }
    };

    const handleCreateNewBoq = () => {
        const emptyRows = Array(10).fill().map((_, i) => ({
            id: Date.now() + i,
            sn: i + 1,
            imageRef: null,
            brandImage: '', brandDesc: '', description: '', qty: '', unit: '', rate: '', amount: '',
            selectedBrand: '', selectedMainCat: '', selectedSubCat: '', selectedFamily: '', selectedModel: ''
        }));

        // Update ONLY active tier with NEW mode
        setTierData(prev => ({
            ...prev,
            [activeTier]: { rows: emptyRows, mode: 'new' }
        }));
    };

    const handleAddBrand = () => {
        setIsAddBrandOpen(true);
    };

    const handleBrandAdded = (newBrand) => {
        setBrands(prev => [...prev, newBrand]);
    };

    const handlePlanApplied = (planItems) => {
        if (!planItems || planItems.length === 0) return;

        const newRows = planItems.map((item, i) => ({
            id: Date.now() + i,
            sn: i + 1,
            imageRef: null,
            brandImage: '', brandDesc: '',
            // Professional QS formatting: Strip all existing bracketed locations and prepend the official one
            description: `[${item.location}] ${item.description.replace(/^(\[.*?\]\s*)+/, '').trim()}`,
            location: item.location,
            scope: item.scope,
            qty: item.qty,
            unit: item.unit || 'Nos',
            rate: '',
            amount: '',
            selectedBrand: '', selectedMainCat: '', selectedSubCat: '', selectedFamily: '', selectedModel: ''
        }));

        // Seed ALL three tiers similarly to handleGenerateFromBoq
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
            for (const part of parts) {
                val = val?.[part];
            }
            return val;
        }).filter(Boolean))];
        return results.length > 0 ? results : null;
    };

    const handleAutoFillAI = () => {
        // Ensure ALL tiers have rows before opening modal
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
            // Only seed tiers that are still empty
            const rows = buildBoqRows();
            setTierData(prev => ({
                budgetary: prev.budgetary?.rows?.length ? prev.budgetary : { rows: rows.map(r => ({ ...r, id: r.id + 0 })), mode: 'boq' },
                mid: prev.mid?.rows?.length ? prev.mid : { rows: rows.map(r => ({ ...r, id: r.id + 100000 })), mode: 'boq' },
                high: prev.high?.rows?.length ? prev.high : { rows: rows.map(r => ({ ...r, id: r.id + 200000 })), mode: 'boq' }
            }));
        }
        setIsAutoFillSelectOpen(true);
    };

    const handleFitoutAutoFill = () => {
        setIsFitoutAutoFillOpen(true);
    };

    const executeFitoutAutoFillAI = async (availableBrands, selectedEngine, providerModel = null) => {
        setIsFitoutAutoFillOpen(false);
        setIsFitoutAutoFilling(true);
        setFitoutBatchResult(null);

        const isHeaderRow = (desc, row = {}) => {
            if (!desc || desc.trim() === '') return true;
            const normalized = desc.trim().toLowerCase();
            
            // If it has a code pattern like [FL-01], it's definitely an item
            if (/^\[.*?\]/.test(normalized)) return false;

            // If it has quantity or unit, it's definitely an item
            const hasData = String(row.qty || '').trim() || String(row.unit || '').trim() || String(row.rate || '').trim();
            if (hasData) return false;

            const exactHeaders = ['item', 'description', 'desc', 'quantity', 'qty', 'unit', 'uom', 'rate', 'price', 'total', 'amount', 's.n.', 'sn', 'sr.no', 'sr no', 'id', 'ref', 'area', 'specification', 'specifications', 'remarks', 'location', 'description and area', 'description & area', 'room', 'floor', 'block', 'zone', 'subtotal', 'total amount', 'grand total', 'net total', 'discount'];
            if (exactHeaders.some(kw => normalized === kw || normalized.startsWith(kw + ' '))) return true;

            // More restrictive regex for generic markers
            if (/^(location|area|floor|block|zone|room|item\s*no|s\.no|ref)$/i.test(normalized)) return true;
            
            return false;
        };

        const tierKeys = ['budgetary', 'mid', 'high'].filter(k => tierDataRef.current[k]?.rows?.length > 0);
        if (tierKeys.length > 1) setActiveTier('comparison');

        let globalStats = { success: 0, error: 0, newlyAdded: 0 };
        const matchCache = new Map(); // description -> responseData object

        const processRow = async (tierKey, rowIndex) => {
            const row = tierDataRef.current[tierKey].rows[rowIndex];
            if (!row || !row.scope?.toUpperCase().includes('FITOUT') || isHeaderRow(row.description, row) || row.selectedBrand) return;

            const rowId = String(row.id);
            updateFitoutStatus(tierKey, { currentItem: row, status: 'identifying', brand: '...', model: 'Matching Fitout...', image: null });

            // Set uniform loading effect
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
                    console.log(`  ♻️ [Fitout Logic] Reusing cached match for: "${cleanDesc}"`);
                    currentMatchData = matchCache.get(cleanDesc);
                    product = currentMatchData.product;
                    newlyAdded = !!currentMatchData.newlyAdded;
                } else {
                    // Extract only brands that were selected for THIS specific tier
                    // availableBrands format is now: ["BrandName|budgetary", "BrandName|mid", ...]
                    const brandsForThisTier = availableBrands
                        .filter(s => s.endsWith(`|${tierKey}`))
                        .map(s => s.split('|')[0]);

                    // Skip if Fitout V2 specifically WAS NOT selected for this tier
                    // (Assuming Fitout V2 is the primarily used one)
                    if (brandsForThisTier.length === 0) {
                        console.log(`  ⏭️ [Fitout Logic] Skipping tier ${tierKey} because no brands were selected for it.`);
                        return;
                    }

                    const response = await fetch(`${API_BASE}/api/auto-match-ai`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            description: cleanDesc, 
                            qty: row.qty, 
                            unit: row.unit, 
                            tier: tierKey, 
                            availableBrands: brandsForThisTier, 
                            provider: selectedEngine, 
                            providerModel, 
                            scope: 'Fitout', 
                            type: 'fitout' 
                        })
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
                        
                        const updatedRow = {
                            selectedBrand: product.brand || 'FitOut V2',
                            brandDesc: product.description || product.model,
                            brandImage: product.imageUrl || row.imageRef || row.brandImage,
                            selectedModel: product.model,
                            selectedMainCat: product.mainCategory || product.category || 'Partition Wall',
                            selectedSubCat: product.subCategory || 'full height partition wall',
                            selectedFamily: product.family || 'Element',
                            type: 'fitout',
                            rate: finalPrice,
                            aiStatus: 'success',
                            aiResult: currentMatchData
                        };

                        // 1. Update primary tier
                        if (next[tierKey]) {
                            next[tierKey].rows = next[tierKey].rows.map((r, idx) => {
                                if (idx === rowIndex) {
                                    return { 
                                        ...r, 
                                        ...updatedRow,
                                        amount: r.qty ? (parseFloat(r.qty) * finalPrice) : finalPrice
                                    };
                                }
                                return r;
                            });
                        }

                        // 2. Clone to OTHER rows in the SAME tier for identical descriptions
                        [tierKey].forEach(tKey => {
                            if (!next[tKey]) return;
                            next[tKey].rows = next[tKey].rows.map((r) => {
                                const otherClean = (r.description || '').replace(/^\[.*?\]\s*/, '').trim();
                                if (otherClean === cleanDesc && !r.selectedBrand) {
                                    console.log(`  👯 [Fitout Logic] Cloning match to ${tKey} tier for: "${cleanDesc}"`);
                                    return { 
                                        ...r, 
                                        ...updatedRow,
                                        amount: r.qty ? (parseFloat(r.qty) * finalPrice) : finalPrice
                                    };
                                }
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
                    
                    setTierData(prev => ({
                        ...prev,
                        [tierKey]: { 
                            ...prev[tierKey], 
                            rows: prev[tierKey].rows.map(r => String(r.id) === rowId ? { ...r, aiStatus: newStatus, aiError: currentMatchData?.message } : r) 
                        }
                    }));
                }
            } catch (e) {
                updateFitoutStatus(tierKey, { status: 'error' });
                globalStats.error++;
                setTierData(prev => ({
                    ...prev,
                    [tierKey]: { 
                        ...prev[tierKey], 
                        rows: prev[tierKey].rows.map(r => String(r.id) === rowId ? { ...r, aiStatus: 'error', aiError: e.message } : r) 
                    }
                }));
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


    const executeAutoFillAI = async (selectedBrands, selectedEngine, providerModel = null) => {
        setIsAutoFillSelectOpen(false);
        setIsFurnitureAutoFilling(true);
        setFurnitureBatchResult(null);

        const isHeaderRow = (desc, row = {}) => {
            if (!desc || desc.trim() === '') return true;
            const normalized = desc.trim().toLowerCase();
            
            // If it has a code pattern like [FL-01], it's definitely an item
            if (/^\[.*?\]/.test(normalized)) return false;

            // If it has quantity or unit, it's definitely an item
            const hasData = String(row.qty || '').trim() || String(row.unit || '').trim() || String(row.rate || '').trim();
            if (hasData) return false;

            const exactHeaders = [
                'item', 'description', 'desc', 'quantity', 'qty', 'unit', 'uom',
                'rate', 'price', 'total', 'amount', 's.n.', 'sn', 'sr.no', 'sr no', 'id',
                'ref', 'area', 'specification', 'specifications', 'remarks', 'location',
                'description and area', 'description & area', 'room', 'floor', 'block', 'zone',
                'subtotal', 'total amount', 'grand total', 'net total', 'discount'
            ];
            if (exactHeaders.some(kw => normalized === kw || normalized.startsWith(kw + ' '))) return true;

            // More restrictive regex for generic markers
            if (/^(location|area|floor|block|zone|room|item\s*no|s\.no|ref)$/i.test(normalized)) return true;
            
            if (/^(group|type|section|category|list)\s+of\s/i.test(normalized)) return true;
            return false;
        };

        const brandsByTier = { budgetary: [], mid: [], high: [] };
        for (const brandName of selectedBrands) {
            const dbEntry = brands.find(b => b.name === brandName);
            const t = (dbEntry?.budgetTier || 'mid').toLowerCase();
            const key = (t === 'high' || t === 'premium') ? 'high' : t === 'budgetary' ? 'budgetary' : 'mid';
            brandsByTier[key].push(brandName);
        }

        const tierKeys = ['budgetary', 'mid', 'high'].filter(k => brandsByTier[k].length > 0 && tierDataRef.current[k]?.rows?.length > 0);
        if (tierKeys.length === 0) {
            setIsFurnitureAutoFilling(false);
            return;
        }

        // Switch to Comparison View if multiple tiers are being filled
        if (tierKeys.length > 1) {
            setActiveTier('comparison');
        } else {
            setActiveTier(tierKeys[0]);
        }

        let globalStats = { success: 0, error: 0, newlyAdded: 0 };

        const processRow = async (tierKey, rowIndex) => {
            const row = tierDataRef.current[tierKey].rows[rowIndex];
            if (!row || isHeaderRow(row.description, row) || (row.scope && row.scope.toUpperCase().includes('FITOUT')) || row.aiStatus === 'success') return;

            const rowId = String(row.id);
            updateFurnitureStatus(tierKey, {
                currentItem: row,
                status: 'identifying',
                brand: '...',
                model: 'Finding match...',
                image: null
            });

            setTierData(prev => {
                const updatedRows = [...prev[tierKey].rows];
                updatedRows[rowIndex] = { ...updatedRows[rowIndex], aiStatus: 'processing' };
                return { ...prev, [tierKey]: { ...prev[tierKey], rows: updatedRows } };
            });

            const sizeContext = [row.qty && `Qty: ${row.qty}`, row.unit && `Unit: ${row.unit}`].filter(Boolean).join(', ');
            const enrichedDesc = sizeContext ? `${row.description} | ${sizeContext}` : row.description;

            try {
                const response = await fetch(`${API_BASE}/api/auto-match-ai`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        description: enrichedDesc,
                        tier: tierKey,
                        availableBrands: brandsByTier[tierKey],
                        provider: selectedEngine,
                        providerModel,
                        scope: row.scope,
                        type: 'furniture'
                    })
                });

                const result = await response.json();
                if (result.status === 'success' && result.product) {
                    const match = result.product;
                    const matchedBrandName = match.brand || '';

                    updateFurnitureStatus(tierKey, {
                        status: 'success',
                        brand: matchedBrandName,
                        model: match.model || '',
                        image: match.imageUrl || null
                    });

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

                    const updatedRow = {
                        ...row,
                        selectedBrand: matchedBrandName,
                        selectedMainCat: finalMainCat,
                        selectedSubCat: finalSubCat,
                        selectedFamily: finalFamily,
                        selectedModel: finalModel,
                        selectedModelUrl: match.bestModelUrl || match.productUrl || finalImageUrl,
                        brandDesc: finalBrandDesc,
                        brandImage: finalImageUrl,
                        brandLogo: resolvedLogo,
                        type: 'furniture',
                        rate: finalRate,
                        amount: (parseFloat(finalRate) * (parseFloat(row.qty) || 0)).toFixed(2),
                        aiStatus: 'success',
                        aiResult: result
                    };

                    setTierData(prev => ({
                        ...prev,
                        [tierKey]: { ...prev[tierKey], rows: prev[tierKey].rows.map(r => String(r.id) === rowId ? updatedRow : r) }
                    }));

                    globalStats.success++;
                } else {
                    const newStatus = result.status === 'no_match' ? 'no_match' : 'error';
                    updateFurnitureStatus(tierKey, { status: newStatus });
                    if (newStatus === 'error') globalStats.error++;

                    setTierData(prev => ({
                        ...prev,
                        [tierKey]: { ...prev[tierKey], rows: prev[tierKey].rows.map(r => String(r.id) === rowId ? { ...r, aiStatus: newStatus, aiError: result.message } : r) }
                    }));
                }
            } catch (error) {
                updateFurnitureStatus(tierKey, { status: 'error' });
                globalStats.error++;
                setTierData(prev => ({
                    ...prev,
                    [tierKey]: { ...prev[tierKey], rows: prev[tierKey].rows.map(r => String(r.id) === rowId ? { ...r, aiStatus: 'error', aiError: error.message } : r) }
                }));
            }

            setFurnitureProgress(prev => ({
                ...prev,
                [tierKey]: { ...prev[tierKey], current: prev[tierKey].current + 1 }
            }));
            await sleep(1000);
        };

        const processTier = async (tierKey) => {
            updateFurnitureStatus(tierKey, { active: true, minimized: false });
            const rows = tierDataRef.current[tierKey].rows || [];
            const workableIndices = rows.map((r, i) => i).filter(i =>
                !isHeaderRow(rows[i].description, rows[i]) &&
                rows[i].aiStatus !== 'success' &&
                (!rows[i].scope || !rows[i].scope.toUpperCase().includes('FITOUT'))
            );

            setFurnitureProgress(prev => ({ ...prev, [tierKey]: { current: 0, total: workableIndices.length } }));

            // Process rows in batches of 5
            await batch(workableIndices, 5, (idx) => processRow(tierKey, idx));

            updateFurnitureStatus(tierKey, { active: false });
        };

        try {
            await Promise.all(tierKeys.map(k => processTier(k)));
            setFurnitureBatchResult({ success: globalStats.success, error: globalStats.error, newlyAdded: globalStats.newlyAdded });
        } catch (error) {
            setFurnitureBatchResult({ error: 1 });
        } finally {
            setIsFurnitureAutoFilling(false);
            setTimeout(() => setFurnitureBatchResult(null), 8000);
            fetchBrands();
        }
    };


    // Allow re-running AI on a single error row
    const handleRetryRow = async (rowIndex, selectedBrands, selectedEngine) => {
        // Reset error state then re-queue just this row by temporarily triggering a mini-batch
        setTierData(prev => {
            const tier = prev[activeTier];
            if (!tier) return prev;
            const newRows = [...tier.rows];
            newRows[rowIndex] = { ...newRows[rowIndex], aiStatus: null, aiError: null };
            return { ...prev, [activeTier]: { ...tier, rows: newRows } };
        });
    };

    const handleCellChange = (rowIndex, field, value) => {
        setTierData(prev => {
            const tier = prev[activeTier];
            if (!tier) return prev;
            const newRows = [...tier.rows];
            const row = { ...newRows[rowIndex] };

            // Special handling for cascading dropdowns
            if (field === 'selectedBrand') {
                row.selectedBrand = value;
                row.selectedMainCat = '';
                row.selectedSubCat = '';
                row.selectedFamily = '';
                row.selectedModel = '';
                row.brandImage = '';
                row.brandDesc = '';
                // Store brand logo for PDF export
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
                // value is now { model, url } to support variants
                const { model, url } = value;
                row.selectedModel = model;
                row.selectedModelUrl = url;

                // Auto-fill Description, Image, and Rate from Product Data
                const brand = brands.find(b => b.name === row.selectedBrand);
                if (brand && brand.products) {
                    // Find product by URL (preferred) or Image URL (fallback)
                    let product = brand.products.find(p =>
                        (p.productUrl && p.productUrl === url) ||
                        (p.imageUrl && p.imageUrl === url)
                    );

                    // Fallback: if no unique URL matched (e.g., empty image/product URLs), find by Model + Hierarchy
                    if (!product) {
                        const candidates = brand.products.filter(p =>
                            (p.normalization?.category || p.mainCategory) === row.selectedMainCat &&
                            (p.normalization?.subCategory || p.subCategory) === row.selectedSubCat &&
                            p.family === row.selectedFamily &&
                            p.model === model
                        );

                        if (candidates.length > 0) {
                            // Check if the synthetic ID contains an index suffix logic (e.g. model_CODE_0)
                            // Structure from render: `model_${modelName}_${i}` or `model_${modelName}`
                            if (url && url.startsWith('model_')) {
                                const parts = url.split('_');    // ── MANUAL ENRICHMENT (HARDENING) ─────────────────────────────────────────
                                const handleManualEnrich = async (row, index, tierKey) => {
                                    const brandName = prompt("Enter Brand Name (e.g., Herman Miller):", row.selectedBrand || "");
                                    if (!brandName) return;
                                    const modelName = prompt("Enter Model Name (e.g., Aeron):", row.selectedModel || "");
                                    if (!modelName) return;

                                    setEnrichingRowId(row.id);
                                    try {
                                        const response = await fetch(`${API_BASE}/api/models/enrich`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ brandName, modelName, budgetTier: tierKey })
                                        });
                                        const data = await response.json();

                                        if (data.status === 'success' && data.product) {
                                            const p = data.product;
                                            handleCellChange(index, 'selectedModel', p.model, tierKey);
                                            handleCellChange(index, 'selectedBrand', p.brand, tierKey);
                                            handleCellChange(index, 'brandImage', p.imageUrl, tierKey);
                                            handleCellChange(index, 'brandLogo', p.brandLogo || '', tierKey);
                                            handleCellChange(index, 'rate', p.price || 0, tierKey);
                                            handleCellChange(index, 'mainCategory', p.mainCategory, tierKey);
                                            handleCellChange(index, 'subCategory', p.subCategory, tierKey);
                                            handleCellChange(index, 'aiStatus', 'success', tierKey);
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
                                // If 3 parts (model, CODE, index), try to parse index
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

                        // Auto-calculate amount if qty exists
                        const currentQty = parseFloat(row.qty) || 0;
                        if (currentQty > 0 && basePrice > 0) {
                            row.amount = (currentQty * basePrice).toFixed(2);
                        }

                        if (!row.unit) row.unit = 'Nos';
                    }
                }
            }

            // --- AUTO-SELECTION LOGIC ---
            const autoSelectNextLevel = (currentRow) => {
                const activeBrand = brands.find(b => b.name === currentRow.selectedBrand);
                if (!activeBrand || !activeBrand.products) return;

                const brandProducts = activeBrand.products;

                // 1. Auto-select Main Category if only one
                if (currentRow.selectedBrand && !currentRow.selectedMainCat) {
                    const mainCats = Array.from(new Set(brandProducts.flatMap(p => [p.normalization?.category, p.mainCategory]).filter(Boolean))).filter(v => v !== 'null' && v !== 'undefined');
                    if (mainCats && mainCats.length === 1) {
                        currentRow.selectedMainCat = mainCats[0];
                        autoSelectNextLevel(currentRow);
                        return;
                    }
                }

                // 2. Auto-select Sub Category if only one
                if (currentRow.selectedMainCat && !currentRow.selectedSubCat) {
                    const matchingByMain = brandProducts.filter(p => (p.normalization?.category || p.mainCategory) === currentRow.selectedMainCat);
                    const subCats = Array.from(new Set(matchingByMain.flatMap(p => [p.normalization?.subCategory, p.subCategory]).filter(Boolean))).filter(v => v !== 'null' && v !== 'undefined');
                    if (subCats && subCats.length === 1) {
                        currentRow.selectedSubCat = subCats[0];
                        autoSelectNextLevel(currentRow);
                        return;
                    }
                }

                // 3. Auto-select Family if only one
                if (currentRow.selectedSubCat && !currentRow.selectedFamily) {
                    const matchingBySub = brandProducts.filter(p =>
                        (p.normalization?.category || p.mainCategory) === currentRow.selectedMainCat &&
                        (p.normalization?.subCategory || p.subCategory) === currentRow.selectedSubCat
                    );
                    const families = getUniqueValues(matchingBySub, 'family');
                    if (families && families.length === 1) {
                        currentRow.selectedFamily = families[0];
                        autoSelectNextLevel(currentRow); // Recursive check
                        return;
                    }
                }

                // 4. Auto-select Model if only one Variant
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
            // -----------------------------
            else if (field === 'selectedModel') {
                // Already handled logic above
            }
            else {
                // Standard Field
                row[field] = value;

                // Real-time Amount Calculation
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

    // Clear all manual selection data from a single row
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

    // Apply costing factors to all rows with base prices
    const handleApplyCosting = (factors) => {
        setCostingFactors(factors);
        setIsCostingOpen(false);

        const activeTierData = tierData[activeTier];
        if (!activeTierData) return;

        // Recalculate rates for all rows with base prices
        const updatedRows = activeTierData.rows.map(row => {
            if (row.basePrice && row.basePrice > 0) {
                const markup = 1 + (factors.profit + factors.freight + factors.customs + factors.installation) / 100;
                const costedPrice = row.basePrice * markup * factors.exchangeRate;
                return { ...row, rate: costedPrice.toFixed(2) };
            }
            return row;
        });

        // Update internal state just in case
        setTierData(prev => ({
            ...prev,
            [activeTier]: { ...activeTierData, rows: updatedRows }
        }));

        // If onApplyFlow is provided (from App.jsx), format and send to main workflow
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
                                    image: row.brandImage,
                                    images: row.brandImage ? [{ url: getFullUrl(row.brandImage) }] : []
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

    // Helper to load image as data URL with size and format optimization
    const getImageData = async (url, options = {}) => {
        if (!url) return null;

        // Explicitly define these in the function scope
        const maxWidth = options.maxWidth || 1000;
        const format = options.format || 'image/jpeg';
        const quality = options.quality || 0.85;

        // Check if it's an external URL (not from our server)
        const isExternal = url.startsWith('http') && !url.includes('localhost:3001') && !url.includes(window.location.hostname);

        // Helper to load image into canvas and return dataUrl
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
                // Proxy returns raw binary image, not JSON
                const proxyUrl = `${API_BASE}/api/image-proxy?url=${encodeURIComponent(url)}`;
                const response = await fetch(proxyUrl);
                if (!response.ok) return null;

                // Convert binary response to blob URL for loading
                const blob = await response.blob();
                const blobUrl = URL.createObjectURL(blob);

                const result = await loadImageToCanvas(blobUrl);

                // Clean up blob URL
                URL.revokeObjectURL(blobUrl);

                return result;
            } catch (e) {
                console.warn('Image proxy fetch failed:', e);
                return null;
            }
        } else {
            // Local images - load directly
            return loadImageToCanvas(url);
        }
    };

    const calcFitSize = (imgW, imgH, maxW, maxH) => {
        const ratio = Math.min(maxW / imgW, maxH / imgH);
        return { w: imgW * ratio, h: imgH * ratio };
    };

    // ===================== MULTI-BUDGET PDF EXPORT =====================
    const handleExportPDF = async () => {
        const tier = tierData[activeTier];
        if (!tier || !tier.rows.length) return alert('No data to export');

        const isBoqMode = tier.mode === 'boq';
        // Changed to Portrait
        const doc = new jsPDF({ orientation: 'portrait' });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();

        const arabicLoaded = await loadArabicFont(doc);
        const processText = (txt) => (arabicLoaded && hasArabic(txt)) ? fixArabic(txt) : String(txt || '');

        const colors = {
            primary: [30, 95, 168],
            accent: [245, 166, 35],
            text: [51, 51, 51],
            white: [255, 255, 255],
            lightBg: [248, 250, 252]
        };

        // Header
        doc.setFillColor(...colors.primary);
        doc.rect(0, 0, pageWidth, 18, 'F');
        doc.setFillColor(...colors.accent);
        doc.rect(0, 18, pageWidth, 2, 'F');
        doc.setTextColor(...colors.white);
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text(`Multi-Budget Offer - ${activeTier.charAt(0).toUpperCase() + activeTier.slice(1)} Tier`, 10, 12);

        // Top Right Logo (Now Company Logo from Settings)
        const logoToUse = logoWhite || logoBlue;
        if (logoToUse) {
            try {
                const docLogo = await getImageData(logoToUse, { format: 'image/png', maxWidth: 800 });
                if (docLogo) {
                    const logoFit = calcFitSize(docLogo.width, docLogo.height, 35, 12);
                    doc.addImage(docLogo.dataUrl, 'PNG', pageWidth - 10 - logoFit.w, 3, logoFit.w, logoFit.h);
                }
            } catch (e) { }
        }

        // Define columns based on mode
        const header = isBoqMode
            ? ['Sr.', 'Location', 'Scope', 'Ref Image', 'Original Desc', 'Brand Image', 'Brand Desc', 'Qty', 'Unit', 'Rate', 'Amount']
            : ['Sr.', 'Location', 'Scope', 'Image', 'Description', 'Qty', 'Unit', 'Rate', 'Amount'];

        const processedHeader = header.map(h => processText(h));

        // Pre-load all images (Use JPEG for products to save space)
        const imageDataMap = {};
        for (let i = 0; i < tier.rows.length; i++) {
            const row = tier.rows[i];
            // Reference image
            if (row.imageRef) {
                try {
                    const url = getFullUrl(row.imageRef);
                    const result = await getImageData(url, { maxWidth: 600, format: 'image/jpeg' });
                    if (result) imageDataMap[`ref_${i}`] = result;
                } catch (e) { console.log('Ref image load error:', e); }
            }
            // Brand product image
            if (row.brandImage) {
                try {
                    const result = await getImageData(row.brandImage, { maxWidth: 800, format: 'image/jpeg' });
                    if (result) imageDataMap[`brand_${i}`] = result;
                } catch (e) { console.log('Brand image load error:', e); }
            }
            // Brand logo (Keep PNG for brand logos)
            if (row.brandLogo) {
                try {
                    const result = await getImageData(row.brandLogo, { format: 'image/png', maxWidth: 400 });
                    if (result) imageDataMap[`logo_${i}`] = result;
                } catch (e) { console.log('Logo error:', e); }
            }
        }

        // Build table data
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

        // Table Generation
        autoTable(doc, {
            startY: 25,
            head: [processedHeader],
            body: body,
            theme: 'grid',
            tableWidth: 'auto',
            styles: {
                fontSize: 7, // Smaller font to fit more columns
                cellPadding: 1.5,
                overflow: 'linebreak',
                valign: 'middle',
                font: arabicLoaded ? 'Almarai' : 'helvetica'
            },
            headStyles: {
                fillColor: colors.primary,
                textColor: colors.white,
                fontStyle: 'bold',
                font: arabicLoaded ? 'Almarai' : 'helvetica',
                minCellHeight: 7
            },
            // Optimized Portrait Column Widths (Reduced to fit 11 columns)
            columnStyles: isBoqMode ? {
                0: { cellWidth: 7 },   // Sr
                1: { cellWidth: 15 },  // Location
                2: { cellWidth: 12 },  // Scope
                3: { cellWidth: 18 },  // Ref Image
                4: { cellWidth: 28 },  // Original Desc
                5: { cellWidth: 18 },  // Brand Image
                6: { cellWidth: 28 },  // Brand Desc
                7: { cellWidth: 8, halign: 'center' },  // Qty
                8: { cellWidth: 8, halign: 'center' },  // Unit
                9: { cellWidth: 14, halign: 'right' },   // Rate
                10: { cellWidth: 16, halign: 'right' }    // Amount
            } : {
                0: { cellWidth: 8 },    // Sr
                1: { cellWidth: 25 },   // Location
                2: { cellWidth: 20 },   // Scope
                3: { cellWidth: 30 },   // Image
                4: { cellWidth: 55 },   // Description
                5: { cellWidth: 12, halign: 'center' }, // Qty
                6: { cellWidth: 12, halign: 'center' }, // Unit
                7: { cellWidth: 16, halign: 'right' },  // Rate
                8: { cellWidth: 20, halign: 'right' }   // Amount
            },
            didDrawCell: (data) => {
                if (data.section === 'body') {
                    const rowIdx = data.row.index;
                    const refImgCol = isBoqMode ? 3 : -1;
                    const brandImgCol = isBoqMode ? 5 : 3;

                    // Draw ref image
                    if (data.column.index === refImgCol && imageDataMap[`ref_${rowIdx}`]) {
                        const img = imageDataMap[`ref_${rowIdx}`];
                        const fit = calcFitSize(img.width, img.height, data.cell.width - 2, data.cell.height - 2);
                        const x = data.cell.x + (data.cell.width - fit.w) / 2;
                        const y = data.cell.y + (data.cell.height - fit.h) / 2;
                        doc.addImage(img.dataUrl, 'JPEG', x, y, fit.w, fit.h, undefined, 'FAST');
                    }

                    // Draw brand logo + product image
                    if (data.column.index === brandImgCol) {
                        const hasLogo = imageDataMap[`logo_${rowIdx}`];
                        const hasBrandImg = imageDataMap[`brand_${rowIdx}`];

                        const logoHeight = 6;
                        const padding = 1;
                        const gap = 1;

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
                            doc.addImage(img.dataUrl, 'JPEG', x, y, fit.w, fit.h, undefined, 'FAST');
                        }
                    }
                }
            },
            didParseCell: (data) => {
                if (data.section === 'body') {
                    const refImgCol = isBoqMode ? 3 : -1;
                    const brandImgCol = isBoqMode ? 5 : 3;
                    if (data.column.index === brandImgCol) {
                        data.cell.styles.minCellHeight = 30;
                    } else if (data.column.index === refImgCol) {
                        data.cell.styles.minCellHeight = 20;
                    }
                }
            }
        });


        // Add Summary Section
        const subtotal = tier.rows.reduce((sum, row) => sum + (parseFloat(row.amount || (parseFloat(row.qty || 0) * parseFloat(row.rate || 0))) || 0), 0);
        const vatAmount = subtotal * ((costingFactors.vat || 0) / 100);
        const grandTotal = subtotal + vatAmount;

        const summaryWidth = 70; // Slightly smaller for portrait
        const summaryX = pageWidth - summaryWidth - 10;
        let finalY = doc.lastAutoTable.finalY + 5; // Reduced gap

        // Check if summary fits on current page
        // Summary needs approx 25 units of height
        if (finalY + 25 > pageHeight) {
            doc.addPage();
            finalY = 20; // Start at top of new page
        }

        doc.setFontSize(10);
        doc.setTextColor(...colors.text);
        doc.setFont('helvetica', 'normal');

        // Subtotal
        doc.text('Subtotal:', summaryX, finalY + 4);
        doc.text(`${subtotal.toFixed(2)} ${costingFactors.toCurrency}`, pageWidth - 10, finalY + 4, { align: 'right' });

        // VAT
        doc.text(`VAT (${costingFactors.vat}%):`, summaryX, finalY + 9);
        doc.text(`${vatAmount.toFixed(2)} ${costingFactors.toCurrency}`, pageWidth - 10, finalY + 9, { align: 'right' });

        // Grand Total Box
        doc.setFont('helvetica', 'bold');
        doc.setFillColor(...colors.primary);
        doc.rect(summaryX - 2, finalY + 12, summaryWidth + 2, 8, 'F');
        doc.setTextColor(...colors.white);
        doc.setFontSize(11);
        doc.text('GRAND TOTAL:', summaryX, finalY + 17);
        doc.text(`${grandTotal.toFixed(2)} ${costingFactors.toCurrency}`, pageWidth - 12, finalY + 17, { align: 'right' });

        doc.save(`MultiBudget_${activeTier}_Offer.pdf`);
    };

    // ===================== MULTI-BUDGET EXCEL EXPORT (WITH IMAGES) =====================
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

        // 1. Add Header Space for Logo & Info
        ws.addRow(['']); // Spacer
        ws.addRow(['', '', '', '', '', '', '', '', '']);
        ws.addRow(['', '', '', '', '', '', '', '', '']);
        ws.mergeCells('A2:C2');
        const titleCell = ws.getCell('A2');
        titleCell.value = `${activeTier.toUpperCase()} TIER OFFER`;
        titleCell.font = { bold: true, size: 14, color: { argb: '1E5FA8' } };

        ws.getCell('A3').value = `Generated on: ${new Date().toLocaleDateString()}`;
        ws.getCell('A3').font = { italic: true, size: 10, color: { argb: '64748B' } };

        // Helper to fetch image as base64
        const fetchImageBase64 = async (url, options = {}) => {
            if (!url) return null;
            const { maxWidth = 1000, format = 'image/png', quality = 0.85 } = options;

            try {
                const isExternal = url.startsWith('http') && !url.includes('localhost:3001') && !url.includes(window.location.hostname);
                let dataUrl;

                if (isExternal) {
                    const proxyUrl = `${API_BASE}/api/image-proxy?url=${encodeURIComponent(url)}`;
                    const response = await fetch(proxyUrl);
                    if (!response.ok) return null;
                    const data = await response.json();
                    dataUrl = data.dataUrl;
                } else {
                    const response = await fetch(url);
                    if (!response.ok) return null;
                    const blob = await response.blob();
                    dataUrl = await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = () => resolve(null);
                        reader.readAsDataURL(blob);
                    });
                }

                if (!dataUrl) return null;

                return new Promise((resolve) => {
                    const img = new Image();
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
                        resolve(canvas.toDataURL(format, quality).split(',')[1]);
                    };
                    img.onerror = () => resolve(null);
                    img.src = dataUrl;
                });

            } catch (e) { return null; }
        };

        // Add Company Logo if available
        // Prefer original (Blue/Color) for Excel as it has a white background
        const excelLogo = logoBlue || logoWhite;
        if (excelLogo) {
            try {
                const logoData = await getImageData(excelLogo, { format: 'image/png', maxWidth: 600 });
                if (logoData) {
                    const logoId = workbook.addImage({
                        base64: logoData.dataUrl.split(',')[1],
                        extension: 'png'
                    });

                    // Position in the top right area (around column G/H/I)
                    const lastColIndex = isBoqMode ? 8 : 6;
                    const logoFit = calcFitSize(logoData.width, logoData.height, 150, 60);
                    ws.addImage(logoId, {
                        tl: { col: lastColIndex - 1.5, row: 0.2 },
                        ext: { width: logoFit.w, height: logoFit.h }
                    });
                }
            } catch (e) { console.error("Excel Logo Error:", e); }
        }

        ws.addRow(['']); // Spacer before table

        // Header with proper columns
        const header = isBoqMode
            ? ['Sr.', 'Location', 'Scope', 'Ref Image', 'Original Desc', 'Brand Image', 'Brand Desc', 'Qty', 'Unit', 'Rate', 'Amount']
            : ['Sr.', 'Location', 'Scope', 'Image', 'Description', 'Qty', 'Unit', 'Rate', 'Amount'];

        // Set column widths first
        ws.columns = isBoqMode
            ? [
                { width: 6 },   // Sr
                { width: 15 },  // Location
                { width: 12 },  // Scope
                { width: 15 },  // Ref Image
                { width: 35 },  // Original Desc
                { width: 18 },  // Brand Image
                { width: 35 },  // Brand Desc
                { width: 8 },   // Qty
                { width: 8 },   // Unit
                { width: 12 },  // Rate
                { width: 14 }   // Amount
            ]
            : [
                { width: 6 },   // Sr
                { width: 15 },  // Location
                { width: 15 },  // Scope
                { width: 18 },  // Image
                { width: 55 },  // Description
                { width: 10 },  // Qty
                { width: 10 },  // Unit
                { width: 14 },  // Rate
                { width: 16 }   // Amount
            ];

        // Enable RTL if Arabic detected
        const hasAr = header.some(h => hasArabic(h)) || tier.rows.some(r => hasArabic(r.description) || hasArabic(r.brandDesc));
        if (hasAr) {
            ws.views = [{ rightToLeft: true }];
        }

        // Add header row
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

        // Add data rows with images
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
            excelRow.height = 75; // Taller rows for images

            // Style data cells
            excelRow.eachCell((cell, colNumber) => {
                cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
                cell.border = {
                    bottom: { style: 'thin', color: { argb: 'E2E8F0' } }
                };
                // Description/Location columns - left align for readability
                // BOQ: Location(2), Scope(3), OriginalDesc(5), BrandDesc(7)
                // Simple: Location(2), Scope(3), Description(5)
                if ([2, 3, 5, 7].includes(colNumber)) {
                    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
                }
            });

            // Add reference image (BOQ mode only, column 4 / index 3)
            if (isBoqMode && row.imageRef) {
                try {
                    const refUrl = getFullUrl(row.imageRef);
                    // Higher quality and resolution for Excel
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

            // Determine brand image column (BOQ: 5, Simple: 3)
            const brandImgCol = isBoqMode ? 5 : 3;

            // Add brand logo on top of brand image cell
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

            // Add brand product image below logo
            if (row.brandImage) {
                try {
                    // Increased maxWidth for high quality
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

        ws.addRow([]); // Spacer
        let summaryStartCol = isBoqMode ? 8 : 6;

        // Subtotal row
        const stRow = ws.addRow([]);
        stRow.getCell(summaryStartCol).value = 'Subtotal:';
        stRow.getCell(summaryStartCol + 1).value = `${subtotal.toFixed(2)} ${costingFactors.toCurrency}`;
        stRow.getCell(summaryStartCol).font = { bold: true };
        stRow.getCell(summaryStartCol + 1).alignment = { horizontal: 'right' };

        // VAT row
        const vRow = ws.addRow([]);
        vRow.getCell(summaryStartCol).value = `VAT (${costingFactors.vat}%):`;
        vRow.getCell(summaryStartCol + 1).value = `${vatAmount.toFixed(2)} ${costingFactors.toCurrency}`;
        vRow.getCell(summaryStartCol + 1).alignment = { horizontal: 'right' };

        // Grand Total row
        const gtRow = ws.addRow([]);
        gtRow.getCell(summaryStartCol).value = 'GRAND TOTAL:';
        gtRow.getCell(summaryStartCol + 1).value = `${grandTotal.toFixed(2)} ${costingFactors.toCurrency}`;
        gtRow.height = 30;

        [gtRow.getCell(summaryStartCol), gtRow.getCell(summaryStartCol + 1)].forEach(cell => {
            cell.font = { bold: true, size: 12, color: { argb: 'FFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E5FA8' } };
            cell.alignment = { vertical: 'middle', horizontal: 'right' };
            cell.border = {
                top: { style: 'medium', color: { argb: 'F5A623' } },
                bottom: { style: 'medium', color: { argb: 'F5A623' } }
            };
        });

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const { saveAs } = await import('file-saver');
        saveAs(blob, `MultiBudget_${activeTier}_Offer.xlsx`);
    };

    // ===================== MULTI-BUDGET PPTX EXPORT (PREMIUM DESIGN) =====================
    const handleExportPPTX = async () => {
        const tier = tierData[activeTier];
        if (!tier || !tier.rows.length) return alert('No data to export');

        const PptxGenJS = (await import('pptxgenjs')).default;
        const pres = new PptxGenJS();
        const isBoqMode = tier.mode === 'boq';

        // Professional color palette
        const colors = {
            primary: '1E5FA8',      // Deep blue
            accent: 'F5A623',       // Gold/amber
            text: '2D3748',         // Dark gray
            lightText: '718096',    // Medium gray
            lightBg: 'F7FAFC',      // Light background
            white: 'FFFFFF',
            border: 'E2E8F0'
        };

        // Define premium slide master
        pres.defineSlideMaster({
            title: 'PREMIUM_MASTER',
            background: { color: colors.white },
            objects: [
                // Header bar
                { rect: { x: 0, y: 0, w: '100%', h: 0.75, fill: { color: colors.primary } } },
                // Gold accent line
                { rect: { x: 0, y: 0.75, w: '100%', h: 0.06, fill: { color: colors.accent } } },
                // Footer bar
                { rect: { x: 0, y: 5.2, w: '100%', h: 0.3, fill: { color: colors.lightBg } } }
            ]
        });

        // Title slide with enhanced design
        const titleSlide = pres.addSlide({ masterName: 'PREMIUM_MASTER' });
        titleSlide.addText('PRODUCT SHOWCASE', {
            x: 0.3, y: 0.2, w: 4, h: 0.4, fontSize: 14, bold: true, color: colors.white
        });
        titleSlide.addShape('rect', {
            x: 2, y: 1.8, w: 6, h: 1.5, fill: { color: colors.lightBg }, line: { color: colors.border, pt: 1 }
        });
        titleSlide.addText(`Multi-Budget Offer`, {
            x: 2, y: 2.0, w: 6, h: 0.6, fontSize: 32, bold: true, color: colors.primary, align: 'center'
        });
        titleSlide.addText(`${activeTier.charAt(0).toUpperCase() + activeTier.slice(1)} Tier`, {
            x: 2, y: 2.6, w: 6, h: 0.5, fontSize: 20, color: colors.accent, align: 'center'
        });
        titleSlide.addText(`${tier.rows.filter(r => r.brandImage || r.brandDesc).length} Products`, {
            x: 2, y: 3.8, w: 6, h: 0.3, fontSize: 12, color: colors.lightText, align: 'center'
        });

        // Company Logo on Title Slide
        const titleSlideLogo = logoWhite || logoBlue;
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

            // Header text - extract first line/product name only (short, no overflow)
            const descForHeader = (row.brandDesc || '');
            const firstLineHeader = descForHeader.split(/[\n*•]/)[0].trim();
            const headerTitle = firstLineHeader.length > 45 ? firstLineHeader.substring(0, 42) + '...' : firstLineHeader;

            slide.addText(`Item ${itemNum}: ${headerTitle}`, {
                x: 0.3, y: 0.15, w: 7.5, h: 0.4, fontSize: 12, bold: true, color: colors.white, valign: 'middle'
            });

            // Top Right Logo (Now Company Logo)
            const slideLogo = logoWhite || logoBlue;
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

            // ===== LEFT COLUMN: Images =====
            const leftX = 0.3;
            let leftY = 1.0;
            const leftWidth = 4.5;

            // Reference image section (BOQ mode only)
            if (isBoqMode && row.imageRef) {
                const refUrl = getFullUrl(row.imageRef);
                try {
                    const refImg = await getImageData(refUrl);
                    if (refImg) {
                        // Reference label
                        slide.addText('Reference Image', { x: leftX, y: leftY, w: 1.5, h: 0.2, fontSize: 8, color: colors.lightText });
                        // Reference image container
                        slide.addShape('rect', {
                            x: leftX, y: leftY + 0.2, w: 1.4, h: 1.0,
                            fill: { color: colors.lightBg }, line: { color: colors.border, pt: 0.5 }
                        });
                        slide.addImage({ data: refImg.dataUrl, x: leftX + 0.05, y: leftY + 0.25, w: 1.3, h: 0.9, sizing: { type: 'contain', w: 1.3, h: 0.9 } });
                        leftY += 1.35;
                    }
                } catch (e) { }
            }

            // Brand badge (No logo now, logo moved above product image)
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

            // Brand Logo moved above product image
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

            // Main product image container
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

            // ===== RIGHT COLUMN: Product Details =====
            const rightX = 5.0;
            let rightY = 1.0;
            const rightWidth = 4.7;

            // Product Details header
            slide.addText('Product Details', {
                x: rightX, y: rightY, w: rightWidth, h: 0.35, fontSize: 16, bold: true, color: colors.primary
            });
            rightY += 0.45;

            // Divider line
            slide.addShape('line', {
                x: rightX, y: rightY, w: rightWidth, h: 0,
                line: { color: colors.accent, pt: 2 }
            });
            rightY += 0.15;

            // Description section
            slide.addText('Description:', {
                x: rightX, y: rightY, w: rightWidth, h: 0.25, fontSize: 10, bold: true, color: colors.text
            });
            rightY += 0.25;
            // Full description with word wrap - capped to fit slide
            const fullDescription = (row.brandDesc || 'N/A').trim();
            // Calculate available height - leave room for Brand, Qty, Specs before footer
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

            // Max content Y before footer (footer at ~4.65)
            const maxContentY = 4.4;

            // Brand info
            if (rightY < maxContentY - 0.25) {
                slide.addText('Brand:', {
                    x: rightX, y: rightY, w: 0.7, h: 0.2, fontSize: 9, bold: true, color: colors.text
                });
                slide.addText(brandName || 'N/A', {
                    x: rightX + 0.55, y: rightY, w: rightWidth - 0.55, h: 0.2, fontSize: 9, color: colors.primary
                });
                rightY += 0.25;
            }

            // Quantity
            if (rightY < maxContentY - 0.25) {
                slide.addText('Quantity:', {
                    x: rightX, y: rightY, w: 0.8, h: 0.2, fontSize: 9, bold: true, color: colors.text
                });
                slide.addText(String(row.qty || 'As per BOQ'), {
                    x: rightX + 0.7, y: rightY, w: rightWidth - 0.7, h: 0.2, fontSize: 9, color: colors.text
                });
                rightY += 0.28;
            }

            // Specifications section - only if space
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

            // ===== FOOTER =====
            // Warranty section
            slide.addText('Warranty', {
                x: 0.3, y: 4.65, w: 1.0, h: 0.2, fontSize: 9, bold: true, color: colors.text
            });
            slide.addText('As per manufacturer - 5 years', {
                x: 0.3, y: 4.85, w: 2.0, h: 0.18, fontSize: 8, color: colors.lightText
            });

            // Page number
            slide.addText(`${itemNum} / ${tier.rows.filter(r => r.brandImage || r.brandDesc).length}`, {
                x: 9, y: 5.25, w: 0.8, h: 0.2, fontSize: 8, color: colors.lightText, align: 'right'
            });

            itemNum++;
        }

        pres.writeFile({ fileName: `MultiBudget_${activeTier}_Presentation.pptx` });
    };

    // ===================== MULTI-BUDGET PRESENTATION PDF (PREMIUM DESIGN) =====================
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

        // Professional color palette
        const colors = {
            primary: [30, 95, 168],      // Deep blue
            accent: [245, 166, 35],       // Gold/amber
            text: [45, 55, 72],           // Dark gray
            lightText: [113, 128, 150],   // Medium gray
            lightBg: [247, 250, 252],     // Light background
            white: [255, 255, 255],
            border: [226, 232, 240]
        };

        let itemNum = 1;

        for (const row of tier.rows) {
            if (!row.brandImage && !row.brandDesc) continue;
            if (itemNum > 1) doc.addPage();
            const brandName = (row.selectedBrand || '').replace(/Explore collections by/i, '').trim();

            // ===== HEADER BAR =====
            doc.setFillColor(...colors.primary);
            doc.rect(0, 0, pageWidth, 20, 'F');
            doc.setFillColor(...colors.accent);
            doc.rect(0, 20, pageWidth, 2.5, 'F');

            // Header title - handle multi-line
            doc.setTextColor(...colors.white);
            doc.setFontSize(11);
            doc.setFont(arabicLoaded ? 'Almarai' : 'helvetica', 'bold');
            const fullTitle = `Item ${itemNum}: ${row.brandDesc || ''}`;
            const titleLines = doc.splitTextToSize(processText(fullTitle), pageWidth - 70);
            let currentTitleY = 10;
            titleLines.slice(0, 2).forEach(tl => {
                doc.text(tl, 10, currentTitleY);
                currentTitleY += 5.5;
            });

            // Top Right Logo (Now Company Logo)
            // Header is blue, so we prefer the White logo variant if available
            const presentationLogo = logoWhite || logoBlue;
            if (presentationLogo) {
                try {
                    const docLogo = await getImageData(presentationLogo, { format: 'image/png', maxWidth: 400 });
                    if (docLogo) {
                        const fit = calcFitSize(docLogo.width, docLogo.height, 40, 14);
                        // Draw directly on blue header - no placeholder box
                        doc.addImage(docLogo.dataUrl, 'PNG', pageWidth - fit.w - 10, 3, fit.w, fit.h);
                    }
                } catch (e) { }
            }

            // ===== LEFT COLUMN: Images =====
            const leftX = 10;
            let leftY = 28;
            const leftWidth = 120;

            // Reference image section (BOQ mode only)
            if (isBoqMode && row.imageRef) {
                const refUrl = getFullUrl(row.imageRef);
                try {
                    const refImg = await getImageData(refUrl, { maxWidth: 600, format: 'image/jpeg', quality: 0.9 });
                    if (refImg) {
                        // Reference label
                        doc.setTextColor(...colors.lightText);
                        doc.setFontSize(7);
                        doc.setFont('helvetica', 'normal');
                        doc.text('Reference Image', leftX, leftY);
                        leftY += 2;

                        // Reference image container
                        doc.setFillColor(...colors.lightBg);
                        doc.setDrawColor(...colors.border);
                        doc.rect(leftX, leftY, 35, 25, 'FD'); // Changed to rect, removed rounded
                        const fit = calcFitSize(refImg.width, refImg.height, 31, 21);
                        const refX = leftX + (35 - fit.w) / 2;
                        const refY = leftY + (25 - fit.h) / 2;
                        doc.addImage(refImg.dataUrl, 'JPEG', refX, refY, fit.w, fit.h);
                        leftY += 30;
                    }
                } catch (e) { }
            }

            // Brand badge (No logo now)
            if (brandName) {
                doc.setFillColor(...colors.lightBg);
                doc.setDrawColor(...colors.primary);
                doc.setLineWidth(0.5);
                doc.rect(leftX, leftY, 60, 12, 'FD'); // Changed to rect, removed rounded

                doc.setTextColor(...colors.primary);
                doc.setFontSize(9);
                doc.setFont('helvetica', 'bold');
                doc.text(brandName.substring(0, 30), leftX + 30, leftY + 7.5, { align: 'center' });
                leftY += 15;
            }

            // Brand Logo moved above product image
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

            // Main product image container
            const imgContainerH = isBoqMode ? 100 : 130;
            doc.setFillColor(...colors.white);
            doc.setDrawColor(...colors.border);
            doc.setLineWidth(0.5);
            doc.rect(leftX, leftY, imgContainerW, imgContainerH, 'FD'); // Changed to rect, removed rounded

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

            // ===== RIGHT COLUMN: Product Details =====
            const rightX = 145;
            let rightY = 28;
            const rightWidth = 135;

            // Product Details header
            doc.setTextColor(...colors.primary);
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.text('Product Details', rightX, rightY);
            rightY += 4;

            // Gold accent line under header
            doc.setFillColor(...colors.accent);
            doc.rect(rightX, rightY, 50, 1.5, 'F');
            rightY += 8;

            // Description section
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
                rightY += 7; // Increased to 7
            });
            rightY += 6;

            // Brand info
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.text('Brand:', rightX, rightY);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...colors.primary);
            doc.text(brandName || 'N/A', rightX + 22, rightY);
            rightY += 10;

            // Quantity
            doc.setTextColor(...colors.text);
            doc.setFont('helvetica', 'bold');
            doc.text('Quantity:', rightX, rightY);
            doc.setFont('helvetica', 'normal');
            doc.text(String(row.qty || 'As per BOQ'), rightX + 22, rightY);
            rightY += 14;

            // Specifications section
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

            // ===== FOOTER =====
            // Footer background
            doc.setFillColor(...colors.lightBg);
            doc.rect(0, pageHeight - 12, pageWidth, 12, 'F');

            // Warranty section in footer
            doc.setTextColor(...colors.text);
            doc.setFontSize(8);
            doc.setFont('helvetica', 'bold');
            doc.text('Warranty', 10, pageHeight - 6);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...colors.lightText);
            doc.text('As per manufacturer - 5 years', 10, pageHeight - 2);

            // Page number
            doc.setTextColor(...colors.lightText);
            doc.setFontSize(8);
            doc.text(`${itemNum} / ${totalItems}`, pageWidth - 20, pageHeight - 4);
            // Website / Brand reference
            const footVal = profile.website || profile.companyName || 'BOQFLOW';
            const footIsAr = hasArabic(footVal);
            doc.setFont(footIsAr && arabicLoaded ? 'Almarai' : 'helvetica', 'normal');
            doc.text(footIsAr ? fixArabic(footVal) : footVal, pageWidth / 2, pageHeight - 4, { align: 'center' });

            itemNum++;
        }

        doc.save(`MultiBudget_${activeTier}_Presentation.pdf`);
    };

    // ===================== MULTI-BUDGET MAS PDF (PREMIUM DESIGN) =====================
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

        // Professional color palette for formal documents
        const colors = {
            primary: [30, 41, 59],         // Slate 800
            accent: [245, 158, 11],        // Amber 500
            text: [51, 65, 85],            // Slate 600
            lightText: [100, 116, 139],    // Slate 500
            lightBg: [248, 250, 252],      // Slate 50
            white: [255, 255, 255],
            border: [203, 213, 225],       // Slate 300
            success: [16, 185, 129]        // Emerald 500
        };

        let itemNum = 1;

        for (const row of tier.rows) {
            if (!row.brandImage && !row.brandDesc) continue;
            if (itemNum > 1) doc.addPage();
            const brandName = (row.selectedBrand || '').replace(/Explore collections by/i, '').trim();

            // ===== HEADER BAR =====
            doc.setFillColor(...colors.primary);
            doc.rect(0, 0, pageWidth, 22, 'F');
            doc.setFillColor(...colors.accent);
            doc.rect(0, 22, pageWidth, 2, 'F');

            // Header title
            doc.setTextColor(...colors.white);
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.text('MATERIAL APPROVAL SHEET', pageWidth / 2, 13, { align: 'center' });

            // Top Right Logo box removal (MAS is white background, prefer Blue logo)
            const masLogo = logoBlue || logoWhite;
            if (masLogo) {
                try {
                    const docLogo = await getImageData(masLogo, { format: 'image/png', maxWidth: 400 });
                    if (docLogo) {
                        const fit = calcFitSize(docLogo.width, docLogo.height, 35, 14);
                        // Use original logo on white background - no box needed
                        doc.addImage(docLogo.dataUrl, 'PNG', pageWidth - fit.w - 10, 4, fit.w, fit.h);
                    }
                } catch (e) { }
            }

            // ===== DOCUMENT INFO BAR =====
            doc.setFillColor(...colors.lightBg);
            doc.rect(0, 24, pageWidth, 14, 'F');
            doc.setDrawColor(...colors.border);
            doc.line(0, 38, pageWidth, 38);

            doc.setTextColor(...colors.text);
            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            doc.text(`Document No: MAS-${String(itemNum).padStart(3, '0')}`, 10, 31);
            doc.text(`Date: ${new Date().toLocaleDateString()}`, 10, 36);
            doc.text(`Item: ${itemNum} of ${totalItems}`, pageWidth / 2, 31, { align: 'center' });
            doc.setFont('helvetica', 'bold');
            doc.text(`Brand: ${brandName || 'N/A'}`, pageWidth - 10, 33, { align: 'right' });

            // ===== REFERENCE IMAGE (BOQ mode, small on right) =====
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
                        doc.text('Reference:', pageWidth - 35, 43);

                        doc.setFillColor(...colors.lightBg);
                        doc.setDrawColor(...colors.border);
                        doc.roundedRect(pageWidth - 35, 45, 30, 22, 1, 1, 'FD');
                        const fit = calcFitSize(refImg.width, refImg.height, 28, 20);
                        const refX = pageWidth - 35 + (30 - fit.w) / 2;
                        const refY = 45 + (22 - fit.h) / 2;
                        doc.addImage(refImg.dataUrl, 'JPEG', refX, refY, fit.w, fit.h);
                    }
                } catch (e) { }
            }

            // ===== PRODUCT IMAGE SECTION =====
            let imgY = 45;
            const imgContainerW = 90;
            const imgContainerH = 65;
            const imgContainerX = (pageWidth - imgContainerW) / 2 - (isBoqMode ? 15 : 0);

            // Brand badge above image (No logo now)
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

            // Brand Logo moved above product image
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

            // Product image container
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

            // ===== SPECIFICATIONS TABLE =====
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

            // ===== APPROVAL SECTION =====
            const approvalY = doc.lastAutoTable.finalY + 10;

            doc.setFillColor(...colors.lightBg);
            doc.rect(15, approvalY, pageWidth - 30, 30, 'F');
            doc.setDrawColor(...colors.border);
            doc.rect(15, approvalY, pageWidth - 30, 30, 'S');

            doc.setTextColor(...colors.primary);
            doc.setFontSize(9);
            doc.setFont('helvetica', 'bold');
            doc.text('APPROVAL SIGNATURES', 20, approvalY + 6);

            // Signature boxes
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

            // ===== FOOTER =====
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
                        <th style={{ width: '50px', textAlign: 'center' }}>Sl</th>
                        {isBoqMode && <th style={{ width: '80px', textAlign: 'center' }}>Ref Img</th>}
                        {isBoqMode && <th style={{ width: '200px', textAlign: 'left' }}>Original Desc</th>}
                        <th style={{ width: '80px', textAlign: 'center' }}>Scope</th>
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
                <tbody>
                    {(() => {
                        let displayRows = [...rows];

                        // Handle Consolidation
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

                        // Group dynamically by Scope (FITOUT first, then FURNITURE)
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
                                        // Find exact row or the first underlying row for consolidated items
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
        const refImgSrc = row.imageRef ? (String(row.imageRef).startsWith('http') ? row.imageRef : `${API_BASE}${row.imageRef}`) : null;

        const activeBrand = brands.find(b => {
            if (b.type === 'fitout' || b.name === 'FitOut V2') {
                return b.name === row.selectedBrand && (b.budgetTier === activeTier || !b.budgetTier);
            }
            return b.name === row.selectedBrand;
        }) || brands.find(b => b.name === row.selectedBrand);
        const brandProducts = activeBrand?.products || [];

        // Category/Family logic: Merge and deduplicate to avoid "confusing branches"
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
                <td>
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
                    <td>
                        {row.imageRef ? (
                            <div className={styles.imgPlaceholder} style={{ background: 'none' }}>
                                <img
                                    src={refImgSrc}
                                    alt="ref"
                                    className={styles.tableImg}
                                    onClick={() => {
                                        setPreviewImage(refImgSrc);
                                        setPreviewLogo(null);
                                        setPreviewBrand('Original Reference');
                                        setPreviewModel(row.description);
                                    }}
                                />
                            </div>
                        ) : (
                            <div className={styles.imgPlaceholder}>No Img</div>
                        )}
                    </td>
                )}

                {isBoqMode && (
                    <td>
                        <textarea
                            className={styles.cellInput}
                            value={row.description}
                            onChange={(e) => handleCellChange(index, 'description', e.target.value)}
                            style={{ minHeight: '80px', resize: 'vertical' }}
                        />
                    </td>
                )}

                <td>
                    <span className={`${styles.rowScopeTag} ${row.scope?.toLowerCase().includes('fitout') ? styles.fitoutTag : styles.furnitureTag}`}>
                        {row.scope || 'Furniture'}
                    </span>
                </td>

                <td>
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
                                    onError={(e) => {
                                        e.target.style.display = 'none';
                                        const sibling = e.target.nextSibling;
                                        if (sibling) sibling.style.display = 'flex';
                                    }}
                                    onClick={() => {
                                        setPreviewImage(getFullUrl(row.brandImage));
                                        setPreviewLogo(getFullUrl(row.brandLogo));
                                        setPreviewBrand(row.selectedBrand);
                                        setPreviewModel(row.selectedModel);
                                    }}
                                />
                                <div className={styles.imgPlaceholder} style={{ display: 'none' }}>
                                    Broken
                                </div>
                            </div>
                        ) : (
                            <div className={styles.imgPlaceholder}>Select</div>
                        )}
                    </div>
                </td>

                <td>
                    <textarea
                        className={styles.cellInput}
                        value={row.brandDesc}
                        onChange={(e) => handleCellChange(index, 'brandDesc', e.target.value)}
                        style={{ minHeight: '80px' }}
                        placeholder="Product details..."
                    />
                </td>

                <td>
                    <input className={styles.cellInput} value={row.qty} onChange={(e) => handleCellChange(index, 'qty', e.target.value)} style={{ textAlign: 'center' }} />
                </td>
                <td>
                    <input className={styles.cellInput} value={row.unit} onChange={(e) => handleCellChange(index, 'unit', e.target.value)} />
                </td>
                <td>
                    <input className={styles.cellInput} value={row.rate} onChange={(e) => handleCellChange(index, 'rate', e.target.value)} style={{ textAlign: 'right' }} />
                </td>
                <td>
                    <input
                        type="text"
                        value={row.rate && parseFloat(row.rate) > 0
                            ? (parseFloat(row.qty || 0) * parseFloat(row.rate || 0)).toFixed(2)
                            : (row.amount || '')}
                        onChange={(e) => handleCellChange(index, 'amount', e.target.value)}
                        className={styles.cellInput}
                        style={{ textAlign: 'right', opacity: row.rate && parseFloat(row.rate) > 0 ? 0.7 : 1 }}
                        disabled={row.rate && parseFloat(row.rate) > 0}
                        placeholder="0.00"
                    />
                </td>

                <td>
                    <div className={styles.dropdownStack}>
                        <div className={styles.brandDropdownContainer}>
                            {row.aiStatus === 'processing' ? (
                                <div className={styles.aiLoadingCell}>
                                    <div className={styles.tinySpinner}></div>
                                    <span>AI Searching...</span>
                                </div>
                            ) : (
                                <button
                                    className={`${styles.brandTrigger} ${row.selectedBrand ? styles.brandSelected : ''}`}
                                    onClick={() => setOpenBrandDropdown(openBrandDropdown === index ? null : index)}
                                >
                                    {row.selectedBrand ? (
                                        <>
                                            {row.brandLogo && (
                                                <img
                                                    src={getFullUrl(row.brandLogo)}
                                                    alt=""
                                                    className={styles.triggerLogo}
                                                    onError={(e) => { e.target.style.display = 'none'; }}
                                                />
                                            )}
                                            <span className={styles.triggerText}>
                                                {row.selectedBrand}
                                            </span>
                                        </>
                                    ) : (
                                        <span className={styles.triggerPlaceholder}>Select Brand...</span>
                                    )}
                                    <span className={styles.triggerArrow}>{openBrandDropdown === index ? '▲' : '▼'}</span>
                                </button>
                            )}

                            {openBrandDropdown === index && (
                                <div className={styles.brandDropdownPanel}>
                                    {brands
                                        .filter(b => {
                                            // 1. Budget Tier Filtering
                                            const bTier = (b.budgetTier || 'mid').toLowerCase();
                                            const aTier = activeTier.toLowerCase();
                                            let tierMatch = false;
                                            if (aTier === 'budgetary') tierMatch = ['budgetary', 'low'].includes(bTier);
                                            else if (aTier === 'high') tierMatch = ['high', 'high-end', 'premium'].includes(bTier);
                                            else tierMatch = !['budgetary', 'low', 'high', 'high-end', 'premium'].includes(bTier);

                                            if (!tierMatch) return false;

                                            // 2. Type/Scope Filtering (Fitout vs Furniture)
                                            const rowScope = (row.scope || 'Furniture').toLowerCase();
                                            // Robust detection: use type tag or name-based fallback
                                            const brandType = (b.type || (b.name.toLowerCase().includes('fitout') ? 'fitout' : 'furniture')).toLowerCase();

                                            // Mapping: if row scope contains 'fitout', only show 'fitout' brands
                                            if (rowScope.includes('fitout')) {
                                                return brandType === 'fitout';
                                            } else {
                                                // Exclude fitout brands from furniture rows
                                                return brandType !== 'fitout';
                                            }
                                        })
                                        .map((b, bIdx) => (
                                            <button
                                                key={bIdx}
                                                className={styles.brandOption}
                                                onClick={() => {
                                                    handleCellChange(index, 'selectedBrand', b.name);
                                                    setOpenBrandDropdown(null);
                                                }}
                                            >
                                                {b.name}
                                            </button>
                                        ))
                                    }
                                </div>
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

                <td>
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

        // Find whichever has rows (usually all if auto-filled)
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
                                        {match && match.selectedBrand ? (
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
        <div className={styles.overlay}>
            <div className={`${styles.modalContainer} ${theme === 'light' ? styles.light : ''}`} onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className={styles.header}>
                    <div className={styles.title}>
                        💰 Multi-Budget Offers
                    </div>
                    <button className={styles.closeBtn} onClick={onClose}>×</button>
                </div>

                {/* Main Content (Flex Column) */}
                <div className={styles.content}>

                    {/* Fixed Top Section: Actions + Tabs */}
                    <div className={styles.topSection}>
                        <div className={styles.mainActions}>
                            <button className={`${styles.actionCard} ${styles.genBoqBtn}`} onClick={handleGenerateFromBoq}>
                                <span style={{ fontSize: '1.4rem' }}>📋</span>
                                <span>Generate from BOQ</span>
                            </button>
                            <button className={`${styles.actionCard} ${styles.genPlanBtn}`} onClick={() => planInputRef.current?.click()}>
                                <span style={{ fontSize: '1.4rem' }}>📐</span>
                                <span>Generate from Plan</span>
                            </button>
                            <button className={`${styles.actionCard} ${styles.createNewBtn}`} onClick={handleCreateNewBoq}>
                                <span style={{ fontSize: '1.4rem' }}>➕</span>
                                <span>Create New BOQ</span>
                            </button>
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
                                        ? `AI FURNITURE${furnitureProgress.total > 0 ? ` (${furnitureProgress.current}/${furnitureProgress.total})` : '...'}`
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
                                        ? `AI FITOUT${fitoutProgress.total > 0 ? ` (${fitoutProgress.current}/${fitoutProgress.total})` : '...'}`
                                        : 'AI FITOUT'
                                    }
                                </span>
                            </button>
                        </div>


                        {/* Hidden Inputs for UPLOADS (act same as landing page) */}
                        <input
                            type="file"
                            ref={boqInputRef}
                            style={{ display: 'none' }}
                            accept=".xlsx,.xls,.pdf"
                            onChange={(e) => {
                                if (e.target.files && e.target.files[0]) {
                                    onUploadBoq(e.target.files[0]);
                                    onClose();
                                }
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
                                    onClose();
                                }
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

                    {/* Scrollable Table Area */}
                    <div className={styles.tableContainer}>
                        {/* Batch completion notification */}
                        {/* Batch completion notification - Furniture */}
                        {furnitureBatchResult && (
                            <div className={`${styles.aiBatchNotification} ${furnitureBatchResult.error > 0 ? styles.aiBatchNotificationError : styles.aiBatchNotificationSuccess}`}>
                                <span>
                                    Furniture Batch Complete — <strong>{furnitureBatchResult.success || 0}</strong> matched, <strong>{furnitureBatchResult.error || 0}</strong> failed
                                    {furnitureBatchResult.newlyAdded > 0 && ` (${furnitureBatchResult.newlyAdded} new brands added)`}
                                </span>
                                <button className={styles.notificationClose} onClick={() => setFurnitureBatchResult(null)}>×</button>
                            </div>
                        )}
                        {/* Batch completion notification - Fitout */}
                        {fitoutBatchResult && (
                            <div className={`${styles.aiBatchNotification} ${fitoutBatchResult.error > 0 ? styles.aiBatchNotificationError : styles.aiBatchNotificationSuccess}`}>
                                <span>
                                    Fitout Batch Complete — <strong>{fitoutBatchResult.success || 0}</strong> matched, <strong>{fitoutBatchResult.error || 0}</strong> failed
                                    {fitoutBatchResult.newlyAdded > 0 && ` (${fitoutBatchResult.newlyAdded} new brands added)`}
                                </span>
                                <button className={styles.notificationClose} onClick={() => setFitoutBatchResult(null)}>×</button>
                            </div>
                        )}
                        {renderActiveView()}
                    </div>

                    {/* Fixed Footer */}
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

            {/* Image Preview Overlay */}
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
            {/* Add Brand Modal */}
            <AddBrandModal
                isOpen={isAddBrandOpen}
                onClose={() => setIsAddBrandOpen(false)}
                onBrandAdded={handleBrandAdded}
                onBrandUpdated={fetchBrands}
            />
            {/* Specialist Audit Modal */}
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
            {/* Costing Modal */}
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
            {/* Parallel AI Discovery Modals - Refactored for global stacking */}
            {(() => {
                const getActiveModals = (statuses, type, batchResult, progress, setStatuses, setBatchResult) => {
                    const activeTiers = ['high', 'mid', 'budgetary'].filter(k => statuses[k]?.active);
                    if (activeTiers.length > 0) {
                        return activeTiers.map(t => ({
                            type,
                            tier: t,
                            status: statuses[t],
                            progress,
                            setStatuses,
                            setBatchResult,
                            isResult: false
                        }));
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

                const furnitureModals = getActiveModals(furnitureStatuses, 'furniture', furnitureBatchResult, furnitureProgress, setFurnitureStatuses, setFurnitureBatchResult);
                const fitoutModals = getActiveModals(fitoutStatuses, 'fitout', fitoutBatchResult, fitoutProgress, setFitoutStatuses, setFitoutBatchResult);
                const globalModals = [...furnitureModals, ...fitoutModals];

                return globalModals.map((modalData, idx) => {
                    const { type, tier, status, progress, setStatuses, setBatchResult, isResult, batchResult: bRes } = modalData;
                    const ModalComponent = type === 'fitout' ? AIFitoutPresentationModal : AIPresentationModal;

                    // Horizontal alignment for full modals
                    let alignment = 'center';
                    if (globalModals.length > 1 && !status.minimized) {
                        if (globalModals.length === 2) {
                            alignment = idx === 0 ? 'left' : 'right';
                        } else if (globalModals.length === 3) {
                            if (idx === 0) alignment = 'left';
                            if (idx === 1) alignment = 'center-narrow';
                            if (idx === 2) alignment = 'right';
                        } else {
                            // More than 3 modals: distribution logic
                            const pos = (idx / (globalModals.length - 1)) * 100;
                            if (pos < 30) alignment = 'left';
                            else if (pos > 70) alignment = 'right';
                            else alignment = 'center-narrow';
                        }
                    }

                    // Global minimized offset
                    const minimizedOffset = idx * 340 + 24;

                    return (
                        <ModalComponent
                            key={`${type}-${tier}-${isResult ? 'result' : 'discovery'}`}
                            type={type}
                            isOpen={true}
                            onClose={() => {
                                if (isResult) {
                                    setBatchResult(null);
                                } else {
                                    setStatuses(prev => ({ ...prev, [tier]: { ...prev[tier], active: false } }));
                                }
                            }}
                            tier={tier}
                            alignment={alignment}
                            currentItem={status.currentItem}
                            batchResult={isResult ? bRes : null}
                            brand={status.brand}
                            foundModel={status.model}
                            foundImage={status.image}
                            progress={progress[tier]?.total > 0 ? (progress[tier].current / progress[tier].total) * 100 : 0}
                            status={status.status}
                            isMinimized={status.minimized}
                            onToggleMinimize={(val) => {
                                if (isResult) return;
                                setStatuses(prev => ({ ...prev, [tier]: { ...prev[tier], minimized: val } }));
                            }}
                            minimizedOffset={minimizedOffset}
                        />
                    );
                });
            })()}
        </div>
    );
}
