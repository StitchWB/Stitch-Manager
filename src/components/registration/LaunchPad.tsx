import { useState } from 'react';
import { Pause, Play, Square } from 'lucide-react';
import { t } from '@/lib/i18n';
import { Badge, Button, GlassCard, Input } from '@/components/ui';
import { registrationControl } from '../../lib/tauri';

interface LaunchPadProps {
  count: number;
  onCountChange: (count: number) => void;
  isRunning: boolean;
  canStart: boolean;
  pythonAvailable: boolean | null;
  onStart: () => void;
  onStop: () => void;
  jobId?: string | null;
}

export function LaunchPad({
  count,
  onCountChange,
  isRunning,
  canStart,
  pythonAvailable,
  onStart,
  onStop,
  jobId,
}: LaunchPadProps) {
  const [isPaused, setIsPaused] = useState(false);
  const isPythonBlocked = pythonAvailable === false;
  const startBlocked = !canStart || isPythonBlocked;

  const handlePauseResume = async () => {
    if (!jobId) return;
    try {
      await registrationControl(jobId, isPaused ? 'resume' : 'pause');
      setIsPaused(paused => !paused);
    } catch {
      // The runtime panel will surface control failures in the event log.
    }
  };

  return (
    <GlassCard className="shrink-0 rounded-none border-x-0 border-b-0 border-t border-indigo-500/20 bg-gradient-to-b from-indigo-500/[0.06] to-transparent">
      <div className="flex items-center gap-2 p-3">
        <Input
          type="number"
          min={1}
          max={100}
          value={count.toString()}
          onChange={event => onCountChange(Math.max(1, Math.min(100, Number(event.target.value) || 1)))}
          disabled={isRunning}
          aria-label="Количество запусков"
          className="w-[52px] text-center font-mono font-bold tabular-nums text-white"
          containerClassName="w-[52px] shrink-0"
        />

        {!isRunning ? (
          <Button
            type="button"
            onClick={onStart}
            disabled={startBlocked}
            variant="primary"
            size="lg"
            leftIcon={<Play className="w-4 h-4" />}
            className="flex-1"
          >
            {t('autoReg.start')}
          </Button>
        ) : (
          <div className="flex-1 flex items-center gap-2">
            <Button
              type="button"
              onClick={handlePauseResume}
              variant="secondary"
              size="lg"
              leftIcon={<Pause className="w-4 h-4" />}
              className="flex-1"
            >
              {isPaused ? t('autoReg.resume') : t('autoReg.pause')}
            </Button>
            <Button
              type="button"
              onClick={onStop}
              variant="danger"
              size="lg"
              leftIcon={<Square className="w-4 h-4" />}
              className="flex-1"
            >
              {t('autoReg.stop')}
            </Button>
          </div>
        )}
      </div>

      <div className="flex justify-end px-3 pb-2.5">
        {isPythonBlocked ? (
          <Badge variant="danger" size="sm">{t('autoReg.launch_pad.python')}</Badge>
        ) : canStart ? (
          <Badge variant="success" size="sm" withDot withPulse>{t('autoReg.readyToStart')}</Badge>
        ) : (
          <Badge variant="warning" size="sm">{t('autoReg.configureMailFirst')}</Badge>
        )}
      </div>

      {isPythonBlocked && (
        <div className="px-3 pb-3 text-xs text-slate-500">
          {t('autoReg.launch_pad.python_drissionpage')}
        </div>
      )}
    </GlassCard>
  );
}
