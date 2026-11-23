/**
 * One-click matching: every line of the extracted BOQ gets a catalogue product (photo,
 * brand, model, price) in one pass, from the auto-detect matcher the Value Engineer uses
 * (`POST /api/ve-match-auto`). A line that names its brand and model keeps them; any
 * other line gets the best product of the preferred catalogues. The result is a priced
 * offer in the Value Engineered layout, so the costed view, the exports and Design &
 * Build read it like the other offers.
 */
import { findDescColumn, cellImageUrls } from '../../utils/boqUtils.js';

export const MATCHED_OFFER_HEADER = ['#', 'Image', 'Description', 'Brand', 'Model', 'Qty', 'Unit', 'Rate', 'Amount'];

/** Lines matched at the same time (the matcher coalesces identical lines on its side too). */
export const MATCH_CONCURRENCY = 3;
/** A line the matcher has not answered in this time is left as in the BOQ (the run goes on). */
export const LINE_TIMEOUT_MS = 120000;

const SUMMARY_TEXT = /\b(sub[-\s]?total|grand\s*total|total\s*value|total\s*amount|net\s*total|vat|tax|discount)\b|^\s*total\b/i;
/** A line's own reference column: Sr., S/N, S.No., Sl. No, No., #, Ref, Item No., Item Code, Pos., Code. */
const REF_HEADER = /^(s\s*[./]?\s*n\.?(o\.?)?|sr\.?(\s*no\.?)?|sl\.?(\s*no\.?)?|no\.?|#|ref(erence)?\.?(\s*no\.?)?|item\s*(no\.?|code)|pos\.?|code)$/i;
/** Columns whose words describe the product, sent to the matcher with the description. */
const DETAIL_HEADER = /brand|\bmake\b|maker|manufacturer|supplier|model|code|spec|finish|material|colou?r|fabric|size|dimension|type|detail|particular/i;
const NOT_DETAIL_HEADER = /qty|quantity|unit|uom|rate|price|amount|total|image|photo|picture|remark|note|location|room|zone|area|floor|scope|categor|trade|page/i;
const PLACEHOLDER = /^(-+|n\/?a|nil|none|no ref|boq_only|tbc|tbd)$/i;
const EMPTY_CELLS = 9;

export const parseNumber = (v) => {
    const n = parseFloat(String(v ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : NaN;
};

const round2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;

/** The text of an extracted cell (plain, rich text or an Excel formula result). */
export function cellText(cell) {
    if (cell == null) return '';
    if (typeof cell !== 'object') return String(cell).trim();
    const rich = (r) => r.map((t) => t?.text || '').join('').trim();
    if (Array.isArray(cell.richText)) return rich(cell.richText);
    const v = cell.value;
    if (v == null) return '';
    if (typeof v === 'object') {
        if (Array.isArray(v.richText)) return rich(v.richText);
        if (v.text != null) return String(v.text).trim();
        if (v.result != null) return String(v.result).trim();
        return '';
    }
    return String(v).trim();
}

/** Where a table keeps the fields a line needs (-1 when it has no such column). */
export function lineColumns(header = [], rows = []) {
    const H = (header || []).map((h) => String(h ?? '').replace(/\s+/g, ' ').trim());
    const find = (re, not) => H.findIndex((h) => re.test(h) && !(not && not.test(h)));
    const description = findDescColumn(header || [], rows || []);
    const amount = find(/amount|total/i, /qty|quantity/i);
    const rate = H.findIndex((h, i) => i !== amount && /rate|price/i.test(h));
    let unit = find(/^(unit|units|uom|u\.?o\.?m\.?)$/i);
    if (unit < 0) unit = find(/unit|uom/i, /rate|price|amount|total|cost/i);
    let scope = find(/^scope$/i);
    if (scope < 0) scope = find(/scope|trade/i);
    return {
        sn: H.findIndex((h, i) => i !== description && REF_HEADER.test(h)),
        description,
        qty: find(/\bqty\b|quantity|\bqt\b|\bqnty\b/i),
        unit,
        rate,
        amount,
        brand: find(/brand|manufacturer|\bmake\b|maker/i),
        model: find(/model/i),
        scope,
        location: find(/^(location|room|zone|area|space)$/i),
        details: H.map((_, i) => i).filter((i) => (
            i !== description && DETAIL_HEADER.test(H[i]) && !NOT_DETAIL_HEADER.test(H[i]) && !REF_HEADER.test(H[i])
        )),
    };
}

const uniqueTexts = (list) => {
    const seen = new Set();
    return list.filter((t) => {
        const k = t.toLowerCase();
        if (!t || seen.has(k)) return false;
        seen.add(k);
        return true;
    });
};

/**
 * The lines to match: rows with a description and a quantity, unit or rate. Section
 * titles, printed totals, set components and option lines are not lines.
 */
export function collectLines(tables = []) {
    const lines = [];
    (tables || []).forEach((table, t) => {
        const rows = Array.isArray(table?.rows) ? table.rows : [];
        const col = lineColumns(table?.header || [], rows);
        rows.forEach((row, r) => {
            if (!row || !Array.isArray(row.cells) || row.isHeader || row.isSummary || row.isOptionRow || row.isSetSubItem) return;
            const at = (i) => (i >= 0 ? cellText(row.cells[i]) : '');
            const description = at(col.description);
            const qty = at(col.qty);
            const unit = at(col.unit);
            const rate = at(col.rate);
            if (!description || PLACEHOLDER.test(description) || (!qty && !unit && !rate)) return;
            if (!(parseNumber(qty) > 0) && SUMMARY_TEXT.test(description)) return;
            const low = description.toLowerCase();
            const details = col.details.map(at).filter((v) => v && !PLACEHOLDER.test(v) && !low.includes(v.toLowerCase()));
            const urls = row.cells
                .flatMap((c) => cellText(c).match(/https?:\/\/[^\s)\],]+/gi) || [])
                .filter((u) => !description.includes(u));
            const images = cellImageUrls(row).filter((u) => !/\/api\/lazy-image/i.test(u));
            lines.push({
                key: `${t}:${r}`,
                table: t,
                row: r,
                sn: at(col.sn),
                description,
                query: uniqueTexts([description, ...details, ...urls]).join(' | ').slice(0, 1200),
                qty,
                unit,
                rate,
                brand: at(col.brand),
                model: at(col.model),
                scope: at(col.scope),
                location: at(col.location),
                images,
            });
        });
    });
    return lines;
}

/** Identical lines (the same words and picture) are matched once. */
export const lineMatchKey = (line) => `${String(line?.query || line?.description || '').toLowerCase().replace(/\s+/g, ' ').trim()}||${line?.images?.[0] || ''}`;

/** The product of a matcher answer, in the fields an offer line needs. */
export function productOf(data) {
    const p = data?.product || {};
    const images = (Array.isArray(p.images) ? p.images : [])
        .map((img) => (typeof img === 'string' ? img : img?.url))
        .filter((u) => typeof u === 'string' && u);
    const price = parseNumber(p.price);
    return {
        brand: String(p.brand || '').trim(),
        brandLogo: p.brandLogo || '',
        model: String(p.model || '').trim(),
        family: p.family || '',
        mainCategory: p.mainCategory || p.category || '',
        subCategory: p.subCategory || '',
        description: String(p.description || '').trim(),
        imageUrl: p.imageUrl || images[0] || '',
        productUrl: p.productUrl || p.websiteUrl || '',
        price: price > 0 ? price : 0,
        currency: String(p.currency || '').trim().toUpperCase(),
        tier: String(data?.matchTier || ''),
        confidence: Number(data?.confidenceScore) || null,
        source: String(data?.source || ''),
    };
}

/** A product worth putting on the line: a picture, a price, or a real brand's model. */
export const isUsableProduct = (p) => Boolean(p && (p.imageUrl || p.price > 0 || (p.model && p.brand && !/^(generic|unknown|not specified)$/i.test(p.brand))));

const normName = (s) => String(s || '').toLowerCase().replace(/#\d+/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Fills what the matcher left out (picture, price, category, page, a fuller description)
 * from the brand's catalogue BOQ Flow already holds.
 */
export function enrichFromCatalog(product, brands = []) {
    if (!product?.brand || !Array.isArray(brands) || brands.length === 0) return product;
    const brandKey = normName(product.brand);
    const brand = brands.find((b) => b && normName(b.name) === brandKey);
    if (!brand) return product;
    const out = { ...product, brand: brand.name || product.brand, brandLogo: product.brandLogo || brand.logo || '' };
    const list = Array.isArray(brand.products) ? brand.products : [];
    const model = normName(product.model);
    if (!model) return out;
    const local = list.find((p) => normName(p?.model) === model)
        || list.find((p) => {
            const n = normName(p?.model);
            return n.length > 2 && (n.includes(model) || model.includes(n));
        });
    if (!local) return out;
    const localImage = local.imageUrl || (Array.isArray(local.images) ? local.images[0] : '') || '';
    const localDescription = String(local.description || '').trim();
    const takeDescription = localDescription && (
        !out.description || /^specified manufacturer:/i.test(out.description) || localDescription.length > out.description.length
    );
    const localPrice = parseNumber(local.price);
    return {
        ...out,
        model: local.model || out.model,
        family: out.family || local.family || '',
        mainCategory: out.mainCategory || local.mainCategory || local.category || '',
        subCategory: out.subCategory || local.subCategory || '',
        imageUrl: out.imageUrl || (typeof localImage === 'string' && localImage && !/img\.architonic\.com/i.test(localImage) ? localImage : ''),
        productUrl: out.productUrl || local.productUrl || local.websiteUrl || '',
        description: takeDescription ? localDescription : out.description,
        price: out.price > 0 ? out.price : (localPrice > 0 ? localPrice : 0),
    };
}

/**
 * Matches one line with the auto-detect matcher. Resolves { ok, product }, or { ok: false,
 * error } (with `noMatch` when the matcher found no catalogue product). Rejects with an
 * AbortError when `signal` aborts.
 */
export async function matchLine(line, { apiBase = '', providerModel = null, tier = 'mid', signal, fetchImpl, timeoutMs = LINE_TIMEOUT_MS } = {}) {
    const doFetch = fetchImpl || globalThis.fetch;
    const images = Array.isArray(line?.images) ? line.images : [];
    const body = {
        description: line?.query || line?.description || '',
        qty: line?.qty || '1',
        unit: line?.unit || 'Nos',
        tier,
        ...(providerModel ? { providerModel } : {}),
        ...(images[0] ? { imageUrl: images[0], imageAssets: images.slice(0, 3).map((url) => ({ url })) } : {}),
    };
    // The run's signal, or this line's own time limit, ends the request.
    const request = new AbortController();
    const stop = () => request.abort();
    if (signal?.aborted) request.abort();
    else signal?.addEventListener?.('abort', stop, { once: true });
    let timedOut = false;
    const timer = timeoutMs > 0 ? setTimeout(() => {
        timedOut = true;
        request.abort();
    }, timeoutMs) : null;
    let res;
    let data = null;
    try {
        res = await doFetch(`${apiBase}/api/ve-match-auto`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: request.signal,
        });
        try {
            data = await res.json();
        } catch (e) {
            if (request.signal.aborted) throw e;
            data = null;
        }
    } catch (e) {
        if (timedOut && !signal?.aborted) return { ok: false, error: 'The matcher took too long for this line' };
        throw e;
    } finally {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener?.('abort', stop);
    }
    const message = String(data?.error_message || data?.message || '');
    if (res.ok && data?.status === 'no_match') return { ok: false, noMatch: true, error: message || 'No catalogue product for this line' };
    if (!res.ok || data?.status !== 'success' || !data?.product) {
        return { ok: false, error: message || `The matcher answered ${res.status}` };
    }
    const product = productOf(data);
    return isUsableProduct(product) ? { ok: true, product } : { ok: false, noMatch: true, error: 'No catalogue product for this line' };
}

/**
 * Counts of a run: lines answered, matched, exact (the line named its product), without
 * a catalogue product (missing), and failed (the matcher could not answer).
 */
export function matchStats(results = []) {
    let done = 0;
    let found = 0;
    let exact = 0;
    let missing = 0;
    let failed = 0;
    let firstError = '';
    for (const r of results) {
        if (!r || r.aborted) continue;
        done++;
        if (r.ok) {
            found++;
            if (/^EXACT/i.test(r.product?.tier || '')) exact++;
        } else if (r.noMatch) {
            missing++;
        } else {
            failed++;
            if (!firstError && r.error) firstError = r.error;
        }
    }
    return { done, found, exact, missing, failed, firstError };
}

/**
 * Matches the lines a few at a time; identical lines share one answer. Stops taking new
 * lines once `signal` aborts (lines not reached stay undefined in the results).
 */
export async function runQuickMatch(lines, { match, concurrency = MATCH_CONCURRENCY, signal, onProgress } = {}) {
    const results = new Array(lines.length);
    const shared = new Map();
    let next = 0;
    const worker = async () => {
        while (next < lines.length && !signal?.aborted) {
            const i = next++;
            const line = lines[i];
            const key = lineMatchKey(line);
            let pending = shared.get(key);
            if (!pending) {
                pending = Promise.resolve()
                    .then(() => match(line))
                    .catch((e) => ({ ok: false, aborted: e?.name === 'AbortError' || !!signal?.aborted, error: e?.message || String(e) }));
                shared.set(key, pending);
            }
            const result = await pending;
            results[i] = result;
            if (result?.aborted) continue;
            onProgress?.({ ...matchStats(results), total: lines.length, line, result });
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, lines.length)) }, worker));
    return results;
}

