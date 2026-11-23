// The uploaded plan as a picture. A PDF inside the page (<object>) shows nothing on phones,
// which have no built-in PDF viewer, so page 1 is drawn with pdf.js instead: once per file,
// shared by every place that shows the plan.

const pictures = new Map(); // object URL -> Promise<string | null>
const MAX_PICTURES = 4;

async function drawFirstPage(url, maxSide) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.min.mjs');
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
    }
    const pdf = await pdfjs.getDocument({ url, isEvalSupported: false }).promise;
    try {
        const page = await pdf.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(4, maxSide / Math.max(base.width, base.height));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        await page.render({ canvas, viewport }).promise;
        return canvas.toDataURL('image/jpeg', 0.86);
    } finally {
        pdf.destroy();
    }
}

/** Page 1 of the PDF at `url` as a JPEG data URL (null if it cannot be drawn). */
export function planPicture(url, maxSide = 1600) {
    if (!pictures.has(url)) {
        pictures.set(url, drawFirstPage(url, maxSide).catch((e) => {
            console.warn('[plan preview]', e?.message || e);
            return null;
        }));
        while (pictures.size > MAX_PICTURES) pictures.delete(pictures.keys().next().value);
    }
    return pictures.get(url);
}

export const isPdfPlan = (type, name) => /pdf/i.test(type || '') || /\.pdf$/i.test(name || '');
