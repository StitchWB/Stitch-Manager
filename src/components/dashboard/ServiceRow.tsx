import { RotateCw, ScrollText } from 'lucide-react';
import { motion } from 'framer-motion';

import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { ButtonBase } from '@/components/ui/ButtonBase';
import { Tooltip } from '@/components/ui/Tooltip';
import { useMarketplaceStore } from '@/stores/marketplace';
import type { ServicePluginInfo } from '@/lib/backend/modules/servicePlugins';

interface ServiceRowProps {
  plugin: ServicePluginInfo;
  index: number;
  restarting: boolean;
  onRestart: (pluginId: string) => void;
  onLogs: (pluginId: string) => void;
}

export function formatDuration(compactMs: number): string {
  const minutes = Math.floor(compactMs / 60_000);
  if (minutes < 1) return t('dashboard.cc.services.unitMinutes', { m: 0 });
  if (minutes < 60) return t('dashboard.cc.services.unitMinutes', { m: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('dashboard.cc.services.unitHours', { h: hours });
  return t('dashboard.cc.services.unitDays', { d: Math.floor(hours / 24) });
}

const ACTION_BUTTON =
  'p-1 rounded text-slate-500 hover:text-white hover:bg-white/[0.08] transition-colors';

export function ServiceRow({ plugin, index, restarting, onRestart, onLogs }: ServiceRowProps) {
  const running = plugin.status.status === 'running';
  const icon = useMarketplaceStore(
    state => state.items.find(item => item.id === plugin.id)?.icon ?? null,
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.06 }}
      data-testid={`service-row-${plugin.id}`}
      className={cn(
        'group flex items-center gap-1.5 h-8 px-2 rounded-md min-w-0 border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.05] hover:-translate-y-px transition-all',
      )}
    >
      {icon !== null && (
        <span className="shrink-0 text-[14px] leading-none select-none" aria-hidden="true">
          {icon}
        </span>
      )}
      {(icon === null || running) && (
        <span
          className={cn(
            'w-1.5 h-1.5 rounded-full shrink-0',
            running
              ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)] animate-pulse'
              : 'bg-slate-600',
          )}
          aria-hidden="true"
        />
      )}

      <span className="flex-1 min-w-0 text-[11px] text-slate-200 truncate">{plugin.id}</span>

      <span className="text-[11px] font-mono text-slate-400 shrink-0">{`v${plugin.version}`}</span>

      <span className="text-[11px] text-slate-400 text-right truncate shrink-0 tabular-nums">
        {running && plugin.status.uptimeSeconds !== null
          ? t('dashboard.cc.services.uptime', {
              time: formatDuration(plugin.status.uptimeSeconds * 1000),
            })
          : t('dashboard.cc.services.notRunning')}
      </span>

      <span className="flex items-center justify-end gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <Tooltip content={t('dashboard.cc.services.restart')} side="top">
          <ButtonBase
            type="button"
            aria-label={t('dashboard.cc.services.restart')}
            className={ACTION_BUTTON}
            disabled={restarting}
            onClick={() => onRestart(plugin.id)}
          >
            <RotateCw size={12} className={restarting ? 'animate-spin' : undefined} />
          </ButtonBase>
        </Tooltip>
        <Tooltip content={t('dashboard.cc.services.logs')} side="top">
          <ButtonBase
            type="button"
            aria-label={t('dashboard.cc.services.logs')}
            className={ACTION_BUTTON}
            onClick={() => onLogs(plugin.id)}
          >
            <ScrollText size={12} />
          </ButtonBase>
        </Tooltip>
      </span>
    </motion.div>
  );
}
