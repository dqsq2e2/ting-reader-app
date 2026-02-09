import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SplashScreen } from '@capacitor/splash-screen';
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary';

// Hide the splash screen when the app is ready
SplashScreen.hide().catch(err => {
  console.warn('Error hiding splash screen:', err);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
