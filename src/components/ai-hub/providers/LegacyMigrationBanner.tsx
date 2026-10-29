import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui';
import { t } from '@/lib/i18n';

export interface LegacyMigrationBannerProps {
  visible: boolean;
  busy: boolean;
  onMigrate: () => void;
}

export function LegacyMigrationBanner(props: LegacyMigrationBannerProps): JSX.Element | null {
  const { visible, busy, onMigrate } = props;

  if (!visible) return null;

  return (
    <div className="border border-amber-500/20 bg-amber-500/[0.05] rounded-lg px-3 py-2 flex items-center gap-3">
      <AlertTriangle size={16} className="text-amber-300 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-amber-200 truncate">
          {t('aiHub.providersPage.legacyTitle')}
        </p>
        <p className="text-[11px] text-amber-200/70 truncate">
          {t('aiHub.providersPage.legacyDescription')}
        </p>
      </div>
      <Button variant="outline" size="xs" onClick={onMigrate} disabled={busy}>
        {busy ? t('aiHub.providersPage.legacyRunning') : t('aiHub.providersPage.legacyCta')}
      </Button>
    </div>
  );
}
