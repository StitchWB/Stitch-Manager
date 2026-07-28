/**
 * Helpers for the "Open Mail for account" deep-link flow.
 *
 * The Accounts page produces `/mail?account=<id>` URLs via AccountInboxButton.
 * The Mail page consumes the param: it loads the account, resolves the
 * appropriate mailbox profile via `resolveMailboxProfileForAccount`, switches
 * to that profile, and applies a `to: account.email` filter so the user only
 * sees the subset of mail destined for the chosen account.
 */

import type { Account } from '@/types/generated';
import type { EmailInboxProfile } from '@/lib/backend/modules/emailInbox';
import { listAccounts } from '@/lib/backend/modules/accounts';
import {
  buildAccountInboxQuery,
  resolveMailboxProfileForAccount,
  type MailboxResolution,
} from './resolveMailbox';

export const ACCOUNT_QUERY_PARAM = 'account';

export interface AccountScopeContext {
  account: Account;
  resolution: MailboxResolution;
  /** Filter that should be merged into the mail store query. */
  filter: { to?: string; search?: string };
}

/**
 * Load an account by id and resolve the mailbox profile that should serve as
 * its inbox. Returns null when the account does not exist or has no email.
 *
 * Avoids loading all accounts when possible: we still call `listAccounts()`
 * because there is no `getAccountById` Backend command exposed; this is the
 * existing convention in the codebase.
 */
export async function buildAccountScopeContext(
  accountId: number | string,
  profiles: EmailInboxProfile[]
): Promise<AccountScopeContext | null> {
  const numericId = Number(accountId);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return null;
  }

  const accounts = await listAccounts();
  const account = accounts.find(item => item.id === numericId) ?? null;
  if (!account) {
    return null;
  }

  const resolution = resolveMailboxProfileForAccount(
    {
      email: account.email,
      metadata: account.metadata ?? null,
      provider: account.provider,
    },
    profiles
  );

  return {
    account,
    resolution,
    filter: buildAccountInboxQuery({ email: account.email }, resolution),
  };
}
