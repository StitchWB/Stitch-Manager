/**
 * Users page — admin-only user management.
 *
 * Lists all users with client-side search, supports creating new users
 * (username/password/role). Row actions (profile, plugin grants, delete) are
 * consolidated in a per-row OverflowMenu; delete previews backend ownership
 * impact — plain ConfirmDialog when nothing is owned, otherwise a transfer
 * dialog requiring a successor. Surfaces 400 self/last-admin and 409
 * unsafe-delete errors as toasts.
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users as UsersIcon, Trash2, Plus, Loader2, AlertCircle, ShieldCheck, User as UserIcon, Puzzle, Eye } from 'lucide-react';
import { toast } from 'sonner';
import Header from '../components/layout/Header';
import { useAuthStore } from '../stores/auth';
import { useAppStore } from '../stores/app';
import { t } from '@/lib/i18n';
import { cn } from '../lib/utils';
import { listUsers, createUser, deleteUser, getDeleteImpact, updateUserRole, type AuthUser, type DeleteImpact } from '../lib/backend/modules/auth';
import { errorMessage } from '../lib/errorText';
import { askConfirm } from '../components/ui/ConfirmDialogHost';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/Table';
import { ToolbarSearchField } from '../components/ui/ToolbarSearchField';
import { OverflowMenu } from '../components/ui/OverflowMenu';
import { Tooltip } from '@/components/ui/Tooltip';
import { TierBadge } from '@/components/ui/TierBadge';
import { Modal } from '@/components/ui/Modal';
import { UserPluginGrants } from '@/components/admin/UserPluginGrants';

type NewUserRole = AuthUser['role'];

function hasTransferableImpact(impact: DeleteImpact): boolean {
  return (
    impact.owned_groups.length > 0 ||
    impact.owned_accounts > 0 ||
    impact.owned_credentials > 0 ||
    impact.owned_endpoints > 0
  );
}

const ROLE_OPTIONS: { value: NewUserRole; labelKey: string }[] = [
  { value: 'user', labelKey: 'auth.users.roleUser' },
  { value: 'vip', labelKey: 'auth.users.roleVip' },
  { value: 'premium', labelKey: 'auth.users.rolePremium' },
  { value: 'elite', labelKey: 'auth.users.roleElite' },
  { value: 'admin', labelKey: 'auth.users.roleAdmin' },
];

export default function Users() {
  const currentUser = useAuthStore(state => state.user);
  const language = useAppStore(state => state.language);
  void language; // re-render on language change
  const navigate = useNavigate();

  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      u => u.username.toLowerCase().includes(q) || u.role.toLowerCase().includes(q)
    );
  }, [users, search]);

  // Create form state
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<NewUserRole>('user');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [roleUpdatingId, setRoleUpdatingId] = useState<string | number | null>(null);
  const [pluginsUser, setPluginsUser] = useState<AuthUser | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<{ user: AuthUser; impact: DeleteImpact } | null>(null);
  const [successorId, setSuccessorId] = useState('');
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await listUsers();
      setUsers(list);
    } catch (err) {
      const status = (err as Error & { status?: number })?.status;
      if (status === 401 || status === 403) {
        // Session dropped — the global 401 hook will redirect; just bail.
        setLoadError(t('auth.users.loadFailed'));
      } else {
        setLoadError(t('auth.users.loadFailed'));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Data-fetching effect: refresh is async; setState calls after the first
    // await run in a microtask. The sync setLoading(true)/setLoadError(null)
    // mirror the component's initial state on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (creating) return;
    setCreateError(null);

    if (!newUsername || !newPassword) {
      setCreateError('auth.users.errorValidation');
      return;
    }

    setCreating(true);
    try {
      await createUser(newUsername, newPassword, newRole);
      toast.success(t('auth.users.created'));
      setNewUsername('');
      setNewPassword('');
      setNewRole('user');
      await refresh();
    } catch (err) {
      const status = (err as Error & { status?: number })?.status;
      const message =
        status === 409
          ? 'auth.users.errorDuplicate'
          : status === 400
            ? 'auth.users.errorValidation'
            : 'auth.users.createFailed';
      setCreateError(message);
      toast.error(t(message));
    } finally {
      setCreating(false);
    }
  };

  const performDelete = async (user: AuthUser, transferTo?: string) => {
    setDeleting(true);
    try {
      await deleteUser(user.id, transferTo);
      toast.success(t('auth.users.deleted'));
      setDeleteImpact(null);
      await refresh();
    } catch (err) {
      const status = (err as Error & { status?: number })?.status;
      if (status === 409) {
        // Unsafe delete (race): surface the backend's detail.message verbatim.
        toast.error(errorMessage(err, t('auth.users.deleteFailed')));
      } else {
        const message =
          status === 400
            ? // Backend returns 400 for both self-delete and last-admin;
              // disambiguate by checking if it's the current user.
              user.id === currentUser?.id
              ? 'auth.users.errorSelfDelete'
              : 'auth.users.errorLastAdmin'
            : 'auth.users.deleteFailed';
        toast.error(t(message));
      }
    } finally {
      setDeleting(false);
    }
  };

  const onDelete = async (user: AuthUser) => {
    let impact: DeleteImpact;
    try {
      impact = await getDeleteImpact(user.id);
    } catch {
      toast.error(t('auth.users.impactLoadFailed'));
      return;
    }

    if (hasTransferableImpact(impact)) {
      setSuccessorId('');
      setDeleteImpact({ user, impact });
      return;
    }

    const confirmed = await askConfirm({
      title: t('auth.users.deleteTitle'),
      message: t('auth.users.deleteMessage', { username: user.username }),
      confirmText: t('auth.users.deleteConfirm'),
      variant: 'danger',
    });
    if (!confirmed) return;
    await performDelete(user);
  };

  const onRoleChange = async (user: AuthUser, nextRole: string) => {
    if (nextRole === user.role) return;
    setRoleUpdatingId(user.id);
    try {
      await updateUserRole(user.id, nextRole);
      toast.success(t('auth.users.updated'));
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('auth.users.updated'));
    } finally {
      setRoleUpdatingId(null);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title={t('auth.users.title')}
        subtitle={t('auth.users.subtitle')}
        icon={<UsersIcon size={18} />}
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          {/* Create user card */}
          <div className="rounded-xl border border-white/[0.06] bg-black/40 backdrop-blur-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
              <Plus className="w-4 h-4 text-indigo-400" />
              <h2 className="text-sm font-semibold text-white">{t('auth.users.addUser')}</h2>
            </div>
            <form onSubmit={onCreate} className="p-5 flex flex-col gap-4" noValidate>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_180px_auto] gap-3 items-end">
                <Input
                  label={t('auth.users.username')}
                  placeholder={t('auth.users.usernamePlaceholder')}
                  value={newUsername}
                  onChange={e => {
                    setNewUsername(e.target.value);
                    if (createError) setCreateError(null);
                  }}
                  autoComplete="off"
                  required
                />
                <Input
                  label={t('auth.users.password')}
                  type="password"
                  placeholder={t('auth.users.passwordPlaceholder')}
                  value={newPassword}
                  onChange={e => {
                    setNewPassword(e.target.value);
                    if (createError) setCreateError(null);
                  }}
                  autoComplete="new-password"
                  required
                />
                <Select
                  label={t('auth.users.role')}
                  value={newRole}
                  onValueChange={v => setNewRole(v as NewUserRole)}
                  options={ROLE_OPTIONS.map(opt => ({ value: opt.value, label: t(opt.labelKey) }))}
                />
                <Button
                  type="submit"
                  variant="primary"
                  isLoading={creating}
                  disabled={creating || !newUsername || !newPassword}
                  leftIcon={<Plus className="w-4 h-4" />}
                >
                  {creating ? t('auth.users.creating') : t('auth.users.create')}
                </Button>
              </div>
              {createError && (
                <div
                  role="alert"
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-xs"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span className="leading-relaxed">{t(createError)}</span>
                </div>
              )}
            </form>
          </div>

          {/* Users table */}
          <div className="rounded-xl border border-white/[0.06] bg-black/40 backdrop-blur-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-white">{t('auth.users.title')}</h2>
              <div className="flex items-center gap-3">
                {loading && <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />}
                <ToolbarSearchField
                  value={search}
                  onValueChange={setSearch}
                  placeholder={t('auth.users.searchPlaceholder')}
                  aria-label={t('auth.users.searchPlaceholder')}
                  containerClassName="w-64"
                />
              </div>
            </div>

            {loadError ? (
              <div className="p-6 text-center">
                <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                <p className="text-sm text-slate-400">{loadError}</p>
              </div>
            ) : users.length === 0 ? (
              <div className="p-10 text-center">
                <UsersIcon className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <p className="text-sm text-slate-500">{t('auth.users.empty')}</p>
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="p-10 text-center">
                <UsersIcon className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <p className="text-sm text-slate-500">{t('auth.users.noMatch')}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table className="w-full text-sm">
                  <TableHeader>
                    <TableRow className="border-b border-white/[0.06] text-left">
                      <TableHead className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider">
                        {t('auth.users.colUsername')}
                      </TableHead>
                      <TableHead className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider w-32">
                        {t('auth.users.colRole')}
                      </TableHead>
                      <TableHead className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider w-28">
                        {t('users.tier')}
                      </TableHead>
                      <TableHead className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider w-16 text-right">
                        {t('auth.users.colActions')}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map(u => {
                      const isCurrentUser = u.id === currentUser?.id;
                      return (
                        <TableRow
                          key={String(u.id)}
                          className="border-b border-white/[0.03] last:border-0 hover:bg-white/[0.02] transition-colors"
                        >
                          <TableCell className="px-5 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className={cn(
                                'w-7 h-7 rounded-full flex items-center justify-center shrink-0',
                                u.role === 'admin'
                                  ? 'bg-indigo-500/15 text-indigo-300'
                                  : 'bg-white/5 text-slate-400'
                              )}>
                                {u.role === 'admin'
                                  ? <ShieldCheck className="w-3.5 h-3.5" />
                                  : <UserIcon className="w-3.5 h-3.5" />}
                              </div>
                              <span className="text-slate-200 font-medium">{u.username}</span>
                              {isCurrentUser && (
                                // eslint-disable-next-line i18next/no-literal-string -- short parenthetical marker for the current user; no existing locale key
                                <span className="text-[10px] text-slate-500 uppercase tracking-wider">
                                  (you)
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="px-5 py-3">
                            <Select
                              value={u.role}
                              onValueChange={v => void onRoleChange(u, v)}
                              disabled={roleUpdatingId === u.id}
                              containerClassName="w-36"
                              shellClassName="h-7 w-full"
                              options={ROLE_OPTIONS.map(opt => ({ value: opt.value, label: t(opt.labelKey) }))}
                            />
                          </TableCell>
                          <TableCell className="px-5 py-3">
                            {u.tg_tier ? (
                              <Tooltip content={t('users.tierSourceBot')} side="top">
                                <span className="inline-flex">
                                  <TierBadge tier={u.tg_tier} size="sm" />
                                </span>
                              </Tooltip>
                            ) : (
                              <span className="text-slate-600 text-sm">—</span>
                            )}
                          </TableCell>
                          <TableCell className="px-5 py-3 text-right">
                            <div className="flex items-center justify-end">
                              <OverflowMenu
                                triggerLabel={t('auth.users.colActions')}
                                size="sm"
                                items={[
                                  {
                                    id: 'profile',
                                    label: t('admin.userProfile.title'),
                                    icon: <Eye className="w-3.5 h-3.5" />,
                                    onSelect: () => navigate(`/users/${String(u.id)}`),
                                  },
                                  {
                                    id: 'plugins',
                                    label: t('admin.plugins.pluginsAction'),
                                    icon: <Puzzle className="w-3.5 h-3.5" />,
                                    onSelect: () => setPluginsUser(u),
                                  },
                                  {
                                    id: 'delete',
                                    label: t('auth.users.delete'),
                                    icon: <Trash2 className="w-3.5 h-3.5" />,
                                    tone: 'danger',
                                    onSelect: () => void onDelete(u),
                                  },
                                ]}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Per-user plugin grants modal */}
      {pluginsUser && (
        <Modal
          isOpen
          onClose={() => setPluginsUser(null)}
          title={t('admin.plugins.perUser')}
          icon={<Puzzle size={18} />}
          size="lg"
        >
          <UserPluginGrants
            userId={Number(pluginsUser.id)}
            username={pluginsUser.username}
            role={pluginsUser.role}
          />
        </Modal>
      )}

      {/* Impact-aware delete: transfer ownership before deleting */}
      {deleteImpact && (
        <Modal
          isOpen
          onClose={() => {
            if (!deleting) setDeleteImpact(null);
          }}
          title={t('auth.users.deleteImpactTitle')}
          icon={<Trash2 size={18} />}
          size="sm"
          footer={
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setDeleteImpact(null)}
                disabled={deleting}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                onClick={() => void performDelete(deleteImpact.user, successorId)}
                disabled={!successorId || deleting}
                isLoading={deleting}
              >
                {t('auth.users.deleteImpactConfirm')}
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-slate-300 leading-relaxed">
              {t('auth.users.deleteImpactMessage', { username: deleteImpact.user.username })}
            </p>

            {deleteImpact.impact.owned_groups.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                  {t('auth.users.impactGroups')}
                </span>
                <ul className="flex flex-col gap-1">
                  {deleteImpact.impact.owned_groups.map(g => (
                    <li
                      key={String(g.id)}
                      className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]"
                    >
                      <span className="text-sm text-slate-200 truncate">{g.name}</span>
                      <span className="text-xs text-slate-400 shrink-0">
                        {t('auth.users.impactGroupMembers', { count: g.member_count })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(
              [
                ['impactAccounts', deleteImpact.impact.owned_accounts],
                ['impactCredentials', deleteImpact.impact.owned_credentials],
                ['impactEndpoints', deleteImpact.impact.owned_endpoints],
              ] as const
            )
              .filter(([, count]) => count > 0)
              .map(([key, count]) => (
                <div
                  key={key}
                  className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]"
                >
                  <span className="text-sm text-slate-300">{t(`auth.users.${key}`)}</span>
                  <span className="text-sm text-slate-200 font-medium">{count}</span>
                </div>
              ))}

            <Select
              label={t('auth.users.transferTo')}
              value={successorId}
              onValueChange={setSuccessorId}
              placeholder={t('auth.users.transferPlaceholder')}
              disabled={deleting}
              options={users
                .filter(u => u.id !== deleteImpact.user.id)
                .map(u => ({ value: String(u.id), label: u.username }))}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
