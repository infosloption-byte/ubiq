import os
import json
import logging
import httpx 
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from dotenv import load_dotenv
from openai import AsyncOpenAI

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# --- CONFIGURATION ---
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")

# Defined Cloud Models (Manual List)
# Updated Gemini to 2.0 Flash
CLOUD_MODELS = [
    {"name": "grok-beta", "provider": "xAI", "size": "Cloud", "parameter_size": "Unknown"},
    {"name": "mistral-large-latest", "provider": "Mistral", "size": "Cloud", "parameter_size": "Large"},
    {"name": "codestral-latest", "provider": "Mistral", "size": "Cloud", "parameter_size": "22B"},
    {"name": "openrouter/anthropic/claude-3.5-sonnet", "provider": "OpenRouter", "size": "Cloud", "parameter_size": "Huge"},
    {"name": "openrouter/openai/gpt-4o", "provider": "OpenRouter", "size": "Cloud", "parameter_size": "Huge"},
    {"name": "gemini-2.0-flash", "provider": "Google", "size": "Cloud", "parameter_size": "Fast"},
]

# --- HELPER: Format Bytes ---
def format_size(size_bytes):
    if not size_bytes:
        return "0 MB"
    power = 2**10
    n = size_bytes
    power_labels = {0 : '', 1: 'K', 2: 'M', 3: 'G', 4: 'T'}
    count = 0
    while n > power:
        n /= power
        count += 1
    return f"{n:.1f} {power_labels[count]}B"

# --- FACTORY: CLIENT SWITCHER ---
def get_ai_client(model_id: str, user_keys: Dict[str, str] = {}):
    """
    Returns (AsyncOpenAI_Client, clean_model_name).
    """
    
    # Helper to get key or raise error
    def require_key(provider_id, env_var, display_name):
        key = user_keys.get(provider_id)
        if not key or not key.strip():
            key = os.getenv(env_var)
        
        if not key or not key.strip():
            raise HTTPException(
                status_code=400, 
                detail=f"Missing API Key for {display_name}. Please add it in Settings."
            )
        return key

    # 1. MISTRAL
    if "mistral" in model_id or "codestral" in model_id:
        key = require_key("mistral", "MISTRAL_API_KEY", "Mistral AI")
        return AsyncOpenAI(
            base_url="https://api.mistral.ai/v1",
            api_key=key
        ), model_id

    # 2. GROK (xAI)
    elif "grok" in model_id:
        key = require_key("grok", "GROK_API_KEY", "xAI (Grok)")
        return AsyncOpenAI(
            base_url="https://api.x.ai/v1",
            api_key=key
        ), model_id

    # 3. OPENROUTER
    elif model_id.startswith("openrouter/"):
        clean_name = model_id.replace("openrouter/", "")
        key = require_key("openrouter", "OPENROUTER_API_KEY", "OpenRouter")
        
        return AsyncOpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=key,
            default_headers={
                "HTTP-Referer": "http://localhost:3000",
                "X-Title": "Ubiq IDE"
            }
        ), clean_name

    # 4. GOOGLE GEMINI
    elif "gemini" in model_id:
        key = require_key("google", "GEMINI_API_KEY", "Google Gemini")
        # Google's OpenAI-compatible endpoint
        # We DO NOT add 'models/' prefix here; the client usually handles it or 2.0-flash works directly.
        return AsyncOpenAI(
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
            api_key=key
        ), model_id

    # 5. OLLAMA (Default)
    else:
        return AsyncOpenAI(
            base_url=f"{OLLAMA_HOST}/v1",
            api_key="ollama" 
        ), model_id


# --- ENDPOINTS ---

@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "Inference Server"}

