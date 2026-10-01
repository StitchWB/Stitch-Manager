import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ArrowDownToLine, FileText } from 'lucide-react';
import Header from '../components/layout/Header';

import { LogDetailsPane } from '../components/logs/LogDetailsPane';
import { LogExportMenu } from '../components/logs/LogExportMenu';
import { LogFilterBar } from '../components/logs/LogFilterBar';
import { LogList } from '../components/logs/LogList';
import { groupLogsByOperation } from '../components/logs/logGrouping';
import { useAppStore } from '../stores/app';
import { useLogsStore, type LogEntry } from '../stores/logs';
import { useUIPreferencesStore } from '../stores/uiPreferences';
import { t } from '../lib/i18n';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import { Button, EmptyState, LoadingSpinner, LogGroup } from '@/components/ui';

export default function Logs() {
  const { language } = useAppStore();
  const {
    logs,
    hasMore,
    isLoading,
    error,
    fetchLogs,
    loadMore,
    subscribeToLogs,
    unsubscribeFromLogs,
    collapsedGroups,
    toggleGroup,
  } = useLogsStore();

  const {
    logsPage: { selectedTab, selectedLogId },
    setLogsSelectedLogId,
  } = useUIPreferencesStore();

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { copy } = useCopyToClipboard();
  const logListRef = useRef<HTMLDivElement | null>(null);

  const [isFollowing, setIsFollowing] = useState(true);
  const [newLogCount, setNewLogCount] = useState(0);
  const prevLogsLength = useRef(logs.length);

  void language;

  useEffect(() => {
    fetchLogs();
    subscribeToLogs();
    return () => unsubscribeFromLogs();
  }, [fetchLogs, subscribeToLogs, unsubscribeFromLogs]);

  // Follow / +N new logs
  useEffect(() => {
    const prevLen = prevLogsLength.current;
    prevLogsLength.current = logs.length;

    if (logs.length > prevLen && prevLen > 0) {
      if (isFollowing) {
        if (logListRef.current) {
          logListRef.current.scrollTop = 0;
        }
      } else {
        setNewLogCount(c => c + (logs.length - prevLen));
      }
    }
  }, [logs.length, isFollowing]);

  const handleFollowToggle = useCallback(() => {
    setIsFollowing(v => {
      const next = !v;
      if (next) {
        setNewLogCount(0);
        if (logListRef.current) {
          logListRef.current.scrollTop = 0;
        }
      }
      return next;
    });
  }, []);

  const handleNewLogsClick = useCallback(() => {
    setNewLogCount(0);
    if (logListRef.current) {
      logListRef.current.scrollTop = 0;
    }
  }, []);

  const groupedLogs = useMemo(() => groupLogsByOperation(logs), [logs]);

  const pythonLogs = useMemo(
    () =>
      logs.filter(log => {
        const msg = log.message.toLowerCase();
        return (
          log.source === 'python_runner' ||
          msg.includes('scenario.replay') ||
          msg.includes('scenario.record') ||
          msg.includes('python.stderr') ||
          msg.includes('python.protocol')
        );
      }),
    [logs]
  );

  const errorLogs = useMemo(
    () => logs.filter(log => log.level === 'error' || log.level === 'warn'),
    [logs]
  );

  const copyMessage = useCallback(
    async (text: string, logId: string) => {
      await copy(text);
      setCopiedId(logId);
      setTimeout(() => setCopiedId(null), 1200);
    },
    [copy]
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title={t('logs.title')}
        subtitle={t('logs.subtitle')}
        icon={<FileText size={18} />}
        actions={<LogExportMenu />}
      />

      <LogFilterBar
        tabCounts={{
          stream: logs.length,
          grouped: groupedLogs.length,
          errors: errorLogs.length,
          python: pythonLogs.length,
        }}
      />

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-w-0 p-4 overflow-hidden">
          {error && (
            <div className="mb-3 p-3 bg-vsc-red/10 border border-vsc-red/30 rounded text-sm text-vsc-red">
              {error}
            </div>
          )}

          <div className="h-full card overflow-hidden flex flex-col bg-vsc-bg">
            <div ref={logListRef} className="overflow-auto flex-1 relative">
              {/* Follow toggle + new logs badge */}
              <div className="absolute top-2 right-2 z-10 flex items-center gap-2">
                {newLogCount > 0 && (
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={handleNewLogsClick}
                    className="animate-pulse"
                  >
                    {t('logs.newLogs', { count: String(newLogCount) })}
                  </Button>
                )}
                <Button
                  size="xs"
                  variant={isFollowing ? 'secondary' : 'ghost'}
                  onClick={handleFollowToggle}
                  leftIcon={<ArrowDownToLine size={12} className={isFollowing ? 'text-vsc-green' : ''} />}
                >
                  {t('logs.follow')}
                </Button>
              </div>
              {logs.length === 0 && !isLoading ? (
                <EmptyState
                  icon={FileText}
                  title={t('logs.noLogs')}
                  description="No logs to display"
                />
              ) : selectedTab === 'grouped' ? (
                <div className="p-3 space-y-2">
                  {groupedLogs.map(group => (
                    <LogGroup
                      key={group.id}
                      name={group.name}
                      source={group.source}
                      entries={group.entries}
                      status={group.status}
                      isCollapsed={collapsedGroups.has(group.id)}
                      onToggle={() => toggleGroup(group.id)}
                      duration={group.duration}
                      lastActivity={group.lastActivity}
                      levelCounts={group.levelCounts}
                      onSelectLog={(log: LogEntry) => setLogsSelectedLogId(log.id)}
                      selectedLogId={selectedLogId}
                    />
                  ))}
                </div>
              ) : selectedTab === 'errors' ? (
                <LogList
                  rows={errorLogs}
                  copiedId={copiedId}
                  selectedLogId={selectedLogId}
                  onSelectLog={setLogsSelectedLogId}
                  onCopyMessage={copyMessage}
                />
              ) : selectedTab === 'python' ? (
                <LogList
                  rows={pythonLogs}
                  copiedId={copiedId}
                  selectedLogId={selectedLogId}
                  onSelectLog={setLogsSelectedLogId}
                  onCopyMessage={copyMessage}
                />
              ) : (
                <LogList
                  rows={logs}
                  copiedId={copiedId}
                  selectedLogId={selectedLogId}
                  onSelectLog={setLogsSelectedLogId}
                  onCopyMessage={copyMessage}
                />
              )}

              {isLoading && (
                <div className="flex items-center justify-center py-8">
                  <LoadingSpinner size="md" />
                </div>
              )}

              {hasMore && !isLoading && (
                <div className="flex justify-center py-4">
                  <Button onClick={loadMore} variant="secondary" size="sm">
                    {t('logs.loadMore')}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        <LogDetailsPane onCopyMessage={copyMessage} />
      </div>
    </div>
  );
}
