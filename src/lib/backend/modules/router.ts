/**
 * Router Module
 *
 * Thin, 1:1 wrappers around Rust router commands.
 * Keep these wrappers as the single source of truth (no parallel duplicate APIs).
 */

export type RouteCacheStats = {
  size: number;
  capacity: number;
  enabled: boolean;
};