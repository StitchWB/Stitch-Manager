import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { Toaster } from 'sonner';
import Layout from './components/layout/Layout';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import AutoReg from './pages/AutoReg';
import AiProviders from './pages/AiProviders';
import AiOverview from './pages/AiOverview';
import Antigravity from './pages/Antigravity';
import Patcher from './pages/Patcher';
import Scheduler from './pages/Scheduler';
import Server from './pages/Server';
import Settings from './pages/Settings';
import Logs from './pages/Logs';
import Chat from './pages/Chat';
import ApiKeys from './pages/ApiKeys';
import NotFound from './pages/NotFound';
import { CommandPalette } from './components/ui/CommandPalette';
import { useAppStore } from './stores/app';
import { useLogsStore } from './stores/logs';
import { useRegistrationStore } from './stores/registration';

function App() {
  const theme = useAppStore(state => state.theme);
  const uiScale = useRegistrationStore(state => state.config.uiScale);
  const loadSettings = useRegistrationStore(state => state.loadSettings);

  const subscribeToLogs = useLogsStore(state => state.subscribeToLogs);
  const unsubscribeFromLogs = useLogsStore(state => state.unsubscribeFromLogs);
  const fetchLogs = useLogsStore(state => state.fetchLogs);

  const hasInitialized = useRef(false);

  useEffect(() => {
    const baseSize = 16; // Standard base size
    const scaledSize = baseSize * uiScale;
    document.documentElement.style.setProperty('--app-font-size', `${scaledSize}px`);
    console.log(`[APP] UI Scale applied: ${uiScale} (font-size: ${scaledSize}px)`);
  }, [uiScale]);

  // Apply theme on mount and when it changes

  useEffect(() => {
    const applyTheme = () => {
      if (
        theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      ) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };

    applyTheme();

    // Listen for system theme changes when using 'system' theme
    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => applyTheme();

      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [theme]);

  // Initialize settings and logging system
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    // Load settings from database (includes UI scale)
    loadSettings();

    // Subscribe to real-time log events from backend
    subscribeToLogs();

    // Fetch initial logs from database
    fetchLogs();

    return () => {
      unsubscribeFromLogs();
    };
  }, [loadSettings, subscribeToLogs, unsubscribeFromLogs, fetchLogs]);

  return (
    <>
      {/* Skip to main content link for keyboard navigation */}
      <a href="#main-content" className="skip-to-content">
        Skip to main content
      </a>

      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/autoreg" element={<AutoReg />} />
          <Route path="/ai" element={<AiOverview />} />
          <Route path="/ai/:section" element={<AiProviders />} />
          <Route path="/ai-providers" element={<Navigate to="/ai/providers" replace />} />
          <Route path="/antigravity" element={<Antigravity />} />
          <Route path="/patcher" element={<Patcher />} />
          <Route path="/scheduler" element={<Scheduler />} />
          <Route path="/server" element={<Server />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/api-keys" element={<ApiKeys />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Layout>
      <Toaster
        position="bottom-right"
        expand={false}
        richColors
        closeButton
        gap={8}
        visibleToasts={4}
        toastOptions={{
          style: {
            background: 'rgba(15, 23, 42, 0.95)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: '#e2e8f0',
            borderRadius: '8px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          },
          className: 'sonner-toast',
          duration: 4000,
        }}
        theme="dark"
      />
      <CommandPalette />
    </>
  );
}

export default App;
