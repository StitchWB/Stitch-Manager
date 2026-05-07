import { Button, Input, Modal, Select, Toggle } from '@/components/ui';
import { t } from '@/lib/i18n';
import { type ProxyLibraryDraft } from '@/lib/tauri/modules/proxyLibrary';

interface ProfileAddProxyModalProps {
  isOpen: boolean;
  isSaving: boolean;
  input: string;
  onInputChange: (value: string) => void;
  isParsing: boolean;
  onParse: () => void;
  draft: ProxyLibraryDraft | null;
  onDraftChange: React.Dispatch<React.SetStateAction<ProxyLibraryDraft | null>>;
  isParsed: boolean;
  isTesting: boolean;
  onTest: () => void;
  testResult: string | null;
  requireTestBeforeSave: boolean;
  onRequireTestBeforeSaveChange: (value: boolean) => void;
  error: string | null;
  onSave: () => void;
  onClose: () => void;
}

export function ProfileAddProxyModal({
  isOpen,
  isSaving,
  input,
  onInputChange,
  isParsing,
  onParse,
  draft,
  onDraftChange,
  isParsed,
  isTesting,
  onTest,
  testResult,
  requireTestBeforeSave,
  onRequireTestBeforeSaveChange,
  error,
  onSave,
  onClose,
}: ProfileAddProxyModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={() => { if (isSaving) return; onClose(); }} title={t('profileProxy.addProxyModalTitle')} size="md">
      <div className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
          <Input label={t('profileProxy.addProxyInputLabel')} value={input} onChange={e => onInputChange(e.target.value)} placeholder={t('profileProxy.addProxyInputPlaceholder')} />
          <div className="flex items-end">
            <Button variant="secondary" onClick={() => void onParse()} disabled={isParsing || !input.trim()}>
              {isParsing ? t('profileProxy.addProxyParsing') : t('profileProxy.addProxyParse')}
            </Button>
          </div>
        </div>

        {draft ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input label={t('proxyLibrary.label')} value={draft.label ?? ''} onChange={e => onDraftChange(prev => prev ? { ...prev, label: e.target.value } : prev)} />
              <Select label={t('proxyLibrary.type')} value={draft.proxyType} disabled={isParsed} onValueChange={value => onDraftChange(prev => prev ? { ...prev, proxyType: value as ProxyLibraryDraft['proxyType'] } : prev)}>
                <option value="http">HTTP</option>
                <option value="socks5">SOCKS5</option>
              </Select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input label={t('proxyLibrary.host')} value={draft.host} disabled={isParsed} onChange={e => onDraftChange(prev => prev ? { ...prev, host: e.target.value } : prev)} />
              <Input label={t('proxyLibrary.port')} type="number" value={String(draft.port)} disabled={isParsed} onChange={e => onDraftChange(prev => prev ? { ...prev, port: Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : 0 } : prev)} />
            </div>
            {isParsed ? <div className="text-xs text-slate-400">{t('profileProxy.addProxyLockHint')}</div> : null}
            <div className="flex items-center justify-between gap-3 rounded border border-white/10 bg-white/[0.02] px-3 py-2">
              <div className="text-xs text-slate-300">{t('profileProxy.addProxyTestRequiredLabel')}</div>
              <Toggle label={t('profileProxy.addProxyTestRequiredLabel')} checked={requireTestBeforeSave} onChange={checked => onRequireTestBeforeSaveChange(checked)} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input label={t('proxyLibrary.username')} value={draft.username ?? ''} onChange={e => onDraftChange(prev => prev ? { ...prev, username: e.target.value } : prev)} />
              <Input label={t('proxyLibrary.password')} type="password" value={draft.password ?? ''} onChange={e => onDraftChange(prev => prev ? { ...prev, password: e.target.value } : prev)} />
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => void onTest()} disabled={isTesting}>
                {isTesting ? t('profileProxy.addProxyTesting') : t('profileProxy.addProxyTest')}
              </Button>
              {testResult ? <div className="text-xs text-slate-300">{testResult}</div> : null}
            </div>
          </>
        ) : null}

        {error ? <div className="text-xs text-red-300 border border-red-500/20 bg-red-500/10 rounded-lg px-3 py-2">{error}</div> : null}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={() => void onSave()} disabled={!draft || isSaving}>
            {isSaving ? t('common.loading') : t('profileProxy.addProxySaveUse')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
