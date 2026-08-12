import { useState, useRef, useEffect } from 'react';
import { Bell, Globe, X, Info, CheckCircle, AlertTriangle, AlertCircle } from 'lucide-react';
import { useAppStore } from '../../stores/app';
import { useAiProxyStore, startProxyStatusPolling, stopProxyStatusPolling } from '../../stores/aiProxy';
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
  const { language, setLanguage, notifications, removeNotification, clearNotifications } =
    useAppStore();
  const [langOpen, setLangOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const langRef = useRef<HTMLDivElement>(null);
  const proxyStatus = useAiProxyStore(state => state.status);

  const isOnline = proxyStatus?.running ?? false;

  // Use centralized proxy status polling
  useEffect(() => {
    startProxyStatusPolling();
    return () => stopProxyStatusPolling();
  }, []);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setNotifOpen(false);
      }
      if (langRef.current && !langRef.current.contains(event.target as Node)) {
        setLangOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-emerald-400" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-amber-400" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-400" />;
      default:
        return <Info className="w-4 h-4 text-blue-400" />;
    }
  };

  const formatTime = (timestamp: number) => {
    const eventTime = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - eventTime.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return t('time.justNow');
    if (minutes < 60) return t('time.minutesAgo', { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('time.hoursAgo', { count: hours });
    return t('time.daysAgo', { count: Math.floor(hours / 24) });
  };

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
          <h1 className="text-sm font-medium text-white truncate">{title}</h1>
          {subtitle && (
            <>
              <span className="text-slate-700" aria-hidden="true">/</span>
              <p className="text-xs text-slate-500 truncate">{subtitle}</p>
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
              setNotifOpen(false);
            }}
            size="md"
            aria-label={t('header.changeLanguage')}
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

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <IconButton
            onClick={() => {
              setNotifOpen(!notifOpen);
              setLangOpen(false);
            }}
            size="md"
            className="relative"
            aria-label={
              t('header.notifications') +
              (notifications.length > 0 ? ` (${notifications.length})` : '')
            }
            aria-expanded={notifOpen}
            aria-haspopup="true"
          >
            <Bell size={18} aria-hidden="true" />
            {notifications.length > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-400 rounded-full ring-2 ring-[#050508] animate-pulse"
                aria-hidden="true"
              />
            )}
          </IconButton>

          {notifOpen && (
            <div className="absolute right-0 top-full mt-1 w-80 bg-vsc-panel border border-vsc-border-light rounded-sm shadow-xl z-50 overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
                <span className="text-xs font-medium text-white">{t('header.notifications')}</span>
                {notifications.length > 0 && (
                  <ButtonBase
                    onClick={clearNotifications}
                    className="text-2xs text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    {t('header.clearAll')}
                  </ButtonBase>
                )}
              </div>

              {/* Notifications List */}
              <div
                className="max-h-64 overflow-y-auto"
                role="list"
                aria-label={t('header.notificationsList')}
              >
                {notifications.length === 0 ? (
                  <div className="px-3 py-6 text-center">
                    <Bell className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                    <p className="text-xs text-slate-500">{t('header.noNotifications')}</p>
                  </div>
                ) : (
                  notifications.map(notif => (
                    <div
                      key={notif.id}
                      className="px-3 py-2.5 border-b border-white/5 hover:bg-white/[0.02] transition-colors group"
                      role="listitem"
                    >
                      <div className="flex items-start gap-2.5">
                        {getNotificationIcon(notif.type)}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-white truncate">{notif.title}</p>
                          {notif.message && (
                            <p className="text-2xs text-slate-400 mt-0.5 line-clamp-2">
                              {notif.message}
                            </p>
                          )}
                          <p className="text-2xs text-slate-600 mt-1">
                            {formatTime(notif.timestamp)}
                          </p>
                        </div>
                        <ButtonBase
                          onClick={() => removeNotification(notif.id)}
                          className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-500 hover:text-white transition-all"
                        >
                          <X className="w-3.5 h-3.5" />
                        </ButtonBase>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
