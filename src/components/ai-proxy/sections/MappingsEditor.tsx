import { ArrowDown, ArrowRight, Layers, Plus, Save, Trash2 } from 'lucide-react';

import type { ProviderModelMapping } from '../../../lib/tauri/modules/aiProxy';
import { AI_PROXY_PROVIDER_FILTERS } from '../providerMeta';
import { t } from '@/lib/i18n';
import { useAppStore } from '@/stores/app';
import { Badge, Button, EmptyState, GlassCard, IconButton, Input, Select, Tooltip } from '@/components/ui';

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
  const isRu = useAppStore(state => state.language) === 'ru';
  const copy = isRu
    ? {
      eyebrow: 'Правила маршрутизации',
      description:
        'Сопоставьте запрашиваемую модель с провайдером и, при необходимости, замените имя целевой модели.',
      rule: 'Правило',
      rules: 'правил',
      requestPattern: 'Модель в запросе',
      requestHint: 'Поддерживаются точные имена и шаблоны',
      target: 'Куда направить',
      provider: 'Провайдер',
      targetModel: 'Целевая модель',
      optional: 'Необязательно — оставьте пустым, чтобы сохранить исходное имя',
      removeRule: 'Удалить правило',
    }
    : {
      eyebrow: 'Routing rules',
      description:
        'Map the requested model to a provider and optionally replace the target model name.',
      rule: 'Rule',
      rules: 'rules',
      requestPattern: 'Requested model',
      requestHint: 'Exact names and patterns are supported',
      target: 'Route to',
      provider: 'Provider',
      targetModel: 'Target model',
      optional: 'Optional — leave empty to preserve the requested model name',
      removeRule: 'Remove rule',
    };

  const providerOptions = AI_PROXY_PROVIDER_FILTERS.filter(provider => provider.id !== 'all').map(
    provider => ({ value: provider.id, label: provider.label })
  );

  return (
    <GlassCard className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-white/[0.06] px-4 py-4 md:flex-row md:items-start md:justify-between md:px-5">
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-violet-300/70">
            {copy.eyebrow}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-white">{t('aiHub.modals.mappingsTitle')}</h3>
            {!isEmpty && (
              <Badge variant="default" size="sm" className="font-normal normal-case tabular-nums text-slate-400">
                {modelMappings.length} {copy.rules}
              </Badge>
            )}
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">{copy.description}</p>
        </div>

        {!isEmpty && (
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={onAddMapping}
              leftIcon={<Plus size={13} />}
            >
              {t('aiHub.actions.addMapping')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                void onSaveMappings();
              }}
              leftIcon={<Save size={13} />}
            >
              {t('aiHub.actions.save')}
            </Button>
          </div>
        )}
      </div>

      <div className="p-3 md:p-4">
        {isEmpty ? (
          <EmptyState
            compact
            icon={Layers}
            title={t('aiHub.empty.noMappings')}
            description={copy.description}
            action={
              <Button
                variant="primary"
                size="xs"
                onClick={onAddMapping}
                leftIcon={<Plus size={12} />}
              >
                {t('aiHub.actions.addMapping')}
              </Button>
            }
          />
        ) : (
          <div className="space-y-2.5">
            {modelMappings.map((mapping, index) => (
              <div
                key={`${mapping.modelPattern}-${index}`}
                className="rounded-xl border border-white/[0.07] bg-vsc-bg/45 p-3 transition-colors hover:border-violet-400/15 md:p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-violet-400/15 bg-violet-500/[0.08] text-[11px] font-semibold tabular-nums text-violet-300">
                    {String(index + 1).padStart(2, '0')}
                  </div>

                  <div className="grid min-w-0 flex-1 gap-3 xl:grid-cols-[minmax(220px,1fr)_28px_minmax(360px,1.35fr)] xl:items-start">
                    <div className="min-w-0">
                      <Input
                        label={copy.requestPattern}
                        value={mapping.modelPattern}
                        onChange={event =>
                          onUpsertMapping(index, { modelPattern: event.target.value })
                        }
                        placeholder={t('aiHub.modals.mappingPatternPlaceholder')}
                        hint={copy.requestHint}
                      />
                    </div>

                    <div className="flex items-center justify-center pt-0 text-slate-600 xl:pt-7">
                      <ArrowDown size={15} className="xl:hidden" aria-hidden="true" />
                      <ArrowRight size={15} className="hidden xl:block" aria-hidden="true" />
                    </div>

                    <div className="min-w-0">
                      <div className="mb-1.5 text-xs font-medium text-slate-300">{copy.target}</div>
                      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                        <Select
                          label={copy.provider}
                          containerClassName="w-full min-w-0"
                          value={mapping.provider}
                          onValueChange={value => onUpsertMapping(index, { provider: value })}
                          options={providerOptions}
                        />
                        <Input
                          label={copy.targetModel}
                          value={mapping.modelId || ''}
                          onChange={event =>
                            onUpsertMapping(index, { modelId: event.target.value || null })
                          }
                          placeholder={t('aiHub.modals.mappingTargetPlaceholder')}
                          hint={copy.optional}
                        />
                      </div>
                    </div>
                  </div>

                  <Tooltip content={copy.removeRule}>
                    <IconButton
                      variant="danger"
                      size="sm"
                      onClick={() => onRemoveMapping(index)}
                      aria-label={`${copy.removeRule} ${index + 1}`}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </Tooltip>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </GlassCard>
  );
}
