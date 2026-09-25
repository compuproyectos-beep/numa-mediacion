import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor — attach JWT token
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('numa_token');
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor — handle errors globally
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (typeof window !== 'undefined') {
      const esIntentoDeLogin = error.config?.url?.includes('/login');

      if (error.response?.status === 401 && !esIntentoDeLogin) {
        // Sesión vencida mientras se usaba la app (no un intento de login
        // fallido, que ya maneja su propio error localmente en la pantalla
        // de login sin necesidad de recargar la página).
        localStorage.removeItem('numa_token');
        localStorage.removeItem('numa_user');
        window.location.href = '/login';
      }
      if (error.response?.status === 403) {
        // Forbidden — user doesn't have permission
        console.error('Acceso denegado');
      }
      if (error.response?.status && error.response.status >= 500) {
        console.error('Error interno del servidor');
      }
    }
    return Promise.reject(error);
  }
);

export default api;
