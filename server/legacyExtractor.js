import XLSX from 'xlsx';
import { extractCleanBoqTablesFromMatrix } from './fastExtractor.js';

/**
 * Legacy Excel (.xls) extractor using SheetJS, backed by the universal
 * BOQ table filtering, header consolidation, and multi-sheet alignment logic.
 * Note: Images are generally NOT supported in .xls by SheetJS alone.
 */
export async function extractLegacyExcelData(filePath) {
    const workbook = XLSX.readFile(filePath);
    const sheetMeta = workbook.Workbook?.Sheets || [];

    const sheetsData = workbook.SheetNames.map((sheetName, idx) => {
        const meta = sheetMeta[idx];
        const state = meta?.Hidden === 1 ? 'hidden' : (meta?.Hidden === 2 ? 'veryHidden' : 'visible');
        const worksheet = workbook.Sheets[sheetName];
        const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: '' });

        const rows = [];
        for (let r = 0; r < rawRows.length; r++) {
            const cells = (rawRows[r] || []).map(v => String(v ?? '').trim());
            if (cells.some(Boolean)) {
                rows.push({ rowNumber: r + 1, cells });
            }
        }

        return {
            name: sheetName,
            sheetId: idx + 1,
            state,
            rows
        };
    });

    const result = extractCleanBoqTablesFromMatrix(sheetsData);
    if (result.tables.length > 0) {
        return {
            tables: result.tables.map(t => ({
                ...t,
                sheetName: 'BOQ Schedule (Legacy)',
                isLegacy: true
            })),
            totalTables: result.tables.length
        };
    }

    return { tables: [], totalTables: 0 };
}
