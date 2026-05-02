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
    
    # Try to load as Metafile specifically for better header access
    # We use New-Object to avoid some lock issues and to be explicit
    $img = New-Object System.Drawing.Imaging.Metafile($in)
    
    # Get dimensions. Metafiles can have unusual units.
    # We use PhysicalDimension to get pixels at current screen resolution
    $width = [int]$img.Width
    $height = [int]$img.Height
    
    # Fallback if dimensions are suspicious
    if ($width -le 1 -or $height -le 1) {
        $width = [int]$img.PhysicalDimension.Width
        $height = [int]$img.PhysicalDimension.Height
    }
    
    # If still 0, we can't proceed
    if ($width -le 0 -or $height -le 0) {
        Throw "Invalid image dimensions: $($width)x$($height)"
    }

    Write-Host "DEBUG: Dimensions: $($width)x$($height)"
    
    # Limit max size to prevent OOM (e.g. 8k resolution)
    if ($width -gt 8192 -or $height -gt 8192) {
        $ratio = [Math]::Min(8192/$width, 8192/$height)
        $width = [int]($width * $ratio)
        $height = [int]($height * $ratio)
        Write-Host "DEBUG: Downscaling to $($width)x$($height)"
    }
    
    # Create a high-quality bitmap to draw into
    $bmp = New-Object System.Drawing.Bitmap($width, $height)
    $bmp.SetResolution(96, 96) # Standard web DPI
    
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    
    # Set high quality rendering settings
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    
    # Clear with transparency
    $g.Clear([System.Drawing.Color]::Transparent)
    
    # Draw the metafile onto the bitmap
    $g.DrawImage($img, 0, 0, $width, $height)
    
    # Save as PNG
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    
    # Cleanup
    $g.Dispose()
    $bmp.Dispose()
    $img.Dispose()
    
    Write-Output "SUCCESS"
} Catch {
    $msg = $_.Exception.Message
    if ($_.Exception.InnerException) { $msg += " ($($_.Exception.InnerException.Message))" }
    Write-Error "EMF Conversion Error: $msg"
    
    # Attempt cleanup on error
    if ($g) { try { $g.Dispose() } catch {} }
    if ($bmp) { try { $bmp.Dispose() } catch {} }
    if ($img) { try { $img.Dispose() } catch {} }
    Exit 1
}
`.trim();

    return new Promise((resolve) => {
        // Use -EncodedCommand to avoid any shell escaping issues with complex characters
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

        // Add a timeout to prevent hanging processes
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
