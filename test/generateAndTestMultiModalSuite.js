/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  MULTIMODAL REAL-WORLD DOCUMENT SUITE GENERATOR & BENCHMARK             │
 * │  Generates & benchmarks genuine Cutsheets, Invoices, Delivery Notes,    │
 * │  Product Presentation Decks & Spec Sheets WITH EMBEDDED IMAGES.         │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import fs from 'fs';
import path from 'path';
import { extractMultiplePdfsV21 } from '../server/universalPatternParsersVercel.v22.dynamic-header-boq-spec.js';

const OUTPUT_DIR = './test_multimodal_suite';
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Load sample real PNG images for embedding
function getSampleImages() {
  const samplePaths = [
    'PDF/Picture1.png',
    'PDF/bordered.png',
    'PDF/borderless.png'
  ];
  return samplePaths.map(p => {
    if (fs.existsSync(p)) {
      return 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
    }
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  });
}

/**
 * 1. Manufacturer Technical Cut-Sheet (Spec Cards with Photos)
 */
function generateTechnicalCutSheet(images) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  
  doc.setFontSize(16);
  doc.setTextColor(20, 40, 80);
  doc.text('HERMAN MILLER / STEELCASE — FF&E TECHNICAL CUT-SHEET SPECIFICATION', 40, 40);
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text('Project: Regional Innovation Center | Package: Architectural Loose Seating Cut Sheets', 40, 56);

  const items = [
    {
      code: 'CH-01',
      title: 'Executive Task Chair',
      specs: 'Ergonomic mesh back, adjustable 4D armrests, pneumatic height adjustment with lumbar support module.',
      finish: 'Frame: Graphite Black / Upholstery: Medley 6001 Fabric',
      dims: 'W685 x D660 x H1040 mm',
      qty: '45 Nos',
      rate: '$480.00',
      total: '$21,600.00'
    },
    {
      code: 'CH-02',
      title: 'High-Back Acoustic Lounge Armchair',
      specs: 'Molded foam shell with acoustic wingback surround, solid European oak 4-star base and swivel mechanism.',
      finish: 'Fabric: Kvadrat Steelcut Trio 3 / Base: Natural Lacquered Oak',
      dims: 'W840 x D820 x H1280 mm',
      qty: '12 Nos',
      rate: '$1,250.00',
      total: '$15,000.00'
    },
    {
      code: 'TB-01',
      title: 'Modular Collaborative Meeting Table',
      specs: 'Chamfered edge solid core laminate top with integrated cable trough, brushed aluminum wire management access hatch.',
      finish: 'Top: Walnut Veneer / Legs: Cast Aluminum Matte White',
      dims: 'W2800 x D1200 x H740 mm',
      qty: '6 Sets',
      rate: '$2,100.00',
      total: '$12,600.00'
    },
    {
      code: 'ST-01',
      title: 'Acoustic Solo Focus Work Booth',
      specs: 'Fully enclosed sound-dampening solo work pod with integrated LED task light, ventilation fan and sit-stand desk.',
      finish: 'Exterior: Sound felt Gray / Interior: Acoustic Wool Felt Anthracite',
      dims: 'W1000 x D1000 x H2200 mm',
      qty: '8 Units',
      rate: '$4,500.00',
      total: '$36,000.00'
    }
  ];

  const tableData = items.map((it, idx) => [
    idx + 1,
    '',
    it.code,
    `${it.title}\n${it.specs}\nFinish: ${it.finish}\nDimensions: ${it.dims}`,
    'Nos',
    it.qty.split(' ')[0],
    it.rate,
    it.total
  ]);

  autoTable(doc, {
    startY: 75,
    head: [['S.No', 'Image', 'Product Code', 'Item Description & Technical Specification', 'Unit', 'Qty', 'Unit Rate', 'Total Amount']],
    body: tableData,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 6, minCellHeight: 65, valign: 'middle' },
    headStyles: { fillColor: [24, 43, 73], textColor: [255, 255, 255] },
    columnStyles: {
      0: { cellWidth: 35 },
      1: { cellWidth: 65 },
      2: { cellWidth: 65 },
      3: { cellWidth: 330 },
      4: { cellWidth: 40 },
      5: { cellWidth: 40 },
      6: { cellWidth: 65 },
      7: { cellWidth: 75 }
    },
    didDrawCell: (data) => {
      if (data.section === 'body' && data.column.index === 1) {
        const img = images[data.row.index % images.length];
        if (img) {
          doc.addImage(img, 'PNG', data.cell.x + 5, data.cell.y + 5, 55, 50);
        }
      }
    }
  });

  const filePath = path.join(OUTPUT_DIR, '01_technical_cutsheet_spec.pdf');
  fs.writeFileSync(filePath, Buffer.from(doc.output('arraybuffer')));
  return filePath;
}

