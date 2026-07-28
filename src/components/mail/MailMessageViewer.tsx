import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FileText, ImageOff, Images, MailOpen, MailSearch, Trash2, X } from 'lucide-react';
import { Badge, EmptyState, IconButton, LoadingSpinner, SegmentedControl } from '@/components/ui';
import { t } from '@/lib/i18n';
import type { EmailMessage, ProviderCapabilities } from '@/lib/backend/modules/emailInbox';
import { MailHtmlSandbox } from './MailHtmlSandbox';
import { VerificationCodeChip } from './VerificationCodeChip';

interface MailMessageViewerProps {
  message: EmailMessage | null;
  capabilities: ProviderCapabilities | null;
  busy: boolean;
  /** Scoped error for the currently selected message fetch, if any. */
  loadError?: string | null;
  onClearLoadError?: () => void;
  onMarkRead?: (messageId: string) => Promise<void>;
  onDelete?: (messageId: string) => Promise<void>;
}

type ViewMode = 'auto' | 'plain' | 'html';

function joinAddresses(list: Array<{ name?: string | null; email: string }>): string {
  if (!list.length) {
    return '—';
  }

  return list.map(item => (item.name ? `${item.name} <${item.email}>` : item.email)).join(', ');
}

function getInitial(message: EmailMessage): string {
  const name = message.from?.name?.trim() || message.from?.email || '?';
  return name.charAt(0).toUpperCase();
}

