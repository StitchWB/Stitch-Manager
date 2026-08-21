import { safeInvoke } from '@/lib/backend/core/invoke';

/**
 * Invoke a namespaced plugin command `plugin.{pluginId}.{cmd}` via the
 * core safeInvoke bridge. The template literal keeps the command name
 * visible to the command-coverage regex (which excludes `plugin.`-prefixed
 * names from literal collection — see todo 4 of plugin-platform-v2).
 */
export function invokeAction<T = unknown>(
  pluginId: string,
  cmd: string,
  params?: Record<string, unknown>,
): Promise<T> {
  return safeInvoke<T>(`plugin.${pluginId}.${cmd}`, params);
}
