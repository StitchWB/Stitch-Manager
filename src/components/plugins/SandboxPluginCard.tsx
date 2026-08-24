/**
 * SandboxPluginCard — a single plugin in the caller's developer sandbox.
 *
 * Shows id/version, a status badge (from the host status object), call/error
 * metrics when present, and the pinned source (url + short sha). Actions:
 * Logs (stderr ring buffer), Restart, Uninstall (destructive confirm) and
 * "Open playground" (namespaced command tester).
 */
import { useCallback, useState } from 'react';
import { Puzzle, RotateCcw, FileText, Trash2, TerminalSquare, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { askConfirm } from '../ui/ConfirmDialogHost';
import {
  sandboxLogs,
  sandboxRestart,
  sandboxUninstall,
  shortSha,
  type SandboxPluginInfo,
} from '@/lib/backend/modules/sandboxPlugins';
import { SandboxPlayground } from './SandboxPlayground';

function statusBadge(plugin: SandboxPluginInfo): { variant: 'success' | 'danger' | 'warning' | 'slate'; label: string } {
  const status = plugin.status;
  if (!status) return { variant: 'slate', label: t('admin.plugins.sandbox.status.stopped') };
  if (status.stopping) return { variant: 'warning', label: t('admin.plugins.sandbox.status.stopping') };
  switch (status.status) {
    case 'running':
      return { variant: 'success', label: t('admin.plugins.sandbox.status.running') };
    case 'error':
      return { variant: 'danger', label: t('admin.plugins.sandbox.status.error') };
    case 'stopped':
      return { variant: 'slate', label: t('admin.plugins.sandbox.status.stopped') };
    default:
      return { variant: 'warning', label: status.status };
  }
}

export interface SandboxPluginCardProps {
  plugin: SandboxPluginInfo;
  /** Called after a restart/uninstall so the parent refetches the list. */
  onChanged: () => void;
}

export function SandboxPluginCard({ plugin, onChanged }: SandboxPluginCardProps) {
  const [restarting, setRestarting] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsLines, setLogsLines] = useState<string[] | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [playgroundOpen, setPlaygroundOpen] = useState(false);

  const badge = statusBadge(plugin);
  const status = plugin.status;
  const pin = plugin.pinned_source;

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const lines = await sandboxLogs(plugin.id, 100);
      setLogsLines(lines);
    } catch {
      setLogsLines([]);
    } finally {
      setLogsLoading(false);
    }
  }, [plugin.id]);

  const onToggleLogs = useCallback(() => {
    if (logsOpen) {
      setLogsOpen(false);
      return;
    }
    setLogsOpen(true);
    if (logsLines === null) void fetchLogs();
  }, [logsOpen, logsLines, fetchLogs]);

  const onRestart = useCallback(async () => {
    setRestarting(true);
    try {
      await sandboxRestart(plugin.id);
      toast.success(t('admin.plugins.sandbox.restartSuccess'));
      onChanged();
    } catch {
      toast.error(t('admin.plugins.sandbox.restartFailed'));
    } finally {
      setRestarting(false);
    }
  }, [plugin.id, onChanged]);

  const onUninstall = useCallback(async () => {
    const confirmed = await askConfirm({
      title: t('admin.plugins.sandbox.uninstallConfirmTitle'),
      message: t('admin.plugins.sandbox.uninstallConfirmMessage', { id: plugin.id }),
      confirmText: t('admin.plugins.sandbox.actions.uninstall'),
      variant: 'danger',
    });
    if (!confirmed) return;
    setUninstalling(true);
    try {
      await sandboxUninstall(plugin.id);
      toast.success(t('admin.plugins.sandbox.uninstallSuccess'));
      onChanged();
    } catch {
      toast.error(t('admin.plugins.sandbox.uninstallFailed'));
    } finally {
      setUninstalling(false);
    }
  }, [plugin.id, onChanged]);

  return (
    <div className="px-5 py-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 bg-indigo-500/15 text-indigo-300">
            <Puzzle className="w-3.5 h-3.5" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-slate-200 font-medium truncate">{plugin.id}</span>
            <span className="text-[10px] text-slate-500 font-mono">v{plugin.version}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <Badge variant={badge.variant} size="sm">{badge.label}</Badge>
          <Button variant="ghost" size="xs" onClick={onToggleLogs} leftIcon={<FileText size={12} />}>
            {t('admin.plugins.sandbox.actions.logs')}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void onRestart()}
            disabled={restarting}
            leftIcon={<RotateCcw size={12} className={restarting ? 'animate-spin' : ''} />}
          >
            {t('admin.plugins.sandbox.actions.restart')}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setPlaygroundOpen(open => !open)}
            leftIcon={<TerminalSquare size={12} />}
          >
            {t('admin.plugins.sandbox.actions.playground')}
          </Button>
          <Button
            variant="danger"
            size="xs"
            onClick={() => void onUninstall()}
            disabled={uninstalling}
            leftIcon={uninstalling ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
          >
            {t('admin.plugins.sandbox.actions.uninstall')}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
        {status && typeof status.calls === 'number' && typeof status.errors === 'number' && (
          <span>
            {t('admin.plugins.sandbox.metrics.calls')}: {status.calls} ·{' '}
            {t('admin.plugins.sandbox.metrics.errors')}: {status.errors}
          </span>
        )}
        {pin && (
          <span className="font-mono text-[11px] truncate" title={pin.sha}>
            {pin.url} #{shortSha(pin.sha)}
          </span>
        )}
        {status?.error && <span className="text-red-400 truncate">{status.error}</span>}
      </div>

      {logsOpen && (
        <div className="mt-1 rounded-lg border border-white/[0.06] bg-black/60 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-medium text-slate-400">
              {t('admin.plugins.sandbox.logs.title')}
            </span>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => void fetchLogs()}
              disabled={logsLoading}
              leftIcon={<RefreshCw size={12} className={logsLoading ? 'animate-spin' : ''} />}
            >
              {t('admin.plugins.sandbox.logs.refresh')}
            </Button>
          </div>
          {logsLoading && logsLines === null ? (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="w-3 h-3 animate-spin" />
              {t('common.loading')}
            </div>
          ) : logsLines && logsLines.length > 0 ? (
            <pre className="text-[11px] text-slate-400 font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
              {logsLines.join('\n')}
            </pre>
          ) : (
            <p className="text-xs text-slate-600">{t('admin.plugins.sandbox.logs.empty')}</p>
          )}
        </div>
      )}

      {playgroundOpen && <SandboxPlayground pluginId={plugin.id} />}
    </div>
  );
}
