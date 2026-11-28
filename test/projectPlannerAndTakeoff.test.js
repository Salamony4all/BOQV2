import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  buildDynamicProjectPlan,
  buildProjectPlanExcel,
  buildMsProjectXml,
} from '../src/features/projectPlan/dynamicProjectPlanner.js';
import {
  buildGeometricEnrichmentPlan,
  applyGeometricEnrichmentToTables,
} from '../src/features/boq/geometricBoqEnricher.js';
import { buildExportSuite } from '../src/features/designBuild/exportSuite.js';
import { recategorizeTables } from '../src/utils/boqGroupingUtils.js';

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`  PASS: ${name}`);
}

const SAMPLE_TABLES = [
  {
    sheetName: 'Main BOQ',
    header: ['S/N', 'Image', 'Description', 'Brand', 'Model', 'Qty', 'Unit', 'Rate', 'Amount'],
    rows: [
      {
        id: 'r1',
        cells: [
          { value: '1' },
          { value: '' },
          { value: 'Executive L-Shape Desk with Cable Management 2000x1600mm' },
          { value: 'NARBUTAS' },
          { value: 'NOVA Wood' },
          { value: 4 },
          { value: 'Nos' },
          { value: 420 },
          { value: 1680 },
        ],
      },
      {
        id: 'r2',
        cells: [
          { value: '2' },
          { value: '' },
          { value: 'Porcelain Floor Tile 600x600mm Matte Anti-Slip' },
          { value: 'FitOut V2' },
          { value: 'FL-POR-01' },
          { value: 120 },
          { value: 'Sqm' },
          { value: 18 },
          { value: 2160 },
        ],
      },
      {
        id: 'r3',
        cells: [
          { value: '3' },
          { value: '' },
          { value: 'Bespoke Curved Reception Counter 3200x850x1050mm Corian & Fluted Oak' },
          { value: 'Custom Fabrication' },
          { value: 'FAB-REC-01' },
          { value: 1 },
          { value: 'Nos' },
          { value: 3200 },
          { value: 3200 },
        ],
        fulfillmentType: 'custom_fabrication',
      },
    ],
  },
];

const SAMPLE_TAKEOFF = {
  netFloorAreaM2: 310.5,
  ceilingAreaM2: 310.5,
  solidWallLengthLm: 92.4,
  solidWallGrossAreaM2: 277.2,
  solidWallNetPaintAreaM2: 495.8,
  curvedSolidWallLengthLm: 14.2,
  curvedSolidWallAreaM2: 42.6,
  glassPartitionLengthLm: 26.8,
  glassPartitionAreaM2: 80.4,
  skirtingLengthLm: 78.6,
  wallsTotalCount: 44,
  doors: { total: 14, single: 11, double: 1, podGlass: 2, totalWidthLm: 13.8, totalAreaM2: 28.98 },
  windows: { total: 8, totalWidthLm: 14.4, totalAreaM2: 21.6 },
  columnsCount: 6,
  furnitureTotalCount: 38,
  sanitaryCounts: { wc: 3, basin: 3, shower: 1 },
  furnitureGroups: [],
};

await test('1. buildDynamicProjectPlan adapts duration to scale & reconciles BAC + VAT', () => {
  const plan = buildDynamicProjectPlan({
    tables: SAMPLE_TABLES,
    takeoff: SAMPLE_TAKEOFF,
    project: {
      projectName: 'Main Gate FBO Lounge',
      projectNumber: 'FBO-2026-01',
      clientName: 'Oman Airports',
      contractor: 'BOQ Flow Contractor LLC',
      projectManager: 'Eng. Salem',
      locationZone: 'Muscat',
      vatPercent: 5,
    },
    currency: 'OMR',
  });

  assert.equal(plan.meta.title, 'Main Gate FBO Lounge');
  assert.ok(plan.meta.durationDays >= 45 && plan.meta.durationDays <= 180, 'Duration is bounded and scale-adaptive');
  assert.equal(Math.round(plan.meta.netTotal * 100) / 100, 7040);
  assert.equal(Math.round(plan.meta.grossTotal * 100) / 100, 7392);
  assert.ok(plan.activities.length >= 12, 'Has full CPM activity schedule');
  assert.ok(plan.wbsItems.length === 3, 'Covers all 3 BOQ rows');

  // Verify WBS allocated BAC sum reconciles to netTotal within rounding tolerance
  const wbsSum = plan.wbsItems.reduce((s, w) => s + w.allocExec + w.allocInst, 0);
  assert.ok(Math.abs(wbsSum - plan.meta.netTotal) < 0.05, `WBS sum (${wbsSum}) reconciles to BAC (${plan.meta.netTotal})`);
});

