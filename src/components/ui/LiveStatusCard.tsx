import { cn } from '../../lib/utils';
import { t } from '../../lib/i18n';
import { 
  Keyboard, 
  Mail, 
  Globe, 
  Shield, 
  Key, 
  CheckCircle2, 
  Loader2,
  Rocket,
  Server,
  Eye,
  AlertCircle,
  Play
} from 'lucide-react';

export type LiveAction = 
  | 'idle'
  | 'processing'
  | 'connecting'
  | 'scanning_inbox'
  | 'launching_browser'
  | 'navigating'
  | 'typing_email'
  | 'typing_password'
  | 'typing_code'
  | 'waiting_code'
  | 'verifying'
  | 'getting_token'
  | 'success'
  | 'error';

interface LiveStatusCardProps {
  action: LiveAction;
  detail?: string;
  onStart?: () => void;
  canStart?: boolean;
  className?: string;
}

// Get action config with translated titles
function getActionConfig(): Record<LiveAction, {
  icon: React.ReactNode;
  title: string;
  color: string;
  bgGlow: string;
  iconBg: string;
}> {
  return {
    idle: {
      icon: <Rocket className="w-8 h-8" />,
      title: t('liveStatus.idle'),
      color: 'text-slate-300',
      bgGlow: 'rgba(100, 116, 139, 0.1)',
      iconBg: 'bg-slate-500/15',
    },
    processing: {
      icon: <Loader2 className="w-8 h-8 animate-spin" />,
      title: t('liveStatus.processing'),
      color: 'text-indigo-400',
      bgGlow: 'rgba(99, 102, 241, 0.15)',
      iconBg: 'bg-indigo-500/20',
    },
    connecting: {
      icon: <Server className="w-8 h-8" />,
      title: t('liveStatus.connecting'),
      color: 'text-blue-400',
      bgGlow: 'rgba(59, 130, 246, 0.15)',
      iconBg: 'bg-blue-500/20',
    },
    scanning_inbox: {
      icon: <Mail className="w-8 h-8" />,
      title: t('liveStatus.scanningInbox'),
      color: 'text-cyan-400',
      bgGlow: 'rgba(34, 211, 238, 0.15)',
      iconBg: 'bg-cyan-500/20',
    },
    launching_browser: {
      icon: <Globe className="w-8 h-8" />,
      title: t('liveStatus.launchingBrowser'),
      color: 'text-violet-400',
      bgGlow: 'rgba(139, 92, 246, 0.15)',
      iconBg: 'bg-violet-500/20',
    },
    navigating: {
      icon: <Eye className="w-8 h-8" />,
      title: t('liveStatus.navigating'),
      color: 'text-indigo-400',
      bgGlow: 'rgba(129, 140, 248, 0.15)',
      iconBg: 'bg-indigo-500/20',
    },
    typing_email: {
      icon: <Keyboard className="w-8 h-8" />,
      title: t('liveStatus.typingEmail'),
      color: 'text-purple-400',
      bgGlow: 'rgba(192, 132, 252, 0.15)',
      iconBg: 'bg-purple-500/20',
    },
    typing_password: {
      icon: <Key className="w-8 h-8" />,
      title: t('liveStatus.typingPassword'),
      color: 'text-pink-400',
      bgGlow: 'rgba(244, 114, 182, 0.15)',
      iconBg: 'bg-pink-500/20',
    },
    typing_code: {
      icon: <Shield className="w-8 h-8" />,
      title: t('liveStatus.typingCode'),
      color: 'text-amber-400',
      bgGlow: 'rgba(251, 191, 36, 0.2)',
      iconBg: 'bg-amber-500/25',
    },
    waiting_code: {
      icon: <Mail className="w-8 h-8" />,
      title: t('liveStatus.waitingCode'),
      color: 'text-orange-400',
      bgGlow: 'rgba(251, 146, 60, 0.15)',
      iconBg: 'bg-orange-500/20',
    },
    verifying: {
      icon: <Shield className="w-8 h-8" />,
      title: t('liveStatus.verifying'),
      color: 'text-yellow-400',
      bgGlow: 'rgba(250, 204, 21, 0.15)',
      iconBg: 'bg-yellow-500/20',
    },
    getting_token: {
      icon: <Loader2 className="w-8 h-8 animate-spin" />,
      title: t('liveStatus.gettingToken'),
      color: 'text-teal-400',
      bgGlow: 'rgba(45, 212, 191, 0.15)',
      iconBg: 'bg-teal-500/20',
    },
    success: {
      icon: <CheckCircle2 className="w-8 h-8" />,
      title: t('liveStatus.success'),
      color: 'text-emerald-400',
      bgGlow: 'rgba(52, 211, 153, 0.2)',
      iconBg: 'bg-emerald-500/25',
    },
    error: {
      icon: <AlertCircle className="w-8 h-8" />,
      title: t('liveStatus.error'),
      color: 'text-red-400',
      bgGlow: 'rgba(248, 113, 113, 0.15)',
      iconBg: 'bg-red-500/20',
    },
  };
}

