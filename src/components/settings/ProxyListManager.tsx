import { useState } from 'react';
import { Plus, Trash2, CheckCircle2, XCircle, RefreshCw, Wifi } from 'lucide-react';
import { Button, Input } from '../ui';
import { parseProxyString, validateProxyString } from '../../lib/proxyUtils';
import { invoke } from '@tauri-apps/api/core';

interface ProxyItem {
  id: string;
  raw: string;
  host: string;
  port: string;
  username?: string;
  password?: string;
  type: 'http' | 'socks5';
  enabled: boolean;
  status?: 'active' | 'error' | 'untested';
  location?: string;
}

interface ProxyListManagerProps {
  proxies: ProxyItem[];
  onProxiesChange: (proxies: ProxyItem[]) => void;
  proxyType: 'http' | 'socks5';
}

export function ProxyListManager({ proxies, onProxiesChange, proxyType }: ProxyListManagerProps) {
  const [newProxy, setNewProxy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [testingProxy, setTestingProxy] = useState<string | null>(null);
  const [showSaved, setShowSaved] = useState(false);

  const handleTestProxy = async (proxyId: string, proxyRaw: string) => {
    setTestingProxy(proxyId);
    
    try {
      // Parse proxy
      const parsed = parseProxyString(proxyRaw, proxyType);
      if (!parsed) {
        onProxiesChange(
          proxies.map(p => 
            p.id === proxyId ? { ...p, status: 'error' } : p
          )
        );
        setTestingProxy(null);
        return;
      }

      // Call Tauri command to test proxy
      const result = await invoke<{
        success: boolean;
        responseTimeMs?: number;
        ip?: string;
        location?: string;
        error?: string;
      }>('test_proxy', {
        proxyUrl: proxyRaw,
        proxyType: parsed.type,
      });

      // Update proxy status and location based on result
      onProxiesChange(
        proxies.map(p => 
          p.id === proxyId 
            ? { 
                ...p, 
                status: result.success ? 'active' : 'error',
                location: result.location 
              } 
            : p
        )
      );
    } catch (err) {
      console.error('Proxy test failed:', err);
      
      // Update status to error
      onProxiesChange(
        proxies.map(p => 
          p.id === proxyId ? { ...p, status: 'error' } : p
        )
      );
    } finally {
      setTestingProxy(null);
    }
  };

  const handleAddProxy = () => {
    const validationError = validateProxyString(newProxy);
    
    if (validationError) {
      setError(validationError);
      return;
    }

    const parsed = parseProxyString(newProxy, proxyType);
    
    if (!parsed) {
      setError('Не удалось распарсить прокси');
      return;
    }

    const proxyItem: ProxyItem = {
      id: Date.now().toString(),
      raw: newProxy,
      host: parsed.host,
      port: parsed.port,
      username: parsed.username,
      password: parsed.password,
      type: parsed.type,
      enabled: true,
      status: 'untested',
    };

    onProxiesChange([...proxies, proxyItem]);
    setNewProxy('');
    setError(null);
    
    // Show saved indication
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 2000);
  };

  const handleRemoveProxy = (id: string) => {
    onProxiesChange(proxies.filter(p => p.id !== id));
  };

  const handleToggleProxy = (id: string) => {
    onProxiesChange(
      proxies.map(p => 
        p.id === id ? { ...p, enabled: !p.enabled } : p
      )
    );
  };

  const handleBulkAdd = (text: string) => {
    const lines = text.split('\n').filter(line => line.trim() && !line.startsWith('#'));
    const newProxies: ProxyItem[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      const validationError = validateProxyString(trimmed);
      
      if (validationError) continue;

      const parsed = parseProxyString(trimmed, proxyType);
      if (!parsed) continue;

      newProxies.push({
        id: `${Date.now()}-${Math.random()}`,
        raw: trimmed,
        host: parsed.host,
        port: parsed.port,
        username: parsed.username,
        password: parsed.password,
        type: parsed.type,
        enabled: true,
        status: 'untested',
      });
    }

    if (newProxies.length > 0) {
      onProxiesChange([...proxies, ...newProxies]);
      setNewProxy('');
      setError(null);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      
      // Check if multiple lines
      if (text.includes('\n')) {
        handleBulkAdd(text);
      } else {
        setNewProxy(text);
      }
    } catch (err) {
      console.error('Failed to read clipboard:', err);
    }
  };

  return (
    <div className="space-y-4">
      {/* Add Proxy Input */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <Input
            type="text"
            value={newProxy}
            onChange={e => {
              setNewProxy(e.target.value);
              setError(null);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                handleAddProxy();
              }
            }}
            placeholder="138.249.63.52:63942:username:password"
            error={error || undefined}
            className="flex-1"
          />
          <Button
            variant="secondary"
            onClick={handlePaste}
            className="px-3"
          >
            Вставить
          </Button>
          <Button
            variant="primary"
            onClick={handleAddProxy}
            disabled={!newProxy.trim()}
            className="px-4"
          >
            <Plus className="w-4 h-4 mr-1" />
            Добавить
          </Button>
        </div>
        
        {error && (
          <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded p-2">
            {error}
          </div>
        )}

        {showSaved && (
          <div className="text-xs text-green-400 bg-green-500/10 border border-green-500/30 rounded p-2 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>Прокси добавлен и сохранен</span>
          </div>
        )}

        <div className="text-xs text-slate-400">
          Можно вставить несколько прокси (каждый с новой строки)
        </div>
      </div>

      {/* Proxy List */}
      {proxies.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm text-slate-400">
            <span>Прокси ({proxies.length})</span>
            <span className="text-xs">
              Активных: {proxies.filter(p => p.enabled).length}
            </span>
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {proxies.map(proxy => (
              <div
                key={proxy.id}
                className={`
                  bg-slate-800/50 border rounded-lg p-3 transition-all
                  ${proxy.enabled 
                    ? 'border-slate-700 hover:border-slate-600' 
                    : 'border-slate-800 opacity-50'
                  }
                `}
              >
                <div className="flex items-start gap-3">
                  {/* Enable Toggle */}
                  <input
                    type="checkbox"
                    checked={proxy.enabled}
                    onChange={() => handleToggleProxy(proxy.id)}
                    className="mt-1 w-4 h-4 rounded border-white/20 bg-white/5 text-primary focus:ring-0"
                  />

                  {/* Proxy Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-mono text-slate-200">
                        {proxy.host}:{proxy.port}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-300 uppercase">
                        {proxy.type}
                      </span>
                      {proxy.status === 'active' && (
                        <div className="flex items-center gap-1 text-green-400 text-xs">
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Работает</span>
                        </div>
                      )}
                      {proxy.status === 'error' && (
                        <div className="flex items-center gap-1 text-red-400 text-xs">
                          <XCircle className="w-4 h-4" />
                          <span>Ошибка</span>
                        </div>
                      )}
                      {proxy.status === 'untested' && (
                        <div className="flex items-center gap-1 text-slate-400 text-xs">
                          <RefreshCw className="w-4 h-4" />
                          <span>Не проверен</span>
                        </div>
                      )}
                    </div>

                    {proxy.username && (
                      <div className="text-xs text-slate-400">
                        <span className="text-slate-500">Логин:</span> {proxy.username}
                        {' • '}
                        <span className="text-slate-500">Пароль:</span> {'•'.repeat(proxy.password?.length || 0)}
                      </div>
                    )}
                    
                    {proxy.location && (
                      <div className="text-xs text-slate-400 flex items-center gap-1 mt-1">
                        <span className="text-slate-500">📍</span>
                        <span>{proxy.location}</span>
                      </div>
                    )}
                  </div>

                  {/* Test Button */}
                  <button
                    onClick={() => handleTestProxy(proxy.id, proxy.raw)}
                    disabled={testingProxy === proxy.id}
                    className="p-1.5 rounded hover:bg-blue-500/10 text-slate-400 hover:text-blue-400 transition-colors disabled:opacity-50"
                    title="Проверить прокси"
                  >
                    {testingProxy === proxy.id ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Wifi className="w-4 h-4" />
                    )}
                  </button>

                  {/* Delete Button */}
                  <button
                    onClick={() => handleRemoveProxy(proxy.id)}
                    className="p-1.5 rounded hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {proxies.length === 0 && (
        <div className="text-center py-8 text-slate-400 text-sm">
          Нет добавленных прокси
        </div>
      )}
    </div>
  );
}
