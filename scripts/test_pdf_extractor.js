import { extractPdfViaWordFastPath } from '../server/universalPatternParsers.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const targetFolder = process.argv[2] || 'PDF';
const PDF_DIR = path.resolve(__dirname, '..', targetFolder);
const suffix = targetFolder === 'PDF' ? '' : `_${targetFolder.toLowerCase()}`;
const REPORT_FILE = `C:/Users/Mohamad60025/.gemini/antigravity-ide/brain/37b0d2fb-577d-4b93-b5fb-996515b2aab7/pdf_extraction_report${suffix}.md`;

async function runE2ETests() {
  console.log(`🔍 Scanning PDF directory: ${PDF_DIR}`);
  let files;
  try {
    files = await fs.readdir(PDF_DIR);
  } catch (err) {
    console.error(`Error reading PDF directory: ${err.message}`);
    process.exit(1);
  }

  const pdfFiles = files.filter(f => f.toLowerCase().endsWith('.pdf'));
  console.log(`📄 Found ${pdfFiles.length} PDF files.`);

  const results = [];

  for (let i = 0; i < pdfFiles.length; i++) {
    const filename = pdfFiles[i];
    const filePath = path.join(PDF_DIR, filename);
    console.log(`\n--------------------------------------------------`);
    console.log(`[${i + 1}/${pdfFiles.length}] Processing: ${filename}`);
    
    const startTime = Date.now();
    let stats;
    try {
      stats = await fs.stat(filePath);
    } catch (e) {
      stats = { size: 0 };
    }

    let success = false;
    let engine = 'None (Failed / No Match)';
    let rowCount = 0;
    let confidence = 0;
    let warningCount = 0;
    let arithmeticPass = 0;
    let completeness = 0;
    let errors = '';

    try {
      const result = await extractPdfViaWordFastPath(filePath, (pct) => {
        // Optional progress log
      });

      if (result && result.tables && result.tables.length > 0) {
        const table = result.tables[0];
        success = true;
        engine = table.engineUsed || result.engineUsed || 'Unknown';
        rowCount = table.rows ? table.rows.length : 0;
        confidence = table.confidence || 0;
        
        const audit = table.extractionAudit || table.serialAudit || {};
        warningCount = audit.warnings ? audit.warnings.length : 0;
        arithmeticPass = table.quality ? table.quality.arithmeticPass : 0;
        completeness = table.quality ? table.quality.completeness : 0;
      }
    } catch (err) {
      errors = err.message;
      console.error(`Error extracting ${filename}:`, err);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`Result: ${success ? '✅ SUCCESS' : '❌ FAILED'}`);
    if (success) {
      console.log(`  Engine: ${engine}`);
      console.log(`  Rows: ${rowCount}`);
      console.log(`  Confidence: ${(confidence * 100).toFixed(1)}%`);
      console.log(`  Warnings: ${warningCount}`);
      console.log(`  Arithmetic Pass: ${(arithmeticPass * 100).toFixed(1)}%`);
    } else if (errors) {
      console.log(`  Error: ${errors}`);
    }

    results.push({
      filename,
      size: (stats.size / 1024).toFixed(1) + ' KB',
      success,
      engine,
      rowCount,
      confidence: confidence ? (confidence * 100).toFixed(1) + '%' : '0%',
      warningCount,
      arithmeticPass: arithmeticPass ? (arithmeticPass * 100).toFixed(1) + '%' : '0%',
      completeness: completeness ? (completeness * 100).toFixed(1) + '%' : '0%',
      duration: duration + 's',
      error: errors || '-'
    });
  }

  // Write markdown report
  let md = `# E2E PDF Extraction Baseline Report\n\n`;
  md += `Generated at: ${new Date().toISOString()}\n\n`;
  md += `| File Name | Size | Success | Engine Matched | Rows | Confidence | Warnings | Arithmetic Pass | Completeness | Time |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;
  
  for (const r of results) {
    const statusIcon = r.success ? '✅' : '❌';
    md += `| ${r.filename} | ${r.size} | ${statusIcon} | ${r.engine} | ${r.rowCount} | ${r.confidence} | ${r.warningCount} | ${r.arithmeticPass} | ${r.completeness} | ${r.duration} |\n`;
  }

  md += `\n\n### Summary\n\n`;
  const total = results.length;
  const passed = results.filter(r => r.success).length;
  const passRate = ((passed / total) * 100).toFixed(1);
  md += `- Total PDFs Tested: ${total}\n`;
  md += `- Fast-Path Successful Extractions: ${passed} / ${total} (${passRate}%)\n`;
  md += `- Slow-Path / Vision Fallbacks Required: ${total - passed}\n`;

  try {
    await fs.writeFile(REPORT_FILE, md, 'utf8');
    console.log(`\n💾 Report successfully written to: ${REPORT_FILE}`);
  } catch (err) {
    console.error(`Failed to write report: ${err.message}`);
  }
}

runE2ETests().catch(console.error);
