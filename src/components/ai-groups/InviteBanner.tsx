import { useState } from 'react';
import { AtSign } from 'lucide-react';
import { toast } from 'sonner';
import { GlassCard, Button } from '@/components/ui';
import { t } from '@/lib/i18n';
import { useGroupsStore } from '@/stores/groups';
import type { GroupInviteSummary } from '@/lib/backend/modules/groups';

interface InviteBannerProps {
  invites: GroupInviteSummary[];
  onResolved?: () => void;
}

/**
 * Amber strip rendered above the Groups master list. Shows one row per
 * pending invite addressed to the current user with Accept / Decline
 * buttons. Rows slide out on resolve (motion-reduce: transition-none).
 */
export function InviteBanner({ invites, onResolved }: InviteBannerProps) {
  const resolveInvite = useGroupsStore(s => s.resolveInvite);
  const [resolving, setResolving] = useState<Record<string, boolean>>({});

  if (invites.length === 0) return null;

  const handleResolve = async (inviteId: string, accept: boolean, groupName: string) => {
    setResolving(prev => ({ ...prev, [inviteId]: true }));
    try {
      await resolveInvite({ inviteId, accept });
      if (accept) {
        toast.success(t('ai.groups.invite.accepted', { group: groupName }));
      } else {
        toast.info(t('ai.groups.invite.declined'));
      }
      onResolved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('ai.groups.detailLoadFailed'));
    } finally {
      setResolving(prev => ({ ...prev, [inviteId]: false }));
    }
  };

  return (
    <GlassCard className="m-3 border-amber-500/20 p-3" >
      <div className="space-y-2">
        {invites.map(invite => (
          <div
            key={invite.id}
            role="region"
            aria-label={t('ai.groups.invite.banner.title', { group: invite.group_name })}
            className="flex items-center gap-3 motion-reduce:transition-none"
          >
            <AtSign size={16} className="text-amber-300 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-100 truncate">
                {t('ai.groups.invite.banner.title', { group: invite.group_name })}
              </p>
              <p className="text-[11px] text-slate-500 truncate">
                {t('ai.groups.invite.banner.from', { username: invite.invited_by_username })}
              </p>
            </div>
            <Button
              size="sm"
              variant="primary"
              isLoading={resolving[invite.id] === true}
              onClick={() => handleResolve(invite.id, true, invite.group_name)}
            >
              {t('ai.groups.invite.banner.accept')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={resolving[invite.id] === true}
              onClick={() => handleResolve(invite.id, false, invite.group_name)}
            >
              {t('ai.groups.invite.banner.decline')}
            </Button>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
