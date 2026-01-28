import axios, { AxiosError } from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// Request interceptor - add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor - handle errors
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      // Unauthorized - clear token and redirect to login
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  register: (data: { username: string; email: string; password: string; password_confirmation: string }) =>
    api.post('/auth/register', data),
  
  login: (data: { email: string; password: string }) =>
    api.post('/auth/login', data),
  
  logout: () =>
    api.post('/auth/logout'),
  
  me: () =>
    api.get('/auth/me'),
  
  refresh: () =>
    api.post('/auth/refresh'),
};

// User API
export const userAPI = {
  getProfile: () =>
    api.get('/user/profile'),
  
  updateProfile: (data: { username?: string; email?: string }) =>
    api.put('/user/profile', data),
  
  getPreferences: () =>
    api.get('/user/preferences'),
  
  updatePreferences: (data: any) =>
    api.put('/user/preferences', data),
  
  getUsage: (days?: number) =>
    api.get('/user/usage', { params: { days } }),
  
  getStats: () =>
    api.get('/user/stats'),
};

// Project API
export const projectAPI = {
  getAll: (archived?: boolean) =>
    api.get('/projects', { params: { archived } }),
  
  create: (data: { name: string; description?: string; language?: string; visibility?: string }) =>
    api.post('/projects', data),
  
  get: (id: number) =>
    api.get(`/projects/${id}`),
  
  update: (id: number, data: any) =>
    api.put(`/projects/${id}`, data),
  
  delete: (id: number) =>
    api.delete(`/projects/${id}`),
  
  archive: (id: number) =>
    api.post(`/projects/${id}/archive`),
  
  restore: (id: number) =>
    api.post(`/projects/${id}/restore`),
};

// File API
export const fileAPI = {
  getAll: (projectId: number) =>
    api.get(`/projects/${projectId}/files`),
  
  create: (projectId: number, data: { name: string; path: string; content?: string; language?: string }) =>
    api.post(`/projects/${projectId}/files`, data),
  
  get: (id: number) =>
    api.get(`/files/${id}`),
  
  update: (id: number, data: { name?: string; content?: string }) =>
    api.put(`/files/${id}`, data),
  
  delete: (id: number) =>
    api.delete(`/files/${id}`),
};

// AI API
export const aiAPI = {
  completion: (data: {
    code: string;
    language: string;
    model?: string;
    max_tokens?: number;
    temperature?: number;
    context_files?: any[];
  }) =>
    api.post('/ai/completion', data),
  
  chat: (data: {
    messages: { role: string; content: string }[];
    model?: string;
    context?: any;
  }) =>
    api.post('/ai/chat', data),
  
  review: (data: {
    code: string;
    language: string;
    model?: string;
    review_type?: string[];
  }) =>
    api.post('/ai/review', data),
  
  debug: (data: {
    code: string;
    error_message: string;
    language: string;
    model?: string;
  }) =>
    api.post('/ai/debug', data),
  
  explain: (data: {
    code: string;
    language: string;
    model?: string;
  }) =>
    api.post('/ai/explain', data),
  
  getModels: () =>
    api.get('/ai/models'),
};

// Chat API
export const chatAPI = {
  getSessions: () =>
    api.get('/chat/sessions'),
  
  createSession: (data: { title?: string; project_id?: number }) =>
    api.post('/chat/sessions', data),
  
  getSession: (id: number) =>
    api.get(`/chat/sessions/${id}`),
  
  getMessages: (sessionId: number) =>
    api.get(`/chat/sessions/${sessionId}/messages`),
  
  sendMessage: (sessionId: number, data: { content: string }) =>
    api.post(`/chat/sessions/${sessionId}/messages`, data),
  
  deleteSession: (id: number) =>
    api.delete(`/chat/sessions/${id}`),
};

export default api;