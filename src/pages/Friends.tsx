import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  HeartHandshake,
  Users as UsersIcon,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  AlertCircle,
  Crown,
  Send,
  MessageCircle,
  Github,
  Globe,
} from 'lucide-react';
import { toast } from 'sonner';
import Header from '../components/layout/Header';
import { FriendCard } from '../components/friends/FriendCard';
import { GlassCard } from '@/components/ui/GlassCard';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';
import { Toggle } from '@/components/ui/Toggle';
import { Checkbox } from '@/components/ui/Checkbox';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { TierBadge } from '@/components/ui/TierBadge';
import { Tooltip } from '@/components/ui/Tooltip';
import { askConfirm } from '@/components/ui/ConfirmDialogHost';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useAppStore } from '../stores/app';
import { useCommunityStore } from '../stores/community';
import { useAuthStore, effectiveRole } from '../stores/auth';
import {
  listPartnerChannels,
  createPartnerChannel,
  updatePartnerChannel,
  deletePartnerChannel,
  getMyPartnerChannel,
  type PartnerChannel,
  type PartnerChannelForm,
  type PartnerChannelType,
  type PartnerBadge,
  type PartnerGrantRole,
  type MyPartnerInfo,
} from '../lib/backend/modules/partners';

const TYPE_ICON: Record<PartnerChannelType, typeof Send> = {
  telegram: Send,
  discord: MessageCircle,
  github: Github,
  other: Globe,
};

const BADGE_CLASS: Record<PartnerBadge, string> = {
  official: 'bg-indigo-500/10 text-indigo-300',
  partner: 'bg-purple-500/10 text-purple-300',
  friend: 'bg-white/5 text-slate-300',
};

const TYPE_OPTIONS: { value: PartnerChannelType; label: string }[] = [
  { value: 'telegram', label: 'Telegram' },
  { value: 'discord', label: 'Discord' },
  { value: 'github', label: 'GitHub' },
  { value: 'other', label: 'Other' },
];

const BADGE_OPTIONS: { value: PartnerBadge; label: string }[] = [
  { value: 'friend', label: 'friend' },
  { value: 'partner', label: 'partner' },
  { value: 'official', label: 'official' },
];

// Server hard cap: only these roles are ever offered/accepted for grants.
const GRANT_ROLE_OPTIONS: PartnerGrantRole[] = ['user', 'vip', 'premium'];

function BadgeChip({ badge }: { badge: PartnerBadge }) {
  return (
    <Badge variant="default" size="sm" className={cn(BADGE_CLASS[badge], 'normal-case')}>
      {badge}
    </Badge>
  );
}

// ============================================
// Create/Edit modal form
// ============================================

interface FormModalProps {
  channel: PartnerChannel | null; // null = create mode
  onClose: () => void;
  onSaved: () => Promise<void>;
}

