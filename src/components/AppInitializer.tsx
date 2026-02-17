import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { Loader2 } from 'lucide-react';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { CapacitorHttp } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Filesystem } from '@capacitor/filesystem';
import logoImg from '../assets/logo.png';

type WindowWithElectron = {
  electronAPI?: unknown;
};

interface AppInitializerProps {
  children: React.ReactNode;
}

import { useDownloadStore } from '../store/downloadStore';

// ... existing code ...

const AppInitializer: React.FC<AppInitializerProps> = ({ children }) => {
  const [isInitializing, setIsInitializing] = useState(true);
  const [statusMessage, setStatusMessage] = useState('正在启动...');
  const { setAuth, setActiveUrl, setServerUrl } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  // Check if running in Electron
  const isElectron = typeof window !== 'undefined' && !!(window as WindowWithElectron).electronAPI;
  // Check if running in App (Capacitor) - this project is specifically for App
  const isApp = true; 

  useEffect(() => {
    // Initialize download queue
    useDownloadStore.getState().initializeQueue();

    // Request permissions
    if (isApp) {
      // Notification permission for media controls
      LocalNotifications.requestPermissions().catch(console.error);
      
      // Storage permission (Optional for app-specific external storage on modern Android, but good for compatibility)
      Filesystem.requestPermissions().catch(err => {
          console.log('Filesystem permission request skipped or failed (likely not needed for private storage):', err);
      });
    }

    // Make status bar transparent on Android for edge-to-edge
    if (isApp) {
        StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
        StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
        // Also ensure background color is transparent so it overlays
        StatusBar.setBackgroundColor({ color: '#00000000' }).catch(() => {});

        // NOTE: Back button listener is handled in App.tsx to avoid conflicts and access global store/router
    }

    const initializeApp = async () => {
      // Only run auto-login logic in Electron environment or App environment
      // For Web environment, we rely on the persisted token in authStore (handled by zustand persist logic)
      if (!isElectron && !isApp) {
        setIsInitializing(false);
        return;
      }
      
      // If we already have a token in memory (e.g. just logged in), skip auto-login check
      // This prevents AppInitializer from overwriting the session when navigating to home immediately after login
      if (useAuthStore.getState().isAuthenticated) {
          setIsInitializing(false);
          if (isApp) SplashScreen.hide().catch(() => {});
          return;
      }

      // Check if we have saved credentials
      const savedUsername = localStorage.getItem('saved_username');
      const savedPassword = localStorage.getItem('saved_password');
      const serverUrl = localStorage.getItem('server_url');

      // If we are already on the login or offline page, skip auto-login
      if (location.pathname === '/login' || location.pathname === '/downloads' || location.pathname.startsWith('/offline')) {
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
        // Ensure Splash Screen is hidden when we are ready to show something
        if (isApp) {
             SplashScreen.hide().catch(() => {});
             navigate('/login');
        }
        return;
      }

      try {
        setStatusMessage('正在连接服务器...');
        console.log('Attempting auto-login with stored credentials...');

        // Perform login request using the SOURCE serverUrl
        // This bypasses the potentially stale 'active_url' and token
        const loginUrl = `${serverUrl}/api/auth/login`;
        
        // We use fetch directly to avoid apiClient interceptors for this initial handshake
        
        let responseData;
        let responseStatus;
        let responseUrl = loginUrl;
        let responseRedirected = false;

        if (isApp) {
             const response = await CapacitorHttp.post({
                  url: loginUrl,
                  headers: { 'Content-Type': 'application/json' },
                  data: { username: savedUsername, password: savedPassword }
             });
             responseData = response.data;
             responseStatus = response.status;
             responseUrl = response.url;
             responseRedirected = responseUrl && responseUrl !== loginUrl;
        } else {
             const response = await fetch(loginUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: savedUsername, password: savedPassword })
             });
             responseData = await response.json().catch(() => ({}));
             responseStatus = response.status;
             responseUrl = response.url;
             responseRedirected = response.redirected;
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
          
          if (isApp) {
             const retryResponse = await CapacitorHttp.post({
                url: responseUrl,
                headers: { 'Content-Type': 'application/json' },
                data: { username: savedUsername, password: savedPassword }
             });
             if (retryResponse.status >= 200 && retryResponse.status < 300) {
                 const baseUrl = retryResponse.url.replace(/\/api\/auth\/login\/?$/, '');
                 setActiveUrl(baseUrl);
                 responseStatus = retryResponse.status;
                 responseData = retryResponse.data;
             }
          } else {
             const retryResponse = await fetch(responseUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: savedUsername, password: savedPassword })
             });
             if (retryResponse.ok) {
                 const baseUrl = retryResponse.url.replace(/\/api\/auth\/login\/?$/, '');
                 setActiveUrl(baseUrl);
                 responseStatus = retryResponse.status;
                 responseData = await retryResponse.json();
             }
          }
        }

        if (responseStatus >= 200 && responseStatus < 300) {
          const { token, user } = responseData;
          
          // Login successful!
          setStatusMessage('登录成功，正在进入...');
          setAuth(user, token);
          
          // Ensure serverUrl is set (it should be, but just in case)
          setServerUrl(serverUrl);
          
          // Allow the app to render
          setIsInitializing(false);
          if (isApp) SplashScreen.hide().catch(() => {});
        } else {
          // Login failed (e.g., password changed, server error)
          console.warn('Auto-login failed:', responseStatus);
          // We don't clear credentials here, just let the user go to login page
          // But we should probably clear the auth state to force re-login UI
          // useAuthStore.getState().logout(); // Optional: maybe too aggressive?
          
          setIsInitializing(false);
          if (isApp) SplashScreen.hide().catch(() => {});
          navigate('/login');
        }
      } catch (err) {
        console.error('Auto-login error:', err);
        // Network error or other issue
        // Fallback to login page
        setIsInitializing(false);
        if (isApp) SplashScreen.hide().catch(() => {});
        navigate('/login');
      }
    };

    initializeApp();
  }, [isElectron, isApp, setActiveUrl, setAuth, setServerUrl, location.pathname, navigate]);

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
