import { Badge, type BadgeProps } from './Badge';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type TierValue = 'user' | 'vip' | 'premium' | 'elite' | 'admin' | string;

const tierVariant: Record<string, NonNullable<BadgeProps['variant']>> = {
  user: 'default',
  vip: 'info',
  premium: 'warning',
  elite: 'success',
  admin: 'info',
};

const tierOverride: Record<string, string> = {
  elite: 'bg-purple-500/10 text-purple-300 border border-transparent',
};

export interface TierBadgeProps {
  tier: TierValue | null | undefined;
  size?: BadgeProps['size'];
  className?: string;
  withDot?: boolean;
}

export function TierBadge({ tier, size = 'sm', className, withDot = false }: TierBadgeProps) {
  if (!tier) return null;
  const variant = tierVariant[tier] ?? 'default';
  const override = tierOverride[tier];
  return (
    <Badge
      variant={variant}
      size={size}
      withDot={withDot}
      className={cn('normal-case', override, className)}
    >
      {t(`auth.role.${tier}`)}
    </Badge>
  );
}

export default TierBadge;
