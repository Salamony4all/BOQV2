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
        const products = [];

        sheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;
            const vals = row.values;
            if (vals.length > 0) {
                products.push({
                    mainCategory: vals[1] ? String(vals[1]).trim() : '',
                    subCategory: vals[2] ? String(vals[2]).trim() : '',
                    family: vals[3] ? String(vals[3]).trim() : '',
                    model: vals[4] ? String(vals[4]).trim() : '',
                    description: vals[5] ? String(vals[5]).trim() : '',
                    imageUrl: vals[6] ? String(vals[6]).trim() : '',
                    price: vals[7] ? parseFloat(String(vals[7]).replace(/[^0-9.-]+/g, '')) || 0 : 0,
                    productUrl: vals[8] ? String(vals[8]).trim() : ''
                });
            }
        });
        return products;
    }
}

export { ExcelDbManager };
