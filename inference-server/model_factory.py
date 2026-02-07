import os
from openai import AsyncOpenAI # Use Async for better performance
from dotenv import load_dotenv

load_dotenv()

def get_ai_client(model_id: str, user_provided_key: str = None):
    """
    Returns (client, actual_model_name) based on the provider.
    Prioritizes user_provided_key if sent from Frontend, else falls back to .env
    """
    
    # --- 1. MISTRAL ---
    if model_id.startswith("mistral/") or "codestral" in model_id:
        api_key = user_provided_key or os.getenv("MISTRAL_API_KEY")
        return AsyncOpenAI(
            base_url="https://api.mistral.ai/v1",
            api_key=api_key
        ), model_id.replace("mistral/", "") # Remove prefix if needed

    # --- 2. GROK (xAI) ---
    elif model_id.startswith("grok"):
        api_key = user_provided_key or os.getenv("GROK_API_KEY")
        return AsyncOpenAI(
            base_url="https://api.x.ai/v1",
            api_key=api_key
        ), model_id

    # --- 3. OPENROUTER (Claude, GPT-4, etc.) ---
    elif model_id.startswith("openrouter/"):
        api_key = user_provided_key or os.getenv("OPENROUTER_API_KEY")
        # OpenRouter expects the header 'HTTP-Referer' for rankings (optional)
        return AsyncOpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=api_key,
            default_headers={"HTTP-Referer": "http://localhost:3000"}
        ), model_id.replace("openrouter/", "") # Keep the vendor prefix (e.g. anthropic/claude...)

    # --- 4. GOOGLE GEMINI (via OpenAI Compat) ---
    elif "gemini" in model_id:
        api_key = user_provided_key or os.getenv("GEMINI_API_KEY")
        return AsyncOpenAI(
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
            api_key=api_key
        ), model_id

    # --- 5. OLLAMA (Default / Fallback) ---
    else:
        return AsyncOpenAI(
            base_url=os.getenv("OLLAMA_BASE_URL"),
            api_key="ollama" # Not used but required
        ), model_id