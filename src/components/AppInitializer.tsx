import React, { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { usePlayerStore } from '../store/playerStore';
import { useLocation, useNavigate } from 'react-router-dom';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { CapacitorHttp } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import logoImg from '../assets/logo.png';
import { Loader2 } from 'lucide-react';

type WindowWithElectron = {
  electronAPI?: unknown;
};

interface AppInitializerProps {
  children: React.ReactNode;
}

// Initialize stores and global listeners
const AppInitializer: React.FC<AppInitializerProps> = ({ children }) => {
  const [isInitializing, setIsInitializing] = useState(true);
  const [statusMessage, setStatusMessage] = useState('正在启动...');
  const { setAuth, setActiveUrl, setServerUrl, token } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  // Check if running in Electron
  const isElectron = typeof window !== 'undefined' && !!(window as WindowWithElectron).electronAPI;
  // Check if running in App (Capacitor) - this project is specifically for App
  const isApp = true; 
  const retryCount = useRef(0);
  const MAX_RETRIES = 2;
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    
    // Request permissions
    if (isApp) {
      // Notification permission for media controls
      LocalNotifications.requestPermissions().catch(console.error);
      
      // Initialize Audio Focus setting
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { Capacitor } = window as any;
      if (Capacitor && Capacitor.isPluginAvailable('AudioConfig')) {
        const { ignoreAudioFocus } = usePlayerStore.getState();
        Capacitor.Plugins.AudioConfig.setIgnoreAudioFocus({ ignore: !!ignoreAudioFocus });
      }
    }

    // Make status bar transparent on Android for edge-to-edge
    if (isApp) {
        StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
        StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
        // Also ensure background color is transparent so it overlays
        StatusBar.setBackgroundColor({ color: '#00000000' }).catch(() => {});
    }

    const performLogin = async (username: string, password: string, serverUrl: string, activeUrl?: string) => {
      // Use activeUrl if available (it might be resolved already), otherwise serverUrl
      // But for initial login, we usually trust serverUrl or try both
      const targetUrl = activeUrl || serverUrl;
      const loginUrl = `${targetUrl}/api/auth/login`;

      let responseData;
      let responseStatus;
      let responseUrl = loginUrl;
      let responseRedirected = false;

      // Timeout logic for CapacitorHttp
      // CapacitorHttp doesn't support signal/timeout natively in all versions, 
      // but we can wrap it. However, client.ts (axios) has timeout now.
      // But here we use raw requests to bypass interceptors.
      
      const TIMEOUT_MS = 10000;
      
      const timeoutPromise = new Promise<{ timeout: true }>((resolve) => {
         setTimeout(() => resolve({ timeout: true }), TIMEOUT_MS);
      });

      try {
        if (isApp) {
             const requestPromise = CapacitorHttp.post({
                  url: loginUrl,
                  headers: { 'Content-Type': 'application/json' },
                  data: { username, password },
                  connectTimeout: TIMEOUT_MS,
                  readTimeout: TIMEOUT_MS
             });
             
             // Race against timeout manually just in case
             // eslint-disable-next-line @typescript-eslint/no-explicit-any
             const response: any = await Promise.race([requestPromise, timeoutPromise]);
             
             if (response.timeout) {
                 throw new Error('Connection timed out');
             }

             responseData = response.data;
             responseStatus = response.status;
             responseUrl = response.url;
             responseRedirected = responseUrl && responseUrl !== loginUrl;
        } else {
             const controller = new AbortController();
             const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
             
             try {
                const response = await fetch(loginUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                responseData = await response.json().catch(() => ({}));
                responseStatus = response.status;
                responseUrl = response.url;
                responseRedirected = response.redirected;
             } catch (e) {
                clearTimeout(timeoutId);
                throw e;
             }
        }

        // Handle redirect (similar to LoginPage logic)
        if (responseRedirected) {
          try {
            console.log('Auto-login: Redirect detected to', responseUrl);
            const baseUrl = responseUrl.replace(/\/api\/auth\/login\/?$/, '');
            setActiveUrl(baseUrl);
          } catch (e) {
            console.error('Auto-login: Failed to parse redirect URL', e);
          }
        }
        
        // Handle 404/Method Not Allowed caused by 302 redirect turning POST into GET
        if ((responseStatus === 404 || responseStatus === 405) && responseRedirected) {
             setStatusMessage('重定向中...');
             console.log('Auto-login: Retrying POST to new location:', responseUrl);
             
             // Recursive retry to new location? Or just one hop.
             // Let's do one hop here for simplicity
             if (isApp) {
                const retryResponse = await CapacitorHttp.post({
                    url: responseUrl,
                    headers: { 'Content-Type': 'application/json' },
                    data: { username, password },
                    connectTimeout: TIMEOUT_MS,
                    readTimeout: TIMEOUT_MS
                });
                if (retryResponse.status >= 200 && retryResponse.status < 300) {
                     const baseUrl = retryResponse.url.replace(/\/api\/auth\/login\/?$/, '');
                     setActiveUrl(baseUrl);
                     return { status: retryResponse.status, data: retryResponse.data };
                }
                return { status: retryResponse.status, data: retryResponse.data };
             } else {
                const retryResponse = await fetch(responseUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                if (retryResponse.ok) {
                     const baseUrl = retryResponse.url.replace(/\/api\/auth\/login\/?$/, '');
                     setActiveUrl(baseUrl);
                     return { status: retryResponse.status, data: await retryResponse.json() };
                }
                return { status: retryResponse.status, data: null };
             }
        }

        return { status: responseStatus, data: responseData };
      } catch (err) {
        console.error('Login request failed', err);
        throw err;
      }
    };

    const initializeApp = async () => {
      // Only run auto-login logic in Electron environment or App environment
      if (!isElectron && !isApp) {
        setIsInitializing(false);
        return;
      }
      
      // If we already have a token in memory (e.g. just logged in), skip auto-login check
      if (useAuthStore.getState().isAuthenticated) {
          setIsInitializing(false);
          if (isApp) SplashScreen.hide().catch(() => {});
          return;
      }

      // Check if we have saved credentials
      const savedUsername = localStorage.getItem('saved_username');
      const savedPassword = localStorage.getItem('saved_password');
      const serverUrl = localStorage.getItem('server_url');
      const activeUrl = localStorage.getItem('active_url'); // Try to use resolved URL first

      // If we are already on the login or offline page, skip auto-login
      if (location.pathname === '/login') {
        setIsInitializing(false);
        if (isApp) SplashScreen.hide().catch(() => {});
        return;
      }

      if (!navigator.onLine) {
        setIsInitializing(false);
        if (isApp) SplashScreen.hide().catch(() => {});
        return;
      }

      // If no credentials or no server URL, we can't auto-login
      if (!savedUsername || !savedPassword || !serverUrl) {
        setIsInitializing(false);
        if (isApp) {
             SplashScreen.hide().catch(() => {});
             navigate('/login');
        }
        return;
      }

      try {
        setStatusMessage('正在连接服务器...');
        console.log('Attempting auto-login...');

        // 1. First, try to validate existing token if available (and not expired)
        // Actually, isAuthenticated is false here (checked above), but we might have a token in localStorage 
        // that zustand hasn't picked up or we manually check.
        // But zustand persistence usually syncs localStorage -> state.
        // If isAuthenticated is false, it means no token or user logged out.
        // However, we might have a STALE token if we force-cleared state but not localStorage (unlikely).
        // Let's stick to credentials login for now, but with RETRY logic.

        // Retry loop
        let success = false;
        let lastError = null;

        while (retryCount.current <= MAX_RETRIES && !success) {
            try {
                if (retryCount.current > 0) {
                    setStatusMessage(`连接失败，重试中 (${retryCount.current}/${MAX_RETRIES})...`);
                    await new Promise(r => setTimeout(r, 1000)); // Wait 1s
                }

                // Try with activeUrl first if exists, else serverUrl
                const urlToUse = (activeUrl && retryCount.current === 0) ? activeUrl : serverUrl;
                
                const { status, data } = await performLogin(savedUsername, savedPassword, urlToUse);
                
                if (status >= 200 && status < 300) {
                    const { token, user } = data;
                    setStatusMessage('登录成功，正在进入...');
                    setAuth(user, token);
                    setServerUrl(serverUrl);
                    success = true;
                } else {
                    // If 401, it's auth error, don't retry network
                    if (status === 401) {
                        console.warn('Auto-login failed: Unauthorized');
                        break;
                    }
                    throw new Error(`HTTP ${status}`);
                }
            } catch (err) {
                console.error(`Attempt ${retryCount.current + 1} failed:`, err);
                lastError = err;
                retryCount.current++;
                console.error('Last error:', lastError);
            }
        }

        if (success) {
            setIsInitializing(false);
            if (isApp) SplashScreen.hide().catch(() => {});
        } else {
            // All retries failed
            console.warn('Auto-login failed after retries');
            setIsInitializing(false);
            if (isApp) SplashScreen.hide().catch(() => {});
            navigate('/login');
        }

      } catch (err) {
        console.error('Auto-login fatal error:', err);
        setIsInitializing(false);
        if (isApp) SplashScreen.hide().catch(() => {});
        navigate('/login');
      }
    };

    initializeApp();
  }, [isElectron, isApp, setActiveUrl, setAuth, setServerUrl, navigate, location.pathname]);

  // Check auth on route change
  useEffect(() => {
    const publicRoutes = ['/login'];
    if (!token && !publicRoutes.includes(location.pathname)) {
        // If no token, redirect to login
        navigate('/login', { replace: true });
    }
  }, [token, location.pathname, navigate]);

  if (isInitializing) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-col items-center gap-6 animate-in fade-in duration-500">
          <div className="w-20 h-20 relative">
             <div className="absolute inset-0 bg-primary-100 dark:bg-primary-900/30 rounded-full animate-ping opacity-75"></div>
             <div className="relative z-10 w-full h-full bg-white dark:bg-slate-900 rounded-full shadow-xl flex items-center justify-center border border-slate-100 dark:border-slate-800">
               <img src={logoImg} alt="Logo" className="w-12 h-12 object-contain" />
             </div>
          </div>
          <div className="text-center space-y-2">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Ting Reader</h2>
            <div className="flex items-center justify-center gap-2 text-primary-600 dark:text-primary-400">
              <Loader2 size={16} className="animate-spin" />
              <span className="text-sm font-medium">{statusMessage}</span>
            </div>
            <button 
              onClick={() => {
                setIsInitializing(false);
                if (isApp) SplashScreen.hide().catch(() => {});
                navigate('/login');
              }}
              className="mt-4 px-6 py-2 rounded-full text-sm font-medium bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shadow-sm active:scale-95 transition-all"
            >
              取消连接
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default AppInitializer;
