import { KeyRound, Server, ShieldCheck } from 'lucide-react';

import { Badge, GlassCard } from '@/components/ui';
import type { ModelSyncStatusResponse } from '@/lib/backend/modules/modelSync';
import { t } from '@/lib/i18n';

interface GatewayStatusCardProps {
  status: ModelSyncStatusResponse | null;
  modelCount: number;
}

/**
 * Slim status strip at the top of the page: the gateway state, base URL and
 * catalog size are the key facts and are rendered at a readable size rather
 * than as caption-gray microtext.
 */
export function GatewayStatusCard({ status, modelCount }: GatewayStatusCardProps) {
  const running = Boolean(status?.gatewayRunning);
  const tokenAvailable = Boolean(status?.gatewayRunning);

  return (
    <GlassCard className="px-5 py-4" data-testid="model-sync-gateway-card">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/10 text-sky-300">
            <Server size={18} />
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

        <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              {t('modelSync.gateway.baseUrl')}
            </div>
            <div className="mt-0.5 font-mono text-sm text-slate-100">
              {status?.baseUrl || '—'}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              {t('modelSync.gateway.models')}
            </div>
            <div className="mt-0.5 text-sm font-semibold text-slate-100">{modelCount}</div>
          </div>
          <p className="flex items-center gap-2 text-xs text-slate-500">
            <ShieldCheck size={14} className="shrink-0 text-emerald-400" />
            {t('modelSync.gateway.tokenNotice')}
          </p>
        </div>
      </div>
    </GlassCard>
  );
}
