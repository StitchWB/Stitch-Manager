import { useMemo, useState } from 'react';
import { CheckCircle2, ClipboardPaste, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import { Badge, Button, Input, Modal, Select, Textarea, Toggle } from '@/components/ui';
import { createAiProxyAccount } from '@/lib/backend/modules/aiProxy';
import { addCustomProvider, setCustomProviderKeys } from '@/lib/backend/modules/customProviders';
import { testOpenCodeApi } from '@/lib/backend/modules/opencodeConfig';
import { defaultBaseUrlFor, detectProvider } from '@/lib/aiHub/detectProvider';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { maskKey } from '@/lib/utils/maskKey';
import { AI_PROXY_PROVIDER_FILTERS } from './providerMeta';

export interface PasteFirstModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialProvider?: string;
  onSubmit: () => Promise<void> | void;
}

type RowStatus = 'pending' | 'testing' | 'ok' | 'invalid' | 'error';

interface RowResult {
  status: RowStatus;
  models?: string[];
  error?: string;
}

const PROVIDER_OPTIONS = AI_PROXY_PROVIDER_FILTERS.filter(f => f.id !== 'all').map(f => ({
  value: f.id,
  label: f.label,
}));

function statusLabel(status: RowStatus): string {
  switch (status) {
    case 'testing':
      return t('aiHub.pasteFirst.test');
    case 'ok':
      return t('aiHub.pasteFirst.statusOk');
    case 'invalid':
      return t('aiHub.pasteFirst.statusInvalid');
    case 'error':
      return t('aiHub.pasteFirst.statusError');
    default:
      return t('aiHub.pasteFirst.statusPending');
  }
}

