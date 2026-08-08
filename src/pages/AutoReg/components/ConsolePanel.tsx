import { Activity, AlertCircle, X } from 'lucide-react';
import { t } from '@/lib/i18n';
import { useState, useEffect } from 'react';
import type { RegistrationLog } from '../../../types/ui';
import { ButtonBase, EmptyState, MissionControlHUD, StatusBadge, StatusBar } from '@/components/ui';
import { PipelineControls } from '../../../components/registration/PipelineControls';

interface ConsolePanelProps {
  logs: RegistrationLog[];
  successCount: number;
  failedCount: number;
  activeThreads: number;
  isRunning: boolean;
  canStart: boolean;
  activeProvider?: string;
  onStart: () => void;
  onClear: () => void;
  onProviderChange: (provider: string) => void;
  showDebug: boolean;
  onShowDebugChange: (show: boolean) => void;
  pipelineJobId: string | null;
  /** Shortcut shown in the empty state when mandatory settings are missing. */
  onConfigureMail?: () => void;
}

export const ConsolePanel = ({
  logs,
  successCount,
  failedCount,
  activeThreads,
  isRunning,
  canStart,
  activeProvider,
  onStart,
  onClear,
  onProviderChange,
  showDebug,
  onShowDebugChange,
  pipelineJobId,
  onConfigureMail,
}: ConsolePanelProps) => {
  // Only surface errors that are actual failures — skip [db] info messages
  // that happen to carry level="error" but contain success=True.
  const lastError = [...logs].reverse().find(
    log =>
      log.level === 'error' &&
      !log.message.includes('success=True') &&
      !log.message.startsWith('[db]'),
  );

  const [errorDismissed, setErrorDismissed] = useState(false);

  // Reset dismiss state whenever a genuinely new error appears.
  useEffect(() => {
    setErrorDismissed(false);
  }, [lastError?.message]);

  const showError = !!lastError && !errorDismissed;
  const showEmptyState = logs.length === 0 && !isRunning;

  return (
    <div className="flex-1 flex flex-col min-w-0 p-4" style={{ background: '#050508' }}>
      <div className="card h-full flex flex-col border border-white/5 overflow-hidden">
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-white/5">
          <div>
            <h3 className="text-sm font-semibold text-white">{t('autoReg.consoleOutput')}</h3>
            <p className="text-2xs text-slate-500 mt-0.5">{t('autoReg.liveRegistrationLogs')}</p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBar success={successCount} failed={failedCount} active={activeThreads} />
            <ButtonBase onClick={onClear} className="btn-ghost text-xs py-1.5 px-3">
              {t('common.clear')}
            </ButtonBase>
          </div>
        </div>

        <PipelineControls jobId={pipelineJobId} isRunning={isRunning} />

        {showError && (
          <div className="shrink-0 flex items-start gap-2 border-b border-red-500/15 bg-red-500/[0.04] px-4 py-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <div className="min-w-0 flex-1">
              <StatusBadge status="error" size="sm">Последняя ошибка</StatusBadge>
              <p className="mt-1 break-words text-xs text-red-200/80">{lastError.message}</p>
            </div>
            <button
              onClick={() => setErrorDismissed(true)}
              className="ml-1 shrink-0 rounded p-0.5 text-red-400/60 hover:text-red-300 hover:bg-red-500/10 transition-colors"
              aria-label="Закрыть"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className="flex-1 min-h-0">
          {showEmptyState ? (
            <EmptyState
              icon={Activity}
              title="Журнал пока пуст"
              description={canStart ? 'Настройте параметры слева и запустите процесс.' : 'Завершите обязательные настройки перед запуском.'}
              action={
                !canStart && onConfigureMail ? (
                  <ButtonBase
                    type="button"
                    onClick={onConfigureMail}
                    className="btn-ghost text-xs py-1.5 px-3 border border-amber-500/20 text-amber-300 hover:bg-amber-500/10 rounded-md"
                  >
                    {t('autoReg.configureMailFirst')}
                  </ButtonBase>
                ) : undefined
              }
              className="h-full"
            />
          ) : (
            <MissionControlHUD
              logs={logs}
              isRunning={isRunning}
              canStart={canStart}
              onStart={onStart}
              onClear={onClear}
              className="h-full"
              activeProvider={activeProvider}
              onProviderChange={onProviderChange}
              showDebug={showDebug}
              onShowDebugChange={onShowDebugChange}
              hideTimeline={!!pipelineJobId}
              hideLiveStatus={!!showError}
            />
          )}
        </div>
      </div>
    </div>
  );
};
