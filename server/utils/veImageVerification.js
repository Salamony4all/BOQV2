/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  Spatial + OCR Image Pairing Verifier & Metadata Enrichment             │
 * └─────────────────────────────────────────────────────────────────────────┘
 * Matches extracted spatial document crops with table rows and verifies them
 * against OCR tokens, brand names, and model keywords without sending raw bytes.
 */

export function verifyImagePairing({
  rowBoundingBox = null,
  imageAssets = [],
  ocrTokens = [],
  matchedProduct = null
}) {
  if (!imageAssets || imageAssets.length === 0) {
    return {
      status: 'no_images',
      pairingConfidence: 0,
      selectedImage: matchedProduct?.imageUrl || null,
      candidates: []
    };
  }

  // 1. Spatial Proximity Verification (if coordinates exist from MuPDF / layout engine)
  const scoredImages = imageAssets.map((asset, idx) => {
    let spatialScore = 0.5;
    const assetUrl = typeof asset === 'string' ? asset : (asset.url || asset.path || '');
    const bbox = asset.bbox || asset.box || null;

    if (rowBoundingBox && bbox) {
      const rowY1 = rowBoundingBox.y1 ?? rowBoundingBox.top ?? 0;
      const rowY2 = rowBoundingBox.y2 ?? rowBoundingBox.bottom ?? 0;
      const assetY1 = bbox.y1 ?? bbox.top ?? 0;
      const assetY2 = bbox.y2 ?? bbox.bottom ?? 0;

      const verticalOverlap = Math.max(0, Math.min(rowY2, assetY2) - Math.max(rowY1, assetY1));
      const rowHeight = rowY2 - rowY1;
      
      if (rowHeight > 0 && verticalOverlap > 0) {
        spatialScore = Math.min(1.0, verticalOverlap / rowHeight + 0.2);
      } else {
        // Compute Euclidean distance from centers if no direct overlap
        const rowCenterY = (rowY1 + rowY2) / 2;
        const assetCenterY = (assetY1 + assetY2) / 2;
        const distance = Math.abs(rowCenterY - assetCenterY);
        spatialScore = Math.max(0.1, 1.0 - (distance / 500));
      }
    }

    // 2. OCR Token Overlap Verification
    let ocrScore = 0.5;
    const rawOcr = asset.ocrText || asset.text || (Array.isArray(ocrTokens) ? ocrTokens.join(' ') : '');
    if (rawOcr && matchedProduct) {
      const ocrLower = String(rawOcr).toLowerCase();
      const modelLower = String(matchedProduct.model || '').toLowerCase();
      const brandLower = String(matchedProduct.brand || '').toLowerCase();

      let hits = 0;
      let totalChecks = 0;

      if (brandLower && brandLower.length > 2) {
        totalChecks++;
        if (ocrLower.includes(brandLower)) hits++;
      }

      if (modelLower && modelLower.length > 2) {
        const modelWords = modelLower.split(/\s+/).filter(w => w.length > 2);
        for (const word of modelWords) {
          totalChecks++;
          if (ocrLower.includes(word)) hits++;
        }
      }

      if (totalChecks > 0) {
        ocrScore = hits / totalChecks;
      }
    }

    // Combine Spatial (60%) and OCR (40%)
    const pairConfidence = Math.min(1.0, (0.60 * spatialScore) + (0.40 * ocrScore));
    const confidencePct = Math.round(pairConfidence * 100);

    return {
      index: idx,
      url: assetUrl,
      spatialScore: parseFloat(spatialScore.toFixed(3)),
      ocrScore: parseFloat(ocrScore.toFixed(3)),
      pairConfidence: confidencePct,
      ocrSnippet: rawOcr ? rawOcr.slice(0, 100) : ''
    };
  }).sort((a, b) => b.pairConfidence - a.pairConfidence);

  const topMatch = scoredImages[0];
  const isVerified = topMatch && topMatch.pairConfidence >= 75;

  return {
    status: isVerified ? 'verified' : (topMatch ? 'ambiguous' : 'not_found'),
    pairingConfidence: topMatch ? topMatch.pairConfidence : 0,
    selectedImage: topMatch ? topMatch.url : (matchedProduct?.imageUrl || null),
    candidates: scoredImages
  };
}
