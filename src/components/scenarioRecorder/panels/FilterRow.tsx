import {
  Heart,
  RefreshCw,
  Tag,
  LayoutGrid,
  List,
  Lock } from
'lucide-react';
import {
  Button,
  MultiFilterDropdown,
  ViewModeSwitch,
  StickyToolbar,
  ToolbarSearchField,
  ToolbarActionsCluster,
  ToolbarSection } from
'@/components/ui';
import { t } from '@/lib/i18n';

type FilterRowProps = {
  query: string;
  onQueryChange: (value: string) => void;
  favoritesOnly: boolean;
  onToggleFavorites: () => void;
  showLocked: boolean;
  onToggleLocked: () => void;
  selectedTags: string[];
  onSelectedTagsChange: (tags: string[]) => void;
  tagOptions: Array<{value: string;label: string;}>;
  viewMode: string;
  onViewModeChange: (value: string) => void;
  onRefresh: () => void;
  refreshDisabled: boolean;
  loading: boolean;
  filteredCount: number;
  itemsCount: number;
};

export function FilterRow({
  query,
  onQueryChange,
  favoritesOnly,
  onToggleFavorites,
  showLocked,
  onToggleLocked,
  selectedTags,
  onSelectedTagsChange,
  tagOptions,
  viewMode,
  onViewModeChange,
  onRefresh,
  refreshDisabled,
  loading,
  filteredCount,
  itemsCount
}: FilterRowProps) {
  return (
    <StickyToolbar>
      <ToolbarSection
        left={
        <ToolbarSearchField
          value={query}
          onValueChange={onQueryChange}
          placeholder={t('scenarios.searchPlaceholder')} />

        }
        right={
        <ToolbarActionsCluster className="min-w-0" align="start">
            <Button
            size="sm"
            className="h-9"
            variant={favoritesOnly ? 'primary' : 'secondary'}
            onClick={onToggleFavorites}
            leftIcon={<Heart size={14} />}>

              {t('scenarios.favoritesOnly')}
            </Button>

            <Button
            size="sm"
            className="h-9"
            variant={showLocked ? 'primary' : 'secondary'}
            onClick={onToggleLocked}
            leftIcon={<Lock size={14} />}>

              {t('scenarios.showLocked')}
            </Button>

            <MultiFilterDropdown
            values={selectedTags}
            onChange={onSelectedTagsChange}
            icon={<Tag size={14} />}
            placeholder={t('scenarios.tagsFilterLabel')}
            triggerClassName="h-9"
            menuClassName="min-w-[260px]"
            showActiveState
            showFooterActions
            options={tagOptions}
            renderValue={(values) =>
            values.length === 0 ? t('scenarios.tagsFilterLabel') : values.join(', ')
            } />


            <ViewModeSwitch
            value={viewMode}
            onChange={onViewModeChange}
            options={[
            {
              value: 'cards',
              label: t('scenarios.viewCards'),
              icon: <LayoutGrid size={14} />
            },
            {
              value: 'list',
              label: t('scenarios.viewList'),
              icon: <List size={14} />
            }]
            } />


            <Button
            size="sm"
            className="h-9"
            variant="secondary"
            onClick={onRefresh}
            disabled={refreshDisabled}
            leftIcon={<RefreshCw size={14} />}>

              {loading ? t('common.loading') : t('common.refresh')}
            </Button>
          </ToolbarActionsCluster>
        } />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <div>
          {t('scenarios.title')}: <span className="text-slate-200">{filteredCount}</span> /{' '}
          {itemsCount}
        </div>
      </div>
    </StickyToolbar>);

}
