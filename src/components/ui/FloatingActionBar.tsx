import { motion } from 'framer-motion';
import { Download, Trash2, X, RefreshCw, UserPlus, FolderOpen, CheckCircle, Eraser, Archive } from 'lucide-react';
import { cn } from '../../lib/utils';
import { t } from '../../lib/i18n';
import { LoadingSpinner } from './LoadingSpinner';
import { ConfirmActionButton } from './ConfirmActionButton';

interface FloatingActionBarProps {
  selectedCount: number;
  onExport: () => void;
  onDelete: () => void;
  onArchive?: () => void;
  onRefreshAll: () => void;
  onClear: () => void;
  className?: string;
  // Bulk refresh state
  isRefreshing?: boolean;
  refreshProgress?: { current: number; total: number };
  // Profile session actions
  onCreateProfiles?: () => void | Promise<void>;
  onOpenProfileSession?: () => void;
  onConfirmProfileSession?: () => void;
  onClearProfileSession?: () => void;
}

export function FloatingActionBar({
  selectedCount,
  onExport,
  onDelete,
  onArchive,
  onRefreshAll,
  onClear,
  className,
  isRefreshing = false,
  refreshProgress,
  onCreateProfiles,
  onOpenProfileSession,
  onConfirmProfileSession,
  onClearProfileSession,
}: FloatingActionBarProps) {
  const progressText = refreshProgress 
    ? t('accounts.syncing', { 
        current: refreshProgress.current.toString(), 
        total: refreshProgress.total.toString() 
      }) || `Syncing ${refreshProgress.current}/${refreshProgress.total}...`
    : null;

  const hasProfileActions = onCreateProfiles || onOpenProfileSession || onConfirmProfileSession || onClearProfileSession;

  return (
    // No AnimatePresence: framer-motion v12 PopChild reads children.props.ref
    // on React 18.3 and logs a "ref is not a prop" warning. motion.div alone
    // still animates initial→animate on mount; exit is instant.
    selectedCount > 0 && (
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className={cn(
          'fixed bottom-0 left-0 right-0 z-50',
          'h-14 flex items-center justify-between px-6',
          'border-t border-white/10',
          'shadow-action-bar',
          className
        )}
        style={{ background: '#18181b' }}
      >
          {/* Left: Selection count or progress */}
          <div className="text-sm text-white font-medium">
            {isRefreshing && progressText ? (
              <span className="flex items-center gap-2">
                <LoadingSpinner size="sm" color="primary" />
                <span className="text-indigo-300">{progressText}</span>
                {refreshProgress && (
                  <span className="text-slate-500 text-xs ml-1">
                    ({Math.round((refreshProgress.current / refreshProgress.total) * 100)}%)
                  </span>
                )}
              </span>
            ) : (
              <>
                <span className="text-white font-semibold">{selectedCount}</span>
                <span className="text-slate-400 ml-1.5">{t('accounts.accountsSelected') || 'selected'}</span>
              </>
            )}
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2">
            {/* Profile session actions (left group) */}
            {hasProfileActions && (
              <div className="flex items-center gap-1.5 mr-2 pr-3 border-r border-white/10">
                {onCreateProfiles && (
                  <button
                    onClick={() => void onCreateProfiles()}
                    disabled={isRefreshing}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-400 hover:text-emerald-300 border border-emerald-500/20 hover:border-emerald-500/40 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label={t('accounts.profilesCreateButton') || 'Create Profile'}
                    title={t('accounts.profilesCreateButton') || 'Create Profile'}
                  >
                    <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">{t('accounts.profilesCreateButton')}</span>
                  </button>
                )}
                {onOpenProfileSession && (
                  <button
                    onClick={onOpenProfileSession}
                    disabled={isRefreshing}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label={t('accounts.profileSessionOpen') || 'Open Session'}
                    title={t('accounts.profileSessionOpen') || 'Open Session'}
                  >
                    <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">{t('accounts.profileSessionOpen')}</span>
                  </button>
                )}
                {onConfirmProfileSession && (
                  <button
                    onClick={onConfirmProfileSession}
                    disabled={isRefreshing}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label={t('accounts.profileSessionConfirm') || 'Confirm Session'}
                    title={t('accounts.profileSessionConfirm') || 'Confirm Session'}
                  >
                    <CheckCircle className="w-3.5 h-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">{t('accounts.profileSessionConfirm')}</span>
                  </button>
                )}
                {onClearProfileSession && (
                  <button
                    onClick={onClearProfileSession}
                    disabled={isRefreshing}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label={t('accounts.profileSessionClear') || 'Clear Session'}
                    title={t('accounts.profileSessionClear') || 'Clear Session'}
                  >
                    <Eraser className="w-3.5 h-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">{t('accounts.profileSessionClear')}</span>
                  </button>
                )}
              </div>
            )}

            {/* Standard actions (right group) */}
            <button
              onClick={onRefreshAll}
              disabled={isRefreshing}
              className={cn(
                "flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg transition-colors",
                isRefreshing
                  ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 cursor-not-allowed"
                  : "text-slate-300 hover:text-white border border-white/10 hover:border-white/20"
              )}
              aria-label={`Refresh ${selectedCount} selected accounts`}
            >
              {isRefreshing ? (
                <LoadingSpinner size="xs" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              {isRefreshing ? (progressText || 'Syncing...') : (t('common.refresh') || 'Refresh')}
            </button>

            <button
              onClick={onExport}
              disabled={isRefreshing}
              className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-300 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label={`Export ${selectedCount} selected accounts`}
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              {t('common.export') || 'Export'}
            </button>

            {onArchive && (
              <button
                onClick={onArchive}
                disabled={isRefreshing}
                className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label={`Archive ${selectedCount} selected accounts`}
              >
                <Archive className="w-3.5 h-3.5" aria-hidden="true" />
                {t('common.archive') || 'Archive'}
              </button>
            )}

            <ConfirmActionButton
              variant="ghost"
              size="sm"
              onConfirm={onDelete}
              disabled={isRefreshing}
              className="px-4 py-2 h-auto text-red-400 hover:text-red-300"
              leftIcon={<Trash2 className="w-3.5 h-3.5" aria-hidden="true" />}
              aria-label={`Delete ${selectedCount} selected accounts`}
            >
              {t('common.delete') || 'Delete'}
            </ConfirmActionButton>

            {/* Close button */}
            <button
              onClick={onClear}
              disabled={isRefreshing}
              className="ml-2 p-2 text-slate-500 hover:text-white hover:bg-white/5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label={t('accounts.clearSelection')}
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
      </motion.div>
    )
  );
}
