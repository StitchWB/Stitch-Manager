import { extractKeyTokens, parsePastedProviders } from '@/lib/utils/parsePastedProviders';

const CARD_ZHIZENGZENG = `[19.08.2026 12:16] Даня:
Переслано от nemets Оскар
буду покупать твое менторство ключами

⭐ Топ-модели (premium): api.zhizengzeng.com

🔑 Ключи: 1

🧩 Модели: 160

🌐 Base URL: https://api.zhizengzeng.com/v1

#1 🔑 Ключ: sk-zk000102030405060708090a0b0c0d0e0f1011121314151617

📅 Дата: 2026-08-18 23:58 UTC
📊 Тир: 1M tok/min (крупный)

🧬 Embed/Rerank: embed ✅

🧩 Модели:

✅ Работают: 

⭐ claude-opus-4-8, ⭐ gpt-5.5, ⭐ gpt-5.5-2026-04-23, ⭐ glm-5.2, ⭐ kimi-k3`;

const CARD_IKHDEV = `[27.08.2026 16:00] Даня:
Переслано от I k h d e v
Ключ:  sk-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfGhIj

Base: 
 https://api.ikhdev.xyz/v1   (для OpenAI-формата)
 https://api.ikhdev.xyz       (для Claude/Anthropic-формата, без /v1!)

Модели: glm-5.3, glm-5.2, deepseek-v4-pro, deepseek-v4-flash, kimi-k3, qwen3.8-max`;

const TABLE_DASHSCOPE = `[08.10.2026 19:25] Даня:
Переслано от Слава
┌────┬─────────────────────────────────────┬──────────────┬────────────────────┐
 │ #  │ Key                                 │ Status       │ Working Model      │
 ├────┼─────────────────────────────────────┼──────────────┼────────────────────┤
 │ 1  │ sk-000102030405060708090a0b0c0d0e0f │ ✅ WORKING   │ qwen3.8-omni-flash │
 ├────┼─────────────────────────────────────┼──────────────┼────────────────────┤
 │ 2  │ sk-1112131415161718191a1b1c1d1e1f20 │ ✅ WORKING   │ qwen-plus          │
 ├────┼─────────────────────────────────────┼──────────────┼────────────────────┤
 │ 3  │ sk-2122232425262728292a2b2c2d2e2f30 │ ✅ WORKING   │ qwen-plus          │
 └────┴─────────────────────────────────────┴──────────────┴────────────────────┘`;

const HEADERS_WITH_URLS = `[14.10.2026 21:09] Даня:
Переслано от Слава
DashScope CN — https://dashscope.aliyuncs.com/compatible-mode/v1

   sk-3132333435363738393a3b3c3d3e3f40
   sk-4142434445464748494a4b4c4d4e4f50
   sk-5152535455565758595a5b5c5d5e5f60

 GLM / Zhipu — https://open.bigmodel.cn/api/paas/v4

   6162636465666768696a6b6c6d6e6f70.xXpRlN58z1oEhXlG`;

const MONEY_BLOCKS = `[18.10.2026 22:27] Даня:
Переслано от Слава
💰 +1
DASHSCOPE  sk-718293a4b5c6d7e8f90a1b2c3d4e5f60  CN:full

💰 +1
DASHSCOPE  sk-8192a3b4c5d6e7f8091a2b3c4d5e6f70  CN:notfull (10/11 models)

💰 +1
DASHSCOPE 
sk-ws-H.AAAAAAA.bbbb.MEUCIQD-synthetic_payload_0001 
  CN:notfull(10/11 models)`;

const FENCED_FINDINGS = `[23.10.2026 14:07] Даня:
Ценные находки — ключи с балансом

 DashScope (4 живых):

 \`\`\`
   sk-9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d  → quota OK
 \`\`\`

 DeepSeek (7 живых, с балансами):

 \`\`\`
   sk-ab1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e  → $21.28 CNY
 \`\`\`

 Kimi/Moonshot (66 живых, 2 с реальным балансом):

 \`\`\`
   sk-KkKkKKkK6l3ghAqXQJ6Tpw0DDFIsoK8OBi6CbO3ZLe76QF0X  → ¥0 cash + ¥240 voucher
   sk-MmMmMMmM7m4hiBrYRK7Uqx1EEGJTpL9PCj7DcP4aMf87RG1Y
 \`\`\`

 TWOCAPTCHA (1)  💰 ~$28.34
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa   # bal:$28.34 plan:bal:28.34 val:23.10 04:18 src:imeSVP/simulatoreBr`;

