// Design & Build export suite, made in BOQ Flow once a render is approved: the package
// Design & Build lays out (BOQ, drawings, presentation, FF&E, renders, model, reports),
// filled with the offer's real products and the validated render, and branded with the
// company profile and the project details set in BOQ Flow. The offer, BOQ and submittals
// come from BOQ Flow's own generators when its table is open. Everything is made in the
// browser; nothing is uploaded.

import { extractImageUrl, loadExportImageData } from '../../utils/urlUtils';
import { fixArabic, hasArabic, loadArabicFont } from '../../utils/arabicPdfUtils';
import { offerColumns } from './designBuildStore';

/** The package, folder by folder (Design & Build's full-suite structure). */
export const SUITE_GROUPS = [
    { key: 'boq', folder: 'BOQ', label: 'BOQ', files: ['Offer PDF', 'Offer Excel'] },
    { key: 'submittals', folder: 'Submittals', label: 'Submittals', files: ['MAS', 'MIR', 'WIR', 'Delivery note'] },
    { key: 'drawings', folder: 'Drawings', label: 'Drawings', files: ['Source_Drawing.pdf', 'Extracted_Plan.png', 'Annotated_Plan.png'] },
    { key: 'presentation', folder: 'Presentation', label: 'Presentation', files: ['Design_and_Build_Presentation.pptx'] },
    { key: 'ffe', folder: 'FF&E', label: 'FF&E', files: ['FF&E_Schedule.xlsx', 'Mood_Board.pdf', 'Catalogue_Links.xlsx'] },
    { key: 'renders', folder: 'Renders', label: 'Renders', files: ['Perspective_01.png'] },
    { key: 'model', folder: 'Model', label: '3D model', files: ['Pascal_Scene.json'] },
    { key: 'reports', folder: 'Reports', label: 'Reports', files: ['Extraction_Audit.pdf'] },
];

const NAVY = '0F172A';
const INK = '1E293B';
const MUTED = '64748B';
const ACCENT = '2D66F6';
const LINE = 'E2E8F0';
const SOFT = 'F1F5F9';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const DEFAULT_HEADER = ['S.No', 'Image', 'Description', 'Brand', 'Model', 'Qty', 'Unit', 'Rate', 'Amount'];

const VIEW_LABEL = { cutaway: '3D cutaway', 'eye-level': 'Eye-level view', interior: 'Interior view' };
const STYLE_LABEL = { daylight: 'Daylight', 'golden-hour': 'Golden hour', overcast: 'Overcast', dusk: 'Dusk', clay: 'Clay model' };

// ---------------------------------------------------------------- helpers

