import { useState, useCallback, useEffect } from 'react';
import { t } from '@/lib/i18n';
import { X, Clipboard, CheckCircle2, XCircle, AlertCircle, RefreshCw, Loader2, Plus, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { maskKey } from '../../lib/utils/maskKey';
import { parseProviderText } from '../../lib/utils/parseProviderText';
import type { ApiKeyEntry } from '../../types/apiKeys';
import type { BulkTestKeyResult } from '../../lib/backend/modules/opencodeConfig';
import { ButtonBase } from '@/components/ui/ButtonBase';
import { Input, Textarea } from '@/components/ui';

interface BulkAddDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  provider: string;
  defaultBaseUrl: string;
  existingKeys: ApiKeyEntry[];
  onBulkTest: (baseUrl: string, keys: string[]) => Promise<BulkTestKeyResult[]>;
  onAddKey: (entry: ApiKeyEntry) => void;
  onAddAllValid: (entries: ApiKeyEntry[]) => void;
  prefillKeys?: string[];
  /** When true, shows name field and creates provider on submit */
  createProviderMode?: boolean;
  onCreateProvider?: (name: string, baseUrl: string, validKeys: ApiKeyEntry[]) => Promise<void>;
}

type TestResultEntry = {
  key: string;
  status: 'ok' | 'rate_limited' | 'invalid' | 'error' | 'testing';
  models?: string[];
  error?: string;
};

