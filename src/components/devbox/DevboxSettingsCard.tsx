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
  | { kind: 'checking' }
  | { kind: 'ok'; tools: number; latency: number; url?: string }
  | { kind: 'fail'; error: string; url?: string };

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
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      setEntries([]);
      setDraft({});
    } finally {
      setLoading(false);
    }
  }, []);

  const runCheck = useCallback(async () => {
    setCheck({ kind: 'checking' });
    try {
      const res = await devboxConnectionCheck();
      if (res?.ok) {
        setCheck({
          kind: 'ok',
          tools: Number(res.tools ?? 0),
          latency: Number(res.latency_ms ?? 0),
          url: res.url,
        });
      } else {
        setCheck({
          kind: 'fail',
          error: res?.error || t('devboxPage.settingsStatusFail'),
          url: res?.url,
        });
      }
    } catch (err) {
      setCheck({
        kind: 'fail',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  useEffect(() => {
    void loadSettings();
    void runCheck();
  }, [loadSettings, runCheck]);

  const patch = useMemo(() => {
    const diff: Record<string, string> = {};
    for (const entry of entries) {
      if (entry.readonly) continue;
      const current = draft[entry.key] ?? '';
      if (current !== entry.value) diff[entry.key] = current;
    }
    return diff;
  }, [entries, draft]);

  const hasChanges = Object.keys(patch).length > 0;
  const mode = (draft.INGRESS_MODE ?? '') === MODE_RELAY ? MODE_RELAY : MODE_CLOUDFLARE;
  const access = detectAccessPreset(draft.OPENCODE_MCP_PERMISSIONS ?? '');

  const setField = (key: string, value: string) => {
    setDraft(prev => ({ ...prev, [key]: value }));
    setSaved(false);
    if (errors.length > 0) setErrors([]);
  };

  const selectMode = (next: string) => {
    setField('INGRESS_MODE', next);
  };

  const handleSave = async () => {
    if (!hasChanges || saving || busy) return;
    setSaving(true);
    setErrors([]);
    try {
      const res = await devboxEnvSet(patch);
      if (!res.valid) {
        setErrors(Array.isArray(res.errors) && res.errors.length > 0 ? res.errors : ['Save failed']);
        setSaved(false);
        return;
      }
      setRestartKinds(Array.isArray(res.restart) ? res.restart : []);
      setSaved(true);
      setEntries(prev =>
        prev.map(entry => (entry.key in patch ? { ...entry, value: patch[entry.key] } : entry)),
      );
      onSaved?.();
      void runCheck();
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

  const statusLine = (() => {
    const fallback =
      mode === MODE_RELAY
        ? draft.RELAY_SUBDOMAIN
          ? `https://${draft.RELAY_SUBDOMAIN}.loca.lt`
          : ''
        : draft.PUBLIC_URL ?? '';
    const url = (check.kind === 'ok' || check.kind === 'fail' ? check.url : undefined) || fallback;
    if (check.kind === 'checking') {
      return { dot: 'bg-slate-400 animate-pulse', text: `${url || '—'} · ${t('devboxPage.settingsChecking')}` };
    }
    if (check.kind === 'ok') {
      return {
        dot: 'bg-emerald-400',
        text: `${url || '—'} · ${t('devboxPage.settingsStatusOk', {
          tools: check.tools,
          ms: check.latency,
        })}`,
      };
    }
    if (check.kind === 'fail') {
      return { dot: 'bg-red-400', text: `${url || '—'} · ${check.error}` };
    }
    return { dot: 'bg-slate-500', text: `${url || '—'} · ${t('devboxPage.settingsStatusIdle')}` };
  })();

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
          className="p-4 text-center text-2xs text-slate-400"
          data-testid="devbox-settings-empty"
        >
          {t('devboxPage.settingsEmpty')}
        </div>
      ) : (
        <div className="flex flex-col gap-4" data-testid="devbox-settings-body">
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

          {restartKinds.length > 0 && (
            <div
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-500/30 bg-amber-500/10 p-2.5 text-2xs text-amber-200"
              data-testid="devbox-settings-restart-banner"
            >
              <span>{t('devboxPage.settingsRestartHint')}</span>
              <div className="flex items-center gap-2">
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
            </div>
          )}

          <div className="space-y-2.5" data-testid="devbox-settings-ingress">
            <h4 className="text-2xs font-semibold uppercase tracking-wider text-slate-400">
              {t('devboxPage.settingsIngressTitle')}
            </h4>
            <SegmentedControl
              size="sm"
              options={[
                { label: t('devboxPage.settingsModeCloudflare'), value: MODE_CLOUDFLARE },
                { label: t('devboxPage.settingsModeRelay'), value: MODE_RELAY },
              ]}
              value={mode}
              onChange={selectMode}
              disabled={saving || busy}
            />
            <p className="text-2xs text-slate-400">
              {mode === MODE_RELAY
                ? t('devboxPage.settingsModeRelayHint')
                : t('devboxPage.settingsModeCloudflareHint')}
            </p>
            {mode === MODE_RELAY ? (
              <Input
                label={t('devboxPage.settingsRelaySubdomainLabel')}
                hint={t('devboxPage.settingsRelaySubdomainHint')}
                id="devbox-settings-RELAY_SUBDOMAIN"
                data-testid="devbox-settings-input-RELAY_SUBDOMAIN"
                value={draft.RELAY_SUBDOMAIN ?? ''}
                placeholder="ide-account-manager"
                disabled={saving || busy}
                onChange={e => setField('RELAY_SUBDOMAIN', e.target.value)}
                containerClassName="space-y-1"
              />
            ) : (
              <Input
                label={t('devboxPage.settingsPublicUrlLabel')}
                hint={t('devboxPage.settingsPublicUrlHint')}
                id="devbox-settings-PUBLIC_URL"
                data-testid="devbox-settings-input-PUBLIC_URL"
                value={draft.PUBLIC_URL ?? ''}
                placeholder="https://devbox.example.com"
                disabled={saving || busy}
                onChange={e => setField('PUBLIC_URL', e.target.value)}
                containerClassName="space-y-1"
              />
            )}
            <div className="flex flex-wrap items-center gap-2" data-testid="devbox-settings-status">
              <span className={`h-2 w-2 rounded-full ${statusLine.dot}`} />
              <span className="text-2xs text-slate-300">{statusLine.text}</span>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => void runCheck()}
                disabled={check.kind === 'checking'}
                data-testid="devbox-settings-check"
              >
                <ShieldCheck size={12} className="mr-1" />
                {t('devboxPage.settingsCheck')}
              </Button>
            </div>
          </div>

          <div className="space-y-2.5" data-testid="devbox-settings-access">
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
            <Input
              label={t('devboxPage.settingsTimeoutLabel')}
              hint={t('devboxPage.settingsTimeoutHint')}
              id="devbox-settings-JOB_TIMEOUT_SECONDS"
              data-testid="devbox-settings-input-JOB_TIMEOUT_SECONDS"
              type="number"
              min={60}
              max={3600}
              value={draft.JOB_TIMEOUT_SECONDS ?? ''}
              disabled={saving || busy}
              onChange={e => setField('JOB_TIMEOUT_SECONDS', e.target.value)}
              containerClassName="space-y-1"
            />
          </div>

          <div className="border-t border-white/5 pt-2" data-testid="devbox-settings-advanced">
            <button
              type="button"
              className="flex w-full items-center gap-1 text-2xs font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-200 transition-colors"
              onClick={() => setAdvancedOpen(open => !open)}
              aria-expanded={advancedOpen}
              data-testid="devbox-settings-advanced-toggle"
            >
              {advancedOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {t('devboxPage.settingsAdvanced')}
            </button>
            {advancedOpen && (
              <div className="mt-2.5 grid grid-cols-1 md:grid-cols-2 gap-3">
                <Select
                  label={t('devboxPage.settingsEgressLabel')}
                  hint={t('devboxPage.settingsEgressHint')}
                  id="devbox-settings-EGRESS_CONTAINER"
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