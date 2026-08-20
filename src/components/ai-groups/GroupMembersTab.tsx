import { useEffect, useState } from 'react';
import { AtSign, X, Crown } from 'lucide-react';
import { toast } from 'sonner';
import {
  GlassCard,
  Badge,
  Button,
  ButtonBase,
  Input,
  IconButton,
  OverflowMenu,
  SkeletonLoader,
  Tooltip,
} from '@/components/ui';
import { TierBadge } from '@/components/ui/TierBadge';
import { askConfirm } from '@/components/ui/ConfirmDialogHost';
import { t, getLocale } from '@/lib/i18n';
import { useGroupsStore } from '@/stores/groups';
import { listUsers, type AuthUser } from '@/lib/backend/modules/auth';
import type { GroupMember, GroupInviteDetail } from '@/lib/backend/modules/groups';
import { groupsTransferOwnership } from '@/lib/backend/modules/groups';

interface GroupMembersTabProps {
  groupId: string;
  isOwner: boolean;
  currentUserId: string | null;
  /** Called after the current user leaves the group (mirrors GroupSettingsTab). */
  onLeft?: () => void;
}

function avatarLetter(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

/** Format an ISO date string using the current locale's date format. */
function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(getLocale(), {
    dateStyle: 'medium',
  }).format(d);
}

function roleBadge(role: GroupMember['role']) {
  if (role === 'owner') {
    return (
      <Badge variant="indigo" size="sm">
        {t('ai.groups.role.owner')}
      </Badge>
    );
  }
  return (
    <Badge variant="slate" size="sm">
      {t('ai.groups.role.member')}
    </Badge>
  );
}

/**
 * Members tab. Owner sees an invite Input with @username autocomplete
 * (portal dropdown, combobox a11y), a pending-invites section (warning
 * Badge withPulse + revoke IconButton), and the members list with
 * remove OverflowMenu on non-self rows. Members see a Leave button on
 * their own row (disabled + Tooltip when sole owner).
 */
