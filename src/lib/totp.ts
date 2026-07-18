/**
 * TOTP (RFC 6238) implementation using the native Web Crypto API.
 * No external dependencies — works in any modern browser.
 */

/** Decode a Base32 string to a Uint8Array */
function base32Decode(base32: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = base32.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bitsLeft = 0;

  for (const char of clean) {
    const val = alphabet.indexOf(char);
    if (val < 0) continue; // skip invalid characters
    buffer = (buffer << 5) | val;
    bitsLeft += 5;
    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      bytes.push((buffer >> bitsLeft) & 0xff);
    }
  }

  return new Uint8Array(bytes);
}

/** Encode a 64-bit counter as big-endian 8-byte array */
function counterToBytes(counter: number): Uint8Array {
  const bytes = new Uint8Array(8);
  let n = counter;
  for (let i = 7; i >= 0; i--) {
    bytes[i] = n & 0xff;
    n = Math.floor(n / 256);
  }
  return bytes;
}

/** Dynamic truncation per RFC 4226 */
function truncate(hmac: Uint8Array, digits: number): string {
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % Math.pow(10, digits)).toString().padStart(digits, '0');
}

/**
 * Generate a TOTP code — async because Web Crypto is async.
 *
 * @param secret  Base32-encoded secret key
 * @param period  Time step in seconds (default 30)
 * @param digits  Number of digits (default 6)
 * @param epoch   Optional Unix timestamp in ms (default Date.now())
 */
export async function generateTotp(
  secret: string,
  period = 30,
  digits = 6,
  epoch?: number
): Promise<string> {
  try {
    const keyBytes = base32Decode(secret);
    const counter = Math.floor((epoch ?? Date.now()) / 1000 / period);
    const counterBytes = counterToBytes(counter);

    // Copy to plain ArrayBuffer to satisfy Web Crypto strict typing
    const keyBuffer = keyBytes.buffer.slice(
      keyBytes.byteOffset,
      keyBytes.byteOffset + keyBytes.byteLength
    ) as ArrayBuffer;
    const counterBuffer = counterBytes.buffer.slice(
      counterBytes.byteOffset,
      counterBytes.byteOffset + counterBytes.byteLength
    ) as ArrayBuffer;

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, counterBuffer);
    return truncate(new Uint8Array(signature), digits);
  } catch {
    return '------';
  }
}

/**
 * Get seconds remaining in current TOTP window.
 */
export function totpSecondsRemaining(period = 30): number {
  return period - (Math.floor(Date.now() / 1000) % period);
}

/**
 * Get the current TOTP counter (time step).
 */
export function totpCounter(period = 30): number {
  return Math.floor(Date.now() / 1000 / period);
}