export function BulkAddDrawer({
  isOpen,
  onClose,
  provider,
  defaultBaseUrl,
  existingKeys,
  onBulkTest,
  onAddKey,
  onAddAllValid,
  prefillKeys = [],
  createProviderMode = false,
  onCreateProvider,
}: BulkAddDrawerProps) {
  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl);
  const [providerName, setProviderName] = useState('');
  const [rawKeys, setRawKeys] = useState('');
  const [results, setResults] = useState<TestResultEntry[]>([]);
  const [isTesting, setIsTesting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [addedKeys, setAddedKeys] = useState<Set<string>>(new Set());

  // Pre-fill keys when drawer opens with prefillKeys (deferred: no sync setState in effect)
  useEffect(() => {
    queueMicrotask(() => {
      if (isOpen && prefillKeys.length > 0) {
        setRawKeys(prefillKeys.join('\n'));
      } else if (!isOpen) {
        setRawKeys('');
        setResults([]);
        setAddedKeys(new Set());
      }
    });
  }, [isOpen, prefillKeys]);

  const existingKeySet = new Set(existingKeys.map(k => k.key));

  const parsedKeys = rawKeys
    .split(/[\n,;]+/)
    .map(k => k.trim())
    .filter(k => k.length > 0)
    .filter((k, i, arr) => arr.indexOf(k) === i); // dedup within input

  const validCount = results.filter(r => r.status === 'ok').length;
  const testedCount = results.filter(r => r.status !== 'testing').length;

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      setRawKeys(prev => {
        const existing = new Set(prev.split('\n').map(k => k.trim()).filter(k => k.length > 0));
        const newKeys = text.split(/[\n,;]+/).map(k => k.trim()).filter(k => k.length > 0);
        const merged = [...prev.split('\n').filter(k => k.trim().length > 0), ...newKeys.filter(k => !existing.has(k))];
        return merged.join('\n');
      });
      toast.success('Keys pasted from clipboard');
    } catch {
      toast.error('Failed to read clipboard');
    }
  }, []);

  const handleSmartPaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      const parsed = parseProviderText(text);

      // Check if URL matches current provider
      if (parsed.baseUrl && defaultBaseUrl && !parsed.baseUrl.includes(defaultBaseUrl) && !defaultBaseUrl.includes(parsed.baseUrl)) {
        toast.warning(
          t('apiKeys.urlMismatch', { detected: parsed.baseUrl, expected: defaultBaseUrl }),
          { duration: 8000 }
        );
      }

      // Auto-fill base URL if found and current is empty or default
      if (parsed.baseUrl && (!baseUrl || baseUrl === defaultBaseUrl)) {
        setBaseUrl(parsed.baseUrl);
      }

      // Add extracted keys
      if (parsed.keys.length > 0) {
        setRawKeys(prev => {
          const existing = new Set(prev.split('\n').map(k => k.trim()).filter(k => k.length > 0));
          const newKeys = parsed.keys.filter(k => !existing.has(k));
          if (newKeys.length === 0) return prev;
          const merged = prev ? `${prev}\n${newKeys.join('\n')}` : newKeys.join('\n');
          return merged;
        });
      }

      const parts = [];
      if (parsed.name) parts.push(t('apiKeys.partProvider', { name: parsed.name }));
      if (parsed.baseUrl) parts.push(t('apiKeys.partUrl', { url: parsed.baseUrl }));
      if (parsed.keys.length > 0) parts.push(t('apiKeys.partKeys', { count: parsed.keys.length }));
      if (parsed.models.length > 0) parts.push(t('apiKeys.partModels', { count: parsed.models.length }));

      toast.success(parts.length > 0 ? t('apiKeys.smartParsed', { parts: parts.join(' · ') }) : t('apiKeys.nothingFound'));
    } catch {
      toast.error(t('apiKeys.clipboardReadFailed'));
    }
  }, [baseUrl, defaultBaseUrl]);

  const handleTestAll = useCallback(async () => {
    if (parsedKeys.length === 0) {
      toast.error('No keys to test');
      return;
    }
    setIsTesting(true);
    setResults(parsedKeys.map(key => ({ key, status: 'testing' as const })));

    try {
      const bulkResults = await onBulkTest(baseUrl, parsedKeys);
      setResults(prev => {
        const resultMap = new Map(bulkResults.map(r => [r.key, r]));
        return prev.map(entry => {
          const result = resultMap.get(entry.key);
          if (result) {
            return {
              key: entry.key,
              status: result.status,
              models: result.models,
              error: result.error,
            };
          }
          return { ...entry, status: 'error' as const, error: 'No result' };
        });
      });
    } catch (error) {
      toast.error(`Test failed: ${error instanceof Error ? error.message : String(error)}`);
      setResults(prev => prev.map(e => ({ ...e, status: 'error' as const, error: 'Test failed' })));
    } finally {
      setIsTesting(false);
    }
  }, [parsedKeys, baseUrl, onBulkTest]);

  const handleAddOne = useCallback((entry: TestResultEntry) => {
    onAddKey({
      key: entry.key,
      baseUrl: baseUrl || undefined,
      addedAt: Date.now(),
      status: entry.status === 'ok' ? 'ok' : entry.status === 'rate_limited' ? 'rate_limited' : 'invalid',
      models: entry.models,
      lastTested: Date.now(),
      lastError: entry.error,
    });
    setAddedKeys(prev => new Set(prev).add(entry.key));
  }, [baseUrl, onAddKey]);

  const handleCreateProvider = useCallback(async () => {
    if (!onCreateProvider) return;
    const name = providerName.trim();
    if (!name) {
      toast.error('Provider name is required');
      return;
    }
    const valid = results
      .filter(r => r.status === 'ok')
      .map(r => ({
        key: r.key,
        baseUrl: baseUrl || undefined,
        addedAt: Date.now(),
        status: 'ok' as const,
        models: r.models,
        lastTested: Date.now(),
      }));
    if (valid.length === 0) {
      toast.error('No valid keys to add');
      return;
    }
    setIsCreating(true);
    try {
      await onCreateProvider(name, baseUrl, valid);
      setProviderName('');
      setRawKeys('');
      setResults([]);
      setAddedKeys(new Set());
    } catch (error) {
      toast.error(`Failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsCreating(false);
    }
  }, [providerName, baseUrl, results, onCreateProvider]);

  const handleAddAllValid = useCallback(() => {
    const valid = results
      .filter(r => r.status === 'ok' && !existingKeySet.has(r.key))
      .map(r => ({
        key: r.key,
        baseUrl: baseUrl || undefined,
        addedAt: Date.now(),
        status: 'ok' as const,
        models: r.models,
        lastTested: Date.now(),
      }));
    if (valid.length === 0) {
      toast.error('No valid keys to add');
      return;
    }
    onAddAllValid(valid);
    setAddedKeys(new Set());
    setRawKeys('');
    setResults([]);
    toast.success(`Added ${valid.length} valid keys`);
  }, [results, baseUrl, existingKeySet, onAddAllValid]);

  const statusIcon = (status: TestResultEntry['status']) => {
    switch (status) {
      case 'ok': return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
      case 'rate_limited': return <AlertCircle className="w-3.5 h-3.5 text-amber-400" />;
      case 'invalid': return <XCircle className="w-3.5 h-3.5 text-red-400" />;
      case 'error': return <XCircle className="w-3.5 h-3.5 text-red-400" />;
      case 'testing': return <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" />;
    }
  };

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 transition-opacity" onClick={onClose} />
      )}

      {/* Drawer */}
      <div className={cn(
        'fixed top-0 right-0 h-full w-full max-w-md bg-slate-900 border-l border-white/10 z-50',
        'flex flex-col shadow-2xl transition-transform duration-300 ease-in-out',
        isOpen ? 'translate-x-0' : 'translate-x-full'
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">
              {createProviderMode ? 'Add New Provider' : `Add ${provider} Keys`}
            </h2>
            {baseUrl && (
              <p className="text-xs text-slate-500 truncate max-w-[280px] mt-0.5">{baseUrl}</p>
            )}
          </div>
          <ButtonBase
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-colors"
            aria-label="Close drawer"
          >
            <X className="w-4 h-4" />
          </ButtonBase>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {/* Provider Name (create mode) */}
          {createProviderMode && (
            <div>
              <label className="text-xs text-slate-500 mb-1 block">{t('apiKeys.name')}</label>
              <Input
                value={providerName}
                onChange={(e) => setProviderName(e.target.value)}
                placeholder={t('apiKeys.phMyProvider')}
                className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500/50"
              />
            </div>
          )}

          {/* Base URL */}
          <div>
            <label className="text-xs text-slate-500 mb-1 block">{t('apiKeys.baseUrl')}</label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com"
              className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500/50"
            />
          </div>

          {/* Keys textarea */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-slate-500">{t('apiKeys.keysOnePerLine')}</label>
              <div className="flex items-center gap-2">
                <ButtonBase
                  onClick={handleSmartPaste}
                  className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 transition-colors"
                  title={t('apiKeys.smartPasteTip')}
                >
                  <Sparkles className="w-3 h-3" />
                  {t('apiKeys.smartPaste')}
                </ButtonBase>
                <ButtonBase
                  onClick={handlePaste}
                  className="inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 transition-colors"
                  title={t('apiKeys.pasteTip')}
                >
                  <Clipboard className="w-3 h-3" />
                  {t('apiKeys.paste')}
                </ButtonBase>
              </div>
            </div>
            <Textarea
              value={rawKeys}
              onChange={(e) => setRawKeys(e.target.value)}
              rows={8}
              placeholder="sk-...&#10;sk-...&#10;sk-..."
              className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-slate-200 font-mono placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500/50 resize-y"
            />
            <p className="text-xs text-slate-500 mt-1">
              {t('apiKeys.keysParsed', { count: parsedKeys.length })}
              {testedCount > 0 && ` · ${testedCount} tested`}
            </p>
          </div>

          {/* Test All button */}
          <ButtonBase
            onClick={handleTestAll}
            disabled={isTesting || parsedKeys.length === 0}
            className={cn(
              'w-full inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors',
              'bg-sky-500/10 border border-sky-500/20 text-sky-300 hover:bg-sky-500/20',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {isTesting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {isTesting ? t('apiKeys.testing') : t('apiKeys.testAll', { count: parsedKeys.length })}
          </ButtonBase>

          {/* Results */}
          {results.length > 0 && (
            <div className="space-y-1">
              {results.map((r, i) => {
                const isDuplicate = existingKeySet.has(r.key);
                const isAlreadyAdded = addedKeys.has(r.key);
                return (
                  <div
                    key={i}
                    className={cn(
                      'flex items-center gap-2 px-2.5 py-1.5 rounded-md border',
                      isDuplicate ? 'bg-white/[0.01] border-white/5' : 'bg-white/[0.02] border-white/10'
                    )}
                  >
                    {statusIcon(r.status)}
                    <code className="text-xs text-slate-400 font-mono flex-1 truncate">
                      {maskKey(r.key)}
                    </code>
                    {r.error && (
                      <span className="text-xs text-red-400 truncate max-w-[120px]">{r.error}</span>
                    )}
                    {isDuplicate ? (
                      <span className="text-xs text-slate-500 italic shrink-0">{t('apiKeys.alreadyAdded')}</span>
                    ) : isAlreadyAdded ? (
                      <span className="text-xs text-emerald-500 shrink-0">{t('apiKeys.added')}</span>
                    ) : r.status === 'testing' ? null : (
                      <ButtonBase
                        onClick={() => handleAddOne(r)}
                        className="p-0.5 rounded hover:bg-white/10 text-slate-400 hover:text-emerald-400 transition-colors shrink-0"
                        aria-label="Add key"
                        title="Add key"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </ButtonBase>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-white/10">
          {createProviderMode ? (
            <ButtonBase
              onClick={handleCreateProvider}
              disabled={validCount === 0 || isCreating}
              className={cn(
                'w-full inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors',
                'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/20',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {isCreating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              {isCreating ? 'Creating...' : `Create Provider & Add Keys (${validCount})`}
            </ButtonBase>
          ) : (
            <ButtonBase
              onClick={handleAddAllValid}
              disabled={validCount === 0}
              className={cn(
                'w-full inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors',
                'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/20',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              <CheckCircle2 className="w-4 h-4" />
              {t('apiKeys.addAllValid', { count: validCount })}
            </ButtonBase>
          )}
        </div>
      </div>
    </>
  );
}