/**
 * 2. Commercial Delivery Note / Dispatch Receipt (with product thumbnails)
 */
function generateDeliveryNote(images) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });

  doc.setFontSize(18);
  doc.setTextColor(30, 41, 59);
  doc.text('COMMERCIAL LOGISTICS & SITE DELIVERY NOTE', 40, 45);

  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text('Delivery Note No: DN-2026-88412 | Date: 01-Sep-2026 | Site: Oman Cultural Complex', 40, 62);
  doc.text('Carrier: FastFreight Logistics LLC | Consignee: Aladrak Engineering LLC', 40, 74);

  const items = [
    {
      code: 'OCC-DL-01',
      desc: 'High-Density Stacking Banquet Chairs with Chromed Steel Sled Base and Fire-Retardant Fabric',
      unit: 'Pcs',
      ordered: '150',
      dispatched: '150',
      status: 'Full Dispatch'
    },
    {
      code: 'OCC-DL-02',
      desc: 'Heavy-Duty Folding Banquet Tables (1800x900mm) with Honeycomb Core and Locking Legs',
      unit: 'Pcs',
      ordered: '30',
      dispatched: '30',
      status: 'Full Dispatch'
    },
    {
      code: 'OCC-DL-03',
      desc: 'Mobile Table Storage Trolley with Heavy-Duty Locking Polyurethane Castors',
      unit: 'Units',
      ordered: '4',
      dispatched: '4',
      status: 'Full Dispatch'
    },
    {
      code: 'OCC-DL-04',
      desc: 'Modular Stage Platform Modules (2000x1000mm) with Adjustable Telescopic Riser Legs',
      unit: 'Decks',
      ordered: '24',
      dispatched: '24',
      status: 'Full Dispatch'
    }
  ];

  const body = items.map((it, idx) => [
    idx + 1,
    '',
    it.code,
    it.desc,
    it.unit,
    it.dispatched,
    it.status
  ]);

  autoTable(doc, {
    startY: 95,
    head: [['Item #', 'Thumbnail', 'Item Code', 'Item Description & Particulars', 'Unit', 'Qty Dispatched', 'Remarks']],
    body: body,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 5, minCellHeight: 60, valign: 'middle' },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
    columnStyles: {
      0: { cellWidth: 35 },
      1: { cellWidth: 60 },
      2: { cellWidth: 70 },
      3: { cellWidth: 200 },
      4: { cellWidth: 40 },
      5: { cellWidth: 55 },
      6: { cellWidth: 60 }
    },
    didDrawCell: (data) => {
      if (data.section === 'body' && data.column.index === 1) {
        const img = images[data.row.index % images.length];
        if (img) {
          doc.addImage(img, 'PNG', data.cell.x + 5, data.cell.y + 5, 50, 48);
        }
      }
    }
  });

  const filePath = path.join(OUTPUT_DIR, '02_commercial_delivery_note.pdf');
  fs.writeFileSync(filePath, Buffer.from(doc.output('arraybuffer')));
  return filePath;
}

/**
 * 3. Commercial Proforma Tax Invoice (with product thumbnails)
 */
