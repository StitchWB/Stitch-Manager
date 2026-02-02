import React from 'react';
import { Play, RefreshCw, ExternalLink, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '../ui/Button';
import { t } from '../../lib/i18n';

interface QuickActionsPanelProps {
  onStartRegistration: () => void;
  onRefreshAllTokens: () => void;
  onOpenLLMServer: () => void;
  isRefreshing: boolean;
  isStartingServer: boolean;
  serverIsRunning: boolean;
  showProviderWarning: boolean;
}

export const QuickActionsPanel = React.memo(function QuickActionsPanel({
  onStartRegistration,
  onRefreshAllTokens,
  onOpenLLMServer,
  isRefreshing,
  isStartingServer,
  serverIsRunning,
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
        onClick={onOpenLLMServer}
        disabled={isStartingServer}
        variant="secondary"
        size="md"
        leftIcon={isStartingServer ? <Loader2 size={16} className="animate-spin" /> : <ExternalLink size={16} />}
      >
        {serverIsRunning
          ? t('dashboard.openLlmServer')
          : t('dashboard.startLlmServer')}
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
