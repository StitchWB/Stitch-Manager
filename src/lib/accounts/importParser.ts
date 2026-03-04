export type ImportAccountPayload = {
  provider?: string;
  email?: string;
  password?: string;
  token?: string;
  refreshToken?: string;
  quotaLimit?: number;
  metadata?: Record<string, unknown> | string;
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

    const quotaRaw = record.quotaLimit ?? record.quota_limit;
    const quotaValue = typeof quotaRaw === 'number' ? quotaRaw : Number(quotaRaw);

    return {
      provider: getString(record.provider),
      email: getString(record.email),
      password: getString(record.password),
      token: getString(record.token),
      refreshToken: getString(record.refreshToken ?? record.refresh_token),
      quotaLimit: Number.isNaN(quotaValue) ? undefined : quotaValue,
      metadata:
        typeof record.metadata === 'string' || typeof record.metadata === 'object'
          ? (record.metadata as Record<string, unknown> | string)
          : undefined,
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

    if (!provider || !email || !password) {
      errors.push(`Record ${index + 1} missing provider, email, or password`);
      return;
    }

    valid.push({
      ...record,
      provider,
      email,
      password,
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
