import { spawn } from 'child_process';
import { promises as fs, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_SCRIPT = path.join(__dirname, 'pdf_navigator.py');

const getPythonPath = () => {
    const winVenv = path.resolve(process.cwd(), '.venv', 'Scripts', 'python.exe');
    const unixVenv = path.resolve(process.cwd(), '.venv', 'bin', 'python');
    if (existsSync(winVenv)) return winVenv;
    if (existsSync(unixVenv)) return unixVenv;
    return 'python';
};

const PYTHON_BIN = getPythonPath();

/**
 * PRIMARY ENGINE: PyMuPDF for native extraction.
 */
export async function renderPDFWithLayout(filePath, pages = null) {
    const outputDir = path.join(path.dirname(filePath), 'extracted_assets');
    await fs.mkdir(outputDir, { recursive: true });

    console.log(`  🚀 [PDF Renderer] Native Layered Engine: ${path.basename(filePath)}${pages ? ` (Target Pages: ${pages.join(',')})` : ''}`);
    
    return new Promise((resolve, reject) => {
        const args = [PYTHON_SCRIPT, filePath, outputDir];
        if (pages && pages.length > 0) {
            args.push('--pages', pages.join(','));
        }
        let pythonProcess;
        try {
            pythonProcess = spawn(PYTHON_BIN, args);
        } catch (spawnErr) {
            console.warn(`    ⚠️ [PDF Renderer] Failed to spawn python (${PYTHON_BIN}): ${spawnErr.message}`);
            return reject(new Error(`Python process spawn failed: ${spawnErr.message}`));
        }

        let stdoutData = '';
        let stderrData = '';

        pythonProcess.on('error', (err) => {
            console.warn(`    ⚠️ [PDF Renderer] Python process error: ${err.message}`);
            reject(new Error(`Python process error: ${err.message}`));
        });

        pythonProcess.stdout?.on('data', (data) => { stdoutData += data; });
        pythonProcess.stderr?.on('data', (data) => { stderrData += data; });

        pythonProcess.on('close', async (code) => {
            if (code !== 0) {
                console.error(`    ❌ [Python Error] Code ${code}: ${stderrData}`);
                return reject(new Error(`Python process failed: ${stderrData}`));
            }

            try {
                const jsonStart = stdoutData.indexOf('{"success"');
                if (jsonStart === -1) throw new Error("No JSON found in python output");
                
                const response = JSON.parse(stdoutData.substring(jsonStart));
                if (!response.success) throw new Error(response.error);

                const layoutFilePath = path.join(outputDir, 'layout.json');
                const layoutFileContent = await fs.readFile(layoutFilePath, 'utf8');
                const layoutData = JSON.parse(layoutFileContent);

                const results = layoutData.data.map(pageData => ({
                    page: pageData.page,
                    fullImage: null, // DEFERRED: No more automatic full page scan
                    extractedImages: pageData.nativeImages.map(img => ({
                        x: img.x,
                        y: img.y,
                        w: img.w,
                        h: img.h,
                        path: path.join(outputDir, img.path),
                        isNative: true
                    })),
                    textItems: pageData.textItems,
                    viewport: pageData.viewport
                }));

                resolve(results);
            } catch (err) {
                reject(err);
            }
        });
    });
}

/**
 * ON-DEMAND FALLBACK: Renders a single page full scan using PyMuPDF.
 * Used when Sharp needs to crop from a flattened view.
 */
export async function renderSinglePageFull(pdfPath, pageNum, outputPath) {
    console.log(`  🎞️ [PDF Renderer] On-Demand Fallback Scan: Page ${pageNum}`);
    return new Promise((resolve, reject) => {
        let pythonProcess;
        try {
            pythonProcess = spawn(PYTHON_BIN, [PYTHON_SCRIPT, '--render-page', pdfPath, pageNum.toString(), outputPath]);
        } catch (spawnErr) {
            return reject(new Error(`Python process spawn failed: ${spawnErr.message}`));
        }
        
        let stdoutData = '';
        pythonProcess.on('error', (err) => reject(new Error(`Python process error: ${err.message}`)));
        pythonProcess.stdout?.on('data', (data) => { stdoutData += data; });

        pythonProcess.on('close', (code) => {
            if (code !== 0) return reject(new Error(`Page render failed with code ${code}`));
            try {
                const response = JSON.parse(stdoutData);
                if (response.success) resolve(response.path);
                else reject(new Error(response.error));
            } catch(e) { reject(e); }
        });
    });
}

/** Compatibility versions (Legacy) */
export async function renderPDFToSimpleImages(filePath) {
    // This is now inefficient because it renders one by one, 
    // but better for nodemon avoidence.
    const layout = await renderPDFWithLayout(filePath);
    const buffers = [];
    const tempDir = path.join(path.dirname(filePath), 'extracted_assets');
    
    for (const p of layout) {
        const outputPath = path.join(tempDir, `page_${p.page}_full.png`);
        await renderSinglePageFull(filePath, p.page, outputPath);
        buffers.push(await fs.readFile(outputPath));
    }
    return buffers;
}

export async function renderPDFToImages(filePath) {
    return renderPDFToSimpleImages(filePath);
}
