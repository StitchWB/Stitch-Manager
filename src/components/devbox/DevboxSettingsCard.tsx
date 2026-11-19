import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { t } from '@/lib/i18n';
import {
  devboxConnectionCheck,
  devboxEnvGet,
  devboxEnvSet,
  type DevboxEnvEntry,
} from '@/lib/backend/modules/devbox';
import { DevboxSection } from './DevboxSection';

export interface DevboxSettingsCardProps {
  busy?: boolean;
  onRestart?: (kind: 'ingress' | 'stack') => void;
  onSaved?: () => void;
}

const MODE_CLOUDFLARE = 'cloudflare';
const MODE_RELAY = 'relay';

const PROBE_KEYS = new Set(['RELAY_SUBDOMAIN', 'PUBLIC_URL', 'INGRESS_MODE']);

const ACCESS_PRESETS: Record<string, Record<string, string>> = {
  readonly: {
    edit: 'deny',
    write: 'deny',
    apply_patch: 'deny',
    bash: 'deny',
    webfetch: 'deny',
  },
  standard: {
    edit: 'ask',
    write: 'ask',
    apply_patch: 'ask',
    bash: 'ask',
    webfetch: 'allow',
  },
  full: {
    edit: 'allow',
    write: 'allow',
    apply_patch: 'allow',
    bash: 'allow',
    webfetch: 'allow',
  },
};

const ACCESS_LABEL_KEYS: Record<string, string> = {
  readonly: 'devboxPage.settingsAccessReadonly',
  standard: 'devboxPage.settingsAccessStandard',
  full: 'devboxPage.settingsAccessFull',
};

function normalizePermissions(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const keys = Object.keys(ACCESS_PRESETS.full).sort();
    const picked: Record<string, string> = {};
    for (const key of keys) picked[key] = String(parsed[key] ?? '');
    return JSON.stringify(picked);
  } catch {
    return '';
  }
}

function detectAccessPreset(raw: string): string {
  const normalized = normalizePermissions(raw);
  if (!normalized) return 'custom';
  for (const [name, preset] of Object.entries(ACCESS_PRESETS)) {
    if (normalizePermissions(JSON.stringify(preset)) === normalized) return name;
  }
  return 'custom';
}

type CheckState =
  | { kind: 'idle' }
  | { kind: 'checking'; mode: string }
  | { kind: 'ok'; mode: string; tools: number; latency: number; url?: string }
  | { kind: 'fail'; mode: string; error: string; url?: string };

