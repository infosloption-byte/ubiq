import axios from 'axios';
import { useAuthStore } from '../stores/authStore';

const OLLAMA_LOCAL_URL = 'http://localhost:11434/api/chat';

// Define the structure for chat messages
export interface ChatMessage {
    role: string;
    content: string;
}

export const aiService = {
    chat: async (
        message: string, 
        history: ChatMessage[] = [], 
        mode: string, 
        selectedModel: string, 
        projectId?: number
    ) => {
        if (mode === 'local') {
            return await chatLocal(message, history, selectedModel);
        } else {
            return await chatCloud(message, history, selectedModel, projectId);
        }
    }
};

// --- LOCAL ENGINE (Ollama) ---
async function chatLocal(message: string, history: ChatMessage[], model: string) {
    try {
        // Prepare history for Ollama
        const ollamaMessages = history.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content
        }));
        
        // Append current message
        ollamaMessages.push({ role: 'user', content: message });

        const response = await axios.post(OLLAMA_LOCAL_URL, {
            model: model || "llama3",
            messages: ollamaMessages,
            stream: false,
            options: {
                temperature: 0.7 
            }
        });

        return {
            role: 'assistant',
            content: response.data.message.content
        };
    } catch (error: any) {
        console.error("Local AI Error:", error);
        if (error.code === "ERR_NETWORK") {
            throw new Error("Could not reach Ollama. Is it running? (OLLAMA_ORIGINS=\"*\")");
        }
        throw error;
    }
}

// --- CLOUD ENGINE (Laravel -> Cloud Providers) ---
async function chatCloud(message: string, history: ChatMessage[], model: string, projectId?: number) {
    const apiUrl = import.meta.env.VITE_API_URL;
    const token = useAuthStore.getState().token;

    // 1. Retrieve Keys from Local Storage (Saved by SettingsPage)
    const storedKeys = localStorage.getItem('ubiq_api_keys');
    const apiKeys = storedKeys ? JSON.parse(storedKeys) : {};

    try {
        // 2. Send request to Laravel Backend
        // FIX: We now send 'messages' as an array, not a single 'message' string
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
        const errorMessage = error.response?.data?.message || "Cloud generation failed. Check your API keys.";
        throw new Error(errorMessage);
    }
}