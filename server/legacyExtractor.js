import * as XLSX from 'xlsx';
import path from 'path';

/**
 * Legacy Excel (.xls) extractor using SheetJS
 * This is a best-effort extractor for old formats.
 * Note: Images are generally NOT supported in .xls by this library.
 */
export async function extractLegacyExcelData(filePath) {
    const workbook = XLSX.readFile(filePath);
    const tables = [];

    // Header patterns for BOQ detection (Shared with fastExtractor)
    const BOQ_HEADER_KEYWORDS = [/description|desc/i, /qty|quantity/i, /unit/i, /rate|price/i, /amount|total/i, /image|photo/i, /sn|s\.n|no\.|item/i];

    for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: '' });
        
        let headerRow = null;
        let isTableStarted = false;
        const validRows = [];

        for (let i = 0; i < rows.length; i++) {
            const rowValues = rows[i];
            if (!rowValues || rowValues.length === 0) continue;

            const rowStrings = rowValues.map(v => v ? String(v).trim() : '');

            // 1. Detect Header
            if (!isTableStarted) {
                const matchCount = BOQ_HEADER_KEYWORDS.reduce((count, pattern) => {
                    return count + (rowStrings.some(str => pattern.test(str)) ? 1 : 0);
                }, 0);

                if (matchCount >= 2) {
                    isTableStarted = true;
                    headerRow = rowStrings;
                    continue;
                }
                continue;
            }

            // 2. Process Data Rows
            let hasContent = false;
            const rowData = [];
            
            // Limit to header length or row values length
            const colCount = headerRow ? headerRow.length : rowValues.length;

            for (let j = 0; j < colCount; j++) {
                const val = rowValues[j] ? String(rowValues[j]).trim() : '';
                if (val) hasContent = true;

                rowData.push({
                    value: val,
                    images: [], // Images not supported in legacy .xls mode
                    isMerged: false,
                    image: null
                });
            }

            if (hasContent) {
                validRows.push({
                    cells: rowData,
                    isHeader: false,
                    isSummary: false
                });
            }
        }

        if (isTableStarted && validRows.length > 0) {
            tables.push({
                sheetName: sheetName,
                header: headerRow,
                rows: validRows,
                columnCount: headerRow.length
            });
        }
    }

    // Stitch into a single table if multiple found, or return all
    // To match fastExtractor's "BOQ Schedule" stitching:
    if (tables.length > 0) {
        const unifiedRows = [];
        tables.forEach(t => unifiedRows.push(...t.rows));
        
        return {
            tables: [{
                sheetName: "BOQ Schedule (Legacy)",
                rows: unifiedRows,
                columnCount: tables[0].header.length,
                header: tables[0].header,
                isLegacy: true // Mark as legacy so frontend knows images are limited
            }],
            totalTables: 1
        };
    }

    return { tables: [], totalTables: 0 };
}
