import { useState } from 'react';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  GlassCard, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
  Button, Badge, EmptyState, ConfirmActionButton, Toggle,
} from '@/components/ui';
import type { ProviderConfig } from '@/lib/backend/modules/opencodeConfig';
import { ProviderEditorModal } from './ProviderEditorModal';

interface ProvidersSectionProps {
  providers: Record<string, ProviderConfig>;
  disabledProviders: string[];
  onChange: (providers: Record<string, ProviderConfig>) => void;
  onToggleEnabled: (providerId: string, enabled: boolean) => void;
}

export function ProvidersSection({
  providers,
  disabledProviders,
  onChange,
  onToggleEnabled,
}: ProvidersSectionProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);


  const providerIds = Object.keys(providers);

  const handleSave = (id: string, provider: ProviderConfig) => {
    onChange({ ...providers, [id]: provider });
    toast.success('Provider saved');
  };

  const handleDelete = (id: string) => {
    const next = { ...providers };
    delete next[id];
    onChange(next);
    toast.success('Provider deleted');
  };

  if (providerIds.length === 0) {
    return (
      <EmptyState
        icon={Plus}
        title="No providers configured"
        description="Add your first provider to get started"
        action={
          <Button onClick={() => { setEditingId(null); setIsModalOpen(true); }}>
            <Plus className="w-4 h-4" /> Add Provider
          </Button>
        }
      />
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Providers</h3>
          <p className="text-sm text-vsc-text-muted">
            {providerIds.length} configured, {providerIds.length - disabledProviders.length} enabled
          </p>
        </div>
        <Button onClick={() => { setEditingId(null); setIsModalOpen(true); }}>
          <Plus className="w-4 h-4" /> Add Provider
        </Button>
      </div>

      <GlassCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Enabled</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Base URL</TableHead>
              <TableHead>Models</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {providerIds.map(id => {
              const p = providers[id];
              const modelCount = Object.keys(p.models || {}).length;
              const enabled = !disabledProviders.includes(id);
              return (
                <TableRow key={id}>
                  <TableCell>
                    <Toggle
                      label=""
                      size="sm"
                      checked={enabled}
                      onChange={(v) => onToggleEnabled(id, v)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className={enabled ? '' : 'opacity-50'}>
                      <div className="font-medium">{p.name || id}</div>
                      <div className="text-xs text-vsc-text-muted">{id}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm truncate max-w-xs">{p.options?.baseURL || '—'}</div>
                  </TableCell>
                  <TableCell>
                    <Badge size="sm">{modelCount}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => { setEditingId(id); setIsModalOpen(true); }}
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <ConfirmActionButton
                        iconOnly
                        variant="ghost"
                        size="sm"
                        armedLabel={<Trash2 className="w-4 h-4" />}
                        onConfirm={() => handleDelete(id)}>
                        <Trash2 className="w-4 h-4" />
                      </ConfirmActionButton>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </GlassCard>

      <ProviderEditorModal
        isOpen={isModalOpen}
        providerId={editingId}
        provider={editingId ? providers[editingId] : null}
        onSave={handleSave}
        onClose={() => setIsModalOpen(false)}
      />

    </>
  );
}
