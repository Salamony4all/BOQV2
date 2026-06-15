import React, { useState, useEffect, useMemo } from 'react';
import styles from '../styles/TableViewer.module.css';
import actionStyles from '../styles/ActionBar.module.css';
import CostingModal from './CostingModal';
import MultiBudgetModal from './MultiBudgetModal';
import ValueEngineeredModal from './ValueEngineeredModal';
import ProjectSettingsPanel from './ProjectSettingsPanel';
import TenderAutofillModal from './TenderAutofillModal';
import PptxTemplateModal from './PptxTemplateModal';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

import { useCompanyProfile } from '../context/CompanyContext';
import { useProject } from '../context/ProjectContext';
import { fixArabic, hasArabic, loadArabicFont } from '../utils/arabicPdfUtils';

import { getApiBase } from '../utils/apiBase';
import { getFullUrl } from '../utils/urlUtils';

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
    const [costingFactors, setCostingFactors] = useState(null);
    const [isCostingOpen, setCostingOpen] = useState(false);
    const [isMultiBudgetOpen, setMultiBudgetOpen] = useState(false);
    const [isValueEngineeredOpen, setValueEngineeredOpen] = useState(false);
    const [isProjectPanelOpen, setProjectPanelOpen] = useState(false);
    const [isTenderAutofillOpen, setTenderAutofillOpen] = useState(false);
    // Per-table VAT rate for extracted summary (GCC default = 5%)
    const [vatRates, setVatRates] = useState({});
    const [isGeneratingPpt, setIsGeneratingPpt] = useState(false);
    const [showPptxModal, setShowPptxModal] = useState(false);
    const [pptxSourceTables, setPptxSourceTables] = useState(null);
    const [pptxAsPdf, setPptxAsPdf] = useState(false);


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
            setTables(JSON.parse(JSON.stringify(data.tables)));
            setVatRates({}); // Reset VAT selections on new upload (defaults back to 5%)

            // Allow pre-initialized costing factors from parent (e.g. from MultiBudgetModal)
            if (data.costingFactors) {
                setCostingFactors(data.costingFactors);
            }
        }
    }, [data]);

    // Poll for background native image matching progress
    useEffect(() => {
        // Find uploadId from any table
        const firstTable = tables.find(t => t.uploadId);
        const uploadId = firstTable?.uploadId;
        if (!uploadId) return;

        // If the table already has real matched images, don't poll
        const hasRealImages = tables.some(t =>
            t.rows.some(r =>
                r.cells.some(c =>
                    c.images && c.images.length > 0 && c.images.some(img => img.url && !img.url.includes('/api/lazy-image'))
                )
            )
        );
        if (hasRealImages) return;

        let intervalId;
        let isPolling = true;

        const pollMetadata = async () => {
            try {
                const response = await fetch(`${API_BASE || ''}/api/upload/metadata/${uploadId}`);
                if (!response.ok) return;
                const meta = await response.json();
                
                // If the background positional pairing is completed
                if (meta && meta.isReady && meta.rows) {
                    console.log('🎉 Background native image matching ready! Updating TableViewer tables.');
                    
                    setTables(prevTables => {
                        return prevTables.map(table => {
                            if (table.uploadId !== uploadId) return table;
                            
                            const updatedRows = table.rows.map((row, rIdx) => {
                                if (row.isHeader || row.isSummary) return row;
                                
                                const matchedMetaRow = meta.rows.find(mr => mr.pageNum === row.pageNum && mr.rowIdx === rIdx);
                                if (matchedMetaRow) {
                                    const newCells = [...row.cells];
                                    const imgIdx = table.header.findIndex(h => /image|photo|picture|img|pic|ref/i.test(h));
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
    }, [tables]);

    // Compute summary for original extracted tables
    const tablesWithSummary = useMemo(() => {
        return tables.map(table => {
            const header = table.header || [];

            // Find rate and amount/total columns
            const rateIdx = header.findIndex(h => /rate|price|unit.*price|unit.*rate/i.test(h));
            const amountIdx = header.findIndex(h => /amount|total(?!.*(qty|quantity))/i.test(h));
            const qtyIdx = header.findIndex(h => /qty|quantity|qt/i.test(h));
            const unitIdx = header.findIndex(h => /unit|uom/i.test(h));
            const descIdx = header.findIndex(h => /description|desc|disc|item|product/i.test(h));
            const imgIdx = header.findIndex(h => /image|photo|picture|img|pic|ref/i.test(h));

            // Calculate totals
            let totalRate = 0;
            let totalAmount = 0;
            let totalQty = 0;
            let validRows = 0;

            table.rows.forEach(row => {
                if (!row || !row.cells || row.isHeader || row.isSummary) return;

                const qtyValStr = qtyIdx !== -1 ? String(row.cells[qtyIdx]?.value || '').trim() : '';
                const rateValStr = rateIdx !== -1 ? String(row.cells[rateIdx]?.value || '').trim() : '';
                const unitValStr = unitIdx !== -1 ? String(row.cells[unitIdx]?.value || '').trim() : '';

                // Skip rows that are clearly section titles (text only, no qty/rate/unit)
                if (!qtyValStr && !rateValStr && !unitValStr) return;

                // Parse rate
                if (rateIdx !== -1 && row.cells[rateIdx]?.value) {
                    const val = parseFloat(String(row.cells[rateIdx].value).replace(/,/g, ''));
                    if (!isNaN(val)) totalRate += val;
                }

                // Parse amount
                if (amountIdx !== -1 && row.cells[amountIdx]?.value) {
                    const val = parseFloat(String(row.cells[amountIdx].value).replace(/,/g, ''));
                    if (!isNaN(val)) {
                        totalAmount += val;
                        validRows++;
                    }
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
        if (!costingFactors) return null;

        const grossMargin = (costingFactors.profit + costingFactors.freight + costingFactors.customs + costingFactors.installation) / 100;
        const multiplier = costingFactors.exchangeRate * (1 + grossMargin);
        const vatRate = (costingFactors.vat || 0) / 100;

        return tables.map(table => {
            const header = table.header || [];
            const moneyIndices = header.map((h, i) =>
                /rate|price|amount|total(?!.*(qty|quantity))/i.test(h) ? i : -1
            ).filter(i => i !== -1);

            const amountIdx = header.findIndex(h => /amount|total(?!.*(qty|quantity))/i.test(h));

            const newRows = (table.rows || []).map(row => {
                if (!row || !row.cells) return row;
                const newCells = row.cells.map((cell, idx) => {
                    // Only modify money columns
                    if (cell && moneyIndices.includes(idx) && cell.value) {
                        try {
                            const cleanVal = String(cell.value).replace(/,/g, '');
                            const num = parseFloat(cleanVal);
                            if (!isNaN(num)) {
                                const finalPrice = (num * multiplier).toFixed(2);
                                return { ...cell, value: finalPrice };
                            }
                        } catch (e) { return cell; }
                    }
                    return cell;
                });
                return { ...row, cells: newCells };
            });

            // Calculate Summary
            let subtotal = 0;
            if (amountIdx !== -1) {
                subtotal = newRows.reduce((acc, row) => {
                    if (row.isHeader || row.isSummary) return acc;
                    const val = parseFloat(String(row.cells[amountIdx]?.value || '0').replace(/,/g, ''));
                    return acc + (isNaN(val) ? 0 : val);
                }, 0);
            }

            const vatAmount = subtotal * vatRate;
            const grandTotal = subtotal + vatAmount;

            return {
                ...table,
                rows: newRows,
                summary: {
                    subtotal: subtotal.toFixed(2),
                    vatAmount: vatAmount.toFixed(2),
                    grandTotal: grandTotal.toFixed(2),
                    vatPercent: costingFactors.vat || 0,
                    currency: costingFactors.toCurrency
                }
            };
        });
    }, [tables, costingFactors]);

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

    // --- Export Handlers (Premium Styled) ---

    // Helper: Load image as data URL with size and format optimization
    const getImageData = async (url, options = {}) => {
        if (!url) return null;

        // Explicitly define these in the function scope
        const maxWidth = options.maxWidth || 1000;
        const format = options.format || 'image/jpeg';
        const quality = options.quality || 0.85;

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
                    resolve({
                        dataUrl: canvas.toDataURL(format, quality),
                        width: canvas.width,
                        height: canvas.height
                    });
                };
                img.onerror = () => resolve(null);
                img.src = imgSrc;
            });
        };

        // Check if this is a proxy URL or external URL
        const isProxyUrl = url.includes('/api/image-proxy');

        if (isProxyUrl) {
            try {
                // Proxy returns raw binary image - convert to blob URL
                const response = await fetch(url);
                if (!response.ok) return null;

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
        doc.setFillColor(...colors.primary);
        doc.rect(0, 0, pageWidth, 90, 'F');
        doc.setFillColor(...colors.secondary);
        doc.rect(0, 90, pageWidth, 1.5, 'F');

        // Add Company Logo to Header if available
        const coverLogo = logoWhite || logoOriginal;
        if (coverLogo) {
            try {
                const docLogo = await getImageData(coverLogo, { format: 'image/png', maxWidth: 1200 });
                if (docLogo) {
                    // Refined size
                    const fit = calcFitSize(docLogo.width, docLogo.height, 80, 40);
                    doc.addImage(docLogo.dataUrl, 'PNG', (pageWidth - fit.w) / 2, 12, fit.w, fit.h);
                }
            } catch (e) { }
        } else {
            // Company Name as fallback in Header
            const cName = companyName || 'COMMERCIAL OFFER';
            doc.setTextColor(...colors.white);
            doc.setFontSize(24);
            const isArabicCName = hasArabic(cName);
            doc.setFont(isArabicCName && arabicLoaded ? 'Almarai' : 'helvetica', 'bold');
            doc.text(isArabicCName ? fixArabic(cName) : cName, pageWidth / 2, 40, { align: 'center' });
        }

        // Title
        doc.setTextColor(...colors.white);
        doc.setFontSize(30);
        doc.setFont('helvetica', 'bold');
        doc.text('COMMERCIAL OFFER', pageWidth / 2, 110, { align: 'center' });

        // Subtitle
        doc.setFontSize(14);
        doc.setFont('helvetica', 'normal');
        doc.text('Bill of Quantities & Pricing Schedule', pageWidth / 2, 120, { align: 'center' });

        // Date Badge - Moved down to Y=80 to prevent overlaps
        doc.setFillColor(...colors.secondary);
        doc.roundedRect(pageWidth / 2 - 20, 80, 40, 8, 1.5, 1.5, 'F');
        doc.setFontSize(9);
        doc.setTextColor(...colors.primary);
        const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        doc.text(today, pageWidth / 2, 85.5, { align: 'center' });

        // Document Info Section
        doc.setTextColor(...colors.text);
        doc.setFontSize(10);
        let infoY = 105;
        doc.setFont('helvetica', 'bold');
        doc.text('Document Reference:', 20, infoY);
        doc.setFont('helvetica', 'normal');
        doc.text(`OFF-${Date.now().toString().slice(-6)}`, 70, infoY);

        infoY += 10;
        doc.setFont('helvetica', 'bold');
        doc.text('Validity:', 20, infoY);
        doc.setFont('helvetica', 'normal');
        doc.text('30 Days from Issue Date', 70, infoY);

        infoY += 10;
        doc.setFont('helvetica', 'bold');
        doc.text('Total Items:', 20, infoY);
        doc.setFont('helvetica', 'normal');
        const totalItems = sourceTables.reduce((acc, t) => acc + t.rows.length, 0);
        doc.text(`${totalItems} Line Items`, 70, infoY);

        // Add Client Logo on Cover Page if available
        if (project.clientLogo) {
            try {
                const cLogoData = await getImageData(project.clientLogo, { format: 'image/png', maxWidth: 600 });
                if (cLogoData) {
                    const cFit = calcFitSize(cLogoData.width, cLogoData.height, 50, 20);
                    // Draw in top right of cover page next to info
                    doc.addImage(cLogoData.dataUrl, 'PNG', pageWidth - 20 - cFit.w, 105, cFit.w, cFit.h);
                }
            } catch (e) { }
        }

        // Draw Project Details Box on Cover Page if settings exist
        if (project.projectName || project.clientName) {
            let projY = infoY + 20; // Around 155
            doc.setFillColor(...colors.lightBg);
            doc.setDrawColor(...colors.secondary);
            doc.setLineWidth(0.5);
            doc.roundedRect(20, projY, pageWidth - 40, 48, 2, 2, 'FD');

            doc.setFillColor(...colors.primary);
            doc.roundedRect(20, projY, pageWidth - 40, 7, 1, 1, 'F');
            doc.setTextColor(...colors.white);
            doc.setFontSize(9.5);
            doc.setFont('helvetica', 'bold');
            doc.text('PROJECT INFORMATION', pageWidth / 2, projY + 5, { align: 'center' });

            doc.setTextColor(...colors.text);
            doc.setFontSize(8.5);
            let rowY = projY + 12;
            const leftX = 25;
            const rightX = pageWidth / 2 + 5;
            const rHeight = 6;

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
                doc.setFont('helvetica', 'normal'); doc.text(processText(r[1]), leftX + 24, y);
                
                if (r[2]) {
                    doc.setFont('helvetica', 'bold'); doc.text(r[2], rightX, y);
                    doc.setFont('helvetica', 'normal'); doc.text(processText(r[3]), rightX + 24, y);
                }
            });
            
            infoY = projY + 48; // Shift infoY down for the decorative line
        }

        // Decorative Line
        doc.setDrawColor(...colors.secondary);
        doc.setLineWidth(2);
        doc.line(20, infoY + 12, pageWidth - 20, infoY + 12);

        // Footer on Cover
        doc.setFontSize(9);
        doc.setTextColor(150, 150, 150);
        const footerText = profile.website || profile.companyName || 'BOQ FLOW - Intelligent Estimation System';
        const isArabicFooter = hasArabic(footerText);
        doc.setFont(isArabicFooter && arabicLoaded ? 'Almarai' : 'helvetica', 'normal');
        doc.text(isArabicFooter ? fixArabic(footerText) : footerText, pageWidth / 2, pageHeight - 15, { align: 'center' });

        // ===== DATA PAGES =====
        for (let tableIndex = 0; tableIndex < sourceTables.length; tableIndex++) {
            const table = sourceTables[tableIndex];
            doc.addPage();

            // Page Header
            doc.setFillColor(...colors.primary);
            doc.rect(0, 0, pageWidth, 25, 'F');
            doc.setFillColor(...colors.secondary);
            doc.rect(0, 25, pageWidth, 0.8, 'F');

            doc.setTextColor(...colors.white);
            doc.setFontSize(10);
            const sheetTitle = (table.sheetName && !table.sheetName.includes("Combined")) ? table.sheetName : (profile.companyName || 'COMMERCIAL OFFER');
            doc.text(sheetTitle, 10, 15);

            // Company Logo in Header
            const headerLogo = logoWhite || logoOriginal;
            if (headerLogo) {
                try {
                    const docLogo = await getImageData(headerLogo, { format: 'image/png', maxWidth: 600 });
                    if (docLogo) {
                        // Refined size
                        const fit = calcFitSize(docLogo.width, docLogo.height, 60, 18);
                        doc.addImage(docLogo.dataUrl, 'PNG', pageWidth - 10 - fit.w, 3, fit.w, fit.h);
                    }
                } catch (e) { }
            }

            // Find column indices
            const header = table.header || [];
            let imgColIdx = header.findIndex(h => /image|photo|picture|img|pic|ref/i.test(h));
            
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
                    colWidths[i] = { cellWidth: 12, halign: 'center' };
                } else if (i === imgColIdx) {
                    colWidths[i] = { cellWidth: 32, halign: 'center' };
                } else if (i === descColIdx) {
                    colWidths[i] = { cellWidth: 'auto', halign: 'left' };
                } else if (i === qtyColIdx) {
                    colWidths[i] = { cellWidth: 10, halign: 'center' };
                } else if (i === uomColIdx) {
                    colWidths[i] = { cellWidth: 12, halign: 'center' };
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
                            if (img?.url) {
                                try {
                                    const imgResult = await getImageData(getFullUrl(img.url), { maxWidth: 800, format: 'image/jpeg' });
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

            // Prepare table data
            const head = [header.map((h, i) => i === imgColIdx ? 'Image' : h)];
            const body = table.rows.map(row => row.cells.map((c, i) => {
                if (i === imgColIdx) return '';
                const val = String(c.value || '');
                return (arabicLoaded && hasArabic(val)) ? fixArabic(val) : val;
            }));

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
                    content: `${tableSummary.subtotal} ${tableSummary.currency}`,
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
                    content: `${tableSummary.vatAmount} ${tableSummary.currency}`,
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
                    content: `${tableSummary.grandTotal} ${tableSummary.currency}`,
                    styles: { halign: 'right', fontStyle: 'bold', fillColor: colors.primary, textColor: [255, 255, 255] }
                });
                for (let k = targetColIdx + 1; k < header.length; k++) {
                    grandTotalRow.push({ content: '', styles: { fillColor: colors.primary } });
                }
                body.push(grandTotalRow);
            }

            // Draw compact Project Info at the top of the sheet (only if project details are filled)
            let startY = 30; // Default start Y for table if no project info
            
            if (project.projectName || project.clientName) {
                const pY = 28;
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
                    const y = pY + 4.5 + i * 4.2;
                    doc.setFont('helvetica', 'bold'); doc.text(r[0], 8, y);
                    doc.setFont('helvetica', 'normal'); doc.text(processText(r[1]), 22, y);
                    doc.setFont('helvetica', 'bold'); doc.text(r[2], pageWidth / 2 + 5, y);
                    doc.setFont('helvetica', 'normal'); doc.text(processText(r[3]), pageWidth / 2 + 22, y);
                });

                // Client Logo in Project Info box if available
                if (project.clientLogo) {
                    try {
                        const cLogo = await getImageData(project.clientLogo, { format: 'image/png', maxWidth: 300 });
                        if (cLogo) {
                            const cFit = calcFitSize(cLogo.width, cLogo.height, 25, 12);
                            doc.addImage(cLogo.dataUrl, 'PNG', pageWidth - 10 - cFit.w - 3, pY + 3, cFit.w, cFit.h);
                        }
                    } catch (e) { }
                }
                
                startY = 50; // Push table start Y down to clear the project info block
            }

            autoTable(doc, {
                head: head,
                body: body,
                startY: startY,
                margin: { top: 28, left: 5, right: 5 },
                theme: 'grid',
                styles: {
                    fontSize: 7,
                    cellPadding: 2,
                    lineColor: [200, 200, 200],
                    lineWidth: 0.3,
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
                    fontSize: 10,
                    font: arabicLoaded ? 'Almarai' : 'helvetica',
                    cellPadding: 1.5,
                    minCellHeight: 7
                },
                alternateRowStyles: {
                    fillColor: [250, 250, 250]
                },
                columnStyles: colWidths,
                didParseCell: (data) => {
                    // Set dynamic row height based on image count
                    if (data.section === 'body') {
                        const isSummaryRow = tableSummary && data.row.index >= body.length - 3;
                        if (isSummaryRow) {
                            data.cell.styles.minCellHeight = 8;
                            return;
                        }
                        const customHeight = rowHeights[data.row.index] || 10;
                        data.cell.styles.minCellHeight = customHeight;
                    }
                },
                didDrawCell: (data) => {
                    const isSummaryRow = tableSummary && data.row.index >= body.length - 3;
                    if (isSummaryRow) return;

                    // Draw multiple images in a grid layout
                    if (imgColIdx >= 0 && data.column.index === imgColIdx && data.section === 'body') {
                        const images = imageDataMap[data.row.index];
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
                    doc.setFontSize(8);
                    doc.setTextColor(150, 150, 150);
                    doc.setFont('helvetica', 'normal');
                    doc.text(`Page ${doc.internal.getNumberOfPages()}`, 10, pageHeight - 8);

                    const fText = profile.website || profile.companyName || '';
                    const isAr = hasArabic(fText);
                    doc.setFont(isAr && arabicLoaded ? 'Almarai' : 'helvetica', 'normal');
                    doc.text(isAr ? fixArabic(fText) : fText, pageWidth - 10, pageHeight - 8, { align: 'right' });
                    doc.setDrawColor(...colors.secondary);
                    doc.setLineWidth(0.5);
                    doc.line(0, pageHeight - 4, pageWidth, pageHeight - 4);
                }
            });


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

        for (let tableIndex = 0; tableIndex < sourceTables.length; tableIndex++) {
            const table = sourceTables[tableIndex];
            const ws = workbook.addWorksheet(table.sheetName || 'BOQ Schedule', {
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
            const hasCosting = true;

            const header = table.header || [];
            let imgColIdx = header.findIndex(h => /image|photo|picture|img|pic|ref/i.test(h));

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

            if (hasArInHeader || hasArInBody) {
                ws.views = [{ rightToLeft: true }];
            }

            // Determine offsets and insert details dynamically
            let startRowOffset = 0;
            const hasProjectInfo = !!(project.projectName || project.clientName || project.projectNumber);

            if (hasProjectInfo) {
                // Row 1: Document Branding / Title
                const titleRow = ws.addRow([`COMMERCIAL OFFER - ${table.sheetName || 'BOQ Schedule'}`]);
                titleRow.getCell(1).font = { bold: true, size: 14, color: { argb: primaryArgb } };
                ws.mergeCells(1, 1, 1, Math.max(header.length, 5));
                ws.getRow(1).height = 25;

                // Row 2: Section Header
                const secRow = ws.addRow(['PROJECT INFORMATION']);
                secRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
                secRow.getCell(1).font = { bold: true, color: { argb: '1E293B' }, size: 10 };
                secRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
                ws.mergeCells(2, 1, 2, Math.max(header.length, 5));
                ws.getRow(2).height = 20;

                // Rows 3-6: Project details
                const contractorText = project.includeContractor !== false ? (project.contractor || '—') : '—';
                const consultantText = project.includeConsultant !== false ? (project.consultant || '—') : '—';

                const detailsRows = [
                    ['Project:', project.projectName || '—', '', 'Client:', project.clientName || '—'],
                    ['Project No:', project.projectNumber || '—', '', 'Location / Zone:', project.locationZone || '—'],
                    ['Contractor:', contractorText, '', 'Consultant:', consultantText],
                    ['Site Engineer:', project.siteEngineer || '—', '', 'Issue Date:', project.issueDate || '—']
                ];

                detailsRows.forEach((rowVals, idx) => {
                    const rNum = idx + 3;
                    const rowObj = ws.getRow(rNum);
                    rowObj.values = rowVals;
                    rowObj.height = 18;
                    
                    const cellA = rowObj.getCell(1);
                    const cellB = rowObj.getCell(2);
                    const cellD = rowObj.getCell(4);
                    const cellE = rowObj.getCell(5);

                    cellA.font = { bold: true, size: 10, color: { argb: '475569' } };
                    cellD.font = { bold: true, size: 10, color: { argb: '475569' } };
                    cellB.font = { size: 10, color: { argb: '0F172A' } };
                    cellE.font = { size: 10, color: { argb: '0F172A' } };

                    [cellA, cellB, cellD, cellE].forEach(c => {
                        c.alignment = { vertical: 'middle' };
                    });

                    ws.mergeCells(rNum, 2, rNum, 3);
                    ws.mergeCells(rNum, 5, rNum, Math.max(header.length, 5));
                });

                startRowOffset = 6;

                // Add gap row after project details
                ws.addRow([]); // Row 7 is gap row
                ws.getRow(7).height = 15;
                startRowOffset = 7;

                // Add Client Logo if available
                if (project.clientLogo) {
                    try {
                        const cImgResult = await getImageData(project.clientLogo, { maxWidth: 300, format: 'image/png' });
                        if (cImgResult) {
                            const cBase64 = cImgResult.dataUrl.split(',')[1];
                            const cImageId = workbook.addImage({
                                base64: cBase64,
                                extension: 'png'
                            });
                            const logoCol = Math.max(header.length - 1, 4);
                            const fit = calcFitSize(cImgResult.width, cImgResult.height, 80, 30);
                            ws.addImage(cImageId, {
                                tl: { col: logoCol + 0.1, row: 0.1 },
                                ext: { width: fit.w, height: fit.h }
                            });
                        }
                    } catch (e) { }
                }
            } else {
                startRowOffset = 0;
            }

            // Always write costing factors exactly beside the table columns (1 empty column gap)
            const startCol = header.length + 2;
            writeCostingFactorsToRight(ws, startCol, excelCostingFactors);

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
                            if (img?.url) {
                                try {
                                    const imgResult = await getImageData(getFullUrl(img.url), { maxWidth: 800, format: 'image/jpeg', quality: 0.95 });
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
            table.rows.forEach((row, rowIndex) => {
                const rowData = row.cells.map((c, i) => {
                    if (i === imgColIdx) return ''; // Clear image column text
                    const valStr = String(c && c.value !== undefined ? c.value : '').trim();
                    if (i === rateColIdx || i === amountColIdx || i === qtyColIdx) {
                        const cleanVal = valStr.replace(/[^0-9.-]/g, '');
                        const num = parseFloat(cleanVal);
                        return isNaN(num) ? valStr : num;
                    }
                    return c ? c.value : '';
                });
                const dataRow = ws.addRow(rowData);

                // Calculate row height based on number of images
                const imgCount = imageDataByRow[rowIndex]?.length || 0;
                let rowHeight = 20;
                if (imgCount === 1) rowHeight = 55;
                else if (imgCount === 2) rowHeight = 55;
                else if (imgCount <= 4) rowHeight = 110;
                else if (imgCount > 4) rowHeight = 165;
                dataRow.height = rowHeight;

                const isEven = rowIndex % 2 === 0;
                dataRow.eachCell((cell, colNumber) => {
                    const colIdx = colNumber - 1;
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isEven ? 'F8FAFC' : 'FFFFFF' } };
                    cell.font = { color: { argb: '334155' }, size: 10 };
                    cell.alignment = { vertical: 'middle', wrapText: true };
                    cell.border = { bottom: { style: 'thin', color: { argb: 'E2E8F0' } } };
                    
                    if (colIdx === qtyColIdx) {
                        cell.alignment = { horizontal: 'center', vertical: 'middle' };
                        cell.numFmt = '#,##0';
                    } else if (colIdx === rateColIdx || colIdx === amountColIdx) {
                        cell.alignment = { horizontal: 'right', vertical: 'middle' };
                        cell.numFmt = '#,##0.00';
                    }
                });

                const excelRow = rowIndex + startRowOffset + 2; // +1 for header, +1 for 1-indexed, offset by project info rows

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
                    const originalRow = tables[tableIndex]?.rows[rowIndex];
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

                if (isAmountNumeric && hasQtyCol && hasRateCol) {
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
                        
                        const colWidthChars = maxImages > 1 ? 18 : 12;
                        const colWidthPx = colWidthChars * 7.5;
                        const colOffset = Math.max(0, (colWidthPx - fit.w) / 2) / colWidthPx;
                        const fitHPoints = fit.h * 0.75;
                        const rowOffset = Math.max(0, (rowHeight - fitHPoints) / 2) / rowHeight;

                        ws.addImage(imgData.imageId, {
                            tl: { col: imgColIdx + colOffset, row: excelRow - 1 + rowOffset },
                            ext: { width: fit.w, height: fit.h }
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
                                ext: { width: fit.w, height: fit.h }
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
                    column.width = maxImages > 1 ? 18 : 12;
                } else if (i === descColIdx) {
                    column.width = 45; // Wider for descriptions
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

            ws.views = [{ state: 'frozen', ySplit: startRowOffset + 1 }];

            // Construct tableSummary
            const tableSummary = table.summary || (table.extractedSummary ? {
                subtotal: parseFloat(table.extractedSummary.totalAmount).toFixed(2),
                vatPercent: vatRates[tableIndex] !== undefined ? vatRates[tableIndex] : 5,
                vatAmount: (parseFloat(table.extractedSummary.totalAmount) * (vatRates[tableIndex] !== undefined ? vatRates[tableIndex] : 5) / 100).toFixed(2),
                grandTotal: (parseFloat(table.extractedSummary.totalAmount) * (1 + (vatRates[tableIndex] !== undefined ? vatRates[tableIndex] : 5) / 100)).toFixed(2),
                currency: detectedCurrency
            } : null);

            const firstDataRow = startRowOffset + 2;
            const lastDataRow = startRowOffset + 1 + table.rows.length;

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
                footerRow.getCell(1).value = `Generated by ${profile.companyName} - ${profile.website}`;
                footerRow.getCell(1).font = { italic: true, size: 9, color: { argb: '94A3B8' } };
                ws.mergeCells(footerRow.number, 1, footerRow.number, 5);
            } else {
                const summaryRow = ws.addRow([`Total: ${table.rows.length} items`]);
                summaryRow.getCell(1).font = { bold: true, color: { argb: secondaryArgb } };
            }

            // Set explicit Print Area to hide costing factors on printout
            if (header.length > 0) {
                const lastColLetter = getColLetter(header.length - 1);
                const lastRowNumber = ws.lastRow ? ws.lastRow.number : 100;
                ws.pageSetup = {
                    printArea: `A1:${lastColLetter}${lastRowNumber}`
                };
            }
        }

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const { saveAs } = await import('file-saver');
        saveAs(blob, `${filename}.xlsx`);
    };

    // ===================== PREMIUM MAS (MATERIAL APPROVAL SHEET) =====================
    const handleGenerateMas = async (sourceTables) => {
        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();

        const arabicLoaded = await loadArabicFont(doc);
        const processText = (txt) => (arabicLoaded && hasArabic(txt)) ? fixArabic(txt) : String(txt || '');

        let pageAdded = false;
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

        for (const table of sourceTables) {
            const header = table.header || [];
            const descIdx = header.findIndex(h => /description|desc/i.test(h));
            const brandIdx = header.findIndex(h => /brand|maker|origin/i.test(h));
            const qtyIdx = header.findIndex(h => /qty|quantity/i.test(h));

            for (const row of table.rows) {
                if (!row.cells.some(c => c.value)) continue;
                if (pageAdded) doc.addPage();
                pageAdded = true;

                // ===== COMPACT HEADER =====
                doc.setFillColor(...colors.primary);
                doc.rect(0, 0, pageWidth, 30, 'F');
                doc.setFillColor(...colors.secondary);
                doc.rect(0, 30, pageWidth, 1, 'F');

                doc.setTextColor(...colors.white);
                doc.setFontSize(14);
                doc.setFont('helvetica', 'bold');
                doc.text('MATERIAL APPROVAL SHEET', pageWidth / 2, 13, { align: 'center' });

                // Company Logo in Header
                const masHeaderLogo = logoWhite || logoOriginal;
                if (masHeaderLogo) {
                    try {
                        const docLogo = await getImageData(masHeaderLogo, { format: 'image/png', maxWidth: 600 });
                        if (docLogo) {
                            // Refined size
                            const fit = calcFitSize(docLogo.width, docLogo.height, 60, 18);
                            doc.addImage(docLogo.dataUrl, 'PNG', pageWidth - 10 - fit.w, 4, fit.w, fit.h);
                        }
                    } catch (e) { }
                }

                // Client Logo in Header if available
                if (project.clientLogo) {
                    try {
                        const cdl = await getImageData(project.clientLogo, { format: 'image/png', maxWidth: 600 });
                        if (cdl) {
                            // Refined size
                            const cfit = calcFitSize(cdl.width, cdl.height, 60, 18);
                            doc.addImage(cdl.dataUrl, 'PNG', 10, 4, cfit.w, cfit.h);
                        }
                    } catch (e) { }
                }

                // Draw Project Info block between header and info bar (Y=32 to Y=50)
                const pY = 32;
                doc.setFillColor(...colors.lightBg);
                doc.setDrawColor(...colors.border);
                doc.setLineWidth(0.3);
                doc.roundedRect(8, pY, pageWidth - 16, 18, 2, 2, 'FD');

                const leftCol = 12, rightCol = pageWidth / 2 + 4;
                const rowH = 4.0;
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
                    const y = pY + 4 + i * rowH;
                    doc.setFont('helvetica', 'bold'); doc.text(r[0], leftCol, y);
                    doc.setFont('helvetica', 'normal'); doc.text(processText(r[1]), leftCol + 26, y);
                    doc.setFont('helvetica', 'bold'); doc.text(r[2], rightCol, y);
                    doc.setFont('helvetica', 'normal'); doc.text(processText(r[3]), rightCol + 30, y);
                });

                // Info bar
                doc.setFillColor(...colors.lightBg);
                doc.rect(0, 52, pageWidth, 12, 'F');
                doc.setTextColor(...colors.text);
                doc.setFontSize(8);
                doc.setFont('helvetica', 'normal');
                doc.text(`Date: ${today}`, 10, 60);
                doc.text(`Item: ${String(itemNumber).padStart(3, '0')}`, pageWidth / 2, 60, { align: 'center' });
                doc.text(`Ref: MAS-${Date.now().toString().slice(-6)}`, pageWidth - 10, 60, { align: 'right' });

                // ===== IMAGE SECTION (with multi-image grid support) =====
                const imageCell = row.cells.find(c => c.images?.length > 0 || c.image);
                const allImages = imageCell?.images || (imageCell?.image ? [imageCell.image] : []);
                let contentY = 75;

                // Load all images (JPEG for MAS products)
                const imageResults = [];
                for (const img of allImages.slice(0, 4)) {
                    if (img?.url) {
                        try {
                            const imgResult = await getImageData(getFullUrl(img.url), { maxWidth: 800, format: 'image/jpeg' });
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
                        imgAreaH = 60;
                        const maxW = 90, maxH = 55;
                        const img = imageResults[0];
                        const fit = calcFitSize(img.width, img.height, maxW, maxH);
                        const imgX = (pageWidth - fit.w) / 2;

                        doc.setFillColor(252, 252, 252);
                        doc.setDrawColor(...colors.border);
                        doc.setLineWidth(0.3);
                        doc.roundedRect(imgX - 3, contentY - 2, fit.w + 6, fit.h + 4, 2, 2, 'FD');
                        doc.addImage(img.dataUrl, 'PNG', imgX, contentY, fit.w, fit.h, '', 'FAST');
                        contentY += fit.h + 12;
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

                // ===== SIGNATURES (dynamic position based on table) =====
                const sigY = Math.max(tableEndY + 10, 200);

                doc.setFillColor(...colors.primary);
                doc.rect(15, sigY, pageWidth - 30, 8, 'F');
                doc.setTextColor(...colors.white);
                doc.setFontSize(8);
                doc.setFont('helvetica', 'bold');
                doc.text('APPROVAL SIGNATURES', pageWidth / 2, sigY + 5.5, { align: 'center' });

                const boxW = 50, boxH = 25;
                const boxY = sigY + 12;
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
                    doc.text(name, x + boxW / 2, boxY + 4, { align: 'center' });

                    doc.setTextColor(...colors.text);
                    doc.setFontSize(6);
                    doc.setFont('helvetica', 'normal');
                    doc.text('Date: __________', x + boxW / 2, boxY + boxH - 2, { align: 'center' });
                });

                // Footer
                doc.setFillColor(...colors.primary);
                doc.rect(0, pageHeight - 8, pageWidth, 8, 'F');
                doc.setTextColor(...colors.white);
                doc.setFontSize(6);
                doc.text('BOQFlow | Material Approval System', pageWidth / 2, pageHeight - 3, { align: 'center' });

                itemNumber++;
            }
        }
        doc.save('MAS_export.pdf');
    };

    // ===================== MATERIAL INSPECTION REPORT (MIR) — 1 PAGE PER ITEM =====================
    const handleGenerateMIR = async (sourceTables) => {
        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const arabicLoaded = await loadArabicFont(doc);
        let pageAdded = false;
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

        for (const table of sourceTables) {
            const header = table.header || [];
            const descIdx = header.findIndex(h => /description|desc|disc|item|product/i.test(h));
            const brandIdx = header.findIndex(h => /brand|maker|origin/i.test(h));
            let qtyIdx = header.findIndex(h => /revised.*qty|revised.*quantity|actual.*qty|actual.*quantity/i.test(h));
            if (qtyIdx === -1) qtyIdx = header.findIndex(h => /qty|quantity|qt/i.test(h));
            const uomIdx = header.findIndex(h => /uom|unit/i.test(h));
            const snIdx = header.findIndex(h => /s\.?n|no\.|#|sr|item|sl/i.test(h));
            const codeIdx = header.findIndex(h => /code|item.*code|ref/i.test(h));

            for (const row of table.rows) {
                if (!row.cells.some(c => c.value)) continue;
                if (pageAdded) doc.addPage();
                pageAdded = true;

                let codeRaw = codeIdx > -1 ? String(row.cells[codeIdx].value || '') : '';
                let snRaw = snIdx > -1 ? String(row.cells[snIdx].value || '') : '';
                let rawTitle = codeRaw.trim() || snRaw.trim() || String(itemNumber).padStart(3, '0');
                let displayTitle = rawTitle.replace(/\n+/g, ', ').replace(/\s{2,}/g, ' ').trim();
                const rowMirRef = `${mirRef}-${String(itemNumber).padStart(3, '0')}`;

                // ── HEADER BAND ──
                doc.setFillColor(...colors.primary);
                doc.rect(0, 0, pageWidth, 30, 'F');
                doc.setFillColor(...colors.accent);
                doc.rect(0, 30, pageWidth, 1, 'F');

                const mirLogo = logoWhite || logoOriginal;
                if (mirLogo) {
                    try {
                        const dl = await getImageData(mirLogo, { format: 'image/png', maxWidth: 600 });
                        if (dl) {
                            // Refined size
                            const fit = calcFitSize(dl.width, dl.height, 60, 18);
                            doc.addImage(dl.dataUrl, 'PNG', 10, 5, fit.w, fit.h);
                        }
                    } catch (e) { }
                }

                if (project.clientLogo) {
                    try {
                        const cdl = await getImageData(project.clientLogo, { format: 'image/png', maxWidth: 600 });
                        if (cdl) {
                            // Refined size
                            const cfit = calcFitSize(cdl.width, cdl.height, 60, 18);
                            doc.addImage(cdl.dataUrl, 'PNG', pageWidth - 10 - cfit.w, 5, cfit.w, cfit.h);
                        }
                    } catch (e) { }
                }

                doc.setTextColor(...colors.white);
                doc.setFontSize(14);
                doc.setFont('helvetica', 'bold');
                doc.text('MATERIAL INSPECTION REQUEST', pageWidth / 2, 16, { align: 'center' });

                doc.setFontSize(7.5);
                doc.setFont('helvetica', 'normal');
                doc.text(`Ref: ${rowMirRef}   |   Item ${displayTitle}   |   Date: ${today}`, pageWidth / 2, 22, { align: 'center' });

                // ── PROJECT INFO ──
                const pY = 32;
                doc.setFillColor(...colors.lightBg);
                doc.setDrawColor(...colors.border);
                doc.setLineWidth(0.3);
                doc.roundedRect(8, pY, pageWidth - 16, 21, 2, 2, 'FD');

                const leftCol = 12, rightCol = pageWidth / 2 + 4;
                const rowH = 4.5;
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
                    const y = pY + 5.5 + i * rowH;
                    doc.setFont('helvetica', 'bold'); doc.text(r[0], leftCol, y);
                    doc.setFont('helvetica', 'normal'); doc.text(processText(r[1]), leftCol + 26, y);
                    doc.setFont('helvetica', 'bold'); doc.text(r[2], rightCol, y);
                    doc.setFont('helvetica', 'normal'); doc.text(processText(r[3]), rightCol + 30, y);
                });

                // ── ITEM DETAILS ──
                const desc = descIdx > -1 ? row.cells[descIdx].value : 'N/A';
                const brand = project.brand || project.brandOrigin || (brandIdx > -1 ? row.cells[brandIdx].value : '') || companyName || 'N/A';
                const qty = qtyIdx > -1 ? row.cells[qtyIdx].value : 'As per BOQ';
                const uom = project.unitOfMeasure ? project.unitOfMeasure : (uomIdx > -1 ? row.cells[uomIdx].value : '');

                let contentY = 49;

                doc.setFillColor(...colors.accent);
                doc.roundedRect(8, contentY, pageWidth - 16, 7, 1, 1, 'F');
                doc.setTextColor(...colors.white);
                doc.setFontSize(8.5);
                doc.setFont('helvetica', 'bold');
                doc.text(`ITEM ${displayTitle} — MATERIAL INSPECTION`, 12, contentY + 4.8);
                contentY += 10;

                // ── UNIFIED IMAGES GRID ──
                const allImages = [];
                for (const cell of row.cells) {
                    const imgs = cell.images || (cell.image ? [cell.image] : []);
                    for (const img of imgs) {
                        if (img?.url) {
                            try {
                                const ir = await getImageData(getFullUrl(img.url), { maxWidth: 800, format: 'image/jpeg' });
                                if (ir) allImages.push(ir);
                            } catch (e) { }
                        }
                    }
                }

                if (allImages.length > 0) {
                    const imgAreaW = pageWidth - 16;
                    const imgAreaH = 65;
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

                const sigY = appY + 6 + 1.5;
                if (sigY + 22 < pageHeight - 8) {
                    doc.setFillColor(...colors.primary);
                    doc.rect(8, sigY, pageWidth - 16, 5, 'F');
                    doc.setTextColor(...colors.white);
                    doc.setFontSize(8);
                    doc.setFont('helvetica', 'bold');
                    doc.text('REVIEWED AND APPROVED BY', pageWidth / 2, sigY + 3.8, { align: 'center' });

                    const sigParties = [
                        { name: 'Submitted By\n(Contractor)', keep: project.includeContractor !== false },
                        { name: 'Checked By\n(Consultant)', keep: project.includeConsultant !== false },
                        { name: `Approved By\n(Client)` + (project.clientRepName ? `\n${project.clientRepName}` : '') + (project.clientRepDesignation ? `\n${project.clientRepDesignation}` : ''), keep: true }
                    ].filter(p => p.keep).map(p => p.name);

                    const boxW = 54, boxH = 21, boxY = sigY + 6.5;
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
                }

                doc.setFillColor(...colors.primary);
                doc.rect(0, pageHeight - 8, pageWidth, 8, 'F');
                doc.setTextColor(...colors.white);
                doc.setFontSize(6);
                doc.text(`Material Inspection Request | ${rowMirRef}  |  Item ${displayTitle}`, pageWidth / 2, pageHeight - 3, { align: 'center' });

                itemNumber++;
            }
        }
        doc.save('MIR_export.pdf');
    };

    // ===================== WORK INSPECTION REQUEST (WIR) — 1 PAGE PER ITEM =====================
    const handleGenerateWIR = async (sourceTables) => {
        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const arabicLoaded = await loadArabicFont(doc);
        let pageAdded = false;
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

        for (const table of sourceTables) {
            const header = table.header || [];
            const descIdx = header.findIndex(h => /description|desc|disc|item|product/i.test(h));
            const brandIdx = header.findIndex(h => /brand|maker|origin/i.test(h));
            let qtyIdx = header.findIndex(h => /revised.*qty|revised.*quantity|actual.*qty|actual.*quantity/i.test(h));
            if (qtyIdx === -1) qtyIdx = header.findIndex(h => /qty|quantity|qt/i.test(h));
            const uomIdx = header.findIndex(h => /uom|unit/i.test(h));
            const snIdx = header.findIndex(h => /s\.?n|no\.|#|sr|item|sl/i.test(h));
            const codeIdx = header.findIndex(h => /code|item.*code|ref/i.test(h));

            for (const row of table.rows) {
                if (!row.cells.some(c => c.value)) continue;
                if (pageAdded) doc.addPage();
                pageAdded = true;

                let codeRaw = codeIdx > -1 ? String(row.cells[codeIdx].value || '') : '';
                let snRaw = snIdx > -1 ? String(row.cells[snIdx].value || '') : '';
                let rawTitle = codeRaw.trim() || snRaw.trim() || String(itemNumber).padStart(3, '0');
                let displayTitle = rawTitle.replace(/\n+/g, ', ').replace(/\s{2,}/g, ' ').trim();
                const rowWirRef = `${wirRef}-${String(itemNumber).padStart(3, '0')}`;

                // ── HEADER ──
                doc.setFillColor(...colors.primary);
                doc.rect(0, 0, pageWidth, 30, 'F');
                doc.setFillColor(...colors.accent);
                doc.rect(0, 30, pageWidth, 1, 'F');

                const wirLogo = logoWhite || logoOriginal;
                if (wirLogo) {
                    try {
                        const dl = await getImageData(wirLogo, { format: 'image/png', maxWidth: 600 });
                        if (dl) {
                            // Refined size
                            const fit = calcFitSize(dl.width, dl.height, 60, 18);
                            doc.addImage(dl.dataUrl, 'PNG', 10, 5, fit.w, fit.h);
                        }
                    } catch (e) { }
                }

                if (project.clientLogo) {
                    try {
                        const cdl = await getImageData(project.clientLogo, { format: 'image/png', maxWidth: 600 });
                        if (cdl) {
                            // Refined size
                            const cfit = calcFitSize(cdl.width, cdl.height, 60, 18);
                            doc.addImage(cdl.dataUrl, 'PNG', pageWidth - 10 - cfit.w, 4, cfit.w, cfit.h);
                        }
                    } catch (e) { }
                }

                doc.setTextColor(...colors.white);
                doc.setFontSize(14);
                doc.setFont('helvetica', 'bold');
                doc.text('WORK INSPECTION REQUEST', pageWidth / 2, 16, { align: 'center' });

                doc.setFontSize(7.5);
                doc.setFont('helvetica', 'normal');
                doc.text(`Ref: ${rowWirRef}   |   Item ${displayTitle}   |   Date: ${today}`, pageWidth / 2, 22, { align: 'center' });

                // ── PROJECT INFO ──
                const pY = 32;
                doc.setFillColor(...colors.lightBg);
                doc.setDrawColor(...colors.border);
                doc.setLineWidth(0.3);
                doc.roundedRect(8, pY, pageWidth - 16, 21, 2, 2, 'FD');

                const leftCol = 12, rightCol = pageWidth / 2 + 4;
                const rowH = 4.5;
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
                    const y = pY + 5.5 + i * rowH;
                    doc.setFont('helvetica', 'bold'); doc.text(r[0], leftCol, y);
                    doc.setFont('helvetica', 'normal'); doc.text(processText(r[1]), leftCol + 26, y);
                    doc.setFont('helvetica', 'bold'); doc.text(r[2], rightCol, y);
                    doc.setFont('helvetica', 'normal'); doc.text(processText(r[3]), rightCol + 30, y);
                });

                // ── ITEM DETAILS ──
                const desc = descIdx > -1 ? row.cells[descIdx].value : 'N/A';
                const brand = brandIdx > -1 ? row.cells[brandIdx].value : 'N/A';
                const qty = qtyIdx > -1 ? row.cells[qtyIdx].value : 'As per BOQ';
                const uom = uomIdx > -1 ? row.cells[uomIdx].value : 'No.';

                let contentY = 49;

                doc.setFillColor(...colors.accent);
                doc.roundedRect(8, contentY, pageWidth - 16, 7, 1, 1, 'F');
                doc.setTextColor(...colors.white);
                doc.setFontSize(8.5);
                doc.setFont('helvetica', 'bold');
                doc.text(`ITEM ${displayTitle} — WORK INSPECTION`, 12, contentY + 4.8);
                contentY += 10;

                // ── UNIFIED IMAGES GRID ──
                const allImages = [];
                for (const cell of row.cells) {
                    const imgs = cell.images || (cell.image ? [cell.image] : []);
                    for (const img of imgs) {
                        if (img?.url) {
                            try {
                                const ir = await getImageData(getFullUrl(img.url), { maxWidth: 800, format: 'image/jpeg' });
                                if (ir) allImages.push(ir);
                            } catch (e) { }
                        }
                    }
                }

                if (allImages.length > 0) {
                    const imgAreaW = pageWidth - 16;
                    const imgAreaH = 65;
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

                const sigY = appY + 6 + 1.5;
                if (sigY + 22 < pageHeight - 8) {
                    doc.setFillColor(...colors.primary);
                    doc.rect(8, sigY, pageWidth - 16, 5, 'F');
                    doc.setTextColor(...colors.white);
                    doc.setFontSize(8);
                    doc.setFont('helvetica', 'bold');
                    doc.text('REVIEWED AND APPROVED BY', pageWidth / 2, sigY + 3.8, { align: 'center' });

                    const sigParties = [
                        { name: 'Requested By\n(Contractor)', keep: project.includeContractor !== false },
                        { name: 'Inspected By\n(Consultant)', keep: project.includeConsultant !== false },
                        { name: `Approved By\n(Client)` + (project.clientRepName ? `\n${project.clientRepName}` : '') + (project.clientRepDesignation ? `\n${project.clientRepDesignation}` : ''), keep: true }
                    ].filter(p => p.keep).map(p => p.name);

                    const boxW = 54, boxH = 21, boxY = sigY + 6.5;
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
                }

                doc.setFillColor(...colors.primary);
                doc.rect(0, pageHeight - 8, pageWidth, 8, 'F');
                doc.setTextColor(...colors.white);
                doc.setFontSize(6);
                doc.text(`Work Inspection Request | ${rowWirRef}  |  Item ${displayTitle}`, pageWidth / 2, pageHeight - 3, { align: 'center' });

                itemNumber++;
            }
        }
        doc.save('WIR_export.pdf');
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
        const [whiteLogoInfo, colorLogoInfo] = await Promise.all([
            logoWhite ? getImageData(logoWhite, { format: 'image/png', maxWidth: 400 }).catch(() => null) : Promise.resolve(null),
            logoOriginal ? getImageData(logoOriginal, { format: 'image/png', maxWidth: 400 }).catch(() => null) : Promise.resolve(null)
        ]);

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

        drawHeader();

        // Project Info - Card starting at Y=35 to fix overlaps
        let currentY = 35;
        doc.setFillColor(...colors.lightBg);
        doc.setDrawColor(...colors.border);
        doc.roundedRect(10, currentY, pageWidth - 20, 35, 2, 2, 'FD');

        const pRows = [
            ['Project:', project.projectName || '—', 'Client:', project.clientName || '—'],
            ['Location:', project.locationZone || '—', 'Project No:', project.projectNumber || '—'],
            ['Contractor:', project.contractor || '—', 'Consultant:', project.consultant || '—'],
            ['Delivery Mode:', 'Road Transport', 'Status:', 'Good Condition'],
        ];

        pRows.forEach((r, i) => {
            const y = currentY + 8 + i * 7;
            doc.setFontSize(9);
            doc.setFont('helvetica', 'bold'); doc.setTextColor(...colors.primary); doc.text(r[0], 15, y);
            doc.setFont('helvetica', 'normal'); doc.setTextColor(...colors.text); doc.text(processText(r[1]), 42, y);
            doc.setFont('helvetica', 'bold'); doc.setTextColor(...colors.primary); doc.text(r[2], pageWidth / 2 + 5, y);
            doc.setFont('helvetica', 'normal'); doc.setTextColor(...colors.text); doc.text(processText(r[3]), pageWidth / 2 + 38, y);
        });

        currentY += 45;

        // Collect Items
        const allItems = [];
        sourceTables.forEach(table => {
            const header = table.header || [];
            const descIdx = header.findIndex(h => /description|desc|disc|item|product/i.test(h));
            const qtyIdx = header.findIndex(h => /qty|quantity|qt/i.test(h));
            const unitIdx = header.findIndex(h => /unit|uom/i.test(h));
            const brandIdx = header.findIndex(h => /brand|maker|origin/i.test(h));

            table.rows.forEach(row => {
                if (row.isHeader || row.isSummary || !row.cells.some(c => c.value)) return;
                const qtyVal = qtyIdx > -1 ? parseFloat(String(row.cells[qtyIdx]?.value || '0').replace(/,/g, '')) : 0;
                if (isNaN(qtyVal) || qtyVal <= 0) return;

                allItems.push({
                    description: descIdx > -1 ? String(row.cells[descIdx]?.value || '') : 'N/A',
                    brand: brandIdx > -1 ? String(row.cells[brandIdx]?.value || '') : '—',
                    qty: qtyVal,
                    unit: unitIdx > -1 ? String(row.cells[unitIdx]?.value || '') : 'No.'
                });
            });
        });

        autoTable(doc, {
            startY: currentY,
            margin: { top: 30, left: 10, right: 10 },
            head: [['S.N', 'Material Description', 'Brand / Origin', 'Unit', 'Delivered Qty', 'Remarks']],
            body: allItems.map((item, i) => [
                i + 1,
                processText(item.description),
                processText(item.brand),
                processText(item.unit),
                item.qty,
                ''
            ]),
            theme: 'grid',
            styles: {
                fontSize: 8,
                cellPadding: 3,
                font: arabicLoaded ? 'Almarai' : 'helvetica',
                valign: 'middle'
            },
            headStyles: {
                fillColor: colors.primary,
                textColor: colors.white,
                fontStyle: 'bold',
                halign: 'center'
            },
            columnStyles: {
                0: { cellWidth: 10, halign: 'center' },
                1: { cellWidth: 'auto' },
                2: { cellWidth: 35 },
                3: { cellWidth: 15, halign: 'center' },
                4: { cellWidth: 25, halign: 'center' },
                5: { cellWidth: 25 }
            },
            didDrawPage: (data) => {
                // For pages > 1, add the colored logo on white background
                if (doc.internal.getNumberOfPages() > 1) {
                    const dlCol = colorLogoInfo || whiteLogoInfo;
                    if (dlCol) {
                        const fit = calcFitSize(dlCol.width, dlCol.height, 105, 36);
                        doc.addImage(dlCol.dataUrl, 'PNG', 10, 8, fit.w, fit.h);
                    }
                }
                
                doc.setFontSize(8);
                doc.setTextColor(150, 150, 150);
                doc.text(`Reference: ${dnRef} | Page ${doc.internal.getNumberOfPages()}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
            }
        });

        let lastY = doc.lastAutoTable.finalY + 20;
        if (lastY > pageHeight - 40) {
            doc.addPage();
            lastY = 30; // Start below logo
            
            // Add Logo to manual page
            const dlCol = colorLogoInfo || whiteLogoInfo;
            if (dlCol) {
                const fit = calcFitSize(dlCol.width, dlCol.height, 35, 12);
                doc.addImage(dlCol.dataUrl, 'PNG', 10, 8, fit.w, fit.h);
            }
            
            // Add Footer to manual page
            doc.setFontSize(8);
            doc.setTextColor(150, 150, 150);
            doc.text(`Reference: ${dnRef} | Page ${doc.internal.getNumberOfPages()}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
        }

        // Signatures
        const sigNames = ['Prepared By', 'Authorized By', 'Customer Signature'];
        const sigW = 55, sigH = 25;
        const sigGap = (pageWidth - 20 - sigW * 3) / 2;

        sigNames.forEach((name, i) => {
            const x = 10 + i * (sigW + sigGap);
            doc.setDrawColor(...colors.border);
            doc.rect(x, lastY, sigW, sigH);
            doc.setFontSize(8);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...colors.primary);
            doc.text(name, x + sigW / 2, lastY + 5, { align: 'center' });
            doc.line(x + 5, lastY + sigH - 8, x + sigW - 5, lastY + sigH - 8);
            doc.setFontSize(7);
            doc.setFont('helvetica', 'normal');
            doc.text('Signature & Date', x + sigW / 2, lastY + sigH - 3, { align: 'center' });
        });

        doc.save(`DeliveryNote_${dnRef}.pdf`);
    };

    // ===================== PREMIUM POWERPOINT PRESENTATION (LIGHT THEME) =====================
    const handleGeneratePresentation = async (sourceTables, returnBase64 = false, templateId = 'corporate') => {
        const PptxGenJS = (await import('pptxgenjs')).default;
        const pres = new PptxGenJS();
        const totalItems = sourceTables.reduce((acc, t) => acc + t.rows.length, 0);

        pres.author = 'BOQFlow';
        pres.title = 'Product Presentation';
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
            detailHeaderColor = '#FFFFFF';
            footerLinkColor = brandColors.accent;
            footerTextColor = brandColors.lightText;
            headerTextColor = '#FFFFFF';
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
            headerTextColor = '#FFFFFF';
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
            } catch (e) {}
        }
        if (project.clientLogo) {
            try {
                clientLogoData = await getImageData(project.clientLogo, { format: 'image/png', maxWidth: 400 });
            } catch (e) {}
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

        for (const table of sourceTables) {
            const header = table.header || [];
            const descIdx = header.findIndex(h => /description|desc|disc|item|product/i.test(h));
            const brandIdx = header.findIndex(h => /brand|maker|origin/i.test(h));
            const qtyIdx = header.findIndex(h => /qty|quantity|qt/i.test(h));
            const finishIdx = header.findIndex(h => /finish|color|material/i.test(h));

            for (const row of table.rows) {
                if (!row.cells.some(c => c.value)) continue;

                const slide = pres.addSlide({ masterName: 'BOQ_MASTER' });
                drawSlideDecorations(slide);

                // Get all images from the row
                const imageCell = row.cells.find(c => c.images?.length > 0 || c.image);
                const allImages = imageCell?.images || (imageCell?.image ? [imageCell.image] : []);

                // Get product info
                const desc = descIdx > -1 ? String(row.cells[descIdx].value || '') : '';
                const brandVal = brandIdx > -1 ? String(row.cells[brandIdx].value || '') : '';
                const qty = qtyIdx > -1 ? String(row.cells[qtyIdx].value || '') : '';
                const finish = finishIdx > -1 ? String(row.cells[finishIdx].value || '') : '';

                // Extract first line/product name for header (short, no overflow)
                const firstLine = desc.split(/[\n*•]/)[0].trim();
                const headerTitle = firstLine.length > 50 ? firstLine.substring(0, 47) + '...' : firstLine;

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

                slide.addText(`Item ${itemNum}: ${headerTitle}`, {
                    x: titleX, y: 0.15, w: titleW, h: 0.4,
                    fontSize: 14, color: headerTextColor, bold: true, fontFace: fontFace, valign: 'middle'
                });

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

                // Pre-load all images to get actual dimensions
                const loadedImages = [];
                for (const img of allImages.slice(0, 4)) {
                    if (img?.url) {
                        try {
                            const imgResult = await getImageData(getFullUrl(img.url));
                            if (imgResult) loadedImages.push(imgResult);
                        } catch (e) { }
                    }
                }

                // Helper to convert inches to pixels for aspect ratio calc (96 DPI)
                const inchesToPx = (inches) => inches * 96;
                const pxToInches = (px) => px / 96;

                if (loadedImages.length === 1) {
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

                // Brand fallback logic
                const rowBrand = brandVal.trim();
                const brand = rowBrand || project.brand || project.brandOrigin || companyName || 'N/A';

                // Brand and Qty side-by-side above the footer
                const footerY = 4.72;
                slide.addText('Brand:', {
                    x: detailX, y: footerY, w: 0.75, h: 0.35,
                    fontSize: 10, bold: true, color: labelColor, fontFace: fontFace, valign: 'middle'
                });
                slide.addText(brand, {
                    x: detailX + 0.75, y: footerY, w: 1.65, h: 0.35,
                    fontSize: 9, color: valueColor, fontFace: fontFace, valign: 'middle'
                });

                // Quantity
                slide.addText('Qty:', {
                    x: detailX + 2.5, y: footerY, w: 0.5, h: 0.35,
                    fontSize: 10, bold: true, color: labelColor, fontFace: fontFace, valign: 'middle'
                });
                slide.addText(qty || 'As per BOQ', {
                    x: detailX + 3.0, y: footerY, w: 1.7, h: 0.35,
                    fontSize: 9, color: valueColor, fontFace: fontFace, valign: 'middle'
                });

                // ===== FOOTER =====
                // Warranty notice
                slide.addText('Warranty', {
                    x: 0.2, y: 5.08, w: 1, h: 0.18,
                    fontSize: 8, bold: true, color: labelColor, fontFace: fontFace
                });
                slide.addText('As per manufacturer - 5 years', {
                    x: 0.2, y: 5.24, w: 2.5, h: 0.15,
                    fontSize: 7, color: footerTextColor, fontFace: fontFace
                });

                // Page URL/reference
                slide.addText(website || 'https://alshayaenterprises.com', {
                    x: 3.5, y: 5.32, w: 3, h: 0.15,
                    fontSize: 7, color: footerLinkColor, fontFace: fontFace, align: 'center'
                });

                // Page number
                slide.addText(`${itemNum} / ${totalItems}`, {
                    x: 8.5, y: 5.32, w: 1, h: 0.15,
                    fontSize: 7, color: footerTextColor, fontFace: fontFace, align: 'right'
                });

                itemNum++;
            }
        }
        if (returnBase64) {
            return await pres.write({ outputType: 'base64' });
        } else {
            pres.writeFile({ fileName: 'presentation_export.pptx' });
        }
    };

    const triggerPptxExport = (sourceTables, asPdf = false) => {
        setPptxSourceTables(sourceTables);
        setPptxAsPdf(asPdf);
        setShowPptxModal(true);
    };

    const handleTemplateModalExport = async (templateId) => {
        setShowPptxModal(false);
        if (!pptxSourceTables) return;
        
        if (pptxAsPdf) {
            await handleGeneratePptPdf(pptxSourceTables, templateId);
        } else {
            setIsGeneratingPpt(true);
            try {
                await handleGeneratePresentation(pptxSourceTables, false, templateId);
            } catch (err) {
                console.error(err);
                alert(`Export failed: ${err.message}`);
            } finally {
                setIsGeneratingPpt(false);
            }
        }
    };

    // ===================== PREMIUM PRESENTATION PDF =====================
    const handleGeneratePptPdf = async (sourceTables, templateId = 'corporate') => {
        setIsGeneratingPpt(true);
        try {
            console.log(`🚀 [Frontend] Generating PPTX natively with template ${templateId} to send for PDF conversion...`);
            
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
                const errData = await response.json();
                throw new Error(errData.error || 'Server failed to generate presentation');
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
            
            console.log('✅ [Background] Presentation PDF downloaded.');
        } catch (err) {
            console.error('❌ [Background] Presentation PDF error:', err);
            alert(`Failed to generate high-fidelity PDF: ${err.message}. Falling back to standard generation.`);
            // You could call the old jsPDF logic here as fallback, but let's try to fix the server first
        } finally {
            setIsGeneratingPpt(false);
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

        let itemNumber = 1;
        const totalItems = sourceTables.reduce((acc, t) => acc + t.rows.length, 0);

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

            for (const row of table.rows) {
                if (!row.cells.some(c => c.value)) continue;
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

                // Item title in header - handle multi-line if needed
                const arabicLoaded = await loadArabicFont(doc);
                const processText = (txt) => (arabicLoaded && hasArabic(txt)) ? fixArabic(txt) : String(txt || '');

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
                    if (img?.url) {
                        try {
                            const imgResult = await getImageData(getFullUrl(img.url));
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
                        {isCosted ? '💰 ' : ''}Sheet: {table.sheetName} {isCosted ? '(Simulated Costs)' : ''}
                    </h3>
                    <span className={styles.rowCount}>
                        {table.rows.length} rows × {table.columnCount} columns
                    </span>
                </div>

                <div className={styles.tableWrapper}>
                    <table className={styles.table}>
                        <thead>
                            {table.header && (
                                <tr className={styles.headerRow}>
                                    {table.header.map((h, i) => <th key={i}>{h}</th>)}
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
                                                         <span className={styles.sectionIcon}>📁</span>
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
                                                 const isSnCol = /s\.?n|no|#|sr|item|sl/i.test(table.header?.[cellIndex] || '');
                                                 
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
 
                                                             // Standard extraction image fallback
                                                             if (cell && ((cell.images && cell.images.length > 0) || cell.image)) {
                                                                 return (
                                                                     <div className={(cell.images?.length > 1) ? styles.imageGrid : styles.cellImage}>
                                                                         {(cell.images || [cell.image]).map((imgData, imgIdx) => (
                                                                             <img
                                                                                 key={imgIdx}
                                                                                 src={getFullUrl(imgData)}
                                                                                 alt="Thumb"
                                                                                 className={styles.image}
                                                                                 onClick={() => imgData && setSelectedImage(getFullUrl(imgData))}
                                                                                 onError={(e) => {
                                                                                     e.target.style.display = 'none';
                                                                                     const ph = document.createElement('div');
                                                                                     ph.className = styles.imgNoData;
                                                                                     ph.textContent = 'No Image';
                                                                                     e.target.parentNode.appendChild(ph);
                                                                                 }}
                                                                                 style={{ cursor: 'pointer' }}
                                                                             />
                                                                         ))}
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
                    const vatAmt = totalAmt * (vatPct / 100);
                    const grandTotal = totalAmt + vatAmt;
                    return (
                        <div className={styles.summarySection} style={{ borderColor: UI_COLORS.primary }}>
                            <div className={styles.summaryDetailRow}>
                                <span>Total:</span>
                                <span style={{ color: UI_COLORS.primary, fontWeight: 600 }}>{totalAmt.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
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
                                <span style={{ color: UI_COLORS.muted, marginLeft: '8px' }}>{vatAmt.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                            </div>
                            <div className={styles.summaryTotal} style={{ color: UI_COLORS.primary }}>
                                <span>Grand Total:</span>
                                <span>{grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                            </div>
                        </div>
                    );
                })()}
            </div>
        ))
    );

    if (!tables || tables.length === 0) return <div className={styles.noData}>No tables found in the uploaded file</div>;

    return (
        <div className={styles.viewerContainer}>

            {/* 1. Original Data Top Header */}
            <div className={styles.header}>
                <h2 className={styles.title}>📋 Extracted Data ({tables.length} {tables.length === 1 ? 'Table' : 'Tables'})</h2>
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
                        ☰ Project Settings
                        {(project.projectName || project.clientName) && (
                            <span className={actionStyles.projectBadge}>
                                {project.projectName || project.clientName}
                            </span>
                        )}
                    </button>
                </div>
                <div className={actionStyles.buttonGroup}>
                    <button className={actionStyles.actionBtn} onClick={() => handleDownloadPDF(tablesWithSummary, 'Original_Offer')}>📄 Download Offer PDF</button>
                    <button className={actionStyles.actionBtn} onClick={() => handleDownloadExcel(tablesWithSummary, 'Original_Offer')}>📊 Download Offer Excel</button>
                    <button className={actionStyles.actionBtn} onClick={() => triggerPptxExport(tablesWithSummary, false)}>📽️ Generate Presentation</button>
                    <button 
                        className={`${actionStyles.actionBtn} ${isGeneratingPpt ? actionStyles.loading : ''}`} 
                        onClick={() => triggerPptxExport(tablesWithSummary, true)}
                        disabled={isGeneratingPpt}
                    >
                        {isGeneratingPpt ? '⏳ Generating...' : '📑 Presentation PDF'}
                    </button>

                    <button className={actionStyles.actionBtn} onClick={() => handleGenerateMas(tablesWithSummary)}>📋 Generate MAS</button>
                    <button className={`${actionStyles.actionBtn} ${actionStyles.actionBtnMir}`} onClick={() => handleGenerateMIR(tablesWithSummary)}>🔍 Generate MIR</button>
                    <button className={`${actionStyles.actionBtn} ${actionStyles.actionBtnWir}`} onClick={() => handleGenerateWIR(tablesWithSummary)}>🔧 Generate WIR</button>
                    <button className={`${actionStyles.actionBtn} ${actionStyles.actionBtnDn}`} onClick={() => handleGenerateDeliveryNote(tablesWithSummary)}>🚚 Delivery Note</button>
                    <button className={`${actionStyles.actionBtn} ${actionStyles.actionBtnDn}`} style={{ background: '#10b981', color: '#ffffff', borderColor: '#059669', fontWeight: '500' }} onClick={() => setTenderAutofillOpen(true)}>🤖 Autofill on Tender Board</button>
                </div>
            </div>

            {/* Costing Trigger Button (Centrally Placed) */}
            {/* Action Triggers */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '2rem', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', gap: '2rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button className={actionStyles.btnCostingTrigger} onClick={() => setCostingOpen(true)}>
                        💰 Apply Costing Factors
                    </button>
                    <button className={actionStyles.btnMultiBudget} onClick={() => setMultiBudgetOpen(true)}>
                        📦 Multi Budget Offer
                    </button>
                    <button 
                        className={actionStyles.btnAiValueEngineer} 
                        onClick={() => setValueEngineeredOpen(true)}
                    >
                        ✨ AI Value Engineer
                    </button>
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
                        <h2 className={styles.title} style={{ color: UI_COLORS.costing }}>💰 Cost Simulation Results</h2>
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
                                ☰ Project Settings
                                {(project.projectName || project.clientName) && (
                                    <span className={actionStyles.projectBadge}>
                                        {project.projectName || project.clientName}
                                    </span>
                                )}
                            </button>
                        </div>
                        <div className={actionStyles.buttonGroup}>
                            <button className={actionStyles.actionBtn} onClick={() => handleDownloadPDF(costedTables, 'Costed_Offer')}>📄 Download Costed PDF</button>
                            <button className={actionStyles.actionBtn} onClick={() => handleDownloadExcel(costedTables, 'Costed_Offer')}>📊 Download Costed Excel</button>
                            <button className={actionStyles.actionBtn} onClick={() => triggerPptxExport(costedTables, false)}>📽️ Generate Costed Presentation</button>
                            <button 
                                className={`${actionStyles.actionBtn} ${isGeneratingPpt ? actionStyles.loading : ''}`} 
                                onClick={() => triggerPptxExport(costedTables, true)}
                                disabled={isGeneratingPpt}
                            >
                                {isGeneratingPpt ? '⏳ Generating...' : '📑 Costed Presentation PDF'}
                            </button>

                            <button className={actionStyles.actionBtn} onClick={() => handleGenerateMas(costedTables)}>📋 Generate Costed MAS</button>
                            <button className={`${actionStyles.actionBtn} ${actionStyles.actionBtnMir}`} onClick={() => handleGenerateMIR(costedTables)}>🔍 Generate Costed MIR</button>
                            <button className={`${actionStyles.actionBtn} ${actionStyles.actionBtnWir}`} onClick={() => handleGenerateWIR(costedTables)}>🔧 Generate Costed WIR</button>
                            <button className={`${actionStyles.actionBtn} ${actionStyles.actionBtnDn}`} onClick={() => handleGenerateDeliveryNote(costedTables)}>🚚 Costed Delivery Note</button>
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
                    setTables(formattedData.tables);
                    setCostingFactors(formattedData.costingFactors);
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
                    setTables(data.tables);
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
                    setCostingFactors(factors);
                    setCostingOpen(false);
                }}
            />

            <PptxTemplateModal
                isOpen={showPptxModal}
                onClose={() => setShowPptxModal(false)}
                onExport={handleTemplateModalExport}
                isGenerating={isGeneratingPpt}
            />

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
