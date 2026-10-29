import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { ProviderEndpoint } from '@/lib/backend/modules/aiGateway';
import { Badge, Button, Input, Toggle } from '@/components/ui';
import { t } from '@/lib/i18n';

export interface ProviderSettingsPanelProps {
  endpoint: ProviderEndpoint;
  busy: boolean;
  onSave: (patch: { name: string; baseUrl: string; enabled: boolean }) => void;
  onDelete: () => void;
}

interface SettingsForm {
  name: string;
  baseUrl: string;
  enabled: boolean;
}

const CIRCUIT_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'slate'> = {
  closed: 'success',
  half_open: 'warning',
  open: 'danger',
};

export function ProviderSettingsPanel(props: ProviderSettingsPanelProps): JSX.Element {
  const { endpoint, busy, onSave, onDelete } = props;

  const [form, setForm] = useState<SettingsForm>({
    name: endpoint.name,
    baseUrl: endpoint.baseUrl,
    enabled: endpoint.enabled,
  });

  useEffect(() => {
    queueMicrotask(() => {
      setForm({ name: endpoint.name, baseUrl: endpoint.baseUrl, enabled: endpoint.enabled });
    });
  }, [endpoint]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave({ name: form.name, baseUrl: form.baseUrl, enabled: form.enabled });
  };

  return (
    <form onSubmit={handleSubmit} className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">{t('aiHub.providersPage.adapterLabel')}</span>
          <Badge size="sm" variant="outline">{endpoint.adapterType}</Badge>
        </div>
        <Badge size="sm" variant={CIRCUIT_VARIANT[endpoint.circuitState] ?? 'slate'}>
          {endpoint.circuitState}
        </Badge>
        <span className="truncate font-mono text-[11px] text-slate-500">{endpoint.id}</span>
      </div>

      <Input
        label={t('aiHub.providersPage.nameLabel')}
        value={form.name}
        onChange={event => setForm(prev => ({ ...prev, name: event.target.value }))}
        required
      />
      <Input
        label={t('aiHub.providersPage.baseUrlLabel')}
        value={form.baseUrl}
        onChange={event => setForm(prev => ({ ...prev, baseUrl: event.target.value }))}
        required
      />
      <Toggle
        label={t('aiHub.providersPage.enabled')}
        checked={form.enabled}
        onChange={checked => setForm(prev => ({ ...prev, enabled: checked }))}
      />

      <div className="mt-auto flex justify-end pt-2">
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {t('aiHub.providersPage.saveLabel')}
        </Button>
      </div>

      <div className="flex items-center rounded-lg border border-red-500/20 bg-red-500/[0.04] px-3 py-2.5">
        <Button type="button" variant="danger" size="xs" onClick={onDelete}>
          {t('aiHub.providersPage.deleteEndpoint')}
        </Button>
      </div>
    </form>
  );
}