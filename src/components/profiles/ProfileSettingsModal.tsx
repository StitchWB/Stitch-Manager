import {
  X,
  Wand2,
  CopyPlus,
  Trash2,
  RotateCcw,
  Download,
  FileUp } from
'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useProfileSettingsModal } from '@/hooks/useProfileSettingsModal';
import {
  ProfileMainTab,
  ProfileProxyTab,
  ProfileGeoTab,
  ProfileDataTab,
  ProfileImportModal,
  ProfileAddProxyModal } from
'./profile-settings';
import { Button, ConfirmActionButton, IconButton, Input, TabButton } from '@/components/ui';
import { formatProfileAlias } from '@/lib/profiles/displayName';
import { t } from '@/lib/i18n';

interface ProfileSettingsModalProps {
  alias: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export function ProfileSettingsModal({
  alias,
  isOpen,
  onClose,
  onSaved
}: ProfileSettingsModalProps) {
  const vm = useProfileSettingsModal({ alias, isOpen, onClose, onSaved });

  // Two-step close (no modals): with unsaved changes the first click arms the
  // close affordances red for 3s, the second click discards and closes.
  const [closeArmed, setCloseArmed] = useState(false);
  const closeArmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (closeArmTimerRef.current) clearTimeout(closeArmTimerRef.current);
    };
  }, []);

  const disarmCloseArm = () => {
    if (closeArmTimerRef.current) {
      clearTimeout(closeArmTimerRef.current);
      closeArmTimerRef.current = null;
    }
    setCloseArmed(false);
  };

  const requestClose = () => {
    if (vm.saving || vm.duplicating || vm.deleting || vm.exportingBundle || vm.importingBundle) return;
    if (!vm.dirty) {
      onClose();
      return;
    }
    if (closeArmed) {
      disarmCloseArm();
      onClose();
      return;
    }
    if (closeArmTimerRef.current) clearTimeout(closeArmTimerRef.current);
    closeArmTimerRef.current = setTimeout(disarmCloseArm, 3000);
    setCloseArmed(true);
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-[70]">
        <div aria-label="Close profile settings backdrop" className="absolute inset-0 bg-black/70" onClick={requestClose} role="presentation" />

        <aside className="absolute right-0 top-0 h-full w-full max-w-[560px] border-l border-white/10 bg-vsc-panel-solid shadow-2xl flex flex-col">
          <header className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs text-slate-400">{t('accounts.profileAlias') || 'Profile'}</div>
              <div className="text-base font-semibold text-slate-100 truncate">{formatProfileAlias(vm.aliasDraft || alias)}</div>
              {vm.aliasDraft && formatProfileAlias(vm.aliasDraft) !== vm.aliasDraft ?
              <div className="mt-0.5 text-[11px] text-slate-500 truncate font-mono">{vm.aliasDraft}</div> :
              null}
              <div className="mt-1 text-xs text-slate-500 truncate">{[
                `${t("profiles.profile_settings_modal.proxy")}: ${vm.summary.proxyState}`,
                `${t("profiles.profile_settings_modal.locale")}: ${vm.summary.locale}`,
                `${t("profiles.profile_settings_modal.timezone")}: ${vm.summary.timezone}`,
                `${t("profiles.profile_settings_modal.window")}: ${vm.summary.windowSizeHint}`
              ].join(' · ')}</div>
            </div>
            <IconButton
              onClick={requestClose}
              disabled={vm.saving || vm.duplicating || vm.deleting || vm.exportingBundle || vm.importingBundle}
              size="sm"
              variant="ghost"
              className="p-2 rounded-md text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-50"
              aria-label="Close profile settings">
              <X size={20} />
            </IconButton>
          </header>

          <div className="px-5 py-3 border-b border-white/10">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <Input label={t('accounts.profileAlias') || 'Profile alias'} value={vm.aliasDraft} onChange={(e) => vm.handleAliasChange(e.target.value)} placeholder={t('accounts.profileSettingsAliasPlaceholder') || 'standalone.profile...@local.profile'} error={vm.aliasValidationError || undefined} rightElement={
                <Button type="button" size="xs" variant="secondary" leftIcon={<Wand2 size={12} />} onClick={vm.handleMakeAliasSafe} disabled={vm.loading || vm.saving || !vm.aliasDraft.trim()} title={t('accounts.profileSettingsAliasMakeSafeTooltip') || 'Replace invalid characters and avoid conflicts'}>
                    {t('accounts.profileSettingsAliasMakeSafe') || 'Make safe'}
                  </Button>
                } />
              </div>
              <Button className="shrink-0" size="sm" variant="secondary" leftIcon={<CopyPlus size={14} />} onClick={() => void vm.handleDuplicateProfile()} disabled={vm.loading || vm.saving || vm.duplicating || vm.deleting || vm.exportingBundle || vm.importingBundle || Boolean(vm.aliasValidationError)} isLoading={vm.duplicating}>{t("profiles.profile_settings_modal.duplicate") || 'Duplicate'}</Button>
              <ConfirmActionButton className="shrink-0" size="sm" variant="danger" leftIcon={<Trash2 size={14} />} armedLabel={t('common.sure') || 'Sure?'} onConfirm={() => void vm.handleDeleteProfile()} disabled={vm.loading || vm.saving || vm.duplicating || vm.deleting} isLoading={vm.deleting}>{t('accounts.deleteProfile') || 'Delete'}</ConfirmActionButton>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="xs" variant="secondary" leftIcon={<Download size={12} />} onClick={() => void vm.handleExportProfile()} disabled={vm.loading || vm.saving || vm.exportingBundle} isLoading={vm.exportingBundle}>{t("profiles.profile_settings_modal.export") || 'Export'}</Button>
              <Button size="xs" variant="secondary" leftIcon={<FileUp size={12} />} onClick={() => void vm.handleImportProfile()} disabled={vm.loading || vm.saving || vm.importingBundle} isLoading={vm.importingBundle}>{t("profiles.profile_settings_modal.import") || 'Import'}</Button>
              <div className="h-4 w-px bg-white/10 mx-1" />
              <Button size="xs" variant="secondary" leftIcon={<RotateCcw size={12} />} onClick={vm.handleResetCurrentTab} disabled={vm.loading || vm.saving}>{t("profiles.profile_settings_modal.reset_tab") || 'Reset tab'}</Button>
              <ConfirmActionButton size="xs" variant="secondary" onConfirm={vm.handleResetAllToDefaults} disabled={vm.loading || vm.saving}>{t("profiles.profile_settings_modal.reset_all") || 'Reset all'}</ConfirmActionButton>
            </div>
          </div>

          <div className="px-5 py-3 border-b border-white/10 grid grid-cols-4 gap-2">
            <TabButton active={vm.activeTab === 'main'} onClick={() => vm.setActiveTab('main')} label={t("profiles.profile_settings_modal.tab_main") || 'Main'} className="h-9 w-full" />
            <TabButton active={vm.activeTab === 'proxy'} onClick={() => vm.setActiveTab('proxy')} label={t("profiles.profile_settings_modal.tab_proxy") || 'Proxy'} className="h-9 w-full" />
            <TabButton active={vm.activeTab === 'geo'} onClick={() => vm.setActiveTab('geo')} label={t("profiles.profile_settings_modal.tab_geo") || 'Geo'} className="h-9 w-full" />
            <TabButton active={vm.activeTab === 'data'} onClick={() => vm.setActiveTab('data')} label={t("profiles.profile_settings_modal.tab_data") || 'Data'} className="h-9 w-full" />
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {vm.loading ? <div className="text-sm text-slate-400">{t('common.loading') || 'Loading...'}</div> : null}
            {vm.error ? <div className="text-xs text-red-300 border border-red-500/20 bg-red-500/10 rounded-lg px-3 py-2">{vm.error}</div> : null}

            {!vm.loading && vm.activeTab === 'main' &&
            <ProfileMainTab draft={vm.draft} browserWindowMode={vm.browserWindowMode} browserWindowWidth={vm.browserWindowWidth} browserWindowHeight={vm.browserWindowHeight} browserWindowMaximize={vm.browserWindowMaximize} summaryWindowSizeHint={vm.summary.windowSizeHint} summaryMaximizeOnStart={vm.summary.maximizeOnStart} onPatchBrowserWindow={vm.patchBrowserWindow} onUpdate={vm.update} onClearMain={vm.handleClearMain} onResetMainToDefaults={vm.handleResetMainToDefaults} onCopyPath={vm.handleCopyPath} onOpenPath={vm.handleOpenPath} />
            }
            {!vm.loading && vm.activeTab === 'proxy' &&
            <ProfileProxyTab proxyEnabled={vm.proxyEnabled} proxyMode={vm.proxyMode} proxyLibraryId={vm.proxyLibraryId} proxyLibrary={vm.proxyLibrary} proxyLibraryLoading={vm.proxyLibraryLoading} selectedLibraryProxy={vm.selectedLibraryProxy} selectedProxyTesting={vm.selectedProxyTesting} selectedProxyTestResult={vm.selectedProxyTestResult} selectedProxyTestError={vm.selectedProxyTestError} saving={vm.saving} onPatchProxy={vm.patchProxy} onTestSelectedProxy={vm.handleTestSelectedProxy} onOpenAddProxyModal={vm.openAddProxyModal} />
            }
            {!vm.loading && vm.activeTab === 'geo' &&
            <ProfileGeoTab draft={vm.draft} showAdvanced={vm.showAdvanced} hasManualGeo={vm.hasManualGeo} localeManual={vm.localeManual} timezoneManual={vm.timezoneManual} onUpdate={vm.update} onClearGeo={vm.handleClearGeo} onToggleAdvanced={() => vm.setShowAdvanced((v) => !v)} />
            }
            {!vm.loading && vm.activeTab === 'data' &&
            <ProfileDataTab draft={vm.draft} showCookieEditor={vm.showCookieEditor} cookiesHint={vm.summary.cookiesHint} onUpdate={vm.update} onToggleCookieEditor={() => vm.setShowCookieEditor((v) => !v)} onPickCookieFile={vm.handlePickCookieFile} onClearData={vm.handleClearData} />
            }
          </div>

          <footer className="sticky bottom-0 border-t border-white/10 px-5 py-4 flex items-center justify-between gap-3 bg-vsc-panel-solid">
            <div className="text-xs text-slate-400">{vm.dirty ? t('profiles.profile_settings_modal.unsaved_changes') || 'Unsaved changes' : t('profiles.profile_settings_modal.no_changes') || 'No changes'}</div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={requestClose}
                disabled={vm.saving || vm.duplicating || vm.deleting || vm.exportingBundle || vm.importingBundle}
                className={closeArmed ? 'bg-red-500/30 border-red-500/70 text-red-100 hover:bg-red-500/40 hover:border-red-400 hover:text-white' : undefined}>
                {closeArmed ? t('accounts.profileSettingsDiscardConfirm') || 'Discard' : t('common.close') || 'Close'}
              </Button>
              <Button variant="primary" onClick={() => void vm.handleSave()} disabled={!vm.dirty || vm.saving || vm.duplicating || vm.deleting || vm.exportingBundle || vm.importingBundle || Boolean(vm.aliasValidationError)} isLoading={vm.saving}>
                {vm.saving ? t('common.loading') || 'Saving...' : t('common.save') || 'Save'}
              </Button>
            </div>
          </footer>
        </aside>
      </div>

      <ProfileImportModal isOpen={vm.importConfigOpen} isLoading={vm.importingBundle} sourcePath={vm.importSourcePath} targetMode={vm.importTargetMode} onTargetModeChange={vm.setImportTargetMode} targetAliasDraft={vm.importTargetAliasDraft} onTargetAliasDraftChange={vm.setImportTargetAliasDraft} targetAliasError={vm.importNewAliasError} overwrite={vm.importOverwrite} onOverwriteChange={vm.setImportOverwrite} onMakeAliasSafe={vm.handleMakeImportAliasSafe} onConfirm={vm.handleConfirmImportProfile} onCancel={vm.resetImportWorkflow} />

      <ProfileAddProxyModal isOpen={vm.addProxyModalOpen} isSaving={vm.addProxySaving} input={vm.addProxyInput} onInputChange={vm.setAddProxyInput} isParsing={vm.addProxyParsing} onParse={vm.handleParseAddProxyInput} draft={vm.addProxyDraft} onDraftChange={vm.setAddProxyDraft} isParsed={vm.addProxyParsed} isTesting={vm.addProxyTesting} onTest={vm.handleTestAddProxyDraft} testResult={vm.addProxyTestResult} requireTestBeforeSave={vm.requireProxyTestBeforeSave} onRequireTestBeforeSaveChange={vm.setRequireProxyTestBeforeSave} error={vm.addProxyError} onSave={vm.handleSaveAndUseAddProxy} onClose={() => vm.setAddProxyModalOpen(false)} />
    </>);

}