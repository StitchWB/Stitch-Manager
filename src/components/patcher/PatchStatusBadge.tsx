import { t } from '../../lib/i18n';
import { LoadingSpinner, StatusBadge } from '@/components/ui';


interface PatchStatusBadgeProps {
  isPatched: boolean;
  isOperating: boolean;
  operation: 'patching' | 'unpatching' | 'restoring' | null;
}

export default function PatchStatusBadge({
  isPatched,
  isOperating,
  operation,
}: PatchStatusBadgeProps) {
  if (isOperating) {
    return (
      <div className="flex items-center gap-2">
        <LoadingSpinner size="sm" color="primary" />
        <span className="text-sm font-medium text-indigo-400 capitalize">
          {operation === 'patching'
            ? t('patcher.patching')
            : operation === 'unpatching'
              ? t('patcher.unpatching')
              : t('patcher.restoring')}
          ...
        </span>
      </div>
    );
  }

  if (isPatched) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <StatusBadge status="success" withDot size="md" />
        <span className="text-sm font-medium text-emerald-400">{t('status.patched')}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <StatusBadge status="inactive" withDot size="md" />
      <span className="text-sm font-medium text-slate-400">{t('status.notPatched')}</span>
    </div>
  );
}
