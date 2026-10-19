import { CheckCircle, XCircle, Loader2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProgressBar } from './ProgressBar';
import { useEffect, useState } from 'react';

export interface StageProgressProps {
  stage: string;
  icon?: string;
  status: 'pending' | 'active' | 'success' | 'error';
  progress?: { current: number; total: number };
  startTime?: number; // timestamp in ms
  message?: string;
}

export function StageProgress({
  stage,
  icon,
  status,
  progress,
  startTime,
  message,
}: StageProgressProps) {
  const [duration, setDuration] = useState(0);

  // Live timer update
  useEffect(() => {
    if (status === 'active' && startTime) {
      const interval = setInterval(() => {
        setDuration(Date.now() - startTime);
      }, 100); // Update every 100ms

      return () => clearInterval(interval);
    }
  }, [status, startTime]);

  const formatDuration = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes > 0) {
      return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    return `${seconds}s`;
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-5 h-5 text-vsc-green" />;
      case 'error':
        return <XCircle className="w-5 h-5 text-vsc-red" />;
      case 'active':
        return <Loader2 className="w-5 h-5 text-vsc-blue animate-spin" />;
      case 'pending':
        return <Clock className="w-5 h-5 text-slate-500" />;
    }
  };

  return (
    <div
      className={cn(
        'rounded-lg border p-4 bg-slate-900/50 backdrop-blur-sm',
        status === 'success' && 'border-vsc-green/30',
        status === 'error' && 'border-vsc-red/30',
        status === 'active' && 'border-vsc-blue/30',
        status === 'pending' && 'border-slate-700'
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        {/* Icon */}
        {icon && <span className="text-xl">{icon}</span>}

        {/* Status Icon */}
        {getStatusIcon()}

        {/* Stage Name */}
        <span className="font-semibold text-slate-200">{stage}</span>

        {/* Duration */}
        {status === 'active' && startTime && (
          <span className="ml-auto text-xs text-slate-500 tabular-nums">
            {formatDuration(duration)}
          </span>
        )}
      </div>

      {/* Progress Bar */}
      {progress && (
        <div className="mb-2">
          <ProgressBar
            value={progress.current}
            max={progress.total}
            showLabel
            size="sm"
          />
        </div>
      )}

      {/* Message */}
      {message && <p className="text-xs text-slate-400">{message}</p>}
    </div>
  );
}
