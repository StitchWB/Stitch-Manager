import { describe, it, expect } from '@jest/globals';
import { resolveRestoreRoute } from '@/lib/routing/restoreRoute';

describe('resolveRestoreRoute', () => {
  it('strips a full URL down to its pathname', () => {
    const resolved = resolveRestoreRoute(
      'https://host/ai/providers',
      path => path === '/ai/providers',
      [],
    );
    expect(resolved).toBe('/ai/providers');
  });

  it('rejects a candidate without a leading slash', () => {
    const resolved = resolveRestoreRoute('ai/providers', () => false, []);
    expect(resolved).toBeNull();
  });

  it('rejects an unknown /ai path that is neither a route nor a redirect', () => {
    const resolved = resolveRestoreRoute('/ai/zzz', () => false, [{ from: '/ai/overview' }]);
    expect(resolved).toBeNull();
  });

  it('returns an existing route candidate unchanged', () => {
    const resolved = resolveRestoreRoute('/ai/tools', path => path === '/ai/tools', []);
    expect(resolved).toBe('/ai/tools');
  });

  it('returns a registered redirect source so the redirect route resolves it', () => {
    const resolved = resolveRestoreRoute('/ai-analytics', () => false, [
      { from: '/ai-analytics' },
    ]);
    expect(resolved).toBe('/ai-analytics');
  });

  it('keeps the query string when the pathname is a live route', () => {
    const resolved = resolveRestoreRoute(
      '/ai/routing?tab=proxy',
      path => path === '/ai/routing',
      [],
    );
    expect(resolved).toBe('/ai/routing?tab=proxy');
  });

  it('keeps the query string on a redirect source', () => {
    const resolved = resolveRestoreRoute('/ai/tools?tab=compression', () => false, [
      { from: '/ai/tools' },
    ]);
    expect(resolved).toBe('/ai/tools?tab=compression');
  });

  it('rejects an unknown pathname carrying a query', () => {
    const resolved = resolveRestoreRoute('/ai/zzz?tab=x', () => false, []);
    expect(resolved).toBeNull();
  });
});
