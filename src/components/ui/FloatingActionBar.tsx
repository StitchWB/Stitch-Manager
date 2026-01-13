import { motion, AnimatePresence } from 'framer-motion';
import { Download, Trash2, X, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';

interface FloatingActionBarProps {
  selectedCount: number;
  onExport: () => void;
  onDelete: () => void;
  onRefreshAll: () => void;
  onClear: () => void;
  className?: string;
}

export function FloatingActionBar({
  selectedCount,
  onExport,
  onDelete,
  onRefreshAll,
  onClear,
  className,
}: FloatingActionBarProps) {
  return (
    <AnimatePresence>
      {selectedCount > 0 && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className={cn(
            'fixed bottom-6 left-1/2 -translate-x-1/2 z-50',
            'flex items-center gap-1 px-2 py-1.5',
            'bg-vsc-sidebar border border-vsc-border rounded-sm shadow-2xl',
            className
          )}
        >
          {/* Count */}
          <div className="px-2 py-1 text-xs font-medium text-vsc-text-muted">
            <span className="text-vsc-text font-semibold">{selectedCount}</span> selected
          </div>

          <div className="w-px h-5 bg-vsc-border" />

          {/* Actions */}
          <button
            onClick={onRefreshAll}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-vsc-text-muted hover:text-vsc-text hover:bg-vsc-hover rounded-sm transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>

          <button
            onClick={onExport}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-vsc-text-muted hover:text-vsc-text hover:bg-vsc-hover rounded-sm transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Export
          </button>

          <button
            onClick={onDelete}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-vsc-red hover:text-vsc-red hover:bg-vsc-red/10 rounded-sm transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>

          <div className="w-px h-5 bg-vsc-border" />

          {/* Close */}
          <button
            onClick={onClear}
            className="p-1.5 text-vsc-text-muted hover:text-vsc-text hover:bg-vsc-hover rounded-sm transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
