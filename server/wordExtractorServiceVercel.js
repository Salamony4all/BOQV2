import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';

import { renderPDFWithLayoutMuPDF } from './utils/pdfRendererMupdf.js';
import { extractPdfViaWordFastPathVercel } from './universalPatternParsersVercel.js';
import { uploadToSupabase, supabase } from './utils/supabaseStorage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execPromise = promisify(exec);
export const WORDCOM_VERCEL_EXTRACTOR_VERSION = 'wordcom-vercel-v17.1-mupdf';
console.log(`[WordPdfExtractorVercel] Module loaded: ${WORDCOM_VERCEL_EXTRACTOR_VERSION}`);

const DEFAULT_HEADER = ['SL.No', 'Image Reference', 'Item Description', 'QTY', 'Unit', 'Unit Price', 'Total (AED)'];
const BOQ_HEADER_KEYWORDS = [
    /\b(description|desc|disc|product|specification|material|particulars|item\s*description|details)s?\b/i,
    /\b(qty|quantity|quanity|qnty|q'?ty|amount|vol)\b/i,
    /\b(unit|uom|untit|measure|nos|no\.?|pcs|set|lot)\b/i,
    /\b(rate|price|prise|u\.?rate|unit\s*price|unit\s*rate|sp|sp\/eur)\b/i,
    /\b(amount|total|sub\s*total|value|sum|tp|tp\/eur)\b/i,
    /\b(image|photo|picture|img|pic|image\s*reference|ref)\b/i,
    /\b(sn|s\.?n\.?|sl\.?no\.?|no\.?|item\s*no|sr|sl|serial)\b/i
];

const HEADER_ALIASES = {
    sn: ['SL.No', 'S.N', 'S/N', 'No.', 'Item No'],
    image: ['Image Reference', 'Image', 'Photo', 'Picture', 'Ref'],
    description: ['Item Description', 'Description', 'Particulars', 'Specification'],
    qty: ['QTY', 'Qty', 'Quantity'],
    unit: ['Unit', 'UOM'],
    rate: ['Unit Price', 'Rate', 'U.Rate', 'Unit Rate', 'SP/EUR'],
    amount: ['Total (AED)', 'Amount', 'Total', 'TP/EUR']
};

export async function extractPdfViaWordVercel(filePath, progressCallback = () => { }, onBlobCreated = null) {
    try {
        await fs.access(filePath);
    } catch {
        throw new Error(`PDF extraction initialization failed. File not found: ${filePath}`);
    }

    const isVercel = true;
    const tempDir = path.join(os.tmpdir(), 'boqflow-word-vercel');
    await fs.mkdir(tempDir, { recursive: true });

    const absInput = path.resolve(filePath);

    // Try fast-path Vercel Wasm-based extraction (v16 + v17 regex patterns)
    try {
        const fastResult = await extractPdfViaWordFastPathVercel(filePath, progressCallback);
        if (fastResult) {
            if (onBlobCreated) {
                try { await onBlobCreated([]); } catch (err) { console.warn(`[WordPdfExtractorVercel] blob callback failed: ${err.message}`); }
            }
            return fastResult;
        }
    } catch (fastErr) {
        console.warn(`[WordPdfExtractorVercel] Fast-path Wasm extraction notice: ${fastErr.message}. Falling back to standard pipeline...`);
    }

    let pageCount = 0;
    try {
        const mupdf = await import('mupdf');
        const data = await fs.readFile(absInput);
        const doc = mupdf.Document.openDocument(new Uint8Array(data), 'application/pdf');
        pageCount = doc.countPages();
        console.log(`[WordPdfExtractorVercel] PDF page count: ${pageCount}`);
    } catch (e) {
        console.warn(`[WordPdfExtractorVercel] Could not determine page count: ${e.message}`);
    }

    const directPdfText = await extractPdfPlainTextMupdf(absInput);
    if (directPdfText && directPdfText.trim()) {
        console.log('[WordPdfExtractorVercel] Falling back to direct WebAssembly PDF text parsing...');
        progressCallback(60);
        
        let tables = [];
        tables = recoverUniversalV12RowsFromFullText(null, {}, tables, directPdfText);
        if (tables && tables.length > 0) {
            assignRowPageNumbers(tables, directPdfText);
            
            const firstTable = tables[0];
            const targetPages = [...new Set(firstTable.rows.map(r => r.pageNum))].sort((a, b) => a - b);
            console.log(`[WordPdfExtractorVercel] Target pages for WebAssembly native layout extraction: ${targetPages.join(', ')}`);
            
            let layouts = [];
            try {
                layouts = await renderPDFWithLayoutMuPDF(absInput, targetPages);
                console.log(`[WordPdfExtractorVercel] MuPDF native layout extraction retrieved ${layouts.length} pages.`);
            } catch (e) {
                console.warn(`[WordPdfExtractorVercel] MuPDF layout extraction failed: ${e.message}`);
            }
            
            const sessionId = `word_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
            await pairNativeImagesToFallbackRowsVercel(tables, layouts, sessionId, directPdfText);

            progressCallback(100);
            return {
                tables,
                totalTables: tables.length,
                isDirectExtraction: true,
                engineUsed: `${WORDCOM_VERCEL_EXTRACTOR_VERSION}-direct-text`,
                previewUrl: null
            };
        }
    }
    throw new Error('PDF extraction failed. WebAssembly text parsing could not identify valid tables.');
}

async function extractPdfPlainTextMupdf(filePath) {
    try {
        const mupdf = await import('mupdf');
        const data = await fs.readFile(filePath);
        const doc = mupdf.Document.openDocument(new Uint8Array(data), 'application/pdf');
        const pages = [];
        for (let i = 0; i < doc.countPages(); i++) {
            try {
                const page = doc.loadPage(i);
                const text = page.toStructuredText().asText();
                if (text && text.trim()) pages.push(text.trim());
            } catch (pageErr) { console.warn(`[WordPdfExtractorVercel] mupdf text page ${i + 1} failed: ${pageErr.message}`); }
        }
        return pages.join('\n--- PAGE BREAK ---\n');
    } catch (err) { console.warn(`[WordPdfExtractorVercel] mupdf direct text unavailable: ${err.message}`); return ''; }
}

function cleanMojibake(value) {
    return String(value || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[\uFFFD]+/g, ' ')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
        .replace(/[\uE000-\uF8FF]/g, ' ')
        .replace(/(?:\s*[\u25A0-\u25FF\u2600-\u27BF]\s*){2,}/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function normText(value) { return cleanMojibake(value); }
function emptyCell() { return { value: '', images: [], image: null, isMerged: false }; }
function makeCell(value = '', images = [], extra = {}) {
    const cleanImages = uniqueImages(images || []);
    return { value: normText(value), images: cleanImages, image: cleanImages[0] || null, isMerged: false, ...extra };
}
function imageStem(file) {
    const base = path.basename(String(file || '').toLowerCase());
    return base.replace(/\.[a-z0-9]+$/i, '').replace(/^temp_\d+_/, '').replace(/[^a-z0-9]+/g, '');
}
function uniqueImages(images) {
    const seen = new Set();
    const out = [];
    for (const img of images || []) {
        if (!img || !img.url || seen.has(img.url)) continue;
        seen.add(img.url);
        out.push(img);
    }
    return out;
}
function scoreHeader(text) { return BOQ_HEADER_KEYWORDS.reduce((a, rx) => a + (rx.test(text || '') ? 1 : 0), 0); }
function looksLikeHeader(texts) {
    const joined = texts.map(normText).join(' | ');
    return scoreHeader(joined) >= 2 || (/description|desc|particulars|product/i.test(joined) && /qty|quantity|unit|rate|amount|total/i.test(joined));
}
function classifyHeader(text) {
    const t = normText(text).toLowerCase();
    if (/^(s\.?n\.?|sl\.?no\.?|sr\.?no\.?|no\.?|#|item\s*no|serial|code|tag)$/.test(t) || /item\s*code|product\s*code|art\.?-\s*no/i.test(t)) return 'sn';
    if (/image|photo|picture|img|pic|ref/i.test(t) && !/code|tag/i.test(t)) return 'image';
    if (/qty|quantity|qnty|qt|vol/i.test(t)) return 'qty';
    if (/description|desc|disc|product|specification|material|particulars|details|item/i.test(t)) return 'description';
    if (/amount|total|value|sum|subtotal|\btp\b|\btp\//i.test(t) || /ext\.?\s*net|ext\.?\s*price|ext\.?\s*cost|extended/i.test(t)) return 'amount';
    if (/rate|price|prise|cost|u\.?rate|\bsp\b|\bsp\//i.test(t)) return 'rate';
    if (/unit|uom|measure|untit|nos|pcs|set|lot/i.test(t)) return 'unit';
    return null;
}
function canonicalIndex(header, type) {
    const idx = (header || []).findIndex(h => classifyHeader(h) === type);
    if (idx !== -1) return idx;
    const fallback = { sn: 0, image: 1, description: 2, qty: 3, unit: 4, rate: 5, amount: 6 };
    return Math.min(fallback[type] ?? 0, Math.max((header || []).length - 1, 0));
}
function normalizeHeaderName(text, idx) {
    const type = classifyHeader(text);
    if (type) return HEADER_ALIASES[type][0];
    return normText(text) || DEFAULT_HEADER[idx] || `Column ${idx + 1}`;
}

function v12Cell(value, images = []) {
    const cleanImages = Array.isArray(images) ? uniqueImages(images.filter(Boolean)) : [];
    return { value: normText(value), images: cleanImages, image: cleanImages[0] || null, isMerged: false };
}
function v12Row(values, pageNum = 1, imagesByColumn = {}) {
    return { cells: values.map((v, idx) => v12Cell(v, imagesByColumn[idx] || [])), isHeader: false, isSummary: false, pageNum, sectionLabel: '' };
}
function v12BestTable(candidates, tables) {
    const currentBest = Math.max(0, ...(tables || []).map(t => (t.rows || []).length));
    const good = candidates.filter(t => t && Array.isArray(t.rows) && t.rows.length >= 3).sort((a, b) => (b.confidence || 0) - (a.confidence || 0) || b.rows.length - a.rows.length);
    if (!good.length) return tables;
    const best = good[0];
    if ((best.confidence || 0) >= 0.94 || best.rows.length >= currentBest) return [best];
    return tables;
}

function splitDynamicHeaderParts(headerText) {
    const h = normText(headerText);
    if (/item\s+no\s+description\s+unit\s+qty/i.test(h)) {
        const cost = /unit\s+cost/i.test(h) ? (h.match(/Unit\s+cost\s*\([^)]*\)|Unit\s+cost/i) || ['Unit cost'])[0] : 'Unit Cost';
        const total = /total\s+cost/i.test(h) ? (h.match(/Total\s+cost\s*\([^)]*\)|Total\s+cost/i) || ['Total cost'])[0] : 'Total Cost';
        return ['Item No', 'Description', 'Unit', 'Qty', cost, total];
    }
    if (/item\s+description\s+unit\s+qty/i.test(h)) return ['Item', 'Description', 'Unit', 'Qty', 'Rate', 'Amount'];
    return null;
}

function parseGenericDynamicHeaderTableV13(rawText) {
    const text = normText(rawText);
    if (!text) return null;

    const headerMatch = text.match(/(Item\s+No\s+Description\s+Unit\s+Qty(?:\s+Unit\s*cost\s*\([^)]*\))?(?:\s+Total\s*cost\s*\([^)]*\))?)/i)
        || text.match(/(Item\s+Description\s+Unit\s+Qty(?:\s+Rate)?(?:\s+Amount)?)/i);
    if (!headerMatch) return null;
    const header = splitDynamicHeaderParts(headerMatch[1]);
    if (!header) return null;

    const stopRx = /\b(Total\s+VAT|Grand[-\s]*Total|Grand\s+Total|VAT\s*\(|Total\s*$)/i;
    let body = text.slice(headerMatch.index + headerMatch[0].length);
    const stop = body.search(stopRx);
    if (stop > 0) body = body.slice(0, stop);

    const rows = [];
    const itemNoRx = /\b(\d+(?:\.\d+)+)\b/g;
    const starts = [...body.matchAll(itemNoRx)]
        .filter(m => !/^\d{4}$/.test(m[1]) && m.index !== undefined)
        .map(m => ({ id: m[1], index: m.index }));
    if (!starts.length) return null;

    const unitRx = /(job|m3|M3|M\.L|ML|M\.L\.|M\.L\s|M2|m2|SQM|LM|No\.?|NO|Nos|PCS|Pcs|Set|Lot|Each|Item)\b/i;
    for (let i = 0; i < starts.length; i++) {
        const id = starts[i].id;
        const segStart = starts[i].index + id.length;
        const segEnd = i + 1 < starts.length ? starts[i + 1].index : body.length;
        let seg = normText(body.slice(segStart, segEnd));
        if (!seg || /^(Total|VAT|Grand)/i.test(seg)) continue;

        const unitMatches = [...seg.matchAll(new RegExp(`\\s${unitRx.source}\\s+(\\d+(?:\\.\\d+)?)`, 'gi'))];
        if (!unitMatches.length) continue;
        const tail = unitMatches[unitMatches.length - 1];
        const unit = normText(tail[1]).replace(/\.$/, '');
        const qty = normText(tail[2]);
        let desc = normText(seg.slice(0, tail.index));
        let after = normText(seg.slice(tail.index + tail[0].length));
        const nums = after.match(/[\d,]+(?:\.\d+)?/g) || [];
        const rate = nums[0] || '';
        const amount = nums[1] || '';
        if (!desc || desc.length < 3) continue;
        if (/^[A-Z\s&:]+$/.test(desc) && !qty) continue;
        rows.push(v12Row([id, desc, unit, qty, rate, amount], Math.max(1, Math.ceil(rows.length / 18))));
    }
    if (rows.length < 5) return null;
    return {
        sheetName: 'BOQ Schedule',
        header,
        rows,
        columnCount: header.length,
        engineUsed: 'wordcom-vercel-v13.2-dynamic-text-table',
        confidence: 0.975,
        extractionAudit: { rowCount: rows.length, dynamicHeader: header },
        serialAudit: { rowCount: rows.length, dynamicHeader: header }
    };
}

function parsePresentationCatalogPagesV13(rawText) {
    const text = normText(rawText);
    const pages = text.split('--- PAGE BREAK ---').map(p => p.trim()).filter(Boolean);
    if (pages.length < 2) return null;

    const rows = [];
    const header = ['SL.No / Code', 'Description', 'Unit', 'Qty', 'Unit Price', 'Total (AED)'];
    const unitPatStr = '(job|m3|M3|M\\.L\\.?|ML|No\\.?|NO|Nos|m²|m2|SQM|LM|MTR|Set|SET|Lot|Each|EA|Item|Pcs|PCS)';
    const unitRx = new RegExp(`\\b${unitPatStr}\\b`, 'i');

    for (let pIdx = 0; pIdx < pages.length; pIdx++) {
        const pageText = pages[pIdx];
        const codeMatch = pageText.match(/\b([A-Z0-9]{2,}\-[A-Z0-9\-]{2,})\b/) || pageText.match(/\b(\d{1,3}(?:\.\d{1,3}){2,})\b/);
        let code = codeMatch ? codeMatch[1] : '';
        if (!code) {
            const snMatch = pageText.match(/^(?:Item\s+|Sl\.?\s*No\.?\s*)?(\d{1,3})\b/i);
            if (snMatch) code = snMatch[1];
        }
        if (!code) continue;

        let qty = '';
        const qtyMatch = pageText.match(/\b(?:Qty|QTY|Quantity|Quantity Required)[:\s]+(\d+)\b/i);
        if (qtyMatch) {
            qty = qtyMatch[1];
        } else {
            const unitQtyMatch = pageText.match(new RegExp(`(\\d+)\\s+\\b${unitPatStr}\\b`, 'i')) || pageText.match(new RegExp(`\\b${unitPatStr}\\b\\s*[:\\s]+\\s*(\\d+)\\b`, 'i'));
            if (unitQtyMatch) qty = unitQtyMatch[1] || unitQtyMatch[2];
        }
        if (!qty) qty = '1';

        let unit = 'Nos';
        const unitMatch = pageText.match(unitRx);
        if (unitMatch) unit = unitMatch[1].replace(/\.$/, '');

        const priceMatches = [...pageText.matchAll(/(?:\$|AED|EUR|OMR|SR)\s*([\d,]+\.\d{2})|([\d,]+\.\d{2})\s*(?:USD|AED|EUR|OMR|SR)/gi)].map(m => m[1] || m[2]).filter(Boolean);
        if (!priceMatches.length) {
            const decMatches = [...pageText.matchAll(/\b([\d,]+\.\d{2})\b/g)].map(m => m[1]);
            priceMatches.push(...decMatches);
        }
        const uniquePrices = [...new Set(priceMatches)].map(p => parseFloat(p.replace(/,/g, ''))).filter(p => p > 0);
        let rate = '', amount = '';
        if (uniquePrices.length >= 2) {
            uniquePrices.sort((a, b) => a - b);
            rate = uniquePrices[0].toFixed(2);
            amount = uniquePrices[1].toFixed(2);
        } else if (uniquePrices.length === 1) {
            rate = uniquePrices[0].toFixed(2);
            const nQty = parseFloat(qty);
            amount = nQty > 1 ? (uniquePrices[0] * nQty).toFixed(2) : rate;
        }

        let lines = pageText.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !/Page\s+\d+|Object\s+number|Date\s*:/i.test(l));
        let codeLineIdx = lines.findIndex(l => l.includes(code));
        if (codeLineIdx === -1) codeLineIdx = 0;
        const descLines = lines.slice(codeLineIdx, codeLineIdx + 4);
        let desc = descLines.join(' ').slice(0, 300).replace(code, '').replace(/^\s*[:\-–—,\.]\s*/, '').trim();
        if (!desc) desc = `Product item ${code}`;

        rows.push(v12Row([code, desc, unit, qty, rate, amount], pIdx + 1));
    }

    if (rows.length < 3) return null;
    return {
        sheetName: 'BOQ Schedule',
        header,
        rows,
        columnCount: header.length,
        engineUsed: 'wordcom-vercel-v13.3-presentation-extractor',
        confidence: 0.90,
        extractionAudit: { rowCount: rows.length },
        serialAudit: { rowCount: rows.length }
    };
}

function parseUniversalDynamicTableV13(rawText) {
    const text = normText(rawText);
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    let header = null, headerIdx = -1, headerClasses = [];
    
    for (let i = 0; i < Math.min(lines.length, 100); i++) {
        const line = lines[i];
        if (line.includes('--- PAGE BREAK ---')) continue;
        let cols = line.split(/\t| {2,}/).map(c => c.trim()).filter(Boolean);
        if (cols.length < 3) continue;
        const classes = cols.map(classifyHeader);
        if (new Set(classes.filter(Boolean)).size >= 3) {
            header = cols; headerIdx = i; headerClasses = classes; break;
        }
    }
    if (!header) return null;
    const snIdx = headerClasses.indexOf('sn'), descIdx = headerClasses.indexOf('description'), qtyIdx = headerClasses.indexOf('qty'), unitIdx = headerClasses.indexOf('unit'), rateIdx = headerClasses.indexOf('rate'), amountIdx = headerClasses.indexOf('amount');
    if (descIdx === -1) return null;
    
    const rows = [];
    let pageNum = 1;
    for (let i = headerIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('--- PAGE BREAK ---')) { pageNum++; continue; }
        const cells = line.split(/\t| {2,}/).map(c => c.trim()).filter(Boolean);
        if (cells.length < 2) continue;
        const classes = cells.map(classifyHeader);
        if (classes.filter(c => c === 'amount').length > 0 && /grand\s*total|subtotal|vat/i.test(line)) continue;
        
        let sn = '', desc = '', qty = '', unit = 'Nos', rate = '', amount = '';
        if (cells.length === header.length) {
            if (snIdx !== -1) sn = cells[snIdx];
            if (descIdx !== -1) desc = cells[descIdx];
            if (qtyIdx !== -1) qty = cells[qtyIdx];
            if (unitIdx !== -1) unit = cells[unitIdx];
            if (rateIdx !== -1) rate = cells[rateIdx];
            if (amountIdx !== -1) amount = cells[amountIdx];
        } else {
            const numericCells = cells.filter(c => /^\d+(?:\.\d+)?$/.test(c.replace(/,/g, '').replace(/^[$\u20AC]/, '')));
            const uomCell = cells.find(c => classifyHeader(c) === 'unit');
            if (snIdx !== -1 && cells[0] && cells[0].length < 20 && /^[A-Z0-9.\-]+$/i.test(cells[0])) sn = cells[0];
            let longestCell = cells.reduce((a, b) => (a.length > b.length ? a : b), '');
            if (longestCell && longestCell.length > 5) desc = longestCell;
            if (uomCell) unit = uomCell;
            if (numericCells.length >= 3) { qty = numericCells[0]; rate = numericCells[1]; amount = numericCells[2]; }
            else if (numericCells.length === 2) { qty = numericCells[0]; amount = numericCells[1]; }
            else if (numericCells.length === 1) { qty = numericCells[0]; }
        }
        desc = desc.replace(/^\d+(?:\.\d+)*\s+/, '').trim();
        if (!desc || desc.length < 3 || /^(total|vat|grand)/i.test(desc)) continue;
        if (!qty && !amount && !rate) continue;
        rows.push(v12Row([sn, desc, unit, qty, rate, amount], pageNum));
    }
    if (rows.length < 3) return null;
    const finalHeader = header.map((h, idx) => normalizeHeaderName(h, idx));
    return { sheetName: 'Vendor Quote', header: finalHeader, rows, columnCount: finalHeader.length, engineUsed: 'wordcom-vercel-v13.3-universal-dynamic', confidence: 0.95, extractionAudit: { rowCount: rows.length }, serialAudit: { rowCount: rows.length } };
}

function assignRowPageNumbers(tables, directPdfText) {
    if (!tables || !tables.length || !directPdfText) return;
    const pages = directPdfText.split('\n--- PAGE BREAK ---\n').map(p => p.toLowerCase());
    for (const table of tables) {
        if (!table.rows || !table.rows.length) continue;
        const snIdx = canonicalIndex(table.header, 'sn');
        const descIdx = canonicalIndex(table.header, 'description');
        let lastKnownPageNum = 1;
        for (const row of table.rows) {
            const descVal = String(row.cells[descIdx]?.value || '').toLowerCase().trim();
            const snVal = String(row.cells[snIdx]?.value || '').toLowerCase().trim();
            if (descVal.length > 5) {
                let matchedPageIdx = pages.findIndex(p => p.includes(descVal) && (snVal ? p.includes(snVal) : true));
                if (matchedPageIdx === -1) matchedPageIdx = pages.findIndex(p => p.includes(descVal));
                if (matchedPageIdx === -1 && snVal.length > 2) matchedPageIdx = pages.findIndex(p => p.includes(snVal));
                if (matchedPageIdx !== -1) { row.pageNum = matchedPageIdx + 1; lastKnownPageNum = row.pageNum; }
                else { row.pageNum = lastKnownPageNum; }
            } else { row.pageNum = lastKnownPageNum; }
        }
    }
}

async function pairNativeImagesToFallbackRowsVercel(tables, layouts, sessionId, directPdfText = '') {
    if (!tables || !tables.length || !layouts || !layouts.length) return;
    
    const targetDir = process.env.VERCEL === '1'
        ? path.join(os.tmpdir(), 'extracted_images', sessionId)
        : path.join(process.cwd(), 'public', 'temp', 'extracted_images', sessionId);
        
    await fs.mkdir(targetDir, { recursive: true });
    
    for (const table of tables) {
        if (!table.rows || !table.rows.length) continue;
        
        const snIdx = canonicalIndex(table.header, 'sn');
        const descIdx = canonicalIndex(table.header, 'description');
        let imgIdx = table.header.findIndex(h => classifyHeader(h) === 'image');
        
        if (imgIdx === -1) continue;
        
        for (const layout of layouts) {
            const pageNum = layout.page;
            if (!layout.extractedImages || layout.extractedImages.length === 0) continue;
            
            const pageRows = table.rows.filter(r => r.pageNum === pageNum);
            if (!pageRows.length) continue;
            
            const pageHeight = layout.viewport?.height || 1000;
            const productImages = layout.extractedImages
                .filter(img => {
                    const ar = img.w / img.h;
                    const isProportional = ar >= 0.25 && ar <= 2.2;
                    const isNotMargin = img.y > 100 && img.y < (pageHeight - 100);
                    return img.w >= 30 && img.h >= 30 && isProportional && isNotMargin;
                })
                .sort((a, b) => a.y - b.y || a.x - b.x);
                
            if (!productImages.length) continue;
            const textItems = layout.textItems || [];
            const normalize = (s) => String(s || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
            const usedImageIndices = new Set();
            
            for (let i = 0; i < pageRows.length; i++) {
                const row = pageRows[i];
                const targetSN = normalize(row.cells[snIdx]?.value || '');
                const snMatch = textItems.find(it => normalize(it.str || it.text) === targetSN && normalize(it.str || it.text).length > 0 && it.x < 150);
                let descMatch = null;
                if (!snMatch) {
                    const descWords = (row.cells[descIdx]?.value || '').split(/\s+/).map(w => normalize(w)).filter(w => w.length > 3);
                    if (descWords.length > 0) {
                        const firstTargetWord = descWords[0];
                        descMatch = textItems.find((it, itIdx) => normalize(it.str || it.text) === firstTargetWord);
                    }
                }
                
                const anchorY = snMatch ? snMatch.y : (descMatch ? descMatch.y : null);
                const matchedImages = [];
                if (anchorY !== null) {
                    for (let j = 0; j < productImages.length; j++) {
                        if (usedImageIndices.has(j)) continue;
                        const img = productImages[j];
                        if (Math.abs((img.y + img.h / 2) - anchorY) < 150) matchedImages.push({ img, idx: j });
                    }
                }
                
                if (matchedImages.length > 0) {
                    matchedImages.sort((a, b) => a.img.x - b.img.x);
                    const rowImages = [];
                    for (const item of matchedImages) {
                        usedImageIndices.add(item.idx);
                        const filename = `page_${pageNum}_row_${i}_img_${item.idx}_${crypto.randomUUID().slice(0, 8)}.png`;
                        const destPath = path.join(targetDir, filename);
                        let imageUrl = `/temp/extracted_images/${sessionId}/${filename}`;
                        try {
                            if (item.img.buffer) await fs.writeFile(destPath, item.img.buffer);
                            else if (item.img.path && fsSync.existsSync(item.img.path)) await fs.copyFile(item.img.path, destPath);

                            if (supabase) {
                                try {
                                    const imgData = item.img.buffer || await fs.readFile(destPath);
                                    const uploadRes = await uploadToSupabase('assets', `extracted-images/${sessionId}/${filename}`, imgData, { contentType: 'image/png' });
                                    if (uploadRes?.url) imageUrl = uploadRes.url;
                                } catch (e) {}
                            }
                            rowImages.push({ url: imageUrl });
                        } catch (e) {}
                    }
                    if (rowImages.length > 0) {
                        row.cells[imgIdx].image = rowImages[0];
                        row.cells[imgIdx].images = rowImages;
                    }
                }
            }
        }
    }
}

function recoverUniversalV12RowsFromFullText($, imageMap, tables, directPdfText = '') {
    const rawText = directPdfText || String($ ? $('body').text() || '' : '').replace(/\u00a0/g, ' ');
    const candidates = [
        parseUniversalDynamicTableV13(rawText),
        parseGenericDynamicHeaderTableV13(rawText),
        parseBillNoV12(rawText),
        parseSerialFinancialV12(rawText),
        parseFfeCodeScheduleV12(rawText),
        parseTeknionCompactQuoteV12(rawText),
        parseSedusOfmlQuoteV12(rawText),
        parseNestedFurnitureScheduleV12(rawText),
        parseCivilHierarchicalBoqV12(rawText),
        parsePageItemTenderV12(rawText),
        parsePresentationCatalogPagesV13(rawText)
    ].filter(Boolean);
    return v12BestTable(candidates, tables);
}

function rowSerial(row, header) {
    const snIdx = canonicalIndex(header, 'sn');
    const raw = normText(row.cells?.[snIdx]?.value || '');
    if (/\d+\.\d+/.test(raw)) return null;
    const m = raw.match(/^\d+$/) || raw.match(/\b(\d{1,4})\b/);
    return m ? parseInt(m[0], 10) : null;
}
function buildSerialAudit(rows, header) {
    const serials = [], duplicates = [], seen = new Set();
    for (const row of rows || []) { const sn = rowSerial(row, header); if (sn === null) continue; if (seen.has(sn)) duplicates.push(sn); seen.add(sn); serials.push(sn); }
    if (!serials.length) return { foundSerials: [], missingSerials: [], duplicateSerials: [], sequenceConfidence: 0 };
    const min = Math.min(...serials), max = Math.max(...serials), missing = [];
    for (let i = min; i <= max; i++) if (!seen.has(i)) missing.push(i);
    const expectedCount = max - min + 1;
    const sequenceConfidence = expectedCount > 0 ? (expectedCount - missing.length - duplicates.length) / expectedCount : 0;
    return { expectedStart: min, expectedEnd: max, foundSerials: [...seen].sort((a, b) => a - b), missingSerials: missing, duplicateSerials: [...new Set(duplicates)].sort((a, b) => a - b), rowCount: rows.length, sequenceConfidence: Math.max(0, Math.min(1, sequenceConfidence)) };
}

function parseBillNoV12(rawText) {
    const text = normText(rawText);
    if (!/Bill\s+No\.?\s*\d+\.\d+/i.test(text)) return null;
    if (!/(Item\s+Code|Item\s+Name|Item\s+Description|Item\s+Details).{0,160}(UOM|Quant\s*ity|Qty).{0,100}(Rate|Amount)/i.test(text)) return null;
    const header = ['Item Code', 'Item Name', 'Item Description', 'Additional Information', 'UOM', 'Quantity', 'Rate', 'Amount'];
    const starts = [...text.matchAll(/Bill\s+No\.?\s*([0-9]+(?:\.[0-9]+)*)\s*/gi)];
    const rows = [];
    for (let i = 0; i < starts.length; i++) {
        const billNo = starts[i][1]; const start = starts[i].index + starts[i][0].length; const end = i + 1 < starts.length ? starts[i + 1].index : text.length;
        let seg = normText(text.slice(start, end)).replace(/\s+(?:Page\s+\d+\s+of\s+\d+|GSM\s+No\.:|Total\s+VAT\s+G\.Total|TOTAL\s+VAT\s+INCL\.).*$/i, ' ').trim();
        const tails = [...seg.matchAll(/\b(No\.?|Nos|EA|SET|PCS|Pcs|Lot|Each|M2|SQM|LM|Item)\b\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)/gi)];
        if (!tails.length) continue; const tail = tails[0];
        const uom = normText(tail[1]), qty = normText(tail[2]); let rate = normText(tail[3]), amount = normText(tail[4]);
        if (rate === billNo) { const next = (seg.slice(tail.index + tail[0].length).match(/\b[\d,]+(?:\.\d+)?\b/) || [])[0]; if (next) { rate = amount; amount = next; } }
        let before = normText(seg.slice(0, tail.index)); let info = ''; const idxInfo = Math.max(before.toLowerCase().lastIndexOf('item code'), before.toLowerCase().lastIndexOf('item no'));
        if (idxInfo >= 0) { info = before.slice(idxInfo).trim(); before = before.slice(0, idxInfo).trim(); }
        let name = '', desc = before; const mName = before.match(/^(LOOSE\s+(?:FURNITURE|EQUIPMENT|ITEM)\s*-\s*[^-]+|Furniture\s+and\s+fittings|Funiture\s+and\s+fiitings)\s*-?\s*(.*)$/i);
        if (mName) { name = normText(mName[1]); desc = normText(mName[2]); } else { const cm = before.match(/^([A-Z]{2,5}\d+[A-Z]?)\s*,?\s*(.*)$/); if (cm) { name = cm[1]; desc = cm[2]; } }
        rows.push(v12Row([`Bill No. ${billNo}`, name, desc || before, info, uom, qty, rate, amount], inferBillNoPageFromSerial(billNo)));
    }
    if (rows.length < 10) return null; const audit = buildBillNoAudit(rows);
    return { sheetName: 'BOQ Schedule', header, rows, columnCount: header.length, engineUsed: 'wordcom-vercel-v12-billno', confidence: 0.985, extractionAudit: audit, serialAudit: audit, supportsMultiImages: true };
}

function parseSerialFinancialV12(rawText) {
    const text = normText(rawText); if (!/(S\.?No|SL\.?No|SN|Sl\.No).{0,100}(Description|Discription|Item Description).{0,100}(Qty|Quantity).{0,90}(Rate|Unit Price|Amount)/i.test(text)) return null;
    const header = ['S.No', 'Image Reference', 'Description', 'Unit', 'QTY', 'Rate', 'Amount']; const starts = [...rawText.matchAll(/(?:^|\n)\s*(\d{1,3})\s+/g)].filter(m => Number(m[1]) > 0 && Number(m[1]) < 500); const rows = [];
    for (let i = 0; i < starts.length; i++) { const sn = starts[i][1]; const seg = normText(rawText.slice(starts[i].index, i + 1 < starts.length ? starts[i + 1].index : rawText.length)); const tail = [...seg.matchAll(/\b(SET|EA|No’s|Nos|No\.?|PCS|Pcs|Lot|Each|M2|SQM|LM|pc|set)\b\s+(\d[\d,]*)\s+([\d,]+(?:\.\d{2,3})|RATE\s+ONLY|EXCLUDED)\s+([\d,]+(?:\.\d{2,3})|RATE\s+ONLY|EXCLUDED)/gi)].pop(); if (!tail) continue; let desc = normText(seg.slice(0, tail.index)).replace(new RegExp('^' + sn + '\\s*'), '').replace(/^(CUSTOM|FAREAST|FAR\s+EAST|LOCAL\s*-?\s*UAE)\s+/i, ''); if (!desc || /TOTAL|VAT|TERMS|CONDITIONS/i.test(desc)) continue; rows.push(v12Row([sn, '', desc, tail[1], tail[2], tail[3], tail[4]], Math.max(1, Math.ceil(Number(sn) / 10)))); }
    if (rows.length < 8) return null; const audit = buildSerialAudit(rows, header); return { sheetName: 'BOQ Schedule', header, rows, columnCount: header.length, engineUsed: 'wordcom-vercel-v12-serial-financial', confidence: rows.length >= 20 ? 0.97 : 0.93, extractionAudit: audit, serialAudit: audit, supportsMultiImages: true };
}

function parseFfeCodeScheduleV12(rawText) { const text = normText(rawText); if (!/CODE\s+AREA\s+DESCRIPTION\s+IMAGE/i.test(text) && !/LEVEL\s+1.*TOTAL\s+QUANTITY\s+ITEM\s+UNIT\s+RATE/i.test(text)) return null; const header = ['Code', 'Area', 'Description', 'Level / Area Qty Split', 'Total Quantity', 'Unit', 'Unit Rate', 'Total Amount']; const starts = [...text.matchAll(/\b((?:FU|FF|RUG|P|TB|CH|AC|S|L|DR|CB|SF|CT|ST|WO|BOA|BIN|HOL|TRO|TAB|DES|CAB|MSF|SHE|LOC|DRA|RAC|WAR|BED|MAT|KETTLE|COFFEE\s+MACHINE|DISHWASHER|MINI\s+FRIDGE|MICROWAVE\s+OVEN)[A-Z0-9\-]*)\b/g)].filter(m => !/^(CODE|DATE|PROJECT)$/i.test(m[1])); const rows = []; for (let i = 0; i < starts.length; i++) { const code = normText(starts[i][1]); const seg = normText(text.slice(starts[i].index + starts[i][0].length, i + 1 < starts.length ? starts[i + 1].index : text.length)); const tail = seg.match(/((?:\d+\s+){0,6})(\d+)\s+(ITEM|pc|pcs|set|Nos|No\.?|EA)\s+([\d,]+\.\d{2,3}|ARTWORK|INCLUDED\s+IN\s+PS\s+RATE|RATE\s+ONLY)\s+([\d,]+\.\d{2,3}|RATE\s+ONLY|INCLUDED\s+IN\s+PS\s+RATE)?/i); if (!tail) continue; const desc = normText(seg.slice(0, tail.index)); if (!desc || /BILL NO\.|PROJECT SUBMISSION|DATE|REVISION/i.test(desc)) continue; rows.push(v12Row([code, '', desc, normText(tail[1]), tail[2], tail[3], tail[4], tail[5] || ''], Math.max(1, Math.ceil((rows.length + 1) / 4)))); } if (rows.length < 8) return null; return { sheetName: 'FFE Schedule', header, rows, columnCount: header.length, engineUsed: 'wordcom-vercel-v12-ffe-code-schedule', confidence: 0.955, extractionAudit: { rowCount: rows.length }, supportsMultiImages: true }; }
function parseTeknionCompactQuoteV12(rawText) { const text = normText(rawText); if (!/teknion/i.test(text) || !/Unit\s+Net\s+Price.*Ext\.?\s+Net\s+Price.*USD/i.test(text)) return null; const header = ['Item', 'Item Code', 'Description', 'QTY', 'Unit Net Price USD', 'Ext. Net Price USD']; const rx = /(\d{3})\.\s+([A-Z]{2}-[A-Z]{2}-[A-Z0-9]+)\s+Description:\s*(\d[\d,]*)\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})\s+(.+?)(?=\s+\d{3}\.\s+[A-Z]{2}-|\s+teknion\s+Page|\s+Total\s+Product\s+Net|$)/gi; const rows = []; let m; while ((m = rx.exec(text)) !== null) rows.push(v12Row([m[1], m[2], m[6], m[3], m[4], m[5]], Math.max(1, Math.ceil(rows.length / 6)))); if (rows.length < 10) return null; return { sheetName: 'Vendor Quote', header, rows, columnCount: header.length, engineUsed: 'wordcom-vercel-v12-teknion-quote', confidence: 0.965, extractionAudit: { rowCount: rows.length, totalProductNet: (text.match(/Total\s+Product\s+Net[^$]*\$([\d,]+\.\d{2})/i) || [])[1] || '' }, supportsMultiImages: true }; }
function parseSedusOfmlQuoteV12(rawText) { const text = normText(rawText); if (!/Article\s+code\s*\/\s*description/i.test(text) || !/Quantity\s+SP\/EUR\s*\(excl\.\s*VAT\).*TP\/EUR/i.test(text)) return null; const header = ['Hierarchy', 'Product Code', 'Product Description', 'Included Total EUR', 'Alternative', 'Section']; const rows = []; const rx = /Intermediate\s+total:\s+((?:FU-[A-Z]{2}-[A-Z0-9]+|[A-Z]{2})[^\d]*?)\s+([\d,]+\.\d{2})/gi; let activeSection = '', m; while ((m = rx.exec(text)) !== null) { const label = normText(m[1]); const code = (label.match(/FU-[A-Z]{2}-[A-Z0-9]+/) || [''])[0]; const desc = normText(label.replace(code, '')); if (/^[A-Z]{2}$/.test(label)) activeSection = label; rows.push(v12Row(['', code || label, desc || label, m[2], 'No', activeSection])); } if (rows.length < 15) return null; const netTotal = (text.match(/Net\s+Total\s+EUR\s+([\d,]+\.\d{2})/i) || text.match(/Net\s+Total[^\d]+([\d,]+\.\d{2})/i) || [])[1] || ''; return { sheetName: 'OFML Quote Summary', header, rows, columnCount: header.length, engineUsed: 'wordcom-vercel-v12-sedus-ofml', confidence: 0.985, extractionAudit: { rowCount: rows.length, netTotal }, supportsMultiImages: true }; }
function parseNestedFurnitureScheduleV12(rawText) { const text = normText(rawText); if (!/PRODUCT\s+DESCRIPTION\s+PRODUCT\s+DIMS/i.test(text) && !/UNIT\s+PRICE\s+IN\s+OMR\s+SUB\s+TOTAL/i.test(text)) return null; const header = ['Code', 'Description', 'Product Description', 'Product Dims', 'QTY', 'Unit Price OMR', 'Sub Total OMR']; const rx = /\b([A-Z]{2}\d{2}|WO\d{2}|ST\d{2}|CH\d{2}|SF\d{2}|TB\d{2})\b\s+([A-Z][A-Z \-/&]+?)\s+(.+?)\s+((?:STANDARD|Dia:?\s?\d+D?|\d{2,4}[W\*×].{0,80}?|MAIN\s+TABLE[:：].{0,80}?|\d{3,4}\*\d{2,4}\*?\d{0,4}H?))\s+(\d{1,4})\s+(?:0\.00|([\d,]+\.\d{2})\s+([\d,]+\.\d{2}))?/gi; const rows = []; let m; while ((m = rx.exec(text)) !== null) { const desc = normText(m[2]); if (/^(CODE|AREA|IMAGE|PRODUCT|OFFICE|FIRST|SECOND)$/i.test(desc)) continue; rows.push(v12Row([m[1], desc, m[3], m[4], m[5], m[6] || '0.00', m[7] || '0.00'])); } if (rows.length < 8) return null; return { sheetName: 'Furniture Schedule', header, rows, columnCount: header.length, engineUsed: 'wordcom-vercel-v12-nested-furniture', confidence: 0.945, extractionAudit: { rowCount: rows.length }, supportsMultiImages: true }; }
function parseCivilHierarchicalBoqV12(rawText) {
    const text = normText(rawText);
    const hasTotal = /Grand[-\u2010‐\u2013\u2014\s]*Total|VAT\s*\(/i.test(text);
    if (!hasTotal) return null;
    const header = ['Item No', 'Description', 'Unit', 'Qty', 'Unit Cost', 'Total Cost'];
    const unitPatStr = '(job|m3|M3|M\\.L\\.?|ML|No\\.?|NO|Nos|m²|m2|SQM|LM|M\\.T)';
    const stopRx = /\b(Total\s+VAT|Grand[-\u2010‐\u2013\u2014\s]*Total|VAT\s*\()/im;
    let workText = text;
    const stopMatch = workText.match(stopRx);
    if (stopMatch && stopMatch.index) workText = workText.slice(0, stopMatch.index);
    const candidateRx = /\b(\d{1,3}(?:\.\d{1,3})+)\b/g;
    const allCandidates = [...workText.matchAll(candidateRx)].map(m => ({ id: m[1], index: m.index, parts: m[1].split('.').map(Number) }));
    const filteredCandidates = allCandidates.filter(c => {
        const before = workText.slice(Math.max(0, c.index - 15), c.index);
        const after = workText.slice(c.index + c.id.length, c.index + c.id.length + 15);
        if (/\(\s*$/.test(before) && /^\s*(m|mm|cm|M|ft|in|kg|%)/.test(after)) return false;
        return true;
    });
    function isLikelyItemNo(cand, allCands) {
        if (cand.parts.length >= 3) return true;
        const parent = cand.parts[0];
        const child = cand.parts[1];
        if (child > 20 || parent > 50) return false;
        const siblings = allCands.filter(c => c.id !== cand.id && c.parts.length >= 2 && c.parts[0] === parent && Math.abs(c.parts[1] - child) <= 2 && Math.abs(c.index - cand.index) < 1500);
        if (siblings.length >= 1) return true;
        const nearby = workText.slice(Math.max(0, cand.index - 500), cand.index);
        return new RegExp(`(?:^|\\s)${parent}\\s+[A-Z]`, 'm').test(nearby) && child <= 5;
    }
    const validItems = filteredCandidates.filter(c => isLikelyItemNo(c, filteredCandidates));
    if (validItems.length < 3) return null;
    const unitCount = (workText.match(new RegExp(`\\b${unitPatStr}\\b`, 'gi')) || []).length;
    if (unitCount < 2) return null;
    const rows = [];
    for (let i = 0; i < validItems.length; i++) {
        const item = validItems[i];
        const segStart = item.index + item.id.length;
        const segEnd = i + 1 < validItems.length ? validItems[i + 1].index : workText.length;
        const seg = normText(workText.slice(segStart, segEnd));
        if (!seg || seg.length < 3) continue;
        const unitQtyRx = new RegExp(`(.+?)\\s+\\b${unitPatStr}\\b\\s+(\\d+(?:\\.\\d+)?)(?:\\s+([\\d,]+(?:\\.\\d+)?))?(?:\\s+([\\d,]+(?:\\.\\d+)?))?`, 'i');
        const match = seg.match(unitQtyRx);
        if (!match) continue;
        let desc = normText(match[1]).replace(/^\d+(?:\.\d+)*\s+/, '').replace(/^[""]|[""]$/g, '');
        if (!desc || desc.length < 3 || /^(total|vat|grand)/i.test(desc)) continue;
        const unit = match[2].replace(/\.$/, '');
        const qty = match[3];
        let unitCost = match[4] || '', totalCost = match[5] || '';
        const sectionParents = new Set(validItems.map(v => v.parts[0]));
        if (unitCost && /^\d{1,2}$/.test(unitCost) && sectionParents.has(parseInt(unitCost, 10))) unitCost = '';
        if (totalCost && /^\d{1,2}$/.test(totalCost) && sectionParents.has(parseInt(totalCost, 10))) totalCost = '';
        if (totalCost && /^\d+\.\d+$/.test(totalCost) && validItems.some(v => v.id === totalCost)) totalCost = '';
        rows.push(v12Row([item.id, desc, unit, qty, unitCost, totalCost]));
    }
    if (rows.length < 3) return null;
    return { sheetName: 'Civil BOQ', header, rows, columnCount: header.length, engineUsed: 'wordcom-vercel-v12-civil-hierarchical', confidence: 0.94, extractionAudit: { rowCount: rows.length }, supportsMultiImages: false };
}
function parsePageItemTenderV12(rawText) { const text = normText(rawText); if (!/Page\s+Item\s+Description\s+Uom\s+Quantity\s+Rate\s+Amount\s+Total/i.test(text)) return null; const header = ['Page', 'Item', 'Description', 'UOM', 'Quantity', 'Rate', 'Amount']; const rx = /\b(\d{1,3})\s+(\d{1,3})\s+(.+?)\s+\b(Item|No|m²|m2|m|Tonnes)\s+([\d,]+\.\d{2})\s+([\d, ]+\.\d{2})(?:\s+([\d, ]+\.\d{2}))?/gi; const rows = []; let m; while ((m = rx.exec(text)) !== null) rows.push(v12Row([m[1], m[2], m[3], m[4], m[5], m[6], m[7] || ''])); if (rows.length < 8) return null; return { sheetName: 'Tender BOQ', header, rows, columnCount: header.length, engineUsed: 'wordcom-vercel-v12-page-item-tender', confidence: 0.935, extractionAudit: { rowCount: rows.length }, supportsMultiImages: false }; }

function inferBillNoPageFromSerial(serialText, rowsPerPage = 12) {
    const n = parseFloat(String(serialText || '').split('.').pop() || '1');
    if (!Number.isFinite(n) || n <= 0) return 1;
    return Math.max(1, Math.ceil(n / Math.max(1, rowsPerPage)));
}
function buildBillNoAudit(rows) {
    const nums = [];
    for (const row of rows || []) {
        const raw = row.cells?.[0]?.value || '';
        const m = String(raw).match(/(\d+)\.(\d+)/);
        if (m) nums.push(parseInt(m[2], 10));
    }
    const seen = new Set(nums);
    const min = nums.length ? Math.min(...nums) : 0;
    const max = nums.length ? Math.max(...nums) : 0;
    const missing = [];
    for (let i = min; i <= max; i++) if (!seen.has(i)) missing.push(i);
    const duplicates = nums.filter((n, i) => nums.indexOf(n) !== i);
    return { expectedStart: min, expectedEnd: max, foundSerials: [...seen].sort((a, b) => a - b), missingSerials: missing, duplicateSerials: [...new Set(duplicates)].sort((a, b) => a - b), rowCount: rows.length, sequenceConfidence: max >= min && max > 0 ? Math.max(0, Math.min(1, (max - min + 1 - missing.length - duplicates.length) / (max - min + 1))) : 0 };
}


