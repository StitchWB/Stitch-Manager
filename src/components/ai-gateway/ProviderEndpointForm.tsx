import { useState } from 'react';
import { useAiGatewayStore } from '@/stores/aiGateway';
import type { ProviderEndpoint } from '@/lib/backend/modules/aiGateway';
import { Button } from '@/components/ui';
import { Input, Select, Checkbox, Modal } from '@/components/ui';
import { t } from '@/lib/i18n';

interface ProviderEndpointFormProps {
  endpoint?: ProviderEndpoint | null;
  open: boolean;
  onClose: () => void;
}

const ADAPTER_DEFAULT_URLS: Record<string, string> = {
  openai_compatible: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com',
};

export function ProviderEndpointForm({ endpoint, open, onClose }: ProviderEndpointFormProps) {
  const { createEndpoint, updateEndpoint } = useAiGatewayStore();

  const [name, setName] = useState(endpoint?.name || '');
  const [adapterType, setAdapterType] = useState(endpoint?.adapterType || 'openai_compatible');
  const [baseUrl, setBaseUrl] = useState(endpoint?.baseUrl || '');
  const [enabled, setEnabled] = useState(endpoint?.enabled ?? true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAdapterTypeChange = (value: string) => {
    setAdapterType(value);
    // Only auto-fill if empty or matches a known default (don't overwrite user-typed URLs)
    if (!baseUrl || Object.values(ADAPTER_DEFAULT_URLS).includes(baseUrl)) {
      setBaseUrl(ADAPTER_DEFAULT_URLS[value] || '');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (endpoint) {
        await updateEndpoint({
          id: endpoint.id,
          name,
          adapterType,
          baseUrl,
          enabled,
        });
      } else {
        await createEndpoint({
          name,
          adapterType,
          baseUrl,
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

  return (
    <Modal isOpen={open} onClose={onClose} title={endpoint ? t('aiGateway.form.editEndpointTitle') : t('aiGateway.form.addEndpointTitle')} size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-sm font-medium">{t('aiGateway.form.name')}</label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder={t('aiGateway.form.phName')} required />
        </div>

        <div>
          <label className="text-sm font-medium">{t('aiGateway.form.adapterType')}</label>
          <Select value={adapterType} onChange={e => handleAdapterTypeChange(e.target.value)} required>
            <option value="openai_compatible">{t('aiGateway.form.optOpenai')}</option>
            <option value="anthropic">{t('aiGateway.form.optAnthropic')}</option>
            <option value="gemini">{t('aiGateway.form.optGemini')}</option>
          </Select>
        </div>

        <div>
          <label className="text-sm font-medium">{t('aiGateway.baseUrl')}</label>
          <Input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder={t('aiGateway.form.phBaseUrl')} required />
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox id="enabled" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          <label htmlFor="enabled" className="text-sm font-medium">{t('aiGateway.enabled')}</label>
        </div>

        {error && <div className="text-sm text-red-400">{error}</div>}

        <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
          <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={loading}>
            {loading ? t('aiGateway.cred.saving') : endpoint ? t('aiGateway.cred.update') : t('aiGateway.cred.create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
