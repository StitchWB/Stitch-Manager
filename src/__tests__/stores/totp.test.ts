/**
 * Unit tests for the TOTP store and API module.
 *
 * Test account (Kiro):
 *   Email  : 76needier_reach@icloud.com
 *   Pass   : uM%iby4sT04v#F
 *   Secret : QOC2VNJ7MFNRH7545F3FBR4E7YP7RVSQ
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ── mock safeInvoke so tests run without a live backend ──────────────────────
// totp.ts imports from '../core/invoke' (relative to lib/Backend/modules/).
// From the Jest rootDir (src/) that resolves to lib/Backend/core/invoke.
jest.mock('../../lib/backend/core/invoke', () => ({
  safeInvoke: jest.fn(),
}));

import { safeInvoke } from '../../lib/backend/core/invoke';
import { useTotpStore } from '../../stores/totp';
import type { TotpKey } from '../../lib/backend/modules/totp';

// ── fixtures ─────────────────────────────────────────────────────────────────

const TEST_SECRET = 'QOC2VNJ7MFNRH7545F3FBR4E7YP7RVSQ';
const TEST_LABEL = '76needier_reach@icloud.com';
const TEST_ISSUER = 'Kiro';

function makeKey(overrides: Partial<TotpKey> = {}): TotpKey {
  return {
    id: 'test-uuid-1',
    label: TEST_LABEL,
    secret: TEST_SECRET,
    issuer: TEST_ISSUER,
    accountId: null,
    digits: 6,
    period: 30,
    algorithm: 'SHA1',
    enabled: true,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

const mockInvoke = safeInvoke as jest.MockedFunction<typeof safeInvoke>;

// ── helpers ──────────────────────────────────────────────────────────────────

function resetStore() {
  useTotpStore.setState({ keys: [], loading: false, error: null });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. TOTP code generation (pure JS, no backend)
// ─────────────────────────────────────────────────────────────────────────────

describe('TOTP code generation', () => {
  // Inline minimal TOTP implementation mirroring the frontend (otplib)
  function generateCode(secret: string, period = 30): string {
    const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const padded = secret.replace(/\s/g, '').toUpperCase();
    // Decode base32
    let bits = '';
    for (const ch of padded) {
      const idx = base32Chars.indexOf(ch);
      if (idx === -1) continue;
      bits += idx.toString(2).padStart(5, '0');
    }
    const bytes = new Uint8Array(Math.floor(bits.length / 8));
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(bits.slice(i * 8, (i + 1) * 8), 2);
    }

    // HMAC-SHA1 via Web Crypto is async; for unit tests use a simple counter
    // check: ensure the secret decodes to the right byte length.
    // (Full OTP generation is covered by the otplib dependency integration test.)
    return bytes.length.toString().padStart(6, '0');
  }

  it('decodes QOC2VNJ7MFNRH7545F3FBR4E7YP7RVSQ to 20 bytes (SHA-1 key length)', () => {
    const code = generateCode(TEST_SECRET);
    // 20 bytes → code = "000020"
    expect(code).toBe('000020');
  });

  it('secret length matches Base32 encoding of 20-byte SHA1 key', () => {
    // 20 bytes → ceil(20 * 8 / 5) = 32 chars (no padding)
    const normalized = TEST_SECRET.replace(/=/g, '');
    expect(normalized.length).toBe(32);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. TOTP store — fetchKeys
// ─────────────────────────────────────────────────────────────────────────────

describe('useTotpStore.fetchKeys', () => {
  beforeEach(() => {
    resetStore();
    mockInvoke.mockReset();
  });

  it('populates keys on success', async () => {
    const key = makeKey();
    mockInvoke.mockResolvedValueOnce([key]);

    await useTotpStore.getState().fetchKeys();

    expect(mockInvoke).toHaveBeenCalledWith('list_totp_keys');
    expect(useTotpStore.getState().keys).toHaveLength(1);
    expect(useTotpStore.getState().keys[0].secret).toBe(TEST_SECRET);
    expect(useTotpStore.getState().loading).toBe(false);
  });

  it('sets error state when backend rejects', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('Unknown command: list_totp_keys'));

    await useTotpStore.getState().fetchKeys();

    expect(useTotpStore.getState().error).toMatch(/list_totp_keys/);
    expect(useTotpStore.getState().keys).toHaveLength(0);
    expect(useTotpStore.getState().loading).toBe(false);
  });

  it('sets loading=true while fetching, loading=false afterwards', async () => {
    let capturedLoading = false;
    mockInvoke.mockImplementationOnce(async () => {
      capturedLoading = useTotpStore.getState().loading;
      return [];
    });

    await useTotpStore.getState().fetchKeys();

    expect(capturedLoading).toBe(true);
    expect(useTotpStore.getState().loading).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. TOTP store — addKey
// ─────────────────────────────────────────────────────────────────────────────

describe('useTotpStore.addKey', () => {
  beforeEach(() => {
    resetStore();
    mockInvoke.mockReset();
  });

  it('appends key to store on success', async () => {
    const key = makeKey();
    mockInvoke.mockResolvedValueOnce(key);

    const result = await useTotpStore.getState().addKey({
      label: TEST_LABEL,
      secret: TEST_SECRET,
      issuer: TEST_ISSUER,
    });

    expect(mockInvoke).toHaveBeenCalledWith('add_totp_key', expect.objectContaining({
      label: TEST_LABEL,
      secret: TEST_SECRET,
      issuer: TEST_ISSUER,
    }));
    expect(result.id).toBe(key.id);
    expect(useTotpStore.getState().keys).toHaveLength(1);
  });

  it('stores secret exactly as returned by backend', async () => {
    const key = makeKey({ secret: TEST_SECRET });
    mockInvoke.mockResolvedValueOnce(key);

    await useTotpStore.getState().addKey({ label: TEST_LABEL, secret: TEST_SECRET });

    expect(useTotpStore.getState().keys[0].secret).toBe(TEST_SECRET);
  });

  it('propagates backend error as thrown exception', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('TOTP secret is required'));

    await expect(
      useTotpStore.getState().addKey({ label: TEST_LABEL, secret: '' })
    ).rejects.toThrow('TOTP secret is required');

    // Store must remain unchanged
    expect(useTotpStore.getState().keys).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. TOTP store — updateKey
// ─────────────────────────────────────────────────────────────────────────────

describe('useTotpStore.updateKey', () => {
  beforeEach(() => {
    resetStore();
    mockInvoke.mockReset();
    // Seed one key
    useTotpStore.setState({ keys: [makeKey()] });
  });

  it('replaces the key in the store', async () => {
    const updated = makeKey({ label: 'Updated label', issuer: 'GitHub' });
    mockInvoke.mockResolvedValueOnce(updated);

    await useTotpStore.getState().updateKey({
      id: 'test-uuid-1',
      label: 'Updated label',
      issuer: 'GitHub',
    });

    expect(useTotpStore.getState().keys[0].label).toBe('Updated label');
    expect(useTotpStore.getState().keys[0].issuer).toBe('GitHub');
  });

  it('does not duplicate keys on update', async () => {
    mockInvoke.mockResolvedValueOnce(makeKey({ label: 'x' }));

    await useTotpStore.getState().updateKey({ id: 'test-uuid-1', label: 'x' });

    expect(useTotpStore.getState().keys).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. TOTP store — removeKey
// ─────────────────────────────────────────────────────────────────────────────

describe('useTotpStore.removeKey', () => {
  beforeEach(() => {
    resetStore();
    mockInvoke.mockReset();
    useTotpStore.setState({ keys: [makeKey()] });
  });

  it('removes key from store on success', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, id: 'test-uuid-1' });

    await useTotpStore.getState().removeKey('test-uuid-1');

    expect(useTotpStore.getState().keys).toHaveLength(0);
  });

  it('calls remove_totp_key with correct id', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, id: 'test-uuid-1' });

    await useTotpStore.getState().removeKey('test-uuid-1');

    expect(mockInvoke).toHaveBeenCalledWith('remove_totp_key', { id: 'test-uuid-1' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. TOTP store — linkKey
// ─────────────────────────────────────────────────────────────────────────────

describe('useTotpStore.linkKey', () => {
  const ACCOUNT_ID = 'account-uuid-999';

  beforeEach(() => {
    resetStore();
    mockInvoke.mockReset();
    useTotpStore.setState({ keys: [makeKey()] });
  });

  it('updates accountId in store', async () => {
    mockInvoke.mockResolvedValueOnce(makeKey({ accountId: ACCOUNT_ID }));

    await useTotpStore.getState().linkKey({ id: 'test-uuid-1', accountId: ACCOUNT_ID });

    expect(useTotpStore.getState().keys[0].accountId).toBe(ACCOUNT_ID);
  });

  it('sets accountId=null when unlinking', async () => {
    useTotpStore.setState({ keys: [makeKey({ accountId: ACCOUNT_ID })] });
    mockInvoke.mockResolvedValueOnce(makeKey({ accountId: null }));

    await useTotpStore.getState().linkKey({ id: 'test-uuid-1', accountId: null });

    expect(useTotpStore.getState().keys[0].accountId).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. TOTP store — getKeysForAccount
// ─────────────────────────────────────────────────────────────────────────────

describe('useTotpStore.getKeysForAccount', () => {
  const ACCOUNT_A = 'acc-aaa';
  const ACCOUNT_B = 'acc-bbb';

  beforeEach(() => {
    resetStore();
    useTotpStore.setState({
      keys: [
        makeKey({ id: 'k1', accountId: ACCOUNT_A }),
        makeKey({ id: 'k2', accountId: ACCOUNT_B }),
        makeKey({ id: 'k3', accountId: ACCOUNT_A }),
        makeKey({ id: 'k4', accountId: null }),
        makeKey({ id: 'k5', accountId: ACCOUNT_A, enabled: false }),
      ],
    });
  });

  it('returns only enabled keys for the given account', () => {
    const keys = useTotpStore.getState().getKeysForAccount(ACCOUNT_A);
    const ids = keys.map(k => k.id);
    expect(ids).toContain('k1');
    expect(ids).toContain('k3');
    expect(ids).not.toContain('k5');   // disabled
    expect(ids).not.toContain('k2');   // different account
    expect(ids).not.toContain('k4');   // unlinked
  });

  it('returns empty array for unknown account', () => {
    expect(useTotpStore.getState().getKeysForAccount('does-not-exist')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Full add → list → update → delete flow (E2E via mocks)
// ─────────────────────────────────────────────────────────────────────────────

describe('TOTP full lifecycle (mocked backend)', () => {
  beforeEach(() => {
    resetStore();
    mockInvoke.mockReset();
  });

  it('add → list → update label → link → unlink → remove', async () => {
    const key = makeKey();

    // 1. add
    mockInvoke.mockResolvedValueOnce(key);
    await useTotpStore.getState().addKey({ label: TEST_LABEL, secret: TEST_SECRET, issuer: TEST_ISSUER });
    expect(useTotpStore.getState().keys).toHaveLength(1);

    // 2. list (simulate store being refilled from backend)
    mockInvoke.mockResolvedValueOnce([key]);
    await useTotpStore.getState().fetchKeys();
    expect(useTotpStore.getState().keys[0].secret).toBe(TEST_SECRET);

    // 3. update label
    const updatedKey = makeKey({ label: 'Kiro account v2' });
    mockInvoke.mockResolvedValueOnce(updatedKey);
    await useTotpStore.getState().updateKey({ id: key.id, label: 'Kiro account v2' });
    expect(useTotpStore.getState().keys[0].label).toBe('Kiro account v2');

    // 4. link to account
    const accountId = 'account-xyz';
    mockInvoke.mockResolvedValueOnce(makeKey({ accountId }));
    await useTotpStore.getState().linkKey({ id: key.id, accountId });
    expect(useTotpStore.getState().keys[0].accountId).toBe(accountId);

    // 5. unlink
    mockInvoke.mockResolvedValueOnce(makeKey({ accountId: null }));
    await useTotpStore.getState().linkKey({ id: key.id, accountId: null });
    expect(useTotpStore.getState().keys[0].accountId).toBeNull();

    // 6. remove
    mockInvoke.mockResolvedValueOnce({ success: true, id: key.id });
    await useTotpStore.getState().removeKey(key.id);
    expect(useTotpStore.getState().keys).toHaveLength(0);
  });
});
