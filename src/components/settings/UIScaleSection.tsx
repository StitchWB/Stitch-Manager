import { RefreshCw } from 'lucide-react';



import { t } from '@/lib/i18n';
import { ButtonBase, RangeSlider, SectionHeader } from '@/components/ui';

interface UIScaleSectionProps {
  uiScale: number;
  onUIScaleChange: (scale: number) => void;
}

export function UIScaleSection({ uiScale, onUIScaleChange }: UIScaleSectionProps) {
  return (
    <SectionHeader
      title={t('settings.general.uiScale')}
      description={t('settings.general.uiScaleDescription')}
      icon={<RefreshCw className="w-4 h-4 text-primary" />}
      className="pt-6 border-t border-white/10"
    >
      <div className="max-w-md">
        <RangeSlider
          label={t('settings.general.scale')}
          value={uiScale}
          onChange={onUIScaleChange}
          min={0.7}
          max={1.3}
          step={0.05}
          valueFormatter={(v) => `${Math.round(v * 100)}%`}
          showMinMax
          minLabel={t('settings.general.scaleSmall')}
          maxLabel={t('settings.general.scaleLarge')}
          className="bg-white/[0.02] border-white/5 rounded-xl p-6"
        />
        <div className="flex justify-center mt-2">
          <ButtonBase
            onClick={() => onUIScaleChange(1.0)}
            className="text-xs text-primary/60 hover:text-primary transition-colors font-medium uppercase tracking-tighter"
          >
            {t('settings.general.scaleReset')}
          </ButtonBase>
        </div>
      </div>
    </SectionHeader>
  );
}