function generateTaxInvoice(images) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });

  doc.setFontSize(18);
  doc.setTextColor(15, 23, 42);
  doc.text('PROFORMA COMMERCIAL TAX INVOICE', 40, 45);

  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text('Invoice No: INV-OM-2026-0914 | Date: 01/09/2026 | VAT Reg: OM1100239482', 40, 62);
  doc.text('Billed To: Royal Court Affairs / Muscat Hospitality Group | Currency: USD ($)', 40, 74);

  const items = [
    {
      code: 'INV-ITM-01',
      desc: 'Solid American Walnut 8-Seater Dining Table with Beveled Edge and Brass Ferrule Accents',
      unit: 'Nos',
      qty: '4',
      rate: '$2,400.00',
      total: '$9,600.00'
    },
    {
      code: 'INV-ITM-02',
      desc: 'Hand-Stitched Full Grain Italian Leather Dining Chairs with Solid Walnut Frames',
      unit: 'Nos',
      qty: '32',
      rate: '$450.00',
      total: '$14,400.00'
    },
    {
      code: 'INV-ITM-03',
      desc: 'Bespoke Buffet Sideboard Credenza (2200x500x850mm) with Calacatta Marble Top Inset',
      unit: 'Units',
      qty: '2',
      rate: '$3,800.00',
      total: '$7,600.00'
    },
    {
      code: 'INV-ITM-04',
      desc: 'Curved Velvet Upholstered Sectional Modular Sofa with Down-Filled Cushions',
      unit: 'Sets',
      qty: '3',
      rate: '$5,200.00',
      total: '$15,600.00'
    }
  ];

  const body = items.map((it, idx) => [
    idx + 1,
    '',
    it.code,
    it.desc,
    it.unit,
    it.qty,
    it.rate,
    it.total
  ]);

  autoTable(doc, {
    startY: 95,
    head: [['Item', 'Image', 'Product Code', 'Item Description', 'Unit', 'Qty', 'Unit Rate ($)', 'Total Amount ($)']],
    body: body,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 5, minCellHeight: 60, valign: 'middle' },
    headStyles: { fillColor: [4, 120, 87], textColor: [255, 255, 255] },
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 55 },
      2: { cellWidth: 65 },
      3: { cellWidth: 190 },
      4: { cellWidth: 35 },
      5: { cellWidth: 35 },
      6: { cellWidth: 55 },
      7: { cellWidth: 60 }
    },
    didDrawCell: (data) => {
      if (data.section === 'body' && data.column.index === 1) {
        const img = images[data.row.index % images.length];
        if (img) {
          doc.addImage(img, 'PNG', data.cell.x + 5, data.cell.y + 5, 45, 48);
        }
      }
    }
  });

  const filePath = path.join(OUTPUT_DIR, '03_proforma_invoice_packing_slip.pdf');
  fs.writeFileSync(filePath, Buffer.from(doc.output('arraybuffer')));
  return filePath;
}

/**
 * 4. Architectural FF&E Presentation Deck (Multi-card layout)
 */
function generatePresentationDeck(images) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('PALACE SUITES — ARCHITECTURAL FF&E SPECIFICATION PRESENTATION', 40, 40);

  const items = [
    {
      code: 'PS-FF-01',
      name: 'Presidential Suite King Bed Frame',
      desc: 'Solid mahogany frame with hand-carved fluted headboard upholstered in silk velvet with integrated LED backlight.',
      dims: '2200 x 2100 x 1450 mm',
      supplier: 'Giorgetti / B&B Italia Ref. GI-KB-99',
      qty: '4 Sets',
      rate: '$6,800.00',
      total: '$27,200.00'
    },
    {
      code: 'PS-FF-02',
      name: 'Luxury Bedside Nightstand Pair',
      desc: 'Mahogany veneer carcass with soft-close bronze inlaid drawers and Emperador Dark marble tops.',
      dims: '650 x 500 x 550 mm',
      supplier: 'Poltrona Frau Ref. PF-NT-02',
      qty: '8 Pairs',
      rate: '$1,850.00',
      total: '$14,800.00'
    },
    {
      code: 'PS-FF-03',
      name: 'Master Suite Vanity Dressing Table',
      desc: 'Curved wood dressing table with tri-fold illuminated vanity mirror, brass legs and jewelry tray organizer.',
      dims: '1400 x 600 x 780 mm',
      supplier: 'Minotti Ref. MN-VDT-11',
      qty: '4 Nos',
      rate: '$3,400.00',
      total: '$13,600.00'
    }
  ];

  const body = items.map((it, idx) => [
    idx + 1,
    '',
    it.code,
    `${it.name}\n${it.desc}\nDimensions: ${it.dims}\nSpecified Supplier: ${it.supplier}`,
    'Sets',
    it.qty.split(' ')[0],
    it.rate,
    it.total
  ]);

  autoTable(doc, {
    startY: 65,
    head: [['S.No', 'Product Photo', 'Spec Code', 'Item Description & Specification Details', 'Unit', 'Qty', 'Unit Cost ($)', 'Net Amount ($)']],
    body: body,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 6, minCellHeight: 75, valign: 'middle' },
    headStyles: { fillColor: [88, 28, 135], textColor: [255, 255, 255] },
    columnStyles: {
      0: { cellWidth: 35 },
      1: { cellWidth: 70 },
      2: { cellWidth: 65 },
      3: { cellWidth: 340 },
      4: { cellWidth: 40 },
      5: { cellWidth: 35 },
      6: { cellWidth: 65 },
      7: { cellWidth: 70 }
    },
    didDrawCell: (data) => {
      if (data.section === 'body' && data.column.index === 1) {
        const img = images[data.row.index % images.length];
        if (img) {
          doc.addImage(img, 'PNG', data.cell.x + 5, data.cell.y + 5, 60, 62);
        }
      }
    }
  });

  const filePath = path.join(OUTPUT_DIR, '04_interior_spec_presentation_deck.pdf');
  fs.writeFileSync(filePath, Buffer.from(doc.output('arraybuffer')));
  return filePath;
}

