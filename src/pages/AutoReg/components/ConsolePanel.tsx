import { t } from '../../../lib/i18n';
import type { RegistrationLog } from '../../../types/ui';
import { ButtonBase, MissionControlHUD, StatusBar } from '@/components/ui';
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
}: ConsolePanelProps) => {
  return (
    <div className="flex-1 flex flex-col min-w-0 p-4" style={{ background: '#050508' }}>
      <div className="card h-full flex flex-col border border-white/5 overflow-hidden">
        {/* Header */}
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

        {/* Pipeline steps + controls (inline) */}
        <PipelineControls jobId={pipelineJobId} isRunning={isRunning} />

        {/* Mission Control HUD */}
        <div className="flex-1 min-h-0">
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
          />
        </div>
      </div>
    </div>
  );
};