await test('2. buildProjectPlanExcel outputs valid 10-sheet XLSX workbook', async () => {
  const plan = buildDynamicProjectPlan({
    tables: SAMPLE_TABLES,
    takeoff: SAMPLE_TAKEOFF,
    project: { projectName: 'FBO Lounge Control Test', contractDurationDays: 90, vatPercent: 5 },
    currency: 'OMR',
  });
  const blob = await buildProjectPlanExcel(plan);
  assert.ok(blob && blob.size > 5000, 'Excel blob should be non-trivial');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await blob.arrayBuffer());
  const sheetNames = wb.worksheets.map((ws) => ws.name);
  assert.deepEqual(sheetNames, [
    'Dashboard | لوحة المعلومات',
    'Action Plan | خطة العمل',
    'Instructions | تعليمات',
    'Scope & WBS | نطاق العمل',
    'Schedule & Gantt | مخطط جانت',
    'Deliverables | التسليمات',
    'Resources & Materials | الموارد',
    'Cost, EV & S-Curve | التكاليف',
    'Risks | المخاطر',
    'Stakeholders & RACI | المعنيين',
  ]);
  const wbsWs = wb.getWorksheet('Scope & WBS | نطاق العمل');
  assert.ok(wbsWs.rowCount >= 7, 'Scope & WBS contains BOQ lines + summary');
});

await test('3. buildMsProjectXml generates valid MSPDI XML schema with Tasks, Predecessors & Assignments', async () => {
  const plan = buildDynamicProjectPlan({
    tables: SAMPLE_TABLES,
    takeoff: SAMPLE_TAKEOFF,
    project: { projectName: 'MS Project Export Verification & <Test>', contractDurationDays: 75 },
    currency: 'OMR',
  });
  const xmlBlob = buildMsProjectXml(plan);
  const xml = await xmlBlob.text();
  assert.ok(xml.includes('xmlns="http://schemas.microsoft.com/project"'));
  assert.ok(xml.includes('&amp;') && xml.includes('&lt;Test&gt;'), 'XML entities are properly escaped');
  assert.ok(xml.includes('<Tasks>') && xml.includes('<Task>') && xml.includes('<PredecessorLink>'));
  assert.ok(xml.includes('<Resources>') && xml.includes('<Assignments>'));
  assert.ok(xml.includes('</Project>'));
});

await test('4. buildGeometricEnrichmentPlan updates measured quantities & proposes missing 3D surfaces with Brand Finishes', () => {
  const plan = buildGeometricEnrichmentPlan(SAMPLE_TABLES, SAMPLE_TAKEOFF);
  assert.ok(plan.updates.length >= 1, 'Detects Porcelain Floor Tile quantity change from 120 to 310.5 Sqm');
  const floorUpd = plan.updates.find((u) => u.ruleKey === 'flooring');
  assert.ok(floorUpd, 'Flooring update identified');
  assert.equal(floorUpd.currentQty, 120);
  assert.equal(floorUpd.measuredQty, 310.5);

  const missingKeys = new Set(plan.additions.map((a) => a.ruleKey));
  assert.ok(missingKeys.has('ceiling'), 'Proposes missing ceiling finish');
  assert.ok(missingKeys.has('wall_paint'), 'Proposes missing wall paint surface');
  assert.ok(missingKeys.has('glass_partition'), 'Proposes missing glazed partitions');
  assert.ok(missingKeys.has('skirting'), 'Proposes missing perimeter skirting');
  assert.ok(missingKeys.has('doors'), 'Proposes missing doors');

  const wallAdd = plan.additions.find((a) => a.ruleKey === 'wall_paint');
  assert.ok(wallAdd.finishes.length >= 1 && wallAdd.finishes[0].code, 'Added surface carries Official Brand Finish');

  const merged = applyGeometricEnrichmentToTables(SAMPLE_TABLES, [floorUpd], [wallAdd]);
  assert.equal(Number(merged[0].rows[1].cells[5].value), 310.5);
  assert.equal(Number(merged[0].rows[1].cells[8].value), 310.5 * 18);
  assert.equal(merged[0].rows.length, 4, 'Appends approved new measured surface row');
  assert.equal(Number(merged[0].rows[3].cells[5].value), 495.8);
});

