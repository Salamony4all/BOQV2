import { getApiBase } from './apiBase';

const API_BASE = getApiBase();

/**
 * Executes a Value Engineered AI Match API call.
 * This identifies a product from a target brand based on an item description.
 * 
 * @param {string} description - The BOQ item description
 * @param {string} targetBrand - The brand to match against
 * @param {number} qty - Item quantity
 * @param {string} unit - Item unit
 * @param {string} label - Category label (optional hint)
 * @returns {Promise<Object>} The API response with success status and product details
 */
export async function executeValueEngineeredAI_API(description, targetBrand, qty, unit, label) {
    try {
        const response = await fetch(`${API_BASE}/api/ve-match`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                description, 
                brand: targetBrand, 
                qty, 
                unit, 
                category: label 
            })
        });
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Normalize status for the frontend which expects .success
        return {
            ...data,
            success: data.status === 'success' || data.success === true
        };
    } catch (error) {
        console.error(' [AI Utils] executeValueEngineeredAI_API failed:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Executes a Value Engineered Routing API call.
 * This categorizes items into groups like Desking, Seating, etc.
 * 
 * @param {Array} items - List of { id, desc } items
 * @returns {Promise<Object>} The routing results with categoryMap
 */
export async function executeValueEngineeredRouting_API(items) {
    try {
        const response = await fetch(`${API_BASE}/api/ve-route`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items })
        });
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error(' [AI Utils] executeValueEngineeredRouting_API failed:', error);
        return { status: 'error', error_message: error.message };
    }
}
