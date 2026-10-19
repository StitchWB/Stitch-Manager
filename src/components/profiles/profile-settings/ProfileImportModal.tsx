import { Wand2 } from 'lucide-react';
import { Button, Input, Modal, Select, Toggle } from '@/components/ui';
import { t } from '@/lib/i18n';

interface ProfileImportModalProps {
  isOpen: boolean;
  isLoading: boolean;
  sourcePath: string | null;
  targetMode: 'current' | 'new';
  onTargetModeChange: (mode: 'current' | 'new') => void;
  targetAliasDraft: string;
  onTargetAliasDraftChange: (value: string) => void;
  targetAliasError: string | null;
  overwrite: boolean;
  onOverwriteChange: (value: boolean) => void;
  onMakeAliasSafe: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ProfileImportModal({
  isOpen,
  isLoading,
  sourcePath,
  targetMode,
  onTargetModeChange,
  targetAliasDraft,
  onTargetAliasDraftChange,
  targetAliasError,
  overwrite,
  onOverwriteChange,
  onMakeAliasSafe,
  onConfirm,
  onCancel,
}: ProfileImportModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={() => { if (isLoading) return; onCancel(); }} title={t('accounts.profileSettingsImportDialogTitle') || 'Import profile bundle'} size="md">
      <div className="space-y-3">
        <Input label={t('accounts.profileSettingsImportFileLabel') || 'Selected file'} value={sourcePath ?? ''} readOnly />
        <Select label={t('accounts.profileSettingsImportTargetLabel') || 'Import target'} value={targetMode} onValueChange={value => onTargetModeChange(value === 'new' ? 'new' : 'current')} disabled={isLoading}>
          <option value="current">{t('accounts.profileSettingsImportTargetCurrent') || 'Current profile'}</option>
          <option value="new">{t('accounts.profileSettingsImportTargetNew') || 'New alias'}</option>
        </Select>
        {targetMode === 'new' ? (
          <Input label={t('accounts.profileSettingsImportNewAliasLabel') || 'Target alias'} value={targetAliasDraft} onChange={e => onTargetAliasDraftChange(e.target.value)} error={targetAliasError || undefined} placeholder={t('accounts.profileSettingsAliasPlaceholder') || 'standalone.profile...@local.profile'} rightElement={
            <Button type="button" size="xs" variant="secondary" leftIcon={<Wand2 size={12} />} onClick={onMakeAliasSafe} disabled={isLoading || !targetAliasDraft.trim()} title={t('accounts.profileSettingsAliasMakeSafeTooltip') || 'Replace invalid characters and avoid conflicts'}>
              {t('accounts.profileSettingsAliasMakeSafe') || 'Make safe'}
            </Button>
          } />
        ) : null}
        <div className="flex items-center justify-between gap-3 rounded border border-white/10 bg-white/[0.02] px-3 py-2">
          <div className="text-xs text-slate-300">{t('accounts.profileSettingsImportOverwriteLabel') || 'Overwrite target profile'}</div>
          <Toggle label={t('accounts.profileSettingsImportOverwriteLabel') || 'Overwrite target profile'} checked={overwrite} onChange={checked => onOverwriteChange(checked)} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={isLoading}>{t('common.cancel') || 'Cancel'}</Button>
          <Button variant="primary" onClick={() => void onConfirm()} disabled={!sourcePath || isLoading || (targetMode === 'new' && !!targetAliasError)} isLoading={isLoading}>
            {t('accounts.profileSettingsImportConfirm') || 'Import'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
