import type { AccountStatus } from '../types/ui';
import { t } from './i18n';

export type AccountStatusVariant = 'success' | 'error' | 'warning' | 'neutral' | 'default';

export function getAccountStatusLabel(status: AccountStatus): string {
  const statusMap: Record<AccountStatus, string> = {
    active: t('status.active'),
    banned: t('status.banned'),
    limit_hit: t('status.limitHit'),
    expired: t('status.expired'),
    unknown: t('status.unknown'),
  };
  return statusMap[status];
}

export function getAccountStatusVariant(status: AccountStatus): AccountStatusVariant {
  switch (status) {
    case 'active':
      return 'success';
    case 'banned':
      return 'error';
    case 'limit_hit':
      return 'warning';
    case 'expired':
      return 'neutral';
    case 'unknown':
    default:
      return 'default';
  }
}
