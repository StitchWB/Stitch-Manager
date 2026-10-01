import { useCallback, useEffect, useMemo } from 'react';
import { useLogsStore } from '../../stores/logs';
import { useUIPreferencesStore } from '../../stores/uiPreferences';
import { useUIState } from '../../hooks/useUIState';
import { t } from '../../lib/i18n';
import { cn, formatDateTime } from '../../lib/utils';
import { copyToClipboard as copyTextToClipboard } from '@/lib/backend/modules/utils';
import { Badge, Button } from '@/components/ui';

const DEFAULT_DETAILS_PANE_WIDTH = 360;

interface LogDetailsPaneProps {
  onCopyMessage: (text: string, logId: string) => void;
}

export function LogDetailsPane({ onCopyMessage }: LogDetailsPaneProps) {
  const { logs } = useLogsStore();
  const {
    logsPage: { detailsPaneWidth, selectedLogId },
    setLogsDetailsPaneWidth,
    setLogsSelectedLogId,
  } = useUIPreferencesStore();
  const [isResizingPane, setIsResizingPane] = useUIState('logs-resizing-pane', false, 'session');

  const errorLogs = useMemo(
    () => logs.filter(log => log.level === 'error' || log.level === 'warn'),
    [logs]
  );

  const errorLogIds = useMemo(() => errorLogs.map(log => log.id), [errorLogs]);
  const selectedErrorIndex = useMemo(() => {
    if (!selectedLogId) return -1;
    return errorLogIds.indexOf(selectedLogId);
  }, [errorLogIds, selectedLogId]);

  const selectedLog = useMemo(
    () => logs.find(l => l.id === selectedLogId) ?? null,
    [logs, selectedLogId]
  );

  useEffect(() => {
    if (!isResizingPane) return;
    const onMove = (e: MouseEvent) => {
      const next = Math.round(window.innerWidth - e.clientX);
      const clamped = Math.min(560, Math.max(300, next));
      setLogsDetailsPaneWidth(clamped);
    };
    const onUp = () => setIsResizingPane(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isResizingPane, setLogsDetailsPaneWidth, setIsResizingPane]);

  useEffect(() => {
    if (!selectedLogId) return;
    if (!logs.some(l => l.id === selectedLogId)) {
      setLogsSelectedLogId(null);
    }
  }, [logs, selectedLogId, setLogsSelectedLogId]);

  const jumpToError = useCallback(
    (direction: 'prev' | 'next') => {
      if (!errorLogIds.length) return;

      let nextIndex = 0;
      if (selectedErrorIndex >= 0) {
        nextIndex = direction === 'prev' ? selectedErrorIndex - 1 : selectedErrorIndex + 1;
      } else {
        nextIndex = direction === 'prev' ? errorLogIds.length - 1 : 0;
      }

      if (nextIndex < 0) nextIndex = errorLogIds.length - 1;
      if (nextIndex >= errorLogIds.length) nextIndex = 0;

      setLogsSelectedLogId(errorLogIds[nextIndex]);
    },
    [errorLogIds, selectedErrorIndex, setLogsSelectedLogId]
  );

  return (
    <>
      <div
        className={cn(
          'hidden xl:block w-1 cursor-col-resize transition-colors rounded-full mx-0.5',
          isResizingPane ? 'bg-indigo-400/70' : 'bg-white/5 hover:bg-indigo-400/50'
        )}
        onMouseDown={() => setIsResizingPane(true)}
        onDoubleClick={() => setLogsDetailsPaneWidth(DEFAULT_DETAILS_PANE_WIDTH)}
        title="Drag to resize • Double-click to reset"
        aria-hidden="true"
      />
      <aside
        className="hidden xl:flex border-l border-white/5 bg-vsc-bg p-4 flex-col gap-3"
        style={{ width: `${detailsPaneWidth}px` }}
      >
        <div className="text-xs uppercase tracking-wider text-slate-500">{t('logs.detailsPanel')}</div>
        {!selectedLog ? (
          <div className="text-sm text-slate-500">{t('logs.selectLogHint')}</div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] text-slate-500">{t('logs.errorNavigation')}</div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" size="sm">
                  {errorLogIds.length === 0
                    ? `${t('logs.error')} 0/0`
                    : `${t('logs.error')} ${selectedErrorIndex >= 0 ? selectedErrorIndex + 1 : 1}/${errorLogIds.length}`}
                </Badge>
                <Button size="xs" variant="ghost" onClick={() => jumpToError('prev')}>
                  {t('logs.prevError')}
                </Button>
                <Button size="xs" variant="ghost" onClick={() => jumpToError('next')}>
                  {t('logs.nextError')}
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Badge
                variant={
                  selectedLog.level === 'error'
                    ? 'danger'
                    : selectedLog.level === 'warn'
                      ? 'warning'
                      : 'info'
                }
                size="sm"
              >
                {selectedLog.level}
              </Badge>
              <span className="text-xs text-slate-400">
                {formatDateTime(selectedLog.timestamp)}
              </span>
            </div>

            <div className="text-xs text-slate-400">{t('logs.sourceLabel')}</div>
            <div className="text-sm text-slate-200">{selectedLog.source}</div>

            <div className="text-xs text-slate-400">{t('logs.channelLabel')}</div>
            <div className="text-sm text-slate-200">{selectedLog.channel || 'app'}</div>

            {selectedLog.correlationId ? (
              <>
                <div className="text-xs text-slate-400">{t('logs.correlationIdLabel')}</div>
                <div className="text-[11px] font-mono text-slate-300 break-all">
                  {selectedLog.correlationId}
                </div>
              </>
            ) : null}

            {selectedLog.sessionId ? (
              <>
                <div className="text-xs text-slate-400">{t('logs.sessionIdLabel')}</div>
                <div className="text-[11px] font-mono text-slate-300 break-all">
                  {selectedLog.sessionId}
                </div>
              </>
            ) : null}

            <div className="text-xs text-slate-400">{t('logs.messageLabel')}</div>
            <div className="text-sm text-slate-200 whitespace-pre-wrap break-words">
              {selectedLog.message}
            </div>

            {selectedLog.context ? (
              <>
                <div className="text-xs text-slate-400">{t('logs.contextLabel')}</div>
                <pre className="text-[11px] font-mono text-slate-300 bg-black/30 border border-white/10 rounded-md p-2 overflow-auto max-h-56">
                  {JSON.stringify(selectedLog.context, null, 2)}
                </pre>
              </>
            ) : null}

            {selectedLog.details ? (
              <>
                <div className="text-xs text-slate-400">{t('logs.detailsPanel')}</div>
                <pre className="text-[11px] font-mono text-slate-300 bg-black/30 border border-white/10 rounded-md p-2 overflow-auto max-h-56">
                  {JSON.stringify(selectedLog.details, null, 2)}
                </pre>
              </>
            ) : null}

            <div className="flex gap-2 pt-2 border-t border-white/10">
              <Button
                size="xs"
                variant="secondary"
                onClick={() => {
                  void onCopyMessage(selectedLog.message, selectedLog.id);
                }}
              >
                {t('logs.copyMessage')}
              </Button>
              <Button
                size="xs"
                variant="secondary"
                onClick={() => {
                  const payload = JSON.stringify(selectedLog, null, 2);
                  void copyTextToClipboard({ text: payload });
                }}
              >
                {t('logs.copyJson')}
              </Button>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
