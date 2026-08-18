import type { IMAPConfig } from '@/stores/registration/types';

export interface DerivedRegistrationImapFields {
  host: string;
  port: number;
  username: string;
  password: string;
  useTls: boolean;
}

export function deriveImapFieldsFromRegistration(imap: IMAPConfig): DerivedRegistrationImapFields {
  const host = imap.strategy === 'gmail' ? 'imap.gmail.com' : imap.server;
  const username = imap.strategy === 'gmail' ? imap.gmailBase : imap.email;
  const password = imap.strategy === 'gmail' ? imap.gmailAppPassword : imap.password;

  return {
    host,
    port: imap.port,
    username,
    password,
    useTls: imap.useTLS,
  };
}

export function buildImapAccountIdFromRegistration(imap: IMAPConfig): string {
  const username = imap.strategy === 'gmail' ? imap.gmailBase : imap.email;
  return `imap:${username}`;
}
