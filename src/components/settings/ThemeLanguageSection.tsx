import { Sun, Moon, Monitor, Globe } from 'lucide-react';import { ButtonBase } from '../ui';

import { SectionHeader } from '../ui/SectionHeader';
import { t } from '../../lib/i18n';
import type { Language } from '../../stores/app';

interface ThemeLanguageSectionProps {
  theme: 'light' | 'dark' | 'system';
  onThemeChange: (theme: 'light' | 'dark' | 'system') => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
}

export function ThemeLanguageSection({
  theme,
  onThemeChange,
  language,
  onLanguageChange,
}: ThemeLanguageSectionProps) {
  return (
    <>
      {/* Theme Section */}
      <SectionHeader
        title={t('settings.general.appearance')}
        description={t('settings.general.appearanceDescription')}
        icon={<Sun className="w-4 h-4 text-primary" />}
      >
        <div className="flex gap-3">
          {[
            { value: 'light', icon: Sun, labelKey: 'settings.general.light' },
            { value: 'dark', icon: Moon, labelKey: 'settings.general.dark' },
            { value: 'system', icon: Monitor, labelKey: 'settings.general.system' },
          ].map(({ value, icon: Icon, labelKey }) => (
            <ButtonBase
              key={value}
              onClick={() => onThemeChange(value as 'light' | 'dark' | 'system')}
              className={`flex items-center gap-2 px-5 py-3 rounded-lg border text-sm font-medium transition-all active:scale-95 duration-75 ${
                theme === value
                  ? 'bg-primary/20 border-primary/50 text-primary shadow-[0_0_15px_rgba(99,102,241,0.2)]'
                  : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20 hover:text-white hover:bg-white/[0.08]'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t(labelKey)}
            </ButtonBase>
          ))}
        </div>
      </SectionHeader>

      {/* Language Section */}
      <SectionHeader
        title={t('settings.general.language')}
        description={t('settings.general.languageDescription')}
        icon={<Globe className="w-4 h-4 text-primary" />}
      >
        <div className="flex gap-3">
          {[
            { value: 'en', label: 'English', flag: '🇺🇸' },
            { value: 'ru', label: 'Русский', flag: '🇷🇺' },
          ].map(({ value, label, flag }) => (
            <ButtonBase
              key={value}
              onClick={() => onLanguageChange(value as Language)}
              className={`flex items-center gap-2 px-5 py-3 rounded-lg border text-sm font-medium transition-all active:scale-95 duration-75 ${
                language === value
                  ? 'bg-primary/20 border-primary/50 text-primary shadow-[0_0_15px_rgba(99,102,241,0.2)]'
                  : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20 hover:text-white hover:bg-white/[0.08]'
              }`}
            >
              <span className="text-base">{flag}</span>
              {label}
            </ButtonBase>
          ))}
        </div>
      </SectionHeader>
    </>
  );
}
