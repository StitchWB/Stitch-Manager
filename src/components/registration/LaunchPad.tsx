import { Play, Square } from 'lucide-react';
import { t } from '../../lib/i18n';
import { Button, GlassCard, Badge, Input } from '@/components/ui';

interface LaunchPadProps {
  count: number;
  onCountChange: (count: number) => void;
  isRunning: boolean;
  canStart: boolean;
  pythonAvailable: boolean | null;
  onStart: () => void;
  onStop: () => void;
}

export function LaunchPad({
  count,
  onCountChange,
  isRunning,
  canStart,
  pythonAvailable,
  onStart,
  onStop,
}: LaunchPadProps) {
  const isPythonBlocked = pythonAvailable === false;
  const startBlocked = !canStart || isPythonBlocked;

  return (
    <GlassCard className="shrink-0 border-indigo-500/20 bg-gradient-to-b from-indigo-500/[0.06] to-transparent">
      <div className="flex items-center gap-3 p-3">
        {/* Count Input */}
        <Input
          type="number"
          min={1}
          max={100}
          value={count.toString()}
          onChange={e => onCountChange(parseInt(e.target.value) || 1)}
          disabled={isRunning}
          className="w-16 text-center font-mono font-bold text-lg tabular-nums text-white"
          containerClassName="w-16"
        />

        {/* Start/Stop Button */}
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
        )}
      </div>

      {/* Status indicator */}
      <div className="flex items-center justify-end gap-2 px-3 pb-3">
        {isPythonBlocked ? (
          <Badge variant="danger" size="sm">Python авто-рег недоступен</Badge>
        ) : canStart ? (
          <Badge variant="success" size="sm" withDot withPulse>{t('autoReg.readyToStart')}</Badge>
        ) : (
          <Badge variant="warning" size="sm">{t('autoReg.configureMailFirst')}</Badge>
        )}
      </div>

      {isPythonBlocked && (
        <div className="px-3 pb-3 text-xs text-slate-500">
          Установите Python + DrissionPage
        </div>
      )}
    </GlassCard>
  );
}
