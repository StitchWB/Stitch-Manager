import { cn } from '../../lib/utils';
import { Check } from 'lucide-react';
import { t } from '../../lib/i18n';

export type ProcessStep = 
  | 'init' 
  | 'imap' 
  | 'browser' 
  | 'auth' 
  | 'verify' 
  | 'token' 
  | 'done';

interface ProcessTimelineProps {
  currentStep: ProcessStep;
  className?: string;
}

const STEPS: { id: ProcessStep; labelKey: string }[] = [
  { id: 'init', labelKey: 'timeline.init' },
  { id: 'imap', labelKey: 'timeline.mail' },
  { id: 'browser', labelKey: 'timeline.browser' },
  { id: 'auth', labelKey: 'timeline.auth' },
  { id: 'verify', labelKey: 'timeline.verify' },
  { id: 'token', labelKey: 'timeline.token' },
  { id: 'done', labelKey: 'timeline.done' },
];

export function ProcessTimeline({ currentStep, className }: ProcessTimelineProps) {
  const currentIndex = STEPS.findIndex(s => s.id === currentStep);
  const isDone = currentStep === 'done';

  return (
    <div className={cn('px-6 py-4', className)}>
      <div className="flex items-center justify-between relative">
        {/* Background line - thicker */}
        <div className="absolute left-4 right-4 top-[14px] h-[3px] bg-white/[0.06] rounded-full" />
        
        {/* Progress line - fills with green, glows */}
        <div 
          className="absolute left-4 top-[14px] h-[3px] rounded-full transition-all duration-700 ease-out"
          style={{ 
            width: `calc(${(currentIndex / (STEPS.length - 1)) * 100}% - 32px + ${currentIndex * 8}px)`,
            background: '#10b981',
            boxShadow: '0 0 12px rgba(16, 185, 129, 0.6), 0 0 4px rgba(16, 185, 129, 0.8)'
          }}
        />

        {STEPS.map((step, index) => {
          const isCompleted = index < currentIndex || isDone;
          const isCurrent = index === currentIndex && !isDone;
          const isPending = index > currentIndex && !isDone;

          return (
            <div key={step.id} className="relative flex flex-col items-center z-10">
              {/* Step circle */}
              <div
                className={cn(
                  'w-7 h-7 rounded-full flex items-center justify-center transition-all duration-300 border-2',
                  // Completed: solid green with glow
                  isCompleted && 'bg-emerald-500 border-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.6)]',
                  // Current: pulsing purple ring
                  isCurrent && 'bg-transparent border-purple-500 shadow-[0_0_16px_rgba(168,85,247,0.7),0_0_32px_rgba(168,85,247,0.4)] animate-pulse',
                  // Pending: dark gray
                  isPending && 'bg-white/[0.03] border-white/10'
                )}
              >
                {isCompleted ? (
                  <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                ) : isCurrent ? (
                  <div className="w-2.5 h-2.5 rounded-full bg-purple-400 shadow-[0_0_8px_rgba(168,85,247,0.8)]" />
                ) : (
                  <div className="w-2 h-2 rounded-full bg-white/10" />
                )}
              </div>

              {/* Label */}
              <span
                className={cn(
                  'text-[10px] mt-2 font-semibold tracking-wide transition-colors',
                  isCompleted && 'text-emerald-400',
                  isCurrent && 'text-white',
                  isPending && 'text-white/25'
                )}
              >
                {t(step.labelKey)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
