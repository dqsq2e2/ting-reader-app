import React, { useEffect, useRef } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
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
import WidgetPage from './pages/WidgetPage';
import { useAuthStore } from './store/authStore';
import { usePlayerStore } from './store/playerStore';
import { App as CapacitorApp } from '@capacitor/app';

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
        const backButtonListener = CapacitorApp.addListener('backButton', ({ canGoBack }) => {
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
