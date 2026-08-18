/**
 * Input validation utilities for Backend commands
 */

import { BackendError, SUPPORTED_PROVIDERS, type SupportedProvider } from './types';

/**
 * Validate if provider is supported
 *
 * @param provider - Provider name to validate
 * @returns True if provider is supported
 */
export function isValidProvider(provider: string): provider is SupportedProvider {
  return SUPPORTED_PROVIDERS.includes(provider as SupportedProvider);
}

/**
 * Validate provider and throw error if invalid
 *
 * @param provider - Provider name to validate
 * @returns The validated provider
 * @throws {BackendError} When provider is not supported
 */
export function validateProvider(provider: string): SupportedProvider {
  if (!isValidProvider(provider)) {
    throw new BackendError(
      `Unsupported provider '${provider}'. Supported providers: ${SUPPORTED_PROVIDERS.join(', ')}`,
      'INVALID_PROVIDER',
      { provider, supportedProviders: SUPPORTED_PROVIDERS }
    );
  }
  return provider;
}

/**
 * Validate email format
 *
 * @param email - Email address to validate
 * @returns True if email format is valid
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate email and throw error if invalid
 *
 * @param email - Email address to validate
 * @returns The validated email
 * @throws {BackendError} When email format is invalid
 */
export function validateEmail(email: string): string {
  if (!isValidEmail(email)) {
    throw new BackendError(`Invalid email format: ${email}`, 'INVALID_EMAIL', { email });
  }
  return email;
}

/**
 * Validate account ID (must be positive integer)
 *
 * @param accountId - Account ID to validate
 * @returns The validated account ID as number
 * @throws {BackendError} When account ID is invalid
 */
export function validateAccountId(accountId: string | number): number {
  const id = typeof accountId === 'string' ? Number(accountId) : accountId;

  if (isNaN(id) || id <= 0 || !Number.isInteger(id)) {
    throw new BackendError(
      `Invalid account ID: ${accountId}. Must be a positive integer.`,
      'INVALID_ACCOUNT_ID',
      { accountId }
    );
  }

  return id;
}

/**
 * Validate required string parameter
 *
 * @param value - Value to validate
 * @param paramName - Parameter name for error message
 * @returns The validated string
 * @throws {BackendError} When value is empty or not a string
 */
export function validateRequiredString(value: unknown, paramName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BackendError(
      `${paramName} is required and must be a non-empty string`,
      'INVALID_PARAMETER',
      { paramName, value }
    );
  }
  return value;
}

/**
 * Validate port number (1-65535)
 *
 * @param port - Port number to validate
 * @returns The validated port number
 * @throws {BackendError} When port is out of valid range
 */
export function validatePort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new BackendError(
      `Invalid port number: ${port}. Must be between 1 and 65535.`,
      'INVALID_PORT',
      { port }
    );
  }
  return port;
}

/**
 * Validate URL format
 *
 * @param url - URL to validate
 * @returns True if URL format is valid
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate URL and throw error if invalid
 *
 * @param url - URL to validate
 * @returns The validated URL
 * @throws {BackendError} When URL format is invalid
 */
export function validateUrl(url: string): string {
  if (!isValidUrl(url)) {
    throw new BackendError(`Invalid URL format: ${url}`, 'INVALID_URL', { url });
  }
  return url;
}
