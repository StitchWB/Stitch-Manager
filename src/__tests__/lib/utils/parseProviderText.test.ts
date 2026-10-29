import { describe, it, expect } from '@jest/globals';

import { parseProviderEntries } from '@/lib/utils/parseProviderText';

const TELEGRAM_POST = `[11.10.2026 9:28] ICHINOKATA: 🌐 Base URL: https://api.groq.com/openai/v1

🔑 Ключ: gsk_example_groq_key_one_not_real
📅 Дата: 2026-10-11 06:27 UTC
[11.10.2026 9:38] ICHINOKATA: 🌐 Base URL: https://apihub.agnes-ai.com/v1

🔑 Ключ: sk-example-agnes-key-not-real
📅 Дата: 2026-10-11 06:38 UTC
[11.10.2026 9:43] ICHINOKATA: 🌐 Base URL: https://api.groq.com/openai/v1

🔑 Ключ: gsk_example_groq_key_two_not_real
📅 Дата: 2026-10-11 06:42 UTC
[11.10.2026 14:39] ICHINOKATA: 🌐 Base URL: https://api.mistral.ai/v1

🔑 Ключ: example-mistral-key-not-real
📅 Дата: 2026-10-11 11:37 UTC

🧩 Модели:

✅ Работают: ministral-14b-2512

📋 Листятся: codestral-2508, codestral-embed, codestral-embed-2505, codestral-latest, labs-leanstral-1-5, labs-leanstral-1-5-1, magistral-medium-latest, magistral-small-latest, ministral-14b-latest, ministral-3b-2512, ministral-3b-latest, ministral-8b-2512, ministral-8b-latest, mistral-code-fim-latest, mistral-code-latest, mistral-embed, mistral-embed-2312, mistral-medium, mistral-medium-2604, mistral-medium-3, mistral-medium-3-5, mistral-medium-3.5, mistral-medium-latest, mistral-moderation-2603, mistral-ocr-2512, mistral-ocr-3, mistral-ocr-3-0, mistral-ocr-4, mistral-ocr-4-0, mistral-ocr-4-1 … (+15 ещё)

@zk_ichinokata
`;

describe('parseProviderEntries', () => {
  it('splits a multi-provider paste into one entry per Base URL label', () => {
    const entries = parseProviderEntries(TELEGRAM_POST);

    expect(entries.map(entry => entry.baseUrl)).toEqual([
      'https://api.groq.com/openai/v1',
      'https://apihub.agnes-ai.com/v1',
      'https://api.groq.com/openai/v1',
      'https://api.mistral.ai/v1',
    ]);
  });

  it('extracts exactly the labeled keys and never model names', () => {
    const entries = parseProviderEntries(TELEGRAM_POST);
    const allKeys = entries.flatMap(entry => entry.keys);

    expect(allKeys).toEqual([
      'gsk_example_groq_key_one_not_real',
      'sk-example-agnes-key-not-real',
      'gsk_example_groq_key_two_not_real',
      'example-mistral-key-not-real',
    ]);
    expect(allKeys).not.toContain('codestral-2508');
    expect(allKeys).not.toContain('ministral-14b-latest');
  });

  it('attaches the models list to the entry that contains it, without noise', () => {
    const entries = parseProviderEntries(TELEGRAM_POST);
    const models = entries[3].models;

    expect(models).toHaveLength(31);
    expect(models).toContain('ministral-14b-2512');
    expect(models).toContain('codestral-2508');
    expect(models).toContain('mistral-medium-3.5');
    expect(models).toContain('mistral-ocr-4-1');
    expect(models).not.toContain('@zk_ichinokata');
    expect(models.join(' ')).not.toContain('ещё');
    expect(models.join(' ')).not.toContain('Работают');
    expect(models.join(' ')).not.toContain('Листятся');
    expect(entries.slice(0, 3).every(entry => entry.models.length === 0)).toBe(true);
  });

  it('returns null names when no explicit name label is present', () => {
    const entries = parseProviderEntries(TELEGRAM_POST);

    expect(entries.every(entry => entry.name === null)).toBe(true);
  });

  it('extracts an unlabeled key via the strict prefix fallback', () => {
    const entries = parseProviderEntries(
      'Base URL: https://api.openai.com/v1\nsk-abcdefghijklmnop1234567890',
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].keys).toEqual(['sk-abcdefghijklmnop1234567890']);
  });

  it('yields zero keys for a models-only paste', () => {
    const withUrl = parseProviderEntries(
      'Base URL: https://api.mistral.ai/v1\nМодели: mistral-small-latest, mistral-medium-latest',
    );
    expect(withUrl[0].keys).toEqual([]);

    const withoutUrl = parseProviderEntries('Модели: gpt-4o, claude-3-5-sonnet');
    expect(withoutUrl).toEqual([]);
  });

  it('reads the provider name only from an explicit label', () => {
    const entries = parseProviderEntries(
      'Base URL: https://relay.example.com/v1\nНазвание: My Relay\nКлюч: sk-abcdefghijklmnop1234567890',
    );

    expect(entries[0].name).toBe('My Relay');
  });

  it('dedupes repeated keys within one entry', () => {
    const entries = parseProviderEntries(
      'Base URL: https://api.openai.com/v1\nКлюч: sk-abcdefghijklmnop1234567890\nКлюч: sk-abcdefghijklmnop1234567890',
    );

    expect(entries[0].keys).toEqual(['sk-abcdefghijklmnop1234567890']);
  });
});
