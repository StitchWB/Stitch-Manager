import { describe, it, expect } from '@jest/globals';
import { detectProvider, defaultBaseUrlFor } from '@/lib/aiHub/detectProvider';
import { AI_PROXY_PROVIDER_FILTERS } from '@/constants/providerRegistry';

describe('detectProvider', () => {
  it('maps anthropic prefixes before the openai sk- fallback', () => {
    expect(detectProvider('sk-ant-api03-abcdefgh1234')).toBe('anthropic');
    expect(detectProvider('sk-proj-abcdefgh1234')).toBe('openai');
    expect(detectProvider('sk-abcdefgh1234')).toBe('openai');
  });

  it('maps gemini and fireworks prefixes', () => {
    expect(detectProvider('AIzaSyD-abcdefgh1234')).toBe('gemini');
    expect(detectProvider('fw_abcdefgh1234')).toBe('fireworks');
  });

  it('returns null for unknown or empty input', () => {
    expect(detectProvider('xyz-unknown-token')).toBeNull();
    expect(detectProvider('')).toBeNull();
    expect(detectProvider('   ')).toBeNull();
  });

  it('trims surrounding whitespace before matching', () => {
    expect(detectProvider('  sk-ant-api03-x  ')).toBe('anthropic');
  });

  it('only returns provider ids present in AI_PROXY_PROVIDER_FILTERS', () => {
    const known = new Set(AI_PROXY_PROVIDER_FILTERS.map(f => f.id));
    const samples = [
      'sk-ant-api03-x',
      'sk-proj-x',
      'sk-x',
      'AIzaSyD-x',
      'fw_x',
    ];
    for (const sample of samples) {
      const detected = detectProvider(sample);
      expect(detected).not.toBeNull();
      expect(known.has(detected as never)).toBe(true);
    }
  });
});

describe('defaultBaseUrlFor', () => {
  it('returns default base urls for supported providers', () => {
    expect(defaultBaseUrlFor('openai')).toBe('https://api.openai.com/v1');
    expect(defaultBaseUrlFor('anthropic')).toBe('https://api.anthropic.com');
    expect(defaultBaseUrlFor('gemini')).toBe('https://generativelanguage.googleapis.com');
    expect(defaultBaseUrlFor('fireworks')).toBe('https://api.fireworks.ai/inference/v1');
    expect(defaultBaseUrlFor('zai')).toBe('https://api.z.ai/api/paas/v4');
  });

  it('returns empty string for providers without a default', () => {
    expect(defaultBaseUrlFor('custom')).toBe('');
    expect(defaultBaseUrlFor('')).toBe('');
  });
});
