import { useMemo, useState } from 'react';
import { ClipboardPaste } from 'lucide-react';
import { useAiGatewayStore } from '@/stores/aiGateway';
import {
  parseProviderPackage,
  isPackageEmpty,
  type ParsedProviderPackage,
} from '@/lib/providerPackageParser';
import { Button, Input, Select, Textarea, Modal } from '@/components/ui';
import { appToast } from '@/lib/observability/toast';
import { t } from '@/lib/i18n';

interface PastePackageDialogProps {
  open: boolean;
  onClose: () => void;
}

interface DraftBase {
  name: string;
  adapterType: string;
  baseUrl: string;
}

interface Draft {
  bases: DraftBase[];
  apiKey: string;
  credentialLabel: string;
  modelsText: string;
}

const EMPTY_DRAFT: Draft = { bases: [], apiKey: '', credentialLabel: '', modelsText: '' };
const MODEL_SPLIT_RE = /[,;\s]+/;

function buildDraft(parsed: ParsedProviderPackage): Draft {
  const name = parsed.suggestedName ?? '';
  return {
    bases: parsed.bases.map(b => ({
      name:
        parsed.bases.length > 1 && name
          ? `${name} (${b.adapterType === 'anthropic' ? 'Anthropic' : 'OpenAI'})`
          : name || b.url,
      adapterType: b.adapterType,
      baseUrl: b.url,
    })),
    apiKey: parsed.apiKey ?? '',
    credentialLabel: name,
    modelsText: parsed.models.join(', '),
  };
}

export function PastePackageDialog({ open, onClose }: PastePackageDialogProps) {
  const { createEndpoint, createCredential, createUpstreamModel } = useAiGatewayStore();

  const [raw, setRaw] = useState('');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseProviderPackage(raw), [raw]);
  const nothingRecognized = raw.trim().length > 0 && isPackageEmpty(parsed);
  const modelChips = draft.modelsText.split(MODEL_SPLIT_RE).map(s => s.trim()).filter(Boolean);

  const handleRawChange = (value: string) => {
    setRaw(value);
    setDraft(buildDraft(parseProviderPackage(value)));
  };

  const updateBase = (index: number, patch: Partial<DraftBase>) => {
    setDraft(prev => ({
      ...prev,
      bases: prev.bases.map((b, i) => (i === index ? { ...b, ...patch } : b)),
    }));
  };

  const handleClose = () => {
    setRaw('');
    setDraft(EMPTY_DRAFT);
    setError(null);
    setSaving(false);
    onClose();
  };

  const handleConfirm = async () => {
    setSaving(true);
    setError(null);
    try {
      const models = draft.modelsText.split(MODEL_SPLIT_RE).map(s => s.trim()).filter(Boolean);
      const secret = draft.apiKey.trim();
      let endpointsCreated = 0;
      let modelsCreated = 0;
      for (const base of draft.bases) {
        const name = base.name.trim();
        const baseUrl = base.baseUrl.trim();
        if (!name || !baseUrl) continue;
        const endpoint = await createEndpoint({
          name,
          adapterType: base.adapterType,
          baseUrl,
          enabled: true,
        });
        endpointsCreated++;
        if (secret) {
          await createCredential({
            providerEndpointId: endpoint.id,
            label: draft.credentialLabel.trim() || null,
            authType: 'api_key',
            secret,
          });
        }
        for (const model of models) {
          await createUpstreamModel({
            providerEndpointId: endpoint.id,
            upstreamModelId: model,
            enabled: true,
            discoverySource: 'manual',
          });
          modelsCreated++;
        }
      }
      appToast.success(
        t('aiGateway.paste.success', { endpoints: endpointsCreated, models: modelsCreated }),
        'ai-gateway',
      );
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const footer = (
    <div className="flex justify-end gap-3">
      <Button variant="outline" onClick={handleClose} disabled={saving}>
        {t('common.cancel')}
      </Button>
      <Button disabled={saving || draft.bases.length === 0} onClick={handleConfirm}>
        {saving ? t('aiGateway.paste.creating') : t('aiGateway.paste.confirm')}
      </Button>
    </div>
  );

  return (
    <Modal
      isOpen={open}
      onClose={handleClose}
      title={t('aiGateway.paste.title')}
      icon={<ClipboardPaste size={18} />}
      size="md"
      footer={footer}
    >
      <div className="space-y-4">
        <Textarea
          label={t('aiGateway.paste.textareaLabel')}
          placeholder={t('aiGateway.paste.textareaPlaceholder')}
          value={raw}
          onChange={e => handleRawChange(e.target.value)}
          className="min-h-[160px] font-mono text-xs"
        />

        {nothingRecognized && (
          <div className="text-sm text-amber-400">{t('aiGateway.paste.nothingRecognized')}</div>
        )}

        {draft.bases.length > 0 && (
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-slate-200">
              {t('aiGateway.paste.previewTitle')}
            </h4>

            {draft.bases.map((base, i) => (
              <div key={`${base.baseUrl}-${i}`} className="bg-white/5 border border-white/10 rounded-lg p-3 space-y-3">
                <div>
                  <label className="text-sm font-medium">{t('aiGateway.form.name')}</label>
                  <Input value={base.name} onChange={e => updateBase(i, { name: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm font-medium">{t('aiGateway.form.adapterType')}</label>
                  <Select
                    value={base.adapterType}
                    onChange={e => updateBase(i, { adapterType: e.target.value })}
                  >
                    <option value="openai_compatible">{t('aiGateway.form.optOpenai')}</option>
                    <option value="anthropic">{t('aiGateway.form.optAnthropic')}</option>
                    <option value="gemini">{t('aiGateway.form.optGemini')}</option>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">{t('aiGateway.baseUrl')}</label>
                  <Input value={base.baseUrl} onChange={e => updateBase(i, { baseUrl: e.target.value })} />
                </div>
              </div>
            ))}

            <div>
              <label className="text-sm font-medium">{t('aiGateway.paste.apiKey')}</label>
              <Input
                type="password"
                value={draft.apiKey}
                onChange={e => setDraft(prev => ({ ...prev, apiKey: e.target.value }))}
                placeholder={t('aiGateway.cred.phEnter')}
              />
              {!draft.apiKey.trim() && (
                <p className="text-xs text-amber-400 mt-1">{t('aiGateway.paste.noKeyWarning')}</p>
              )}
            </div>

            <div>
              <label className="text-sm font-medium">{t('aiGateway.paste.credentialLabel')}</label>
              <Input
                value={draft.credentialLabel}
                onChange={e => setDraft(prev => ({ ...prev, credentialLabel: e.target.value }))}
                placeholder={t('aiGateway.cred.phLabel')}
              />
            </div>

            <div>
              <label className="text-sm font-medium">{t('aiGateway.paste.modelsLabel')}</label>
              <Input
                value={draft.modelsText}
                onChange={e => setDraft(prev => ({ ...prev, modelsText: e.target.value }))}
              />
              {modelChips.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {modelChips.map(model => (
                    <span
                      key={model}
                      className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 font-mono"
                    >
                      {model}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {error && <div className="text-sm text-red-400">{error}</div>}
          </div>
        )}
      </div>
    </Modal>
  );
}
