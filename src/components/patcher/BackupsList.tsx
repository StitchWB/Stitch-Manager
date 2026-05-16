import { Archive, RotateCcw, Trash2, RefreshCw } from 'lucide-react';
import { t } from '@/lib/i18n';
import { formatDate, formatSize } from '../../lib/patcher';

import type { UIBackupInfo } from '../../types/ui';
import { Tooltip } from '../Tooltip';
import { Button, ButtonBase, LoadingSpinner } from '@/components/ui';

interface BackupsListProps {
  backups: UIBackupInfo[];
  isLoading: boolean;
  operationInProgress: Record<string, string | null>;
  onRestore: (backupId: string) => void;
  onDelete: (backupId: string) => void;
  onRefresh: () => void;
}

export default function BackupsList({
  backups,
  isLoading,
  operationInProgress,
  onRestore,
  onDelete,
  onRefresh,
}: BackupsListProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
          <Archive size={14} className="text-slate-500" />
          {t('patcher.backups')} ({backups.length})
        </h3>
        <Button
          onClick={onRefresh}
          disabled={isLoading}
          variant="ghost"
          size="xs"
          leftIcon={<RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />}
        >
          {t('common.refresh')}
        </Button>
      </div>

      {isLoading && backups.length === 0 ? (
        <div className="text-center py-8 text-slate-500 flex flex-col items-center gap-2">
          <LoadingSpinner size="md" color="muted" />
          <span className="text-xs">{t('patcher.loadingBackups')}</span>
        </div>
      ) : backups.length === 0 ? (
        <div className="text-center py-8 text-slate-600 bg-white/[0.02] rounded-lg">
          <Archive className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-xs">{t('patcher.noBackups')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {backups.map((backup: UIBackupInfo) => {
            const isRestoring = operationInProgress[backup.ideId] === 'restoring';
            return (
              <div
                key={backup.id}
                className="flex items-center gap-3 p-3 bg-white/[0.02] rounded-lg hover:bg-white/[0.04] transition-colors"
              >
                <div className="w-8 h-8 rounded bg-white/[0.05] flex items-center justify-center text-slate-500 shrink-0">
                  <Archive size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium text-white truncate block">
                    {backup.ideName}
                  </span>
                  <span className="text-[10px] text-slate-600">
                    {formatDate(backup.createdAt)} • {formatSize(backup.size)}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Tooltip content={t('patcher.restore')}>
                    <ButtonBase
                      onClick={() => onRestore(backup.id)}
                      disabled={isRestoring || !backup.isValid}
                      className="p-1.5 text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10 rounded disabled:opacity-40"
                    >
                      {isRestoring ? <LoadingSpinner size="xs" /> : <RotateCcw size={14} />}
                    </ButtonBase>
                  </Tooltip>
                  <Tooltip content={t('common.delete')}>
                    <ButtonBase
                      onClick={() => onDelete(backup.id)}
                      className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded"
                    >
                      <Trash2 size={14} />
                    </ButtonBase>
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
