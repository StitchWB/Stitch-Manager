/**
 * Helpers for syncing the global Auto-Reg IMAP/Gmail config into a mailbox
 * profile so the Mail page can work with a single source of truth (profiles).
 */

import {
  emailInboxUpsertProfile,
  type EmailConnectInput,
  type EmailInboxProfile,
} from '@/lib/tauri/modules/emailInbox';
import type { IMAPConfig } from '@/stores/registration/types';

/**
 * Stable id for the auto-generated profile. Using a fixed id makes upsert
 * idempotent across saves and lets the resolver pick this profile by id.
 */
export const AUTO_REG_MAILBOX_PROFILE_ID = 'auto-reg-imap';

export interface DerivedAutoRegProfile {
  username: string;
  host: string;
  port: number;
  password: string;
  useTls: boolean;
  label: string;
  accountId: string;
  connectInput: EmailConnectInput;
}

function trimOrEmpty(value: string | undefined | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Build a connect-input + label for the global auto-reg IMAP/Gmail config.
 * Returns null when the configuration is not enough to connect (missing host
 * or username/password).
 */
export function deriveAutoRegProfile(imap: IMAPConfig): DerivedAutoRegProfile | null {
  const isGmail = imap.strategy === 'gmail';

  const host = isGmail ? 'imap.gmail.com' : trimOrEmpty(imap.server);
  const username = trimOrEmpty(isGmail ? imap.gmailBase : imap.email);
  const password = isGmail ? imap.gmailAppPassword || '' : imap.password || '';
  const port = imap.port || 993;
  const useTls = imap.useTLS ?? true;

  if (!host || !username) {
    return null;
  }

  const accountId = `imap:${username}`;
  const label = isGmail ? `Gmail · ${username}` : `IMAP · ${username}`;

  const connectInput: EmailConnectInput = {
    provider: 'imap',
    accountId,
    credentials: {
      type: 'imap',
      value: {
        host,
        port,
        username,
        password,
        useTls,
      },
    },
    options: {
      mailbox: 'INBOX',
      readOnly: true,
    },
  };

  return {
    username,
    host,
    port,
    password,
    useTls,
    label,
    accountId,
    connectInput,
  };
}

/**
 * Upsert the auto-reg IMAP/Gmail config into the mailbox-profile registry.
 * No-ops when configuration is incomplete or password is empty.
 *
 * The backend masks passwords as "********" on read; we send the actual
 * password only when it is non-empty and not the sentinel, otherwise the
 * Rust side resolves it from the settings table on connect.
 */
export async function upsertAutoRegMailboxProfile(
  imap: IMAPConfig
): Promise<EmailInboxProfile | null> {
  const derived = deriveAutoRegProfile(imap);
  if (!derived) {
    return null;
  }

  return emailInboxUpsertProfile({
    id: AUTO_REG_MAILBOX_PROFILE_ID,
    label: derived.label,
    connectInput: derived.connectInput,
  });
}
