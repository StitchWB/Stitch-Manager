import type { ProviderModelMapping } from '../../../lib/tauri/modules/aiProxy';
import { AI_PROXY_PROVIDER_FILTERS } from '../providerMeta';
import { t } from '@/lib/i18n';
import { Button, EmptyState, GlassCard, IconButton, Input, Select, Tooltip } from '@/components/ui';
import { Layers, Trash2 } from 'lucide-react';

interface MappingsEditorProps {
  modelMappings: ProviderModelMapping[];
  onAddMapping: () => void;
  onUpsertMapping: (index: number, patch: Partial<ProviderModelMapping>) => void;
  onRemoveMapping: (index: number) => void;
  onSaveMappings: () => Promise<boolean> | boolean | void;
}

export function MappingsEditor({
  modelMappings,
  onAddMapping,
  onUpsertMapping,
  onRemoveMapping,
  onSaveMappings,
}: MappingsEditorProps) {
  const isEmpty = modelMappings.length === 0;

  return (
    <GlassCard className="mb-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white">
            {t('aiHub.modals.mappingsTitle')}
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            {t('aiHub.integrations.mappingsHint')}
          </p>
        </div>
        {!isEmpty && (
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="secondary" size="sm" onClick={onAddMapping}>
              {t('aiHub.actions.addMapping')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                void onSaveMappings();
              }}
            >
              {t('aiHub.actions.save')}
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {isEmpty ? (
          <EmptyState
            compact
            icon={Layers}
            title={t('aiHub.empty.noMappings')}
            action={
              <Button variant="primary" size="xs" onClick={onAddMapping}>
                {t('aiHub.actions.addMapping')}
              </Button>
            }
          />
        ) : (
          modelMappings.map((mapping, index) => (
            <div
              key={`${mapping.modelPattern}-${index}`}
              className="grid grid-cols-12 gap-2 items-center"
            >
              <div className="col-span-12 md:col-span-5">
                <Input
                  value={mapping.modelPattern}
                  onChange={e =>
                    onUpsertMapping(index, { modelPattern: e.target.value })
                  }
                  placeholder={t('aiHub.modals.mappingPatternPlaceholder')}
                />
              </div>
              <div className="col-span-6 md:col-span-3">
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
              <div className="col-span-5 md:col-span-3">
                <Input
                  value={mapping.modelId || ''}
                  onChange={e =>
                    onUpsertMapping(index, { modelId: e.target.value || null })
                  }
                  placeholder={t('aiHub.modals.mappingTargetPlaceholder')}
                />
              </div>
              <div className="col-span-1 flex justify-end">
                <Tooltip content={t('aiHub.table.delete')}>
                  <IconButton
                    variant="danger"
                    size="sm"
                    onClick={() => onRemoveMapping(index)}
                    aria-label={t('aiHub.table.delete')}
                  >
                    <Trash2 size={14} />
                  </IconButton>
                </Tooltip>
              </div>
            </div>
          ))
        )}
      </div>
    </GlassCard>
  );
}
