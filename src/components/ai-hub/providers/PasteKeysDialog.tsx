import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardPaste, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button, Checkbox, Input, Modal, Select, Textarea } from '@/components/ui';
import { useAiGatewayStore } from '@/stores/aiGateway';
import { bulkTestOpenCodeApi } from '@/lib/backend/modules/opencodeConfig';
import { looksLikeApiKey } from '@/lib/utils/parseProviderText';
import { parsePastedProviders, extractKeyTokens } from '@/lib/utils/parsePastedProviders';
import { computeCredentialFingerprint } from '@/lib/utils/credentialFingerprint';
import type { ParsedProviderEntry } from '@/lib/utils/parseProviderText';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import type { ProviderEndpoint } from '@/lib/backend/modules/aiGateway';

type KeyStatus = 'pending' | 'testing' | 'ok' | 'rate_limited' | 'invalid' | 'error';

interface KeyResult {
  status: KeyStatus;
  error?: string;
}

type GroupTest = { status: 'testing' } | { status: 'done'; ok: number; invalid: number; badKeys: string[] };

interface PasteKeysDialogProps {
  open: boolean;
  endpoint: ProviderEndpoint | null;
  onClose: () => void;
  onAdded?: (endpointIds: string[]) => void;
}

const ADAPTER_DEFAULT_URLS: Record<string, string> = {
  openai_compatible: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com',
};

interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  adapterType: string;
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', adapterType: 'openai_compatible' },
  { id: 'anthropic', label: 'Anthropic / Claude', baseUrl: 'https://api.anthropic.com', adapterType: 'anthropic' },
  { id: 'gemini', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', adapterType: 'gemini' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', adapterType: 'openai_compatible' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', adapterType: 'openai_compatible' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', adapterType: 'openai_compatible' },
  { id: 'fireworks', label: 'Fireworks', baseUrl: 'https://api.fireworks.ai/inference/v1', adapterType: 'openai_compatible' },
  { id: 'together', label: 'Together', baseUrl: 'https://api.together.xyz/v1', adapterType: 'openai_compatible' },
  { id: 'custom', label: '', baseUrl: '', adapterType: 'openai_compatible' },
];

const CUSTOM_PRESET_ID = 'custom';

function splitKeys(text: string): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  const push = (key: string) => {
    const trimmed = key.replace(/[.,;:]+$/, '');
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    keys.push(trimmed);
  };
  for (const line of text.split('\n')) {
    if (looksLikeApiKey(line.trim())) push(line.trim());
    for (const key of extractKeyTokens(line)) push(key);
  }
  return keys;
}