/**
 * 5. Multi-Item Quotation Brochure (Supplier Tender Offer)
 */
function generateQuotationBrochure(images) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  doc.setFontSize(16);
  doc.setTextColor(30, 41, 59);
  doc.text('COMMERCIAL TENDER OFFER & PRODUCT QUOTATION BROCHURE', 40, 40);

  const items = [
    {
      code: 'QT-OFF-01',
      desc: 'Steelcase Gesture Ergonomic Office Chair with 360-degree Rotating Armrests and Platinum Shell Finish',
      unit: 'Nos',
      qty: '80',
      rate: '$620.00',
      total: '$49,600.00'
    },
    {
      code: 'QT-OFF-02',
      desc: 'Herman Miller Ratio Dual Sit-to-Stand Electric Height Adjustable Workstation (1600x800mm)',
      unit: 'Sets',
      qty: '40',
      rate: '$1,150.00',
      total: '$46,000.00'
    },
    {
      code: 'QT-OFF-03',
      desc: 'Framery Q Meeting Pod 4-Person Soundproof Conference Booth with Integrated Video Bar & Display Mount',
      unit: 'Pods',
      qty: '4',
      rate: '$14,500.00',
      total: '$58,000.00'
    },
    {
      code: 'QT-OFF-04',
      desc: 'Knoll Saarinen Tulip Dining / Meeting Table (Dia 1500mm) with Arabescato Marble Top',
      unit: 'Nos',
      qty: '6',
      rate: '$3,800.00',
      total: '$22,800.00'
    }
  ];

  const body = items.map((it, idx) => [
    idx + 1,
    '',
    it.code,
    it.desc,
    it.unit,
    it.qty,
    it.rate,
    it.total
  ]);

  autoTable(doc, {
    startY: 65,
    head: [['Item #', 'Product Image', 'Offer Code', 'Detailed Product Scope & Specification', 'Unit', 'Qty', 'Unit Price ($)', 'Extended Value ($)']],
    body: body,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 6, minCellHeight: 65, valign: 'middle' },
    headStyles: { fillColor: [180, 83, 9], textColor: [255, 255, 255] },
    columnStyles: {
      0: { cellWidth: 35 },
      1: { cellWidth: 65 },
      2: { cellWidth: 70 },
      3: { cellWidth: 330 },
      4: { cellWidth: 40 },
      5: { cellWidth: 40 },
      6: { cellWidth: 65 },
      7: { cellWidth: 75 }
    },
    didDrawCell: (data) => {
      if (data.section === 'body' && data.column.index === 1) {
        const img = images[data.row.index % images.length];
        if (img) {
          doc.addImage(img, 'PNG', data.cell.x + 5, data.cell.y + 5, 55, 52);
        }
      }
    }
  });

  const filePath = path.join(OUTPUT_DIR, '05_multi_item_quotation_brochure.pdf');
  fs.writeFileSync(filePath, Buffer.from(doc.output('arraybuffer')));
  return filePath;
}