export function MailMessageViewer({
  message,
  capabilities,
  busy,
  loadError,
  onClearLoadError,
  onMarkRead,
  onDelete,
}: MailMessageViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('auto');
  const [showRemoteImages, setShowRemoteImages] = useState(false);

  // Reset remote-image trust whenever a different message is opened.
  useEffect(() => {
    setShowRemoteImages(false);
  }, [message?.id]);

  const effectiveMode = useMemo<'plain' | 'html'>(() => {
    if (viewMode === 'plain') return 'plain';
    if (viewMode === 'html') return 'html';
    return message?.html ? 'html' : 'plain';
  }, [viewMode, message?.html]);

  return (
    <section className="bg-white/[0.03] border border-white/[0.08] rounded-xl flex flex-col h-full min-h-[420px] overflow-hidden">
      {!message && busy ? (
        <div className="flex items-center justify-center h-full">
          <LoadingSpinner size="lg" />
        </div>
      ) : !message && loadError ? (
        <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
          <AlertTriangle size={22} className="text-red-400" />
          <p className="text-sm text-red-200 max-w-sm">{loadError}</p>
          {onClearLoadError ? (
            <button
              type="button"
              onClick={onClearLoadError}
              className="text-xs text-slate-400 hover:text-white underline underline-offset-2"
            >
              {t('common.dismiss')}
            </button>
          ) : null}
        </div>
      ) : !message ? (
        <EmptyState
          icon={MailSearch}
          title={t('mail.noSelectionTitle')}
          description={t('mail.noSelectionDescription')}
          className="py-14 flex-1"
        />
      ) : (
        <>
          {loadError ? (
            <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-red-500/20 bg-red-500/10">
              <p className="text-[11px] text-red-200 flex items-center gap-1.5">
                <AlertTriangle size={12} />
                {loadError}
              </p>
              {onClearLoadError ? (
                <IconButton size="sm" onClick={onClearLoadError} aria-label={t('common.dismiss')}>
                  <X size={12} />
                </IconButton>
              ) : null}
            </div>
          ) : null}

          {/* Header */}
          <header className="px-4 py-3 border-b border-white/[0.06] space-y-2">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-base font-semibold text-white leading-snug break-words flex-1">
                {message.subject || '—'}
              </h2>
              <div className="flex items-center gap-1 shrink-0">
                {capabilities?.canMarkAsRead && !message.isRead && onMarkRead ? (
                  <button
                    type="button"
                    title={t('mail.markReadAction')}
                    disabled={busy}
                    onClick={() => {
                      void onMarkRead(message.id);
                    }}
                    className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-50 transition-colors"
                  >
                    <MailOpen size={14} />
                  </button>
                ) : null}
                {capabilities?.canDelete && onDelete ? (
                  <button
                    type="button"
                    title={t('mail.deleteAction')}
                    disabled={busy}
                    onClick={() => {
                      void onDelete(message.id);
                    }}
                    className="p-1.5 rounded text-slate-400 hover:text-red-300 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                ) : null}
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-xs font-semibold text-indigo-200 shrink-0">
                {getInitial(message)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-white truncate">
                  {message.from?.name ? (
                    <>
                      <span className="font-medium">{message.from.name}</span>{' '}
                      <span className="text-slate-500">&lt;{message.from.email}&gt;</span>
                    </>
                  ) : (
                    message.from?.email || '—'
                  )}
                </p>
                <p className="text-[11px] text-slate-500 truncate">
                  {t('mail.toField')}: {joinAddresses(message.to)}
                </p>
                {message.cc.length > 0 ? (
                  <p className="text-[11px] text-slate-500 truncate">
                    {t('mail.ccField')}: {joinAddresses(message.cc)}
                  </p>
                ) : null}
              </div>
              <div className="text-right shrink-0">
                <p className="text-[11px] text-slate-500">
                  {new Date(message.receivedAt).toLocaleString()}
                </p>
                <Badge size="sm" variant={message.isRead ? 'outline' : 'info'} className="mt-1">
                  {message.isRead ? t('mail.readStateRead') : t('mail.readStateUnread')}
                </Badge>
              </div>
            </div>

            {message.html || message.text ? (
              <div className="flex items-center justify-between gap-2 pt-1">
                <SegmentedControl
                  options={[
                    { value: 'auto', label: 'Auto' },
                    ...(message.html ? [{ value: 'html', label: t('mail.htmlLabel') }] : []),
                    ...(message.text ? [{ value: 'plain', label: t('mail.plainTextLabel') }] : []),
                  ]}
                  value={viewMode}
                  onChange={value => setViewMode(value as ViewMode)}
                  size="sm"
                  stretch={false}
                />

                {effectiveMode === 'html' && message.html ? (
                  <button
                    type="button"
                    onClick={() => setShowRemoteImages(value => !value)}
                    title={
                      showRemoteImages
                        ? t('mail.hideRemoteImagesAction')
                        : t('mail.showRemoteImagesAction')
                    }
                    className="text-[11px] px-2 py-1 rounded text-slate-400 hover:text-white hover:bg-white/5 flex items-center gap-1.5 transition-colors"
                  >
                    {showRemoteImages ? <Images size={12} /> : <ImageOff size={12} />}
                    {showRemoteImages
                      ? t('mail.hideRemoteImagesAction')
                      : t('mail.showRemoteImagesAction')}
                  </button>
                ) : null}
              </div>
            ) : null}
          </header>

          {/* Body */}
          <div className="flex-1 min-h-0 overflow-auto">
            <div className="px-4 pt-3">
              <VerificationCodeChip
                messageId={message.id}
                subject={message.subject}
                text={message.text}
                html={message.html}
              />
            </div>
            {effectiveMode === 'html' && message.html ? (
              <MailHtmlSandbox html={message.html} showRemoteImages={showRemoteImages} />
            ) : (
              <pre className="text-xs text-slate-200 whitespace-pre-wrap break-words p-4 font-sans leading-relaxed">
                {message.text || message.html?.replace(/<[^>]+>/g, ' ').trim() || '—'}
              </pre>
            )}
          </div>

          {/* Attachments */}
          {message.attachments.length > 0 ? (
            <footer className="px-4 py-3 border-t border-white/[0.06]">
              <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">
                {t('mail.attachmentsLabel')} · {message.attachments.length}
              </p>
              <ul className="space-y-1">
                {message.attachments.map(attachment => (
                  <li
                    key={attachment.id}
                    className="text-xs text-slate-300 flex items-center gap-2 px-2 py-1 rounded bg-black/20 border border-white/5"
                  >
                    <FileText size={12} className="text-slate-500" />
                    <span className="truncate flex-1">{attachment.filename}</span>
                    <span className="text-slate-500 shrink-0">{attachment.size} B</span>
                  </li>
                ))}
              </ul>
            </footer>
          ) : null}
        </>
      )}
    </section>
  );
}
