import { useState } from 'react';
import { cn } from '../../lib/utils';
import { t } from '../../lib/i18n';
import { Copy, Check, Sparkles, Key } from 'lucide-react';

interface SuccessCardProps {
  email: string;
  hasToken?: boolean;
  onCopyToken?: () => void;
  className?: string;
}

// Generate consistent avatar color from email (brand colors)
function getAvatarColor(email: string): string {
  const colors = [
    'from-emerald-500 to-emerald-600',
    'from-cyan-500 to-cyan-600',
    'from-violet-500 to-violet-600',
    'from-indigo-500 to-indigo-600',
    'from-teal-500 to-teal-600',
    'from-blue-500 to-blue-600',
  ];
  const hash = email.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

// Get initials from email
function getInitials(email: string): string {
  const name = email.split('@')[0];
  if (name.includes('+')) {
    return name.split('+')[0].slice(0, 2).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function SuccessCard({ email, hasToken, onCopyToken, className }: SuccessCardProps) {
  const [copied, setCopied] = useState(false);
  const avatarColor = getAvatarColor(email);
  const initials = getInitials(email);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  };

  return (
    <div 
      className={cn(
        'relative rounded-xl p-5 overflow-hidden animate-in slide-in-from-top-2 duration-500',
        'border border-emerald-500/30',
        className
      )}
      style={{ 
        background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(6, 182, 212, 0.06))',
      }}
    >
      {/* Sparkle decorations */}
      <Sparkles className="absolute top-3 right-3 w-4 h-4 text-amber-400/40 animate-pulse" />
      <Sparkles className="absolute bottom-3 left-3 w-3 h-3 text-emerald-400/40 animate-pulse" style={{ animationDelay: '500ms' }} />

      {/* Glow effect */}
      <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/5 via-transparent to-cyan-500/5" />

      <div className="relative flex items-center gap-4">
        {/* Avatar - consistent brand colors */}
        <div className={cn(
          'w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0',
          'bg-gradient-to-br shadow-lg',
          avatarColor
        )}>
          {initials}
        </div>

        {/* Info - email is the hero */}
        <div className="flex-1 min-w-0">
          {/* Badges row */}
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">
              {t('successCard.accountCreated')}
            </span>
            {hasToken && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 text-[9px] font-medium">
                <Key className="w-2.5 h-2.5" />
                {t('successCard.token')}
              </span>
            )}
          </div>
          
          {/* Email - THE TROPHY */}
          <p className="text-base font-bold font-mono text-white truncate tracking-tight">
            {email}
          </p>
        </div>

        {/* Actions - vertically centered */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleCopy}
            className={cn(
              'p-2.5 rounded-lg transition-all',
              copied 
                ? 'bg-emerald-500/20 text-emerald-400' 
                : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
            )}
            title={t('successCard.copyEmail')}
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </button>
          
          {hasToken && onCopyToken && (
            <button
              onClick={onCopyToken}
              className="p-2.5 rounded-lg bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 transition-all"
              title={t('successCard.copyToken')}
            >
              <Key className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Bottom shine effect */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent" />
    </div>
  );
}