export function DevboxSettingsCard({
  busy = false,
  onRestart,
  onSaved,
}: DevboxSettingsCardProps) {
  const [entries, setEntries] = useState<DevboxEnvEntry[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [restartKinds, setRestartKinds] = useState<string[]>([]);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [check, setCheck] = useState<CheckState>({ kind: 'idle' });

  const mode = (draft.INGRESS_MODE ?? '') === MODE_RELAY ? MODE_RELAY : MODE_CLOUDFLARE;

  const access = detectAccessPreset(draft.OPENCODE_MCP_PERMISSIONS ?? '');

  const runCheck = useCallback(async (checkMode: string) => {
    setCheck({ kind: 'checking', mode: checkMode });
    try {
      const res = await devboxConnectionCheck();
      if (res?.ok) {
        setCheck({
          kind: 'ok',
          mode: checkMode,
          tools: Number(res.tools ?? 0),
          latency: Number(res.latency_ms ?? 0),
          url: res.url,
        });
      } else {
        setCheck({
          kind: 'fail',
          mode: checkMode,
          error: res?.error || t('devboxPage.settingsStatusFail'),
          url: res?.url,
        });
      }
    } catch (err) {
      setCheck({
        kind: 'fail',
        mode: checkMode,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setErrors([]);
    try {
      const res = await devboxEnvGet();
      const list = Array.isArray(res?.entries) ? res.entries : [];
      setEntries(list);
      const initial: Record<string, string> = {};
      for (const entry of list) initial[entry.key] = entry.value;
      setDraft(initial);
      setSaved(false);
      void runCheck(initial.INGRESS_MODE === MODE_RELAY ? MODE_RELAY : MODE_CLOUDFLARE);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      setEntries([]);
      setDraft({});
    } finally {
      setLoading(false);
    }
  }, [runCheck]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const patch = useMemo(() => {
    const diff: Record<string, string> = {};
    for (const entry of entries) {
      if (entry.readonly) continue;
      if (entry.key === 'RELAY_SUBDOMAIN' && mode !== MODE_RELAY) continue;
      if (entry.key === 'PUBLIC_URL' && mode !== MODE_CLOUDFLARE) continue;
      const current = draft[entry.key] ?? '';
      if (current !== entry.value) diff[entry.key] = current;
    }
    return diff;
  }, [entries, draft, mode]);

  const hasChanges = Object.keys(patch).length > 0;

  const setField = (key: string, value: string) => {
    setDraft(prev => ({ ...prev, [key]: value }));
    setSaved(false);
    if (errors.length > 0) setErrors([]);
    if (PROBE_KEYS.has(key)) setCheck({ kind: 'idle' });
  };

  const selectMode = (next: string) => {
    setField('INGRESS_MODE', next);
  };

  const handleSave = async () => {
    if (!hasChanges || saving || busy) return;
    if (mode === MODE_RELAY && !(draft.RELAY_SUBDOMAIN ?? '').trim()) {
      setErrors([t('devboxPage.settingsRelaySubdomainRequired')]);
      setSaved(false);
      return;
    }
    setSaving(true);
    setErrors([]);
    try {
      const res = await devboxEnvSet(patch);
      if (!res.valid) {
        setErrors(
          Array.isArray(res.errors) && res.errors.length > 0
            ? res.errors
            : [t('devboxPage.settingsSaveFailed')],
        );
        setSaved(false);
        return;
      }
      setRestartKinds(Array.isArray(res.restart) ? res.restart : []);
      setSaved(true);
      setEntries(prev =>
        prev.map(entry => (entry.key in patch ? { ...entry, value: patch[entry.key] } : entry)),
      );
      onSaved?.();
      void runCheck(mode);
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)]);
      setSaved(false);
    } finally {
      setSaving(false);
    }
  };

  const secretToggle = (key: string) => (
    <button
      type="button"
      className="pr-2 text-slate-400 hover:text-white transition-colors"
      data-testid={`devbox-settings-toggle-${key}`}
      aria-label={revealed[key] ? t('devboxPage.settingsHideSecret') : t('devboxPage.settingsShowSecret')}
      onClick={() => setRevealed(prev => ({ ...prev, [key]: !prev[key] }))}
    >
      {revealed[key] ? <EyeOff size={13} /> : <Eye size={13} />}
    </button>
  );

  const activeCheck: CheckState =
    check.kind !== 'idle' && check.mode === mode ? check : { kind: 'idle' };

  const statusLine: { dot: string; url?: string; message: string } = (() => {
    if (activeCheck.kind === 'checking') {
      return {
        dot: 'bg-slate-400 animate-pulse',
        message: t('devboxPage.settingsChecking'),
      };
    }
    if (activeCheck.kind === 'ok') {
      return {
        dot: 'bg-emerald-400',
        url: activeCheck.url,
        message: t('devboxPage.settingsStatusOk', {
          tools: activeCheck.tools,
          ms: activeCheck.latency,
        }),
      };
    }
    if (activeCheck.kind === 'fail') {
      return { dot: 'bg-red-400', url: activeCheck.url, message: activeCheck.error };
    }
    return { dot: 'bg-slate-500', message: t('devboxPage.settingsStatusIdle') };
  })();

  const egressValue = draft.EGRESS_CONTAINER ?? 'rdm-egress';
  const advancedSummary = `${egressValue} · tunnel ${draft.TUNNEL_TOKEN ? '✓' : '—'} · VLESS ${draft.VLESS_SUB_URL ? '✓' : '—'}`;

  return (
    <DevboxSection
      title={t('devboxPage.settingsTitle')}
      testId="devbox-settings"
      error={loadError}
      onRetry={loadSettings}
      actions={
        <div className="flex items-center gap-2">
          {saved && (
            <span
              className="text-2xs text-emerald-400 font-medium"
              data-testid="devbox-settings-saved-badge"
            >
              {t('devboxPage.settingsSaved')}
            </span>
          )}
          <Button
            size="xs"
            variant="primary"
            onClick={handleSave}
            disabled={!hasChanges || saving || busy}
            isLoading={saving}
            data-testid="devbox-settings-save"
          >
            <Save size={13} className="mr-1" />
            {saving ? t('devboxPage.settingsSaving') : t('devboxPage.settingsSave')}
          </Button>
        </div>
      }
    >
      {loading ? (
        <div
          className="flex items-center justify-center p-6 text-2xs text-slate-400"
          data-testid="devbox-settings-loading"
        >
          {t('devboxPage.settingsLoading')}
        </div>
      ) : entries.length === 0 ? (
        <div
          className="flex flex-col items-center gap-2 p-4 text-center"
          data-testid="devbox-settings-empty"
        >
          <p className="text-2xs text-slate-400">{t('devboxPage.settingsEmpty')}</p>
          <Button size="xs" variant="secondary" onClick={() => void loadSettings()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : (
        <div className="max-w-2xl space-y-4" data-testid="devbox-settings-body">
          {restartKinds.length > 0 && (
            <div
              className="flex flex-wrap items-center justify-start gap-2 rounded border border-amber-500/30 bg-amber-500/10 p-2.5 text-2xs text-amber-200"
              data-testid="devbox-settings-restart-banner"
            >
              <span>{t('devboxPage.settingsRestartHint')}</span>
              {restartKinds.includes('ingress') && (
                <Button
                  size="xs"
                  variant="secondary"
                  disabled={busy}
                  data-testid="devbox-settings-restart-ingress"
                  onClick={() => onRestart?.('ingress')}
                >
                  <RefreshCw size={12} className="mr-1" />
                  {t('devboxPage.settingsRestartIngress')}
                </Button>
              )}
              {restartKinds.includes('stack') && (
                <Button
                  size="xs"
                  variant="secondary"
                  disabled={busy}
                  data-testid="devbox-settings-restart-stack"
                  onClick={() => onRestart?.('stack')}
                >
                  <RefreshCw size={12} className="mr-1" />
                  {t('devboxPage.settingsRestartStack')}
                </Button>
              )}
            </div>
          )}

          {errors.length > 0 && (
            <div
              className="rounded border border-red-500/30 bg-red-500/10 p-2.5 text-2xs text-red-200"
              data-testid="devbox-settings-errors"
            >
              <div className="font-semibold text-red-300 mb-1">
                {t('devboxPage.settingsErrorsTitle')}
              </div>
              <ul className="list-disc pl-4 space-y-0.5">
                {errors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-2" data-testid="devbox-settings-ingress">
            <div className="space-y-2">
              <div className="space-y-1">
                <span className="block text-2xs font-semibold uppercase tracking-wider text-slate-400">
                  {t('devboxPage.settingsIngressTitle')}
                </span>
                <SegmentedControl
                  size="sm"
                  stretch={false}
                  className="w-fit"
                  options={[
                    { label: t('devboxPage.settingsModeCloudflare'), value: MODE_CLOUDFLARE },
                    { label: t('devboxPage.settingsModeRelay'), value: MODE_RELAY },
                  ]}
                  value={mode}
                  onChange={selectMode}
                  disabled={saving || busy}
                />
              </div>
              <p className="text-2xs text-slate-400">
                {mode === MODE_RELAY
                  ? t('devboxPage.settingsModeRelayHint')
                  : t('devboxPage.settingsModeCloudflareHint')}
              </p>
            </div>
            {mode === MODE_RELAY ? (
              <div className="space-y-2">
                <Input
                  label={t('devboxPage.settingsRelaySubdomainLabel')}
                  id="devbox-settings-RELAY_SUBDOMAIN"
                  aria-describedby="devbox-settings-RELAY_SUBDOMAIN-hint"
                  data-testid="devbox-settings-input-RELAY_SUBDOMAIN"
                  value={draft.RELAY_SUBDOMAIN ?? ''}
                  placeholder="ide-account-manager"
                  disabled={saving || busy}
                  onChange={e => setField('RELAY_SUBDOMAIN', e.target.value)}
                  containerClassName="space-y-1"
                />
                <p id="devbox-settings-RELAY_SUBDOMAIN-hint" className="px-0.5 text-xs text-slate-400">
                  {t('devboxPage.settingsRelaySubdomainHint')}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Input
                  label={t('devboxPage.settingsPublicUrlLabel')}
                  id="devbox-settings-PUBLIC_URL"
                  aria-describedby="devbox-settings-PUBLIC_URL-hint"
                  data-testid="devbox-settings-input-PUBLIC_URL"
                  value={draft.PUBLIC_URL ?? ''}
                  placeholder="https://devbox.example.com"
                  disabled={saving || busy}
                  onChange={e => setField('PUBLIC_URL', e.target.value)}
                  containerClassName="space-y-1"
                />
                <p id="devbox-settings-PUBLIC_URL-hint" className="px-0.5 text-xs text-slate-400">
                  {t('devboxPage.settingsPublicUrlHint')}
                </p>
              </div>
            )}
            <div
              className="flex flex-wrap items-center gap-2"
              data-testid="devbox-settings-status"
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${statusLine.dot}`} />
              {statusLine.url && (
                <span className="min-w-0 truncate text-2xs text-slate-300">{statusLine.url}</span>
              )}
              <span className="min-w-0 truncate text-2xs text-slate-400">{statusLine.message}</span>
              <Button
                size="xs"
                variant="ghost"
                className="shrink-0"
                onClick={() => void runCheck(mode)}
                disabled={activeCheck.kind === 'checking'}
                data-testid="devbox-settings-check"
              >
                <ShieldCheck size={12} className="mr-1" />
                {t('devboxPage.settingsCheck')}
              </Button>
            </div>
          </div>

          <div className="space-y-2" data-testid="devbox-settings-access">
            <h4 className="text-2xs font-semibold uppercase tracking-wider text-slate-400">
              {t('devboxPage.settingsAccessTitle')}
            </h4>
            <div className="flex flex-wrap items-center gap-2" data-testid="devbox-settings-access-hint">
              <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-2xs text-slate-200">
                {access === 'custom'
                  ? t('devboxPage.settingsAccessCustom')
                  : t(ACCESS_LABEL_KEYS[access] as never)}
              </span>
              <span className="text-2xs text-slate-400">{t('devboxPage.settingsAccessHint')}</span>
            </div>
            <div className="w-32 space-y-2">
              <Input
                label={t('devboxPage.settingsTimeoutLabel')}
                id="devbox-settings-JOB_TIMEOUT_SECONDS"
                aria-describedby="devbox-settings-JOB_TIMEOUT_SECONDS-hint"
                data-testid="devbox-settings-input-JOB_TIMEOUT_SECONDS"
                type="number"
                min={60}
                max={3600}
                value={draft.JOB_TIMEOUT_SECONDS ?? ''}
                disabled={saving || busy}
                onChange={e => setField('JOB_TIMEOUT_SECONDS', e.target.value)}
                containerClassName="space-y-1"
              />
              <p id="devbox-settings-JOB_TIMEOUT_SECONDS-hint" className="px-0.5 text-xs text-slate-400">
                {t('devboxPage.settingsTimeoutHint')}
              </p>
            </div>
          </div>

          <div className="border-t border-white/5 pt-3" data-testid="devbox-settings-advanced">
            <button
              type="button"
              className="flex w-full items-center gap-1 text-2xs font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-200 transition-colors"
              onClick={() => setAdvancedOpen(open => !open)}
              aria-expanded={advancedOpen}
              data-testid="devbox-settings-advanced-toggle"
            >
              {advancedOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span>{t('devboxPage.settingsAdvanced')}</span>
              <span className="ml-auto truncate text-2xs font-normal normal-case tracking-normal text-slate-500">
                {advancedSummary}
              </span>
            </button>
            {advancedOpen && (
              <div className="mt-3 space-y-3">
                <div className="space-y-2">
                  <Select
                    label={t('devboxPage.settingsEgressLabel')}
                    id="devbox-settings-EGRESS_CONTAINER"
                    aria-describedby="devbox-settings-EGRESS_CONTAINER-hint"
                    data-testid="devbox-settings-select-EGRESS_CONTAINER"
                    value={draft.EGRESS_CONTAINER ?? 'rdm-egress'}
                    options={[
                      { value: 'rdm-egress', label: 'rdm-egress' },
                      { value: 'rdm-vpn', label: 'rdm-vpn' },
                    ]}
                    onValueChange={value => setField('EGRESS_CONTAINER', value)}
                    disabled={saving || busy}
                    containerClassName="space-y-1"
                  />
                  <p id="devbox-settings-EGRESS_CONTAINER-hint" className="px-0.5 text-xs text-slate-400">
                    {t('devboxPage.settingsEgressHint')}
                  </p>
                </div>
                <Input
                  label={t('devboxPage.settingsVlessLabel')}
                  id="devbox-settings-VLESS_SUB_URL"
                  data-testid="devbox-settings-input-VLESS_SUB_URL"
                  type={revealed.VLESS_SUB_URL ? 'text' : 'password'}
                  value={draft.VLESS_SUB_URL ?? ''}
                  disabled={saving || busy}
                  onChange={e => setField('VLESS_SUB_URL', e.target.value)}
                  rightElement={secretToggle('VLESS_SUB_URL')}
                  containerClassName="space-y-1"
                />
                {mode === MODE_CLOUDFLARE && (
                  <Input
                    label={t('devboxPage.settingsTunnelTokenLabel')}
                    id="devbox-settings-TUNNEL_TOKEN"
                    data-testid="devbox-settings-input-TUNNEL_TOKEN"
                    type={revealed.TUNNEL_TOKEN ? 'text' : 'password'}
                    value={draft.TUNNEL_TOKEN ?? ''}
                    disabled={saving || busy}
                    onChange={e => setField('TUNNEL_TOKEN', e.target.value)}
                    rightElement={secretToggle('TUNNEL_TOKEN')}
                    containerClassName="space-y-1"
                  />
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </DevboxSection>
  );
}