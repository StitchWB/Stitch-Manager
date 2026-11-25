import { useMemo, useState } from 'react';
import { PackageSearch } from 'lucide-react';

import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  GlassCard,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui';
import type { ModelSyncCatalogModel } from '@/lib/backend/modules/modelSync';
import { t } from '@/lib/i18n';

interface ModelCatalogTableProps {
  models: ModelSyncCatalogModel[];
  selectedIds: Set<string>;
  syncedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
}

export function ModelCatalogTable({
  models,
  selectedIds,
  syncedIds,
  onSelectionChange,
}: ModelCatalogTableProps) {
  const [search, setSearch] = useState('');
  const [modalityFilter, setModalityFilter] = useState('');
  const [toolsFilter, setToolsFilter] = useState('');

  const modalities = useMemo(() => {
    const values = new Set<string>();
    for (const model of models) {
      for (const modality of model.inputModalities || []) values.add(modality);
      for (const modality of model.outputModalities || []) values.add(modality);
    }
    return [...values].sort();
  }, [models]);

  const filteredModels = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return models.filter(model => {
      const matchesSearch =
        !needle ||
        model.id.toLowerCase().includes(needle) ||
        model.name.toLowerCase().includes(needle);
      const matchesModality =
        !modalityFilter ||
        model.inputModalities.includes(modalityFilter) ||
        model.outputModalities.includes(modalityFilter);
      const matchesTools =
        !toolsFilter || (toolsFilter === 'yes' ? model.tools : !model.tools);
      return matchesSearch && matchesModality && matchesTools;
    });
  }, [models, search, modalityFilter, toolsFilter]);

  const updateOne = (id: string, checked: boolean) => {
    const next = new Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    onSelectionChange(next);
  };

  const selectSynced = () => {
    const catalogIds = new Set(models.map(model => model.id));
    const next = new Set([...syncedIds].filter(id => catalogIds.has(id)));
    onSelectionChange(next.size ? next : new Set(models.map(model => model.id)));
  };

  return (
    <GlassCard className="p-5" data-testid="model-sync-catalog-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-100">{t('modelSync.catalog.title')}</h2>
          <p className="mt-1 text-xs text-slate-500">{t('modelSync.catalog.description')}</p>
        </div>
        <Badge variant="indigo" size="sm" data-testid="model-sync-selected-count">
          {t('modelSync.catalog.selectedCount', {
            selected: selectedIds.size,
            total: models.length,
          })}
        </Badge>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="min-w-[220px] flex-1">
          <Input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder={t('modelSync.catalog.searchPlaceholder')}
            aria-label={t('modelSync.catalog.searchPlaceholder')}
          />
        </div>
        <div className="w-44">
          <Select
            value={modalityFilter}
            onValueChange={setModalityFilter}
            aria-label={t('modelSync.catalog.columns.modalities')}
            options={[
              { value: '', label: t('modelSync.catalog.allModalities') },
              ...modalities.map(modality => ({ value: modality, label: modality })),
            ]}
          />
        </div>
        <div className="w-40">
          <Select
            value={toolsFilter}
            onValueChange={setToolsFilter}
            aria-label={t('modelSync.catalog.columns.tools')}
            options={[
              { value: '', label: t('modelSync.catalog.allTools') },
              { value: 'yes', label: t('modelSync.catalog.toolsOnly') },
              { value: 'no', label: t('modelSync.catalog.noToolsOnly') },
            ]}
          />
        </div>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onSelectionChange(new Set(models.map(model => model.id)))}
          >
            {t('modelSync.catalog.selectAll')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onSelectionChange(new Set())}
          >
            {t('modelSync.catalog.clear')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={selectSynced}>
            {t('modelSync.catalog.selectSynced')}
          </Button>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-white/[0.06]">
        {models.length === 0 ? (
          <EmptyState
            compact
            icon={PackageSearch}
            title={t('modelSync.catalog.noModels')}
          />
        ) : filteredModels.length === 0 ? (
          <EmptyState
            compact
            icon={PackageSearch}
            title={t('modelSync.catalog.noMatches')}
          />
        ) : (
          <Table containerClassName="max-h-[420px]" data-testid="model-sync-catalog-table">
            <TableHeader>
              <TableRow>
                <TableHead className="sticky top-0 z-10 w-12 bg-vsc-panel-solid">{t('modelSync.catalog.columns.selected')}</TableHead>
                <TableHead className="sticky top-0 z-10 bg-vsc-panel-solid">{t('modelSync.catalog.columns.model')}</TableHead>
                <TableHead className="sticky top-0 z-10 bg-vsc-panel-solid">{t('modelSync.catalog.columns.id')}</TableHead>
                <TableHead className="sticky top-0 z-10 bg-vsc-panel-solid text-right">{t('modelSync.catalog.columns.context')}</TableHead>
                <TableHead className="sticky top-0 z-10 bg-vsc-panel-solid text-right">{t('modelSync.catalog.columns.output')}</TableHead>
                <TableHead className="sticky top-0 z-10 bg-vsc-panel-solid">{t('modelSync.catalog.columns.modalities')}</TableHead>
                <TableHead className="sticky top-0 z-10 bg-vsc-panel-solid">{t('modelSync.catalog.columns.tools')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredModels.map(model => {
                const checked = selectedIds.has(model.id);
                return (
                  <TableRow key={model.id} data-testid={`model-sync-model-row-${model.id}`}>
                    <TableCell>
                      <Checkbox
                        checked={checked}
                        onChange={event => updateOne(model.id, event.target.checked)}
                        aria-label={model.id}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-slate-100">{model.name}</div>
                      {model.reasoning !== null ? (
                        <div className="mt-0.5 text-[10px] text-violet-300">
                          {t('modelSync.catalog.reasoning')}: {String(model.reasoning)}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-slate-400">{model.id}</TableCell>
                    <TableCell className="text-right font-mono">
                      {model.contextTokens.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {model.outputTokens.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-[220px] flex-wrap gap-1">
                        {model.inputModalities.map(modality => (
                          <Badge key={`in-${modality}`} variant="info" size="sm">
                            in:{modality}
                          </Badge>
                        ))}
                        {model.outputModalities.map(modality => (
                          <Badge key={`out-${modality}`} variant="slate" size="sm">
                            out:{modality}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={model.tools ? 'success' : 'slate'} size="sm">
                        {model.tools
                          ? t('modelSync.catalog.toolsYes')
                          : t('modelSync.catalog.toolsNo')}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {models.length > 0 && filteredModels.length > 0 ? (
        <div
          className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500"
          data-testid="model-sync-catalog-summary"
        >
          <span>
            {t('modelSync.catalog.selectedCount', {
              selected: selectedIds.size,
              total: models.length,
            })}
          </span>
          {filteredModels.length !== models.length ? (
            <span>
              {filteredModels.length} / {models.length}
            </span>
          ) : null}
        </div>
      ) : null}
    </GlassCard>
  );
}
