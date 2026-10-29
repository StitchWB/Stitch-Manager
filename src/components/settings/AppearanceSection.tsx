import { useAppStore } from '@/stores/app';
import { useRegistrationStore } from '@/stores/registration';
import { ThemeLanguageSection } from './ThemeLanguageSection';
import { UIScaleSection } from './UIScaleSection';
import { saveSettingsSlice } from './shared';

export function AppearanceSection() {
  const theme = useAppStore(state => state.theme);
  const setTheme = useAppStore(state => state.setTheme);
  const language = useAppStore(state => state.language);
  const setLanguage = useAppStore(state => state.setLanguage);

  const uiScale = useRegistrationStore(state => state.config.uiScale);
  const setUIScale = useRegistrationStore(state => state.setUIScale);

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
    void saveSettingsSlice({ theme: newTheme }, 'Failed to save settings');
  };

  return (
    <>
      <ThemeLanguageSection
        theme={theme}
        onThemeChange={handleThemeChange}
        language={language}
        onLanguageChange={setLanguage}
      />

      <UIScaleSection uiScale={uiScale} onUIScaleChange={setUIScale} />
    </>
  );
}
