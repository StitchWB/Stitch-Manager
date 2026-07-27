import { Copy, RefreshCw } from 'lucide-react';
import { useState } from 'react';

import type { AuthFile } from '../../../types/generated';
import { t } from '@/lib/i18n';
import { Button, Checkbox, ConfirmDialog, Modal, Select, Textarea } from '@/components/ui';

interface ImportValidationState {
  isValid: boolean;
  error: string | null;
  includeSecrets: boolean;
}

interface AiTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  transferMode: 'import' | 'export';
  showAuthScanActions?: boolean;
  importDescription?: string;
  authScan: AuthFile[] | null;
  authScanLoading: boolean;
  importPayload: string;
  onImportPayloadChange: (value: string) => void;
  importValidation: ImportValidationState;
  importLoading: boolean;
  onScanAuthFiles: () => void;
  onPrepareImportFromScan: () => void;
  onImportPayload: () => void;
  onImportAllFromScan: () => void;
  exportFormat: 'json' | 'csv';
  onExportFormatChange: (value: 'json' | 'csv') => void;
  exportIncludeSecrets: boolean;
  onExportIncludeSecretsChange: (value: boolean) => void;
  exportPayload: string;
  exportLoading: boolean;
  onGenerateExport: () => void;
  onDownloadText: (fileName: string, text: string, mime: string) => void;
  buildExportFileName: (format: 'json' | 'csv', includeSecrets: boolean) => string;
  effectiveExportIncludeSecrets: boolean;
  onCopy: (label: string, value: string, requireConfirm?: boolean) => void;
}

