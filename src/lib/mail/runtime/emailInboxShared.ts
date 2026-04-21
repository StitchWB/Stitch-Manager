import type {
  EmailConnectInput,
  EmailMessage,
  EmailQuery,
  ImapConnectCredentials,
  MailTmConnectCredentials,
  WaitForEmailOptions,
} from '@/lib/tauri/modules/emailInbox';

type NullableString = string | null | undefined;

function toTrimmedOrNull(value: NullableString): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildImapConnectInput(args: {
  accountId?: string;
  mailbox?: NullableString;
  readOnly: boolean;
  credentials: ImapConnectCredentials;
}): EmailConnectInput {
  const accountId = toTrimmedOrNull(args.accountId) ?? `imap:${args.credentials.username.trim()}`;
  const mailbox = toTrimmedOrNull(args.mailbox) ?? 'INBOX';

  return {
    provider: 'imap',
    accountId,
    credentials: {
      type: 'imap',
      value: {
        host: args.credentials.host.trim(),
        port: args.credentials.port,
        username: args.credentials.username.trim(),
        password: args.credentials.password,
        useTls: args.credentials.useTls ?? true,
      },
    },
    options: {
      mailbox,
      readOnly: args.readOnly,
    },
  };
}

export function buildMailTmConnectInput(args: {
  accountId?: string;
  readOnly: boolean;
  credentials: MailTmConnectCredentials;
}): EmailConnectInput {
  const address = args.credentials.address.trim();
  const accountId = toTrimmedOrNull(args.accountId) ?? `mailtm:${address}`;

  return {
    provider: 'mail_tm',
    accountId,
    credentials: {
      type: 'mail_tm',
      value: {
        address,
        password: args.credentials.password,
        baseUrl: toTrimmedOrNull(args.credentials.baseUrl),
      },
    },
    options: {
      mailbox: null,
      readOnly: args.readOnly,
    },
  };
}

export function buildEmailQuery(args: {
  from?: NullableString;
  to?: NullableString;
  subjectContains?: NullableString;
  bodyContains?: NullableString;
  unreadOnly?: boolean;
  since?: NullableString;
  limit?: number;
}): EmailQuery {
  return {
    from: toTrimmedOrNull(args.from),
    to: toTrimmedOrNull(args.to),
    subjectContains: toTrimmedOrNull(args.subjectContains),
    bodyContains: toTrimmedOrNull(args.bodyContains),
    unreadOnly: typeof args.unreadOnly === 'boolean' ? args.unreadOnly : null,
    since: toTrimmedOrNull(args.since),
    limit: typeof args.limit === 'number' ? args.limit : null,
  };
}

export function buildWaitForEmailOptions(args: {
  timeoutMs?: number;
  pollIntervalMs?: number;
  dedupeKey?: NullableString;
}): WaitForEmailOptions {
  return {
    timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : null,
    pollIntervalMs: typeof args.pollIntervalMs === 'number' ? args.pollIntervalMs : null,
    dedupeKey: toTrimmedOrNull(args.dedupeKey),
  };
}

export function upsertMessageById(messages: EmailMessage[], message: EmailMessage): EmailMessage[] {
  return [message, ...messages.filter(item => item.id !== message.id)];
}

export function markMessageAsReadLocal(
  messages: EmailMessage[],
  messageId: string
): EmailMessage[] {
  return messages.map(item =>
    item.id === messageId
      ? {
          ...item,
          isRead: true,
        }
      : item
  );
}

export function removeMessageLocal(messages: EmailMessage[], messageId: string): EmailMessage[] {
  return messages.filter(item => item.id !== messageId);
}
