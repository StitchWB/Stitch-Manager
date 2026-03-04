import { Play, Square } from 'lucide-react';
import { cn } from '../../lib/utils';
import { t } from '../../lib/i18n';
import { Input } from '../ui';

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
    <div className="shrink-0 p-4 border-t border-white/5">
      <div
        className="flex rounded-lg overflow-hidden"
        style={{ boxShadow: '0 0 20px rgba(99, 102, 241, 0.15)' }}
      >
        {/* Count Input */}
        <div className="relative">
          <Input
            type="number"
            min={1}
            max={100}
            value={count.toString()}
            onChange={e => onCountChange(parseInt(e.target.value) || 1)}
            disabled={isRunning}
            className="w-14 h-11 text-center font-mono font-bold text-white text-lg rounded-l-lg rounded-r-none border-r-0 focus:outline-none focus:ring-0"
            shellClassName="rounded-l-lg rounded-r-none border-r-0"
            containerClassName="w-14"
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRight: 'none',
            }}
          />
        </div>

        {/* Start/Stop Button */}
        {!isRunning ? (
          <button
            type="button"
            onClick={onStart}
            disabled={startBlocked}
            className={cn(
              'flex-1 h-11 rounded-l-none rounded-r-lg text-sm font-semibold flex items-center justify-center gap-2',
              'text-white transition-all',
              !startBlocked
                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500'
                : 'bg-slate-700/50 cursor-not-allowed'
            )}
          >
            <Play className="w-4 h-4" />
            {t('autoReg.start')}
          </button>
        ) : (
          <button
            type="button"
            onClick={onStop}
            className="flex-1 h-11 rounded-l-none rounded-r-lg text-sm font-semibold flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white transition-colors"
          >
            <Square className="w-4 h-4" />
            {t('autoReg.stop')}
          </button>
        )}
      </div>

      {/* Status indicator */}
      <div className="flex flex-col items-end gap-1 mt-2 text-[10px] text-slate-500">
        <div className="flex items-center gap-1.5">
          {isPythonBlocked ? (
            <>
              <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
              <span>Python auto-reg unavailable</span>
            </>
          ) : canStart ? (
            <>
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px] shadow-emerald-500/50" />
              <span>{t('autoReg.readyToStart')}</span>
            </>
          ) : (
            <>
              <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              <span>{t('autoReg.configureMailFirst')}</span>
            </>
          )}
        </div>

        {isPythonBlocked && (
          <div className="text-[10px] text-slate-600">Install Python + DrissionPage</div>
        )}
      </div>
    </div>
  );
}
