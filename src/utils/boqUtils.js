/**
 * Simple task queue with concurrency control
 */
export class Queue {
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

/**
 * Common BOQ header row detection logic
 */
export const isHeaderRow = (desc, row = {}) => {
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
        'subtotal', 'total amount', 'grand total', 'net total', 'discount',
        'main category', 'maincategory', 'main_category', 'sub category', 'subcategory', 'sub_category', 'family'
    ];

    if (exactHeaders.some(kw => normalized === kw || normalized.startsWith(kw + ' '))) return true;
    
    // More restrictive regex for generic markers
    if (/^(location|area|floor|block|zone|room|item\s*no|s\.no|ref|item\s+\d+)$/i.test(normalized)) return true;
    
    if (/^(group|type|section|category|list)\s+of\s/i.test(normalized)) return true;

    return false;
};

/**
 * Sleep utility
 */
export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Canonical description-column resolver for extracted BOQ tables.
 * Priority-tiered header match (strong "desc"-ish names first) so weak terms
 * like "product" can never shadow "Item Description" (e.g. the canonical
 * header ['S.No','Image','Product Code','Item Description',...] where
 * first-match-wins used to lock onto the empty Product Code column).
 * Falls back to the wordiest column when no header name matches at all.
 */
export const findDescColumn = (header = [], rows = []) => {
    const H = header.map(h => String(h ?? '').toLowerCase());
    const tiers = [
        /desc/,                                                  // description, item description, desc., descrption, material description
        /detail|spec|particular|material|finish/,                // details, specs, specification(s), finish
        /\bitem\b(?!.*\b(no|code|ref)\b)|product(?!.*\b(code|ref|no)\b)/ // item/product name-ish, never code/ref columns
    ];
    for (const rx of tiers) {
        const i = H.findIndex(h => h && rx.test(h));
        if (i !== -1) return i;
    }
    // Content fallback: description is the wordiest column by average cell length.
    let best = -1, bestLen = 0;
    const width = Math.max(H.length, rows[0]?.cells?.length || 0);
    for (let c = 0; c < width; c++) {
        const sample = rows.slice(0, 30);
        const avg = sample.length
            ? sample.reduce((a, r) => a + String(r?.cells?.[c]?.value ?? '').length, 0) / sample.length
            : 0;
        if (avg > bestLen) { bestLen = avg; best = c; }
    }
    return bestLen >= 12 ? best : 1; // real desc columns are wordy; else legacy default idx 1
};

/**
 * Batch processor
 */
export const batch = async (items, limit, fn) => {
    for (let i = 0; i < items.length; i += limit) {
        const chunk = items.slice(i, i + limit);
        await Promise.all(chunk.map(fn));
    }
};
