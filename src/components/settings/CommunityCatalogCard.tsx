import { Download, Trash2, Package } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { t } from '@/lib/i18n';
import type { CommunityCatalogPlugin, InstalledCommunityPackage } from '@/lib/backend/modules/community';

export interface CommunityCatalogCardProps {
  plugin: CommunityCatalogPlugin;
  installed: InstalledCommunityPackage | undefined;
  actionInProgress: boolean;
  onInstall: (plugin: CommunityCatalogPlugin) => void;
  onUninstall: (plugin: CommunityCatalogPlugin) => void;
}

export function CommunityCatalogCard({
  plugin,
  installed,
  actionInProgress,
  onInstall,
  onUninstall,
}: CommunityCatalogCardProps) {
  const isInstalled = Boolean(installed);

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3 flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Package className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span className="text-sm font-medium text-slate-200 truncate">
              {plugin.name}
            </span>
            <Badge variant="outline" size="sm">
              {t('settings.community.communityBadge')}
            </Badge>
          </div>
        </div>
        <span className="text-xs text-slate-500 font-mono shrink-0">
          {plugin.version}
        </span>
      </div>

      <p className="text-xs text-slate-400 leading-relaxed line-clamp-3">
        {plugin.description}
      </p>

      <div className="flex items-center gap-3 text-xs text-slate-500">
        <span>
          <span className="text-slate-600">
            {t('settings.community.authorLabel')}:
          </span>{' '}
          <span className="text-slate-400">{plugin.author}</span>
        </span>
      </div>

      {plugin.services.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-slate-600">
            {t('settings.community.servicesLabel')}:
          </span>
          {plugin.services.map(svc => (
            <Badge key={svc} variant="default" size="sm">
              {svc}
            </Badge>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1.5 pt-1 mt-auto">
        {isInstalled ? (
          <Button
            size="xs"
            variant="danger"
            onClick={() => onUninstall(plugin)}
            isLoading={actionInProgress}
            disabled={actionInProgress}
            leftIcon={<Trash2 className="w-3 h-3" />}
          >
            {actionInProgress
              ? t('settings.community.uninstalling')
              : t('settings.community.uninstall')}
          </Button>
        ) : (
          <Button
            size="xs"
            variant="primary"
            onClick={() => onInstall(plugin)}
            isLoading={actionInProgress}
            disabled={actionInProgress}
            leftIcon={<Download className="w-3 h-3" />}
          >
            {actionInProgress
              ? t('settings.community.installing')
              : t('settings.community.install')}
          </Button>
        )}
        {isInstalled && (
          <Badge variant="success" size="sm">
            {t('settings.community.installed')}
          </Badge>
        )}
      </div>
    </div>
  );
}
