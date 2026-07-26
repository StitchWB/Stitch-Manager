/**
 * otpauth:// URI parser (Google Authenticator Key URI format).
 * https://github.com/google/google-authenticator/wiki/Key-Uri-Format
 *
 * Only TOTP is supported (backend has no HOTP counters).
 */

export interface OtpauthKey {
  label: string;
  issuer: string | null;
  secret: string;
  digits?: number;
  period?: number;
  algorithm?: string;
}

export function isOtpauthUri(value: string): boolean {
  return value.trim().toLowerCase().startsWith('otpauth://');
}

/**
 * Parse `otpauth://totp/<label>?secret=..&issuer=..&digits=..&period=..&algorithm=..`
 * Returns null on anything malformed or unsupported.
 * Label convention "Issuer:account" fills issuer when the param is absent.
 */
export function parseOtpauthUri(raw: string): OtpauthKey | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'otpauth:' || url.hostname.toLowerCase() !== 'totp') {
    return null;
  }

  const secret = (url.searchParams.get('secret') ?? '').replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z2-7]+=*$/.test(secret) || secret.length < 8) {
    return null;
  }

  let rawLabel: string;
  try {
    rawLabel = decodeURIComponent(url.pathname.replace(/^\//, ''));
  } catch {
    return null;
  }

  let issuer = url.searchParams.get('issuer');
  let label = rawLabel;
  const colon = rawLabel.indexOf(':');
  if (colon > 0) {
    if (!issuer) issuer = rawLabel.slice(0, colon);
    label = rawLabel.slice(colon + 1);
  }
  if (!label.trim()) return null;

  const digits = Number(url.searchParams.get('digits'));
  const period = Number(url.searchParams.get('period'));
  const algorithm = url.searchParams.get('algorithm')?.toUpperCase();

  return {
    label: label.trim(),
    issuer: issuer?.trim() || null,
    secret,
    ...(digits === 6 || digits === 8 ? { digits } : {}),
    ...(Number.isInteger(period) && period > 0 ? { period } : {}),
    ...(algorithm && /^SHA(1|256|512)$/.test(algorithm) ? { algorithm } : {}),
  };
}
