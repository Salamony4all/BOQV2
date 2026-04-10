import os
import json
import base64
import ollama
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
import uvicorn
from pydantic import BaseModel

app = FastAPI(title="BOQFLOW Local AI Service")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class LLMRequest(BaseModel):
    system_prompt: str
    user_prompt: str
    model: str = "llama3.2"

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.post("/llm")
async def llm_endpoint(request: LLMRequest):
    try:
        response = ollama.generate(
            model=request.model,
            system=request.system_prompt,
            prompt=request.user_prompt
        )
        return {"content": response['response']}
    except Exception as e:
        return {"error": str(e)}, 500

@app.post("/analyze-vision")
async def analyze_vision(file: UploadFile = File(...)):
    try:
        # Read file
        contents = await file.read()
        
        # System prompt for floor plan analysis
        system_prompt = """Analyze this floor plan drawing and extract FF&E (Furniture, Fixtures, and Equipment) items.
        Return a valid JSON object with an 'items' array. Each item should have:
        - description: clear name and details
        - qty: number found (default to 1 if unknown)
        - mainCategory: Furniture, Fitout, Lighting, etc.
        - subCategory: Table, Chair, Flooring, etc.
        - notes: any special marks or annotations
        
        ONLY return the JSON object. No markdown, no text."""
        
        # Call Ollama with the image
        response = ollama.generate(
            model='llama3.2-vision',
            prompt=system_prompt,
            images=[contents]
        )
        
        text_output = response['response']
        
        # Try to find JSON in output
        try:
            # Strip markdown code blocks if any
            clean_json = text_output.strip()
            if "```" in clean_json:
                clean_json = clean_json.split("```")[1]
                if clean_json.startswith("json"):
                    clean_json = clean_json[4:]
            
            data = json.loads(clean_json)
            return {"status": "success", "boq": data}
        except Exception as json_err:
            print(f"JSON Parse Error: {json_err}")
            # Fallback: maybe the AI just gave text, we'll try to rescue it or just return what we have
            return {
                "status": "partial_success", 
                "boq": { "items": [] },
                "raw_response": text_output
            }
            
    except Exception as e:
        print(f"Vision error: {e}")
        return {"error": str(e)}, 500

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
