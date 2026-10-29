import { useState, useEffect, useMemo } from 'react';
import { t } from '@/lib/i18n';
import { useAiGatewayStore } from '@/stores/aiGateway';
import type { RouteTarget, PublicModel } from '@/lib/backend/modules/aiGateway';
import { Button, Input, Checkbox, Modal, Select } from '@/components/ui';

interface RouteTargetFormProps {
  publicModel: PublicModel;
  target?: RouteTarget | null;
  open: boolean;
  onClose: () => void;
}

export function RouteTargetForm({ publicModel, target, open, onClose }: RouteTargetFormProps) {
  const { createRouteTarget, updateRouteTarget, upstreamModels, endpoints, fetchUpstreamModels, fetchEndpoints } = useAiGatewayStore();

  const [upstreamModelId, setUpstreamModelId] = useState(target?.upstreamModelId || '');
  const [priority, setPriority] = useState(target?.priority ?? 100);
  const [weight, setWeight] = useState(target?.weight ?? 1.0);
  const [costModifier, setCostModifier] = useState(target?.costModifier ?? 1.0);
  const [enabled, setEnabled] = useState(target?.enabled ?? true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      fetchUpstreamModels();
      fetchEndpoints();
    }
  }, [open, fetchUpstreamModels, fetchEndpoints]);

  // Group upstream models by provider endpoint name
  const groupedModels = useMemo(() => {
    const groups: Record<string, { endpointName: string; models: typeof upstreamModels }> = {};
    for (const model of upstreamModels) {
      const ep = endpoints.find(e => e.id === model.providerEndpointId);
      const name = ep?.name || model.providerEndpointId.slice(0, 8);
      if (!groups[model.providerEndpointId]) {
        groups[model.providerEndpointId] = { endpointName: name, models: [] };
      }
      groups[model.providerEndpointId].models.push(model);
    }
    return Object.values(groups);
  }, [upstreamModels, endpoints]);

  const handleSubmit = async () => {
    if (isNaN(priority)) { setError(t('aiGateway.form.priorityNotNumber')); return; }
    if (isNaN(weight)) { setError(t('aiGateway.form.weightNotNumber')); return; }
    if (isNaN(costModifier)) { setError(t('aiGateway.form.costModifierNotNumber')); return; }
    if (priority < 0) { setError(t('aiGateway.form.priorityNonNegative')); return; }
    if (weight < 0) { setError(t('aiGateway.form.weightNonNegative')); return; }
    if (costModifier < 0) { setError(t('aiGateway.form.costModifierNonNegative')); return; }
    setLoading(true);
    setError(null);

    try {
      if (target) {
        await updateRouteTarget({
          id: target.id,
          priority,
          weight,
          costModifier,
          enabled,
        });
      } else {
        await createRouteTarget({
          publicModelId: publicModel.id,
          upstreamModelId,
          priority,
          weight,
          costModifier,
          enabled,
        });
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
      <Button disabled={loading} onClick={handleSubmit}>
        {loading ? t('aiGateway.cred.saving') : target ? t('aiGateway.cred.update') : t('aiGateway.cred.create')}
      </Button>
    </div>
  );

  return (
    <Modal isOpen={open} onClose={onClose} title={target ? t('aiGateway.form.editRouteTargetTitle') : t('aiGateway.form.addRouteTargetTitle')} size="sm" footer={footer}>
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">{t('aiGateway.form.upstreamModel')}</label>
          <Select
            value={upstreamModelId}
            onChange={e => setUpstreamModelId(e.target.value)}
            disabled={!!target}
            required
          >
            <option value="">{t('aiGateway.form.selectUpstream')}</option>
            {groupedModels.flatMap(group =>
              group.models.map(model => (
                <option key={model.id} value={model.id}>
                  {group.endpointName} / {model.displayName || model.upstreamModelId}
                </option>
              ))
            )}
          </Select>
        </div>

        <div>
          <label className="text-sm font-medium">{t('aiGateway.form.priority')}</label>
          <Input
            type="number"
            value={priority}
            onChange={e => setPriority(Number(e.target.value))}
            min={0}
            required
          />
          <p className="text-xs text-slate-400 mt-1">{t('aiGateway.form.priorityHint')}</p>
        </div>

        <div>
          <label className="text-sm font-medium">{t('aiGateway.form.weight')}</label>
          <Input
            type="number"
            value={weight}
            onChange={e => setWeight(Number(e.target.value))}
            min={0}
            step={0.1}
            required
          />
          <p className="text-xs text-slate-400 mt-1">{t('aiGateway.form.weightHint')}</p>
        </div>

        <div>
          <label className="text-sm font-medium">{t('aiGateway.form.costModifier')}</label>
          <Input
            type="number"
            value={costModifier}
            onChange={e => setCostModifier(Number(e.target.value))}
            min={0}
            step={0.1}
            required
          />
          <p className="text-xs text-slate-400 mt-1">{t('aiGateway.form.costHint')}</p>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox id="target-enabled" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          <label htmlFor="target-enabled" className="text-sm font-medium">{t('aiGateway.enabled')}</label>
        </div>

        {error && <div className="text-sm text-red-400">{error}</div>}
      </div>
    </Modal>
  );
}
