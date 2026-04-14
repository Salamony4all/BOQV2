import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { promises as fs } from 'fs';

const execPromise = promisify(exec);

/**
 * Converts legacy .xls to .xlsx using Excel COM via PowerShell (Windows Only)
 * This ensures maximum fidelity and preserves images/EMFs.
 */
export async function convertXlsToXlsx(inputPath) {
    const outputPath = inputPath.replace(/\.xls$/i, '_converted.xlsx');
    
    // Ensure absolute paths for PowerShell
    const absInput = path.resolve(inputPath);
    const absOutput = path.resolve(outputPath);

    console.log(`[XlsConverter] Converting ${absInput} to ${absOutput}...`);

    const psScript = `
        $absInput = "${absInput}";
        $absOutput = "${absOutput}";
        try {
            $excel = New-Object -ComObject Excel.Application;
            $excel.Visible = $false;
            $excel.DisplayAlerts = $false;
            $workbook = $excel.Workbooks.Open($absInput);
            $workbook.SaveAs($absOutput, 51);
            $workbook.Close();
            $excel.Quit();
            [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null;
            Write-Output "SUCCESS";
        } catch {
            Write-Error $_.Exception.Message;
            exit 1;
        }
    `;

    try {
        // Use Base64 encoding for the script to avoid shell escaping issues with spaces in paths
        const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');
        const { stdout, stderr } = await execPromise(`powershell -EncodedCommand ${encodedScript}`);
        
        if (stdout.includes("SUCCESS")) {
            console.log(`[XlsConverter] Conversion successful.`);
            return outputPath;
        } else {
            console.error(`[XlsConverter] PowerShell output was unexpected:`, stdout);
            throw new Error(`XLS to XLSX conversion failed: ${stderr || stdout}`);
        }
    } catch (err) {
        console.warn(`[XlsConverter] Excel COM conversion failed (Excel might not be installed):`, err.message);
        throw err;
    }
}
