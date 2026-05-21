export type ImportAccountPayload = {
  provider?: string;
  email?: string;
  password?: string;
  token?: string;
  refreshToken?: string;
  quotaLimit?: number;
  metadata?: Record<string, unknown> | string;
  // Kiro OAuth fields — for importing pre-authorized accounts
  kiroAccessToken?: string;
  kiroRefreshToken?: string;
  kiroTokenExpiresAt?: string;
  kiroAccountId?: string;
  providerType?: string;
};

export type ParsedAccountsResult = {
  payloads: ImportAccountPayload[];
  errors: string[];
};

const readBlobAsText = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Failed to read file contents'));
    reader.readAsText(blob);
  });

const parseCsvLine = (line: string): string[] => {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  fields.push(current);
  return fields;
};

export const parseCsvAccounts = (text: string): ImportAccountPayload[] => {
  const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]).map(value => value.trim().toLowerCase());
  const records: ImportAccountPayload[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const record: ImportAccountPayload = {};

    header.forEach((key, index) => {
      const rawValue = values[index]?.trim();
      if (!rawValue) return;

      switch (key) {
        case 'provider':
          record.provider = rawValue;
          break;
        case 'email':
          record.email = rawValue;
          break;
        case 'password':
          record.password = rawValue;
          break;
        case 'token':
          record.token = rawValue;
          break;
        case 'refreshtoken':
        case 'refresh_token':
          record.refreshToken = rawValue;
          break;
        case 'quotalimit':
        case 'quota_limit': {
          const parsed = Number(rawValue);
          if (!Number.isNaN(parsed)) record.quotaLimit = parsed;
          break;
        }
        case 'metadata':
          record.metadata = rawValue;
          break;
        // Kiro-specific columns
        case 'kiroaccesstoken':
        case 'kiro_access_token':
          record.kiroAccessToken = rawValue;
          break;
        case 'kirorefreshtoken':
        case 'kiro_refresh_token':
          record.kiroRefreshToken = rawValue;
          break;
        case 'kirotokenexpiresat':
        case 'kiro_token_expires_at':
          record.kiroTokenExpiresAt = rawValue;
          break;
        case 'kiroaccountid':
        case 'kiro_account_id':
        case 'user_id':
          record.kiroAccountId = rawValue;
          break;
        case 'providertype':
        case 'provider_type':
          record.providerType = rawValue;
          break;
        default:
          break;
      }
    });

    records.push(record);
  }

  return records;
};

export const normalizeJsonAccounts = (data: unknown): ParsedAccountsResult => {
  if (!Array.isArray(data)) {
    throw new Error('JSON must be an array of account records');
  }

  const errors: string[] = [];
  const payloads = data.map((item, index) => {
    if (!item || typeof item !== 'object') {
      errors.push(`Record ${index + 1} is not an object`);
      return {} satisfies ImportAccountPayload;
    }

    const record = item as Record<string, unknown>;
    const getString = (value: unknown): string | undefined =>
      typeof value === 'string' ? value : undefined;
    const getNumber = (value: unknown): number | undefined => {
      if (typeof value === 'number') return value;
      const n = Number(value);
      return Number.isNaN(n) ? undefined : n;
    };

    // Detect external Kiro export format — objects that have
    // `kiro_auth_token_raw` or `access_token` + `user_id` but no `provider`.
    // Transform them into our canonical import shape.
    const isExternalKiro =
      !record.provider &&
      (record.kiro_auth_token_raw != null ||
        record.access_token != null ||
        record.kiro_access_token != null);

    if (isExternalKiro) {
      return normalizeExternalKiroRecord(record, getString, getNumber);
    }

    const quotaRaw = record.quotaLimit ?? record.quota_limit;
    const quotaValue = getNumber(quotaRaw);

    return {
      provider: getString(record.provider),
      email: getString(record.email),
      password: getString(record.password),
      token: getString(record.token),
      refreshToken: getString(record.refreshToken ?? record.refresh_token),
      quotaLimit: quotaValue,
      metadata:
        typeof record.metadata === 'string' || typeof record.metadata === 'object'
          ? (record.metadata as Record<string, unknown> | string)
          : undefined,
      kiroAccessToken: getString(record.kiroAccessToken ?? record.kiro_access_token),
      kiroRefreshToken: getString(record.kiroRefreshToken ?? record.kiro_refresh_token),
      kiroTokenExpiresAt: getString(record.kiroTokenExpiresAt ?? record.kiro_token_expires_at),
      kiroAccountId: getString(record.kiroAccountId ?? record.kiro_account_id ?? record.user_id),
      providerType: getString(record.providerType ?? record.provider_type),
    };
  });

  return { payloads, errors };
};

