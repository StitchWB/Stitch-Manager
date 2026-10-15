/**
 * Admin Overview — home of the admin zone.
 *
 * Surfaces controls that were previously API-only: the all-groups table
 * (groups_admin_list), partner members, the enforce_login policy toggle
 * (GET /api/auth/status + POST /api/auth/policy) and the plugin-grant
 * audit log (plugin_grants_audit_list).
 *
 * Visual language matches Codes.tsx / Users.tsx: Deep Space glassmorphism,
 * shared UI kit (GlassCard/Table/Toggle/Badge/EmptyState), Header with icon.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Crown,
  ScrollText,
  ShieldCheck,
  Users as UsersIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import Header from '../components/layout/Header';
import { useAppStore } from '../stores/app';
import { t } from '@/lib/i18n';
import { groupsAdminList, type GroupAdminRow } from '../lib/backend/modules/groups';
import { listPartnerMembers, type PartnerMemberRow } from '../lib/backend/modules/partners';
import {
  pluginGrantsAuditList,
  type PluginGrantAuditEntry,
} from '../lib/backend/modules/pluginGrants';
import { getAuthStatus, setLoginPolicy } from '../lib/backend/modules/auth';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { GlassCard } from '../components/ui/GlassCard';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { Toggle } from '../components/ui/Toggle';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../components/ui/Table';

const AUDIT_LIMIT = 20;

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function SectionCard({
  icon,
  title,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <GlassCard className="overflow-hidden">
      <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-indigo-400 shrink-0">{icon}</span>
          <h2 className="text-sm font-semibold text-white truncate">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </GlassCard>
  );
}

export default function AdminOverview() {
  const language = useAppStore(state => state.language);
  void language; // re-render on language change

  const [groups, setGroups] = useState<GroupAdminRow[]>([]);
  const [members, setMembers] = useState<PartnerMemberRow[]>([]);
  const [audit, setAudit] = useState<PluginGrantAuditEntry[]>([]);
  const [enforceLogin, setEnforceLogin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [groupsRes, membersRes, auditRes, statusRes] = await Promise.allSettled([
      groupsAdminList(),
      listPartnerMembers(),
      pluginGrantsAuditList(AUDIT_LIMIT),
      getAuthStatus(),
    ]);
    if (groupsRes.status === 'fulfilled') setGroups(groupsRes.value.groups);
    if (membersRes.status === 'fulfilled') setMembers(membersRes.value);
    if (auditRes.status === 'fulfilled') setAudit(auditRes.value.entries);
    if (statusRes.status === 'fulfilled') setEnforceLogin(statusRes.value.enforce_login);
    const failed = [groupsRes, membersRes, auditRes].find(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    if (failed) setLoadError(errorMessage(failed.reason));
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const onToggleEnforceLogin = async (next: boolean) => {
    setSavingPolicy(true);
    try {
      const persisted = await setLoginPolicy(next);
      setEnforceLogin(persisted);
      toast.success(t('admin.overview.loginUpdated'));
    } catch {
      toast.error(t('admin.overview.loginFailed'));
    } finally {
      setSavingPolicy(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title={t('admin.overview.title')}
        subtitle={t('admin.overview.subtitle')}
        icon={<ShieldCheck size={18} />}
        actions={
          <Button variant="ghost" size="sm" onClick={() => void refresh()} isLoading={loading}>
            {t('admin.overview.refresh')}
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          {loadError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-red-300 min-w-0">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="truncate">{loadError}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => void refresh()}>
                {t('admin.overview.retry')}
              </Button>
            </div>
          )}

          {/* Login policy (enforce_login) */}
          <SectionCard icon={<ShieldCheck className="w-4 h-4" />} title={t('admin.overview.loginTitle')}>
            <div className="p-5 flex flex-col gap-3">
              <p className="text-xs text-slate-400 leading-relaxed">
                {t('admin.overview.loginEnforceHint')}
              </p>
              {enforceLogin === null ? (
                <LoadingSpinner size="sm" />
              ) : (
                <Toggle
                  label={t('admin.overview.loginEnforce')}
                  checked={enforceLogin}
                  onChange={next => void onToggleEnforceLogin(next)}
                  disabled={savingPolicy}
                />
              )}
            </div>
          </SectionCard>

          {/* All groups */}
          <SectionCard icon={<UsersIcon className="w-4 h-4" />} title={t('admin.overview.groupsTitle')}>
            {loading ? (
              <div className="p-5 flex justify-center"><LoadingSpinner /></div>
            ) : groups.length === 0 ? (
              <EmptyState icon={UsersIcon} title={t('admin.overview.groupsEmpty')} compact className="m-3" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('admin.overview.colGroupName')}</TableHead>
                    <TableHead>{t('admin.overview.colOwner')}</TableHead>
                    <TableHead>{t('admin.overview.colMembers')}</TableHead>
                    <TableHead>{t('admin.overview.colShares')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map(g => (
                    <TableRow key={g.id}>
                      <TableCell className="font-medium text-white">{g.name}</TableCell>
                      <TableCell>{g.owner_username || '—'}</TableCell>
                      <TableCell>{g.member_count}</TableCell>
                      <TableCell>{g.share_count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>

          {/* Partner members */}
          <SectionCard icon={<Crown className="w-4 h-4" />} title={t('admin.overview.partnersTitle')}>
            {loading ? (
              <div className="p-5 flex justify-center"><LoadingSpinner /></div>
            ) : members.length === 0 ? (
              <EmptyState icon={Crown} title={t('admin.overview.partnersEmpty')} compact className="m-3" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('admin.overview.colChannel')}</TableHead>
                    <TableHead>{t('admin.overview.colUser')}</TableHead>
                    <TableHead>{t('admin.overview.colGrantedRole')}</TableHead>
                    <TableHead>{t('admin.overview.colInvitedBy')}</TableHead>
                    <TableHead>{t('admin.overview.colCreated')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map(m => (
                    <TableRow key={`${m.channel_id}:${m.user_id}`}>
                      <TableCell className="font-mono">{m.channel_id}</TableCell>
                      <TableCell>{m.user_id}</TableCell>
                      <TableCell><Badge variant="indigo" size="sm">{m.granted_role}</Badge></TableCell>
                      <TableCell>{m.invited_by_tg_id ?? '—'}</TableCell>
                      <TableCell>{formatDate(m.created_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>

          {/* Plugin-grant audit */}
          <SectionCard icon={<ScrollText className="w-4 h-4" />} title={t('admin.overview.auditTitle')}>
            {loading ? (
              <div className="p-5 flex justify-center"><LoadingSpinner /></div>
            ) : audit.length === 0 ? (
              <EmptyState icon={ScrollText} title={t('admin.overview.auditEmpty')} compact className="m-3" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('admin.overview.colTs')}</TableHead>
                    <TableHead>{t('admin.overview.colAdmin')}</TableHead>
                    <TableHead>{t('admin.overview.colAction')}</TableHead>
                    <TableHead>{t('admin.overview.colScope')}</TableHead>
                    <TableHead>{t('admin.overview.colTarget')}</TableHead>
                    <TableHead>{t('admin.overview.colPlugin')}</TableHead>
                    <TableHead>{t('admin.overview.colGranted')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {audit.map((e, i) => (
                    <TableRow key={`${e.ts}:${e.pluginId}:${i}`}>
                      <TableCell>{formatDate(e.ts)}</TableCell>
                      <TableCell>{e.adminUserId}</TableCell>
                      <TableCell>{e.action}</TableCell>
                      <TableCell><Badge variant="slate" size="sm">{e.scope}</Badge></TableCell>
                      <TableCell>{e.target}</TableCell>
                      <TableCell className="font-mono">{e.pluginId}</TableCell>
                      <TableCell>
                        <Badge variant={e.granted ? 'success' : 'danger'} size="sm">
                          {e.granted ? t('admin.overview.grantedYes') : t('admin.overview.grantedNo')}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
