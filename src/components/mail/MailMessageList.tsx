import { useMemo, useRef, useState } from 'react';
import { MailOpen, Paperclip, Trash2 } from 'lucide-react';
import { Badge, Button, Checkbox, EmptyState } from '@/components/ui';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { EmailMessage, ProviderCapabilities } from '@/lib/tauri/modules/emailInbox';

const VIRTUAL_ROW_HEIGHT = 164;
const VIRTUAL_OVERSCAN = 6;

interface MailMessageListProps {
  messages: EmailMessage[];
  selectedMessageId: string | null;
  capabilities: ProviderCapabilities | null;
  busy: boolean;
  onSelectMessage: (messageId: string) => Promise<void>;
  onMarkRead: (messageId: string) => Promise<void>;
  onDelete: (messageId: string) => Promise<void>;
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

  const openSelected = () => {
    if (!selectedMessageId) {
      return;
    }
    void onSelectMessage(selectedMessageId);
  };

  return (
    <section className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-3 flex flex-col h-full min-h-[420px]">
      <div className="sticky top-0 z-10 bg-[#0b0d14]/95 backdrop-blur border-b border-white/10 pb-2 mb-2 px-1 pt-1">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-white tracking-wide">
            {t('mail.messagesTitle')}
          </h2>
          <Badge size="sm" variant="outline">
            {messages.length}
          </Badge>
        </div>
        <p className="text-[10px] text-slate-500 mt-1">{t('mail.keyboardHint')}</p>
      </div>

      {messages.length > 0 ? (
        <div className="sticky top-[54px] z-10 rounded-lg border border-white/10 bg-black/35 p-2 mb-2 flex flex-wrap items-center gap-2">
          <Checkbox
            checked={allSelected}
            onChange={event => selectAll(event.target.checked)}
            label={t('mail.selectAllLabel')}
            className="py-0 px-0"
          />
          <Badge size="sm" variant="outline">
            {t('mail.selectedCountLabel')}: {selectedCount}
          </Badge>
          <Button
            size="xs"
            variant="ghost"
            disabled={busy || selectedCount === 0}
            onClick={() => {
              void bulkMarkRead();
            }}
          >
            {t('mail.bulkMarkReadAction')}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={busy || selectedCount === 0}
            onClick={() => {
              void bulkDelete();
            }}
          >
            {t('mail.bulkDeleteAction')}
          </Button>
          <Button size="xs" variant="ghost" disabled={selectedCount === 0} onClick={clearSelection}>
            {t('mail.clearSelectionAction')}
          </Button>
        </div>
      ) : null}

      {messages.length === 0 ? (
        <EmptyState
          icon={MailOpen}
          title={t('mail.noMessagesTitle')}
          description={t('mail.noMessagesDescription')}
          className="py-12"
        />
      ) : (
        <div
          ref={scrollContainerRef}
          tabIndex={0}
          role="listbox"
          aria-label={t('mail.messagesTitle')}
          className="overflow-auto pr-1 min-h-0"
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

            if (event.key === 'Enter') {
              event.preventDefault();
              openSelected();
            }
          }}
        >
          <div
            className="space-y-1.5"
            style={{
              paddingTop: virtualSlice.topSpacer,
              paddingBottom: virtualSlice.bottomSpacer,
            }}
          >
            {virtualSlice.rows.map(message => {
              const selected = message.id === selectedMessageId;
              const checked = selectedIds.includes(message.id);
              const excerpt = (message.text || message.html || '-').replace(/\s+/g, ' ').trim();

              return (
                <article
                  key={message.id}
                  className={cn(
                    'w-full rounded-lg border p-3 space-y-2 text-left transition-colors',
                    selected
                      ? 'border-indigo-400/70 bg-indigo-500/14 shadow-[0_0_0_1px_rgba(129,140,248,0.15)]'
                      : 'border-white/10 bg-black/20 hover:border-white/20 hover:bg-black/25'
                  )}
                  style={
                    useVirtualizedList ? { minHeight: `${VIRTUAL_ROW_HEIGHT - 10}px` } : undefined
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      <Checkbox
                        checked={checked}
                        onChange={event => toggleSelect(message.id, event.target.checked)}
                        className="py-0 px-0 mt-0.5"
                      />
                      <p className="text-[13px] font-medium text-white truncate">
                        {message.subject || '-'}
                      </p>
                    </div>
                    <span className="text-[10px] text-slate-500 whitespace-nowrap">
                      {new Date(message.receivedAt).toLocaleTimeString()}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-slate-300 truncate">{message.from?.email || '-'}</p>
                    {message.attachments.length > 0 ? (
                      <span className="flex items-center gap-1 text-[10px] text-slate-500 shrink-0">
                        <Paperclip size={10} />
                        {message.attachments.length}
                      </span>
                    ) : null}
                  </div>

                  <p className="text-xs text-slate-500 line-clamp-2 min-h-[32px]">{excerpt}</p>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-slate-500">
                      {message.isRead ? t('mail.readStateRead') : t('mail.readStateUnread')}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="xs"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => {
                          void onSelectMessage(message.id);
                        }}
                      >
                        {t('mail.loadMessageAction')}
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={!capabilities?.canMarkAsRead || busy || message.isRead}
                        onClick={event => {
                          event.stopPropagation();
                          void onMarkRead(message.id);
                        }}
                        leftIcon={<MailOpen size={12} />}
                      >
                        {t('mail.markReadAction')}
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={!capabilities?.canDelete || busy}
                        onClick={event => {
                          event.stopPropagation();
                          void onDelete(message.id);
                        }}
                        leftIcon={<Trash2 size={12} />}
                      >
                        {t('mail.deleteAction')}
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
