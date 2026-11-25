import { formatDistanceToNow } from 'date-fns';
import { ru as dateFnsRu } from 'date-fns/locale';
import { AlertTriangle, KeyRound, ShieldCheck } from 'lucide-react';

import { Badge, GlassCard } from '@/components/ui';
import type {
  ModelSyncSecurityKeyInfo,
  ModelSyncStatusResponse,
  ModelSyncTarget,
} from '@/lib/backend/modules/modelSync';
import { getLocale, t } from '@/lib/i18n';

interface SecurityKeysSectionProps {
  status: ModelSyncStatusResponse | null;
}

function relativeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const locale = getLocale() === 'ru' ? dateFnsRu : undefined;
  return formatDistanceToNow(date, { addSuffix: true, locale });
}

function stateBadge(state: string | undefined): { label: string; variant: 'success' | 'warning' | 'danger' | 'slate' } {
  switch (state) {
    case 'active':
      return { label: t('modelSync.security.states.active'), variant: 'success' };
    case 'disabled':
      return { label: t('modelSync.security.states.disabled'), variant: 'warning' };
    case 'missing':
      return { label: t('modelSync.security.states.missing'), variant: 'danger' };
    default:
      return { label: t('modelSync.security.states.unknown'), variant: 'slate' };
  }
}

function targetLabel(target: ModelSyncTarget): string {
  return target === 'opencode'
    ? t('modelSync.security.targetOpencode')
    : t('modelSync.security.targetOmp');
}

function KeyRow({ target, info }: { target: ModelSyncTarget; info: ModelSyncSecurityKeyInfo }) {
  const badge = stateBadge(info.state);
  const lastUsed = relativeTime(info.lastUsedAt);
  const created = relativeTime(info.createdAt);
  return (
    <div
      className="rounded-xl border border-white/[0.06] bg-black/20 p-4"
      data-testid={`model-sync-security-key-${target}`}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-300">
          <KeyRound size={15} />
        </div>
        <span className="text-sm font-semibold text-slate-100">{targetLabel(target)}</span>
        <Badge variant={badge.variant} size="sm" withDot data-testid={`security-state-${target}`}>
          {badge.label}
        </Badge>
        {typeof info.enabled === 'boolean' ? (
          <Badge variant={info.enabled ? 'success' : 'slate'} size="sm">
            {info.enabled
              ? t('modelSync.security.enabledLabel')
              : t('modelSync.security.disabledLabel')}
          </Badge>
        ) : null}
        {info.fingerprint ? (
          <span
            className="rounded-md border border-white/[0.08] bg-black/30 px-2 py-0.5 font-mono text-[11px] text-slate-300"
            data-testid={`security-fingerprint-${target}`}
            title={t('modelSync.security.fingerprint')}
          >
            {info.fingerprint}
          </span>
        ) : null}
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-xs">
        {info.keyId ? (
          <div className="flex items-baseline gap-1.5">
            <dt className="text-slate-500">{t('modelSync.security.keyId')}</dt>
            <dd className="font-mono text-slate-200">{info.keyId}</dd>
          </div>
        ) : null}
        {created ? (
          <div className="flex items-baseline gap-1.5">
            <dt className="text-slate-500">{t('modelSync.security.createdAt')}</dt>
            <dd className="text-slate-200">{created}</dd>
          </div>
        ) : null}
        <div className="flex items-baseline gap-1.5">
          <dt className="text-slate-500">{t('modelSync.security.lastUsed')}</dt>
          <dd className="text-slate-200" data-testid={`security-last-used-${target}`}>
            {lastUsed || t('modelSync.security.neverUsed')}
          </dd>
        </div>
      </dl>

      {info.legacyLocalTokenDetected ? (
        <div
          className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200"
          data-testid={`security-legacy-warning-${target}`}
        >
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>{t('modelSync.security.legacyTokenWarning')}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Compact read-only per-target key state. Renders nothing at all when the
 * backend does not report security info (older backends) — graceful
 * degradation for the additive status.security field.
 */
export function SecurityKeysSection({ status }: SecurityKeysSectionProps) {
  const keys = status?.security?.keys;
  if (!keys) return null;
  const targets = (['opencode', 'omp'] as const).filter(target => keys[target]);
  if (!targets.length) return null;

  return (
    <GlassCard className="p-5" data-testid="model-sync-security-section">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-300">
          <ShieldCheck size={17} />
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-100">{t('modelSync.security.title')}</h2>
          <p className="mt-0.5 text-xs text-slate-500">{t('modelSync.security.description')}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {targets.map(target => (
          <KeyRow key={target} target={target} info={keys[target]!} />
        ))}
      </div>
    </GlassCard>
  );
}
