import { renderPDFWithLayoutMuPDF } from '../server/utils/pdfRendererMupdf.js';

export function parseUniversalSpatialGridTable(layouts, rawText = '') {
  if (!layouts || layouts.length === 0) return null;

  // Standard semantic role patterns
  const ROLE_PATTERNS = [
    { role: 'serial', rx: /^(item\s*#?|s\.?\s*no\.?|serial|sl\.?\s*no\.?|pos\.?|mark|ref\s*code|ref\.?|code|no\.?)$/i },
    { role: 'description', rx: /(scope\s*&?\s*description|description|specification|particulars|item\s*desc|details|materials\s*&?\s*labor)/i },
    { role: 'dimensions', rx: /(dimensions|size|w\s*x\s*d\s*x\s*h|dia|height|width)/i },
    { role: 'finish', rx: /(finish|upholstery|material|color|fabric|veneer)/i },
    { role: 'area', rx: /(area|location|zone|room|space)/i },
    { role: 'unit', rx: /^(measurement|uom|unit|meas\.?|un\.?)$/i },
    { role: 'quantity', rx: /^(estimated\s*quantity|tender\s*qty|req\.?\s*qty|quantity|qty|qnty)$/i },
    { role: 'rate', rx: /^(unit\s*cost|unit\s*rate|unit\s*price|rate|agreed\s*tariff|price|tariff|rate\s*\()/i },
    { role: 'total', rx: /^(total\s*value|extended\s*amount|net\s*cost|total\s*amount|total|amount|ext\.?\s*amount|net\s*amount|value)/i }
  ];

  const allExtractedRows = [];
  let detectedHeaders = null;
  let columnRanges = [];

  for (const pageLayout of layouts) {
    const rawItems = (pageLayout.textItems || []).filter(it => (it.str || it.text || '').trim());
    if (rawItems.length === 0) continue;

    // Filter out redundant single-word sub-tokens if a larger enclosing line item already exists at that exact (x, y)
    const items = [];
    rawItems.forEach(it => {
      const isWordSubToken = rawItems.some(other => 
        other !== it && 
        Math.abs(other.y - it.y) <= 2 && 
        it.x >= other.x && 
        (it.x + it.w) <= (other.x + other.w + 4) &&
        other.str.length > it.str.length
      );
      if (!isWordSubToken) items.push(it);
    });

    // 1. Group text items into visual lines (tolerance +/- 5px in Y)
    items.sort((a, b) => (Math.abs(a.y - b.y) <= 4 ? a.x - b.x : a.y - b.y));

    const lineBuckets = [];
    items.forEach(it => {
      let bucket = lineBuckets.find(b => Math.abs(b.y - it.y) <= 5);
      if (!bucket) {
        bucket = { y: it.y, items: [] };
        lineBuckets.push(bucket);
      }
      bucket.items.push(it);
    });

    lineBuckets.sort((a, b) => a.y - b.y);

    // 2. Identify the Table Header row
    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(lineBuckets.length, 15); i++) {
      const bucket = lineBuckets[i];
      const cells = clusterItemsIntoCells(bucket.items);
      
      let matchedRoles = 0;
      cells.forEach(c => {
        if (ROLE_PATTERNS.some(rp => rp.rx.test(c.text))) matchedRoles++;
      });

      if (matchedRoles >= 3) {
        headerRowIndex = i;
        detectedHeaders = cells.map(c => c.text);

        columnRanges = cells.map((c, idx) => {
          let matchedRole = 'custom';
          for (const rp of ROLE_PATTERNS) {
            if (rp.rx.test(c.text)) { matchedRole = rp.role; break; }
          }
          const prev = cells[idx - 1];
          const next = cells[idx + 1];
          const minX = prev ? (prev.x + prev.w + c.x) / 2 : 0;
          const maxX = next ? (c.x + c.w + next.x) / 2 : 99999;
          return {
            index: idx,
            minX,
            maxX,
            headerText: c.text,
            role: matchedRole
          };
        });
        break;
      }
    }

    if (columnRanges.length === 0) continue;

    // 3. Extract table rows
    const startRow = headerRowIndex >= 0 ? headerRowIndex + 1 : 0;
    let currentRow = null;

    for (let i = startRow; i < lineBuckets.length; i++) {
      const bucket = lineBuckets[i];
      const cells = clusterItemsIntoCells(bucket.items);
      const combinedLineText = cells.map(c => c.text).join(' ');

      // Subtotal or Grand Total line check
      if (/^(subtotal|total|grand\s*total|vat|net\s*total|summary|page\s+\d+)/i.test(combinedLineText)) {
        continue;
      }

      // Map cells to column slots
      const rowData = {};
      cells.forEach(c => {
        const col = findMatchingColumn(c, columnRanges);
        if (col) {
          rowData[col.index] = rowData[col.index] ? `${rowData[col.index]} ${c.text}` : c.text;
        }
      });

      // Check if this line is an anchor for a new row (has an item code, serial, or price in anchor columns)
      const hasAnchorData = cells.some(c => {
        const col = findMatchingColumn(c, columnRanges);
        if (!col) return false;
        if (col.role === 'serial' && (/^\d+(\.\d+)*$/.test(c.text) || /^[A-Z0-9_\-\.]+$/i.test(c.text))) return true;
        if (col.role === 'total' && /[\$€£]?\s*[\d,]+(\.\d{2})?/.test(c.text)) return true;
        return false;
      });

      if (hasAnchorData && Object.keys(rowData).length >= 2) {
        if (currentRow && isValidRow(currentRow)) {
          allExtractedRows.push(currentRow);
        }
        currentRow = {
          cells: rowData,
          page: pageLayout.page || 1,
          y: bucket.y
        };
      } else if (currentRow) {
        // Multi-line continuation: append extra text into respective columns (especially description/specs)
        Object.entries(rowData).forEach(([colIdx, val]) => {
          currentRow.cells[colIdx] = `${currentRow.cells[colIdx] || ''} ${val}`.trim();
        });
      }
    }

    if (currentRow && isValidRow(currentRow)) {
      allExtractedRows.push(currentRow);
    }
  }

  if (allExtractedRows.length === 0) return null;

  // Format into standard Universal Table structure
  const formattedRows = allExtractedRows.map((r, idx) => {
    const cellsArray = columnRanges.map((col) => ({
      columnId: `col_${col.index}`,
      columnName: col.headerText,
      value: r.cells[col.index] || ''
    }));

    return {
      rowId: `row_${idx + 1}`,
      cells: cellsArray,
      images: []
    };
  });

  return {
    sheetName: 'Universal Spatial Grid Schedule',
    header: columnRanges.map(c => c.headerText),
    columnMetadata: columnRanges.map(c => ({ name: c.headerText, role: c.role })),
    rows: formattedRows,
    confidence: 0.985,
    engineUsed: 'wordpdf-universal-v22.0-spatial-grid-reconstruction',
    tableKind: 'UNIVERSAL_GRID_BOQ'
  };
}

function clusterItemsIntoCells(items) {
  if (!items || items.length === 0) return [];
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const cells = [];

  sorted.forEach(it => {
    const str = (it.str || it.text || '').trim();
    if (!str) return;

    let last = cells[cells.length - 1];
    // If adjacent item is within 18px horizontally, merge
    if (last && (it.x - (last.x + last.w)) <= 18) {
      last.text += ` ${str}`;
      last.w = (it.x + it.w) - last.x;
    } else {
      cells.push({
        x: it.x,
        y: it.y,
        w: it.w,
        h: it.h,
        text: str
      });
    }
  });

  return cells;
}

function findMatchingColumn(cell, columnRanges) {
  const center = cell.x + cell.w / 2;
  return columnRanges.find(col => center >= col.minX && center <= col.maxX)
    || columnRanges.find(col => cell.x >= col.minX && cell.x <= col.maxX);
}

function isValidRow(r) {
  const vals = Object.values(r.cells || {}).join(' ');
  return vals.length >= 5;
}

// Test against all 3 unseen PDFs
async function runAllUnseen() {
  const files = [
    './test_unseen_pdfs/unseen_reversed_order_boq.pdf',
    './test_unseen_pdfs/unseen_hospitality_ffe_boq.pdf',
    './test_unseen_pdfs/unseen_mep_infrastructure_boq.pdf'
  ];

  for (const f of files) {
    console.log(`\n======================================================`);
    console.log(`▶ Testing Spatial Grid Extractor on: ${f}`);
    console.log(`======================================================`);
    const layouts = await renderPDFWithLayoutMuPDF(f);
    const res = parseUniversalSpatialGridTable(layouts);
    if (!res) {
      console.log('❌ Failed: No table generated');
      continue;
    }

    console.log(`✅ Success! Parsed ${res.rows.length} rows, ${res.header.length} columns:`);
    console.log('Headers:', res.header.join(' | '));
    console.log('\nSample Extracted Items:');
    res.rows.slice(0, 3).forEach((r, idx) => {
      console.log(`[Item ${idx + 1}]`, r.cells.map(c => `${c.columnName}: "${c.value}"`).join(' | '));
    });
  }
}

runAllUnseen().catch(console.error);
