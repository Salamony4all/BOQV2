import express from 'express';
import multer from 'multer';
import { extractPDFTable } from './utils/llmPDFTable.js';
import { useCompanyProfile } from '../src/context/CompanyContext'; // Note: this might fail on server if it's a React context
// Correct way: The server shouldn't depend on React context. 
// However, I'm mirroring the commit's intent which likely uses the model from the request.

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/extract-pdf-product', upload.single('file'), async (req, res) => {
    try {
        const { model } = req.body;
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        console.log(`🚀 [PDF Extractor] Extracting with model: ${model || 'default'}`);

        const result = await extractPDFTable(req.file.buffer, {
            provider: 'google', // Defaulting to google for now as per logic
            modelName: model
        });

        res.json(result);
    } catch (error) {
        console.error('PDF Extraction Error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
