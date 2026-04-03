import { useState, useEffect, useMemo } from 'react';
import styles from '../styles/TableViewer.module.css';
import actionStyles from '../styles/ActionBar.module.css';
import CostingModal from './CostingModal';
import MultiBudgetModal from './MultiBudgetModal';
import ProjectSettingsPanel from './ProjectSettingsPanel';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

import { useCompanyProfile } from '../context/CompanyContext';
import { useProject } from '../context/ProjectContext';
import { fixArabic, hasArabic, loadArabicFont } from '../utils/arabicPdfUtils';

import { getApiBase } from '../utils/apiBase';

const API_BASE = getApiBase();

const getFullUrl = (url) => {
    if (!url) return '';
    let normalizedUrl = url;
    if (url.startsWith('//')) {
        normalizedUrl = 'https:' + url;
    }
    // Proxy Architonic and Amara Art images to bypass hotlink protection/CORS
    if (normalizedUrl.includes('amara-art.com') || normalizedUrl.includes('architonic.com')) {
        // Base64 encode the URL to bypass client-side antivirus/firewall URL inspection
        try {
            return `${API_BASE}/api/image-proxy?url=${encodeURIComponent(btoa(normalizedUrl))}`;
        } catch (e) {
            return `${API_BASE}/api/image-proxy?url=${encodeURIComponent(normalizedUrl)}`;
        }
    }
    if (normalizedUrl.startsWith('http') || normalizedUrl.startsWith('data:')) return normalizedUrl;
    return `${API_BASE}${normalizedUrl}`;
};


