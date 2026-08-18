/**
 * Privileges page — admin-only permission matrix editor.
 *
 * Fetches the full {roles, keys, matrix} from /api/auth/admin/permissions
 * and renders a table: rows are permission keys grouped under Sections /
 * Actions sub-headers, columns are roles. Each cell is a checkbox; the
 * admin column is always checked and disabled (immutable server-side).
 * Toggling a cell PUTs the new value and toasts success/error.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldCheck, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import Header from '../components/layout/Header';
import { useAppStore } from '../stores/app';
import { t } from '@/lib/i18n';
import { cn } from '../lib/utils';
import {
  getPermissionsMatrix,
  setPermission,
  PERMISSION_KEYS,
} from '../lib/backend/modules/auth';
import { Tooltip } from '@/components/ui/Tooltip';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

const SECTION_KEYS = PERMISSION_KEYS.filter(k => k.startsWith('section.'));
const ACTION_KEYS = PERMISSION_KEYS.filter(k => k.startsWith('action.'));

interface MatrixState {
  roles: string[];
  keys: string[];
  matrix: Record<string, Record<string, boolean>>;
}

export default function Privileges() {
  const language = useAppStore(state => state.language);
  void language; // re-render on language change

  const [state, setState] = useState<MatrixState>({ roles: [], keys: [], matrix: {} });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getPermissionsMatrix();
      setState(data);
    } catch (err) {
      const status = (err as Error & { status?: number })?.status;
      if (status === 401 || status === 403) {
        setLoadError(t('privileges.error'));
      } else {
        setLoadError(t('privileges.error'));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Use the canonical key list from PERMISSION_KEYS so the table always
  // shows every key in a stable order even if the backend omits one.
  const roles = useMemo(() => {
    // Always show admin first (it's the immutable reference column).
    const rs = state.roles.length > 0 ? state.roles : [];
    const unique = Array.from(new Set(rs));
    const adminIdx = unique.indexOf('admin');
    if (adminIdx > 0) {
      unique.splice(adminIdx, 1);
      unique.unshift('admin');
    } else if (adminIdx === -1 && !unique.includes('admin')) {
      unique.unshift('admin');
    }
    return unique;
  }, [state.roles]);

  const onToggle = async (role: string, key: string, next: boolean) => {
    const cellId = `${role}:${key}`;
    if (role === 'admin') return; // immutable
    setUpdating(cellId);
    // Optimistic update so the checkbox reflects immediately.
    setState(prev => ({
      ...prev,
      matrix: {
        ...prev.matrix,
        [role]: { ...prev.matrix[role], [key]: next },
      },
    }));
    try {
      await setPermission(role, key, next);
      toast.success(t('privileges.updated'));
      // Refresh to reconcile with the server's authoritative state.
      const data = await getPermissionsMatrix();
      setState(data);
    } catch (err) {
      // Revert on failure.
      setState(prev => ({
        ...prev,
        matrix: {
          ...prev.matrix,
          [role]: { ...prev.matrix[role], [key]: !next },
        },
      }));
      const message = err instanceof Error && err.message
        ? err.message
        : t('privileges.error');
      toast.error(message);
    } finally {
      setUpdating(null);
    }
  };

  const renderRow = (key: string) => {
    const isSection = key.startsWith('section.');
    return (
      <tr
        key={key}
        className="border-b border-white/[0.03] last:border-0 hover:bg-white/[0.02] transition-colors"
      >
        <td className="px-5 py-3">
          <div className="flex items-center gap-2.5">
            <div className={cn(
              'w-7 h-7 rounded-full flex items-center justify-center shrink-0',
              isSection
                ? 'bg-indigo-500/15 text-indigo-300'
                : 'bg-amber-500/15 text-amber-300'
            )}>
              {isSection
                ? <ShieldCheck className="w-3.5 h-3.5" />
                : <RefreshCw className="w-3.5 h-3.5" />}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-slate-200 font-medium truncate">
                {t(`privileges.key.${key}`)}
              </span>
              <span className="text-[10px] text-slate-500 font-mono truncate">
                {key}
              </span>
            </div>
          </div>
        </td>
        {roles.map(role => {
          const cellId = `${role}:${key}`;
          const checked = Boolean(state.matrix[role]?.[key]);
          const isAdmin = role === 'admin';
          const isUpdating = updating === cellId;
          return (
            <td
              key={role}
              className="px-5 py-3 text-center"
            >
              <div className="flex items-center justify-center">
                {isAdmin ? (
                  <Tooltip content={t('privileges.adminImmutable')} side="top">
                    <span className="inline-flex">
                      <input
                        type="checkbox"
                        checked
                        disabled
                        readOnly
                        aria-label={`${role} ${key}`}
                        className="appearance-none h-[15px] w-[15px] rounded-[4px] border border-indigo-500/40 bg-indigo-500/30 bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22white%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M12.207%204.793a1%201%200%20010%201.414l-5%205a1%201%200%2001-1.414%200l-2-2a1%201%200%20011.414-1.414L6.5%209.086l4.293-4.293a1%201%200%20011.414%200z%22%2F%3E%3C%2Fsvg%3E')] opacity-60 cursor-not-allowed"
                      />
                    </span>
                  </Tooltip>
                ) : (
                  <label className="inline-flex items-center justify-center cursor-pointer p-1.5 rounded-lg hover:bg-white/[0.04] transition-colors">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isUpdating}
                      onChange={() => void onToggle(role, key, !checked)}
                      aria-label={`${role} ${key}`}
                      className="appearance-none h-[15px] w-[15px] rounded-[4px] border border-white/20 bg-white/[0.03] transition-all duration-200 checked:bg-indigo-500 checked:border-indigo-500 checked:bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22white%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M12.207%204.793a1%201%200%20010%201.414l-5%205a1%201%200%2001-1.414%200l-2-2a1%201%200%20011.414-1.414L6.5%209.086l4.293-4.293a1%201%200%20011.414%200z%22%2F%3E%3C%2Fsvg%3E')] hover:border-white/35 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </label>
                )}
              </div>
            </td>
          );
        })}
      </tr>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title={t('privileges.title')}
        subtitle={t('privileges.subtitle')}
        icon={<ShieldCheck size={18} />}
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading}
            leftIcon={<RefreshCw size={14} className={loading ? 'animate-spin' : ''} />}
          >
            {t('common.refresh')}
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          {/* Permission matrix table */}
          <div className="rounded-xl border border-white/[0.06] bg-black/40 backdrop-blur-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">{t('privileges.title')}</h2>
              {loading && <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />}
            </div>

            {loadError ? (
              <div className="p-6 text-center">
                <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                <p className="text-sm text-slate-400">{loadError}</p>
              </div>
            ) : loading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-white/[0.04] animate-pulse" />
                    <div className="flex-1 h-4 rounded bg-white/[0.04] animate-pulse" />
                    {roles.length > 0 ? roles.map(r => (
                      <div key={r} className="w-[15px] h-[15px] rounded-[4px] bg-white/[0.04] animate-pulse" />
                    )) : Array.from({ length: 4 }).map((_, j) => (
                      <div key={j} className="w-[15px] h-[15px] rounded-[4px] bg-white/[0.04] animate-pulse" />
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-left">
                      <th className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider">
                        {t('common.name')}
                      </th>
                      {roles.map(role => (
                        <th
                          key={role}
                          className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider text-center w-28"
                        >
                          <div className="flex items-center justify-center gap-1.5">
                            <span>{t(`auth.role.${role}`)}</span>
                            {role === 'admin' && (
                              <Badge variant="indigo" size="sm" className="!px-1.5 !py-0">
                                <ShieldCheck className="w-2.5 h-2.5" />
                              </Badge>
                            )}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Sections sub-header */}
                    <tr className="border-b border-white/[0.04] bg-white/[0.01]">
                      <td
                        colSpan={roles.length + 1}
                        className="px-5 py-2 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]"
                      >
                        {t('privileges.sections')}
                      </td>
                    </tr>
                    {SECTION_KEYS.map(renderRow)}
                    {/* Actions sub-header */}
                    <tr className="border-b border-white/[0.04] bg-white/[0.01]">
                      <td
                        colSpan={roles.length + 1}
                        className="px-5 py-2 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]"
                      >
                        {t('privileges.actions')}
                      </td>
                    </tr>
                    {ACTION_KEYS.map(renderRow)}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
