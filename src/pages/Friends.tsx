import { useEffect, useState } from 'react';
import { HeartHandshake, Users as UsersIcon, Crown } from 'lucide-react';
import Header from '../components/layout/Header';
import { FriendCard } from '../components/friends/FriendCard';
import { BadgeChip } from '../components/friends/BadgeChip';
import { GlassCard } from '@/components/ui/GlassCard';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { TierBadge } from '@/components/ui/TierBadge';
import { t } from '@/lib/i18n';
import { useAppStore } from '../stores/app';
import { useFriendsStore } from '../stores/friends';
import { useAuthStore } from '../stores/auth';
import { getMyPartnerChannel, type MyPartnerInfo } from '../lib/backend/modules/partners';

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

export default function Friends() {
  const language = useAppStore(s => s.language);
  void language; // force re-render on locale change (t() is not reactive)

  const friends = useFriendsStore(s => s.friends);
  const friendsLoading = useFriendsStore(s => s.friendsLoading);
  const friendsError = useFriendsStore(s => s.friendsError);
  const fetchFriends = useFriendsStore(s => s.fetchFriends);

  const authUser = useAuthStore(s => s.user);

  const [myInfo, setMyInfo] = useState<MyPartnerInfo | null>(null);

  useEffect(() => {
    void fetchFriends();
  }, [fetchFriends]);

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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title={t('friends.title')}
        subtitle={t('friends.subtitle')}
        icon={<HeartHandshake size={18} />}
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[1400px] mx-auto flex flex-col gap-6">
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
    </div>
  );
}