/** The currency most priced products are in (the offer's currency before costing). */
export function offerCurrency(results = [], fallback = 'USD') {
    const counts = new Map();
    for (const r of results) {
        const c = r?.ok && r.product?.price > 0 ? r.product.currency : '';
        if (c) counts.set(c, (counts.get(c) || 0) + 1);
    }
    let best = fallback;
    let n = 0;
    counts.forEach((v, c) => {
        if (v > n) {
            best = c;
            n = v;
        }
    });
    return best;
}

/** Costing that leaves catalogue prices as they are (VAT 5%, the GCC default). */
export const neutralFactors = (currency = 'USD') => ({
    profit: 0, freight: 0, customs: 0, installation: 0, vat: 5, fromCurrency: currency, toCurrency: currency, exchangeRate: 1,
});

/** The multiplier costing factors put on a base price (margins, then the exchange rate). */
export function costMultiplier(factors) {
    if (!factors) return 1;
    const margin = ((Number(factors.profit) || 0) + (Number(factors.freight) || 0) + (Number(factors.customs) || 0) + (Number(factors.installation) || 0)) / 100;
    return (Number(factors.exchangeRate) || 1) * (1 + margin);
}

const blankCells = () => Array.from({ length: EMPTY_CELLS }, () => ({ value: '' }));
const imageCell = (urls) => {
    const list = (urls || []).filter(Boolean);
    return { value: '', image: list[0] || null, images: list.map((url) => ({ url })) };
};

