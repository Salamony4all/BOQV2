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
 * Pure-JS embedded raster extractor for Excel EMF/WMF metafiles (zero Railway sidecar needed).
 * Extracts embedded PNG, JPEG, or Windows DIB bitmaps directly from EMF/WMF records.
 */
export function extractEmbeddedRasterFromMetafile(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 32) return null;

    // 1. Scan for embedded PNG stream (89 50 4E 47 0D 0A 1A 0A ... IEND AE 42 60 82)
    const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const pngIdx = buffer.indexOf(pngSig);
    if (pngIdx !== -1) {
        const iendSig = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
        const endIdx = buffer.indexOf(iendSig, pngIdx + 8);
        if (endIdx !== -1) {
            return { ext: '.png', data: buffer.subarray(pngIdx, endIdx + 8) };
        }
    }

    // 2. Scan for embedded JPEG stream (FF D8 FF ... FF D9)
    const jpgSig = Buffer.from([0xff, 0xd8, 0xff]);
    const jpgIdx = buffer.indexOf(jpgSig);
    if (jpgIdx !== -1) {
        const eoiSig = Buffer.from([0xff, 0xd9]);
        const endIdx = buffer.lastIndexOf(eoiSig);
        if (endIdx > jpgIdx + 16) {
            return { ext: '.jpg', data: buffer.subarray(jpgIdx, endIdx + 2) };
        }
    }

    // 3. Parse EMF EMR_STRETCHDIBITS (0x51) or EMR_BITBLT (0x4C) DIB payload into a BMP buffer
    if (buffer.readUInt32LE(0) === 1 && buffer.length > 88) {
        let offset = buffer.readUInt32LE(4); // header nSize
        while (offset + 8 <= buffer.length) {
            const recType = buffer.readUInt32LE(offset);
            const recSize = buffer.readUInt32LE(offset + 4);
            if (recSize < 8 || offset + recSize > buffer.length) break;
            if (recType === 81 && recSize >= 80) { // EMR_STRETCHDIBITS
                const offBmi = buffer.readUInt32LE(offset + 48);
                const cbBmi = buffer.readUInt32LE(offset + 52);
                const offBits = buffer.readUInt32LE(offset + 56);
                const cbBits = buffer.readUInt32LE(offset + 60);
                if (cbBmi >= 40 && cbBits > 0 && offBmi + cbBmi <= recSize && offBits + cbBits <= recSize) {
                    const bmi = buffer.subarray(offset + offBmi, offset + offBmi + cbBmi);
                    const bits = buffer.subarray(offset + offBits, offset + offBits + cbBits);
                    const fileHeader = Buffer.alloc(14);
                    fileHeader.write('BM', 0, 'ascii');
                    fileHeader.writeUInt32LE(14 + cbBmi + cbBits, 2);
                    fileHeader.writeUInt32LE(14 + cbBmi, 10);
                    return { ext: '.bmp', data: Buffer.concat([fileHeader, bmi, bits]) };
                }
            }
            if (recType === 14) break; // EMR_EOF
            offset += recSize;
        }
    }
    return null;
}

/**
 * Converts EMF/WMF files to PNG.
 * Uses Windows GDI+ via PowerShell on Windows, Inkscape/LibreOffice/ImageMagick on Linux,
 * and falls back to pure-JS embedded raster extraction on serverless runtimes (no Railway).
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
    // 1. Try local OS tools first (if available)
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

    // 2. Serverless Pure-JS Fallback: extract embedded PNG/JPEG/DIB directly from EMF/WMF
    try {
        const metaBuf = await fs.readFile(inputPath);
        const extracted = extractEmbeddedRasterFromMetafile(metaBuf);
        if (extracted && extracted.data) {
            const targetOut = extracted.ext === '.png'
                ? outputPath
                : outputPath.replace(/\.png$/i, extracted.ext);
            await fs.writeFile(targetOut, extracted.data);
            console.log(`[EMF Converter] Pure-JS metafile raster extracted: ${path.basename(targetOut)} (${extracted.data.length} bytes)`);
            return targetOut;
        }
    } catch (e) {
        console.warn(`[EMF Converter] Pure-JS extraction warning for ${path.basename(inputPath)}:`, e.message);
    }

    console.warn(`[EMF Converter] Pure vector EMF without embedded raster on serverless Linux: ${path.basename(inputPath)}`);
    return null;
}