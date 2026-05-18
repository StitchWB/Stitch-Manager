import { useEffect, useMemo, useRef, useState } from 'react';
import { MailOpen, Paperclip, Trash2 } from 'lucide-react';
import { Badge, Button, Checkbox, EmptyState } from '@/components/ui';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { EmailMessage, ProviderCapabilities } from '@/lib/tauri/modules/emailInbox';

const VIRTUAL_ROW_HEIGHT = 64;
const VIRTUAL_OVERSCAN = 8;

interface MailMessageListProps {
  messages: EmailMessage[];
  selectedMessageId: string | null;
  capabilities: ProviderCapabilities | null;
  busy: boolean;
  onSelectMessage: (messageId: string) => Promise<void>;
  onMarkRead: (messageId: string) => Promise<void>;
  onDelete: (messageId: string) => Promise<void>;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.round(diffMs / 1000);

  // Future or "just now": clamp to "now"
  if (diffSec < 45) return 'now';
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m`;

  const sameDay =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (sameDay) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Yesterday
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear()
  ) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays < 7) {
    // Within a week: weekday short ("Mon", "Tue", ...)
    return date.toLocaleDateString([], { weekday: 'short' });
  }

  const sameYear = date.getFullYear() === now.getFullYear();
  if (sameYear) {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

function getSenderLabel(message: EmailMessage): string {
  if (message.from?.name && message.from.name.trim()) {
    return message.from.name.trim();
  }
  if (message.from?.email) {
    return message.from.email;
  }
  return '—';
}

function getMessagePreview(message: EmailMessage): string {
  const source = message.text || message.html || '';
  return source.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function MailMessageList({
  messages,
  selectedMessageId,
  capabilities,
  busy,
  onSelectMessage,
  onMarkRead,
  onDelete,
}: MailMessageListProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(520);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const useVirtualizedList = messages.length > 80;

  // Reset bulk selection when message set changes
  useEffect(() => {
    setSelectedIds(prev => prev.filter(id => messages.some(message => message.id === id)));
  }, [messages]);

  const virtualSlice = useMemo(() => {
    if (!useVirtualizedList) {
      return {
        topSpacer: 0,
        bottomSpacer: 0,
        rows: messages,
      };
    }

    const startIndex = Math.max(0, Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN);
    const visibleCount =
      Math.ceil(Math.max(viewportHeight, 1) / VIRTUAL_ROW_HEIGHT) + VIRTUAL_OVERSCAN * 2;
    const endIndex = Math.min(messages.length, startIndex + visibleCount);

    return {
      topSpacer: startIndex * VIRTUAL_ROW_HEIGHT,
      bottomSpacer: Math.max(0, (messages.length - endIndex) * VIRTUAL_ROW_HEIGHT),
      rows: messages.slice(startIndex, endIndex),
    };
  }, [messages, scrollTop, useVirtualizedList, viewportHeight]);

  const selectableIds = useMemo(() => messages.map(message => message.id), [messages]);
  const allSelected =
    selectableIds.length > 0 && selectableIds.every(id => selectedIds.includes(id));
  const selectedCount = selectedIds.length;

  const messageIndexById = useMemo(() => {
    const map = new Map<string, number>();
    messages.forEach((message, index) => {
      map.set(message.id, index);
    });
    return map;
  }, [messages]);

  const selectAll = (checked: boolean) => {
    setSelectedIds(checked ? selectableIds : []);
  };

  const toggleSelect = (id: string, checked: boolean) => {
    setSelectedIds(prev => {
      if (checked) {
        return prev.includes(id) ? prev : [...prev, id];
      }
      return prev.filter(item => item !== id);
    });
  };

  const clearSelection = () => setSelectedIds([]);

  const bulkMarkRead = async () => {
    for (const id of selectedIds) {
      await onMarkRead(id);
    }
    clearSelection();
  };

  const bulkDelete = async () => {
    for (const id of selectedIds) {
      await onDelete(id);
    }
    clearSelection();
  };

  const moveSelectionBy = (delta: number) => {
    if (messages.length === 0) {
      return;
    }

    const currentIndex = selectedMessageId ? (messageIndexById.get(selectedMessageId) ?? -1) : -1;
    const nextIndex =
      currentIndex < 0
        ? delta > 0
          ? 0
          : messages.length - 1
        : Math.max(0, Math.min(messages.length - 1, currentIndex + delta));

    const nextMessage = messages[nextIndex];
    if (!nextMessage) {
      return;
    }

    void onSelectMessage(nextMessage.id);

    if (scrollContainerRef.current) {
      const top = nextIndex * VIRTUAL_ROW_HEIGHT;
      const bottom = top + VIRTUAL_ROW_HEIGHT;
      const viewportTop = scrollContainerRef.current.scrollTop;
      const viewportBottom = viewportTop + scrollContainerRef.current.clientHeight;

      if (top < viewportTop) {
        scrollContainerRef.current.scrollTo({ top, behavior: 'smooth' });
      } else if (bottom > viewportBottom) {
        scrollContainerRef.current.scrollTo({
          top: Math.max(0, bottom - scrollContainerRef.current.clientHeight),
          behavior: 'smooth',
        });
      }
    }
  };

  return (
    <section className="bg-white/[0.03] border border-white/[0.08] rounded-xl flex flex-col h-full min-h-[420px] overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-3 py-2 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          {messages.length > 0 ? (
            <Checkbox
              checked={allSelected}
              onChange={event => selectAll(event.target.checked)}
              className="py-0 px-0"
            />
          ) : null}
          <h2 className="text-xs font-semibold text-white tracking-wide">
            {t('mail.messagesTitle')}
          </h2>
          <Badge size="sm" variant="outline">
            {messages.length}
          </Badge>
        </div>
        <p className="text-[10px] text-slate-500 hidden md:block">{t('mail.keyboardHint')}</p>
      </header>

      {selectedCount > 0 ? (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-indigo-500/[0.05] border-b border-indigo-400/15">
          <Badge size="sm" variant="info">
            {t('mail.selectedCountLabel')}: {selectedCount}
          </Badge>
          <Button
            size="xs"
            variant="ghost"
            disabled={busy || !capabilities?.canMarkAsRead}
            onClick={() => {
              void bulkMarkRead();
            }}
          >
            {t('mail.bulkMarkReadAction')}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={busy || !capabilities?.canDelete}
            onClick={() => {
              void bulkDelete();
            }}
          >
            {t('mail.bulkDeleteAction')}
          </Button>
          <Button size="xs" variant="ghost" onClick={clearSelection}>
            {t('mail.clearSelectionAction')}
          </Button>
        </div>
      ) : null}

      {messages.length === 0 ? (
        <EmptyState
          icon={MailOpen}
          title={t('mail.noMessagesTitle')}
          description={t('mail.noMessagesDescription')}
          className="py-12 flex-1"
        />
      ) : (
        <div
          ref={scrollContainerRef}
          tabIndex={0}
          role="listbox"
          aria-label={t('mail.messagesTitle')}
          className="overflow-auto flex-1 min-h-0 outline-none"
          onScroll={event => {
            const target = event.currentTarget;
            setScrollTop(target.scrollTop);
            setViewportHeight(target.clientHeight);
          }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              moveSelectionBy(1);
              return;
            }

            if (event.key === 'ArrowUp') {
              event.preventDefault();
              moveSelectionBy(-1);
              return;
            }

            if (event.key === 'Enter' && selectedMessageId) {
              event.preventDefault();
              void onSelectMessage(selectedMessageId);
            }
          }}
        >
          <div
            style={{
              paddingTop: virtualSlice.topSpacer,
              paddingBottom: virtualSlice.bottomSpacer,
            }}
          >
            {virtualSlice.rows.map(message => {
              const selected = message.id === selectedMessageId;
              const checked = selectedIds.includes(message.id);
              const sender = getSenderLabel(message);
              const preview = getMessagePreview(message);

              return (
                <div
                  key={message.id}
                  role="option"
                  aria-selected={selected}
                  className={cn(
                    'group flex items-start gap-2 px-3 py-2 border-b border-white/[0.04] cursor-pointer transition-colors',
                    selected
                      ? 'bg-indigo-500/[0.12] border-l-2 border-l-indigo-400'
                      : message.isRead
                        ? 'border-l-2 border-l-transparent hover:bg-white/[0.03]'
                        : 'border-l-2 border-l-transparent bg-white/[0.02] hover:bg-white/[0.05]'
                  )}
                  onClick={() => {
                    if (busy) return;
                    void onSelectMessage(message.id);
                  }}
                >
                  <Checkbox
                    checked={checked}
                    onChange={event => toggleSelect(message.id, event.target.checked)}
                    className="py-0 px-0 mt-0.5 shrink-0"
                    onClick={event => event.stopPropagation()}
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <p
                        className={cn(
                          'text-[12px] truncate',
                          message.isRead ? 'text-slate-300' : 'text-white font-semibold'
                        )}
                      >
                        {sender}
                      </p>
                      <div className="flex items-center gap-2 shrink-0">
                        {message.attachments.length > 0 ? (
                          <Paperclip size={11} className="text-slate-500" />
                        ) : null}
                        <span className="text-[10px] text-slate-500 whitespace-nowrap">
                          {formatTimestamp(message.receivedAt)}
                        </span>
                      </div>
                    </div>

                    <p
                      className={cn(
                        'text-[12px] truncate mb-0.5',
                        message.isRead ? 'text-slate-400' : 'text-slate-200 font-medium'
                      )}
                    >
                      {message.subject || '—'}
                    </p>

                    {preview ? (
                      <p className="text-[11px] text-slate-500 truncate">{preview}</p>
                    ) : null}
                  </div>

                  {/* Hover-only quick actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    {!message.isRead && capabilities?.canMarkAsRead ? (
                      <button
                        type="button"
                        title={t('mail.markReadAction')}
                        disabled={busy}
                        onClick={event => {
                          event.stopPropagation();
                          void onMarkRead(message.id);
                        }}
                        className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-50"
                      >
                        <MailOpen size={12} />
                      </button>
                    ) : null}
                    {capabilities?.canDelete ? (
                      <button
                        type="button"
                        title={t('mail.deleteAction')}
                        disabled={busy}
                        onClick={event => {
                          event.stopPropagation();
                          void onDelete(message.id);
                        }}
                        className="p-1 rounded text-slate-400 hover:text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                      >
                        <Trash2 size={12} />
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
