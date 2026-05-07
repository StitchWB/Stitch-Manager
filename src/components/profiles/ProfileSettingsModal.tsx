import {
  X,
  Wand2,
  CopyPlus,
  Trash2,
  RotateCcw,
  Download,
  FileUp,
} from 'lucide-react';
import { useProfileSettingsModal } from '@/hooks/useProfileSettingsModal';
import {
  ProfileMainTab,
  ProfileProxyTab,
  ProfileGeoTab,
  ProfileDataTab,
  ProfileImportModal,
  ProfileAddProxyModal,
} from './profile-settings';
import { Button, ConfirmDialog, Input, TabButton } from '@/components/ui';
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
  onSaved,
}: ProfileSettingsModalProps) {
  const vm = useProfileSettingsModal({ alias, isOpen, onClose, onSaved });

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50">
        <button type="button" aria-label="Close profile settings backdrop" className="absolute inset-0 bg-black/60" onClick={vm.requestClose} />

        <aside className="absolute right-0 top-0 h-full w-full max-w-[560px] border-l border-white/10 bg-ds-surface-elevated shadow-2xl flex flex-col">
          <header className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs text-slate-400">{t('accounts.profileAlias') || 'Profile'}</div>
              <div className="text-base font-semibold text-slate-100 truncate">{formatProfileAlias(vm.aliasDraft || alias)}</div>
              {vm.aliasDraft && formatProfileAlias(vm.aliasDraft) !== vm.aliasDraft ? (
                <div className="mt-0.5 text-[11px] text-slate-500 truncate font-mono">{vm.aliasDraft}</div>
              ) : null}
              <div className="mt-1 text-xs text-slate-500">Proxy: {vm.summary.proxyState} • Locale: {vm.summary.locale} • Timezone: {vm.summary.timezone} • Window: {vm.summary.windowSizeHint}</div>
            </div>
            <button type="button" onClick={vm.requestClose} disabled={vm.saving || vm.duplicating || vm.deleting || vm.exportingBundle || vm.importingBundle} className="p-2 rounded-md text-slate-400 hover:text-slate-100 hover:bg-white/10 disabled:opacity-50" aria-label="Close profile settings">
              <X size={18} />
            </button>
          </header>

          <div className="px-5 py-3 border-b border-white/10">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input label={t('accounts.profileAlias') || 'Profile alias'} value={vm.aliasDraft} onChange={e => vm.handleAliasChange(e.target.value)} placeholder={t('accounts.profileSettingsAliasPlaceholder') || 'standalone.profile...@local.profile'} error={vm.aliasValidationError || undefined} rightElement={
                <Button type="button" size="xs" variant="secondary" leftIcon={<Wand2 size={12} />} onClick={vm.handleMakeAliasSafe} disabled={vm.loading || vm.saving || !vm.aliasDraft.trim()} title={t('accounts.profileSettingsAliasMakeSafeTooltip') || 'Replace invalid characters and avoid conflicts'}>
                  {t('accounts.profileSettingsAliasMakeSafe') || 'Make safe'}
                </Button>
              } />
              <div className="flex items-end justify-start md:justify-end gap-2">
                <Button size="sm" variant="secondary" leftIcon={<CopyPlus size={14} />} onClick={() => void vm.handleDuplicateProfile()} disabled={vm.loading || vm.saving || vm.duplicating || vm.deleting || vm.exportingBundle || vm.importingBundle || Boolean(vm.aliasValidationError)} isLoading={vm.duplicating}>Duplicate</Button>
                <Button size="sm" variant="danger" leftIcon={<Trash2 size={14} />} onClick={() => vm.setDeleteConfirmOpen(true)} disabled={vm.loading || vm.saving || vm.duplicating || vm.deleting}>{t('accounts.deleteProfile') || 'Delete'}</Button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="xs" variant="secondary" leftIcon={<Download size={12} />} onClick={() => void vm.handleExportProfile()} disabled={vm.loading || vm.saving || vm.exportingBundle} isLoading={vm.exportingBundle}>Export</Button>
              <Button size="xs" variant="secondary" leftIcon={<FileUp size={12} />} onClick={() => void vm.handleImportProfile()} disabled={vm.loading || vm.saving || vm.importingBundle} isLoading={vm.importingBundle}>Import</Button>
              <div className="h-4 w-px bg-white/10 mx-1" />
              <Button size="xs" variant="secondary" leftIcon={<RotateCcw size={12} />} onClick={vm.handleResetCurrentTab} disabled={vm.loading || vm.saving}>Reset tab</Button>
              <Button size="xs" variant="secondary" onClick={() => vm.setResetAllConfirmOpen(true)} disabled={vm.loading || vm.saving}>Reset all</Button>
            </div>
          </div>

          <div className="px-5 py-3 border-b border-white/10 flex flex-wrap gap-2">
            <TabButton active={vm.activeTab === 'main'} onClick={() => vm.setActiveTab('main')} label="Main" className="h-9 px-5" />
            <TabButton active={vm.activeTab === 'proxy'} onClick={() => vm.setActiveTab('proxy')} label="Proxy" className="h-9 px-5" />
            <TabButton active={vm.activeTab === 'geo'} onClick={() => vm.setActiveTab('geo')} label="Geo" className="h-9 px-5" />
            <TabButton active={vm.activeTab === 'data'} onClick={() => vm.setActiveTab('data')} label="Data" className="h-9 px-5" />
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {vm.loading ? <div className="text-sm text-slate-400">{t('common.loading') || 'Loading...'}</div> : null}
            {vm.error ? <div className="text-xs text-red-300 border border-red-500/20 bg-red-500/10 rounded-lg px-3 py-2">{vm.error}</div> : null}

            {!vm.loading && vm.activeTab === 'main' && (
              <ProfileMainTab draft={vm.draft} browserWindowMode={vm.browserWindowMode} browserWindowWidth={vm.browserWindowWidth} browserWindowHeight={vm.browserWindowHeight} browserWindowMaximize={vm.browserWindowMaximize} summaryWindowSizeHint={vm.summary.windowSizeHint} summaryMaximizeOnStart={vm.summary.maximizeOnStart} onPatchBrowserWindow={vm.patchBrowserWindow} onUpdate={vm.update} onClearMain={vm.handleClearMain} onResetMainToDefaults={vm.handleResetMainToDefaults} onCopyPath={vm.handleCopyPath} onOpenPath={vm.handleOpenPath} />
            )}
            {!vm.loading && vm.activeTab === 'proxy' && (
              <ProfileProxyTab proxyEnabled={vm.proxyEnabled} proxyMode={vm.proxyMode} proxyLibraryId={vm.proxyLibraryId} proxyLibrary={vm.proxyLibrary} proxyLibraryLoading={vm.proxyLibraryLoading} selectedLibraryProxy={vm.selectedLibraryProxy} selectedProxyTesting={vm.selectedProxyTesting} selectedProxyTestResult={vm.selectedProxyTestResult} selectedProxyTestError={vm.selectedProxyTestError} saving={vm.saving} onPatchProxy={vm.patchProxy} onTestSelectedProxy={vm.handleTestSelectedProxy} onOpenAddProxyModal={vm.openAddProxyModal} />
            )}
            {!vm.loading && vm.activeTab === 'geo' && (
              <ProfileGeoTab draft={vm.draft} showAdvanced={vm.showAdvanced} hasManualGeo={vm.hasManualGeo} localeManual={vm.localeManual} timezoneManual={vm.timezoneManual} onUpdate={vm.update} onClearGeo={vm.handleClearGeo} onToggleAdvanced={() => vm.setShowAdvanced(v => !v)} />
            )}
            {!vm.loading && vm.activeTab === 'data' && (
              <ProfileDataTab draft={vm.draft} showCookieEditor={vm.showCookieEditor} cookiesHint={vm.summary.cookiesHint} onUpdate={vm.update} onToggleCookieEditor={() => vm.setShowCookieEditor(v => !v)} onPickCookieFile={vm.handlePickCookieFile} onClearData={vm.handleClearData} />
            )}
          </div>

          <footer className="sticky bottom-0 border-t border-white/10 px-5 py-4 flex items-center justify-between gap-3 bg-ds-surface-elevated">
            <div className="text-xs text-slate-400">{vm.dirty ? 'Unsaved changes' : 'No changes'}</div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={vm.requestClose} disabled={vm.saving || vm.duplicating || vm.deleting || vm.exportingBundle || vm.importingBundle}>{t('common.close') || 'Close'}</Button>
              <Button variant="primary" onClick={() => void vm.handleSave()} disabled={!vm.dirty || vm.saving || vm.duplicating || vm.deleting || vm.exportingBundle || vm.importingBundle || Boolean(vm.aliasValidationError)} isLoading={vm.saving}>
                {vm.saving ? t('common.loading') || 'Saving...' : t('common.save') || 'Save'}
              </Button>
            </div>
          </footer>
        </aside>
      </div>

      <ConfirmDialog isOpen={vm.closeConfirmOpen} onClose={() => vm.setCloseConfirmOpen(false)} onConfirm={() => { vm.setCloseConfirmOpen(false); onClose(); }} title={t('accounts.profileSettingsDiscardTitle') || 'Discard changes?'} message={t('accounts.profileSettingsDiscardMessage') || 'You have unsaved changes. Close without saving?'} confirmText={t('accounts.profileSettingsDiscardConfirm') || 'Discard'} cancelText={t('common.cancel') || 'Cancel'} variant="warning" />

      <ConfirmDialog isOpen={vm.deleteConfirmOpen} onClose={() => { if (!vm.deleting) vm.setDeleteConfirmOpen(false); }} onConfirm={() => void vm.handleDeleteProfile()} title={t('accounts.deleteProfile') || 'Delete profile'} message={t('accounts.profileSettingsDeleteConfirmMessage', { alias: vm.currentAlias || vm.aliasDraft }) || `Delete profile ${vm.currentAlias || vm.aliasDraft}?`} confirmText={t('common.delete') || 'Delete'} cancelText={t('common.cancel') || 'Cancel'} variant="danger" isLoading={vm.deleting} />

      <ConfirmDialog isOpen={vm.resetAllConfirmOpen} onClose={() => vm.setResetAllConfirmOpen(false)} onConfirm={vm.handleResetAllToDefaults} title={t('accounts.profileSettingsResetAllTitle') || 'Reset all settings?'} message={t('accounts.profileSettingsResetAllMessage') || 'This will reset Main, Proxy, Geo and Data values to defaults in the editor.'} confirmText={t('accounts.profileSettingsResetAllConfirm') || 'Reset all'} cancelText={t('common.cancel') || 'Cancel'} variant="warning" />

      <ProfileImportModal isOpen={vm.importConfigOpen} isLoading={vm.importingBundle} sourcePath={vm.importSourcePath} targetMode={vm.importTargetMode} onTargetModeChange={vm.setImportTargetMode} targetAliasDraft={vm.importTargetAliasDraft} onTargetAliasDraftChange={vm.setImportTargetAliasDraft} targetAliasError={vm.importNewAliasError} overwrite={vm.importOverwrite} onOverwriteChange={vm.setImportOverwrite} onMakeAliasSafe={vm.handleMakeImportAliasSafe} onConfirm={vm.handleConfirmImportProfile} onCancel={vm.resetImportWorkflow} />

      <ProfileAddProxyModal isOpen={vm.addProxyModalOpen} isSaving={vm.addProxySaving} input={vm.addProxyInput} onInputChange={vm.setAddProxyInput} isParsing={vm.addProxyParsing} onParse={vm.handleParseAddProxyInput} draft={vm.addProxyDraft} onDraftChange={vm.setAddProxyDraft} isParsed={vm.addProxyParsed} isTesting={vm.addProxyTesting} onTest={vm.handleTestAddProxyDraft} testResult={vm.addProxyTestResult} requireTestBeforeSave={vm.requireProxyTestBeforeSave} onRequireTestBeforeSaveChange={vm.setRequireProxyTestBeforeSave} error={vm.addProxyError} onSave={vm.handleSaveAndUseAddProxy} onClose={() => vm.setAddProxyModalOpen(false)} />
    </>
  );
}
