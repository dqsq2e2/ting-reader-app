import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/client';
import { useAuthStore } from '../store/authStore';
import { Lock, User, Server } from 'lucide-react';
import { CapacitorHttp } from '@capacitor/core';
import logoImg from '../assets/logo.png';

const LoginPage: React.FC = () => {
  const [serverAddress, setServerAddress] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberPassword, setRememberPassword] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  const navigate = useNavigate();
  const { setAuth, setServerUrl, setActiveUrl, serverUrl: storedServerUrl } = useAuthStore();
  
  // Check if running in Electron
  const isElectron = !!(window as any).electronAPI;
  // For Android App (this project), we always need server address
  const isApp = true;

  useEffect(() => {
    // Restore saved credentials if available
    const savedUsername = localStorage.getItem('saved_username');
    const savedPassword = localStorage.getItem('saved_password');
    if (savedUsername) setUsername(savedUsername);
    if (savedPassword) setPassword(savedPassword);
    
    if (storedServerUrl && (isElectron || isApp)) {
      // Fix: If stored URL is file:// (legacy default), clear it
      if (storedServerUrl.startsWith('file://')) {
        setServerAddress('');
      } else {
        setServerAddress(storedServerUrl);
      }
    }
  }, [storedServerUrl, isElectron, isApp]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    let finalServerAddress = serverAddress;

    try {
      // 1. Resolve and set Server URL (Only in Electron or App)
      if (isElectron || isApp) {
        if (!finalServerAddress) {
          setError('请输入服务器地址');
          setLoading(false);
          return;
        }

        // Sanitize URL
        finalServerAddress = finalServerAddress.trim().replace(/\/+$/, ''); // Remove trailing slashes
        
        // Fix common typos like https// (missing colon)
        if (finalServerAddress.startsWith('https//')) {
            finalServerAddress = finalServerAddress.replace('https//', 'https://');
        } else if (finalServerAddress.startsWith('http//')) {
            finalServerAddress = finalServerAddress.replace('http//', 'http://');
        }

        // Add protocol if missing
        if (!finalServerAddress.startsWith('http://') && !finalServerAddress.startsWith('https://')) {
            finalServerAddress = `http://${finalServerAddress}`;
        }
        
        // Update state to show sanitized URL to user
        setServerAddress(finalServerAddress);
        
        // Ensure we set the serverUrl in store
        setServerUrl(finalServerAddress); 
        // We will assume serverAddress is the base URL for now since we removed resolveRedirect logic.
        // If serverAddress redirects, fetch will follow it automatically.
        // We should store the EFFECTIVE url if possible, but fetch doesn't easily expose the final URL of a redirect
        // unless we inspect response.url.
        setActiveUrl(finalServerAddress);
      }

      // 2. Login
      // Use fetch instead of axios to bypass some CORS issues or handle it differently?
      // Actually, if we disabled webSecurity in Electron main process, both should work.
      // But fetch API is natively supported and might be simpler to debug.
      
      const loginUrl = `${(isElectron || isApp) ? finalServerAddress : ''}/api/auth/login`;
      
      // Attempt to probe the URL first to see if it redirects?
      // Or just fire POST and handle retry.
      
      let responseData;
      let responseStatus;
      let responseUrl = loginUrl;
      let responseRedirected = false;

      // Use CapacitorHttp to bypass CORS
      if (isApp) {
          try {
              console.log('Using CapacitorHttp to fetch:', loginUrl);
              const response = await CapacitorHttp.post({
                  url: loginUrl,
                  headers: { 'Content-Type': 'application/json' },
                  data: { username, password }
              });
              
              // CapacitorHttp response structure: { data, status, headers, url }
              responseData = response.data;
              responseStatus = response.status;
              responseUrl = response.url;
              // Check if URL changed (redirected)
              responseRedirected = responseUrl && responseUrl !== loginUrl;
              
              if (responseRedirected) {
                  console.log('CapacitorHttp redirected to:', responseUrl);
              }
          } catch (e) {
              console.error("CapacitorHttp failed", e);
              throw e;
          }
      } else {
          // Fallback for Electron / Web (though Electron should also use net or similar if possible, but fetch works mostly)
          const fetchResponse = await fetch(loginUrl, {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json'
              },
              body: JSON.stringify({ username, password })
          });
          
          responseData = await fetchResponse.json().catch(() => ({}));
          responseStatus = fetchResponse.status;
          responseUrl = fetchResponse.url;
          responseRedirected = fetchResponse.redirected;
      }
      
      // If we followed a redirect (in either attempt), update activeUrl
      if ((isElectron || isApp) && responseRedirected) {
          try {
              console.log('Final effective URL:', responseUrl);
              const baseUrl = responseUrl.replace(/\/api\/auth\/login\/?$/, '');
              setActiveUrl(baseUrl);
          } catch(e) {
              console.error('Failed to parse final URL', e);
          }
      }

      if (responseStatus < 200 || responseStatus >= 300) {
          // Handle Error
          const errorData = responseData || {};
          
          // Special handling for 404 after redirect (POST -> GET issue)
          if (responseStatus === 404 && responseRedirected) {
               console.log('Redirect turned POST into GET (404). Retrying POST to new URL:', responseUrl);
               
               if (isApp) {
                   // Retry with CapacitorHttp
                   const retryResponse = await CapacitorHttp.post({
                      url: responseUrl,
                      headers: { 'Content-Type': 'application/json' },
                      data: { username, password }
                   });
                   
                   if (retryResponse.status >= 200 && retryResponse.status < 300) {
                       // Success on retry
                       responseData = retryResponse.data;
                       const baseUrl = retryResponse.url.replace(/\/api\/auth\/login\/?$/, '');
                       setActiveUrl(baseUrl);
                       
                       // Save credentials if "Remember Password" is checked (MUST be done before navigate)
                       if (rememberPassword) {
                         localStorage.setItem('saved_username', username);
                         localStorage.setItem('saved_password', password);
                       } else {
                         localStorage.removeItem('saved_username');
                         localStorage.removeItem('saved_password');
                       }

                       setAuth(responseData.user, responseData.token);
                       navigate('/');
                       return;
                   } else {
                       throw { response: { data: retryResponse.data } };
                   }
               } else {
                   // Retry with fetch
                   const retryResponse = await fetch(responseUrl, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ username, password })
                   });
                   
                   if (retryResponse.ok) {
                       const data = await retryResponse.json();
                       const baseUrl = retryResponse.url.replace(/\/api\/auth\/login\/?$/, '');
                       setActiveUrl(baseUrl);

                       // Save credentials if "Remember Password" is checked (MUST be done before navigate)
                       if (rememberPassword) {
                         localStorage.setItem('saved_username', username);
                         localStorage.setItem('saved_password', password);
                       } else {
                         localStorage.removeItem('saved_username');
                         localStorage.removeItem('saved_password');
                       }

                       setAuth(data.user, data.token);
                       navigate('/');
                       return;
                   } else {
                        const retryError = await retryResponse.json().catch(() => ({}));
                        throw { response: { data: retryError } };
                   }
               }
          }
          
          throw { response: { data: errorData } }; 
      }
      
      const { token, user } = responseData;
      
      // Save credentials if "Remember Password" is checked
      if (rememberPassword) {
        localStorage.setItem('saved_username', username);
        localStorage.setItem('saved_password', password);
      } else {
        localStorage.removeItem('saved_username');
        localStorage.removeItem('saved_password');
      }

      setAuth(user, token);
      navigate('/');
    } catch (err: any) {
      console.error('Login error:', err);
      setError(err.response?.data?.error || '登录失败，请检查用户名和密码');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
      <div className="flex-1 flex items-center justify-center w-full">
        <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-8 space-y-8 border border-slate-200 dark:border-slate-800">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-20 h-20 mb-6">
              <img src={logoImg} alt="Logo" className="w-full h-full object-contain" />
            </div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Ting Reader</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">您的私有有声书馆</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            {(isElectron || isApp) && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">服务器地址</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <Server size={18} />
                  </span>
                  <input
                    type="text"
                    value={serverAddress}
                    onChange={(e) => setServerAddress(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all dark:text-white"
                    placeholder="例如: http://192.168.1.10:3000"
                  />
                </div>
                <p className="text-[10px] text-slate-400 px-1">
                  请输入源地址，应用会自动处理重定向。
                </p>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">用户名</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <User size={18} />
                </span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all dark:text-white"
                  placeholder="请输入用户名"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">密码</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <Lock size={18} />
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all dark:text-white"
                  placeholder="请输入密码"
                  required
                />
              </div>
            </div>

            <div className="flex items-center">
              <input
                id="remember-password"
                type="checkbox"
                checked={rememberPassword}
                onChange={(e) => setRememberPassword(e.target.checked)}
                className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
              />
              <label htmlFor="remember-password" className="ml-2 text-sm text-slate-600 dark:text-slate-400">
                记住密码 (启动时自动登录)
              </label>
            </div>

            {error && (
              <div className="text-red-500 text-sm bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-100 dark:border-red-900/30">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-primary-600 hover:bg-primary-700 text-white font-semibold rounded-lg shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '正在登录...' : '登录'}
            </button>
          </form>
        </div>
      </div>
      <div className="py-8 text-center text-slate-400 text-sm">
        <p>©2026 Ting Reader.保留所有权利。</p>
      </div>
    </div>
  );
};

export default LoginPage;
