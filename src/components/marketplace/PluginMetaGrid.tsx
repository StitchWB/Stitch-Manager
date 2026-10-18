import { Badge } from '@/components/ui/Badge';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { MarketplaceItem } from '@/lib/backend/modules/marketplace';

interface MetaCellProps {
  label: string;
  mono?: boolean;
  wide?: boolean;
  children: React.ReactNode;
}

function MetaCell({ label, mono = false, wide = false, children }: MetaCellProps) {
  return (
    <div
      className={cn(
        'rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 min-w-0',
        wide && 'col-span-2',
      )}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div
        className={cn(
          'mt-1 text-sm font-medium text-slate-100 truncate',
          mono && 'font-mono tabular-nums',
        )}
      >
        {children}
      </div>
    </div>
  );
}

interface PluginMetaGridProps {
  item: MarketplaceItem;
  sourceLabel: string;
}

export function PluginMetaGrid({ item, sourceLabel }: PluginMetaGridProps) {
  return (
    <dl className="grid grid-cols-2 gap-2 w-full" data-testid="plugin-meta-grid">
      <MetaCell label={t('marketplace.idLabel')} mono wide>
        <span title={item.id}>{item.id}</span>
      </MetaCell>
      <MetaCell label={t('marketplace.sourceLabel')}>{sourceLabel}</MetaCell>
      <MetaCell label={t('marketplace.authorLabel')}>
        {item.author ?? '—'}
      </MetaCell>
      <MetaCell label={t('marketplace.versionLabel')} mono>
        {item.version ?? '—'}
      </MetaCell>
      <MetaCell label={t('marketplace.installedVersionLabel')} mono>
        {item.installed_version ?? '—'}
      </MetaCell>
      <div className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 min-w-0 col-span-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {t('marketplace.accessLabel')}
        </div>
        <div className="mt-1.5">
          <Badge variant={item.entitled ? 'success' : 'danger'} size="sm">
            {item.entitled
              ? t('marketplace.accessGranted')
              : t('marketplace.unavailableForRole')}
          </Badge>
        </div>
      </div>
    </dl>
  );
}