export function AiTransferModal({
  isOpen,
  onClose,
  transferMode,
  showAuthScanActions = true,
  importDescription,
  authScan,
  authScanLoading,
  importPayload,
  onImportPayloadChange,
  importValidation,
  importLoading,
  onScanAuthFiles,
  onPrepareImportFromScan,
  onImportPayload,
  onImportAllFromScan,
  exportFormat,
  onExportFormatChange,
  exportIncludeSecrets,
  onExportIncludeSecretsChange,
  exportPayload,
  exportLoading,
  onGenerateExport,
  onDownloadText,
  buildExportFileName,
  effectiveExportIncludeSecrets,
  onCopy,
}: AiTransferModalProps) {
  const [confirmIncludeSecretsOpen, setConfirmIncludeSecretsOpen] = useState(false);

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={
          transferMode === 'import'
            ? t('aiHub.modals.transferImportTitle')
            : t('aiHub.modals.transferExportTitle')
        }
        size="lg"
        footer={
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-400">{t('aiHub.modals.transferFooter')}</div>
            <Button variant="secondary" onClick={onClose}>
              {t('aiHub.actions.close')}
            </Button>
          </div>
        }
      >
        {transferMode === 'import' ? (
          <div className="space-y-4">
            <div className="bg-black/30 border border-white/10 rounded-lg p-3">
              <div className="text-sm text-white font-medium">{t('aiHub.modals.importTitle')}</div>
              <div className="text-xs text-slate-400 mt-1">
                {importDescription ?? t('aiHub.modals.importDescription')}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {showAuthScanActions ? (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={onScanAuthFiles}
                      disabled={authScanLoading}
                      leftIcon={<RefreshCw size={16} />}
                    >
                      {authScanLoading
                        ? t('aiHub.actions.scanningAuthFiles')
                        : t('aiHub.actions.scanAuthFiles')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={onPrepareImportFromScan}
                      disabled={!authScan || authScan.length === 0}
                    >
                      {t('aiHub.actions.prepareFromScan')}
                    </Button>
                  </>
                ) : null}
                <Button
                  variant="primary"
                  size="sm"
                  onClick={onImportPayload}
                  disabled={importLoading || !importValidation.isValid}
                >
                  {importLoading ? t('aiHub.actions.importing') : t('aiHub.actions.importJson')}
                </Button>
                {showAuthScanActions ? (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={onImportAllFromScan}
                    disabled={
                      importLoading || authScanLoading || !authScan || authScan.length === 0
                    }
                  >
                    {importLoading
                      ? t('aiHub.actions.importing')
                      : t('aiHub.actions.importAllFromScan')}
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs text-slate-400">{t('aiHub.modals.importPayloadLabel')}</div>
              <Textarea
                value={importPayload}
                onChange={e => onImportPayloadChange(e.target.value)}
                className="min-h-[140px] p-3 text-xs font-mono"
                placeholder={t('aiHub.modals.importPayloadPlaceholder')}
              />
              {importValidation.error && (
                <div className="text-xs text-red-400">{importValidation.error}</div>
              )}
            </div>

            {importValidation.includeSecrets && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200">
                <div className="font-medium text-amber-200">
                  {t('aiHub.modals.importWarningTitle')}
                </div>
                <div className="mt-1 text-amber-200/80">
                  {t('aiHub.modals.importWarningDescription')}
                </div>
              </div>
            )}

            {showAuthScanActions && authScan && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-white">
                    {t('aiHub.modals.scanResultsTitle')}{' '}
                    <span className="text-slate-400">({authScan.length})</span>
                  </div>
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() =>
                      onCopy(t('aiHub.modals.scanReportLabel'), JSON.stringify(authScan, null, 2))
                    }
                    leftIcon={<Copy size={14} />}
                  >
                    {t('aiHub.actions.copy')}
                  </Button>
                </div>
                {authScan.length === 0 ? (
                  <div className="text-xs text-slate-400">{t('aiHub.empty.noAuthFiles')}</div>
                ) : (
                  <div className="max-h-64 overflow-auto pr-1 space-y-1">
                    {authScan.map((f, idx) => (
                      <div
                        key={`${f.provider}-${f.path}-${idx}`}
                        className="text-xs text-slate-300 bg-white/5 border border-white/10 rounded-lg px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="capitalize text-white">{f.provider}</span>
                          <span className="text-slate-500 tabular-nums">
                            {f.expiresAt
                              ? t('aiHub.modals.expiresShort', {
                                  date: new Date(f.expiresAt * 1000).toLocaleDateString(),
                                })
                              : t('aiHub.modals.noExpiry')}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 break-all mt-1">
                          {f.path}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-3">
              <div>
                <div className="text-sm text-white font-medium">
                  {t('aiHub.modals.exportTitle')}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {t('aiHub.modals.exportDescription')}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Select
                  containerClassName="w-auto"
                  className="h-9 py-1 text-sm"
                  value={exportFormat}
                  onValueChange={value => onExportFormatChange(value as 'json' | 'csv')}
                  options={[
                    { value: 'json', label: t('aiHub.modals.exportFormatJson') },
                    { value: 'csv', label: t('aiHub.modals.exportFormatCsv') },
                  ]}
                />
                <Checkbox
                  checked={exportIncludeSecrets}
                  disabled={exportFormat === 'csv'}
                  onChange={e => {
                    const next = e.target.checked;
                    if (next) {
                      setConfirmIncludeSecretsOpen(true);
                      return;
                    }
                    onExportIncludeSecretsChange(next);
                  }}
                  label={t('aiHub.modals.includeSecrets')}
                  className="py-0 px-0 hover:bg-transparent"
                />
                {exportFormat === 'csv' && (
                  <span className="text-xs text-slate-500">{t('aiHub.modals.csvNoSecrets')}</span>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  onClick={onGenerateExport}
                  disabled={exportLoading}
                >
                  {exportLoading ? t('aiHub.actions.generating') : t('aiHub.actions.generate')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!exportPayload}
                  onClick={() =>
                    onDownloadText(
                      buildExportFileName(exportFormat, effectiveExportIncludeSecrets),
                      exportPayload,
                      exportFormat === 'csv' ? 'text/csv' : 'application/json'
                    )
                  }
                >
                  {t('aiHub.actions.download')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!exportPayload}
                  onClick={() =>
                    onCopy(
                      t('aiHub.modals.exportPayloadLabel'),
                      exportPayload,
                      effectiveExportIncludeSecrets
                    )
                  }
                  leftIcon={<Copy size={16} />}
                >
                  {t('aiHub.actions.copy')}
                </Button>
              </div>

              <div className="rounded-lg border border-white/10 bg-black/20 p-3 max-h-64 overflow-auto">
                {exportPayload ? (
                  <pre className="text-[11px] text-slate-300 whitespace-pre-wrap break-words">
                    {exportPayload}
                  </pre>
                ) : (
                  <div className="text-xs text-slate-500">{t('aiHub.empty.noExportPayload')}</div>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={confirmIncludeSecretsOpen}
        onClose={() => setConfirmIncludeSecretsOpen(false)}
        onConfirm={() => {
          onExportIncludeSecretsChange(true);
          setConfirmIncludeSecretsOpen(false);
        }}
        title={t('aiHub.modals.includeSecrets')}
        message={t('aiHub.warnings.includeSecretsConfirm')}
        confirmText={t('common.confirm')}
        cancelText={t('common.cancel')}
        variant="warning"
      />
    </>
  );
}
