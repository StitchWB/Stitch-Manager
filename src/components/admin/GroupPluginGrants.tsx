/**
 * GroupPluginGrants — group→plugin grant matrix (card body).
 *
 * Self-contained: fetches plugin_grants_group_list on mount. Rows =
 * plugins (with a special first row "*" for all plugins), columns =
 * groups. Cell = checkbox → plugin_grants_group_set (optimistic update
 * + rollback + toast), then re-fetch to reconcile with server truth.
 * Mirrors the "Access by role" matrix markup from Plugins.tsx.
 */

import { useCallback, useEffect, useState } from 'react';
import { Puzzle, AlertCircle, Users } from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';
import {
  pluginGrantsGroupList,
  pluginGrantsGroupSet,
  type PluginGrantsGroupListResponse,
} from '@/lib/backend/modules/pluginGrants';

const ALL_PLUGINS_ID = '*';

export function GroupPluginGrants() {
  const [state, setState] = useState<PluginGrantsGroupListResponse>({ groups: {}, groupNames: {}, plugins: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await pluginGrantsGroupList();
      setState(data);
    } catch {
      setLoadError(t('admin.plugins.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Re-fetch only the group matrix (used after successful group mutations
  // to reconcile with server truth — e.g. backend normalizes "*" by
  // deduping individual ids, or concurrent admin edits changed state).
  const refreshGroups = useCallback(async () => {
    const data = await pluginGrantsGroupList();
    setState(data);
  }, []);

  const groupEntries = Object.entries(state.groupNames);

  const isGroupGranted = useCallback((groupId: string, pluginId: string): boolean => {
    const list = state.groups[groupId] ?? [];
    return list.includes(pluginId) || list.includes(ALL_PLUGINS_ID);
  }, [state.groups]);

  const onToggleGroup = async (groupId: string, pluginId: string, next: boolean) => {
    const cellId = `${groupId}:${pluginId}`;
    setUpdating(cellId);
    // Optimistic update
    setState(prev => {
      const current = prev.groups[groupId] ?? [];
      const has = current.includes(pluginId);
      let nextList: string[];
      if (next && !has) nextList = [...current, pluginId];
      else if (!next && has) nextList = current.filter(id => id !== pluginId);
      else nextList = current;
      return { ...prev, groups: { ...prev.groups, [groupId]: nextList } };
    });
    try {
      await pluginGrantsGroupSet({ groupId, pluginId, granted: next });
      toast.success(t('admin.plugins.updated'));
      // Re-fetch group list to reconcile with server truth (backend may
      // normalize, e.g. granting "*" dedupes individual ids; concurrent
      // admin edits). Optimistic update stays for instant UI.
      await refreshGroups().catch(() => { /* optimistic state remains; toast already shown */ });
    } catch {
      // Rollback
      setState(prev => {
        const current = prev.groups[groupId] ?? [];
        const has = current.includes(pluginId);
        let reverted: string[];
        if (!next && !has) reverted = [...current, pluginId];
        else if (next && has) reverted = current.filter(id => id !== pluginId);
        else reverted = current;
        return { ...prev, groups: { ...prev.groups, [groupId]: reverted } };
      });
      toast.error(t('admin.plugins.grantFailed'));
    } finally {
      setUpdating(null);
    }
  };

  const renderCheckbox = (groupId: string, pluginId: string) => {
    const cellId = `${groupId}:${pluginId}`;
    const checked = isGroupGranted(groupId, pluginId);
    const isUpdating = updating === cellId;
    return (
      <td key={groupId} className="px-5 py-3 text-center">
        <div className="flex items-center justify-center">
          <label className="inline-flex items-center justify-center cursor-pointer p-1.5 rounded-lg hover:bg-white/[0.04] transition-colors">
            <input type="checkbox" checked={checked} disabled={isUpdating} onChange={() => void onToggleGroup(groupId, pluginId, !checked)} aria-label={`${groupId} ${pluginId}`} className="appearance-none h-[15px] w-[15px] rounded-[4px] border border-white/20 bg-white/[0.03] transition-all duration-200 checked:bg-indigo-500 checked:border-indigo-500 checked:bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22white%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M12.207%204.793a1%201%200%20010%201.414l-5%205a1%201%200%2001-1.414%200l-2-2a1%201%200%20011.414-1.414L6.5%209.086l4.293-4.293a1%201%200%20011.414%200z%22%2F%3E%3C%2Fsvg%3E')] hover:border-white/35 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 disabled:opacity-50 disabled:cursor-not-allowed" />
          </label>
        </div>
      </td>
    );
  };

  if (loadError) {
    return (
      <div className="p-6 text-center">
        <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
        <p className="text-sm text-slate-400">{loadError}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="flex-1 h-4 rounded bg-white/[0.04] animate-pulse" />
            {groupEntries.map(([groupId]) => <div key={groupId} className="w-[15px] h-[15px] rounded-[4px] bg-white/[0.04] animate-pulse" />)}
          </div>
        ))}
      </div>
    );
  }

  if (groupEntries.length === 0) {
    return (
      <div className="p-10 text-center">
        <Users className="w-10 h-10 text-slate-600 mx-auto mb-3" />
        <p className="text-sm text-slate-500">{t('admin.plugins.noGroups')}</p>
        <p className="text-xs text-slate-600 mt-1">{t('admin.plugins.noGroupsDesc')}</p>
      </div>
    );
  }

  if (state.plugins.length === 0) {
    return (
      <div className="p-10 text-center">
        <Puzzle className="w-10 h-10 text-slate-600 mx-auto mb-3" />
        <p className="text-sm text-slate-500">{t('admin.plugins.noPlugins')}</p>
        <p className="text-xs text-slate-600 mt-1">{t('admin.plugins.noPluginsDesc')}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/[0.06] text-left">
            <th className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider">{t('admin.plugins.plugin')}</th>
            {groupEntries.map(([groupId, name]) => (
              <th key={groupId} className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider text-center w-28">
                <div className="flex flex-col items-center gap-1">
                  <span className="max-w-full truncate" title={name}>{name}</span>
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
            {groupEntries.map(([groupId]) => renderCheckbox(groupId, ALL_PLUGINS_ID))}
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
              {groupEntries.map(([groupId]) => renderCheckbox(groupId, p.id))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
