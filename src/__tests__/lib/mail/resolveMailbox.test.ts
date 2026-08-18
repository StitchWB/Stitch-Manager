/**
 * Unit tests for resolveMailboxProfileForAccount + buildAccountInboxQuery.
 *
 * The resolver chooses the most appropriate mailbox profile for an account
 * by trying a sequence of strategies in priority order. These tests cover
 * each branch (metadata, mail.tm, plus-alias, gmail-dot, catch-all,
 * addy.io / 33mail aliases, auto-reg fallback, none).
 */

import { describe, expect, it } from '@jest/globals';
import {
  AUTO_REG_MAILBOX_PROFILE_ID,
  buildAccountInboxQuery,
  resolveMailboxProfileForAccount,
} from '@/lib/mail/runtime';
import type { EmailInboxProfile } from '@/lib/backend/modules/emailInbox';

function makeImapProfile(args: {
  id: string;
  username: string;
  host?: string;
  label?: string;
}): EmailInboxProfile {
  const host = args.host ?? 'imap.example.com';
  return {
    id: args.id,
    label: args.label ?? `IMAP · ${args.username}`,
    provider: 'imap',
    accountId: `imap:${args.username}`,
    connectInput: {
      provider: 'imap',
      accountId: `imap:${args.username}`,
      credentials: {
        type: 'imap',
        value: {
          host,
          port: 993,
          username: args.username,
          password: '********',
          useTls: true,
        },
      },
      options: { mailbox: 'INBOX', readOnly: true },
    },
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

function makeMailTmProfile(args: { id: string; address: string }): EmailInboxProfile {
  return {
    id: args.id,
    label: `Mail.tm · ${args.address}`,
    provider: 'mail_tm',
    accountId: `mailtm:${args.address}`,
    connectInput: {
      provider: 'mail_tm',
      accountId: `mailtm:${args.address}`,
      credentials: {
        type: 'mail_tm',
        value: { address: args.address, password: '********', baseUrl: null },
      },
      options: { mailbox: null, readOnly: true },
    },
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

describe('resolveMailboxProfileForAccount', () => {
  it('returns the metadata-bound profile even when other strategies would match', () => {
    const target = makeImapProfile({ id: 'specific-profile', username: 'master@example.com' });
    const distractor = makeImapProfile({
      id: AUTO_REG_MAILBOX_PROFILE_ID,
      username: 'master@example.com',
    });

    const account = {
      email: 'master+kiro@example.com',
      provider: 'kiro',
      metadata: JSON.stringify({ mailbox_profile_id: 'specific-profile' }),
    };

    const result = resolveMailboxProfileForAccount(account, [distractor, target]);

    expect(result.reason).toBe('metadata');
    expect(result.profile?.id).toBe('specific-profile');
  });

  it('matches plus-aliases against an IMAP profile with the same base+domain', () => {
    const profile = makeImapProfile({ id: 'imap-master', username: 'user@domain.com' });

    const result = resolveMailboxProfileForAccount(
      { email: 'user+kiro1@domain.com', provider: 'kiro', metadata: null },
      [profile]
    );

    expect(result.reason).toBe('plus-alias');
    expect(result.profile?.id).toBe('imap-master');
  });

  it('matches gmail dot-aliases by collapsing dots in the local part', () => {
    const profile = makeImapProfile({
      id: 'gmail-master',
      username: 'user@gmail.com',
      host: 'imap.gmail.com',
    });

    const result = resolveMailboxProfileForAccount(
      { email: 'u.s.e.r+abc@gmail.com', provider: 'kiro', metadata: null },
      [profile]
    );

    expect(result.reason).toBe('gmail-dot');
    expect(result.profile?.id).toBe('gmail-master');
  });

  it('matches a mail.tm profile by exact address', () => {
    const profile = makeMailTmProfile({ id: 'mailtm-1', address: 'temp@mail.tm' });

    const result = resolveMailboxProfileForAccount(
      { email: 'temp@mail.tm', provider: 'kiro', metadata: null },
      [profile]
    );

    expect(result.reason).toBe('mail-tm');
    expect(result.profile?.id).toBe('mailtm-1');
  });

  it('falls back to a catch-all imap profile when only the domain matches', () => {
    const profile = makeImapProfile({ id: 'catch-all', username: 'admin@mydomain.com' });

    const result = resolveMailboxProfileForAccount(
      { email: 'random-handle@mydomain.com', provider: 'kiro', metadata: null },
      [profile]
    );

    expect(result.reason).toBe('catch-all');
    expect(result.profile?.id).toBe('catch-all');
  });

  it('routes addy.io aliases to the auto-reg profile', () => {
    const autoReg = makeImapProfile({
      id: AUTO_REG_MAILBOX_PROFILE_ID,
      username: 'master@gmail.com',
      host: 'imap.gmail.com',
    });

    const result = resolveMailboxProfileForAccount(
      { email: 'rand123@anonymous.addy.io', provider: 'kiro', metadata: null },
      [autoReg]
    );

    expect(result.reason).toBe('addy-io');
    expect(result.profile?.id).toBe(AUTO_REG_MAILBOX_PROFILE_ID);
  });

  it('routes 33mail aliases to the auto-reg profile', () => {
    const autoReg = makeImapProfile({
      id: AUTO_REG_MAILBOX_PROFILE_ID,
      username: 'master@gmail.com',
      host: 'imap.gmail.com',
    });

    const result = resolveMailboxProfileForAccount(
      { email: 'random.kiro@username.33mail.com', provider: 'kiro', metadata: null },
      [autoReg]
    );

    expect(result.reason).toBe('33mail');
    expect(result.profile?.id).toBe(AUTO_REG_MAILBOX_PROFILE_ID);
  });

  it('falls back to the auto-reg profile when no other strategy matches', () => {
    const autoReg = makeImapProfile({
      id: AUTO_REG_MAILBOX_PROFILE_ID,
      username: 'master@gmail.com',
      host: 'imap.gmail.com',
    });

    const result = resolveMailboxProfileForAccount(
      { email: 'someone@completely-different-domain.org', provider: 'kiro', metadata: null },
      [autoReg]
    );

    expect(result.reason).toBe('auto-reg-fallback');
    expect(result.profile?.id).toBe(AUTO_REG_MAILBOX_PROFILE_ID);
  });

  it('returns none when there are no profiles at all', () => {
    const result = resolveMailboxProfileForAccount(
      { email: 'anyone@anywhere.io', provider: 'kiro', metadata: null },
      []
    );

    expect(result.reason).toBe('none');
    expect(result.profile).toBeNull();
  });

  it('treats malformed metadata as a no-op and falls through to other strategies', () => {
    const profile = makeImapProfile({ id: 'imap-master', username: 'user@domain.com' });

    const result = resolveMailboxProfileForAccount(
      {
        email: 'user+test@domain.com',
        provider: 'kiro',
        metadata: '{this is not: valid json',
      },
      [profile]
    );

    expect(result.reason).toBe('plus-alias');
    expect(result.profile?.id).toBe('imap-master');
  });

  it('ignores metadata that points at a non-existent profile id', () => {
    const profile = makeImapProfile({ id: 'imap-master', username: 'user@domain.com' });

    const result = resolveMailboxProfileForAccount(
      {
        email: 'user+test@domain.com',
        provider: 'kiro',
        metadata: JSON.stringify({ mailbox_profile_id: 'does-not-exist' }),
      },
      [profile]
    );

    expect(result.reason).toBe('plus-alias');
    expect(result.profile?.id).toBe('imap-master');
  });

  it('prefers a specific imap match over the auto-reg fallback in the same list', () => {
    const specific = makeImapProfile({ id: 'specific', username: 'user@domain.com' });
    const autoReg = makeImapProfile({
      id: AUTO_REG_MAILBOX_PROFILE_ID,
      username: 'master@gmail.com',
    });

    const result = resolveMailboxProfileForAccount(
      { email: 'user+x@domain.com', provider: 'kiro', metadata: null },
      [autoReg, specific]
    );

    expect(result.reason).toBe('plus-alias');
    expect(result.profile?.id).toBe('specific');
  });
});

describe('buildAccountInboxQuery', () => {
  it('returns an empty query for mail.tm resolutions', () => {
    const profile = makeMailTmProfile({ id: 'mailtm', address: 'tmp@mail.tm' });
    const query = buildAccountInboxQuery(
      { email: 'tmp@mail.tm' },
      { profile, reason: 'mail-tm' }
    );
    expect(query).toEqual({});
  });

  it('returns an empty query when no profile resolved (none)', () => {
    const query = buildAccountInboxQuery(
      { email: 'tmp@mail.tm' },
      { profile: null, reason: 'none' }
    );
    expect(query).toEqual({});
  });

  it('filters by recipient address for plus-alias resolutions', () => {
    const profile = makeImapProfile({ id: 'p1', username: 'master@domain.com' });
    const query = buildAccountInboxQuery(
      { email: 'master+kiro@domain.com' },
      { profile, reason: 'plus-alias' }
    );
    expect(query).toEqual({ search: 'master+kiro@domain.com' });
  });

  it('filters by recipient address for catch-all resolutions', () => {
    const profile = makeImapProfile({ id: 'p1', username: 'admin@mydomain.com' });
    const query = buildAccountInboxQuery(
      { email: 'someone@mydomain.com' },
      { profile, reason: 'catch-all' }
    );
    expect(query).toEqual({ search: 'someone@mydomain.com' });
  });

  it('filters by recipient address for auto-reg fallback resolutions', () => {
    const profile = makeImapProfile({
      id: AUTO_REG_MAILBOX_PROFILE_ID,
      username: 'master@gmail.com',
    });
    const query = buildAccountInboxQuery(
      { email: 'whatever@elsewhere.io' },
      { profile, reason: 'auto-reg-fallback' }
    );
    expect(query).toEqual({ search: 'whatever@elsewhere.io' });
  });
});
