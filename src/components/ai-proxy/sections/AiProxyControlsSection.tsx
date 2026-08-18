import { Copy, Power, RefreshCw } from 'lucide-react';

import { cn } from '../../../lib/utils';
import type { ProxySettings, ProxyStatus } from '../../../types/generated';
import { t } from '@/lib/i18n';
import {
  Button,
  GlassCard,
  IconButton,
  Input,
  Select,
  Toggle,
  Tooltip,
} from '@/components/ui';

interface AiProxyControlsSectionProps {
  visible: boolean;
  proxyStatus: ProxyStatus | null;
  proxySettings: ProxySettings | null;
  proxyDraft: ProxySettings | null;
  proxyBusy: boolean;
  proxySaving: boolean;
  proxyError: string | null;
  baseUrl: string;
  clientApiKey: string;
  isProxyDraftDirty: boolean;
  maskKey: (value: string) => string;
  onSetProxyDraft: (updater: (prev: ProxySettings | null) => ProxySettings | null) => void;
  onCopy: (label: string, value: string, requireConfirm?: boolean) => void;
  onOpenIdeWizard: () => void;
  onResetDraft: () => void;
  onSaveSettings: () => void;
  onStartStopProxy: () => void;
  onRefreshProxyInfo: () => void;
  showIdeWizardAction?: boolean;
  showProxyActions?: boolean;
  showConfigActions?: boolean;
  showRuntimeActions?: boolean;
}

function CopyField({
  label,
  value,
  onCopy,
  copyLabel,
  requireConfirm,
  preview,
}: {
  label: string;
  value: string;
  onCopy: (label: string, value: string, requireConfirm?: boolean) => void;
  copyLabel: string;
  requireConfirm?: boolean;
  preview?: string;
}) {
  const display = preview ?? value;
  return (
    <div className="flex items-center justify-between gap-2 bg-black/30 border border-white/10 rounded-lg px-3 py-2 min-w-0">
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
        <div className="text-xs font-mono text-slate-200 truncate">{display}</div>
      </div>
      <Tooltip content={copyLabel}>
        <IconButton
          size="sm"
          variant="ghost"
          onClick={() => onCopy(label, value, requireConfirm)}
          aria-label={copyLabel}
        >
          <Copy size={14} />
        </IconButton>
      </Tooltip>
    </div>
  );
}

