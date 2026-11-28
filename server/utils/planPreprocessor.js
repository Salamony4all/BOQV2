/**
 * Hybrid CAD/PDF Preprocessor using bundled `mupdf` (Phase 3.1).
 * Extracts ground-truth vector text (scales, room m², dimension strings, furniture/finish tags),
 * classifies drawing pages, and renders crisp 2048px PNGs for all multimodal providers.
 */

let mupdfPromise = null;
async function getMuPdf() {
  if (!mupdfPromise) {
    mupdfPromise = import('mupdf').then(m => m.default || m);
  }
  return mupdfPromise;
}

function classifySheetType(text = '') {
  const low = text.toLowerCase();
  if (/\b(legend|schedule|symbol\s*key|abbreviation|finish\s*schedule)\b/.test(low)) return 'Legend / Schedule';
  if (/\b(rcp|reflected\s*ceiling|ceiling\s*plan|lighting\s*layout)\b/.test(low)) return 'Reflected Ceiling Plan';
  if (/\b(joinery|millwork|elevation|section\s*detail|reception\s*detail)\b/.test(low)) return 'Joinery / Detail';
  return 'Floor Plan';
}

function extractCadSignals(text = '') {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const scales = Array.from(new Set(clean.match(/\b1\s*:\s*(?:20|25|50|75|100|150|200|250|500)\b/g) || [])).slice(0, 6);
  const areas = Array.from(new Set(clean.match(/\b\d{1,4}(?:\.\d{1,2})?\s*(?:m2|m²|sq\.?\s*m|sqm)\b/gi) || [])).slice(0, 20);
  const tags = Array.from(new Set(clean.match(/\b(?:CH|WS|DK|TB|SF|ST|LC|AC|FL|CPT|PT|DR|GL|JN|RC|FAB|BNQ)[-\s]?\d{1,3}[A-Z]?\b/g) || [])).slice(0, 35);
  const dims = Array.from(new Set(clean.match(/\b[1-9]\d{2,4}\s*[x×]\s*[1-9]\d{2,4}(?:\s*[x×]\s*\d{2,4})?\b/g) || [])).slice(0, 20);

  return {
    scales,
    areas,
    tags,
    dims,
    textSnippet: clean.slice(0, 2200),
  };
}

/**
 * Normalizes uploaded plans (PDF or raster images) into Vision-ready PNG assets + CAD calibration context.
 */
export async function preprocessPlanFiles(filesData = []) {
  const visionAssets = [];
  const pageSummaries = [];

  for (let fIdx = 0; fIdx < filesData.length; fIdx++) {
    const file = filesData[fIdx];
    const isPdf = /pdf/i.test(String(file?.mimeType || '')) || /\.pdf$/i.test(String(file?.originalname || ''));

    if (!isPdf) {
      visionAssets.push({
        base64Data: file.base64Data,
        mimeType: file.mimeType || 'image/png',
        originalname: file.originalname || `sheet_${fIdx + 1}.png`,
      });
      pageSummaries.push(`Sheet "${file.originalname || `Image ${fIdx + 1}`}" [Raster Drawing]`);
      continue;
    }

    try {
      const mupdf = await getMuPdf();
      const buf = Buffer.from(file.base64Data, 'base64');
      const doc = mupdf.Document.openDocument(buf, 'application/pdf');
      const pageCount = Math.min(doc.countPages(), 6);

      for (let p = 0; p < pageCount; p++) {
        const page = doc.loadPage(p);
        const bounds = page.getBounds(); // [x0, y0, x1, y1]
        const w = Math.max(1, bounds[2] - bounds[0]);
        const h = Math.max(1, bounds[3] - bounds[1]);

        let rawText = '';
        try {
          const stext = page.toStructuredText('preserve-whitespace');
          rawText = typeof stext.asText === 'function' ? stext.asText() : '';
        } catch { /* ignore text extraction failure */ }

        const sheetType = classifySheetType(rawText);
        const signals = extractCadSignals(rawText);

        // Render at high resolution (~2048px on longest edge) for crisp symbol & dimension reading
        const scale = Math.min(3.0, Math.max(1.2, 2048 / Math.max(w, h)));
        const matrix = mupdf.Matrix.scale(scale, scale);
        const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
        const pngUint8 = pixmap.asPNG();
        const pngBase64 = Buffer.from(pngUint8).toString('base64');

        visionAssets.push({
          base64Data: pngBase64,
          mimeType: 'image/png',
          originalname: `${file.originalname || 'plan.pdf'} (Page ${p + 1})`,
        });

        const parts = [
          `Page ${p + 1}/${doc.countPages()} (${file.originalname || 'plan.pdf'}) [${sheetType}]`,
          signals.scales.length ? `Scales: ${signals.scales.join(', ')}` : null,
          signals.areas.length ? `Explicit Room Areas: ${signals.areas.join(', ')}` : null,
          signals.tags.length ? `Detected CAD Tags: ${signals.tags.join(', ')}` : null,
          signals.dims.length ? `Dimension Strings: ${signals.dims.join(', ')}` : null,
          signals.textSnippet ? `CAD Text Sample: ${signals.textSnippet}` : null,
        ].filter(Boolean);
        pageSummaries.push(parts.join('\n  '));
      }
    } catch (err) {
      console.warn(`⚠️ [PlanPreprocessor] mupdf fallback for "${file.originalname}":`, err.message);
      visionAssets.push(file);
      pageSummaries.push(`Sheet "${file.originalname || `PDF ${fIdx + 1}`}" (raw PDF fallback)`);
    }
  }

  return {
    visionAssets,
    cadContext: pageSummaries.join('\n\n'),
  };
}
