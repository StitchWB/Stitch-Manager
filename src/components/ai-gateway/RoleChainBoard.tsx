import { Fragment, useEffect } from 'react';
import { ArrowRight, Layers3, RefreshCw } from 'lucide-react';

import { Badge, Button, EmptyState, GlassCard, SkeletonLoader } from '@/components/ui';
import type { BadgeProps } from '@/components/ui';
import type {
  RoleChainStepState,
  RoleChainStepStatus,
  RoleChainTrustState,
  RoleRoutingState,
} from '@/lib/backend/modules/aiGateway';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useAiGatewayStore } from '@/stores/aiGateway';
import { useAppStore } from '@/stores/app';

const ROLE_VARIANTS: Record<RoleRoutingState, BadgeProps['variant']> = {
  active: 'success',
  degraded: 'warning',
  probing: 'info',
  demoted: 'danger',
  disabled: 'slate',
  missing: 'warning',
};

const STEP_VARIANTS: Record<RoleChainStepState, BadgeProps['variant']> = {
  active: 'success',
  probing: 'info',
  demoted: 'danger',
  disabled: 'slate',
  missing: 'warning',
  manual: 'indigo',
};

const TRUST_VARIANTS: Record<RoleChainTrustState, BadgeProps['variant']> = {
  verified_coherent: 'success',
  untested: 'slate',
  degraded: 'danger',
  usage_fabrication_suspect: 'warning',
};

const TRUST_LABEL_KEYS: Record<RoleChainTrustState, string> = {
  verified_coherent: 'aiHub.roleChains.trust.verifiedCoherent',
  untested: 'aiHub.roleChains.trust.untested',
  degraded: 'aiHub.roleChains.trust.degraded',
  usage_fabrication_suspect: 'aiHub.roleChains.trust.usageFabricationSuspect',
};

// Endpoint-level fabrication is worth a compact warning only when the share
// is large and the sample is not a single model — below that the per-step
// "usage suspect" badge already carries the signal.
const SUPPLIER_INTEGRITY_MIN_PROBED = 2;
const SUPPLIER_INTEGRITY_MIN_SHARE = 0.5;

