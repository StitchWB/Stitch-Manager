import { useState, useEffect, useRef, ReactNode } from 'react';
import {
  Settings as SettingsIcon,
  Repeat,
  CheckCircle,
  AlertCircle,
  Zap,
  Table2,
  ShieldCheck,
  Palette,
  Mail,
  Monitor,
  Chrome,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '../stores/app';
import { useUIState } from '../hooks/useUIState';
import { getSettings } from '@/lib/backend';
import { SettingsData } from '../types/generated';
import Header from '../components/layout/Header';
import { t } from '../lib/i18n';
import {
  BackgroundManagerSettingsSection,
  ExtensionSettingsSection,
} from '../components/settings';
import { AiProxySettings } from '../components/settings/AiProxySettings';
import { AppearanceSection } from '../components/settings/AppearanceSection';
import { MailSection } from '../components/settings/MailSection';
import { ProxySection } from '../components/settings/ProxySection';
import { SystemSection } from '../components/settings/SystemSection';
import { GoogleSheetsSection } from '../components/settings/GoogleSheetsSection';
import { useSettingsSaveStore } from '../components/settings/shared';
import { AutomationTab } from '../components/registration/AutomationTab';
import { LoadingSpinner, TabButton } from '@/components/ui';

type SettingsCategory =
  | 'appearance'
  | 'mail'
  | 'proxy'
  | 'system'
  | 'automation'
  | 'google-sheets'
  | 'ai-proxy'
  | 'extension';

interface CategoryConfig {
  id: SettingsCategory;
  labelKey: string;
  icon: ReactNode;
}

const categories: CategoryConfig[] = [
  {
    id: 'appearance',
    labelKey: 'settings.categories.appearance',
    icon: <Palette className="w-4 h-4" />,
  },
  {
    id: 'mail',
    labelKey: 'settings.categories.mail',
    icon: <Mail className="w-4 h-4" />,
  },
  {
    id: 'proxy',
    labelKey: 'settings.categories.proxy',
    icon: <ShieldCheck className="w-4 h-4" />,
  },
  {
    id: 'system',
    labelKey: 'settings.categories.system',
    icon: <Monitor className="w-4 h-4" />,
  },
  {
    id: 'automation',
    labelKey: 'settings.categories.automation',
    icon: <Repeat className="w-4 h-4" />,
  },
  {
    id: 'google-sheets',
    labelKey: 'settings.categories.googleSheets',
    icon: <Table2 className="w-4 h-4" />,
  },
  {
    id: 'ai-proxy',
    labelKey: 'settings.categories.aiProxy',
    icon: <Zap className="w-4 h-4" />,
  },
  {
    id: 'extension',
    labelKey: 'settings.categories.extension',
    icon: <Chrome className="w-4 h-4" />,
  },
];

export default function Settings() {
  const setTheme = useAppStore(state => state.setTheme);
  const language = useAppStore(state => state.language);

  const [activeCategory, setActiveCategory] = useUIState<SettingsCategory>(
    'settings-active-category',
    'appearance',
    'persist'
  );
  // Fallback: if a stale category id is stored (e.g. legacy 'general'/'connectivity'),
  // map it to the first valid category.
  useEffect(() => {
    const validIds = categories.map(c => c.id);
    if (!validIds.includes(activeCategory)) {
      setActiveCategory('appearance');
    }
  }, [activeCategory, setActiveCategory]);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const isSaving = useSettingsSaveStore(state => state.isSaving);
  const saveStatus = useSettingsSaveStore(state => state.saveStatus);
  const errorMessage = useSettingsSaveStore(state => state.errorMessage);

  // Refs for timer cleanup to prevent memory leaks
  const categoryChangeOuterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const categoryChangeInnerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Force re-render when language changes
  void language; // Force re-render on language change

  // Mount animation
  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(timer);
  }, []);

  // Page loads settings once to apply the stored theme; each section loads its own slice on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = (await getSettings()) as unknown as SettingsData;
        if (!cancelled && data.theme && ['light', 'dark', 'system'].includes(data.theme)) {
          setTheme(data.theme as 'light' | 'dark' | 'system');
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
        toast.error(t('settings.loadFailed'), { description: String(error) });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setTheme]);

  const handleCategoryChange = (category: SettingsCategory) => {
    if (category === activeCategory) return;

    if (categoryChangeOuterTimerRef.current) {
      clearTimeout(categoryChangeOuterTimerRef.current);
      categoryChangeOuterTimerRef.current = null;
    }
    if (categoryChangeInnerTimerRef.current) {
      clearTimeout(categoryChangeInnerTimerRef.current);
      categoryChangeInnerTimerRef.current = null;
    }

    setIsTransitioning(true);
    categoryChangeOuterTimerRef.current = setTimeout(() => {
      setActiveCategory(category);
      categoryChangeInnerTimerRef.current = setTimeout(() => setIsTransitioning(false), 50);
    }, 150);
  };

  // Cleanup category change timers on unmount
  useEffect(() => {
    return () => {
      if (categoryChangeOuterTimerRef.current) {
        clearTimeout(categoryChangeOuterTimerRef.current);
      }
      if (categoryChangeInnerTimerRef.current) {
        clearTimeout(categoryChangeInnerTimerRef.current);
      }
    };
  }, []);

  const getAnimationStyle = (index: number) => ({
    opacity: mounted ? 1 : 0,
    transform: mounted ? 'translateY(0)' : 'translateY(8px)',
    transition: `opacity 300ms ease-out ${index * 50}ms, transform 300ms ease-out ${index * 50}ms`,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <Header title={t('settings.title')} icon={<SettingsIcon size={18} />} />
        <div className="flex-1 flex items-center justify-center">
          <LoadingSpinner size="md" />
          <span className="ml-2 text-slate-500 text-sm">{t('settings.loadingSettings')}</span>
        </div>
      </div>
    );
  }

  const renderContent = () => {
    switch (activeCategory) {
      case 'appearance':
        return (
          <div className="space-y-8" style={getAnimationStyle(0)}>
            <AppearanceSection />
          </div>
        );
      case 'mail':
        return (
          <div className="space-y-6" style={getAnimationStyle(0)}>
            <MailSection />
          </div>
        );
      case 'proxy':
        return (
          <div className="space-y-6" style={getAnimationStyle(0)}>
            <ProxySection />
          </div>
        );
      case 'system':
        return (
          <div className="space-y-8" style={getAnimationStyle(0)}>
            <SystemSection />
          </div>
        );
      case 'automation':
        return (
          <div className="space-y-8" style={getAnimationStyle(0)}>
            <AutomationTab />
            <BackgroundManagerSettingsSection />
          </div>
        );
      case 'google-sheets':
        return (
          <div style={getAnimationStyle(0)}>
            <GoogleSheetsSection />
          </div>
        );
      case 'ai-proxy':
        return (
          <div style={getAnimationStyle(0)}>
            <AiProxySettings />
          </div>
        );
      case 'extension':
        return (
          <div style={getAnimationStyle(0)}>
            <ExtensionSettingsSection />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-vsc-bg">
      <Header title={t('settings.title')} icon={<SettingsIcon size={18} />} />

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 border-r border-white/5 bg-vsc-panel/50 flex flex-col p-4 gap-1 overflow-y-auto">
          {categories.map(cat => (
            <TabButton
              key={cat.id}
              active={activeCategory === cat.id}
              onClick={() => handleCategoryChange(cat.id)}
              icon={cat.icon}
              label={t(cat.labelKey)}
              className="justify-start px-4 py-3"
            />
          ))}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-8 relative">
          {/* Transition wrapper */}
          <div
            className={`transition-all duration-150 ease-out ${isTransitioning ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'
              }`}
          >
            {renderContent()}
          </div>
        </div>
      </div>

      {/* Footer / Status Bar (optional, for save status) */}
      <div className="px-6 py-3 border-t border-white/5 bg-vsc-panel flex justify-end items-center gap-4">
        {isSaving && (
          <span className="text-xs text-slate-400 flex items-center gap-1.5 animate-pulse">
            <LoadingSpinner size="xs" color="muted" />
            {t('common.saving')}
          </span>
        )}
        {saveStatus === 'success' && !isSaving && (
          <span className="text-xs text-emerald-400 flex items-center gap-1.5 animate-in fade-in slide-in-from-bottom-2">
            <CheckCircle className="w-3.5 h-3.5" />
            {t('settings.settingsSaved')}
          </span>
        )}
        {saveStatus === 'error' && (
          <span className="text-xs text-red-400 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            {errorMessage || t('settings.failedToSave')}
          </span>
        )}
      </div>
    </div>
  );
}
