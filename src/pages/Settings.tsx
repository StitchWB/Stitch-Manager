import { useState, useEffect, useCallback } from 'react';
import { Settings as SettingsIcon, Moon, Sun, Monitor, Database, Mail, Globe, Save, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { useAppStore } from '../stores/app';
import { API_BASE_URL } from '../config';

// Settings response type from backend
interface SettingsData {
  theme: string;
  imap_server: string;
  imap_port: number;
  imap_email: string;
  imap_password: string;
  proxy_enabled: boolean;
  proxy_url: string;
}

export default function Settings() {
  const { theme, setTheme } = useAppStore();
  
  // Form state
  const [imapServer, setImapServer] = useState('');
  const [imapPort, setImapPort] = useState('993');
  const [imapEmail, setImapEmail] = useState('');
  const [imapPassword, setImapPassword] = useState('');
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyUrl, setProxyUrl] = useState('');
  
  // UI state
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  // Load settings from backend
  const loadSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`${API_BASE_URL}/settings`);
      
      if (response.ok) {
        const data: SettingsData = await response.json();
        
        // Update form state with loaded settings
        setImapServer(data.imap_server || '');
        setImapPort(String(data.imap_port || 993));
        setImapEmail(data.imap_email || '');
        // Don't overwrite password field if it's masked
        if (data.imap_password && data.imap_password !== '********') {
          setImapPassword(data.imap_password);
        }
        setProxyEnabled(data.proxy_enabled || false);
        setProxyUrl(data.proxy_url || '');
        
        // Update theme in store if different
        if (data.theme && ['light', 'dark', 'system'].includes(data.theme)) {
          setTheme(data.theme as 'light' | 'dark' | 'system');
        }
      } else {
        console.error('Failed to load settings:', response.statusText);
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setIsLoading(false);
    }
  }, [setTheme]);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Save settings to backend
  const handleSave = async () => {
    try {
      setIsSaving(true);
      setSaveStatus('idle');
      setErrorMessage('');
      
      const settingsToSave: Partial<SettingsData> = {
        theme,
        imap_server: imapServer,
        imap_port: parseInt(imapPort, 10) || 993,
        imap_email: imapEmail,
        proxy_enabled: proxyEnabled,
        proxy_url: proxyUrl,
      };
      
      // Only include password if it was changed (not the masked value)
      if (imapPassword && imapPassword !== '********') {
        settingsToSave.imap_password = imapPassword;
      }
      
      const response = await fetch(`${API_BASE_URL}/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(settingsToSave),
      });
      
      if (response.ok) {
        setSaveStatus('success');
        // Clear success status after 3 seconds
        setTimeout(() => setSaveStatus('idle'), 3000);
      } else {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to save settings');
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
      setSaveStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  // Handle theme change - update both local store and prepare for save
  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <span className="ml-2 text-slate-400">Loading settings...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <SettingsIcon className="w-7 h-7 text-primary" />
          Settings
        </h1>
        <p className="text-slate-400 mt-1">Configure application preferences</p>
      </div>

      {/* Theme Settings */}
      <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Sun className="w-5 h-5" />
          Appearance
        </h2>
        <div className="flex gap-3">
          {[
            { value: 'light', icon: Sun, label: 'Light' },
            { value: 'dark', icon: Moon, label: 'Dark' },
            { value: 'system', icon: Monitor, label: 'System' },
          ].map(({ value, icon: Icon, label }) => (
            <button
              key={value}
              onClick={() => handleThemeChange(value as 'light' | 'dark' | 'system')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all ${
                theme === value
                  ? 'bg-primary/20 border-primary text-primary'
                  : 'bg-slate-700/50 border-slate-600 text-slate-300 hover:border-slate-500'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* IMAP Settings */}
      <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Mail className="w-5 h-5" />
          IMAP Configuration
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">IMAP Server</label>
            <input
              type="text"
              value={imapServer}
              onChange={(e) => setImapServer(e.target.value)}
              placeholder="imap.example.com"
              className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Port</label>
            <input
              type="text"
              value={imapPort}
              onChange={(e) => setImapPort(e.target.value)}
              placeholder="993"
              className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Email Address</label>
            <input
              type="email"
              value={imapEmail}
              onChange={(e) => setImapEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Password</label>
            <input
              type="password"
              value={imapPassword}
              onChange={(e) => setImapPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:border-primary focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Proxy Settings */}
      <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Globe className="w-5 h-5" />
          Proxy Settings
        </h2>
        <div className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={proxyEnabled}
              onChange={(e) => setProxyEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-primary focus:ring-primary"
            />
            <span className="text-slate-300">Enable Proxy</span>
          </label>
          {proxyEnabled && (
            <div>
              <label className="block text-sm text-slate-400 mb-1">Proxy URL</label>
              <input
                type="text"
                value={proxyUrl}
                onChange={(e) => setProxyUrl(e.target.value)}
                placeholder="http://proxy:8080"
                className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:border-primary focus:outline-none"
              />
            </div>
          )}
        </div>
      </div>

      {/* Database Info */}
      <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Database className="w-5 h-5" />
          Database
        </h2>
        <div className="text-slate-400 text-sm">
          <p>Location: <span className="text-white font-mono">./stitch.db</span></p>
          <p className="mt-2">SQLite database for storing accounts and settings.</p>
        </div>
      </div>

      {/* Save Button and Status */}
      <div className="flex items-center justify-end gap-4">
        {/* Status Messages */}
        {saveStatus === 'success' && (
          <div className="flex items-center gap-2 text-green-400">
            <CheckCircle className="w-5 h-5" />
            <span>Settings saved successfully!</span>
          </div>
        )}
        {saveStatus === 'error' && (
          <div className="flex items-center gap-2 text-red-400">
            <AlertCircle className="w-5 h-5" />
            <span>{errorMessage || 'Failed to save settings'}</span>
          </div>
        )}
        
        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 px-6 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Save Settings
            </>
          )}
        </button>
      </div>
    </div>
  );
}
