/**
 * Validation utilities for registration configuration
 */

import type { IMAPConfig } from '../types';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export const validateEmail = (email: string): ValidationResult => {
  if (!email) {
    return { valid: true }; // Empty is valid (optional field)
  }
  if (!email.includes('@')) {
    return { valid: false, error: 'Invalid email format' };
  }
  return { valid: true };
};

export const validatePort = (port: number): ValidationResult => {
  if (isNaN(port) || port < 1 || port > 65535) {
    return { valid: false, error: 'Invalid IMAP port (must be 1-65535)' };
  }
  return { valid: true };
};

export const validateIMAPConfig = (imap: IMAPConfig, strategy: string): ValidationResult => {
  if (strategy === 'custom' || strategy === 'cf-to-imap') {
    const emailResult = validateEmail(imap.email);
    if (!emailResult.valid) {
      return emailResult;
    }

    const portResult = validatePort(imap.port);
    if (!portResult.valid) {
      return portResult;
    }
  }

  return { valid: true };
};
