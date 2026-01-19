import { motion, AnimatePresence } from 'framer-motion';
import { Download, Trash2, X, RefreshCw, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { t } from '../../lib/i18n';

interface FloatingActionBarProps {
  selectedCount: number;
  onExport: () => void;
  onDelete: () => void;
  onRefreshAll: () => void;
  onClear: () => void;
  className?: string;
  // Bulk refresh state
  isRefreshing?: boolean;
  refreshProgress?: { current: number; total: number };
}

export function FloatingActionBar({
  selectedCount,
  onExport,
  onDelete,
  onRefreshAll,
  onClear,
  className,
  isRefreshing = false,
  refreshProgress,
}: FloatingActionBarProps) {
  const progressText = refreshProgress 
    ? t('accounts.syncing', { 
        current: refreshProgress.current.toString(), 
        total: refreshProgress.total.toString() 
      }) || `Syncing ${refreshProgress.current}/${refreshProgress.total}...`
    : null;

  return (
    <AnimatePresence>
      {selectedCount > 0 && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
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
                <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
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
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
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

            <button
              onClick={onDelete}
              disabled={isRefreshing}
              className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-red-400 hover:text-red-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label={`Delete ${selectedCount} selected accounts`}
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              {t('common.delete') || 'Delete'}
            </button>

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
      )}
    </AnimatePresence>
  );
}
