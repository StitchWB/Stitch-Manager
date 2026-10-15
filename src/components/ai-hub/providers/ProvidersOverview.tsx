import { ChevronRight, ClipboardPaste, Download, Plus, Route } from 'lucide-react';

import { ButtonBase, MetricStrip, ProviderLogo } from '@/components/ui';
import type { MetricSegment } from '@/components/ui';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { ProviderToolsSection } from './ProviderToolsSection';
import { HEALTH_META } from './viewModel';
import type { ProviderRosterItem } from './viewModel';

export interface ProvidersOverviewProps {
  items: ProviderRosterItem[];
  onSelectProvider: (id: string) => void;
  onPasteKeys: () => void;
  onAddProvider: () => void;
  onImportOpencode: () => void;
  onOpenRouting: () => void;
}

const ACTION_TILE =
  'flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-left text-xs font-medium text-slate-200 transition-colors hover:bg-white/[0.05] hover:text-white';

export function ProvidersOverview(props: ProvidersOverviewProps): JSX.Element {
  const { items, onSelectProvider, onPasteKeys, onAddProvider, onImportOpencode, onOpenRouting } = props;

  const totals = items.reduce(
    (acc, item) => ({
      keys: acc.keys + item.credentialCount,
      active: acc.active + item.activeCount,
      failing: acc.failing + item.problemCount,
      models: acc.models + item.modelCount,
    }),
    { keys: 0, active: 0, failing: 0, models: 0 }
  );
  const attention = items.filter(item => item.problemCount > 0);

  const segments: MetricSegment[] = [
    { id: 'providers', label: t('aiHub.providersPage.overview.providers'), value: items.length },
    { id: 'keys', label: t('aiHub.providersPage.overview.keys'), value: totals.keys, tone: 'info' },
    {
      id: 'active',
      label: t('aiHub.providersPage.overview.active'),
      value: totals.active,
      tone: totals.active > 0 ? 'success' : 'neutral',
    },
    {
      id: 'failing',
      label: t('aiHub.providersPage.overview.failing'),
      value: totals.failing,
      tone: totals.failing > 0 ? 'danger' : 'neutral',
    },
    { id: 'models', label: t('aiHub.providersPage.overview.models'), value: totals.models },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="shrink-0 border-b border-white/[0.06] px-4 py-3">
        <h2 className="text-sm font-semibold text-white">{t('aiHub.providersPage.overview.title')}</h2>
      </div>

      <div className="flex flex-col gap-3 p-3">
        <MetricStrip segments={segments} density="compact" />

        <section className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
          <h3 className="border-b border-white/[0.06] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {t('aiHub.providersPage.overview.needsAttention')}
          </h3>
          {attention.length === 0 ? (
            <p className="flex items-center gap-2 px-3 py-2.5 text-xs text-emerald-300">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
              {t('aiHub.providersPage.overview.allHealthy')}
            </p>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {attention.map(item => {
                const meta = HEALTH_META[item.health];
                return (
                  <ButtonBase
                    key={item.endpoint.id}
                    type="button"
                    onClick={() => onSelectProvider(item.endpoint.id)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-slate-300 transition-colors hover:bg-white/[0.04] hover:text-white"
                  >
                    <ProviderLogo provider={item.logoKey} size={16} colored />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {item.endpoint.name}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-red-300">
                      {item.problemCount} {t('aiHub.providersPage.failingShort')}
                    </span>
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', meta.dotClass)} />
                    <ChevronRight size={13} className="shrink-0 text-slate-600" />
                  </ButtonBase>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
          <h3 className="border-b border-white/[0.06] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {t('aiHub.providersPage.overview.actions')}
          </h3>
          <div className="grid grid-cols-1 gap-2 p-2 sm:grid-cols-2">
            <ButtonBase type="button" onClick={onPasteKeys} className={ACTION_TILE}>
              <ClipboardPaste size={15} className="shrink-0 text-indigo-300" />
              {t('aiHub.providersPage.pasteKeys')}
            </ButtonBase>
            <ButtonBase type="button" onClick={onAddProvider} className={ACTION_TILE}>
              <Plus size={15} className="shrink-0 text-indigo-300" />
              {t('aiHub.addProvider')}
            </ButtonBase>
            <ButtonBase type="button" onClick={onImportOpencode} className={ACTION_TILE}>
              <Download size={15} className="shrink-0 text-indigo-300" />
              {t('aiHub.providersPage.importOpencode')}
            </ButtonBase>
            <ButtonBase type="button" onClick={onOpenRouting} className={ACTION_TILE}>
              <Route size={15} className="shrink-0 text-indigo-300" />
              {t('aiHub.tabs.routing')}
            </ButtonBase>
          </div>
        </section>

        <ProviderToolsSection />
      </div>
    </div>
  );
}
