import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardPaste, Loader2, Plus, Settings2, Trash2, WandSparkles } from 'lucide-react';
import { toast } from 'sonner';

import { Button, Checkbox, Input, Modal, Select, Textarea } from '@/components/ui';
import { useAiGatewayStore } from '@/stores/aiGateway';
import { bulkTestOpenCodeApi } from '@/lib/backend/modules/opencodeConfig';
import { looksLikeApiKey } from '@/lib/utils/parseProviderText';
import { parsePastedProviders, extractKeyTokens } from '@/lib/utils/parsePastedProviders';
import type { ParsedProviderEntry } from '@/lib/utils/parseProviderText';
import type { ProviderEndpoint, SaveConnectionParams } from '@/lib/backend/modules/aiGateway';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

type KeyStatus = 'pending' | 'testing' | 'ok' | 'rate_limited' | 'invalid' | 'error';

interface KeyResult {
  status: KeyStatus;
  error?: string;
}

type GroupTest = { status: 'testing' } | { status: 'done'; ok: number; invalid: number; badKeys: string[] };

interface HeaderRow {
  id: number;
  name: string;
  value: string;
}

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
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return undefined;
  const exact = PROVIDER_PRESETS.find(preset => normalizeBaseUrl(preset.baseUrl) === normalized);
  if (exact) return exact;
  const host = hostFromUrl(normalized).toLowerCase();
  if (!host || host === normalized.toLowerCase()) return undefined;
  return PROVIDER_PRESETS.find(preset => hostFromUrl(preset.baseUrl).toLowerCase() === host);
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
  const saveConnection = useAiGatewayStore(state => state.saveConnection);
  const fetchEndpoints = useAiGatewayStore(state => state.fetchEndpoints);
  const endpoints = useAiGatewayStore(state => state.endpoints);

  const [text, setText] = useState('');
  const [presetId, setPresetId] = useState(CUSTOM_PRESET_ID);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [adapterType, setAdapterType] = useState('openai_compatible');
  const [authType, setAuthType] = useState<'api_key' | 'none'>('api_key');
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [results, setResults] = useState<Record<string, KeyResult>>({});
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [batchEntries, setBatchEntries] = useState<ParsedProviderEntry[] | null>(null);
  const [ignoredLabels, setIgnoredLabels] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [groupTests, setGroupTests] = useState<Record<string, GroupTest>>({});
  const [groupUrls, setGroupUrls] = useState<Record<string, string>>({});
  const [groupErrors, setGroupErrors] = useState<Record<string, string>>({});
  const [savedGroups, setSavedGroups] = useState<Record<string, string>>({});
  const [pendingNewEntry, setPendingNewEntry] = useState<ParsedProviderEntry | null>(null);
  const [forceNew, setForceNew] = useState(false);
  const initializedScope = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      initializedScope.current = null;
      return;
    }
    const scope = endpoint?.id ?? 'new';
    if (initializedScope.current === scope) return;
    initializedScope.current = scope;
    queueMicrotask(() => {
      setText('');
      setResults({});
      setPresetId(CUSTOM_PRESET_ID);
      setName(endpoint?.name ?? '');
      setBaseUrl(endpoint?.baseUrl ?? '');
      setAdapterType(endpoint?.adapterType ?? 'openai_compatible');
      setAuthType('api_key');
      setHeaderRows([]);
      setShowAdvanced(false);
      setBatchEntries(null);
      setIgnoredLabels([]);
      setSelected({});
      setGroupTests({});
      setGroupUrls({});
      setGroupErrors({});
      setSavedGroups({});
      setPendingNewEntry(null);
      setForceNew(false);
    });
  }, [open, endpoint]);

  const scopedEndpoint = forceNew ? null : endpoint;

  const keys = useMemo(() => (authType === 'api_key' ? splitKeys(text) : []), [text, authType]);
  const batchGroups = useMemo(
    () => (batchEntries ? groupEntriesByBaseUrl(batchEntries) : []),
    [batchEntries],
  );
  const selectedCount = batchGroups.filter(group => selected[group.id] !== false).length;
  const keyLimitExceeded = batchEntries
    ? batchGroups.some(group => selected[group.id] !== false && !savedGroups[group.id] && group.keys.length > 200)
    : keys.length > 200;
  const targetUrl = scopedEndpoint ? scopedEndpoint.baseUrl : baseUrl.trim();

  const effectiveAdapterType = scopedEndpoint ? scopedEndpoint.adapterType : adapterType;
  const protocolTestSupported = effectiveAdapterType === 'openai_compatible';

  const canTest =
    authType === 'api_key' &&
    protocolTestSupported &&
    keys.length > 0 &&
    !keyLimitExceeded &&
    !testing &&
    !saving &&
    (scopedEndpoint !== null || baseUrl.trim() !== '');

  const canSave =
    !saving &&
    !keyLimitExceeded &&
    (scopedEndpoint
      ? keys.length > 0
      : name.trim() !== '' &&
        baseUrl.trim() !== '' &&
        (authType === 'none' || keys.length > 0));

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
    if (preset.adapterType !== 'openai_compatible') setAuthType('api_key');
  }, []);

  const handleAdapterChange = useCallback((value: string) => {
    setAdapterType(value);
    if (value !== 'openai_compatible') setAuthType('api_key');
    if (!baseUrl || Object.values(ADAPTER_DEFAULT_URLS).includes(baseUrl)) {
      setBaseUrl(ADAPTER_DEFAULT_URLS[value] ?? '');
    }
  }, [baseUrl]);

  const applyParsedEntries = useCallback((entries: ParsedProviderEntry[], ignored: string[]) => {
    setIgnoredLabels(ignored);
    if (entries.length > 1) {
      setBatchEntries(entries);
      setPendingNewEntry(null);
      const groups = groupEntriesByBaseUrl(entries);
      setSelected(Object.fromEntries(groups.map(group => [group.id, true])));
      setGroupTests({});
      setGroupErrors({});
      setSavedGroups({});
      setGroupUrls(Object.fromEntries(groups.filter(group => !group.baseUrl).map(group => [group.id, ''])));
      return;
    }
    if (entries.length === 1) {
      const entry = entries[0];
      if (!entry.baseUrl) {
        // key-only paste: keys already sit in the textarea, typed fields stay untouched
        return;
      }
      const matched = presetForBaseUrl(entry.baseUrl);
      const entryName = matched
        ? matched.label
        : entry.baseUrl
          ? hostFromUrl(entry.baseUrl)
          : (entry.name ?? '');
      if (scopedEndpoint && normalizeBaseUrl(entry.baseUrl) !== normalizeBaseUrl(scopedEndpoint.baseUrl)) {
        setPendingNewEntry(entry);
        if (entry.keys.length > 0) setText(entry.keys.join('\n'));
        return;
      }
      setPendingNewEntry(null);
      setPresetId(matched ? matched.id : CUSTOM_PRESET_ID);
      setName(entryName);
      setBaseUrl(entry.baseUrl);
      setAdapterType(matched ? matched.adapterType : 'openai_compatible');
      if ((matched?.adapterType ?? 'openai_compatible') !== 'openai_compatible') setAuthType('api_key');
      if (entry.keys.length > 0) setText(entry.keys.join('\n'));
    }
  }, [scopedEndpoint]);

  const applyPendingNewEntry = useCallback(() => {
    const entry = pendingNewEntry;
    if (!entry) return;
    const matched = presetForBaseUrl(entry.baseUrl);
    const entryName = matched ? matched.label : hostFromUrl(entry.baseUrl);
    setForceNew(true);
    setPendingNewEntry(null);
    setPresetId(matched ? matched.id : CUSTOM_PRESET_ID);
    setName(entryName);
    setBaseUrl(entry.baseUrl);
    setAdapterType(matched ? matched.adapterType : 'openai_compatible');
    if ((matched?.adapterType ?? 'openai_compatible') !== 'openai_compatible') setAuthType('api_key');
    if (entry.keys.length > 0) setText(entry.keys.join('\n'));
  }, [pendingNewEntry]);

  const handleSmartPaste = useCallback(async () => {
    try {
      const clipboard = await navigator.clipboard.readText();
      const { entries, ignoredLabels: ignored } = parsePastedProviders(clipboard);
      if (entries.some(entry => entry.baseUrl)) {
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

  const handleParse = useCallback(() => {
    const { entries, ignoredLabels: ignored } = parsePastedProviders(text);
    if (entries.length === 0) {
      toast.info(t('aiHub.pasteFirst.parseNothingFound'));
      return;
    }
    applyParsedEntries(entries, ignored);
  }, [text, applyParsedEntries]);

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
    if (!batchEntries || batchEntries.length === 0 || saving || keyLimitExceeded) return;
    setSaving(true);
    const nextErrors: Record<string, string> = {};
    const savedNow: Record<string, string> = { ...savedGroups };
    let created = 0;
    let existing = 0;
    try {
      for (const group of groupEntriesByBaseUrl(batchEntries)) {
        if (selected[group.id] === false) continue;
        if (savedGroups[group.id]) continue;
        const groupUrl = (groupUrls[group.id] ?? group.baseUrl).trim();
        if (!groupUrl) {
          nextErrors[group.id] = t('aiHub.pasteFirst.batchGroupUrlMissing');
          continue;
        }
        const groupTest = groupTests[group.id];
        const keysToAdd =
          groupTest?.status === 'done'
            ? group.keys.filter(key => !groupTest.badKeys.includes(key))
            : group.keys;
        if (keysToAdd.length === 0) continue;
        const normalized = normalizeBaseUrl(groupUrl);
        const preset = presetForBaseUrl(groupUrl);
        const groupAdapter = preset?.adapterType ?? 'openai_compatible';
        const existingEndpoint = endpoints.find(
          item => normalizeBaseUrl(item.baseUrl) === normalized && item.adapterType === groupAdapter,
        );
        try {
          const result = await saveConnection(
            existingEndpoint
              ? {
                  endpointId: existingEndpoint.id,
                  auth: { type: 'api_key', secrets: keysToAdd },
                }
              : {
                  endpointId: null,
                  name: groupTitle(group, groupUrl),
                  baseUrl: groupUrl,
                  adapterType: groupAdapter,
                  enabled: true,
                  auth: { type: 'api_key', secrets: keysToAdd },
                },
          );
          created += result.credentialsCreated;
          existing += result.credentialsExisting;
          savedNow[group.id] = result.endpoint.id;
          setSavedGroups(savedNow);
        } catch (error) {
          nextErrors[group.id] = error instanceof Error ? error.message : String(error);
        }
      }
      await fetchEndpoints();
      setGroupErrors(nextErrors);
      if (Object.keys(nextErrors).length === 0) {
        toast.success(
          existing > 0
            ? t('aiHub.pasteFirst.addedToastSkipped', { count: created, skipped: existing })
            : t('aiHub.pasteFirst.addedToastUnverified', { count: created }),
        );
        onClose();
        const savedIds = Object.values(savedNow);
        if (savedIds.length > 0) onAdded?.(savedIds);
      } else {
        toast.error(t('aiHub.pasteFirst.batchPartialFailed', { count: Object.keys(nextErrors).length }));
      }
    } finally {
      setSaving(false);
    }
  }, [batchEntries, saving, keyLimitExceeded, selected, savedGroups, groupTests, groupUrls, endpoints, saveConnection, fetchEndpoints, onClose, onAdded]);

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
    if (!canSave) return;
    const accepted = authType === 'api_key' ? keys.filter(key => results[key]?.status !== 'invalid') : [];
    if (accepted.length === 0 && (scopedEndpoint !== null || authType === 'api_key')) {
      toast.error(t('aiHub.pasteFirst.nothingToAdd'));
      return;
    }

    setSaving(true);
    try {
      const headers = Object.fromEntries(
        headerRows.filter(row => row.name.trim() !== '').map(row => [row.name.trim(), row.value]),
      );
      const params: SaveConnectionParams = scopedEndpoint
        ? { endpointId: scopedEndpoint.id, auth: { type: 'api_key', secrets: accepted } }
        : {
            endpointId: null,
            name: name.trim(),
            adapterType,
            baseUrl: baseUrl.trim(),
            enabled: true,
            ...(Object.keys(headers).length > 0 ? { defaultHeaders: headers } : {}),
            auth: authType === 'none' ? { type: 'none' } : { type: 'api_key', secrets: accepted },
          };
      const result = await saveConnection(params);
      await fetchEndpoints();
      if (authType === 'none') {
        toast.success(t('aiHub.pasteFirst.savedToast'));
      } else if (result.credentialsExisting > 0) {
        toast.success(
          t('aiHub.pasteFirst.addedToastSkipped', {
            count: result.credentialsCreated,
            skipped: result.credentialsExisting,
          }),
        );
      } else if (accepted.some(key => results[key]?.status !== 'ok')) {
        toast.success(t('aiHub.pasteFirst.addedToastUnverified', { count: result.credentialsCreated }));
      } else {
        toast.success(t('aiHub.pasteFirst.addedToast', { count: result.credentialsCreated }));
      }
      onClose();
      onAdded?.([result.endpoint.id]);
    } catch (error) {
      toast.error(t('aiHub.pasteFirst.addFailed', { msg: error instanceof Error ? error.message : String(error) }));
    } finally {
      setSaving(false);
    }
  }, [canSave, authType, keys, results, scopedEndpoint, name, baseUrl, adapterType, headerRows, saveConnection, fetchEndpoints, onClose, onAdded]);

  const addHeaderRow = useCallback(() => {
    setHeaderRows(prev => [...prev, { id: Date.now() + prev.length, name: '', value: '' }]);
  }, []);

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
      title={endpoint ? t('aiHub.pasteFirst.addKeysTitle') : t('aiHub.pasteFirst.addConnectionTitle')}
      size="md"
      overlayClassName="z-[70]"
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
                setGroupErrors({});
                setSavedGroups({});
              }}
              disabled={saving}
            >
              {t('aiHub.pasteFirst.batchBack')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleBatchAdd()}
              disabled={selectedCount === 0 || saving || keyLimitExceeded}
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
              {authType === 'api_key' && keys.length > 0
                ? `${keys.length} · ${t('aiHub.providersPage.keysShort')}`
                : ''}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
                {t('common.cancel')}
              </Button>
              {authType === 'api_key' && protocolTestSupported && (
                <Button variant="outline" size="sm" onClick={() => void handleTest()} disabled={!canTest}>
                  {testing ? <Loader2 size={13} className="animate-spin" /> : null}
                  {t('aiHub.pasteFirst.test')}
                </Button>
              )}
              <Button variant="primary" size="sm" onClick={() => void handleAdd()} disabled={!canSave}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : null}
                {t('aiHub.pasteFirst.saveAction')}
              </Button>
            </div>
          </div>
        )
      }
    >
      {keyLimitExceeded && (
        <p role="alert" className="mb-4 text-sm text-amber-300">{t('aiHub.pasteFirst.keyLimit')}</p>
      )}
      {batchEntries ? (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">{t('aiHub.pasteFirst.batchTitle')}</p>
          <div className="max-h-64 space-y-1 overflow-auto rounded-md border border-white/[0.06] bg-black/20 p-2">
            {batchGroups.map(group => {
              const groupUrl = (groupUrls[group.id] ?? group.baseUrl).trim();
              const label = groupTitle(group, groupUrl);
              const groupTest = groupTests[group.id];
              const groupError = groupErrors[group.id];
              const groupSaved = savedGroups[group.id];
              const groupTestSupported =
                (presetForBaseUrl(groupUrl)?.adapterType ?? 'openai_compatible') === 'openai_compatible';
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
                    {groupSaved && (
                      <span className="shrink-0 text-emerald-300">
                        {t('aiHub.pasteFirst.batchGroupAdded')}
                      </span>
                    )}
                    {groupTestSupported && (
                      <Button
                        variant="ghost"
                        size="xs"
                        className="shrink-0"
                        disabled={saving || Boolean(groupSaved) || !groupUrl || groupTest?.status === 'testing'}
                        onClick={() => void handleTestGroup(group)}
                      >
                        {groupTest?.status === 'testing' ? <Loader2 size={12} className="animate-spin" /> : null}
                        {t('aiHub.pasteFirst.test')}
                      </Button>
                    )}
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
                  {groupError && (
                    <p className="ml-6 text-[11px] text-red-300">{groupError}</p>
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
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="text-slate-500">{t('aiHub.pasteFirst.providerLabel')}:</span>
              <span className="font-medium text-slate-200">{scopedEndpoint.name}</span>
            </div>
            {pendingNewEntry && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-300">
                <span className="min-w-0 flex-1">
                  {t('aiHub.pasteFirst.mismatchHint', { name: scopedEndpoint.name })}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="shrink-0"
                  onClick={applyPendingNewEntry}
                >
                  {t('aiHub.pasteFirst.mismatchNewAction')}
                </Button>
              </div>
            )}
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
              <Select value={adapterType} onChange={event => handleAdapterChange(event.target.value)}>
                <option value="openai_compatible">{t('aiGateway.form.optOpenai')}</option>
                <option value="anthropic">{t('aiGateway.form.optAnthropic')}</option>
                <option value="gemini">{t('aiGateway.form.optGemini')}</option>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-300">{t('aiHub.pasteFirst.authLabel')}</label>
              <Select
                value={authType}
                onChange={event => setAuthType(event.target.value === 'none' ? 'none' : 'api_key')}
              >
                <option value="api_key">{t('aiHub.pasteFirst.authApiKey')}</option>
                <option value="none" disabled={adapterType !== 'openai_compatible'}>
                  {t('aiHub.pasteFirst.authNone')}
                </option>
              </Select>
            </div>
            {adapterType === 'gemini' && (
              <p className="text-[11px] text-amber-300">{t('aiHub.pasteFirst.protocolNoteGemini')}</p>
            )}
            <div>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                leftIcon={<Settings2 size={12} />}
                onClick={() => setShowAdvanced(value => !value)}
              >
                {t('aiHub.pasteFirst.advancedToggle')}
              </Button>
              {showAdvanced && (
                <div className="mt-2 space-y-2 rounded-md border border-white/[0.06] bg-black/20 p-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-slate-300">
                      {t('aiHub.pasteFirst.headersLabel')}
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      leftIcon={<Plus size={12} />}
                      onClick={addHeaderRow}
                    >
                      {t('aiHub.pasteFirst.headersAdd')}
                    </Button>
                  </div>
                  {headerRows.map(row => (
                    <div key={row.id} className="flex items-center gap-2">
                      <Input
                        aria-label={t('aiHub.pasteFirst.headerNameLabel')}
                        value={row.name}
                        onChange={event =>
                          setHeaderRows(prev =>
                            prev.map(item => (item.id === row.id ? { ...item, name: event.target.value } : item)),
                          )
                        }
                        placeholder="X-Title"
                        className="flex-1"
                      />
                      <Input
                        aria-label={t('aiHub.pasteFirst.headerValueLabel')}
                        value={row.value}
                        onChange={event =>
                          setHeaderRows(prev =>
                            prev.map(item => (item.id === row.id ? { ...item, value: event.target.value } : item)),
                          )
                        }
                        placeholder="value"
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        aria-label={t('aiHub.pasteFirst.headersRemove')}
                        onClick={() => setHeaderRows(prev => prev.filter(item => item.id !== row.id))}
                      >
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  ))}
                  <p className="text-[11px] text-slate-500">{t('aiHub.pasteFirst.headersHint')}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {authType === 'api_key' && (
          <>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-300">{t('aiHub.pasteFirst.keysLabel')}</label>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  leftIcon={<WandSparkles size={12} />}
                  onClick={handleParse}
                >
                  {t('aiHub.pasteFirst.parseAction')}
                </Button>
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
            </div>

            {!protocolTestSupported && (
              <p className="text-[11px] text-slate-500">
                {t('aiHub.pasteFirst.testUnsupportedProtocol')}
              </p>
            )}

            <Textarea
              value={text}
              onChange={event => {
                const next = event.target.value;
                setText(next);
                // WebView2 paste arrives without clipboardData — parse bulk inserts from onChange
                if (next.length - text.length > 24) {
                  const parsed = parsePastedProviders(next);
                  if (parsed.entries.length > 0) applyParsedEntries(parsed.entries, parsed.ignoredLabels);
                }
              }}
              onPaste={event => {
                const pasted = event.clipboardData.getData('text');
                const { entries, ignoredLabels: ignored } = parsePastedProviders(pasted);
                if (entries.some(entry => entry.baseUrl)) {
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
          </>
        )}
        </div>
      )}
    </Modal>
  );
}
