import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Info, OctagonAlert } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { ButtonBase } from '@/components/ui/ButtonBase';
import type { ActionItem } from '@/lib/dashboard/insights';

interface ActionQueueProps {
  items: ActionItem[];
}

const SEVERITY_CLASSES: Record<ActionItem['severity'], string> = {
  danger: 'bg-red-500/[0.08] border-red-500/25 text-red-200',
  warn: 'bg-amber-500/[0.08] border-amber-500/25 text-amber-200',
  info: 'bg-white/[0.03] border-white/[0.08] text-slate-300',
};

const SEVERITY_ICON_CLASSES: Record<ActionItem['severity'], string> = {
  danger: 'text-red-400',
  warn: 'text-amber-400',
  info: 'text-slate-500',
};

const SEVERITY_ACTION_CLASSES: Record<ActionItem['severity'], string> = {
  danger: 'border-red-400/30 hover:bg-red-500/10',
  warn: 'border-amber-400/30 hover:bg-amber-500/10',
  info: 'border-white/15 hover:bg-white/[0.06]',
};

function SeverityIcon({ severity }: { severity: ActionItem['severity'] }) {
  const className = cn('shrink-0', SEVERITY_ICON_CLASSES[severity]);
  if (severity === 'danger') return <OctagonAlert size={13} className={className} aria-hidden="true" />;
  if (severity === 'warn') return <AlertTriangle size={13} className={className} aria-hidden="true" />;
  return <Info size={13} className={className} aria-hidden="true" />;
}

export function ActionQueue({ items }: ActionQueueProps) {
  const navigate = useNavigate();
  if (items.length === 0) return null;

  return (
    <section
      aria-label={t('dashboard.cc.queue.ariaLabel')}
      className="shrink-0 flex flex-col gap-1"
      data-testid="action-queue"
    >
      <AnimatePresence initial={false}>
        {items.map((item, index) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, delay: index * 0.05 }}
            className={cn(
              'flex items-center gap-2 px-2.5 py-1.5 rounded-lg border',
              SEVERITY_CLASSES[item.severity],
            )}
          >
            <SeverityIcon severity={item.severity} />
            <span className="text-[11px] flex-1 min-w-0 truncate">{item.message}</span>
            {item.to && (
              <ButtonBase
                type="button"
                onClick={() => navigate(item.to as string)}
                className={cn(
                  'shrink-0 text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded border transition-colors',
                  SEVERITY_ACTION_CLASSES[item.severity],
                )}
              >
                {item.actionLabel}
              </ButtonBase>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </section>
  );
}
