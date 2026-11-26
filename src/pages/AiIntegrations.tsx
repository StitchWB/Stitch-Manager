import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Download, FileJson, Gauge, Terminal, Upload, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { AiTransferModal } from '@/components/ai-proxy/modals/AiTransferModal';
import { VellyConnectionCard } from '@/components/ai-proxy/VellyConnectionCard';
import Header from '@/components/layout/Header';
import { Button, GlassCard, Input, PageHeader, StatusBadge } from '@/components/ui';
import { askConfirm } from '@/components/ui/ConfirmDialogHost';
import { API_BASE_URL } from '@/lib/backend/core/invoke';
import { getLocalChatToken } from '@/lib/backend/modules/aiProxy';
import { modelSyncStatus } from '@/lib/backend/modules/modelSync';
import { t } from '@/lib/i18n';
import { useAppStore } from '@/stores/app';
import { useAiProvidersController } from './hooks/useAiProvidersController';

function fallbackGatewayBaseUrl(): string {
  try {
    return new URL(`${API_BASE_URL}/v1`, window.location.origin).href;
  } catch {
    return `${API_BASE_URL}/v1`;
  }
}

interface AiIntegrationsProps {
  baseUrl?: string;
  clientApiKey?: string;
}

export function AiIntegrations({ baseUrl: baseUrlOverride, clientApiKey }: AiIntegrationsProps) {
  const navigate = useNavigate();
  const language = useAppStore(state => state.language);
  const [copied, setCopied] = useState<'url' | 'key' | null>(null);
  const [localToken, setLocalToken] = useState('');
  const [gatewayBaseUrl, setGatewayBaseUrl] = useState(() => fallbackGatewayBaseUrl());
  const [gatewayRunning, setGatewayRunning] = useState(true);
  const [transferMode, setTransferMode] = useState<'import' | 'export' | null>(null);
  const controller = useAiProvidersController();

  useEffect(() => {
    let disposed = false;
    getLocalChatToken()
      .then(token => {
        if (!disposed) setLocalToken(token);
      })
      .catch(() => {
        if (!disposed) setLocalToken('');
      });
    modelSyncStatus()
      .then(status => {
        if (disposed) return;
        if (typeof status.baseUrl === 'string' && status.baseUrl.trim()) {
          setGatewayBaseUrl(status.baseUrl.trim());
        }
        setGatewayRunning(status.gatewayRunning !== false);
      })
      .catch(() => {
        if (!disposed) setGatewayRunning(true);
      });
    return () => {
      disposed = true;
    };
  }, []);

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

  const baseUrl = baseUrlOverride ?? gatewayBaseUrl;
  const effectiveClientApiKey = clientApiKey ?? localToken;
  const isRu = language === 'ru';
  const copy = isRu
    ? {
      workspaceTitle: 'AI Gateway',
      workspaceDescription:
        'OpenAI-совместимый endpoint встроен в backend Stitch. Внешний proxy для него не нужен.',
      endpointTitle: 'Gateway endpoint и ключ',
      endpointHint:
        'Укажите Base URL в клиенте и передавайте ключ как Authorization: Bearer <key>. Локальный ключ ниже действует только на этом компьютере; Model Sync записывает в opencode/omp отдельные install-ключи с ограниченным доступом.',
      gatewayRunning: 'AI Gateway работает',
      gatewayStopped: 'AI Gateway недоступен',
      localTokenLabel: 'Локальный gateway-ключ',
      installKeyHint:
        'Не вставляйте этот локальный ключ в конфиги opencode/omp вручную: кнопка Model Sync создаёт отдельные install-ключи, которые можно отозвать без смены локального токена.',
      legacyTitle: 'Legacy AI Proxy',
      legacyDescription:
        'Совместимость для старых клиентов. Новые подключения должны использовать AI Gateway выше.',
      legacyRunning: 'Legacy proxy работает',
      proxySettings: 'Настройки Gateway',
      testInChat: 'Проверить в чате',
      transferTitle: 'Перенос аккаунтов',
      transferDescription:
        'Импортируйте JSON-бэкап или экспортируйте текущие аккаунты в JSON/CSV.',
      importModalDescription:
        'Вставьте JSON-бэкап аккаунтов. Данные будут проверены до импорта.',
      importAccounts: 'Импорт JSON',
      exportAccounts: 'Экспорт',
      copyFailed: 'Не удалось скопировать значение',
      copied: 'Скопировано',
      sensitiveConfirm: 'Скопировать значение с секретами в буфер обмена?',
    }
    : {
      workspaceTitle: 'AI Gateway',
      workspaceDescription:
        'An OpenAI-compatible endpoint built into the Stitch backend. No external proxy is required.',
      endpointTitle: 'Gateway endpoint and key',
      endpointHint:
        'Use this Base URL in your client and send the key as Authorization: Bearer <key>. The local key below works only on this machine; Model Sync provisions separate least-privilege install keys for opencode/omp.',
      gatewayRunning: 'AI Gateway is running',
      gatewayStopped: 'AI Gateway is unavailable',
      localTokenLabel: 'Local gateway key',
      installKeyHint:
        'Do not paste this local key into opencode/omp configs manually: Model Sync creates separate install keys that can be revoked without rotating the local token.',
      legacyTitle: 'Legacy AI Proxy',
      legacyDescription:
        'Compatibility endpoint for older clients. New connections should use the AI Gateway above.',
      legacyRunning: 'Legacy proxy is running',
      proxySettings: 'Gateway settings',
      testInChat: 'Test in Chat',
      transferTitle: 'Move accounts',
      transferDescription:
        'Import a JSON backup or export current accounts as JSON/CSV.',
      importModalDescription:
        'Paste an account JSON backup. The data is validated before import.',
      importAccounts: 'Import JSON',
      exportAccounts: 'Export',
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
      if (requireConfirm) {
        const ok = await askConfirm({
          title: t('common.copy'),
          message: copy.sensitiveConfirm,
          confirmText: t('common.copy'),
          cancelText: t('common.cancel'),
          variant: 'warning',
        });
        if (!ok) return;
      }

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

  const legacyRunning = Boolean(proxyStatus?.running);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-void-base">
      <Header title={t('sidebar.aiHub')} icon={<Zap size={18} />} />
      <PageHeader
        eyebrow={t('sidebar.aiHub')}
        title={t('aiHub.tabs.connections')}
        description={copy.workspaceDescription}
        className="px-4 py-2.5 md:px-5 md:py-3"
      />

      <div className="flex-1 space-y-3 overflow-y-auto p-3 md:p-4">
        <GlassCard className="mx-auto w-full max-w-[1200px] overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-white">{copy.workspaceTitle}</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">{copy.endpointHint}</p>
            </div>
            <StatusBadge status={gatewayRunning ? 'active' : 'inactive'} size="sm" withDot>
              {gatewayRunning ? copy.gatewayRunning : copy.gatewayStopped}
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
                  label={copy.localTokenLabel}
                  value={effectiveClientApiKey}
                  readOnly
                  className="font-mono text-xs"
                  rightElement={
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        void handleCopy(
                          t('aiHub.integrations.apiKey'),
                          effectiveClientApiKey,
                          true,
                          'key'
                        )
                      }
                      leftIcon={copied === 'key' ? <Check size={13} /> : <Copy size={13} />}
                    >
                      {t('common.copy')}
                    </Button>
                  }
                />
              </div>

              <p className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px] leading-4 text-slate-400">
                {copy.installKeyHint}
              </p>

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

          {legacyRunning ? (
            <section className="border-t border-white/[0.06] px-4 py-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold text-white">{copy.legacyTitle}</h3>
                  <p className="mt-0.5 text-[11px] text-slate-500">{copy.legacyDescription}</p>
                </div>
                <StatusBadge status="active" size="sm" withDot>
                  {copy.legacyRunning}
                </StatusBadge>
              </div>
              <Input
                label={t('aiHub.integrations.baseUrl')}
                value={detectedBaseUrl}
                readOnly
                className="font-mono text-xs"
                rightElement={
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() =>
                      void handleCopy(copy.legacyTitle, detectedBaseUrl, false)
                    }
                    leftIcon={<Copy size={13} />}
                  >
                    {t('common.copy')}
                  </Button>
                }
              />
            </section>
          ) : null}
        </GlassCard>
        <VellyConnectionCard />
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
