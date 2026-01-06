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
import { useAppStore } from './stores/app';
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react';

// Notification Toast Component
function NotificationToast() {
  const { notifications, removeNotification } = useAppStore();

  if (notifications.length === 0) return null;

  const iconMap = {
    success: <CheckCircle className="w-5 h-5 text-emerald-400" />,
    error: <XCircle className="w-5 h-5 text-red-400" />,
    warning: <AlertCircle className="w-5 h-5 text-amber-400" />,
    info: <Info className="w-5 h-5 text-blue-400" />,
  };

  const bgMap = {
    success: 'bg-emerald-500/10 border-emerald-500/30',
    error: 'bg-red-500/10 border-red-500/30',
    warning: 'bg-amber-500/10 border-amber-500/30',
    info: 'bg-blue-500/10 border-blue-500/30',
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`${bgMap[notification.type]} border rounded-lg p-4 shadow-lg backdrop-blur-sm animate-in slide-in-from-right duration-300`}
        >
          <div className="flex items-start gap-3">
            {iconMap[notification.type]}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white">{notification.title}</p>
              {notification.message && (
                <p className="text-xs text-slate-400 mt-1">{notification.message}</p>
              )}
            </div>
            <button
              onClick={() => removeNotification(notification.id)}
              className="text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

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
