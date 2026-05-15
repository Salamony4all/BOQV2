/**
 * Excel Database Manager
 * Handles import/export of brand product data to/from Excel
 */

import ExcelJS from 'exceljs';

class ExcelDbManager {
    async exportToExcel(brandData) {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Products');

        sheet.columns = [
            { header: 'Main Category', key: 'mainCategory', width: 20 },
            { header: 'Sub Category', key: 'subCategory', width: 20 },
            { header: 'Family', key: 'family', width: 20 },
            { header: 'Model', key: 'model', width: 25 },
            { header: 'Description', key: 'description', width: 40 },
            { header: 'Image URL', key: 'imageUrl', width: 30 },
            { header: 'Price', key: 'price', width: 15 },
            { header: 'Product URL', key: 'productUrl', width: 30 }
        ];

        if (brandData.products) {
            sheet.addRows(brandData.products);
        }
        return workbook;
    }

    async importFromExcel(filePath) {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);
        const sheet = workbook.getWorksheet(1);
        if (!sheet) return [];

        const products = [];
        const headers = {};

        // 1. Identify columns from the first row
        const firstRow = sheet.getRow(1);
        firstRow.eachCell((cell, colNumber) => {
            const header = String(cell.value || '').toLowerCase().trim();
            if (header.includes('main category')) headers.mainCategory = colNumber;
            else if (header.includes('sub category')) headers.subCategory = colNumber;
            else if (header.includes('family')) headers.family = colNumber;
            else if (header.includes('model')) headers.model = colNumber;
            else if (header.includes('description')) headers.description = colNumber;
            else if (header.includes('image url')) headers.imageUrl = colNumber;
            else if (header.includes('price')) headers.price = colNumber;
            else if (header.includes('product url')) headers.productUrl = colNumber;
        });

        // Fallback to indices if headers not found (backward compatibility)
        const getVal = (row, key, index) => {
            const col = headers[key] || index;
            const cell = row.getCell(col);
            return cell.value;
        };

        sheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;
            
            const model = getVal(row, 'model', 4);
            if (!model || String(model).trim() === '') return; // Skip rows without model

            const priceVal = getVal(row, 'price', 7);
            let price = 0;
            if (priceVal !== null && priceVal !== undefined) {
                if (typeof priceVal === 'number') {
                    price = priceVal;
                } else if (typeof priceVal === 'object' && priceVal.result) { // Formula result
                    price = parseFloat(priceVal.result) || 0;
                } else {
                    price = parseFloat(String(priceVal).replace(/[^0-9.-]+/g, '')) || 0;
                }
            }

            products.push({
                mainCategory: String(getVal(row, 'mainCategory', 1) || '').trim(),
                subCategory: String(getVal(row, 'subCategory', 2) || '').trim(),
                family: String(getVal(row, 'family', 3) || '').trim(),
                model: String(model).trim(),
                description: String(getVal(row, 'description', 5) || '').trim(),
                imageUrl: String(getVal(row, 'imageUrl', 6) || '').trim(),
                price: price,
                productUrl: String(getVal(row, 'productUrl', 8) || '').trim()
            });
        });
        return products;
    }
}

export { ExcelDbManager };
