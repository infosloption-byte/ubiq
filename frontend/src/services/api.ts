import axios, { AxiosError } from 'axios';
import { usePlanLimitStore } from '../stores/planLimitStore';

const API_URL = import.meta.env.VITE_API_URL;

const api = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
    timeout: 30000,
});

/**
 * FIX #2: Single source of truth for the auth token.
 * Previously tried 3 keys (auth_token, token, auth-storage JSON) in a
 * fragile fallback chain. Now reads only from 'auth-storage' — the key
 * Zustand's persist middleware writes to — with a direct localStorage
 * mirror on setToken() as a convenience for non-store callers.
 *
 * Migration: setToken() in authStore still writes 'auth_token' as a
 * legacy mirror so any cached sessions continue to work, but this
 * function reads auth-storage first and falls back to auth_token for
 * any existing sessions that haven't re-logged in yet.
 */
export const getAuthToken = (): string | null => {
    try {
        const authStorage = localStorage.getItem('auth-storage');
        if (authStorage) {
            const token = JSON.parse(authStorage).state?.token;
            if (token) return token;
        }
    } catch (_) { /* corrupted storage — fall through */ }

    // Legacy fallback for existing sessions
    return localStorage.getItem('auth_token') || null;
};

api.interceptors.request.use(
    (config) => {
        if (import.meta.env.DEV) {
            // Never log config.headers — it contains the Authorization token
            console.log(`🚀 [API] ${config.method?.toUpperCase()} ${config.url}`, config.data || '');
        }
        const token = getAuthToken();
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

api.interceptors.response.use(
    (response) => {
        if (import.meta.env.DEV) {
            console.log(`✅ [API] ${response.status} ${response.config.url}`, response.data);
        }
        return response;
    },
    (error: AxiosError) => {
        if (import.meta.env.DEV) {
            console.error(`❌ [API] ${error.response?.status} ${error.config?.url}`, error.response?.data);
        }
        if (error.response?.status === 401) {
            localStorage.removeItem('auth_token');
            localStorage.removeItem('auth-storage');
            window.location.href = '/login';
            return Promise.reject(error);
        }

        // C2 — every PlanGuard denial (403/429) carries a `reason` field in
        // a consistent shape (see PlanLimitExceededException::toResponseArray
        // and every catch block that surfaces it). Detecting on that field
        // rather than status code alone avoids misfiring on unrelated 403s
        // (e.g. plain project-ownership checks, which return {error:
        // 'Unauthorized'} with no `reason` key) or 422 validation errors.
        const data = error.response?.data as { reason?: string; limit?: any; usage?: any; error?: string } | undefined;
        if ((error.response?.status === 403 || error.response?.status === 429) && data?.reason) {
            usePlanLimitStore.getState().show(data.reason, {
                limit: data.limit,
                usage: data.usage,
                fallbackMessage: data.error,
            });
        }

        return Promise.reject(error);
    }
);

// --- API DEFINITIONS ---

export const authAPI = {
    register: (data: any) => api.post('/auth/register', data),
    login: (data: any) => api.post('/auth/login', data),
    logout: () => api.post('/auth/logout'),
    me: () => api.get('/auth/me'),
    refresh: () => api.post('/auth/refresh'),
};

export const userAPI = {
    getProfile: () => api.get('/user/profile'),
    updateProfile: (data: any) => api.put('/user/profile', data),
    getPreferences: () => api.get('/user/preferences'),
    updatePreferences: (data: any) => api.put('/user/preferences', data),
    getUsage: (days?: number) => api.get('/user/usage', { params: { days } }),
    getStats: () => api.get('/user/stats'),
    getStorageStats: () => api.get('/user/storage'),
    getPlanUsage: () => api.get('/user/plan-usage'),
};

export const subscriptionApi = {
    // Called right after PayPal's onApprove() fires with a subscriptionID —
    // verifies + persists it server-side against PayPal's own API.
    confirmSubscription: (subscriptionId: string) =>
        api.post('/paypal/confirm', { subscription_id: subscriptionId }),
    cancelSubscription: () =>
        api.post('/paypal/cancel'),
    getSubscription: () =>
        api.get('/paypal/subscription'),
};

export const projectAPI = {
    getAll: (archived?: boolean) => api.get('/projects', { params: { archived } }),
    create: (data: { name: string; description?: string; language?: string; visibility?: string; source?: string; repository_url?: string; github_token?: string }) => api.post('/projects', data),
    get: (id: number) => api.get(`/projects/${id}`),
    update: (id: number, data: any) => api.put(`/projects/${id}`, data),
    delete: (id: number) => api.delete(`/projects/${id}`),
    archive: (id: number) => api.post(`/projects/${id}/archive`),
    restore: (id: number) => api.post(`/projects/${id}/restore`),
    scaffold: (projectId: number, files: any[]) =>
        api.post(`/projects/${projectId}/scaffold`, { files }),
    seedChat: (projectId: number, prompt: string, aiResponse: string, model: string) =>
        api.post(`/projects/${projectId}/seed-chat`, {
            prompt,
            ai_response: aiResponse,
            model
        }),
    runProject: (projectId: number) => api.post(`/projects/${projectId}/run`),
    stopProject: (projectId: number) => api.post(`/projects/${projectId}/stop`),
    getBuildLog: (projectId: number) => api.get(`/projects/${projectId}/build-log`),
};

export const terminalAPI = {
    execute: (projectId: number, command: string) =>
        api.post(`/projects/${projectId}/terminal`, { command })
};

export const fileAPI = {
    getAll: (projectId: number) => api.get(`/projects/${projectId}/files`),
    create: (projectId: number, data: { name: string; path: string; content?: string; language?: string }) =>
        api.post(`/projects/${projectId}/files`, data),
    get: (id: number) => api.get(`/files/${id}`),
    update: (id: number, data: { name?: string; content?: string }) => api.put(`/files/${id}`, data),
    delete: (id: number) => api.delete(`/files/${id}`),
    upload: (projectId: number, formData: FormData, onProgress?: (e: ProgressEvent) => void) =>
        api.post(`/projects/${projectId}/files/upload`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            onUploadProgress: onProgress,
        }),
    deleteFolder: (projectId: number, path: string) =>
        api.delete(`/projects/${projectId}/files/path`, { data: { path } }),
};

export const aiAPI = {
    completion: (data: any) => api.post('/ai/completion', data),
    chat: (data: any) => api.post('/ai/chat', data),
    review: (data: any) => api.post('/ai/review', data),
    debug: (data: any) => api.post('/ai/debug', data),
    explain: (data: any) => api.post('/ai/explain', data),
    getModels: () => api.get('/ai/models'),
    generateProject: (projectId: number, prompt: string, model: string, apiKeys?: any) =>
        api.post('/ai/generate', {
            project_id: projectId,
            prompt,
            model,
            api_keys: apiKeys
        }),
};

export const chatAPI = {
    getSessions: (params?: { project_id?: number }) => api.get('/chat/sessions', { params }),
    createSession: (data: { title?: string; project_id?: number }) => api.post('/chat/sessions', data),
    getSession: (id: number) => api.get(`/chat/sessions/${id}`),
    getMessages: (sessionId: number) => api.get(`/chat/sessions/${sessionId}/messages`),
    sendMessage: (sessionId: number, data: { content: string; role?: string }) =>
        api.post(`/chat/sessions/${sessionId}/messages`, data),
    deleteSession: (id: number) => api.delete(`/chat/sessions/${id}`),
    updateSession: (id: number, data: { title: string }) => api.patch(`/chat/sessions/${id}`, data),
    uploadAttachment: (sessionId: number, formData: FormData) =>
        api.post(`/chat/sessions/${sessionId}/upload`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        }),
};