function TableViewer({ data }) {
    const profile = useCompanyProfile();
    const { companyName, logoWhite, logoBlue, website } = profile;
    const { project, updateProject } = useProject();
    const [selectedImage, setSelectedImage] = useState(null);
    const [tables, setTables] = useState([]); // Base Data
    const [costingFactors, setCostingFactors] = useState(null);
    const [isCostingOpen, setCostingOpen] = useState(false);
    const [isMultiBudgetOpen, setMultiBudgetOpen] = useState(false);
    const [isProjectPanelOpen, setProjectPanelOpen] = useState(false);

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
            
            // Allow pre-initialized costing factors from parent (e.g. from MultiBudgetModal)
            if (data.costingFactors) {
                setCostingFactors(data.costingFactors);
            }
        }
    }, [data]);

    // Compute summary for original extracted tables
    const tablesWithSummary = useMemo(() => {
        return tables.map(table => {
            const header = table.header || [];

            // Find rate and amount/total columns
            const rateIdx = header.findIndex(h => /rate|price|unit.*price/i.test(h));
            const amountIdx = header.findIndex(h => /amount|total/i.test(h));
            const qtyIdx = header.findIndex(h => /qty|quantity/i.test(h));

            // Calculate totals
            let totalRate = 0;
            let totalAmount = 0;
            let totalQty = 0;
            let validRows = 0;

            table.rows.forEach(row => {
                if (row.isHeader || row.isSummary) return;

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
                /rate|price|amount|total/i.test(h) ? i : -1
            ).filter(i => i !== -1);

            const amountIdx = header.findIndex(h => /amount|total/i.test(h));

            const newRows = table.rows.map(row => {
                const newCells = row.cells.map((cell, idx) => {
                    // Only modify money columns
                    if (moneyIndices.includes(idx) && cell.value) {
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

        // Premium Color Palette
        const colors = {
            primary: [30, 41, 59],       // Slate 800
            secondary: [245, 158, 11],   // Amber 500
            accent: [16, 185, 129],      // Emerald 500
            text: [51, 65, 85],          // Slate 600
            lightBg: [248, 250, 252],    // Slate 50
            white: [255, 255, 255]
        };

        // ===== COVER PAGE =====
        // Premium Header Section
        doc.setFillColor(...colors.primary);
        doc.rect(0, 0, pageWidth, 100, 'F');
        doc.setFillColor(...colors.secondary);
        doc.rect(0, 100, pageWidth, 2, 'F');

        // Add Company Logo to Header if available
        const coverLogo = logoWhite || logoBlue;
        if (coverLogo) {
            try {
                const docLogo = await getImageData(coverLogo, { format: 'image/png', maxWidth: 800 });
                if (docLogo) {
                    const fit = calcFitSize(docLogo.width, docLogo.height, 80, 30);
                    doc.addImage(docLogo.dataUrl, 'PNG', (pageWidth - fit.w) / 2, 15, fit.w, fit.h);
                }
            } catch (e) { }
        } else {
            // Company Name as fallback in Header
            const cName = companyName || 'COMMERCIAL OFFER';
            doc.setTextColor(...colors.white);
            doc.setFontSize(24);
            const isArabicCName = hasArabic(cName);
            doc.setFont(isArabicCName && arabicLoaded ? 'Almarai' : 'helvetica', 'bold');
            doc.text(isArabicCName ? fixArabic(cName) : cName, pageWidth / 2, 30, { align: 'center' });
        }

        // Title
        doc.setTextColor(...colors.white);
        doc.setFontSize(30);
        doc.setFont('helvetica', 'bold');
        doc.text('COMMERCIAL OFFER', pageWidth / 2, 65, { align: 'center' });

        // Subtitle
        doc.setFontSize(14);
        doc.setFont('helvetica', 'normal');
        doc.text('Bill of Quantities & Pricing Schedule', pageWidth / 2, 75, { align: 'center' });

        // Date Badge
        doc.setFillColor(...colors.secondary);
        doc.roundedRect(pageWidth / 2 - 25, 82, 50, 10, 2, 2, 'F');
        doc.setFontSize(10);
        doc.setTextColor(...colors.primary);
        const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        doc.text(today, pageWidth / 2, 88.5, { align: 'center' });

        // Document Info Section
        doc.setTextColor(...colors.text);
        doc.setFontSize(11);
        let infoY = 135;
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

        // Decorative Line
        doc.setDrawColor(...colors.secondary);
        doc.setLineWidth(2);
        doc.line(20, infoY + 12, pageWidth - 20, infoY + 12);

        // Footer on Cover
        doc.setFontSize(9);
        doc.setTextColor(150, 150, 150);
        const footerText = profile.website || profile.companyName || 'BOQFLOW - Intelligent Estimation System';
        const isArabicFooter = hasArabic(footerText);
        doc.setFont(isArabicFooter && arabicLoaded ? 'Almarai' : 'helvetica', 'normal');
        doc.text(isArabicFooter ? fixArabic(footerText) : footerText, pageWidth / 2, pageHeight - 15, { align: 'center' });

        // ===== DATA PAGES =====
        for (const table of sourceTables) {
            doc.addPage();

            // Page Header
            doc.setFillColor(...colors.primary);
            doc.rect(0, 0, pageWidth, 20, 'F');
            doc.setTextColor(...colors.white);
            doc.setFontSize(12);
            const sheetTitle = (table.sheetName && !table.sheetName.includes("Combined")) ? table.sheetName : (profile.companyName || 'COMMERCIAL OFFER');
            doc.text(sheetTitle, 10, 13);

            // Company Logo in Header
            const headerLogo = logoWhite || logoBlue;
            if (headerLogo) {
                try {
                    const docLogo = await getImageData(headerLogo, { format: 'image/png', maxWidth: 400 });
                    if (docLogo) {
                        const fit = calcFitSize(docLogo.width, docLogo.height, 35, 12);
                        doc.addImage(docLogo.dataUrl, 'PNG', pageWidth - 10 - fit.w, 4, fit.w, fit.h);
                    }
                } catch (e) { }
            }

            // Find column indices
            const header = table.header || [];
            const imgColIdx = header.findIndex(h => /image|photo|picture/i.test(h));
            const descColIdx = header.findIndex(h => /description|desc/i.test(h));
            const snColIdx = header.findIndex(h => /s\.?n|no|#|sr/i.test(h));
            const qtyColIdx = header.findIndex(h => /qty|quantity/i.test(h));
            const rateColIdx = header.findIndex(h => /rate|price|unit/i.test(h));
            const amountColIdx = header.findIndex(h => /amount|total/i.test(h));
            const brandColIdx = header.findIndex(h => /brand|maker|country|origin/i.test(h));
            const uomColIdx = header.findIndex(h => /uom|unit of/i.test(h));

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
                    colWidths[i] = { cellWidth: 8, halign: 'center' };
                } else if (i === imgColIdx) {
                    colWidths[i] = { cellWidth: 35, halign: 'center' }; // Larger for images
                } else if (i === descColIdx) {
                    colWidths[i] = { cellWidth: 55, halign: 'left' }; // Larger for description
                } else if (i === brandColIdx) {
                    colWidths[i] = { cellWidth: 28, halign: 'left' };
                } else if (i === qtyColIdx) {
                    colWidths[i] = { cellWidth: 12, halign: 'center' };
                } else if (i === uomColIdx) {
                    colWidths[i] = { cellWidth: 12, halign: 'center' };
                } else if (i === rateColIdx) {
                    colWidths[i] = { cellWidth: 18, halign: 'right' };
                } else if (i === amountColIdx) {
                    colWidths[i] = { cellWidth: 22, halign: 'right' };
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

            // Prepare table data
            const head = [header.map((h, i) => i === imgColIdx ? 'Image' : h)];
            const body = table.rows.map(row => row.cells.map((c, i) => {
                if (i === imgColIdx) return '';
                const val = String(c.value || '');
                return (arabicLoaded && hasArabic(val)) ? fixArabic(val) : val;
            }));

            autoTable(doc, {
                head: head,
                body: body,
                startY: 25,
                margin: { left: 5, right: 5 },
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
                    fontSize: 7,
                    cellPadding: 3
                },
                alternateRowStyles: {
                    fillColor: [250, 250, 250]
                },
                columnStyles: colWidths,
                didParseCell: (data) => {
                    // Set dynamic row height based on image count
                    if (data.section === 'body') {
                        const customHeight = rowHeights[data.row.index] || 10;
                        data.cell.styles.minCellHeight = customHeight;
                    }
                },
                didDrawCell: (data) => {
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

            // Add Summary Section after table
            if (table.summary) {
                const finalY = doc.lastAutoTable.finalY || 25;
                const summaryX = pageWidth - 70;

                // Ensure summary doesn't go off page
                if (finalY + 30 > pageHeight - 20) {
                    doc.addPage();
                    // Redraw header for new page
                    doc.setFillColor(...colors.primary);
                    doc.rect(0, 0, pageWidth, 20, 'F');
                    doc.setTextColor(...colors.white);
                    doc.setFontSize(12);
                    doc.text(`${table.sheetName || 'Offer Schedule'} (Summary)`, 10, 13);
                }

                let currentY = (doc.lastAutoTable.finalY + 15 > pageHeight - 40) ? 35 : doc.lastAutoTable.finalY + 15;
                if (doc.lastAutoTable.finalY + 15 > pageHeight - 40) doc.addPage();
                currentY = doc.lastAutoTable.finalY + 15;

                // Simple Rect for Summary
                doc.setFillColor(...colors.lightBg);
                doc.setDrawColor(...colors.primary);
                doc.setLineWidth(0.1);
                doc.rect(summaryX - 5, currentY - 8, 70, 32, 'F');

                doc.setFontSize(9);
                doc.setTextColor(...colors.text);
                doc.setFont('helvetica', 'normal');

                doc.text('Subtotal:', summaryX, currentY);
                doc.text(`${table.summary.subtotal} ${table.summary.currency}`, pageWidth - 10, currentY, { align: 'right' });

                currentY += 7;
                doc.text(`VAT (${table.summary.vatPercent}%):`, summaryX, currentY);
                doc.text(`${table.summary.vatAmount} ${table.summary.currency}`, pageWidth - 10, currentY, { align: 'right' });

                currentY += 10;
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(...colors.primary);
                doc.setFontSize(11);
                doc.text('GRAND TOTAL:', summaryX, currentY);
                doc.text(`${table.summary.grandTotal} ${table.summary.currency}`, pageWidth - 10, currentY, { align: 'right' });

                // Decorative accent for total
                doc.setDrawColor(...colors.secondary);
                doc.setLineWidth(1);
                doc.line(summaryX, currentY + 2, pageWidth - 10, currentY + 2);
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

        for (const table of sourceTables) {
            const ws = workbook.addWorksheet(table.sheetName || 'BOQ Schedule', {
                properties: { tabColor: { argb: 'F59E0B' } }
            });

            const header = table.header || [];
            const imgColIdx = header.findIndex(h => /image|photo|picture/i.test(h));
            const descColIdx = header.findIndex(h => /description|desc/i.test(h));

            const hasArInHeader = header.some(h => hasArabic(h));
            const hasArInBody = table.rows.some(r => r.cells.some(c => hasArabic(c.value)));

            if (hasArInHeader || hasArInBody) {
                ws.views = [{ rightToLeft: true }];
            }

            // Add header row
            if (header.length > 0) {
                const headerRow = ws.addRow(header);
                headerRow.height = 25;
                headerRow.eachCell((cell) => {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E293B' } };
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

            // Add data rows with dynamic heights based on image count
            table.rows.forEach((row, rowIndex) => {
                const rowData = row.cells.map((c, i) => {
                    if (i === imgColIdx) return ''; // Clear image column text
                    return c.value;
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
                dataRow.eachCell((cell) => {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isEven ? 'F8FAFC' : 'FFFFFF' } };
                    cell.font = { color: { argb: '334155' }, size: 10 };
                    cell.alignment = { vertical: 'middle', wrapText: true };
                    cell.border = { bottom: { style: 'thin', color: { argb: 'E2E8F0' } } };
                });

                // Add multiple images to cell in grid layout
                if (imgColIdx >= 0 && imageDataByRow[rowIndex]?.length > 0) {
                    const images = imageDataByRow[rowIndex];
                    const excelRow = rowIndex + 2; // +1 for header, +1 for 1-indexed
                    const baseImgSize = 50;

                    if (images.length === 1) {
                        // Single image - centered
                        ws.addImage(images[0].imageId, {
                            tl: { col: imgColIdx + 0.05, row: excelRow - 1 + 0.05 },
                            ext: { width: baseImgSize, height: baseImgSize }
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
                        const cellLength = cell.value ? String(cell.value).length : 0;
                        if (cellLength > maxLength) maxLength = cellLength;
                    });
                    column.width = Math.min(maxLength + 2, 50);
                }
            });

            ws.views = [{ state: 'frozen', ySplit: 1 }];
            const summaryStartCol = Math.max(header.length - 1, 1);

            if (table.summary) {
                ws.addRow([]); // Gap

                // Subtotal
                const subtotalRow = ws.addRow([]);
                subtotalRow.getCell(summaryStartCol).value = 'Subtotal:';
                subtotalRow.getCell(summaryStartCol + 1).value = `${table.summary.subtotal} ${table.summary.currency}`;
                subtotalRow.getCell(summaryStartCol).font = { bold: true };
                subtotalRow.getCell(summaryStartCol + 1).alignment = { horizontal: 'right' };

                // VAT
                const vatRow = ws.addRow([]);
                vatRow.getCell(summaryStartCol).value = `VAT (${table.summary.vatPercent}%):`;
                vatRow.getCell(summaryStartCol + 1).value = `${table.summary.vatAmount} ${table.summary.currency}`;
                vatRow.getCell(summaryStartCol + 1).alignment = { horizontal: 'right' };

                // Grand Total
                const totalRow = ws.addRow([]);
                totalRow.getCell(summaryStartCol).value = 'GRAND TOTAL:';
                totalRow.getCell(summaryStartCol + 1).value = `${table.summary.grandTotal} ${table.summary.currency}`;

                const totalLabelCell = totalRow.getCell(summaryStartCol);
                const totalValueCell = totalRow.getCell(summaryStartCol + 1);

                [totalLabelCell, totalValueCell].forEach(cell => {
                    cell.font = { bold: true, size: 12, color: { argb: 'FFFFFF' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E293B' } };
                    cell.alignment = { horizontal: cell === totalValueCell ? 'right' : 'left' };
                    cell.border = {
                        top: { style: 'medium', color: { argb: 'F59E0B' } },
                        bottom: { style: 'medium', color: { argb: 'F59E0B' } }
                    };
                });

                // Add Website Footer
                ws.addRow([]);
                const footerRow = ws.addRow([]);
                footerRow.getCell(1).value = `Generated by ${profile.companyName} - ${profile.website}`;
                footerRow.getCell(1).font = { italic: true, size: 9, color: { argb: '94A3B8' } };
                ws.mergeCells(footerRow.number, 1, footerRow.number, 5);
            } else {
                const summaryRow = ws.addRow([`Total: ${table.rows.length} items`]);
                summaryRow.getCell(1).font = { bold: true, color: { argb: 'F59E0B' } };
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

        let pageAdded = false;
        let itemNumber = 1;

        const colors = {
            primary: [30, 41, 59],
            secondary: [245, 158, 11],
            text: [51, 65, 85],
            lightBg: [248, 250, 252],
            border: [203, 213, 225],
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
                doc.rect(0, 0, pageWidth, 25, 'F');
                doc.setFillColor(...colors.secondary);
                doc.rect(0, 25, pageWidth, 2, 'F');

                doc.setTextColor(...colors.white);
                doc.setFontSize(16);
                doc.setFont('helvetica', 'bold');
                doc.text('MATERIAL APPROVAL SHEET', pageWidth / 2, 15, { align: 'center' });

                // Company Logo in Header
                const masHeaderLogo = logoWhite || logoBlue;
                if (masHeaderLogo) {
                    try {
                        const docLogo = await getImageData(masHeaderLogo, { format: 'image/png', maxWidth: 400 });
                        if (docLogo) {
                            const fit = calcFitSize(docLogo.width, docLogo.height, 35, 12);
                            doc.addImage(docLogo.dataUrl, 'PNG', pageWidth - 10 - fit.w, 6, fit.w, fit.h);
                        }
                    } catch (e) { }
                }

                // Info bar
                doc.setFillColor(...colors.lightBg);
                doc.rect(0, 27, pageWidth, 12, 'F');
                doc.setTextColor(...colors.text);
                doc.setFontSize(8);
                doc.setFont('helvetica', 'normal');
                const today = new Date().toLocaleDateString('en-GB');
                doc.text(`Date: ${today}`, 10, 35);
                doc.text(`Item: ${String(itemNumber).padStart(3, '0')}`, pageWidth / 2, 35, { align: 'center' });
                doc.text(`Ref: MAS-${Date.now().toString().slice(-6)}`, pageWidth - 10, 35, { align: 'right' });

                // ===== IMAGE SECTION (with multi-image grid support) =====
                const imageCell = row.cells.find(c => c.images?.length > 0 || c.image);
                const allImages = imageCell?.images || (imageCell?.image ? [imageCell.image] : []);
                let contentY = 45;

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
                const brand = brandIdx > -1 ? row.cells[brandIdx].value : 'N/A';
                const qty = qtyIdx > -1 ? row.cells[qtyIdx].value : 'As per BOQ';

                const processText = (txt) => (arabicLoaded && hasArabic(txt)) ? fixArabic(txt) : String(txt || '');

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
                        fontSize: 9
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

        const colors = {
            primary: [15, 23, 42],       // Slate 900
            accent: [14, 165, 233],     // Sky 500
            gold: [245, 158, 11],     // Amber 500
            green: [16, 185, 129],     // Emerald
            text: [51, 65, 85],
            lightBg: [240, 249, 255],    // Sky 50
            border: [186, 230, 253],    // Sky 200
            white: [255, 255, 255]
        };

        const processText = (txt) => (arabicLoaded && hasArabic(txt)) ? fixArabic(txt) : String(txt || '');
        const today = new Date().toLocaleDateString('en-GB');
        const mirRef = project.mirReference || `MIR-${Date.now().toString().slice(-6)}`;

        for (const table of sourceTables) {
            const header = table.header || [];
            const descIdx = header.findIndex(h => /description|desc/i.test(h));
            const brandIdx = header.findIndex(h => /brand|maker|origin/i.test(h));
            let qtyIdx = header.findIndex(h => /revised.*qty|revised.*quantity|actual.*qty|actual.*quantity/i.test(h));
            if (qtyIdx === -1) qtyIdx = header.findIndex(h => /qty|quantity/i.test(h));
            const uomIdx = header.findIndex(h => /uom|unit/i.test(h));
            const snIdx = header.findIndex(h => /s\.?n|no\.|#/i.test(h));
            const codeIdx = header.findIndex(h => /code|item.*code/i.test(h));

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
                doc.rect(0, 0, pageWidth, 22, 'F');
                doc.setFillColor(...colors.accent);
                doc.rect(0, 22, pageWidth, 2, 'F');

                // Logo
                const mirLogo = logoWhite || logoBlue;
                if (mirLogo) {
                    try {
                        const dl = await getImageData(mirLogo, { format: 'image/png', maxWidth: 400 });
                        if (dl) {
                            const fit = calcFitSize(dl.width, dl.height, 32, 12);
                            doc.addImage(dl.dataUrl, 'PNG', 10, 5, fit.w, fit.h);
                        }
                    } catch (e) { }
                }

                if (project.clientLogo) {
                    try {
                        const cdl = await getImageData(project.clientLogo, { format: 'image/png', maxWidth: 400 });
                        if (cdl) {
                            const cfit = calcFitSize(cdl.width, cdl.height, 32, 12);
                            doc.addImage(cdl.dataUrl, 'PNG', pageWidth - 10 - cfit.w, 5, cfit.w, cfit.h);
                        }
                    } catch (e) { }
                }

                doc.setTextColor(...colors.white);
                doc.setFontSize(14);
                doc.setFont('helvetica', 'bold');
                doc.text('MATERIAL INSPECTION REQUEST', pageWidth / 2, 10, { align: 'center' });

                doc.setFontSize(7.5);
                doc.setFont('helvetica', 'normal');
                doc.text(`Ref: ${rowMirRef}   |   Item ${displayTitle}   |   Date: ${today}`, pageWidth / 2, 18, { align: 'center' });

                // ── PROJECT INFO BOX ──
                const pY = 25;
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
                const brand = project.brandOrigin ? project.brandOrigin : (brandIdx > -1 ? row.cells[brandIdx].value : '');
                const qty = qtyIdx > -1 ? row.cells[qtyIdx].value : 'As per BOQ';
                const uom = project.unitOfMeasure ? project.unitOfMeasure : (uomIdx > -1 ? row.cells[uomIdx].value : '');
                const sn = snIdx > -1 ? row.cells[snIdx].value : String(itemNumber);

                let contentY = 49;

                // Item title band
                doc.setFillColor(...colors.accent);
                doc.roundedRect(8, contentY, pageWidth - 16, 7, 1, 1, 'F');
                doc.setTextColor(...colors.white);
                doc.setFontSize(8.5);
                doc.setFont('helvetica', 'bold');
                doc.text(`ITEM ${displayTitle} — MATERIAL INSPECTION`, 12, contentY + 4.8);
                contentY += 10;

                // ── IMAGES ──
                const imageGroups = [];
                for (let idx = 0; idx < row.cells.length; idx++) {
                    const c = row.cells[idx];
                    const colName = header[idx] || '';
                    if (c.images?.length > 0 || c.image) {
                        const imgs = c.images || [c.image];
                        const groupImgs = [];
                        for (const img of imgs) {
                            if (img?.url) {
                                try {
                                    const ir = await getImageData(getFullUrl(img.url), { maxWidth: 800, format: 'image/jpeg' });
                                    if (ir) groupImgs.push(ir);
                                } catch (e) { }
                            }
                        }
                        if (groupImgs.length > 0) {
                            imageGroups.push({ title: colName, images: groupImgs });
                        }
                    }
                }

                if (imageGroups.length > 0) {
                    const imgAreaW = pageWidth - 16;
                    const imgAreaH = 65;
                    const gap = 4;
                    const groupW = (imgAreaW - (imageGroups.length - 1) * gap) / imageGroups.length;

                    imageGroups.forEach((group, gIdx) => {
                        const gX = 8 + gIdx * (groupW + gap);
                        const gY = contentY;

                        doc.setFillColor(252, 252, 252);
                        doc.setDrawColor(...colors.border);
                        doc.roundedRect(gX, gY, groupW, imgAreaH, 2, 2, 'FD');

                        // Title for the group
                        doc.setFontSize(7.5);
                        doc.setTextColor(80, 80, 80);
                        doc.setFont('helvetica', 'bold');
                        const titleText = doc.splitTextToSize(processText(String(group.title || '').toUpperCase()), groupW - 4);
                        doc.text(titleText[0], gX + groupW / 2, gY + 4.5, { align: 'center' });

                        // Line under title
                        doc.setDrawColor(...colors.border);
                        doc.setLineWidth(0.3);
                        doc.line(gX + 2, gY + 6, gX + groupW - 2, gY + 6);

                        // Grid for images in this group
                        const numImgs = group.images.length;
                        let cols = 1, rows2 = 1;
                        if (numImgs === 1) { cols = 1; rows2 = 1; }
                        else if (numImgs === 2) { cols = 2; rows2 = 1; }
                        else if (numImgs <= 4) { cols = 2; rows2 = 2; }
                        else if (numImgs <= 6) { cols = 3; rows2 = 2; }
                        else if (numImgs <= 9) { cols = 3; rows2 = 3; }
                        else {
                            cols = Math.ceil(Math.sqrt(numImgs));
                            rows2 = Math.ceil(numImgs / cols);
                        }

                        const pad = 2;
                        const availW = groupW - pad * 2;
                        const availH = imgAreaH - 8 - pad * 2; // 8 is reserved for the head title area

                        const cW = (availW - (cols - 1) * pad) / cols;
                        const cH = (availH - (rows2 - 1) * pad) / rows2;

                        group.images.forEach((img, iIdx) => {
                            const c = iIdx % cols;
                            const r = Math.floor(iIdx / cols);
                            const fit = calcFitSize(img.width, img.height, cW, cH);

                            const imgX = gX + pad + c * (cW + pad) + (cW - fit.w) / 2;
                            const imgY = gY + 8 + pad + r * (cH + pad) + (cH - fit.h) / 2;

                            doc.addImage(img.dataUrl, 'JPEG', imgX, imgY, fit.w, fit.h, '', 'FAST');
                        });
                    });

                    contentY += imgAreaH + 4;
                }

                // ── SPECIFICATION TABLE ──
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
                    headStyles: { fillColor: colors.accent, textColor: colors.white, fontStyle: 'bold', fontSize: 8 },
                    alternateRowStyles: { fillColor: colors.lightBg },
                    columnStyles: { 0: { cellWidth: 48, fontStyle: 'bold' } }
                });

                // ── ORIGINATOR'S INFORMATION ──
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
                    headStyles: { fillColor: [248, 250, 252], textColor: colors.text, fontStyle: 'bold', halign: 'center', lineWidth: 0.1, lineColor: colors.border },
                    bodyStyles: { minCellHeight: 6 },
                    columnStyles: { 0: { cellWidth: 55 }, 1: { cellWidth: 55 }, 2: { cellWidth: 'auto' } }
                });

                // ── COMMENTS ──
                const comY = doc.lastAutoTable.finalY;
                doc.setFillColor(...colors.lightBg);
                doc.rect(8, comY, pageWidth - 16, 5, 'FD');
                doc.setFontSize(7.5);
                doc.setFont('helvetica', 'bold');
                doc.text("COMMENTS:", 12, comY + 3.8);

                // Comment box white space
                doc.setFillColor(255, 255, 255);
                doc.rect(8, comY + 5, pageWidth - 16, 13, 'FD');

                // Approvals checkboxes 
                const appY = comY + 18;
                doc.setFillColor(255, 255, 255);
                doc.rect(8, appY, pageWidth - 16, 6, 'FD');
                doc.setFontSize(7);
                doc.setFont('helvetica', 'bold');

                doc.rect(30, appY + 2, 2, 2);
                doc.text('A. Approved', 34, appY + 4);

                doc.rect(85, appY + 2, 2, 2);
                doc.text('B. Approved as Noted', 89, appY + 4);

                doc.rect(145, appY + 2, 2, 2);
                doc.text('C. Revise and Resubmit', 149, appY + 4);

                // ── REVIEWED AND APPROVED BY ──
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

                        if (parts[2]) {
                            doc.text(parts[2], x + boxW / 2, boxY + 11.5, { align: 'center' });
                        }
                        if (parts[3]) {
                            doc.setFontSize(5.5);
                            doc.text(parts[3], x + boxW / 2, boxY + 14.5, { align: 'center' });
                        }

                        doc.setFontSize(6);
                        doc.text('Date: __________', x + boxW / 2, boxY + boxH - 2, { align: 'center' });
                    });
                }

                // ── FOOTER ──
                doc.setFillColor(...colors.primary);
                doc.rect(0, pageHeight - 8, pageWidth, 8, 'F');
                doc.setTextColor(...colors.white);
                doc.setFontSize(6);
                doc.text(`Material Inspection Request | ${rowMirRef}  |  Page ${itemNumber}`, pageWidth / 2, pageHeight - 3, { align: 'center' });

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

        const colors = {
            primary: [5, 46, 22],          // Green 950
            accent: [16, 185, 129],       // Emerald 500
            gold: [251, 191, 36],       // Amber 400
            text: [30, 58, 54],
            lightBg: [236, 253, 245],      // Emerald 50
            border: [110, 231, 183],      // Emerald 300
            white: [255, 255, 255]
        };

        const processText = (txt) => (arabicLoaded && hasArabic(txt)) ? fixArabic(txt) : String(txt || '');
        const today = new Date().toLocaleDateString('en-GB');
        const wirRef = project.wirReference || `WIR-${Date.now().toString().slice(-6)}`;

        for (const table of sourceTables) {
            const header = table.header || [];
            const descIdx = header.findIndex(h => /description|desc/i.test(h));
            const brandIdx = header.findIndex(h => /brand|maker|origin/i.test(h));
            let qtyIdx = header.findIndex(h => /revised.*qty|revised.*quantity|actual.*qty|actual.*quantity/i.test(h));
            if (qtyIdx === -1) qtyIdx = header.findIndex(h => /qty|quantity/i.test(h));
            const uomIdx = header.findIndex(h => /uom|unit/i.test(h));
            const snIdx = header.findIndex(h => /s\.?n|no\.|#/i.test(h));
            const codeIdx = header.findIndex(h => /code|item.*code/i.test(h));

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
                doc.rect(0, 0, pageWidth, 22, 'F');
                doc.setFillColor(...colors.accent);
                doc.rect(0, 22, pageWidth, 2, 'F');

                const wirLogo = logoWhite || logoBlue;
                if (wirLogo) {
                    try {
                        const dl = await getImageData(wirLogo, { format: 'image/png', maxWidth: 400 });
                        if (dl) {
                            const fit = calcFitSize(dl.width, dl.height, 32, 12);
                            doc.addImage(dl.dataUrl, 'PNG', 10, 5, fit.w, fit.h);
                        }
                    } catch (e) { }
                }

                if (project.clientLogo) {
                    try {
                        const cdl = await getImageData(project.clientLogo, { format: 'image/png', maxWidth: 400 });
                        if (cdl) {
                            const cfit = calcFitSize(cdl.width, cdl.height, 32, 12);
                            doc.addImage(cdl.dataUrl, 'PNG', pageWidth - 10 - cfit.w, 5, cfit.w, cfit.h);
                        }
                    } catch (e) { }
                }

                doc.setTextColor(...colors.white);
                doc.setFontSize(14);
                doc.setFont('helvetica', 'bold');
                doc.text('WORK INSPECTION REQUEST', pageWidth / 2, 10, { align: 'center' });

                doc.setFontSize(7.5);
                doc.setFont('helvetica', 'normal');
                doc.text(`Ref: ${rowWirRef}   |   Item ${displayTitle}   |   Date: ${today}`, pageWidth / 2, 18, { align: 'center' });

                // ── PROJECT INFO ──
                const pY = 25;
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
                const sn = snIdx > -1 ? row.cells[snIdx].value : String(itemNumber);

                let contentY = 49;

                // Item title band
                doc.setFillColor(...colors.accent);
                doc.roundedRect(8, contentY, pageWidth - 16, 7, 1, 1, 'F');
                doc.setTextColor(...colors.white);
                doc.setFontSize(8.5);
                doc.setFont('helvetica', 'bold');
                doc.text(`ITEM ${displayTitle} — WORK INSPECTION`, 12, contentY + 4.8);
                contentY += 10;

                // ── IMAGES ──
                const imageGroups = [];
                for (let idx = 0; idx < row.cells.length; idx++) {
                    const c = row.cells[idx];
                    const colName = header[idx] || '';
                    if (c.images?.length > 0 || c.image) {
                        const imgs = c.images || [c.image];
                        const groupImgs = [];
                        for (const img of imgs) {
                            if (img?.url) {
                                try {
                                    const ir = await getImageData(getFullUrl(img.url), { maxWidth: 800, format: 'image/jpeg' });
                                    if (ir) groupImgs.push(ir);
                                } catch (e) { }
                            }
                        }
                        if (groupImgs.length > 0) {
                            imageGroups.push({ title: colName, images: groupImgs });
                        }
                    }
                }

                if (imageGroups.length > 0) {
                    const imgAreaW = pageWidth - 16;
                    const imgAreaH = 65;
                    const gap = 4;
                    const groupW = (imgAreaW - (imageGroups.length - 1) * gap) / imageGroups.length;

                    imageGroups.forEach((group, gIdx) => {
                        const gX = 8 + gIdx * (groupW + gap);
                        const gY = contentY;

                        doc.setFillColor(252, 252, 252);
                        doc.setDrawColor(...colors.border);
                        doc.roundedRect(gX, gY, groupW, imgAreaH, 2, 2, 'FD');

                        // Title for the group
                        doc.setFontSize(7.5);
                        doc.setTextColor(80, 80, 80);
                        doc.setFont('helvetica', 'bold');
                        const titleText = doc.splitTextToSize(processText(String(group.title || '').toUpperCase()), groupW - 4);
                        doc.text(titleText[0], gX + groupW / 2, gY + 4.5, { align: 'center' });

                        // Line under title
                        doc.setDrawColor(...colors.border);
                        doc.setLineWidth(0.3);
                        doc.line(gX + 2, gY + 6, gX + groupW - 2, gY + 6);

                        // Grid for images in this group
                        const numImgs = group.images.length;
                        let cols = 1, rows2 = 1;
                        if (numImgs === 1) { cols = 1; rows2 = 1; }
                        else if (numImgs === 2) { cols = 2; rows2 = 1; }
                        else if (numImgs <= 4) { cols = 2; rows2 = 2; }
                        else if (numImgs <= 6) { cols = 3; rows2 = 2; }
                        else if (numImgs <= 9) { cols = 3; rows2 = 3; }
                        else {
                            cols = Math.ceil(Math.sqrt(numImgs));
                            rows2 = Math.ceil(numImgs / cols);
                        }

                        const pad = 2;
                        const availW = groupW - pad * 2;
                        const availH = imgAreaH - 8 - pad * 2; // 8 is reserved for the head title area

                        const cW = (availW - (cols - 1) * pad) / cols;
                        const cH = (availH - (rows2 - 1) * pad) / rows2;

                        group.images.forEach((img, iIdx) => {
                            const c = iIdx % cols;
                            const r = Math.floor(iIdx / cols);
                            const fit = calcFitSize(img.width, img.height, cW, cH);

                            const imgX = gX + pad + c * (cW + pad) + (cW - fit.w) / 2;
                            const imgY = gY + 8 + pad + r * (cH + pad) + (cH - fit.h) / 2;

                            doc.addImage(img.dataUrl, 'JPEG', imgX, imgY, fit.w, fit.h, '', 'FAST');
                        });
                    });

                    contentY += imgAreaH + 4;
                }

                // ── SPECIFICATION TABLE ──
                autoTable(doc, {
                    startY: contentY,
                    margin: { left: 8, right: 8 },
                    head: [[processText('Field'), processText('Details')]],
                    body: [
                        [processText('Work Description'), processText(desc)],
                        [processText('Brand / Material'), processText(project.brandOrigin ? project.brandOrigin : (brandIdx > -1 ? row.cells[brandIdx].value : ''))],
                        [processText('Quantity'), processText(qty)],
                        [processText('Unit'), processText(project.unitOfMeasure ? project.unitOfMeasure : (uomIdx > -1 ? row.cells[uomIdx].value : ''))],
                        [processText('Work Area / Zone'), processText(project.locationZone || '')],
                        [processText('Inspection Required'), ''],
                        [processText('Remarks'), ''],
                    ],
                    theme: 'striped',
                    styles: { fontSize: 8, cellPadding: 2.5, textColor: colors.text, overflow: 'linebreak', font: arabicLoaded ? 'Almarai' : 'helvetica' },
                    headStyles: { fillColor: colors.accent, textColor: colors.white, fontStyle: 'bold', fontSize: 8 },
                    alternateRowStyles: { fillColor: colors.lightBg },
                    columnStyles: { 0: { cellWidth: 48, fontStyle: 'bold' } }
                });

                // ── ORIGINATOR'S INFORMATION ──
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
                    headStyles: { fillColor: [248, 250, 252], textColor: colors.text, fontStyle: 'bold', halign: 'center', lineWidth: 0.1, lineColor: colors.border },
                    bodyStyles: { minCellHeight: 6 },
                    columnStyles: { 0: { cellWidth: 55 }, 1: { cellWidth: 55 }, 2: { cellWidth: 'auto' } }
                });

                // ── COMMENTS ──
                const comY = doc.lastAutoTable.finalY;
                doc.setFillColor(...colors.lightBg);
                doc.rect(8, comY, pageWidth - 16, 5, 'FD');
                doc.setFontSize(7.5);
                doc.setFont('helvetica', 'bold');
                doc.text("COMMENTS:", 12, comY + 3.8);

                // Comment box white space
                doc.setFillColor(255, 255, 255);
                doc.rect(8, comY + 5, pageWidth - 16, 13, 'FD');

                // Approvals checkboxes 
                const appY = comY + 18;
                doc.setFillColor(255, 255, 255);
                doc.rect(8, appY, pageWidth - 16, 6, 'FD');
                doc.setFontSize(7);
                doc.setFont('helvetica', 'bold');

                doc.rect(30, appY + 2, 2, 2);
                doc.text('A. Approved', 34, appY + 4);

                doc.rect(85, appY + 2, 2, 2);
                doc.text('B. Approved as Noted', 89, appY + 4);

                doc.rect(145, appY + 2, 2, 2);
                doc.text('C. Revise and Resubmit', 149, appY + 4);

                // ── REVIEWED AND APPROVED BY ──
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

                        if (parts[2]) {
                            doc.text(parts[2], x + boxW / 2, boxY + 11.5, { align: 'center' });
                        }
                        if (parts[3]) {
                            doc.setFontSize(5.5);
                            doc.text(parts[3], x + boxW / 2, boxY + 14.5, { align: 'center' });
                        }

                        doc.setFontSize(6);
                        doc.text('Date: __________', x + boxW / 2, boxY + boxH - 2, { align: 'center' });
                    });
                }

                // ── FOOTER ──
                doc.setFillColor(...colors.primary);
                doc.rect(0, pageHeight - 8, pageWidth, 8, 'F');
                doc.setTextColor(...colors.white);
                doc.setFontSize(6);
                doc.text(`Work Inspection Request | ${rowWirRef}  |  Page ${itemNumber}`, pageWidth / 2, pageHeight - 3, { align: 'center' });

                itemNumber++;
            }
        }
        doc.save('WIR_export.pdf');
    };

    // ===================== DELIVERY NOTE — ALL ITEMS IN ONE TABLE =====================
    const handleGenerateDeliveryNote = async (sourceTables) => {
        const doc = new jsPDF({ orientation: 'portrait' });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const arabicLoaded = await loadArabicFont(doc);

        const colors = {
            primary: [30, 41, 59],
            accent: [99, 102, 241],       // Indigo 500
            gold: [245, 158, 11],
            text: [51, 65, 85],
            lightBg: [238, 242, 255],      // Indigo 50
            border: [199, 210, 254],      // Indigo 200
            white: [255, 255, 255]
        };

        const processText = (txt) => (arabicLoaded && hasArabic(txt)) ? fixArabic(txt) : String(txt || '');
        const today = new Date().toLocaleDateString('en-GB');
        const dnRef = `DN-${Date.now().toString().slice(-6)}`;

        // ── HEADER ──
        doc.setFillColor(...colors.primary);
        doc.rect(0, 0, pageWidth, 30, 'F');
        doc.setFillColor(...colors.accent);
        doc.rect(0, 30, pageWidth, 2, 'F');

        const dnLogo = logoWhite || logoBlue;
        if (dnLogo) {
            try {
                const dl = await getImageData(dnLogo, { format: 'image/png', maxWidth: 400 });
                if (dl) {
                    const fit = calcFitSize(dl.width, dl.height, 35, 15);
                    doc.addImage(dl.dataUrl, 'PNG', 10, 7, fit.w, fit.h);
                }
            } catch (e) { }
        }

        if (project.clientLogo) {
            try {
                const cdl = await getImageData(project.clientLogo, { format: 'image/png', maxWidth: 400 });
                if (cdl) {
                    const cfit = calcFitSize(cdl.width, cdl.height, 35, 15);
                    doc.addImage(cdl.dataUrl, 'PNG', pageWidth - 10 - cfit.w, 7, cfit.w, cfit.h);
                }
            } catch (e) { }
        }

        doc.setTextColor(...colors.white);
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.text('DELIVERY NOTE', pageWidth / 2, 14, { align: 'center' });

        doc.setFontSize(8.5);
        doc.setFont('helvetica', 'normal');
        doc.text(`Ref: ${dnRef}   |   Date: ${today}   |   Rev: ${project.revision || 'Rev 0'}`, pageWidth / 2, 23, { align: 'center' });

        // ── PROJECT INFO BOX (2 columns) ──
        const pY = 36;
        doc.setFillColor(...colors.lightBg);
        doc.setDrawColor(...colors.border);
        doc.setLineWidth(0.3);
        doc.roundedRect(8, pY, pageWidth - 16, 30, 2, 2, 'FD');

        const leftCol = 12, rightCol = pageWidth / 2 + 4;
        const rowH = 5.5;
        doc.setFontSize(8);
        doc.setTextColor(...colors.text);

        const pRow3 = [];
        if (project.includeContractor !== false) pRow3.push('Contractor:', project.contractor || '—');
        if (project.includeConsultant !== false) pRow3.push('Consultant:', project.consultant || '—');
        while (pRow3.length < 4) pRow3.push('', '');

        const pRows = [
            ['Project Name:', project.projectName || '—', 'Project No:', project.projectNumber || '—'],
            ['Client / Owner:', project.clientName || '—', 'Location:', project.locationZone || '—'],
            pRow3,
            ['Site Engineer:', project.siteEngineer || '—', 'Delivery Date:', today],
        ];

        pRows.forEach((r, i) => {
            const y = pY + 8 + i * rowH;
            doc.setFont('helvetica', 'bold'); doc.text(r[0], leftCol, y);
            doc.setFont('helvetica', 'normal'); doc.text(processText(r[1]), leftCol + 28, y);
            doc.setFont('helvetica', 'bold'); doc.text(r[2], rightCol, y);
            doc.setFont('helvetica', 'normal'); doc.text(processText(r[3]), rightCol + 26, y);
        });

        // ── DELIVERY TABLE (ALL ITEMS) ──
        let contentY = pY + 34;

        // Collect all rows across tables
        const allRows = [];
        let rowCounter = 1;
        for (const table of sourceTables) {
            const header = table.header || [];
            const descIdx = header.findIndex(h => /description|desc/i.test(h));
            const brandIdx = header.findIndex(h => /brand|maker|origin/i.test(h));
            const qtyIdx = header.findIndex(h => /qty|quantity/i.test(h));
            const uomIdx = header.findIndex(h => /uom|unit/i.test(h));

            for (const row of table.rows) {
                if (!row.cells.some(c => c.value)) continue;
                const desc = descIdx > -1 ? row.cells[descIdx].value : '';
                const brand = brandIdx > -1 ? row.cells[brandIdx].value : '';
                const qty = qtyIdx > -1 ? row.cells[qtyIdx].value : '';
                const uom = uomIdx > -1 ? row.cells[uomIdx].value : '';
                if (!desc && !brand) continue;
                allRows.push([
                    String(rowCounter++).padStart(3, '0'),
                    processText(desc),
                    processText(brand),
                    processText(qty),
                    processText(uom),
                    '', // Delivered Qty — to be filled
                    '', // Condition
                    '', // Notes
                ]);
            }
        }

        autoTable(doc, {
            startY: contentY,
            margin: { left: 8, right: 8 },
            head: [[
                '#',
                'Item Description',
                'Brand / Origin',
                'Ordered Qty',
                'UOM',
                'Delivered Qty',
                'Condition',
                'Notes',
            ]],
            body: allRows,
            theme: 'striped',
            styles: { fontSize: 7.5, cellPadding: 2.5, textColor: colors.text, overflow: 'linebreak', font: arabicLoaded ? 'Almarai' : 'helvetica', valign: 'middle' },
            headStyles: { fillColor: colors.accent, textColor: colors.white, fontStyle: 'bold', fontSize: 7.5, halign: 'center' },
            alternateRowStyles: { fillColor: colors.lightBg },
            columnStyles: {
                0: { cellWidth: 9, halign: 'center' },
                1: { cellWidth: 55, halign: 'left' },
                2: { cellWidth: 28, halign: 'left' },
                3: { cellWidth: 16, halign: 'center' },
                4: { cellWidth: 12, halign: 'center' },
                5: { cellWidth: 18, halign: 'center' },
                6: { cellWidth: 18, halign: 'center' },
                7: { cellWidth: 'auto' },
            },
            didDrawPage: (data) => {
                // Re-draw header band on overflow pages
                doc.setFillColor(...colors.primary);
                doc.rect(0, 0, pageWidth, 10, 'F');
                doc.setTextColor(...colors.white);
                doc.setFontSize(8);
                doc.setFont('helvetica', 'bold');
                doc.text(`DELIVERY NOTE — ${dnRef}`, pageWidth / 2, 7, { align: 'center' });

                // Footer
                doc.setFontSize(7);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(150, 150, 150);
                doc.text(`Page ${doc.internal.getNumberOfPages()}`, pageWidth - 10, pageHeight - 5, { align: 'right' });
                const fText = website || companyName || 'BOQFlow';
                doc.text(processText(fText), 10, pageHeight - 5);
            }
        });

        // ── SUMMARY BAR ──
        const finalY = doc.lastAutoTable.finalY + 5;
        doc.setFillColor(...colors.lightBg);
        doc.setDrawColor(...colors.border);
        doc.roundedRect(8, finalY, pageWidth - 16, 10, 2, 2, 'FD');
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...colors.text);
        doc.text(`Total Items: ${allRows.length}`, 14, finalY + 6.5);
        doc.setFont('helvetica', 'normal');
        doc.text('Received in Good Condition: ☐ YES   ☐ NO', pageWidth / 2, finalY + 6.5, { align: 'center' });

        // ── SIGNATURES ──
        const sigY = finalY + 18;
        if (sigY + 28 < pageHeight - 8) {
            doc.setFillColor(...colors.primary);
            doc.rect(8, sigY, pageWidth - 16, 7, 'F');
            doc.setTextColor(...colors.white);
            doc.setFontSize(8);
            doc.setFont('helvetica', 'bold');
            doc.text('DELIVERY CONFIRMATION', pageWidth / 2, sigY + 4.8, { align: 'center' });

            const sigParties = [
                { name: 'Delivered By\n(Supplier)', keep: true },
                { name: 'Received By\n(Contractor)', keep: project.includeContractor !== false },
                { name: 'Verified By\n(Consultant)', keep: project.includeConsultant !== false }
            ].filter(p => p.keep).map(p => p.name);

            const boxW = 54, boxH = 22, boxY = sigY + 9;
            const gap = sigParties.length > 1 ? (pageWidth - 16 - boxW * sigParties.length) / (sigParties.length - 1) : 0;

            sigParties.forEach((name, i) => {
                const x = 8 + i * (boxW + gap);
                doc.setFillColor(...colors.white);
                doc.setDrawColor(...colors.border);
                doc.setLineWidth(0.3);
                doc.rect(x, boxY, boxW, boxH, 'FD');
                doc.setFillColor(...colors.accent);
                doc.rect(x, boxY, boxW, 6, 'F');
                doc.setTextColor(...colors.white);
                doc.setFontSize(6.5);
                doc.setFont('helvetica', 'bold');
                doc.text(name.split('\n')[0], x + boxW / 2, boxY + 4, { align: 'center' });
                doc.setTextColor(...colors.text);
                doc.setFontSize(6);
                doc.setFont('helvetica', 'normal');
                doc.text(name.split('\n')[1] || '', x + boxW / 2, boxY + 9, { align: 'center' });
                doc.text('Date: __________', x + boxW / 2, boxY + boxH - 2, { align: 'center' });
            });
        }

        // ── FOOTER ──
        doc.setFillColor(...colors.primary);
        doc.rect(0, pageHeight - 8, pageWidth, 8, 'F');
        doc.setTextColor(...colors.white);
        doc.setFontSize(6);
        doc.text(`BOQFlow | Delivery Note | ${dnRef}  |  Powered by BOQFlow`, pageWidth / 2, pageHeight - 3, { align: 'center' });

        doc.save('DeliveryNote_export.pdf');
    };

    // ===================== PREMIUM POWERPOINT PRESENTATION (LIGHT THEME) =====================
    const handleGeneratePresentation = async (sourceTables) => {
        const PptxGenJS = (await import('pptxgenjs')).default;
        const pres = new PptxGenJS();

        pres.author = 'BOQFlow';
        pres.title = 'Product Presentation';
        pres.subject = 'Bill of Quantities - Product Showcase';

        // Colors matching the reference design
        const brandColors = {
            primary: '1E5FA8',    // Blue header
            accent: 'F5A623',     // Gold/Yellow accent
            text: '333333',       // Dark text
            lightText: '666666',  // Light gray text
            border: 'E0E0E0',     // Light border
            bg: 'FFFFFF',         // White background
            lightBg: 'F5F5F5'     // Light gray background
        };

        // Light theme master slide
        pres.defineSlideMaster({
            title: 'BOQ_MASTER',
            background: { color: brandColors.bg },
            objects: [
                // Header bar (blue)
                { rect: { x: 0, y: 0, w: '100%', h: 0.7, fill: { color: brandColors.primary } } },
                // Gold accent line
                { rect: { x: 0, y: 0.7, w: '100%', h: 0.04, fill: { color: brandColors.accent } } },
                // Footer background
                { rect: { x: 0, y: 5.3, w: '100%', h: 0.2, fill: { color: brandColors.lightBg } } }
            ]
        });

        // Title Slide
        const titleSlide = pres.addSlide({ masterName: 'BOQ_MASTER' });
        titleSlide.addText('PRODUCT SHOWCASE', {
            x: 0.5, y: 1.8, w: 9, h: 0.7,
            fontSize: 36, bold: true, color: brandColors.primary, fontFace: 'Arial'
        });
        titleSlide.addText('Bill of Quantities - Product Presentation', {
            x: 0.5, y: 2.5, w: 9, h: 0.4,
            fontSize: 14, color: brandColors.lightText, fontFace: 'Arial'
        });
        const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
        const totalItems = sourceTables.reduce((acc, t) => acc + t.rows.length, 0);
        titleSlide.addText(`Date: ${today}  |  Total Items: ${totalItems}`, {
            x: 0.5, y: 3.1, w: 9, h: 0.3, fontSize: 11, color: brandColors.lightText
        });

        let itemNum = 1;

        for (const table of sourceTables) {
            const header = table.header || [];
            const descIdx = header.findIndex(h => /description|desc/i.test(h));
            const brandIdx = header.findIndex(h => /brand|maker|origin/i.test(h));
            const qtyIdx = header.findIndex(h => /qty|quantity/i.test(h));
            const finishIdx = header.findIndex(h => /finish|color|material/i.test(h));

            for (const row of table.rows) {
                if (!row.cells.some(c => c.value)) continue;

                const slide = pres.addSlide({ masterName: 'BOQ_MASTER' });

                // Get all images from the row
                const imageCell = row.cells.find(c => c.images?.length > 0 || c.image);
                const allImages = imageCell?.images || (imageCell?.image ? [imageCell.image] : []);

                // Get product info
                const desc = descIdx > -1 ? String(row.cells[descIdx].value || '') : '';
                const brand = brandIdx > -1 ? String(row.cells[brandIdx].value || '') : '';
                const qty = qtyIdx > -1 ? String(row.cells[qtyIdx].value || '') : '';
                const finish = finishIdx > -1 ? String(row.cells[finishIdx].value || '') : '';

                // Extract first line/product name for header (short, no overflow)
                const firstLine = desc.split(/[\n*•]/)[0].trim();
                const headerTitle = firstLine.length > 50 ? firstLine.substring(0, 47) + '...' : firstLine;

                slide.addText(`Item ${itemNum}: ${headerTitle}`, {
                    x: 0.2, y: 0.15, w: 8.0, h: 0.4,
                    fontSize: 14, color: brandColors.bg, bold: true, fontFace: 'Arial', valign: 'middle'
                });

                // Company logo area (top right)
                // PPT master has a white background in the logo area, so prefer original logo
                const pptLogo = logoBlue || logoWhite;
                if (pptLogo) {
                    try {
                        const logoImg = await getImageData(pptLogo, { format: 'image/png', maxWidth: 400 });
                        if (logoImg) {
                            const fit = calcFitSize(logoImg.width, logoImg.height, 1.5 * 96, 0.5 * 96);
                            const fitW = fit.w / 96;
                            const fitH = fit.h / 96;
                            slide.addImage({
                                data: logoImg.dataUrl,
                                x: 8.2 + (1.5 - fitW) / 2, y: 0.1 + (0.5 - fitH) / 2, w: fitW, h: fitH
                            });
                        }
                    } catch (e) { }
                } else {
                    slide.addText(companyName || 'LOGO', {
                        x: 8.2, y: 0.25, w: 1.5, h: 0.2,
                        fontSize: 8, color: brandColors.lightText, align: 'center'
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
                        h: fitH
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
                            h: fitH
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
                            h: fitH
                        });
                    });

                    // Show indicator if more images exist
                    if (allImages.length > 4) {
                        slide.addText(`+${allImages.length - 4} more`, {
                            x: imgAreaX + imgAreaW - 0.8, y: imgAreaY + imgAreaH - 0.3, w: 0.7, h: 0.2,
                            fontSize: 8, color: brandColors.lightText, align: 'right'
                        });
                    }
                }

                // ===== RIGHT SIDE: PRODUCT DETAILS =====
                const detailX = 5;
                const detailW = 4.7;
                let detailY = 0.95;

                // "Product Details" Header
                slide.addText('Product Details', {
                    x: detailX, y: detailY, w: detailW, h: 0.35,
                    fontSize: 18, bold: true, color: brandColors.primary, fontFace: 'Arial'
                });
                detailY += 0.45;

                // Description sub-section
                slide.addText('Description:', {
                    x: detailX, y: detailY, w: detailW, h: 0.25,
                    fontSize: 11, bold: true, color: brandColors.text, fontFace: 'Arial'
                });
                detailY += 0.28;

                // Full description with word wrap - capped height to fit slide
                const fullDesc = desc.trim();
                // Max height: leave room for Brand, Qty, Specs (~1.5") before footer at 4.7"
                const maxDescY = 3.5; // Max Y position after description
                const availableDescH = maxDescY - detailY;
                const estLines = Math.ceil(fullDesc.length / 60) + (fullDesc.match(/[\n*•]/g) || []).length;
                const descBoxH = Math.min(availableDescH, Math.max(0.4, estLines * 0.15));

                slide.addText(fullDesc, {
                    x: detailX, y: detailY, w: detailW, h: descBoxH,
                    fontSize: 9, color: brandColors.text, fontFace: 'Arial', valign: 'top',
                    wrap: true, shrinkText: true
                });
                detailY += descBoxH + 0.08;

                // Ensure we don't overflow - cap at safe Y
                const maxContentY = 4.5; // Footer starts around 4.7"

                // Brand sub-section
                if (detailY < maxContentY - 0.3) {
                    slide.addText('Brand:', {
                        x: detailX, y: detailY, w: 1, h: 0.22,
                        fontSize: 10, bold: true, color: brandColors.text, fontFace: 'Arial'
                    });
                    slide.addText(brand || 'N/A', {
                        x: detailX + 0.55, y: detailY, w: detailW - 0.55, h: 0.22,
                        fontSize: 9, color: brandColors.text, fontFace: 'Arial'
                    });
                    detailY += 0.28;
                }

                // Quantity sub-section
                if (detailY < maxContentY - 0.3) {
                    slide.addText('Quantity:', {
                        x: detailX, y: detailY, w: 1, h: 0.22,
                        fontSize: 10, bold: true, color: brandColors.text, fontFace: 'Arial'
                    });
                    slide.addText(qty || 'As per BOQ', {
                        x: detailX + 0.7, y: detailY, w: detailW - 0.7, h: 0.22,
                        fontSize: 9, color: brandColors.text, fontFace: 'Arial'
                    });
                    detailY += 0.28;
                }

                // Specifications sub-section - only if space available
                if (detailY < maxContentY - 0.4) {
                    slide.addText('Specifications:', {
                        x: detailX, y: detailY, w: detailW, h: 0.22,
                        fontSize: 10, bold: true, color: brandColors.primary, fontFace: 'Arial'
                    });
                    detailY += 0.22;

                    // Build specifications from available data
                    const specs = [];
                    if (finish) specs.push(`• Finish: ${finish}`);
                    if (desc.includes('mm')) {
                        const sizeMatch = desc.match(/\d+\s*[xX×]\s*\d+\s*(mm|cm)?/);
                        if (sizeMatch) specs.push(`• Dimensions: ${sizeMatch[0]}`);
                    }
                    specs.push('• Warranty: As per manufacturer');

                    const specsH = Math.min(maxContentY - detailY, 0.6);
                    slide.addText(specs.join('\n') || '• As per manufacturer specifications', {
                        x: detailX + 0.1, y: detailY, w: detailW - 0.1, h: specsH,
                        fontSize: 8, color: brandColors.text, fontFace: 'Arial', valign: 'top'
                    });
                }

                // ===== FOOTER =====
                // Warranty notice
                slide.addText('Warranty', {
                    x: 0.2, y: 5.08, w: 1, h: 0.18,
                    fontSize: 8, bold: true, color: brandColors.primary
                });
                slide.addText('As per manufacturer - 5 years', {
                    x: 0.2, y: 5.24, w: 2.5, h: 0.15,
                    fontSize: 7, color: brandColors.lightText
                });

                // Page URL/reference
                slide.addText('https://alshayaenterprises.com', {
                    x: 3.5, y: 5.32, w: 3, h: 0.15,
                    fontSize: 7, color: brandColors.primary, align: 'center'
                });

                // Page number
                slide.addText(`${itemNum} / ${totalItems}`, {
                    x: 8.5, y: 5.32, w: 1, h: 0.15,
                    fontSize: 7, color: brandColors.lightText, align: 'right'
                });

                itemNum++;
            }
        }

        pres.writeFile({ fileName: 'presentation_export.pptx' });
    };

    // ===================== PREMIUM PRESENTATION PDF (LIGHT THEME) =====================
    const handleGeneratePptPdf = async (sourceTables) => {
        const doc = new jsPDF({ orientation: 'landscape' });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();

        // Colors matching the reference design (matching PPTX)
        const colors = {
            primary: [30, 95, 168],      // Blue header
            accent: [245, 166, 35],      // Gold/Yellow accent
            text: [51, 51, 51],          // Dark text
            lightText: [102, 102, 102],  // Light gray text
            bg: [255, 255, 255],         // White background
            lightBg: [245, 245, 245],    // Light gray background
            border: [224, 224, 224]      // Light border
        };

        let itemNumber = 1;
        const totalItems = sourceTables.reduce((acc, t) => acc + t.rows.length, 0);

        // ===== TITLE PAGE =====
        doc.setFillColor(...colors.bg);
        doc.rect(0, 0, pageWidth, pageHeight, 'F');
        doc.setFillColor(...colors.primary);
        doc.rect(0, 0, pageWidth, 35, 'F');
        doc.setFillColor(...colors.accent);
        doc.rect(0, 35, pageWidth, 2, 'F');

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
                const brand = brandIdx > -1 ? String(row.cells[brandIdx].value || '') : '';
                const qty = qtyIdx > -1 ? String(row.cells[qtyIdx].value || '') : '';
                const finish = finishIdx > -1 ? String(row.cells[finishIdx].value || '') : '';

                // Truncate description for title
                const titleText = desc.length > 70 ? desc.substring(0, 67) + '...' : desc;

                // ===== HEADER BAR =====
                doc.setFillColor(...colors.primary);
                doc.rect(0, 0, pageWidth, 25, 'F');
                doc.setFillColor(...colors.accent);
                doc.rect(0, 25, pageWidth, 2, 'F');

                // Item title in header - handle multi-line if needed
                const arabicLoaded = await loadArabicFont(doc);
                const processText = (txt) => (arabicLoaded && hasArabic(txt)) ? fixArabic(txt) : String(txt || '');

                doc.setTextColor(...colors.bg);
                doc.setFontSize(14);
                doc.setFont(arabicLoaded ? 'Almarai' : 'helvetica', 'bold');

                const fullTitle = `Item ${itemNumber}: ${titleText}`;
                const titleLines = doc.splitTextToSize(processText(fullTitle), pageWidth - 70);
                let currentTitleY = 12;
                titleLines.slice(0, 2).forEach(tl => {
                    doc.text(tl, 8, currentTitleY);
                    currentTitleY += 7;
                });

                // Company logo area (top right)
                // This PDF version has a white background in the header area, so prefer original logo
                const pptPdfLogo = logoBlue || logoWhite;
                if (pptPdfLogo) {
                    try {
                        const logoImg = await getImageData(pptPdfLogo);
                        if (logoImg) {
                            const fit = calcFitSize(logoImg.width, logoImg.height, 35, 15);
                            doc.addImage(logoImg.dataUrl, 'PNG', pageWidth - 10 - fit.w, 5, fit.w, fit.h);
                        }
                    } catch (e) { }
                } else {
                    doc.setTextColor(...colors.lightText);
                    doc.setFontSize(7);
                    doc.setFont('helvetica', 'normal');
                    doc.text(companyName || 'BOQFLOW', pageWidth - 23, 14, { align: 'center' });
                }

                // ===== LEFT SIDE: IMAGE(S) =====
                const imgAreaX = 8;
                const imgAreaY = 32;
                const imgAreaW = 130;
                const imgAreaH = 120;

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
                doc.setFontSize(9);
                const descText = desc.length > 350 ? desc.substring(0, 347) + '...' : desc;

                // Break into manual lines for precise control
                const rawLines = doc.splitTextToSize(processText(descText), detailW);
                const displayLines = rawLines.slice(0, 12);

                displayLines.forEach((line) => {
                    doc.text(line, detailX, detailY);
                    detailY += 7; // Increased to 7 for better spacing
                });
                detailY += 6;

                // Brand sub-section
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(10);
                doc.text('Brand:', detailX, detailY);
                doc.setFont('helvetica', 'normal');
                doc.text(brand || 'N/A', detailX + 22, detailY);
                detailY += 8; // Adjusted padding

                // Quantity sub-section
                doc.setFont('helvetica', 'bold');
                doc.text('Quantity:', detailX, detailY);
                doc.setFont('helvetica', 'normal');
                doc.text(qty || 'As per BOQ', detailX + 22, detailY);
                detailY += 12;

                // Specifications sub-section
                doc.setTextColor(...colors.primary);
                doc.setFont('helvetica', 'bold');
                doc.text('Specifications:', detailX, detailY);
                detailY += 6;

                // Build specifications from available data
                doc.setTextColor(...colors.text);
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9);
                const specs = [];
                if (finish) specs.push(`• Finish: ${finish}`);
                if (desc.includes('mm')) {
                    const sizeMatch = desc.match(/\d+\s*[xX×]\s*\d+\s*(mm|cm)?/);
                    if (sizeMatch) specs.push(`• Dimensions: ${sizeMatch[0]}`);
                }
                specs.push('• Warranty: As per manufacturer');

                specs.forEach((spec, idx) => {
                    doc.text(spec, detailX + 3, detailY + idx * 5);
                });

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
                const footerVal = profile.website || profile.companyName || 'BOQFLOW';
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
        const isMoneyCol = /rate|price|amount|total/i.test(header || '');
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
                            {table.rows.map((row, rowIndex) => (
                                <tr key={rowIndex} className={row.isHeader ? styles.headerRow : ''}>
                                    {row.cells.map((cell, cellIndex) => {
                                        const CellTag = row.isHeader ? 'th' : 'td';
                                        return (
                                            <CellTag key={cellIndex} className={`${styles.cell} ${cell.images?.length ? styles.imageCell : ''}`}>
                                                {(cell.images && cell.images.length > 0) || cell.image ? (
                                                    <div className={(cell.images?.length > 1) ? styles.imageGrid : styles.cellImage}>
                                                        {(cell.images || [cell.image]).map((imgData, imgIdx) => (
                                                            <img
                                                                key={imgIdx}
                                                                src={getFullUrl(imgData.url)}
                                                                alt="Thumb"
                                                                className={styles.image}
                                                                onClick={() => setSelectedImage(getFullUrl(imgData.url))}
                                                                style={{ cursor: 'pointer' }}
                                                            />
                                                        ))}
                                                    </div>
                                                ) : null}
                                                <div
                                                    className={styles.editableCell}
                                                    contentEditable={!isCosted && !row.isHeader}
                                                    suppressContentEditableWarning
                                                    onBlur={(e) => !isCosted && handleCellChange(tableIndex, rowIndex, cellIndex, e.target.innerText)}
                                                >
                                                    {row.isHeader ? cell.value : formatNumber(cell.value, table.header?.[cellIndex])}
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
                            ))}
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

                {!isCosted && table.extractedSummary && (
                    <div className={styles.summarySection} style={{ borderColor: '#3b82f6' }}>
                        <div className={styles.summaryDetailRow}>
                            <span>Total Items:</span>
                            <span>{table.extractedSummary.itemCount}</span>
                        </div>
                        <div className={styles.summaryDetailRow}>
                            <span>Total Quantity:</span>
                            <span>{parseFloat(table.extractedSummary.totalQty).toLocaleString()}</span>
                        </div>
                        {parseFloat(table.extractedSummary.totalRate) > 0 && (
                            <div className={styles.summaryDetailRow}>
                                <span>Sum of Rates:</span>
                                <span>{parseFloat(table.extractedSummary.totalRate).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                            </div>
                        )}
                        <div className={styles.summaryTotal} style={{ color: '#3b82f6' }}>
                            <span>Total Amount:</span>
                            <span>{parseFloat(table.extractedSummary.totalAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                        </div>
                    </div>
                )}
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
                    <button className={actionStyles.actionBtn} onClick={() => handleDownloadPDF(tables, 'Original_Offer')}>📄 Download Offer PDF</button>
                    <button className={actionStyles.actionBtn} onClick={() => handleDownloadExcel(tables, 'Original_Offer')}>📊 Download Offer Excel</button>
                    <button className={actionStyles.actionBtn} onClick={() => handleGeneratePresentation(tables)}>📽️ Generate Presentation</button>
                    <button className={actionStyles.actionBtn} onClick={() => handleGeneratePptPdf(tables)}>📑 Presentation PDF</button>
                    <button className={actionStyles.actionBtn} onClick={() => handleGenerateMas(tables)}>📋 Generate MAS</button>
                    <button className={`${actionStyles.actionBtn} ${actionStyles.actionBtnMir}`} onClick={() => handleGenerateMIR(tables)}>🔍 Generate MIR</button>
                    <button className={`${actionStyles.actionBtn} ${actionStyles.actionBtnWir}`} onClick={() => handleGenerateWIR(tables)}>🔧 Generate WIR</button>
                    <button className={`${actionStyles.actionBtn} ${actionStyles.actionBtnDn}`} onClick={() => handleGenerateDeliveryNote(tables)}>🚚 Delivery Note</button>
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
                </div>
                {costingFactors && (
                    <div style={{ marginTop: '1rem', fontSize: '0.9rem', color: '#94a3b8' }}>
                        Active: Profit {costingFactors.profit}%, Freight {costingFactors.freight}%, Customs {costingFactors.customs}%, Install {costingFactors.installation}%
                    </div>
                )}
            </div>

            {/* 2. Costed Data Section (Only if Costing Applied) */}
            {costedTables && (
                <div id="costed-results" style={{ animation: 'fadeInUp 0.5s ease' }}>
                    <div className={styles.header}>
                        <h2 className={styles.title} style={{ color: '#f59e0b' }}>💰 Cost Simulation Results</h2>
                    </div>
                    {renderTableList(costedTables, true)}

                    {/* Set of Actions for Costed Tables */}
                    <div className={actionStyles.actionBar}>
                        <div className={actionStyles.actionBarTop}>
                            <div className={actionStyles.actionTitle} style={{ color: '#f59e0b' }}>Costed Data Actions</div>
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
                            <button className={actionStyles.actionBtn} onClick={() => handleGeneratePresentation(costedTables)}>📽️ Generate Costed Presentation</button>
                            <button className={actionStyles.actionBtn} onClick={() => handleGeneratePptPdf(costedTables)}>📑 Costed Presentation PDF</button>
                            <button className={actionStyles.actionBtn} onClick={() => handleGenerateMas(costedTables)}>📋 Generate Costed MAS</button>
                            <button className={`${actionStyles.actionBtn} ${actionStyles.actionBtnMir}`} onClick={() => handleGenerateMIR(costedTables)}>🔍 Generate Costed MIR</button>
                            <button className={`${actionStyles.actionBtn} ${actionStyles.actionBtnWir}`} onClick={() => handleGenerateWIR(costedTables)}>🔧 Generate Costed WIR</button>
                            <button className={`${actionStyles.actionBtn} ${actionStyles.actionBtnDn}`} onClick={() => handleGenerateDeliveryNote(costedTables)}>🚚 Costed Delivery Note</button>
                        </div>
                    </div>
                </div>
            )}

            <MultiBudgetModal
                isOpen={isMultiBudgetOpen}
                onClose={() => setMultiBudgetOpen(false)}
                originalTables={tables}
                onApplyFlow={(formattedData) => {
                    setTables(formattedData.tables);
                    setCostingFactors(formattedData.costingFactors);
                    setMultiBudgetOpen(false);
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

            {selectedImage && (
                <div className={styles.modalOverlay} onClick={() => setSelectedImage(null)}>
                    <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
                        <button className={styles.innerCloseButton} onClick={() => setSelectedImage(null)}>×</button>
                        <img src={selectedImage} alt="Full view" className={styles.modalImage} />
                    </div>
                </div>
            )}
        </div>
    );
}

export default TableViewer;
