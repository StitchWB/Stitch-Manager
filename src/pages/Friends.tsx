import { useEffect } from 'react';
import { HeartHandshake, Users } from 'lucide-react';
import Header from '../components/layout/Header';
import { FriendCard } from '../components/friends/FriendCard';
import { GlassCard } from '@/components/ui/GlassCard';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { t } from '@/lib/i18n';
import { useAppStore } from '../stores/app';
import { useCommunityStore } from '../stores/community';

export default function Friends() {
  const language = useAppStore(s => s.language);
  void language; // force re-render on locale change (t() is not reactive)

  const friends = useCommunityStore(s => s.friends);
  const friendsLoading = useCommunityStore(s => s.friendsLoading);
  const friendsError = useCommunityStore(s => s.friendsError);
  const fetchFriends = useCommunityStore(s => s.fetchFriends);

  useEffect(() => {
    void fetchFriends();
  }, [fetchFriends]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title={t('friends.title')}
        subtitle={t('friends.subtitle')}
        icon={<HeartHandshake size={18} />}
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[1400px] mx-auto">
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
              icon={Users}
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
  );
}
