import { useMemo } from 'react';
import { Chrome, FolderOpen, Link2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button, SectionHeader } from '@/components/ui';
import { t } from '@/lib/i18n';
import { copyToClipboard, openInBrowser, openInFileManager } from '@/lib/backend/modules/utils';
import { useExtensionBridgeProbe } from '@/lib/scenarioRecorder/useExtensionBridgeProbe';

export function ExtensionSettingsSection() {
  const bridge = useExtensionBridgeProbe({
    isOpen: true,
    runnerMode: 'extension',
  });

  const extensionRelativePath = 'extension/stitch-scenario-runner/dist';
  const extensionPathForUi = useMemo(() => extensionRelativePath, []);

  const bridgeStatusText = bridge.state.checking
    ? t('recorder.extensionBridgeChecking')
    : bridge.state.connected
      ? t('recorder.extensionBridgeConnected')
      : t('recorder.extensionBridgeDisconnected');

  const lastCheckedText = bridge.state.lastCheckedAt
    ? new Date(bridge.state.lastCheckedAt).toLocaleTimeString()
    : '—';

  const openExtensionsPage = async () => {
    try {
      await openInBrowser({ url: 'chrome://extensions' });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const openExtensionFolder = async () => {
    try {
      await openInFileManager({ path: extensionRelativePath });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const copyExtensionPath = async () => {
    try {
      await copyToClipboard({ text: extensionPathForUi });
      toast.success(t('notifications.copied'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <SectionHeader
      title={t('settings.extension.title')}
      description={t('settings.extension.description')}
      icon={<Chrome className="w-4 h-4 text-cyan-400" />}
      className="pt-2"
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-4 space-y-3">
          <div className="text-xs text-cyan-100">{t('settings.extension.installTitle')}</div>
          <ol className="list-decimal pl-4 space-y-1 text-xs text-slate-200/95">
            <li>{t('settings.extension.installStep1')}</li>
            <li>{t('settings.extension.installStep2')}</li>
            <li>{t('settings.extension.installStep3')}</li>
            <li>{t('settings.extension.installStep4')}</li>
          </ol>

          <div className="rounded-md border border-white/10 bg-black/20 p-3">
            <div className="text-[11px] text-slate-400 mb-1">
              {t('settings.extension.extensionPath')}
            </div>
            <div className="text-xs text-slate-200 font-mono break-all">
              {extensionPathForUi}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              {t('settings.extension.pathHint')}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void openExtensionsPage()}
              leftIcon={<Link2 className="w-3.5 h-3.5" />}
            >
              {t('settings.extension.openChromeExtensions')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void openExtensionFolder()}
              leftIcon={<FolderOpen className="w-3.5 h-3.5" />}
            >
              {t('settings.extension.openExtensionFolder')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void copyExtensionPath()}>
              {t('settings.extension.copyPath')}
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-black/20 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs text-slate-400">
                {t('recorder.extensionBridgeStatusLabel')}
              </div>
              <div
                className={`text-sm ${
                  bridge.state.connected
                    ? 'text-emerald-300'
                    : bridge.state.checking
                      ? 'text-cyan-200'
                      : 'text-amber-300'
                }`}
              >
                {bridgeStatusText}
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void bridge.refresh()}
              disabled={bridge.state.checking}
              leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            >
              {t('recorder.extensionBridgeRefresh')}
            </Button>
          </div>

          {bridge.state.error ? (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {bridge.state.error}
            </div>
          ) : null}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-400">
            <div>
              {t('settings.extension.lastPingLabel')}:{' '}
              <span className="text-slate-200">{lastCheckedText}</span>
            </div>
            <div>
              {t('settings.extension.latencyLabel')}:{' '}
              <span className="text-slate-200">
                {typeof bridge.state.latencyMs === 'number' ? `${bridge.state.latencyMs} ms` : '—'}
              </span>
            </div>
          </div>

          <div className="text-[11px] text-slate-500">{t('settings.extension.bridgeHint')}</div>

          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              const checklist = [
                t('settings.extension.installTitle'),
                `1. ${t('settings.extension.installStep1')}`,
                `2. ${t('settings.extension.installStep2')}`,
                `3. ${t('settings.extension.installStep3')}`,
                `4. ${t('settings.extension.installStep4')}`,
                `${t('settings.extension.extensionPath')}: ${extensionPathForUi}`,
              ].join('\n');

              try {
                await copyToClipboard({ text: checklist });
                toast.success(t('settings.extension.checklistCopied'));
              } catch (e) {
                toast.error(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            {t('settings.extension.copyChecklist')}
          </Button>
        </div>
      </div>
    </SectionHeader>
  );
}
