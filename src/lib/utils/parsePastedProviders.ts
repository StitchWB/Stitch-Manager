import type { ParsedProviderEntry } from './parseProviderText';

export interface ParsedPaste {
  entries: ParsedProviderEntry[];
  ignoredLabels: string[];
}

const KEY_TOKEN_PATTERN =
  /(?<![A-Za-z0-9])sk-[A-Za-z0-9._+=/-]{8,}|(?<![0-9a-fA-F])[0-9a-fA-F]{32}\.[A-Za-z0-9]{8,}(?![A-Za-z0-9])|(?<![0-9a-fA-F])[0-9a-fA-F]{32}(?![0-9a-fA-F])/g;
const LABELED_KEY_PATTERN = /(?:🔑\s*)?(?:Ключ|Key|API[\s-]?key|Token)\s*[:：]\s*(\S{12,})/gi;
const URL_PATTERN = /https?:\/\/[^\s<>"'`│|)]+/g;
const URL_LABEL_PATTERN = /(?:Base\s*URL|Base|URL)\s*[:：]\s*$/i;
const MODELS_MARKER = /^[^\p{L}\p{N}]*?(?:Модели|Models)\s*[:：]/iu;
const LABEL_MARKER = /WORKING|\(|\$|💰|—|–|Провайдер\s*[:：]/i;
const NAME_PATTERN =
  /^([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9._-]*(?:[\s/]+[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9._-]*)*)/;
const MODEL_TOKEN_PATTERN = /^[a-z0-9][a-z0-9._:-]{2,}$/i;
const COUNTRY_TOKEN = /\b(?:CN|INTL|US|EU|GLOBAL)\s*:[^\s]*/gi;
const COUNTRY_SUFFIX = /\s+(?:CN|INTL|US|EU|GLOBAL)$/i;
const TRAILING_PUNCTUATION = /[.,;:]+$/;
const DENY_HOSTS = ['github.com', 'gitee.com', 't.me'];
const MODEL_SKIP_TOKENS = new Set([
  'модели',
  'models',
  'работают',
  'листятся',
  'working',
  'listed',
]);
const NON_INFERENCE_LABELS = new Set([
  'anticaptcha',
  'twocaptcha',
  '2captcha',
  'capmonster',
  'capsolver',
  'yescaptcha',
  'rucaptcha',
]);

const LABEL_BASE_URLS: Record<string, string> = {
  dashscope: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  deepseek: 'https://api.deepseek.com/v1',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  together: 'https://api.together.xyz/v1',
};

interface Group {
  label: string | null;
  baseUrl: string;
  keys: string[];
  models: string[];
}

function stripNoise(raw: string): string {
  const normalized = raw
    .replace(/^\[\d{1,2}\.\d{1,2}\.\d{4}\s+\d{1,2}:\d{2}\]\s*[^:\n]{0,40}:\s*/, '')
    .replace(/[│┌┐└┘├┤┬┴┼─]/g, ' ')
    .replace(/```/g, ' ');
  return normalized.replace(/^[>\s]+/, '').trim();
}

export function extractKeyTokens(line: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const match of line.matchAll(KEY_TOKEN_PATTERN)) {
    const token = match[0].replace(TRAILING_PUNCTUATION, '');
    if (!token || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

function extractLabeledKeys(line: string): string[] {
  const keys: string[] = [];
  for (const match of line.matchAll(LABELED_KEY_PATTERN)) {
    const value = match[1].replace(TRAILING_PUNCTUATION, '');
    if (value.length >= 12) keys.push(value);
  }
  return keys;
}

function isDeniedHost(url: string): boolean {
  try {
    const host = new URL(url).host.toLowerCase();
    return DENY_HOSTS.some(denied => host === denied || host.endsWith(`.${denied}`));
  } catch {
    return true;
  }
}

function wordsOutsideUrl(line: string, url: string): number {
  const rest = line
    .replace(url, ' ')
    .replace(/[—–·:()[\]]/g, ' ')
    .trim();
  return rest ? rest.split(/\s+/).length : 0;
}

function extractUrl(line: string): string | null {
  const labeled = URL_LABEL_PATTERN.test(line);
  for (const match of line.matchAll(URL_PATTERN)) {
    const url = match[0].replace(TRAILING_PUNCTUATION, '');
    if (!/^https?:\/\//i.test(url) || isDeniedHost(url)) continue;
    if (labeled || wordsOutsideUrl(line, match[0]) <= 6) return url;
  }
  return null;
}

function stripTailDecorations(tail: string): boolean {
  let rest = tail;
  let changed = true;
  while (changed) {
    changed = false;
    const match = rest.match(
      /^(?:\s+|\([^)]*\)|WORKING\b|\$[\d.,]+|💰\s*~?\$?\s*[\d.,]*|—|–|·|:(?!\S))/i,
    );
    if (match && match[0].length > 0) {
      rest = rest.slice(match[0].length);
      changed = true;
    }
  }
  return rest.trim() === '';
}

function extractLabel(line: string, keys: string[], url: string | null): string | null {
  if (keys.length === 0 && !url && !LABEL_MARKER.test(line)) return null;
  let rest = line;
  for (const key of keys) rest = rest.replace(key, ' ');
  if (url) rest = rest.replace(url, ' ');
  rest = rest.replace(COUNTRY_TOKEN, ' ').trim();
  const prefix = rest.match(/^(?:[·•]\s*)?(?:Провайдер\s*[:：]\s*)?/i);
  if (prefix) rest = rest.slice(prefix[0].length);
  const nameMatch = rest.match(NAME_PATTERN);
  if (!nameMatch) return null;
  if (!stripTailDecorations(rest.slice(nameMatch[0].length))) return null;
  const name = nameMatch[1]
    .trim()
    .replace(/\s+WORKING$/i, '')
    .replace(COUNTRY_SUFFIX, '')
    .trim();
  return name || null;
}

function extractModelTokens(text: string): string[] {
  const models: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const token = raw.replace(/^[⭐✅·•]+/, '').replace(/[.…]+$/, '');
    if (!token || !MODEL_TOKEN_PATTERN.test(token)) continue;
    if (!/[A-Za-zА-Яа-яЁё]/.test(token)) continue;
    const normalized = token.toLowerCase().replace(/[:：]$/, '');
    if (MODEL_SKIP_TOKENS.has(normalized)) continue;
    if (!models.includes(token)) models.push(token);
  }
  return models;
}

function canonicalLabel(label: string): string | null {
  const normalized = label.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const first = normalized.split(' ')[0];
  if (first === 'dashscope' || first === 'dash') return 'dashscope';
  return first in LABEL_BASE_URLS ? first : null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export function parsePastedProviders(text: string): ParsedPaste {
  const groups: Group[] = [];
  const pending: string[] = [];
  let current: Group | null = null;
  let lastKeyGroup: Group | null = null;
  let lastKind: 'label' | 'key' | 'url' | 'none' = 'none';
  let anchor = false;
  let modelsMode = false;

  const createGroup = (label: string | null, baseUrl: string): Group => {
    const group: Group = { label, baseUrl, keys: pending.splice(0), models: [] };
    groups.push(group);
    return group;
  };

  for (const raw of text.split('\n')) {
    const line = stripNoise(raw);
    if (!line) continue;

    const prevAnchor = anchor;
    anchor = false;

    const keys = [...extractKeyTokens(line), ...extractLabeledKeys(line)];
    const url = extractUrl(line);
    const label = extractLabel(line, keys, url);

    if (label) {
      current = createGroup(label, '');
      anchor = true;
    }
    if (url) {
      if (!(prevAnchor && lastKind === 'url')) {
        if (current && !current.baseUrl) {
          current.baseUrl = url;
          if (current.keys.length === 0) current.keys.push(...pending.splice(0));
        } else if (current && current.keys.length === 0) {
          current.baseUrl = url;
        } else {
          current = createGroup(null, url);
        }
        lastKind = 'url';
      }
      anchor = true;
    }
    if (keys.length > 0) {
      if (current && (prevAnchor || anchor)) {
        for (const key of keys) if (!current.keys.includes(key)) current.keys.push(key);
        lastKeyGroup = current;
      } else {
        for (const key of keys) if (!pending.includes(key)) pending.push(key);
        if (current) lastKeyGroup = current;
      }
      anchor = true;
      lastKind = 'key';
    }

    const modelsMarker = MODELS_MARKER.test(line);
    if (modelsMarker) modelsMode = true;
    if (modelsMode) {
      const source = modelsMarker ? line.replace(MODELS_MARKER, ' ') : line;
      const target = current ?? lastKeyGroup;
      if (target) {
        for (const model of extractModelTokens(source)) {
          if (!target.models.includes(model)) target.models.push(model);
        }
      }
    }
    if (modelsMarker && anchor) modelsMode = false;
    if (!anchor) lastKind = 'none';
  }

  if (pending.length > 0) {
    if (current) {
      for (const key of pending) if (!current.keys.includes(key)) current.keys.push(key);
    } else {
      groups.push({ label: null, baseUrl: '', keys: pending.splice(0), models: [] });
    }
  }

  const ignoredLabels: string[] = [];
  const entries: ParsedProviderEntry[] = [];
  const byUrl = new Map<string, ParsedProviderEntry>();
  const seenKeys = new Set<string>();

  for (const group of groups) {
    const numericLabel = (group.label ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (group.label && NON_INFERENCE_LABELS.has(numericLabel)) {
      if (!ignoredLabels.includes(group.label)) ignoredLabels.push(group.label);
      continue;
    }
    if (group.keys.length === 0) continue;
    const canonical = group.label ? canonicalLabel(group.label) : null;
    const canonicalUrl = canonical ? LABEL_BASE_URLS[canonical] : '';
    let baseUrl = group.baseUrl || canonicalUrl || '';
    if (group.baseUrl && canonicalUrl && hostOf(group.baseUrl) === hostOf(canonicalUrl)) {
      baseUrl = canonicalUrl;
    }
    const normalized = normalizeUrl(baseUrl);
    let entry = normalized ? byUrl.get(normalized) : undefined;
    if (!entry) {
      entry = { name: group.label, baseUrl, keys: [], models: [] };
      entries.push(entry);
      if (normalized) byUrl.set(normalized, entry);
    } else if (!entry.name && group.label) {
      entry.name = group.label;
    }
    for (const key of group.keys) {
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      entry.keys.push(key);
    }
    for (const model of group.models) {
      if (!entry.models.includes(model)) entry.models.push(model);
    }
  }

  return { entries: entries.filter(entry => entry.keys.length > 0), ignoredLabels };
}
