import os
import json
import httpx
import logging
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# Configuration
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")

@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "Inference Server"}

@app.get("/v1/models")
async def list_models():
    """Proxy to get available models from Ollama"""
    async with httpx.AsyncClient() as client:
        try:
            # Ollama's endpoint for models is /api/tags
            response = await client.get(f"{OLLAMA_HOST}/api/tags")
            if response.status_code == 200:
                data = response.json()
                # Transform to match what Laravel ModelController expects
                # Laravel expects: {'models': [{'name': '...'}]}
                return {"models": data.get("models", [])}
            return JSONResponse(content={"error": "Failed to fetch models"}, status_code=response.status_code)
        except Exception as e:
            logger.error(f"Models Error: {str(e)}")
            return JSONResponse(content={"error": str(e)}, status_code=500)

@app.post("/v1/completion")
async def completion(request: Request):
    """
    Handle code completion.
    Laravel sends: { code, language, model, max_tokens, temperature, context_files }
    """
    body = await request.json()
    
    # Construct a prompt for Ollama
    code = body.get("code", "")
    language = body.get("language", "text")
    context_files = body.get("context_files", [])
    
    # Build a prompt context from files
    context_str = ""
    for file in context_files:
        context_str += f"\nFile: {file.get('path')}\nContent:\n{file.get('content')}\n"
        
    prompt = f"{context_str}\n\nComplete the following {language} code. Do not output markdown, just the code:\n\n{code}"

    payload = {
        "model": body.get("model", "codellama:7b"),
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": float(body.get("temperature", 0.2)),
            "num_predict": int(body.get("max_tokens", 100))
        }
    }

    async with httpx.AsyncClient(timeout=300.0) as client:
        try:
            # Call Ollama Generate API
            response = await client.post(f"{OLLAMA_HOST}/api/generate", json=payload)
            if response.status_code == 200:
                result = response.json()
                # Return format expected by CompletionController.php
                return {
                    "completion": result.get("response", ""),
                    "tokens": result.get("eval_count", 0)
                }
            else:
                logger.error(f"Ollama Error: {response.text}")
                raise HTTPException(status_code=500, detail=f"Ollama API Error: {response.text}")
        except Exception as e:
            logger.error(f"Connection Error: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/chat")
async def chat(request: Request):
    """
    Handle chat.
    Laravel sends: { messages, model, context, stream }
    """
    body = await request.json()
    model = body.get("model", "codellama:7b")
    messages = body.get("messages", [])
    stream = body.get("stream", False)

    print(f"------------ REQUESTING MODEL: {model} (Stream: {stream}) ------------")
    
    payload = {
        "model": model,
        "messages": messages,
        "stream": stream
    }

    # --- STREAMING RESPONSE HANDLING ---
    if stream:
        async def generate_stream():
            async with httpx.AsyncClient(timeout=300.0) as client:
                try:
                    async with client.stream(
                        "POST", 
                        f"{OLLAMA_HOST}/api/chat", 
                        json=payload
                    ) as response:
                        if response.status_code != 200:
                            # Yield error as a chunk so frontend receives it
                            yield json.dumps({"error": f"Ollama Error: {response.status_code}"}).encode()
                            return

                        async for chunk in response.aiter_bytes():
                            yield chunk
                except Exception as e:
                    logger.error(f"Streaming Error: {str(e)}")
                    yield json.dumps({"error": str(e)}).encode()

        # Return a StreamingResponse so data flows immediately
        return StreamingResponse(generate_stream(), media_type="application/x-ndjson")

    # --- STANDARD RESPONSE HANDLING (Non-Streaming) ---
    async with httpx.AsyncClient(timeout=300.0) as client:
        try:
            response = await client.post(f"{OLLAMA_HOST}/api/chat", json=payload)
            if response.status_code == 200:
                result = response.json()
                # Return format expected by CompletionController.php
                return {
                    "message": result.get("message", {}),
                    "eval_count": result.get("eval_count", 0),
                    "prompt_eval_count": result.get("prompt_eval_count", 0)
                }
            
            error_msg = response.text
            logger.error(f"Chat Error: {error_msg}")
            raise HTTPException(status_code=response.status_code, detail=error_msg)
            
        except Exception as e:
            logger.error(f"Chat Connection Error: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)