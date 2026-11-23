import React, { useState, useEffect, useMemo } from 'react';
import styles from '../styles/TableViewer.module.css';
import actionStyles from '../styles/ActionBar.module.css';
import CostingModal from './CostingModal';
import MultiBudgetModal from './MultiBudgetModal';
import DesignBuildButton from './DesignBuildButton';
import { designBuild, productsFromTables } from '../features/designBuild/designBuildStore';

/** An offer applied here also furnishes the Design & Build model (and feeds its export suite). */
const shareOfferWithDesignBuild = (offerTables) => {
    const tables = Array.isArray(offerTables) ? offerTables : [];
    designBuild.setProducts(productsFromTables(tables), { tables, title: tables[0]?.sheetName || 'Applied offer' });
};

// ── Shared money helpers: one source of truth for row amounts, subtotals and VAT ──
const parseMoney = (v) => {
    const n = parseFloat(String(v ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : NaN;
};
const round2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
const fmt2 = (n) => round2(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SUMMARY_LINE_RE = /\b(sub[-\s]?total|grand\s*total|total\s*value|total\s*amount|net\s*total|vat|tax|discount)\b|^\s*total\b/i;

function getMoneyColumns(header = []) {
    const amountIdx = header.findIndex(h => /amount|total(?!.*(qty|quantity))/i.test(h));
    const rateIdx = header.findIndex((h, i) => i !== amountIdx && /rate|price/i.test(h));
    const qtyIdx = header.findIndex(h => /\bqty\b|quantity|\bqt\b/i.test(h));
    return { amountIdx, rateIdx, qtyIdx };
}

/** Row amount = qty x rate when both are present (amount cells can be stale); else the amount cell. */
function resolveRowAmount(cells = [], { qtyIdx, rateIdx, amountIdx }) {
    const qty = qtyIdx !== -1 ? parseMoney(cells[qtyIdx]?.value) : NaN;
    const rate = rateIdx !== -1 ? parseMoney(cells[rateIdx]?.value) : NaN;
    if (Number.isFinite(qty) && Number.isFinite(rate)) return round2(qty * rate);
    const amt = amountIdx !== -1 ? parseMoney(cells[amountIdx]?.value) : NaN;
    return Number.isFinite(amt) ? round2(amt) : 0;
}

/** Printed "TOTAL VALUE / VAT / GRAND TOTAL" lines extracted as rows must never be summed. */
function isSummaryLine(row, { qtyIdx }) {
    if (!row || !row.cells) return true;
    if (row.isHeader || row.isSummary) return true;
    const qty = qtyIdx !== -1 ? parseMoney(row.cells[qtyIdx]?.value) : NaN;
    if (Number.isFinite(qty) && qty > 0) return false;
    return row.cells.some(c => SUMMARY_LINE_RE.test(String(c?.value ?? '')));
}

/** Sub-items of a rolled-up set ("Included") and optional alternatives ("Optional") are never summed. */
function isNonTotalRow(row) {
    return Boolean(row && (row.isOptionRow || row.isSetSubItem));
}
import ValueEngineeredModal from './ValueEngineeredModal';
import ProjectSettingsPanel from './ProjectSettingsPanel';
import TenderAutofillModal from './TenderAutofillModal';
import PptxTemplateModal from './PptxTemplateModal';
import AISemanticMatchModal from './AISemanticMatchModal';
import MultiImageCell from './MultiImageCell';
import ImageGalleryModal from './ImageGalleryModal';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

import { useCompanyProfile } from '../context/CompanyContext';
import { useProject } from '../context/ProjectContext';
import { fixArabic, hasArabic, loadArabicFont } from '../utils/arabicPdfUtils';

import { getApiBase } from '../utils/apiBase';
import { getFullUrl, loadExportImageData, extractImageUrl } from '../utils/urlUtils';
import { exportRfqByBrandFromTables } from '../utils/rfqExportUtils';
import {
    recategorizeTables,
    resolveSectionDividerMeta,
    drawPdfCategoryDividerPage,
    addPptxCategoryDividerSlide
} from '../utils/boqGroupingUtils';

const API_BASE = getApiBase();
import { getBrandColors, UI_COLORS } from '../utils/themeConfig';


function TableViewer({
    data,
    allBrands,
    onUploadBoq,
    onUploadPlan,
    planPreviewUrl,
    planPreviewType,
    planPreviewName,
    seededItems = null
}) {
    const profile = useCompanyProfile();
    const { companyName, logoOriginal, logoWhite, website, accentColor, secondaryColor } = profile;
    const { project, updateProject } = useProject();
    const [selectedImage, setSelectedImage] = useState(null);
    const [tables, setTables] = useState([]); // Base Data
    const [recategorizeMode, setRecategorizeMode] = useState('original');
    const [costingFactors, setCostingFactors] = useState(null);
    const [isCostingOpen, setCostingOpen] = useState(false);
    const [isMultiBudgetOpen, setMultiBudgetOpen] = useState(false);
    const [isValueEngineeredOpen, setValueEngineeredOpen] = useState(false);
    const [isProjectPanelOpen, setProjectPanelOpen] = useState(false);
    const [isTenderAutofillOpen, setTenderAutofillOpen] = useState(false);
    // Per-table VAT rate for extracted summary (GCC default = 5%)
    const [vatRates, setVatRates] = useState({});
    // Offer applied from Value Engineer / Multi-Budget: already priced & costed, shown in the
    // costed section only. The original extracted tables are never replaced by it.
    const [appliedOffer, setAppliedOffer] = useState(null);
    // Removed columns, most recent last, so a removal can be undone
    const [removedColumns, setRemovedColumns] = useState([]);
    const [generatingType, setGeneratingType] = useState(null);
    const [showPptxModal, setShowPptxModal] = useState(false);
    const [pptxSourceTables, setPptxSourceTables] = useState(null);
    const [pptxAsPdf, setPptxAsPdf] = useState(false);
    const [pptxIsCosted, setPptxIsCosted] = useState(false);
    const [semanticMatchTarget, setSemanticMatchTarget] = useState(null);
    const [isSemanticModalOpen, setSemanticModalOpen] = useState(false);
    const [matchingRowKey, setMatchingRowKey] = useState(null);
    const [galleryModal, setGalleryModal] = useState({
        isOpen: false,
        images: [],
        initialIndex: 0,
        title: '',
        subtitle: '',
        tableIndex: null,
        rowIndex: null,
        cellIndex: null
    });


    // Close on Escape
    useEffect(() => {
        const handleEsc = (e) => {
            if (e.key === 'Escape') setSelectedImage(null);
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, []);

    // Load Data
    useEffect(() => {
        if (data && data.tables) {
            const rawTables = JSON.parse(JSON.stringify(data.tables));
            // Keep uploaded BOQs / offers in their exact original sequence by default;
            // only auto-recategorize when explicitly marked (e.g. extracted Plan Drawings -> 'item').
            const initMode = data.recategorizeMode || rawTables[0]?.recategorizeMode || 'original';
            setRecategorizeMode(initMode);
            const shouldRecat = initMode === 'item' || initMode === 'room';
            setTables(shouldRecat ? recategorizeTables(rawTables, initMode) : rawTables);
            setVatRates({}); // Reset VAT selections on new upload (defaults back to 5%)
            // Already-costed VE / Multi-Budget offer handed over by the parent (never re-costed)
            setAppliedOffer(data.appliedOffer ? JSON.parse(JSON.stringify(data.appliedOffer)) : null);
            setRemovedColumns([]);

            // Allow pre-initialized costing factors from parent (e.g. from MultiBudgetModal)
            if (data.costingFactors) {
                setCostingFactors(data.costingFactors);
            }
        }
    }, [data]);

    const handleRecategorizeChange = (nextMode) => {
        setRecategorizeMode(nextMode);
        setTables(prev => recategorizeTables(prev, nextMode));
    };

    const firstTable = tables.find(t => t.uploadId);
    const uploadId = firstTable?.uploadId;
    const [pollCompleted, setPollCompleted] = useState(false);

    // Reset polling state when uploadId changes
    useEffect(() => {
        setPollCompleted(false);
    }, [uploadId]);

    // Poll for background native image matching progress
    useEffect(() => {
        if (!uploadId || pollCompleted) return;

        // If the table already has real matched images, don't poll
        const hasRealImages = tables.some(t =>
            t.rows.some(r =>
                r.cells.some(c =>
                    c.images && c.images.length > 0 && c.images.some(img => img.url && !img.url.includes('/api/lazy-image'))
                )
            )
        );
        if (hasRealImages) {
            setPollCompleted(true);
            return;
        }

        let intervalId;
        let isPolling = true;

        const pollMetadata = async () => {
            try {
                const response = await fetch(`${API_BASE || ''}/api/upload/metadata/${uploadId}`);
                if (!response.ok) return;
                const meta = await response.json();

                // If the background positional pairing is completed
                if (meta && meta.isReady && meta.rows) {
                    console.log(' Background native image matching ready! Updating TableViewer tables.');

                    setTables(prevTables => {
                        return prevTables.map(table => {
                            if (table.uploadId !== uploadId) return table;

                            const updatedRows = table.rows.map((row, rIdx) => {
                                if (row.isHeader || row.isSummary) return row;

                                const matchedMetaRow = meta.rows.find(mr => mr.pageNum === row.pageNum && mr.rowIdx === rIdx);
                                if (matchedMetaRow) {
                                    const newCells = [...row.cells];
                                    const imgIdx = table.header.findIndex(h => /\b(image|photo|picture|img|pic|illustration|drawing|sketch)\b/i.test(h) || /\b(image\s*ref|photo\s*ref|pic\s*ref)\b/i.test(h));
                                    if (imgIdx !== -1 && newCells[imgIdx]) {
                                        newCells[imgIdx] = {
                                            ...newCells[imgIdx],
                                            image: matchedMetaRow.image,
                                            images: matchedMetaRow.images && matchedMetaRow.images.length > 0 ? matchedMetaRow.images : [matchedMetaRow.image]
                                        };
                                    }
                                    return {
                                        ...row,
                                        cells: newCells
                                    };
                                }
                                return row;
                            });

                            return {
                                ...table,
                                rows: updatedRows
                            };
                        });
                    });

                    // Stop polling
                    isPolling = false;
                    clearInterval(intervalId);
                    setPollCompleted(true);
                }
            } catch (err) {
                console.warn('Error polling upload metadata:', err);
            }
        };

        // Poll every 3 seconds
        intervalId = setInterval(() => {
            if (isPolling) pollMetadata();
        }, 3000);

        // Run immediately once
        pollMetadata();

        return () => {
            isPolling = false;
            clearInterval(intervalId);
        };
    }, [uploadId, pollCompleted]);

    // Compute summary for original extracted tables
    const tablesWithSummary = useMemo(() => {
        return tables.map(table => {
            const header = table.header || [];

            // Find rate and amount/total columns
            const { rateIdx, amountIdx, qtyIdx } = getMoneyColumns(header);
            const unitIdx = header.findIndex(h => /unit|uom/i.test(h));
            const descIdx = header.findIndex(h => /description|desc|disc|item|product/i.test(h));
            const imgIdx = header.findIndex(h => /\b(image|photo|picture|img|pic|illustration|drawing|sketch)\b/i.test(h) || /\b(image\s*ref|photo\s*ref|pic\s*ref)\b/i.test(h));

            // Calculate totals
            let totalRate = 0;
            let totalAmount = 0;
            let totalQty = 0;
            let validRows = 0;

            table.rows.forEach(row => {
                if (!row || !row.cells || row.isHeader || row.isSummary || isNonTotalRow(row)) return;

                const qtyValStr = qtyIdx !== -1 ? String(row.cells[qtyIdx]?.value || '').trim() : '';
                const rateValStr = rateIdx !== -1 ? String(row.cells[rateIdx]?.value || '').trim() : '';
                const unitValStr = unitIdx !== -1 ? String(row.cells[unitIdx]?.value || '').trim() : '';

                // Skip rows that are clearly section titles (text only, no qty/rate/unit)
                if (!qtyValStr && !rateValStr && !unitValStr) return;
                // Skip printed TOTAL / VAT / GRAND TOTAL lines extracted as rows
                if (isSummaryLine(row, { qtyIdx })) return;

                // Parse rate
                if (rateIdx !== -1 && row.cells[rateIdx]?.value) {
                    const val = parseFloat(String(row.cells[rateIdx].value).replace(/,/g, ''));
                    if (!isNaN(val)) totalRate += val;
                }

                // Parse amount (qty x rate is authoritative)
                const lineAmount = resolveRowAmount(row.cells, { qtyIdx, rateIdx, amountIdx });
                if (lineAmount !== 0) {
                    totalAmount = round2(totalAmount + lineAmount);
                    validRows++;
                }

                // Parse quantity
                if (qtyIdx !== -1 && row.cells[qtyIdx]?.value) {
                    const val = parseFloat(String(row.cells[qtyIdx].value).replace(/,/g, ''));
                    if (!isNaN(val)) totalQty += val;
                }
            });

            // Only add summary if we found monetary values
            const hasValues = totalAmount > 0 || totalRate > 0;

            return {
                ...table,
                extractedSummary: hasValues ? {
                    totalRate: totalRate.toFixed(2),
                    totalAmount: totalAmount.toFixed(2),
                    totalQty: totalQty.toFixed(0),
                    itemCount: validRows
                } : null
            };
        });
    }, [tables]);

    // Compute Costed Tables (Separate copy)
    const costedTables = useMemo(() => {
        // An applied VE / Multi-Budget offer is already costed: summarise it, never cost it again.
        const offerFactors = appliedOffer ? (appliedOffer.costingFactors || costingFactors || { vat: 5, toCurrency: '' }) : null;
        const factors = offerFactors || costingFactors;
        if (!factors) return null;
        const sourceTables = appliedOffer ? appliedOffer.tables : tables;

        const grossMargin = ((factors.profit || 0) + (factors.freight || 0) + (factors.customs || 0) + (factors.installation || 0)) / 100;
        const multiplier = appliedOffer ? 1 : (factors.exchangeRate || 1) * (1 + grossMargin);
        const vatRate = (factors.vat || 0) / 100;

        return sourceTables.map(table => {
            const header = table.header || [];
            const moneyIndices = header.map((h, i) =>
                /rate|price|amount|total(?!.*(qty|quantity))/i.test(h) ? i : -1
            ).filter(i => i !== -1);

            const cols = getMoneyColumns(header);
            const { amountIdx, rateIdx, qtyIdx } = cols;

            const newRows = (table.rows || []).map(row => {
                if (!row || !row.cells) return row;
                if (isSummaryLine(row, cols)) return row;
                const nonTotal = isNonTotalRow(row);
                const newCells = row.cells.map((cell, idx) => {
                    // Never alter the "Optional" / "Included" amount marker on non-total rows
                    if (nonTotal && idx === amountIdx) return cell;
                    // Only modify money columns
                    if (cell && moneyIndices.includes(idx) && cell.value) {
                        try {
                            const cleanVal = String(cell.value).replace(/,/g, '');
                            const num = parseFloat(cleanVal);
                            if (!isNaN(num)) {
                                const finalPrice = round2(num * multiplier).toFixed(2);
                                return { ...cell, value: finalPrice };
                            }
                        } catch (e) { return cell; }
                    }
                    return cell;
                });
                // Keep the costed amount consistent with the costed (rounded) rate x qty
                // (never overwrite "Included" / "Optional" on set sub-items or optional lines)
                if (!nonTotal && amountIdx !== -1 && rateIdx !== -1 && qtyIdx !== -1) {
                    const qty = parseMoney(newCells[qtyIdx]?.value);
                    const rate = parseMoney(newCells[rateIdx]?.value);
                    if (Number.isFinite(qty) && Number.isFinite(rate) && newCells[amountIdx]) {
                        newCells[amountIdx] = { ...newCells[amountIdx], value: round2(qty * rate).toFixed(2) };
                    }
                }
                return { ...row, cells: newCells };
            });

            // Calculate Summary (same rules as the original table; exclude Included sub-items & Optional lines)
            const subtotal = newRows.reduce((acc, row) => (
                (isSummaryLine(row, cols) || isNonTotalRow(row)) ? acc : round2(acc + resolveRowAmount(row.cells, cols))
            ), 0);

            const vatAmount = round2(subtotal * vatRate);
            const grandTotal = round2(subtotal + vatAmount);

            return {
                ...table,
                rows: newRows,
                summary: {
                    subtotal: subtotal.toFixed(2),
                    vatAmount: vatAmount.toFixed(2),
                    grandTotal: grandTotal.toFixed(2),
                    vatPercent: factors.vat || 0,
                    currency: factors.toCurrency || ''
                }
            };
        });
    }, [tables, costingFactors, appliedOffer]);

    // Scroll to costed results when they appear
    useEffect(() => {
        if (costedTables) {
            const timer = setTimeout(() => {
                const costedSection = document.getElementById('costed-results');
                if (costedSection) {
                    costedSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [costedTables]);

    // Handlers
    const handleCellChange = (tableIndex, rowIndex, cellIndex, newValue) => {
        const newTables = [...tables];
        newTables[tableIndex].rows[rowIndex].cells[cellIndex].value = newValue;
        setTables(newTables);
    };

    const handleUpdateCellImages = (tableIndex, rowIndex, cellIndex, newImages) => {
        setTables(prevTables => {
            const next = [...prevTables];
            const targetTable = { ...next[tableIndex] };
            const rows = [...targetTable.rows];
            const targetRow = { ...rows[rowIndex] };
            const newCells = [...targetRow.cells];
            const cell = { ...newCells[cellIndex] };

            const normalized = (newImages || []).map(u => (typeof u === 'string' ? { url: u } : u));
            cell.images = normalized;
            cell.image = normalized[0] ? (typeof normalized[0] === 'string' ? normalized[0] : normalized[0].url) : null;

            newCells[cellIndex] = cell;
            targetRow.cells = newCells;
            rows[rowIndex] = targetRow;
            targetTable.rows = rows;
            next[tableIndex] = targetTable;
            return next;
        });
    };

    const handleOpenSemanticMatch = (tableIndex, rowIndex, row, header) => {
        const descIdx = header.findIndex(h => /description|desc|disc|item|spec/i.test(h));
        const modelIdx = header.findIndex(h => /model|code|item_code|product/i.test(h));
        const qtyIdx = header.findIndex(h => /qty|quantity|qt/i.test(h));
        const unitIdx = header.findIndex(h => /unit|uom/i.test(h));
        const brandIdx = header.findIndex(h => /brand|maker|manufacturer/i.test(h));
        const snIdx = header.findIndex(h => /sn|s\.n|item\s*no|pos|#/i.test(h));
        const imgIdx = header.findIndex(h => /\b(image|photo|picture|img|pic|illustration|drawing|sketch)\b/i.test(h) || /\b(image\s*ref|photo\s*ref|pic\s*ref)\b/i.test(h));

        const cellImages = (imgIdx !== -1 && row.cells[imgIdx])
            ? (row.cells[imgIdx].images || (row.cells[imgIdx].image ? [row.cells[imgIdx].image] : []))
            : [];
        const firstImg = cellImages.length > 0
            ? (typeof cellImages[0] === 'string' ? cellImages[0] : (cellImages[0].url || cellImages[0].src || ''))
            : (imgIdx !== -1 ? row.cells[imgIdx]?.image : null);

        const currentTable = tables[tableIndex];
        const categoryHint = row.sectionLabel || currentTable?.sheetName || '';

        // Consolidate full row text from all relevant columns (Item name, description, size, finishes, reference links/URLs)
        const descParts = [];
        const excludedRegex = /^(s\.?n\.?|item\s*no|pos|#|qty|quantity|qt|unit\s*rate|unit\s*price|rate|price|amount|total|image|photo|picture|img|pic)$/i;

        header.forEach((h, cIdx) => {
            if (excludedRegex.test(h.trim())) return;
            const cellVal = (row.cells[cIdx]?.value || '').trim();
            if (cellVal && cellVal !== '-' && cellVal !== 'NO REF' && cellVal !== 'BOQ_ONLY' && !descParts.includes(cellVal)) {
                descParts.push(cellVal);
            }
        });

        // Scan all row cells for embedded manufacturer/dealer URLs (e.g. bt.design, workspace.ae)
        row.cells.forEach(cell => {
            const val = (cell?.value || '').trim();
            const urlMatches = val.match(/https?:\/\/[^\s\)\],]+/gi);
            if (urlMatches) {
                urlMatches.forEach(u => {
                    if (!descParts.some(p => p.includes(u))) {
                        descParts.push(u);
                    }
                });
            }
        });

        const fullDescription = descParts.length > 0 ? descParts.join(' | ') : (descIdx !== -1 ? row.cells[descIdx]?.value : (row.cells[1]?.value || ''));

        const itemObj = {
            tableIndex,
            rowIndex,
            code: snIdx !== -1 ? row.cells[snIdx]?.value : `${rowIndex + 1}`,
            description: fullDescription,
            model: modelIdx !== -1 ? row.cells[modelIdx]?.value : '',
            brand: brandIdx !== -1 ? row.cells[brandIdx]?.value : '',
            quantity: qtyIdx !== -1 ? parseFloat(row.cells[qtyIdx]?.value) || 1 : 1,
            unit: unitIdx !== -1 ? row.cells[unitIdx]?.value : 'pcs',
            imageUrl: firstImg || null,
            images: cellImages,
            category: categoryHint
        };

        setSemanticMatchTarget(itemObj);
        setSemanticModalOpen(true);
    };

    const handleSelectSemanticProduct = (product) => {
        if (!semanticMatchTarget || !product) return;
        const { tableIndex, rowIndex } = semanticMatchTarget;

        setTables(prevTables => {
            const nextTables = [...prevTables];
            const targetTable = { ...nextTables[tableIndex] };
            const header = targetTable.header || [];
            const rows = [...targetTable.rows];
            const targetRow = { ...rows[rowIndex] };
            const newCells = [...targetRow.cells];

            const modelIdx = header.findIndex(h => /model|code|item_code|product/i.test(h));
            const brandIdx = header.findIndex(h => /brand|maker|manufacturer/i.test(h));
            const rateIdx = header.findIndex(h => /unit\s*rate|unit\s*price|rate|price/i.test(h));
            const amountIdx = header.findIndex(h => /amount|total(?!.*(qty|quantity))/i.test(h));
            const qtyIdx = header.findIndex(h => /qty|quantity|qt/i.test(h));
            const imgIdx = header.findIndex(h => /\b(image|photo|picture|img|pic|illustration|drawing|sketch)\b/i.test(h) || /\b(image\s*ref|photo\s*ref|pic\s*ref)\b/i.test(h));

            if (modelIdx !== -1 && newCells[modelIdx]) {
                newCells[modelIdx] = { ...newCells[modelIdx], value: product.model || newCells[modelIdx].value };
            }
            if (brandIdx !== -1 && newCells[brandIdx]) {
                newCells[brandIdx] = { ...newCells[brandIdx], value: product.brand || newCells[brandIdx].value };
            }
            if (rateIdx !== -1 && newCells[rateIdx] && product.price > 0) {
                const numericPrice = parseFloat(product.price) || 0;
                newCells[rateIdx] = { ...newCells[rateIdx], value: numericPrice.toFixed(2) };
                if (qtyIdx !== -1 && amountIdx !== -1 && newCells[amountIdx]) {
                    const qty = parseFloat(newCells[qtyIdx]?.value) || 1;
                    newCells[amountIdx] = { ...newCells[amountIdx], value: (numericPrice * qty).toFixed(2) };
                }
            }
            if (imgIdx !== -1 && newCells[imgIdx] && product.imageUrl) {
                const rawImgs = product.images && Array.isArray(product.images) && product.images.length > 0
                    ? product.images
                    : [product.imageUrl];
                newCells[imgIdx] = {
                    ...newCells[imgIdx],
                    image: product.imageUrl,
                    images: rawImgs
                };
            }

            targetRow.cells = newCells;
            targetRow.aiStatus = 'success';
            targetRow.matchedProduct = product;
            rows[rowIndex] = targetRow;
            targetTable.rows = rows;
            nextTables[tableIndex] = targetTable;
            return nextTables;
        });
    };

    const handleQuickAutoMatchRow = async (tableIndex, rowIndex, row, header) => {
        const rowKey = `${tableIndex}_${rowIndex}`;
        setMatchingRowKey(rowKey);

        const descIdx = header.findIndex(h => /description|desc|disc|item|spec/i.test(h));
        const modelIdx = header.findIndex(h => /model|code|item_code|product/i.test(h));
        const qtyIdx = header.findIndex(h => /qty|quantity|qt/i.test(h));
        const unitIdx = header.findIndex(h => /unit|uom/i.test(h));
        const brandIdx = header.findIndex(h => /brand|maker|manufacturer/i.test(h));
        const snIdx = header.findIndex(h => /sn|s\.n|item\s*no|pos|#/i.test(h));
        const imgIdx = header.findIndex(h => /image|photo|picture|img|pic|ref/i.test(h));

        const cellImages = (imgIdx !== -1 && row.cells[imgIdx])
            ? (row.cells[imgIdx].images || (row.cells[imgIdx].image ? [row.cells[imgIdx].image] : []))
            : [];
        const firstImg = cellImages.length > 0
            ? (typeof cellImages[0] === 'string' ? cellImages[0] : (cellImages[0].url || cellImages[0].src || ''))
            : (imgIdx !== -1 ? row.cells[imgIdx]?.image : null);

        const currentTable = tables[tableIndex];
        const categoryHint = row.sectionLabel || currentTable?.sheetName || '';
        const descToMatch = descIdx !== -1 ? row.cells[descIdx]?.value : (row.cells[1]?.value || '');
        const qtyVal = qtyIdx !== -1 ? parseFloat(row.cells[qtyIdx]?.value) || 1 : 1;
        const unitVal = unitIdx !== -1 ? row.cells[unitIdx]?.value : 'pcs';

        try {
            const apiBase = getApiBase();
            const brandNames = (allBrands && allBrands.length > 0)
                ? allBrands.map(b => b.name)
                : ['B&T Design', 'NARBUTAS', 'Nurus', 'FREZZA', 'LAS', 'Sedus Stoll', 'Ofifran', 'Arper', 'Teknion ME', 'AMARA', 'Ottimo Furniture', 'Sokoa', 'Rim'];

            // Run primary VE Auto-Detect pipeline with specification grounding
            let matchedProduct = null;
            let matchedAlternatives = [];

            const veRes = await fetch(`${apiBase}/api/ve-match-auto`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    description: descToMatch,
                    qty: qtyVal,
                    unit: unitVal,
                    imageUrl: firstImg,
                    imageAssets: cellImages.map(img => typeof img === 'string' ? { url: img } : img),
                    category: categoryHint,
                    tier: 'mid'
                })
            }).then(r => r.json()).catch(() => null);

            if (veRes && veRes.status === 'success' && veRes.product) {
                matchedProduct = veRes.product;
                matchedAlternatives = veRes.alternatives || [];
            }

            if (!matchedProduct) {
                // Secondary check via Auto-Match AI
                const res = await fetch(`${apiBase}/api/auto-match-ai`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        description: descToMatch,
                        qty: qtyVal,
                        unit: unitVal,
                        tier: 'mid',
                        availableBrands: brandNames,
                        provider: 'google',
                        scope: 'Furniture'
                    })
                });
                const data = await res.json();
                if (data.status === 'success' && data.product) {
                    matchedProduct = data.product;
                    matchedAlternatives = data.alternatives || [];
                }
            }

            if (matchedProduct) {
                setTables(prevTables => {
                    const nextTables = [...prevTables];
                    const targetTable = { ...nextTables[tableIndex] };
                    const tHeader = targetTable.header || [];
                    const tRows = [...targetTable.rows];
                    const targetRow = { ...tRows[rowIndex] };
                    const newCells = [...targetRow.cells];

                    const mIdx = tHeader.findIndex(h => /model|code|item_code|product/i.test(h));
                    const bIdx = tHeader.findIndex(h => /brand|maker|manufacturer/i.test(h));
                    const rIdx = tHeader.findIndex(h => /unit\s*rate|unit\s*price|rate|price/i.test(h));
                    const aIdx = tHeader.findIndex(h => /amount|total(?!.*(qty|quantity))/i.test(h));
                    const qIdx = tHeader.findIndex(h => /qty|quantity|qt/i.test(h));
                    const iIdx = tHeader.findIndex(h => /image|photo|picture|img|pic|ref/i.test(h));

                    if (mIdx !== -1 && newCells[mIdx]) {
                        newCells[mIdx] = { ...newCells[mIdx], value: matchedProduct.model || newCells[mIdx].value };
                    }
                    if (bIdx !== -1 && newCells[bIdx]) {
                        newCells[bIdx] = { ...newCells[bIdx], value: matchedProduct.brand || newCells[bIdx].value };
                    }
                    if (rIdx !== -1 && newCells[rIdx] && matchedProduct.price > 0) {
                        const numericPrice = parseFloat(matchedProduct.price) || 0;
                        newCells[rIdx] = { ...newCells[rIdx], value: numericPrice.toFixed(2) };
                        if (qIdx !== -1 && aIdx !== -1 && newCells[aIdx]) {
                            const qty = parseFloat(newCells[qIdx]?.value) || 1;
                            newCells[aIdx] = { ...newCells[aIdx], value: (numericPrice * qty).toFixed(2) };
                        }
                    }
                    if (iIdx !== -1 && newCells[iIdx] && matchedProduct.imageUrl) {
                        const rawImgs = matchedProduct.images && Array.isArray(matchedProduct.images) && matchedProduct.images.length > 0
                            ? matchedProduct.images
                            : [matchedProduct.imageUrl];
                        newCells[iIdx] = {
                            ...newCells[iIdx],
                            image: matchedProduct.imageUrl,
                            images: rawImgs
                        };
                    }

                    targetRow.cells = newCells;
                    targetRow.aiStatus = 'success';
                    targetRow.matchedProduct = matchedProduct;
                    targetRow.alternatives = matchedAlternatives;
                    tRows[rowIndex] = targetRow;
                    targetTable.rows = tRows;
                    nextTables[tableIndex] = targetTable;
                    return nextTables;
                });
            } else {
                handleOpenSemanticMatch(tableIndex, rowIndex, row, header);
            }
        } catch (e) {
            console.error('Quick auto-match error:', e);
            handleOpenSemanticMatch(tableIndex, rowIndex, row, header);
        } finally {
            setMatchingRowKey(null);
        }
    };

    const handleAddRow = (tableIndex, rowIndex) => {
        const newTables = [...tables];
        const currentTable = newTables[tableIndex];
        const colCount = currentTable.columnCount || currentTable.header?.length || 0;
        const newRow = {
            cells: Array(colCount).fill().map(() => ({ value: '', image: null, images: [] })),
            isHeader: false, isSummary: false
        };
        currentTable.rows.splice(rowIndex + 1, 0, newRow);
        setTables(newTables);
    };

    const handleRemoveRow = (tableIndex, rowIndex) => {
        const newTables = [...tables];
        newTables[tableIndex].rows.splice(rowIndex, 1);
        setTables(newTables);
    };

    // Per-column metadata some extractors attach alongside the header
    const COLUMN_META_KEYS = ['columnRoles', 'originalHeaders', 'columnMetadata'];

    const handleRemoveColumn = (tableIndex, colIndex) => {
        const table = tables[tableIndex];
        if (!table || !Array.isArray(table.header) || table.header.length <= 1) return;
        const width = table.header.length;
        const snapshot = {
            tableIndex,
            colIndex,
            label: table.header[colIndex],
            cells: table.rows.map(r => (Array.isArray(r.cells) && r.cells.length === width ? r.cells[colIndex] : undefined)),
            meta: Object.fromEntries(COLUMN_META_KEYS.filter(k => Array.isArray(table[k]) && table[k].length === width).map(k => [k, table[k][colIndex]]))
        };
        setTables(prev => prev.map((t, ti) => {
            if (ti !== tableIndex) return t;
            const next = {
                ...t,
                header: t.header.filter((_, i) => i !== colIndex),
                columnCount: width - 1,
                rows: t.rows.map(r => (Array.isArray(r.cells) && r.cells.length === width
                    ? { ...r, cells: r.cells.filter((_, i) => i !== colIndex) }
                    : r))
            };
            for (const k of Object.keys(snapshot.meta)) next[k] = t[k].filter((_, i) => i !== colIndex);
            return next;
        }));
        setRemovedColumns(prev => [...prev, snapshot]);
    };

    /** Insert an empty column to the right of colIndex. Its header can be renamed in place. */
    const handleAddColumn = (tableIndex, colIndex) => {
        setTables(prev => prev.map((t, ti) => {
            if (ti !== tableIndex || !Array.isArray(t.header)) return t;
            const width = t.header.length;
            const at = colIndex + 1;
            const insert = (arr, value) => [...arr.slice(0, at), value, ...arr.slice(at)];
            const taken = new Set(t.header.map(h => String(h || '').trim().toLowerCase()));
            let label = 'New Column';
            for (let n = 2; taken.has(label.toLowerCase()); n++) label = `New Column ${n}`;
            const next = {
                ...t,
                header: insert(t.header, label),
                columnCount: width + 1,
                rows: t.rows.map(r => (Array.isArray(r.cells) && r.cells.length === width
                    ? { ...r, cells: insert(r.cells, { value: '', images: [], image: null, isMerged: false }) }
                    : r))
            };
            for (const k of COLUMN_META_KEYS) {
                if (Array.isArray(t[k]) && t[k].length === width) next[k] = insert(t[k], k === 'columnRoles' ? 'other' : (k === 'originalHeaders' ? label : null));
            }
            return next;
        }));
        // Positions of earlier removals shift right when a column is inserted before them
        setRemovedColumns(prev => prev.map(s => (s.tableIndex === tableIndex && s.colIndex > colIndex ? { ...s, colIndex: s.colIndex + 1 } : s)));
    };

    const handleRenameColumn = (tableIndex, colIndex, rawLabel) => {
        const label = String(rawLabel || '').replace(/\s+/g, ' ').trim();
        setTables(prev => prev.map((t, ti) => {
            if (ti !== tableIndex || !Array.isArray(t.header) || t.header[colIndex] === label) return t;
            return { ...t, header: t.header.map((h, i) => (i === colIndex ? label : h)) };
        }));
    };

    const handleRestoreColumn = (tableIndex) => {
        let snapshot = null;
        for (let i = removedColumns.length - 1; i >= 0; i--) {
            if (removedColumns[i].tableIndex === tableIndex) { snapshot = removedColumns[i]; break; }
        }
        if (!snapshot) return;
        setTables(prev => prev.map((t, ti) => {
            if (ti !== tableIndex) return t;
            const width = t.header.length;
            const at = Math.min(snapshot.colIndex, width);
            const insert = (arr, value) => [...arr.slice(0, at), value, ...arr.slice(at)];
            const next = {
                ...t,
                header: insert(t.header, snapshot.label),
                columnCount: width + 1,
                // Rows added after the removal get an empty cell
                rows: t.rows.map((r, ri) => (Array.isArray(r.cells) && r.cells.length === width
                    ? { ...r, cells: insert(r.cells, snapshot.cells[ri] ?? { value: '', images: [], image: null }) }
                    : r))
            };
            for (const k of Object.keys(snapshot.meta)) if (Array.isArray(t[k]) && t[k].length === width) next[k] = insert(t[k], snapshot.meta[k]);
            return next;
        }));
        setRemovedColumns(prev => prev.filter(s => s !== snapshot));
    };

    // --- Export Handlers (Premium Styled) ---

    // In-memory image cache for ultra-fast presentation and document generation
    const imageCache = useMemo(() => new Map(), []);

    // Helper: Load image as data URL with size and format optimization (mixed-content & CORS-safe for Vercel)
    const getImageData = async (url, options = {}) => {
        return loadExportImageData(url, options, imageCache);
    };

    // ===================== RFQ GROUPING BY BRAND (ZIP / PER-BRAND XLSX) =====================
    const handleGenerateRfqByBrand = async (sourceTables, labelKey = 'original') => {
        const genKey = `rfq_${labelKey}`;
        if (generatingType) return;
        setGeneratingType(genKey);
        try {
            await exportRfqByBrandFromTables(sourceTables, {
                allBrands,
                project,
                companyName,
                logoUrl: logoOriginal || logoWhite || '',
                accentColor,
                secondaryColor,
                filenamePrefix: labelKey === 'costed' ? 'RFQ_By_Brand_Costed' : 'RFQ_By_Brand',
                imageCache
            });
        } catch (err) {
            console.error('[RFQ Export] Failed:', err);
            alert(`Failed to generate Brand RFQ pack: ${err?.message || 'Unknown error'}`);
        } finally {
            setGeneratingType(null);
        }
    };

    // Helper: Calculate fit dimensions maintaining aspect ratio (contain)
    const calcFitSize = (imgW, imgH, maxW, maxH) => {
        const ratio = Math.min(maxW / imgW, maxH / imgH);
        return { w: imgW * ratio, h: imgH * ratio };
    };

    // ===================== PREMIUM OFFER PDF =====================
    const handleDownloadPDF = async (sourceTables, filename) => {
        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();

        // Load Arabic Font
        const arabicLoaded = await loadArabicFont(doc);

        // Convert Hex/RGB to [R, G, B] array for jsPDF
        const parseColor = (colorStr, defaultVal) => {
            if (!colorStr) return defaultVal;
            const clean = colorStr.trim().replace('#', '').toUpperCase();
            if (clean === '3B82F6' || clean === '1E5FA8' || clean === '2563EB') {
                return [15, 62, 103]; // RGB for #0F3E67
            }
            if (colorStr.startsWith('rgb')) {
                const match = colorStr.match(/\d+/g);
                return match ? match.slice(0, 3).map(Number) : defaultVal;
            }
            if (colorStr.startsWith('#')) {
                const hex = colorStr.replace('#', '');
                const r = parseInt(hex.substring(0, 2), 16);
                const g = parseInt(hex.substring(2, 4), 16);
                const b = parseInt(hex.substring(4, 6), 16);
                return [r, g, b];
            }
            return defaultVal;
        };

        // Premium Color Palette
        const colors = {
            primary: parseColor(accentColor, [30, 41, 59]),
            secondary: parseColor(secondaryColor, [245, 158, 11]),
            accent: [16, 185, 129],      // Emerald 500
            text: [51, 65, 85],          // Slate 600
            lightBg: [248, 250, 252],    // Slate 50
            border: [226, 232, 240],     // Slate 200
            white: [255, 255, 255]
        };

        // ===== COVER PAGE =====
        // Premium Header Section
        const coverHeaderHeight = 108;
        doc.setFillColor(...colors.primary);
        doc.rect(0, 0, pageWidth, coverHeaderHeight, 'F');
        doc.setFillColor(...colors.secondary);
        doc.rect(0, coverHeaderHeight, pageWidth, 1.5, 'F');

        // Add Company Logo to Header if available
        const coverLogo = logoWhite || logoOriginal;
        if (coverLogo) {
            try {
                const docLogo = await getImageData(coverLogo, { format: 'image/png', maxWidth: 1200 });
                if (docLogo) {
                    // Refined size inside upper portion of banner
                    const fit = calcFitSize(docLogo.width, docLogo.height, 76, 34);
                    doc.addImage(docLogo.dataUrl, 'PNG', (pageWidth - fit.w) / 2, 12, fit.w, fit.h);
                }
            } catch (e) { }
        } else {
            // Company Name as fallback in Header
            const cName = companyName || 'COMMERCIAL OFFER';
            doc.setTextColor(...colors.white);
            doc.setFontSize(22);
            const isArabicCName = hasArabic(cName);
            doc.setFont(isArabicCName && arabicLoaded ? 'Almarai' : 'helvetica', 'bold');
            doc.text(isArabicCName ? fixArabic(cName) : cName, pageWidth / 2, 36, { align: 'center' });
        }

        // Title (placed cleanly inside dark header banner)
        doc.setTextColor(...colors.white);
        doc.setFontSize(26);
        doc.setFont('helvetica', 'bold');
        doc.text('COMMERCIAL OFFER', pageWidth / 2, 66, { align: 'center' });

        // Subtitle
        doc.setFontSize(12);
        doc.setFont('helvetica', 'normal');
        doc.text('Bill of Quantities & Pricing Schedule', pageWidth / 2, 78, { align: 'center' });

        // Date Badge inside lower portion of dark banner
        doc.setFillColor(...colors.secondary);
        doc.roundedRect(pageWidth / 2 - 22, 88, 44, 8, 1.5, 1.5, 'F');
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...colors.primary);
        const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        doc.text(today, pageWidth / 2, 93.5, { align: 'center' });

        // Document Info Card
        doc.setFillColor(...colors.lightBg);
        doc.setDrawColor(...colors.border);
        doc.setLineWidth(0.4);
        doc.roundedRect(20, 118, pageWidth - 40, 34, 2, 2, 'FD');

        doc.setTextColor(...colors.text);
        doc.setFontSize(9.5);
        const activeTotalItems = sourceTables.reduce((acc, t) => acc + collectActiveTableRows(t).length, 0);
        const docRefCode = `OFF-${Date.now().toString().slice(-6)}`;

        let infoY = 127;
        doc.setFont('helvetica', 'bold'); doc.text('Document Reference:', 26, infoY);
        doc.setFont('helvetica', 'normal'); doc.text(docRefCode, 72, infoY);

        infoY += 9;
        doc.setFont('helvetica', 'bold'); doc.text('Offer Validity:', 26, infoY);
        doc.setFont('helvetica', 'normal'); doc.text('30 Days from Issue Date', 72, infoY);

        infoY += 9;
        doc.setFont('helvetica', 'bold'); doc.text('Scope Summary:', 26, infoY);
        doc.setFont('helvetica', 'normal'); doc.text(`${activeTotalItems} Active Line Items`, 72, infoY);

        // Add Client Logo on Cover Page inside right side of Document Info card if available
        if (project.clientLogo) {
            try {
                const cLogoData = await getImageData(project.clientLogo, { format: 'image/png', maxWidth: 600 });
                if (cLogoData) {
                    const cFit = calcFitSize(cLogoData.width, cLogoData.height, 44, 22);
                    doc.addImage(cLogoData.dataUrl, 'PNG', pageWidth - 26 - cFit.w, 124 + (22 - cFit.h) / 2, cFit.w, cFit.h);
                }
            } catch (e) { }
        }
        infoY = 152;

        // Draw Project Details Box on Cover Page if settings exist
        if (project.projectName || project.clientName) {
            let projY = infoY + 8;
            doc.setFillColor(...colors.lightBg);
            doc.setDrawColor(...colors.secondary);
            doc.setLineWidth(0.5);
            doc.roundedRect(20, projY, pageWidth - 40, 48, 2, 2, 'FD');

            doc.setFillColor(...colors.primary);
            doc.roundedRect(20, projY, pageWidth - 40, 7.5, 1, 1, 'F');
            doc.setTextColor(...colors.white);
            doc.setFontSize(9.5);
            doc.setFont('helvetica', 'bold');
            doc.text('PROJECT INFORMATION', pageWidth / 2, projY + 5.2, { align: 'center' });

            doc.setTextColor(...colors.text);
            doc.setFontSize(8.5);
            let rowY = projY + 13;
            const leftX = 25;
            const rightX = pageWidth / 2 + 5;
            const rHeight = 6.2;

            const processText = (txt) => (arabicLoaded && hasArabic(txt)) ? fixArabic(txt) : String(txt || '');

            const contractorText = project.includeContractor !== false ? (project.contractor || '—') : '—';
            const consultantText = project.includeConsultant !== false ? (project.consultant || '—') : '—';

            const projRows = [
                ['Project:', project.projectName || '—', 'Client:', project.clientName || '—'],
                ['Project No:', project.projectNumber || '—', 'Location / Zone:', project.locationZone || '—'],
                ['Contractor:', contractorText, 'Consultant:', consultantText],
                ['Site Engineer:', project.siteEngineer || '—', 'Issue Date:', project.issueDate || today],
                ['Revision:', project.revision || '—', '', '']
            ];

            projRows.forEach((r, idx) => {
                const y = rowY + idx * rHeight;
                doc.setFont('helvetica', 'bold'); doc.text(r[0], leftX, y);
                doc.setFont(arabicLoaded && hasArabic(r[1]) ? 'Almarai' : 'helvetica', 'normal');
                doc.text(processText(r[1]), leftX + 24, y, { maxWidth: 56 });

                if (r[2]) {
                    doc.setFont('helvetica', 'bold'); doc.text(r[2], rightX, y);
                    doc.setFont(arabicLoaded && hasArabic(r[3]) ? 'Almarai' : 'helvetica', 'normal');
                    doc.text(processText(r[3]), rightX + 24, y, { maxWidth: 56 });
                }
            });

            infoY = projY + 48; // Shift infoY down for the decorative line
        }

        // Decorative Line
        doc.setDrawColor(...colors.secondary);
        doc.setLineWidth(1.5);
        doc.line(20, infoY + 10, pageWidth - 20, infoY + 10);

        // Footer on Cover
        doc.setFontSize(8.5);
        doc.setTextColor(120, 130, 145);
        const footerText = [profile.companyName, profile.website].filter(Boolean).join('  |  ') || 'BOQ FLOW — Commercial Estimation Suite';
        const isArabicFooter = hasArabic(footerText);
        doc.setFont(isArabicFooter && arabicLoaded ? 'Almarai' : 'helvetica', 'normal');
        doc.text(isArabicFooter ? fixArabic(footerText) : footerText, pageWidth / 2, pageHeight - 14, { align: 'center' });

        // Pre-load logos once for all data pages (headers + project info strips)
        const { headerLogoData: pdfHeaderLogoData, clientLogoData: pdfClientLogoData } = await loadSubmissionLogos();

        // ===== DATA PAGES =====
        for (let tableIndex = 0; tableIndex < sourceTables.length; tableIndex++) {
            const table = sourceTables[tableIndex];
            doc.addPage();

            const sheetTitle = (table.sheetName && !table.sheetName.includes("Combined")) ? table.sheetName : (profile.companyName || 'COMMERCIAL OFFER');

            const drawOfferPageHeader = () => {
                doc.setFillColor(...colors.primary);
                doc.rect(0, 0, pageWidth, 22, 'F');
                doc.setFillColor(...colors.secondary);
                doc.rect(0, 22, pageWidth, 0.9, 'F');

                doc.setTextColor(...colors.white);
                doc.setFontSize(10);
                const titleAr = hasArabic(sheetTitle);
                doc.setFont(titleAr && arabicLoaded ? 'Almarai' : 'helvetica', 'bold');
                doc.text(titleAr ? fixArabic(sheetTitle) : sheetTitle, 8, 11, { maxWidth: pageWidth - 75 });
                doc.setFontSize(7.5);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(220, 228, 238);
                doc.text(`Ref: ${docRefCode}  |  Date: ${today}`, 8, 17.5);

                if (pdfHeaderLogoData) {
                    const fit = calcFitSize(pdfHeaderLogoData.width, pdfHeaderLogoData.height, 48, 15);
                    doc.addImage(pdfHeaderLogoData.dataUrl, 'PNG', pageWidth - 8 - fit.w, (22 - fit.h) / 2, fit.w, fit.h);
                }
            };
            drawOfferPageHeader();

            // Find column indices
            const header = table.header || [];
            let imgColIdx = header.findIndex(h => /\b(image|photo|picture|img|pic|illustration|drawing|sketch)\b/i.test(h) || /\b(image\s*ref|photo\s*ref|pic\s*ref)\b/i.test(h));

            // Robust check: if no "Image" header, find column that actually has images
            if (imgColIdx === -1) {
                for (let i = 0; i < header.length; i++) {
                    const hasImages = table.rows.some(r => r.cells?.[i]?.images?.length > 0 || r.cells?.[i]?.image);
                    if (hasImages) {
                        imgColIdx = i;
                        break;
                    }
                }
            }

            const descColIdx = header.findIndex(h => /description|desc|disc|item|product/i.test(h));
            const snColIdx = header.findIndex(h => /s\.?n|no|#|sr|item|sl/i.test(h));
            const qtyColIdx = header.findIndex(h => /qty|quantity|qt/i.test(h));
            const rateColIdx = header.findIndex(h => /rate|price|unit.*price|unit.*rate/i.test(h));
            const amountColIdx = header.findIndex(h => /amount|total(?!.*(qty|quantity))/i.test(h));
            const brandColIdx = header.findIndex(h => /brand|maker|country|origin/i.test(h));
            const uomColIdx = header.findIndex(h => /uom|unit/i.test(h));

            // Detect currency from amount or rate header (e.g. "Amount OMR" -> "OMR", "Total (USD)" -> "USD")
            let detectedCurrency = 'AED';
            if (amountColIdx !== -1) {
                const headerText = String(header[amountColIdx]);
                const match = headerText.match(/\(([^)]+)\)/) || headerText.match(/([A-Z]{3})/);
                if (match) {
                    detectedCurrency = match[1] || match[0];
                }
            } else if (rateColIdx !== -1) {
                const headerText = String(header[rateColIdx]);
                const match = headerText.match(/\(([^)]+)\)/) || headerText.match(/([A-Z]{3})/);
                if (match) {
                    detectedCurrency = match[1] || match[0];
                }
            }

            // Dynamic column widths - larger for images and descriptions
            const colWidths = {};
            const usableWidth = pageWidth - 10; // 5mm margin each side

            const pdfHeader = [...header];
            pdfHeader.forEach((h, i) => {
                const headerText = arabicLoaded && hasArabic(h) ? fixArabic(h) : h;
                pdfHeader[i] = headerText;

                // Use pdfHeader[i] for calculations if needed, but here we just update it
            });

            pdfHeader.forEach((h, i) => {
                if (i === snColIdx || (i === 0 && snColIdx === -1)) {
                    colWidths[i] = { cellWidth: 11, halign: 'center' };
                } else if (i === imgColIdx) {
                    colWidths[i] = { cellWidth: 32, halign: 'center' };
                } else if (i === descColIdx) {
                    colWidths[i] = { cellWidth: 'auto', halign: 'left' };
                } else if (i === qtyColIdx) {
                    colWidths[i] = { cellWidth: 13, halign: 'center' };
                } else if (i === uomColIdx) {
                    colWidths[i] = { cellWidth: 13, halign: 'center' };
                } else if (i === rateColIdx) {
                    colWidths[i] = { cellWidth: 22, halign: 'right' };
                } else if (i === amountColIdx) {
                    colWidths[i] = { cellWidth: 25, halign: 'right' };
                } else {
                    colWidths[i] = { cellWidth: 'auto' };
                }
            });

            // Pre-load ALL images (including multiple per cell) before drawing table
            const imageDataMap = {};
            if (imgColIdx >= 0) {
                for (let rowIdx = 0; rowIdx < table.rows.length; rowIdx++) {
                    const row = table.rows[rowIdx];
                    const imageCell = row.cells[imgColIdx];
                    const allImages = imageCell?.images || (imageCell?.image ? [imageCell.image] : []);

                    if (allImages.length > 0) {
                        imageDataMap[rowIdx] = [];
                        for (const img of allImages) {
                            const rawImgUrl = extractImageUrl(img);
                            if (rawImgUrl) {
                                try {
                                    const imgResult = await getImageData(getFullUrl(rawImgUrl), { maxWidth: 800, format: 'image/jpeg' });
                                    if (imgResult) imageDataMap[rowIdx].push(imgResult);
                                } catch (e) { }
                            }
                        }
                    }
                }
            }

            // Calculate row heights based on number of images
            const rowHeights = table.rows.map((row, idx) => {
                const imgCount = imageDataMap[idx]?.length || 0;
                if (imgCount === 0) return 10;
                if (imgCount === 1) return 25;
                if (imgCount <= 2) return 25;
                if (imgCount <= 4) return 45;
                return 60; // For 5+ images
            });

            // Construct tableSummary
            const tableSummary = table.summary || (table.extractedSummary ? {
                subtotal: parseFloat(table.extractedSummary.totalAmount).toFixed(2),
                vatPercent: vatRates[tableIndex] !== undefined ? vatRates[tableIndex] : 5,
                vatAmount: (parseFloat(table.extractedSummary.totalAmount) * (vatRates[tableIndex] !== undefined ? vatRates[tableIndex] : 5) / 100).toFixed(2),
                grandTotal: (parseFloat(table.extractedSummary.totalAmount) * (1 + (vatRates[tableIndex] !== undefined ? vatRates[tableIndex] : 5) / 100)).toFixed(2),
                currency: detectedCurrency
            } : null);

            // Format money values cleanly with comma separators
            const fmtMoney = (v) => {
                const n = parseFloat(String(v ?? '').replace(/,/g, ''));
                return Number.isFinite(n)
                    ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : String(v || '0.00');
            };

            // Prepare table data with Offer subheaders (Item wise / Room wise)
            const head = [pdfHeader.map((h, i) => i === imgColIdx ? 'Image' : h)];
            const body = [];
            const bodyRowMeta = [];
            let lastPdfSection = '';

            table.rows.forEach((row, idx) => {
                if (row.sectionLabel && row.sectionLabel !== lastPdfSection && !row.isHeader && !row.isSummary) {
                    lastPdfSection = row.sectionLabel;
                    body.push([{
                        content: (arabicLoaded && hasArabic(row.sectionLabel)) ? fixArabic(row.sectionLabel) : row.sectionLabel,
                        colSpan: header.length || 1,
                        styles: {
                            fillColor: [254, 243, 199],
                            textColor: colors.primary,
                            fontStyle: 'bold',
                            fontSize: 8.5,
                            halign: 'left',
                            cellPadding: 2.2
                        }
                    }]);
                    bodyRowMeta.push({ isSubheader: true, origIdx: -1, rowHeight: 8 });
                }

                body.push(row.cells.map((c, i) => {
                    if (i === imgColIdx) return '';
                    const val = String(c.value ?? '');
                    if ((i === rateColIdx || i === amountColIdx) && val.trim() !== '') {
                        const cleanNum = parseFloat(val.replace(/,/g, ''));
                        if (Number.isFinite(cleanNum)) return fmtMoney(cleanNum);
                    }
                    return (arabicLoaded && hasArabic(val)) ? fixArabic(val) : val;
                }));
                bodyRowMeta.push({ isSubheader: false, origIdx: idx, rowHeight: rowHeights[idx] || 10 });
            });

            // Append summary rows directly to body
            if (tableSummary) {
                const targetColIdx = amountColIdx !== -1 ? amountColIdx : (header.length > 0 ? header.length - 1 : 0);
                const labelColSpan = targetColIdx > 0 ? targetColIdx : 1;

                // Subtotal Row
                const subtotalRow = [];
                subtotalRow.push({
                    content: 'Subtotal:',
                    colSpan: labelColSpan,
                    styles: { halign: 'right', fontStyle: 'bold', fillColor: [241, 245, 249], textColor: colors.primary }
                });
                subtotalRow.push({
                    content: `${fmtMoney(tableSummary.subtotal)} ${tableSummary.currency}`,
                    styles: { halign: 'right', fontStyle: 'bold', fillColor: [241, 245, 249], textColor: colors.primary }
                });
                for (let k = targetColIdx + 1; k < header.length; k++) {
                    subtotalRow.push({ content: '', styles: { fillColor: [241, 245, 249] } });
                }
                body.push(subtotalRow);

                // VAT Row
                const vatRow = [];
                vatRow.push({
                    content: `VAT (${tableSummary.vatPercent}%):`,
                    colSpan: labelColSpan,
                    styles: { halign: 'right', fontStyle: 'bold', fillColor: [241, 245, 249], textColor: colors.primary }
                });
                vatRow.push({
                    content: `${fmtMoney(tableSummary.vatAmount)} ${tableSummary.currency}`,
                    styles: { halign: 'right', fontStyle: 'bold', fillColor: [241, 245, 249], textColor: colors.primary }
                });
                for (let k = targetColIdx + 1; k < header.length; k++) {
                    vatRow.push({ content: '', styles: { fillColor: [241, 245, 249] } });
                }
                body.push(vatRow);

                // Grand Total Row
                const grandTotalRow = [];
                grandTotalRow.push({
                    content: 'GRAND TOTAL:',
                    colSpan: labelColSpan,
                    styles: { halign: 'right', fontStyle: 'bold', fillColor: colors.primary, textColor: [255, 255, 255] }
                });
                grandTotalRow.push({
                    content: `${fmtMoney(tableSummary.grandTotal)} ${tableSummary.currency}`,
                    styles: { halign: 'right', fontStyle: 'bold', fillColor: colors.primary, textColor: [255, 255, 255] }
                });
                for (let k = targetColIdx + 1; k < header.length; k++) {
                    grandTotalRow.push({ content: '', styles: { fillColor: colors.primary } });
                }
                body.push(grandTotalRow);
            }

            // Draw compact Project Info at the top of the sheet (only if project details are filled)
            let startY = 27; // Default start Y for table if no project info

            if (project.projectName || project.clientName) {
                const pY = 26;
                doc.setFillColor(...colors.lightBg);
                doc.setDrawColor(...colors.border);
                doc.setLineWidth(0.3);
                doc.roundedRect(5, pY, pageWidth - 10, 18, 1.5, 1.5, 'FD');

                doc.setFontSize(7);
                doc.setTextColor(...colors.text);

                const processText = (txt) => (arabicLoaded && hasArabic(txt)) ? fixArabic(txt) : String(txt || '');
                const contractorText = project.includeContractor !== false ? (project.contractor || '—') : '—';
                const consultantText = project.includeConsultant !== false ? (project.consultant || '—') : '—';

                const pRows = [
                    ['Project:', project.projectName || '—', 'Client:', project.clientName || '—'],
                    ['Proj No:', project.projectNumber || '—', 'Location:', project.locationZone || '—'],
                    ['Contractor:', contractorText, 'Consultant:', consultantText],
                ];

                pRows.forEach((r, i) => {
                    const y = pY + 4.8 + i * 4.4;
                    doc.setFont('helvetica', 'bold'); doc.text(r[0], 8, y);
                    doc.setFont(arabicLoaded && hasArabic(r[1]) ? 'Almarai' : 'helvetica', 'normal');
                    doc.text(processText(r[1]), 24, y, { maxWidth: 68 });
                    doc.setFont('helvetica', 'bold'); doc.text(r[2], pageWidth / 2 + 2, y);
                    doc.setFont(arabicLoaded && hasArabic(r[3]) ? 'Almarai' : 'helvetica', 'normal');
                    doc.text(processText(r[3]), pageWidth / 2 + 20, y, { maxWidth: pdfClientLogoData ? 48 : 72 });
                });

                if (pdfClientLogoData) {
                    const cFit = calcFitSize(pdfClientLogoData.width, pdfClientLogoData.height, 24, 12);
                    doc.addImage(pdfClientLogoData.dataUrl, 'PNG', pageWidth - 8 - cFit.w, pY + 3, cFit.w, cFit.h);
                }

                startY = 47; // Push table start Y down to clear the project info block
            }

            autoTable(doc, {
                head: head,
                body: body,
                startY: startY,
                margin: { top: 27, bottom: 15, left: 5, right: 5 },
                theme: 'grid',
                styles: {
                    fontSize: 7.2,
                    cellPadding: 2,
                    lineColor: [216, 222, 232],
                    lineWidth: 0.25,
                    textColor: colors.text,
                    overflow: 'linebreak',
                    font: arabicLoaded ? 'Almarai' : 'helvetica',
                    valign: 'middle'
                },
                headStyles: {
                    fillColor: colors.primary,
                    textColor: colors.white,
                    fontStyle: 'bold',
                    halign: 'center',
                    fontSize: 8,
                    font: arabicLoaded ? 'Almarai' : 'helvetica',
                    cellPadding: 2,
                    minCellHeight: 8
                },
                alternateRowStyles: {
                    fillColor: [248, 250, 252]
                },
                columnStyles: colWidths,
                didParseCell: (data) => {
                    // Set dynamic row height based on image count
                    if (data.section === 'body') {
                        const isSummaryRow = tableSummary && data.row.index >= body.length - 3;
                        const rowMeta = bodyRowMeta[data.row.index];
                        if (isSummaryRow || !rowMeta || rowMeta.isSubheader) {
                            data.cell.styles.minCellHeight = 8;
                            return;
                        }
                        data.cell.styles.minCellHeight = rowMeta.rowHeight || 10;
                    }
                },
                didDrawCell: (data) => {
                    const isSummaryRow = tableSummary && data.row.index >= body.length - 3;
                    const rowMeta = bodyRowMeta[data.row.index];
                    if (isSummaryRow || !rowMeta || rowMeta.isSubheader) return;

                    // Draw multiple images in a grid layout
                    if (imgColIdx >= 0 && data.column.index === imgColIdx && data.section === 'body') {
                        const images = imageDataMap[rowMeta.origIdx];
                        if (images && images.length > 0) {
                            const cellW = data.cell.width - 2;
                            const cellH = data.cell.height - 2;
                            const cellX = data.cell.x + 1;
                            const cellY = data.cell.y + 1;

                            if (images.length === 1) {
                                // Single image - center it
                                const img = images[0];
                                const fit = calcFitSize(img.width, img.height, cellW, cellH);
                                const x = cellX + (cellW - fit.w) / 2;
                                const y = cellY + (cellH - fit.h) / 2;
                                doc.addImage(img.dataUrl, 'JPEG', x, y, fit.w, fit.h, '', 'FAST');
                            } else {
                                // Multiple images - grid layout
                                const cols = images.length <= 2 ? 2 : 2;
                                const rows = Math.ceil(images.length / cols);
                                const imgW = (cellW - (cols - 1) * 1) / cols;
                                const imgH = (cellH - (rows - 1) * 1) / rows;

                                images.forEach((img, idx) => {
                                    const col = idx % cols;
                                    const row = Math.floor(idx / cols);
                                    const x = cellX + col * (imgW + 1);
                                    const y = cellY + row * (imgH + 1);
                                    const fit = calcFitSize(img.width, img.height, imgW, imgH);
                                    const centeredX = x + (imgW - fit.w) / 2;
                                    const centeredY = y + (imgH - fit.h) / 2;
                                    doc.addImage(img.dataUrl, 'JPEG', centeredX, centeredY, fit.w, fit.h, '', 'FAST');
                                });
                            }
                        }
                    }
                },
                didDrawPage: (data) => {
                    // Draw branded header banner on continuation pages too
                    if (data.pageNumber > 1) {
                        drawOfferPageHeader();
                    }
                }
            });


        }

        // Executive Commercial Terms & Sign-Off Block at end of Offer PDF
        let termsY = (doc.lastAutoTable?.finalY || 120) + 12;
        if (termsY + 48 > pageHeight - 16) {
            doc.addPage();
            doc.setFillColor(...colors.primary);
            doc.rect(0, 0, pageWidth, 22, 'F');
            doc.setFillColor(...colors.secondary);
            doc.rect(0, 22, pageWidth, 0.9, 'F');
            doc.setTextColor(...colors.white);
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.text('COMMERCIAL TERMS & ACCEPTANCE', 8, 13.5);
            if (pdfHeaderLogoData) {
                const fit = calcFitSize(pdfHeaderLogoData.width, pdfHeaderLogoData.height, 48, 15);
                doc.addImage(pdfHeaderLogoData.dataUrl, 'PNG', pageWidth - 8 - fit.w, (22 - fit.h) / 2, fit.w, fit.h);
            }
            termsY = 32;
        }

        doc.setFillColor(...colors.lightBg);
        doc.setDrawColor(...colors.border);
        doc.setLineWidth(0.3);
        doc.roundedRect(10, termsY, pageWidth - 20, 22, 1.5, 1.5, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...colors.primary);
        doc.text('COMMERCIAL NOTES & VALIDITY', 14, termsY + 5.5);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.2);
        doc.setTextColor(...colors.text);
        doc.text('1. This commercial offer is valid for 30 days from issue date and subject to final site verification and finish confirmation.', 14, termsY + 11);
        doc.text('2. Manufacturing warranty applies as per manufacturer terms (standard 5 years on commercial contract furniture).', 14, termsY + 16);

        const sigLineY = termsY + 42;
        doc.setDrawColor(...colors.border);
        doc.setLineWidth(0.35);
        doc.line(14, sigLineY, 86, sigLineY);
        doc.line(pageWidth - 86, sigLineY, pageWidth - 14, sigLineY);
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...colors.primary);
        doc.text(`Authorized Signatory — ${companyName || 'Supplier'}`, 14, sigLineY + 4.5);
        doc.text('Client Acceptance (Signature, Stamp & Date)', pageWidth - 86, sigLineY + 4.5);

        // Stamp crisp "Page X of Y" + branded footer on all data pages (skip Cover Page 1)
        const totalPdfPages = doc.internal.getNumberOfPages();
        const fText = [profile.companyName, profile.website].filter(Boolean).join('  |  ');
        const isArFooter = hasArabic(fText);
        for (let p = 2; p <= totalPdfPages; p++) {
            doc.setPage(p);
            doc.setDrawColor(...colors.secondary);
            doc.setLineWidth(0.5);
            doc.line(0, pageHeight - 12, pageWidth, pageHeight - 12);
            doc.setFontSize(7.5);
            doc.setTextColor(120, 130, 145);
            doc.setFont('helvetica', 'normal');
            doc.text(`Page ${p - 1} of ${totalPdfPages - 1}`, 8, pageHeight - 6.5);
            if (fText) {
                doc.setFont(isArFooter && arabicLoaded ? 'Almarai' : 'helvetica', 'normal');
                doc.text(isArFooter ? fixArabic(fText) : fText, pageWidth - 8, pageHeight - 6.5, { align: 'right' });
            }
        }

        doc.save(`${filename}.pdf`);
    };

    // ===================== PREMIUM EXCEL EXPORT =====================
    const handleDownloadExcel = async (sourceTables, filename) => {
        const ExcelJS = await import('exceljs');
        const workbook = new ExcelJS.Workbook();

        workbook.creator = 'BOQFlow';
        workbook.created = new Date();

        const writeCostingFactorsToRight = (ws, startCol, factors) => {
            const row = ws.getRow(1);

            row.getCell(startCol).value = 'Costing Factors:';
            row.getCell(startCol).font = { bold: true, size: 10, color: { argb: 'F59E0B' } };
            row.getCell(startCol).alignment = { vertical: 'middle', horizontal: 'left' };

            const labelFont = { bold: true, size: 9, color: { argb: '475569' } };

            const applyInputStyle = (cell, isPercent) => {
                cell.font = { bold: true, size: 10, color: { argb: '0F172A' } };
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FEF3C7' } // Light yellow/gold background to show it's editable
                };
                cell.border = {
                    top: { style: 'thin', color: { argb: 'F59E0B' } },
                    bottom: { style: 'thin', color: { argb: 'F59E0B' } },
                    left: { style: 'thin', color: { argb: 'F59E0B' } },
                    right: { style: 'thin', color: { argb: 'F59E0B' } }
                };
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
                cell.numFmt = isPercent ? '0%' : '0.00';
            };

            row.getCell(startCol + 1).value = 'Profit:';
            row.getCell(startCol + 1).font = labelFont;
            row.getCell(startCol + 1).alignment = { vertical: 'middle', horizontal: 'right' };

            const profitCell = row.getCell(startCol + 2);
            profitCell.value = factors.profit / 100;
            applyInputStyle(profitCell, true);

            row.getCell(startCol + 3).value = 'Freight:';
            row.getCell(startCol + 3).font = labelFont;
            row.getCell(startCol + 3).alignment = { vertical: 'middle', horizontal: 'right' };

            const freightCell = row.getCell(startCol + 4);
            freightCell.value = factors.freight / 100;
            applyInputStyle(freightCell, true);

            row.getCell(startCol + 5).value = 'Customs:';
            row.getCell(startCol + 5).font = labelFont;
            row.getCell(startCol + 5).alignment = { vertical: 'middle', horizontal: 'right' };

            const customsCell = row.getCell(startCol + 6);
            customsCell.value = factors.customs / 100;
            applyInputStyle(customsCell, true);

            row.getCell(startCol + 7).value = 'Installation:';
            row.getCell(startCol + 7).font = labelFont;
            row.getCell(startCol + 7).alignment = { vertical: 'middle', horizontal: 'right' };

            const installCell = row.getCell(startCol + 8);
            installCell.value = factors.installation / 100;
            applyInputStyle(installCell, true);

            row.getCell(startCol + 9).value = 'Exchange Rate:';
            row.getCell(startCol + 9).font = labelFont;
            row.getCell(startCol + 9).alignment = { vertical: 'middle', horizontal: 'right' };

            const exrateCell = row.getCell(startCol + 10);
            exrateCell.value = factors.exchangeRate;
            applyInputStyle(exrateCell, false);
        };

        const parseToArgb = (colorStr, defaultHex) => {
            if (!colorStr) return defaultHex;
            let hex = defaultHex;
            if (colorStr.startsWith('#')) {
                hex = colorStr.replace('#', '').toUpperCase();
            } else if (colorStr.startsWith('rgb')) {
                const match = colorStr.match(/\d+/g);
                if (match && match.length >= 3) {
                    const r = parseInt(match[0]).toString(16).padStart(2, '0');
                    const g = parseInt(match[1]).toString(16).padStart(2, '0');
                    const b = parseInt(match[2]).toString(16).padStart(2, '0');
                    hex = (r + g + b).toUpperCase();
                }
            }
            if (hex === '3B82F6' || hex === '1E5FA8' || hex === '2563EB') {
                return '0F3E67';
            }
            return hex;
        };

        const primaryArgb = parseToArgb(accentColor, '1E293B');
        const secondaryArgb = parseToArgb(secondaryColor, 'F59E0B');

        const getColLetter = (idx) => {
            let letter = '';
            let temp = idx;
            while (temp >= 0) {
                letter = String.fromCharCode((temp % 26) + 65) + letter;
                temp = Math.floor(temp / 26) - 1;
            }
            return letter;
        };

        const excelCompanyLogo = logoOriginal || logoWhite;
        const excelCompanyLogoData = excelCompanyLogo
            ? await getImageData(excelCompanyLogo, { maxWidth: 500, format: 'image/png' }).catch(() => null)
            : null;
        const usedSheetNames = new Set();

        for (let tableIndex = 0; tableIndex < sourceTables.length; tableIndex++) {
            const table = sourceTables[tableIndex];
            let safeSheetName = String(table.sheetName || `BOQ Schedule ${tableIndex + 1}`)
                .replace(/[\\/*?:[\]]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 28) || `BOQ_${tableIndex + 1}`;
            if (usedSheetNames.has(safeSheetName.toLowerCase())) {
                safeSheetName = `${safeSheetName.slice(0, 24)}_${tableIndex + 1}`;
            }
            usedSheetNames.add(safeSheetName.toLowerCase());

            const ws = workbook.addWorksheet(safeSheetName, {
                properties: { tabColor: { argb: secondaryArgb } }
            });
            let costingRowNum = null;
            const excelCostingFactors = costingFactors || {
                profit: 0,
                freight: 0,
                customs: 0,
                installation: 0,
                exchangeRate: 1
            };
            // Live costing formulas only when exporting the originals (or originals costed here).
            // An applied VE / Multi-Budget offer is already costed and has a different column
            // layout from the originals, so its rates are exported as fixed values.
            const hasCosting = !appliedOffer;

            const header = table.header || [];
            let imgColIdx = header.findIndex(h => /\b(image|photo|picture|img|pic|illustration|drawing|sketch)\b/i.test(h) || /\b(image\s*ref|photo\s*ref|pic\s*ref)\b/i.test(h));

            // Robust check: if no "Image" header, find column that actually has images
            if (imgColIdx === -1) {
                for (let i = 0; i < header.length; i++) {
                    const hasImages = table.rows.some(r => r.cells?.[i]?.images?.length > 0 || r.cells?.[i]?.image);
                    if (hasImages) {
                        imgColIdx = i;
                        break;
                    }
                }
            }

            const cleanHeader = header.map(h => String(h || '').replace(/\s+/g, ' ').trim());
            const descColIdx = cleanHeader.findIndex(h => /description|desc|disc|item|product/i.test(h));
            const amountColIdx = cleanHeader.findIndex(h => /amount|total(?!.*(qty|quantity))/i.test(h));
            const rateColIdx = cleanHeader.findIndex(h => /rate|price|unit.*price|unit.*rate/i.test(h));
            const qtyColIdx = cleanHeader.findIndex(h => /qty|quantity|qt/i.test(h));

            // Detect currency from amount or rate header (e.g. "Amount OMR" -> "OMR", "Total (USD)" -> "USD")
            let detectedCurrency = 'AED';
            if (amountColIdx !== -1) {
                const headerText = String(header[amountColIdx]);
                const match = headerText.match(/\(([^)]+)\)/) || headerText.match(/([A-Z]{3})/);
                if (match) {
                    detectedCurrency = match[1] || match[0];
                }
            } else if (rateColIdx !== -1) {
                const headerText = String(header[rateColIdx]);
                const match = headerText.match(/\(([^)]+)\)/) || headerText.match(/([A-Z]{3})/);
                if (match) {
                    detectedCurrency = match[1] || match[0];
                }
            }

            const hasArInHeader = header.some(h => hasArabic(h));
            const hasArInBody = table.rows.some(r => r.cells.some(c => hasArabic(c.value)));
            const isRtlSheet = hasArInHeader || hasArInBody;

            // Determine offsets and insert branded banner + optional project details dynamically
            let startRowOffset = 0;
            const hasProjectInfo = !!(project.projectName || project.clientName || project.projectNumber);
            const bannerSpan = Math.max(header.length, 5);

            // Row 1: Always render a clean branded offer banner (with company logo if available)
            const titleRow = ws.addRow([`COMMERCIAL OFFER — ${table.sheetName || companyName || 'BOQ Schedule'}`]);
            ws.mergeCells(1, 1, 1, bannerSpan);
            ws.getRow(1).height = 30;
            const bannerCell = titleRow.getCell(1);
            bannerCell.font = { name: 'Calibri', bold: true, size: 14, color: { argb: 'FFFFFF' } };
            bannerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: primaryArgb } };
            bannerCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

            if (hasProjectInfo) {
                // Row 2: Section Header
                const secRow = ws.addRow(['PROJECT INFORMATION']);
                secRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
                secRow.getCell(1).font = { bold: true, color: { argb: primaryArgb }, size: 10 };
                secRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
                ws.mergeCells(2, 1, 2, bannerSpan);
                ws.getRow(2).height = 20;

                // Rows 3-6: Project details
                const contractorText = project.includeContractor !== false ? (project.contractor || '—') : '—';
                const consultantText = project.includeConsultant !== false ? (project.consultant || '—') : '—';

                const detailsRows = [
                    ['Project:', project.projectName || '—', '', 'Client:', project.clientName || '—'],
                    ['Project No:', project.projectNumber || '—', '', 'Location / Zone:', project.locationZone || '—'],
                    ['Contractor:', contractorText, '', 'Consultant:', consultantText],
                    ['Site Engineer:', project.siteEngineer || '—', '', 'Issue Date:', project.issueDate || new Date().toLocaleDateString('en-GB')]
                ];

                detailsRows.forEach((rowVals, idx) => {
                    const rNum = idx + 3;
                    const rowObj = ws.getRow(rNum);
                    rowObj.values = rowVals;
                    rowObj.height = 19;

                    const cellA = rowObj.getCell(1);
                    const cellB = rowObj.getCell(2);
                    const cellD = rowObj.getCell(4);
                    const cellE = rowObj.getCell(5);

                    cellA.font = { bold: true, size: 9.5, color: { argb: '475569' } };
                    cellD.font = { bold: true, size: 9.5, color: { argb: '475569' } };
                    cellB.font = { size: 9.5, color: { argb: '0F172A' } };
                    cellE.font = { size: 9.5, color: { argb: '0F172A' } };

                    [cellA, cellB, cellD, cellE].forEach(c => {
                        c.alignment = { vertical: 'middle' };
                    });

                    ws.mergeCells(rNum, 2, rNum, 3);
                    ws.mergeCells(rNum, 5, rNum, bannerSpan);
                    for (let col = 1; col <= bannerSpan; col++) {
                        rowObj.getCell(col).border = {
                            top: { style: 'thin', color: { argb: 'E2E8F0' } },
                            bottom: { style: 'thin', color: { argb: 'E2E8F0' } },
                            left: { style: 'thin', color: { argb: 'E2E8F0' } },
                            right: { style: 'thin', color: { argb: 'E2E8F0' } }
                        };
                    }
                });

                // Add gap row after project details
                ws.addRow([]); // Row 7 is gap row
                ws.getRow(7).height = 10;
                startRowOffset = 7;

                // Add Client Logo if available (or Company Logo)
                const bannerLogo = project.clientLogo
                    ? await getImageData(project.clientLogo, { maxWidth: 300, format: 'image/png' }).catch(() => null)
                    : excelCompanyLogoData;
                if (bannerLogo) {
                    try {
                        const cImageId = workbook.addImage({
                            base64: bannerLogo.dataUrl.split(',')[1],
                            extension: 'png'
                        });
                        const logoCol = Math.max(header.length - 1, 4);
                        const fit = calcFitSize(bannerLogo.width, bannerLogo.height, 90, 32);
                        ws.addImage(cImageId, {
                            tl: { col: logoCol + 0.1, row: 0.1 },
                            ext: { width: fit.w, height: fit.h }
                        });
                    } catch (e) { }
                }
            } else {
                // Subtitle row with date + gap row
                const subRow = ws.addRow([`${companyName || 'BOQFLOW'}  |  Generated: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`]);
                ws.mergeCells(2, 1, 2, bannerSpan);
                ws.getRow(2).height = 18;
                subRow.getCell(1).font = { italic: true, size: 9.5, color: { argb: '64748B' } };
                subRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
                ws.addRow([]);
                ws.getRow(3).height = 8;
                startRowOffset = 3;

                if (excelCompanyLogoData) {
                    try {
                        const logoId = workbook.addImage({
                            base64: excelCompanyLogoData.dataUrl.split(',')[1],
                            extension: 'png'
                        });
                        const logoCol = Math.max(header.length - 1, 4);
                        const fit = calcFitSize(excelCompanyLogoData.width, excelCompanyLogoData.height, 90, 32);
                        ws.addImage(logoId, {
                            tl: { col: logoCol + 0.1, row: 0.08 },
                            ext: { width: fit.w, height: fit.h }
                        });
                    } catch (e) { }
                }
            }

            // Always write costing factors exactly beside the table columns (1 empty column gap)
            const startCol = header.length + 2;
            if (hasCosting) writeCostingFactorsToRight(ws, startCol, excelCostingFactors);

            // Add header row
            if (header.length > 0) {
                const headerRow = ws.addRow(header);
                headerRow.height = 25;
                headerRow.eachCell((cell) => {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: primaryArgb } };
                    cell.font = { color: { argb: 'FFFFFF' }, bold: true, size: 11 };
                    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
                    cell.border = {
                        top: { style: 'thin', color: { argb: '334155' } },
                        bottom: { style: 'thin', color: { argb: '334155' } },
                        left: { style: 'thin', color: { argb: '334155' } },
                        right: { style: 'thin', color: { argb: '334155' } }
                    };
                });
            }

            // Pre-load ALL images (multiple per cell) for Excel
            const imageDataByRow = {};
            if (imgColIdx >= 0) {
                for (let rowIdx = 0; rowIdx < table.rows.length; rowIdx++) {
                    const row = table.rows[rowIdx];
                    const imageCell = row.cells[imgColIdx];
                    const allImages = imageCell?.images || (imageCell?.image ? [imageCell.image] : []);

                    if (allImages.length > 0) {
                        imageDataByRow[rowIdx] = [];
                        for (const img of allImages) {
                            const rawImgUrl = extractImageUrl(img);
                            if (rawImgUrl) {
                                try {
                                    const imgResult = await getImageData(getFullUrl(rawImgUrl), { maxWidth: 800, format: 'image/jpeg', quality: 0.95 });
                                    if (imgResult) {
                                        const base64 = imgResult.dataUrl.split(',')[1];
                                        const imageId = workbook.addImage({
                                            base64: base64,
                                            extension: 'jpeg'
                                        });
                                        imageDataByRow[rowIdx].push({
                                            imageId,
                                            width: imgResult.width,
                                            height: imgResult.height
                                        });
                                    }
                                } catch (e) { }
                            }
                        }
                    }
                }
            }

            const maxImages = Math.max(...Object.values(imageDataByRow).map(arr => arr?.length || 0), 1);
            let lastExcelSection = '';
            let firstDataExcelRow = null;
            let lastDataExcelRow = null;

            table.rows.forEach((row, rowIndex) => {
                if (row.sectionLabel && row.sectionLabel !== lastExcelSection && !row.isHeader && !row.isSummary) {
                    lastExcelSection = row.sectionLabel;
                    const secRow = ws.addRow([row.sectionLabel]);
                    secRow.height = 22;
                    ws.mergeCells(secRow.number, 1, secRow.number, Math.max(header.length, 1));
                    const secCell = secRow.getCell(1);
                    secCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF3C7' } };
                    secCell.font = { bold: true, size: 11, color: { argb: primaryArgb } };
                    secCell.alignment = { vertical: 'middle', horizontal: 'left' };
                    secCell.border = {
                        top: { style: 'thin', color: { argb: secondaryArgb } },
                        bottom: { style: 'thin', color: { argb: secondaryArgb } }
                    };
                }

                const rowData = row.cells.map((c, i) => {
                    if (i === imgColIdx) return ''; // Clear image column text
                    const valStr = String(c && c.value !== undefined ? c.value : '').trim();
                    if (isNonTotalRow(row) && i === amountColIdx) {
                        return valStr || (row.isOptionRow ? 'Optional' : 'Included');
                    }
                    if (i === rateColIdx || i === amountColIdx || i === qtyColIdx) {
                        const cleanVal = valStr.replace(/[^0-9.-]/g, '');
                        const num = parseFloat(cleanVal);
                        return isNaN(num) ? valStr : num;
                    }
                    return c ? c.value : '';
                });
                const dataRow = ws.addRow(rowData);
                if (firstDataExcelRow === null) firstDataExcelRow = dataRow.number;
                lastDataExcelRow = dataRow.number;

                // Calculate row height based on BOTH embedded images and wrapped description text (prevents text clipping!)
                const imgCount = imageDataByRow[rowIndex]?.length || 0;
                let imgHeight = 22;
                if (imgCount === 1 || imgCount === 2) imgHeight = 62;
                else if (imgCount <= 4) imgHeight = 114;
                else if (imgCount > 4) imgHeight = 165;

                const descValStr = descColIdx >= 0 ? String(rowData[descColIdx] || '') : '';
                const wrappedLines = descValStr
                    ? descValStr.split('\n').reduce((acc, line) => acc + Math.max(1, Math.ceil(line.length / 44)), 0)
                    : 1;
                const textHeight = Math.min(220, Math.max(22, wrappedLines * 14.5 + 8));
                const rowHeight = Math.max(imgHeight, textHeight);
                dataRow.height = rowHeight;

                const isEven = rowIndex % 2 === 0;
                dataRow.eachCell((cell, colNumber) => {
                    const colIdx = colNumber - 1;
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isEven ? 'F8FAFC' : 'FFFFFF' } };
                    cell.font = { name: 'Calibri', color: { argb: '1E293B' }, size: 10 };
                    cell.alignment = { vertical: 'middle', wrapText: true };
                    cell.border = {
                        top: { style: 'thin', color: { argb: 'E2E8F0' } },
                        bottom: { style: 'thin', color: { argb: 'E2E8F0' } },
                        left: { style: 'thin', color: { argb: 'E2E8F0' } },
                        right: { style: 'thin', color: { argb: 'E2E8F0' } }
                    };

                    if (colIdx === qtyColIdx) {
                        cell.alignment = { horizontal: 'center', vertical: 'middle' };
                        cell.numFmt = '#,##0';
                    } else if (colIdx === rateColIdx || colIdx === amountColIdx) {
                        cell.alignment = { horizontal: 'right', vertical: 'middle' };
                        cell.numFmt = '#,##0.00';
                    }
                });

                const excelRow = dataRow.number; // Exact Excel row number accounting for inserted subheaders

                const hasQtyCol = qtyColIdx !== -1;
                const hasRateCol = rateColIdx !== -1;
                const hasAmountCol = amountColIdx !== -1;

                const qtyVal = hasQtyCol ? rowData[qtyColIdx] : null;
                const rateVal = hasRateCol ? rowData[rateColIdx] : null;
                const amountVal = hasAmountCol ? rowData[amountColIdx] : null;

                const isRateNumeric = hasRateCol && typeof rateVal === 'number';
                const isAmountNumeric = hasAmountCol && typeof amountVal === 'number';

                const qtyLetter = hasQtyCol ? getColLetter(qtyColIdx) : '';
                const rateLetter = hasRateCol ? getColLetter(rateColIdx) : '';

                if (hasCosting && isRateNumeric) {
                    let originalPrice = rateVal;
                    // Base price must come from the matching original row/column (same table layout)
                    const originalRow = (tables[tableIndex]?.header || []).length === header.length
                        ? tables[tableIndex]?.rows[rowIndex]
                        : null;
                    const originalRateCell = originalRow?.cells[rateColIdx];
                    if (originalRateCell && originalRateCell.value !== undefined) {
                        const origValStr = String(originalRateCell.value).trim();
                        const cleanOrigVal = origValStr.replace(/[^0-9.-]/g, '');
                        const parsedOrigPrice = parseFloat(cleanOrigVal);
                        if (!isNaN(parsedOrigPrice)) {
                            originalPrice = parsedOrigPrice;
                        }
                    }

                    const startCol = header.length + 2;
                    const profitColLetter = getColLetter(startCol + 2 - 1);
                    const freightColLetter = getColLetter(startCol + 4 - 1);
                    const customsColLetter = getColLetter(startCol + 6 - 1);
                    const installColLetter = getColLetter(startCol + 8 - 1);
                    const exrateColLetter = getColLetter(startCol + 10 - 1);

                    const rateCell = dataRow.getCell(rateColIdx + 1);
                    rateCell.value = {
                        formula: `${originalPrice}*$${exrateColLetter}$1*(1+$${profitColLetter}$1+$${freightColLetter}$1+$${customsColLetter}$1+$${installColLetter}$1)`,
                        result: rateVal
                    };
                }

                if (!isNonTotalRow(row) && isAmountNumeric && hasQtyCol && hasRateCol) {
                    const amountCell = dataRow.getCell(amountColIdx + 1);
                    amountCell.value = {
                        formula: `${qtyLetter}${excelRow}*${rateLetter}${excelRow}`,
                        result: amountVal
                    };
                }

                // Add multiple images to cell in grid layout
                if (imgColIdx >= 0 && imageDataByRow[rowIndex]?.length > 0) {
                    const images = imageDataByRow[rowIndex];
                    const baseImgSize = 50;

                    if (images.length === 1) {
                        // Single image - centered with aspect ratio preservation
                        const imgData = images[0];
                        const fit = calcFitSize(imgData.width, imgData.height, baseImgSize, baseImgSize);

                        const colWidthChars = maxImages > 1 ? 24 : 16;
                        const colWidthPx = colWidthChars * 7.5;
                        const colOffset = Math.max(0, (colWidthPx - fit.w) / 2) / colWidthPx;
                        const fitHPoints = fit.h * 0.75;
                        const rowOffset = Math.max(0, (rowHeight - fitHPoints) / 2) / rowHeight;

                        ws.addImage(imgData.imageId, {
                            tl: { col: imgColIdx + colOffset, row: excelRow - 1 + rowOffset },
                            ext: { width: fit.w, height: fit.h },
                            editAs: 'oneCell'
                        });
                    } else {
                        // Multiple images - grid layout (2 columns)
                        const cols = 2;
                        const imgSize = baseImgSize * 0.9; // Slightly smaller for grid

                        images.forEach((imgData, idx) => {
                            const col = idx % cols;
                            const gridRow = Math.floor(idx / cols);
                            const fit = calcFitSize(imgData.width, imgData.height, imgSize, imgSize);
                            const offsetCol = imgColIdx + (col * 0.5) + (0.5 - fit.w / baseImgSize) / 2 + 0.03;
                            const offsetRow = excelRow - 1 + (gridRow * 0.95) + (0.95 - fit.h / rowHeight) / 2 + 0.03;

                            ws.addImage(imgData.imageId, {
                                tl: { col: offsetCol, row: offsetRow },
                                ext: { width: fit.w, height: fit.h },
                                editAs: 'oneCell'
                            });
                        });
                    }
                }
            });

            // Set column widths - wider for image column with multiple images
            ws.columns.forEach((column, i) => {
                if (i === imgColIdx) {
                    // Calculate max images in any row to determine column width
                    const maxImages = Math.max(...Object.values(imageDataByRow).map(arr => arr?.length || 0), 1);
                    column.width = maxImages > 1 ? 24 : 16;
                } else if (i === descColIdx) {
                    column.width = 48; // Wider for descriptions
                } else if (i === amountColIdx || i === rateColIdx) {
                    column.width = 18; // Money columns: wide enough for totals (avoids ####)
                } else {
                    let maxLength = 12;
                    column.eachCell({ includeEmpty: true }, (cell) => {
                        if (cell.row.number > startRowOffset) {
                            let cellLength = 0;
                            if (cell.value) {
                                if (typeof cell.value === 'object' && cell.value.formula) {
                                    cellLength = cell.value.result ? String(cell.value.result).length : 10;
                                } else {
                                    cellLength = String(cell.value).length;
                                }
                            }
                            if (cellLength > maxLength) maxLength = cellLength;
                        }
                    });
                    column.width = Math.min(maxLength + 2, 50);
                }
            });

            ws.views = [{ state: 'frozen', ySplit: startRowOffset + 1, rightToLeft: isRtlSheet }];

            // Construct tableSummary
            const tableSummary = table.summary || (table.extractedSummary ? {
                subtotal: parseFloat(table.extractedSummary.totalAmount).toFixed(2),
                vatPercent: vatRates[tableIndex] !== undefined ? vatRates[tableIndex] : 5,
                vatAmount: (parseFloat(table.extractedSummary.totalAmount) * (vatRates[tableIndex] !== undefined ? vatRates[tableIndex] : 5) / 100).toFixed(2),
                grandTotal: (parseFloat(table.extractedSummary.totalAmount) * (1 + (vatRates[tableIndex] !== undefined ? vatRates[tableIndex] : 5) / 100)).toFixed(2),
                currency: detectedCurrency
            } : null);

            const firstDataRow = firstDataExcelRow || (startRowOffset + 2);
            const lastDataRow = lastDataExcelRow || (startRowOffset + 1 + table.rows.length);

            if (tableSummary) {
                ws.addRow([]); // Gap row at lastDataRow + 1

                const amountLetter = getColLetter(amountColIdx !== -1 ? amountColIdx : header.length - 1);
                const valColNum = amountColIdx !== -1 ? amountColIdx + 1 : header.length;
                const labelColNum = valColNum - 1 > 0 ? valColNum - 1 : 1;

                const currencyFmt = `#,##0.00 "${tableSummary.currency}"`;
                const labelFont = { bold: true, size: 10, color: { argb: '334155' } };
                const valFont = { bold: true, size: 10, color: { argb: '334155' } };

                // Row 1: Subtotal
                const subtotalRowNum = lastDataRow + 2;
                const subtotalRow = ws.addRow([]);
                subtotalRow.height = 20;
                subtotalRow.getCell(labelColNum).value = 'Subtotal:';
                subtotalRow.getCell(valColNum).value = {
                    formula: `SUM(${amountLetter}${firstDataRow}:${amountLetter}${lastDataRow})`,
                    result: parseFloat(tableSummary.subtotal)
                };
                subtotalRow.getCell(labelColNum).font = labelFont;
                subtotalRow.getCell(valColNum).font = valFont;
                subtotalRow.getCell(valColNum).numFmt = currencyFmt;
                subtotalRow.getCell(labelColNum).alignment = { horizontal: 'right', vertical: 'middle' };
                subtotalRow.getCell(valColNum).alignment = { horizontal: 'right', vertical: 'middle' };

                // Row 2: VAT
                const vatRowNum = lastDataRow + 3;
                const vatRow = ws.addRow([]);
                vatRow.height = 20;
                vatRow.getCell(labelColNum).value = `VAT (${tableSummary.vatPercent}%):`;
                vatRow.getCell(valColNum).value = {
                    formula: `${amountLetter}${subtotalRowNum}*${tableSummary.vatPercent}/100`,
                    result: parseFloat(tableSummary.vatAmount)
                };
                vatRow.getCell(labelColNum).font = labelFont;
                vatRow.getCell(valColNum).font = valFont;
                vatRow.getCell(valColNum).numFmt = currencyFmt;
                vatRow.getCell(labelColNum).alignment = { horizontal: 'right', vertical: 'middle' };
                vatRow.getCell(valColNum).alignment = { horizontal: 'right', vertical: 'middle' };

                // Row 3: Grand Total
                const totalRow = ws.addRow([]);
                totalRow.height = 24;
                totalRow.getCell(labelColNum).value = 'GRAND TOTAL:';
                totalRow.getCell(valColNum).value = {
                    formula: `${amountLetter}${subtotalRowNum}+${amountLetter}${vatRowNum}`,
                    result: parseFloat(tableSummary.grandTotal)
                };

                const totalLabelCell = totalRow.getCell(labelColNum);
                const totalValueCell = totalRow.getCell(valColNum);

                [totalLabelCell, totalValueCell].forEach(cell => {
                    cell.font = { bold: true, size: 12, color: { argb: 'FFFFFF' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: primaryArgb } };
                    cell.alignment = { horizontal: cell === totalValueCell ? 'right' : 'left', vertical: 'middle' };
                    cell.border = {
                        top: { style: 'medium', color: { argb: secondaryArgb } },
                        bottom: { style: 'medium', color: { argb: secondaryArgb } }
                    };
                });
                totalValueCell.numFmt = currencyFmt;

                // Add Website Footer
                ws.addRow([]);
                const footerRow = ws.addRow([]);
                const footerParts = [profile.companyName || 'BOQFLOW', profile.website].filter(Boolean);
                footerRow.getCell(1).value = `Generated by ${footerParts.join('  |  ')}`;
                footerRow.getCell(1).font = { italic: true, size: 9, color: { argb: '94A3B8' } };
                ws.mergeCells(footerRow.number, 1, footerRow.number, 5);
            } else {
                const summaryRow = ws.addRow([`Total: ${table.rows.length} items`]);
                summaryRow.getCell(1).font = { bold: true, color: { argb: secondaryArgb } };
            }

            // Set explicit Landscape Fit-to-Width Print Area to hide costing factors on printout
            if (header.length > 0) {
                const lastColLetter = getColLetter(header.length - 1);
                const lastRowNumber = ws.lastRow ? ws.lastRow.number : 100;
                ws.pageSetup = {
                    orientation: 'landscape',
                    paperSize: 9, // A4
                    fitToPage: true,
                    fitToWidth: 1,
                    fitToHeight: 0,
                    printArea: `A1:${lastColLetter}${lastRowNumber}`
                };
            }
        }

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const { saveAs } = await import('file-saver');
        saveAs(blob, `${filename}.xlsx`);
    };

    const loadSubmissionLogos = async () => {
        const headerLogo = logoWhite || logoOriginal;
        const [headerLogoData, clientLogoData] = await Promise.all([
            headerLogo ? getImageData(headerLogo, { format: 'image/png', maxWidth: 600 }).catch(() => null) : Promise.resolve(null),
            project.clientLogo ? getImageData(project.clientLogo, { format: 'image/png', maxWidth: 600 }).catch(() => null) : Promise.resolve(null)
        ]);
        return { headerLogoData, clientLogoData };
    };

    const collectActiveTableRows = (table) =>
        (table?.rows || []).filter(r => r && !r.isHeader && !r.isSummary && (r.cells || []).some(c => c?.value));

    const maybeInsertSubmissionDividerPage = (doc, {
        row,
        tableRows,
        rowIdx,
        lastSectionRef,
        pageAddedRef,
        submissionType,
        colors,
        headerLogoData,
        clientLogoData,
        processText
    }) => {
        const currentSection = row?.sectionLabel || '';
        if (!currentSection || currentSection === lastSectionRef.value) return;
        lastSectionRef.value = currentSection;
        const groupRows = [];
        for (let i = rowIdx; i < tableRows.length; i++) {
            const candidate = tableRows[i];
            if ((candidate?.sectionLabel || '') !== currentSection) break;
            groupRows.push(candidate);
        }
        const divMeta = resolveSectionDividerMeta(groupRows, currentSection);
        if (pageAddedRef.value) doc.addPage();
        pageAddedRef.value = true;
        drawPdfCategoryDividerPage(doc, {
            categoryTitle: divMeta.categoryTitle,
            subheaderTitle: divMeta.subheaderTitle,
            itemCount: divMeta.itemCount,
            submissionType,
            project,
            companyName,
            colors,
            headerLogoData,
            clientLogoData,
            calcFitSize,
            processText
        });
    };

    // ===================== PREMIUM MAS (MATERIAL APPROVAL SHEET) =====================
    const handleGenerateMas = async (sourceTables) => {
        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();

        const arabicLoaded = await loadArabicFont(doc);
        const processText = (txt) => (arabicLoaded && hasArabic(txt)) ? fixArabic(txt) : String(txt || '');

        const pageAddedRef = { value: false };
        const lastSectionRef = { value: '' };
        let itemNumber = 1;

        const brandColors = getBrandColors(accentColor, secondaryColor);
        const colors = {
            primary: brandColors.primaryRgb,
            secondary: brandColors.accentRgb,
            text: brandColors.textRgb,
            lightBg: brandColors.lightBgRgb,
            border: brandColors.borderRgb,
            white: [255, 255, 255]
        };

        const masBatchRef = project.masReference || `MAS-${Date.now().toString().slice(-6)}`;
        const { headerLogoData, clientLogoData } = await loadSubmissionLogos();

        for (const table of sourceTables) {
            const header = table.header || [];
            const descIdx = header.findIndex(h => /description|desc/i.test(h));
            const brandIdx = header.findIndex(h => /brand|maker|origin/i.test(h));
            const qtyIdx = header.findIndex(h => /qty|quantity/i.test(h));
            const activeRows = collectActiveTableRows(table);

            for (let rIdx = 0; rIdx < activeRows.length; rIdx++) {
                const row = activeRows[rIdx];
                maybeInsertSubmissionDividerPage(doc, {
                    row,
                    tableRows: activeRows,
                    rowIdx: rIdx,
                    lastSectionRef,
                    pageAddedRef,
                    submissionType: 'MATERIAL APPROVAL SHEET',
                    colors,
                    headerLogoData,
                    clientLogoData,
                    processText
                });

                if (pageAddedRef.value) doc.addPage();
                pageAddedRef.value = true;

                const rowMasRef = `${masBatchRef}-${String(itemNumber).padStart(3, '0')}`;

                // ===== COMPACT HEADER (Company Logo Left, Client Logo Right, zero title collision) =====
                doc.setFillColor(...colors.primary);
                doc.rect(0, 0, pageWidth, 30, 'F');
                doc.setFillColor(...colors.secondary);
                doc.rect(0, 30, pageWidth, 1, 'F');

                if (headerLogoData) {
                    const fit = calcFitSize(headerLogoData.width, headerLogoData.height, 40, 16);
                    doc.addImage(headerLogoData.dataUrl, 'PNG', 8, (30 - fit.h) / 2, fit.w, fit.h);
                }
                if (clientLogoData) {
                    const cfit = calcFitSize(clientLogoData.width, clientLogoData.height, 40, 16);
                    doc.addImage(clientLogoData.dataUrl, 'PNG', pageWidth - 8 - cfit.w, (30 - cfit.h) / 2, cfit.w, cfit.h);
                }

                doc.setTextColor(...colors.white);
                doc.setFontSize(13.5);
                doc.setFont('helvetica', 'bold');
                doc.text('MATERIAL APPROVAL SHEET', pageWidth / 2, 14, { align: 'center' });
                if (row.submissionTitle || row.sectionLabel) {
                    doc.setFontSize(7.5);
                    doc.setFont('helvetica', 'normal');
                    doc.setTextColor(225, 232, 240);
                    doc.text(processText(String(row.submissionTitle || row.sectionLabel)), pageWidth / 2, 23.5, { align: 'center', maxWidth: 105 });
                }

                // Draw Project Info block between header and info bar (Y=33 to Y=52)
                const pY = 33;
                doc.setFillColor(...colors.lightBg);
                doc.setDrawColor(...colors.border);
                doc.setLineWidth(0.3);
                doc.roundedRect(8, pY, pageWidth - 16, 19, 2, 2, 'FD');

                const leftCol = 12, rightCol = pageWidth / 2 + 4;
                const rowH = 4.2;
                doc.setFontSize(7.5);
                doc.setTextColor(...colors.text);

                const contractorText = project.includeContractor !== false ? (project.contractor || '—') : '—';
                const consultantText = project.includeConsultant !== false ? (project.consultant || '—') : '—';
                const today = new Date().toLocaleDateString('en-GB');

                const pRows = [
                    ['Project:', project.projectName || '—', 'Client:', project.clientName || '—'],
                    ['Project No:', project.projectNumber || '—', 'Location / Zone:', project.locationZone || '—'],
                    ['Contractor:', contractorText, 'Consultant:', consultantText],
                    ['Site Engineer:', project.siteEngineer || '—', 'Issue Date:', project.issueDate || today],
                ];

                pRows.forEach((r, i) => {
                    const y = pY + 4.4 + i * rowH;
                    doc.setFont('helvetica', 'bold'); doc.text(r[0], leftCol, y);
                    doc.setFont(arabicLoaded && hasArabic(r[1]) ? 'Almarai' : 'helvetica', 'normal');
                    doc.text(processText(r[1]), leftCol + 24, y, { maxWidth: 62 });
                    doc.setFont('helvetica', 'bold'); doc.text(r[2], rightCol, y);
                    doc.setFont(arabicLoaded && hasArabic(r[3]) ? 'Almarai' : 'helvetica', 'normal');
                    doc.text(processText(r[3]), rightCol + 28, y, { maxWidth: 62 });
                });

                // Info bar (Y=54 to Y=63)
                doc.setFillColor(...colors.lightBg);
                doc.setDrawColor(...colors.border);
                doc.rect(0, 54, pageWidth, 9.5, 'F');
                doc.line(0, 63.5, pageWidth, 63.5);
                doc.setTextColor(...colors.text);
                doc.setFontSize(8);
                doc.setFont('helvetica', 'bold');
                doc.text(`Date: ${today}`, 10, 60);
                doc.text(`Item: ${String(itemNumber).padStart(3, '0')}`, pageWidth / 2, 60, { align: 'center' });
                doc.text(`Ref: ${rowMasRef}`, pageWidth - 10, 60, { align: 'right' });

                // ===== IMAGE SECTION (with multi-image grid support) =====
                const imageCell = row.cells.find(c => c.images?.length > 0 || c.image);
                const allImages = imageCell?.images || (imageCell?.image ? [imageCell.image] : []);
                let contentY = 69;

                // Load all images (JPEG for MAS products)
                const imageResults = [];
                for (const img of allImages.slice(0, 4)) {
                    const rawImgUrl = extractImageUrl(img);
                    if (rawImgUrl) {
                        try {
                            const imgResult = await getImageData(getFullUrl(rawImgUrl), { maxWidth: 800, format: 'image/jpeg' });
                            if (imgResult) imageResults.push(imgResult);
                        } catch (e) { }
                    }
                }

                if (imageResults.length > 0) {
                    // Image area dimensions
                    const imgAreaX = 15;
                    const imgAreaW = pageWidth - 30;
                    let imgAreaH;

                    if (imageResults.length === 1) {
                        // Single image - centered
                        imgAreaH = 58;
                        const maxW = 92, maxH = 54;
                        const img = imageResults[0];
                        const fit = calcFitSize(img.width, img.height, maxW, maxH);
                        const imgX = (pageWidth - fit.w) / 2;

                        doc.setFillColor(252, 252, 252);
                        doc.setDrawColor(...colors.border);
                        doc.setLineWidth(0.3);
                        doc.roundedRect(imgX - 3, contentY - 2, fit.w + 6, fit.h + 4, 2, 2, 'FD');
                        doc.addImage(img.dataUrl, 'JPEG', imgX, contentY, fit.w, fit.h, '', 'FAST');
                        contentY += fit.h + 9;
                    } else if (imageResults.length === 2) {
                        // Two images - side by side
                        imgAreaH = 55;
                        const singImgW = (imgAreaW - 15) / 2;
                        const singImgH = 50;

                        // Background for image area
                        doc.setFillColor(252, 252, 252);
                        doc.setDrawColor(...colors.border);
                        doc.setLineWidth(0.3);
                        doc.roundedRect(imgAreaX, contentY - 2, imgAreaW, imgAreaH, 2, 2, 'FD');

                        imageResults.forEach((img, idx) => {
                            const fit = calcFitSize(img.width, img.height, singImgW - 4, singImgH - 4);
                            const x = imgAreaX + 4 + idx * (singImgW + 7) + (singImgW - 4 - fit.w) / 2;
                            const y = contentY + (imgAreaH - fit.h) / 2 - 1;
                            doc.addImage(img.dataUrl, 'JPEG', x, y, fit.w, fit.h, '', 'FAST');
                        });
                        contentY += imgAreaH + 8;
                    } else {
                        // 3-4 images - 2x2 grid
                        imgAreaH = 85;
                        const cols = 2;
                        const gridRows = 2;
                        const cellW = (imgAreaW - 12) / cols;
                        const cellH = (imgAreaH - 8) / gridRows;

                        // Background for image area
                        doc.setFillColor(252, 252, 252);
                        doc.setDrawColor(...colors.border);
                        doc.setLineWidth(0.3);
                        doc.roundedRect(imgAreaX, contentY - 2, imgAreaW, imgAreaH, 2, 2, 'FD');

                        imageResults.slice(0, 4).forEach((img, idx) => {
                            const col = idx % cols;
                            const gridRow = Math.floor(idx / cols);
                            const fit = calcFitSize(img.width, img.height, cellW - 4, cellH - 4);
                            const x = imgAreaX + 4 + col * (cellW + 4) + (cellW - 4 - fit.w) / 2;
                            const y = contentY + 2 + gridRow * (cellH + 2) + (cellH - 4 - fit.h) / 2;
                            doc.addImage(img.dataUrl, 'JPEG', x, y, fit.w, fit.h, '', 'FAST');
                        });

                        // Show indicator if more images exist
                        if (allImages.length > 4) {
                            doc.setTextColor(...colors.text);
                            doc.setFontSize(7);
                            doc.text(`+${allImages.length - 4} more images`, imgAreaX + imgAreaW - 2, contentY + imgAreaH - 4, { align: 'right' });
                        }
                        contentY += imgAreaH + 8;
                    }
                }

                // ===== COMPACT DETAILS TABLE =====
                const desc = descIdx > -1 ? row.cells[descIdx].value : 'N/A';
                const rowBrand = brandIdx > -1 ? String(row.cells[brandIdx].value || '').trim() : '';
                const brand = rowBrand || project.brand || project.brandOrigin || companyName || 'N/A';
                const qty = qtyIdx > -1 ? row.cells[qtyIdx].value : 'As per BOQ';

                autoTable(doc, {
                    startY: contentY,
                    margin: { left: 15, right: 15 },
                    head: [[processText('Specification'), processText('Details')]],
                    body: [
                        [processText('Description'), processText(desc)],
                        [processText('Brand / Origin'), processText(brand)],
                        [processText('Quantity'), processText(qty)],
                        [processText('Warranty'), processText('As per manufacturer (5 years)')],
                        [processText('Compliance'), processText('As per project specifications')]
                    ],
                    theme: 'striped',
                    styles: {
                        fontSize: 9,
                        cellPadding: 3,
                        textColor: colors.text,
                        font: arabicLoaded ? 'Almarai' : 'helvetica',
                        overflow: 'linebreak'
                    },
                    headStyles: {
                        fillColor: colors.primary,
                        textColor: colors.white,
                        fontStyle: 'bold',
                        fontSize: 9,
                        cellPadding: 1.5,
                        minCellHeight: 7
                    },
                    alternateRowStyles: { fillColor: colors.lightBg },
                    columnStyles: { 0: { cellWidth: 40, fontStyle: 'bold' } }
                });

                // Get table end Y position
                const tableEndY = doc.lastAutoTable.finalY;

                // ===== SIGNATURES (guarded against bottom overflow) =====
                let sigY = Math.max(tableEndY + 8, 224);
                if (sigY + 40 > pageHeight - 10) {
                    doc.addPage();
                    sigY = 24;
                }

                doc.setFillColor(...colors.primary);
                doc.rect(15, sigY, pageWidth - 30, 8, 'F');
                doc.setTextColor(...colors.white);
                doc.setFontSize(8);
                doc.setFont('helvetica', 'bold');
                doc.text('APPROVAL SIGNATURES', pageWidth / 2, sigY + 5.5, { align: 'center' });

                const boxW = 52, boxH = 26;
                const boxY = sigY + 11;
                const gap = (pageWidth - 30 - boxW * 3) / 2;

                ['CONTRACTOR', 'CONSULTANT', 'CLIENT'].forEach((name, i) => {
                    const x = 15 + i * (boxW + gap);
                    doc.setFillColor(...colors.white);
                    doc.setDrawColor(...colors.border);
                    doc.setLineWidth(0.3);
                    doc.rect(x, boxY, boxW, boxH, 'FD');

                    doc.setFillColor(...colors.secondary);
                    doc.rect(x, boxY, boxW, 6, 'F');
                    doc.setTextColor(...colors.primary);
                    doc.setFontSize(7);
                    doc.setFont('helvetica', 'bold');
                    doc.text(name, x + boxW / 2, boxY + 4.2, { align: 'center' });

                    doc.setTextColor(...colors.text);
                    doc.setFontSize(6.5);
                    doc.setFont('helvetica', 'normal');
                    doc.text('Date: __________', x + boxW / 2, boxY + boxH - 2.5, { align: 'center' });
                });

                itemNumber++;
            }
        }

        // Stamp crisp white-label footer with Page X of Y on all MAS pages
        const totalMasPages = doc.internal.getNumberOfPages();
        const masBrandFoot = companyName || 'BOQ FLOW';
        for (let p = 1; p <= totalMasPages; p++) {
            doc.setPage(p);
            doc.setFillColor(...colors.primary);
            doc.rect(0, pageHeight - 8, pageWidth, 8, 'F');
            doc.setTextColor(...colors.white);
            doc.setFontSize(6.8);
            doc.setFont('helvetica', 'normal');
            doc.text(`${masBrandFoot}  |  Material Approval Sheet (${masBatchRef})`, 10, pageHeight - 2.8);
            doc.text(`Page ${p} of ${totalMasPages}`, pageWidth - 10, pageHeight - 2.8, { align: 'right' });
        }

        doc.save(`MAS_${masBatchRef}.pdf`);
    };

    // ===================== MATERIAL INSPECTION REPORT (MIR) — 1 PAGE PER ITEM =====================
    const handleGenerateMIR = async (sourceTables) => {
        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const arabicLoaded = await loadArabicFont(doc);
        const pageAddedRef = { value: false };
        const lastSectionRef = { value: '' };
        let itemNumber = 1;

        const brandColors = getBrandColors(accentColor, secondaryColor);
        const colors = {
            primary: brandColors.primaryRgb,
            accent: brandColors.accentRgb,
            gold: brandColors.accentRgb, // Mapping gold to accent for consistency
            green: [16, 185, 129],     // Emerald (kept for status/specific UI if needed)
            text: brandColors.textRgb,
            lightBg: brandColors.lightBgRgb,
            border: brandColors.borderRgb,
            white: [255, 255, 255]
        };

        const processText = (txt) => (arabicLoaded && hasArabic(txt)) ? fixArabic(txt) : String(txt || '');
        const today = new Date().toLocaleDateString('en-GB');
        const mirRef = project.mirReference || `MIR-${Date.now().toString().slice(-6)}`;
        const { headerLogoData, clientLogoData } = await loadSubmissionLogos();

        for (const table of sourceTables) {
            const header = table.header || [];
            const descIdx = header.findIndex(h => /description|desc|disc|item|product/i.test(h));
            const brandIdx = header.findIndex(h => /brand|maker|origin/i.test(h));
            let qtyIdx = header.findIndex(h => /revised.*qty|revised.*quantity|actual.*qty|actual.*quantity/i.test(h));
            if (qtyIdx === -1) qtyIdx = header.findIndex(h => /qty|quantity|qt/i.test(h));
            const uomIdx = header.findIndex(h => /uom|unit/i.test(h));
            const snIdx = header.findIndex(h => /s\.?n|no\.|#|sr|item|sl/i.test(h));
            const codeIdx = header.findIndex(h => /code|item.*code|ref/i.test(h));
            const activeRows = collectActiveTableRows(table);

            for (let rIdx = 0; rIdx < activeRows.length; rIdx++) {
                const row = activeRows[rIdx];
                maybeInsertSubmissionDividerPage(doc, {
                    row,
                    tableRows: activeRows,
                    rowIdx: rIdx,
                    lastSectionRef,
                    pageAddedRef,
                    submissionType: 'MATERIAL INSPECTION REQUEST',
                    colors,
                    headerLogoData,
                    clientLogoData,
                    processText
                });

                if (pageAddedRef.value) doc.addPage();
                pageAddedRef.value = true;

                let codeRaw = codeIdx > -1 ? String(row.cells[codeIdx].value || '') : '';
                let snRaw = snIdx > -1 ? String(row.cells[snIdx].value || '') : '';
                let rawTitle = codeRaw.trim() || snRaw.trim() || String(itemNumber).padStart(3, '0');
                let displayTitle = rawTitle.replace(/\n+/g, ', ').replace(/\s{2,}/g, ' ').trim();
                const rowMirRef = `${mirRef}-${String(itemNumber).padStart(3, '0')}`;

                // ── HEADER BAND (bounded logos to prevent title collision) ──
                doc.setFillColor(...colors.primary);
                doc.rect(0, 0, pageWidth, 30, 'F');
                doc.setFillColor(...colors.accent);
                doc.rect(0, 30, pageWidth, 1, 'F');

                if (headerLogoData) {
                    const fit = calcFitSize(headerLogoData.width, headerLogoData.height, 40, 16);
                    doc.addImage(headerLogoData.dataUrl, 'PNG', 8, (30 - fit.h) / 2, fit.w, fit.h);
                }
                if (clientLogoData) {
                    const cfit = calcFitSize(clientLogoData.width, clientLogoData.height, 40, 16);
                    doc.addImage(clientLogoData.dataUrl, 'PNG', pageWidth - 8 - cfit.w, (30 - cfit.h) / 2, cfit.w, cfit.h);
                }

                doc.setTextColor(...colors.white);
                doc.setFontSize(13);
                doc.setFont('helvetica', 'bold');
                doc.text('MATERIAL INSPECTION REQUEST', pageWidth / 2, 13.5, { align: 'center' });

                doc.setFontSize(7.5);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(225, 232, 240);
                doc.text(`Ref: ${rowMirRef}   |   Item ${displayTitle}   |   Date: ${today}`, pageWidth / 2, 20.5, { align: 'center' });
                if (row.submissionTitle || row.sectionLabel) {
                    doc.setFontSize(7);
                    doc.text(processText(String(row.submissionTitle || row.sectionLabel)), pageWidth / 2, 26.5, { align: 'center', maxWidth: 105 });
                }

                // ── PROJECT INFO (Y=33 to Y=53) ──
                const pY = 33;
                doc.setFillColor(...colors.lightBg);
                doc.setDrawColor(...colors.border);
                doc.setLineWidth(0.3);
                doc.roundedRect(8, pY, pageWidth - 16, 20, 2, 2, 'FD');

                const leftCol = 12, rightCol = pageWidth / 2 + 4;
                const rowH = 4.4;
                doc.setFontSize(7.5);
                doc.setTextColor(...colors.text);

                const pRow3 = [];
                if (project.includeContractor !== false) pRow3.push('Contractor:', project.contractor || '—');
                if (project.includeConsultant !== false) pRow3.push('Consultant:', project.consultant || '—');
                while (pRow3.length < 4) pRow3.push('', '');

                const pRows = [
                    ['Project:', project.projectName || '—', 'Client:', project.clientName || '—'],
                    ['Project No:', project.projectNumber || '—', 'Location / Zone:', project.locationZone || '—'],
                    pRow3,
                    ['Site Engineer:', project.siteEngineer || '—', 'Issue Date:', project.issueDate || today],
                ];

                pRows.forEach((r, i) => {
                    const y = pY + 4.8 + i * rowH;
                    doc.setFont('helvetica', 'bold'); doc.text(r[0], leftCol, y);
                    doc.setFont(arabicLoaded && hasArabic(r[1]) ? 'Almarai' : 'helvetica', 'normal');
                    doc.text(processText(r[1]), leftCol + 24, y, { maxWidth: 62 });
                    doc.setFont('helvetica', 'bold'); doc.text(r[2], rightCol, y);
                    doc.setFont(arabicLoaded && hasArabic(r[3]) ? 'Almarai' : 'helvetica', 'normal');
                    doc.text(processText(r[3]), rightCol + 28, y, { maxWidth: 62 });
                });

                // ── ITEM DETAILS (starts cleanly below Project Info box at Y=56!) ──
                const desc = descIdx > -1 ? row.cells[descIdx].value : 'N/A';
                const brand = project.brand || project.brandOrigin || (brandIdx > -1 ? row.cells[brandIdx].value : '') || companyName || 'N/A';
                const qty = qtyIdx > -1 ? row.cells[qtyIdx].value : 'As per BOQ';
                const uom = project.unitOfMeasure ? project.unitOfMeasure : (uomIdx > -1 ? row.cells[uomIdx].value : '');

                let contentY = 56;

                doc.setFillColor(...colors.accent);
                doc.roundedRect(8, contentY, pageWidth - 16, 7, 1, 1, 'F');
                doc.setTextColor(...colors.white);
                doc.setFontSize(8.5);
                doc.setFont('helvetica', 'bold');
                doc.text(`ITEM ${displayTitle} — MATERIAL INSPECTION`, 12, contentY + 4.8);
                contentY += 9.5;

                // ── UNIFIED IMAGES GRID ──
                const allImages = [];
                for (const cell of row.cells) {
                    const imgs = cell.images || (cell.image ? [cell.image] : []);
                    for (const img of imgs) {
                        const rawImgUrl = extractImageUrl(img);
                        if (rawImgUrl) {
                            try {
                                const ir = await getImageData(getFullUrl(rawImgUrl), { maxWidth: 800, format: 'image/jpeg' });
                                if (ir) allImages.push(ir);
                            } catch (e) { }
                        }
                    }
                }

                if (allImages.length > 0) {
                    const imgAreaW = pageWidth - 16;
                    const imgAreaH = 54;
                    const numImgs = allImages.length;

                    let cols = numImgs === 1 ? 1 : (numImgs <= 4 ? 2 : 3);
                    let rows2 = Math.ceil(numImgs / cols);
                    if (rows2 > 3) rows2 = 3;

                    const pad = 2;
                    const cW = (imgAreaW - (cols - 1) * pad) / cols;
                    const cH = (imgAreaH - (rows2 - 1) * pad) / rows2;

                    doc.setFillColor(252, 252, 252);
                    doc.setDrawColor(...colors.border);
                    doc.roundedRect(8, contentY, imgAreaW, imgAreaH, 2, 2, 'FD');

                    allImages.slice(0, 9).forEach((img, iIdx) => {
                        const c = iIdx % cols;
                        const r = Math.floor(iIdx / cols);
                        const fit = calcFitSize(img.width, img.height, cW, cH);
                        const imgX = 8 + pad + c * (cW + pad) + (cW - fit.w) / 2;
                        const imgY = contentY + pad + r * (cH + pad) + (cH - fit.h) / 2;
                        doc.addImage(img.dataUrl, 'JPEG', imgX, imgY, fit.w, fit.h, '', 'FAST');
                    });
                    contentY += imgAreaH + 4;
                }

                autoTable(doc, {
                    startY: contentY,
                    margin: { left: 8, right: 8 },
                    head: [[processText('Field'), processText('Details')]],
                    body: [
                        [processText('Description'), processText(desc)],
                        [processText('Brand / Origin'), processText(brand)],
                        [processText('Quantity'), processText(qty)],
                        [processText('Unit of Measure'), processText(uom)],
                        [processText('Material Status'), ''],
                        [processText('Inspection Result'), ''],
                        [processText('Remarks'), ''],
                    ],
                    theme: 'striped',
                    styles: { fontSize: 8, cellPadding: 2.5, textColor: colors.text, overflow: 'linebreak', font: arabicLoaded ? 'Almarai' : 'helvetica' },
                    headStyles: {
                        fillColor: colors.accent,
                        textColor: colors.white,
                        fontStyle: 'bold',
                        fontSize: 8,
                        cellPadding: 1.5,
                        minCellHeight: 7
                    },
                    alternateRowStyles: { fillColor: colors.lightBg },
                    columnStyles: { 0: { cellWidth: 48, fontStyle: 'bold' } }
                });

                const clY = doc.lastAutoTable.finalY + 2;
                doc.setDrawColor(...colors.border);
                doc.setFillColor(...colors.lightBg);
                doc.rect(8, clY, pageWidth - 16, 5, 'FD');
                doc.setTextColor(...colors.text);
                doc.setFontSize(7.5);
                doc.setFont('helvetica', 'bold');
                doc.text("ORIGINATOR'S INFORMATION", 12, clY + 3.8);

                autoTable(doc, {
                    startY: clY + 5,
                    margin: { left: 8, right: 8 },
                    head: [['Name', 'Designation', 'Signature']],
                    body: [[processText(project.originatorName || ''), processText(project.originatorDesignation || ''), '']],
                    theme: 'grid',
                    styles: { fontSize: 7.5, cellPadding: 2, textColor: colors.text, font: arabicLoaded ? 'Almarai' : 'helvetica' },
                    headStyles: {
                        fillColor: [248, 250, 252],
                        textColor: colors.text,
                        fontStyle: 'bold',
                        halign: 'center',
                        lineWidth: 0.1,
                        lineColor: colors.border,
                        cellPadding: 1.5,
                        minCellHeight: 7
                    },
                    bodyStyles: { minCellHeight: 6 },
                    columnStyles: { 0: { cellWidth: 55 }, 1: { cellWidth: 55 }, 2: { cellWidth: 'auto' } }
                });

                const comY = doc.lastAutoTable.finalY;
                doc.setFillColor(...colors.lightBg);
                doc.rect(8, comY, pageWidth - 16, 5, 'FD');
                doc.setFontSize(7.5);
                doc.setFont('helvetica', 'bold');
                doc.text("COMMENTS:", 12, comY + 3.8);

                doc.setFillColor(255, 255, 255);
                doc.rect(8, comY + 5, pageWidth - 16, 13, 'FD');

                const appY = comY + 18;
                doc.setFillColor(255, 255, 255);
                doc.rect(8, appY, pageWidth - 16, 6, 'FD');
                doc.setFontSize(7);
                doc.setFont('helvetica', 'bold');
                doc.rect(30, appY + 2, 2, 2); doc.text('A. Approved', 34, appY + 4);
                doc.rect(85, appY + 2, 2, 2); doc.text('B. Approved as Noted', 89, appY + 4);
                doc.rect(145, appY + 2, 2, 2); doc.text('C. Revise and Resubmit', 149, appY + 4);

                let sigY = appY + 7.5;
                if (sigY + 28 > pageHeight - 10) {
                    doc.addPage();
                    sigY = 22;
                }
                doc.setFillColor(...colors.primary);
                doc.rect(8, sigY, pageWidth - 16, 5.5, 'F');
                doc.setTextColor(...colors.white);
                doc.setFontSize(8);
                doc.setFont('helvetica', 'bold');
                doc.text('REVIEWED AND APPROVED BY', pageWidth / 2, sigY + 4, { align: 'center' });

                const sigParties = [
                    { name: 'Submitted By\n(Contractor)', keep: project.includeContractor !== false },
                    { name: 'Checked By\n(Consultant)', keep: project.includeConsultant !== false },
                    { name: `Approved By\n(Client)` + (project.clientRepName ? `\n${project.clientRepName}` : '') + (project.clientRepDesignation ? `\n${project.clientRepDesignation}` : ''), keep: true }
                ].filter(p => p.keep).map(p => p.name);

                const boxW = 54, boxH = 22, boxY = sigY + 7;
                const gap = sigParties.length > 1 ? (pageWidth - 16 - boxW * sigParties.length) / (sigParties.length - 1) : 0;

                sigParties.forEach((name, i) => {
                    const x = 8 + i * (boxW + gap);
                    doc.setFillColor(...colors.white);
                    doc.setDrawColor(...colors.border);
                    doc.setLineWidth(0.3);
                    doc.rect(x, boxY, boxW, boxH, 'FD');
                    doc.setFillColor(...colors.accent);
                    doc.rect(x, boxY, boxW, 5.5, 'F');
                    const parts = name.split('\n');
                    doc.setTextColor(...colors.white);
                    doc.setFontSize(6.5);
                    doc.setFont('helvetica', 'bold');
                    doc.text(parts[0] || '', x + boxW / 2, boxY + 4, { align: 'center' });
                    doc.setTextColor(...colors.text);
                    doc.setFontSize(6);
                    doc.setFont('helvetica', 'normal');
                    doc.text(parts[1] || '', x + boxW / 2, boxY + 8.5, { align: 'center' });
                    if (parts[2]) doc.text(parts[2], x + boxW / 2, boxY + 11.5, { align: 'center' });
                    if (parts[3]) { doc.setFontSize(5.5); doc.text(parts[3], x + boxW / 2, boxY + 14.5, { align: 'center' }); }
                    doc.setFontSize(6);
                    doc.text('Date: __________', x + boxW / 2, boxY + boxH - 2, { align: 'center' });
                });

                itemNumber++;
            }
        }
        const totalMirPages = doc.internal.getNumberOfPages();
        const mirFootBrand = companyName || 'BOQ FLOW';
        for (let p = 1; p <= totalMirPages; p++) {
            doc.setPage(p);
            doc.setFillColor(...colors.primary);
            doc.rect(0, pageHeight - 8, pageWidth, 8, 'F');
            doc.setTextColor(...colors.white);
            doc.setFontSize(6.8);
            doc.setFont('helvetica', 'normal');
            doc.text(`${mirFootBrand}  |  Material Inspection Request (${mirRef})`, 10, pageHeight - 2.8);
            doc.text(`Page ${p} of ${totalMirPages}`, pageWidth - 10, pageHeight - 2.8, { align: 'right' });
        }
        doc.save(`MIR_${mirRef}.pdf`);
    };

    // ===================== WORK INSPECTION REQUEST (WIR) — 1 PAGE PER ITEM =====================
    const handleGenerateWIR = async (sourceTables) => {
        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const arabicLoaded = await loadArabicFont(doc);
        const pageAddedRef = { value: false };
        const lastSectionRef = { value: '' };
        let itemNumber = 1;

        const brandColors = getBrandColors(accentColor, secondaryColor);
        const colors = {
            primary: brandColors.primaryRgb,
            accent: brandColors.accentRgb,
            gold: brandColors.accentRgb,
            text: brandColors.textRgb,
            lightBg: brandColors.lightBgRgb,
            border: brandColors.borderRgb,
            white: [255, 255, 255]
        };

        const processText = (txt) => (arabicLoaded && hasArabic(txt)) ? fixArabic(txt) : String(txt || '');
        const today = new Date().toLocaleDateString('en-GB');
        const wirRef = project.wirReference || `WIR-${Date.now().toString().slice(-6)}`;
        const { headerLogoData, clientLogoData } = await loadSubmissionLogos();

        for (const table of sourceTables) {
            const header = table.header || [];
            const descIdx = header.findIndex(h => /description|desc|disc|item|product/i.test(h));
            const brandIdx = header.findIndex(h => /brand|maker|origin/i.test(h));
            let qtyIdx = header.findIndex(h => /revised.*qty|revised.*quantity|actual.*qty|actual.*quantity/i.test(h));
            if (qtyIdx === -1) qtyIdx = header.findIndex(h => /qty|quantity|qt/i.test(h));
            const uomIdx = header.findIndex(h => /uom|unit/i.test(h));
            const snIdx = header.findIndex(h => /s\.?n|no\.|#|sr|item|sl/i.test(h));
            const codeIdx = header.findIndex(h => /code|item.*code|ref/i.test(h));
            const activeRows = collectActiveTableRows(table);

            for (let rIdx = 0; rIdx < activeRows.length; rIdx++) {
                const row = activeRows[rIdx];
                maybeInsertSubmissionDividerPage(doc, {
                    row,
                    tableRows: activeRows,
                    rowIdx: rIdx,
                    lastSectionRef,
                    pageAddedRef,
                    submissionType: 'WORK INSPECTION REQUEST',
                    colors,
                    headerLogoData,
                    clientLogoData,
                    processText
                });

                if (pageAddedRef.value) doc.addPage();
                pageAddedRef.value = true;

                let codeRaw = codeIdx > -1 ? String(row.cells[codeIdx].value || '') : '';
                let snRaw = snIdx > -1 ? String(row.cells[snIdx].value || '') : '';
                let rawTitle = codeRaw.trim() || snRaw.trim() || String(itemNumber).padStart(3, '0');
                let displayTitle = rawTitle.replace(/\n+/g, ', ').replace(/\s{2,}/g, ' ').trim();
                const rowWirRef = `${wirRef}-${String(itemNumber).padStart(3, '0')}`;

                // ── HEADER (bounded logos to prevent title collision) ──
                doc.setFillColor(...colors.primary);
                doc.rect(0, 0, pageWidth, 30, 'F');
                doc.setFillColor(...colors.accent);
                doc.rect(0, 30, pageWidth, 1, 'F');

                if (headerLogoData) {
                    const fit = calcFitSize(headerLogoData.width, headerLogoData.height, 40, 16);
                    doc.addImage(headerLogoData.dataUrl, 'PNG', 8, (30 - fit.h) / 2, fit.w, fit.h);
                }
                if (clientLogoData) {
                    const cfit = calcFitSize(clientLogoData.width, clientLogoData.height, 40, 16);
                    doc.addImage(clientLogoData.dataUrl, 'PNG', pageWidth - 8 - cfit.w, (30 - cfit.h) / 2, cfit.w, cfit.h);
                }

                doc.setTextColor(...colors.white);
                doc.setFontSize(13);
                doc.setFont('helvetica', 'bold');
                doc.text('WORK INSPECTION REQUEST', pageWidth / 2, 13.5, { align: 'center' });

                doc.setFontSize(7.5);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(225, 232, 240);
                doc.text(`Ref: ${rowWirRef}   |   Item ${displayTitle}   |   Date: ${today}`, pageWidth / 2, 20.5, { align: 'center' });
                if (row.submissionTitle || row.sectionLabel) {
                    doc.setFontSize(7);
                    doc.text(processText(String(row.submissionTitle || row.sectionLabel)), pageWidth / 2, 26.5, { align: 'center', maxWidth: 105 });
                }

                // ── PROJECT INFO (Y=33 to Y=53) ──
                const pY = 33;
                doc.setFillColor(...colors.lightBg);
                doc.setDrawColor(...colors.border);
                doc.setLineWidth(0.3);
                doc.roundedRect(8, pY, pageWidth - 16, 20, 2, 2, 'FD');

                const leftCol = 12, rightCol = pageWidth / 2 + 4;
                const rowH = 4.4;
                doc.setFontSize(7.5);
                doc.setTextColor(...colors.text);

                const pRow3 = [];
                if (project.includeContractor !== false) pRow3.push('Contractor:', project.contractor || '—');
                if (project.includeConsultant !== false) pRow3.push('Consultant:', project.consultant || '—');
                while (pRow3.length < 4) pRow3.push('', '');

                const pRows = [
                    ['Project:', project.projectName || '—', 'Client:', project.clientName || '—'],
                    ['Project No:', project.projectNumber || '—', 'Location / Zone:', project.locationZone || '—'],
                    pRow3,
                    ['Site Engineer:', project.siteEngineer || '—', 'Inspection Date:', project.issueDate || today],
                ];

                pRows.forEach((r, i) => {
                    const y = pY + 4.8 + i * rowH;
                    doc.setFont('helvetica', 'bold'); doc.text(r[0], leftCol, y);
                    doc.setFont(arabicLoaded && hasArabic(r[1]) ? 'Almarai' : 'helvetica', 'normal');
                    doc.text(processText(r[1]), leftCol + 24, y, { maxWidth: 62 });
                    doc.setFont('helvetica', 'bold'); doc.text(r[2], rightCol, y);
                    doc.setFont(arabicLoaded && hasArabic(r[3]) ? 'Almarai' : 'helvetica', 'normal');
                    doc.text(processText(r[3]), rightCol + 28, y, { maxWidth: 62 });
                });

                // ── ITEM DETAILS (starts cleanly below Project Info box at Y=56!) ──
                const desc = descIdx > -1 ? row.cells[descIdx].value : 'N/A';
                const brand = brandIdx > -1 ? row.cells[brandIdx].value : 'N/A';
                const qty = qtyIdx > -1 ? row.cells[qtyIdx].value : 'As per BOQ';
                const uom = uomIdx > -1 ? row.cells[uomIdx].value : 'No.';

                let contentY = 56;

                doc.setFillColor(...colors.accent);
                doc.roundedRect(8, contentY, pageWidth - 16, 7, 1, 1, 'F');
                doc.setTextColor(...colors.white);
                doc.setFontSize(8.5);
                doc.setFont('helvetica', 'bold');
                doc.text(`ITEM ${displayTitle} — WORK INSPECTION`, 12, contentY + 4.8);
                contentY += 9.5;

                // ── UNIFIED IMAGES GRID ──
                const allImages = [];
                for (const cell of row.cells) {
                    const imgs = cell.images || (cell.image ? [cell.image] : []);
                    for (const img of imgs) {
                        const rawImgUrl = extractImageUrl(img);
                        if (rawImgUrl) {
                            try {
                                const ir = await getImageData(getFullUrl(rawImgUrl), { maxWidth: 800, format: 'image/jpeg' });
                                if (ir) allImages.push(ir);
                            } catch (e) { }
                        }
                    }
                }

                if (allImages.length > 0) {
                    const imgAreaW = pageWidth - 16;
                    const imgAreaH = 54;
                    const numImgs = allImages.length;

                    let cols = numImgs === 1 ? 1 : (numImgs <= 4 ? 2 : 3);
                    let rows2 = Math.ceil(numImgs / cols);
                    if (rows2 > 3) rows2 = 3;

                    const pad = 2;
                    const cW = (imgAreaW - (cols - 1) * pad) / cols;
                    const cH = (imgAreaH - (rows2 - 1) * pad) / rows2;

                    doc.setFillColor(252, 252, 252);
                    doc.setDrawColor(...colors.border);
                    doc.roundedRect(8, contentY, imgAreaW, imgAreaH, 2, 2, 'FD');

                    allImages.slice(0, 9).forEach((img, iIdx) => {
                        const c = iIdx % cols;
                        const r = Math.floor(iIdx / cols);
                        const fit = calcFitSize(img.width, img.height, cW, cH);
                        const imgX = 8 + pad + c * (cW + pad) + (cW - fit.w) / 2;
                        const imgY = contentY + pad + r * (cH + pad) + (cH - fit.h) / 2;
                        doc.addImage(img.dataUrl, 'JPEG', imgX, imgY, fit.w, fit.h, '', 'FAST');
                    });
                    contentY += imgAreaH + 4;
                }

                autoTable(doc, {
                    startY: contentY,
                    margin: { left: 8, right: 8 },
                    head: [[processText('Field'), processText('Details')]],
                    body: [
                        [processText('Work Description'), processText(desc)],
                        [processText('Brand / Material'), processText(project.brand || project.brandOrigin || (brandIdx > -1 ? row.cells[brandIdx].value : '') || companyName || 'N/A')],
                        [processText('Quantity'), processText(qty)],
                        [processText('Unit'), processText(project.unitOfMeasure ? project.unitOfMeasure : (uomIdx > -1 ? row.cells[uomIdx].value : ''))],
                        [processText('Work Area / Zone'), processText(project.locationZone || '')],
                        [processText('Inspection Required'), ''],
                        [processText('Remarks'), ''],
                    ],
                    theme: 'striped',
                    styles: { fontSize: 8, cellPadding: 2.5, textColor: colors.text, overflow: 'linebreak', font: arabicLoaded ? 'Almarai' : 'helvetica' },
                    headStyles: {
                        fillColor: colors.accent,
                        textColor: colors.white,
                        fontStyle: 'bold',
                        fontSize: 8,
                        cellPadding: 1.5,
                        minCellHeight: 7
                    },
                    alternateRowStyles: { fillColor: colors.lightBg },
                    columnStyles: { 0: { cellWidth: 48, fontStyle: 'bold' } }
                });

                const clY = doc.lastAutoTable.finalY + 2;
                doc.setDrawColor(...colors.border);
                doc.setFillColor(...colors.lightBg);
                doc.rect(8, clY, pageWidth - 16, 5, 'FD');
                doc.setTextColor(...colors.text);
                doc.setFontSize(7.5);
                doc.setFont('helvetica', 'bold');
                doc.text("ORIGINATOR'S INFORMATION", 12, clY + 3.8);

                autoTable(doc, {
                    startY: clY + 5,
                    margin: { left: 8, right: 8 },
                    head: [['Name', 'Designation', 'Signature']],
                    body: [[processText(project.originatorName || ''), processText(project.originatorDesignation || ''), '']],
                    theme: 'grid',
                    styles: { fontSize: 7.5, cellPadding: 2, textColor: colors.text, font: arabicLoaded ? 'Almarai' : 'helvetica' },
                    headStyles: {
                        fillColor: [248, 250, 252],
                        textColor: colors.text,
                        fontStyle: 'bold',
                        halign: 'center',
                        lineWidth: 0.1,
                        lineColor: colors.border,
                        cellPadding: 1.5,
                        minCellHeight: 7
                    },
                    bodyStyles: { minCellHeight: 6 },
                    columnStyles: { 0: { cellWidth: 55 }, 1: { cellWidth: 55 }, 2: { cellWidth: 'auto' } }
                });

                const comY = doc.lastAutoTable.finalY;
                doc.setFillColor(...colors.lightBg);
                doc.rect(8, comY, pageWidth - 16, 5, 'FD');
                doc.setFontSize(7.5);
                doc.setFont('helvetica', 'bold');
                doc.text("COMMENTS:", 12, comY + 3.8);

                doc.setFillColor(255, 255, 255);
                doc.rect(8, comY + 5, pageWidth - 16, 13, 'FD');

                const appY = comY + 18;
                doc.setFillColor(255, 255, 255);
                doc.rect(8, appY, pageWidth - 16, 6, 'FD');
                doc.setFontSize(7);
                doc.setFont('helvetica', 'bold');
                doc.rect(30, appY + 2, 2, 2); doc.text('A. Approved', 34, appY + 4);
                doc.rect(85, appY + 2, 2, 2); doc.text('B. Approved as Noted', 89, appY + 4);
                doc.rect(145, appY + 2, 2, 2); doc.text('C. Revise and Resubmit', 149, appY + 4);

                let sigY = appY + 7.5;
                if (sigY + 28 > pageHeight - 10) {
                    doc.addPage();
                    sigY = 22;
                }
                doc.setFillColor(...colors.primary);
                doc.rect(8, sigY, pageWidth - 16, 5.5, 'F');
                doc.setTextColor(...colors.white);
                doc.setFontSize(8);
                doc.setFont('helvetica', 'bold');
                doc.text('REVIEWED AND APPROVED BY', pageWidth / 2, sigY + 4, { align: 'center' });

                const sigParties = [
                    { name: 'Requested By\n(Contractor)', keep: project.includeContractor !== false },
                    { name: 'Inspected By\n(Consultant)', keep: project.includeConsultant !== false },
                    { name: `Approved By\n(Client)` + (project.clientRepName ? `\n${project.clientRepName}` : '') + (project.clientRepDesignation ? `\n${project.clientRepDesignation}` : ''), keep: true }
                ].filter(p => p.keep).map(p => p.name);

                const boxW = 54, boxH = 22, boxY = sigY + 7;
                const gap = sigParties.length > 1 ? (pageWidth - 16 - boxW * sigParties.length) / (sigParties.length - 1) : 0;

                sigParties.forEach((name, i) => {
                    const x = 8 + i * (boxW + gap);
                    doc.setFillColor(...colors.white);
                    doc.setDrawColor(...colors.border);
                    doc.setLineWidth(0.3);
                    doc.rect(x, boxY, boxW, boxH, 'FD');
                    doc.setFillColor(...colors.accent);
                    doc.rect(x, boxY, boxW, 5.5, 'F');
                    const parts = name.split('\n');
                    doc.setTextColor(...colors.white);
                    doc.setFontSize(6.5);
                    doc.setFont('helvetica', 'bold');
                    doc.text(parts[0] || '', x + boxW / 2, boxY + 4, { align: 'center' });
                    doc.setTextColor(...colors.text);
                    doc.setFontSize(6);
                    doc.setFont('helvetica', 'normal');
                    doc.text(parts[1] || '', x + boxW / 2, boxY + 8.5, { align: 'center' });
                    if (parts[2]) doc.text(parts[2], x + boxW / 2, boxY + 11.5, { align: 'center' });
                    if (parts[3]) { doc.setFontSize(5.5); doc.text(parts[3], x + boxW / 2, boxY + 14.5, { align: 'center' }); }
                    doc.setFontSize(6);
                    doc.text('Date: __________', x + boxW / 2, boxY + boxH - 2, { align: 'center' });
                });

                itemNumber++;
            }
        }
        const totalWirPages = doc.internal.getNumberOfPages();
        const wirFootBrand = companyName || 'BOQ FLOW';
        for (let p = 1; p <= totalWirPages; p++) {
            doc.setPage(p);
            doc.setFillColor(...colors.primary);
            doc.rect(0, pageHeight - 8, pageWidth, 8, 'F');
            doc.setTextColor(...colors.white);
            doc.setFontSize(6.8);
            doc.setFont('helvetica', 'normal');
            doc.text(`${wirFootBrand}  |  Work Inspection Request (${wirRef})`, 10, pageHeight - 2.8);
            doc.text(`Page ${p} of ${totalWirPages}`, pageWidth - 10, pageHeight - 2.8, { align: 'right' });
        }
        doc.save(`WIR_${wirRef}.pdf`);
    };

    // ===================== DELIVERY NOTE — 1 PAGE PER ITEM =====================
    const handleGenerateDeliveryNote = async (sourceTables) => {
        const doc = new jsPDF({ orientation: 'portrait' });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const arabicLoaded = await loadArabicFont(doc);

        const brandColors = getBrandColors(accentColor, secondaryColor);
        const colors = {
            primary: brandColors.primaryRgb,
            accent: brandColors.accentRgb,
            text: brandColors.textRgb,
            lightBg: brandColors.lightBgRgb,
            border: brandColors.borderRgb,
            white: [255, 255, 255]
        };

        const processText = (txt) => (arabicLoaded && hasArabic(txt)) ? fixArabic(txt) : String(txt || '');
        const today = new Date().toLocaleDateString('en-GB');
        const dnRef = project.dnReference || `DN-${Date.now().toString().slice(-6)}`;

        // Pre-load logos
        const [whiteLogoInfo, colorLogoInfo, clientLogoInfo] = await Promise.all([
            logoWhite ? getImageData(logoWhite, { format: 'image/png', maxWidth: 400 }).catch(() => null) : Promise.resolve(null),
            logoOriginal ? getImageData(logoOriginal, { format: 'image/png', maxWidth: 400 }).catch(() => null) : Promise.resolve(null),
            project.clientLogo ? getImageData(project.clientLogo, { format: 'image/png', maxWidth: 400 }).catch(() => null) : Promise.resolve(null)
        ]);
        const dividerHeaderLogo = whiteLogoInfo || colorLogoInfo;

        // Header Helper - Shrunk to height 30 and symmetric logo
        const drawHeader = () => {
            doc.setFillColor(...colors.primary);
            doc.rect(0, 0, pageWidth, 30, 'F');
            doc.setFillColor(...colors.accent);
            doc.rect(0, 30, pageWidth, 1, 'F');

            const dlWhite = whiteLogoInfo || colorLogoInfo;
            if (dlWhite) {
                const fit = calcFitSize(dlWhite.width, dlWhite.height, 60, 18);
                doc.addImage(dlWhite.dataUrl, 'PNG', 10, 6, fit.w, fit.h);
            }

            doc.setTextColor(...colors.white);
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.text('DELIVERY NOTE', pageWidth - 10, 12, { align: 'right' });

            doc.setFontSize(8.5);
            doc.setFont('helvetica', 'normal');
            doc.text(`Ref: ${dnRef}`, pageWidth - 10, 18, { align: 'right' });
            doc.text(`Date: ${today}`, pageWidth - 10, 24, { align: 'right' });
        };

        const drawProjectCard = (startY) => {
            doc.setFillColor(...colors.lightBg);
            doc.setDrawColor(...colors.border);
            doc.roundedRect(10, startY, pageWidth - 20, 34, 2, 2, 'FD');

            const contractorText = project.includeContractor !== false ? (project.contractor || '—') : '—';
            const consultantText = project.includeConsultant !== false ? (project.consultant || '—') : '—';
            const pRows = [
                ['Project:', project.projectName || '—', 'Client:', project.clientName || '—'],
                ['Location:', project.locationZone || '—', 'Project No:', project.projectNumber || '—'],
                ['Contractor:', contractorText, 'Consultant:', consultantText],
                ['Delivery Mode:', 'Road Transport', 'Condition:', 'Good / Inspected'],
            ];

            pRows.forEach((r, i) => {
                const y = startY + 7.5 + i * 6.8;
                doc.setFontSize(8.5);
                doc.setFont('helvetica', 'bold'); doc.setTextColor(...colors.primary); doc.text(r[0], 14, y);
                doc.setFont(arabicLoaded && hasArabic(r[1]) ? 'Almarai' : 'helvetica', 'normal'); doc.setTextColor(...colors.text);
                doc.text(processText(r[1]), 40, y, { maxWidth: 58 });
                doc.setFont('helvetica', 'bold'); doc.setTextColor(...colors.primary); doc.text(r[2], pageWidth / 2 + 4, y);
                doc.setFont(arabicLoaded && hasArabic(r[3]) ? 'Almarai' : 'helvetica', 'normal'); doc.setTextColor(...colors.text);
                doc.text(processText(r[3]), pageWidth / 2 + 32, y, { maxWidth: 62 });
            });
            return startY + 40;
        };

        // Collect Items (preserve lump-sum / non-zero items cleanly)
        const allItems = [];
        sourceTables.forEach(table => {
            const header = table.header || [];
            const descIdx = header.findIndex(h => /description|desc|disc|item|product/i.test(h));
            const qtyIdx = header.findIndex(h => /qty|quantity|qt/i.test(h));
            const unitIdx = header.findIndex(h => /unit|uom/i.test(h));
            const brandIdx = header.findIndex(h => /brand|maker|origin/i.test(h));

            table.rows.forEach(row => {
                if (row.isHeader || row.isSummary || !row.cells.some(c => c.value)) return;
                const rawQtyStr = qtyIdx > -1 ? String(row.cells[qtyIdx]?.value || '').trim() : '';
                const parsedQty = parseFloat(rawQtyStr.replace(/,/g, ''));
                const descVal = descIdx > -1 ? String(row.cells[descIdx]?.value || '').trim() : '';
                if (!descVal && (isNaN(parsedQty) || parsedQty <= 0)) return;
                const qtyVal = (!isNaN(parsedQty) && parsedQty > 0) ? parsedQty : 1;

                allItems.push({
                    description: descVal || 'N/A',
                    brand: brandIdx > -1 ? (String(row.cells[brandIdx]?.value || '').trim() || '—') : '—',
                    qty: qtyVal,
                    unit: unitIdx > -1 ? (String(row.cells[unitIdx]?.value || '').trim() || 'No.') : 'No.',
                    sectionLabel: row.sectionLabel || '',
                    sectionCategory: row.sectionCategory || '',
                    sectionSubheader: row.sectionSubheader || '',
                    submissionTitle: row.submissionTitle || ''
                });
            });
        });

        const hasCategorizedSections = allItems.some(item => item.sectionLabel);
        const sections = [];
        if (hasCategorizedSections) {
            allItems.forEach(item => {
                const label = item.sectionLabel || 'GENERAL ITEMS';
                const lastSec = sections[sections.length - 1];
                if (!lastSec || lastSec.label !== label) {
                    sections.push({ label, items: [item] });
                } else {
                    lastSec.items.push(item);
                }
            });
        } else {
            sections.push({ label: '', items: allItems });
        }

        let globalSn = 1;
        for (let sIdx = 0; sIdx < sections.length; sIdx++) {
            const sec = sections[sIdx];
            let tableStartY = 80;

            if (hasCategorizedSections) {
                const divMeta = resolveSectionDividerMeta(sec.items, sec.label);
                if (sIdx > 0) doc.addPage();
                drawPdfCategoryDividerPage(doc, {
                    categoryTitle: divMeta.categoryTitle,
                    subheaderTitle: divMeta.subheaderTitle,
                    itemCount: divMeta.itemCount,
                    submissionType: 'DELIVERY NOTE',
                    project,
                    companyName,
                    colors,
                    headerLogoData: dividerHeaderLogo,
                    clientLogoData: clientLogoInfo,
                    calcFitSize,
                    processText
                });

                doc.addPage();
                drawHeader();
                let currentY = sIdx === 0 ? drawProjectCard(35) : 35;

                // Compact section banner right above the section Delivery Note table
                doc.setFillColor(...colors.lightBg);
                doc.setDrawColor(...colors.accent);
                doc.setLineWidth(0.4);
                doc.roundedRect(10, currentY, pageWidth - 20, 9, 1.5, 1.5, 'FD');
                doc.setFontSize(9);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(...colors.primary);
                doc.text(processText(divMeta.fullTitle), 14, currentY + 6);
                tableStartY = currentY + 13;
            } else {
                drawHeader();
                tableStartY = drawProjectCard(35);
            }

            const secQtyTotal = sec.items.reduce((sum, it) => sum + (parseFloat(it.qty) || 0), 0);
            const dnBody = sec.items.map(item => [
                globalSn++,
                processText(item.description),
                processText(item.brand),
                processText(item.unit),
                item.qty,
                ''
            ]);
            dnBody.push([
                { content: `TOTAL DELIVERED (${sec.items.length} Items)`, colSpan: 4, styles: { halign: 'right', fontStyle: 'bold', fillColor: [241, 245, 249], textColor: colors.primary } },
                { content: String(secQtyTotal), styles: { halign: 'center', fontStyle: 'bold', fillColor: [241, 245, 249], textColor: colors.primary } },
                { content: '', styles: { fillColor: [241, 245, 249] } }
            ]);

            autoTable(doc, {
                startY: tableStartY,
                margin: { top: 35, bottom: 16, left: 10, right: 10 },
                head: [['S.N', 'Material Description', 'Brand / Origin', 'Unit', 'Delivered Qty', 'Remarks']],
                body: dnBody,
                theme: 'grid',
                styles: {
                    fontSize: 8,
                    cellPadding: 2.8,
                    font: arabicLoaded ? 'Almarai' : 'helvetica',
                    valign: 'middle',
                    lineColor: colors.border,
                    lineWidth: 0.25
                },
                headStyles: {
                    fillColor: colors.primary,
                    textColor: colors.white,
                    fontStyle: 'bold',
                    halign: 'center'
                },
                alternateRowStyles: {
                    fillColor: [248, 250, 252]
                },
                columnStyles: {
                    0: { cellWidth: 10, halign: 'center' },
                    1: { cellWidth: 'auto' },
                    2: { cellWidth: 34 },
                    3: { cellWidth: 15, halign: 'center' },
                    4: { cellWidth: 24, halign: 'center' },
                    5: { cellWidth: 26 }
                },
                didDrawPage: (data) => {
                    // Draw consistent compact branded header on overflow pages (fixes giant logo overlap!)
                    if (data.pageNumber > 1) {
                        drawHeader();
                    }
                }
            });
        }

        let lastY = (doc.lastAutoTable?.finalY || 120) + 14;
        if (lastY + 32 > pageHeight - 14) {
            doc.addPage();
            drawHeader();
            lastY = 40;
        }

        // Signatures
        const sigNames = ['Prepared By', 'Authorized By', 'Customer Signature'];
        const sigW = 56, sigH = 26;
        const sigGap = (pageWidth - 20 - sigW * 3) / 2;

        sigNames.forEach((name, i) => {
            const x = 10 + i * (sigW + sigGap);
            doc.setFillColor(...colors.white);
            doc.setDrawColor(...colors.border);
            doc.roundedRect(x, lastY, sigW, sigH, 1.5, 1.5, 'FD');
            doc.setFillColor(...colors.lightBg);
            doc.rect(x, lastY, sigW, 6.5, 'F');
            doc.setFontSize(8);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...colors.primary);
            doc.text(name, x + sigW / 2, lastY + 4.5, { align: 'center' });
            doc.setDrawColor(...colors.border);
            doc.line(x + 5, lastY + sigH - 7.5, x + sigW - 5, lastY + sigH - 7.5);
            doc.setFontSize(6.8);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...colors.text);
            doc.text('Signature & Date', x + sigW / 2, lastY + sigH - 2.5, { align: 'center' });
        });

        // Stamp crisp Page X of Y footer across all Delivery Note pages
        const totalDnPages = doc.internal.getNumberOfPages();
        const dnBrandFoot = companyName || 'BOQ FLOW';
        for (let p = 1; p <= totalDnPages; p++) {
            doc.setPage(p);
            doc.setDrawColor(...colors.accent);
            doc.setLineWidth(0.5);
            doc.line(0, pageHeight - 11, pageWidth, pageHeight - 11);
            doc.setFontSize(7.5);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(120, 130, 145);
            doc.text(`${dnBrandFoot}  |  Delivery Note: ${dnRef}`, 10, pageHeight - 5.5);
            doc.text(`Page ${p} of ${totalDnPages}`, pageWidth - 10, pageHeight - 5.5, { align: 'right' });
        }

        doc.save(`DeliveryNote_${dnRef}.pdf`);
    };

    // ===================== PREMIUM POWERPOINT PRESENTATION (LIGHT THEME) =====================
    const handleGeneratePresentation = async (sourceTables, returnBase64 = false, templateId = 'corporate') => {
        const PptxGenJS = (await import('pptxgenjs')).default;
        const pres = new PptxGenJS();
        const totalItems = sourceTables.reduce((acc, t) => acc + collectActiveTableRows(t).length, 0);

        pres.author = companyName || 'BOQFlow';
        pres.title = project.projectName ? `${project.projectName} — Product Presentation` : 'Product Presentation';
        pres.subject = 'Bill of Quantities - Product Showcase';

        const baseColors = getBrandColors(accentColor, secondaryColor);

        let brandColors = { ...baseColors };
        let fontFace = 'Arial';
        let layoutStyle = 'corporate'; // corporate, dark, minimalist, creative, tech

        if (templateId === 'dark') {
            brandColors.bg = '0F172A';
            brandColors.text = 'E2E8F0';
            brandColors.lightText = '94A3B8';
            brandColors.border = '334155';
            brandColors.lightBg = '1E293B';
            fontFace = 'Calibri';
            layoutStyle = 'dark';
        } else if (templateId === 'minimalist') {
            brandColors.bg = 'FFFFFF';
            brandColors.primary = '111111';
            brandColors.accent = baseColors.primary; // Use company primary as accent color
            brandColors.text = '222222';
            brandColors.lightText = '777777';
            brandColors.border = 'E5E5E5';
            brandColors.lightBg = 'FAFAFA';
            fontFace = 'Georgia';
            layoutStyle = 'minimalist';
        } else if (templateId === 'creative') {
            brandColors.bg = 'FAF8F5';
            brandColors.text = '2C2520';
            brandColors.lightText = '70655E';
            brandColors.border = 'E5DFD9';
            brandColors.lightBg = 'F3EFE9';
            fontFace = 'Trebuchet MS';
            layoutStyle = 'creative';
        } else if (templateId === 'tech') {
            brandColors.bg = 'F1F5F9';
            brandColors.primary = '1E293B';
            brandColors.accent = '0D9488';
            brandColors.text = '0F172A';
            brandColors.lightText = '475569';
            brandColors.border = 'CBD5E1';
            brandColors.lightBg = 'E2E8F0';
            fontFace = 'Segoe UI';
            layoutStyle = 'tech';
        }

        // Configure text colors based on template style
        let mainTitleColor = brandColors.primary;
        let subtitleColor = brandColors.lightText;
        let detailsColor = brandColors.lightText;
        let labelColor = brandColors.primary;
        let valueColor = brandColors.text;
        let detailHeaderColor = brandColors.primary;
        let footerLinkColor = brandColors.primary;
        let footerTextColor = brandColors.lightText;
        let headerTextColor = 'FFFFFF';

        if (layoutStyle === 'dark') {
            mainTitleColor = 'FFFFFF';
            subtitleColor = brandColors.accent;
            detailsColor = brandColors.text;
            labelColor = brandColors.accent;
            valueColor = brandColors.text;
            detailHeaderColor = 'FFFFFF';
            footerLinkColor = brandColors.accent;
            footerTextColor = brandColors.lightText;
            headerTextColor = 'FFFFFF';
        } else if (layoutStyle === 'minimalist') {
            mainTitleColor = '111111';
            subtitleColor = '777777';
            detailsColor = '777777';
            labelColor = brandColors.primary;
            valueColor = brandColors.text;
            detailHeaderColor = brandColors.primary;
            footerLinkColor = brandColors.primary;
            footerTextColor = brandColors.lightText;
            headerTextColor = brandColors.primary;
        } else if (layoutStyle === 'tech') {
            mainTitleColor = '1E293B';
            subtitleColor = '0D9488';
            detailsColor = '475569';
            labelColor = brandColors.primary;
            valueColor = brandColors.text;
            detailHeaderColor = brandColors.primary;
            footerLinkColor = brandColors.accent;
            footerTextColor = brandColors.lightText;
            headerTextColor = 'FFFFFF';
        }

        // Pre-load company and client logos for slide header
        let companyLogoData = null;
        let clientLogoData = null;
        const logoToUse = (layoutStyle === 'minimalist' || layoutStyle === 'creative')
            ? (logoOriginal || logoWhite)
            : (logoWhite || logoOriginal);

        if (logoToUse) {
            try {
                companyLogoData = await getImageData(logoToUse, { format: 'image/png', maxWidth: 400 });
            } catch (e) { }
        }
        if (project.clientLogo) {
            try {
                clientLogoData = await getImageData(project.clientLogo, { format: 'image/png', maxWidth: 400 });
            } catch (e) { }
        }

        // Light theme master slide (logos and shapes drawn inside loop so they are editable/movable)
        pres.defineSlideMaster({
            title: 'BOQ_MASTER',
            background: { color: brandColors.bg },
            objects: []
        });

        const drawSlideDecorations = (slideObj) => {
            if (layoutStyle === 'minimalist') {
                // Just a thin top accent line or border
                slideObj.addShape('rect', { x: 0, y: 0, w: '100%', h: 0.05, fill: { color: brandColors.primary } });
                // Divider line below header text
                slideObj.addShape('rect', { x: 0.2, y: 0.8, w: 9.6, h: 0.01, fill: { color: brandColors.border } });
                // Footer divider
                slideObj.addShape('rect', { x: 0.2, y: 5.3, w: 9.6, h: 0.01, fill: { color: brandColors.border } });
            } else if (layoutStyle === 'tech') {
                // Steel blue header bar
                slideObj.addShape('rect', { x: 0, y: 0, w: '100%', h: 0.8, fill: { color: brandColors.primary } });
                // Teal accent line
                slideObj.addShape('rect', { x: 0, y: 0.8, w: '100%', h: 0.05, fill: { color: brandColors.accent } });
                // Cool grid elements or blocky footer
                slideObj.addShape('rect', { x: 0, y: 5.3, w: '100%', h: 0.2, fill: { color: brandColors.lightBg } });
            } else if (layoutStyle === 'dark') {
                // Header bar (dark slate)
                slideObj.addShape('rect', { x: 0, y: 0, w: '100%', h: 0.8, fill: { color: brandColors.lightBg } });
                // Colored accent line
                slideObj.addShape('rect', { x: 0, y: 0.8, w: '100%', h: 0.03, fill: { color: brandColors.accent } });
                // Footer background
                slideObj.addShape('rect', { x: 0, y: 5.3, w: '100%', h: 0.2, fill: { color: brandColors.lightBg } });
            } else {
                // corporate & creative default header bar style
                slideObj.addShape('rect', { x: 0, y: 0, w: '100%', h: 0.8, fill: { color: brandColors.primary } });
                // Gold accent line
                slideObj.addShape('rect', { x: 0, y: 0.8, w: '100%', h: 0.03, fill: { color: brandColors.accent } });
                // Footer background
                slideObj.addShape('rect', { x: 0, y: 5.3, w: '100%', h: 0.2, fill: { color: brandColors.lightBg } });
            }
        };

        // Title Slide
        const titleSlide = pres.addSlide({ masterName: 'BOQ_MASTER' });
        drawSlideDecorations(titleSlide);

        // Draw Company Logo on header of cover slide if available (small, far right)
        if (companyLogoData) {
            const maxW = 1.5;
            const maxH = 0.6;
            const fit = calcFitSize(companyLogoData.width, companyLogoData.height, maxW * 96, maxH * 96);
            const fitW = fit.w / 96;
            const fitH = fit.h / 96;
            const logoX = 9.8 - fitW;
            const centeredY = 0.1 + (0.6 - fitH) / 2;
            titleSlide.addImage({
                data: companyLogoData.dataUrl,
                x: logoX, y: centeredY,
                w: fitW, h: fitH
            });
        }

        // Add prominent client logo centered if uploaded, otherwise company logo (never stretched or distorted)
        if (project.clientLogo && clientLogoData) {
            const maxW = 3.2;
            const maxH = 1.5;
            const fit = calcFitSize(clientLogoData.width, clientLogoData.height, maxW * 96, maxH * 96);
            const fitW = fit.w / 96;
            const fitH = fit.h / 96;
            const centeredX = 3.4 + (3.2 - fitW) / 2;
            const centeredY = 1.2 + (1.5 - fitH) / 2;

            titleSlide.addImage({
                data: clientLogoData.dataUrl,
                x: centeredX, y: centeredY,
                w: fitW, h: fitH
            });
        } else if (companyLogoData) {
            const maxW = 3.2;
            const maxH = 1.5;
            const fit = calcFitSize(companyLogoData.width, companyLogoData.height, maxW * 96, maxH * 96);
            const fitW = fit.w / 96;
            const fitH = fit.h / 96;
            const centeredX = 3.4 + (3.2 - fitW) / 2;
            const centeredY = 1.2 + (1.5 - fitH) / 2;

            titleSlide.addImage({
                data: companyLogoData.dataUrl,
                x: centeredX, y: centeredY,
                w: fitW, h: fitH
            });
        }

        if (project.projectName) {
            titleSlide.addText(project.projectName.toUpperCase(), {
                x: 0, y: 2.8, w: '100%', h: 0.6,
                fontSize: 32, bold: true, color: mainTitleColor, fontFace: fontFace, align: 'center'
            });
        } else {
            titleSlide.addText('PRODUCT SHOWCASE', {
                x: 0, y: 2.8, w: '100%', h: 0.6,
                fontSize: 36, bold: true, color: mainTitleColor, fontFace: fontFace, align: 'center'
            });
        }

        const subtitle = project.clientName ? `Prepared for: ${project.clientName}` : 'Bill of Quantities - Product Presentation';
        titleSlide.addText(subtitle, {
            x: 0, y: 3.4, w: '100%', h: 0.4,
            fontSize: 14, color: subtitleColor, fontFace: fontFace, align: 'center'
        });

        const todayStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
        const contractorText = project.includeContractor !== false ? (project.contractor || '—') : '—';
        const consultantText = project.includeConsultant !== false ? (project.consultant || '—') : '—';

        let detailsPptText = `Date: ${project.issueDate || todayStr}   |   Revision: ${project.revision || 'Rev 0'}`;
        if (project.projectNumber) detailsPptText += `   |   Project No: ${project.projectNumber}`;
        if (project.locationZone) detailsPptText += `   |   Location: ${project.locationZone}`;

        let partiesPptText = '';
        if (project.contractor && project.includeContractor !== false) partiesPptText += `Contractor: ${project.contractor}   `;
        if (project.consultant && project.includeConsultant !== false) partiesPptText += `|   Consultant: ${project.consultant}   `;
        if (project.siteEngineer) partiesPptText += `|   Site Engineer: ${project.siteEngineer}`;

        titleSlide.addText(detailsPptText, {
            x: 0, y: 3.9, w: '100%', h: 0.3, fontSize: 10, color: detailsColor, fontFace: fontFace, align: 'center'
        });

        if (partiesPptText.trim()) {
            titleSlide.addText(partiesPptText.trim(), {
                x: 0, y: 4.2, w: '100%', h: 0.3, fontSize: 9.5, color: detailsColor, fontFace: fontFace, align: 'center'
            });
        }

        let itemNum = 1;
        let lastSection = '';
        const headerSubColor = layoutStyle === 'minimalist' ? '64748B' : 'E2E8F0';

        for (const table of sourceTables) {
            const header = table.header || [];
            let descIdx = header.findIndex(h => !/image|photo|picture|img/i.test(h) && /description|details|spec|specification/i.test(h));
            if (descIdx === -1) {
                descIdx = header.findIndex(h => !/image|photo|picture|img/i.test(h) && /desc|disc|product|item name|particulars/i.test(h));
            }
            const brandIdx = header.findIndex(h => !/image|photo/i.test(h) && /brand|maker|origin|country/i.test(h));
            const qtyIdx = header.findIndex(h => /qty|quantity|qt/i.test(h));
            const finishIdx = header.findIndex(h => /finish|color|material/i.test(h));
            const activeRows = collectActiveTableRows(table);

            for (let rIdx = 0; rIdx < activeRows.length; rIdx++) {
                const row = activeRows[rIdx];
                const currentSection = row.sectionLabel || '';
                if (currentSection && currentSection !== lastSection) {
                    lastSection = currentSection;
                    const groupRows = [];
                    for (let k = rIdx; k < activeRows.length; k++) {
                        if ((activeRows[k]?.sectionLabel || '') !== currentSection) break;
                        groupRows.push(activeRows[k]);
                    }
                    const divMeta = resolveSectionDividerMeta(groupRows, currentSection);
                    addPptxCategoryDividerSlide(pres, {
                        masterName: 'BOQ_MASTER',
                        categoryTitle: divMeta.categoryTitle,
                        subheaderTitle: divMeta.subheaderTitle,
                        itemCount: divMeta.itemCount,
                        colors: {
                            primary: brandColors.primary,
                            accent: brandColors.accent,
                            text: brandColors.text,
                            lightText: brandColors.lightText,
                            lightBg: brandColors.lightBg
                        },
                        drawSlideDecorations,
                        logoData: companyLogoData,
                        calcFitSize,
                        projectName: project.projectName || ''
                    });
                }

                const slide = pres.addSlide({ masterName: 'BOQ_MASTER' });
                drawSlideDecorations(slide);

                // Get all images from the row
                const imageCell = row.cells?.find(c => c?.images?.length > 0 || c?.image);
                const allImages = imageCell?.images || (imageCell?.image ? [imageCell.image] : []);

                // Get product info safely
                let desc = descIdx > -1 ? String(row.cells?.[descIdx]?.value || '').trim() : '';

                // Fallback: If desc is empty, scan row for all non-image, non-numeric description/spec text
                if (!desc && row.cells) {
                    const textParts = [];
                    header.forEach((headerName, i) => {
                        if (!/image|photo|picture|img|qty|quantity|unit|rate|price|amount|total|s\.?no|sl\.?no|item no/i.test(headerName)) {
                            const val = String(row.cells[i]?.value || '').trim();
                            if (val && !textParts.includes(val)) {
                                textParts.push(val);
                            }
                        }
                    });
                    desc = textParts.join(' ');
                }

                const brandVal = brandIdx > -1 ? String(row.cells?.[brandIdx]?.value || '') : '';
                const qty = qtyIdx > -1 ? String(row.cells?.[qtyIdx]?.value || '') : '';
                const finish = finishIdx > -1 ? String(row.cells?.[finishIdx]?.value || '') : '';

                // Extract first line/product name for header title (short, no overflow)
                const firstLine = desc.split(/[\n*•]/)[0].trim();
                const headerTitle = firstLine ? (firstLine.length > 55 ? firstLine.substring(0, 52) + '...' : firstLine) : String(row.cells?.[0]?.value || '');

                let clientLogoW = 0;
                let clientLogoH = 0;
                let clientCenteredY = 0.1;
                // Draw Client Logo on header if available (never stretched or distorted)
                if (clientLogoData) {
                    const maxW = 1.5;
                    const maxH = 0.6;
                    const fit = calcFitSize(clientLogoData.width, clientLogoData.height, maxW * 96, maxH * 96);
                    clientLogoW = fit.w / 96;
                    clientLogoH = fit.h / 96;
                    clientCenteredY = 0.1 + (0.6 - clientLogoH) / 2;
                    slide.addImage({
                        data: clientLogoData.dataUrl,
                        x: 0.2, y: clientCenteredY,
                        w: clientLogoW, h: clientLogoH
                    });
                }

                let companyLogoW = 0;
                let companyLogoH = 0;
                let companyCenteredY = 0.1;
                // Draw Company Logo on header if available (never stretched or distorted)
                if (companyLogoData) {
                    const maxW = 1.5;
                    const maxH = 0.6;
                    const fit = calcFitSize(companyLogoData.width, companyLogoData.height, maxW * 96, maxH * 96);
                    companyLogoW = fit.w / 96;
                    companyLogoH = fit.h / 96;
                    companyCenteredY = 0.1 + (0.6 - companyLogoH) / 2;
                    const logoX = 9.8 - companyLogoW;
                    slide.addImage({
                        data: companyLogoData.dataUrl,
                        x: logoX, y: companyCenteredY,
                        w: companyLogoW, h: companyLogoH
                    });
                }

                // Dynamically offset titleX and titleW based on logos width to prevent any overlapping
                const titleX = clientLogoData ? (0.2 + clientLogoW + 0.15) : 0.2;
                const titleW = 10 - titleX - (companyLogoData ? (companyLogoW + 0.15) : 0.2);
                const titleSub = row.submissionTitle || row.sectionLabel;

                slide.addText(`Item ${itemNum}: ${headerTitle}`, {
                    x: titleX, y: titleSub ? 0.08 : 0.15, w: titleW, h: titleSub ? 0.36 : 0.4,
                    fontSize: 14, color: headerTextColor, bold: true, fontFace: fontFace, valign: 'middle'
                });
                if (titleSub) {
                    slide.addText(String(titleSub), {
                        x: titleX, y: 0.45, w: titleW, h: 0.24,
                        fontSize: 9.5, color: headerSubColor, fontFace: fontFace, valign: 'middle'
                    });
                }

                // ===== LEFT SIDE: IMAGE(S) - Pre-load and calculate exact dimensions =====
                const imgAreaX = 0.25;
                const imgAreaY = 0.95;
                const imgAreaW = 4.5;
                const imgAreaH = 4.1;

                // Image container background
                slide.addShape('rect', {
                    x: imgAreaX, y: imgAreaY, w: imgAreaW, h: imgAreaH,
                    fill: { color: brandColors.lightBg },
                    line: { color: brandColors.border, pt: 0.5 }
                });

                // Pre-load all images in parallel to get actual dimensions instantly
                const loadedImages = (await Promise.all(
                    allImages.slice(0, 4).map(img => {
                        const rawImgUrl = extractImageUrl(img);
                        return rawImgUrl ? getImageData(getFullUrl(rawImgUrl)) : null;
                    })
                )).filter(Boolean);

                // Helper to convert inches to pixels for aspect ratio calc (96 DPI)
                const inchesToPx = (inches) => inches * 96;
                const pxToInches = (px) => px / 96;

                if (loadedImages.length === 0) {
                    slide.addText('No Product Image Available', {
                        x: imgAreaX, y: imgAreaY + imgAreaH / 2 - 0.25, w: imgAreaW, h: 0.5,
                        fontSize: 11, italic: true, color: footerTextColor, fontFace: fontFace, align: 'center', valign: 'middle'
                    });
                } else if (loadedImages.length === 1) {
                    // Single image - calculate exact fit dimensions
                    const img = loadedImages[0];
                    const maxW = imgAreaW - 0.2;
                    const maxH = imgAreaH - 0.2;

                    // Calculate fit size in pixels then convert back
                    const maxWpx = inchesToPx(maxW);
                    const maxHpx = inchesToPx(maxH);
                    const fit = calcFitSize(img.width, img.height, maxWpx, maxHpx);
                    const fitW = pxToInches(fit.w);
                    const fitH = pxToInches(fit.h);

                    // Center the image
                    const centeredX = imgAreaX + (imgAreaW - fitW) / 2;
                    const centeredY = imgAreaY + (imgAreaH - fitH) / 2;

                    slide.addImage({
                        data: img.dataUrl,
                        x: centeredX,
                        y: centeredY,
                        w: fitW,
                        h: fitH,
                        sizing: { type: 'contain', w: fitW, h: fitH }
                    });
                } else if (loadedImages.length === 2) {
                    // 2 images - side by side with exact dimensions
                    const cellW = (imgAreaW - 0.3) / 2;
                    const cellH = imgAreaH - 0.2;
                    const maxWpx = inchesToPx(cellW);
                    const maxHpx = inchesToPx(cellH);

                    loadedImages.forEach((img, idx) => {
                        const fit = calcFitSize(img.width, img.height, maxWpx, maxHpx);
                        const fitW = pxToInches(fit.w);
                        const fitH = pxToInches(fit.h);

                        const cellX = imgAreaX + 0.1 + idx * (cellW + 0.1);
                        const centeredX = cellX + (cellW - fitW) / 2;
                        const centeredY = imgAreaY + (imgAreaH - fitH) / 2;

                        slide.addImage({
                            data: img.dataUrl,
                            x: centeredX,
                            y: centeredY,
                            w: fitW,
                            h: fitH,
                            sizing: { type: 'contain', w: fitW, h: fitH }
                        });
                    });
                } else if (loadedImages.length >= 3) {
                    // 3+ images - 2x2 grid with exact dimensions
                    const cols = 2;
                    const rows = 2;
                    const cellW = (imgAreaW - 0.3) / cols;
                    const cellH = (imgAreaH - 0.3) / rows;
                    const maxWpx = inchesToPx(cellW);
                    const maxHpx = inchesToPx(cellH);

                    loadedImages.slice(0, 4).forEach((img, idx) => {
                        const col = idx % cols;
                        const rowNum = Math.floor(idx / cols);

                        const fit = calcFitSize(img.width, img.height, maxWpx, maxHpx);
                        const fitW = pxToInches(fit.w);
                        const fitH = pxToInches(fit.h);

                        const cellX = imgAreaX + 0.1 + col * (cellW + 0.1);
                        const cellY = imgAreaY + 0.1 + rowNum * (cellH + 0.1);
                        const centeredX = cellX + (cellW - fitW) / 2;
                        const centeredY = cellY + (cellH - fitH) / 2;

                        slide.addImage({
                            data: img.dataUrl,
                            x: centeredX,
                            y: centeredY,
                            w: fitW,
                            h: fitH,
                            sizing: { type: 'contain', w: fitW, h: fitH }
                        });
                    });

                    // Show indicator if more images exist
                    if (allImages.length > 4) {
                        slide.addText(`+${allImages.length - 4} more`, {
                            x: imgAreaX + imgAreaW - 0.8, y: imgAreaY + imgAreaH - 0.3, w: 0.7, h: 0.2,
                            fontSize: 8, color: footerTextColor, fontFace: fontFace, align: 'right'
                        });
                    }
                }

                // ===== RIGHT SIDE: PRODUCT DETAILS =====
                const detailX = 5.0;
                const detailW = 4.7;

                // "Product Details" Header
                slide.addText('Product Details', {
                    x: detailX, y: 0.95, w: detailW, h: 0.35,
                    fontSize: 18, bold: true, color: detailHeaderColor, fontFace: fontFace
                });

                // Description sub-section
                slide.addText('Description:', {
                    x: detailX, y: 1.35, w: detailW, h: 0.25,
                    fontSize: 11, bold: true, color: labelColor, fontFace: fontFace
                });

                // Full description with word wrap - dynamic font size to prevent overlapping sections below
                const fullDesc = desc.trim();
                const estimatedLines = fullDesc.split('\n').reduce((acc, line) => {
                    return acc + Math.max(1, Math.ceil(line.length / 60));
                }, 0);

                let descFontSize = 9.5;
                if (estimatedLines > 28) {
                    descFontSize = 6.5;
                } else if (estimatedLines > 20) {
                    descFontSize = 7.5;
                } else if (estimatedLines > 12) {
                    descFontSize = 8.5;
                }

                slide.addText(fullDesc, {
                    x: detailX, y: 1.6, w: detailW, h: 3.1,
                    fontSize: descFontSize, color: valueColor, fontFace: fontFace, valign: 'top',
                    wrap: true, shrinkText: true
                });

                // Brand, Qty & Finish inside a clean architectural metadata card
                const rowBrand = brandVal.trim();
                const brand = rowBrand || project.brand || project.brandOrigin || companyName || 'N/A';
                const cleanFinish = finish.trim();

                const metaCardY = cleanFinish ? 4.46 : 4.64;
                const metaCardH = cleanFinish ? 0.62 : 0.44;
                slide.addShape('rect', {
                    x: detailX, y: metaCardY, w: detailW, h: metaCardH,
                    fill: { color: brandColors.lightBg },
                    line: { color: brandColors.border, pt: 0.5 }
                });
                slide.addShape('rect', {
                    x: detailX, y: metaCardY, w: 0.06, h: metaCardH,
                    fill: { color: brandColors.accent }
                });

                slide.addText('Brand:', {
                    x: detailX + 0.14, y: metaCardY + 0.04, w: 0.65, h: 0.34,
                    fontSize: 9.5, bold: true, color: labelColor, fontFace: fontFace, valign: 'middle'
                });
                slide.addText(brand, {
                    x: detailX + 0.78, y: metaCardY + 0.04, w: 1.9, h: 0.34,
                    fontSize: 9.5, bold: true, color: valueColor, fontFace: fontFace, valign: 'middle'
                });

                slide.addText('Qty:', {
                    x: detailX + 2.75, y: metaCardY + 0.04, w: 0.45, h: 0.34,
                    fontSize: 9.5, bold: true, color: labelColor, fontFace: fontFace, valign: 'middle'
                });
                slide.addText(qty || 'As per BOQ', {
                    x: detailX + 3.2, y: metaCardY + 0.04, w: 1.4, h: 0.34,
                    fontSize: 9.5, bold: true, color: valueColor, fontFace: fontFace, valign: 'middle'
                });

                if (cleanFinish) {
                    slide.addText('Finish:', {
                        x: detailX + 0.14, y: metaCardY + 0.34, w: 0.65, h: 0.24,
                        fontSize: 8.5, bold: true, color: labelColor, fontFace: fontFace, valign: 'middle'
                    });
                    slide.addText(cleanFinish.slice(0, 80), {
                        x: detailX + 0.78, y: metaCardY + 0.34, w: detailW - 0.9, h: 0.24,
                        fontSize: 8.5, color: valueColor, fontFace: fontFace, valign: 'middle'
                    });
                }

                // ===== FOOTER =====
                // Warranty notice
                slide.addText('Warranty: As per manufacturer (5 years)', {
                    x: 0.2, y: 5.31, w: 3.1, h: 0.17,
                    fontSize: 7.5, color: footerTextColor, fontFace: fontFace, valign: 'middle'
                });

                // Page URL/reference (only render if company website is configured)
                if (website) {
                    slide.addText(website, {
                        x: 3.4, y: 5.31, w: 3.2, h: 0.17,
                        fontSize: 7.5, color: footerLinkColor, fontFace: fontFace, align: 'center', valign: 'middle'
                    });
                }

                // Page number
                slide.addText(`${itemNum} / ${totalItems}`, {
                    x: 8.5, y: 5.31, w: 1.3, h: 0.17,
                    fontSize: 7.5, bold: true, color: footerTextColor, fontFace: fontFace, align: 'right', valign: 'middle'
                });

                itemNum++;
            }
        }

        // Executive Closing Slide
        const closingSlide = pres.addSlide({ masterName: 'BOQ_MASTER' });
        drawSlideDecorations(closingSlide);
        if (companyLogoData) {
            const fit = calcFitSize(companyLogoData.width, companyLogoData.height, 2.8 * 96, 1.1 * 96);
            const fitW = fit.w / 96;
            const fitH = fit.h / 96;
            closingSlide.addImage({
                data: companyLogoData.dataUrl,
                x: (10 - fitW) / 2, y: 1.4, w: fitW, h: fitH
            });
        }
        closingSlide.addText('THANK YOU', {
            x: 0, y: 2.75, w: '100%', h: 0.65,
            fontSize: 32, bold: true, color: mainTitleColor, fontFace: fontFace, align: 'center'
        });
        closingSlide.addText(
            `${project.projectName || 'Commercial FF&E Proposal'}  •  ${totalItems} Presented Items`,
            {
                x: 0.8, y: 3.45, w: 8.4, h: 0.35,
                fontSize: 12, color: subtitleColor, fontFace: fontFace, align: 'center'
            }
        );
        const closingContact = [companyName, website].filter(Boolean).join('   |   ');
        if (closingContact) {
            closingSlide.addText(closingContact, {
                x: 0.8, y: 4.1, w: 8.4, h: 0.3,
                fontSize: 10, bold: true, color: footerLinkColor, fontFace: fontFace, align: 'center'
            });
        }

        if (returnBase64) {
            return await pres.write({ outputType: 'base64' });
        } else {
            const safeProj = (project.projectName || 'BOQ').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 32) || 'BOQ';
            await pres.writeFile({ fileName: `${safeProj}_Presentation_${templateId}.pptx` });
        }
    };

    const triggerPptxExport = (sourceTables, asPdf = false, isCosted = false) => {
        setPptxSourceTables(sourceTables);
        setPptxAsPdf(asPdf);
        setPptxIsCosted(isCosted);
        setShowPptxModal(true);
    };

    const handleTemplateModalExport = async (templateId) => {
        setShowPptxModal(false);
        if (!pptxSourceTables) return;

        const actionKey = (pptxAsPdf ? 'pdf_' : 'pptx_') + (pptxIsCosted ? 'costed' : 'original');
        setGeneratingType(actionKey);

        try {
            if (pptxAsPdf) {
                await handleGeneratePptPdf(pptxSourceTables, templateId);
            } else {
                await handleGeneratePresentation(pptxSourceTables, false, templateId);
            }
        } catch (err) {
            console.error(err);
            alert(`Export failed: ${err.message}`);
        } finally {
            setGeneratingType(null);
        }
    };

    // ===================== PREMIUM PRESENTATION PDF =====================
    const handleGeneratePptPdf = async (sourceTables, templateId = 'corporate') => {
        try {
            console.log(` [Frontend] Generating PPTX natively with template ${templateId} to send for PDF conversion...`);

            // Generate the PPTX natively in frontend to ensure identical styling
            const pptxBase64 = await handleGeneratePresentation(sourceTables, true, templateId);

            const payload = {
                pptxBase64: pptxBase64
            };

            const response = await fetch(`${API_BASE}/api/generate-pptx-pdf`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                let errorText = 'Server failed to generate presentation';
                try {
                    const errData = await response.json();
                    errorText = errData.error || errData.message || errorText;
                } catch (jsonErr) {
                    const rawText = await response.text().catch(() => '');
                    if (rawText.includes('Request Entity Too Large') || response.status === 413) {
                        errorText = 'Presentation size exceeds payload limit (413). Please export directly as PPTX.';
                    } else if (rawText) {
                        errorText = rawText.slice(0, 150);
                    }
                }
                throw new Error(errorText);
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const contentDisposition = response.headers.get('Content-Disposition');
            const fileName = contentDisposition?.split('filename=')[1]?.replace(/"/g, '') || 'presentation_export.pdf';
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            console.log(' [Background] Presentation PDF downloaded.');
        } catch (err) {
            console.error(' [Background] Presentation PDF error:', err);
            alert(`Failed to generate high-fidelity PDF: ${err.message}.`);
        }
    };

    const handleGeneratePptPdfOld = async (sourceTables) => {

        const doc = new jsPDF({ orientation: 'landscape' });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();

        const brandColors = getBrandColors(accentColor, secondaryColor);
        const colors = {
            primary: brandColors.primaryRgb,
            accent: brandColors.accentRgb,
            text: brandColors.textRgb,
            lightText: brandColors.lightTextRgb,
            bg: brandColors.bgRgb,
            lightBg: brandColors.lightBgRgb,
            border: brandColors.borderRgb
        };

        const arabicLoaded = await loadArabicFont(doc);
        const processText = (txt) => (arabicLoaded && hasArabic(txt)) ? fixArabic(txt) : String(txt || '');
        const { headerLogoData, clientLogoData } = await loadSubmissionLogos();

        let itemNumber = 1;
        const pageAddedRef = { value: true };
        const lastSectionRef = { value: '' };
        const totalItems = sourceTables.reduce((acc, t) => acc + collectActiveTableRows(t).length, 0);

        // ===== TITLE PAGE =====
        doc.setFillColor(...colors.bg);
        doc.rect(0, 0, pageWidth, pageHeight, 'F');
        doc.setFillColor(...colors.primary);
        doc.rect(0, 0, pageWidth, 55, 'F');
        doc.setFillColor(...colors.accent);
        doc.rect(0, 55, pageWidth, 2, 'F');

        doc.setTextColor(...colors.bg);
        doc.setFontSize(28);
        doc.setFont('helvetica', 'bold');
        doc.text('PRODUCT SHOWCASE', pageWidth / 2, 22, { align: 'center' });

        doc.setTextColor(...colors.text);
        doc.setFontSize(14);
        doc.setFont('helvetica', 'normal');
        doc.text('Bill of Quantities - Product Presentation', pageWidth / 2, 55, { align: 'center' });

        const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
        doc.setFontSize(10);
        doc.setTextColor(...colors.lightText);
        doc.text(`Date: ${today}  |  Total Items: ${totalItems}`, pageWidth / 2, 68, { align: 'center' });

        // ===== PRODUCT PAGES =====
        for (const table of sourceTables) {
            const header = table.header || [];
            const descIdx = header.findIndex(h => /description|desc/i.test(h));
            const brandIdx = header.findIndex(h => /brand|maker|origin/i.test(h));
            const qtyIdx = header.findIndex(h => /qty|quantity/i.test(h));
            const finishIdx = header.findIndex(h => /finish|color|material/i.test(h));
            const activeRows = collectActiveTableRows(table);

            for (let rIdx = 0; rIdx < activeRows.length; rIdx++) {
                const row = activeRows[rIdx];
                maybeInsertSubmissionDividerPage(doc, {
                    row,
                    tableRows: activeRows,
                    rowIdx: rIdx,
                    lastSectionRef,
                    pageAddedRef,
                    submissionType: 'PRODUCT PRESENTATION',
                    colors,
                    headerLogoData,
                    clientLogoData,
                    processText
                });

                doc.addPage();

                // Background
                doc.setFillColor(...colors.bg);
                doc.rect(0, 0, pageWidth, pageHeight, 'F');

                // Get all images and data
                const imageCell = row.cells.find(c => c.images?.length > 0 || c.image);
                const allImages = imageCell?.images || (imageCell?.image ? [imageCell.image] : []);

                const desc = descIdx > -1 ? String(row.cells[descIdx].value || '') : '';
                const rowBrand = brandIdx > -1 ? String(row.cells[brandIdx].value || '').trim() : '';
                const brand = rowBrand || project.brand || project.brandOrigin || companyName || 'N/A';
                const qty = qtyIdx > -1 ? String(row.cells[qtyIdx].value || '') : '';
                const finish = finishIdx > -1 ? String(row.cells[finishIdx].value || '') : '';

                // Truncate description for title
                const titleText = desc.length > 70 ? desc.substring(0, 67) + '...' : desc;

                // ===== HEADER BAR =====
                doc.setFillColor(...colors.primary);
                doc.rect(0, 0, pageWidth, 55, 'F');
                doc.setFillColor(...colors.accent);
                doc.rect(0, 55, pageWidth, 2, 'F');

                doc.setTextColor(...colors.bg);
                doc.setFontSize(14);
                doc.setFont(arabicLoaded ? 'Almarai' : 'helvetica', 'bold');

                const fullTitle = `Item ${itemNumber}: ${titleText}`;
                const titleLines = doc.splitTextToSize(processText(fullTitle), pageWidth - 100);
                let currentTitleY = 25;
                titleLines.slice(0, 2).forEach(tl => {
                    doc.text(tl, 8, currentTitleY);
                    currentTitleY += 8;
                });
                if (row.submissionTitle || row.sectionLabel) {
                    doc.setFontSize(9);
                    doc.setFont('helvetica', 'normal');
                    doc.text(processText(String(row.submissionTitle || row.sectionLabel)), 8, 48);
                }

                // Company logo area (top right)
                // This PDF version has a white background in the header area, so prefer original logo
                const pptPdfLogo = logoWhite || logoOriginal;
                if (pptPdfLogo) {
                    try {
                        const logoImg = await getImageData(pptPdfLogo);
                        if (logoImg) {
                            const fit = calcFitSize(logoImg.width, logoImg.height, 80, 28);
                            doc.addImage(logoImg.dataUrl, 'PNG', pageWidth - 10 - fit.w, 8, fit.w, fit.h);
                        }
                    } catch (e) { }
                } else {
                    doc.setTextColor(...colors.lightText);
                    doc.setFontSize(7);
                    doc.setFont('helvetica', 'normal');
                    doc.text(companyName || 'BOQ FLOW', pageWidth - 23, 14, { align: 'center' });
                }

                // ===== LEFT SIDE: IMAGE(S) =====
                const imgAreaX = 8;
                const imgAreaY = 65;
                const imgAreaW = 125;
                const imgAreaH = 100;

                // Image container background
                doc.setFillColor(...colors.lightBg);
                doc.setDrawColor(...colors.border);
                doc.setLineWidth(0.5);
                doc.roundedRect(imgAreaX, imgAreaY, imgAreaW, imgAreaH, 3, 3, 'FD');

                // Load and draw images
                const imageResults = [];
                for (const img of allImages.slice(0, 4)) {
                    const rawImgUrl = extractImageUrl(img);
                    if (rawImgUrl) {
                        try {
                            const imgResult = await getImageData(getFullUrl(rawImgUrl));
                            if (imgResult) imageResults.push(imgResult);
                        } catch (e) { }
                    }
                }

                if (imageResults.length === 1) {
                    // Single image - centered with aspect ratio
                    const img = imageResults[0];
                    const maxW = imgAreaW - 6;
                    const maxH = imgAreaH - 6;
                    const fit = calcFitSize(img.width, img.height, maxW, maxH);
                    const centeredX = imgAreaX + (imgAreaW - fit.w) / 2;
                    const centeredY = imgAreaY + (imgAreaH - fit.h) / 2;
                    doc.addImage(img.dataUrl, 'PNG', centeredX, centeredY, fit.w, fit.h, '', 'FAST');
                } else if (imageResults.length === 2) {
                    // 2 images - side by side
                    const imgW = (imgAreaW - 10) / 2;
                    const imgH = imgAreaH - 6;
                    imageResults.forEach((img, idx) => {
                        const fit = calcFitSize(img.width, img.height, imgW, imgH);
                        const x = imgAreaX + 3 + idx * (imgW + 4) + (imgW - fit.w) / 2;
                        const y = imgAreaY + 3 + (imgH - fit.h) / 2;
                        doc.addImage(img.dataUrl, 'PNG', x, y, fit.w, fit.h, '', 'FAST');
                    });
                } else if (imageResults.length >= 3) {
                    // 3+ images - 2x2 grid
                    const cols = 2;
                    const gridRows = 2;
                    const imgW = (imgAreaW - 12) / cols;
                    const imgH = (imgAreaH - 12) / gridRows;

                    imageResults.slice(0, 4).forEach((img, idx) => {
                        const col = idx % cols;
                        const gridRow = Math.floor(idx / cols);
                        const fit = calcFitSize(img.width, img.height, imgW, imgH);
                        const x = imgAreaX + 4 + col * (imgW + 4) + (imgW - fit.w) / 2;
                        const y = imgAreaY + 4 + gridRow * (imgH + 4) + (imgH - fit.h) / 2;
                        doc.addImage(img.dataUrl, 'JPEG', x, y, fit.w, fit.h, '', 'FAST');
                    });

                    // Show indicator if more images exist
                    if (allImages.length > 4) {
                        doc.setTextColor(...colors.lightText);
                        doc.setFontSize(7);
                        doc.text(`+${allImages.length - 4} more`, imgAreaX + imgAreaW - 3, imgAreaY + imgAreaH - 3, { align: 'right' });
                    }
                }

                // ===== RIGHT SIDE: PRODUCT DETAILS =====
                const detailX = imgAreaX + imgAreaW + 10;
                const detailW = pageWidth - detailX - 8;
                let detailY = 35;

                // "Product Details" Header
                doc.setTextColor(...colors.primary);
                doc.setFontSize(16);
                doc.setFont(arabicLoaded ? 'Almarai' : 'helvetica', 'bold');
                doc.text(processText('Product Details'), detailX, detailY);
                detailY += 10;

                // Description sub-section
                doc.setTextColor(...colors.text);
                doc.setFontSize(10);
                doc.setFont('helvetica', 'bold');
                doc.text('Description:', detailX, detailY);
                detailY += 5;

                doc.setFont(arabicLoaded ? 'Almarai' : 'helvetica', 'normal');
                const descText = desc.trim();

                // Estimate lines count to scale text size dynamically
                const rawLinesDefault = doc.splitTextToSize(processText(descText), detailW);
                let descFontSize = 9.5;
                let lineSpacing = 4.8;

                if (rawLinesDefault.length > 16) {
                    descFontSize = 6.5;
                    lineSpacing = 3.2;
                } else if (rawLinesDefault.length > 12) {
                    descFontSize = 7.5;
                    lineSpacing = 3.8;
                } else if (rawLinesDefault.length > 8) {
                    descFontSize = 8.5;
                    lineSpacing = 4.2;
                }

                doc.setFontSize(descFontSize);
                const rawLines = doc.splitTextToSize(processText(descText), detailW);
                const displayLines = rawLines.slice(0, 14);

                displayLines.forEach((line) => {
                    doc.text(line, detailX, detailY);
                    detailY += lineSpacing;
                });
                detailY += 4;

                // Brand and Qty — anchored above footer in dark navy
                const brandQtyY = pageHeight - 30;
                doc.setTextColor(...colors.primary);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(10);
                doc.text('Brand:', detailX, brandQtyY);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(...colors.text);
                doc.text(brand || 'N/A', detailX + 22, brandQtyY);

                doc.setTextColor(...colors.primary);
                doc.setFont('helvetica', 'bold');
                doc.text('Qty:', detailX + 60, brandQtyY);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(...colors.text);
                doc.text(qty || 'As per BOQ', detailX + 75, brandQtyY);

                // ===== FOOTER =====
                doc.setFillColor(...colors.lightBg);
                doc.rect(0, pageHeight - 15, pageWidth, 15, 'F');

                // Warranty notice
                doc.setTextColor(...colors.primary);
                doc.setFontSize(8);
                doc.setFont('helvetica', 'bold');
                doc.text('Warranty', 8, pageHeight - 9);
                doc.setTextColor(...colors.lightText);
                doc.setFontSize(7);
                doc.setFont('helvetica', 'normal');
                doc.text('As per manufacturer - 5 years', 8, pageHeight - 4);

                // Page URL/reference
                doc.setTextColor(...colors.primary);
                doc.setFontSize(7);
                const footerVal = profile.website || profile.companyName || 'BOQ FLOW';
                const footerIsAr = hasArabic(footerVal);
                doc.setFont(footerIsAr && arabicLoaded ? 'Almarai' : 'helvetica', 'normal');
                doc.text(footerIsAr ? fixArabic(footerVal) : footerVal, pageWidth / 2, pageHeight - 6, { align: 'center' });

                // Page number
                doc.setTextColor(...colors.lightText);
                doc.text(`${itemNumber} / ${totalItems}`, pageWidth - 8, pageHeight - 6, { align: 'right' });

                itemNumber++;
            }
        }
        doc.save('presentation_export.pdf');
    };

    // Helper to format numbers with max 3 decimals and thousand separators
    const formatNumber = (value, header) => {
        if (!value) return value;
        const strVal = String(value).trim();

        // Only format if the column is a known numeric type
        const isMoneyCol = /rate|price|amount|total(?!.*(qty|quantity))/i.test(header || '');
        const isQtyCol = /qty|quantity/i.test(header || '');

        // Skip formatting for description/text columns
        if (!isMoneyCol && !isQtyCol) return value;

        // Check if value is purely numeric (with optional commas and decimals)
        // This regex ensures we don't format text like "45 series..." or "1/2 x 3/8..."
        const cleanVal = strVal.replace(/,/g, '');
        if (!/^-?\d+(\.\d+)?$/.test(cleanVal)) return value;

        const num = parseFloat(cleanVal);
        if (isNaN(num)) return value;

        if (isQtyCol) {
            // For qty columns: no forced decimals
            return num.toLocaleString(undefined, { maximumFractionDigits: 0 });
        }

        // For money columns: max 3 decimals, thousand separators
        return num.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 3
        });
    };

    // Helper to get brand logo URL (Clearbit API fallback)
    const getBrandLogo = (brandName) => {
        if (!brandName) return null;
        const cleanName = String(brandName).trim();
        if (!cleanName || cleanName === '-' || cleanName.toLowerCase() === 'n/a') return null;

        // 1. Try to find website in allBrands first
        const brandObj = (allBrands || []).find(b => b.name?.toLowerCase() === cleanName.toLowerCase());

        // 2. Clearbit API with target domain if website exists
        if (brandObj && brandObj.website) {
            try {
                const domain = brandObj.website.replace(/^https?:\/\//, '').split('/')[0];
                if (domain && domain.includes('.')) {
                    return `https://logo.clearbit.com/${domain}?size=200`;
                }
            } catch (e) {
                // Ignore parsing errors
            }
        }

        // 3. Fallback: Guess domain (works for 90% of global brands like Herman Miller => hermanmiller.com)
        const guessDomain = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com';
        return `https://logo.clearbit.com/${guessDomain}?size=200`;
    };

    // Helper to render a table list
    const renderTableList = (dataTables, isCosted) => (
        dataTables.map((table, tableIndex) => (
            <div key={`${isCosted ? 'costed' : 'orig'}-${tableIndex}`} className={styles.tableCard}
                style={isCosted ? { border: '1px solid #f59e0b', background: 'rgba(245, 158, 11, 0.05)' } : {}}>
                <div className={styles.tableHeader}>
                    <h3 className={styles.sheetName} style={isCosted ? { color: '#f59e0b' } : {}} >
                        {isCosted ? ' ' : ''}Sheet: {table.sheetName} {isCosted ? '(Costed)' : ''}
                    </h3>
                    <div className={styles.tableHeaderMeta}>
                        {!isCosted && removedColumns.some(c => c.tableIndex === tableIndex) && (
                            <button
                                type="button"
                                className={styles.restoreColumnBtn}
                                onClick={() => handleRestoreColumn(tableIndex)}
                                title="Put the last removed column back"
                            >
                                ↶ Restore column
                            </button>
                        )}
                        <span className={styles.rowCount}>
                            {table.rows.length} rows × {table.header?.length ?? table.columnCount} columns
                        </span>
                    </div>
                </div>

                <div className={styles.tableWrapper}>
                    <table className={styles.table}>
                        <thead>
                            {table.header && (
                                <tr className={styles.headerRow}>
                                    {table.header.map((h, i) => (
                                        <th key={i} className={styles.colHeadCell}>
                                            <span className={styles.colHead}>
                                                <span
                                                    className={styles.colHeadLabel}
                                                    contentEditable={!isCosted}
                                                    suppressContentEditableWarning
                                                    title={isCosted ? undefined : 'Click to rename'}
                                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                                                    onBlur={(e) => !isCosted && handleRenameColumn(tableIndex, i, e.currentTarget.innerText)}
                                                >{h}</span>
                                                {!isCosted && (
                                                    <button
                                                        type="button"
                                                        className={styles.colAddBtn}
                                                        onClick={() => handleAddColumn(tableIndex, i)}
                                                        title={`Add a column after "${h || i + 1}"`}
                                                        aria-label={`Add a column after ${h || i + 1}`}
                                                    >
                                                        +
                                                    </button>
                                                )}
                                                {!isCosted && table.header.length > 1 && (
                                                    <button
                                                        type="button"
                                                        className={styles.colRemoveBtn}
                                                        onClick={() => handleRemoveColumn(tableIndex, i)}
                                                        title={`Remove column "${h || i + 1}"`}
                                                        aria-label={`Remove column ${h || i + 1}`}
                                                    >
                                                        ×
                                                    </button>
                                                )}
                                            </span>
                                        </th>
                                    ))}
                                    <th className={styles.actionCell}>Actions</th>
                                </tr>
                            )}
                        </thead>
                        <tbody>
                            {table.rows.map((row, rowIndex) => {
                                const prevRow = rowIndex > 0 ? table.rows[rowIndex - 1] : null;
                                const showSectionHeader = row.sectionLabel && (!prevRow || prevRow.sectionLabel !== row.sectionLabel);

                                return (
                                    <React.Fragment key={rowIndex}>
                                        {showSectionHeader && (
                                            <tr className={styles.sectionHeaderRow}>
                                                <td colSpan={(table.header?.length || 0) + 1} className={styles.sectionHeaderCell}>
                                                    <div className={styles.sectionHeaderContent}>
                                                        <span className={styles.sectionIcon}></span>
                                                        <span className={styles.sectionTitleText}>{row.sectionLabel}</span>
                                                        {row.pageNum && <span className={styles.sectionPageBadge}>Page {row.pageNum}</span>}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                        <tr className={row.isHeader ? styles.headerRow : ''}>
                                            {(row.cells || []).map((cell, cellIndex) => {
                                                const CellTag = row.isHeader ? 'th' : 'td';
                                                const cellValue = cell && cell.value !== undefined ? cell.value : '';
                                                const isSnCol = cellIndex === 0 || /^(s\.?n\.?|sl\.?no\.?|sr\.?no\.?|item\s*#?|item\s*no\.?|#|no\.?)$/i.test(String(table.header?.[cellIndex] || '').trim());

                                                return (
                                                    <CellTag key={cellIndex} className={`${styles.cell} ${cell?.images?.length || /brand\s*(img|logo|image)/i.test(table.header?.[cellIndex]) ? styles.imageCell : ''}`}>
                                                        {(() => {
                                                            const headerName = table.header?.[cellIndex] || '';
                                                            const isBrandImgCol = /brand\s*(img|logo|image)/i.test(headerName);

                                                            if (isBrandImgCol) {
                                                                // Find the BRAND column name to fetch the correct logo
                                                                const brandIdx = table.header.findIndex(h => /brand/i.test(h) && !/img|logo|image/i.test(h));
                                                                const brandName = brandIdx !== -1 ? row.cells[brandIdx]?.value : null;
                                                                const logo = getBrandLogo(brandName);

                                                                if (logo) {
                                                                    return (
                                                                        <div className={styles.brandLogoWrapper}>
                                                                            <img
                                                                                src={logo}
                                                                                alt={brandName}
                                                                                className={styles.brandLogo}
                                                                                onClick={() => setSelectedImage(logo)}
                                                                                onError={(e) => { e.target.style.display = 'none'; }}
                                                                                style={{ cursor: 'pointer' }}
                                                                            />
                                                                        </div>
                                                                    );
                                                                }
                                                            }

                                                            // Standard extraction image fallback or image column (strictly verified)
                                                            const isImageCol = /\b(image|photo|picture|img|pic|illustration|drawing|sketch)\b/i.test(headerName) || /\b(image\s*ref|photo\s*ref|pic\s*ref)\b/i.test(headerName);
                                                            if (cell && isImageCol) {
                                                                const rawImages = cell.images && cell.images.length > 0 ? cell.images : (cell.image ? [cell.image] : []);
                                                                const cellId = `tbl_${tableIndex}_row_${rowIndex}_col_${cellIndex}`;
                                                                const descIdx = table.header?.findIndex(h => /description|desc|item/i.test(h));
                                                                const rowTitle = descIdx !== -1 ? row.cells[descIdx]?.value : `Row #${rowIndex + 1}`;

                                                                return (
                                                                    <div style={{ padding: '2px 0' }}>
                                                                        <MultiImageCell
                                                                            images={rawImages}
                                                                            cellId={cellId}
                                                                            size={86}
                                                                            altPrefix="Ref"
                                                                            itemTitle={rowTitle}
                                                                            allowDrop={!isCosted && !row.isHeader}
                                                                            allowRemove={!isCosted && !row.isHeader}
                                                                            allowDrag={!isCosted && !row.isHeader}
                                                                            onImagesChange={(newImgs) => handleUpdateCellImages(tableIndex, rowIndex, cellIndex, newImgs)}
                                                                            onPreview={(imgs, targetIdx) => {
                                                                                setGalleryModal({
                                                                                    isOpen: true,
                                                                                    images: imgs,
                                                                                    initialIndex: targetIdx,
                                                                                    title: `Item Image (${targetIdx + 1}/${imgs.length})`,
                                                                                    subtitle: rowTitle,
                                                                                    tableIndex,
                                                                                    rowIndex,
                                                                                    cellIndex
                                                                                });
                                                                            }}
                                                                        />
                                                                    </div>
                                                                );
                                                            }
                                                            return null;
                                                        })()}
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            {isSnCol && !row.isHeader && row.pageNum && (
                                                                <span className={styles.rowPageBadge} title={`Extracted from page ${row.pageNum}`}>
                                                                    P.{row.pageNum}
                                                                </span>
                                                            )}
                                                            <div
                                                                className={styles.editableCell}
                                                                contentEditable={!isCosted && !row.isHeader}
                                                                suppressContentEditableWarning
                                                                onBlur={(e) => !isCosted && handleCellChange(tableIndex, rowIndex, cellIndex, e.target.innerText)}
                                                                style={{ flex: 1 }}
                                                            >
                                                                {row.isHeader ? cellValue : formatNumber(cellValue, table.header?.[cellIndex])}
                                                            </div>
                                                        </div>
                                                    </CellTag>
                                                );
                                            })}
                                            {!row.isHeader && !isCosted && (
                                                <td className={styles.actionCell}>
                                                    <button 
                                                        className={styles.actionBtn} 
                                                        style={{ 
                                                            background: 'linear-gradient(135deg, #6366f1, #a855f7)', 
                                                            color: '#fff', 
                                                            fontSize: '0.75rem', 
                                                            padding: '2px 7px', 
                                                            width: 'auto', 
                                                            borderRadius: '6px',
                                                            fontWeight: 600,
                                                            boxShadow: '0 2px 6px rgba(99, 102, 241, 0.3)'
                                                        }}
                                                        title=" AI Auto-Match & Inspector (Opens live multimodal matcher with real-time throbber & alternatives)"
                                                        onClick={() => handleOpenSemanticMatch(tableIndex, rowIndex, row, table.header)}
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ display: 'block' }}><path d="M12 2 L14.5 9.5 L22 12 L14.5 14.5 L12 22 L9.5 14.5 L2 12 L9.5 9.5 Z" /></svg>
                                                    </button>
                                                    <button className={`${styles.actionBtn} ${styles.addBtn}`} onClick={() => handleAddRow(tableIndex, rowIndex)}>+</button>
                                                    <button className={`${styles.actionBtn} ${styles.removeBtn}`} onClick={() => handleRemoveRow(tableIndex, rowIndex)}>×</button>
                                                </td>
                                            )}
                                            {isCosted && !row.isHeader && <td className={styles.actionCell}>-</td>}
                                        </tr>
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {isCosted && table.summary && (
                    <div className={styles.summarySection}>
                        <div className={styles.summaryDetailRow}>
                            <span>Subtotal:</span>
                            <span>{table.summary.subtotal} {table.summary.currency}</span>
                        </div>
                        <div className={styles.summaryDetailRow}>
                            <span>VAT ({table.summary.vatPercent}%):</span>
                            <span>{table.summary.vatAmount} {table.summary.currency}</span>
                        </div>
                        <div className={styles.summaryTotal}>
                            <span>Grand Total:</span>
                            <span>{table.summary.grandTotal} {table.summary.currency}</span>
                        </div>
                    </div>
                )}

                {!isCosted && table.extractedSummary && (() => {
                    const vatPct = vatRates[tableIndex] !== undefined ? vatRates[tableIndex] : 5;
                    const totalAmt = parseFloat(table.extractedSummary.totalAmount) || 0;
                    const vatAmt = round2(totalAmt * (vatPct / 100));
                    const grandTotal = round2(totalAmt + vatAmt);
                    return (
                        <div className={styles.summarySection} style={{ borderColor: UI_COLORS.primary }}>
                            <div className={styles.summaryDetailRow}>
                                <span>Total:</span>
                                <span style={{ color: UI_COLORS.primary, fontWeight: 600 }}>{fmt2(totalAmt)}</span>
                            </div>
                            <div className={styles.summaryDetailRow} style={{ alignItems: 'center' }}>
                                <span>VAT:</span>
                                <select
                                    value={vatPct}
                                    onChange={e => setVatRates(prev => ({ ...prev, [tableIndex]: parseFloat(e.target.value) }))}
                                    style={{
                                        background: UI_COLORS.darkBg,
                                        border: `1px solid ${UI_COLORS.primary}`,
                                        borderRadius: '6px',
                                        color: '#e2e8f0',
                                        padding: '3px 8px',
                                        fontSize: '0.85rem',
                                        cursor: 'pointer',
                                    }}
                                >
                                    <option value={5}>5%</option>
                                    <option value={0}>0%</option>
                                    <option value={9}>9%</option>
                                    <option value={15}>15%</option>
                                </select>
                                <span style={{ color: UI_COLORS.muted, marginLeft: '8px' }}>{fmt2(vatAmt)}</span>
                            </div>
                            <div className={styles.summaryTotal} style={{ color: UI_COLORS.primary }}>
                                <span>Grand Total:</span>
                                <span>{fmt2(grandTotal)}</span>
                            </div>
                        </div>
                    );
                })()}
            </div>
        ))
    );

    const renderRecategorizeControl = (suffix = 'main') => (
        <div className={styles.recatBar} title="Group extracted BOQ items via subheaders & categorized submissions">
            <label className={styles.recatBarLabel} htmlFor={`table-viewer-recat-${suffix}`}>Recategorize</label>
            <select
                id={`table-viewer-recat-${suffix}`}
                className={styles.recatBarSelect}
                value={recategorizeMode}
                onChange={(e) => handleRecategorizeChange(e.target.value)}
            >
                <option value="original">Original Order (As Is)</option>
                <option value="item">Item wise</option>
                <option value="room">Room wise</option>
            </select>
        </div>
    );

    if (!tables || tables.length === 0) return <div className={styles.noData}>No tables found in the uploaded file</div>;

    return (
        <div className={styles.viewerContainer}>

            {/* 1. Original Data Top Header */}
            <div className={styles.header}>
                <h2 className={styles.title}> Extracted Data ({tables.length} {tables.length === 1 ? 'Table' : 'Tables'})</h2>
                {renderRecategorizeControl('original')}
            </div>

            {/* Render Original Tables */}
            {renderTableList(tablesWithSummary, false)}

            {/* Project Settings Panel */}
            <ProjectSettingsPanel isOpen={isProjectPanelOpen} onClose={() => setProjectPanelOpen(false)} />

            {/* Set of Actions for Original Tables */}
            <div className={actionStyles.actionBar}>
                <div className={actionStyles.actionBarTop}>
                    <div className={actionStyles.actionTitle}>Original Data Actions</div>
                    <button
                        className={actionStyles.projectSettingsBtn}
                        onClick={() => setProjectPanelOpen(true)}
                        title="Project Settings — fills info on all generated documents"
                    >
                         Project Settings
                        {(project.projectName || project.clientName) && (
                            <span className={actionStyles.projectBadge}>
                                {project.projectName || project.clientName}
                            </span>
                        )}
                    </button>
                </div>
                <div className={actionStyles.buttonGroup}>
                    <DesignBuildButton getTables={() => tables} title="Original offer" />
                    <button className={actionStyles.actionBtn} onClick={() => handleDownloadPDF(tablesWithSummary, 'Original_Offer')}> Download Offer PDF</button>
                    <button className={actionStyles.actionBtn} onClick={() => handleDownloadExcel(tablesWithSummary, 'Original_Offer')}> Download Offer Excel</button>
                    <button
                        className={`${actionStyles.actionBtn} ${generatingType === 'pptx_original' ? actionStyles.loading : ''}`}
                        onClick={() => triggerPptxExport(tables, false, false)}
                        disabled={!!generatingType}
                    >
                        {generatingType === 'pptx_original' ? ' Generating...' : ' Generate Presentation'}
                    </button>
                    <button
                        className={`${actionStyles.actionBtn} ${generatingType === 'pdf_original' ? actionStyles.loading : ''}`}
                        onClick={() => triggerPptxExport(tables, true, false)}
                        disabled={!!generatingType}
                    >
                        {generatingType === 'pdf_original' ? ' Generating...' : ' Presentation PDF'}
                    </button>

                    <button className={actionStyles.actionBtn} onClick={() => handleGenerateMas(tables)}> Generate MAS</button>
                    <button className={`${actionStyles.actionBtn} ${actionStyles.actionBtnMir}`} onClick={() => handleGenerateMIR(tables)}> Generate MIR</button>
                    <button className={`${actionStyles.actionBtn} ${actionStyles.actionBtnWir}`} onClick={() => handleGenerateWIR(tables)}> Generate WIR</button>
                    <button className={`${actionStyles.actionBtn} ${actionStyles.actionBtnDn}`} onClick={() => handleGenerateDeliveryNote(tables)}> Delivery Note</button>
                    <button
                        className={`${actionStyles.actionBtn} ${actionStyles.actionBtnRfq} ${generatingType === 'rfq_original' ? actionStyles.loading : ''}`}
                        onClick={() => handleGenerateRfqByBrand(tables, 'original')}
                        disabled={!!generatingType}
                        title="Split BOQ by Brand into ready-to-send Supplier RFQ Excel sheets (ZIP pack with Master Tracker)"
                    >
                        {generatingType === 'rfq_original' ? ' Grouping RFQs...' : ' RFQ by Brand'}
                    </button>
                    <button className={`${actionStyles.actionBtn} ${actionStyles.actionBtnDn}`} style={{ background: '#10b981', color: '#ffffff', borderColor: '#059669', fontWeight: '500' }} onClick={() => setTenderAutofillOpen(true)}> Autofill on Tender Board</button>
                </div>
            </div>

            {/* Costing Trigger Button (Centrally Placed) */}
            {/* Action Triggers */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '2rem', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', gap: '2rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button className={actionStyles.btnCostingTrigger} onClick={() => setCostingOpen(true)}>
                         Apply Costing Factors
                    </button>
                    <button className={actionStyles.btnMultiBudget} onClick={() => setMultiBudgetOpen(true)}>
                         Multi Budget Offer
                    </button>
                    <button
                        className={actionStyles.btnAiValueEngineer}
                        onClick={() => setValueEngineeredOpen(true)}
                    >
                         AI Value Engineer
                    </button>
                    <label className={actionStyles.btnMultiBudget} style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', background: '#0f766e', borderColor: '#0d9488' }}>
                        <input
                            type="file"
                            accept=".xlsx,.xls,.xlsb,.pdf,.png,.jpg,.jpeg"
                            style={{ display: 'none' }}
                            multiple
                            onChange={(e) => {
                                const files = Array.from(e.target.files || []).filter(Boolean);
                                if (files.length > 0 && onUploadBoq) {
                                    onUploadBoq(files);
                                }
                                e.target.value = '';
                            }}
                        />
                         Append / Batch BOQs
                    </label>
                </div>
                {costingFactors && (
                    <div style={{ marginTop: '1rem', fontSize: '0.9rem', color: UI_COLORS.muted }}>
                        Active: Profit {costingFactors.profit}%, Freight {costingFactors.freight}%, Customs {costingFactors.customs}%, Install {costingFactors.installation}%
                    </div>
                )}
            </div>

            {/* 2. Costed Data Section (Only if Costing Applied) */}
            {costedTables && (
                <div id="costed-results" style={{ animation: 'fadeInUp 0.5s ease' }}>
                    <div className={styles.header}>
                        <h2 className={styles.title} style={{ color: UI_COLORS.costing }}>Costed Results</h2>
                        {renderRecategorizeControl('costed')}
                    </div>
                    {renderTableList(costedTables, true)}

                    {/* Set of Actions for Costed Tables */}
                    <div className={actionStyles.actionBar}>
                        <div className={actionStyles.actionBarTop}>
                            <div className={actionStyles.actionTitle} style={{ color: UI_COLORS.costing }}>Costed Data Actions</div>
                            <button
                                className={actionStyles.projectSettingsBtn}
                                onClick={() => setProjectPanelOpen(true)}
                                title="Project Settings"
                            >
                                 Project Settings
                                {(project.projectName || project.clientName) && (
                                    <span className={actionStyles.projectBadge}>
                                        {project.projectName || project.clientName}
                                    </span>
                                )}
                            </button>
                        </div>
                        <div className={actionStyles.buttonGroup}>
                            <DesignBuildButton getTables={() => costedTables} title="Costed offer" />
                            <button className={actionStyles.actionBtn} onClick={() => handleDownloadPDF(costedTables, 'Costed_Offer')}> Download Costed PDF</button>
                            <button className={actionStyles.actionBtn} onClick={() => handleDownloadExcel(costedTables, 'Costed_Offer')}> Download Costed Excel</button>
                            <button
                                className={`${actionStyles.actionBtn} ${generatingType === 'pptx_costed' ? actionStyles.loading : ''}`}
                                onClick={() => triggerPptxExport(costedTables, false, true)}
                                disabled={!!generatingType}
                            >
                                {generatingType === 'pptx_costed' ? ' Generating...' : ' Generate Costed Presentation'}
                            </button>
                            <button
                                className={`${actionStyles.actionBtn} ${generatingType === 'pdf_costed' ? actionStyles.loading : ''}`}
                                onClick={() => triggerPptxExport(costedTables, true, true)}
                                disabled={!!generatingType}
                            >
                                {generatingType === 'pdf_costed' ? ' Generating...' : ' Costed Presentation PDF'}
                            </button>

                            <button className={actionStyles.actionBtn} onClick={() => handleGenerateMas(costedTables)}> Generate Costed MAS</button>
                            <button className={`${actionStyles.actionBtn} ${actionStyles.actionBtnMir}`} onClick={() => handleGenerateMIR(costedTables)}> Generate Costed MIR</button>
                            <button className={`${actionStyles.actionBtn} ${actionStyles.actionBtnWir}`} onClick={() => handleGenerateWIR(costedTables)}> Generate Costed WIR</button>
                            <button className={`${actionStyles.actionBtn} ${actionStyles.actionBtnDn}`} onClick={() => handleGenerateDeliveryNote(costedTables)}> Costed Delivery Note</button>
                            <button
                                className={`${actionStyles.actionBtn} ${actionStyles.actionBtnRfq} ${generatingType === 'rfq_costed' ? actionStyles.loading : ''}`}
                                onClick={() => handleGenerateRfqByBrand(costedTables, 'costed')}
                                disabled={!!generatingType}
                                title="Split BOQ by Brand into ready-to-send Supplier RFQ Excel sheets (excludes client margins)"
                            >
                                {generatingType === 'rfq_costed' ? ' Grouping RFQs...' : ' RFQ by Brand'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <TenderAutofillModal isOpen={isTenderAutofillOpen} onClose={() => setTenderAutofillOpen(false)} tables={tables} apiBase={API_BASE} />

            <MultiBudgetModal
                isOpen={isMultiBudgetOpen}
                onClose={() => setMultiBudgetOpen(false)}
                originalTables={tables}
                onUploadBoq={onUploadBoq}
                onUploadPlan={onUploadPlan}
                planPreviewUrl={planPreviewUrl}
                planPreviewType={planPreviewType}
                planPreviewName={planPreviewName}
                seededItems={seededItems}
                onApplyFlow={(formattedData) => {
                    // Keep the original extracted tables; show the costed offer separately.
                    setAppliedOffer({ tables: formattedData.tables, costingFactors: formattedData.costingFactors || null });
                    shareOfferWithDesignBuild(formattedData.tables);
                    if (formattedData.costingFactors) setCostingFactors(formattedData.costingFactors);
                    setMultiBudgetOpen(false);
                }}
                onOpenValueEngineer={() => {
                    setMultiBudgetOpen(false);
                    setValueEngineeredOpen(true);
                }}
            />

            <ValueEngineeredModal
                isOpen={isValueEngineeredOpen}
                onClose={() => setValueEngineeredOpen(false)}
                allBrands={allBrands}
                originalTables={tables}
                onUploadBoq={onUploadBoq}
                onUploadPlan={onUploadPlan}
                planPreviewUrl={planPreviewUrl}
                planPreviewType={planPreviewType}
                planPreviewName={planPreviewName}
                seededItems={seededItems}
                onApply={(data) => {
                    // Keep the original extracted tables; show the costed offer separately.
                    setAppliedOffer({ tables: data.tables, costingFactors: data.costingFactors || null });
                    shareOfferWithDesignBuild(data.tables);
                    if (data.costingFactors) setCostingFactors(data.costingFactors);
                    setValueEngineeredOpen(false);
                }}
                onOpenMultiBudget={() => {
                    setValueEngineeredOpen(false);
                    setMultiBudgetOpen(true);
                }}
            />

            <CostingModal
                isOpen={isCostingOpen}
                onClose={() => setCostingOpen(false)}
                initialFactors={costingFactors}
                onApply={(factors) => {
                    // Costing always runs on the original extracted tables, once.
                    setAppliedOffer(null);
                    setCostingFactors(factors);
                    setCostingOpen(false);
                }}
            />

            <PptxTemplateModal
                isOpen={showPptxModal}
                onClose={() => setShowPptxModal(false)}
                onExport={handleTemplateModalExport}
                isGenerating={!!generatingType}
            />

            <AISemanticMatchModal
                isOpen={isSemanticModalOpen}
                onClose={() => {
                    setSemanticModalOpen(false);
                    setSemanticMatchTarget(null);
                }}
                item={semanticMatchTarget}
                allBrands={allBrands}
                onSelectProduct={handleSelectSemanticProduct}
            />

            {galleryModal.isOpen && (
                <ImageGalleryModal
                    images={galleryModal.images}
                    initialIndex={galleryModal.initialIndex}
                    title={galleryModal.title}
                    subtitle={galleryModal.subtitle}
                    onRemoveImage={galleryModal.tableIndex !== null && galleryModal.tableIndex !== undefined ? (removedIdx) => {
                        const currentImgs = (Array.isArray(galleryModal.images) ? galleryModal.images : [galleryModal.images])
                            .map(img => (typeof img === 'string' ? img : (img?.url || img?.data || img?.src || '')))
                            .filter(Boolean);
                        const updated = currentImgs.filter((_, idx) => idx !== removedIdx);
                        handleUpdateCellImages(galleryModal.tableIndex, galleryModal.rowIndex, galleryModal.cellIndex, updated);
                        setGalleryModal(prev => ({ ...prev, images: updated }));
                    } : null}
                    onClose={() => setGalleryModal(prev => ({ ...prev, isOpen: false }))}
                />
            )}

            {selectedImage && (
                <div className={styles.modalOverlay} onClick={() => setSelectedImage(null)}>
                    <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
                        <div className={styles.modalMain}>
                            <img
                                src={selectedImage}
                                alt="Full view"
                                className={styles.modalImage}
                                onError={(e) => {
                                    e.target.src = 'https://placehold.co/600x400?text=Image+Not+Available';
                                }}
                            />
                        </div>
                        <div className={styles.modalFooter}>
                            <span className={styles.modalFooterLabel}>Image Preview</span>
                            <button className={styles.innerCloseButton} onClick={() => setSelectedImage(null)}>×</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default TableViewer;
