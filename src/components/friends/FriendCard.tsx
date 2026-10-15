import { ExternalLink } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ChannelLogo } from '@/components/friends/ChannelLogo';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { openUrlInBrowser } from '@/lib/backend/modules/aiProxy';
import type { FriendItem, FriendBadge } from '@/lib/backend';

const BADGE_CLASS: Record<NonNullable<FriendBadge>, string> = {
  official: 'bg-indigo-500/10 text-indigo-300',
  partner: 'bg-purple-500/10 text-purple-300',
  friend: 'bg-white/5 text-slate-300',
};

const BADGE_LABEL_KEY: Record<NonNullable<FriendBadge>, string> = {
  official: 'friends.badges.official',
  partner: 'friends.badges.partner',
  friend: 'friends.badges.friend',
};

interface FriendCardProps {
  item: FriendItem;
}

export function FriendCard({ item }: FriendCardProps) {
  const badgeClass = item.badge ? BADGE_CLASS[item.badge] : null;

  return (
    <GlassCard className="p-4 flex flex-col gap-3 h-full">
      <div className="flex items-start gap-3 min-w-0">
        <ChannelLogo
          src={item.logo_url}
          type={item.type}
          className="w-9 h-9 rounded-lg border border-white/10 text-slate-300"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-medium text-white truncate">{item.title}</h3>
            {item.badge && badgeClass && (
              <Badge variant="default" size="sm" className={cn(badgeClass, 'normal-case')}>
                {t(BADGE_LABEL_KEY[item.badge])}
              </Badge>
            )}
          </div>
          {item.description && (
            <p className="text-xs text-slate-500 mt-1 line-clamp-2">{item.description}</p>
          )}
        </div>
      </div>

      <div className="mt-auto">
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          rightIcon={<ExternalLink size={12} />}
          onClick={() => void openUrlInBrowser(item.url)}
        >
          {t('friends.open')}
        </Button>
      </div>
    </GlassCard>
  );
}
