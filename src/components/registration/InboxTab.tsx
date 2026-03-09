import { useMemo, useState } from 'react';
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
  type WaitForEmailOptions,
} from '../../lib/tauri/modules/emailInbox';
import type { IMAPConfig } from '../../stores/registration/types';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';
import { Mail, Search, Timer, Trash2, Eye } from 'lucide-react';
import { cn } from '../../lib/utils';

interface InboxTabProps {
  imap: IMAPConfig;
  disabled?: boolean;
  onLog?: (level: 'info' | 'warn' | 'error' | 'success' | 'debug', message: string) => void;
}

export function InboxTab({ imap, disabled, onLog }: InboxTabProps) {
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
  const [dedupeKey, setDedupeKey] = useState('ui');

  const canConnect = useMemo(() => {
    if (provider === 'mail_tm') {
      return Boolean(mailtmAddress.trim() && mailtmPassword.trim());
    }
    const server = imap.strategy === 'gmail' ? 'imap.gmail.com' : imap.server;
    const user = imap.strategy === 'gmail' ? imap.gmailBase : imap.email;
    const pass = imap.strategy === 'gmail' ? imap.gmailAppPassword : imap.password;
    return Boolean(server?.trim() && user?.trim() && pass?.trim());
  }, [provider, mailtmAddress, mailtmPassword, imap]);

  const buildQuery = () => ({
    from: queryFrom.trim() || null,
    subjectContains: querySubject.trim() || null,
    bodyContains: queryBody.trim() || null,
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
          ? {
              provider: 'mail_tm' as const,
              accountId: `mailtm:${mailtmAddress}`,
              credentials: {
                type: 'mail_tm' as const,
                value: {
                  address: mailtmAddress,
                  password: mailtmPassword,
                  baseUrl: mailtmBaseUrl.trim() || null,
                },
              },
              options: { mailbox: null, readOnly: false },
            }
          : {
              provider: 'imap' as const,
              accountId: `imap:${imap.email || imap.gmailBase}`,
              credentials: {
                type: 'imap' as const,
                value: {
                  host: imap.strategy === 'gmail' ? 'imap.gmail.com' : imap.server,
                  port: imap.port,
                  username: imap.strategy === 'gmail' ? imap.gmailBase : imap.email,
                  password: imap.strategy === 'gmail' ? imap.gmailAppPassword : imap.password,
                  useTls: imap.useTLS,
                },
              },
              options: { mailbox: 'INBOX', readOnly: false },
            };

      const nextSession = await emailInboxConnect(input);
      const caps = await emailInboxGetCapabilities(nextSession.sessionId);
      setSession(nextSession);
      setMessages([]);
      log(
        'success',
        `Connected to ${nextSession.provider}. delete=${caps.canDelete}, markAsRead=${caps.canMarkAsRead}`
      );
    } catch (error) {
      log('error', `Connect failed: ${String(error)}`);
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
      log('info', 'Disconnected');
    } catch (error) {
      log('error', `Disconnect failed: ${String(error)}`);
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
      log('info', `Loaded ${list.length} message(s)`);
    } catch (error) {
      log('error', `List failed: ${String(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleWait = async () => {
    if (!session) return;
    setIsBusy(true);
    try {
      const waitOptions: WaitForEmailOptions = {
        timeoutMs,
        pollIntervalMs,
        dedupeKey: dedupeKey.trim() || null,
      };
      const message = await emailInboxWaitForEmail(session.sessionId, buildQuery(), waitOptions);
      setMessages(prev => [message, ...prev.filter(m => m.id !== message.id)]);
      log('success', `Email received: ${message.subject || '(no subject)'}`);
    } catch (error) {
      log('warn', `Wait finished: ${String(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleMarkAsRead = async (messageId: string) => {
    if (!session) return;
    try {
      await emailInboxMarkAsRead(session.sessionId, messageId);
      setMessages(prev => prev.map(m => (m.id === messageId ? { ...m, isRead: true } : m)));
      log('info', `Marked as read: ${messageId}`);
    } catch (error) {
      log('warn', `Mark as read failed: ${String(error)}`);
    }
  };

  const handleDelete = async (messageId: string) => {
    if (!session) return;
    try {
      await emailInboxDelete(session.sessionId, messageId);
      setMessages(prev => prev.filter(m => m.id !== messageId));
      log('info', `Deleted message: ${messageId}`);
    } catch (error) {
      log('warn', `Delete failed: ${String(error)}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card border border-white/10 p-4 space-y-3">
        <div className="flex items-center gap-2 text-white text-sm font-semibold">
          <Mail className="w-4 h-4" /> Inbox Provider
        </div>

        <Select
          label="Provider"
          value={provider}
          onValueChange={value => setProvider(value as EmailProviderType)}
          options={[
            { value: 'imap', label: 'IMAP' },
            { value: 'mail_tm', label: 'Mail.tm' },
          ]}
          disabled={disabled || isBusy || Boolean(session)}
        />

        {provider === 'mail_tm' && (
          <div className="grid grid-cols-1 gap-3">
            <Input
              label="Mail.tm address"
              value={mailtmAddress}
              onChange={e => setMailtmAddress(e.target.value)}
              placeholder="name@domain"
              disabled={disabled || isBusy || Boolean(session)}
            />
            <Input
              label="Mail.tm password"
              type="password"
              value={mailtmPassword}
              onChange={e => setMailtmPassword(e.target.value)}
              placeholder="password"
              disabled={disabled || isBusy || Boolean(session)}
            />
            <Input
              label="Mail.tm base URL (optional)"
              value={mailtmBaseUrl}
              onChange={e => setMailtmBaseUrl(e.target.value)}
              placeholder="https://api.mail.tm"
              disabled={disabled || isBusy || Boolean(session)}
            />
          </div>
        )}

        <div className="flex gap-2">
          <Button
            onClick={handleConnect}
            disabled={!canConnect || disabled || isBusy || Boolean(session)}
          >
            Connect
          </Button>
          <Button
            variant="secondary"
            onClick={handleDisconnect}
            disabled={!session || isBusy || disabled}
          >
            Disconnect
          </Button>
        </div>

        {session && (
          <div className="text-xs text-slate-400">
            session: <span className="text-slate-200">{session.sessionId}</span>
          </div>
        )}
      </div>

      <div className={cn('card border border-white/10 p-4 space-y-3', !session && 'opacity-60')}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Input
            label="From contains"
            value={queryFrom}
            onChange={e => setQueryFrom(e.target.value)}
            disabled={!session || disabled || isBusy}
          />
          <Input
            label="Subject contains"
            value={querySubject}
            onChange={e => setQuerySubject(e.target.value)}
            disabled={!session || disabled || isBusy}
          />
          <Input
            label="Body contains"
            value={queryBody}
            onChange={e => setQueryBody(e.target.value)}
            disabled={!session || disabled || isBusy}
          />
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={e => setUnreadOnly(e.target.checked)}
                disabled={!session || disabled || isBusy}
              />
              Unread only
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Input
            label="Timeout ms"
            type="number"
            value={String(timeoutMs)}
            onChange={e => setTimeoutMs(Number(e.target.value) || 120000)}
            disabled={!session || disabled || isBusy}
          />
          <Input
            label="Poll interval ms"
            type="number"
            value={String(pollIntervalMs)}
            onChange={e => setPollIntervalMs(Number(e.target.value) || 3000)}
            disabled={!session || disabled || isBusy}
          />
          <Input
            label="Dedupe key"
            value={dedupeKey}
            onChange={e => setDedupeKey(e.target.value)}
            disabled={!session || disabled || isBusy}
          />
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button onClick={handleList} disabled={!session || disabled || isBusy}>
            <Search className="w-4 h-4" /> List
          </Button>
          <Button
            onClick={handleWait}
            disabled={!session || disabled || isBusy}
            variant="secondary"
          >
            <Timer className="w-4 h-4" /> Wait for email
          </Button>
        </div>
      </div>

      <div className="card border border-white/10 p-4 space-y-3">
        <div className="text-sm font-semibold text-white">Messages ({messages.length})</div>
        <div className="space-y-2 max-h-[320px] overflow-auto pr-1">
          {messages.map(message => (
            <div key={message.id} className="rounded-lg border border-white/10 p-3 space-y-2">
              <div className="text-xs text-slate-400">{message.receivedAt}</div>
              <div className="text-sm text-white font-medium truncate">
                {message.subject || '(no subject)'}
              </div>
              <div className="text-xs text-slate-300">from: {message.from?.email || '-'}</div>
              <div className="text-xs text-slate-400 line-clamp-2">
                {message.text || message.html || ''}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleMarkAsRead(message.id)}
                  disabled={!session || isBusy || message.isRead}
                >
                  <Eye className="w-3.5 h-3.5" /> Mark read
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(message.id)}
                  disabled={!session || isBusy}
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </Button>
              </div>
            </div>
          ))}
          {messages.length === 0 && (
            <div className="text-xs text-slate-500">No messages loaded</div>
          )}
        </div>
      </div>
    </div>
  );
}
