import { describe, it, expect } from '@jest/globals';
import { parseProviderPackage, isPackageEmpty } from '@/lib/providerPackageParser';

const DANYA_BLOB = [
  'Ключ: sk-8rYKLLlExIrwKMR166zMCKpIQsp3wBlBaQMJ0LujlvNtIU7S',
  'Base:',
  ' https://api.ikhdev.xyz/v1   (для OpenAI-формата)',
  ' https://api.ikhdev.xyz       (для Claude/Anthropic-формата, без /v1!)',
  'Модели: glm-5.3, glm-5.2, deepseek-v4-pro, deepseek-v4-flash, kimi-k3, qwen3.8-max',
].join('\n');

describe('parseProviderPackage — Дanya blob', () => {
  const parsed = parseProviderPackage(DANYA_BLOB);

  it('extracts the API key', () => {
    expect(parsed.apiKey).toBe('sk-8rYKLLlExIrwKMR166zMCKpIQsp3wBlBaQMJ0LujlvNtIU7S');
  });

  it('extracts both bases with adapters (openai /v1 first, anthropic bare second)', () => {
    expect(parsed.bases).toEqual([
      { url: 'https://api.ikhdev.xyz/v1', adapterType: 'openai_compatible' },
      { url: 'https://api.ikhdev.xyz', adapterType: 'anthropic' },
    ]);
  });

  it('extracts exactly the 6 listed models in order', () => {
    expect(parsed.models).toEqual([
      'glm-5.3',
      'glm-5.2',
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'kimi-k3',
      'qwen3.8-max',
    ]);
  });

  it('suggests a name from the host', () => {
    expect(parsed.suggestedName).toBe('ikhdev.xyz');
  });

  it('is not empty', () => {
    expect(isPackageEmpty(parsed)).toBe(false);
  });
});

describe('parseProviderPackage — single base', () => {
  it('bare URL with no hints defaults to openai_compatible', () => {
    const parsed = parseProviderPackage(
      'key: sk-abcdefgh12345678\nhttps://api.foo.dev\nМодели: gpt-4o, claude-3.5-sonnet',
    );
    expect(parsed.apiKey).toBe('sk-abcdefgh12345678');
    expect(parsed.bases).toEqual([
      { url: 'https://api.foo.dev', adapterType: 'openai_compatible' },
    ]);
    expect(parsed.models).toEqual(['gpt-4o', 'claude-3.5-sonnet']);
    expect(parsed.suggestedName).toBe('foo.dev');
  });

  it('bare URL marked as Claude becomes anthropic', () => {
    const parsed = parseProviderPackage(
      'Ключ: sk-test1234567890abcdef\nhttps://api.bar.dev (для Claude)\n',
    );
    expect(parsed.bases).toEqual([
      { url: 'https://api.bar.dev', adapterType: 'anthropic' },
    ]);
  });

  it('URL with /v1 path stays openai_compatible even without hints', () => {
    const parsed = parseProviderPackage('https://api.baz.dev/v1');
    expect(parsed.bases).toEqual([
      { url: 'https://api.baz.dev/v1', adapterType: 'openai_compatible' },
    ]);
  });
});

describe('parseProviderPackage — missing parts', () => {
  it('missing key → apiKey null, rest still parsed', () => {
    const parsed = parseProviderPackage(
      'Base: https://api.example.com/v1\nМодели: model-a1, model-b2',
    );
    expect(parsed.apiKey).toBeNull();
    expect(parsed.bases).toEqual([
      { url: 'https://api.example.com/v1', adapterType: 'openai_compatible' },
    ]);
    expect(parsed.models).toEqual(['model-a1', 'model-b2']);
  });

  it('missing models → empty list, key not mistaken for a model', () => {
    const parsed = parseProviderPackage(
      'Ключ: sk-abcdefgh12345678\nBase: https://api.foo.dev\n',
    );
    expect(parsed.apiKey).toBe('sk-abcdefgh12345678');
    expect(parsed.models).toEqual([]);
  });

  it('models listed on continuation lines after the label', () => {
    const parsed = parseProviderPackage(
      'Модели:\ngpt-4o\nclaude-3-opus\n\nДругое: не модель',
    );
    expect(parsed.models).toEqual(['gpt-4o', 'claude-3-opus']);
  });

  it('models found without a label via strict fallback scan', () => {
    const parsed = parseProviderPackage(
      'Ключ: sk-abcdefgh12345678\nhttps://api.foo.dev/v1\ndostupny deepseek-v4-pro i glm-5.3',
    );
    expect(parsed.models).toEqual(['deepseek-v4-pro', 'glm-5.3']);
  });
});