interface ProviderGroup {
  id: string;
  name: string | null;
  baseUrl: string;
  keys: string[];
  models: string[];
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function presetForBaseUrl(baseUrl: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find(preset => normalizeBaseUrl(preset.baseUrl) === normalizeBaseUrl(baseUrl));
}

function groupEntriesByBaseUrl(entries: ParsedProviderEntry[]): ProviderGroup[] {
  const groups = new Map<string, ProviderGroup>();
  for (const entry of entries) {
    const normalized = normalizeBaseUrl(entry.baseUrl);
    const id = normalized || `label:${(entry.name ?? '').toLowerCase()}`;
    const group = groups.get(id);
    if (group) {
      for (const key of entry.keys) {
        if (!group.keys.includes(key)) group.keys.push(key);
      }
      for (const model of entry.models) {
        if (!group.models.includes(model)) group.models.push(model);
      }
    } else {
      groups.set(id, {
        id,
        name: entry.name,
        baseUrl: entry.baseUrl,
        keys: [...entry.keys],
        models: [...entry.models],
      });
    }
  }
  return [...groups.values()];
}

function groupTitle(group: ProviderGroup, url: string): string {
  const preset = presetForBaseUrl(url);
  if (preset) return preset.label;
  if (url) return hostFromUrl(url);
  return group.name ?? '';
}

export function PasteKeysDialog({ open, endpoint, onClose, onAdded }: PasteKeysDialogProps) {
  const createEndpoint = useAiGatewayStore(state => state.createEndpoint);
  const createCredential = useAiGatewayStore(state => state.createCredential);
  const fetchEndpoints = useAiGatewayStore(state => state.fetchEndpoints);
  const fetchCredentials = useAiGatewayStore(state => state.fetchCredentials);
  const endpoints = useAiGatewayStore(state => state.endpoints);

  const [text, setText] = useState('');
  const [presetId, setPresetId] = useState(CUSTOM_PRESET_ID);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [adapterType, setAdapterType] = useState('openai_compatible');
  const [results, setResults] = useState<Record<string, KeyResult>>({});
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [batchEntries, setBatchEntries] = useState<ParsedProviderEntry[] | null>(null);
  const [ignoredLabels, setIgnoredLabels] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [groupTests, setGroupTests] = useState<Record<string, GroupTest>>({});
  const [groupUrls, setGroupUrls] = useState<Record<string, string>>({});
  const [forceNew, setForceNew] = useState(false);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setText('');
      setResults({});
      setPresetId(CUSTOM_PRESET_ID);
      setName(endpoint?.name ?? '');
      setBaseUrl(endpoint?.baseUrl ?? '');
      setAdapterType(endpoint?.adapterType ?? 'openai_compatible');
      setBatchEntries(null);
      setIgnoredLabels([]);
      setSelected({});
      setGroupTests({});
      setGroupUrls({});
      setForceNew(false);
    });
  }, [open, endpoint]);

  const scopedEndpoint = forceNew ? null : endpoint;

  const keys = useMemo(() => splitKeys(text), [text]);
  const batchGroups = useMemo(
    () => (batchEntries ? groupEntriesByBaseUrl(batchEntries) : []),
    [batchEntries],
  );
  const selectedCount = batchGroups.filter(group => selected[group.id] !== false).length;
  const targetUrl = scopedEndpoint ? scopedEndpoint.baseUrl : baseUrl.trim();

  const canTest = keys.length > 0 && !testing && !saving && (scopedEndpoint !== null || baseUrl.trim() !== '');

  const handlePresetChange = useCallback((id: string) => {
    setPresetId(id);
    const preset = PROVIDER_PRESETS.find(item => item.id === id);
    if (!preset) return;
    if (preset.id === CUSTOM_PRESET_ID) {
      setName('');
      setBaseUrl('');
      setAdapterType('openai_compatible');
    } else {
      setName(preset.label);
      setBaseUrl(preset.baseUrl);
      setAdapterType(preset.adapterType);
    }
  }, []);

  const applyParsedEntries = useCallback((entries: ParsedProviderEntry[], ignored: string[]) => {
    setIgnoredLabels(ignored);
    if (entries.length > 1) {
      setBatchEntries(entries);
      const groups = groupEntriesByBaseUrl(entries);
      setSelected(Object.fromEntries(groups.map(group => [group.id, true])));
      setGroupTests({});
      setGroupUrls(Object.fromEntries(groups.filter(group => !group.baseUrl).map(group => [group.id, ''])));
      return;
    }
    if (entries.length === 1) {
      const entry = entries[0];
      const matched = presetForBaseUrl(entry.baseUrl);
      const entryName = matched
        ? matched.label
        : entry.baseUrl
          ? hostFromUrl(entry.baseUrl)
          : (entry.name ?? '');
      if (endpoint && normalizeBaseUrl(entry.baseUrl) !== normalizeBaseUrl(endpoint.baseUrl)) {
        setForceNew(true);
        setPresetId(matched ? matched.id : CUSTOM_PRESET_ID);
        setName(entryName);
        setBaseUrl(entry.baseUrl);
        setAdapterType(matched ? matched.adapterType : 'openai_compatible');
        if (entry.keys.length > 0) setText(entry.keys.join('\n'));
        return;
      }
      setPresetId(matched ? matched.id : CUSTOM_PRESET_ID);
      setName(entryName);
      setBaseUrl(entry.baseUrl);
      if (entry.keys.length > 0) setText(entry.keys.join('\n'));
    }
  }, [endpoint]);

  const handleSmartPaste = useCallback(async () => {
    try {
      const clipboard = await navigator.clipboard.readText();
      const { entries, ignoredLabels: ignored } = parsePastedProviders(clipboard);
      if (entries.length > 0) {
        applyParsedEntries(entries, ignored);
        return;
      }
      const recovered = splitKeys(clipboard);
      const payload = recovered.length > 0 ? recovered.join('\n') : clipboard.trim();
      setText(prev => (prev ? `${prev.trimEnd()}\n${payload}` : payload));
    } catch {
      toast.error(t('aiHub.pasteFirst.clipboardFailed'));
    }
  }, [applyParsedEntries]);

  const handleTestGroup = useCallback(async (group: ProviderGroup) => {
    const url = (groupUrls[group.id] ?? group.baseUrl).trim();
    if (!url) return;
    setGroupTests(prev => ({ ...prev, [group.id]: { status: 'testing' } }));
    try {
      const response = await bulkTestOpenCodeApi(url, group.keys, 10);
      let ok = 0;
      let invalid = 0;
      const badKeys: string[] = [];
      for (const result of response.results) {
        if (result.status === 'ok' || result.status === 'rate_limited') {
          ok += 1;
        } else if (result.status === 'invalid') {
          invalid += 1;
          badKeys.push(result.key);
        }
      }
      setGroupTests(prev => ({ ...prev, [group.id]: { status: 'done', ok, invalid, badKeys } }));
    } catch (error) {
      setGroupTests(prev => {
        const next = { ...prev };
        delete next[group.id];
        return next;
      });
      toast.error(t('aiHub.pasteFirst.addFailed', { msg: error instanceof Error ? error.message : String(error) }));
    }
  }, [groupUrls]);

  const handleBatchAdd = useCallback(async () => {
    if (!batchEntries || batchEntries.length === 0) return;
    setSaving(true);
    try {
      let added = 0;
      let skipped = 0;
      let missingUrl = 0;
      const targetIds: string[] = [];
      for (const group of groupEntriesByBaseUrl(batchEntries)) {
        if (selected[group.id] === false) continue;
        const groupUrl = (groupUrls[group.id] ?? group.baseUrl).trim();
        if (!groupUrl) {
          missingUrl += 1;
          continue;
        }
        const groupTest = groupTests[group.id];
        const keysToAdd =
          groupTest?.status === 'done'
            ? group.keys.filter(key => !groupTest.badKeys.includes(key))
            : group.keys;
        const normalized = normalizeBaseUrl(groupUrl);
        const existing = endpoints.find(item => normalizeBaseUrl(item.baseUrl) === normalized);
        const preset = presetForBaseUrl(groupUrl);
        const target = existing ?? await createEndpoint({
          name: groupTitle(group, groupUrl),
          baseUrl: groupUrl,
          adapterType: preset?.adapterType ?? 'openai_compatible',
          enabled: true,
        });
        const known = new Set<string>();
        if (existing) {
          await fetchCredentials(existing.id);
          for (const credential of useAiGatewayStore.getState().credentials) {
            if (credential.providerEndpointId === existing.id) known.add(credential.fingerprint);
          }
        }
        let groupAdded = 0;
        for (const key of keysToAdd) {
          if (known.has(await computeCredentialFingerprint(target.id, key))) {
            skipped += 1;
            continue;
          }
          await createCredential({ providerEndpointId: target.id, authType: 'api_key', secret: key });
          added += 1;
          groupAdded += 1;
        }
        if (groupAdded > 0) targetIds.push(target.id);
      }
      await fetchEndpoints();
      toast.success(
        skipped > 0
          ? t('aiHub.pasteFirst.addedToastSkipped', { count: added, skipped })
          : t('aiHub.pasteFirst.addedToast', { count: added }),
      );
      if (missingUrl > 0) {
        toast.error(t('aiHub.pasteFirst.batchUrlMissing', { count: missingUrl }));
      }
      onClose();
      if (targetIds.length > 0) onAdded?.(targetIds);
    } catch (error) {
      toast.error(t('aiHub.pasteFirst.addFailed', { msg: error instanceof Error ? error.message : String(error) }));
    } finally {
      setSaving(false);
    }
  }, [batchEntries, selected, groupTests, groupUrls, endpoints, createEndpoint, createCredential, fetchCredentials, fetchEndpoints, onClose, onAdded]);

  const handleTest = useCallback(async () => {
    if (!canTest) return;
    setTesting(true);
    setResults(Object.fromEntries(keys.map(key => [key, { status: 'testing' as const }])));
    try {
      const response = await bulkTestOpenCodeApi(targetUrl, keys, 10);
      const next: Record<string, KeyResult> = {};
      for (const result of response.results) {
        next[result.key] = {
          status: result.status === 'ok' ? 'ok' : result.status,
          error: result.error,
        };
      }
      setResults(next);
    } catch {
      setResults(Object.fromEntries(keys.map(key => [key, { status: 'error' as const }])));
    } finally {
      setTesting(false);
    }
  }, [canTest, keys, targetUrl]);

  const handleAdd = useCallback(async () => {
    const accepted = keys.filter(key => results[key]?.status !== 'invalid');
    if (accepted.length === 0) {
      toast.error(t('aiHub.pasteFirst.nothingToAdd'));
      return;
    }

    setSaving(true);
    try {
      let target = scopedEndpoint;
      const targetExisted = target !== null;
      if (!target) {
        const trimmedName = name.trim();
        const trimmedUrl = baseUrl.trim();
        if (!trimmedName || !trimmedUrl) {
          toast.error(t('aiHub.pasteFirst.newProviderHint'));
          return;
        }
        target = await createEndpoint({ name: trimmedName, baseUrl: trimmedUrl, adapterType, enabled: true });
      }
      if (!target) return;
      const targetId = target.id;

      const fresh: string[] = [];
      let skipped = 0;
      if (targetExisted) {
        await fetchCredentials(targetId);
        const known = new Set(
          useAiGatewayStore
            .getState()
            .credentials.filter(credential => credential.providerEndpointId === targetId)
            .map(credential => credential.fingerprint),
        );
        for (const key of accepted) {
          if (known.has(await computeCredentialFingerprint(targetId, key))) skipped += 1;
          else fresh.push(key);
        }
      } else {
        fresh.push(...accepted);
      }

      for (const key of fresh) {
        await createCredential({ providerEndpointId: targetId, authType: 'api_key', secret: key });
      }
      await fetchEndpoints();
      toast.success(
        skipped > 0
          ? t('aiHub.pasteFirst.addedToastSkipped', { count: fresh.length, skipped })
          : t('aiHub.pasteFirst.addedToast', { count: fresh.length }),
      );
      onClose();
      onAdded?.([targetId]);
    } catch (error) {
      toast.error(t('aiHub.pasteFirst.addFailed', { msg: error instanceof Error ? error.message : String(error) }));
    } finally {
      setSaving(false);
    }
  }, [keys, results, scopedEndpoint, name, baseUrl, adapterType, createEndpoint, createCredential, fetchCredentials, fetchEndpoints, onClose, onAdded]);

  const statusTone = (status: KeyStatus): string => {
    if (status === 'ok') return 'text-emerald-300';
    if (status === 'invalid') return 'text-red-300';
    if (status === 'error' || status === 'rate_limited') return 'text-amber-300';
    if (status === 'testing') return 'text-slate-400';
    return 'text-slate-500';
  };

  const statusLabel = (status: KeyStatus): string => {
    if (status === 'ok') return t('aiHub.pasteFirst.statusOk');
    if (status === 'invalid') return t('aiHub.pasteFirst.statusInvalid');
    if (status === 'error' || status === 'rate_limited') return t('aiHub.pasteFirst.statusError');
    return t('aiHub.pasteFirst.statusPending');
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={t('aiHub.pasteFirst.title')}
      size="md"
      footer={
        batchEntries ? (
          <div className="flex items-center justify-between gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setBatchEntries(null);
                setIgnoredLabels([]);
                setSelected({});
                setGroupTests({});
              }}
              disabled={saving}
            >
              {t('aiHub.pasteFirst.batchBack')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleBatchAdd()}
              disabled={selectedCount === 0 || saving}
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : null}
              {selectedCount === batchGroups.length
                ? t('aiHub.pasteFirst.batchAddAll', { count: batchGroups.length })
                : t('aiHub.pasteFirst.batchAddSelected', { count: selectedCount })}
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs tabular-nums text-slate-500">
              {keys.length > 0 ? `${keys.length} · ${t('aiHub.providersPage.keysShort')}` : ''}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void handleTest()} disabled={!canTest}>
                {testing ? <Loader2 size={13} className="animate-spin" /> : null}
                {t('aiHub.pasteFirst.test')}
              </Button>
              <Button variant="primary" size="sm" onClick={() => void handleAdd()} disabled={keys.length === 0 || saving}>
                {t('aiHub.pasteFirst.add')}
              </Button>
            </div>
          </div>
        )
      }
    >
      {batchEntries ? (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">{t('aiHub.pasteFirst.batchTitle')}</p>
          <div className="max-h-64 space-y-1 overflow-auto rounded-md border border-white/[0.06] bg-black/20 p-2">
            {batchGroups.map(group => {
              const groupUrl = (groupUrls[group.id] ?? group.baseUrl).trim();
              const label = groupTitle(group, groupUrl);
              const groupTest = groupTests[group.id];
              return (
                <div key={group.id} className="space-y-1">
                  <div className="flex items-center gap-2 text-xs">
                    <Checkbox
                      className="shrink-0 px-0 py-0"
                      checked={selected[group.id] !== false}
                      onChange={event =>
                        setSelected(prev => ({ ...prev, [group.id]: event.target.checked }))
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium text-slate-200">{label}</span>
                      {groupUrl && (
                        <span className="ml-2 text-slate-500">{hostFromUrl(groupUrl)}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-slate-400">
                      {t('aiHub.pasteFirst.batchKeys', { count: group.keys.length })}
                    </span>
                    {group.models.length > 0 && (
                      <span className="shrink-0 text-slate-500">
                        {t('aiHub.pasteFirst.batchModels', { count: group.models.length })}
                      </span>
                    )}
                    {groupTest?.status === 'done' && (
                      <span
                        className={cn('shrink-0', groupTest.invalid > 0 ? 'text-amber-300' : 'text-emerald-300')}
                      >
                        {t('aiHub.pasteFirst.batchTestSummary', { ok: groupTest.ok, invalid: groupTest.invalid })}
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="xs"
                      className="shrink-0"
                      disabled={saving || !groupUrl || groupTest?.status === 'testing'}
                      onClick={() => void handleTestGroup(group)}
                    >
                      {groupTest?.status === 'testing' ? <Loader2 size={12} className="animate-spin" /> : null}
                      {t('aiHub.pasteFirst.test')}
                    </Button>
                  </div>
                  {!group.baseUrl && (
                    <Input
                      aria-label={t('aiHub.pasteFirst.batchUrlLabel', { label })}
                      value={groupUrls[group.id] ?? ''}
                      onChange={event =>
                        setGroupUrls(prev => ({ ...prev, [group.id]: event.target.value }))
                      }
                      placeholder={t('aiHub.pasteFirst.batchUrlPlaceholder')}
                      className="ml-6"
                    />
                  )}
                </div>
              );
            })}
          </div>
          {ignoredLabels.length > 0 && (
            <p className="text-xs text-slate-500">
              {t('aiHub.pasteFirst.batchIgnored', { labels: ignoredLabels.join(', ') })}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">{t('aiHub.pasteFirst.hint')}</p>

        {scopedEndpoint ? (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="text-slate-500">{t('aiHub.pasteFirst.providerLabel')}:</span>
            <span className="font-medium text-slate-200">{scopedEndpoint.name}</span>
          </div>
        ) : (
          <div className="space-y-3">
            {forceNew && endpoint && (
              <p className="text-xs text-amber-300">
                {t('aiHub.pasteFirst.mismatchHint', { name: endpoint.name })}
              </p>
            )}
            <div>
              <label className="text-xs font-medium text-slate-300">{t('aiHub.pasteFirst.providerPresetLabel')}</label>
              <Select
                value={presetId}
                onValueChange={handlePresetChange}
                options={PROVIDER_PRESETS.map(preset => ({
                  value: preset.id,
                  label:
                    preset.id === CUSTOM_PRESET_ID
                      ? t('aiHub.pasteFirst.providerPresetOther')
                      : preset.label,
                }))}
              />
            </div>
            <Input
              label={t('aiHub.providersPage.nameLabel')}
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="My Provider"
            />
            <Input
              label={t('aiHub.providersPage.baseUrlLabel')}
              value={baseUrl}
              onChange={event => setBaseUrl(event.target.value)}
              placeholder="https://api.example.com/v1"
            />
            <div>
              <label className="text-xs font-medium text-slate-300">{t('aiHub.providersPage.adapterLabel')}</label>
              <Select
                value={adapterType}
                onChange={event => {
                  setAdapterType(event.target.value);
                  if (!baseUrl || Object.values(ADAPTER_DEFAULT_URLS).includes(baseUrl)) {
                    setBaseUrl(ADAPTER_DEFAULT_URLS[event.target.value] ?? '');
                  }
                }}
              >
                <option value="openai_compatible">{t('aiGateway.form.optOpenai')}</option>
                <option value="anthropic">{t('aiGateway.form.optAnthropic')}</option>
                <option value="gemini">{t('aiGateway.form.optGemini')}</option>
              </Select>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-slate-300">{t('aiHub.pasteFirst.keysLabel')}</label>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            leftIcon={<ClipboardPaste size={12} />}
            onClick={() => void handleSmartPaste()}
          >
            {t('aiHub.pasteFirst.fromClipboard')}
          </Button>
        </div>

        <Textarea
          value={text}
          onChange={event => {
            const next = event.target.value;
            setText(next);
            // WebView2 native paste inserts text without a usable clipboardData, so bulk inserts are parsed here too
            if (next.length - text.length > 24) {
              const parsed = parsePastedProviders(next);
              if (parsed.entries.length > 0) applyParsedEntries(parsed.entries, parsed.ignoredLabels);
            }
          }}
          onPaste={event => {
            const pasted = event.clipboardData.getData('text');
            const { entries, ignoredLabels: ignored } = parsePastedProviders(pasted);
            if (entries.length > 0) {
              event.preventDefault();
              applyParsedEntries(entries, ignored);
            }
          }}
          placeholder={t('aiHub.pasteFirst.emptyHint')}
          rows={6}
        />

        <p className="text-[11px] text-slate-500">{t('aiHub.pasteFirst.modelsHint')}</p>

        {keys.length > 0 && (
          <div className="max-h-48 space-y-1 overflow-auto rounded-md border border-white/[0.06] bg-black/20 p-2">
            {keys.map(key => {
              const result = results[key];
              return (
                <div key={key} className="flex items-center gap-2 font-mono text-[11px]">
                  <span className="min-w-0 flex-1 truncate text-slate-400">
                    {key.slice(0, 10)}…{key.slice(-4)}
                  </span>
                  <span className={cn('shrink-0', statusTone(result?.status ?? 'pending'))}>
                    {statusLabel(result?.status ?? 'pending')}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        </div>
      )}
    </Modal>
  );
}