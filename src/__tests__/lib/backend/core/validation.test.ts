/**
 * Unit tests for core/validation.ts
 */

import { describe, it, expect } from '@jest/globals';
import {
  isValidProvider,
  validateProvider,
  isValidEmail,
  validateEmail,
  validateAccountId,
  validateRequiredString,
  validatePort,
  isValidUrl,
  validateUrl,
} from '../../../../lib/backend/core/validation';
import { BackendError } from '../../../../lib/backend/core/types';

describe('Provider Validation', () => {
  describe('isValidProvider', () => {
    it('should return true for valid providers', () => {
      expect(isValidProvider('kiro')).toBe(true);
      expect(isValidProvider('windsurf')).toBe(true);
      expect(isValidProvider('trae')).toBe(true);
    });

    it('should return false for invalid providers', () => {
      expect(isValidProvider('invalid')).toBe(false);
      expect(isValidProvider('github')).toBe(false);
      expect(isValidProvider('')).toBe(false);
      expect(isValidProvider('KIRO')).toBe(false); // Case sensitive
    });
  });

  describe('validateProvider', () => {
    it('should return provider for valid providers', () => {
      expect(validateProvider('kiro')).toBe('kiro');
      expect(validateProvider('windsurf')).toBe('windsurf');
      expect(validateProvider('trae')).toBe('trae');
    });

    it('should throw BackendError for invalid providers', () => {
      expect(() => validateProvider('invalid')).toThrow(BackendError);
      expect(() => validateProvider('invalid')).toThrow(/Unsupported provider/);
    });

    it('should include supported providers in error message', () => {
      try {
        validateProvider('invalid');
      } catch (error) {
        expect(error).toBeInstanceOf(BackendError);
        expect((error as BackendError).message).toContain('kiro');
        expect((error as BackendError).message).toContain('windsurf');
        expect((error as BackendError).message).toContain('trae');
        expect((error as BackendError).code).toBe('INVALID_PROVIDER');
      }
    });
  });
});

describe('Email Validation', () => {
  describe('isValidEmail', () => {
    it('should return true for valid email addresses', () => {
      expect(isValidEmail('test@example.com')).toBe(true);
      expect(isValidEmail('user.name@domain.co.uk')).toBe(true);
      expect(isValidEmail('user+tag@example.com')).toBe(true);
      expect(isValidEmail('123@test.com')).toBe(true);
    });

    it('should return false for invalid email addresses', () => {
      expect(isValidEmail('invalid')).toBe(false);
      expect(isValidEmail('invalid@')).toBe(false);
      expect(isValidEmail('@example.com')).toBe(false);
      expect(isValidEmail('test@')).toBe(false);
      expect(isValidEmail('test@domain')).toBe(false);
      expect(isValidEmail('')).toBe(false);
      expect(isValidEmail('test @example.com')).toBe(false);
    });
  });

  describe('validateEmail', () => {
    it('should return email for valid addresses', () => {
      expect(validateEmail('test@example.com')).toBe('test@example.com');
    });

    it('should throw BackendError for invalid addresses', () => {
      expect(() => validateEmail('invalid')).toThrow(BackendError);
      expect(() => validateEmail('invalid')).toThrow(/Invalid email format/);
    });

    it('should include email in error details', () => {
      try {
        validateEmail('invalid-email');
      } catch (error) {
        expect(error).toBeInstanceOf(BackendError);
        expect((error as BackendError).code).toBe('INVALID_EMAIL');
        expect((error as BackendError).details).toEqual({ email: 'invalid-email' });
      }
    });
  });
});

describe('Account ID Validation', () => {
  describe('validateAccountId', () => {
    it('should accept valid numeric IDs', () => {
      expect(validateAccountId(1)).toBe(1);
      expect(validateAccountId(100)).toBe(100);
      expect(validateAccountId(999999)).toBe(999999);
    });

    it('should accept valid string IDs and convert to number', () => {
      expect(validateAccountId('1')).toBe(1);
      expect(validateAccountId('100')).toBe(100);
    });

    it('should reject zero and negative numbers', () => {
      expect(() => validateAccountId(0)).toThrow(BackendError);
      expect(() => validateAccountId(-1)).toThrow(BackendError);
      expect(() => validateAccountId('-5')).toThrow(BackendError);
    });

    it('should reject non-integer values', () => {
      expect(() => validateAccountId(1.5)).toThrow(BackendError);
      expect(() => validateAccountId('1.5')).toThrow(BackendError);
    });

    it('should reject invalid string values', () => {
      expect(() => validateAccountId('abc')).toThrow(BackendError);
      expect(() => validateAccountId('')).toThrow(BackendError);
      expect(() => validateAccountId('12abc')).toThrow(BackendError);
    });

    it('should throw BackendError with correct code', () => {
      try {
        validateAccountId('invalid');
      } catch (error) {
        expect(error).toBeInstanceOf(BackendError);
        expect((error as BackendError).code).toBe('INVALID_ACCOUNT_ID');
      }
    });
  });
});