export const validateImportRecords = (records: ImportAccountPayload[]) => {
  const valid: ImportAccountPayload[] = [];
  const errors: string[] = [];

  records.forEach((record, index) => {
    const provider = typeof record.provider === 'string' ? record.provider.trim() : '';
    const email = typeof record.email === 'string' ? record.email.trim() : '';
    const password = typeof record.password === 'string' ? record.password.trim() : '';

    const isKiro = provider === 'kiro' || provider === 'kiro_v2';
    const hasKiroToken =
      isKiro && (record.kiroAccessToken?.trim() || record.token?.trim());

    // For Kiro accounts, a kiro access token is sufficient — no password needed.
    // For other providers, provider + email + password are mandatory.
    if (!provider || !email || (!password && !hasKiroToken)) {
      errors.push(
        `Record ${index + 1} missing provider, email, or password${
          isKiro ? ' (or kiro access token)' : ''
        }`,
      );
      return;
    }

    valid.push({
      ...record,
      provider,
      email,
      password: password || (hasKiroToken ? 'imported' : password),
    });
  });

  return { valid, errors };
};

export const readSelectedFileText = async (selected: string | File): Promise<string> => {
  if (typeof selected === 'string') {
    return readBlobAsText(await (await fetch(selected)).blob());
  }

  return selected.text();
};

export const readBlobText = readBlobAsText;

// ─── External Kiro format normalizer ─────────────────────────────────────
//
// External Kiro exports come in a shape like:
//   {
//     "id": "kiro_abc123",
//     "email": "user@gmail.com",
//     "user_id": "d-xxx.yyy",
//     "login_provider": "Google",
//     "access_token": "aoaAAA...",
//     "refresh_token": "aorAAA...",
//     "token_type": "Bearer",
//     "expires_at": 1779310565,
//     "plan_name": "KIRO PRO",
//     "plan_tier": "Q_DEVELOPER_STANDALONE_PRO",
//     "credits_total": 1000.0,
//     "credits_used": 2.17,
//     "kiro_auth_token_raw": { "accessToken": "...", "refreshToken": "...", ... },
//     "kiro_profile_raw": { "arn": "...", "name": "Google" },
//     "kiro_usage_raw": { ... },
//     "status": "normal"
//   }
//
// We extract the essential fields and build a canonical ImportAccountPayload.

type GetStringFn = (value: unknown) => string | undefined;
type GetNumberFn = (value: unknown) => number | undefined;

function normalizeExternalKiroRecord(
  record: Record<string, unknown>,
  getString: GetStringFn,
  getNumber: GetNumberFn,
): ImportAccountPayload {
  // Prefer nested kiro_auth_token_raw if present, fall back to top-level.
  const authTokenRaw = record.kiro_auth_token_raw != null &&
    typeof record.kiro_auth_token_raw === 'object'
    ? (record.kiro_auth_token_raw as Record<string, unknown>)
    : null;

  const accessToken =
    getString(authTokenRaw?.accessToken) ??
    getString(record.access_token) ??
    getString(record.kiro_access_token);

  const refreshToken =
    getString(authTokenRaw?.refreshToken) ??
    getString(record.refresh_token) ??
    getString(record.kiro_refresh_token);

  const expiresAt =
    getString(authTokenRaw?.expiresAt) ??
    (record.expires_at != null
      ? typeof record.expires_at === 'number'
        ? new Date(record.expires_at * 1000).toISOString()
        : getString(record.expires_at)
      : getString(record.kiro_token_expires_at));

  const profileArn =
    getString(
      (record.kiro_profile_raw as Record<string, unknown> | null)?.arn,
    ) ??
    getString(authTokenRaw?.profileArn);

  const loginProvider =
    getString(authTokenRaw?.loginProvider) ??
    getString(record.login_provider) ??
    getString(authTokenRaw?.provider) ??
    'Google';

  const isSocial = loginProvider === 'Google' || loginProvider === 'GitHub';

  // Build metadata with auth_method, region, profileArn for the Rust side.
  const metadata: Record<string, unknown> = {
    auth_method: isSocial ? 'social' : 'IdC',
    provider: loginProvider,
    login_provider: loginProvider,
    region: 'us-east-1',
  };
  if (profileArn) {
    metadata.profileArn = profileArn;
  }

  // Determine provider subtype: kiro_v2 for social Google logins,
  // plain 'kiro' for AWS Builder ID / IdC.
  const providerType = isSocial ? 'kiro_social' : undefined;

  // Determine quota from kiro_usage_raw if present.
  const usageRaw =
    record.kiro_usage_raw != null &&
    typeof record.kiro_usage_raw === 'object'
      ? (record.kiro_usage_raw as Record<string, unknown>)
      : null;
  const usageBreakdown = usageRaw?.usageBreakdownList as
    | Array<Record<string, unknown>>
    | undefined;
  const firstBreakdown = usageBreakdown?.[0];
  const quotaLimit = firstBreakdown
    ? getNumber(firstBreakdown.usageLimit ?? firstBreakdown.usageLimitWithPrecision) ??
      getNumber(record.credits_total)
    : getNumber(record.credits_total);

  return {
    provider: 'kiro',
    email: getString(record.email) ?? getString(authTokenRaw?.email) ?? '',
    // External Kiro accounts have no password — use placeholder so
    // validation passes (the Rust side requires non-empty password).
    password: 'imported',
    kiroAccessToken: accessToken,
    kiroRefreshToken: refreshToken,
    kiroTokenExpiresAt: expiresAt,
    kiroAccountId: getString(record.user_id) ?? getString(record.kiro_account_id),
    providerType,
    quotaLimit,
    metadata,
  };
}
