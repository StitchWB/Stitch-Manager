import { useEffect, useState } from 'react';
import { Globe, Link2, Unlink, ChevronDown, Wifi, WifiOff } from 'lucide-react';
import { cn } from '../../lib/utils';
import { setAccountProxy } from '@/lib/backend';
import {
  listProxyLibrary,
  type ProxyLibraryEntry,
} from '@/lib/backend/modules/proxyLibrary';
import { toast } from 'sonner';

interface AccountProxySectionProps {
  accountId: number;
  proxyId: string | null | undefined;
  onProxyChanged: () => void;
}

export function AccountProxySection({
  accountId,
  proxyId,
  onProxyChanged,
}: AccountProxySectionProps) {
  const [proxies, setProxies] = useState<ProxyLibraryEntry[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [boundProxy, setBoundProxy] = useState<ProxyLibraryEntry | null>(null);

  // Load proxy library and find bound proxy
  useEffect(() => {
    listProxyLibrary().then((items) => {
      setProxies(items);
      if (proxyId) {
        const found = items.find((p) => p.id === proxyId);
        setBoundProxy(found ?? null);
      } else {
        setBoundProxy(null);
      }
    }).catch(() => {
      setProxies([]);
    });
  }, [proxyId]);

  const handleBind = async (entry: ProxyLibraryEntry) => {
    setIsLoading(true);
    try {
      await setAccountProxy({ accountId, proxyId: entry.id });
      setBoundProxy(entry);
      setIsExpanded(false);
      onProxyChanged();
      toast.success(`Прокси привязан: ${entry.label || entry.host}`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnbind = async () => {
    setIsLoading(true);
    try {
      await setAccountProxy({ accountId, proxyId: null });
      setBoundProxy(null);
      onProxyChanged();
      toast.success('Прокси отвязан');
    } catch (e) {
      toast.error(String(e));
    } finally {
      setIsLoading(false);
    }
  };

  const enabledProxies = proxies.filter((p) => p.enabled);

  return (
    <div className="mb-6 p-4 rounded-lg bg-white/[0.02] border border-white/10">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-xs text-slate-400 uppercase tracking-wider">
          <Globe className="w-3.5 h-3.5" />
          Сеть / Прокси
        </div>
        {boundProxy && (
          <button
            onClick={handleUnbind}
            disabled={isLoading}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
          >
            <Unlink className="w-3 h-3" />
            Отвязать
          </button>
        )}
      </div>

      {/* Current proxy display */}
      {boundProxy ? (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
            <Wifi className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-slate-200 truncate">
              {boundProxy.label || `${boundProxy.host}:${boundProxy.port}`}
            </div>
            <div className="text-xs text-slate-400 font-mono">
              {boundProxy.host}:{boundProxy.port} • {boundProxy.proxyType.toUpperCase()}
            </div>
          </div>
          <Link2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
        </div>
      ) : (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/30 border border-white/5">
          <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
            <WifiOff className="w-4 h-4 text-slate-500" />
          </div>
          <div className="flex-1">
            <div className="text-sm text-slate-400">Прокси не привязан</div>
            <div className="text-xs text-slate-500">Прямое подключение</div>
          </div>
        </div>
      )}

      {/* Expand to select */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-white/5 rounded-lg transition-colors"
      >
        <span>{isExpanded ? 'Скрыть список' : 'Выбрать из библиотеки'}</span>
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', isExpanded && 'rotate-180')} />
      </button>

      {/* Proxy list picker */}
      {isExpanded && (
        <div className="mt-3 max-h-48 overflow-y-auto space-y-1 border-t border-white/5 pt-3">
          {enabledProxies.length === 0 ? (
            <div className="text-xs text-slate-500 text-center py-4">
              Нет доступных прокси. Добавьте в Настройки → Подключение.
            </div>
          ) : (
            enabledProxies.map((proxy) => (
              <button
                key={proxy.id}
                onClick={() => handleBind(proxy)}
                disabled={isLoading || proxy.id === proxyId}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors',
                  proxy.id === proxyId
                    ? 'bg-indigo-500/10 border border-indigo-500/30'
                    : 'hover:bg-white/5 border border-transparent',
                  'disabled:opacity-50'
                )}
              >
                <div className="w-6 h-6 rounded bg-white/5 flex items-center justify-center flex-shrink-0">
                  <Wifi className="w-3 h-3 text-slate-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-slate-200 truncate">
                    {proxy.label || `${proxy.host}:${proxy.port}`}
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    {proxy.host}:{proxy.port} • {proxy.proxyType.toUpperCase()}
                    {proxy.lastTestOk !== null && (
                      <span className={cn('ml-2', proxy.lastTestOk ? 'text-emerald-400' : 'text-red-400')}>
                        {proxy.lastTestOk ? '●' : '○'}
                      </span>
                    )}
                  </div>
                </div>
                {proxy.id === proxyId && (
                  <span className="text-[10px] text-indigo-400 font-medium">Текущий</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
