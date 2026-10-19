import { Badge } from './Badge';
import { t } from '../../lib/i18n';

interface OwnershipBadgeProps {
  mine?: boolean;
  shared?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Inline ownership badge for per-user list items.
 * Shows "mine" (indigo) or "shared" (slate) when the respective flag is set.
 * Renders nothing when both flags are absent (guests / legacy rows).
 */
export function OwnershipBadge({ mine, shared, size = 'sm', className }: OwnershipBadgeProps) {
  if (mine) {
    return (
      <Badge variant="indigo" size={size} className={className}>
        {t('ownership.mine')}
      </Badge>
    );
  }
  if (shared) {
    return (
      <Badge variant="slate" size={size} className={className}>
        {t('ownership.shared')}
      </Badge>
    );
  }
  return null;
}
