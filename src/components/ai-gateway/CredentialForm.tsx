import { useState } from 'react';
import { useAiGatewayStore } from '@/stores/aiGateway';
import type { Credential, ProviderEndpoint } from '@/lib/backend/modules/aiGateway';
import { Button, Input, Select, Checkbox, Modal } from '@/components/ui';
import { t } from '@/lib/i18n';

interface CredentialFormProps {
  endpoint: ProviderEndpoint;
  credential?: Credential | null;
  open: boolean;
  onClose: () => void;
}

export function CredentialForm({ endpoint, credential, open, onClose }: CredentialFormProps) {
  const { createCredential, updateCredential, rotateSecret } = useAiGatewayStore();

  const [label, setLabel] = useState(credential?.label || '');
  const [authType, setAuthType] = useState(credential?.authType || 'api_key');
  const [secret, setSecret] = useState('');
  const [enabled, setEnabled] = useState(credential?.enabled ?? true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);

    try {
      if (credential) {
        await updateCredential({ id: credential.id, label, enabled });
        if (secret) {
          await rotateSecret({ id: credential.id, newSecret: secret });
        }
      } else {
        if (!secret) throw new Error('Secret is required for new credentials');
        await createCredential({ providerEndpointId: endpoint.id, label, authType, secret });
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
        {loading ? t('aiGateway.cred.saving') : credential ? t('aiGateway.cred.update') : t('aiGateway.cred.create')}
      </Button>
    </div>
  );

  return (
    <Modal isOpen={open} onClose={onClose} title={credential ? t('aiGateway.cred.editTitle') : t('aiGateway.cred.addTitle')} size="sm" footer={footer}>
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">{t('aiGateway.cred.labelOptional')}</label>
          <Input value={label} onChange={e => setLabel(e.target.value)} placeholder={t('aiGateway.cred.phLabel')} />
        </div>

        <div>
          <label className="text-sm font-medium">{t('aiGateway.cred.authType')}</label>
          <Select value={authType} onChange={e => setAuthType(e.target.value)} disabled={!!credential} required>
            <option value="api_key">{t('aiGateway.cred.optApiKey')}</option>
            <option value="oauth">{t('aiGateway.cred.optOAuth')}</option>
            <option value="session">{t('aiGateway.cred.optSession')}</option>
          </Select>
        </div>

        <div>
          <label className="text-sm font-medium">
            {credential ? t('aiGateway.cred.secretNew') : t('aiGateway.cred.secret')}
          </label>
          <Input
            type="password"
            value={secret}
            onChange={e => setSecret(e.target.value)}
            placeholder={credential ? t('aiGateway.cred.phKeep') : t('aiGateway.cred.phEnter')}
            required={!credential}
          />
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox id="cred-enabled" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          <label htmlFor="cred-enabled" className="text-sm font-medium">{t('aiGateway.enabled')}</label>
        </div>

        {error && <div className="text-sm text-red-400">{error}</div>}
      </div>
    </Modal>
  );
}