export function projectTitle(planName) {
    return String(planName || '').replace(/\.pdf$/i, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim() || 'Design & Build project';
}

export function projectSlug(planName) {
    // Letters of any script (an Arabic project name stays readable in the file name).
    return projectTitle(planName).replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'Project';
}

const rgb = (hex) => {
    const h = String(hex || '').replace('#', '');
    return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
};
const argb = (hex) => `FF${String(hex || '').replace('#', '').toUpperCase()}`;
const num = (v) => {
    const n = parseFloat(String(v ?? '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
};
const money = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const productLabel = (p) => [p.brand, p.model].filter(Boolean).join(' · ') || String(p.description || '').slice(0, 60);
const cellValue = (row, i) => {
    if (!(i >= 0)) return undefined;
    const c = row?.cells?.[i];
    return c && typeof c === 'object' ? c.value : c;
};
const clip = (s, n) => {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const pct = (score) => `${Math.round((Number(score) || 0) * 100)}%`;
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
/** Document properties: pptxgenjs writes some of them unescaped, so no XML special characters. */
const metaText = (s) => clean(s).replace(/&/g, 'and').replace(/[<>"']/g, '');

/** The project's issue date (yyyy-mm-dd from the project details) as "24 November 2026". */
function issueDate(value) {
    const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date();
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function dataUrlToBlob(dataUrl) {
    const comma = dataUrl.indexOf(',');
    const mime = (dataUrl.slice(0, comma).match(/^data:([^;,]+)/) || [])[1] || 'application/octet-stream';
    const bin = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

const extOf = (dataUrl) => (/^data:image\/png/i.test(dataUrl) ? 'png' : /^data:image\/webp/i.test(dataUrl) ? 'webp' : 'jpg');

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('A picture could not be read.'));
        img.src = src;
    });
}

function canvasOf(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
}

/** The whole picture as a JPEG, at most `maxW` wide (white behind transparency). */
async function asJpeg(dataUrl, maxW = 2000, quality = 0.88) {
    const img = await loadImage(dataUrl);
    const s = Math.min(1, maxW / img.naturalWidth);
    const c = canvasOf(img.naturalWidth * s, img.naturalHeight * s);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return { dataUrl: c.toDataURL('image/jpeg', quality), width: c.width, height: c.height };
}

/** The picture cropped to fill `aspect` (w / h), as a JPEG at most `maxW` wide. */
async function coverJpeg(dataUrl, aspect, maxW = 2000, quality = 0.88) {
    const img = await loadImage(dataUrl);
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    let sw = iw;
    let sh = iw / aspect;
    if (sh > ih) {
        sh = ih;
        sw = ih * aspect;
    }
    const w = Math.min(maxW, sw);
    const c = canvasOf(w, w / aspect);
    c.getContext('2d').drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, c.width, c.height);
    return { dataUrl: c.toDataURL('image/jpeg', quality), width: c.width, height: c.height };
}

function canvasBlob(c, type = 'image/png', quality) {
    return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode a picture.'))), type, quality));
}

async function asPngBlob(dataUrl) {
    const img = await loadImage(dataUrl);
    const c = canvasOf(img.naturalWidth, img.naturalHeight);
    c.getContext('2d').drawImage(img, 0, 0);
    return canvasBlob(c, 'image/png');
}

/** A `w x h` picture fitted inside `box`, centred. */
function contain(w, h, box) {
    const s = Math.min(box.w / w, box.h / h);
    return { x: box.x + (box.w - w * s) / 2, y: box.y + (box.h - h * s) / 2, w: w * s, h: h * s };
}

/** A `w x h` picture fitted inside `box`, kept against its right (or left) edge and centred upright. */
function containAt(w, h, box, side = 'right') {
    const f = contain(w, h, box);
    return { ...f, x: side === 'right' ? box.x + box.w - f.w : box.x };
}

/** A logo as a PNG at most `maxW` x `maxH` (transparency kept), or null. */
async function rasterLogo(src, maxW = 1200, maxH = 480) {
    if (!src) return null;
    try {
        const img = await loadImage(src);
        // An SVG without a size of its own reports 0 x 0.
        const iw = img.naturalWidth || 600;
        const ih = img.naturalHeight || 200;
        const s = Math.min(1, maxW / iw, maxH / ih);
        const c = canvasOf(iw * s, ih * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        return { dataUrl: c.toDataURL('image/png'), width: c.width, height: c.height };
    } catch {
        return null;
    }
}

/** A light logo on a navy badge, so it reads on white pages too. */
async function logoBadge(logo) {
    const img = await loadImage(logo.dataUrl);
    const pad = Math.round(Math.max(logo.height * 0.35, 16));
    const c = canvasOf(logo.width + pad * 2, logo.height + pad * 2);
    const g = c.getContext('2d');
    const r = Math.min(c.height / 2, pad * 1.2);
    g.fillStyle = `#${NAVY}`;
    g.beginPath();
    g.moveTo(r, 0);
    g.arcTo(c.width, 0, c.width, c.height, r);
    g.arcTo(c.width, c.height, 0, c.height, r);
    g.arcTo(0, c.height, 0, 0, r);
    g.arcTo(0, 0, c.width, 0, r);
    g.closePath();
    g.fill();
    g.drawImage(img, pad, pad, logo.width, logo.height);
    return { dataUrl: c.toDataURL('image/png'), width: c.width, height: c.height };
}

/**
 * The company and client logos, ready for each kind of page: `onDark` for the navy bands
 * and render slides, `onLight` for white pages (a light logo goes on a navy badge there).
 */
async function prepareLogos(ctx) {
    const b = ctx.input.brand || {};
    const [original, white, client] = await Promise.all([
        rasterLogo(b.logo),
        rasterLogo(b.logoWhite || b.logo),
        rasterLogo(ctx.input.project?.clientLogo, 900, 360),
    ]);
    const onLight = original && b.logoIsLight ? await logoBadge(original).catch(() => original) : original;
    ctx.logo = { onDark: white || original, onLight, client };
}

/**
 * An Office file (.pptx, .xlsx) repacked without folder entries: the libraries write
 * them, and cloud editors (OneDrive, SharePoint) refuse to open such packages.
 */
async function officeFile(data, type) {
    const JSZip = (await import('jszip')).default;
    const src = await JSZip.loadAsync(data);
    const out = new JSZip();
    const names = Object.keys(src.files).filter((n) => !src.files[n].dir);
    names.sort((a, b) => (a === '[Content_Types].xml' ? -1 : b === '[Content_Types].xml' ? 1 : 0));
    for (const n of names) out.file(n, await src.files[n].async('uint8array'), { createFolders: false });
    return out.generateAsync({ type: 'blob', mimeType: type, compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

async function pool(items, size, fn) {
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            await fn(items[i], i);
        }
    };
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

function detectCurrency(tables) {
    for (const t of tables || []) {
        for (const h of t?.header || []) {
            const text = String(h || '');
            if (!/amount|total|rate|price/i.test(text)) continue;
            const m = text.match(/\(([A-Z]{3})\)/) || text.match(/\b([A-Z]{3})\b/);
            if (m) return m[1];
        }
    }
    return '';
}

// ---------------------------------------------------------------- context

function suiteContext(input) {
    const planName = input.plan?.name || input.artifacts?.planName || '';
    const products = input.products || [];
    const placed = new Map((input.furnished?.products || []).map((m) => [m.productId, Number(m.placed) || 0]));
    const colours = new Map((input.furnished?.colours || []).map((c) => [c.id, c]));
    const renders = input.renders || [];
    const approved = renders.find((r) => r.id === input.approvedRenderId) || null;
    const views = new Map((input.artifacts?.views || []).filter((v) => v?.image).map((v) => [v.kind, v.image]));
    const tables = input.offer?.tables?.length ? input.offer.tables : null;
    const cache = new Map();
    const picture = (ref, maxWidth = 640) => {
        const url = extractImageUrl(ref);
        if (!url) return Promise.resolve(null);
        const key = `${url}|${maxWidth}`;
        if (!cache.has(key)) {
            cache.set(key, loadExportImageData(url, { maxWidth, format: 'image/jpeg', quality: 0.86 }).catch(() => null));
        }
        return cache.get(key);
    };
    const ordered = [...products].sort((a, b) => (placed.get(b.id) || 0) - (placed.get(a.id) || 0));
    // The project details and company profile set in BOQ Flow name and brand every file.
    const proj = input.project || {};
    const brand = input.brand || {};
    const title = clean(proj.projectName) || projectTitle(planName);
    const client = clean(proj.clientName);
    const company = clean(brand.company) || 'BOQ Flow';
    return {
        input,
        planName,
        title,
        slug: projectSlug(title),
        date: issueDate(proj.issueDate),
        client,
        company,
        website: clean(brand.website),
        project: {
            number: clean(proj.projectNumber),
            location: clean(proj.locationZone),
            consultant: proj.includeConsultant === false ? '' : clean(proj.consultant),
            contractor: proj.includeContractor === false ? '' : clean(proj.contractor),
            revision: clean(proj.revision),
        },
        // "Project · Client" for subtitles and footers.
        heading: [title, client].filter(Boolean).join(' · '),
        logo: { onDark: null, onLight: null, client: null },
        products: ordered,
        placedOf: (p) => placed.get(p.id) || 0,
        colourOf: (p) => colours.get(p.id) || null,
        renders: approved ? [approved, ...renders.filter((r) => r !== approved)] : renders,
        approved,
        // The plan from the top with each product's photo in place, and without them.
        planView: views.get('top') || views.get('current') || null,
        planPlain: views.get('top-plain') || views.get('top') || views.get('current') || null,
        placements: Array.isArray(input.artifacts?.placements) ? input.artifacts.placements : [],
        overview: views.get('overview') || views.get('current') || null,
        tables,
        currency: detectCurrency(tables),
        counts: input.artifacts?.counts || input.counts || null,
        picture,
    };
}

/** Pictures of every product, loaded a few at a time (a list in product order). */
async function productPictures(ctx, maxWidth = 640) {
    const out = new Array(ctx.products.length).fill(null);
    await pool(ctx.products, 6, async (p, i) => {
        out[i] = p.imageRef || p.imageUrl ? await ctx.picture(p.imageRef || p.imageUrl, maxWidth) : null;
    });
    return out;
}

// ---------------------------------------------------------------- BOQ

function styleHeaderRow(row, fill = NAVY) {
    row.eachCell((cell) => {
        cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(fill) } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = { bottom: { style: 'thin', color: { argb: argb(LINE) } } };
    });
    row.height = 24;
}

function printWide(ws) {
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
}

/**
 * Title rows of a sheet: the project; the client, project number and what the sheet is;
 * who prepared it. The company logo goes on the right once the columns are sized (sheetLogo).
 */
function sheetTitle(ws, ctx, subtitle, width) {
    printWide(ws);
    ws.mergeCells(1, 1, 1, width);
    ws.getCell(1, 1).value = ctx.title;
    ws.getCell(1, 1).font = { bold: true, size: 15, color: { argb: argb(NAVY) } };
    ws.getCell(1, 1).alignment = { vertical: 'middle' };
    ws.getRow(1).height = 28;
    ws.mergeCells(2, 1, 2, width);
    ws.getCell(2, 1).value = [ctx.client ? `Client: ${ctx.client}` : '', ctx.project.number ? `Project no. ${ctx.project.number}` : '', subtitle].filter(Boolean).join('  ·  ');
    ws.getCell(2, 1).font = { size: 10, color: { argb: argb(MUTED) } };
    ws.mergeCells(3, 1, 3, width);
    ws.getCell(3, 1).value = `Prepared by ${ctx.company}${ctx.website ? `  ·  ${ctx.website}` : ''}`;
    ws.getCell(3, 1).font = { size: 9, italic: true, color: { argb: argb(MUTED) } };
}

/** The company logo at the top right of a sheet, over its last columns (once the columns are sized). */
function sheetLogo(wb, ws, ctx, width) {
    const logo = ctx.logo.onLight;
    if (!logo?.dataUrl) return;
    const colPx = (i) => Math.round((ws.getColumn(i + 1).width || 9) * 7 + 5);
    let total = 0;
    for (let i = 0; i < width; i++) total += colPx(i);
    const s = Math.min(180 / logo.width, 46 / logo.height);
    const w = logo.width * s;
    const h = logo.height * s;
    let x = Math.max(0, total - w - 6);
    let col = 0;
    while (col < width - 1 && x >= colPx(col)) {
        x -= colPx(col);
        col++;
    }
    const id = wb.addImage({ base64: logo.dataUrl.split(',')[1], extension: 'png' });
    ws.addImage(id, { tl: { col: col + x / colPx(col), row: 0.2 }, ext: { width: w, height: h }, editAs: 'absolute' });
}

async function embedPicture(wb, ws, ctx, ref, col, row, size = 56) {
    const img = ref ? await ctx.picture(ref, 240) : null;
    if (!img?.dataUrl) return false;
    const id = wb.addImage({ base64: img.dataUrl.split(',')[1], extension: 'jpeg' });
    const s = Math.min(size / img.width, size / img.height);
    ws.addImage(id, { tl: { col: col - 1 + 0.12, row: row - 1 + 0.12 }, ext: { width: img.width * s, height: img.height * s }, editAs: 'oneCell' });
    return true;
}

async function buildDetailedBoq(ctx) {
    if (!ctx.tables) return null;
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = ctx.company;
    wb.created = new Date();
    const used = new Set();
    for (let t = 0; t < ctx.tables.length; t++) {
        const table = ctx.tables[t];
        let name = String(table.sheetName || `BOQ ${t + 1}`).replace(/[\\/*?:[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28) || `BOQ ${t + 1}`;
        if (used.has(name.toLowerCase())) name = `${name.slice(0, 24)} ${t + 1}`;
        used.add(name.toLowerCase());
        const ws = wb.addWorksheet(name, { properties: { tabColor: { argb: argb(ACCENT) } } });
        const header = (table.header?.length ? table.header : DEFAULT_HEADER).map((h) => String(h || '').replace(/\s+/g, ' ').trim());
        const width = header.length;
        const imgCol = header.findIndex((h) => /image|photo|picture/i.test(h));
        const qtyCol = header.findIndex((h) => /qty|quantity/i.test(h));
        const rateCol = header.findIndex((h) => /rate|price/i.test(h));
        const amountCol = header.findIndex((h) => /amount|total/i.test(h));
        const descCol = header.findIndex((h) => /description|item|product/i.test(h));
        sheetTitle(ws, ctx, `Detailed BOQ — ${ctx.input.offer?.title || 'applied offer'} · ${ctx.date}`, width);
        header.forEach((_, i) => {
            ws.getColumn(i + 1).width = i === descCol ? 60 : i === imgCol ? 12 : i === 0 ? 8 : 16;
        });
        sheetLogo(wb, ws, ctx, width);
        const head = ws.getRow(4);
        head.values = header;
        styleHeaderRow(head);
        let r = 5;
        let total = 0;
        for (const row of table.rows || []) {
            if (!row || !Array.isArray(row.cells)) continue;
            const option = !!row.isOptionRow;
            const values = header.map((_, i) => {
                if (i === imgCol) return '';
                const v = cellValue(row, i);
                if (i === qtyCol || i === rateCol || i === amountCol) {
                    const n = num(v);
                    return String(v ?? '').trim() === '' ? '' : n;
                }
                return v == null ? '' : String(v);
            });
            if (option && descCol >= 0) values[descCol] = `Option — ${values[descCol]}`;
            const xr = ws.getRow(r);
            xr.values = values;
            xr.eachCell({ includeEmpty: true }, (cell, c) => {
                cell.alignment = { vertical: 'middle', wrapText: c - 1 === descCol, horizontal: c - 1 === descCol ? 'left' : 'center' };
                cell.font = { size: 9.5, italic: option, color: { argb: argb(option ? MUTED : INK) } };
                cell.border = { bottom: { style: 'hair', color: { argb: argb(LINE) } } };
                if (c - 1 === rateCol || c - 1 === amountCol) cell.numFmt = '#,##0.00';
            });
            if (imgCol >= 0) {
                const imageCell = row.cells[imgCol] || {};
                const ref = extractImageUrl(imageCell.image) || extractImageUrl(imageCell.images?.[0]);
                if (await embedPicture(wb, ws, ctx, ref, imgCol + 1, r)) xr.height = 48;
            }
            if (!option && amountCol >= 0) total += num(cellValue(row, amountCol));
            r++;
        }
        if (amountCol >= 0) {
            const tr = ws.getRow(r + 1);
            tr.getCell(Math.max(1, amountCol)).value = `Total${ctx.currency ? ` (${ctx.currency})` : ''}`;
            tr.getCell(amountCol + 1).value = total;
            tr.getCell(amountCol + 1).numFmt = '#,##0.00';
            tr.eachCell((cell) => {
                cell.font = { bold: true, size: 10.5, color: { argb: argb(NAVY) } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(SOFT) } };
            });
        }
        ws.views = [{ state: 'frozen', ySplit: 4 }];
    }
    return officeFile(await wb.xlsx.writeBuffer(), XLSX_TYPE);
}

async function pdfKit() {
    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    return { jsPDF, autoTable };
}

/**
 * A new PDF for the package. Arabic names and lines need a font jsPDF does not have: it
 * is added when the document's text has any (`texts`: what the document will print).
 */
async function newPdf(ctx, options, texts = []) {
    const { jsPDF, autoTable } = await pdfKit();
    const doc = new jsPDF(options);
    const wantsArabic = [ctx.title, ctx.client, ctx.company, ...texts].some(hasArabic);
    doc.arabicFont = wantsArabic ? await loadArabicFont(doc) : false;
    return { doc, autoTable };
}

/** Text in the right font: Arabic is shaped and set in Almarai when the document has it. */
function pdfText(doc, text, x, y, options = {}, weight = 'normal') {
    const value = String(text ?? '');
    if (doc.arabicFont && hasArabic(value)) {
        doc.setFont('Almarai', weight);
        doc.text(fixArabic(value), x, y, options);
    } else {
        doc.setFont('helvetica', weight);
        doc.text(value, x, y, options);
    }
}

/** autoTable hook: cells with Arabic in Almarai, shaped. */
function arabicCells(doc) {
    return (data) => {
        if (!doc.arabicFont) return;
        const raw = data.cell.raw && typeof data.cell.raw === 'object' ? data.cell.raw.content : data.cell.raw;
        if (!hasArabic(raw)) return;
        data.cell.styles.font = 'Almarai';
        data.cell.text = (Array.isArray(data.cell.text) ? data.cell.text : [String(raw)]).map((t) => fixArabic(t));
    };
}

/** Logo `logo` fitted in `box` (mm) on `doc`, against the box's right edge. */
function pdfLogo(doc, logo, box) {
    if (!logo?.dataUrl) return 0;
    const f = containAt(logo.width, logo.height, box, 'right');
    doc.addImage(logo.dataUrl, 'PNG', f.x, f.y, f.w, f.h);
    return f.w;
}

/** Navy band with the document title, the company logo, the project, client and date. */
function pdfHeader(doc, title, ctx) {
    const w = doc.internal.pageSize.getWidth();
    doc.setFillColor(...rgb(NAVY));
    doc.rect(0, 0, w, 30, 'F');
    doc.setFillColor(...rgb(ACCENT));
    doc.rect(0, 30, w, 1.2, 'F');
    // The company's logo on the right, or its name.
    const logoW = pdfLogo(doc, ctx.logo.onDark, { x: w - 14 - 52, y: 6, w: 52, h: 18 });
    if (!logoW) {
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(10);
        pdfText(doc, clip(ctx.company, 40), w - 14, 17, { align: 'right' }, 'bold');
    }
    const textW = w - 28 - (logoW ? logoW + 6 : 50);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(17);
    pdfText(doc, title, 14, 14, {}, 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(203, 213, 225);
    pdfText(doc, clip(`${ctx.heading} · ${ctx.date}`, Math.max(40, Math.floor(textW / 1.75))), 14, 22);
    return 40;
}

function pdfFooters(doc, ctx) {
    const pages = doc.internal.getNumberOfPages();
    const w = doc.internal.pageSize.getWidth();
    const h = doc.internal.pageSize.getHeight();
    for (let p = 1; p <= pages; p++) {
        doc.setPage(p);
        doc.setDrawColor(...rgb(LINE));
        doc.setLineWidth(0.2);
        doc.line(14, h - 11, w - 14, h - 11);
        doc.setFontSize(7.5);
        doc.setTextColor(...rgb(MUTED));
        pdfText(doc, clip(`${ctx.heading} — ${ctx.company}`, 90), 14, h - 7);
        pdfText(doc, `Page ${p} of ${pages}`, w - 14, h - 7, { align: 'right' });
    }
}

const TABLE_STYLE = {
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1.8, lineColor: rgb(LINE), lineWidth: 0.1, textColor: rgb(INK) },
    headStyles: { fillColor: rgb(NAVY), textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14, bottom: 16 },
};

/** TABLE_STYLE for `doc`, with Arabic cells handled. */
const tableStyle = (doc) => ({ ...TABLE_STYLE, didParseCell: arabicCells(doc) });

function sectionTitle(doc, text, y) {
    if (y > doc.internal.pageSize.getHeight() - 40) {
        doc.addPage();
        y = 20;
    }
    doc.setFontSize(11.5);
    doc.setTextColor(...rgb(NAVY));
    pdfText(doc, text, 14, y, {}, 'bold');
    return y + 4;
}

async function buildBoqSummary(ctx) {
    if (!ctx.tables) return null;
    const lineTexts = ctx.tables.flatMap((t) => (t.rows || []).map((r) => (r?.cells || []).map((c) => (c && typeof c === 'object' ? c.value : c)).join(' ')));
    const { doc, autoTable } = await newPdf(ctx, { orientation: 'portrait', unit: 'mm', format: 'a4' }, lineTexts);
    let y = pdfHeader(doc, 'BOQ Summary', ctx);
    const cur = ctx.currency ? ` (${ctx.currency})` : '';
    const sections = new Map();
    const lines = [];
    let total = 0;
    for (const table of ctx.tables) {
        const col = offerColumns(table);
        for (const row of table.rows || []) {
            if (!row || row.isOptionRow || row.isSetSubItem || !Array.isArray(row.cells)) continue;
            const amount = num(cellValue(row, col.amount));
            const key = row.sectionLabel || row.sectionCategory || table.sheetName || 'General';
            const s = sections.get(key) || { lines: 0, amount: 0 };
            s.lines++;
            s.amount += amount;
            sections.set(key, s);
            total += amount;
            lines.push([
                // No reference column (a plan analysis): number the lines.
                col.sn >= 0 ? String(cellValue(row, col.sn) ?? '') : String(lines.length + 1),
                clip(cellValue(row, col.description), 90),
                clip(cellValue(row, col.brand) || row.selectedBrand, 24),
                clip(cellValue(row, col.model) || row.selectedModel, 28),
                String(cellValue(row, col.qty) ?? ''),
                String(cellValue(row, col.unit) ?? ''),
                money(num(cellValue(row, col.rate))),
                money(amount),
            ]);
        }
    }
    y = sectionTitle(doc, 'By section', y);
    autoTable(doc, {
        ...tableStyle(doc),
        startY: y,
        head: [['Section', 'Lines', `Amount${cur}`]],
        body: [...sections.entries()].map(([k, s]) => [clip(k, 80), String(s.lines), money(s.amount)]),
        foot: [['Total', { content: String(lines.length), styles: { halign: 'center' } }, { content: money(total), styles: { halign: 'right' } }]],
        footStyles: { fillColor: rgb(SOFT), textColor: rgb(NAVY), fontStyle: 'bold' },
        columnStyles: { 1: { halign: 'center', cellWidth: 20 }, 2: { halign: 'right', cellWidth: 40 } },
    });
    y = doc.lastAutoTable.finalY + 10;
    y = sectionTitle(doc, 'Lines', y);
    autoTable(doc, {
        ...tableStyle(doc),
        startY: y,
        head: [['#', 'Description', 'Brand', 'Model', 'Qty', 'Unit', `Rate${cur}`, `Amount${cur}`]],
        body: lines,
        styles: { ...TABLE_STYLE.styles, fontSize: 7.2 },
        // References like "LF-01" stay on one line.
        columnStyles: { 0: { cellWidth: 'wrap', minCellWidth: 9 }, 4: { halign: 'center', cellWidth: 11 }, 5: { halign: 'center', cellWidth: 12 }, 6: { halign: 'right', cellWidth: 20 }, 7: { halign: 'right', cellWidth: 22 } },
    });
    pdfFooters(doc, ctx);
    return doc.output('blob');
}

// ---------------------------------------------------------------- drawings

/** The plan view with a key of the product colours beside it (made once per export). */
function buildAnnotatedPlan(ctx) {
    if (!ctx.annotated) ctx.annotated = drawAnnotatedPlan(ctx);
    return ctx.annotated;
}

async function drawAnnotatedPlan(ctx) {
    if (!ctx.planView) return null;
    const plan = await loadImage(ctx.planView);
    const keyed = ctx.products.filter((p) => ctx.colourOf(p) && ctx.placedOf(p) > 0);
    const thumbs = await Promise.all(
        keyed.map(async (p) => {
            const pic = p.imageRef || p.imageUrl ? await ctx.picture(p.imageRef || p.imageUrl, 200) : null;
            return pic?.dataUrl ? loadImage(pic.dataUrl).catch(() => null) : null;
        }),
    );
    const logo = ctx.logo.onLight ? await loadImage(ctx.logo.onLight.dataUrl).catch(() => null) : null;
    const pw = plan.naturalWidth;
    const ph = plan.naturalHeight;
    const legendW = Math.round(Math.max(420, pw * 0.32));
    const unit = Math.max(1, legendW / 460);
    const rowH = 78 * unit;
    const logoH = logo ? 64 * unit : 0;
    const lines = [clip(ctx.title, 40), ctx.client ? `Client: ${clip(ctx.client, 32)}` : '', ctx.date].filter(Boolean);
    const headH = logoH + 70 * unit + lines.length * 22 * unit;
    const needH = headH + 40 * unit + (keyed.length + 1) * rowH;
    const H = Math.max(ph, needH);
    const c = canvasOf(pw + legendW, H);
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(plan, 0, (H - ph) / 2);
    const x0 = pw + 28 * unit;
    g.fillStyle = '#f8fafc';
    g.fillRect(pw, 0, legendW, H);
    let y = 26 * unit;
    if (logo) {
        // The company's logo heads the key.
        const f = contain(logo.naturalWidth, logo.naturalHeight, { x: x0, y, w: legendW - 56 * unit, h: 44 * unit });
        g.drawImage(logo, x0, f.y, f.w, f.h);
        y += logoH;
    }
    g.fillStyle = `#${NAVY}`;
    g.font = `700 ${Math.round(26 * unit)}px Arial, sans-serif`;
    g.fillText('Products in place', x0, y + 30 * unit);
    y += 58 * unit;
    g.fillStyle = `#${MUTED}`;
    g.font = `${Math.round(15 * unit)}px Arial, sans-serif`;
    lines.forEach((t) => {
        g.fillText(t, x0, y);
        y += 22 * unit;
    });
    y += 18 * unit;
    const box = 60 * unit;
    const drawRow = (hex, thumb, title, sub) => {
        // colour bar, then the product's own picture, then its name
        g.fillStyle = hex;
        g.fillRect(x0, y, 8 * unit, box);
        const tx = x0 + 18 * unit;
        if (thumb) {
            g.fillStyle = '#ffffff';
            g.fillRect(tx, y, box, box);
            g.strokeStyle = 'rgba(15,23,42,0.15)';
            g.lineWidth = Math.max(1, unit);
            g.strokeRect(tx, y, box, box);
        }
        if (thumb) {
            const f = contain(thumb.naturalWidth, thumb.naturalHeight, { x: tx + 3 * unit, y: y + 3 * unit, w: box - 6 * unit, h: box - 6 * unit });
            g.drawImage(thumb, f.x, f.y, f.w, f.h);
        }
        const textX = tx + box + 14 * unit;
        g.fillStyle = `#${INK}`;
        g.font = `700 ${Math.round(16 * unit)}px Arial, sans-serif`;
        g.fillText(clip(title, 30), textX, y + 24 * unit);
        g.fillStyle = `#${MUTED}`;
        g.font = `${Math.round(13 * unit)}px Arial, sans-serif`;
        g.fillText(clip(sub, 38), textX, y + 46 * unit);
        y += rowH;
    };
    keyed.forEach((p, i) => {
        drawRow(ctx.colourOf(p).hex, thumbs[i], productLabel(p), `${ctx.placedOf(p)} placed · ${clip(p.description, 40)}`);
    });
    drawRow('#ece8e2', null, 'Furniture from the drawing', 'No product matched yet');
    return canvasBlob(c, 'image/png');
}

// ---------------------------------------------------------------- presentation

async function buildPresentation(ctx, pictures) {
    const PptxGenJS = (await import('pptxgenjs')).default;
    const pres = new PptxGenJS();
    pres.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 in
    // pptxgenjs writes some document properties unescaped: no "&" or "<" there, or
    // PowerPoint reports the file as damaged.
    pres.author = metaText(ctx.company) || 'BOQ Flow';
    pres.company = metaText(ctx.company) || 'BOQ Flow';
    pres.subject = 'Design and Build proposal';
    pres.title = metaText(`${ctx.title} - Design and Build`);
    const W = 13.333;
    const H = 7.5;
    const font = 'Calibri';
    const heading = (slide, title, sub) => {
        slide.addText(title, { x: 0.5, y: 0.3, w: 9, h: 0.6, fontFace: font, fontSize: 24, bold: true, color: NAVY });
        if (sub) slide.addText(sub, { x: 0.5, y: 0.85, w: 10, h: 0.35, fontFace: font, fontSize: 12, color: MUTED });
    };
    const containImage = async (slide, dataUrl, box) => {
        const j = await asJpeg(dataUrl, 2200);
        const f = contain(j.width, j.height, box);
        slide.addImage({ data: j.dataUrl, ...f });
    };
    const placeLogo = (slide, logo, box, side = 'right') => {
        if (!logo?.dataUrl) return null;
        const f = containAt(logo.width, logo.height, box, side);
        slide.addImage({ data: logo.dataUrl, ...f });
        return f;
    };
    // White slides: the company logo top right, and a footer with the project, client,
    // company and slide number.
    const chrome = (slide) => {
        placeLogo(slide, ctx.logo.onLight, { x: W - 0.5 - 2.1, y: 0.3, w: 2.1, h: 0.6 });
        slide.addShape(pres.ShapeType.line, { x: 0.5, y: 7.0, w: W - 1.0, h: 0, line: { color: LINE, width: 0.75 } });
        slide.addText(clip(ctx.heading, 100), { x: 0.5, y: 7.05, w: 7.6, h: 0.3, fontFace: font, fontSize: 9, color: MUTED, valign: 'middle' });
        slide.addText(clip(ctx.company, 60), { x: W - 0.5 - 4.6, y: 7.05, w: 4.0, h: 0.3, fontFace: font, fontSize: 9, color: MUTED, align: 'right', valign: 'middle' });
        slide.slideNumber = { x: W - 0.5 - 0.55, y: 7.05, w: 0.55, h: 0.3, fontFace: font, fontSize: 9, color: NAVY, align: 'right' };
    };
    const details = [ctx.date, ctx.project.number ? `Project no. ${ctx.project.number}` : '', ctx.project.revision, ctx.project.location]
        .filter(Boolean)
        .join('  ·  ');

    // Cover: the approved render, the company and client logos, the project.
    {
        const slide = pres.addSlide();
        slide.background = { color: NAVY };
        const hero = ctx.approved?.image || ctx.overview;
        if (hero) {
            const j = await coverJpeg(hero, W / H, 2400);
            slide.addImage({ data: j.dataUrl, x: 0, y: 0, w: W, h: H });
        }
        // The company, on a dark plate so it reads over any render.
        const own = ctx.logo.onDark;
        if (own?.dataUrl) {
            const f = contain(own.width, own.height, { x: 0, y: 0, w: 2.9, h: 0.8 });
            slide.addShape(pres.ShapeType.roundRect, { x: 0.45, y: 0.4, w: f.w + 0.5, h: f.h + 0.4, rectRadius: 0.12, fill: { color: NAVY, transparency: 15 }, line: { color: NAVY, transparency: 100 } });
            slide.addImage({ data: own.dataUrl, x: 0.7, y: 0.6, w: f.w, h: f.h });
        } else {
            slide.addShape(pres.ShapeType.roundRect, { x: 0.45, y: 0.4, w: 3.6, h: 0.75, rectRadius: 0.12, fill: { color: NAVY, transparency: 15 }, line: { color: NAVY, transparency: 100 } });
            slide.addText(clip(ctx.company, 36), { x: 0.65, y: 0.45, w: 3.3, h: 0.65, fontFace: font, fontSize: 16, bold: true, color: 'FFFFFF', valign: 'middle', fit: 'shrink' });
        }
        // The client's logo, on a white plate.
        const client = ctx.logo.client;
        if (client?.dataUrl) {
            const f = contain(client.width, client.height, { x: 0, y: 0, w: 2.2, h: 0.75 });
            const pw = f.w + 0.5;
            slide.addShape(pres.ShapeType.roundRect, { x: W - 0.45 - pw, y: 0.4, w: pw, h: f.h + 0.4, rectRadius: 0.12, fill: { color: 'FFFFFF', transparency: 5 }, line: { color: 'FFFFFF', transparency: 100 } });
            slide.addImage({ data: client.dataUrl, x: W - 0.45 - pw + 0.25, y: 0.6, w: f.w, h: f.h });
        }
        slide.addShape(pres.ShapeType.rect, { x: 0.5, y: 4.35, w: 7.0, h: 2.7, fill: { color: NAVY, transparency: 12 }, line: { color: NAVY, transparency: 100 } });
        slide.addText('DESIGN & BUILD PROPOSAL', { x: 0.8, y: 4.55, w: 6.4, h: 0.36, fontFace: font, fontSize: 12, bold: true, color: 'A5B4FC', charSpacing: 2 });
        slide.addText(clip(ctx.title, 70), { x: 0.8, y: 4.92, w: 6.5, h: 0.95, fontFace: font, fontSize: 28, bold: true, color: 'FFFFFF', valign: 'top', fit: 'shrink' });
        let y = 5.92;
        if (ctx.client) {
            slide.addText(`Prepared for ${clip(ctx.client, 60)}`, { x: 0.8, y, w: 6.5, h: 0.36, fontFace: font, fontSize: 14, color: 'E2E8F0', fit: 'shrink' });
            y += 0.4;
        }
        const placed = ctx.products.filter((p) => ctx.placedOf(p) > 0).length;
        slide.addText([details, placed ? `${placed} products` : ''].filter(Boolean).join('  ·  '), { x: 0.8, y, w: 6.5, h: 0.36, fontFace: font, fontSize: 12, color: 'CBD5E1', fit: 'shrink' });
    }

    // The space: overview and key facts.
    if (ctx.overview) {
        const slide = pres.addSlide();
        chrome(slide);
        heading(slide, 'The space', `Built in 3D from ${clip(ctx.planName || ctx.title, 70)} by Design & Build`);
        slide.addShape(pres.ShapeType.rect, { x: 0.5, y: 1.35, w: 8.4, h: 5.45, fill: { color: SOFT }, line: { color: SOFT } });
        await containImage(slide, ctx.overview, { x: 0.6, y: 1.45, w: 8.2, h: 5.25 });
        const c = ctx.counts || {};
        const placedPieces = ctx.input.furnished?.placedPieces || 0;
        const facts = [
            [c.walls, 'walls', c.glassWalls ? `${c.glassWalls} of them glass` : ''],
            [c.doors, 'doors', ''],
            [c.windows, 'windows', ''],
            [ctx.input.furniture?.pieces || c.items, 'furniture pieces from the drawing', ''],
            [placedPieces, 'pieces carry real products', ''],
        ].filter((f) => Number(f[0]) > 0);
        facts.forEach(([n, label, note], i) => {
            const y = 1.45 + i * 1.04;
            slide.addText(String(n), { x: 9.3, y, w: 3.5, h: 0.6, fontFace: font, fontSize: 30, bold: true, color: ACCENT });
            slide.addText(note ? `${label} · ${note}` : label, { x: 9.3, y: y + 0.58, w: 3.6, h: 0.35, fontFace: font, fontSize: 12, color: MUTED });
        });
    }

    // Plan from the top, with the furniture key beside it.
    if (ctx.planView) {
        const slide = pres.addSlide();
        chrome(slide);
        heading(slide, 'Plan with the products in place', 'Each product stands where the drawing shows it, by its own photo and colour');
        await containImage(slide, ctx.planView, { x: 0.5, y: 1.35, w: 8.2, h: 5.5 });
        const keyed = ctx.products.filter((p) => ctx.colourOf(p) && ctx.placedOf(p) > 0);
        const shownKeys = keyed.slice(0, 9);
        shownKeys.forEach((p, i) => {
            const y = 1.45 + i * 0.56;
            slide.addShape(pres.ShapeType.rect, { x: 9.0, y, w: 0.08, h: 0.46, fill: { color: ctx.colourOf(p).hex.replace('#', '') }, line: { color: ctx.colourOf(p).hex.replace('#', ''), width: 0 } });
            const img = pictures[ctx.products.indexOf(p)];
            if (img?.dataUrl) {
                const f = contain(img.width, img.height, { x: 9.14, y, w: 0.46, h: 0.46 });
                slide.addImage({ data: img.dataUrl, ...f });
            }
            slide.addText(clip(productLabel(p), 34), { x: 9.68, y: y - 0.04, w: 3.2, h: 0.28, fontFace: font, fontSize: 11, bold: true, color: INK });
            slide.addText(`${ctx.placedOf(p)} placed · ${clip(p.description, 40)}`, { x: 9.68, y: y + 0.22, w: 3.2, h: 0.24, fontFace: font, fontSize: 8.5, color: MUTED });
        });
        const y = 1.45 + shownKeys.length * 0.56;
        if (keyed.length > shownKeys.length) {
            slide.addText(`+ ${keyed.length - shownKeys.length} more products in the FF&E schedule`, { x: 9.0, y, w: 3.8, h: 0.3, fontFace: font, fontSize: 9, italic: true, color: MUTED });
        } else {
            slide.addShape(pres.ShapeType.roundRect, { x: 9.0, y: y + 0.04, w: 0.3, h: 0.3, rectRadius: 0.06, fill: { color: 'ECE8E2' }, line: { color: 'CBD5E1', width: 0.5 } });
            slide.addText('Furniture from the drawing, no product yet', { x: 9.45, y, w: 3.4, h: 0.3, fontFace: font, fontSize: 9.5, color: MUTED });
        }
    }

    // Renders, the approved one first, with the company's logo in the corner.
    for (let i = 0; i < ctx.renders.length; i++) {
        const r = ctx.renders[i];
        const slide = pres.addSlide();
        slide.background = { color: NAVY };
        await containImage(slide, r.image, { x: 0.35, y: 0.3, w: W - 0.7, h: 6.35 });
        const tag = [
            `Perspective ${String(i + 1).padStart(2, '0')}`,
            r.id === ctx.approved?.id ? 'Approved' : '',
            VIEW_LABEL[r.viewKind] || '',
            STYLE_LABEL[r.style] || '',
            r.score ? `geometry match ${pct(r.score)}` : '',
        ].filter(Boolean).join('  ·  ');
        slide.addText(tag, { x: 0.35, y: 6.8, w: W - 2.6, h: 0.4, fontFace: font, fontSize: 12, color: 'CBD5E1' });
        placeLogo(slide, ctx.logo.onDark, { x: W - 0.35 - 1.7, y: 6.8, w: 1.7, h: 0.42 });
    }

    // Products, six to a slide.
    const shown = ctx.products.slice(0, 48);
    for (let start = 0; start < shown.length; start += 6) {
        const slide = pres.addSlide();
        chrome(slide);
        heading(slide, 'Furniture & products', start === 0 ? `${ctx.products.length} lines from the applied offer${ctx.input.offer?.title ? ` · ${clip(ctx.input.offer.title, 60)}` : ''}` : '');
        for (let k = 0; k < 6 && start + k < shown.length; k++) {
            const p = shown[start + k];
            const col = k % 3;
            const row = Math.floor(k / 3);
            const x = 0.5 + col * 4.16;
            const y = 1.35 + row * 2.8;
            slide.addShape(pres.ShapeType.rect, { x, y, w: 4.0, h: 2.68, fill: { color: 'FFFFFF' }, line: { color: LINE, width: 0.75 } });
            const img = pictures[ctx.products.indexOf(p)];
            if (img?.dataUrl) {
                const f = contain(img.width, img.height, { x: x + 0.15, y: y + 0.12, w: 3.7, h: 1.34 });
                slide.addImage({ data: img.dataUrl, ...f });
            } else {
                slide.addShape(pres.ShapeType.rect, { x: x + 0.15, y: y + 0.12, w: 3.7, h: 1.34, fill: { color: SOFT }, line: { color: SOFT } });
            }
            const colour = ctx.colourOf(p);
            const placed = ctx.placedOf(p);
            if (colour) slide.addShape(pres.ShapeType.ellipse, { x: x + 0.17, y: y + 1.6, w: 0.2, h: 0.2, fill: { color: colour.hex.replace('#', '') }, line: { color: 'FFFFFF', width: 1 } });
            slide.addText(clip(productLabel(p), 48), { x: x + (colour ? 0.42 : 0.15), y: y + 1.52, w: 3.4, h: 0.36, fontFace: font, fontSize: 12, bold: true, color: NAVY, valign: 'middle', fit: 'shrink' });
            slide.addText(clip(p.description, 110), { x: x + 0.15, y: y + 1.86, w: 3.7, h: 0.42, fontFace: font, fontSize: 9, color: MUTED, valign: 'top', fit: 'shrink' });
            slide.addText(`Qty ${p.qty}${p.unit ? ` ${p.unit}` : ''}${placed ? ` · ${placed} in the model` : ' · not on the drawing'}`, { x: x + 0.15, y: y + 2.3, w: 3.7, h: 0.3, fontFace: font, fontSize: 9.5, bold: true, color: INK });
        }
    }

    // Schedule.
    if (ctx.products.length) {
        const cur = ctx.currency ? ` (${ctx.currency})` : '';
        const head = ['Ref', 'Product', 'Brand', 'Model', 'Qty', 'Unit', `Amount${cur}`].map((t) => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: NAVY } } }));
        for (let start = 0; start < ctx.products.length; start += 13) {
            const slide = pres.addSlide();
            chrome(slide);
            heading(slide, 'Schedule', start === 0 ? 'Quantities and amounts from the offer' : '');
            const rows = ctx.products.slice(start, start + 13).map((p) => [
                p.sn || '',
                clip(p.description, 70),
                clip(p.brand, 22),
                clip(p.model, 26),
                String(p.qty),
                p.unit || '',
                p.amount ? money(p.amount) : '',
            ]);
            slide.addTable([head, ...rows], {
                x: 0.5, y: 1.35, w: 12.33, colW: [0.7, 5.0, 1.7, 2.1, 0.8, 0.8, 1.23],
                fontFace: font, fontSize: 9.5, color: INK, valign: 'middle',
                border: { type: 'solid', color: LINE, pt: 0.5 },
                rowH: 0.36,
            });
        }
    }

    // Closing: the company, and the project it was prepared for.
    {
        const slide = pres.addSlide();
        slide.background = { color: NAVY };
        const own = ctx.logo.onDark;
        let y = 1.75;
        if (own?.dataUrl) {
            const f = contain(own.width, own.height, { x: W / 2 - 2.2, y, w: 4.4, h: 1.25 });
            slide.addImage({ data: own.dataUrl, ...f });
            y += 1.6;
        } else {
            slide.addText(clip(ctx.company, 40), { x: 1, y, w: W - 2, h: 0.9, fontFace: font, fontSize: 34, bold: true, color: 'FFFFFF', align: 'center', fit: 'shrink' });
            y += 1.2;
        }
        slide.addText('Thank you', { x: 1, y, w: W - 2, h: 0.7, fontFace: font, fontSize: 30, bold: true, color: 'FFFFFF', align: 'center' });
        y += 0.8;
        slide.addText([ctx.company, ctx.website].filter(Boolean).join('  ·  '), { x: 1, y, w: W - 2, h: 0.4, fontFace: font, fontSize: 14, color: 'CBD5E1', align: 'center', fit: 'shrink' });
        y += 0.75;
        slide.addShape(pres.ShapeType.rect, { x: W / 2 - 0.6, y, w: 1.2, h: 0.04, fill: { color: ACCENT }, line: { color: ACCENT, width: 0 } });
        y += 0.3;
        slide.addText(`${clip(ctx.title, 70)}${ctx.client ? `  ·  Prepared for ${clip(ctx.client, 50)}` : ''}`, { x: 1, y, w: W - 2, h: 0.4, fontFace: font, fontSize: 13, color: 'A5B4FC', align: 'center', fit: 'shrink' });
        y += 0.42;
        const team = [ctx.project.consultant ? `Consultant: ${ctx.project.consultant}` : '', ctx.project.contractor ? `Contractor: ${ctx.project.contractor}` : ''].filter(Boolean).join('  ·  ');
        slide.addText([details, team].filter(Boolean).join('  ·  '), { x: 1, y, w: W - 2, h: 0.4, fontFace: font, fontSize: 11.5, color: 'CBD5E1', align: 'center', fit: 'shrink' });
    }

    return officeFile(await pres.write({ outputType: 'arraybuffer' }), PPTX_TYPE);
}

// ---------------------------------------------------------------- FF&E

async function buildFfeSchedule(ctx, pictures) {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = ctx.company;
    wb.created = new Date();
    const ws = wb.addWorksheet('FF&E Schedule', { properties: { tabColor: { argb: argb(ACCENT) } } });
    const cur = ctx.currency ? ` (${ctx.currency})` : '';
    const header = ['Ref', 'Image', 'Key', 'BOQ item', 'Brand', 'Model', 'Product description', 'Qty', 'Unit', 'In the model', `Rate${cur}`, `Amount${cur}`, 'Location', 'Category'];
    const widths = [8, 12, 11, 44, 18, 22, 44, 8, 8, 12, 13, 15, 18, 26];
    sheetTitle(ws, ctx, `FF&E schedule — products of the applied offer, as placed in the Design & Build model · ${ctx.date}`, header.length);
    widths.forEach((w, i) => {
        ws.getColumn(i + 1).width = w;
    });
    sheetLogo(wb, ws, ctx, header.length);
    const head = ws.getRow(4);
    head.values = header;
    styleHeaderRow(head);
    let r = 5;
    let total = 0;
    for (let i = 0; i < ctx.products.length; i++) {
        const p = ctx.products[i];
        const colour = ctx.colourOf(p);
        const placed = ctx.placedOf(p);
        const row = ws.getRow(r);
        const productText = p.productText && p.productText !== p.description ? p.productText : '';
        row.values = [p.sn || String(i + 1), '', colour ? colour.name : '', p.description, p.brand || '', p.model || '', productText, p.qty, p.unit || '', placed, p.rate || '', p.amount || '', p.location || '', p.category || ''];
        row.eachCell({ includeEmpty: true }, (cell, c) => {
            cell.alignment = { vertical: 'middle', wrapText: c === 4 || c === 7, horizontal: c === 4 || c === 7 || c >= 13 ? 'left' : 'center' };
            cell.font = { size: 9.5, color: { argb: argb(INK) } };
            cell.border = { bottom: { style: 'hair', color: { argb: argb(LINE) } } };
            if (c === 11 || c === 12) cell.numFmt = '#,##0.00';
        });
        if (colour) {
            const key = row.getCell(3);
            key.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(colour.hex) } };
            key.font = { size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
        }
        if (placed === 0) row.getCell(10).font = { size: 9.5, color: { argb: 'FFB45309' } };
        const img = pictures[i];
        if (img?.dataUrl) {
            const id = wb.addImage({ base64: img.dataUrl.split(',')[1], extension: 'jpeg' });
            const s = Math.min(56 / img.width, 56 / img.height);
            ws.addImage(id, { tl: { col: 1.12, row: r - 1 + 0.12 }, ext: { width: img.width * s, height: img.height * s }, editAs: 'oneCell' });
            row.height = 48;
        } else {
            row.height = 30;
        }
        total += num(p.amount);
        r++;
    }
    const tr = ws.getRow(r + 1);
    tr.getCell(11).value = 'Total';
    tr.getCell(12).value = total;
    tr.getCell(12).numFmt = '#,##0.00';
    [11, 12].forEach((c) => {
        tr.getCell(c).font = { bold: true, color: { argb: argb(NAVY) } };
        tr.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(SOFT) } };
    });
    ws.views = [{ state: 'frozen', ySplit: 4 }];

    // Where each piece stands on the plan, with its product.
    if (ctx.placements.length) {
        const ps = wb.addWorksheet('Placement');
        sheetTitle(ps, ctx, 'Each piece of furniture on the plan (centre in metres from the drawing origin, x right, y down)', 9);
        [8, 34, 11, 14, 10, 10, 12, 11, 11].forEach((w, i) => {
            ps.getColumn(i + 1).width = w;
        });
        sheetLogo(wb, ps, ctx, 9);
        const h = ps.getRow(4);
        h.values = ['Ref', 'Product', 'Key', 'Kind', 'X (m)', 'Y (m)', 'Rotation (°)', 'Width (m)', 'Depth (m)'];
        styleHeaderRow(h);
        const byId = new Map(ctx.products.map((p) => [p.id, p]));
        const order = new Map(ctx.products.map((p, i) => [p.id, i]));
        const rows = [...ctx.placements].sort((a, b) => {
            const pa = a.productId && byId.has(a.productId) ? order.get(a.productId) : 1e9;
            const pb = b.productId && byId.has(b.productId) ? order.get(b.productId) : 1e9;
            return pa - pb || a.y - b.y || a.x - b.x;
        });
        rows.forEach((pl, i) => {
            const p = pl.productId ? byId.get(pl.productId) : null;
            const colour = p ? ctx.colourOf(p) : null;
            const row = ps.getRow(5 + i);
            row.values = [p?.sn || '', p ? productLabel(p) : 'No product yet', colour ? colour.name : '', pl.kind, pl.x, pl.y, pl.angleDeg, pl.widthM, pl.depthM];
            [5, 6, 8, 9].forEach((c) => {
                row.getCell(c).numFmt = '0.00';
            });
            if (colour) {
                row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(colour.hex) } };
                row.getCell(3).font = { size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
            }
            if (!p) row.getCell(2).font = { italic: true, color: { argb: argb(MUTED) } };
        });
        ps.views = [{ state: 'frozen', ySplit: 4 }];
    }

    // The furniture Design & Build read from the drawing.
    const schedule = ctx.input.furniture?.schedule || [];
    if (schedule.length) {
        const ds = wb.addWorksheet('From the drawing');
        sheetTitle(ds, ctx, 'Furniture types read from the drawing (sizes in metres)', 5);
        [22, 16, 14, 14, 10].forEach((w, i) => {
            ds.getColumn(i + 1).width = w;
        });
        sheetLogo(wb, ds, ctx, 5);
        const h = ds.getRow(4);
        h.values = ['Kind', 'Shape', 'Width (m)', 'Depth (m)', 'Count'];
        styleHeaderRow(h);
        schedule.forEach((t, i) => {
            const row = ds.getRow(5 + i);
            row.values = [t.kind, t.shape, Number(t.widthM) || 0, Number(t.depthM) || 0, Number(t.count) || 0];
            row.getCell(3).numFmt = '0.00';
            row.getCell(4).numFmt = '0.00';
        });
    }
    return officeFile(await wb.xlsx.writeBuffer(), XLSX_TYPE);
}

async function buildCatalogueLinks(ctx) {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = ctx.company;
    const ws = wb.addWorksheet('Catalogue links');
    const header = ['Ref', 'Product', 'Brand', 'Model', 'Qty', 'Product page', 'Picture', 'Category'];
    sheetTitle(ws, ctx, `Catalogue links for the offer's products · ${ctx.date}`, header.length);
    [8, 44, 18, 24, 8, 40, 40, 26].forEach((w, i) => {
        ws.getColumn(i + 1).width = w;
    });
    sheetLogo(wb, ws, ctx, header.length);
    const head = ws.getRow(4);
    head.values = header;
    styleHeaderRow(head);
    ctx.products.forEach((p, i) => {
        const row = ws.getRow(5 + i);
        const pictureLink = /^https?:\/\//i.test(p.imageRef || '') ? p.imageRef : '';
        row.values = [p.sn || String(i + 1), clip(p.description, 200), p.brand || '', p.model || '', p.qty, '', '', p.category || ''];
        if (p.productUrl) {
            row.getCell(6).value = { text: clip(p.productUrl, 80), hyperlink: p.productUrl };
            row.getCell(6).font = { color: { argb: argb(ACCENT) }, underline: true };
        }
        if (pictureLink) {
            row.getCell(7).value = { text: clip(pictureLink, 80), hyperlink: pictureLink };
            row.getCell(7).font = { color: { argb: argb(ACCENT) }, underline: true };
        }
        row.alignment = { vertical: 'middle', wrapText: true };
    });
    return officeFile(await wb.xlsx.writeBuffer(), XLSX_TYPE);
}

async function buildMoodBoard(ctx, pictures) {
    const { doc } = await newPdf(ctx, { orientation: 'landscape', unit: 'mm', format: 'a3' }, ctx.products.map((p) => productLabel(p)));
    const W = doc.internal.pageSize.getWidth(); // 420
    const top = (subtitle) => {
        // The company's logo (or name) on the right, the project and client on the left.
        const logoW = pdfLogo(doc, ctx.logo.onLight, { x: W - 15 - 64, y: 8, w: 64, h: 20 });
        doc.setFontSize(22);
        doc.setTextColor(...rgb(NAVY));
        pdfText(doc, clip(ctx.title, 70), 15, 20, {}, 'bold');
        if (!logoW) pdfText(doc, clip(ctx.company, 40), W - 15, 20, { align: 'right' }, 'bold');
        doc.setFontSize(11);
        doc.setTextColor(...rgb(MUTED));
        pdfText(doc, [subtitle, ctx.client ? `Client: ${ctx.client}` : '', ctx.date].filter(Boolean).join('  ·  '), 15, 27);
        doc.setDrawColor(...rgb(ACCENT));
        doc.setLineWidth(0.8);
        doc.line(15, 31, 60, 31);
    };
    const tile = (p, img, x, y, w, h) => {
        doc.setDrawColor(...rgb(LINE));
        doc.setLineWidth(0.25);
        doc.roundedRect(x, y, w, h, 2, 2, 'S');
        const imgBox = { x: x + 3, y: y + 3, w: w - 6, h: h - 20 };
        if (img?.dataUrl) {
            const f = contain(img.width, img.height, imgBox);
            doc.addImage(img.dataUrl, 'JPEG', f.x, f.y, f.w, f.h);
        } else {
            doc.setFillColor(...rgb(SOFT));
            doc.rect(imgBox.x, imgBox.y, imgBox.w, imgBox.h, 'F');
        }
        const colour = ctx.colourOf(p);
        if (colour) {
            doc.setFillColor(...rgb(colour.hex));
            doc.circle(x + 5.5, y + h - 11.5, 2.2, 'F');
        }
        doc.setFontSize(8);
        doc.setTextColor(...rgb(INK));
        pdfText(doc, clip(productLabel(p), 40), x + (colour ? 10 : 3), y + h - 10.5, { maxWidth: w - (colour ? 13 : 6) }, 'bold');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...rgb(MUTED));
        const placed = ctx.placedOf(p);
        doc.text(`Qty ${p.qty}${placed ? ` · ${placed} in the model` : ''}`, x + 3, y + h - 4);
    };

    top('Mood board — the approved render with the real products of the offer');
    const hero = ctx.approved?.image || ctx.overview;
    if (hero) {
        const j = await asJpeg(hero, 2400);
        const f = contain(j.width, j.height, { x: 15, y: 38, w: 255, h: 190 });
        doc.addImage(j.dataUrl, 'JPEG', f.x, f.y, f.w, f.h);
    }
    // Other renders in a strip below.
    const others = ctx.renders.filter((r) => r !== ctx.approved).slice(0, 3);
    for (let i = 0; i < others.length; i++) {
        const j = await asJpeg(others[i].image, 900, 0.82);
        const f = contain(j.width, j.height, { x: 15 + i * 86, y: 234, w: 82, h: 50 });
        doc.addImage(j.dataUrl, 'JPEG', f.x, f.y, f.w, f.h);
    }
    // Products beside the render, then on further pages.
    const first = ctx.products.slice(0, 8);
    first.forEach((p, k) => {
        const col = k % 2;
        const row = Math.floor(k / 2);
        tile(p, pictures[ctx.products.indexOf(p)], 280 + col * 64, 38 + row * 62, 60, 58);
    });
    for (let start = 8; start < ctx.products.length; start += 18) {
        doc.addPage();
        top('Mood board — products');
        ctx.products.slice(start, start + 18).forEach((p, k) => {
            const col = k % 6;
            const row = Math.floor(k / 6);
            tile(p, pictures[ctx.products.indexOf(p)], 15 + col * 66, 40 + row * 82, 62, 78);
        });
    }
    pdfFooters(doc, ctx);
    return doc.output('blob');
}

