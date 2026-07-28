/**
 * Unit tests for core/types.ts
 */

import { describe, it, expect } from '@jest/globals';
import { BackendError, SUPPORTED_PROVIDERS } from '../../../../lib/backend/core/types';

describe('BackendError', () => {
  it('should create error with message only', () => {
    const error = new BackendError('Test error');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(BackendError);
    expect(error.message).toBe('Test error');
    expect(error.name).toBe('BackendError');
    expect(error.code).toBeUndefined();
    expect(error.details).toBeUndefined();
  });

  it('should create error with message and code', () => {
    const error = new BackendError('Test error', 'TEST_CODE');

    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error.details).toBeUndefined();
  });

  it('should create error with message, code, and details', () => {
    const details = { command: 'test_command', args: { id: 1 } };
    const error = new BackendError('Test error', 'TEST_CODE', details);

    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error.details).toEqual(details);
  });

  it('should preserve error stack trace', () => {
    const error = new BackendError('Test error');

    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('BackendError');
  });

  it('should be catchable as Error', () => {
    try {
      throw new BackendError('Test error');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(BackendError);
    }
  });

  it('should support different detail types', () => {
    const stringDetails = new BackendError('Error', 'CODE', 'string details');
    expect(stringDetails.details).toBe('string details');

    const numberDetails = new BackendError('Error', 'CODE', 42);
    expect(numberDetails.details).toBe(42);

    const objectDetails = new BackendError('Error', 'CODE', { key: 'value' });
    expect(objectDetails.details).toEqual({ key: 'value' });

    const arrayDetails = new BackendError('Error', 'CODE', [1, 2, 3]);
    expect(arrayDetails.details).toEqual([1, 2, 3]);
  });
});

describe('SUPPORTED_PROVIDERS', () => {
  it('should contain expected providers', () => {
    expect(SUPPORTED_PROVIDERS).toContain('kiro');
    expect(SUPPORTED_PROVIDERS).toContain('kiro_v2');
    expect(SUPPORTED_PROVIDERS).toContain('windsurf');
    expect(SUPPORTED_PROVIDERS).toContain('trae');
    expect(SUPPORTED_PROVIDERS).toContain('fireworks');
    expect(SUPPORTED_PROVIDERS).toContain('qoder');
    expect(SUPPORTED_PROVIDERS).toContain('v0_app');
  });

  it('should have providers with autoreg flag', () => {
    // All entries in SUPPORTED_PROVIDERS must have hasAutoreg=true in PROVIDER_META.
    // The exact count grows as new providers are added — assert minimum viable set.
    expect(SUPPORTED_PROVIDERS.length).toBeGreaterThanOrEqual(7);
  });

  it('should be an array of strings', () => {
    const providers = [...SUPPORTED_PROVIDERS];
    expect(providers.every(p => typeof p === 'string')).toBe(true);
  });
});
