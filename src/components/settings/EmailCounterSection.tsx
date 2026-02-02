import { RefreshCw } from 'lucide-react';
import { SectionHeader } from '../ui/SectionHeader';
import { t } from '../../lib/i18n';
import { LoadingSpinner } from '../ui';

interface EmailCounterSectionProps {
  emailCounter: number;
  onEmailCounterChange: (counter: number) => void;
  isLoading: boolean;
}

export function EmailCounterSection({
  emailCounter,
  onEmailCounterChange,
  isLoading,
}: EmailCounterSectionProps) {
  return (
    <SectionHeader
      title={t('settings.emailCounter.title')}
      description={t('settings.emailCounter.description')}
      icon={<RefreshCw className="w-4 h-4 text-primary" />}
      className="pt-6 border-t border-white/10"
    >
      <div className="max-w-xs">
        <label className="input-label">{t('settings.emailCounter.counterValue')}</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="0"
            value={emailCounter}
            onChange={e => onEmailCounterChange(parseInt(e.target.value, 10) || 0)}
            disabled={isLoading}
            className="input-ds text-sm transition-all duration-200"
            placeholder="0"
          />
          {isLoading && <LoadingSpinner size="sm" color="muted" />}
        </div>
        <p className="text-xs text-slate-500 mt-1.5">
          {t('settings.emailCounter.nextRegistration')}: user+{emailCounter + 1}@domain.com
        </p>
      </div>
    </SectionHeader>
  );
}