// ---------------------------------------------------------------- report

async function buildAudit(ctx) {
    const { doc, autoTable } = await newPdf(ctx, { orientation: 'portrait', unit: 'mm', format: 'a4' }, [
        ctx.project.location, ctx.project.consultant, ctx.project.contractor, ...ctx.products.map((p) => `${productLabel(p)} ${p.description}`),
    ]);
    let y = pdfHeader(doc, 'Extraction Audit', ctx);
    const plan = ctx.input.plan;
    const c = ctx.counts || {};
    const next = () => doc.lastAutoTable.finalY + 9;

    // The project, as set in BOQ Flow's project details.
    const projectRows = [
        ['Project', ctx.title],
        ['Project number', ctx.project.number],
        ['Client', ctx.client],
        ['Location', ctx.project.location],
        ['Consultant', ctx.project.consultant],
        ['Contractor', ctx.project.contractor],
        ['Revision', ctx.project.revision],
        ['Issue date', ctx.date],
        ['Prepared by', [ctx.company, ctx.website].filter(Boolean).join(' · ')],
    ].filter(([, v]) => v);
    y = sectionTitle(doc, 'Project', y);
    autoTable(doc, {
        ...tableStyle(doc),
        startY: y,
        body: projectRows.map(([k, v]) => [k, clip(v, 90)]),
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40 } },
    });

    y = sectionTitle(doc, 'Source drawing', next());
    autoTable(doc, {
        ...tableStyle(doc),
        startY: y,
        body: [
            ['Drawing', clip(ctx.planName || '—', 90)],
            ['File size', plan?.file?.size ? `${(plan.file.size / 1048576).toFixed(2)} MB` : '—'],
            ['Read by', 'Design & Build (geometric extraction of the vector drawing)'],
            ['Exported', `${new Date().toLocaleString('en-GB')} from BOQ Flow`],
        ],
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40 } },
    });
    y = sectionTitle(doc, '3D model', next());
    autoTable(doc, {
        ...tableStyle(doc),
        startY: y,
        head: [['Element', 'Count']],
        body: [
            ['Walls', c.walls ?? '—'],
            ['  of which glass', c.glassWalls ?? '—'],
            ['  of which curved', c.curvedWalls ?? '—'],
            ['Doors', c.doors ?? '—'],
            ['Windows', c.windows ?? '—'],
            ['Furniture items', c.items ?? '—'],
        ].map(([a, b]) => [a, String(b)]),
        columnStyles: { 1: { halign: 'right', cellWidth: 30 } },
    });
    const schedule = ctx.input.furniture?.schedule || [];
    y = sectionTitle(doc, `Furniture from the drawing — ${ctx.input.furniture?.pieces || 0} pieces`, next());
    autoTable(doc, {
        ...tableStyle(doc),
        startY: y,
        head: [['Kind', 'Shape', 'Size (m)', 'Count']],
        body: schedule.length
            ? schedule.map((t) => [t.kind, t.shape, `${(Number(t.widthM) || 0).toFixed(2)} × ${(Number(t.depthM) || 0).toFixed(2)}`, String(t.count)])
            : [['No furniture layer on this drawing', '', '', '']],
        columnStyles: { 3: { halign: 'right', cellWidth: 20 } },
    });
    const f = ctx.input.furnished;
    y = sectionTitle(doc, `Products — ${f ? `${f.placedPieces} of ${f.pieces} pieces carry a product` : 'not furnished'}`, next());
    autoTable(doc, {
        ...tableStyle(doc),
        startY: y,
        head: [['Product', 'Qty', 'In the model', 'Status']],
        body: ctx.products.map((p) => {
            const placed = ctx.placedOf(p);
            return [clip(`${productLabel(p)} — ${p.description}`, 90), String(p.qty), String(placed), placed === 0 ? 'Not found on the drawing' : placed < p.qty ? 'Partly placed' : 'Placed'];
        }),
        columnStyles: { 1: { halign: 'center', cellWidth: 14 }, 2: { halign: 'center', cellWidth: 24 }, 3: { cellWidth: 40 } },
    });
    y = sectionTitle(doc, 'Renders', next());
    autoTable(doc, {
        ...tableStyle(doc),
        startY: y,
        head: [['#', 'View', 'Light', 'Model', 'Geometry match', 'Approved']],
        body: ctx.renders.map((r, i) => [
            String(i + 1).padStart(2, '0'),
            VIEW_LABEL[r.viewKind] || r.viewKind || '—',
            STYLE_LABEL[r.style] || r.style || '—',
            r.modelLabel || '—',
            r.score ? pct(r.score) : '—',
            r.id === ctx.approved?.id ? 'Yes' : '',
        ]),
    });
    pdfFooters(doc, ctx);
    return doc.output('blob');
}

