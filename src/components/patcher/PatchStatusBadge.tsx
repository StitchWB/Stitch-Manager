import { Loader2 } from 'lucide-react';
import { t } from '../../lib/i18n';

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
        <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
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
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
        <span className="text-sm font-medium text-emerald-400">{t('status.patched')}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="w-1.5 h-1.5 rounded-full bg-slate-500" />
      <span className="text-sm font-medium text-slate-400">{t('status.notPatched')}</span>
    </div>
  );
}
