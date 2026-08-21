/**
 * Plugins page — admin-only plugin entitlement management.
 *
 * Two sections:
 * 1. "Access by role": matrix table — rows = plugins, columns = roles
 *    (user/vip/premium/elite). Admin column is locked/read-only. Cell =
 *    checkbox → plugin_grants_role_set (optimistic + rollback + toast).
 *    Column-header "grant all" toggle per role. Special first row "*"
 *    (all plugins) toggle per role.
 * 2. "Per-user grants": user picker → UserPluginGrants component.
 *
 * Follows the same layout/card conventions as Users.tsx/Privileges.tsx.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Puzzle, Loader2, AlertCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import Header from '../components/layout/Header';
import { useAppStore } from '../stores/app';
import { t } from '@/lib/i18n';
import {
  pluginGrantsRoleList,
  pluginGrantsRoleSet,
  ROLE_LADDER,
  type PluginSummary,
} from '../lib/backend/modules/pluginGrants';
import { listUsers, type AuthUser } from '../lib/backend/modules/auth';
import { Tooltip } from '@/components/ui/Tooltip';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Select } from '../components/ui/Select';
import { UserPluginGrants } from '../components/admin/UserPluginGrants';

const ALL_PLUGINS_ID = '*';

interface RoleMatrixState {
  roles: Record<string, string[]>;
  plugins: PluginSummary[];
}

export default function Plugins() {
  const language = useAppStore(state => state.language);
  void language;

  const [state, setState] = useState<RoleMatrixState>({ roles: {}, plugins: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  // Per-user section state
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  // Re-fetch only the role matrix (used after successful role mutations
  // to reconcile with server truth — e.g. backend normalizes "*" by
  // deduping individual ids, or concurrent admin edits changed state).
  const refreshRoles = useCallback(async () => {
    const roleData = await pluginGrantsRoleList();
    setState(roleData);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setUsersError(null);
    try {
      const [roleData, userList] = await Promise.all([
        pluginGrantsRoleList(),
        listUsers().catch((): AuthUser[] => {
          setUsersError(t('admin.plugins.usersLoadFailed'));
          return [];
        }),
      ]);
      setState(roleData);
      setUsers(userList);
    } catch {
      setLoadError(t('admin.plugins.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const roles = useMemo(() => ROLE_LADDER, []);

  const isRoleGranted = useCallback((role: string, pluginId: string): boolean => {
    const list = state.roles[role] ?? [];
    return list.includes(pluginId) || list.includes(ALL_PLUGINS_ID);
  }, [state.roles]);

  const onToggleRole = async (role: string, pluginId: string, next: boolean) => {
    if (role === 'admin') return;
    const cellId = `${role}:${pluginId}`;
    setUpdating(cellId);
    // Optimistic update
    setState(prev => {
      const current = prev.roles[role] ?? [];
      const has = current.includes(pluginId);
      let nextList: string[];
      if (next && !has) nextList = [...current, pluginId];
      else if (!next && has) nextList = current.filter(id => id !== pluginId);
      else nextList = current;
      return { ...prev, roles: { ...prev.roles, [role]: nextList } };
    });
    try {
      await pluginGrantsRoleSet({ role, pluginId, granted: next });
      toast.success(t('admin.plugins.updated'));
      // Re-fetch role list to reconcile with server truth (backend may
      // normalize, e.g. granting "*" dedupes individual ids; concurrent
      // admin edits). Optimistic update stays for instant UI.
      await refreshRoles().catch(() => { /* optimistic state remains; toast already shown */ });
    } catch {
      // Rollback
      setState(prev => {
        const current = prev.roles[role] ?? [];
        const has = current.includes(pluginId);
        let reverted: string[];
        if (!next && !has) reverted = [...current, pluginId];
        else if (next && has) reverted = current.filter(id => id !== pluginId);
        else reverted = current;
        return { ...prev, roles: { ...prev.roles, [role]: reverted } };
      });
      toast.error(t('admin.plugins.grantFailed'));
    } finally {
      setUpdating(null);
    }
  };

  const onToggleAllForRole = async (role: string, next: boolean) => {
    if (role === 'admin') return;
    const cellId = `${role}:${ALL_PLUGINS_ID}`;
    setUpdating(cellId);
    setState(prev => {
      const current = prev.roles[role] ?? [];
      const has = current.includes(ALL_PLUGINS_ID);
      let nextList: string[];
      if (next && !has) nextList = [...current, ALL_PLUGINS_ID];
      else if (!next && has) nextList = current.filter(id => id !== ALL_PLUGINS_ID);
      else nextList = current;
      return { ...prev, roles: { ...prev.roles, [role]: nextList } };
    });
    try {
      await pluginGrantsRoleSet({ role, pluginId: ALL_PLUGINS_ID, granted: next });
      toast.success(t('admin.plugins.updated'));
      // Re-fetch role list to reconcile with server truth.
      await refreshRoles().catch(() => { /* optimistic state remains; toast already shown */ });
    } catch {
      setState(prev => {
        const current = prev.roles[role] ?? [];
        const has = current.includes(ALL_PLUGINS_ID);
        let reverted: string[];
        if (!next && !has) reverted = [...current, ALL_PLUGINS_ID];
        else if (next && has) reverted = current.filter(id => id !== ALL_PLUGINS_ID);
        else reverted = current;
        return { ...prev, roles: { ...prev.roles, [role]: reverted } };
      });
      toast.error(t('admin.plugins.grantFailed'));
    } finally {
      setUpdating(null);
    }
  };

  const selectedUser = useMemo(() => {
    if (selectedUserId === null) return null;
    return users.find(u => String(u.id) === selectedUserId) ?? null;
  }, [users, selectedUserId]);

  const renderCheckbox = (role: string, pluginId: string) => {
    const cellId = `${role}:${pluginId}`;
    const checked = role === 'admin' ? true : isRoleGranted(role, pluginId);
    const isAdmin = role === 'admin';
    const isUpdating = updating === cellId;
    return (
      <td key={role} className="px-5 py-3 text-center">
        <div className="flex items-center justify-center">
          {isAdmin ? (
            <Tooltip content={t('admin.plugins.adminLockedHint')} side="top">
              <span><input type="checkbox" checked disabled readOnly aria-label={`${role} ${pluginId}`} className="appearance-none h-[15px] w-[15px] rounded-[4px] border border-indigo-500/40 bg-indigo-500/30 bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22white%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M12.207%204.793a1%201%200%20010%201.414l-5%205a1%201%200%2001-1.414%200l-2-2a1%201%200%20011.414-1.414L6.5%209.086l4.293-4.293a1%201%200%20011.414%200z%22%2F%3E%3C%2Fsvg%3E')] opacity-60 cursor-not-allowed" /></span>
            </Tooltip>
          ) : (
            <label className="inline-flex items-center justify-center cursor-pointer p-1.5 rounded-lg hover:bg-white/[0.04] transition-colors">
              <input type="checkbox" checked={checked} disabled={isUpdating} onChange={() => void onToggleRole(role, pluginId, !checked)} aria-label={`${role} ${pluginId}`} className="appearance-none h-[15px] w-[15px] rounded-[4px] border border-white/20 bg-white/[0.03] transition-all duration-200 checked:bg-indigo-500 checked:border-indigo-500 checked:bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22white%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M12.207%204.793a1%201%200%20010%201.414l-5%205a1%201%200%2001-1.414%200l-2-2a1%201%200%20011.414-1.414L6.5%209.086l4.293-4.293a1%201%200%20011.414%200z%22%2F%3E%3C%2Fsvg%3E')] hover:border-white/35 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 disabled:opacity-50 disabled:cursor-not-allowed" />
            </label>
          )}
        </div>
      </td>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title={t('admin.plugins.title')}
        subtitle={t('admin.plugins.subtitle')}
        icon={<Puzzle size={18} />}
        actions={
          <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading} leftIcon={<RefreshCw size={14} className={loading ? 'animate-spin' : ''} />}>
            {t('common.refresh')}
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          {/* Access by role matrix */}
          <div className="rounded-xl border border-white/[0.06] bg-black/40 backdrop-blur-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-indigo-400" />
                <h2 className="text-sm font-semibold text-white">{t('admin.plugins.accessByRole')}</h2>
              </div>
              {loading && <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />}
            </div>
            {loadError ? (
              <div className="p-6 text-center">
                <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                <p className="text-sm text-slate-400">{loadError}</p>
              </div>
            ) : loading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="flex-1 h-4 rounded bg-white/[0.04] animate-pulse" />
                    {roles.map(r => <div key={r} className="w-[15px] h-[15px] rounded-[4px] bg-white/[0.04] animate-pulse" />)}
                  </div>
                ))}
              </div>
            ) : state.plugins.length === 0 ? (
              <div className="p-10 text-center">
                <Puzzle className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <p className="text-sm text-slate-500">{t('admin.plugins.noPlugins')}</p>
                <p className="text-xs text-slate-600 mt-1">{t('admin.plugins.noPluginsDesc')}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-left">
                      <th className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider">{t('admin.plugins.plugin')}</th>
                      {roles.map(role => (
                        <th key={role} className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider text-center w-28">
                          <div className="flex flex-col items-center gap-1">
                            <div className="flex items-center gap-1.5">
                              <span>{t(`auth.role.${role}`)}</span>
                              {role === 'admin' && <Badge variant="indigo" size="sm" className="!px-1.5 !py-0"><ShieldCheck className="w-2.5 h-2.5" /></Badge>}
                            </div>
                            {role !== 'admin' && (
                              <button
                                type="button"
                                onClick={() => void onToggleAllForRole(role, !isRoleGranted(role, ALL_PLUGINS_ID))}
                                disabled={updating === `${role}:${ALL_PLUGINS_ID}`}
                                className="text-[10px] text-slate-500 hover:text-indigo-400 transition-colors disabled:opacity-50"
                              >
                                {t('admin.plugins.grantAll')}
                              </button>
                            )}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* All plugins row */}
                    <tr className="border-b border-white/[0.04] bg-white/[0.01]">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 bg-indigo-500/15 text-indigo-300">
                            <Puzzle className="w-3.5 h-3.5" />
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="text-slate-200 font-medium">{t('admin.plugins.allPlugins')}</span>
                            <span className="text-[10px] text-slate-500 font-mono">{ALL_PLUGINS_ID}</span>
                          </div>
                        </div>
                      </td>
                      {roles.map(role => renderCheckbox(role, ALL_PLUGINS_ID))}
                    </tr>
                    {/* Plugin rows */}
                    {state.plugins.map(p => (
                      <tr key={p.id} className="border-b border-white/[0.03] last:border-0 hover:bg-white/[0.02] transition-colors">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 bg-white/5 text-slate-400">
                              <Puzzle className="w-3.5 h-3.5" />
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="text-slate-200 font-medium truncate">{p.name}</span>
                              <span className="text-[10px] text-slate-500 font-mono truncate">{p.id} · v{p.version}</span>
                            </div>
                          </div>
                        </td>
                        {roles.map(role => renderCheckbox(role, p.id))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Per-user grants */}
          <div className="rounded-xl border border-white/[0.06] bg-black/40 backdrop-blur-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-indigo-400" />
              <h2 className="text-sm font-semibold text-white">{t('admin.plugins.perUser')}</h2>
            </div>
            <div className="p-5 flex flex-col gap-4">
              {usersError ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                    <span className="text-sm text-red-300">{usersError}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void refresh()}
                    disabled={loading}
                    leftIcon={<RefreshCw size={14} className={loading ? 'animate-spin' : ''} />}
                  >
                    {t('admin.plugins.usersRetry')}
                  </Button>
                </div>
              ) : (
                <div className="w-72">
                  <Select
                    label={t('admin.plugins.selectUser')}
                    placeholder={t('admin.plugins.selectUserPlaceholder')}
                    value={selectedUserId ?? ''}
                    onValueChange={v => setSelectedUserId(v)}
                    options={users.map(u => ({ value: String(u.id), label: `${u.username} (${t(`auth.role.${u.role}`)})` }))}
                  />
                </div>
              )}
              {selectedUser ? (
                <UserPluginGrants userId={Number(selectedUser.id)} username={selectedUser.username} role={selectedUser.role} />
              ) : !usersError ? (
                <div className="p-6 text-center">
                  <Puzzle className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                  <p className="text-sm text-slate-500">{t('admin.plugins.pickUser')}</p>
                  <p className="text-xs text-slate-600 mt-1">{t('admin.plugins.pickUserDesc')}</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
