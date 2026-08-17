import { User } from 'lucide-react';
import { t } from '@/lib/i18n';
import { GlassCard } from '../GlassCard';
import { StatusBadge } from '../StatusBadge';
import { ButtonBase } from '../ButtonBase';
import { cn } from '@/lib/utils';
import type { AccountStatusVariant } from '@/lib/accountStatus';
import { SectionHeader } from '../SectionHeader';

type ProfileSessionStatus = 'ready' | 'pending' | 'disabled';

const getProfileSessionStatus = (tags: string[]): ProfileSessionStatus => {
  if (tags.includes('profile:disabled')) return 'disabled';
  if (tags.includes('profile:pending')) return 'pending';
  if (
    tags.includes('profile:ready') ||
    tags.includes('profile:manual') ||
    tags.includes('profile:antidetect')
  ) {
    return 'ready';
  }
  return 'disabled';
};

interface AccountProfileSessionSectionProps {
  tagsList: string[];
  onOpenProfileSession?: () => void;
  onConfirmProfileSession?: () => void;
  onClearProfileSession?: () => void;
  /** Web-session (web2api) providers get the cookie-harvest pair instead. */
  isWebSession?: boolean;
  onOpenWebLogin?: () => void;
  onCaptureWebCookies?: () => void;
  compact?: boolean;
}

export function AccountProfileSessionSection({
  tagsList,
  onOpenProfileSession,
  onConfirmProfileSession,
  onClearProfileSession,
  isWebSession,
  onOpenWebLogin,
  onCaptureWebCookies,
  compact,
}: AccountProfileSessionSectionProps) {
  const profileSessionStatus = getProfileSessionStatus(tagsList);
  const profileSessionVariant =
    profileSessionStatus === 'ready'
      ? 'success'
      : profileSessionStatus === 'pending'
        ? 'warning'
        : 'neutral';
  const profileSessionLabel =
    profileSessionStatus === 'ready'
      ? t('accounts.profileSessionReady')
      : profileSessionStatus === 'pending'
        ? t('accounts.profileSessionPending')
        : t('accounts.profileSessionDisabled');
  const hasProfileTags = tagsList.some(tag => tag.startsWith('profile:'));
  const canOpenProfileSession = profileSessionStatus === 'ready' && !!onOpenProfileSession;
  const canConfirmProfileSession = profileSessionStatus === 'pending' && !!onConfirmProfileSession;
  const canClearProfileSession = hasProfileTags && !!onClearProfileSession;

  const content = (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-slate-500">{t('common.status')}</span>
          <StatusBadge variant={profileSessionVariant as AccountStatusVariant} size="sm">
          {profileSessionLabel}
        </StatusBadge>
      </div>
      <div className="flex flex-wrap gap-2">
        <ButtonBase
          onClick={onOpenProfileSession}
          disabled={!canOpenProfileSession}
          className={cn(
            'px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest rounded-md border transition-colors',
            canOpenProfileSession
              ? 'border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/10'
              : 'border-white/5 text-slate-500 opacity-50 cursor-not-allowed'
          )}
        >
          {t('accounts.profileSessionOpen')}
        </ButtonBase>
        <ButtonBase
          onClick={onConfirmProfileSession}
          disabled={!canConfirmProfileSession}
          className={cn(
            'px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest rounded-md border transition-colors',
            canConfirmProfileSession
              ? 'border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10'
              : 'border-white/5 text-slate-500 opacity-50 cursor-not-allowed'
          )}
        >
          {t('accounts.profileSessionConfirm')}
        </ButtonBase>
        <ButtonBase
          onClick={onClearProfileSession}
          disabled={!canClearProfileSession}
          className={cn(
            'px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest rounded-md border transition-colors',
            canClearProfileSession
              ? 'border-amber-500/30 text-amber-300 hover:bg-amber-500/10'
              : 'border-white/5 text-slate-500 opacity-50 cursor-not-allowed'
          )}
        >
          {t('accounts.profileSessionClear')}
        </ButtonBase>
        {isWebSession && (
          <>
            <ButtonBase
              onClick={onOpenWebLogin}
              disabled={!onOpenWebLogin}
              className={cn(
                'px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest rounded-md border transition-colors',
                onOpenWebLogin
                  ? 'border-sky-500/30 text-sky-300 hover:bg-sky-500/10'
                  : 'border-white/5 text-slate-500 opacity-50 cursor-not-allowed'
              )}
            >
              {t('accounts.webLoginOpen')}
            </ButtonBase>
            <ButtonBase
              onClick={onCaptureWebCookies}
              disabled={!onCaptureWebCookies}
              className={cn(
                'px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest rounded-md border transition-colors',
                onCaptureWebCookies
                  ? 'border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10'
                  : 'border-white/5 text-slate-500 opacity-50 cursor-not-allowed'
              )}
            >
              {t('accounts.webLoginCapture')}
            </ButtonBase>
          </>
        )}
      </div>
    </div>
  );

  if (compact) {
    return (
      <GlassCard className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <User size={14} className="text-indigo-400" />
          <span className="text-xs font-semibold text-white">{t('accounts.profileSession')}</span>
        </div>
        {content}
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-4">
      <SectionHeader
        title={t('accounts.profileSession')}
        icon={<User size={16} className="text-indigo-400" />}
      >
        {content}
      </SectionHeader>
    </GlassCard>
  );
}