// ---------------------------------------------------------------- suite

/**
 * Make the files of the chosen groups. Returns the files (path inside the package,
 * blob) and notes on anything that could not be made.
 */
export async function buildExportSuite(input, { groups, onProgress } = {}) {
    const ctx = suiteContext(input);
    const want = new Set(groups?.length ? groups : SUITE_GROUPS.map((g) => g.key));
    const progress = onProgress || (() => {});
    const files = [];
    const notes = [];
    progress('Preparing the logos…');
    await prepareLogos(ctx);
    // BOQ Flow's own offer, BOQ and submittals, as its table's exports make them.
    const documents = input.documents?.files || [];
    const documentsIn = (folder) => documents.filter((f) => f.path.startsWith(`${folder}/`));
    const boqDocuments = want.has('boq') ? documentsIn('BOQ') : [];
    if (boqDocuments.length) files.push(...boqDocuments);
    if (want.has('submittals')) {
        const submittals = documentsIn('Submittals');
        if (submittals.length) files.push(...submittals);
        else notes.push('Submittals: open the BOQ table in BOQ Flow to add the MAS, MIR, WIR and delivery note.');
    }
    if (input.documents?.notes?.length) notes.push(...input.documents.notes);
    let pictures = null;
    const pics = async () => {
        if (!pictures) {
            progress('Loading product pictures…');
            pictures = await productPictures(ctx);
        }
        return pictures;
    };
    const steps = [
        // Without BOQ Flow's own offer documents, the package makes its own BOQ from the offer.
        ...(boqDocuments.length ? [] : [
            ['boq', 'BOQ/Detailed_BOQ.xlsx', () => buildDetailedBoq(ctx)],
            ['boq', 'BOQ/BOQ_Summary.pdf', () => buildBoqSummary(ctx)],
        ]),
        ['drawings', 'Drawings/Source_Drawing.pdf', async () => input.plan?.file || null],
        ['drawings', 'Drawings/Extracted_Plan.png', async () => (ctx.planPlain ? asPngBlob(ctx.planPlain) : null)],
        ['drawings', 'Drawings/Annotated_Plan.png', () => buildAnnotatedPlan(ctx)],
        ['presentation', 'Presentation/Design_and_Build_Presentation.pptx', async () => buildPresentation(ctx, await pics())],
        ['ffe', 'FF&E/FF&E_Schedule.xlsx', async () => (ctx.products.length ? buildFfeSchedule(ctx, await pics()) : null)],
        ['ffe', 'FF&E/Mood_Board.pdf', async () => buildMoodBoard(ctx, await pics())],
        ['ffe', 'FF&E/Catalogue_Links.xlsx', async () => (ctx.products.length ? buildCatalogueLinks(ctx) : null)],
        ['model', 'Model/Pascal_Scene.json', async () => (input.artifacts?.scene ? new Blob([input.artifacts.scene], { type: 'application/json' }) : null)],
        ['reports', 'Reports/Extraction_Audit.pdf', () => buildAudit(ctx)],
    ].filter(([g]) => want.has(g));
    const total = steps.length + (want.has('renders') ? 1 : 0);
    let done = 0;
    for (const [, path, run] of steps) {
        progress(`Making ${path.split('/').pop()}…`, done / total);
        try {
            const blob = await run();
            if (blob) files.push({ path, blob });
            else notes.push(`${path}: nothing to export (${reasonFor(path, input)}).`);
        } catch (e) {
            console.warn('[design-build export]', path, e);
            notes.push(`${path}: could not be made (${e?.message || e}).`);
        }
        done++;
    }
    if (want.has('renders')) {
        ctx.renders.forEach((r, i) => {
            const tag = r.id === ctx.approved?.id ? '_Approved' : '';
            files.push({ path: `Renders/Perspective_${String(i + 1).padStart(2, '0')}${tag}.${extOf(r.image)}`, blob: dataUrlToBlob(r.image) });
        });
        if (!ctx.renders.length) notes.push('Renders: no render yet.');
    }
    progress('Package ready', 1);
    return { files, notes, slug: ctx.slug, title: ctx.title };
}

