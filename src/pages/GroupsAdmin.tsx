/**
 * Groups admin — group levels (verify/suspend) and numeric limits.
 *
 * The groups table comes from ``groups_admin_list`` (which does not carry
 * the level), so the Level column shows the level returned by the latest
 * ``group_verify``/``group_suspend`` response and "unknown" until an
 * action runs. Limits are the three ``groups.*`` server settings keys.
 *
 * Visual language matches AdminOverview.tsx: Deep Space glassmorphism,
 * shared UI kit (GlassCard/Table/Badge/EmptyState/Input), Header with icon.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Gauge,
  ShieldCheck,
  Users as UsersIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import Header from '../components/layout/Header';
import { useAppStore } from '../stores/app';
import { t } from '@/lib/i18n';
import {
  groupsAdminList,
  groupVerify,
  groupSuspend,
  type GroupAdminRow,
} from '../lib/backend/modules/groups';
import { getGroupsLimits, setGroupsLimits } from '../lib/backend/modules/settings';
import { askConfirm } from '../components/ui/ConfirmDialogHost';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { GlassCard } from '../components/ui/GlassCard';
import { Input } from '../components/ui/Input';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../components/ui/Table';

const LEVEL_VARIANT: Record<string, 'slate' | 'success' | 'danger'> = {
  open: 'slate',
  verified: 'success',
  suspended: 'danger',
};

const LEVEL_LABEL_KEY: Record<string, string> = {
  open: 'admin.groups.levelOpen',
  verified: 'admin.groups.levelVerified',
  suspended: 'admin.groups.levelSuspended',
};

interface LimitsForm {
  maxPerUser: string;
  openMaxMembers: string;
  maxGatedPlugins: string;
}

const EMPTY_LIMITS_FORM: LimitsForm = {
  maxPerUser: '',
  openMaxMembers: '',
  maxGatedPlugins: '',
};

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

export default function GroupsAdmin() {
  const language = useAppStore(state => state.language);
  void language; // re-render on language change

  const [groups, setGroups] = useState<GroupAdminRow[]>([]);
  const [levels, setLevels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [limits, setLimits] = useState<LimitsForm>(EMPTY_LIMITS_FORM);
  const [savingLimits, setSavingLimits] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [groupsRes, limitsRes] = await Promise.allSettled([
      groupsAdminList(),
      getGroupsLimits(),
    ]);
    if (groupsRes.status === 'fulfilled') {
      setGroups(groupsRes.value.groups);
    } else {
      setLoadError(errorMessage(groupsRes.reason));
    }
    if (limitsRes.status === 'fulfilled') {
      const v = limitsRes.value;
      setLimits({
        maxPerUser: v.maxPerUser != null ? String(v.maxPerUser) : '',
        openMaxMembers: v.openMaxMembers != null ? String(v.openMaxMembers) : '',
        maxGatedPlugins: v.maxGatedPlugins != null ? String(v.maxGatedPlugins) : '',
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const onVerify = async (group: GroupAdminRow) => {
    setActing(group.id);
    try {
      const updated = await groupVerify(group.id);
      setLevels(prev => ({ ...prev, [group.id]: updated.level ?? 'verified' }));
      toast.success(t('admin.groups.verified'));
    } catch (err) {
      toast.error(errorMessage(err) || t('admin.groups.actionFailed'));
    } finally {
      setActing(null);
    }
  };

  const onSuspend = async (group: GroupAdminRow) => {
    const ok = await askConfirm({
      title: t('admin.groups.suspendConfirmTitle'),
      message: t('admin.groups.suspendConfirmBody', { group: group.name }),
      confirmText: t('admin.groups.suspendConfirm'),
      cancelText: t('common.cancel'),
      variant: 'danger',
    });
    if (!ok) return;
    setActing(group.id);
    try {
      const updated = await groupSuspend(group.id);
      setLevels(prev => ({ ...prev, [group.id]: updated.level ?? 'suspended' }));
      toast.success(t('admin.groups.suspended'));
    } catch (err) {
      toast.error(errorMessage(err) || t('admin.groups.actionFailed'));
    } finally {
      setActing(null);
    }
  };

  const onSaveLimits = async () => {
    const parse = (raw: string): number | null | undefined => {
      if (raw.trim() === '') return null;
      const num = Number(raw.trim());
      if (!Number.isInteger(num) || num < 1) return undefined;
      return num;
    };
    const parsed = {
      maxPerUser: parse(limits.maxPerUser),
      openMaxMembers: parse(limits.openMaxMembers),
      maxGatedPlugins: parse(limits.maxGatedPlugins),
    };
    if (
      parsed.maxPerUser === undefined ||
      parsed.openMaxMembers === undefined ||
      parsed.maxGatedPlugins === undefined
    ) {
      toast.error(t('admin.groups.limitsInvalid'));
      return;
    }
    setSavingLimits(true);
    try {
      await setGroupsLimits({
        maxPerUser: parsed.maxPerUser,
        openMaxMembers: parsed.openMaxMembers,
        maxGatedPlugins: parsed.maxGatedPlugins,
      });
      toast.success(t('admin.groups.limitsSaved'));
    } catch (err) {
      toast.error(errorMessage(err) || t('admin.groups.limitsFailed'));
    } finally {
      setSavingLimits(false);
    }
  };

  const limitFields: { key: keyof LimitsForm; label: string }[] = [
    { key: 'maxPerUser', label: t('admin.groups.maxPerUser') },
    { key: 'openMaxMembers', label: t('admin.groups.openMaxMembers') },
    { key: 'maxGatedPlugins', label: t('admin.groups.maxGatedPlugins') },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title={t('admin.groups.title')}
        subtitle={t('admin.groups.subtitle')}
        icon={<UsersIcon size={18} />}
        actions={
          <Button variant="ghost" size="sm" onClick={() => void refresh()} isLoading={loading}>
            {t('admin.groups.refresh')}
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
                {t('admin.groups.retry')}
              </Button>
            </div>
          )}

          <SectionCard icon={<UsersIcon className="w-4 h-4" />} title={t('admin.groups.listTitle')}>
            {loading ? (
              <div className="p-5 flex justify-center"><LoadingSpinner /></div>
            ) : groups.length === 0 ? (
              <EmptyState icon={UsersIcon} title={t('admin.groups.empty')} compact className="m-3" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('admin.groups.colGroup')}</TableHead>
                    <TableHead>{t('admin.groups.colOwner')}</TableHead>
                    <TableHead>{t('admin.groups.colMembers')}</TableHead>
                    <TableHead>{t('admin.groups.colShares')}</TableHead>
                    <TableHead>{t('admin.groups.colLevel')}</TableHead>
                    <TableHead>{t('admin.groups.colActions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map(g => {
                    const level = levels[g.id];
                    return (
                      <TableRow key={g.id}>
                        <TableCell className="font-medium text-white">{g.name}</TableCell>
                        <TableCell>{g.owner_username || '—'}</TableCell>
                        <TableCell>{g.member_count}</TableCell>
                        <TableCell>{g.share_count}</TableCell>
                        <TableCell>
                          <Badge variant={level ? LEVEL_VARIANT[level] ?? 'slate' : 'outline'} size="sm">
                            {level
                              ? t(LEVEL_LABEL_KEY[level] ?? 'admin.groups.levelUnknown')
                              : t('admin.groups.levelUnknown')}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={acting === g.id}
                              isLoading={acting === g.id}
                              onClick={() => void onVerify(g)}
                            >
                              {t('admin.groups.verify')}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={acting === g.id}
                              onClick={() => void onSuspend(g)}
                              className="text-red-300 hover:text-red-200"
                            >
                              {t('admin.groups.suspend')}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </SectionCard>

          <SectionCard icon={<Gauge className="w-4 h-4" />} title={t('admin.groups.limitsTitle')}>
            <div className="p-5 flex flex-col gap-4">
              <p className="text-xs text-slate-400 leading-relaxed">
                {t('admin.groups.limitsHint')}
              </p>
              {loading ? (
                <LoadingSpinner size="sm" />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {limitFields.map(f => (
                    <Input
                      key={f.key}
                      type="number"
                      min={1}
                      label={f.label}
                      value={limits[f.key]}
                      onChange={e =>
                        setLimits(prev => ({ ...prev, [f.key]: e.target.value }))
                      }
                      placeholder={t('admin.groups.limitsDefault')}
                    />
                  ))}
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void onSaveLimits()}
                  isLoading={savingLimits}
                  leftIcon={<ShieldCheck size={14} />}
                >
                  {t('admin.groups.limitsSave')}
                </Button>
              </div>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
