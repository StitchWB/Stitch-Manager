import type { FlowValidationResult } from '@/lib/scenarioFlow/validation';
import { Button } from '@/components/ui';

type FlowValidationBannerProps = {
  validation: FlowValidationResult;
  onIssueClick?: (index: number) => void;
};

export function FlowValidationBanner({ validation, onIssueClick }: FlowValidationBannerProps) {
  if (!validation.issues.length) return null;

  const tone =
    validation.errors.length > 0
      ? 'border-rose-400/35 bg-rose-500/10 text-rose-200'
      : 'border-amber-400/35 bg-amber-500/10 text-amber-200';

  return (
    <div className={`rounded-lg border p-3 text-xs ${tone}`}>
      <div className="font-medium">
        {validation.errors.length > 0
          ? `${validation.errors.length} error(s) block run`
          : `${validation.warnings.length} warning(s)`}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span>Issues: {validation.issues.length}</span>
        {validation.issues.length > 0 ? (
          <Button size="xs" variant="secondary" onClick={() => onIssueClick?.(0)}>
            Go to first issue
          </Button>
        ) : null}
      </div>
      <div className="mt-1 space-y-1">
        {validation.issues.slice(0, 5).map((item, idx) => (
          <button
            key={`${item.code}-${item.nodeId ?? 'flow'}-${item.message}`}
            type="button"
            className="block text-left underline-offset-2 hover:underline"
            onClick={() => onIssueClick?.(idx)}
          >
            • {item.message}
          </button>
        ))}
      </div>
    </div>
  );
}
