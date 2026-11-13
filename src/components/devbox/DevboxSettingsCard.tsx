import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, Lock, RefreshCw, Save } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Tooltip } from '@/components/ui/Tooltip';
import { t } from '@/lib/i18n';
import {
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

const SECTION_ORDER = ['ingress', 'egress', 'runtime', 'managed'] as const;

const SECTION_TITLE_KEYS: Record<string, string> = {
  ingress: 'devboxPage.settingsSectionIngress',
  egress: 'devboxPage.settingsSectionEgress',
  runtime: 'devboxPage.settingsSectionRuntime',
  managed: 'devboxPage.settingsSectionManaged',
};

const FIELD_LABEL_KEYS: Record<string, string> = {
  INGRESS_MODE: 'devboxPage.settingsFieldIngressMode',
  RELAY_SUBDOMAIN: 'devboxPage.settingsFieldRelaySubdomain',
  TUNNEL_TOKEN: 'devboxPage.settingsFieldTunnelToken',
  PUBLIC_URL: 'devboxPage.settingsFieldPublicUrl',
  EGRESS_CONTAINER: 'devboxPage.settingsFieldEgressContainer',
  VLESS_SUB_URL: 'devboxPage.settingsFieldVlessSubUrl',
  JOB_TIMEOUT_SECONDS: 'devboxPage.settingsFieldJobTimeoutSeconds',
  OPENCODE_MCP_PERMISSIONS: 'devboxPage.settingsFieldOpencodeMcpPermissions',
  TUNNEL_TAIL: 'devboxPage.settingsFieldTunnelTail',
};

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
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>({});
  const [savedSuccess, setSavedSuccess] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setErrors([]);
    try {
      const res = await devboxEnvGet();
      const list = Array.isArray(res?.entries) ? res.entries : [];
      setEntries(list);
      const initialDraft: Record<string, string> = {};
      for (const entry of list) {
        initialDraft[entry.key] = entry.value;
      }
      setDraft(initialDraft);
      setSavedSuccess(false);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      setEntries([]);
      setDraft({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const patch = useMemo(() => {
    const diff: Record<string, string> = {};
    for (const entry of entries) {
      if (entry.readonly) continue;
      const current = draft[entry.key] ?? '';
      if (current !== entry.value) {
        diff[entry.key] = current;
      }
    }
    return diff;
  }, [entries, draft]);

  const hasChanges = Object.keys(patch).length > 0;

  const handleFieldChange = (key: string, value: string) => {
    setDraft(prev => ({ ...prev, [key]: value }));
    setSavedSuccess(false);
    if (errors.length > 0) setErrors([]);
  };

  const toggleSecretReveal = (key: string) => {
    setRevealedSecrets(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async () => {
    if (!hasChanges || saving || busy) return;
    setSaving(true);
    setErrors([]);
    try {
      const res = await devboxEnvSet(patch);
      if (!res.valid) {
        setErrors(Array.isArray(res.errors) && res.errors.length > 0 ? res.errors : ['Save failed']);
        setSavedSuccess(false);
        return;
      }
      setRestartKinds(Array.isArray(res.restart) ? res.restart : []);
      setSavedSuccess(true);
      setEntries(prev =>
        prev.map(entry => (entry.key in patch ? { ...entry, value: patch[entry.key] } : entry)),
      );
      onSaved?.();
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)]);
      setSavedSuccess(false);
    } finally {
      setSaving(false);
    }
  };

  const groupedEntries = useMemo(() => {
    const groups: Record<string, DevboxEnvEntry[]> = {};
    for (const entry of entries) {
      const sec = entry.section || 'runtime';
      if (!groups[sec]) groups[sec] = [];
      groups[sec].push(entry);
    }
    const result: { section: string; title: string; entries: DevboxEnvEntry[] }[] = [];
    for (const sec of SECTION_ORDER) {
      if (groups[sec] && groups[sec].length > 0) {
        const titleKey = SECTION_TITLE_KEYS[sec];
        result.push({
          section: sec,
          title: titleKey ? t(titleKey as never) : sec,
          entries: groups[sec],
        });
      }
    }
    for (const [sec, items] of Object.entries(groups)) {
      if (!(SECTION_ORDER as readonly string[]).includes(sec) && items.length > 0) {
        result.push({ section: sec, title: sec, entries: items });
      }
    }
    return result;
  }, [entries]);

  return (
    <DevboxSection
      title={t('devboxPage.settingsTitle')}
      testId="devbox-settings"
      error={loadError}
      onRetry={loadSettings}
      actions={
        <div className="flex items-center gap-2">
          {savedSuccess && (
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
        <div className="flex flex-col gap-4">
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

          {groupedEntries.map(group => (
            <div
              key={group.section}
              className="space-y-2"
              data-testid={`devbox-settings-group-${group.section}`}
            >
              <h4 className="text-2xs font-semibold uppercase tracking-wider text-slate-400">
                {group.title}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {group.entries.map(entry => {
                  const labelKey = FIELD_LABEL_KEYS[entry.key];
                  const labelText = labelKey ? t(labelKey as never) : entry.key;
                  const isRevealed = Boolean(revealedSecrets[entry.key]);
                  const isSecret = entry.secret;
                  const inputType = isSecret && !isRevealed ? 'password' : 'text';

                  const rightElement = entry.readonly ? (
                    <Tooltip content={t('devboxPage.settingsReadonlyHint')}>
                      <span
                        className="pr-2 text-slate-500 flex items-center"
                        data-testid={`devbox-settings-readonly-${entry.key}`}
                      >
                        <Lock size={13} />
                      </span>
                    </Tooltip>
                  ) : isSecret ? (
                    <button
                      type="button"
                      className="pr-2 text-slate-400 hover:text-white transition-colors"
                      data-testid={`devbox-settings-toggle-${entry.key}`}
                      aria-label={
                        isRevealed
                          ? t('devboxPage.settingsHideSecret')
                          : t('devboxPage.settingsShowSecret')
                      }
                      onClick={() => toggleSecretReveal(entry.key)}
                    >
                      {isRevealed ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  ) : undefined;

                  return (
                    <div key={entry.key} className="space-y-0.5">
                      <Input
                        label={labelText}
                        id={`devbox-settings-${entry.key}`}
                        data-testid={`devbox-settings-input-${entry.key}`}
                        type={inputType}
                        value={draft[entry.key] ?? ''}
                        disabled={entry.readonly || saving || busy}
                        onChange={e => handleFieldChange(entry.key, e.target.value)}
                        rightElement={rightElement}
                        containerClassName="space-y-1"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </DevboxSection>
  );
}
