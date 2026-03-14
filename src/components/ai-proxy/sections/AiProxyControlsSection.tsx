import { Copy, Power, RefreshCw } from 'lucide-react';

import { cn } from '../../../lib/utils';
import type { ProxySettings, ProxyStatus } from '../../../types/generated';
import { t } from '../../../lib/i18n';
import { Button, Input, Select, Toggle } from '@/components/ui';

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

  return (
    <div className="mb-4 bg-[#111116]/80 border border-white/10 rounded-xl p-4 md:p-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Power
              size={16}
              className={proxyStatus?.running ? 'text-emerald-400' : 'text-slate-500'}
            />
            <h3 className="text-sm font-semibold text-white">{t('aiHub.proxy.title')}</h3>
            <span
              className={cn(
                'text-2xs px-2 py-0.5 rounded border',
                proxyStatus?.running
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                  : 'bg-white/5 border-white/10 text-slate-400'
              )}
            >
              {proxyStatus?.running
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

          <div className="mt-2 text-xs text-slate-400">{t('aiHub.proxy.summary')}</div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
            <div className="flex items-center justify-between gap-2 bg-black/30 border border-white/10 rounded-lg px-3 py-2">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  {t('aiHub.proxy.baseUrl')}
                </div>
                <div className="text-xs font-mono text-slate-200 truncate max-w-[240px]">
                  {baseUrl}
                </div>
              </div>
              <Button
                variant="secondary"
                size="xs"
                onClick={() => onCopy(t('aiHub.proxy.baseUrl'), baseUrl)}
                leftIcon={<Copy size={14} />}
              >
                {t('aiHub.actions.copy')}
              </Button>
            </div>

            <div className="flex items-center justify-between gap-2 bg-black/30 border border-white/10 rounded-lg px-3 py-2">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  {t('aiHub.proxy.clientApiKey')}
                </div>
                <div className="text-xs font-mono text-slate-200 truncate max-w-[240px]">
                  {clientApiKey}
                </div>
              </div>
              <Button
                variant="secondary"
                size="xs"
                onClick={() => onCopy(t('aiHub.proxy.clientApiKey'), clientApiKey)}
                leftIcon={<Copy size={14} />}
              >
                {t('aiHub.actions.copy')}
              </Button>
            </div>
          </div>

          {showProxyActions && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-2 items-end">
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
              />

              <div className="flex items-center h-9 px-3 rounded-lg bg-black/30 border border-white/10">
                <Toggle
                  label={t('aiHub.proxy.autoStart')}
                  checked={proxyDraft?.autoStart ?? false}
                  onChange={checked =>
                    onSetProxyDraft(prev => (prev ? { ...prev, autoStart: checked } : prev))
                  }
                />
              </div>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
            <span className="tabular-nums">
              {t('aiHub.proxy.activePortLabel')}{' '}
              <span className="text-slate-200">
                {proxyStatus?.port ?? t('aiHub.table.emptyValue')}
              </span>
            </span>
            <span className="text-slate-600">•</span>
            <span className="min-w-0">
              {t('aiHub.proxy.keyPreviewLabel')}:{' '}
              <span className="font-mono text-slate-200 truncate max-w-[180px] inline-block align-middle">
                {proxyDraft?.managementKey
                  ? maskKey(proxyDraft.managementKey)
                  : t('aiHub.table.emptyValue')}
              </span>
            </span>
            <span className="text-slate-600">•</span>
            <span>
              Reachability:{' '}
              <span
                className={proxyStatus?.networkReachable ? 'text-emerald-300' : 'text-slate-400'}
              >
                {proxyStatus?.networkReachable ? 'reachable' : 'unreachable'}
              </span>
            </span>
            {proxyDraft?.managementKey && (
              <Button
                variant="secondary"
                size="xs"
                onClick={() =>
                  onCopy(t('aiHub.proxy.managementKey'), proxyDraft.managementKey, true)
                }
                leftIcon={<Copy size={14} />}
              >
                {t('aiHub.actions.copy')}
              </Button>
            )}
          </div>
          {proxyError && (
            <div className="mt-2 text-xs text-red-400">
              {t('aiHub.proxy.error')}: {proxyError}
            </div>
          )}
          {isProxyDraftDirty && !proxyError && (
            <div className="mt-2 text-xs text-amber-300">{t('aiHub.proxy.unsavedChanges')}</div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          {showIdeWizardAction && (
            <Button variant="secondary" size="sm" onClick={onOpenIdeWizard}>
              {t('aiHub.actions.configureIde')}
            </Button>
          )}
          {showProxyActions && (
            <>
              {showConfigActions && (
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

              {showRuntimeActions && (
                <>
                  <Button
                    variant={proxyStatus?.running ? 'danger' : 'primary'}
                    size="sm"
                    onClick={onStartStopProxy}
                    disabled={proxyBusy || proxySaving}
                    leftIcon={<Power size={16} />}
                  >
                    {proxyBusy
                      ? t('aiHub.actions.working')
                      : proxyStatus?.running
                        ? t('aiHub.actions.stopProxy')
                        : t('aiHub.actions.startProxy')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={onRefreshProxyInfo}
                    disabled={proxyBusy || proxySaving}
                    leftIcon={<RefreshCw size={16} />}
                  >
                    {t('aiHub.actions.refresh')}
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
