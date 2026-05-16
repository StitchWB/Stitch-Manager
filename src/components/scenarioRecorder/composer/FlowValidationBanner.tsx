import { t } from "@/lib/i18n";import type { FlowValidationResult } from '@/lib/scenarioFlow/validation';
import { Button } from '@/components/ui';

type FlowValidationBannerProps = {
  validation: FlowValidationResult;
  onIssueClick?: (index: number) => void;
};

export function FlowValidationBanner({ validation, onIssueClick }: FlowValidationBannerProps) {
  if (!validation.issues.length) return null;

  const tone =
  validation.errors.length > 0 ?
  'border-rose-400/35 bg-rose-500/10 text-rose-200' :
  'border-amber-400/35 bg-amber-500/10 text-amber-200';

  return (
    <div className={`rounded-lg border p-3 text-xs ${tone}`}>
      <div className="font-medium">
        {validation.errors.length > 0 ?
        `${validation.errors.length} error(s) block run` :
        `${validation.warnings.length} warning(s)`}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span>{t("recorder.flow_validation_banner.issues")}{validation.issues.length}</span>
        {validation.issues.length > 0 ?
        <Button size="xs" variant="secondary" onClick={() => onIssueClick?.(0)}>{t("recorder.flow_validation_banner.go_to_first_issue")}

        </Button> :
        null}
      </div>
      <div className="mt-1 space-y-1">
        {validation.issues.slice(0, 5).map((item, idx) =>
        <div
          key={`${item.code}-${item.nodeId ?? 'flow'}-${item.message}`}
          className="block text-left underline-offset-2 hover:underline cursor-pointer"
          onClick={() => onIssueClick?.(idx)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onIssueClick?.(idx); }}}>

            • {item.message}
          </div>
        )}
      </div>
    </div>);

}