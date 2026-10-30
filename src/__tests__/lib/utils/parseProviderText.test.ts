import { describe, it, expect } from '@jest/globals';

import { parseProviderEntries, parseProviderEntriesWithMeta, looksLikeApiKey } from '@/lib/utils/parseProviderText';

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

const CHECK_REPORT = `[29.10.2026 8:13] X: 📊 Отчёт: 10
DASHSCOPE (отвечают): 8 · балансовых: 2 · Σ $98.35
ANTICAPTCHA $91.80 WORKING
0f1e2d3c4b5a697886756454342415141
DASHSCOPE WORKING
sk-11111111111111111111111111111111
sk-ws-AAAA.BBBB.CCCC.DDDD.EEEE.FFFF
TWOCAPTCHA $6.55 WORKING
1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7
🔑 Чек API — deepseek
sk-22222222222222222222222222222222
· Провайдер: deepseek
Основной эндпоинт:
✅ ·
https://api.deepseek.com
✅ чат работает · 3 проб · api.deepseek.com
✅ deepseek-v4-pro — 200 · 1.8с`;

describe('looksLikeApiKey', () => {
  it('accepts whole-line key shapes', () => {
    for (const line of [
      'sk-test-key-123',
      'sk-abcdefghijklmnop1234567890',
      'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
      'sk-ws-H.EHXEDRR.pnSb.MEQCIAQh',
    ]) {
      expect(looksLikeApiKey(line)).toBe(true);
    }
  });

  it('rejects model names, URLs and report noise lines', () => {
    for (const line of [
      'deepseek-v4-pro',
      'https://api.deepseek.com',
      '✅ ·',
      '[29.10.2026 8:13] x: 10',
      'DASHSCOPE WORKING',
    ]) {
      expect(looksLikeApiKey(line)).toBe(false);
    }
  });
});

describe('check-report format', () => {
  it('yields one entry per inference provider with the resolved canonical base URLs', () => {
    const entries = parseProviderEntries(CHECK_REPORT);

    expect(entries.map(entry => entry.baseUrl)).toEqual([
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
      'https://api.deepseek.com/v1',
    ]);
    expect(entries.every(entry => entry.name === null)).toBe(true);
    expect(entries.every(entry => entry.models.length === 0)).toBe(true);
  });

  it('collects the WORKING-list keys and the key preceding the provider label', () => {
    const entries = parseProviderEntries(CHECK_REPORT);

    expect(entries[0].keys).toEqual([
      'sk-11111111111111111111111111111111',
      'sk-ws-AAAA.BBBB.CCCC.DDDD.EEEE.FFFF',
    ]);
    expect(entries[1].keys).toEqual(['sk-22222222222222222222222222222222']);
  });

  it('drops captcha-service groups and never turns noise lines into keys', () => {
    const allKeys = parseProviderEntries(CHECK_REPORT).flatMap(entry => entry.keys);

    expect(allKeys).toHaveLength(3);
    expect(allKeys).not.toContain('0f1e2d3c4b5a697886756454342415141');
    expect(allKeys).not.toContain('1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7');
    expect(allKeys).not.toContain('deepseek-v4-pro');
    expect(allKeys).not.toContain('https://api.deepseek.com');
    expect(allKeys).not.toContain('✅ ·');
    expect(allKeys).not.toContain('DASHSCOPE WORKING');
  });
});

describe('parseProviderEntriesWithMeta', () => {
  it('reports the dropped captcha labels with the captured case, in first-seen order', () => {
    const { entries, ignoredLabels } = parseProviderEntriesWithMeta(CHECK_REPORT);

    expect(ignoredLabels).toEqual(['ANTICAPTCHA', 'TWOCAPTCHA']);
    expect(entries).toEqual(parseProviderEntries(CHECK_REPORT));
  });

  it('reports nothing ignored for a plain provider paste', () => {
    expect(parseProviderEntriesWithMeta(TELEGRAM_POST).ignoredLabels).toEqual([]);
  });
});
