import axios from 'axios';
import { useAuthStore } from '../stores/authStore';

// Define the structure for chat messages
export interface ChatMessage {
    role: string;
    content: string;
}

// Unified config passed from the UI layer.
//   1. Cloud BYOK  — D8 fix: provider keys are resolved server-side from
//      encrypted storage now (see CompletionController::mergeServerKeys);
//      nothing provider-secret related is ever sent through this field.
//   2. Local Ollama — api_keys.ollama_url = 'http://localhost:11434'
//   3. Remote Ollama — api_keys.ollama_url = 'https://my-ec2.example.com:11434'
export interface AiApiConfig {
    api_keys?: {
        ollama_url?: string;
    };
    project_id?: number;
}

export const aiService = {
    chat: async (
        message: string, 
        history: ChatMessage[] = [], 
        mode: string, 
        selectedModel: string, 
        apiConfig?: AiApiConfig
    ) => {
        if (mode === 'cloud') {
            return await chatCloud(message, history, selectedModel, apiConfig?.project_id);
        } else if (mode === 'remote') {
            // Remote Ollama — URL must be explicitly configured by the user
            const remoteUrl = apiConfig?.api_keys?.ollama_url?.trim();
            if (!remoteUrl) {
                throw new Error("Remote Ollama URL not configured. Open the settings panel and enter your server URL.");
            }
            return await chatLocal(message, history, selectedModel, remoteUrl);
        } else {
            // Local Ollama — reads from ubiq_local_url, defaults to localhost
            const localUrl = (typeof localStorage !== 'undefined' ? localStorage.getItem('ubiq_local_url') : null) || 'http://localhost:11434';
            return await chatLocal(message, history, selectedModel, localUrl);
        }
    }
};

// --- LOCAL ENGINE (Ollama) ---
// All requests go through the Laravel backend proxy (/api/ollama/chat).
// This avoids the browser's Mixed-Content block when the app is served over HTTPS
// but Ollama is on plain HTTP. Laravel makes the HTTP call server-side.
async function chatLocal(message: string, history: ChatMessage[], model: string, ollamaUrl: string) {
    const apiUrl = import.meta.env.VITE_API_URL;
    const authRaw = localStorage.getItem('auth-storage');
    const token = authRaw
        ? (JSON.parse(authRaw)?.state?.token || '')
        : (localStorage.getItem('auth_token') || localStorage.getItem('token') || '');

    const ollamaMessages = history.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content
    }));
    ollamaMessages.push({ role: 'user', content: message });

    try {
        const response = await axios.post(`${apiUrl}/ollama/chat`, {
            url:      ollamaUrl.replace(/\/$/, ''),
            model:    model || 'llama3',
            messages: ollamaMessages,
            stream:   false,
            options:  { temperature: 0.7 }
        }, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            // 300s — large models (7B+) generating full apps can take 2-4 minutes
            timeout: 300_000
        });

        return {
            role: 'assistant',
            content: response.data.message.content
        };
    } catch (error: any) {
        console.error('Ollama proxy error:', error);

        const serverMsg = error?.response?.data?.error;
        if (serverMsg) throw new Error(serverMsg);

        const status = error?.response?.status;

        if (status === 504 || error.code === 'ECONNABORTED') {
            throw new Error(
                'The model took too long to respond (gateway timeout). ' +
                'Try a smaller/faster model, or shorten your prompt. ' +
                'If you own the server, increase Nginx proxy_read_timeout.'
            );
        }
        if (status === 502) {
            throw new Error(
                'Could not reach the Ollama proxy (502). ' +
                'Check that your EC2 server is running and the port is open.'
            );
        }
        if (error.code === 'ERR_NETWORK') {
            throw new Error(
                'Network error reaching the proxy. ' +
                'Check your internet connection and that the server is online.'
            );
        }
        throw error;
    }
}

// --- CLOUD ENGINE (Laravel -> Cloud Providers via BYOK) ---
async function chatCloud(message: string, history: ChatMessage[], model: string, projectId?: number) {
    const apiUrl = import.meta.env.VITE_API_URL;
    const token = useAuthStore.getState().token;

    // D8 fix (PLAN_SYSTEM_TASKS.md Phase D): previously read BYOK keys from
    // localStorage and sent them here. The backend endpoint this calls
    // (CompletionController::chat(), routed at /chat/message) now resolves
    // google/openai/openrouter/mistral from encrypted server-side storage
    // itself and ignores whatever this field contains — so there's nothing
    // left to assemble. `api_keys` is omitted entirely below.
    try {
        const response = await axios.post(`${apiUrl}/chat/message`, {
            model: model, 
            messages: [
                ...history,
                { role: 'user', content: message }
            ],
            project_id: projectId
        }, {
            headers: { 
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        // Backend returns: { message: { role: "assistant", content: "..." }, ... }
        return response.data.message;

    } catch (error: any) {
        console.error("Cloud AI Error:", error.response?.data || error.message);

        // BUG FIX: CompletionController::chat()'s own catch block returns
        // `{'error' => $e->getMessage()}` — a plain string under the key
        // `error`, never `message`. Reading `.data.message` here was
        // always undefined regardless of what actually failed, so EVERY
        // chat failure — invalid key, quota exceeded, network issue,
        // provider overload, anything — fell through to the same
        // generic "Check your API keys" text below, even when the real
        // cause had nothing to do with API keys at all.
        const rawMessage: string | undefined = error.response?.data?.error;

        // Providers return a 503 with a body like Gemini's
        // `{"error":{"code":503,"status":"UNAVAILABLE",...}}` when
        // they're simply overloaded — a transient, expected condition,
        // not a real error. `$e->getMessage()` on the backend just
        // stringifies that provider body as-is (prefixed with "AI
        // Provider Error: "), so surfacing it raw here would mean
        // dumping escaped JSON at the person instead of something
        // they can actually act on.
        const isProviderOverloaded = rawMessage
            && (/"status"\s*:\s*"UNAVAILABLE"/i.test(rawMessage) || /"code"\s*:\s*503/.test(rawMessage));

        const errorMessage = isProviderOverloaded
            ? "The AI model is currently overloaded on the provider's end. This isn't an issue with your API key — please wait a moment and try again."
            : rawMessage || "Cloud generation failed. Check your API keys in Settings.";
        throw new Error(errorMessage);
    }
}