import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import fs from 'fs';

const TARGET_DIR = './test_unseen_suite';
if (!fs.existsSync(TARGET_DIR)) fs.mkdirSync(TARGET_DIR);

function saveDoc(doc, filename) {
  const path = `${TARGET_DIR}/${filename}`;
  fs.writeFileSync(path, Buffer.from(doc.output('arraybuffer')));
  console.log(`✅ Generated: ${filename}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Educational & University Campus Fit-Out
// ─────────────────────────────────────────────────────────────────────────────
function genUniversityCampus() {
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14).text('SULTAN QABOOS STEM UNIVERSITY — PHASE 2 CAMPUS FIT-OUT', 14, 15);
  doc.setFontSize(9).text('Tender Package: ST-2026-EDU | Faculty of Artificial Intelligence & Robotics', 14, 21);

  const head = [['Item Ref', 'Room Location', 'Item Specification & Technical Standard', 'UOM', 'Tender Qty', 'Unit Rate (OMR)', 'Total Amount (OMR)']];
  const body = [
    ['LAB-001', 'Robotics Lab 101', 'Chemical Resistant Solid Phenolic Core Island Workbench (2400x1200x900mm) with Integrated Gas/Water Taps and Power Turrets', 'Sets', '8', '1,450.00', '11,600.00'],
    ['LAB-002', 'Robotics Lab 101', 'ESD Anti-Static Heavy Duty Polyurethane Lab Stool with Footrest Ring and Conductive Dual-Wheel Glides (Seat H: 550-800mm)', 'Nos', '32', '125.00', '4,000.00'],
    ['LEC-001', 'Auditorium A', 'Fixed Tiered Auditorium Lecture Seating with Auto-Return Anti-Panic Writing Tablet and High-Density Molded Foam Upholstery', 'Seats', '180', '165.00', '29,700.00'],
    ['STU-001', 'Study Commons', 'Modular Acoustic 6-Person Collaborative Work Pod with Power Module, Magnetic Whiteboard and Dimmable LED Lighting', 'Units', '6', '2,800.00', '16,800.00'],
    ['LIB-001', 'Digital Library', 'Double-Sided Cantilever Steel Library Bookcase System (1800x600x2100mm) with 6 Adjustable Shelves in Epoxy Powder Coat', 'Bays', '24', '380.00', '9,120.00'],
    ['OFF-001', 'Faculty Offices', 'Professor Executive L-Shaped Desk (1800x1600x750mm) with Integrated Wire Raceway and 3-Drawer Locking Pedestal', 'Sets', '16', '750.00', '12,000.00']
  ];

  autoTable(doc, { head, body, startY: 26, theme: 'grid', headStyles: { fillColor: [41, 128, 185] }, styles: { fontSize: 8 } });
  saveDoc(doc, '01_university_campus_boq.pdf');
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Healthcare & Hospital Medical Fit-Out
// ─────────────────────────────────────────────────────────────────────────────
function genHospitalMedical() {
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14).text('ROYAL SPECIALIZED HOSPITAL — CLINICAL & WARD FURNITURE SCHEDULE', 14, 15);
  doc.setFontSize(9).text('Department: Critical Care, Emergency & Outpatient Suites | Spec Class: Antibacterial Healthcare Standard', 14, 21);

  const head = [['Mark', 'Clinical Area', 'Equipment & Furniture Description', 'Antimicrobial Finish', 'Unit', 'Qty', 'Unit Price ($)', 'Extended Total ($)']];
  const body = [
    ['MED-ICU-01', 'ICU Ward 4', '5-Function Motorized Electric ICU Patient Bed with Built-in Scale, Trendelenburg Tilt and X-Ray Translucent Backrest', 'Silver-Ion Antibacterial', 'Units', '12', '4,200.00', '50,400.00'],
    ['MED-DOC-02', 'Consultation', 'Physician Examination Desk with Seamless Solid Surface Top and Sealed Infection-Control Cable Gland', 'Solid Surface Acrylic', 'Nos', '18', '950.00', '17,100.00'],
    ['MED-PAT-03', 'Patient Rooms', 'Ergonomic High-Back Medical Patient Armchair with Drop-Down Arms for Side Transfer and Wipeable Vinyl Cover', 'Hospital-Grade Vinyl', 'Nos', '45', '480.00', '21,600.00'],
    ['MED-NUR-04', 'Nurse Station', 'Curved Central Nurse Operations Counter (4800x1800x1100mm) with Dual Work Tier and Seamless Solid Surface Facade', 'Corian Solid Surface', 'Sets', '4', '6,800.00', '27,200.00'],
    ['MED-STL-05', 'Operating Theater', 'Stainless Steel 304 Seamless Surgical Foot-Operated Swivel Stool with Fluid-Resistant Seamless Vinyl Cushion', 'Grade 304 Stainless', 'Nos', '16', '290.00', '4,640.00']
  ];

  autoTable(doc, { head, body, startY: 26, theme: 'grid', headStyles: { fillColor: [22, 160, 133] }, styles: { fontSize: 8 } });
  saveDoc(doc, '02_hospital_medical_boq.pdf');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Airport Terminal & Transit Hub
// ─────────────────────────────────────────────────────────────────────────────
function genAirportTransit() {
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14).text('INTERNATIONAL AIRPORT TERMINAL 3 EXPANSION — PUBLIC SEATING BOQ', 14, 15);
  doc.setFontSize(9).text('Tender: T3-CON-2026 | Departures Concourse, Gate Lounges & Transfer Areas', 14, 21);

  const head = [['Item #', 'Code', 'Aviation Specification Summary', 'Material / Structure', 'Meas.', 'Estimated Quantity', 'Rate ($)', 'Total Cost ($)']];
  const body = [
    ['1.01', 'AIR-GATE-01', 'Beam-Mounted Airport Gate Seating Cluster (4-Seat Unit) with Die-Cast Aluminum Frame and Integrated USB-A/C Power Sockets', 'Cast Aluminum & PU Foam', 'Cluster', '120', '1,350.00', '162,000.00'],
    ['1.02', 'AIR-CHCK-02', 'Passenger Check-In Counter Modular Unit (1600x900x1100mm) with BHS Belt Interface Cutout and Stainless Kickplate', 'SS 316 & Solid Surface', 'Units', '36', '3,400.00', '122,400.00'],
    ['1.03', 'AIR-RECL-03', 'Long-Transit Ergonomic Wave Lounger Single Daybed for Rest Zones with Anti-Vandal Polyurethane Shell', 'Molded Polyurethane', 'Nos', '48', '850.00', '40,800.00'],
    ['1.04', 'AIR-INFO-04', 'Circular Public Information Help Desk (Dia 3200mm) with Overhead 360 Degree LED Signage Ring and Lockable Under-Storage', 'Formed Aluminum & Glass', 'Item', '3', '14,500.00', '43,500.00']
  ];

  autoTable(doc, { head, body, startY: 26, theme: 'grid', headStyles: { fillColor: [44, 62, 80] }, styles: { fontSize: 8 } });
  saveDoc(doc, '03_airport_transit_boq.pdf');
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. High-Rise Luxury Residential Penthouse FF&E
// ─────────────────────────────────────────────────────────────────────────────
function genLuxuryResidential() {
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14).text('THE CREST RESIDENCES — PENTHOUSE COLLECTION FF&E SPECIFICATION', 14, 15);
  doc.setFontSize(9).text('Design Style: Contemporary Minimalist Luxury | Units: Penthouses 50A & 50B', 14, 21);

  const head = [['Tag', 'Room Space', 'Custom Joinery & Loose FF&E Description', 'Material / Finish Specification', 'Dims (mm)', 'Qty', 'Unit', 'Rate ($)', 'Amount ($)']];
  const body = [
    ['LV-SOF-01', 'Grand Salon', 'Modular Low-Profile Sectional Sofa (4200x2800mm) in Premium Italian Nubuck Leather with Down-Filled Cushions', 'Italian Nubuck Leather', '4200x2800x720', '2', 'Sets', '14,500.00', '29,000.00'],
    ['DN-TBL-01', 'Formal Dining', 'Monolithic Custom Dining Table with Sahara Noir Polished Marble Slab Top and Sculpted Cast Bronze Base', 'Sahara Noir Marble & Bronze', '3400x1200x750', '2', 'Nos', '9,800.00', '19,600.00'],
    ['DN-CHR-01', 'Formal Dining', 'Dining Chair with Curved Ash Wood Shell Upholstered in Textured Linen Fabric on Tapered Bronze Legs', 'Ash Wood & Linen', '580x600x820', '20', 'Nos', '850.00', '17,000.00'],
    ['MB-BED-01', 'Master Suite', 'Floating King Bed Base with Oversized Wall-Mounted Velvet Padded Acoustic Headboard and Integrated Nightstands', 'Fluted Walnut & Velvet', '3600x2200x1300', '2', 'Sets', '8,200.00', '16,400.00'],
    ['MB-WIK-01', 'Walk-in Closet', 'Custom Island Accessory Cabinet (1800x1000x900mm) with Fluted Glass Drawers, LED Interior Lighting and Suede Liners', 'Fluted Glass & Smoked Oak', '1800x1000x900', '2', 'Units', '6,400.00', '12,800.00']
  ];

  autoTable(doc, { head, body, startY: 26, theme: 'grid', headStyles: { fillColor: [142, 68, 173] }, styles: { fontSize: 8 } });
  saveDoc(doc, '04_luxury_residential_ffe.pdf');
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Commercial Corporate Headquarters (Workplace)
// ─────────────────────────────────────────────────────────────────────────────
function genCorporateHq() {
  const doc = new jsPDF({ orientation: 'portrait' });
  doc.setFontSize(13).text('FINANCIAL TOWER — LEVEL 12-15 HQ FIT-OUT BOQ', 14, 15);
  doc.setFontSize(8).text('Workplace Standard Specification: Agile Activity-Based Working Environment', 14, 20);

  const head = [['S.No', 'Item Code', 'Item Description & Specification', 'UOM', 'Quantity', 'Unit Rate ($)', 'Net Total ($)']];
  const body = [
    ['1', 'WS-AGL-01', 'Electric Dual-Motor Height-Adjustable Sit-Stand Workstation (1400x750x650-1300mm) with Anti-Collision Sensor and Central Cable Tray', 'Nos', '160', '580.00', '92,800.00'],
    ['2', 'CHR-TSK-01', 'Ergonomic Task Chair with Synchronous Mechanism, 3D Adjustable Arms, Weight-Sensitive Tension and Breathable Mesh Back', 'Nos', '160', '320.00', '51,200.00'],
    ['3', 'POD-PHN-01', 'Single Acoustic Solo Phone Booth (1000x1000x2200mm) with Ventilation Fan, LED Sensor Light and Built-In Work Ledge', 'Units', '12', '3,900.00', '46,800.00'],
    ['4', 'LCK-MOD-01', '10-Door Smart RFID Electronic Locker Bank (1800x450x1900mm) with Master Management Console in Matte Powder Coat', 'Banks', '8', '2,400.00', '19,200.00'],
    ['5', 'TBL-COL-01', 'High Collaboration Island Table (2400x1000x1050mm) with Integrated Wireless Phone Charging Pads and Cast Iron Footrest', 'Nos', '10', '1,150.00', '11,500.00']
  ];

  autoTable(doc, { head, body, startY: 24, theme: 'grid', headStyles: { fillColor: [52, 152, 219] }, styles: { fontSize: 7.5 } });
  saveDoc(doc, '05_corporate_workplace_boq.pdf');
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Judicial Courts & Government Ministry
// ─────────────────────────────────────────────────────────────────────────────
function genJudicialCourts() {
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14).text('PALACE OF JUSTICE — SUPREME COURTROOM JOINERY & SEATING BOQ', 14, 15);
  doc.setFontSize(9).text('Ministry of Legal Affairs | Package: MOJ-2026-COURT-01', 14, 21);

  const head = [['Serial', 'Ref Code', 'Judicial Furniture Particulars', 'Finish Standard', 'Unit', 'Tender Qty', 'Rate (OMR)', 'Cost (OMR)']];
  const body = [
    ['1.1', 'CRT-JDG-01', 'Judicial 3-Judge Elevated Bench Platform (6000x1200x1100mm) with Ballistic Armor Core, Integrated Microphones and Mahogany Veneer', 'Mahogany Veneer & Brass', 'Sum', '2', '12,500.00', '25,000.00'],
    ['1.2', 'CRT-JCH-02', 'High-Back Judicial Swivel Armchair in Premium Burgundy Leather with Hand-Carved State Emblem and Pneumatic Height Control', 'Burgundy Leather & Oak', 'Nos', '6', '850.00', '5,100.00'],
    ['2.1', 'CRT-JUR-01', '12-Member Tiered Jury Seating Box with Fixed Ergonomic Swivel Padded Chairs and Continuous Writing Ledger Shelf', 'Solid Oak & Navy Wool', 'Sets', '4', '4,800.00', '19,200.00'],
    ['2.2', 'CRT-WIT-01', 'Witness Examination Stand with Curved Acoustic Shielding, Documents Monitor Inset and Height-Adjustable Swivel Seat', 'Mahogany & Tinted Glass', 'Nos', '4', '1,650.00', '6,600.00'],
    ['3.1', 'CRT-GAL-01', 'Solid Hardwood Courtroom Public Gallery Benches with Ergonomically Contoured Seat and Backrest (Length 3000mm)', 'Solid White Oak Hardwood', 'Nos', '24', '720.00', '17,280.00']
  ];

  autoTable(doc, { head, body, startY: 26, theme: 'grid', headStyles: { fillColor: [120, 40, 31] }, styles: { fontSize: 8 } });
  saveDoc(doc, '06_judicial_courts_boq.pdf');
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Restaurant, F&B & Hospitality Lounge
// ─────────────────────────────────────────────────────────────────────────────
function genRestaurantFnb() {
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14).text('MARINA PROMENADE RESTAURANT & BAR — LOOSE FURNITURE PACKAGE', 14, 15);
  doc.setFontSize(9).text('Concept: Fine Dining, Lounge Bar & Waterfront Terrace | Interior Architect Ref: FNB-R4', 14, 21);

  const head = [['Item #', 'Tag', 'F&B Item Specification', 'Upholstery / Finish', 'Zone', 'Quantity', 'UOM', 'Tariff ($)', 'Extended ($)']];
  const body = [
    ['01', 'BNQ-FLT-01', 'Custom Fluted Banquette Booth Seating (Length 2400mm) with Heavy-Duty Commercial Crypton Fabric and Solid Walnut Base', 'Crypton Fabric & Walnut', 'Dining Room', '8', 'Nos', '2,100.00', '16,800.00'],
    ['02', 'TBL-DIN-02', 'Dining Table for 4 Persons (900x900x750mm) with Honed Travertine Marble Top and Heavy Cast Iron Pillar Base', 'Travertine & Matte Black', 'Dining Room', '20', 'Nos', '680.00', '13,600.00'],
    ['03', 'CHR-DIN-03', 'Dining Armchair with Steam-Bent Solid Oak Frame, Cane Mesh Backrest and Velvet Seat Cushion', 'Oak, Cane & Velvet', 'Dining Room', '48', 'Nos', '280.00', '13,440.00'],
    ['04', 'STL-BAR-04', 'High Bar Stool with Swivel Brass Column, Footrest Ring and Olive Green Leather Padded Seat (SH: 760mm)', 'Olive Leather & Brass', 'Cocktail Bar', '16', 'Nos', '340.00', '5,440.00'],
    ['05', 'OUT-TBL-05', 'All-Weather Outdoor Dining Table (1600x900x750mm) with Powder-Coated Aluminum Slat Top and Marine Grade 316 Hardware', 'Marine Aluminum', 'Terrace', '12', 'Nos', '520.00', '6,240.00'],
    ['06', 'OUT-CHR-06', 'Outdoor Stackable Armchair with Hand-Woven Weather-Resistant Polyrope Back and Quick-Dry Foam Cushion', 'Polyrope & Aluminum', 'Terrace', '48', 'Nos', '195.00', '9,360.00']
  ];

  autoTable(doc, { head, body, startY: 26, theme: 'grid', headStyles: { fillColor: [211, 84, 0] }, styles: { fontSize: 8 } });
  saveDoc(doc, '07_restaurant_hospitality_boq.pdf');
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Multi-Currency European Metric Tender
// ─────────────────────────────────────────────────────────────────────────────
function genEuropeanMetric() {
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14).text('EUROPEAN INNOVATION CAMPUS — BÜROMÖBEL LEISTUNGSVERZEICHNIS', 14, 15);
  doc.setFontSize(9).text('Projekt: Frankfurt Tech Campus | Norm: DIN EN 527-1 / DIN EN 1335', 14, 21);

  const head = [['Pos.', 'Artikelnummer', 'Leistungsbeschreibung & Spezifikation', 'Dimensionen (mm)', 'Menge', 'Einheit', 'Einheitspreis (€)', 'Gesamtbetrag (€)']];
  const body = [
    ['01.01', 'DSK-ELE-20', 'Elektrisch höhenverstellbarer Schreibtisch (1600x800mm) mit 2 Motoren, Soft-Start/Stop und Kollisionsschutz nach DIN EN 527', '1600x800x650-1250', '80', 'Stk', '620.00', '49,600.00'],
    ['01.02', 'CHR-SYN-04', 'Bürodrehstuhl mit Synchronmechanik, verstellbarer Lordosenstütze, 4D-Armlehnen und atmungsaktivem Netzrücken nach DIN EN 1335', '680x680x1000-1150', '80', 'Stk', '340.00', '27,200.00'],
    ['02.01', 'CNF-MOD-10', 'Konferenztisch für 10 Personen (3200x1200x740mm) mit integrierter Medienbox, HDMI/Stromanschlüssen und Kabelmanagement', '3200x1200x740', '6', 'Stk', '2,450.00', '14,700.00'],
    ['02.02', 'CHR-FRE-12', 'Freischwinger Konferenzstuhl mit verchromtem Rundrohrgestell, Lederpolsterung und Kippschutzgleitern', '560x580x880', '60', 'Stk', '260.00', '15,600.00'],
    ['03.01', 'AKO-WND-02', 'Akustische Stellwand freistehend (1600x1800x40mm) mit Schallabsorberklasse A und Stoffbezug nach Oeko-Tex Standard 100', '1600x40x1800', '24', 'Stk', '410.00', '9,840.00']
  ];

  autoTable(doc, { head, body, startY: 26, theme: 'grid', headStyles: { fillColor: [41, 53, 66] }, styles: { fontSize: 8 } });
  saveDoc(doc, '08_european_metric_boq.pdf');
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. UK NRM2 Bill of Quantities
// ─────────────────────────────────────────────────────────────────────────────
function genUkNrm2() {
  const doc = new jsPDF({ orientation: 'portrait' });
  doc.setFontSize(13).text('CANARY WHARF COMMERCIAL FIT-OUT — BILL OF QUANTITIES', 14, 15);
  doc.setFontSize(8).text('Prepared in accordance with NRM2 (New Rules of Measurement: Detailed Measurement for Building Works)', 14, 20);

  const head = [['Item No', 'NRM2 Ref', 'Description of Work & Preliminaries', 'Unit', 'Quantity', 'Rate (£)', 'Amount (£)']];
  const body = [
    ['A', '28.1.1', 'Demountable Glazed Office Partition System (12.8mm acoustic laminated glass) with slimline aluminum track (Height: 2800mm)', 'm2', '340.0', '185.00', '62,900.00'],
    ['B', '28.2.4', 'Single Action Solid Core Timber Door (900x2100mm) with 30-min fire resistance (FD30), stainless steel lever set and drop seal', 'nr', '28', '620.00', '17,360.00'],
    ['C', '30.1.2', 'Heavy Commercial Modular Carpet Tiles (500x500mm) with Class 33 heavy commercial rating and tackifier adhesive bed', 'm2', '850.0', '42.00', '35,700.00'],
    ['D', '32.4.1', 'Bespoke Reception Desk Counter (3600x1100x750-1100mm) in Solid Surface finish with recessed LED plinth and lockable drawers', 'item', '1', '8,500.00', '8,500.00'],
    ['E', '35.1.1', 'Provisional Sum for Tenant Architectural Signage, Directional Wayfinding and Manifestation Films (Defined Prov Sum)', 'sum', '1', '12,000.00', '12,000.00']
  ];

  autoTable(doc, { head, body, startY: 24, theme: 'grid', headStyles: { fillColor: [13, 71, 161] }, styles: { fontSize: 8 } });
  saveDoc(doc, '09_uk_nrm2_boq.pdf');
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. Middle East Gulf Bilingual Arabic/English Tender
// ─────────────────────────────────────────────────────────────────────────────
function genGulfBilingual() {
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14).text('GULF REGIONAL MUNICIPALITY — PUBLIC TENDER SCHEDULE', 14, 15);
  doc.setFontSize(9).text('Tender Reference: GRM-2026-OM-990 | Project: Regional Community Center Fit-Out', 14, 21);

  const head = [['S.No / الرقم', 'Item Code / الرمز', 'Item Description / تفاصيل البند والمواصفات الفنية', 'Unit / الوحدة', 'Tender Qty / الكمية', 'Unit Rate / السعر', 'Total Amount / الإجمالي']];
  const body = [
    ['1', 'GULF-DSK-01', 'Executive Desking System (2000x1000x750mm) in Natural American Walnut Veneer with Side Return Credenza and Cable Inset', 'Set', '10', '1,250.00', '12,500.00'],
    ['2', 'GULF-CHR-02', 'Ergonomic Executive Swivel Chair in Full Grain Genuine Leather with Synchronized Tilt Mechanism and Adjustable Lumbar', 'No', '10', '380.00', '3,800.00'],
    ['3', 'GULF-WS-04', '4-Person Open Plan Workstation Cluster (2800x1400x750mm) with Central Acoustic Fabric Divider and Built-in Wire Duct', 'Cluster', '12', '1,850.00', '22,200.00'],
    ['4', 'GULF-SOF-03', '3-Seater Reception Waiting Sofa Upholstered in Heavy-Duty Commercial Fabric on Brushed Stainless Steel Leg Base', 'No', '8', '620.00', '4,960.00'],
    ['5', 'GULF-CAB-01', 'Full-Height Lockable Storage Cupboard (1000x450x2000mm) with 4 Adjustable Shelves and Dual Hinged Doors in Melamine', 'No', '20', '290.00', '5,800.00']
  ];

  autoTable(doc, { head, body, startY: 26, theme: 'grid', headStyles: { fillColor: [180, 130, 20] }, styles: { fontSize: 8 } });
  saveDoc(doc, '10_gulf_bilingual_boq.pdf');
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. Industrial Warehouse & Logistics Logistics Schedule
// ─────────────────────────────────────────────────────────────────────────────
function genIndustrialWarehouse() {
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14).text('LOGISTICS HUB OMAN — WAREHOUSE RACKING & STORAGE EQUIPMENT BOQ', 14, 15);
  doc.setFontSize(9).text('Location: Sohar Freezone Distribution Park | Specification: EN 15512 Industrial Standard', 14, 21);

  const head = [['Bay #', 'Equipment Code', 'Racking Specification & Load Capacity', 'Dimensions (LxWxH mm)', 'UOM', 'Required Qty', 'Rate ($)', 'Total Value ($)']];
  const body = [
    ['BAY-01', 'RCK-HVY-01', 'Heavy Duty Selective Pallet Racking Starter Bay with 3000kg Beam Capacity per Level, 4 Beam Levels and Column Upright Protectors', '2700x1100x6000', 'Bays', '40', '850.00', '34,000.00'],
    ['BAY-02', 'RCK-HVY-02', 'Heavy Duty Selective Pallet Racking Extension Bay with 3000kg Beam Capacity per Level, 4 Beam Levels', '2700x1100x6000', 'Bays', '120', '680.00', '81,600.00'],
    ['BAY-03', 'RCK-DRV-03', 'Drive-In Heavy Racking System for 3-Deep Pallet Storage with Guide Rails and Heavy Gauge Upright Posts', '3000x1200x6500', 'Positions', '200', '220.00', '44,000.00'],
    ['BAY-04', 'RCK-MES-04', 'Heavy Duty Modular Structural Steel Storage Mezzanine Floor System with Staircase, Handrails and 500kg/m2 Live Load Capacity', '12000x8000x3200', 'SQM', '96', '145.00', '13,920.00'],
    ['BAY-05', 'WRK-BEN-05', 'Industrial Heavy Duty Packing & Assembly Workbench with Steel Top, Lower Storage Shelf and Tool Pegboard Panel', '2000x800x850', 'Units', '16', '420.00', '6,720.00']
  ];

  autoTable(doc, { head, body, startY: 26, theme: 'grid', headStyles: { fillColor: [127, 140, 141] }, styles: { fontSize: 8 } });
  saveDoc(doc, '11_industrial_warehouse_boq.pdf');
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. Multi-Division CSI MasterFormat Schedule
// ─────────────────────────────────────────────────────────────────────────────
function genCsiMasterFormat() {
  const doc = new jsPDF({ orientation: 'portrait' });
  doc.setFontSize(13).text('CENTRAL CIVIC TOWER — CSI MASTERFORMAT BOQ SCHEDULE', 14, 15);
  doc.setFontSize(8).text('Project Scope: CSI Divisions 06 (Wood/Plastics), 10 (Specialties) & 12 (Furnishings)', 14, 20);

  const head = [['Division', 'CSI Section', 'Work Description & Technical Specification', 'Unit', 'Qty', 'Unit Rate ($)', 'Net Amount ($)']];
  const body = [
    ['DIV 06', '06 41 16', 'Plastic-Laminate-Clad Architectural Cabinets & Casework with Solid Surface Countertops in Staff Breakout Pantries', 'LM', '45.0', '480.00', '21,600.00'],
    ['DIV 10', '10 22 26', 'Operable Accordion Acoustic Folding Partition Wall (STC 50 Acoustic Rating) with Ceiling Track and Vinyl Fabric Finish', 'SQM', '65.0', '390.00', '25,350.00'],
    ['DIV 10', '10 28 13', 'Toilet Accessories Package (Stainless Steel Soap Dispensers, Automatic Hand Dryers, Grab Bars and Mirror Assemblies)', 'Sets', '18.0', '750.00', '13,500.00'],
    ['DIV 12', '12 35 53', 'Laboratory Steel Casework Island Assembly with Epoxy Resin Work Surfaces, Sink Basins and Acid-Resistant Waste Traps', 'Units', '6.0', '4,200.00', '25,200.00'],
    ['DIV 12', '12 51 16', 'Executive Boardroom Conference Table (4800x1500x750mm) with Leather Inset, Built-in Extron Retractors and Power Hubs', 'Nos', '2.0', '7,800.00', '15,600.00']
  ];

  autoTable(doc, { head, body, startY: 24, theme: 'grid', headStyles: { fillColor: [46, 64, 83] }, styles: { fontSize: 8 } });
  saveDoc(doc, '12_csi_masterformat_boq.pdf');
}

// ─────────────────────────────────────────────────────────────────────────────
// 13. Extreme Reversed Column Layout
// ─────────────────────────────────────────────────────────────────────────────
function genExtremeReversed() {
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14).text('METRO TRANSIT AUTHORITY — REVERSED COLUMN COST SCHEDULE', 14, 15);
  doc.setFontSize(9).text('Audit Format: R-2026 | Financial Ledger Direct Export', 14, 21);

  const head = [['Total Value ($)', 'VAT Amount ($)', 'Unit Cost ($)', 'Tender Qty', 'Measurement', 'Scope & Description of Work', 'Ref Code', 'Line #']];
  const body = [
    ['$38,000.00', '$1,900.00', '$950.00', '40', 'Units', 'Platform Passenger Waiting Perch Bench (3-Seater) in Solid Stainless Steel 316 with Anti-Vandal Armrests', 'MTR-BNC-01', '1.01'],
    ['$24,000.00', '$1,200.00', '$4,000.00', '6', 'Sets', 'Station Ticketing Office Dual-Position Counter Desk with Bullet-Resistant Glass Screen and Speak-Thru Intercom', 'MTR-TCK-02', '1.02'],
    ['$15,600.00', '$780.00', '$650.00', '24', 'Nos', 'Station Master Ergonomic 24-Hour Operations Control Chair with High-Durability Wool Upholstery', 'MTR-CHR-03', '1.03'],
    ['$18,400.00', '$920.00', '$2,300.00', '8', 'Units', 'Station Staff Restroom Recliner Rest Pod with Privacy Screen and Wipeable Polyurethane Upholstery', 'MTR-POD-04', '1.04']
  ];

  autoTable(doc, { head, body, startY: 26, theme: 'grid', headStyles: { fillColor: [192, 57, 43] }, styles: { fontSize: 8 } });
  saveDoc(doc, '13_extreme_reversed_boq.pdf');
}

// ─────────────────────────────────────────────────────────────────────────────
// 14. Multi-Page Tree Hierarchy BOQ
// ─────────────────────────────────────────────────────────────────────────────
function genMultiPageTree() {
  const doc = new jsPDF({ orientation: 'portrait' });
  doc.setFontSize(13).text('MEDIA PRODUCTION CITY — MULTI-PAGE STUDIO COMPLEX BOQ', 14, 15);
  doc.setFontSize(8).text('Master Schedule: Stages A, B & Acoustic Soundstages (Pages 1 & 2)', 14, 20);

  const head = [['Item', 'Code', 'Studio Equipment & Acoustic Fit-Out Description', 'UOM', 'Qty', 'Unit Rate ($)', 'Net Amount ($)']];
  const bodyPage1 = [
    ['1.1', 'ST-ACO-01', 'Acoustic Soundstage Timber Diffuser Wall Panel (600x600x120mm) with 3D Convex Quadratic Residue Solid Maple Elements', 'SQM', '120.0', '145.00', '17,400.00'],
    ['1.2', 'ST-ISO-02', 'Studio Sound Isolation Heavy Acoustic Door (1000x2200mm) with STC 55 Sound Reduction Rating and Perimeter Compression Seals', 'Sets', '8', '2,400.00', '19,200.00'],
    ['2.1', 'ST-DSK-03', 'Audio Mastering Console Desk with 24U Integrated 19-inch Rack Bays, Monitor Speaker Isolation Arms and Padded Armrest', 'Nos', '4', '4,800.00', '19,200.00'],
    ['2.2', 'ST-CHR-04', 'Acoustic Neutral Producer Chair with Low-Back Profile to Eliminate High-Frequency Audio Reflections and 4D Armrests', 'Nos', '12', '450.00', '5,400.00']
  ];

  autoTable(doc, { head, body: bodyPage1, startY: 24, theme: 'grid', headStyles: { fillColor: [74, 35, 90] }, styles: { fontSize: 7.5 } });
  doc.addPage();
  doc.setFontSize(13).text('MEDIA PRODUCTION CITY — MULTI-PAGE STUDIO COMPLEX BOQ (PAGE 2)', 14, 15);

  const bodyPage2 = [
    ['3.1', 'ST-LGT-05', 'Ceiling Grid Motorized Pantograph Lighting Suspension Bar (Length 3000mm) with Integrated DMX and Power Outlets', 'Units', '16', '1,650.00', '26,400.00'],
    ['3.2', 'ST-CYC-06', 'Seamless Vinyl Cyclorama Studio Floor Surface (Seamless White/Green) with Heavy Load Capacity for Camera Dollies', 'SQM', '240.0', '65.00', '15,600.00'],
    ['4.1', 'ST-VIP-07', 'Celebrity Green Room 3-Piece Lounge Seating Ensemble (Sofa + 2 Armchairs) Upholstered in Stain-Resistant Italian Velvet', 'Sets', '4', '3,600.00', '14,400.00']
  ];

  autoTable(doc, { head, body: bodyPage2, startY: 24, theme: 'grid', headStyles: { fillColor: [74, 35, 90] }, styles: { fontSize: 7.5 } });
  saveDoc(doc, '14_multipage_studio_boq.pdf');
}

// ─────────────────────────────────────────────────────────────────────────────
// 15. Minimalist 3-Column Scope Schedule
// ─────────────────────────────────────────────────────────────────────────────
function genMinimalist3Col() {
  const doc = new jsPDF({ orientation: 'portrait' });
  doc.setFontSize(13).text('EMBASSY DIPLOMATIC COMPOUND — TURNKEY FIT-OUT PACKAGE', 14, 15);
  doc.setFontSize(8).text('Direct Contract Summary: Embassy Chancery & Consular Section', 14, 20);

  const head = [['Item Ref', 'Detailed Scope of Supply, Joinery & Turnkey Installation', 'Lump Sum Total ($)']];
  const body = [
    ['PKG-01', 'Complete Supply and Installation of Ambassador Formal Reception Suite Furniture including Custom Solid Teak Wood Meeting Table, 12 Diplomatic High-Back Chairs and Side Credenzas', '$32,500.00'],
    ['PKG-02', 'Consular Public Visa Processing Hall Fixed Counter Modules with Ballistic Bulletproof Glass Glazing, Intercom Audio Systems and Queuing Benches for 60 Persons', '$48,000.00'],
    ['PKG-03', 'Chancery Secure Archive & Vault Compact Mobile Storage Shelving System with Mechanical Hand Crank Drive and Reinforced Steel End Panels', '$18,600.00'],
    ['PKG-04', 'Staff Multipurpose Briefing Room Modular Reconfigurable Flip-Top Training Tables on Castors (24 Nos) and Stackable Conference Chairs (72 Nos)', '$21,400.00']
  ];

  autoTable(doc, { head, body, startY: 24, theme: 'grid', headStyles: { fillColor: [31, 78, 121] }, styles: { fontSize: 8 } });
  saveDoc(doc, '15_minimalist_3col_boq.pdf');
}

// ─────────────────────────────────────────────────────────────────────────────
// 16. Dense 12-Column Technical Specification Schedule
// ─────────────────────────────────────────────────────────────────────────────
function genDense12Col() {
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(13).text('TECH MEGAPLEX — FULL 12-COLUMN ARCHITECTURAL FF&E MATRIX', 14, 13);
  doc.setFontSize(8).text('Comprehensive Engineering Master Matrix | Building A & B Fit-Out', 14, 18);

  const head = [['S.No', 'Mark', 'Category', 'Room', 'Maker', 'Model', 'Specification Summary', 'Finish', 'UOM', 'Qty', 'Unit Rate ($)', 'Ext Amount ($)']];
  const body = [
    ['1', 'FF-01', 'Desking', 'Open Office', 'Narbutas', 'Nova Wood', 'Double Bench Workstation (2800x1400mm) with Solid Ash Legs', 'White / Ash', 'Sets', '30', '1,100.00', '33,000.00'],
    ['2', 'FF-02', 'Seating', 'Open Office', 'Sedus', 'Black Dot', 'Ergonomic 3D Swivel Task Chair with Mesh Backrest & 4D Arms', 'Black Mesh', 'Nos', '60', '360.00', '21,600.00'],
    ['3', 'FF-03', 'Meeting', 'Boardroom', 'B&T Design', 'Pebble', '14-Person Oval Conference Table with Brushed Brass Column Plinth', 'Smoked Walnut', 'Nos', '2', '5,400.00', '10,800.00'],
    ['4', 'FF-04', 'Lounge', 'Breakout', 'Ottimo', 'Linear Pod', '2-Seater High Acoustic Sofa Pod with Integrated Power and Work Table', 'Mustard Wool', 'Units', '8', '1,950.00', '15,600.00'],
    ['5', 'FF-05', 'Storage', 'Archive', 'Nurus', 'Inno Storage', 'Tambour Door Lateral Filing Credenza (1600x450x1100mm) with 3 Shelves', 'Anthracite Metal', 'Nos', '15', '480.00', '7,200.00']
  ];

  autoTable(doc, { head, body, startY: 22, theme: 'grid', headStyles: { fillColor: [33, 47, 61] }, styles: { fontSize: 7, cellPadding: 2 } });
  saveDoc(doc, '16_dense_12col_ffe_matrix.pdf');
}

console.log('🚀 Generating 16 brand-new, unseen, highly diverse BOQ PDF files...');
genUniversityCampus();
genHospitalMedical();
genAirportTransit();
genLuxuryResidential();
genCorporateHq();
genJudicialCourts();
genRestaurantFnb();
genEuropeanMetric();
genUkNrm2();
genGulfBilingual();
genIndustrialWarehouse();
genCsiMasterFormat();
genExtremeReversed();
genMultiPageTree();
genMinimalist3Col();
genDense12Col();
console.log('✨ All 16 unseen BOQ PDFs generated successfully!');
