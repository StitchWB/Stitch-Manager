import { Routes, Route } from 'react-router-dom';
import { useEffect } from 'react';
import { Toaster } from 'sonner';
import { listen } from '@tauri-apps/api/event';
import Layout from './components/layout/Layout';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import AutoReg from './pages/AutoReg';
import AutoRegNext from './pages/AutoRegNext';
import Patcher from './pages/Patcher';
import Server from './pages/Server';
import Settings from './pages/Settings';
import Logs from './pages/Logs';
import { CommandPalette } from './components/ui/CommandPalette';
import { useAppStore } from './stores/app';
import { useLogsStore } from './stores/logs';

function App() {
  const { theme } = useAppStore();
  const { addLog } = useLogsStore();

  // Apply theme on mount and when it changes
  useEffect(() => {
    if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Global log listener - captures all REGISTRATION_LOG events
  useEffect(() => {
    const unlistenLog = listen<{ level: string; message: string; source?: string }>('REGISTRATION_LOG', (event) => {
      addLog({
        level: event.payload.level as 'info' | 'error' | 'success' | 'warn' | 'debug',
        message: event.payload.message,
        source: event.payload.source || 'registration',
      });
    });

    // Also listen for general app logs
    const unlistenAppLog = listen<{ level: string; message: string; source?: string }>('APP_LOG', (event) => {
      addLog({
        level: event.payload.level as 'info' | 'error' | 'success' | 'warn' | 'debug',
        message: event.payload.message,
        source: event.payload.source || 'app',
      });
    });

    return () => {
      unlistenLog.then(fn => fn());
      unlistenAppLog.then(fn => fn());
    };
  }, [addLog]);

  return (
    <>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/autoreg" element={<AutoRegNext />} />
          <Route path="/autoreg-legacy" element={<AutoReg />} />
          <Route path="/patcher" element={<Patcher />} />
          <Route path="/server" element={<Server />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/logs" element={<Logs />} />
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
