import { spawn, execSync } from 'child_process';
import path from 'path';
import { promises as fs } from 'fs';
import os from 'os';

/**
 * Checks if a command exists in the system path (Linux/macOS)
 */
const commandExists = (cmd) => {
    try {
        execSync(`which ${cmd}`, { stdio: 'ignore' });
        return true;
    } catch (e) {
        return false;
    }
};

/**
 * Converts EMF/WMF files to PNG.
 * Uses Windows GDI+ via PowerShell on Windows.
 * Falls back to Inkscape, LibreOffice, or ImageMagick on Linux/macOS.
 */
export async function convertEmfToPng(inputPath) {
    // Verify input file exists
    try {
        await fs.access(inputPath);
    } catch (e) {
        console.error(`[EMF Converter] Input file not found: ${inputPath}`);
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

    if (os.platform() === 'win32') {
        return convertOnWindows(inputPath, outputPath);
    } else {
        return convertOnLinux(inputPath, outputPath);
    }
}

function convertOnWindows(inputPath, outputPath) {
    // Use single quotes for PowerShell literal strings and escape single quotes in path
    const escapedInput = inputPath.replace(/'/g, "''");
    const escapedOutput = outputPath.replace(/'/g, "''");

    const psScript = `
$ErrorActionPreference = 'Stop'
Try {
    Add-Type -AssemblyName System.Drawing
    $in = '${escapedInput}'
    $out = '${escapedOutput}'
    
    Write-Host "DEBUG: Loading metafile from $in"
    
    $img = New-Object System.Drawing.Imaging.Metafile($in)
    
    $width = [int]$img.Width
    $height = [int]$img.Height
    
    if ($width -le 1 -or $height -le 1) {
        $width = [int]$img.PhysicalDimension.Width
        $height = [int]$img.PhysicalDimension.Height
    }
    
    if ($width -le 0 -or $height -le 0) {
        Throw "Invalid image dimensions: $($width)x$($height)"
    }

    Write-Host "DEBUG: Dimensions: $($width)x$($height)"
    
    if ($width -gt 8192 -or $height -gt 8192) {
        $ratio = [Math]::Min(8192/$width, 8192/$height)
        $width = [int]($width * $ratio)
        $height = [int]($height * $ratio)
        Write-Host "DEBUG: Downscaling to $($width)x$($height)"
    }
    
    $bmp = New-Object System.Drawing.Bitmap($width, $height)
    $bmp.SetResolution(96, 96) 
    
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.DrawImage($img, 0, 0, $width, $height)
    
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    
    $g.Dispose()
    $bmp.Dispose()
    $img.Dispose()
    
    Write-Output "SUCCESS"
} Catch {
    $msg = $_.Exception.Message
    if ($_.Exception.InnerException) { $msg += " ($($_.Exception.InnerException.Message))" }
    Write-Error "EMF Conversion Error: $msg"
    
    if ($g) { try { $g.Dispose() } catch {} }
    if ($bmp) { try { $bmp.Dispose() } catch {} }
    if ($img) { try { $img.Dispose() } catch {} }
    Exit 1
}
`.trim();

    return new Promise((resolve) => {
        const buffer = Buffer.from(psScript, 'utf16le');
        const encodedScript = buffer.toString('base64');

        const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedScript]);

        let errorData = '';
        let stdoutData = '';

        ps.stdout.on('data', (data) => {
            const msg = data.toString();
            stdoutData += msg;
            if (msg.includes('DEBUG:')) {
                console.log(`[EMF Converter PS] ${msg.trim()}`);
            }
        });
        ps.stderr.on('data', (data) => {
            errorData += data.toString();
        });

        ps.on('error', (err) => {
            console.error(`[EMF Converter] Spawn error: ${err.message}`);
            resolve(null);
        });

        const timeout = setTimeout(() => {
            ps.kill();
            console.error(`[EMF Converter] Timeout converting ${path.basename(inputPath)}`);
            resolve(null);
        }, 15000);

        ps.on('close', (code) => {
            clearTimeout(timeout);
            if (code === 0 && stdoutData.includes('SUCCESS')) {
                console.log(`[EMF Converter] Successfully converted: ${path.basename(inputPath)} -> PNG`);
                resolve(outputPath);
            } else {
                const errorMessage = errorData || stdoutData || 'Unknown error';
                console.error(`[EMF Converter] Failed for ${path.basename(inputPath)} (Code ${code}): ${errorMessage}`);
                resolve(null);
            }
        });
    });
}

function convertOnLinux(inputPath, outputPath) {
    return new Promise((resolve) => {
        let cmd = '';
        let args = [];

        if (commandExists('inkscape')) {
            cmd = 'inkscape';
            args = [inputPath, '--export-filename=' + outputPath];
        } else if (commandExists('soffice')) {
            cmd = 'soffice';
            args = ['--headless', '--convert-to', 'png', '--outdir', path.dirname(outputPath), inputPath];
        } else if (commandExists('magick')) {
            cmd = 'magick';
            args = [inputPath, outputPath];
        } else {
            console.warn('[EMF Converter] No suitable conversion tool (inkscape, libreoffice, imagemagick) found on Linux. Skipping EMF conversion.');
            return resolve(null);
        }

        const proc = spawn(cmd, args);

        let errorData = '';
        proc.stderr.on('data', (data) => { errorData += data.toString(); });

        const timeout = setTimeout(() => {
            proc.kill();
            console.error(`[EMF Converter] Linux timeout converting ${path.basename(inputPath)} using ${cmd}`);
            resolve(null);
        }, 15000);

        proc.on('close', async (code) => {
            clearTimeout(timeout);
            if (code === 0) {
                try {
                    await fs.access(outputPath);
                    console.log(`[EMF Converter] Successfully converted on Linux: ${path.basename(inputPath)} -> PNG using ${cmd}`);
                    resolve(outputPath);
                } catch (e) {
                    console.error(`[EMF Converter] File not found after successful exit code using ${cmd}`);
                    resolve(null);
                }
            } else {
                console.error(`[EMF Converter] Failed for ${path.basename(inputPath)} using ${cmd} (Code ${code}): ${errorData}`);
                resolve(null);
            }
        });

        proc.on('error', (err) => {
            clearTimeout(timeout);
            console.error(`[EMF Converter] Spawn error on Linux using ${cmd}: ${err.message}`);
            resolve(null);
        });
    });
}