import { useState, useEffect } from 'react';
import AddBrandModal from './AddBrandModal';
import CostingModal from './CostingModal';
import styles from '../styles/MultiBudgetModal.module.css';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

import { ScrapingProvider } from '../context/ScrapingContext';
import { useCompanyProfile } from '../context/CompanyContext';
import { fixArabic, hasArabic, loadArabicFont } from '../utils/arabicPdfUtils';

const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:3001' : '';

const getFullUrl = (url) => {
    if (!url) return '';
    // Proxy Architonic and Amara Art images to bypass hotlink protection/CORS
    if (url.includes('amara-art.com') || url.includes('architonic.com')) {
        // Base64 encode the URL to bypass client-side antivirus/firewall URL inspection
        return `${API_BASE}/api/image-proxy?url=${encodeURIComponent(btoa(url))}`;
    }
    if (url.startsWith('http') || url.startsWith('data:')) return url;
    return `${API_BASE}${url}`;
};

export default function MultiBudgetModal({ isOpen, onClose, originalTables }) {
    const profile = useCompanyProfile();
    const { companyName, logoWhite, logoBlue, website, updateProfile, processLogoFile } = profile;
    const [activeTier, setActiveTier] = useState('mid'); // budgetary, mid, high
    const [previewImage, setPreviewImage] = useState(null); // URL of image to preview
    const [previewLogo, setPreviewLogo] = useState(null); // URL of brand logo for preview
    // State stores data + mode PER TIER
    // Structure: { mid: { rows: [...], mode: 'boq'|'new' }, ... }
    const [tierData, setTierData] = useState({
        budgetary: null,
        mid: null,
        high: null
    });

    // Brand System
    const [brands, setBrands] = useState([]);
    const [isAddBrandOpen, setIsAddBrandOpen] = useState(false);
    const [openBrandDropdown, setOpenBrandDropdown] = useState(null); // row index of open dropdown

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

    const fetchBrands = () => {
        fetch(`${API_BASE}/api/brands`)
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) {
                    setBrands(data);

                    // Auto-update prices in existing rows if they are 0
                    setTierData(prev => {
                        const newState = { ...prev };
                        ['budgetary', 'mid', 'high'].forEach(tierName => {
                            const tier = newState[tierName];
                            if (tier && tier.rows) {
                                const newRows = tier.rows.map(row => {
                                    if (row.selectedBrand && row.selectedModel) {
                                        const brand = data.find(b => b.name === row.selectedBrand);
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
                                                return { ...row, rate: basePrice.toFixed(2), basePrice: basePrice };
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

    // Helper to find column index in original table
    const findCol = (header, regex) => {
        if (!header) return -1;
        return header.findIndex(h => regex.test(h));
    };

    const handleGenerateFromBoq = () => {
        if (!originalTables || originalTables.length === 0) {
            console.warn("No original tables to generate from.");
            return;
        }

        const sourceTable = originalTables[0];
        const header = sourceTable.header || [];

        const idxDesc = findCol(header, /description|desc/i);
        const idxQty = findCol(header, /qty|quantity/i);
        const idxUnit = findCol(header, /unit|uom/i);
        const idxRate = findCol(header, /rate|price/i);
        const idxTotal = findCol(header, /total|amount/i);

        const newRows = sourceTable.rows.map((row, i) => {
            const getVal = (idx) => idx !== -1 ? (row.cells[idx]?.value || '') : '';
            const imageCell = row.cells.find(c => c.image || (c.images && c.images.length > 0));
            let imgSrc = imageCell ? (imageCell.image || imageCell.images[0]) : null;
            if (imgSrc && typeof imgSrc === 'object' && imgSrc.url) imgSrc = imgSrc.url;
            // Ensure proper path format
            if (imgSrc && !imgSrc.startsWith('http') && !imgSrc.startsWith('/')) imgSrc = '/' + imgSrc;

            return {
                id: Date.now() + i,
                sn: i + 1,
                imageRef: imgSrc,
                brandImage: '',
                brandDesc: '',
                description: getVal(idxDesc) || (idxDesc === -1 ? row.cells[1]?.value : ''),
                qty: getVal(idxQty),
                unit: getVal(idxUnit),
                rate: getVal(idxRate),
                amount: getVal(idxTotal),

                // Dropdown States
                selectedBrand: '',
                selectedMainCat: '',
                selectedSubCat: '',
                selectedFamily: '',
                selectedModel: ''
            };
        });

        // Update ONLY active tier with BOQ mode
        setTierData(prev => ({
            ...prev,
            [activeTier]: { rows: newRows, mode: 'boq' }
        }));
    };

    const handleCreateNewBoq = () => {
        const emptyRows = Array(5).fill().map((_, i) => ({
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

    const getUniqueValues = (items, key) => [...new Set(items.map(i => i[key]).filter(Boolean))];

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
                            p.mainCategory === row.selectedMainCat &&
                            p.subCategory === row.selectedSubCat &&
                            p.family === row.selectedFamily &&
                            p.model === model
                        );

                        if (candidates.length > 0) {
                            // Check if the synthetic ID contains an index suffix logic (e.g. model_CODE_0)
                            // Structure from render: `model_${modelName}_${i}` or `model_${modelName}`
                            if (url && url.startsWith('model_')) {
                                const parts = url.split('_');
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
                        // Set raw price directly without costing
                        const basePrice = parseFloat(product.price) || 0;
                        row.rate = basePrice.toFixed(2);
                        row.basePrice = basePrice;

                        // Default Unit to "Nos" if empty
                        if (!row.unit) row.unit = 'Nos';
                    }
                }
            } else {
                // Standard Field
                row[field] = value;
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

    // Apply costing factors to all rows with base prices
    const handleApplyCosting = (factors) => {
        setCostingFactors(factors);
        setIsCostingOpen(false);

        // Recalculate rates for all rows with base prices
        setTierData(prev => {
            const tier = prev[activeTier];
            if (!tier) return prev;
            const newRows = tier.rows.map(row => {
                if (row.basePrice && row.basePrice > 0) {
                    const markup = 1 + (factors.profit + factors.freight + factors.customs + factors.installation) / 100;
                    const costedPrice = row.basePrice * markup * factors.exchangeRate;
                    return { ...row, rate: costedPrice.toFixed(2) };
                }
                return row;
            });
            return { ...prev, [activeTier]: { ...tier, rows: newRows } };
        });
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
            ? ['Sr.', 'Ref Image', 'Original Desc', 'Brand Image', 'Brand Desc', 'Qty', 'Unit', 'Rate', 'Amount']
            : ['Sr.', 'Image', 'Description', 'Qty', 'Unit', 'Rate', 'Amount'];

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
                } catch (e) { console.log('Logo load error:', e); }
            }
        }

        // Build table data
        const body = tier.rows.map((row, i) => {
            const amount = row.amount || (parseFloat(row.qty || 0) * parseFloat(row.rate || 0)).toFixed(2);
            if (isBoqMode) {
                return [row.sn, '', processText(row.description), '', processText(row.brandDesc), row.qty || '', row.unit || '', row.rate || '', amount];
            } else {
                return [row.sn, '', processText(row.brandDesc), row.qty || '', row.unit || '', row.rate || '', amount];
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
                fontSize: 8,
                cellPadding: 2,
                overflow: 'linebreak',
                valign: 'middle',
                font: arabicLoaded ? 'Almarai' : 'helvetica'
            },
            headStyles: { fillColor: colors.primary, textColor: colors.white, fontStyle: 'bold', font: arabicLoaded ? 'Almarai' : 'helvetica' },
            // Optimized Portrait Column Widths
            columnStyles: isBoqMode ? {
                0: { cellWidth: 8 },   // Sr
                1: { cellWidth: 20 },  // Ref Image
                2: { cellWidth: 35 },  // Original Desc
                3: { cellWidth: 25 },  // Brand Image
                4: { cellWidth: 35 },  // Brand Desc
                5: { cellWidth: 10, halign: 'center' },  // Qty
                6: { cellWidth: 10, halign: 'center' },  // Unit
                7: { cellWidth: 16, halign: 'right' },   // Rate
                8: { cellWidth: 18, halign: 'right' }    // Amount
            } : {
                0: { cellWidth: 8 },
                1: { cellWidth: 30 },
                2: { cellWidth: 70 },
                3: { cellWidth: 15, halign: 'center' }, // Qty
                4: { cellWidth: 15, halign: 'center' }, // Unit
                5: { cellWidth: 20, halign: 'right' },  // Rate
                6: { cellWidth: 25, halign: 'right' }   // Amount
            },
            didDrawCell: (data) => {
                if (data.section === 'body') {
                    const rowIdx = data.row.index;
                    const refImgCol = isBoqMode ? 1 : -1;
                    const brandImgCol = isBoqMode ? 3 : 1;

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

                        const logoHeight = 8;
                        const padding = 1;
                        const gap = 2;

                        if (hasLogo) {
                            const logoImg = imageDataMap[`logo_${rowIdx}`];
                            const logoFit = calcFitSize(logoImg.width, logoImg.height, data.cell.width - 4, logoHeight);
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
                            const fit = calcFitSize(img.width, img.height, data.cell.width - 4, availableHeight);
                            const x = data.cell.x + (data.cell.width - fit.w) / 2;
                            const y = imgStartY + (availableHeight - fit.h) / 2;
                            doc.addImage(img.dataUrl, 'JPEG', x, y, fit.w, fit.h, undefined, 'FAST');
                        }
                    }
                }
            },
            didParseCell: (data) => {
                if (data.section === 'body') {
                    const refImgCol = isBoqMode ? 1 : -1;
                    const brandImgCol = isBoqMode ? 3 : 1;
                    if (data.column.index === brandImgCol) {
                        data.cell.styles.minCellHeight = 32;
                    } else if (data.column.index === refImgCol) {
                        data.cell.styles.minCellHeight = 22;
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
            ? ['Sr.', 'Ref Image', 'Original Desc', 'Brand Image', 'Brand Desc', 'Qty', 'Unit', 'Rate', 'Amount']
            : ['Sr.', 'Image', 'Description', 'Qty', 'Unit', 'Rate', 'Amount'];

        // Set column widths first
        ws.columns = isBoqMode
            ? [
                { width: 6 },   // Sr
                { width: 15 },  // Ref Image
                { width: 40 },  // Original Desc
                { width: 18 },  // Brand Image (wider for logo + image)
                { width: 40 },  // Brand Desc
                { width: 10 },  // Qty
                { width: 10 },  // Unit
                { width: 14 },  // Rate
                { width: 16 }   // Amount
            ]
            : [
                { width: 6 },   // Sr
                { width: 18 },  // Image (wider for logo + image)
                { width: 55 },  // Description
                { width: 12 },  // Qty
                { width: 12 },  // Unit
                { width: 16 },  // Rate
                { width: 18 }   // Amount
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
                ? [row.sn, '', row.description || '', '', row.brandDesc || '', row.qty || '', row.unit || '', row.rate || '', amount]
                : [row.sn, '', row.brandDesc || '', row.qty || '', row.unit || '', row.rate || '', amount];

            const excelRow = ws.addRow(dataRow);
            const rowNumber = excelRow.number;
            excelRow.height = 75; // Taller rows for images

            // Style data cells
            excelRow.eachCell((cell, colNumber) => {
                cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
                cell.border = {
                    bottom: { style: 'thin', color: { argb: 'E2E8F0' } }
                };
                // Description columns - left align
                if ((isBoqMode && (colNumber === 3 || colNumber === 5)) || (!isBoqMode && colNumber === 3)) {
                    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
                }
            });

            // Add reference image (BOQ mode only, column 2)
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
                            tl: { col: 1.05, row: rowNumber - 1 + 0.1 },
                            ext: { width: fit.w, height: fit.h }
                        });
                    }
                } catch (e) { console.log('Ref image error:', e); }
            }

            // Determine brand image column
            const brandImgCol = isBoqMode ? 3 : 1;

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
        const summaryStartCol = isBoqMode ? 8 : 6;

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
                const refUrl = row.imageRef.startsWith('http') ? row.imageRef : `http://localhost:3001${row.imageRef}`;
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
                    font: arabicLoaded ? 'Almarai' : 'helvetica'
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
                    {rows.map((row, index) => {
                        const refImgSrc = row.imageRef ? (String(row.imageRef).startsWith('http') ? row.imageRef : `http://localhost:3001${row.imageRef}`) : null;

                        // Active Data for Dropdowns
                        const activeBrand = brands.find(b => b.name === row.selectedBrand);
                        const brandProducts = activeBrand?.products || [];

                        // Filter Logic
                        const mainCats = getUniqueValues(brandProducts, 'mainCategory');
                        const subCats = getUniqueValues(brandProducts.filter(p => p.mainCategory === row.selectedMainCat), 'subCategory');
                        const families = getUniqueValues(brandProducts.filter(p => p.mainCategory === row.selectedMainCat && p.subCategory === row.selectedSubCat), 'family');

                        // To solve "missing products" like Sokoa variants (same model name), 
                        // we'll append a short description snippet to the model selection if multiple products have the same model.
                        const rawModels = brandProducts.filter(p => p.mainCategory === row.selectedMainCat && p.subCategory === row.selectedSubCat && p.family === row.selectedFamily);
                        const modelGroups = {};
                        rawModels.forEach(p => {
                            if (!modelGroups[p.model]) modelGroups[p.model] = [];
                            modelGroups[p.model].push(p);
                        });

                        const modelOptions = [];
                        Object.entries(modelGroups).forEach(([modelName, items]) => {
                            if (items.length > 1) {
                                // Add each variant with a snippet of description or unique ID
                                items.forEach((item, i) => {
                                    const snippet = item.description ? item.description.substring(0, 25) + '...' : `Variant ${i + 1}`;
                                    // Use productUrl as unique ID, fallback to imageUrl if missing (common in Excel imports)
                                    const uniqueVal = item.productUrl || item.imageUrl || `model_${modelName}_${i}`;
                                    modelOptions.push({
                                        value: uniqueVal,
                                        label: `${modelName} (${snippet})`,
                                        rawModel: modelName
                                    });
                                });
                            } else {
                                const item = items[0];
                                const uniqueVal = item.productUrl || item.imageUrl || `model_${modelName}`;
                                modelOptions.push({
                                    value: uniqueVal,
                                    label: modelName,
                                    rawModel: modelName
                                });
                            }
                        });

                        return (
                            <tr key={row.id}>
                                <td>{row.sn}</td>

                                {/* Ref Image (BOQ Only) */}
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
                                                    }}
                                                />
                                            </div>
                                        ) : (
                                            <div className={styles.imgPlaceholder}>No Img</div>
                                        )}
                                    </td>
                                )}

                                {/* Original Description (BOQ Only) */}
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

                                {/* Brand Image */}
                                <td>
                                    <div className={styles.brandImageCell}>
                                        {/* Brand Logo Badge */}
                                        {row.brandLogo && (
                                            <div className={styles.brandLogoBadge}>
                                                <img
                                                    src={getFullUrl(row.brandLogo)}
                                                    alt=""
                                                    className={styles.badgeLogo}
                                                    style={{ objectFit: 'contain', background: 'white', borderRadius: '2px' }}
                                                    onError={(e) => { e.target.style.display = 'none'; }}
                                                />
                                            </div>
                                        )}

                                        {/* Product Image */}
                                        {row.brandImage ? (
                                            <img
                                                src={getFullUrl(row.brandImage)}
                                                alt="brand"
                                                className={styles.tableImg}
                                                onClick={() => {
                                                    setPreviewImage(getFullUrl(row.brandImage));
                                                    setPreviewLogo(getFullUrl(row.brandLogo));
                                                }}
                                            />
                                        ) : (
                                            <div className={styles.imgPlaceholder}>Select</div>
                                        )}
                                    </div>
                                </td>

                                {/* Brand Description */}
                                <td>
                                    <textarea className={styles.cellInput} value={row.brandDesc} onChange={(e) => handleCellChange(index, 'brandDesc', e.target.value)} style={{ minHeight: '80px' }} placeholder="Product details..." />
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
                                    <div style={{ textAlign: 'right', paddingRight: '5px' }}>
                                        {row.amount || (parseFloat(row.qty || 0) * parseFloat(row.rate || 0)).toFixed(2)}
                                    </div>
                                </td>

                                {/* CASCADING DROPDOWNS COLUMN (Moved) */}
                                <td>
                                    <div className={styles.dropdownStack}>
                                        {/* 1. Brand Selector */}
                                        <div className={styles.brandDropdownContainer}>
                                            {/* Trigger Button */}
                                            <button
                                                className={`${styles.brandTrigger} ${row.selectedBrand ? styles.brandSelected : ''}`}
                                                onClick={() => setOpenBrandDropdown(openBrandDropdown === index ? null : index)}
                                            >
                                                {row.selectedBrand ? (
                                                    <>
                                                        {row.brandLogo ? (
                                                            <img
                                                                src={getFullUrl(row.brandLogo)}
                                                                alt=""
                                                                className={styles.triggerLogo}
                                                                style={{ objectFit: 'contain', background: 'white', padding: '1px', borderRadius: '2px' }}
                                                                onError={(e) => {
                                                                    e.target.style.display = 'none';
                                                                    // Show initial instead
                                                                    const initial = document.createElement('span');
                                                                    initial.className = e.target.closest('button')?.querySelector('span')?.className || '';
                                                                    initial.textContent = row.selectedBrand?.charAt(0) || '?';
                                                                    e.target.parentNode?.insertBefore(initial, e.target);
                                                                }}
                                                            />
                                                        ) : (
                                                            <span className={styles.triggerInitial}>{row.selectedBrand.charAt(0)}</span>
                                                        )}
                                                        <span className={styles.triggerText}>{row.selectedBrand}</span>
                                                    </>
                                                ) : (
                                                    <span className={styles.triggerPlaceholder}>Select Brand...</span>
                                                )}
                                                <span className={styles.triggerArrow}>{openBrandDropdown === index ? '▲' : '▼'}</span>
                                            </button>

                                            {/* Dropdown Panel */}
                                            {openBrandDropdown === index && (
                                                <div className={styles.brandDropdownPanel}>
                                                    {Array.from(new Map(brands.map(b => [b.name, b])).values()).map(b => (
                                                        <button
                                                            key={b.id}
                                                            className={`${styles.brandOption} ${row.selectedBrand === b.name ? styles.brandOptionActive : ''}`}
                                                            onClick={() => {
                                                                handleCellChange(index, 'selectedBrand', b.name);
                                                                setOpenBrandDropdown(null);
                                                            }}
                                                        >
                                                            {b.logo ? (
                                                                <img
                                                                    src={getFullUrl(b.logo)}
                                                                    alt=""
                                                                    className={styles.optionLogo}
                                                                    style={{ objectFit: 'contain', background: 'white', padding: '1px', borderRadius: '2px' }}
                                                                    onError={(e) => {
                                                                        // Replace with initial on error
                                                                        const span = document.createElement('span');
                                                                        span.className = e.target.nextSibling?.previousSibling ? '' : '';
                                                                        span.textContent = b.name.charAt(0);
                                                                        span.style.cssText = 'width:22px;height:22px;background:white;border-radius:3px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:11px;color:#7c3aed;flex-shrink:0;';
                                                                        e.target.parentNode?.insertBefore(span, e.target);
                                                                        e.target.style.display = 'none';
                                                                    }}
                                                                />
                                                            ) : (
                                                                <span className={styles.optionInitial}>{b.name.charAt(0)}</span>
                                                            )}
                                                            <span className={styles.optionName}>
                                                                {b.name.replace(/Explore collections by/i, '').trim()}
                                                            </span>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        {/* 2. Main Category */}
                                        {row.selectedBrand && (
                                            <select className={styles.productSelect} value={row.selectedMainCat} onChange={(e) => handleCellChange(index, 'selectedMainCat', e.target.value)}>
                                                <option value="">Select Category...</option>
                                                {mainCats.map(c => <option key={c} value={c}>{c}</option>)}
                                            </select>
                                        )}

                                        {/* 3. Sub Category */}
                                        {row.selectedMainCat && (
                                            <select className={styles.productSelect} value={row.selectedSubCat} onChange={(e) => handleCellChange(index, 'selectedSubCat', e.target.value)}>
                                                <option value="">Select Sub-Category...</option>
                                                {subCats.map(c => <option key={c} value={c}>{c}</option>)}
                                            </select>
                                        )}

                                        {/* 4. Family */}
                                        {row.selectedSubCat && (
                                            <select className={styles.productSelect} value={row.selectedFamily} onChange={(e) => handleCellChange(index, 'selectedFamily', e.target.value)}>
                                                <option value="">Select Family...</option>
                                                {families.map(c => <option key={c} value={c}>{c}</option>)}
                                            </select>
                                        )}

                                        {/* 5. Model (With Variant Support) */}
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
                                                <option value="">Select Model/Variant...</option>
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
                    })}
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

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modalContainer} onClick={e => e.stopPropagation()}>

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
                            <button className={styles.actionCard} onClick={handleGenerateFromBoq}>
                                📝 Generate from BOQ
                            </button>
                            <button className={styles.actionCard} onClick={handleCreateNewBoq}>
                                ➕ Create New BOQ
                            </button>
                            <button className={styles.actionCard} onClick={handleAddBrand}>
                                🌐 Add Brand
                            </button>
                        </div>

                        <div className={styles.tabsContainer}>
                            <button className={`${styles.tab} ${activeTier === 'budgetary' ? styles.activeTabBudgetary : ''}`} onClick={() => setActiveTier('budgetary')}>
                                💰 Budgetary
                            </button>
                            <button className={`${styles.tab} ${activeTier === 'mid' ? styles.activeTabMid : ''}`} onClick={() => setActiveTier('mid')}>
                                ⭐ Mid-Range
                            </button>
                            <button className={`${styles.tab} ${activeTier === 'high' ? styles.activeTabHigh : ''}`} onClick={() => setActiveTier('high')}>
                                👑 High-End
                            </button>
                        </div>
                    </div>

                    {/* Scrollable Table Area */}
                    <div className={styles.tableContainer}>
                        {tierData[activeTier] ? (
                            renderTable(tierData[activeTier])
                        ) : (
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
                                <div style={{ fontSize: '3rem', opacity: 0.2 }}>📋</div>
                                <div style={{ marginTop: '1rem' }}>No table data yet. Click "Generate from BOQ" or "Create New BOQ".</div>
                            </div>
                        )}
                    </div>

                    {/* Fixed Footer */}
                    <div className={styles.footer}>
                        <button className={styles.applyCostingBtn} onClick={() => setIsCostingOpen(true)}>
                            💰 Apply Costing to Table
                        </button>

                        <div style={{ width: '100%', borderTop: '1px solid rgba(255,255,255,0.1)' }} />

                        <div className={styles.exportGroup}>
                            <button className={styles.exportBtn} onClick={handleExportPDF}>📄 Offer PDF</button>
                            <button className={styles.exportBtn} onClick={handleExportExcel}>📊 Offer Excel</button>
                            <button className={styles.exportBtn} onClick={handleExportPPTX}>📽️ Presentation</button>
                            <button className={styles.exportBtn} onClick={handleExportPresentationPDF}>📑 PDF</button>
                            <button className={styles.exportBtn} onClick={handleExportMAS}>📋 MAS</button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Image Preview Overlay */}
            {previewImage && (
                <div className={styles.previewOverlay} onClick={(e) => { e.stopPropagation(); setPreviewImage(null); setPreviewLogo(null); }}>
                    <div className={styles.previewContent} onClick={e => e.stopPropagation()}>
                        <button className={styles.previewCloseBtn} onClick={() => { setPreviewImage(null); setPreviewLogo(null); }}>×</button>

                        {/* Brand Logo Badge in Modal */}
                        {previewLogo && (
                            <div className={styles.previewLogoBadge}>
                                <img
                                    src={getFullUrl(previewLogo)}
                                    alt="brand logo"
                                    className={styles.previewBadgeLogo}
                                    style={{ objectFit: 'contain', background: 'white', padding: '4px', borderRadius: '4px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}
                                    onError={(e) => { e.target.parentNode.style.display = 'none'; }}
                                />
                            </div>
                        )}

                        <img src={previewImage} alt="Full view" className={styles.previewImage} />
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
            {/* Costing Modal */}
            <CostingModal
                isOpen={isCostingOpen}
                onClose={() => setIsCostingOpen(false)}
                initialFactors={costingFactors}
                onApply={handleApplyCosting}
            />
        </div>
    );
}
