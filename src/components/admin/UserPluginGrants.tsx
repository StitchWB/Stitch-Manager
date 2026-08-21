/**
 * UserPluginGrants — shared per-user plugin grant editor.
 *
 * Used by the Plugins page (inline) and the Users page (in a modal).
 * Fetches the role-grant map + per-user grants, then renders two lists:
 * Granted (effective, with source badge) and Available. Each row has
 * Grant/Revoke buttons; bulk Grant all / Revoke all (with ConfirmDialog
 * for revoke-all). A summary line shows role-grant count and override
 * delta.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, AlertCircle, Plus, Ban, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';
import {
  pluginGrantsRoleList,
  pluginGrantsUserGet,
  pluginGrantsUserSet,
  pluginGrantsUserDelete,
  type PluginSummary,
} from '@/lib/backend/modules/pluginGrants';
import { askConfirm } from '@/components/ui/ConfirmDialogHost';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

export interface UserPluginGrantsProps {
  userId: number;
  username: string;
  role: string;
}

interface UserGrantState {
  grants: Array<{ pluginId: string; granted: boolean }>;
  effective: string[];
}

export function UserPluginGrants({ userId, username, role }: UserPluginGrantsProps) {
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [roleGrants, setRoleGrants] = useState<Record<string, string[]>>({});
  const [userState, setUserState] = useState<UserGrantState>({ grants: [], effective: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [roleData, userData] = await Promise.all([
        pluginGrantsRoleList(),
        pluginGrantsUserGet(userId),
      ]);
      setPlugins(roleData.plugins);
      setRoleGrants(roleData.roles);
      setUserState({ grants: userData.grants, effective: userData.effective });
    } catch {
      setLoadError(t('admin.plugins.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Plugins granted by the user's role (default, no override).
  // "*" in role grants means all plugins are granted by the role.
  const roleGrantedPlugins = useMemo(() => {
    const roleSet = new Set(roleGrants[role] ?? []);
    if (roleSet.has('*')) return plugins;
    return plugins.filter(p => roleSet.has(p.id));
  }, [roleGrants, role, plugins]);

  // Override maps: pluginId → granted (true=grant, false=revoke)
  const overrideMap = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const g of userState.grants) m.set(g.pluginId, g.granted);
    return m;
  }, [userState.grants]);

  const effectiveSet = useMemo(() => new Set(userState.effective), [userState.effective]);

  // Granted list: plugins in effective, with source badge.
  // "*" in effective means the user has access to all plugins.
  const grantedList = useMemo(() => {
    if (effectiveSet.has('*')) return plugins;
    return plugins.filter(p => effectiveSet.has(p.id));
  }, [plugins, effectiveSet]);

  // Available list: plugins NOT in effective.
  // "*" in effective means nothing is available (user already has all).
  const availableList = useMemo(() => {
    if (effectiveSet.has('*')) return [];
    return plugins.filter(p => !effectiveSet.has(p.id));
  }, [plugins, effectiveSet]);

  // Summary stats.
  const overridesAdd = useMemo(() => userState.grants.filter(g => g.granted).length, [userState.grants]);
  const overridesSub = useMemo(() => userState.grants.filter(g => !g.granted).length, [userState.grants]);

  const onGrant = async (pluginId: string) => {
    setUpdatingId(pluginId);
    // Optimistic update
    setUserState(prev => ({
      grants: [...prev.grants.filter(g => g.pluginId !== pluginId), { pluginId, granted: true }],
      effective: Array.from(new Set([...prev.effective, pluginId])),
    }));
    try {
      await pluginGrantsUserSet({ userId, pluginId, granted: true });
      toast.success(t('admin.plugins.grantUpdated'));
      // Refresh from server
      const userData = await pluginGrantsUserGet(userId);
      setUserState({ grants: userData.grants, effective: userData.effective });
    } catch {
      // Rollback
      toast.error(t('admin.plugins.grantFailed'));
      const userData = await pluginGrantsUserGet(userId).catch(() => null);
      if (userData) setUserState({ grants: userData.grants, effective: userData.effective });
      else await refresh();
    } finally {
      setUpdatingId(null);
    }
  };

  const onRevoke = async (pluginId: string) => {
    setUpdatingId(pluginId);
    // Optimistic update
    setUserState(prev => ({
      grants: [...prev.grants.filter(g => g.pluginId !== pluginId), { pluginId, granted: false }],
      effective: prev.effective.filter(id => id !== pluginId),
    }));
    try {
      // user_set with granted=false creates/updates a revoke override —
      // correct for ALL cases (role-granted, override-granted, both).
      // user_delete would be a no-op for role-granted plugins (no override
      // to remove) and silently lose the revoke intent.
      await pluginGrantsUserSet({ userId, pluginId, granted: false });
      toast.success(t('admin.plugins.grantUpdated'));
      const userData = await pluginGrantsUserGet(userId);
      setUserState({ grants: userData.grants, effective: userData.effective });
    } catch {
      toast.error(t('admin.plugins.grantFailed'));
      const userData = await pluginGrantsUserGet(userId).catch(() => null);
      if (userData) setUserState({ grants: userData.grants, effective: userData.effective });
      else await refresh();
    } finally {
      setUpdatingId(null);
    }
  };

  const onGrantAll = async () => {
    const toGrant = availableList.map(p => p.id);
    if (toGrant.length === 0) return;
    setUpdatingId('*');
    // Optimistic
    setUserState(prev => ({
      grants: [...prev.grants, ...toGrant.map(id => ({ pluginId: id, granted: true as const }))],
      effective: Array.from(new Set([...prev.effective, ...toGrant])),
    }));
    try {
      await Promise.all(toGrant.map(id => pluginGrantsUserSet({ userId, pluginId: id, granted: true })));
      toast.success(t('admin.plugins.grantUpdated'));
      const userData = await pluginGrantsUserGet(userId);
      setUserState({ grants: userData.grants, effective: userData.effective });
    } catch {
      toast.error(t('admin.plugins.grantFailed'));
      await refresh();
    } finally {
      setUpdatingId(null);
    }
  };

  const onRevokeAll = async () => {
    if (userState.grants.length === 0) return;
    const confirmed = await askConfirm({
      title: t('admin.plugins.revokeAllTitle'),
      message: t('admin.plugins.revokeAllMessage', { username }),
      confirmText: t('admin.plugins.revokeAllConfirm'),
      variant: 'danger',
    });
    if (!confirmed) return;
    setUpdatingId('*');
    setUserState({ grants: [], effective: roleGrantedPlugins.map(p => p.id) });
    try {
      await Promise.all(userState.grants.map(g => pluginGrantsUserDelete({ userId, pluginId: g.pluginId })));
      toast.success(t('admin.plugins.grantUpdated'));
      const userData = await pluginGrantsUserGet(userId);
      setUserState({ grants: userData.grants, effective: userData.effective });
    } catch {
      toast.error(t('admin.plugins.grantFailed'));
      await refresh();
    } finally {
      setUpdatingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 text-slate-500 animate-spin" />
        <span className="ml-2 text-sm text-slate-500">{t('admin.plugins.loading')}</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-6 text-center">
        <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
        <p className="text-sm text-slate-400">{loadError}</p>
      </div>
    );
  }

  const isBulkBusy = updatingId === '*';

  return (
    <div className="flex flex-col gap-4" data-testid="user-plugin-grants">
      {/* Summary */}
      <div className="flex items-center gap-3 text-xs text-slate-400">
        <span>{t('admin.plugins.summaryRoleGrants', { role, count: roleGrantedPlugins.length })}</span>
        {userState.grants.length > 0 && (
          <span className="text-slate-500">·</span>
        )}
        {overridesAdd > 0 && (
          <Badge variant="success" size="sm">+{overridesAdd}</Badge>
        )}
        {overridesSub > 0 && (
          <Badge variant="danger" size="sm">−{overridesSub}</Badge>
        )}
        {overridesAdd > 0 || overridesSub > 0 ? (
          <span className="text-slate-500">{t('admin.plugins.summaryOverrides', { add: overridesAdd, sub: overridesSub })}</span>
        ) : null}
      </div>

      {/* Bulk actions */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => void onGrantAll()} disabled={isBulkBusy || availableList.length === 0} leftIcon={<Plus className="w-3.5 h-3.5" />}>
          {t('admin.plugins.grantAll2')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void onRevokeAll()} disabled={isBulkBusy || userState.grants.length === 0} leftIcon={<Ban className="w-3.5 h-3.5" />} className="text-slate-500 hover:text-red-400">
          {t('admin.plugins.revokeAll')}
        </Button>
      </div>

      {/* Granted list */}
      <div className="rounded-lg border border-white/[0.06] bg-black/40 overflow-hidden">
        <div className="px-4 py-2 border-b border-white/[0.06] flex items-center justify-between">
          <h3 className="text-xs font-semibold text-white uppercase tracking-wider">{t('admin.plugins.granted')} · {grantedList.length}</h3>
        </div>
        {grantedList.length === 0 ? (
          <div className="px-4 py-3 text-sm text-slate-500">{t('admin.plugins.noGrants')}</div>
        ) : (
          <div className="divide-y divide-white/[0.03]">
            {grantedList.map(p => {
              const override = overrideMap.get(p.id);
              const isOverride = override !== undefined;
              const isRevokeOverride = isOverride && !override;
              const isUpdating = updatingId === p.id;
              return (
                <div key={p.id} className="flex items-center gap-3 px-4 py-2 hover:bg-white/[0.02] transition-colors">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-slate-200 truncate">{p.name}</span>
                    <span className="ml-2 text-[10px] text-slate-500 font-mono">{p.id}</span>
                  </div>
                  <Badge variant={isOverride ? (isRevokeOverride ? 'danger' : 'info') : 'outline'} size="sm">
                    {isOverride ? (isRevokeOverride ? t('admin.plugins.sourceOverrideRevoke') : t('admin.plugins.sourceOverride')) : t('admin.plugins.sourceRole')}
                  </Badge>
                  <Button variant="ghost" size="sm" onClick={() => void onRevoke(p.id)} disabled={isUpdating || isBulkBusy} leftIcon={<X className="w-3 h-3" />} className="text-slate-500 hover:text-red-400" aria-label={t('admin.plugins.revoke')}>
                    {t('admin.plugins.revoke')}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Available list */}
      {availableList.length > 0 && (
        <div className="rounded-lg border border-white/[0.06] bg-black/40 overflow-hidden">
          <div className="px-4 py-2 border-b border-white/[0.06] flex items-center justify-between">
            <h3 className="text-xs font-semibold text-white uppercase tracking-wider">{t('admin.plugins.available')} · {availableList.length}</h3>
          </div>
          <div className="divide-y divide-white/[0.03]">
            {availableList.map(p => {
              const override = overrideMap.get(p.id);
              const isRevokeOverride = override === false;
              const isUpdating = updatingId === p.id;
              return (
                <div key={p.id} className="flex items-center gap-3 px-4 py-2 hover:bg-white/[0.02] transition-colors">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-slate-200 truncate">{p.name}</span>
                    <span className="ml-2 text-[10px] text-slate-500 font-mono">{p.id}</span>
                  </div>
                  {isRevokeOverride && (
                    <Badge variant="danger" size="sm">{t('admin.plugins.sourceOverrideRevoke')}</Badge>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => void onGrant(p.id)} disabled={isUpdating || isBulkBusy} leftIcon={<Check className="w-3 h-3" />} className="text-emerald-400 hover:text-emerald-300" aria-label={t('admin.plugins.grant')}>
                    {t('admin.plugins.grant')}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
