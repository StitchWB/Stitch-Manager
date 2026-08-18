import { useMemo, useState, useCallback } from 'react';
import {
  emailInboxConnect,
  emailInboxDelete,
  emailInboxDisconnect,
  emailInboxGetCapabilities,
  emailInboxList,
  emailInboxMarkAsRead,
  emailInboxWaitForEmail,
  type EmailMailboxSession,
  type EmailMessage,
  type EmailProviderType,
} from '@/lib/backend/modules/emailInbox';
import type { IMAPConfig } from '@/stores/registration/types';
import {
  buildEmailQuery,
  buildImapConnectInput,
  buildMailTmConnectInput,
  buildWaitForEmailOptions,
  buildImapAccountIdFromRegistration,
  deriveImapFieldsFromRegistration,
  markMessageAsReadLocal,
  removeMessageLocal,
  upsertMessageById,
} from '@/lib/mail/runtime';

interface UseInboxTabArgs {
  imap: IMAPConfig;
  disabled?: boolean;
  onLog?: (level: 'info' | 'warn' | 'error' | 'success' | 'debug', message: string) => void;
}

export function useInboxTab({ imap, disabled, onLog }: UseInboxTabArgs) {
  const [provider, setProvider] = useState<EmailProviderType>('imap');
  const [mailtmAddress, setMailtmAddress] = useState('');
  const [mailtmPassword, setMailtmPassword] = useState('');
  const [mailtmBaseUrl, setMailtmBaseUrl] = useState('');
  const [session, setSession] = useState<EmailMailboxSession | null>(null);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [queryFrom, setQueryFrom] = useState('');
  const [querySubject, setQuerySubject] = useState('');
  const [queryBody, setQueryBody] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [timeoutMs, setTimeoutMs] = useState(120000);
  const [pollIntervalMs, setPollIntervalMs] = useState(3000);
  const [dedupeKey, setDedupeKey] = useState('');
  const [allExpanded, setAllExpanded] = useState(false);

  const canConnect = useMemo(() => {
    if (provider === 'mail_tm') {
      return Boolean(mailtmAddress.trim() && mailtmPassword.trim());
    }
    const { host: server, username: user, password: pass } = deriveImapFieldsFromRegistration(imap);
    return Boolean(server?.trim() && user?.trim() && pass?.trim());
  }, [provider, mailtmAddress, mailtmPassword, imap]);

  const buildQuery = () =>
    buildEmailQuery({
      from: queryFrom,
      subjectContains: querySubject,
      bodyContains: queryBody,
      unreadOnly,
      limit: 50,
    });

  const log = (level: 'info' | 'warn' | 'error' | 'success' | 'debug', message: string) => {
    onLog?.(level, `[Inbox] ${message}`);
  };

  const handleConnect = async () => {
    if (!canConnect || disabled) return;
    setIsBusy(true);
    try {
      if (session) {
        await emailInboxDisconnect(session.sessionId);
      }

      const input =
        provider === 'mail_tm'
          ? buildMailTmConnectInput({
              accountId: `mailtm:${mailtmAddress}`,
              readOnly: false,
              credentials: {
                address: mailtmAddress,
                password: mailtmPassword,
                baseUrl: mailtmBaseUrl,
              },
            })
          : buildImapConnectInput({
              accountId: buildImapAccountIdFromRegistration(imap),
              mailbox: 'INBOX',
              readOnly: false,
              credentials: deriveImapFieldsFromRegistration(imap),
            });

      const nextSession = await emailInboxConnect(input);
      const caps = await emailInboxGetCapabilities(nextSession.sessionId);
      setSession(nextSession);
      setMessages([]);
      log(
        'success',
        `Connected to ${nextSession.provider}. delete=${caps.canDelete}, markAsRead=${caps.canMarkAsRead}`
      );
    } catch (error) {
      log('error', `Ошибка подключения: ${String(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!session) return;
    setIsBusy(true);
    try {
      await emailInboxDisconnect(session.sessionId);
      setSession(null);
      setMessages([]);
      log('info', 'Отключено');
    } catch (error) {
      log('error', `Ошибка отключения: ${String(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleList = async () => {
    if (!session) return;
    setIsBusy(true);
    try {
      const list = await emailInboxList(session.sessionId, buildQuery());
      setMessages(list);
      log('info', `Загружено ${list.length} сообщений`);
    } catch (error) {
      log('error', `Ошибка списка: ${String(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleWait = async () => {
    if (!session) return;
    setIsBusy(true);
    try {
      const waitOptions = buildWaitForEmailOptions({
        timeoutMs,
        pollIntervalMs,
        dedupeKey,
      });
      const message = await emailInboxWaitForEmail(session.sessionId, buildQuery(), waitOptions);
      setMessages(prev => upsertMessageById(prev, message));
      log('success', `Получено письмо: ${message.subject || '(без темы)'}`);
    } catch (error) {
      log('warn', `Ожидание завершено: ${String(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleMarkAsRead = async (messageId: string) => {
    if (!session) return;
    try {
      await emailInboxMarkAsRead(session.sessionId, messageId);
      setMessages(prev => markMessageAsReadLocal(prev, messageId));
      log('info', `Помечено прочитанным: ${messageId}`);
    } catch (error) {
      log('warn', `Ошибка отметки прочитанным: ${String(error)}`);
    }
  };

  const handleDelete = async (messageId: string) => {
    if (!session) return;
    try {
      await emailInboxDelete(session.sessionId, messageId);
      setMessages(prev => removeMessageLocal(prev, messageId));
      log('info', `Удалено сообщение: ${messageId}`);
    } catch (error) {
      log('warn', `Ошибка удаления: ${String(error)}`);
    }
  };

  const toggleAll = useCallback(() => {
    setAllExpanded(prev => !prev);
  }, []);

  return {
    // Provider state
    provider,
    setProvider,
    mailtmAddress,
    setMailtmAddress,
    mailtmPassword,
    setMailtmPassword,
    mailtmBaseUrl,
    setMailtmBaseUrl,
    canConnect,

    // Session / Messages
    session,
    messages,
    isBusy,

    // Filters
    queryFrom,
    setQueryFrom,
    querySubject,
    setQuerySubject,
    queryBody,
    setQueryBody,
    unreadOnly,
    setUnreadOnly,

    // Advanced
    timeoutMs,
    setTimeoutMs,
    pollIntervalMs,
    setPollIntervalMs,
    dedupeKey,
    setDedupeKey,

    // UI
    allExpanded,
    toggleAll,

    // Handlers
    handleConnect,
    handleDisconnect,
    handleList,
    handleWait,
    handleMarkAsRead,
    handleDelete,
  };
}