await test('5. buildExportSuite separates Furniture, Custom Joinery, and Fit-Out divisions & includes Programme files', async () => {
  const mixedProducts = [
    {
      id: 'p_chair',
      sn: '1',
      brand: 'B&T Design',
      model: 'Boom Curve #20276742',
      description: 'Curved modular lounge sofa with high-resilience molded foam cushions.',
      qty: 5,
      unit: 'Nos',
      rate: 450,
      amount: 2250,
    },
    {
      id: 'p_fab',
      sn: '2',
      brand: 'Custom Fabrication',
      model: 'FAB-REC-01',
      code: 'FAB-REC-01',
      fulfillmentType: 'custom_fabrication',
      description: 'Curved Corian & Fluted Oak Reception Counter',
      qty: 1,
      unit: 'Nos',
      rate: 1650,
      amount: 1650,
    },
    {
      id: 'p_legacy_van',
      sn: '3',
      brand: 'FitOut V2',
      model: 'ST 101',
      description: 'Wall-mounted vanity counter featuring a 20mm thick engineered quartz top with undermount basins.',
      qty: 7.2,
      unit: 'LM',
      rate: 185,
      amount: 1332,
    },
    {
      id: 'p_mismatched_por',
      sn: '4',
      brand: 'NARBUTAS',
      model: 'Domino Reception #20264053',
      sourceDescription: 'Full-bodied rectified porcelain floor tiles with an R10 anti-slip matte finish over cementitious screed.',
      description: 'Full-bodied rectified porcelain floor tiles with an R10 anti-slip matte finish over cementitious screed.',
      qty: 115.5,
      unit: 'SQM',
      rate: 24,
      amount: 2772,
    },
    {
      id: 'p_legacy_cpt',
      sn: '5',
      brand: 'FitOut V2',
      model: 'CA 101',
      description: 'Tufted commercial carpet tile 500x500mm with acoustic backing.',
      qty: 425,
      unit: 'SQM',
      rate: 19,
      amount: 8075,
    },
    {
      id: 'p_gcc_dry',
      sn: '6',
      brand: 'Knauf',
      model: 'PT-DRY-01',
      description: 'Knauf 125mm acoustic drywall partition with double 12.5mm gypsum boards.',
      qty: 80.8,
      unit: 'SQM',
      rate: 28,
      amount: 2262.4,
    },
  ];

  const suite = await buildExportSuite(
    {
      products: mixedProducts,
      takeoff: SAMPLE_TAKEOFF,
      project: { projectName: 'Division Separation Check', clientName: 'FBO Lounge' },
      brand: { company: 'BOQ Flow' },
      offer: { tables: SAMPLE_TABLES, title: 'Matched offer' },
    },
    { groups: ['programme', 'presentation', 'ffe'] },
  );

  const filePaths = suite.files.map((f) => f.path);
  assert.ok(filePaths.includes('Programme/Action_and_Project_Plan.xlsx'), 'Suite includes Action_and_Project_Plan.xlsx');
  assert.ok(filePaths.includes('Programme/MS_Project_Schedule.xml'), 'Suite includes MS_Project_Schedule.xml');
  const pptxFile = suite.files.find((f) => f.path === 'Presentation/Design_and_Build_Presentation.pptx');
  assert.ok(pptxFile, 'Suite includes Design_and_Build_Presentation.pptx');

  const pptxZip = await JSZip.loadAsync(await pptxFile.blob.arrayBuffer());
  const slideKeys = Object.keys(pptxZip.files)
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const slideXmls = await Promise.all(slideKeys.map((k) => pptxZip.files[k].async('string')));
  const joinedXml = slideXmls.join('\n');

  assert.ok(!joinedXml.includes('Furniture &amp; products'), 'Legacy mixed slide title "Furniture & products" must not appear');
  assert.ok(joinedXml.includes('1. Loose Furniture (FF&amp;E)'), 'Loose Furniture division slide present');
  assert.ok(joinedXml.includes('2. Custom Joinery &amp; Fabrication'), 'Custom Joinery division slide present');
  assert.ok(joinedXml.includes('3. Architectural Fit-Out &amp; MEP Finishes'), 'Architectural Fit-Out division slide present');

  const looseSlide = slideXmls.find((x) => x.includes('1. Loose Furniture (FF&amp;E)'));
  assert.ok(looseSlide && !looseSlide.includes('porcelain floor tiles') && !looseSlide.includes('carpet tile') && !looseSlide.includes('vanity counter'), 'Loose Furniture slide excludes porcelain tiles, carpet tiles, and vanity counter');
  const fitoutSlide = slideXmls.find((x) => x.includes('3. Architectural Fit-Out &amp; MEP Finishes'));
  assert.ok(fitoutSlide && fitoutSlide.includes('RAK Ceramics') && fitoutSlide.includes('Knauf') && fitoutSlide.includes('DuPont Corian'), 'Fit-Out slide contains porcelain, drywall, and vanity under GCC brands');

  const recat = recategorizeTables([
    {
      sheetName: 'Mixed',
      header: ['S/N', 'Image', 'Description', 'Brand', 'Model', 'Qty', 'Unit', 'Rate', 'Amount'],
      rows: [
        { cells: [{ value: '1' }, { value: '' }, { value: 'Knauf 12.5mm false ceiling' }, { value: 'Knauf' }, { value: 'CL-GYP-01' }, { value: '120' }, { value: 'SQM' }, { value: '16' }, { value: '1920' }] },
        { cells: [{ value: '2' }, { value: '' }, { value: 'Ergonomic swivel task chair' }, { value: 'NARBUTAS' }, { value: 'SURF' }, { value: '10' }, { value: 'Nos' }, { value: '250' }, { value: '2500' }] },
        { cells: [{ value: '3' }, { value: '' }, { value: 'Custom curved reception counter' }, { value: 'Custom Fabrication' }, { value: 'FAB-REC-01' }, { value: '1' }, { value: 'Nos' }, { value: '1600' }, { value: '1600' }] },
      ],
    },
  ], 'item');
  const seq = recat[0].rows.map((r) => r.sectionCategory);
  assert.deepEqual(seq, ['FURNITURE', 'CUSTOM JOINERY & FABRICATION', 'FITOUT WORKS'], 'recategorizeTables orders FURNITURE -> CUSTOM JOINERY -> FITOUT WORKS');
});

await test('6. inferArchitecturalRole routes wall cladding, fluted glass & decorative ceilings cleanly', async () => {
  const { inferArchitecturalRole } = await import('../src/features/designBuild/designBuildStore.js');
  assert.equal(inferArchitecturalRole({ code: 'WC-FLT-01', description: 'Fluted timber acoustic wall panel' }), 'wall-cladding');
  assert.equal(inferArchitecturalRole({ code: 'PT-GLS-03', description: 'Frosted / Fluted Decorative Glass Partition' }), 'glazing-partition');
  assert.equal(inferArchitecturalRole({ code: 'FAB-CLG-01', description: 'Suspended Circular Slatted Ceiling Canopy' }), 'ceiling-feature');
});

console.log(`\nAll ${passed} Project Planner & Geometric Takeoff tests passed.\n`);