function formatDateTime(value: string | null | undefined, locale: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function StepCard({ step, locale }: { step: RoleChainStepStatus; locale: string }) {
  const missing = !step.endpointId
    ? t('aiHub.roleChains.missingEndpoint')
    : !step.upstreamRowId
      ? t('aiHub.roleChains.missingUpstream')
      : !step.routeTargetId
        ? t('aiHub.roleChains.missingRoute')
        : null;
  const lastVerified = formatDateTime(step.access.lastVerifiedAt, locale);
  const nextProbe = formatDateTime(step.access.nextProbeAt, locale);
  const trustState: RoleChainTrustState = step.trustState ?? 'untested';
  const probedAt = formatDateTime(step.probedAt, locale);

  return (
    <div
      data-testid={`role-chain-step-${step.ordinal}`}
      className={cn(
        'min-w-[230px] max-w-[270px] flex-1 rounded-lg border bg-slate-950/35 p-3 transition-colors',
        step.state === 'active'
          ? 'border-emerald-400/25 shadow-[0_0_18px_rgba(16,185,129,0.08)]'
          : step.state === 'demoted'
            ? 'border-red-400/20'
            : step.state === 'manual'
              ? 'border-indigo-400/25'
              : 'border-white/[0.08]',
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.06] text-[11px] font-semibold text-slate-300 ring-1 ring-white/10">
            {step.ordinal}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-slate-500">
            {t('aiHub.roleChains.desiredOrder')}
          </span>
        </div>
        <Badge variant={STEP_VARIANTS[step.state]} size="sm" withDot withPulse={step.state === 'probing'}>
          {t(`aiHub.roleChains.stepState.${step.state}`)}
        </Badge>
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <div className="truncate font-mono text-xs font-semibold text-slate-100" title={step.upstreamModelKey}>
            {step.upstreamModelKey}
          </div>
          {step.isCurrent ? (
            <Badge variant="success" size="sm">{t('aiHub.roleChains.currentStep')}</Badge>
          ) : null}
        </div>
        {step.family ? <div className="mt-0.5 truncate text-[11px] text-slate-500">{step.family}</div> : null}
      </div>

      <div className="mt-2 space-y-1 text-[11px] text-slate-400">
        <div className="truncate" title={step.endpointBaseUrl ?? undefined}>
          {step.endpointName ?? step.endpointSelector}
        </div>
        {step.endpointCircuitState ? (
          <div>{t('aiHub.roleChains.circuit', { state: step.endpointCircuitState })}</div>
        ) : null}
        {missing ? <div className="text-amber-300">{missing}</div> : null}
        {step.lifecycleReason ? (
          <div className="truncate text-slate-500" title={step.lifecycleReason}>{step.lifecycleReason}</div>
        ) : null}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10px]">
        <span className="rounded bg-emerald-500/10 px-1.5 py-1 text-emerald-300">
          {t('aiHub.roleChains.probesAvailable', { count: step.access.available })}
        </span>
        <span className="rounded bg-red-500/10 px-1.5 py-1 text-red-300">
          {t('aiHub.roleChains.probesDenied', { count: step.access.denied })}
        </span>
        <span className="rounded bg-amber-500/10 px-1.5 py-1 text-amber-300">
          {t('aiHub.roleChains.probesTemporary', { count: step.access.temporarilyUnavailable })}
        </span>
        <span className="rounded bg-white/[0.05] px-1.5 py-1 text-slate-400">
          {t('aiHub.roleChains.probesUnknown', { count: step.access.unknown })}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-slate-500">
        {step.priority !== null && step.priority !== undefined ? (
          <span>{t('aiHub.roleChains.priority', { value: step.priority })}</span>
        ) : null}
        <span>{step.managedBy === 'manual' ? t('aiHub.roleChains.manualOverride') : t('aiHub.roleChains.managedByCatalog')}</span>
        <span>
          {t('aiHub.roleChains.lastVerified')}: {lastVerified ?? t('aiHub.roleChains.never')}
        </span>
        {nextProbe ? <span>{t('aiHub.roleChains.nextProbe')}: {nextProbe}</span> : null}
      </div>

      <div className="mt-2 border-t border-white/[0.06] pt-2" data-testid={`role-chain-trust-${step.ordinal}`}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            variant={TRUST_VARIANTS[trustState]}
            size="sm"
            withDot
          >
            {t(TRUST_LABEL_KEYS[trustState])}
          </Badge>
          {step.evidenceTier && step.probeLatencyMs != null ? (
            <span className="text-[10px] text-slate-500">
              {t('aiHub.roleChains.trust.tierLine', { tier: step.evidenceTier, latency: step.probeLatencyMs })}
            </span>
          ) : null}
        </div>
        <div className="mt-1 space-y-0.5 text-[10px] text-slate-500">
          {probedAt ? <div>{t('aiHub.roleChains.trust.probedAt', { when: probedAt })}</div> : null}
          {step.usageReason ? <div className="text-amber-300/90">{step.usageReason}</div> : null}
          {(step.usageSuspicionCount ?? 0) > 0 ? (
            <div className="text-amber-300/90">
              {t('aiHub.roleChains.trust.suspicionCount', { count: step.usageSuspicionCount ?? 0 })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function RoleChainBoard() {
  const routingStatus = useAiGatewayStore(state => state.routingStatus);
  const loading = useAiGatewayStore(state => state.loading.routingStatus);
  const error = useAiGatewayStore(state => state.errors.routingStatus);
  const fetchRoutingStatus = useAiGatewayStore(state => state.fetchRoutingStatus);
  const language = useAppStore(state => state.language);
  const locale = language === 'ru' ? 'ru-RU' : 'en-US';

  useEffect(() => {
    void fetchRoutingStatus();
    const timer = window.setInterval(() => void fetchRoutingStatus(), 30_000);
    return () => window.clearInterval(timer);
  }, [fetchRoutingStatus]);

  if (loading && !routingStatus) {
    return (
      <GlassCard className="p-4" data-testid="role-chain-board">
        <SkeletonLoader variant="card" height="180px" />
      </GlassCard>
    );
  }

  const roles = (routingStatus?.roles ?? []).filter(role => role.id.startsWith('rb/'));

  return (
    <GlassCard className="overflow-hidden" data-testid="role-chain-board">
      <div className="border-b border-white/[0.06] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-400/20">
                <Layers3 size={16} />
              </span>
              <h2 className="text-sm font-semibold text-white">{t('aiHub.roleChains.title')}</h2>
            </div>
            <p className="mt-1.5 max-w-4xl text-xs leading-5 text-slate-400">
              {t('aiHub.roleChains.subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {routingStatus ? (
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-right">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">
                  {t('aiHub.roleChains.gatewayTitle')}
                </div>
                <div className="mt-0.5 flex items-center justify-end gap-2">
                  <Badge variant={routingStatus.gateway.running ? 'success' : 'danger'} size="sm" withDot>
                    {routingStatus.gateway.running
                      ? t('aiHub.roleChains.gatewayRunning')
                      : t('aiHub.roleChains.gatewayStopped')}
                  </Badge>
                  <span className="font-mono text-[11px] text-slate-300">{routingStatus.gateway.baseUrl}</span>
                </div>
              </div>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void fetchRoutingStatus()}
              isLoading={loading}
              leftIcon={<RefreshCw size={13} />}
            >
              {t('aiHub.roleChains.refresh')}
            </Button>
          </div>
        </div>
        {error ? <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div> : null}
      </div>

      {roles.length === 0 ? (
        <EmptyState
          icon={Layers3}
          title={t('aiHub.roleChains.emptyTitle')}
          description={t('aiHub.roleChains.emptyDescription')}
          compact
          className="m-4"
        />
      ) : (
        <div className="divide-y divide-white/[0.05]">
          {roles.map(role => {
            const supplierWarnings = new Map<string, { probed: number; suspect: number }>();
            for (const step of role.steps) {
              const integrity = step.supplierIntegrity;
              if (
                step.endpointId
                && integrity
                && integrity.probedModels >= SUPPLIER_INTEGRITY_MIN_PROBED
                && integrity.fabricationShare >= SUPPLIER_INTEGRITY_MIN_SHARE
                && integrity.fabricationSuspectModels > 0
              ) {
                supplierWarnings.set(step.endpointId, {
                  probed: integrity.probedModels,
                  suspect: integrity.fabricationSuspectModels,
                });
              }
            }
            return (
            <section key={role.id} className="p-4" data-testid={`role-chain-role-${role.id}`}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <h3 className="truncate font-mono text-sm font-semibold text-white">{role.id}</h3>
                  {role.displayName && role.displayName !== role.id ? (
                    <span className="truncate text-xs text-slate-500">{role.displayName}</span>
                  ) : null}
                  {[...supplierWarnings.values()].map(warning => (
                    <span
                      key={`${warning.probed}-${warning.suspect}`}
                      data-testid={`supplier-integrity-warning-${role.id}`}
                      className="rounded-md border border-amber-400/25 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300"
                    >
                      {t('aiHub.roleChains.trust.supplierIntegrity', {
                        suspect: warning.suspect,
                        probed: warning.probed,
                      })}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">
                    {t('aiHub.roleChains.activeOfTotal', { active: role.activeSteps, total: role.totalSteps })}
                  </span>
                  <Badge variant={ROLE_VARIANTS[role.state]} size="sm" withDot>
                    {t(`aiHub.roleChains.roleState.${role.state}`)}
                  </Badge>
                </div>
              </div>

              <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
                {role.steps.map((step, index) => (
                  <Fragment key={step.entryId ?? `${role.id}-${step.ordinal}-${step.upstreamModelKey}`}>
                    <StepCard step={step} locale={locale} />
                    {index < role.steps.length - 1 ? (
                      <div className="flex shrink-0 items-center text-slate-600">
                        <ArrowRight size={16} />
                      </div>
                    ) : null}
                  </Fragment>
                ))}
              </div>
            </section>
            );
          })}
        </div>
      )}
    </GlassCard>
  );
}
