import { multimodalExtract } from './llmUtils.js';
import { PDF_BOQ_PROMPT } from './llmPrompts.js';

export async function extractPDFTable(pdfBuffer, options = {}) {
    const { provider = 'google', modelName = null } = options;
    
    console.log(`📊 [PDF Table Extractor] Starting extraction with ${provider}...`);

    try {
        const base64Data = pdfBuffer.toString('base64');
        const systemPrompt = "You are an expert BOQ quantity surveyor. Extract tabular data from the provided document accurately.";
        const userPrompt = PDF_BOQ_PROMPT();

        const assets = [
            {
                base64Data,
                mimeType: 'application/pdf'
            }
        ];

        const result = await multimodalExtract(systemPrompt, userPrompt, assets, {
            provider,
            model: modelName,
            jsonMode: true
        });

        return result;
    } catch (error) {
        console.error('  ❌ [PDF Table Extractor Error]:', error.message);
        throw error;
    }
}