const COMPACT_KIMI = `KIMI (3)  💰 ~$247.15
sk-NnNnNNnN8n5ijCsZSL8Vry2FFHKUqM0QDk8EdQ5bNg98SH2Z   # bal:$1.68 plan:CN:bal:1.68 val:23.10 06:19 src:gitee:yang1-tao22222/moligeocms sk-OoOoOOoO9o6jkDtATMA9Wsz3GGILrN1REl9FeR6cOh09TI3A   # bal:$240.00 plan:CN:bal:240.00 val:23.10 05:19 src:Arshim28/pitch_agent sk-PpPpPPpP0p7klEuBUNA0Xta4HHJMxO2SFm0GfS7dPi10UJ4B   # bal:$5.47 plan:INTL:bal:5.47 val:23.10 03:18 src:sandrow007/manolito-aire`;

const REPORT_MIXED = `📊 За 3 ч валидных: 10
DASHSCOPE (отвечают): 8 · балансовых: 2 · Σ $98.35

ANTICAPTCHA $91.80 WORKING
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
DASHSCOPE WORKING
sk-000102030405060708090a0b0c0d0e0f
TWOCAPTCHA $6.55 WORKING
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
ZAI WORKING
1112131415161718191a1b1c1d1e1f20.AbCdEfGhIjKlMnOp
🔑 Чек API — deepseek
sk-22222222222222222222222222222222
· Провайдер: deepseek
Основной эндпоинт:
✅ ·
https://api.deepseek.com`;

function keysOf(entries: ReturnType<typeof parsePastedProviders>['entries'], baseUrl: string): string[] {
  return entries.find(entry => entry.baseUrl === baseUrl)?.keys ?? [];
}