// Typing animation dots
function TypingDots() {
  return (
    <div className="flex gap-1 mt-1">
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '0ms', animationDuration: '600ms' }} />
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '150ms', animationDuration: '600ms' }} />
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '300ms', animationDuration: '600ms' }} />
    </div>
  );
}

export function LiveStatusCard({ action, detail, onStart, canStart = true, className }: LiveStatusCardProps) {
  const ACTION_CONFIG = getActionConfig();
  const config = ACTION_CONFIG[action];
  const isTyping = action.startsWith('typing_');
  const isActive = action !== 'idle' && action !== 'success' && action !== 'error';
  const isIdle = action === 'idle';
  const isCodeAction = action === 'typing_code' || action === 'waiting_code';

  // Make idle state clickable as start button
  const handleClick = () => {
    if (isIdle && onStart && canStart) {
      onStart();
    }
  };

  return (
    <div 
      onClick={handleClick}
      className={cn(
        'relative rounded-xl p-6 backdrop-blur-sm border overflow-hidden transition-all duration-300',
        isIdle && canStart && onStart
          ? 'border-white/15 cursor-pointer hover:border-white/25 hover:scale-[1.01] active:scale-[0.99]'
          : 'border-white/[0.08]',
        // Golden glow for code actions
        isCodeAction && 'shadow-[0_0_30px_rgba(234,179,8,0.2)]',
        className
      )}
      style={{ 
        background: `linear-gradient(145deg, ${config.bgGlow}, rgba(0,0,0,0.3))`,
      }}
    >
      {/* Subtle animated border glow for active states */}
      {isActive && (
        <div 
          className="absolute inset-0 rounded-xl opacity-60"
          style={{ 
            background: `linear-gradient(145deg, ${config.bgGlow}, transparent)`,
            filter: 'blur(25px)',
          }}
        />
      )}

      {/* Content */}
      <div className="relative flex items-center gap-5">
        {/* Icon container with background */}
        <div className={cn(
          'w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-300',
          config.iconBg,
          isActive && 'animate-pulse'
        )}>
          <div className={cn('transition-colors duration-300', config.color)}>
            {config.icon}
          </div>
        </div>

        {/* Text content */}
        <div className="flex-1 min-w-0">
          {/* Title - large and prominent */}
          <h3 className={cn(
            'text-xl font-bold mb-1 transition-colors duration-300',
            config.color
          )}>
            {config.title}
          </h3>

          {/* Detail or typing indicator */}
          {isTyping ? (
            <div className={cn('flex items-center gap-2', config.color)}>
              {/* Code display - larger for verification codes */}
              {isCodeAction && detail ? (
                <span className="text-2xl font-bold font-mono tracking-wider">{detail}</span>
              ) : (
                <span className="text-sm text-slate-400">{detail || 'Processing...'}</span>
              )}
              <TypingDots />
            </div>
          ) : detail ? (
            <p className={cn(
              'font-mono truncate',
              isCodeAction ? 'text-xl font-bold text-amber-300' : 'text-sm text-slate-400'
            )}>
              {detail}
            </p>
          ) : isIdle && onStart ? (
            <p className="text-sm text-slate-400 flex items-center gap-2">
              <Play className="w-4 h-4" />
              {t('liveStatus.clickToStart')}
            </p>
          ) : (
            <p className="text-sm text-slate-500">
              {action === 'idle' ? t('liveStatus.configureFirst') : t('liveStatus.processing')}
            </p>
          )}
        </div>

        {/* Activity indicator */}
        {isActive && (
          <div className="shrink-0">
            <div className={cn(
              'w-3 h-3 rounded-full animate-pulse',
              action === 'typing_code' || action === 'waiting_code' ? 'bg-amber-400' : 'bg-indigo-400'
            )} 
            style={{ boxShadow: `0 0 12px currentColor` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