export function AiProxyControlsSection({
  visible,
  proxyStatus,
  proxySettings,
  proxyDraft,
  proxyBusy,
  proxySaving,
  proxyError,
  baseUrl,
  clientApiKey,
  isProxyDraftDirty,
  maskKey,
  onSetProxyDraft,
  onCopy,
  onOpenIdeWizard,
  onResetDraft,
  onSaveSettings,
  onStartStopProxy,
  onRefreshProxyInfo,
  showIdeWizardAction = true,
  showProxyActions = true,
  showConfigActions = true,
  showRuntimeActions = true,
}: AiProxyControlsSectionProps) {
  if (!visible) return null;
  const isExternallyRunning = Boolean(proxyStatus?.running && !proxyStatus?.managedByApp);
  const running = Boolean(proxyStatus?.running);

  return (
    <GlassCard className="mb-4 p-4 md:p-5">
      <div className="flex flex-col gap-4">
        {/* Header: title + status pill + mode pill */}
        <div className="flex items-center gap-2 flex-wrap">
          <Power size={16} className={running ? 'text-emerald-400' : 'text-slate-500'} />
          <h3 className="text-sm font-semibold text-white">{t('aiHub.proxy.title')}</h3>
          <span
            className={cn(
              'text-2xs px-2 py-0.5 rounded border',
              running
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                : 'bg-white/5 border-white/10 text-slate-400'
            )}
          >
            {running
              ? isExternallyRunning
                ? `${t('aiHub.proxy.running')} (external)`
                : t('aiHub.proxy.running')
              : t('aiHub.proxy.stopped')}
          </span>
          {proxySettings?.appMode && (
            <span className="text-2xs px-2 py-0.5 rounded border border-white/10 bg-white/5 text-slate-300">
              {t('aiHub.proxy.modeLabel')}: {proxySettings.appMode}
            </span>
          )}
        </div>

        {/* Read-only copy fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <CopyField
            label={t('aiHub.proxy.baseUrl')}
            value={baseUrl}
            onCopy={onCopy}
            copyLabel={t('aiHub.actions.copy')}
          />
          <CopyField
            label={t('aiHub.proxy.clientApiKey')}
            value={clientApiKey}
            onCopy={onCopy}
            copyLabel={t('aiHub.actions.copy')}
          />
        </div>

        {/* Editable proxy settings */}
        {showProxyActions && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              type="number"
              min={1024}
              max={65535}
              step={1}
              inputMode="numeric"
              value={proxyDraft?.proxyPort ?? ''}
              onChange={e => {
                const raw = e.target.value;
                if (!raw.trim()) return;
                const nextPort = Number(raw);
                if (!Number.isInteger(nextPort)) return;
                onSetProxyDraft(prev => (prev ? { ...prev, proxyPort: nextPort } : prev));
              }}
              label={t('aiHub.proxy.portLabel')}
              placeholder={t('aiHub.proxy.portPlaceholder')}
            />

            <Select
              label={t('aiHub.proxy.modeLabel')}
              value={proxyDraft?.appMode ?? 'full'}
              onValueChange={value =>
                onSetProxyDraft(prev => (prev ? { ...prev, appMode: value } : prev))
              }
              options={[
                { value: 'full', label: t('aiHub.proxy.modeFull') },
                { value: 'quota-only', label: t('aiHub.proxy.modeQuota') },
              ]}
            />

            <Select
              label={t('aiHub.proxy.routingLabel')}
              value={proxyDraft?.routingStrategy ?? 'round-robin'}
              onValueChange={value =>
                onSetProxyDraft(prev => (prev ? { ...prev, routingStrategy: value } : prev))
              }
              options={[
                { value: 'round-robin', label: t('aiHub.proxy.routingRoundRobin') },
                { value: 'fill-first', label: t('aiHub.proxy.routingFillFirst') },
              ]}
            />

            <Input
              type="password"
              value={proxyDraft?.managementKey ?? ''}
              onChange={e =>
                onSetProxyDraft(prev =>
                  prev ? { ...prev, managementKey: e.target.value } : prev
                )
              }
              label={t('aiHub.proxy.managementKey')}
              placeholder={t('aiHub.proxy.managementKeyPlaceholder')}
              hint={
                proxyDraft?.managementKey
                  ? `${t('aiHub.proxy.keyPreviewLabel')}: ${maskKey(proxyDraft.managementKey)}`
                  : undefined
              }
            />
          </div>
        )}

        {showProxyActions && (
          <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/[0.06]">
            <Toggle
              label={t('aiHub.proxy.autoStart')}
              checked={proxyDraft?.autoStart ?? false}
              onChange={checked =>
                onSetProxyDraft(prev => (prev ? { ...prev, autoStart: checked } : prev))
              }
            />
          </div>
        )}

        {/* Runtime info row */}
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
          <span className="tabular-nums">
            {t('aiHub.proxy.activePortLabel')}{' '}
            <span className="text-slate-200">
              {proxyStatus?.port ?? t('aiHub.table.emptyValue')}
            </span>
          </span>
          {running && (
            <>
              <span className="text-slate-600">·</span>
              <span>
                {t('aiHub.proxy.reachabilityLabel')}:{' '}
                <span
                  className={
                    proxyStatus?.networkReachable ? 'text-emerald-300' : 'text-amber-300'
                  }
                >
                  {proxyStatus?.networkReachable
                    ? t('aiHub.proxy.reachable')
                    : t('aiHub.proxy.unreachable')}
                </span>
              </span>
            </>
          )}
        </div>

        {/* Inline error / dirty state */}
        {proxyError && (
          <div className="text-xs text-red-400">
            {t('aiHub.proxy.error')}: {proxyError}
          </div>
        )}
        {isProxyDraftDirty && !proxyError && (
          <div className="text-xs text-amber-300">{t('aiHub.proxy.unsavedChanges')}</div>
        )}

        {/* Actions cluster — under the form, right-aligned */}
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-white/[0.06]">
          {showIdeWizardAction && (
            <Button variant="secondary" size="sm" onClick={onOpenIdeWizard}>
              {t('aiHub.actions.configureIde')}
            </Button>
          )}

          {showProxyActions && showConfigActions && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={onResetDraft}
                disabled={!isProxyDraftDirty || proxySaving || proxyBusy}
              >
                {t('aiHub.actions.reset')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={onSaveSettings}
                disabled={proxySaving || !proxyDraft || !isProxyDraftDirty || proxyBusy}
              >
                {proxySaving ? t('aiHub.actions.saving') : t('aiHub.actions.saveSettings')}
              </Button>
            </>
          )}

          {showProxyActions && showRuntimeActions && (
            <>
              <Button
                variant={running ? 'danger' : 'primary'}
                size="sm"
                onClick={onStartStopProxy}
                disabled={proxyBusy || proxySaving}
                leftIcon={<Power size={14} />}
              >
                {proxyBusy
                  ? t('aiHub.actions.working')
                  : running
                    ? t('aiHub.actions.stopProxy')
                    : t('aiHub.actions.startProxy')}
              </Button>
              <Tooltip content={t('aiHub.actions.refresh')}>
                <IconButton
                  size="sm"
                  variant="ghost"
                  onClick={onRefreshProxyInfo}
                  disabled={proxyBusy || proxySaving}
                  aria-label={t('aiHub.actions.refresh')}
                >
                  <RefreshCw size={14} className={cn(proxyBusy && 'animate-spin')} />
                </IconButton>
              </Tooltip>
            </>
          )}
        </div>
      </div>
    </GlassCard>
  );
}
