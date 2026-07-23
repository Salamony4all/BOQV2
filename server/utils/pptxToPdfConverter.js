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

    console.log(`[PptxConverter] Attempting PPTX→PDF conversion: ${absInput} → ${absOutput}`);

    // Try LibreOffice first (cross-platform: Windows, macOS, Linux)
    try {
        console.log(`[PptxConverter] Trying LibreOffice...`);
        const cmd = `soffice --headless --convert-to pdf --outdir "${path.dirname(absOutput)}" "${absInput}"`;
        
        const { stdout, stderr } = await execPromise(cmd, { timeout: 30000 });
        
        console.log(`[PptxConverter] LibreOffice output:`, stdout);

        // Verify the PDF was actually created
        try {
            await fs.access(absOutput);
            console.log(`[PptxConverter] PDF successfully generated at ${absOutput}`);
            return absOutput;
        } catch (e) {
            console.warn(`[PptxConverter] LibreOffice conversion reported success but PDF not found:`, stderr);
            throw new Error('PDF not created after LibreOffice conversion');
        }
    } catch (libreErr) {
        console.warn(`[PptxConverter] LibreOffice failed:`, libreErr.message);
        
        // Try Windows PowerPoint COM as fallback (Windows only)
        const isWindows = process.platform === 'win32';
        if (isWindows) {
            try {
                console.log(`[PptxConverter] Trying Windows PowerPoint COM...`);
                
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

                const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');
                const { stdout, stderr } = await execPromise(`powershell -EncodedCommand ${encodedScript}`, { timeout: 60000 });
                
                console.log(`[PptxConverter] PowerPoint COM output:`, stdout);

                if (stdout.includes("SUCCESS")) {
                    console.log(`[PptxConverter] PDF conversion successful via PowerPoint COM`);
                    return absOutput;
                } else {
                    throw new Error(`PowerPoint conversion failed: ${stderr || stdout}`);
                }
            } catch (powershellErr) {
                console.warn(`[PptxConverter] PowerPoint COM also failed:`, powershellErr.message);
            }
        }
        
        // Both conversions failed or not available
        console.warn(`[PptxConverter] All PDF conversion methods failed. Returning PPTX only.`);
        return null; // Signal that PDF conversion failed
    }
}
