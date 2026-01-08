import { useState, useEffect } from 'react';
import { FileText, Search, Download, Trash2, RefreshCw } from 'lucide-react';
import Header from '../components/layout/Header';
import { useAppStore } from '../stores/app';
import { useLogsStore } from '../stores/logs';
import { t } from '../lib/i18n';

const levelConfig = {
  info: 'badge-info',
  warn: 'badge-warning',
  error: 'badge-error',
  debug: 'badge-neutral',
  success: 'badge-success',
};

export default function Logs() {
  const { language } = useAppStore();
  const { logs, clearLogs } = useLogsStore();
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [lastUpdated, setLastUpdated] = useState(new Date());

  // Force re-render when language changes
  void language;

  // Update timestamp when logs change
  useEffect(() => {
    setLastUpdated(new Date());
  }, [logs.length]);

  const filteredLogs = logs.filter((log) => {
    const matchesFilter = filter === 'all' || log.level === filter;
    const matchesSearch = search === '' || log.message.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const handleClear = () => clearLogs();

  const handleExport = () => {
    const content = logs.map((log) => `[${log.timestamp}] [${log.level.toUpperCase()}] ${log.source ? `[${log.source}] ` : ''}${log.message}`).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stitch-logs-${new Date().toISOString().split('T')[0]}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRefresh = () => {
    setLastUpdated(new Date());
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title={t('logs.title')}
        subtitle={t('logs.subtitle')}
        icon={<FileText size={18} />}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={handleRefresh} className="btn-secondary py-1.5 text-xs">
              <RefreshCw className="w-3.5 h-3.5" />
              {t('logs.refresh')}
            </button>
            <button onClick={handleExport} className="btn-secondary py-1.5 text-xs">
              <Download className="w-3.5 h-3.5" />
              {t('logs.export')}
            </button>
            <button onClick={handleClear} className="btn-danger py-1.5 text-xs">
              <Trash2 className="w-3.5 h-3.5" />
              {t('logs.clear')}
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        {/* Filters */}
        <div className="flex items-center gap-4 mb-4">
          <div className="flex items-center gap-2">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="input-ds text-sm py-1.5 w-32"
            >
              <option value="all">{t('logs.allLevels')}</option>
              <option value="info">{t('logs.info')}</option>
              <option value="success">Success</option>
              <option value="warn">{t('logs.warning')}</option>
              <option value="error">{t('logs.error')}</option>
              <option value="debug">{t('logs.debug')}</option>
            </select>
          </div>
          <div className="flex-1 relative max-w-md">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('logs.searchPlaceholder')}
              className="input-ds text-sm py-1.5 pl-9"
            />
          </div>
        </div>

        {/* Logs Table */}
        <div className="card flex-1 overflow-hidden flex flex-col">
          <div className="overflow-auto flex-1">
            <table className="table-ds">
              <thead>
                <tr>
                  <th className="w-24">{t('logs.time')}</th>
                  <th className="w-20">{t('logs.level')}</th>
                  <th className="w-28">{t('logs.source')}</th>
                  <th>{t('logs.message')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-slate-600">
                      {t('logs.noLogs')}
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="font-mono text-xs text-slate-500 tabular-nums">
                        {new Date(log.timestamp).toLocaleTimeString('en-US', { hour12: false })}
                      </td>
                      <td>
                        <span className={levelConfig[log.level] || 'badge-neutral'}>
                          {log.level}
                        </span>
                      </td>
                      <td className="text-xs text-slate-500">
                        {log.source || '—'}
                      </td>
                      <td className="text-sm text-slate-200">
                        {log.message}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="border-t border-white/5 px-4 py-3 flex items-center justify-between" style={{ background: 'rgba(30, 41, 59, 0.6)' }}>
            <span className="text-2xs text-slate-500">
              {t('logs.showing')} <span className="text-slate-300 tabular-nums">{filteredLogs.length}</span> {t('logs.of')} <span className="text-slate-300 tabular-nums">{logs.length}</span> {t('logs.entries')}
            </span>
            <span className="text-2xs text-slate-600">
              {t('logs.lastUpdated')} {lastUpdated.toLocaleTimeString('en-US', { hour12: false })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
