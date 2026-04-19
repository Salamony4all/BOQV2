import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { promises as fs } from 'fs';

const execPromise = promisify(exec);

/**
 * Converts .pptx to .pdf using PowerPoint COM via PowerShell (Windows Only)
 * High fidelity "native" conversion.
 */
export async function convertPptxToPdf(inputPath) {
    const outputPath = inputPath.replace(/\.pptx$/i, '.pdf');
    
    // Ensure absolute paths for PowerShell
    const absInput = path.resolve(inputPath);
    const absOutput = path.resolve(outputPath);

    console.log(`[PptxConverter] Converting ${absInput} to ${absOutput}...`);

    // PowerShell script to use PowerPoint COM object
    // 32 = ppSaveAsPDF
    const psScript = `
        $absInput = "${absInput}";
        $absOutput = "${absOutput}";
        try {
            Write-Output "Starting PowerPoint COM...";
            $ppt = New-Object -ComObject PowerPoint.Application;
            $ppt.Visible = [Microsoft.Office.Core.MsoTriState]::msoTrue; 
            Write-Output "Opening presentation...";
            $presentation = $ppt.Presentations.Open($absInput, [Microsoft.Office.Core.MsoTriState]::msoTrue, [Microsoft.Office.Core.MsoTriState]::msoFalse, [Microsoft.Office.Core.MsoTriState]::msoFalse);
            Write-Output "Saving as PDF...";
            $presentation.SaveAs($absOutput, 32);
            $presentation.Close();
            $ppt.Quit();
            [System.Runtime.Interopservices.Marshal]::ReleaseComObject($ppt) | Out-Null;
            Write-Output "SUCCESS";
        } catch {
            Write-Error $_.Exception.Message;
            if ($ppt) { $ppt.Quit(); }
            exit 1;
        }
    `;

    try {
        // Use Base64 encoding for the script to avoid shell escaping issues
        const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');
        const { stdout, stderr } = await execPromise(`powershell -EncodedCommand ${encodedScript}`);
        
        console.log(`[PptxConverter] PS Output:`, stdout);

        if (stdout.includes("SUCCESS")) {
            console.log(`[PptxConverter] Conversion successful.`);
            return outputPath;
        } else {
            throw new Error(`PowerPoint conversion failed: ${stderr || stdout}`);
        }
    } catch (err) {
        console.warn(`[PptxConverter] PowerPoint COM conversion failed (PowerPoint might not be installed or error occurred):`, err.message);
        throw err;
    }
}
