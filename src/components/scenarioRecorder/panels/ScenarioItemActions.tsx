import {
  Copy,
  Trash2,
  Heart,
  Pencil,
  Repeat2,
  FolderOpen,
  Archive,
  HelpCircle } from
'lucide-react';
import { Button, ConfirmActionButton, IconButton, Tooltip } from '@/components/ui';
import { openInFileManager, copyToClipboard } from '@/lib/backend/modules/utils';
import type { ScenarioRecordItem } from '@/lib/backend/modules/pythonJobs';
import { t } from '@/lib/i18n';
import { toast } from 'sonner';

type ScenarioItemActionsProps = {
  item: ScenarioRecordItem;
  isLocked: boolean;
  view: 'list' | 'cards';
  duplicateLoading: boolean;
  pendingDeleteId: string | null;
  deleteLoadingId: string | null;
  onHowToGet: (item: ScenarioRecordItem) => void;
  onToggleFavorite: (item: ScenarioRecordItem) => void;
  onEdit: (item: ScenarioRecordItem) => void;
  onDuplicate: (item: ScenarioRecordItem) => void;
  onOpenHistory: (item: ScenarioRecordItem) => void;
  onDeleteClick: (item: ScenarioRecordItem) => void;
};

export function ScenarioItemActions({
  item,
  isLocked,
  view,
  duplicateLoading,
  pendingDeleteId,
  deleteLoadingId,
  onHowToGet,
  onToggleFavorite,
  onEdit,
  onDuplicate,
  onOpenHistory,
  onDeleteClick
}: ScenarioItemActionsProps) {
  const howToGetButton = isLocked && item.min_role ? (
    <IconButton
      size="md"
      variant="ghost"
      onClick={() => onHowToGet(item)}
      aria-label={t('scenarios.howToGetTier', { tier: t(`auth.role.${item.min_role}`) })}
      title={t('scenarios.howToGetTier', { tier: t(`auth.role.${item.min_role}`) })}
      className="text-slate-400 hover:text-amber-300">
      <HelpCircle size={16} />
    </IconButton>
  ) : null;

  const favoriteButton = (
    <IconButton
      size="md"
      variant="ghost"
      disabled={isLocked}
      onClick={() => { if (!isLocked) onToggleFavorite(item); }}
      aria-label={t('scenarios.toggleFavorite')}
      title={isLocked ? t('scenarios.tierLocked') : t('scenarios.toggleFavorite')}>

      <Heart size={16} className={item.favorite ? 'text-pink-300' : ''} />
    </IconButton>
  );

  const editButton = (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => onEdit(item)}
      disabled={isLocked}
      leftIcon={<Pencil size={14} />}
      className="h-8"
      title={isLocked ? t('scenarios.tierLocked') : undefined}>

      {t('common.edit')}
    </Button>
  );

  const duplicateButton = (
    <ConfirmActionButton
      iconOnly
      size="md"
      variant="ghost"
      isLoading={duplicateLoading}
      disabled={isLocked}
      onConfirm={() => { if (!isLocked) onDuplicate(item); }}
      armedLabel={<Repeat2 size={16} />}
      aria-label={t('scenarios.duplicateScenario')}
      title={isLocked ? t('scenarios.tierLocked') : t('scenarios.duplicateScenario')}>

      <Repeat2 size={16} />
    </ConfirmActionButton>
  );

  const historyButton = (
    <IconButton
      size="md"
      variant="ghost"
      onClick={() => onOpenHistory(item)}
      aria-label={t('common.history')}
      title={t('common.history')}>

      <Archive size={16} />
    </IconButton>
  );

  const openFolderButton = (
    <IconButton
      size="md"
      variant="ghost"
      onClick={() =>
      void openInFileManager({ path: item.scenarioPath }).catch(() => {
        toast.error(t('common.error'));
      })
      }
      aria-label={t('scenarios.openFolder')}
      title={t('scenarios.openFolder')}>

      <FolderOpen size={16} />
    </IconButton>
  );

  const copyPathButton = (
    <IconButton
      size="md"
      variant="ghost"
      onClick={() =>
      void copyToClipboard({ text: item.scenarioPath }).then(
        () => toast.success(t('common.success')),
        () => toast.error(t('common.error'))
      )
      }
      aria-label={t('scenarios.copyPath')}
      title={t('scenarios.copyPath')}>

      <Copy size={16} />
    </IconButton>
  );

  const deleteButton = (
    <Tooltip
      content={
      isLocked ? t('scenarios.tierLocked') :
      pendingDeleteId === item.id ?
      t('scenarios.deleteArmedHint') :
      t('common.delete')
      }
      side="top">

      <Button
        size="sm"
        variant="danger"
        onClick={() => onDeleteClick(item)}
        disabled={isLocked || deleteLoadingId === item.id}
        leftIcon={<Trash2 size={14} />}
        className={
        pendingDeleteId === item.id ?
        'h-8 border-red-500/90 bg-red-700/70 text-red-100 hover:bg-red-700/90 hover:text-white' :
        'h-8 border-red-500/60 bg-red-500/30 text-red-200 hover:bg-red-500/45 hover:text-red-50'
        }>

        {pendingDeleteId === item.id ?
        t('scenarios.deleteArmedLabel') :
        t('common.delete')}
      </Button>
    </Tooltip>
  );

  if (view === 'list') {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {howToGetButton}
        {favoriteButton}
        {editButton}
        {duplicateButton}
        {historyButton}
        {openFolderButton}
        {copyPathButton}
        {deleteButton}
      </div>);

  }

  return (
    <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end sm:flex-nowrap flex-shrink-0">
      {howToGetButton}
      {favoriteButton}
      {editButton}
      {deleteButton}
      {duplicateButton}
      {historyButton}
      {openFolderButton}
      {copyPathButton}
    </div>);

}
