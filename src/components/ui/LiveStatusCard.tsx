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
  AlertCircle
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

  // COMPACT MODE: Thin status strip instead of hero card
  return (
    <div 
      onClick={handleClick}
      className={cn(
        'relative h-10 px-3 backdrop-blur-sm border-y overflow-hidden transition-all duration-300 flex items-center gap-3',
        isIdle && canStart && onStart
          ? 'border-white/10 cursor-pointer hover:border-white/20 hover:bg-white/[0.02]'
          : 'border-white/[0.05]',
        // Golden glow for code actions
        isCodeAction && 'bg-amber-500/5 border-amber-500/20',
        isActive && !isCodeAction && 'bg-white/[0.02]',
        className
      )}
    >
      {/* Compact icon - small */}
      <div className={cn('shrink-0', config.color)}>
        {action === 'idle' ? <Rocket className="w-3.5 h-3.5" /> : 
         action === 'processing' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
         action === 'connecting' ? <Server className="w-3.5 h-3.5" /> :
         action === 'scanning_inbox' ? <Mail className="w-3.5 h-3.5" /> :
         action === 'launching_browser' ? <Globe className="w-3.5 h-3.5" /> :
         action === 'navigating' ? <Eye className="w-3.5 h-3.5" /> :
         action === 'typing_email' ? <Keyboard className="w-3.5 h-3.5" /> :
         action === 'typing_password' ? <Key className="w-3.5 h-3.5" /> :
         action === 'typing_code' ? <Shield className="w-3.5 h-3.5" /> :
         action === 'waiting_code' ? <Mail className="w-3.5 h-3.5" /> :
         action === 'verifying' ? <Shield className="w-3.5 h-3.5" /> :
         action === 'getting_token' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
         action === 'success' ? <CheckCircle2 className="w-3.5 h-3.5" /> :
         <AlertCircle className="w-3.5 h-3.5" />}
      </div>

      {/* Compact text - single line, monospace with blinking cursor */}
      <div className="flex-1 min-w-0 font-mono text-xs">
        {isIdle ? (
          <span className="text-slate-500">
            &gt; {canStart && onStart ? 'Ready to initialize. Waiting for user input' : 'Configure settings first'}
            <span className="inline-block w-2 animate-pulse">_</span>
          </span>
        ) : (
          <span className={cn('truncate', config.color)}>
            &gt; {config.title}
            {detail && `: ${detail}`}
            {isTyping && <span className="inline-block w-2 animate-pulse">_</span>}
          </span>
        )}
      </div>

      {/* Activity indicator - minimal */}
      {isActive && (
        <div className={cn(
          'w-1.5 h-1.5 rounded-full animate-pulse shrink-0',
          isCodeAction ? 'bg-amber-400' : 'bg-indigo-400'
        )} />
      )}
    </div>
  );
}