function PartnerChannelFormModal({ channel, onClose, onSaved }: FormModalProps) {
  const [title, setTitle] = useState(channel?.title ?? '');
  const [url, setUrl] = useState(channel?.url ?? '');
  const [description, setDescription] = useState(channel?.description ?? '');
  const [type, setType] = useState<PartnerChannelType>(channel?.type ?? 'telegram');
  const [badge, setBadge] = useState<PartnerBadge>(channel?.badge ?? 'friend');
  const [tgChatId, setTgChatId] = useState(
    channel?.tg_chat_id != null ? String(channel.tg_chat_id) : '',
  );
  const [owner, setOwner] = useState(channel?.owner_telegram_id ?? '');
  const [roles, setRoles] = useState<PartnerGrantRole[]>(
    channel && channel.allowed_grant_roles.length > 0 ? channel.allowed_grant_roles : ['user'],
  );
  const [maxMembers, setMaxMembers] = useState(
    channel?.max_members != null ? String(channel.max_members) : '',
  );
  const [active, setActive] = useState(channel?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const toggleRole = (role: PartnerGrantRole, checked: boolean) => {
    setRoles(prev => (checked ? [...prev, role] : prev.filter(r => r !== role)));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setFormError(null);

    if (!title.trim() || !url.trim()) {
      setFormError('friends.admin.errorValidation');
      return;
    }
    if (roles.length === 0) {
      setFormError('friends.admin.errorRoles');
      return;
    }

    let parsedTgChatId: number | null = null;
    if (tgChatId.trim()) {
      const n = Number(tgChatId.trim());
      if (!Number.isInteger(n)) {
        setFormError('friends.admin.errorTgChatId');
        return;
      }
      parsedTgChatId = n;
    }

    const ownerTrim = owner.trim().replace(/^@/, '');
    if (ownerTrim && !/^\d+$/.test(ownerTrim)) {
      setFormError('friends.admin.errorOwnerNumeric');
      return;
    }

    let parsedMaxMembers: number | null = null;
    if (maxMembers.trim()) {
      const n = Number(maxMembers.trim());
      if (!Number.isInteger(n) || n <= 0) {
        setFormError('friends.admin.errorMaxMembers');
        return;
      }
      parsedMaxMembers = n;
    }

    const form: PartnerChannelForm = {
      title: title.trim(),
      url: url.trim(),
      description: description.trim() || null,
      type,
      badge,
      tg_chat_id: parsedTgChatId,
      owner_telegram_id: ownerTrim || null,
      allowed_grant_roles: roles,
      max_members: parsedMaxMembers,
      active,
    };

    setSaving(true);
    try {
      if (channel) {
        await updatePartnerChannel(channel.id, form);
        toast.success(t('friends.admin.updated'));
      } else {
        await createPartnerChannel(form);
        toast.success(t('friends.admin.created'));
      }
      onClose();
      await onSaved();
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : t('friends.admin.saveFailed');
      setFormError(null);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={channel ? t('friends.admin.editTitle') : t('friends.admin.createTitle')}
      icon={<HeartHandshake size={18} />}
      size="md"
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input
            label={t('friends.admin.fieldTitle')}
            value={title}
            onChange={e => setTitle(e.target.value)}
            autoComplete="off"
            required
          />
          <Input
            label={t('friends.admin.fieldUrl')}
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://t.me/..."
            autoComplete="off"
            required
          />
        </div>

        <Textarea
          label={t('friends.admin.fieldDescription')}
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={2}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Select
            label={t('friends.admin.fieldType')}
            value={type}
            onValueChange={v => setType(v as PartnerChannelType)}
            options={TYPE_OPTIONS}
          />
          <Select
            label={t('friends.admin.fieldBadge')}
            value={badge}
            onValueChange={v => setBadge(v as PartnerBadge)}
            options={BADGE_OPTIONS}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input
            label={t('friends.admin.fieldTgChatId')}
            hint={t('friends.admin.fieldTgChatIdHint')}
            value={tgChatId}
            onChange={e => setTgChatId(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
          />
          <Input
            label={t('friends.admin.fieldMaxMembers')}
            hint={t('friends.admin.fieldMaxMembersHint')}
            value={maxMembers}
            onChange={e => setMaxMembers(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
          />
        </div>

        <Input
          label={t('friends.admin.fieldOwner')}
          hint={t('friends.admin.fieldOwnerHint')}
          value={owner}
          onChange={e => setOwner(e.target.value)}
          placeholder="@username or 123456789"
          autoComplete="off"
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-slate-400">
            {t('friends.admin.fieldRoles')}
          </span>
          <div className="flex items-center gap-2">
            {GRANT_ROLE_OPTIONS.map(role => (
              <Checkbox
                key={role}
                label={<TierBadge tier={role} />}
                checked={roles.includes(role)}
                onChange={e => toggleRole(role, e.target.checked)}
              />
            ))}
          </div>
          <span className="text-[10px] text-slate-500 leading-tight">
            {t('friends.admin.fieldRolesHint')}
          </span>
        </div>

        <Toggle
          label={t('friends.admin.fieldActive')}
          checked={active}
          onChange={setActive}
        />

        {formError && (
          <div
            role="alert"
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-xs"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="leading-relaxed">{t(formError)}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.06]">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            {t('friends.admin.cancel')}
          </Button>
          <Button type="submit" variant="primary" isLoading={saving} disabled={saving}>
            {saving ? t('friends.admin.saving') : t('friends.admin.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ============================================
// Admin management section
// ============================================

interface AdminSectionProps {
  channels: PartnerChannel[];
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
  onEdit: (channel: PartnerChannel) => void;
  onCreate: () => void;
  onDelete: (channel: PartnerChannel) => void;
}

function PartnerAdminSection({
  channels,
  loading,
  error,
  onRefresh,
  onEdit,
  onCreate,
  onDelete,
}: AdminSectionProps) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-black/40 backdrop-blur-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Crown className="w-4 h-4 text-indigo-400 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white truncate">
              {t('friends.admin.title')}
            </h2>
            <p className="text-[11px] text-slate-500 truncate">{t('friends.admin.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {loading && <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />}
          <Button
            variant="primary"
            size="sm"
            onClick={onCreate}
            leftIcon={<Plus className="w-3.5 h-3.5" />}
          >
            {t('friends.admin.add')}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="p-6 flex flex-col items-center gap-3 text-center">
          <AlertCircle className="w-6 h-6 text-red-400" />
          <p className="text-sm text-slate-400 max-w-md">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => void onRefresh()}>
            {t('radar.retry')}
          </Button>
        </div>
      ) : channels.length === 0 && !loading ? (
        <div className="p-10 text-center">
          <HeartHandshake className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-500">{t('friends.admin.empty')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="w-full text-sm">
            <TableHeader>
              <TableRow className="border-b border-white/[0.06] text-left">
                <TableHead className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider">
                  {t('friends.admin.colTitle')}
                </TableHead>
                <TableHead className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider w-24">
                  {t('friends.admin.colType')}
                </TableHead>
                <TableHead className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider w-28">
                  {t('friends.admin.colBadge')}
                </TableHead>
                <TableHead className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider w-24">
                  {t('friends.admin.colMembers')}
                </TableHead>
                <TableHead className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider w-40">
                  {t('friends.admin.colRoles')}
                </TableHead>
                <TableHead className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider w-24">
                  {t('friends.admin.colQuota')}
                </TableHead>
                <TableHead className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider w-32">
                  {t('friends.admin.colOwner')}
                </TableHead>
                <TableHead className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider w-24">
                  {t('friends.admin.colStatus')}
                </TableHead>
                <TableHead className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider w-28 text-right">
                  {t('friends.admin.colActions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {channels.map(ch => {
                const Icon = TYPE_ICON[ch.type] ?? Globe;
                return (
                  <TableRow
                    key={ch.id}
                    className="border-b border-white/[0.03] last:border-0 hover:bg-white/[0.02] transition-colors"
                  >
                    <TableCell className="px-5 py-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-full bg-white/5 text-slate-400 flex items-center justify-center shrink-0">
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-slate-200 font-medium truncate">{ch.title}</div>
                          {ch.tg_chat_id != null && (
                            <div className="text-[10px] text-slate-500 font-mono">
                              {ch.tg_chat_id}
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="px-5 py-3 text-slate-400 text-xs">{ch.type}</TableCell>
                    <TableCell className="px-5 py-3">
                      <BadgeChip badge={ch.badge} />
                    </TableCell>
                    <TableCell className="px-5 py-3 text-slate-300">
                      {ch.member_count ?? <span className="text-slate-600">—</span>}
                    </TableCell>
                    <TableCell className="px-5 py-3">
                      <div className="flex items-center gap-1 flex-wrap">
                        {ch.allowed_grant_roles.map(role => (
                          <TierBadge key={role} tier={role} size="sm" />
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="px-5 py-3 text-slate-300">
                      {ch.max_members ?? (
                        <span className="text-slate-500 text-xs">{t('friends.admin.unlimited')}</span>
                      )}
                    </TableCell>
                    <TableCell className="px-5 py-3">
                      {ch.owner_telegram_id ? (
                        <span className="text-slate-300 text-xs font-mono truncate">
                          {ch.owner_telegram_id}
                        </span>
                      ) : (
                        <span className="text-slate-600 text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="px-5 py-3">
                      <Badge
                        variant={ch.active ? 'success' : 'default'}
                        size="sm"
                        withDot
                        className="normal-case"
                      >
                        {ch.active ? t('friends.admin.statusActive') : t('friends.admin.statusInactive')}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip content={t('friends.admin.edit')} side="top">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onEdit(ch)}
                            leftIcon={<Pencil className="w-3.5 h-3.5" />}
                            className="text-slate-500 hover:text-indigo-400"
                            aria-label={t('friends.admin.edit')}
                          />
                        </Tooltip>
                        <Tooltip content={t('friends.admin.delete')} side="top">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onDelete(ch)}
                            leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                            className="text-slate-500 hover:text-red-400"
                            aria-label={t('friends.admin.delete')}
                          />
                        </Tooltip>
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
  );
}

// ============================================
// Owner "My channel" panel
// ============================================

function MyChannelPanel({ info }: { info: MyPartnerInfo }) {
  const ch = info.channel;
  if (!ch) return null;
  const quota =
    ch.max_members != null ? String(ch.max_members) : t('friends.myChannel.unlimited');

  return (
    <GlassCard className="p-5 flex flex-col gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0">
          <Crown size={16} className="text-indigo-300" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-white truncate">
              {t('friends.myChannel.title')}
            </h2>
            <BadgeChip badge={ch.badge} />
            {!ch.active && (
              <Badge variant="danger" size="sm" className="normal-case">
                {t('friends.myChannel.inactive')}
              </Badge>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-0.5 truncate">{ch.title}</p>
        </div>
      </div>

      <div className="flex items-center gap-4 flex-wrap text-xs">
        <span className="text-slate-300">
          {t('friends.myChannel.members', { count: info.member_count, quota })}
        </span>
        <span className="flex items-center gap-1.5 text-slate-400">
          {t('friends.myChannel.allowedRoles')}:
          {ch.allowed_grant_roles.map(role => (
            <TierBadge key={role} tier={role} size="sm" />
          ))}
        </span>
      </div>

      <p className="text-[10px] text-slate-500 font-mono">{t('friends.myChannel.hint')}</p>
    </GlassCard>
  );
}

// ============================================
// Page
// ============================================

type FormTarget = { mode: 'create' } | { mode: 'edit'; channel: PartnerChannel };

export default function Friends() {
  const language = useAppStore(s => s.language);
  void language; // force re-render on locale change (t() is not reactive)

  const friends = useCommunityStore(s => s.friends);
  const friendsLoading = useCommunityStore(s => s.friendsLoading);
  const friendsError = useCommunityStore(s => s.friendsError);
  const fetchFriends = useCommunityStore(s => s.fetchFriends);

  const authUser = useAuthStore(s => s.user);
  const isAdmin = effectiveRole(authUser) === 'admin';

  // Admin: partner channel management
  const [channels, setChannels] = useState<PartnerChannel[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [formTarget, setFormTarget] = useState<FormTarget | null>(null);

  // Owner: "my channel" panel
  const [myInfo, setMyInfo] = useState<MyPartnerInfo | null>(null);

  useEffect(() => {
    void fetchFriends();
  }, [fetchFriends]);

  const refreshChannels = useCallback(async () => {
    setAdminLoading(true);
    setAdminError(null);
    try {
      setChannels(await listPartnerChannels());
    } catch (err) {
      // Non-blocking: the catalog below keeps working off get_friends.
      setAdminError(
        err instanceof Error && err.message ? err.message : t('friends.admin.loadFailed'),
      );
    } finally {
      setAdminLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshChannels();
  }, [isAdmin, refreshChannels]);

  useEffect(() => {
    if (!authUser) return;
    let cancelled = false;
    void getMyPartnerChannel().then(info => {
      if (!cancelled) setMyInfo(info);
    });
    return () => {
      cancelled = true;
    };
  }, [authUser]);

  const onDelete = async (channel: PartnerChannel) => {
    const confirmed = await askConfirm({
      title: t('friends.admin.deleteTitle'),
      message: t('friends.admin.deleteMessage', { title: channel.title }),
      confirmText: t('friends.admin.deleteConfirm'),
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      await deletePartnerChannel(channel.id);
      toast.success(t('friends.admin.deleted'));
      await refreshChannels();
    } catch (err) {
      toast.error(
        err instanceof Error && err.message ? err.message : t('friends.admin.deleteFailed'),
      );
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title={t('friends.title')}
        subtitle={t('friends.subtitle')}
        icon={<HeartHandshake size={18} />}
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[1400px] mx-auto flex flex-col gap-6">
          {isAdmin && (
            <PartnerAdminSection
              channels={channels}
              loading={adminLoading}
              error={adminError}
              onRefresh={refreshChannels}
              onCreate={() => setFormTarget({ mode: 'create' })}
              onEdit={channel => setFormTarget({ mode: 'edit', channel })}
              onDelete={channel => void onDelete(channel)}
            />
          )}

          {myInfo?.channel && <MyChannelPanel info={myInfo} />}

          <div>
            {friendsLoading && (
              <div className="flex items-center justify-center py-20">
                <LoadingSpinner size="lg" />
              </div>
            )}

            {!friendsLoading && friendsError !== null && (
              <GlassCard className="p-6 flex flex-col items-center gap-3">
                <p className="text-sm text-slate-300">{t('friends.loadError')}</p>
                <p className="text-xs text-slate-500 max-w-md text-center">{friendsError}</p>
                <Button variant="secondary" size="sm" onClick={() => void fetchFriends()}>
                  {t('radar.retry')}
                </Button>
              </GlassCard>
            )}

            {!friendsLoading && friendsError === null && friends.length === 0 && (
              <EmptyState
                icon={UsersIcon}
                title={t('friends.emptyTitle')}
                description={t('friends.emptyDescription')}
              />
            )}

            {friends.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {friends.map(item => (
                  <FriendCard key={item.id} item={item} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {formTarget && (
        <PartnerChannelFormModal
          channel={formTarget.mode === 'edit' ? formTarget.channel : null}
          onClose={() => setFormTarget(null)}
          onSaved={refreshChannels}
        />
      )}
    </div>
  );
}
