import { useState } from 'react';
import { useAiGatewayStore } from '@/stores/aiGateway';
import type { Credential, ProviderEndpoint } from '@/lib/backend/modules/aiGateway';
import { Button, Input, Select, Checkbox, Modal } from '@/components/ui';

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
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button disabled={loading} onClick={handleSubmit}>
        {loading ? 'Saving...' : credential ? 'Update' : 'Create'}
      </Button>
    </div>
  );

  return (
    <Modal isOpen={open} onClose={onClose} title={credential ? 'Edit Credential' : 'Add Credential'} size="sm" footer={footer}>
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">Label (optional)</label>
          <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g., Production Key" />
        </div>

        <div>
          <label className="text-sm font-medium">Auth Type</label>
          <Select value={authType} onChange={e => setAuthType(e.target.value)} disabled={!!credential} required>
            <option value="api_key">API Key</option>
            <option value="oauth">OAuth</option>
            <option value="session">Session Token</option>
          </Select>
        </div>

        <div>
          <label className="text-sm font-medium">
            {credential ? 'New Secret (leave empty to keep current)' : 'Secret'}
          </label>
          <Input
            type="password"
            value={secret}
            onChange={e => setSecret(e.target.value)}
            placeholder={credential ? 'Leave empty to keep current secret' : 'Enter API key or token'}
            required={!credential}
          />
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox id="cred-enabled" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          <label htmlFor="cred-enabled" className="text-sm font-medium">Enabled</label>
        </div>

        {error && <div className="text-sm text-red-400">{error}</div>}
      </div>
    </Modal>
  );
}
