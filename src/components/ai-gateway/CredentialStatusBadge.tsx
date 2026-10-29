import { Badge } from '@/components/ui';
import { t } from '@/lib/i18n';

export function CredentialStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'active':
      return <Badge variant="success">{t('aiGateway.status.active')}</Badge>;
    case 'cooldown':
      return <Badge variant="warning">{t('aiGateway.status.cooldown')}</Badge>;
    case 'rate_limited':
      return <Badge variant="warning">{t('aiGateway.status.rateLimited')}</Badge>;
    case 'quota_exhausted':
      return <Badge variant="danger">{t('aiGateway.status.quotaExhausted')}</Badge>;
    case 'auth_failed':
      return <Badge variant="danger">{t('aiGateway.status.authFailed')}</Badge>;
    case 'degraded':
      return <Badge variant="warning">{t('aiGateway.status.degraded')}</Badge>;
    case 'disabled':
      return <Badge variant="default">{t('aiGateway.status.disabled')}</Badge>;
    default:
      return <Badge variant="outline">{t('aiGateway.status.unknown')}</Badge>;
  }
}
