import { useMemo, useState } from 'react';
import { ClipboardPaste, CheckCircle2, XCircle, KeyRound, Globe, Boxes } from 'lucide-react';
import { useAiGatewayStore } from '@/stores/aiGateway';
import { discoverModelsForEndpoint } from '@/lib/backend/modules/aiGateway';
import {
  parseProviderPackage,
  isPackageEmpty,
  type ParsedPackageBase,
} from '@/lib/providerPackageParser';
import { Button, Input, Textarea, Modal, Badge, Checkbox } from '@/components/ui';
import { useNavigate } from 'react-router-dom';

import { appToast } from '@/lib/observability/toast';
import { t } from '@/lib/i18n';

interface PastePackageDialogProps {
  open: boolean;
  onClose: () => void;
}

function maskKey(key: string): string {
  if (key.length <= 12) return `${key.slice(0, 2)}…`;
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

function endpointName(baseName: string, base: ParsedPackageBase, multi: boolean): string {
  if (!multi) return baseName || base.url;
  const suffix = base.adapterType === 'anthropic' ? 'Anthropic' : 'OpenAI';
  return baseName ? `${baseName} (${suffix})` : base.url;
}

function SummaryRow({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-sm min-w-0">
      <span className="shrink-0">{icon}</span>
      {children}
    </div>
  );
}

export function PastePackageDialog({ open, onClose }: PastePackageDialogProps) {
  const navigate = useNavigate();
  const { createEndpoint, createCredential, createUpstreamModel } = useAiGatewayStore();

  const [raw, setRaw] = useState('');
  const [keyOverride, setKeyOverride] = useState('');
  const [alsoAnthropic, setAlsoAnthropic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseProviderPackage(raw), [raw]);
  const hasInput = raw.trim().length > 0;
  const nothingRecognized = hasInput && isPackageEmpty(parsed);

  const openaiBases = parsed.bases.filter(b => b.adapterType !== 'anthropic');
  const anthropicBases = parsed.bases.filter(b => b.adapterType === 'anthropic');
  const primaryBases = openaiBases.length > 0 ? openaiBases : anthropicBases;
  const hasAnthropicOption = openaiBases.length > 0 && anthropicBases.length > 0;

  const apiKey = parsed.apiKey ?? keyOverride.trim();
  const baseName = parsed.suggestedName ?? '';
  const canConfirm = primaryBases.length > 0;

  const handleClose = () => {
    setRaw('');
    setKeyOverride('');
    setAlsoAnthropic(false);
    setError(null);
    setSaving(false);
    onClose();
  };

  const handleConfirm = async () => {
    setSaving(true);
    setError(null);
    try {
      const basesToCreate =
        alsoAnthropic && hasAnthropicOption ? [...primaryBases, ...anthropicBases] : primaryBases;
      const multi = basesToCreate.length > 1;
      const secret = apiKey.trim();
      let endpointsCreated = 0;
      let modelsDiscovered = 0;
      let discoveryOk = false;

      for (const base of basesToCreate) {
        const endpoint = await createEndpoint({
          name: endpointName(baseName, base, multi),
          adapterType: base.adapterType,
          baseUrl: base.url,
          enabled: true,
        });
        endpointsCreated++;
        if (secret) {
          await createCredential({
            providerEndpointId: endpoint.id,
            label: baseName || null,
            authType: 'api_key',
            secret,
          });
        }
        for (const model of parsed.models) {
          await createUpstreamModel({
            providerEndpointId: endpoint.id,
            upstreamModelId: model,
            enabled: true,
            discoverySource: 'manual',
          });
        }
        try {
          const result = await discoverModelsForEndpoint(endpoint.id);
          modelsDiscovered += result.models_count ?? 0;
          discoveryOk = true;
        } catch {
          // models will be picked up by the next discovery sync
        }
      }

      appToast.success(
        discoveryOk
          ? t('aiGateway.paste.success', {
              endpoints: endpointsCreated,
              models: modelsDiscovered,
            })
          : t('aiGateway.paste.successPending', { endpoints: endpointsCreated }),
        'ai-gateway',
      );
      handleClose();
      // Land the user where the created endpoints live — "where did it go"
      // is answered by navigation, not by a toast.
      navigate('/ai/providers');
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
      <Button disabled={saving || !canConfirm} onClick={handleConfirm}>
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
          onChange={e => setRaw(e.target.value)}
          className="min-h-[140px] font-mono text-xs"
        />

        {nothingRecognized && (
          <div className="text-sm text-amber-400">{t('aiGateway.paste.nothingRecognized')}</div>
        )}

        {canConfirm && (
          <div className="bg-white/5 border border-white/10 rounded-lg p-3 space-y-2.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t('aiGateway.paste.summaryTitle')}
            </h4>

            {apiKey ? (
              <SummaryRow icon={<CheckCircle2 size={15} className="text-emerald-400" />}>
                <KeyRound size={13} className="text-slate-500 shrink-0" />
                <span className="text-slate-400">{t('aiGateway.paste.apiKey')}</span>
                <span className="font-mono text-xs text-slate-200" data-testid="key-masked">
                  {maskKey(apiKey)}
                </span>
              </SummaryRow>
            ) : (
              <SummaryRow icon={<XCircle size={15} className="text-amber-400" />}>
                <KeyRound size={13} className="text-slate-500 shrink-0" />
                <span className="text-slate-400 shrink-0">{t('aiGateway.paste.apiKey')}</span>
                <Input
                  type="password"
                  value={keyOverride}
                  onChange={e => setKeyOverride(e.target.value)}
                  placeholder={t('aiGateway.paste.keyMissing')}
                  containerClassName="flex-1 min-w-0"
                  className="text-xs"
                />
              </SummaryRow>
            )}

            {primaryBases.map(base => (
              <SummaryRow
                key={base.url}
                icon={<CheckCircle2 size={15} className="text-emerald-400" />}
              >
                <Globe size={13} className="text-slate-500 shrink-0" />
                <span className="font-mono text-xs text-slate-200 truncate" title={base.url}>
                  {base.url}
                </span>
                <Badge variant="indigo" size="sm" className="shrink-0">
                  {base.adapterType === 'anthropic'
                    ? t('aiGateway.paste.adapterAnthropic')
                    : t('aiGateway.paste.adapterOpenai')}
                </Badge>
              </SummaryRow>
            ))}

            {hasAnthropicOption && (
              <div className="pl-[23px]">
                <Checkbox
                  checked={alsoAnthropic}
                  onChange={e => setAlsoAnthropic(e.target.checked)}
                  label={
                    <span className="text-xs text-slate-400">
                      {t('aiGateway.paste.alsoAnthropic')}
                    </span>
                  }
                  className="py-0.5 px-0"
                />
                {alsoAnthropic &&
                  anthropicBases.map(base => (
                    <SummaryRow
                      key={base.url}
                      icon={<CheckCircle2 size={15} className="text-emerald-400" />}
                    >
                      <Globe size={13} className="text-slate-500 shrink-0" />
                      <span className="font-mono text-xs text-slate-200 truncate" title={base.url}>
                        {base.url}
                      </span>
                      <Badge variant="indigo" size="sm" className="shrink-0">
                        {t('aiGateway.paste.adapterAnthropic')}
                      </Badge>
                    </SummaryRow>
                  ))}
              </div>
            )}

            <SummaryRow
              icon={
                parsed.models.length > 0 ? (
                  <CheckCircle2 size={15} className="text-emerald-400" />
                ) : (
                  <CheckCircle2 size={15} className="text-sky-400" />
                )
              }
            >
              <Boxes size={13} className="text-slate-500 shrink-0" />
              <span className="text-slate-400 shrink-0">{t('aiGateway.paste.modelsLabel')}</span>
              {parsed.models.length > 0 ? (
                <span className="text-xs text-slate-200 truncate" title={parsed.models.join(', ')}>
                  {t('aiGateway.paste.modelsFound', { count: parsed.models.length })}
                  <span className="font-mono text-slate-400 ml-1.5">
                    {parsed.models.join(', ')}
                  </span>
                </span>
              ) : (
                <span className="text-xs text-sky-300">{t('aiGateway.paste.modelsAuto')}</span>
              )}
            </SummaryRow>

            {error && <div className="text-sm text-red-400">{error}</div>}
          </div>
        )}
      </div>
    </Modal>
  );
}
