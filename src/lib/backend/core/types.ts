/**
 * Core types for Backend integration
 */

import { AUTOREG_PROVIDERS } from '@/constants/providerIds';
export type { ProviderId } from '@/constants/providerIds';

/**
 * Custom error class for Backend command failures
 */
export class BackendError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'BackendError';
  }
}

/**
 * All provider IDs that have an autoreg flow.
 * Source of truth: src/constants/providerIds.ts → AUTOREG_PROVIDERS
 */
export const SUPPORTED_PROVIDERS = AUTOREG_PROVIDERS;
export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

/**
 * Generic result type for operations that can fail
 */
export type Result<T, E = BackendError> =
  | { success: true; data: T }
  | { success: false; error: E };
