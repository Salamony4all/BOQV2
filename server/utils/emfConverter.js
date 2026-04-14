import { spawn } from 'child_process';
import path from 'path';
import { promises as fs } from 'fs';
import os from 'os';

/**
 * Converts EMF/WMF files to PNG using Windows GDI+ via PowerShell.
 * Only works on Windows.
 */
export async function convertEmfToPng(inputPath) {
    if (os.platform() !== 'win32') {
        console.warn('[EMF Converter] Skip: Non-Windows platform');
        return null;
    }

    const outputPath = inputPath.replace(/\.(emf|wmf)$/i, '.png');
    
    // Check if PNG already exists (to avoid duplicate work)
    try {
        await fs.access(outputPath);
        return outputPath;
    } catch (e) {
        // Continue to conversion
    }

    const psScript = `
        Try {
            Add-Type -AssemblyName System.Drawing
            $img = [System.Drawing.Image]::FromFile("${inputPath.replace(/\\/g, '\\\\')}")
            $img.Save("${outputPath.replace(/\\/g, '\\\\')}", [System.Drawing.Imaging.ImageFormat]::Png)
            $img.Dispose()
            Write-Output "SUCCESS"
        } Catch {
            Write-Error $_.Exception.Message
            Exit 1
        }
    `;

    return new Promise((resolve, reject) => {
        const ps = spawn('powershell.exe', ['-Command', psScript]);
        
        let errorData = '';
        ps.stderr.on('data', (data) => { errorData += data.toString(); });

        ps.on('close', (code) => {
            if (code === 0) {
                console.log(`[EMF Converter] Successfully converted: ${path.basename(inputPath)} -> PNG`);
                resolve(outputPath);
            } else {
                console.error(`[EMF Converter] Failed for ${path.basename(inputPath)}: ${errorData}`);
                resolve(null); // Resolve with null to allow logic to continue without crashing
            }
        });
    });
}
