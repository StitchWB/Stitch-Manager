import {
  Modal,
  Button,
  Input,
  Textarea,
  Select } from
'@/components/ui';
import type { ScenarioRecordItem, ScenarioRevisionItem } from '@/lib/backend/modules/pythonJobs';
import { t } from '@/lib/i18n';
import { formatDateTime as formatDateTimeBase } from '@/lib/utils';

type ScenarioDialogsProps = {
  editOpen: boolean;
  editSaving: boolean;
  editName: string;
  editDescription: string;
  editTagsText: string;
  editTier: string;
  isAdmin: boolean;
  onEditClose: () => void;
  onEditCancel: () => void;
  onEditNameChange: (value: string) => void;
  onEditDescriptionChange: (value: string) => void;
  onEditTagsTextChange: (value: string) => void;
  onEditTierChange: (value: string) => void;
  onEditSave: () => void;
  historyOpen: boolean;
  historyItem: ScenarioRecordItem | null;
  historyLoading: boolean;
  historyError: string | null;
  revisions: ScenarioRevisionItem[];
  rollbackLoading: boolean;
  onHistoryClose: () => void;
  onRollback: (versionNo: number) => void;
  howToGetItem: ScenarioRecordItem | null;
  onHowToGetClose: () => void;
};

export function ScenarioDialogs({
  editOpen,
  editSaving,
  editName,
  editDescription,
  editTagsText,
  editTier,
  isAdmin,
  onEditClose,
  onEditCancel,
  onEditNameChange,
  onEditDescriptionChange,
  onEditTagsTextChange,
  onEditTierChange,
  onEditSave,
  historyOpen,
  historyItem,
  historyLoading,
  historyError,
  revisions,
  rollbackLoading,
  onHistoryClose,
  onRollback,
  howToGetItem,
  onHowToGetClose
}: ScenarioDialogsProps) {
  return (
    <>
      <Modal
        isOpen={editOpen}
        onClose={onEditClose}
        title={t('scenarios.editScenario')}
        size="lg"
        footer={
        <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={onEditCancel} disabled={editSaving}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={onEditSave} isLoading={editSaving}>
              {t('scenarios.update')}
            </Button>
          </div>
        }>

        <div className="space-y-3">
          <Input
            label={t('common.name')}
            value={editName}
            onChange={(e) => onEditNameChange(e.target.value)}
            placeholder="scenario" />

          <Textarea
            label={t('scenarios.description')}
            value={editDescription}
            onChange={(e) => onEditDescriptionChange(e.target.value)}
            rows={3} />

          <Input
            label={t('scenarios.tags')}
            value={editTagsText}
            onChange={(e) => onEditTagsTextChange(e.target.value)}
            placeholder={t('scenarios.tagsHint')} />

          {isAdmin ? (
          <Select
            label={t('auth.users.role')}
            value={editTier}
            onValueChange={onEditTierChange}
            options={[
              { value: 'user', label: t('auth.users.roleUser') },
              { value: 'vip', label: t('auth.users.roleVip') },
              { value: 'premium', label: t('auth.users.rolePremium') },
              { value: 'elite', label: t('auth.users.roleElite') },
              { value: 'admin', label: t('auth.users.roleAdmin') },
            ]}
          />
          ) : null}

        </div>
      </Modal>

      <Modal
        isOpen={historyOpen}
        onClose={onHistoryClose}
        title={t('common.history')}
        size="lg">

        <div className="space-y-3">
          <div className="text-sm text-slate-200 font-medium">{historyItem?.name ?? ''}</div>
          <div className="text-xs text-slate-500 break-all">{historyItem?.scenarioPath ?? ''}</div>

          {historyLoading ?
          <div className="text-xs text-slate-500">{t('common.loading')}</div> :
          historyError ?
          <div className="text-xs text-amber-300">{historyError}</div> :
          revisions.length === 0 ?
          <div className="text-xs text-slate-500">{t('common.none')}</div> :

          <div className="max-h-80 overflow-auto rounded-lg border border-white/10 bg-black/20 p-2 space-y-2">
              {revisions.map((r) =>
            <div
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">

                  <div className="min-w-0">
                    <div className="text-xs text-slate-200">
                      {t('common.versionPrefix', { version: r.versionNo })} <span className="text-slate-500">{t('common.bullet')}</span>{' '}
                      <span className="text-slate-400">
                        {formatDateTimeBase(r.createdAt)}
                      </span>
                    </div>
                    {r.reason ?
                <div className="text-[11px] text-slate-500 truncate">{r.reason}</div> :
                null}
                  </div>
                  <Button
                size="xs"
                variant="secondary"
                onClick={() => onRollback(r.versionNo)}
                isLoading={rollbackLoading}>

                    {t('common.rollback')}
                  </Button>
                </div>
            )}
            </div>
          }
        </div>
      </Modal>

      <Modal
        isOpen={howToGetItem !== null}
        onClose={onHowToGetClose}
        title={t('scenarios.howToGetTier', { tier: t(`auth.role.${howToGetItem?.min_role ?? 'user'}`) })}
        size="sm">
        <ul className="space-y-2 text-sm text-slate-300">
          <li className="flex items-start gap-2">
            <span className="text-slate-500 mt-0.5">•</span>
            <span>{t('scenarios.howToGetTierSubscribe')}</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-slate-500 mt-0.5">•</span>
            <span>{t('scenarios.howToGetTierAskAdmin')}</span>
          </li>
        </ul>
      </Modal>
    </>);

}
