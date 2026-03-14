
import type { ProviderModelMapping } from '../../../lib/tauri/modules/aiProxy';
import { AI_PROXY_PROVIDER_FILTERS } from '../providerMeta';
import { t } from '../../../lib/i18n';
import { Button, Input, Modal, Select } from '@/components/ui';

interface AiMappingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  modelMappings: ProviderModelMapping[];
  onAddMapping: () => void;
  onUpsertMapping: (index: number, patch: Partial<ProviderModelMapping>) => void;
  onRemoveMapping: (index: number) => void;
  onSaveMappings: () => Promise<boolean>;
}

export function AiMappingsModal({
  isOpen,
  onClose,
  modelMappings,
  onAddMapping,
  onUpsertMapping,
  onRemoveMapping,
  onSaveMappings,
}: AiMappingsModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('aiHub.modals.mappingsTitle')}
      size="lg"
      footer={
        <div className="flex items-center justify-between">
          <Button variant="secondary" onClick={onAddMapping}>
            {t('aiHub.actions.addMapping')}
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t('aiHub.actions.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                const ok = await onSaveMappings();
                if (ok) onClose();
              }}
            >
              {t('aiHub.actions.save')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {modelMappings.length === 0 ? (
          <p className="text-sm text-slate-400">{t('aiHub.empty.noMappings')}</p>
        ) : (
          modelMappings.map((mapping, index) => (
            <div
              key={`${mapping.modelPattern}-${index}`}
              className="grid grid-cols-12 gap-2 items-center"
            >
              <div className="col-span-5">
                <Input
                  value={mapping.modelPattern}
                  onChange={e => onUpsertMapping(index, { modelPattern: e.target.value })}
                  placeholder={t('aiHub.modals.mappingPatternPlaceholder')}
                />
              </div>
              <div className="col-span-3">
                <Select
                  containerClassName="w-full"
                  className="h-9 py-1 text-sm"
                  value={mapping.provider}
                  onValueChange={value => onUpsertMapping(index, { provider: value })}
                  options={AI_PROXY_PROVIDER_FILTERS.filter(p => p.id !== 'all').map(p => ({
                    value: p.id,
                    label: p.label,
                  }))}
                />
              </div>
              <div className="col-span-3">
                <Input
                  value={mapping.modelId || ''}
                  onChange={e => onUpsertMapping(index, { modelId: e.target.value || null })}
                  placeholder={t('aiHub.modals.mappingTargetPlaceholder')}
                />
              </div>
              <div className="col-span-1 flex justify-end">
                <Button variant="danger" size="xs" onClick={() => onRemoveMapping(index)}>
                  {t('aiHub.table.delete')}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
