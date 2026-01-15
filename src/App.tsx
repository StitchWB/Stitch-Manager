import { Routes, Route } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { Toaster } from 'sonner';
import Layout from './components/layout/Layout';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import AutoReg from './pages/AutoReg';
import Patcher from './pages/Patcher';
import Server from './pages/Server';
import Settings from './pages/Settings';
import Logs from './pages/Logs';
import NotFound from './pages/NotFound';
import { CommandPalette } from './components/ui/CommandPalette';
import { useAppStore } from './stores/app';
import { useLogsStore } from './stores/logs';

function App() {
  const { theme } = useAppStore();
  const { subscribeToLogs, unsubscribeFromLogs, fetchLogs } = useLogsStore();
  const hasInitialized = useRef(false);

  // Apply theme on mount and when it changes
  useEffect(() => {
    const applyTheme = () => {
      if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
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

  // Initialize logging system - subscribe to real-time events and fetch initial logs
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    // Subscribe to real-time log events from backend
    subscribeToLogs();
    
    // Fetch initial logs from database
    fetchLogs();

    return () => {
      unsubscribeFromLogs();
    };
  }, [subscribeToLogs, unsubscribeFromLogs, fetchLogs]);

  return (
    <>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/autoreg" element={<AutoReg />} />
          <Route path="/patcher" element={<Patcher />} />
          <Route path="/server" element={<Server />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Layout>
      <Toaster 
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#0f172a',
            border: '1px solid rgba(255,255,255,0.1)',
            color: '#e2e8f0',
          },
          className: 'sonner-toast',
        }}
        theme="dark"
      />
      <CommandPalette />
    </>
  );
}

export default App;
