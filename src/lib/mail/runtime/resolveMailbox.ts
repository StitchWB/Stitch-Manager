/**
 * Resolves the best mailbox profile for a given account by trying a sequence
 * of strategies (metadata override, exact mail.tm match, plus-alias, gmail
 * dot-alias, catch-all by domain, alias-service fallbacks, and finally the
 * shared auto-reg IMAP profile).
 *
 * Used by the Accounts page to build "Open Mail" deep-links and by the Mail
 * page to apply an account-scoped inbox filter.
 */

import type { EmailInboxProfile } from '@/lib/backend/modules/emailInbox';
import { AUTO_REG_MAILBOX_PROFILE_ID } from './autoRegProfile';

export type ResolveReason =
  | 'metadata' // explicit binding via account.metadata.mailbox_profile_id
  | 'plus-alias' // user+xxx@domain → user@domain
  | 'catch-all' // *@domain → match by domain only
  | 'gmail-dot' // u.s.e.r@gmail.com → user@gmail.com
  | 'mail-tm' // direct mail.tm address match
  | 'addy-io' // addy.io alias → fallback to auto-reg-imap
  | '33mail' // 33mail alias → fallback to auto-reg-imap
  | 'auto-reg-fallback' // last resort: auto-reg-imap
  | 'none';

export interface MailboxResolution {
  profile: EmailInboxProfile | null;
  reason: ResolveReason;
}

export interface AccountInboxQuery {
  to?: string;
  search?: string;
}

interface AccountForResolve {
  email: string;
  metadata?: string | null;
  provider: string;
}

interface ParsedEmail {
  local: string;
  base: string;
  domain: string;
  normalizedBase: string;
}

/**
 * Splits an email into local/domain and computes a "base" local part
 * (before the +alias suffix). For gmail.com the base is also normalized
 * by stripping all dots so that `u.s.e.r` and `user` collapse to the
 * same canonical form.
 *
 * Returns null when the input does not look like an email address.
 */
function parseEmail(input: string | undefined | null): ParsedEmail | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  const atIdx = trimmed.lastIndexOf('@');
  if (atIdx <= 0 || atIdx === trimmed.length - 1) return null;

  const local = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx + 1);
  if (!local || !domain || !domain.includes('.')) return null;

  const plusIdx = local.indexOf('+');
  const base = plusIdx >= 0 ? local.slice(0, plusIdx) : local;

  const normalizedBase = domain === 'gmail.com' ? base.replace(/\./g, '') : base;

  return { local, base, domain, normalizedBase };
}

function getProfileImapUsername(profile: EmailInboxProfile): string | null {
  if (profile.connectInput.provider !== 'imap') return null;
  if (profile.connectInput.credentials.type !== 'imap') return null;
  const username = profile.connectInput.credentials.value.username;
  if (typeof username !== 'string') return null;
  const trimmed = username.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getProfileMailTmAddress(profile: EmailInboxProfile): string | null {
  if (profile.connectInput.provider !== 'mail_tm') return null;
  if (profile.connectInput.credentials.type !== 'mail_tm') return null;
  const address = profile.connectInput.credentials.value.address;
  if (typeof address !== 'string') return null;
  const trimmed = address.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function findProfileById(
  profiles: EmailInboxProfile[],
  id: string | undefined | null
): EmailInboxProfile | null {
  if (typeof id !== 'string' || !id.trim()) return null;
  return profiles.find(profile => profile.id === id) ?? null;
}

function readMailboxProfileIdFromMetadata(metadata: string | null | undefined): string | null {
  if (typeof metadata !== 'string' || !metadata.trim()) return null;
  try {
    const parsed = JSON.parse(metadata) as unknown;
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      // Accept both camelCase and snake_case for compatibility with various
      // callers that have written metadata over time.
      const candidates = [obj.mailbox_profile_id, obj.mailboxProfileId];
      for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
          return candidate.trim();
        }
      }
    }
  } catch {
    // Malformed JSON → fall through, resolver continues with other strategies.
  }
  return null;
}

const ADDY_DOMAIN_PATTERN = /(^|\.)addy\.io$|addymail|anonaddy/i;
const THIRTY_THREE_MAIL_PATTERN = /(^|\.)33mail\.com$/i;

function isAddyDomain(domain: string): boolean {
  return ADDY_DOMAIN_PATTERN.test(domain) || domain.includes('addy');
}

function isThirtyThreeMailDomain(domain: string): boolean {
  return THIRTY_THREE_MAIL_PATTERN.test(domain) || domain.includes('33mail');
}

/**
 * Resolve the most appropriate mailbox profile for the given account.
 *
 * Strategies are tried in this order, returning on first match:
 * 1. metadata.mailbox_profile_id  → 'metadata'
 * 2. mail.tm exact address match  → 'mail-tm'
 * 3. plus-alias / catch-all on imap profiles, plus gmail dot-equivalence
 *    → 'plus-alias' | 'gmail-dot' | 'catch-all'
 * 4. addy.io / 33mail alias domain → 'addy-io' | '33mail' (auto-reg fallback)
 * 5. auto-reg-imap profile present → 'auto-reg-fallback'
 * 6. nothing matches → 'none'
 */
