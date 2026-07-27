import { useCallback, useState } from 'react';
import { Check, Copy, Download, FileJson, Gauge, Terminal, Upload, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { AiTopTabs } from '@/components/ai-proxy/AiTopTabs';
import { ConnectionsNav } from '@/components/ai-proxy/ConnectionsNav';
import { AiTransferModal } from '@/components/ai-proxy/modals/AiTransferModal';
import Header from '@/components/layout/Header';
import { Button, GlassCard, Input, PageHeader, StatusBadge } from '@/components/ui';
import { t } from '@/lib/i18n';
import { useAppStore } from '@/stores/app';
import { useAiProvidersController } from './hooks/useAiProvidersController';

const CLIENT_API_KEY = 'proxystitch-local';

interface AiIntegrationsProps {
  baseUrl?: string;
  clientApiKey?: string;
}

export function AiIntegrations({
  baseUrl: baseUrlOverride,
  clientApiKey = CLIENT_API_KEY,
}: AiIntegrationsProps) {
  const navigate = useNavigate();
  const language = useAppStore(state => state.language);
  const [copied, setCopied] = useState<'url' | 'key' | null>(null);
  const [transferMode, setTransferMode] = useState<'import' | 'export' | null>(null);
  const controller = useAiProvidersController();

  const {
    baseUrl: detectedBaseUrl,
    proxyStatus,
    authScan,
    authScanLoading,
    importPayload,
    setImportPayload,
    importValidation,
    importLoading,
    scanAuthFiles,
    handlePrepareImportFromScan,
    handleImportPayload,
    handleImportAllFromScan,
    exportFormat,
    setExportFormat,
    exportIncludeSecrets,
    setExportIncludeSecrets,
    exportPayload,
    exportLoading,
    handleGenerateExport,
    downloadText,
    buildExportFileName,
    effectiveExportIncludeSecrets,
  } = controller;

  const baseUrl = baseUrlOverride ?? detectedBaseUrl;
  const isRu = language === 'ru';
  const copy = isRu
    ? {
      workspaceTitle: 'Подключение клиентов',
      workspaceDescription:
        'Используйте эти данные в любом OpenAI-совместимом клиенте. Proxy должен быть запущен.',
      endpointTitle: 'Endpoint и ключ',
      endpointHint: 'Значения можно скопировать без ручного выделения.',
      proxySettings: 'Настройки Proxy',
      testInChat: 'Проверить в чате',
      transferTitle: 'Перенос аккаунтов',
      transferDescription:
        'Импортируйте JSON-бэкап или экспортируйте текущие аккаунты в JSON/CSV.',
      importModalDescription:
        'Вставьте JSON-бэкап аккаунтов. Данные будут проверены до импорта.',
      importAccounts: 'Импорт JSON',
      exportAccounts: 'Экспорт',
      running: 'Proxy работает',
      stopped: 'Proxy остановлен',
      copyFailed: 'Не удалось скопировать значение',
      copied: 'Скопировано',
      sensitiveConfirm: 'Скопировать значение с секретами в буфер обмена?',
    }
    : {
      workspaceTitle: 'Connect clients',
      workspaceDescription:
        'Use these values in any OpenAI-compatible client. The proxy must be running.',
      endpointTitle: 'Endpoint and key',
      endpointHint: 'Copy values without selecting them manually.',
      proxySettings: 'Proxy settings',
      testInChat: 'Test in Chat',
      transferTitle: 'Move accounts',
      transferDescription:
        'Import a JSON backup or export current accounts as JSON/CSV.',
      importModalDescription:
        'Paste an account JSON backup. The data is validated before import.',
      importAccounts: 'Import JSON',
      exportAccounts: 'Export',
      running: 'Proxy is running',
      stopped: 'Proxy is stopped',
      copyFailed: 'Could not copy the value',
      copied: 'Copied',
      sensitiveConfirm: 'Copy a value containing secrets to the clipboard?',
    };

  const handleCopy = useCallback(
    async (
      label: string,
      value: string,
      requireConfirm = false,
      kind?: 'url' | 'key'
    ) => {
      if (!value) return;
      if (requireConfirm && !window.confirm(copy.sensitiveConfirm)) return;

      try {
        await navigator.clipboard.writeText(value);
        if (kind) {
          setCopied(kind);
          window.setTimeout(() => setCopied(current => (current === kind ? null : current)), 2000);
        }
        toast.success(`${copy.copied}: ${label}`);
      } catch (error) {
        console.error('[AiIntegrations] Copy failed:', error);
        toast.error(copy.copyFailed);
      }
    },
    [copy.copied, copy.copyFailed, copy.sensitiveConfirm]
  );

  const running = Boolean(proxyStatus?.running);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-void-base">
      <Header title={t('sidebar.aiHub')} icon={<Zap size={18} />} />
      <AiTopTabs />
      <ConnectionsNav />
      <PageHeader
        eyebrow={t('sidebar.aiHub')}
        title={t('aiHub.tabs.integrations')}
        description={copy.workspaceDescription}
        className="px-4 py-2.5 md:px-5 md:py-3"
      />

      <div className="flex-1 overflow-y-auto p-3 md:p-4">
        <GlassCard className="mx-auto w-full max-w-[1200px] overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-white">{copy.workspaceTitle}</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">{copy.endpointHint}</p>
            </div>
            <StatusBadge status={running ? 'active' : 'inactive'} size="sm" withDot>
              {running ? copy.running : copy.stopped}
            </StatusBadge>
          </div>

          <div className="grid min-[720px]:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)]">
            <section className="min-w-0 p-4">
              <div className="mb-3 flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-300 ring-1 ring-inset ring-indigo-400/15">
                  <Terminal size={16} />
                </span>
                <h3 className="text-xs font-semibold text-white">{copy.endpointTitle}</h3>
              </div>

              <div className="space-y-3">
                <Input
                  label={t('aiHub.integrations.baseUrl')}
                  value={baseUrl}
                  readOnly
                  className="font-mono text-xs"
                  rightElement={
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        void handleCopy(t('aiHub.integrations.baseUrl'), baseUrl, false, 'url')
                      }
                      leftIcon={copied === 'url' ? <Check size={13} /> : <Copy size={13} />}
                    >
                      {t('common.copy')}
                    </Button>
                  }
                />
                <Input
                  label={t('aiHub.integrations.apiKey')}
                  value={clientApiKey}
                  readOnly
                  className="font-mono text-xs"
                  rightElement={
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        void handleCopy(t('aiHub.integrations.apiKey'), clientApiKey, false, 'key')
                      }
                      leftIcon={copied === 'key' ? <Check size={13} /> : <Copy size={13} />}
                    >
                      {t('common.copy')}
                    </Button>
                  }
                />
              </div>

              <div className="mt-3 flex flex-wrap gap-2 border-t border-white/[0.06] pt-3">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => navigate('/ai/routing')}
                  leftIcon={<Gauge size={14} />}
                >
                  {copy.proxySettings}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => navigate('/ai/chat')}>
                  {copy.testInChat}
                </Button>
              </div>
            </section>

            <section className="border-t border-white/[0.06] bg-white/[0.015] p-4 min-[720px]:border-l min-[720px]:border-t-0">
              <div className="mb-3 flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-300 ring-1 ring-inset ring-emerald-400/15">
                  <FileJson size={16} />
                </span>
                <h3 className="text-xs font-semibold text-white">{copy.transferTitle}</h3>
              </div>
              <p className="text-[11px] leading-4 text-slate-500">{copy.transferDescription}</p>
              <div className="mt-4 grid grid-cols-2 gap-2 min-[720px]:grid-cols-1">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setTransferMode('import')}
                  leftIcon={<Upload size={14} />}
                >
                  {copy.importAccounts}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setTransferMode('export')}
                  leftIcon={<Download size={14} />}
                >
                  {copy.exportAccounts}
                </Button>
              </div>
            </section>
          </div>
        </GlassCard>
      </div>

      {transferMode ? (
        <AiTransferModal
          isOpen
          onClose={() => setTransferMode(null)}
          transferMode={transferMode}
          showAuthScanActions={false}
          importDescription={copy.importModalDescription}
          authScan={authScan}
          authScanLoading={authScanLoading}
          importPayload={importPayload}
          onImportPayloadChange={setImportPayload}
          importValidation={importValidation}
          importLoading={importLoading}
          onScanAuthFiles={scanAuthFiles}
          onPrepareImportFromScan={handlePrepareImportFromScan}
          onImportPayload={handleImportPayload}
          onImportAllFromScan={handleImportAllFromScan}
          exportFormat={exportFormat}
          onExportFormatChange={setExportFormat}
          exportIncludeSecrets={exportIncludeSecrets}
          onExportIncludeSecretsChange={setExportIncludeSecrets}
          exportPayload={exportPayload}
          exportLoading={exportLoading}
          onGenerateExport={handleGenerateExport}
          onDownloadText={downloadText}
          buildExportFileName={buildExportFileName}
          effectiveExportIncludeSecrets={effectiveExportIncludeSecrets}
          onCopy={(label, value, requireConfirm) => {
            void handleCopy(label, value, requireConfirm);
          }}
        />
      ) : null}
    </div>
  );
}

export default AiIntegrations;
