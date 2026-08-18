/**
 * Validation utilities for registration configuration
 */

import type { IMAPConfig } from '../types';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export const validateIMAPConfig = (imap: IMAPConfig, strategy: string): ValidationResult => {
  if (strategy === 'custom' || strategy === 'cf-to-imap') {
    if (imap.email && !imap.email.includes('@')) {
      return { valid: false, error: 'Invalid email format' };
    }
    if (isNaN(imap.port) || imap.port < 1 || imap.port > 65535) {
      return { valid: false, error: 'Invalid IMAP port (must be 1-65535)' };
    }
  }

  return { valid: true };
};
