import React from 'react';
import { Play, RefreshCw, ExternalLink, AlertCircle } from 'lucide-react';

import { t } from '../../lib/i18n';
import { Button } from '@/components/ui';

interface QuickActionsPanelProps {
  onStartRegistration: () => void;
  onRefreshAllTokens: () => void;
  onOpenAiHub: () => void;
  isRefreshing: boolean;
  showProviderWarning: boolean;
}

export const QuickActionsPanel = React.memo(function QuickActionsPanel({
  onStartRegistration,
  onRefreshAllTokens,
  onOpenAiHub,
  isRefreshing,
  showProviderWarning,
}: QuickActionsPanelProps) {
  return (
    <section className="flex flex-wrap gap-3">
      <Button
        onClick={onStartRegistration}
        variant="purple"
        size="md"
        leftIcon={<Play size={16} />}
      >
        {t('dashboard.startRegistration')}
      </Button>
      <Button
        onClick={onRefreshAllTokens}
        disabled={isRefreshing}
        variant="secondary"
        size="md"
        leftIcon={<RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />}
      >
        {t('dashboard.refreshAllTokens')}
      </Button>
      <Button
        onClick={onOpenAiHub}
        variant="secondary"
        size="md"
        leftIcon={<ExternalLink size={16} />}
      >
        AI Hub
      </Button>
      {showProviderWarning && (
        <span className="flex items-center gap-1.5 text-xs text-amber-400 ml-2">
          <AlertCircle size={14} />
          {t('dashboard.selectProviderBelow')}
        </span>
      )}
    </section>
  );
});
