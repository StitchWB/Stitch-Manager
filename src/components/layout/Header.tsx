import { useState, useRef, useEffect } from 'react';
import { Globe } from 'lucide-react';
import { useAppStore } from '../../stores/app';
import { startProxyStatusPolling, stopProxyStatusPolling } from '../../stores/aiProxy';
import { subscribeBackendOffline } from '@/lib/backend/core/invoke';
import { t } from '@/lib/i18n';
import { ButtonBase } from '@/components/ui/ButtonBase';
import { IconButton } from '@/components/ui/IconButton';



const languages = [
  { code: 'en', label: 'English' },
  { code: 'ru', label: 'Русский' },
] as const;

interface HeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}

export default function Header({ title, subtitle, icon, actions }: HeaderProps) {
  const { language, setLanguage } = useAppStore();
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);
  const [backendOffline, setBackendOffline] = useState(false);

  useEffect(() => subscribeBackendOffline(setBackendOffline), []);

  const isOnline = !backendOffline;

  // Use centralized proxy status polling
  useEffect(() => {
    startProxyStatusPolling();
    return () => stopProxyStatusPolling();
  }, []);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(event.target as Node)) {
        setLangOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header
      className="h-12 bg-black/60 border-b border-white/[0.06] flex items-center shrink-0 sticky top-0 z-[60] backdrop-blur-md"
      role="banner"
    >
      {/* Left: Title, subtitle, icon */}
      <div className="flex items-center gap-2.5 px-4 flex-1 min-w-0">
        {icon && (
          <span className="text-slate-400 shrink-0" aria-hidden="true">
            {icon}
          </span>
        )}
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-sm font-medium text-white truncate" title={title}>{title}</h1>
          {subtitle && (
            <>
              <span className="text-slate-700" aria-hidden="true">/</span>
              <p className="text-xs text-slate-500 truncate" title={subtitle}>{subtitle}</p>
            </>
          )}
        </div>
      </div>

      {/* Right: Status, language, notifications, actions */}
      <div className="flex items-center gap-2 px-4 shrink-0">
        {actions}

        {/* Status Indicator */}
        <div
          className="flex items-center gap-1.5 px-2.5 h-7 rounded-md bg-white/[0.04] border border-white/[0.06]"
          role="status"
          aria-live="polite"
          aria-label={isOnline ? t('header.systemOnline') : t('header.serverOffline')}
        >
          <span
            className={`status-dot ${isOnline ? 'status-dot-online' : 'status-dot-offline'}`}
            aria-hidden="true"
          />
          <span className="text-2xs font-medium text-slate-400">
            {isOnline ? t('header.systemOnline') : t('header.serverOffline')}
          </span>
        </div>

        {/* Language Switcher */}
        <div className="relative" ref={langRef}>
          <IconButton
            onClick={() => {
              setLangOpen(!langOpen);
            }}
            size="md"
            aria-label={t('header.changeLanguage')}
            tooltip={t('header.changeLanguage')}
            aria-expanded={langOpen}
            aria-haspopup="listbox"
          >
            <Globe size={18} aria-hidden="true" />
          </IconButton>
          {langOpen && (
            <div
              className="absolute right-0 top-full mt-1 w-32 bg-vsc-panel border border-vsc-border-light rounded-sm shadow-xl z-50 py-1"
              role="listbox"
              aria-label={t('header.selectLanguage')}
            >
              {languages.map(lang => (
                <ButtonBase
                  key={lang.code}
                  onClick={() => {
                    setLanguage(lang.code);
                    setLangOpen(false);
                  }}
                  className={`w-full px-3 py-1.5 text-xs text-left hover:bg-white/5 ${language === lang.code ? 'text-primary' : 'text-slate-300'}`}
                  role="option"
                  aria-selected={language === lang.code}
                >
                  {lang.label}
                </ButtonBase>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