@app.get("/v1/models")
async def list_models():
    try:
        local_models = []
        try:
            async with httpx.AsyncClient(timeout=2.0) as http_client:
                response = await http_client.get(f"{OLLAMA_HOST}/api/tags")
                if response.status_code == 200:
                    data = response.json()
                    for m in data.get("models", []):
                        local_models.append({
                            "name": m.get("name"),
                            "provider": "Ollama",
                            "size": format_size(m.get("size", 0)),
                            "parameter_size": m.get("details", {}).get("parameter_size", "Unknown")
                        })
        except Exception as e:
            logger.warning(f"Ollama offline: {e}")

        all_models = local_models + CLOUD_MODELS
        return {"models": all_models}
    except Exception as e:
        logger.error(f"Models Error: {str(e)}")
        return JSONResponse(content={"error": str(e)}, status_code=500)


@app.post("/v1/completion")
async def completion(request: Request):
    try:
        body = await request.json()
        model_id = body.get("model", "codellama:7b")
        code = body.get("code", "")
        language = body.get("language", "text")
        user_keys = body.get("api_keys", {}) 
        
        prompt = f"Complete this {language} code:\n\n{code}"

        client, clean_model = get_ai_client(model_id, user_keys)

        response = await client.chat.completions.create(
            model=clean_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=100,
            stream=False
        )

        return {
            "completion": response.choices[0].message.content,
            "tokens": response.usage.total_tokens if response.usage else 0
        }

    except HTTPException as he:
        raise he 
    except Exception as e:
        logger.error(f"Completion Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/v1/chat")
async def chat(request: Request):
    try:
        body = await request.json()
        model_id = body.get("model", "codellama:7b")
        messages = body.get("messages", [])
        stream = body.get("stream", False)
        user_keys = body.get("api_keys", {})

        print(f"--- REQUEST: {model_id} (Stream: {stream}) ---")

        client, clean_model = get_ai_client(model_id, user_keys)

        # Set strict token limit for cloud to prevent 402 Errors
        safe_max_tokens = 2048

        if stream:
            async def generate_stream():
                try:
                    stream_response = await client.chat.completions.create(
                        model=clean_model,
                        messages=messages,
                        stream=True,
                        max_tokens=safe_max_tokens
                    )
                    
                    async for chunk in stream_response:
                        if not chunk.choices or len(chunk.choices) == 0:
                            continue
                            
                        delta = chunk.choices[0].delta
                        if delta.content:
                            ollama_style = {
                                "message": {"content": delta.content},
                                "done": False
                            }
                            yield json.dumps(ollama_style) + "\n"
                            
                    yield json.dumps({"message": {"content": ""}, "done": True}) + "\n"

                except Exception as e:
                    logger.error(f"Stream Error: {e}")
                    
                    err_str = str(e).lower()
                    msg = f"Error: {str(e)}"
                    
                    # --- USER FRIENDLY ERROR MAPPING ---
                    if "401" in err_str: 
                        msg = "Authentication Failed: Please check your API Key in Settings."
                    elif "402" in err_str: 
                        msg = "Insufficient Credits: Your account balance is too low for this request."
                    elif "403" in err_str: 
                        msg = "Access Denied: Your account lacks permission (check billing/team credits)."
                    elif "404" in err_str: 
                        msg = f"Model Not Found: '{clean_model}' is not available or valid."
                    elif "429" in err_str: 
                        msg = "Rate Limit Exceeded: You are sending requests too fast or hit your daily quota."
                    elif "context_length_exceeded" in err_str:
                        msg = "Context too large: The conversation is too long for this model."
                    
                    yield json.dumps({"error": msg}) + "\n"

            return StreamingResponse(generate_stream(), media_type="application/x-ndjson")

        else:
            response = await client.chat.completions.create(
                model=clean_model,
                messages=messages,
                stream=False,
                max_tokens=safe_max_tokens
            )
            return {
                "message": {
                    "role": response.choices[0].message.role,
                    "content": response.choices[0].message.content
                },
                "eval_count": response.usage.completion_tokens if response.usage else 0,
                "prompt_eval_count": response.usage.prompt_tokens if response.usage else 0
            }

    except HTTPException as he:
        raise he 
    except Exception as e:
        logger.error(f"Chat Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)