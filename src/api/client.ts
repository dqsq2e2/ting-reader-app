import axios from 'axios';
import camelcaseKeys from 'camelcase-keys';
import snakecaseKeys from 'snakecase-keys';
import { useAuthStore } from '../store/authStore';

type WindowWithElectron = {
  electronAPI?: {
    resolveRedirect: (url: string) => Promise<string>;
  };
};

// Initial base URL
// For Capacitor App, we must ensure we don't default to relative URL if no server_url is set
const isApp = true; // This codebase is for the App
const API_BASE_URL = localStorage.getItem('active_url') || localStorage.getItem('server_url') || (import.meta.env.PROD ? (isApp ? '' : '') : 'http://localhost:3000');

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000, // 15s timeout
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use((config) => {
  const { token, activeUrl, isOffline } = useAuthStore.getState();

  // Explicit Offline Mode (set by user or network status)
  if (isOffline) {
    // Block all API requests
    const controller = new AbortController();
    config.signal = controller.signal;
    controller.abort('Offline Mode');
    // We can also throw an error directly to skip the network request
    throw new axios.Cancel('Offline Mode: Request blocked');
  }

  // Update baseURL dynamically from store
  if (activeUrl && !config.url?.startsWith('http')) {
    config.baseURL = activeUrl;
  }

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Transform request data to snake_case
  if (config.data && config.headers['Content-Type'] === 'application/json') {
    config.data = snakecaseKeys(config.data, { deep: true });
  }

  // Transform params to snake_case
  if (config.params) {
    config.params = snakecaseKeys(config.params, { deep: true });
  }

  return config;
});

apiClient.interceptors.response.use(
  (response) => {
    // Check if we were redirected and update activeUrl if needed
    // Note: This relies on the browser/XHR exposing the final URL
    if (response.request && response.request.responseURL) {
      // ... (existing logic if needed)
    }

    // Transform response data to camelCase
    if (response.data && response.headers['content-type']?.includes('application/json')) {
      response.data = camelcaseKeys(response.data, { deep: true });
    }

    return response;
  },
  async (error) => {
    const originalRequest = error.config;
    
    // Don't logout if we are in Offline Mode
    if (useAuthStore.getState().isOffline) {
        return Promise.reject(error);
    }

    // Handle 401 Unauthorized
    if (error.response?.status === 401 && !originalRequest._retry) {
      useAuthStore.getState().logout();
      window.location.href = '/login';
      return Promise.reject(error);
    }

    // Handle Network Error or Connection Refused (potentially redirect expired)
    // Only in Electron environment where we manage serverUrl/activeUrl
    const electronApi = (window as WindowWithElectron).electronAPI;
    if (!error.response && !originalRequest._retry && electronApi) {
      const { serverUrl, setActiveUrl } = useAuthStore.getState();

      // If we have a serverUrl and it's different or we want to re-verify
      if (serverUrl) {
        console.log('Network error, attempting to re-resolve server URL from:', serverUrl);
        originalRequest._retry = true;
        
        try {
           // Call Electron IPC to resolve again
           const newUrl = await electronApi.resolveRedirect(serverUrl);
           
           // In main.js, resolve-redirect returns the URL string directly
           if (newUrl && typeof newUrl === 'string') {
             console.log('Resolved new active URL:', newUrl);
             
             // Update store
             setActiveUrl(newUrl);
             
             // Update request baseURL and retry
             originalRequest.baseURL = newUrl;
             
             return apiClient(originalRequest);
           }
        } catch (resolveErr) {
          console.error('Failed to re-resolve server URL', resolveErr);
        }
      }
    }
    
    return Promise.reject(error);
  }
);

export default apiClient;
