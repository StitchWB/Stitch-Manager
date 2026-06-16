/**
 * Event system — drop-in replacement for `@tauri-apps/api/event`.
 *
 * All frontend components should import from `@/lib/events` instead of
 * `@tauri-apps/api/event`.
 *
 * @example
 * ```ts
 * import { listen, emit } from '@/lib/events';
 *
 * const unlisten = await listen<MyPayload>('account-created', handler);
 * await emit('SETTINGS_UPDATED', data);
 * ```
 */

export { listen, emit, dispose, type UnlistenFn } from './websocket';