export const adminAPI = {
    getStats: () => api.get('/admin/stats'),
    getUsers: (page = 1) => api.get(`/admin/users?page=${page}`),
    deleteUser: (id: number) => api.delete(`/admin/users/${id}`),
};

export const gitAPI = {
    getStatus: (projectId: number) => api.get(`/projects/${projectId}/git/status`),
    createPr: (projectId: number, data: { token: string; title: string; description: string }) =>
        api.post(`/projects/${projectId}/git/create-pr`, data),
};

// --- HELPER FUNCTIONS ---

export const streamChat = async (
    messages: any[],
    model: string,
    onChunk: (content: string) => void,
    onDone: () => void,
    onError: (err: string) => void,
    signal?: AbortSignal,
    apiKeys?: any
) => {
    try {
        const token = getAuthToken();
        if (!token) throw new Error("Authentication token missing.");

        const response = await fetch(`${API_URL}/ai/chat?stream=true`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/x-ndjson',
            },
            body: JSON.stringify({
                messages,
                model,
                stream: true,
                api_keys: apiKeys || {}
            }),
            signal,
        });

        if (response.status === 401) throw new Error("Session expired.");
        if (!response.ok) {
            // Was: throw new Error(errorData.error || ...) INSIDE the same
            // try whose catch immediately overwrote it with a generic
            // "Server Error" message — the specific backend message never
            // actually reached the caller. Restructured so a real JSON
            // parse failure (not JSON at all) is the only thing that falls
            // through to the generic message now.
            let errorData: any = null;
            try {
                errorData = await response.json();
            } catch (_) {
                // not JSON — errorData stays null, generic message below
            }

            // This streaming path uses raw fetch(), not the axios `api`
            // instance, so it never passes through api.ts's response
            // interceptor — chat() is PlanGuard-guarded same as every
            // other AI endpoint, so this needs its own explicit hook
            // rather than relying on the centralized one.
            if ((response.status === 403 || response.status === 429) && errorData?.reason) {
                usePlanLimitStore.getState().show(errorData.reason, {
                    limit: errorData.limit,
                    usage: errorData.usage,
                    fallbackMessage: errorData.error,
                });
            }

            throw new Error(errorData?.error || `Server Error: ${response.statusText}`);
        }

        if (!response.body) throw new Error('No response body');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const cleanLine = line.startsWith('data: ') ? line.replace('data: ', '') : line;
                    if (cleanLine === '[DONE]') { onDone(); return; }
                    const data = JSON.parse(cleanLine);
                    if (data.error) { onError(data.error); return; }
                    if (data.message && data.message.content) onChunk(data.message.content);
                    if (data.done) { onDone(); return; }
                } catch (e) { /* partial chunk, continue */ }
            }
        }
    } catch (error: any) {
        if (error.name === 'AbortError') {
            onDone();
        } else {
            console.error("Stream failed:", error);
            onError(error.message || 'Streaming failed');
        }
    }
};

export const generateTitle = async (sessionId: number, firstMessage: string) => {
    try {
        return await api.post(`/chat/sessions/${sessionId}/title`, { prompt: firstMessage });
    } catch (e) {
        console.error("Failed to auto-generate title", e);
    }
};

export default api;