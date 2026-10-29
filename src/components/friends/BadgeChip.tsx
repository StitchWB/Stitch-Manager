import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import type { PartnerBadge } from '@/lib/backend/modules/partners';

const BADGE_CLASS: Record<PartnerBadge, string> = {
  official: 'bg-indigo-500/10 text-indigo-300',
  partner: 'bg-purple-500/10 text-purple-300',
  friend: 'bg-white/5 text-slate-300',
};

export function BadgeChip({ badge }: { badge: PartnerBadge }) {
  return (
    <Badge variant="default" size="sm" className={cn(BADGE_CLASS[badge], 'normal-case')}>
      {badge}
    </Badge>
  );
}
