import { Copy, Power, RefreshCw } from 'lucide-react';
import { Button, Input, Select, Toggle } from '../../ui';
import { cn } from '../../../lib/utils';
import type { ProxySettings, ProxyStatus } from '../../../types/generated';

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
}: AiProxyControlsSectionProps) {
  if (!visible) return null;

  return (
    <div className="mb-4 bg-[#111116]/80 border border-white/10 rounded-xl p-4 md:p-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Power
              size={16}
              className={proxyStatus?.running ? 'text-emerald-400' : 'text-slate-500'}
            />
            <h3 className="text-sm font-semibold text-white">IDE Proxy</h3>
            <span
              className={cn(
                'text-2xs px-2 py-0.5 rounded border',
                proxyStatus?.running
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                  : 'bg-white/5 border-white/10 text-slate-400'
              )}
            >
              {proxyStatus?.running ? 'Running' : 'Stopped'}
            </span>
            {proxySettings?.appMode && (
              <span className="text-2xs px-2 py-0.5 rounded border border-white/10 bg-white/5 text-slate-300">
                Mode: {proxySettings.appMode}
              </span>
            )}
          </div>

          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
            <div className="flex items-center justify-between gap-2 bg-black/30 border border-white/10 rounded-lg px-3 py-2">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Base URL</div>
                <div className="text-xs font-mono text-slate-200 truncate max-w-[240px]">
                  {baseUrl}
                </div>
              </div>
              <Button
                variant="secondary"
                size="xs"
                onClick={() => onCopy('Base URL', baseUrl)}
                leftIcon={<Copy size={14} />}
              >
                Copy
              </Button>
            </div>

            <div className="flex items-center justify-between gap-2 bg-black/30 border border-white/10 rounded-lg px-3 py-2">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  Client API key
                </div>
                <div className="text-xs font-mono text-slate-200 truncate max-w-[240px]">
                  {clientApiKey}
                </div>
              </div>
              <Button
                variant="secondary"
                size="xs"
                onClick={() => onCopy('Client API key', clientApiKey)}
                leftIcon={<Copy size={14} />}
              >
                Copy
              </Button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-2 items-end">
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
              label="Port"
              placeholder="8317"
            />

            <Select
              label="Mode"
              value={proxyDraft?.appMode ?? 'full'}
              onChange={e =>
                onSetProxyDraft(prev => (prev ? { ...prev, appMode: e.target.value } : prev))
              }
              options={[
                { value: 'full', label: 'Full mode' },
                { value: 'quota-only', label: 'Quota-only' },
              ]}
            />

            <Select
              label="Routing"
              value={proxyDraft?.routingStrategy ?? 'round-robin'}
              onChange={e =>
                onSetProxyDraft(prev =>
                  prev ? { ...prev, routingStrategy: e.target.value } : prev
                )
              }
              options={[
                { value: 'round-robin', label: 'Round robin' },
                { value: 'fill-first', label: 'Fill first' },
              ]}
            />

            <Input
              type="password"
              value={proxyDraft?.managementKey ?? ''}
              onChange={e =>
                onSetProxyDraft(prev => (prev ? { ...prev, managementKey: e.target.value } : prev))
              }
              label="Management key"
              placeholder="Management key"
            />

            <div className="flex items-center h-9 px-3 rounded-lg bg-black/30 border border-white/10">
              <Toggle
                label="Auto start"
                checked={proxyDraft?.autoStart ?? false}
                onChange={checked =>
                  onSetProxyDraft(prev => (prev ? { ...prev, autoStart: checked } : prev))
                }
              />
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="tabular-nums">
              Active port: <span className="text-slate-200">{proxyStatus?.port ?? '—'}</span>
            </span>
            <span className="text-slate-600">•</span>
            <span className="min-w-0">
              Key preview:{' '}
              <span className="font-mono text-slate-200 truncate max-w-[180px] inline-block align-middle">
                {proxyDraft?.managementKey ? maskKey(proxyDraft.managementKey) : '—'}
              </span>
            </span>
            {proxyDraft?.managementKey && (
              <Button
                variant="secondary"
                size="xs"
                onClick={() => onCopy('Management key', proxyDraft.managementKey, true)}
                leftIcon={<Copy size={14} />}
              >
                Copy
              </Button>
            )}
          </div>
          {proxyError && <div className="mt-2 text-xs text-red-400">Proxy error: {proxyError}</div>}
          {isProxyDraftDirty && !proxyError && (
            <div className="mt-2 text-xs text-amber-300">You have unsaved proxy changes</div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Button variant="secondary" size="sm" onClick={onOpenIdeWizard}>
            Configure IDE/CLI
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onResetDraft}
            disabled={!isProxyDraftDirty || proxySaving || proxyBusy}
          >
            Reset
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onSaveSettings}
            disabled={proxySaving || !proxyDraft || !isProxyDraftDirty || proxyBusy}
          >
            {proxySaving ? 'Saving...' : 'Save settings'}
          </Button>
          <Button
            variant={proxyStatus?.running ? 'danger' : 'primary'}
            size="sm"
            onClick={onStartStopProxy}
            disabled={proxyBusy || proxySaving}
            leftIcon={<Power size={16} />}
          >
            {proxyBusy ? 'Working...' : proxyStatus?.running ? 'Stop Proxy' : 'Start Proxy'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onRefreshProxyInfo}
            disabled={proxyBusy || proxySaving}
            leftIcon={<RefreshCw size={16} />}
          >
            Refresh
          </Button>
        </div>
      </div>
    </div>
  );
}