const ROW_META = ['code', 'categoryHint', 'sectionLabel', 'sectionCategory', 'sectionSubheader', 'submissionTitle', 'pageNum'];
const rowMeta = (row) => Object.fromEntries(ROW_META.filter((k) => row[k] != null && row[k] !== '').map((k) => [k, row[k]]));

/** A heading of the source table (a section title or a heading row), or '' for none. */
function headingOf(row, header, col) {
    const texts = row.cells.map(cellText).filter(Boolean);
    if (!texts.length) return '';
    // Column labels repeated on a later page are not headings.
    const labels = new Set((header || []).map((h) => String(h ?? '').trim().toLowerCase()).filter(Boolean));
    if (texts.filter((t) => labels.has(t.toLowerCase())).length >= 2) return '';
    const own = col.description >= 0 ? cellText(row.cells[col.description]) : '';
    const title = own || texts.join(' — ');
    return SUMMARY_TEXT.test(title) ? '' : title.slice(0, 300);
}

/**
 * The matched offer: one table per source table in the Value Engineered layout, each
 * line with its product (picture, description, brand, model) and its price costed with
 * `factors`. A line without a product keeps its own words, pictures and rate. Section
 * titles stay as headings; printed totals are left out (the offer has its own).
 */
export function matchedOfferTables(sourceTables = [], lines = [], results = [], factors = null) {
    const byKey = new Map(lines.map((line, i) => [line.key, { line, result: results[i] }]));
    const k = costMultiplier(factors);
    const many = (sourceTables || []).length > 1;
    return (sourceTables || []).map((table, t) => {
        const header = table?.header || [];
        const source = Array.isArray(table?.rows) ? table.rows : [];
        const col = lineColumns(header, source);
        const rows = [];
        source.forEach((row, r) => {
            if (!row || !Array.isArray(row.cells)) return;
            const hit = byKey.get(`${t}:${r}`);
            if (!hit) {
                if (row.isSummary || row.isOptionRow || row.isSetSubItem) return;
                const title = headingOf(row, header, col);
                if (!title) return;
                const cells = blankCells();
                cells[2] = { value: title };
                rows.push({ ...rowMeta(row), isHeader: true, cells });
                return;
            }
            const { line, result } = hit;
            const product = result?.ok && isUsableProduct(result.product) ? result.product : null;
            const qty = parseNumber(line.qty);
            const base = product && product.price > 0 ? product.price : parseNumber(line.rate);
            const rate = Number.isFinite(base) && base > 0 ? round2(base * k) : 0;
            const amount = rate > 0 ? round2((qty > 0 ? qty : 1) * rate) : 0;
            const description = product && product.description.length > 2 ? product.description : line.description;
            rows.push({
                ...rowMeta(row),
                // the BOQ line's own words, for Design & Build to match the drawn furniture
                sourceDescription: line.description,
                selectedBrand: product?.brand || line.brand || '',
                selectedModel: product?.model || line.model || '',
                selectedMainCat: product?.mainCategory || '',
                selectedSubCat: product?.subCategory || '',
                productUrl: product?.productUrl || '',
                location: line.location || row.location || '',
                scope: line.scope || row.scope || '',
                matchTier: product?.tier || '',
                cells: [
                    { value: line.sn || String(rows.filter((x) => !x.isHeader).length + 1) },
                    imageCell(product?.imageUrl ? [product.imageUrl] : line.images),
                    { value: description },
                    { value: product?.brand || line.brand || '' },
                    { value: product?.model || line.model || '' },
                    { value: line.qty || '' },
                    { value: line.unit || (line.qty ? 'Nos' : '') },
                    { value: rate > 0 ? rate.toFixed(2) : '' },
                    { value: amount > 0 ? amount.toFixed(2) : '' },
                ],
            });
        });
        const name = String(table?.sheetName || '').trim();
        return {
            sheetName: many ? `${name || `Sheet ${t + 1}`} — Matched` : 'Matched Offer',
            header: [...MATCHED_OFFER_HEADER],
            columnCount: MATCHED_OFFER_HEADER.length,
            recategorizeMode: table?.recategorizeMode || 'original',
            rows,
        };
    });
}