describe('parsePastedProviders', () => {
  it('reads a provider card with a labeled base URL and key', () => {
    const { entries, ignoredLabels } = parsePastedProviders(CARD_ZHIZENGZENG);
    expect(entries).toHaveLength(1);
    expect(entries[0].baseUrl).toBe('https://api.zhizengzeng.com/v1');
    expect(entries[0].keys).toEqual([
      'sk-zk000102030405060708090a0b0c0d0e0f1011121314151617',
    ]);
    expect(entries[0].models).toContain('claude-opus-4-8');
    expect(entries[0].models).toContain('gpt-5.5');
    expect(entries[0].models).not.toContain('160');
    expect(ignoredLabels).toEqual([]);
  });

  it('attaches a key that precedes the Base label to the following endpoint', () => {
    const { entries } = parsePastedProviders(CARD_IKHDEV);
    expect(entries).toHaveLength(1);
    expect(entries[0].baseUrl).toBe('https://api.ikhdev.xyz/v1');
    expect(entries[0].keys).toEqual(['sk-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfGhIj']);
    expect(entries[0].models).toContain('glm-5.3');
    expect(entries[0].models).toContain('deepseek-v4-pro');
  });

  it('keeps keys from an ascii table that carries no endpoint', () => {
    const { entries } = parsePastedProviders(TABLE_DASHSCOPE);
    expect(entries).toHaveLength(1);
    expect(entries[0].baseUrl).toBe('');
    expect(entries[0].keys).toEqual([
      'sk-000102030405060708090a0b0c0d0e0f',
      'sk-1112131415161718191a1b1c1d1e1f20',
      'sk-2122232425262728292a2b2c2d2e2f30',
    ]);
  });

  it('splits sections that carry their endpoint inline', () => {
    const { entries } = parsePastedProviders(HEADERS_WITH_URLS);
    expect(entries).toHaveLength(2);
    expect(keysOf(entries, 'https://dashscope.aliyuncs.com/compatible-mode/v1')).toEqual([
      'sk-3132333435363738393a3b3c3d3e3f40',
      'sk-4142434445464748494a4b4c4d4e4f50',
      'sk-5152535455565758595a5b5c5d5e5f60',
    ]);
    expect(keysOf(entries, 'https://open.bigmodel.cn/api/paas/v4')).toEqual([
      '6162636465666768696a6b6c6d6e6f70.xXpRlN58z1oEhXlG',
    ]);
  });

  it('reads keys that sit next to status prose and resolves the endpoint from the label', () => {
    const { entries } = parsePastedProviders(MONEY_BLOCKS);
    expect(entries).toHaveLength(1);
    expect(entries[0].baseUrl).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
    expect(entries[0].keys).toEqual([
      'sk-718293a4b5c6d7e8f90a1b2c3d4e5f60',
      'sk-8192a3b4c5d6e7f8091a2b3c4d5e6f70',
      'sk-ws-H.AAAAAAA.bbbb.MEUCIQD-synthetic_payload_0001',
    ]);
  });

  it('reads fenced sections and drops captcha services', () => {
    const { entries, ignoredLabels } = parsePastedProviders(FENCED_FINDINGS);
    expect(entries).toHaveLength(3);
    expect(keysOf(entries, 'https://dashscope.aliyuncs.com/compatible-mode/v1')).toEqual([
      'sk-9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d',
    ]);
    expect(keysOf(entries, 'https://api.deepseek.com/v1')).toEqual([
      'sk-ab1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e',
    ]);
    const kimi = entries.find(entry => entry.baseUrl === '');
    expect(kimi?.keys).toEqual([
      'sk-KkKkKKkK6l3ghAqXQJ6Tpw0DDFIsoK8OBi6CbO3ZLe76QF0X',
      'sk-MmMmMMmM7m4hiBrYRK7Uqx1EEGJTpL9PCj7DcP4aMf87RG1Y',
    ]);
    expect(ignoredLabels).toEqual(['TWOCAPTCHA']);
  });

  it('takes three keys from one line and ignores the src metadata', () => {
    const { entries } = parsePastedProviders(COMPACT_KIMI);
    expect(entries).toHaveLength(1);
    expect(entries[0].baseUrl).toBe('');
    expect(entries[0].keys).toEqual([
      'sk-NnNnNNnN8n5ijCsZSL8Vry2FFHKUqM0QDk8EdQ5bNg98SH2Z',
      'sk-OoOoOOoO9o6jkDtATMA9Wsz3GGILrN1REl9FeR6cOh09TI3A',
      'sk-PpPpPPpP0p7klEuBUNA0Xta4HHJMxO2SFm0GfS7dPi10UJ4B',
    ]);
    for (const key of entries[0].keys) {
      expect(key).not.toContain('gitee');
      expect(key).not.toContain('Arshim28');
      expect(key).not.toContain('sandrow007');
    }
  });

  it('reads the WORKING report, keeps unmapped labels and claims orphan keys', () => {
    const { entries, ignoredLabels } = parsePastedProviders(REPORT_MIXED);
    expect(entries).toHaveLength(3);
    expect(keysOf(entries, 'https://dashscope.aliyuncs.com/compatible-mode/v1')).toEqual([
      'sk-000102030405060708090a0b0c0d0e0f',
    ]);
    expect(keysOf(entries, '')).toEqual(['1112131415161718191a1b1c1d1e1f20.AbCdEfGhIjKlMnOp']);
    expect(keysOf(entries, 'https://api.deepseek.com/v1')).toEqual([
      'sk-22222222222222222222222222222222',
    ]);
    expect(ignoredLabels).toEqual(['ANTICAPTCHA', 'TWOCAPTCHA']);
  });

  it('never invents an endpoint for an unmapped provider label', () => {
    const { entries } = parsePastedProviders(REPORT_MIXED);
    const zai = entries.find(entry => entry.name === 'ZAI');
    expect(zai?.baseUrl).toBe('');
  });

  it('reads a key followed by pipe and model prose', () => {
    const { entries } = parsePastedProviders(
      'sk-000102030405060708090a0b0c0d0e0f │ —      │ 176 models | qwen-plus responded ',
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].baseUrl).toBe('');
    expect(entries[0].keys).toEqual(['sk-000102030405060708090a0b0c0d0e0f']);
  });
});

describe('extractKeyTokens', () => {
  it('pulls every key out of a metadata line', () => {
    const line = COMPACT_KIMI.split('\n')[1];
    expect(extractKeyTokens(line)).toHaveLength(3);
  });

  it('ignores model identifiers', () => {
    expect(extractKeyTokens('⭐ claude-opus-4-8, ⭐ gpt-5.5-2026-04-23')).toEqual([]);
    expect(extractKeyTokens('qwen3.8-omni-flash')).toEqual([]);
  });

  it('keeps workspace keys whole', () => {
    expect(extractKeyTokens('sk-ws-H.AAAAAAA.bbbb.MEUCIQD-synthetic_payload_0001')).toEqual([
      'sk-ws-H.AAAAAAA.bbbb.MEUCIQD-synthetic_payload_0001',
    ]);
  });

  it('does not emit the inner hex slice of an sk key', () => {
    expect(extractKeyTokens('sk-000102030405060708090a0b0c0d0e0f')).toEqual([
      'sk-000102030405060708090a0b0c0d0e0f',
    ]);
  });

  it('reads dotted provider keys without the sk prefix', () => {
    expect(extractKeyTokens('8967dd709b4a47bab08aba49ba6936d4.xXpRlN58z1oEhXlG')).toEqual([
      '8967dd709b4a47bab08aba49ba6936d4.xXpRlN58z1oEhXlG',
    ]);
  });
});