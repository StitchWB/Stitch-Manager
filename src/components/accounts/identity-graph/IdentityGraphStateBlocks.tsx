import { AlertTriangle, User } from 'lucide-react';

import { ButtonBase, EmptyState } from '@/components/ui';

interface IdentityGraphStateBlocksProps {
  isLoading: boolean;
  error?: string | null;
  hasData: boolean;
  onRetry?: () => void;
}

export function IdentityGraphStateBlocks({
  isLoading,
  error,
  hasData,
  onRetry,
}: IdentityGraphStateBlocksProps) {
  return (
    <>
      {isLoading ? (
        <div className="rounded-xl border border-white/10 bg-[#111116]/70 p-6 text-sm text-slate-400">
          Loading identity graph...
        </div>
      ) : null}

      {!isLoading && error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            <span>{error}</span>
          </div>
          {onRetry && (
            <ButtonBase
              type="button"
              onClick={onRetry}
              className="text-xs font-semibold text-rose-200 hover:text-white"
            >
              Retry
            </ButtonBase>
          )}
        </div>
      ) : null}

      {!isLoading && !error && !hasData ? (
        <EmptyState
          icon={User}
          title="No identities found"
          description="Try adjusting filters or loading another dataset."
        />
      ) : null}
    </>
  );
}
