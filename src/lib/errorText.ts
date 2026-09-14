/**
 * Human-readable error text helpers.
 *
 * Backend error payloads (`detail` / `error`) are untrusted: FastAPI may send
 * a string, a validation-error array, or a nested object. Coercing those with
 * `String()` / `new Error()` renders "[object Object]" in the UI — every
 * user-visible error string must go through these helpers.
 */

/** Coerce an untrusted error payload into a readable string. */
export function detailToMessage(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (Array.isArray(value)) {
    const msgs = value
      .map(v =>
        v && typeof v === 'object' && typeof (v as { msg?: unknown }).msg === 'string'
          ? (v as { msg: string }).msg
          : null,
      )
      .filter((m): m is string => Boolean(m));
    if (msgs.length) return msgs.join('; ');
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['message', 'error', 'detail']) {
      if (typeof obj[key] === 'string' && (obj[key] as string).trim()) {
        return obj[key] as string;
      }
    }
  }
  return fallback;
}

/** Extract a readable message from a thrown value (Error, object, string). */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message && err.message !== '[object Object]') {
    return err.message;
  }
  return detailToMessage(err, fallback);
}