export function PasteFirstModal({ isOpen, onClose, initialProvider, onSubmit }: PasteFirstModalProps) {
  const [text, setText] = useState('');
  const [selectedProvider, setSelectedProvider] = useState(initialProvider ?? '');
  const [baseUrl, setBaseUrl] = useState('');
  const [showBaseUrl, setShowBaseUrl] = useState(false);
  const [providerName, setProviderName] = useState('');
  const [results, setResults] = useState<Record<string, RowResult>>({});
  const [testing, setTesting] = useState(false);
  const [adding, setAdding] = useState(false);

  const keys = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const line of text.split('\n')) {
      const key = line.trim();
      if (key && !seen.has(key)) {
        seen.add(key);
        list.push(key);
      }
    }
    return list;
  }, [text]);

  const firstDetected = keys.length > 0 ? detectProvider(keys[0]) : null;
  const effectiveProvider = selectedProvider || firstDetected || '';
  const isCustomFlow = effectiveProvider === '' || effectiveProvider === 'custom';
  const baseUrlVisible = isCustomFlow || showBaseUrl;

  const rowProvider = (key: string): string => selectedProvider || detectProvider(key) || '';

  const canTest =
    keys.length > 0 && !testing && !adding && (isCustomFlow ? baseUrl.trim() !== '' : true);

  const handleTest = async () => {
    if (!canTest) return;
    setTesting(true);
    setResults(Object.fromEntries(keys.map(k => [k, { status: 'testing' as const }])));
    const next: Record<string, RowResult> = {};
    await Promise.all(
      keys.map(async key => {
        const url = baseUrl.trim() || defaultBaseUrlFor(rowProvider(key));
        if (!url) {
          next[key] = { status: 'error', error: t('aiHub.pasteFirst.noBaseUrl') };
          return;
        }
        try {
          const result = await testOpenCodeApi(url, key);
          next[key] = result.success
            ? { status: 'ok', models: result.models?.map(m => m.id) }
            : { status: 'invalid', error: result.error };
        } catch (e) {
          next[key] = { status: 'error', error: e instanceof Error ? e.message : String(e) };
        }
      })
    );
    setResults(next);
    setTesting(false);
  };

  const handleAdd = async () => {
    const accepted = keys.filter(k => {
      const status = results[k]?.status;
      return status !== 'invalid' && status !== 'error';
    });
    if (accepted.length === 0) {
      toast.error(t('aiHub.pasteFirst.nothingToAdd'));
      return;
    }
    setAdding(true);
    try {
      if (isCustomFlow) {
        const name = providerName.trim();
        const url = baseUrl.trim();
        if (!name || !url) {
          toast.error(t('aiHub.pasteFirst.newProviderHint'));
          return;
        }
        const created = await addCustomProvider(name, url, 'openai/*');
        if (!created.success || !created.provider) {
          throw new Error(created.error || t('aiHub.providerCreateFailed'));
        }
        await setCustomProviderKeys(
          created.provider.id,
          accepted.map(key => ({ apiKey: key, baseUrl: url, prefix: null }))
        );
      } else {
        const now = Math.floor(Date.now() / 1000);
        await Promise.all(
          accepted.map(key => {
            const provider = rowProvider(key) || effectiveProvider;
            return createAiProxyAccount({
              id: null,
              provider,
              name: `${provider}-${key.slice(-4)}`,
              oauthToken: null,
              apiKey: key,
              sessionToken: null,
              enabled: true,
              accountType: null,
              requestsToday: 0,
              requestsTotal: 0,
              tokensUsed: 0,
              lastUsedAt: null,
              createdAt: now,
              updatedAt: now,
            });
          })
        );
      }
      toast.success(t('aiHub.pasteFirst.addedToast', { count: accepted.length }));
      await onSubmit();
      onClose();
    } catch (e) {
      toast.error(
        t('aiHub.pasteFirst.addFailed', { msg: e instanceof Error ? e.message : String(e) })
      );
    } finally {
      setAdding(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('aiHub.pasteFirst.title')}
      icon={<ClipboardPaste size={18} className="text-indigo-300" />}
      size="lg"
      isLoading={adding}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={adding}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleTest()}
            disabled={!canTest}
            isLoading={testing}
          >
            {t('aiHub.pasteFirst.test')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleAdd()}
            disabled={keys.length === 0 || adding}
            isLoading={adding}
          >
            {t('aiHub.pasteFirst.add')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4" data-testid="paste-first-modal">
        <Textarea
          label={t('aiHub.pasteFirst.keysLabel')}
          hint={t('aiHub.pasteFirst.hint')}
          value={text}
          onChange={e => setText(e.target.value)}
          rows={5}
          className="font-mono text-xs"
          placeholder={'sk-ant-...\nAIza...\nsk-...'}
          disabled={adding}
        />

        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={t('aiHub.pasteFirst.providerLabel')}
            containerClassName="w-48"
            value={effectiveProvider}
            options={[{ value: '', label: t('aiHub.pasteFirst.providerAuto') }, ...PROVIDER_OPTIONS]}
            onValueChange={setSelectedProvider}
            disabled={adding}
          />
          {!isCustomFlow && (
            <Toggle
              label={t('aiHub.pasteFirst.baseUrlToggle')}
              checked={showBaseUrl}
              onChange={setShowBaseUrl}
              size="sm"
            />
          )}
        </div>

        {baseUrlVisible && (
          <Input
            label={t('aiHub.pasteFirst.baseUrlLabel')}
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v1"
            disabled={adding}
          />
        )}

        {isCustomFlow && keys.length > 0 && (
          <div className="space-y-1">
            <Input
              label={t('aiHub.pasteFirst.newNameLabel')}
              value={providerName}
              onChange={e => setProviderName(e.target.value)}
              placeholder="DashScope (Alibaba)"
              disabled={adding}
            />
            <p className="text-[11px] text-slate-500">{t('aiHub.pasteFirst.newProviderHint')}</p>
          </div>
        )}

        {keys.length > 0 && (
          <div className="space-y-1.5" data-testid="paste-preview">
            {keys.map(key => {
              const result = results[key];
              const status: RowStatus = result?.status ?? 'pending';
              const detected = detectProvider(key);
              const models = result?.models ?? [];
              return (
                <div
                  key={key}
                  data-testid="paste-row"
                  className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-slate-300">{maskKey(key)}</span>
                    {detected && (
                      <Badge variant="indigo" size="sm">
                        {detected}
                      </Badge>
                    )}
                    <span
                      className={cn(
                        'ml-auto flex items-center gap-1 text-[11px]',
                        status === 'ok'
                          ? 'text-emerald-300'
                          : status === 'invalid' || status === 'error'
                            ? 'text-red-300'
                            : 'text-slate-500'
                      )}
                    >
                      {status === 'ok' && <CheckCircle2 size={13} className="shrink-0" />}
                      {(status === 'invalid' || status === 'error') && (
                        <XCircle size={13} className="shrink-0" />
                      )}
                      {statusLabel(status)}
                    </span>
                  </div>
                  {status === 'ok' && models.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {models.slice(0, 10).map(id => (
                        <Badge key={id} variant="info" size="sm">
                          {id}
                        </Badge>
                      ))}
                      {models.length > 10 && (
                        <Badge variant="outline" size="sm">
                          {t('apiKeys.moreCount', { count: models.length - 10 })}
                        </Badge>
                      )}
                    </div>
                  )}
                  {(status === 'invalid' || status === 'error') && result?.error && (
                    <div className="mt-1 text-[11px] text-red-400/80">{result.error}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
