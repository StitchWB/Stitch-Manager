export function resolveRestoreRoute(
  candidate: string,
  exists: (path: string) => boolean,
  redirects: Array<{ from: string }>
): string | null {
  let path = candidate;
  if (/^https?:/i.test(path)) {
    try {
      const url = new URL(path);
      path = (url.pathname || '/') + url.search;
    } catch {
      return null;
    }
  }
  if (!path.startsWith('/')) return null;
  const queryIndex = path.indexOf('?');
  const pathname = queryIndex === -1 ? path : path.slice(0, queryIndex);
  if (exists(pathname) || redirects.some(redirect => redirect.from === pathname)) {
    return path;
  }
  return null;
}