describe('parseProviderPackage — messy chat formats', () => {
  const KEY = 'sk-8rYKLLlExIrwKMR166zMCKpIQsp3wBlBaQMJ0LujlvNtIU7S';

  it('Telegram desktop export with "[date] sender:" prefixes', () => {
    const blob = [
      '[27.08.2026 16:00] Даня: Привет! Вот пакет провайдера:',
      `[27.08.2026 16:01] Даня: Ключ: ${KEY}`,
      '[27.08.2026 16:02] Даня: Base: https://api.ikhdev.xyz/v1',
      '[27.08.2026 16:03] Даня: Модели: glm-5.3, deepseek-v4-pro, kimi-k3',
    ].join('\n');
    const parsed = parseProviderPackage(blob);
    expect(parsed.apiKey).toBe(KEY);
    expect(parsed.bases).toEqual([
      { url: 'https://api.ikhdev.xyz/v1', adapterType: 'openai_compatible' },
    ]);
    expect(parsed.models).toEqual(['glm-5.3', 'deepseek-v4-pro', 'kimi-k3']);
    expect(parsed.suggestedName).toBe('ikhdev.xyz');
  });

  it('timestamp-only prefix directly followed by a URL keeps the URL intact', () => {
    const parsed = parseProviderPackage('[27.08.2026 16:00] https://api.foo.dev/v1');
    expect(parsed.bases).toEqual([
      { url: 'https://api.foo.dev/v1', adapterType: 'openai_compatible' },
    ]);
  });

  it('WhatsApp-style "date, time - sender:" prefixes', () => {
    const blob = [
      '27.08.2026, 16:00 - Даня: Держи пакет',
      `27.08.2026, 16:01 - Даня: Ключ: ${KEY}`,
      '27.08.2026, 16:02 - Даня: Base: https://api.ikhdev.xyz/v1',
    ].join('\n');
    const parsed = parseProviderPackage(blob);
    expect(parsed.apiKey).toBe(KEY);
    expect(parsed.bases).toEqual([
      { url: 'https://api.ikhdev.xyz/v1', adapterType: 'openai_compatible' },
    ]);
  });

  it('code fences, markdown quotes, bullets and bold are stripped', () => {
    const blob = [
      '> Пакет от провайдера',
      '```',
      '**Ключ:** sk-abcdefgh12345678',
      'Base:',
      '- https://api.foo.dev/v1',
      '```',
      'Модели:',
      '* gpt-4o',
      '* claude-3.5-sonnet',
      '',
      'Лишняя строка после пустой',
    ].join('\n');
    const parsed = parseProviderPackage(blob);
    expect(parsed.apiKey).toBe('sk-abcdefgh12345678');
    expect(parsed.bases).toEqual([
      { url: 'https://api.foo.dev/v1', adapterType: 'openai_compatible' },
    ]);
    expect(parsed.models).toEqual(['gpt-4o', 'claude-3.5-sonnet']);
  });

  it('no-models blob inside chat noise parses fine with empty models', () => {
    const blob = [
      '[27.08.2026 16:00] Даня: Вот, только ключ и база:',
      `[27.08.2026 16:00] Даня: ${KEY}`,
      '[27.08.2026 16:01] Даня: https://api.ikhdev.xyz/v1',
    ].join('\n');
    const parsed = parseProviderPackage(blob);
    expect(parsed.apiKey).toBe(KEY);
    expect(parsed.bases).toHaveLength(1);
    expect(parsed.models).toEqual([]);
    expect(isPackageEmpty(parsed)).toBe(false);
  });

  it('both-formats blob in a Telegram export yields openai base first, anthropic second', () => {
    const blob = [
      '[27.08.2026 16:00] Даня: Ключ: sk-8rYKLLlExIrwKMR166zMCKpIQsp3wBlBaQMJ0LujlvNtIU7S',
      '[27.08.2026 16:01] Даня: Base:',
      '[27.08.2026 16:01] Даня:  https://api.ikhdev.xyz/v1   (для OpenAI-формата)',
      '[27.08.2026 16:02] Даня:  https://api.ikhdev.xyz       (для Claude/Anthropic-формата, без /v1!)',
    ].join('\n');
    const parsed = parseProviderPackage(blob);
    expect(parsed.bases).toEqual([
      { url: 'https://api.ikhdev.xyz/v1', adapterType: 'openai_compatible' },
      { url: 'https://api.ikhdev.xyz', adapterType: 'anthropic' },
    ]);
  });

  it('anthropic host without hints is inferred as anthropic', () => {
    const parsed = parseProviderPackage('https://api.anthropic.com');
    expect(parsed.bases).toEqual([
      { url: 'https://api.anthropic.com', adapterType: 'anthropic' },
    ]);
  });
});

describe('parseProviderPackage — garbage input', () => {
  it('garbage text → nothing recognized, never throws', () => {
    expect(() => parseProviderPackage('привет как дела %%% ### <<<>>>')).not.toThrow();
    const parsed = parseProviderPackage('привет как дела %%% ### <<<>>>');
    expect(parsed.apiKey).toBeNull();
    expect(parsed.bases).toEqual([]);
    expect(parsed.models).toEqual([]);
    expect(parsed.suggestedName).toBeNull();
    expect(isPackageEmpty(parsed)).toBe(true);
  });

  it('empty string → nothing recognized', () => {
    const parsed = parseProviderPackage('');
    expect(isPackageEmpty(parsed)).toBe(true);
  });

  it('non-string input → nothing recognized, never throws', () => {
    const parsed = parseProviderPackage(undefined as unknown as string);
    expect(isPackageEmpty(parsed)).toBe(true);
  });

  it('malformed URL does not throw', () => {
    expect(() => parseProviderPackage('https://\nsk-abcdefgh12345678')).not.toThrow();
  });
});