export function GroupMembersTab({ groupId, isOwner, currentUserId, onLeft }: GroupMembersTabProps) {
  const detail = useGroupsStore(s => s.detail);
  const loading = useGroupsStore(s => s.loading);
  const inviteMember = useGroupsStore(s => s.inviteMember);
  const revokeInvite = useGroupsStore(s => s.revokeInvite);
  const removeMember = useGroupsStore(s => s.removeMember);
  const leaveGroup = useGroupsStore(s => s.leaveGroup);
  const fetchDetail = useGroupsStore(s => s.fetchDetail);
  const [inviteInput, setInviteInput] = useState('');
  const [userResults, setUserResults] = useState<AuthUser[]>([]);
  const [autocompleteOpen, setAutocompleteOpen] = useState(false);
  const [activeOption, setActiveOption] = useState<number>(-1);
  const [sending, setSending] = useState(false);

  const members = detail?.members ?? [];
  const invites = detail?.invites ?? [];

  const soleOwner = isOwner && members.length === 1;

  // Debounced autocomplete: query listUsers() filtered by prefix.
  useEffect(() => {
    const q = inviteInput.replace(/^@/, '').trim();
    let cancelled = false;
    const handle = setTimeout(async () => {
      if (cancelled) return;
      if (q.length < 1) {
        setUserResults([]);
        setAutocompleteOpen(false);
        return;
      }
      try {
        const users = await listUsers();
        if (cancelled) return;
        const filtered = users
          .filter(u => u.username.toLowerCase().includes(q.toLowerCase()))
          .slice(0, 8);
        setUserResults(filtered);
        setAutocompleteOpen(filtered.length > 0);
        setActiveOption(filtered.length > 0 ? 0 : -1);
      } catch {
        // listUsers is admin-only; non-admins silently get no autocomplete.
        if (!cancelled) {
          setUserResults([]);
          setAutocompleteOpen(false);
        }
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [inviteInput]);

  const sendInvite = async (username: string) => {
    const trimmed = username.replace(/^@/, '').trim();
    if (!trimmed) return;
    setSending(true);
    try {
      await inviteMember({ groupId, username: trimmed });
      toast.success(t('ai.groups.invite.sent', { username: trimmed }));
      setInviteInput('');
      setAutocompleteOpen(false);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err?.status === 409) {
        toast.error(t('ai.groups.invite.duplicate'));
      } else {
        toast.error(e instanceof Error ? e.message : t('ai.groups.detailLoadFailed'));
      }
    } finally {
      setSending(false);
    }
  };

  const handleRevoke = async (inviteId: string) => {
    try {
      await revokeInvite(inviteId);
      toast.success(t('ai.groups.invite.revoked'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('ai.groups.detailLoadFailed'));
    }
  };

  const handleRemove = async (member: GroupMember) => {
    const ok = await askConfirm({
      title: t('ai.groups.members.removeConfirm.title'),
      message: t('ai.groups.members.removeConfirm.body', {
        username: member.username,
        group: detail?.group.name ?? '',
      }),
      confirmText: t('ai.groups.members.removeConfirm.confirm'),
      cancelText: t('common.cancel'),
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await removeMember({ groupId, userId: member.user_id });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('ai.groups.detailLoadFailed'));
    }
  };

  const handleTransfer = async (member: GroupMember) => {
    const ok = await askConfirm({
      title: t('ai.groups.members.transfer.confirmTitle'),
      message: t('ai.groups.members.transfer.confirmBody', {
        username: member.username,
        group: detail?.group.name ?? '',
      }),
      confirmText: t('ai.groups.members.transfer.action'),
      cancelText: t('common.cancel'),
      variant: 'warning',
    });
    if (!ok) return;
    try {
      await groupsTransferOwnership({ groupId, userId: member.user_id });
      // Refresh detail so members list + group owner update.
      await fetchDetail(groupId);
      toast.success(
        t('ai.groups.members.transfer.success', { username: member.username }),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('ai.groups.detailLoadFailed'));
    }
  };

  const handleLeave = async () => {
    if (soleOwner) return;
    const ok = await askConfirm({
      title: t('ai.groups.members.leaveConfirm.title'),
      message: t('ai.groups.members.leaveConfirm.body', { group: detail?.group.name ?? '' }),
      confirmText: t('ai.groups.members.leaveConfirm.confirm'),
      cancelText: t('common.cancel'),
      variant: 'warning',
    });
    if (!ok) return;
    try {
      await leaveGroup(groupId);
      onLeft?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('ai.groups.detailLoadFailed'));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!autocompleteOpen) {
      if (e.key === 'Enter' && inviteInput.trim()) {
        void sendInvite(inviteInput);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveOption(i => Math.min(i + 1, userResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveOption(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = activeOption >= 0 ? userResults[activeOption] : null;
      if (selected) {
        void sendInvite(selected.username);
      } else if (inviteInput.trim()) {
        void sendInvite(inviteInput);
      }
    } else if (e.key === 'Escape') {
      setAutocompleteOpen(false);
      setActiveOption(-1);
    }
  };

  const listboxId = 'invite-user-listbox';

  const pendingSection = invites.length > 0 ? (
    <div className="border-t border-white/[0.06] pt-3 mt-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
        {t('ai.groups.invite.pending')}
      </div>
      <div className="space-y-1.5">
        {invites.map((inv: GroupInviteDetail) => (
          <div key={inv.id} className="flex items-center gap-2">
            <Badge variant="warning" size="sm" withDot withPulse>
              <span className="motion-reduce:animate-none">{t('ai.groups.invite.pending')}</span>
            </Badge>
            <span className="text-sm text-slate-200 truncate">@{inv.invitee_username}</span>
            <Tooltip content={t('ai.groups.invite.revoke')}>
              <IconButton
                size="sm"
                variant="ghost"
                onClick={() => handleRevoke(inv.id)}
                aria-label={t('ai.groups.invite.revoke')}
              >
                <X size={14} />
              </IconButton>
            </Tooltip>
          </div>
        ))}
      </div>
    </div>
  ) : null;

  return (
    <GlassCard className="p-3 md:p-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-semibold text-slate-100 truncate">
            {t('ai.groups.members.title')}
          </h3>
          <Badge variant="slate" size="sm">
            {members.length}
          </Badge>
        </div>
      </div>

      {/* Owner invite row */}
      {isOwner && (
        <div className="mb-3">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0 relative">
              <Input
                type="text"
                value={inviteInput}
                onChange={e => setInviteInput(e.target.value)}
                onKeyDown={onKeyDown}
                onBlur={() => setTimeout(() => setAutocompleteOpen(false), 150)}
                onFocus={() => {
                  if (userResults.length > 0) setAutocompleteOpen(true);
                }}
                placeholder={t('ai.groups.invite.placeholder')}
                leftIcon={<AtSign className="w-4 h-4" />}
                containerClassName="w-full"
                aria-label={t('ai.groups.invite.placeholder')}
                role="combobox"
                aria-expanded={autocompleteOpen}
                aria-controls={listboxId}
                aria-activedescendant={
                  autocompleteOpen && activeOption >= 0
                    ? `invite-option-${activeOption}`
                    : undefined
                }
                aria-autocomplete="list"
              />
              {autocompleteOpen && (
                <div
                  id={listboxId}
                  role="listbox"
                  className="absolute top-full left-0 right-0 z-50 bg-vsc-panel/95 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl overflow-hidden animate-fade-in mt-1 max-h-60 overflow-y-auto"
                >
                  {userResults.map((u, idx) => (
                    <ButtonBase
                      key={u.id}
                      id={`invite-option-${idx}`}
                      type="button"
                      role="option"
                      aria-selected={idx === activeOption}
                      onMouseDown={e => {
                        e.preventDefault();
                        void sendInvite(u.username);
                      }}
                      className={[
                        'w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                        idx === activeOption ? 'bg-white/5 text-white' : 'text-slate-300 hover:bg-white/5',
                      ].join(' ')}
                    >
                      <span className="w-6 h-6 rounded-full bg-indigo-500/15 text-indigo-300 flex items-center justify-center text-[10px] font-semibold shrink-0">
                        {avatarLetter(u.username)}
                      </span>
                      <span className="flex-1 min-w-0 truncate">@{u.username}</span>
                      <TierBadge tier={u.role} size="sm" />
                    </ButtonBase>
                  ))}
                </div>
              )}
            </div>
            <Button
              size="sm"
              variant="primary"
              onClick={() => sendInvite(inviteInput)}
              isLoading={sending}
              disabled={!inviteInput.trim()}
            >
              {t('ai.groups.invite.send')}
            </Button>
          </div>
        </div>
      )}

      {/* Pending invites */}
      {pendingSection}

      {/* Members list */}
      {loading.detail ? (
        <div className="space-y-2">
          <SkeletonLoader variant="rectangle" height="h-12" count={3} />
        </div>
      ) : (
        <div className="divide-y divide-white/[0.06]">
          {members.map(member => {
            const isSelf = currentUserId != null && String(member.user_id) === currentUserId;
            return (
              <div key={member.user_id} className="flex items-center gap-3 px-1 py-2">
                <span className="w-7 h-7 rounded-full bg-indigo-500/15 text-indigo-300 flex items-center justify-center text-xs font-semibold shrink-0">
                  {avatarLetter(member.username)}
                </span>
                <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                  <span className="text-sm text-slate-100 truncate">@{member.username}</span>
                  <span className="text-[11px] text-slate-500 truncate">
                    {formatDate(member.joined_at)}
                  </span>
                </div>
                {roleBadge(member.role)}
                {isSelf ? (
                  soleOwner ? (
                    <Tooltip content={t('ai.groups.members.leaveConfirm.soleOwner')}>
                      <Button size="sm" variant="ghost" disabled>
                        {t('ai.groups.actions.leave')}
                      </Button>
                    </Tooltip>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={handleLeave}>
                      {t('ai.groups.actions.leave')}
                    </Button>
                  )
                ) : isOwner ? (
                  <OverflowMenu
                    triggerLabel={t('common.more')}
                    size="sm"
                    items={[
                      {
                        id: 'transfer',
                        label: t('ai.groups.members.transfer.action'),
                        icon: <Crown size={14} />,
                        onSelect: () => handleTransfer(member),
                      },
                      {
                        id: 'remove',
                        label: t('ai.groups.members.remove'),
                        onSelect: () => handleRemove(member),
                        tone: 'danger',
                      },
                    ]}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </GlassCard>
  );
}
