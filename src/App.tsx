import React, { useEffect, useRef } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useNavigate, useLocation, Outlet } from 'react-router-dom';
import Layout from './components/Layout';
import AppInitializer from './components/AppInitializer';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import BookshelfPage from './pages/BookshelfPage';
import BookDetailPage from './pages/BookDetailPage';
import SearchPage from './pages/SearchPage';
import FavoritesPage from './pages/FavoritesPage';
import AdminLibraries from './pages/AdminLibraries';
import AdminUsers from './pages/AdminUsers';
import TaskLogsPage from './pages/TaskLogsPage';
import SettingsPage from './pages/SettingsPage';
import DownloadsPage from './pages/DownloadsPage';
import WidgetPage from './pages/WidgetPage';
import { useAuthStore } from './store/authStore';
import { usePlayerStore } from './store/playerStore';
import { App as CapacitorApp } from '@capacitor/app';
import { useTheme } from './hooks/useTheme';
import Player from './components/Player';
import { ArrowLeft, WifiOff } from 'lucide-react';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
};

const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, user } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" />;
  if (user?.role !== 'admin') return <Navigate to="/" />;
  return <>{children}</>;
};

const OfflineLayout = () => {
  const navigate = useNavigate();
  const { refreshTheme } = useTheme();
  const hasCurrentChapter = usePlayerStore(state => !!state.currentChapter);

  useEffect(() => {
    refreshTheme();
  }, [refreshTheme]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500">
            <WifiOff size={18} />
          </div>
          <div>
            <h1 className="font-bold text-slate-900 dark:text-white text-lg leading-tight">离线模式</h1>
            <p className="text-[10px] text-slate-500 font-medium">仅本地功能可用</p>
          </div>
        </div>

        <button
          onClick={() => navigate('/login')}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
        >
          <ArrowLeft size={16} />
          返回登录
        </button>
      </header>

      <main className="flex-1 overflow-hidden relative flex flex-col">
        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>
        {hasCurrentChapter && <Player />}
      </main>
    </div>
  );
};

// Component to handle global app events like Back Button
const AppEventListener = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const locationRef = useRef(location);

    // Keep ref updated
    useEffect(() => {
        locationRef.current = location;
    }, [location]);
    
    useEffect(() => {
        const backButtonListener = CapacitorApp.addListener('backButton', () => {
            // 1. Check if Player is expanded
            const { isExpanded, setIsExpanded } = usePlayerStore.getState();
            if (isExpanded) {
                setIsExpanded(false);
                return;
            }

            // 2. Handle routing based on current location
            const path = locationRef.current.pathname;
            
            // Explicit routing logic for better UX
            if (path.startsWith('/book/')) {
                // From details, go back to bookshelf or home (usually bookshelf)
                navigate('/bookshelf');
            } else if (path === '/bookshelf' || path === '/settings' || path === '/favorites' || path === '/search') {
                // From main tabs, go back to home
                navigate('/');
            } else if (path === '/offline') {
                navigate('/login');
            } else if (path === '/' || path === '/login') {
                // On root or login, exit app
                CapacitorApp.exitApp();
            } else {
                // Default fallback
                navigate(-1);
            }
        });
        
        return () => {
            backButtonListener.then(handler => handler.remove());
        };
    }, [navigate]); // Only re-run if navigate changes (rarely)
    
    return null;
};

function App() {
  return (
    <Router>
      <AppEventListener />
      <AppInitializer>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/widget" element={<WidgetPage />} />
          <Route path="/widget/:id" element={<WidgetPage />} />
          <Route path="/offline" element={<OfflineLayout />}>
            <Route index element={<DownloadsPage isOfflineMode />} />
          </Route>
          
          <Route path="/" element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }>
            <Route index element={<HomePage />} />
            <Route path="bookshelf" element={<BookshelfPage />} />
            <Route path="book/:id" element={<BookDetailPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="favorites" element={<FavoritesPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="downloads" element={<DownloadsPage />} />
            
            <Route path="admin/libraries" element={
              <AdminRoute>
                <AdminLibraries />
              </AdminRoute>
            } />
            <Route path="admin/users" element={
              <AdminRoute>
                <AdminUsers />
              </AdminRoute>
            } />
            <Route path="admin/tasks" element={
              <AdminRoute>
                <TaskLogsPage />
              </AdminRoute>
            } />
          </Route>
        </Routes>
      </AppInitializer>
    </Router>
  );
}

export default App;
