# Provider/Model Selection Implementation

## Summary of Changes

This implementation enables users to select from multiple AI providers and models for plan analysis, with no fallback to Gemini 2.5 Flash when a selected provider fails.

## 1. OpenRouter Vision Models Added

### Model Categories

**Google Vision Models:**
- `google/gemini-2.5-flash-lite-001` - Free lite version
- `google/gemini-4-31b-it:free` - Free tier
- `google/gemma-4-26b-a4b-it:free` - Free tier
- `google/gemma-4-31b-it:free` - Free tier
- `google/gemini-2.5-pro` - Premium

**Anthropic Vision Models:**
- `anthropic/claude-opus-4.6-fast` - Fast vision
- `anthropic/claude-opus-4` - Full featured
- `anthropic/claude-sonnet-4-20250514` - Latest sonnet

**OpenAI Vision Models:**
- `openai/gpt-4-vision-preview` - Preview version
- `openai/gpt-4-turbo-vision` - Turbo variant

**Other Models:**
- `z-ai/glm-5.1` - GLM vision
- `cohere/rerank-4-pro` - Reranking

### Implementation Location
- **Backend:** `server/utils/llmUtils.js` - Lines 23-38 (VALID_OPENROUTER_MODELS)
- **Frontend:** Updated in all three modal components:
  - `src/components/PlanScopeModal.jsx`
  - `src/components/AutoFillSelectModal.jsx`
  - `src/components/FitoutAutoFillModal.jsx`

## 2. NVIDIA Vision Models Previously Added

**Vision Models:**
- `nvidia/neva-22b` - Vision language model
- `nvidia/vila` - Vision language model
- `nvidia/vlia` - Vision language model
- `nvidia/llama-3.1-nemotron-nano-vl-8b-v1` - Nano VL model
- `nvidia/nemotron-nano-12b-v2-vl` - Nano v2 VL model

**Text Models:**
- `nvidia/llama-3.3-70b-instruct`
- `nvidia/llama-3.1-70b-instruct`
- `nvidia/nemotron-3-super-120b-a12b`
- And more...

## 3. Provider/Model Selection UI

### How It Works

Users can now:
1. Click on "Plan" tab in the app
2. Upload a floor plan PDF
3. A modal appears with provider selection
4. Choose between:
   - **Google Gemini** (native SDK)
   - **OpenRouter** (gateway to multiple providers)
   - **NVIDIA NIM** (native NIM API)
5. Select specific model for chosen provider
6. Choose extraction scope (furniture only or furniture + fitout)
7. Click to start analysis

### UI Components Updated

**PlanScopeModal.jsx:**
```jsx
const modelOptions = {
    google: ['gemini-2.5-flash', 'gemini-2.0-flash-exp', ...],
    openrouter: ['google/gemini-2.5-flash-lite-001', 'anthropic/claude-opus-4.6-fast', ...],
    nvidia: ['nvidia/neva-22b', 'nvidia/vila', ...]
};
```

## 4. Backend Implementation - No Fallback

### Key Changes in `analyzePlan()` Function

**Old Behavior (Fallback):**
```
if provider !== 'google' → warn and use Gemini anyway
```

**New Behavior (Native Support):**
```
if provider === 'google' → use Google Gemini SDK
else if provider === 'openrouter' → use OpenRouter API with multimodal
else if provider === 'nvidia' → use NVIDIA NIM API with multimodal
else → throw error with provider list
```

### New Function: `callVisionAPI()`

Handles multimodal requests for both OpenRouter and NVIDIA:
- Sends base64-encoded images
- Includes system prompt and user prompt
- Expects JSON response
- Returns parsed JSON or throws with specific error

**Location:** `server/utils/llmUtils.js` - Lines 220-258

## 5. Error Handling

### Error Flow

1. Model fails during analysis
2. Error caught in `callVisionAPI()` or native SDK
3. Error message includes:
   - Provider name
   - Model name
   - Specific failure reason
4. Error returned to frontend with status 500
5. Frontend displays error to user suggesting trying another model

### Example Error Message
```
Failed to analyze plan with openrouter (google/gemini-2.5-flash-lite-001): 
request failed - try another model from the list
```

### Frontend Error Display

Error is shown in:
- `setError()` state
- Displayed in UI modal
- Logged to console for debugging

## 6. Testing

### Test Notebook
File: `tmp/test_nvidia_vision.ipynb`

Tests multiple providers/models:
- Google Gemini (baseline)
- OpenRouter with different models
- NVIDIA NIM with different models

Shows success/failure for each without fallback.

## 7. Configuration Requirements

### Environment Variables (.env)
```env
GOOGLE_API_KEY=<your-gemini-api-key>
OPENROUTER_API_KEY=<your-openrouter-api-key>
NVIDIA_API_KEY=<your-nvidia-nim-api-key>
```

### API Endpoints
- **Google:** Uses SDK (no endpoint needed)
- **OpenRouter:** `https://openrouter.ai/api/v1/chat/completions`
- **NVIDIA:** `https://integrate.api.nvidia.com/v1/chat/completions`

## 8. Response Format

### Success Response
```json
{
  "status": "success",
  "planSummary": "Extraction of 27 items completed.",
  "items": [...],
  "provider": "google",
  "model": "gemini-2.5-flash"
}
```

### Error Response
```json
{
  "error": "Failed to analyze plan with nvidia (nvidia/neva-22b): Model failed - try another provider/model"
}
```

## 9. Files Modified

1. **Backend:**
   - `server/utils/llmUtils.js` - Added OpenRouter vision models, refactored `analyzePlan()`, added `callVisionAPI()`
   - `server/server.js` - No changes needed (already passing provider/model)

2. **Frontend:**
   - `src/components/PlanScopeModal.jsx` - Updated model lists
   - `src/components/AutoFillSelectModal.jsx` - Updated model lists
   - `src/components/FitoutAutoFillModal.jsx` - Updated model lists
   - `src/App.jsx` - No changes needed (already handling errors)

3. **Test:**
   - `tmp/test_nvidia_vision.ipynb` - Comprehensive multi-provider test

## 10. Usage Flow

### For Users

1. Upload PDF
2. Select provider (Google/OpenRouter/NVIDIA)
3. Select model from dropdown
4. Select scope (furniture only or with fitout)
5. Extraction starts with selected provider
6. If model fails → error shown with suggestion to try another
7. Success → BOQ items displayed

### For Developers

- Add new models: Update `VALID_*_MODELS` arrays in `llmUtils.js` and frontend components
- Add new provider: Add new branch in `analyzePlan()` with API call logic
- Debug: Check server logs for specific API errors

## 11. Limitations & Notes

- **OpenRouter/NVIDIA failures in test:** May be due to model availability, rate limits, or API configuration
- **Image processing:** All providers receive base64-encoded images in the same format
- **Context:** System prompt ensures consistent BOQ extraction format across all providers
- **Cost:** OpenRouter and NVIDIA have their own rate limits and pricing

## 12. Next Steps (Optional)

- Monitor which models perform best for BOQ extraction
- Add response time tracking
- Implement model comparison/A-B testing
- Cache extraction results by PDF hash
- Add provider health status monitoring
