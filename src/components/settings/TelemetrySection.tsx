import { useCallback, useEffect, useState } from 'react';
import { Activity, Eye, Send, Trash2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, EmptyState, SectionHeader, Toggle } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { getSettings, updateSettings } from '@/lib/backend/modules/settings';
import {
  discardReport,
  getPendingReports,
  sendReport,
  type PendingReport,
} from '@/lib/backend/modules/telemetry';
import { ReportPreviewModal } from './ReportPreviewModal';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function TelemetrySection() {
  const [consent, setConsent] = useState(false);
  const [reports, setReports] = useState<PendingReport[]>([]);
  const [isLoadingReports, setIsLoadingReports] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [actionRowId, setActionRowId] = useState<string | null>(null);

  const loadConsent = useCallback(async () => {
    try {
      const data = await getSettings();
      setConsent((data as { telemetry_consent?: string }).telemetry_consent === 'true');
    } catch (err) {
      console.error('[Telemetry] failed to load consent:', err);
    }
  }, []);

  const loadReports = useCallback(async () => {
    setIsLoadingReports(true);
    try {
      const data = await getPendingReports();
      setReports(data.reports || []);
    } catch (err) {
      toast.error(t('settings.telemetry.loadFailed'));
      console.error('[Telemetry] failed to load reports:', err);
      setReports([]);
    } finally {
      setIsLoadingReports(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
    void loadConsent();
    void loadReports();
    });
  }, [loadConsent, loadReports]);

  const handleConsentChange = async (checked: boolean) => {
    setConsent(checked);
    try {
      await updateSettings({ telemetry_consent: checked ? 'true' : 'false' });
    } catch (err) {
      console.error('[Telemetry] failed to save consent:', err);
      toast.error(t('settings.failedToSave'));
      setConsent(!checked);
    }
  };

  const handleSendRow = async (id: string) => {
    setActionRowId(id);
    try {
      const result = await sendReport({ id });
      if (result.success) {
        toast.success(t('settings.telemetry.sendSuccess'));
        await loadReports();
      } else {
        toast.error(result.error || t('settings.telemetry.sendFailed'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.telemetry.sendFailed'));
    } finally {
      setActionRowId(null);
    }
  };

  const handleDiscardRow = async (id: string) => {
    setActionRowId(id);
    try {
      const result = await discardReport({ id });
      if (result.success) {
        toast.success(t('settings.telemetry.discardSuccess'));
        await loadReports();
      } else {
        toast.error(result.error || t('settings.telemetry.discardFailed'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.telemetry.discardFailed'));
    } finally {
      setActionRowId(null);
    }
  };

  return (
    <SectionHeader
      title={t('settings.telemetry.title')}
      description={t('settings.telemetry.description')}
      icon={<Activity className="w-4 h-4 text-indigo-400" />}
      className="pt-6 border-t border-white/10"
    >
      <div className="space-y-4">
        <div className="glass-card rounded-lg p-4 bg-white/[0.02] space-y-2">
          <Toggle
            label={t('settings.telemetry.consentLabel')}
            checked={consent}
            onChange={v => void handleConsentChange(v)}
          />
          <p className="text-xs text-slate-500 leading-relaxed">
            {t('settings.telemetry.consentDescription')}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-medium text-slate-200">
                {t('settings.telemetry.pendingTitle')}
              </h4>
              <p className="text-xs text-slate-500">
                {t('settings.telemetry.pendingDescription')}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void loadReports()}
              disabled={isLoadingReports}
              leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            >
              {t('settings.telemetry.refresh')}
            </Button>
          </div>

          {!consent && reports.length > 0 && (
            <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300/80">
              {t('settings.telemetry.consentOffNotice')}
            </div>
          )}

          {reports.length === 0 ? (
            <EmptyState
              icon={Activity}
              title={t('settings.telemetry.emptyTitle')}
              description={t('settings.telemetry.emptyDescription')}
              compact
            />
          ) : (
            <div className={cn('space-y-2', !consent && 'opacity-60')}>
              {reports.map(report => (
                <div
                  key={report.id}
                  className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-slate-200 font-mono">
                          {report.plugin_id}@{report.version}
                        </span>
                        <Badge
                          variant={report.scrubbed ? 'success' : 'warning'}
                          size="sm"
                        >
                          {report.scrubbed
                            ? t('settings.telemetry.scrubbedBadge')
                            : t('settings.telemetry.notScrubbedBadge')}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        <span className="text-slate-500">
                          {t('settings.telemetry.colStep')}:
                        </span>{' '}
                        <span className="text-slate-300 font-mono">{report.step}</span>
                        <span className="text-slate-600 mx-1">·</span>
                        <span className="text-slate-500">
                          {t('settings.telemetry.colDate')}:
                        </span>{' '}
                        <span className="text-slate-300">
                          {formatDate(report.created_at)}
                        </span>
                        <span className="text-slate-600 mx-1">·</span>
                        <span className="text-slate-500">
                          {t('settings.telemetry.colSize')}:
                        </span>{' '}
                        <span className="text-slate-300">
                          {formatBytes(report.size_bytes)}
                        </span>
                      </div>
                      {report.error_preview && (
                        <div className="mt-1 text-xs text-red-300/70 truncate font-mono">
                          {report.error_preview}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => setPreviewId(report.id)}
                        leftIcon={<Eye className="w-3 h-3" />}
                      >
                        {t('settings.telemetry.preview')}
                      </Button>
                      <Button
                        size="xs"
                        variant="danger"
                        onClick={() => void handleDiscardRow(report.id)}
                        isLoading={actionRowId === report.id}
                        disabled={actionRowId !== null}
                        leftIcon={<Trash2 className="w-3 h-3" />}
                      >
                        {t('settings.telemetry.discard')}
                      </Button>
                      <Button
                        size="xs"
                        variant="primary"
                        onClick={() => void handleSendRow(report.id)}
                        isLoading={actionRowId === report.id}
                        disabled={actionRowId !== null || !consent}
                        leftIcon={<Send className="w-3 h-3" />}
                      >
                        {t('settings.telemetry.send')}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ReportPreviewModal
        reportId={previewId}
        onClose={() => setPreviewId(null)}
        onActionComplete={() => void loadReports()}
        consentOn={consent}
      />
    </SectionHeader>
  );
}
