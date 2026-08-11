import { useEffect, useState } from 'react';
import { Eye, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Modal } from '@/components/ui';
import { t } from '@/lib/i18n';
import {
  discardReport,
  getReportPreview,
  sendReport,
  type ReportPreview,
} from '@/lib/backend/modules/telemetry';

interface ReportPreviewModalProps {
  reportId: string | null;
  onClose: () => void;
  onActionComplete: () => void;
  consentOn: boolean;
}

/** Max inline string length in the JSON preview — longer values are replaced
 * with a size placeholder so 500 KB base64 blobs don't flood the modal. */
const MAX_INLINE_STRING = 300;

function _truncateLongStringsReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && value.length > MAX_INLINE_STRING) {
    const sizeKb = (value.length / 1024).toFixed(1);
    return `<${_key || 'value'}: ${sizeKb} KB>`;
  }
  return value;
}

export function ReportPreviewModal({
  reportId,
  onClose,
  onActionComplete,
  consentOn,
}: ReportPreviewModalProps) {
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<'send' | 'discard' | null>(null);

  useEffect(() => {
    if (!reportId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setPreview(null);
    getReportPreview({ id: reportId })
      .then(data => {
        if (!cancelled) setPreview(data);
      })
      .catch(err => {
        if (!cancelled) {
          toast.error(t('settings.telemetry.previewLoadFailed'));
          console.error('[Telemetry] preview load failed:', err);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  const handleSend = async () => {
    if (!reportId) return;
    setActionInProgress('send');
    try {
      const result = await sendReport({ id: reportId });
      if (result.success) {
        toast.success(t('settings.telemetry.sendSuccess'));
        onActionComplete();
        onClose();
      } else {
        toast.error(result.error || t('settings.telemetry.sendFailed'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.telemetry.sendFailed'));
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDiscard = async () => {
    if (!reportId) return;
    setActionInProgress('discard');
    try {
      const result = await discardReport({ id: reportId });
      if (result.success) {
        toast.success(t('settings.telemetry.discardSuccess'));
        onActionComplete();
        onClose();
      } else {
        toast.error(result.error || t('settings.telemetry.discardFailed'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.telemetry.discardFailed'));
    } finally {
      setActionInProgress(null);
    }
  };

  const bundleJson = preview
    ? JSON.stringify(preview.bundle, _truncateLongStringsReplacer, 2)
    : '';

  const renderBundle = () => {
    if (!bundleJson) return null;
    const parts = bundleJson.split(/(\*\*\*)/);
    return parts.map((part, i) => {
      if (part === '***') {
        return (
          <span
            key={i}
            className="text-amber-400 font-bold bg-amber-500/10 px-0.5 rounded"
          >
            {part}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <Modal
      isOpen={reportId !== null}
      onClose={onClose}
      title={t('settings.telemetry.previewTitle')}
      icon={<Eye className="w-4 h-4 text-cyan-400" />}
      size="lg"
      isLoading={isLoading}
      loadingMessage={t('common.loading')}
      footer={
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={onClose}>
            {t('settings.telemetry.close')}
          </Button>
          <div className="flex gap-2">
            <Button
              variant="danger"
              onClick={() => void handleDiscard()}
              isLoading={actionInProgress === 'discard'}
              disabled={actionInProgress !== null}
              leftIcon={<Trash2 className="w-3.5 h-3.5" />}
            >
              {t('settings.telemetry.discard')}
            </Button>
            <Button
              variant="primary"
              onClick={() => void handleSend()}
              isLoading={actionInProgress === 'send'}
              disabled={actionInProgress !== null || !consentOn}
              leftIcon={<Send className="w-3.5 h-3.5" />}
            >
              {t('settings.telemetry.send')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {preview?.sensitive_dropped && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            {t('settings.telemetry.sensitiveDroppedNotice')}
          </div>
        )}
        {preview && (
          <div className="text-[11px] text-slate-500">
            {t('settings.telemetry.scrubbedNotice')}
          </div>
        )}
        {bundleJson && (
          <pre className="text-xs font-mono text-slate-300 bg-black/30 border border-white/10 rounded-lg p-4 overflow-x-auto max-h-[50vh] whitespace-pre-wrap break-all">
            {renderBundle()}
          </pre>
        )}
      </div>
    </Modal>
  );
}