function reasonFor(path, input) {
    if (path.startsWith('BOQ/') || path.includes('Catalogue') || path.includes('FF&E_Schedule')) return 'no offer applied yet';
    if (path.includes('Source_Drawing')) return 'the drawing is not in this session';
    if (path.includes('Plan')) return 'no plan view from Design & Build';
    if (path.includes('Scene')) return input.artifacts ? 'no scene' : 'Design & Build did not answer';
    return 'no data';
}

/**
 * Save the files: as a ZIP named after the project (the whole package, or one folder
 * of it), or a single file as it is.
 */
export async function saveExportSuite(result, { asZip = true, suffix = 'Design_and_Build' } = {}) {
    const { saveAs } = await import('file-saver');
    if (!asZip && result.files.length === 1) {
        const f = result.files[0];
        saveAs(f.blob, `${result.slug}_${f.path.split('/').pop()}`);
        return;
    }
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const root = zip.folder(result.slug);
    for (const f of result.files) {
        root.file(f.path, f.blob, { compression: /\.(png|jpe?g|webp|pptx|xlsx)$/i.test(f.path) ? 'STORE' : 'DEFLATE' });
    }
    if (result.notes.length) root.file('Export_Notes.txt', `${result.title}\r\n\r\n${result.notes.join('\r\n')}\r\n`);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    saveAs(blob, `${result.slug}_${String(suffix).replace(/[^A-Za-z0-9]+/g, '_')}.zip`);
}
