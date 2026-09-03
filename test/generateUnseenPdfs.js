import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import fs from 'fs';

const TARGET_DIR = './test_unseen_pdfs';
if (!fs.existsSync(TARGET_DIR)) fs.mkdirSync(TARGET_DIR);

// ─────────────────────────────────────────────────────────────────────────────
// 1. Unseen PDF 1: Reversed Columns Commercial BOQ
// ─────────────────────────────────────────────────────────────────────────────
function generateReversedBoq() {
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(16);
  doc.text('AL-FAHAD COMMERCIAL COMPLEX — BILL OF QUANTITIES', 14, 15);
  doc.setFontSize(10);
  doc.text('Contract Package C-401 | Architectural Fit-Out & Joinery', 14, 22);

  const head = [['Total Value ($)', 'Unit Cost ($)', 'Estimated Quantity', 'Measurement', 'Scope & Description of Work', 'Ref Code', 'Item #']];
  const body = [
    ['$4,500.00', '$450.00', '10', 'Nos', 'Executive High-Back Ergonomic Swivel Chair with Synchro Mechanism and Adjustable Lumbar Support in Genuine Black Leather', 'FUR-EXEC-01', '1.01'],
    ['$12,800.00', '$3,200.00', '4', 'Units', 'Linear 4-Person Workstation Cluster (2800x1400x750mm) with Central Acoustic Fabric Divider and Integrated Power/Data Raceway', 'FUR-WS-04', '1.02'],
    ['$6,400.00', '$6,400.00', '1', 'Item', '12-Person Boat-Shaped Boardroom Conference Table (3600x1400x750mm) in Natural Oak Veneer with Brushed Aluminum Cable Grommets', 'FUR-CONF-12', '1.03'],
    ['$3,840.00', '$320.00', '12', 'Nos', 'Medium-Back Cantilever Visitor / Conference Meeting Chair on Heavy-Duty Chrome Sled Frame with Anti-Tip Glides', 'FUR-VIS-02', '1.04'],
    ['$5,100.00', '$1,700.00', '3', 'Sets', 'High-Back Acoustic Lounge Focus Pod 2-Seater Sofa with Sound-Absorbing Side Panels in Commercial Fabric', 'FUR-LNG-02', '1.05'],
    ['$3,600.00', '$600.00', '6', 'Nos', 'Full-Height Wooden Storage Credenza Cabinet (1600x450x1200mm) with Sliding Tambour Doors and 3 Internal Adjustable Shelves', 'FUR-STOR-01', '1.06'],
    ['$2,250.00', '$750.00', '3', 'Nos', 'Breakout High-Top Bar Table (1800x600x1050mm) with Solid Wood Top and Matte Black Powder-Coated Metal Frame', 'FUR-BAR-01', '1.07'],
    ['$1,920.00', '$240.00', '8', 'Nos', 'Matching Swivel Bar Stool with Footrest Ring and Padded Polyurethane Upholstered Seat (Seat Height 750mm)', 'FUR-STL-01', '1.08']
  ];

  autoTable(doc, {
    head,
    body,
    startY: 28,
    theme: 'grid',
    headStyles: { fillColor: [41, 128, 185], textColor: 255, fontStyle: 'bold' },
    styles: { fontSize: 8, cellPadding: 3 },
    foot: [['$40,410.00', '', '47', '', 'SUBTOTAL — ARCHITECTURAL FURNITURE & JOINERY', '', '']]
  });

  const path = `${TARGET_DIR}/unseen_reversed_order_boq.pdf`;
  fs.writeFileSync(path, Buffer.from(doc.output('arraybuffer')));
  console.log('✅ Generated:', path);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Unseen PDF 2: Hospitality Hotel FF&E Master Schedule
// ─────────────────────────────────────────────────────────────────────────────
function generateHospitalityFfe() {
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(16);
  doc.text('GRAND HYATT LUXURY RESORT — FF&E TENDER SCHEDULE', 14, 15);
  doc.setFontSize(10);
  doc.text('Phase 2 Guestrooms & Presidential Suites | Interior Design Spec R3', 14, 22);

  const head = [['Mark', 'Item Description & Manufacturer Specs', 'Finish / Upholstery', 'Dimensions (W x D x H)', 'Area / Location', 'Qty', 'Unit', 'Unit Rate', 'Extended Amount']];
  const body = [
    ['PS-BED-01', 'King Size Headboard & Custom Upholstered Bed Frame with Integrated LED Reading Sconces and Brass Trims', 'Walnut Veneer & Velvet Fabric', '2000 x 2100 x 1400 mm', 'Presidential Suite', '6', 'Sets', '$2,850.00', '$17,100.00'],
    ['PS-NST-01', 'Nightstand Bedside Table with Single Soft-Close Drawer and Marble Top Inset', 'Carrara White Marble & Walnut', '600 x 450 x 550 mm', 'Presidential Suite', '12', 'Nos', '$620.00', '$7,440.00'],
    ['PS-SFA-01', 'Curved 3-Seater Living Room Lounge Sofa with High-Density Foam Cushions and Brass Plinth Base', 'Textured Boucle Fabric', '2400 x 950 x 780 mm', 'Living Suite', '6', 'Nos', '$3,400.00', '$20,400.00'],
    ['PS-ARM-01', 'Sculptural Swivel Occasional Accent Armchair with 360 Degree Return Swivel Base', 'Mustard Velvet Upholstery', '850 x 800 x 820 mm', 'Living Suite', '12', 'Nos', '$1,150.00', '$13,800.00'],
    ['PS-CFT-01', 'Organic Pebble-Shaped Coffee Table with Fluted Solid Oak Base and Bronze Glass Top', 'Fluted Oak & Bronze Glass', '1300 x 750 x 420 mm', 'Living Suite', '6', 'Nos', '$980.00', '$5,880.00'],
    ['PS-WRK-01', 'Executive Writing Desk with Concealed Cable Tray, Wireless Charging Pad and Leather Desk Inset', 'Smoked Eucalyptus Veneer', '1600 x 700 x 750 mm', 'Study Area', '6', 'Nos', '$1,850.00', '$11,100.00'],
    ['PS-DSK-01', 'Ergonomic Mid-Back Leather Desk Chair with Tilt Limiter and Castors on Bronze 5-Star Base', 'Cognac Full-Grain Leather', '650 x 650 x 920 mm', 'Study Area', '6', 'Nos', '$780.00', '$4,680.00'],
    ['PS-DIN-01', 'Round Dining Table for 6 Persons with Brushed Titanium Column Base and Porcelain Top', 'Calacatta Gold Porcelain Top', 'Dia 1500 x 750 mm', 'Dining Area', '6', 'Nos', '$2,200.00', '$13,200.00'],
    ['PS-DNC-01', 'Upholstered Dining Chair with Curved Backrest and Tapered Metal Legs in Brushed Brass', 'Stain-Resistant Performance Fabric', '560 x 580 x 840 mm', 'Dining Area', '36', 'Nos', '$420.00', '$15,120.00']
  ];

  autoTable(doc, {
    head,
    body,
    startY: 28,
    theme: 'grid',
    headStyles: { fillColor: [52, 73, 94], textColor: 255, fontStyle: 'bold' },
    styles: { fontSize: 8, cellPadding: 3 },
    foot: [['', 'TOTAL GRAND HYATT FF&E TENDER SCHEDULE (OMR / USD)', '', '', '', '96', 'Items', '', '$108,720.00']]
  });

  const path = `${TARGET_DIR}/unseen_hospitality_ffe_boq.pdf`;
  fs.writeFileSync(path, Buffer.from(doc.output('arraybuffer')));
  console.log('✅ Generated:', path);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Unseen PDF 3: MEP & Civil Engineering Infrastructure Schedule
// ─────────────────────────────────────────────────────────────────────────────
function generateMepCivilBoq() {
  const doc = new jsPDF({ orientation: 'portrait' });
  doc.setFontSize(15);
  doc.text('NATIONAL DATA CENTER — CIVIL & MEP INFRASTRUCTURE BOQ', 14, 15);
  doc.setFontSize(9);
  doc.text('Tender Ref: NDC-2026-MEP-009 | Location: Cyber Gateway Campus', 14, 21);

  const head = [['Serial', 'Code', 'Specification Particulars of Materials & Labor', 'UOM', 'Tender Qty', 'Rate (OMR)', 'Net Cost (OMR)']];
  const body = [
    ['1.0', 'DIV-01', 'DIVISION 01 — GENERAL REQUIREMENTS & SITE PRELIMINARIES', 'Sum', '1.0', '15,000.00', '15,000.00'],
    ['2.1', 'MEP-01', 'Supply and installation of Heavy Duty Modular Raised Access Flooring (600x600x35mm) with Antistatic High-Pressure Laminate Finish and Adjustable Pedestals (FFH 450mm)', 'SQM', '450.0', '28.50', '12,825.00'],
    ['2.2', 'MEP-02', 'Underfloor Cable Tray Grid (300x50mm Galvanized Perforated Steel) with All Couplers, Bends, Risers and Earthing Terminals', 'LM', '320.0', '18.00', '5,760.00'],
    ['3.1', 'NOC-01', 'Network Operations Center (NOC) Ergonomic Curved Console Desk for 3 Operators with Heavy Duty Motorized Dual-Tier Height Adjustment (4200x1200x720-1200mm)', 'Nos', '2.0', '6,500.00', '13,000.00'],
    ['3.2', 'NOC-02', '24/7 Continuous Duty Multi-Shift Ergonomic Control Room Operator Chair with 200kg Load Rating, Height and Depth Adjustable Lumbar, 4D Armrests', 'Nos', '6.0', '750.00', '4,500.00'],
    ['4.1', 'SRV-01', 'Standard 19-inch 42U Server Rack Enclosure (800x1200x2000mm) with Perforated Front/Rear Mesh Doors, Key Locks, Dual Vertical PDUs and Cable Rings', 'Units', '24.0', '980.00', '23,520.00'],
    ['4.2', 'SRV-02', 'Cold Aisle Containment Sliding End Doors and Roof Ceiling Panels (Aisle Width 1200mm) with Clear Polycarbonate and Fire Release Mechanism', 'Sets', '2.0', '3,200.00', '6,400.00'],
    ['5.1', 'FIR-01', 'FM-200 Clean Agent Total Flooding Fire Suppression System Cylinders, Distribution Piping, Nozzles and Interlocking Control Panel with Detection Smoke Sensors', 'Lot', '1.0', '18,500.00', '18,500.00']
  ];

  autoTable(doc, {
    head,
    body,
    startY: 26,
    theme: 'grid',
    headStyles: { fillColor: [39, 174, 96], textColor: 255, fontStyle: 'bold' },
    styles: { fontSize: 8, cellPadding: 2.5 },
    foot: [['', '', 'TOTAL CIVIL & MEP INFRASTRUCTURE SCHEDULE', '', '', 'OMR', '99,505.00']]
  });

  const path = `${TARGET_DIR}/unseen_mep_infrastructure_boq.pdf`;
  fs.writeFileSync(path, Buffer.from(doc.output('arraybuffer')));
  console.log('✅ Generated:', path);
}

generateReversedBoq();
generateHospitalityFfe();
generateMepCivilBoq();