describe('Required String Validation', () => {
  describe('validateRequiredString', () => {
    it('should accept valid non-empty strings', () => {
      expect(validateRequiredString('test', 'param')).toBe('test');
      expect(validateRequiredString('  value  ', 'param')).toBe('  value  ');
    });

    it('should reject empty strings', () => {
      expect(() => validateRequiredString('', 'param')).toThrow(BackendError);
      expect(() => validateRequiredString('   ', 'param')).toThrow(BackendError);
    });

    it('should reject non-string values', () => {
      expect(() => validateRequiredString(123, 'param')).toThrow(BackendError);
      expect(() => validateRequiredString(null, 'param')).toThrow(BackendError);
      expect(() => validateRequiredString(undefined, 'param')).toThrow(BackendError);
      expect(() => validateRequiredString({}, 'param')).toThrow(BackendError);
    });

    it('should include parameter name in error message', () => {
      try {
        validateRequiredString('', 'apiToken');
      } catch (error) {
        expect(error).toBeInstanceOf(BackendError);
        expect((error as BackendError).message).toContain('apiToken');
        expect((error as BackendError).code).toBe('INVALID_PARAMETER');
      }
    });
  });
});

describe('Port Validation', () => {
  describe('validatePort', () => {
    it('should accept valid port numbers', () => {
      expect(validatePort(1)).toBe(1);
      expect(validatePort(80)).toBe(80);
      expect(validatePort(443)).toBe(443);
      expect(validatePort(8080)).toBe(8080);
      expect(validatePort(65535)).toBe(65535);
    });

    it('should reject ports outside valid range', () => {
      expect(() => validatePort(0)).toThrow(BackendError);
      expect(() => validatePort(-1)).toThrow(BackendError);
      expect(() => validatePort(65536)).toThrow(BackendError);
      expect(() => validatePort(100000)).toThrow(BackendError);
    });

    it('should reject non-integer values', () => {
      expect(() => validatePort(80.5)).toThrow(BackendError);
      expect(() => validatePort(NaN)).toThrow(BackendError);
    });

    it('should throw BackendError with correct code', () => {
      try {
        validatePort(70000);
      } catch (error) {
        expect(error).toBeInstanceOf(BackendError);
        expect((error as BackendError).code).toBe('INVALID_PORT');
        expect((error as BackendError).message).toContain('1 and 65535');
      }
    });
  });
});

describe('URL Validation', () => {
  describe('isValidUrl', () => {
    it('should return true for valid URLs', () => {
      expect(isValidUrl('https://example.com')).toBe(true);
      expect(isValidUrl('http://localhost:8080')).toBe(true);
      expect(isValidUrl('https://api.example.com/v1/endpoint')).toBe(true);
      expect(isValidUrl('ftp://files.example.com')).toBe(true);
    });

    it('should return false for invalid URLs', () => {
      expect(isValidUrl('not-a-url')).toBe(false);
      expect(isValidUrl('example.com')).toBe(false);
      expect(isValidUrl('')).toBe(false);
      expect(isValidUrl('http://')).toBe(false);
    });
  });

  describe('validateUrl', () => {
    it('should return URL for valid URLs', () => {
      const url = 'https://example.com';
      expect(validateUrl(url)).toBe(url);
    });

    it('should throw BackendError for invalid URLs', () => {
      expect(() => validateUrl('invalid')).toThrow(BackendError);
      expect(() => validateUrl('invalid')).toThrow(/Invalid URL format/);
    });

    it('should include URL in error details', () => {
      try {
        validateUrl('not-a-url');
      } catch (error) {
        expect(error).toBeInstanceOf(BackendError);
        expect((error as BackendError).code).toBe('INVALID_URL');
        expect((error as BackendError).details).toEqual({ url: 'not-a-url' });
      }
    });
  });
});
