import { FileText, MailSearch } from 'lucide-react';
import { Badge, EmptyState } from '@/components/ui';
import { t } from '@/lib/i18n';
import type { EmailMessage } from '@/lib/tauri/modules/emailInbox';

interface MailMessageViewerProps {
  message: EmailMessage | null;
}

function joinAddresses(list: Array<{ name?: string | null; email: string }>): string {
  if (!list.length) {
    return '-';
  }

  return list.map(item => (item.name ? `${item.name} <${item.email}>` : item.email)).join(', ');
}

export function MailMessageViewer({ message }: MailMessageViewerProps) {
  return (
    <section className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-3 min-h-[420px] flex flex-col">
      <div className="flex items-center justify-between gap-2 pb-2 px-1 border-b border-white/10">
        <h2 className="text-sm font-semibold text-white tracking-wide">{t('mail.viewerTitle')}</h2>
        {message ? (
          <Badge size="sm" variant={message.isRead ? 'outline' : 'info'}>
            {message.isRead ? t('mail.readStateRead') : t('mail.readStateUnread')}
          </Badge>
        ) : null}
      </div>

      {!message ? (
        <EmptyState
          icon={MailSearch}
          title={t('mail.noSelectionTitle')}
          description={t('mail.noSelectionDescription')}
          className="py-14"
        />
      ) : (
        <div className="space-y-3 overflow-auto pr-1 pt-3 min-h-0">
          <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-2">
            <p className="text-base text-white font-semibold">{message.subject || '-'}</p>
            <p className="text-xs text-slate-400">
              {t('mail.fromField')}: {joinAddresses([message.from])}
            </p>
            <p className="text-xs text-slate-400">
              {t('mail.toField')}: {joinAddresses(message.to)}
            </p>
            <p className="text-xs text-slate-500">
              {t('mail.ccField')}: {joinAddresses(message.cc)}
            </p>
            <p className="text-xs text-slate-500">
              {t('mail.bccField')}: {joinAddresses(message.bcc)}
            </p>
            <p className="text-xs text-slate-500">
              {t('mail.receivedAtField')}: {new Date(message.receivedAt).toLocaleString()}
            </p>
          </div>

          <div className="grid grid-cols-1 2xl:grid-cols-2 gap-3">
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400 mb-2">
                {t('mail.plainTextLabel')}
              </p>
              <pre className="text-xs text-slate-300 whitespace-pre-wrap break-words max-h-[260px] overflow-auto">
                {message.text || '-'}
              </pre>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400 mb-2">
                {t('mail.htmlLabel')}
              </p>
              <pre className="text-xs text-slate-300 whitespace-pre-wrap break-words max-h-[260px] overflow-auto">
                {message.html || '-'}
              </pre>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-400 mb-2">
              {t('mail.attachmentsLabel')}
            </p>
            {message.attachments.length === 0 ? (
              <p className="text-xs text-slate-500">-</p>
            ) : (
              <ul className="space-y-1">
                {message.attachments.map(attachment => (
                  <li
                    key={attachment.id}
                    className="text-xs text-slate-300 flex items-center gap-2"
                  >
                    <FileText size={12} />
                    <span>{attachment.filename}</span>
                    <span className="text-slate-500">({attachment.size})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
