/**
 * Mailbox provider presets — lets the UI group mailbox profiles by their
 * underlying email provider (iCloud / Gmail / generic IMAP / Mail.tm) and
 * pre-fill connection fields for well-known providers so the user does not
 * have to remember IMAP host/port/TLS settings.
 */

import type { EmailInboxProfile } from '@/lib/backend/modules/emailInbox';

export type MailboxProviderKind = 'icloud' | 'gmail' | 'imap' | 'mail_tm';

export interface ImapPreset {
  host: string;
  port: number;
  useTls: boolean;
}

export const ICLOUD_IMAP_PRESET: ImapPreset = {
  host: 'imap.mail.me.com',
  port: 993,
  useTls: true,
};

export const GMAIL_IMAP_PRESET: ImapPreset = {
  host: 'imap.gmail.com',
  port: 993,
  useTls: true,
};

const ICLOUD_HOST_PATTERN = /(^|\.)mail\.me\.com$/i;
const GMAIL_HOST_PATTERN = /(^|\.)gmail\.com$/i;

/**
 * Detect which known provider a profile's IMAP host belongs to. Falls back
 * to generic 'imap' when the host does not match a known preset, and to
 * 'mail_tm' for Mail.tm profiles.
 */
export function detectMailboxProviderKind(profile: EmailInboxProfile): MailboxProviderKind {
  if (profile.connectInput.provider === 'mail_tm') {
    return 'mail_tm';
  }

  if (profile.connectInput.credentials.type !== 'imap') {
    return 'imap';
  }

  const host = profile.connectInput.credentials.value.host?.trim().toLowerCase() ?? '';
  if (ICLOUD_HOST_PATTERN.test(host)) return 'icloud';
  if (GMAIL_HOST_PATTERN.test(host)) return 'gmail';
  return 'imap';
}

/**
 * Detect provider kind from a raw host string (used while the user is still
 * typing in the manual-connect form, before a profile exists).
 */
export function detectProviderKindFromHost(host: string): MailboxProviderKind {
  const normalized = host.trim().toLowerCase();
  if (ICLOUD_HOST_PATTERN.test(normalized)) return 'icloud';
  if (GMAIL_HOST_PATTERN.test(normalized)) return 'gmail';
  return 'imap';
}

export function getPresetForKind(kind: MailboxProviderKind): ImapPreset | null {
  if (kind === 'icloud') return ICLOUD_IMAP_PRESET;
  if (kind === 'gmail') return GMAIL_IMAP_PRESET;
  return null;
}
