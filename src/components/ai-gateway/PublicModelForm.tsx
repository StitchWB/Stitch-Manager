import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';
import { useAiGatewayStore } from '@/stores/aiGateway';
import type { PublicModel } from '@/lib/backend/modules/aiGateway';
import { Button, ButtonBase, Input, Textarea, Checkbox, Modal, Select } from '@/components/ui';

export interface PublicModelPrefill {
  id?: string;
  upstreamModelId?: string;
}

interface PublicModelFormProps {
  model?: PublicModel | null;
  prefill?: PublicModelPrefill | null;
  open: boolean;
  onClose: () => void;
  onCreated?: (publicModelId: string) => void;
}

interface RouteRow {
  endpointId: string;
  upstreamModelId: string;
  priority: number;
  weight: number;
}

const emptyRow = (): RouteRow => ({ endpointId: '', upstreamModelId: '', priority: 100, weight: 1 });

export function PublicModelForm({ model, prefill, open, onClose, onCreated }: PublicModelFormProps) {
  const {
    createPublicModel,
    updatePublicModel,
    createRouteTarget,
    upstreamModels,
    endpoints,
    fetchUpstreamModels,
    fetchEndpoints,
  } = useAiGatewayStore();

  const [id, setId] = useState(model?.id ?? prefill?.id ?? '');
  const [displayName, setDisplayName] = useState(model?.displayName ?? '');
  const [contract, setContract] = useState(model?.contract ? JSON.stringify(model.contract, null, 2) : '');
  const [enabled, setEnabled] = useState(model?.enabled ?? true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [routes, setRoutes] = useState<RouteRow[]>(
    model ? [] : [{ ...emptyRow(), upstreamModelId: prefill?.upstreamModelId ?? '' }],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      fetchUpstreamModels();
      fetchEndpoints();
    }
  }, [open, fetchUpstreamModels, fetchEndpoints]);

  const defaultUpstreamId = upstreamModels[0]?.id ?? '';
  const effectiveRoutes = routes.map(row =>
    row.upstreamModelId || row.endpointId ? row : { ...row, upstreamModelId: defaultUpstreamId },
  );

  const endpointIdFor = (row: RouteRow): string =>
    row.endpointId ||
    upstreamModels.find(m => m.id === row.upstreamModelId)?.providerEndpointId ||
    '';

  const updateRow = (index: number, patch: Partial<RouteRow>) => {
    setRoutes(prev => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);

    try {
      const parsedContract = contract.trim() ? JSON.parse(contract) : null;
      const payload = {
        displayName: displayName.trim() || null,
        contract: parsedContract,
        enabled,
      };

      if (model) {
        await updatePublicModel({ id: model.id, ...payload });
      } else {
        const created = await createPublicModel({ id: id.trim(), ...payload });
        for (const row of effectiveRoutes) {
          if (!row.upstreamModelId) continue;
          await createRouteTarget({
            publicModelId: created.id,
            upstreamModelId: row.upstreamModelId,
            priority: row.priority,
            weight: row.weight,
            costModifier: 1,
            enabled: true,
          });
        }
        toast.success(t('aiGateway.form.publicModelCreated', { id: created.id }));
        onCreated?.(created.id);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const footer = (
    <div className="flex justify-end gap-3">
      <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
      <Button disabled={loading || (!model && !id.trim())} onClick={handleSubmit}>
        {loading ? t('aiGateway.cred.saving') : model ? t('aiGateway.cred.update') : t('aiGateway.cred.create')}
      </Button>
    </div>
  );

  return (
    <Modal isOpen={open} onClose={onClose} title={model ? t('aiGateway.form.editPublicModelTitle') : t('aiGateway.form.addPublicModelTitle')} size="md" footer={footer}>
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">{t('aiGateway.form.modelName')}</label>
          <Input
            value={id}
            onChange={e => setId(e.target.value)}
            placeholder="gpt-4o-mini"
            disabled={!!model}
            required
          />
          <p className="text-xs text-slate-400 mt-1">{t('aiGateway.form.modelNameHint')}</p>
        </div>

        <div>
          <label className="text-sm font-medium">{t('aiGateway.form.displayName')}</label>
          <Input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="e.g., GPT-4 Turbo" />
        </div>

        {!model && (
          <div>
            <label className="text-sm font-medium">{t('aiGateway.form.routes')}</label>
            <p className="text-xs text-slate-400 mt-0.5 mb-2">{t('aiGateway.form.routesHint')}</p>
            <div className="grid grid-cols-[minmax(96px,1fr)_minmax(0,1.5fr)_84px_52px_28px] items-center gap-1.5 text-[10px] uppercase text-slate-500">
              <span>{t('aiGateway.form.providerColumn')}</span>
              <span>{t('aiGateway.form.upstreamModel')}</span>
              <span>{t('aiGateway.form.priority')}</span>
              <span>{t('aiGateway.form.weight')}</span>
              <span />
            </div>
            <div className="mt-1 space-y-1.5">
              {effectiveRoutes.map((row, index) => {
                const rowEndpointId = endpointIdFor(row);
                return (
                  <div
                    key={index}
                    className="grid grid-cols-[minmax(96px,1fr)_minmax(0,1.5fr)_84px_52px_28px] items-center gap-1.5"
                  >
                    <Select
                      value={rowEndpointId}
                      onChange={e => updateRow(index, { endpointId: e.target.value, upstreamModelId: '' })}
                      aria-label={t('aiGateway.form.providerColumn')}
                      containerClassName="min-w-0"
                    >
                      <option value="">{t('aiGateway.form.selectEndpoint')}</option>
                      {endpoints.map(ep => (
                        <option key={ep.id} value={ep.id}>{ep.name}</option>
                      ))}
                    </Select>
                    <Select
                      value={row.upstreamModelId}
                      onChange={e => updateRow(index, { endpointId: rowEndpointId, upstreamModelId: e.target.value })}
                      aria-label={t('aiGateway.form.upstreamModel')}
                      containerClassName="min-w-0"
                    >
                      <option value="">{t('aiGateway.form.selectUpstream')}</option>
                      {upstreamModels
                        .filter(m => m.providerEndpointId === rowEndpointId)
                        .map(m => (
                          <option key={m.id} value={m.id}>
                            {m.displayName || m.upstreamModelId}
                          </option>
                        ))}
                    </Select>
                    <Input
                      type="number"
                      value={row.priority}
                      onChange={e => updateRow(index, { priority: Number(e.target.value) })}
                      aria-label={t('aiGateway.form.priority')}
                      title={t('aiGateway.form.priority')}
                      min={0}
                      containerClassName="w-full"
                    />
                    <Input
                      type="number"
                      value={row.weight}
                      onChange={e => updateRow(index, { weight: Number(e.target.value) })}
                      aria-label={t('aiGateway.form.weight')}
                      title={t('aiGateway.form.weight')}
                      min={0}
                      step={0.1}
                      containerClassName="w-full"
                    />
                    <ButtonBase
                      type="button"
                      aria-label={t('common.delete')}
                      onClick={() => setRoutes(prev => prev.filter((_, i) => i !== index))}
                      className="justify-self-center rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/[0.04] hover:text-red-300"
                    >
                      <X size={14} />
                    </ButtonBase>
                  </div>
                );
              })}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="mt-2"
              onClick={() => setRoutes(prev => [...prev, emptyRow()])}
            >
              <Plus size={12} className="mr-1" />
              {t('aiGateway.form.addRoute')}
            </Button>
          </div>
        )}

        <div className="flex items-center space-x-2">
          <Checkbox id="pub-enabled" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          <label htmlFor="pub-enabled" className="text-sm font-medium">{t('aiGateway.enabled')}</label>
        </div>

        <div>
          <ButtonBase
            type="button"
            onClick={() => setShowAdvanced(prev => !prev)}
            aria-expanded={showAdvanced}
            className="flex items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium text-slate-400 transition-colors hover:text-slate-200"
          >
            {showAdvanced ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {t('aiGateway.form.advanced')}
          </ButtonBase>
          {showAdvanced && (
            <div className="mt-2">
              <label className="text-sm font-medium">{t('aiGateway.form.contract')}</label>
              <Textarea
                value={contract}
                onChange={e => setContract(e.target.value)}
                placeholder='{"max_tokens": 4096, "supports_streaming": true}'
                rows={5}
              />
              <p className="text-xs text-slate-400 mt-1">{t('aiGateway.form.contractHint')}</p>
            </div>
          )}
        </div>

        {error && <div className="text-sm text-red-400">{error}</div>}
      </div>
    </Modal>
  );
}
