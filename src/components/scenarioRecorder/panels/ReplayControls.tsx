import { PlayCircle, PlusCircle, RefreshCw, GitBranch } from 'lucide-react';
import { Button } from '@/components/ui';
import { t } from '@/lib/i18n';

type ReplayControlsProps = {
  variant: 'modal' | 'panel';
  loading?: boolean;
  refreshDisabled?: boolean;
  onRefresh?: () => void;
  onReplay: () => void;
  onComposeFlow?: () => void;
  onRecord: () => void;
};

export function ReplayControls({
  variant,
  loading = false,
  refreshDisabled = false,
  onRefresh,
  onReplay,
  onComposeFlow,
  onRecord
}: ReplayControlsProps) {
  if (variant === 'panel') {
    return (
      <>
        <Button
          size="sm"
          className="h-9"
          variant="secondary"
          onClick={onRefresh}
          disabled={refreshDisabled}
          leftIcon={<RefreshCw size={14} />}>

          {loading ? t('common.loading') : t('common.refresh')}
        </Button>
        <Button
          size="sm"
          className="h-9"
          variant="secondary"
          onClick={() => onReplay()}
          leftIcon={<PlayCircle size={16} />}>

          {t('common.replay')}
        </Button>
        {onComposeFlow ?
        <Button
          size="sm"
          className="h-9"
          variant="secondary"
          onClick={onComposeFlow}
          leftIcon={<GitBranch size={16} />}>{t("recorder.profile_scenarios_panel.flow_composer")}


        </Button> :
        null}
        <Button
          size="sm"
          className="h-9 px-4"
          variant="primary"
          onClick={onRecord}
          leftIcon={<PlusCircle size={16} />}>

          {t('common.record')}
        </Button>
      </>);

  }

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => onReplay()}
        leftIcon={<PlayCircle size={16} />}>

        {t('common.replay')}
      </Button>
      {onComposeFlow ?
      <Button
        variant="secondary"
        onClick={onComposeFlow}
        leftIcon={<GitBranch size={16} />}>{t("recorder.profile_scenarios_panel.flow_composer")}


      </Button> :
      null}
      <Button variant="primary" onClick={onRecord} leftIcon={<PlusCircle size={16} />}>
        {t('common.record')}
      </Button>
    </>);

}