export function resolveMailboxProfileForAccount(
  account: AccountForResolve,
  profiles: EmailInboxProfile[]
): MailboxResolution {
  // 1. metadata override always wins.
  const metaId = readMailboxProfileIdFromMetadata(account.metadata);
  if (metaId) {
    const profile = findProfileById(profiles, metaId);
    if (profile) {
      return { profile, reason: 'metadata' };
    }
  }

  const accountEmail = parseEmail(account.email);

  // 2. mail.tm direct address match.
  if (accountEmail) {
    for (const profile of profiles) {
      const address = getProfileMailTmAddress(profile);
      if (address && address.toLowerCase() === accountEmail.local + '@' + accountEmail.domain) {
        return { profile, reason: 'mail-tm' };
      }
    }
  }

  // 3. IMAP profile matches — plus-alias / gmail-dot / catch-all.
  if (accountEmail) {
    let plusMatch: EmailInboxProfile | null = null;
    let gmailDotMatch: EmailInboxProfile | null = null;
    let catchAllMatch: EmailInboxProfile | null = null;

    for (const profile of profiles) {
      // Skip the shared auto-reg profile here — it has lower priority and is
      // handled by the explicit fallback step below to keep semantics clear.
      if (profile.id === AUTO_REG_MAILBOX_PROFILE_ID) continue;

      const username = getProfileImapUsername(profile);
      if (!username) continue;

      const profileEmail = parseEmail(username);
      if (!profileEmail) continue;
      if (profileEmail.domain !== accountEmail.domain) continue;

      // Same domain. Now match by base.
      if (
        profileEmail.domain === 'gmail.com' &&
        profileEmail.normalizedBase === accountEmail.normalizedBase
      ) {
        // Distinguish gmail-dot (different raw base, same normalized) from
        // a regular plus-alias on gmail.
        if (profileEmail.base === accountEmail.base) {
          plusMatch = plusMatch ?? profile;
        } else {
          gmailDotMatch = gmailDotMatch ?? profile;
        }
        continue;
      }

      if (profileEmail.base === accountEmail.base) {
        plusMatch = plusMatch ?? profile;
        continue;
      }

      // Same domain, different base → catch-all candidate.
      catchAllMatch = catchAllMatch ?? profile;
    }

    if (plusMatch) return { profile: plusMatch, reason: 'plus-alias' };
    if (gmailDotMatch) return { profile: gmailDotMatch, reason: 'gmail-dot' };
    if (catchAllMatch) return { profile: catchAllMatch, reason: 'catch-all' };
  }

  // 4. Alias-service domains: addy.io / 33mail. These do not own an IMAP
  //    server themselves, so we route them through the shared auto-reg IMAP
  //    profile (which is typically the master gmail with catch-all aliases).
  const autoRegProfile = findProfileById(profiles, AUTO_REG_MAILBOX_PROFILE_ID);
  if (accountEmail) {
    if (isAddyDomain(accountEmail.domain) && autoRegProfile) {
      return { profile: autoRegProfile, reason: 'addy-io' };
    }
    if (isThirtyThreeMailDomain(accountEmail.domain) && autoRegProfile) {
      return { profile: autoRegProfile, reason: '33mail' };
    }
  }

  // 5. Generic fallback: shared auto-reg IMAP profile if configured.
  if (autoRegProfile) {
    return { profile: autoRegProfile, reason: 'auto-reg-fallback' };
  }

  // 6. Nothing matched.
  return { profile: null, reason: 'none' };
}

/**
 * Build the inbox filter that should be applied when navigating from an
 * account row to the Mail page. For mail.tm profiles the mailbox itself is
 * already scoped to the account, so no extra filter is needed. For everything
 * else we filter by the recipient address so that the user only sees the
 * subset of mail destined for this specific account email.
 */
export function buildAccountInboxQuery(
  account: { email: string },
  resolution: MailboxResolution
): AccountInboxQuery {
  if (!resolution.profile || resolution.reason === 'none') {
    return {};
  }

  if (resolution.reason === 'mail-tm') {
    // Mail.tm profile == one mailbox per account; filtering by `to` would
    // exclude legitimate messages that were addressed via aliasing services.
    return {};
  }

  const trimmed = (account.email ?? '').trim();
  if (!trimmed) return {};

  // Use `search` (full-text / IMAP TEXT) instead of strict `to` header match.
  // This handles forwarded mail (33mail, plus-addressing, catch-all) where the
  // original recipient address may appear in Delivered-To, X-Original-To, or
  // envelope headers rather than the visible To: field.
  return { search: trimmed };
}