export async function runMultiModalSuite() {
  console.log('═══════════════════════════════════════════════════════════════════════════════════');
  console.log('🚀 [Multimodal Document Suite] Generating & Extracting Real-World Documents with IMAGES');
  console.log('═══════════════════════════════════════════════════════════════════════════════════\n');

  const images = getSampleImages();

  console.log('1. Generating Multimodal PDF Documents with Embedded Product Images...');
  const files = [
    { path: generateTechnicalCutSheet(images), name: '01_technical_cutsheet_spec.pdf', type: 'Technical Cut-Sheet' },
    { path: generateDeliveryNote(images), name: '02_commercial_delivery_note.pdf', type: 'Logistics Delivery Note' },
    { path: generateTaxInvoice(images), name: '03_proforma_invoice_packing_slip.pdf', type: 'Proforma Tax Invoice' },
    { path: generatePresentationDeck(images), name: '04_interior_spec_presentation_deck.pdf', type: 'FF&E Presentation Deck' },
    { path: generateQuotationBrochure(images), name: '05_multi_item_quotation_brochure.pdf', type: 'Tender Quotation Brochure' }
  ];

  console.log('   ✅ Generated all 5 multimodal documents with high-res PNG image assets.\n');

  console.log('2. Running Universal PDF & Image Extraction Engine...\n');
  const scorecard = [];
  let passed = 0;
  let total = 0;

  for (const item of files) {
    total++;
    console.log(`▶ [${total}/5] Processing: "${item.name}" (${item.type})`);
    const startTime = Date.now();

    try {
      const result = await extractMultiplePdfsV21([item.path], () => {});
      const elapsed = Date.now() - startTime;

      if (!result || !result.tables || result.tables.length === 0) {
        console.error(`  ❌ FAILED: No tables extracted.`);
        scorecard.push({ name: item.name, type: item.type, status: 'FAILED', reason: 'Zero tables' });
        continue;
      }

      const table = result.tables[0];
      const rowCount = table.rows?.length || 0;
      const colCount = table.header?.length || 0;
      const imageCount = (table.rows || []).reduce((acc, r) => {
        const imgCell = r.cells?.find((c, i) => /(image|thumbnail|photo|picture)/i.test(table.header[i] || ''));
        const hasImg = (imgCell?.images && imgCell.images.length > 0) || Boolean(imgCell?.image) || (Array.isArray(imgCell?.value) ? imgCell.value.length > 0 : Boolean(imgCell?.value && typeof imgCell.value === 'string' && imgCell.value.startsWith('http'))) || (r.images && r.images.length > 0);
        return acc + (hasImg ? 1 : 0);
      }, 0);



      console.log(`  ✅ PASSED (${elapsed}ms): Extracted ${rowCount} rows, ${colCount} cols, ${imageCount} paired images`);
      console.log(`     Headers: ${(table.header || []).join(' | ')}`);
      if (table.rows && table.rows[0]) {
        console.log(`     Sample Item: ${table.rows[0].cells.map(c => typeof c.value === 'string' ? c.value : '[Image]').filter(Boolean).slice(0, 4).join(' — ')}`);
      }

      passed++;
      scorecard.push({
        index: total,
        name: item.name,
        type: item.type,
        status: 'PASSED',
        rows: rowCount,
        columns: colCount,
        pairedImages: imageCount,
        timeMs: elapsed
      });
    } catch (err) {
      console.error(`  ❌ ERROR:`, err.message);
      scorecard.push({ index: total, name: item.name, type: item.type, status: 'ERROR', reason: err.message });
    }
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════════');
  console.log(`📊 MULTIMODAL SCORECARD: ${passed}/${total} Documents Successfully Transformed into Tabled BOQs (${((passed / total) * 100).toFixed(0)}%)`);
  console.log('═══════════════════════════════════════════════════════════════════════════════════\n');

  console.table(scorecard);
  return { passed, total, success: passed === total };
}

runMultiModalSuite().then(res => {
  if (!res.success) process.exit(1);
});
