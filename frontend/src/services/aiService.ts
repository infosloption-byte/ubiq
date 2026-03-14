import axios from 'axios';
import { useAuthStore } from '../stores/authStore';

// Define the structure for chat messages
export interface ChatMessage {
    role: string;
    content: string;
}

// Unified config passed from the UI layer.
// Covers all three connection modes:
//   1. Cloud BYOK  — api_keys contains provider keys (handled by Laravel backend)
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

    // Retrieve BYOK keys from localStorage (saved by SettingsPage)
    const storedKeys = localStorage.getItem('ubiq_api_keys');
    const apiKeys = storedKeys ? JSON.parse(storedKeys) : {};

    try {
        const response = await axios.post(`${apiUrl}/chat/message`, {
            model: model, 
            messages: [
                ...history,
                { role: 'user', content: message }
            ],
            project_id: projectId,
            api_keys: apiKeys 
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
        const errorMessage = error.response?.data?.message || "Cloud generation failed. Check your API keys in Settings.";
        throw new Error(errorMessage);
    }
}