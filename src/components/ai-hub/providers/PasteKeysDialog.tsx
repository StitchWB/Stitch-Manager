import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardPaste, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button, Input, Modal, Select, Textarea } from '@/components/ui';
import { useAiGatewayStore } from '@/stores/aiGateway';
import { bulkTestOpenCodeApi } from '@/lib/backend/modules/opencodeConfig';
import { parseProviderEntries, looksLikeApiKey } from '@/lib/utils/parseProviderText';
import type { ParsedProviderEntry } from '@/lib/utils/parseProviderText';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import type { ProviderEndpoint } from '@/lib/backend/modules/aiGateway';

type KeyStatus = 'pending' | 'testing' | 'ok' | 'rate_limited' | 'invalid' | 'error';

interface KeyResult {
  status: KeyStatus;
  error?: string;
}

interface PasteKeysDialogProps {
  open: boolean;
  endpoint: ProviderEndpoint | null;
  onClose: () => void;
  onAdded?: (endpointId: string) => void;
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
  for (const raw of text.split(/[\n,;]+/)) {
    const key = raw.trim();
    if (!key || seen.has(key)) continue;
    if (!looksLikeApiKey(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

interface ProviderGroup {
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
    const group = groups.get(normalized);
    if (group) {
      for (const key of entry.keys) {
        if (!group.keys.includes(key)) group.keys.push(key);
      }
      for (const model of entry.models) {
        if (!group.models.includes(model)) group.models.push(model);
      }
    } else {
      groups.set(normalized, { baseUrl: entry.baseUrl, keys: [...entry.keys], models: [...entry.models] });
    }
  }
  return [...groups.values()];
}

export function PasteKeysDialog({ open, endpoint, onClose, onAdded }: PasteKeysDialogProps) {
  const createEndpoint = useAiGatewayStore(state => state.createEndpoint);
  const createCredential = useAiGatewayStore(state => state.createCredential);
  const fetchEndpoints = useAiGatewayStore(state => state.fetchEndpoints);
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
    });
  }, [open, endpoint]);

  const keys = useMemo(() => splitKeys(text), [text]);
  const batchGroups = useMemo(
    () => (batchEntries ? groupEntriesByBaseUrl(batchEntries) : []),
    [batchEntries],
  );
  const targetUrl = endpoint ? endpoint.baseUrl : baseUrl.trim();

  const canTest = keys.length > 0 && !testing && !saving && (endpoint !== null || baseUrl.trim() !== '');

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

  const applyParsedEntries = useCallback((entries: ParsedProviderEntry[]) => {
    if (entries.length > 1) {
      setBatchEntries(entries);
      return;
    }
    if (entries.length === 1) {
      const entry = entries[0];
      const matched = presetForBaseUrl(entry.baseUrl);
      setPresetId(matched ? matched.id : CUSTOM_PRESET_ID);
      setName(entry.name ?? (matched ? matched.label : hostFromUrl(entry.baseUrl)));
      setBaseUrl(entry.baseUrl);
      if (entry.keys.length > 0) setText(entry.keys.join('\n'));
    }
  }, []);

  const handleSmartPaste = useCallback(async () => {
    try {
      const clipboard = await navigator.clipboard.readText();
      const entries = parseProviderEntries(clipboard);
      if (entries.length > 0) {
        applyParsedEntries(entries);
        return;
      }
      setText(prev => (prev ? `${prev.trimEnd()}\n${clipboard.trim()}` : clipboard.trim()));
    } catch {
      toast.error(t('aiHub.pasteFirst.clipboardFailed'));
    }
  }, [applyParsedEntries]);

  const handleBatchAdd = useCallback(async () => {
    if (!batchEntries || batchEntries.length === 0) return;
    setSaving(true);
    try {
      let added = 0;
      for (const group of groupEntriesByBaseUrl(batchEntries)) {
        const normalized = normalizeBaseUrl(group.baseUrl);
        const existing = endpoints.find(item => normalizeBaseUrl(item.baseUrl) === normalized);
        const preset = presetForBaseUrl(group.baseUrl);
        const target = existing ?? await createEndpoint({
          name: preset?.label ?? hostFromUrl(group.baseUrl),
          baseUrl: group.baseUrl,
          adapterType: preset?.adapterType ?? 'openai_compatible',
          enabled: true,
        });
        for (const key of group.keys) {
          await createCredential({ providerEndpointId: target.id, authType: 'api_key', secret: key });
          added += 1;
        }
      }
      await fetchEndpoints();
      toast.success(t('aiHub.pasteFirst.addedToast', { count: added }));
      onClose();
    } catch (error) {
      toast.error(t('aiHub.pasteFirst.addFailed', { msg: error instanceof Error ? error.message : String(error) }));
    } finally {
      setSaving(false);
    }
  }, [batchEntries, endpoints, createEndpoint, createCredential, fetchEndpoints, onClose]);

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
    const accepted = keys.filter(key => {
      const status = results[key]?.status;
      return status !== 'invalid' && status !== 'error';
    });
    if (accepted.length === 0) {
      toast.error(t('aiHub.pasteFirst.nothingToAdd'));
      return;
    }

    setSaving(true);
    try {
      let target = endpoint;
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

      for (const key of accepted) {
        await createCredential({ providerEndpointId: target.id, authType: 'api_key', secret: key });
      }
      await fetchEndpoints();
      toast.success(t('aiHub.pasteFirst.addedToast', { count: accepted.length }));
      onClose();
      onAdded?.(target.id);
    } catch (error) {
      toast.error(t('aiHub.pasteFirst.addFailed', { msg: error instanceof Error ? error.message : String(error) }));
    } finally {
      setSaving(false);
    }
  }, [keys, results, endpoint, name, baseUrl, adapterType, createEndpoint, createCredential, fetchEndpoints, onClose, onAdded]);

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
            <Button variant="ghost" size="sm" onClick={() => setBatchEntries(null)} disabled={saving}>
              {t('aiHub.pasteFirst.batchBack')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleBatchAdd()}
              disabled={batchGroups.length === 0 || saving}
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : null}
              {t('aiHub.pasteFirst.batchAddAll', { count: batchGroups.length })}
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
              const preset = presetForBaseUrl(group.baseUrl);
              const label = preset?.label ?? hostFromUrl(group.baseUrl);
              return (
                <div key={group.baseUrl} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium text-slate-200">{label}</span>
                    {preset && (
                      <span className="ml-2 text-slate-500">{hostFromUrl(group.baseUrl)}</span>
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
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">{t('aiHub.pasteFirst.hint')}</p>

        {endpoint ? (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="text-slate-500">{t('aiHub.pasteFirst.providerLabel')}:</span>
            <span className="font-medium text-slate-200">{endpoint.name}</span>
          </div>
        ) : (
          <div className="space-y-3">
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
          onChange={event => setText(event.target.value)}
          onPaste={event => {
            const pasted = event.clipboardData.getData('text');
            const entries = parseProviderEntries(pasted);
            if (entries.length > 0) {
              event.preventDefault();
              applyParsedEntries(entries);
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