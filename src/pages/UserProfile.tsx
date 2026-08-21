/**
 * UserProfile page — admin-only single-user overview.
 *
 * Route: /users/:userId (wrapped in AdminRoute, lazy-loaded in App.tsx).
 *
 * On mount calls safeInvoke('admin_user_overview', { userId }) and renders
 * six cards: Header, Permissions, Groups, Plugins, Keys, Usage.
 *
 * Backend response shape:
 *   {
 *     user: { id, username, role, telegram_id?, created_at? },
 *     permissions: string[],
 *     groups: { id, name, owner: boolean }[],
 *     plugins: { effective: string[], overrides: { pluginId, granted }[] },
 *     keys: { ai_gateway_credentials, proxy_keys, provider_accounts, totp },
 *     usage: { requests_today, tokens_today },
 *   }
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  UserCircle,
  ArrowLeft,
  Loader2,
  AlertCircle,
  RefreshCw,
  ShieldCheck,
  Users as UsersIcon,
  Puzzle,
  KeyRound,
  BarChart3,
  Check,
  X,
  Crown,
} from 'lucide-react';
import Header from '../components/layout/Header';
import { useAppStore } from '../stores/app';
import { t } from '@/lib/i18n';
import { safeInvoke } from '../lib/backend/core/invoke';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Tooltip } from '@/components/ui/Tooltip';
import { StatCard } from '@/components/ui/StatCard';

// ── Types ───────────────────────────────────────────────────────────────────

interface OverviewUser {
  id: string | number;
  username: string;
  role: 'admin' | 'user' | 'vip' | 'premium' | 'elite';
  telegram_id?: string | number | null;
  created_at?: string | null;
}

interface OverviewGroup {
  id: string | number;
  name: string;
  owner: boolean;
}

interface OverviewOverride {
  pluginId: string;
  granted: boolean;
}

interface OverviewKeys {
  ai_gateway_credentials: number;
  proxy_keys: number;
  provider_accounts: number;
  totp: number;
}

interface OverviewUsage {
  requests_today: number;
  tokens_today: number;
}

interface AdminUserOverview {
  user: OverviewUser;
  permissions: string[];
  groups: OverviewGroup[];
  plugins: {
    effective: string[];
    overrides: OverviewOverride[];
  };
  keys: OverviewKeys;
  usage: OverviewUsage;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return t('admin.userProfile.notSet');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t('admin.userProfile.notSet');
  return date.toLocaleString();
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function UserProfile() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const language = useAppStore(state => state.language);
  void language; // re-render on language change

  const [data, setData] = useState<AdminUserOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await safeInvoke<AdminUserOverview>('admin_user_overview', { userId });
      setData(result);
    } catch {
      setError(t('admin.userProfile.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title={t('admin.userProfile.title')}
        subtitle={t('admin.userProfile.subtitle')}
        icon={<UserCircle size={18} />}
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
          {/* Back link */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/users')}
            leftIcon={<ArrowLeft className="w-3.5 h-3.5" />}
            className="self-start"
          >
            {t('admin.userProfile.backToUsers')}
          </Button>

          {error ? (
            <div className="rounded-xl border border-white/[0.06] bg-black/40 backdrop-blur-sm p-6 text-center">
              <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
              <p className="text-sm text-slate-400 mb-3">{error}</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void refresh()}
                leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
              >
                {t('admin.userProfile.retry')}
              </Button>
            </div>
          ) : loading ? (
            <div className="rounded-xl border border-white/[0.06] bg-black/40 backdrop-blur-sm p-10 text-center">
              <Loader2 className="w-6 h-6 text-indigo-400 animate-spin mx-auto mb-2" />
              <p className="text-sm text-slate-400">{t('admin.userProfile.loading')}</p>
            </div>
          ) : data ? (
            <>
              {/* Header card */}
              <div className="rounded-xl border border-white/[0.06] bg-black/40 backdrop-blur-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
                  <UserCircle className="w-4 h-4 text-indigo-400" />
                  <h2 className="text-sm font-semibold text-white">{t('admin.userProfile.header')}</h2>
                </div>
                <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1">
                      {t('admin.userProfile.username')}
                    </p>
                    <p className="text-sm text-slate-200 font-medium truncate">{data.user.username}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1">
                      {t('admin.userProfile.role')}
                    </p>
                    <Badge
                      variant={data.user.role === 'admin' ? 'info' : 'default'}
                      size="sm"
                    >
                      {t(`auth.role.${data.user.role}`)}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1">
                      {t('admin.userProfile.telegramId')}
                    </p>
                    <p className="text-sm text-slate-200 font-medium truncate">
                      {data.user.telegram_id != null && data.user.telegram_id !== ''
                        ? String(data.user.telegram_id)
                        : t('admin.userProfile.notSet')}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1">
                      {t('admin.userProfile.createdAt')}
                    </p>
                    <p className="text-sm text-slate-200 font-medium truncate">
                      {formatTimestamp(data.user.created_at)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Permissions card */}
              <div className="rounded-xl border border-white/[0.06] bg-black/40 backdrop-blur-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-indigo-400" />
                  <h2 className="text-sm font-semibold text-white">{t('admin.userProfile.permissions')}</h2>
                </div>
                <div className="p-5">
                  {data.permissions.length === 0 ? (
                    <p className="text-sm text-slate-500">{t('admin.userProfile.permissionsEmpty')}</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {data.permissions.map(p => (
                        <Badge key={p} variant="default" size="sm">
                          {p}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Groups card */}
              <div className="rounded-xl border border-white/[0.06] bg-black/40 backdrop-blur-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
                  <UsersIcon className="w-4 h-4 text-indigo-400" />
                  <h2 className="text-sm font-semibold text-white">{t('admin.userProfile.groups')}</h2>
                </div>
                <div className="p-5">
                  {data.groups.length === 0 ? (
                    <p className="text-sm text-slate-500">{t('admin.userProfile.groupsEmpty')}</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {data.groups.map(g => (
                        <li
                          key={String(g.id)}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]"
                        >
                          <span className="text-sm text-slate-200 font-medium truncate flex-1">
                            {g.name}
                          </span>
                          {g.owner && (
                            <Tooltip content={t('admin.userProfile.groupOwner')} side="top">
                              <Badge variant="warning" size="sm" className="shrink-0">
                                <Crown className="w-3 h-3" />
                                {t('admin.userProfile.groupOwner')}
                              </Badge>
                            </Tooltip>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Plugins card */}
              <div className="rounded-xl border border-white/[0.06] bg-black/40 backdrop-blur-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
                  <Puzzle className="w-4 h-4 text-indigo-400" />
                  <h2 className="text-sm font-semibold text-white">{t('admin.userProfile.plugins')}</h2>
                </div>
                <div className="p-5 flex flex-col gap-4">
                  {/* Effective */}
                  <div>
                    <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-2">
                      {t('admin.userProfile.pluginsEffective')}
                    </p>
                    {data.plugins.effective.length === 0 ? (
                      <p className="text-sm text-slate-500">{t('admin.userProfile.pluginsEmpty')}</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {data.plugins.effective.map(id => (
                          <Badge key={id} variant="success" size="sm">
                            {id}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Overrides */}
                  {data.plugins.overrides.length > 0 && (
                    <div>
                      <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-2">
                        {t('admin.userProfile.pluginsOverrides')}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {data.plugins.overrides.map(o => (
                          <Badge
                            key={o.pluginId}
                            variant={o.granted ? 'success' : 'danger'}
                            size="sm"
                          >
                            {o.granted ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                            {o.pluginId}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Keys card */}
              <div className="rounded-xl border border-white/[0.06] bg-black/40 backdrop-blur-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-indigo-400" />
                  <h2 className="text-sm font-semibold text-white">{t('admin.userProfile.keys')}</h2>
                </div>
                <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <StatCard
                    icon={<KeyRound className="w-4 h-4" />}
                    label={t('admin.userProfile.keysAiGateway')}
                    value={data.keys.ai_gateway_credentials}
                  />
                  <StatCard
                    icon={<KeyRound className="w-4 h-4" />}
                    label={t('admin.userProfile.keysProxy')}
                    value={data.keys.proxy_keys}
                  />
                  <StatCard
                    icon={<KeyRound className="w-4 h-4" />}
                    label={t('admin.userProfile.keysProviderAccounts')}
                    value={data.keys.provider_accounts}
                  />
                  <StatCard
                    icon={<KeyRound className="w-4 h-4" />}
                    label={t('admin.userProfile.keysTotp')}
                    value={data.keys.totp}
                  />
                </div>
              </div>

              {/* Usage card */}
              <div className="rounded-xl border border-white/[0.06] bg-black/40 backdrop-blur-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-indigo-400" />
                  <h2 className="text-sm font-semibold text-white">{t('admin.userProfile.usage')}</h2>
                </div>
                <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <StatCard
                    icon={<BarChart3 className="w-4 h-4" />}
                    label={t('admin.userProfile.usageRequestsToday')}
                    value={data.usage.requests_today}
                  />
                  <StatCard
                    icon={<BarChart3 className="w-4 h-4" />}
                    label={t('admin.userProfile.usageTokensToday')}
                    value={data.usage.tokens_today}
                  />
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
