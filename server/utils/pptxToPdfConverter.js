import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { promises as fs } from 'fs';

const execPromise = promisify(exec);

/**
 * Converts .pptx to .pdf using LibreOffice (cross-platform)
 * Falls back to returning only PPTX if LibreOffice is not available.
 */
export async function convertPptxToPdf(inputPath) {
    const outputPath = inputPath.replace(/\.pptx$/i, '.pdf');
    
    // Ensure absolute paths
    const absInput = path.resolve(inputPath);
    const absOutput = path.resolve(outputPath);
    const isWindows = process.platform === 'win32';

    console.log(`[PptxConverter] Attempting PPTX→PDF conversion: ${absInput} → ${absOutput}`);

    // Try Windows PowerPoint COM first if on Windows (instant & native)
    if (isWindows) {
        try {
            console.log(`[PptxConverter] Trying Windows PowerPoint COM...`);
            
            const psScript = `
                $absInput = "${absInput.replace(/\\/g, '\\\\')}";
                $absOutput = "${absOutput.replace(/\\/g, '\\\\')}";
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

            const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');
            const { stdout, stderr } = await execPromise(`powershell -EncodedCommand ${encodedScript}`, { timeout: 60000 });
            
            console.log(`[PptxConverter] PowerPoint COM output:`, stdout);

            if (stdout.includes("SUCCESS")) {
                console.log(`[PptxConverter] PDF conversion successful via PowerPoint COM`);
                return absOutput;
            }
        } catch (powershellErr) {
            console.warn(`[PptxConverter] PowerPoint COM failed:`, powershellErr.message);
        }
    }

    // Try LibreOffice (cross-platform fallback or Linux/macOS primary)
    try {
        console.log(`[PptxConverter] Trying LibreOffice...`);
        const cmd = `soffice --headless --convert-to pdf --outdir "${path.dirname(absOutput)}" "${absInput}"`;
        
        const { stdout, stderr } = await execPromise(cmd, { timeout: 30000 });
        console.log(`[PptxConverter] LibreOffice output:`, stdout);

        try {
            await fs.access(absOutput);
            console.log(`[PptxConverter] PDF successfully generated at ${absOutput}`);
            return absOutput;
        } catch (e) {
            console.warn(`[PptxConverter] LibreOffice conversion reported success but PDF not found:`, stderr);
        }
    } catch (libreErr) {
        console.warn(`[PptxConverter] LibreOffice failed:`, libreErr.message);
    }

    console.warn(`[PptxConverter] All PDF conversion methods failed. Returning null.`);
    return null;
}
