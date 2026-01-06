import { Routes, Route } from 'react-router-dom';
import { useEffect } from 'react';
import Layout from './components/layout/Layout';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import AutoReg from './pages/AutoReg';
import Patcher from './pages/Patcher';
import Server from './pages/Server';
import Settings from './pages/Settings';
import Logs from './pages/Logs';
import NotificationToast from './components/NotificationToast';
import { useAppStore } from './stores/app';

function App() {
  const { theme } = useAppStore();

  // Apply theme on mount and when it changes
  useEffect(() => {
    if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

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
        </Routes>
      </Layout>
      <NotificationToast />
    </>
  );
}

export default App;
