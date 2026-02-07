import axios, { AxiosError } from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

api.interceptors.request.use(
  (config) => {
    let token = localStorage.getItem('auth_token') || localStorage.getItem('token');
    if (!token) {
        const authStorage = localStorage.getItem('auth-storage');
        if (authStorage) {
            try {
                const parsed = JSON.parse(authStorage);
                token = parsed.state?.token;
            } catch (e) { /* ignore */ }
        }
    }
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('token');
      localStorage.removeItem('auth-storage');
      window.location.href = '/login';
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
};

export const projectAPI = {
  getAll: (archived?: boolean) => api.get('/projects', { params: { archived } }),
  create: (data: { name: string; description?: string; language?: string; visibility?: string }) => api.post('/projects', data),
  get: (id: number) => api.get(`/projects/${id}`),
  update: (id: number, data: any) => api.put(`/projects/${id}`, data),
  delete: (id: number) => api.delete(`/projects/${id}`),
  archive: (id: number) => api.post(`/projects/${id}/archive`),
  restore: (id: number) => api.post(`/projects/${id}/restore`),
};

export const fileAPI = {
  getAll: (projectId: number) => api.get(`/projects/${projectId}/files`),
  create: (projectId: number, data: { name: string; path: string; content?: string; language?: string }) => api.post(`/projects/${projectId}/files`, data),
  get: (id: number) => api.get(`/files/${id}`),
  update: (id: number, data: { name?: string; content?: string }) => api.put(`/files/${id}`, data),
  delete: (id: number) => api.delete(`/files/${id}`),
};

export const aiAPI = {
  completion: (data: any) => api.post('/ai/completion', data),
  chat: (data: any) => api.post('/ai/chat', data),
  review: (data: any) => api.post('/ai/review', data),
  debug: (data: any) => api.post('/ai/debug', data),
  explain: (data: any) => api.post('/ai/explain', data),
  getModels: () => api.get('/ai/models'),
};

export const chatAPI = {
  getSessions: (params?: { project_id?: number }) => api.get('/chat/sessions', { params }),
  createSession: (data: { title?: string; project_id?: number }) => api.post('/chat/sessions', data),
  getSession: (id: number) => api.get(`/chat/sessions/${id}`),
  getMessages: (sessionId: number) => api.get(`/chat/sessions/${sessionId}/messages`),
  sendMessage: (sessionId: number, data: { content: string }) => api.post(`/chat/sessions/${sessionId}/messages`, data),
  deleteSession: (id: number) => api.delete(`/chat/sessions/${id}`),
  updateSession: (id: number, data: { title: string }) => api.patch(`/chat/sessions/${id}`, data),
  uploadAttachment: (sessionId: number, formData: FormData) => api.post(`/chat/sessions/${sessionId}/upload`, formData, {headers: { 'Content-Type': 'multipart/form-data' }}),
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
    // FIX: Check 'auth_token' first (standard), then 'token'
    let token = localStorage.getItem('auth_token') || localStorage.getItem('token');
    
    // Fallback: Check auth-storage if direct keys are missing
    if (!token) {
        const authStorage = localStorage.getItem('auth-storage');
        if (authStorage) {
            try {
                const parsed = JSON.parse(authStorage);
                token = parsed.state?.token;
            } catch (e) {}
        }
    }

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
      signal: signal
    });

    if (response.status === 401) throw new Error("Session expired.");
    if (!response.ok) {
        try {
            const errorData = await response.json();
            throw new Error(errorData.error || `Server Error: ${response.statusText}`);
        } catch (e) {
            throw new Error(`Server Error: ${response.statusText}`);
        }
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
            if (cleanLine === '[DONE]') {
                onDone();
                return;
            }

            const data = JSON.parse(cleanLine);
            
            // --- ERROR HANDLING ---
            if (data.error) {
                onError(data.error);
                return; 
            }

            if (data.message && data.message.content) {
                onChunk(data.message.content);
            }
            
            if (data.done) {
                onDone();
                return;
            }
        } catch (e) { 
            // Ignore parsing errors for partial chunks
        }
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