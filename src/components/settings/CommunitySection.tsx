import { useCallback, useEffect, useState } from 'react';
import {
  Users,
  RefreshCw,
  AlertTriangle,
  Package,
  FolderOpen,
  GitPullRequest,
  FileEdit,
  CheckCircle2,
  Trash2,
  Send,
  Copy,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, EmptyState, SectionHeader, Toggle } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { getSettings, updateSettings } from '@/lib/backend/modules/settings';
import {
  getCommunityCatalog,
  installCommunityPlugin,
  uninstallCommunityPlugin,
  listInstalledCommunity,
  listLocalPackages,
  type CommunityCatalogPlugin,
  type InstalledCommunityPackage,
  type LocalPackage,
} from '@/lib/backend/modules/community';
import {
  listOverrides,
  createOverride,
  validateOverride,
  clearOverride,
  type OverrideEntry,
} from '@/lib/backend/modules/overrides';
import { CommunityCatalogCard } from './CommunityCatalogCard';
import { SubmitForReviewModal } from './SubmitForReviewModal';

function isOfflineError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes('offline') || msg.includes('failed to fetch');
  }
  return false;
}

export function CommunitySection() {
  const [consent, setConsent] = useState(false);
  const [catalog, setCatalog] = useState<CommunityCatalogPlugin[]>([]);
  const [installed, setInstalled] = useState<InstalledCommunityPackage[]>([]);
  const [localPackages, setLocalPackages] = useState<LocalPackage[]>([]);
  const [overrides, setOverrides] = useState<OverrideEntry[]>([]);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [, setIsLoadingInstalled] = useState(false);
  const [isLoadingLocal, setIsLoadingLocal] = useState(false);
  const [isLoadingOverrides, setIsLoadingOverrides] = useState(false);
  const [catalogOffline, setCatalogOffline] = useState(false);
  const [actionPluginId, setActionPluginId] = useState<string | null>(null);
  const [overrideActionPluginId, setOverrideActionPluginId] = useState<string | null>(null);
  const [submitPackageId, setSubmitPackageId] = useState<string | null>(null);
  const [submitOverridePluginId, setSubmitOverridePluginId] = useState<string | null>(null);

  const loadConsent = useCallback(async () => {
    try {
      const data = await getSettings();
      setConsent(
        (data as { community_enabled?: string }).community_enabled === 'true',
      );
    } catch (err) {
      console.error('[Community] failed to load consent:', err);
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    setIsLoadingCatalog(true);
    setCatalogOffline(false);
    try {
      const data = await getCommunityCatalog();
      setCatalog(data.plugins || []);
    } catch (err) {
      if (isOfflineError(err)) {
        setCatalogOffline(true);
      } else {
        toast.error(t('settings.community.loadFailed'));
      }
      setCatalog([]);
    } finally {
      setIsLoadingCatalog(false);
    }
  }, []);

  const loadInstalled = useCallback(async () => {
    setIsLoadingInstalled(true);
    try {
      const data = await listInstalledCommunity();
      setInstalled(data.packages || []);
    } catch (err) {
      console.error('[Community] failed to load installed:', err);
      setInstalled([]);
    } finally {
      setIsLoadingInstalled(false);
    }
  }, []);

  const loadLocalPackages = useCallback(async () => {
    setIsLoadingLocal(true);
    try {
      const data = await listLocalPackages();
      setLocalPackages(data.packages || []);
    } catch (err) {
      console.error('[Community] failed to load local packages:', err);
      setLocalPackages([]);
    } finally {
      setIsLoadingLocal(false);
    }
  }, []);

  const loadOverrides = useCallback(async () => {
    setIsLoadingOverrides(true);
    try {
      const data = await listOverrides();
      setOverrides(data.overrides || []);
    } catch (err) {
      console.error('[Community] failed to load overrides:', err);
      setOverrides([]);
    } finally {
      setIsLoadingOverrides(false);
    }
  }, []);

  useEffect(() => {
    void loadConsent();
    void loadCatalog();
    void loadInstalled();
    void loadLocalPackages();
    void loadOverrides();
  }, [loadConsent, loadCatalog, loadInstalled, loadLocalPackages, loadOverrides]);

  const handleConsentChange = async (checked: boolean) => {
    setConsent(checked);
    try {
      await updateSettings({ community_enabled: checked ? 'true' : 'false' });
    } catch (err) {
      console.error('[Community] failed to save consent:', err);
      toast.error(t('settings.failedToSave'));
      setConsent(!checked);
    }
  };

  const installedMap = new Map(installed.map(p => [p.id, p]));

  const handleInstall = async (plugin: CommunityCatalogPlugin) => {
    setActionPluginId(plugin.id);
    try {
      const result = await installCommunityPlugin({
        id: plugin.id,
        version: plugin.version,
      });
      if (result.success) {
        toast.success(t('settings.community.installSuccess'));
        await Promise.all([loadCatalog(), loadInstalled()]);
      } else {
        toast.error(result.error || t('settings.community.installFailed'));
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('settings.community.installFailed'),
      );
    } finally {
      setActionPluginId(null);
    }
  };

  const handleUninstall = async (plugin: CommunityCatalogPlugin) => {
    setActionPluginId(plugin.id);
    try {
      const result = await uninstallCommunityPlugin({ id: plugin.id });
      if (result.success) {
        toast.success(t('settings.community.uninstallSuccess'));
        await Promise.all([loadCatalog(), loadInstalled()]);
      } else {
        toast.error(result.error || t('settings.community.uninstallFailed'));
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('settings.community.uninstallFailed'),
      );
    } finally {
      setActionPluginId(null);
    }
  };

  const handleUninstallInstalled = async (pkg: InstalledCommunityPackage) => {
    setActionPluginId(pkg.id);
    try {
      const result = await uninstallCommunityPlugin({
        id: pkg.id,
        version: pkg.version,
      });
      if (result.success) {
        toast.success(t('settings.community.uninstallSuccess'));
        await Promise.all([loadCatalog(), loadInstalled()]);
      } else {
        toast.error(result.error || t('settings.community.uninstallFailed'));
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('settings.community.uninstallFailed'),
      );
    } finally {
      setActionPluginId(null);
    }
  };

  // ── Override handlers ────────────────────────────────────────────────

  const handleCreateOverride = async (pluginId: string) => {
    setOverrideActionPluginId(pluginId);
    try {
      const result = await createOverride({ plugin_id: pluginId });
      if (result.success) {
        toast.success(t('settings.overrides.createSuccess'));
        await loadOverrides();
      } else {
        toast.error(result.error || t('settings.overrides.createFailed'));
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('settings.overrides.createFailed'),
      );
    } finally {
      setOverrideActionPluginId(null);
    }
  };

  const handleValidateOverride = async (pluginId: string) => {
    setOverrideActionPluginId(pluginId);
    try {
      const result = await validateOverride({ plugin_id: pluginId });
      if (result.valid) {
        toast.success(t('settings.overrides.validateSuccess'));
      } else {
        toast.error(result.error || t('settings.overrides.validateFailed'));
      }
      await loadOverrides();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('settings.overrides.validateFailed'),
      );
    } finally {
      setOverrideActionPluginId(null);
    }
  };

  const handleClearOverride = async (pluginId: string) => {
    setOverrideActionPluginId(pluginId);
    try {
      const result = await clearOverride({ plugin_id: pluginId });
      if (result.success) {
        toast.success(t('settings.overrides.removeSuccess'));
        await loadOverrides();
      } else {
        toast.error(result.error || t('settings.overrides.removeFailed'));
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('settings.overrides.removeFailed'),
      );
    } finally {
      setOverrideActionPluginId(null);
    }
  };

  const handleCopyOverridePath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      toast.success(t('settings.overrides.pathCopied'));
    } catch {
      toast.error(t('settings.overrides.copyPath'));
    }
  };

  return (
    <SectionHeader
      title={t('settings.community.title')}
      description={t('settings.community.description')}
      icon={<Users className="w-4 h-4 text-indigo-400" />}
      className="pt-6 border-t border-white/10"
    >
      <div className="space-y-4">
        {/* Trust banner */}
        <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300/80 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="leading-relaxed">
            {t('settings.community.trustBanner')}
          </span>
        </div>

        {/* Consent toggle */}
        <div className="glass-card rounded-lg p-4 bg-white/[0.02] space-y-2">
          <Toggle
            label={t('settings.community.consentLabel')}
            checked={consent}
            onChange={v => void handleConsentChange(v)}
          />
          <p className="text-xs text-slate-500 leading-relaxed">
            {t('settings.community.consentDescription')}
          </p>
        </div>

        {!consent && (
          <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300/80">
            {t('settings.community.consentOffNotice')}
          </div>
        )}

        {/* Catalog */}
        <div className={cn('space-y-2', !consent && 'opacity-60 pointer-events-none')}>
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-medium text-slate-200">
                {t('settings.community.catalogTitle')}
              </h4>
              <p className="text-xs text-slate-500">
                {t('settings.community.catalogDescription')}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void loadCatalog()}
              disabled={isLoadingCatalog}
              leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            >
              {t('settings.community.refresh')}
            </Button>
          </div>

          {catalogOffline ? (
            <EmptyState
              icon={AlertTriangle}
              title={t('settings.community.offlineTitle')}
              description={t('settings.community.offlineDescription')}
              compact
            />
          ) : catalog.length === 0 ? (
            <EmptyState
              icon={Package}
              title={t('settings.community.emptyTitle')}
              description={t('settings.community.emptyDescription')}
              compact
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {catalog.map(plugin => (
                <CommunityCatalogCard
                  key={plugin.id}
                  plugin={plugin}
                  installed={installedMap.get(plugin.id)}
                  actionInProgress={actionPluginId === plugin.id}
                  onInstall={p => void handleInstall(p)}
                  onUninstall={p => void handleUninstall(p)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Installed community plugins */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-slate-200">
            {t('settings.community.installedTitle')}
          </h4>
          <p className="text-xs text-slate-500">
            {t('settings.community.installedDescription')}
          </p>
          {installed.length === 0 ? (
            <EmptyState
              icon={Package}
              title={t('settings.community.installedEmpty')}
              compact
            />
          ) : (
            <div className="space-y-2">
              {installed.map(pkg => (
                <div
                  key={`${pkg.id}@${pkg.version}`}
                  className="rounded-lg border border-white/10 bg-white/[0.02] p-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-200">
                        {pkg.name || pkg.id}
                      </span>
                      <span className="text-xs text-slate-500 font-mono">
                        {pkg.version}
                      </span>
                      <Badge variant="outline" size="sm">
                        {t('settings.community.communityBadge')}
                      </Badge>
                    </div>
                    {pkg.services.length > 0 && (
                      <div className="mt-1 flex items-center gap-1 flex-wrap">
                        {pkg.services.map(svc => (
                          <Badge key={svc} variant="default" size="sm">
                            {svc}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button
                    size="xs"
                    variant="danger"
                    onClick={() => void handleUninstallInstalled(pkg)}
                    isLoading={actionPluginId === pkg.id}
                    disabled={actionPluginId !== null}
                  >
                    {t('settings.community.uninstall')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Author cabinet */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-medium text-slate-200">
                {t('settings.community.authorCabinetTitle')}
              </h4>
              <p className="text-xs text-slate-500">
                {t('settings.community.authorCabinetDescription')}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void loadLocalPackages()}
              disabled={isLoadingLocal}
              leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            >
              {t('settings.community.refresh')}
            </Button>
          </div>
          {localPackages.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title={t('settings.community.authorCabinetEmpty')}
              compact
            />
          ) : (
            <div className="space-y-2">
              {localPackages.map(pkg => (
                <div
                  key={`${pkg.id}@${pkg.version}`}
                  className="rounded-lg border border-white/10 bg-white/[0.02] p-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-200">
                        {pkg.name}
                      </span>
                      <span className="text-xs text-slate-500 font-mono">
                        {pkg.version}
                      </span>
                    </div>
                    {pkg.services.length > 0 && (
                      <div className="mt-1 flex items-center gap-1 flex-wrap">
                        {pkg.services.map(svc => (
                          <Badge key={svc} variant="default" size="sm">
                            {svc}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {pkg.path && (
                      <p className="mt-1 text-xs text-slate-600 font-mono truncate">
                        {t('settings.community.pathLabel')}: {pkg.path}
                      </p>
                    )}
                  </div>
                  <Button
                    size="xs"
                    variant="primary"
                    onClick={() => setSubmitPackageId(pkg.id)}
                    leftIcon={<GitPullRequest className="w-3 h-3" />}
                  >
                    {t('settings.community.submitForReview')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Overrides block */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-medium text-slate-200">
                {t('settings.overrides.title')}
              </h4>
              <p className="text-xs text-slate-500">
                {t('settings.overrides.description')}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void loadOverrides()}
              disabled={isLoadingOverrides}
              leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            >
              {t('settings.overrides.refresh')}
            </Button>
          </div>
          {overrides.length === 0 ? (
            <EmptyState
              icon={FileEdit}
              title={t('settings.overrides.emptyTitle')}
              description={t('settings.overrides.emptyDescription')}
              compact
            />
          ) : (
            <div className="space-y-2">
              {overrides.map(entry => {
                const pkg = localPackages.find(p => p.id === entry.plugin_id);
                const hasOverride = entry.has_override;
                const isValid = entry.has_override && entry.valid;
                const isInvalid = entry.has_override && !entry.valid;
                return (
                  <div
                    key={entry.plugin_id}
                    className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-slate-200">
                            {pkg?.name || entry.plugin_id}
                          </span>
                          {pkg && (
                            <span className="text-xs text-slate-500 font-mono">
                              {pkg.version}
                            </span>
                          )}
                          {hasOverride && isValid && (
                            <Badge variant="success" size="sm" withDot>
                              {t('settings.overrides.statusActive')}
                            </Badge>
                          )}
                          {isInvalid && (
                            <Badge variant="danger" size="sm" withDot>
                              {t('settings.overrides.statusInvalid')}
                            </Badge>
                          )}
                          {!hasOverride && (
                            <Badge variant="outline" size="sm">
                              {t('settings.overrides.statusNone')}
                            </Badge>
                          )}
                        </div>
                        {hasOverride && entry.path && (
                          <div className="mt-1 flex items-center gap-1.5">
                            <p className="text-xs text-slate-600 font-mono truncate flex-1">
                              {t('settings.overrides.pathLabel')}: {entry.path}
                            </p>
                            <button
                              type="button"
                              onClick={() => void handleCopyOverridePath(entry.path)}
                              className="text-slate-500 hover:text-slate-300 transition-colors shrink-0"
                              title={t('settings.overrides.copyPath')}
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                        {isInvalid && entry.error && (
                          <p className="mt-1 text-xs text-red-400/80 truncate">
                            {entry.error}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {!hasOverride && (
                        <Button
                          size="xs"
                          variant="primary"
                          onClick={() => void handleCreateOverride(entry.plugin_id)}
                          isLoading={overrideActionPluginId === entry.plugin_id}
                          disabled={overrideActionPluginId !== null}
                          leftIcon={<FileEdit className="w-3 h-3" />}
                        >
                          {t('settings.overrides.create')}
                        </Button>
                      )}
                      {hasOverride && (
                        <>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => void handleValidateOverride(entry.plugin_id)}
                            isLoading={overrideActionPluginId === entry.plugin_id}
                            disabled={overrideActionPluginId !== null}
                            leftIcon={<CheckCircle2 className="w-3 h-3" />}
                          >
                            {t('settings.overrides.validate')}
                          </Button>
                          <Button
                            size="xs"
                            variant="danger"
                            onClick={() => void handleClearOverride(entry.plugin_id)}
                            isLoading={overrideActionPluginId === entry.plugin_id}
                            disabled={overrideActionPluginId !== null}
                            leftIcon={<Trash2 className="w-3 h-3" />}
                          >
                            {t('settings.overrides.remove')}
                          </Button>
                          <Button
                            size="xs"
                            variant="primary"
                            onClick={() => setSubmitOverridePluginId(entry.plugin_id)}
                            disabled={overrideActionPluginId !== null}
                            leftIcon={<Send className="w-3 h-3" />}
                          >
                            {t('settings.overrides.sendPatch')}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <SubmitForReviewModal
        packageId={submitPackageId}
        onClose={() => setSubmitPackageId(null)}
      />
      <SubmitForReviewModal
        packageId={submitOverridePluginId}
        onClose={() => setSubmitOverridePluginId(null)}
        overrideMode
      />
    </SectionHeader>
  );
}
