export function resolveRestoreRoute(
  candidate: string,
  exists: (path: string) => boolean,
  redirects: Array<{ from: string }>
): string | null {
  let path = candidate;
  if (/^https?:/i.test(path)) {
    try {
      path = new URL(path).pathname || '/';
    } catch {
      return null;
    }
  }
  if (!path.startsWith('/')) return null;
  if (exists(path)) return path;
  if (redirects.some(redirect => redirect.from === path)) return path;
  return null;
}
