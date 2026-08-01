import { useState } from 'react';
import { useAiGatewayStore } from '@/stores/aiGateway';
import type { PublicModel } from '@/lib/backend/modules/aiGateway';
import { Button, Input, Textarea, Checkbox, Modal } from '@/components/ui';

interface PublicModelFormProps {
  model?: PublicModel | null;
  open: boolean;
  onClose: () => void;
}

export function PublicModelForm({ model, open, onClose }: PublicModelFormProps) {
  const { createPublicModel, updatePublicModel } = useAiGatewayStore();

  const [id, setId] = useState(model?.id || '');
  const [displayName, setDisplayName] = useState(model?.displayName || '');
  const [contract, setContract] = useState(model?.contract ? JSON.stringify(model.contract, null, 2) : '{}');
  const [enabled, setEnabled] = useState(model?.enabled ?? true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);

    try {
      let parsedContract = null;
      if (contract.trim()) {
        parsedContract = JSON.parse(contract);
      }

      if (model) {
        await updatePublicModel({
          id: model.id,
          displayName: displayName || null,
          contract: parsedContract,
          enabled,
        });
      } else {
        await createPublicModel({
          id,
          displayName: displayName || null,
          contract: parsedContract,
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
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button disabled={loading} onClick={handleSubmit}>
        {loading ? 'Saving...' : model ? 'Update' : 'Create'}
      </Button>
    </div>
  );

  return (
    <Modal isOpen={open} onClose={onClose} title={model ? 'Edit Public Model' : 'Add Public Model'} size="md" footer={footer}>
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">Model ID</label>
          <Input
            value={id}
            onChange={e => setId(e.target.value)}
            placeholder="e.g., gpt-4-turbo"
            disabled={!!model}
            required
          />
          <p className="text-xs text-slate-400 mt-1">Unique identifier exposed to clients</p>
        </div>

        <div>
          <label className="text-sm font-medium">Display Name (optional)</label>
          <Input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="e.g., GPT-4 Turbo" />
        </div>

        <div>
          <label className="text-sm font-medium">Contract (JSON)</label>
          <Textarea
            value={contract}
            onChange={e => setContract(e.target.value)}
            placeholder='{"max_tokens": 4096, "supports_streaming": true}'
            rows={5}
          />
          <p className="text-xs text-slate-400 mt-1">Capabilities and constraints for this model</p>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox id="pub-enabled" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          <label htmlFor="pub-enabled" className="text-sm font-medium">Enabled</label>
        </div>

        {error && <div className="text-sm text-red-400">{error}</div>}
      </div>
    </Modal>
  );
}
