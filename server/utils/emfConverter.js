import { spawn, execSync } from 'child_process';
import path from 'path';
import { promises as fs } from 'fs';
import os from 'os';
import axios from 'axios';

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
 * Further falls back to Railway sidecar if local tools are missing (e.g. on Vercel).
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
    // ... existing implementation ...
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

async function convertOnLinux(inputPath, outputPath) {
    const JS_SCRAPER_SERVICE_URL = process.env.JS_SCRAPER_SERVICE_URL;

    // 1. Try local tools first (if available)
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
    }

    if (cmd) {
        console.log(`[EMF Converter] Attempting local conversion using ${cmd}...`);
        return new Promise((resolve) => {
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
    } else {
        console.warn(`[EMF Converter] No local conversion tools (inkscape, soffice, magick) found on Linux environment.`);
    }

    // 2. Fallback to Railway Sidecar (if configured)
    if (JS_SCRAPER_SERVICE_URL) {
        console.log(`[EMF Converter] Offloading ${path.basename(inputPath)} to Railway sidecar at ${JS_SCRAPER_SERVICE_URL}...`);
        try {
            const buffer = await fs.readFile(inputPath);
            const base64Image = buffer.toString('base64');
            
            const response = await axios.post(`${JS_SCRAPER_SERVICE_URL}/convert-image`, {
                image: base64Image,
                filename: path.basename(inputPath)
            }, { timeout: 30000 });

            if (response.data && response.data.success && response.data.image) {
                const pngBuffer = Buffer.from(response.data.image, 'base64');
                await fs.writeFile(outputPath, pngBuffer);
                console.log(`[EMF Converter] Successfully converted via Railway: ${path.basename(inputPath)} -> PNG`);
                return outputPath;
            } else {
                console.warn(`[EMF Converter] Railway sidecar conversion failed: ${response.data?.error || 'Unknown error'}`);
                if (response.data?.details) console.warn(`[EMF Converter] Railway sidecar details: ${response.data.details}`);
            }
        } catch (err) {
            console.error(`[EMF Converter] Error calling Railway sidecar for conversion at ${JS_SCRAPER_SERVICE_URL}:`, err.message);
            if (err.response) {
                console.error(`[EMF Converter] Sidecar response status: ${err.response.status}`);
                console.error(`[EMF Converter] Sidecar response data:`, err.response.data);
            }
        }
    } else {
        console.warn(`[EMF Converter] JS_SCRAPER_SERVICE_URL not configured. Check Vercel environment variables.`);
    }

    console.warn(`[EMF Converter] Conversion failed for ${path.basename(inputPath)}. Local tools: ${!!cmd}, Sidecar: ${!!JS_SCRAPER_SERVICE_URL}`);
    return null;
}