import { t } from '@/lib/i18n';
import { Tooltip } from '@/components/Tooltip';
import { Button, EmptyState, GlassCard } from '@/components/ui';
import { Mail, Trash2, Eye, MessageSquare } from 'lucide-react';
import { CollapsibleSection } from '@/components/ui';
import type { EmailMessage } from '@/lib/tauri/modules/emailInbox';

export interface InboxMessagesSectionProps {
  messages: EmailMessage[];
  session: unknown;
  isBusy: boolean;
  disabled?: boolean;
  onMarkAsRead: (messageId: string) => void;
  onDelete: (messageId: string) => void;
  allExpanded: boolean;
}

export function InboxMessagesSection({
  messages,
  session,
  isBusy,
  disabled,
  onMarkAsRead,
  onDelete,
  allExpanded,
}: InboxMessagesSectionProps) {
  return (
    <CollapsibleSection
      title={`Сообщения (${messages.length})`}
      description="Полученные письма"
      icon={<MessageSquare className="w-5 h-5 text-slate-400" />}
      defaultExpanded={allExpanded || false}
      disabled={disabled}
      className="p-3"
    >
      <div className="space-y-4 max-h-[240px] overflow-auto pr-1">
        {messages.map(message => (
          <GlassCard key={message.id} className="p-3 space-y-2">
            <div className="text-xs text-slate-400">{message.receivedAt}</div>
            <div className="text-sm text-white font-medium truncate">
              {message.subject || t('autoReg.inboxMessagesSection.noSubject')}
            </div>
            <div className="text-xs text-slate-300">{t('autoReg.inboxMessagesSection.from')}{': '}{message.from?.email || '-'}</div>
            <div className="text-xs text-slate-400 line-clamp-2">
              {message.text || message.html || ''}
            </div>
            <div className="flex gap-2">
              <Tooltip content={t('autoReg.inboxMessagesSection.markAsReadTooltip')}>
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<Eye className="w-4 h-4" />}
                  onClick={() => onMarkAsRead(message.id)}
                  disabled={!session || isBusy || message.isRead}
                >
                  {t('autoReg.inboxMessagesSection.readButton')}
                </Button>
              </Tooltip>
              <Tooltip content={t('autoReg.inboxMessagesSection.deleteTooltip')}>
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<Trash2 className="w-4 h-4" />}
                  onClick={() => onDelete(message.id)}
                  disabled={!session || isBusy}
                >
                  {t('autoReg.inboxMessagesSection.deleteButton')}
                </Button>
              </Tooltip>
            </div>
          </GlassCard>
        ))}
        {messages.length === 0 && (
          <EmptyState
            icon={Mail}
            title={t('autoReg.inboxMessagesSection.emptyTitle')}
            description={t('autoReg.inboxMessagesSection.emptyDescription')}
          />
        )}
      </div>
    </CollapsibleSection>
  );
}
