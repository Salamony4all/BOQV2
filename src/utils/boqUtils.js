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
 * Batch processor
 */
export const batch = async (items, limit, fn) => {
    for (let i = 0; i < items.length; i += limit) {
        const chunk = items.slice(i, i + limit);
        await Promise.all(chunk.map(fn));
    }
};
