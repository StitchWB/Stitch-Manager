import { KeyRound, Server, ShieldCheck } from 'lucide-react';

import { Badge, GlassCard } from '@/components/ui';
import type { ModelSyncStatusResponse } from '@/lib/backend/modules/modelSync';
import { t } from '@/lib/i18n';

interface GatewayStatusCardProps {
  status: ModelSyncStatusResponse | null;
  modelCount: number;
}

export function GatewayStatusCard({ status, modelCount }: GatewayStatusCardProps) {
  const running = Boolean(status?.gatewayRunning);
  const tokenAvailable = Boolean(status?.gatewayRunning);

  return (
    <GlassCard className="p-4" data-testid="model-sync-gateway-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/10 text-sky-300">
            <Server size={17} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-100">{t('modelSync.gateway.title')}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge variant={running ? 'success' : 'danger'} size="sm" withDot>
                {running ? t('modelSync.gateway.running') : t('modelSync.gateway.stopped')}
              </Badge>
              <Badge variant={tokenAvailable ? 'success' : 'warning'} size="sm">
                <KeyRound size={11} className="mr-1" />
                {tokenAvailable
                  ? t('modelSync.gateway.tokenAvailable')
                  : t('modelSync.gateway.tokenUnavailable')}
              </Badge>
            </div>
          </div>
        </div>
        <div className="grid gap-1 text-right text-xs text-slate-400">
          <div>
            <span className="text-slate-500">{t('modelSync.gateway.baseUrl')}: </span>
            <span className="font-mono text-slate-200">{status?.baseUrl || '—'}</span>
          </div>
          <div>
            <span className="text-slate-500">{t('modelSync.gateway.models')}: </span>
            <span className="font-semibold text-slate-200">{modelCount}</span>
          </div>
        </div>
      </div>
      <p className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
        <ShieldCheck size={13} className="text-emerald-400" />
        {t('modelSync.gateway.tokenNotice')}
      </p>
    </GlassCard>
  );
}
