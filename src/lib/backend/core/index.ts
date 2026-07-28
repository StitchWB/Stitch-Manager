/**
 * Core Backend utilities
 * 
 * This module provides foundational utilities for Backend integration:
 * - Error handling with BackendError
 * - Safe invoke wrappers with retry support
 * - Input validation helpers
 * - Shared types
 */

export { BackendError, SUPPORTED_PROVIDERS, type SupportedProvider, type Result } from './types';
export { safeInvoke, safeInvokeWithRetry, batchInvoke } from './invoke';
export {
  isValidProvider,
  validateProvider,
  isValidEmail,
  validateEmail,
  validateAccountId,
  validateRequiredString,
  validatePort,
  isValidUrl,
  validateUrl,
} from './validation';
