import { useState } from 'react';
import { t } from '@/lib/i18n';
import { useAiGatewayStore } from '@/stores/aiGateway';
import type { UpstreamModel, ProviderEndpoint } from '@/lib/backend/modules/aiGateway';
import { Button, Input, Checkbox, Modal } from '@/components/ui';

interface UpstreamModelFormProps {
  endpoint: ProviderEndpoint;
  model?: UpstreamModel | null;
  open: boolean;
  onClose: () => void;
}

export function UpstreamModelForm({ endpoint, model, open, onClose }: UpstreamModelFormProps) {
  const { createUpstreamModel, updateUpstreamModel } = useAiGatewayStore();

  const [upstreamModelId, setUpstreamModelId] = useState(model?.upstreamModelId || '');
  const [displayName, setDisplayName] = useState(model?.displayName || '');
  const [enabled, setEnabled] = useState(model?.enabled ?? true);
  const capBool = (v: unknown, fallback: boolean) => (v === undefined ? fallback : Boolean(v));
  const [supportsVision, setSupportsVision] = useState(capBool(model?.capabilities?.supports_vision, false));
  const [supportsTools, setSupportsTools] = useState(capBool(model?.capabilities?.supports_tools, false));
  const [supportsStreaming, setSupportsStreaming] = useState(capBool(model?.capabilities?.supports_streaming, true));
  const [supportsJsonMode, setSupportsJsonMode] = useState(capBool(model?.capabilities?.supports_json_mode, false));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);

    try {
      const capabilities = {
        supports_vision: supportsVision,
        supports_tools: supportsTools,
        supports_streaming: supportsStreaming,
        supports_json_mode: supportsJsonMode,
      };

      if (model) {
        await updateUpstreamModel({
          id: model.id,
          displayName: displayName || null,
          enabled,
          capabilities,
        });
      } else {
        await createUpstreamModel({
          providerEndpointId: endpoint.id,
          upstreamModelId,
          displayName: displayName || null,
          enabled,
          discoverySource: 'manual',
          capabilities,
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
        {loading ? 'Saving...' : model ? 'Update' : 'Create'}
      </Button>
    </div>
  );

  return (
    <Modal isOpen={open} onClose={onClose} title={model ? 'Edit Upstream Model' : 'Add Upstream Model'} size="sm" footer={footer}>
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">{t('aiGateway.form.upstreamModelId')}</label>
          <Input
            value={upstreamModelId}
            onChange={e => setUpstreamModelId(e.target.value)}
            placeholder="e.g., gpt-4-turbo-preview"
            disabled={!!model}
            required
          />
        </div>

        <div>
          <label className="text-sm font-medium">{t('aiGateway.form.displayName')}</label>
          <Input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="e.g., GPT-4 Turbo" />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">{t('aiGateway.form.capabilities')}</label>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center space-x-2">
              <Checkbox id="vision" checked={supportsVision} onChange={e => setSupportsVision(e.target.checked)} />
              <label htmlFor="vision" className="text-sm">{t('aiGateway.form.vision')}</label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox id="tools" checked={supportsTools} onChange={e => setSupportsTools(e.target.checked)} />
              <label htmlFor="tools" className="text-sm">{t('aiGateway.form.tools')}</label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox id="streaming" checked={supportsStreaming} onChange={e => setSupportsStreaming(e.target.checked)} />
              <label htmlFor="streaming" className="text-sm">{t('aiGateway.form.streaming')}</label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox id="json" checked={supportsJsonMode} onChange={e => setSupportsJsonMode(e.target.checked)} />
              <label htmlFor="json" className="text-sm">{t('aiGateway.form.jsonMode')}</label>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox id="model-enabled" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          <label htmlFor="model-enabled" className="text-sm font-medium">{t('aiGateway.enabled')}</label>
        </div>

        {error && <div className="text-sm text-red-400">{error}</div>}
      </div>
    </Modal>
  );
}
