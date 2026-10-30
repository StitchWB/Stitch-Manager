export interface ParsedProviderEntry {
  name: string | null;
  baseUrl: string;
  keys: string[];
  models: string[];
}

const BASE_URL_PATTERN = /(?<![A-Za-zА-Яа-яЁё])(?:🌐\s*)?(?:Base\s*URL|URL)\s*[:：]\s*(\S+)/gi;
const LABELED_KEY_PATTERN = /(?:🔑\s*)?(?:Ключ|Key|API[\s-]?key|Token)\s*[:：]\s*(\S{12,})/gi;
const STRICT_KEY_PATTERN = /\b(?:sk-|gsk_|fw_|hf_|xai-|AIza|sk-proj-)[A-Za-z0-9_-]{8,}\b/g;
const NAME_PATTERN = /(?<![A-Za-zА-Яа-яЁё])(?:Название|Name)\s*[:：]\s*([^\n]+)/i;
const MODELS_SECTION_PATTERN = /(?<![A-Za-zА-Яа-яЁё])(?:Модели|Models)\s*[:：]/i;
const MODEL_TOKEN_PATTERN = /^[a-z0-9][a-z0-9._:-]{2,}$/i;
const MODEL_LABEL_TOKENS = new Set(['модели', 'models', 'работают', 'листятся', 'working', 'listed']);

const API_KEY_LINE_PATTERN = /^(?:sk-[A-Za-z0-9._+=-]{8,}|gsk_[A-Za-z0-9._+=-]{8,}|fw_[A-Za-z0-9._+=-]{8,}|hf_[A-Za-z0-9._+=-]{8,}|xai-[A-Za-z0-9._+=-]{8,}|AIza[A-Za-z0-9._+=-]{8,}|[A-Za-z0-9][A-Za-z0-9._+=-]{19,})$/;

// Telegram check-report line shapes (external format)
const REPORT_WORKING_LABEL = /^([A-Za-z][A-Za-z0-9_-]{2,})(?:\s+\$[\d.]+)?\s+WORKING$/i;
const REPORT_PROVIDER_LABEL = /Провайдер:\s*([A-Za-z][A-Za-z0-9_-]+)/i;
const REPORT_BARE_URL = /^(?:[✅✓]\s*[·.•-]?\s*)?(https?:\/\/\S+)$/;
const NON_INFERENCE_LABELS = new Set([
  'anticaptcha',
  'twocaptcha',
  '2captcha',
  'capmonster',
  'capsolver',
  'yescaptcha',
  'rucaptcha',
]);
const REPORT_BASE_URLS: Record<string, string> = {
  deepseek: 'https://api.deepseek.com/v1',
  dashscope: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  together: 'https://api.together.xyz/v1',
};

export function looksLikeApiKey(line: string): boolean {
  return API_KEY_LINE_PATTERN.test(line);
}

interface ReportGroup {
  label: string;
  baseUrl: string | null;
  keys: string[];
}

function parseReportGroups(text: string): ReportGroup[] {
  const groups: ReportGroup[] = [];
  const buffer: string[] = [];
  let current: ReportGroup | null = null;
  let attachMode = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const label = REPORT_WORKING_LABEL.exec(line) ?? REPORT_PROVIDER_LABEL.exec(line);
    if (label) {
      const group: ReportGroup = { label: label[1].toLowerCase(), baseUrl: null, keys: buffer.splice(0) };
      groups.push(group);
      current = group;
      attachMode = true;
      continue;
    }
    if (looksLikeApiKey(line)) {
      if (attachMode && current) current.keys.push(line);
      else buffer.push(line);
      continue;
    }
    const url = REPORT_BARE_URL.exec(line);
    if (url && current && current.baseUrl === null) current.baseUrl = url[1];
    attachMode = false;
  }
  if (buffer.length > 0 && current) current.keys.push(...buffer);
  return groups;
}

function appendReportEntries(entries: ParsedProviderEntry[], text: string): void {
  for (const group of parseReportGroups(text)) {
    if (group.keys.length === 0) continue;
    if (NON_INFERENCE_LABELS.has(group.label)) continue;
    const baseUrl = REPORT_BASE_URLS[group.label] ?? group.baseUrl;
    if (!baseUrl) continue;
    const keys = [...new Set(group.keys)];
    const existing = entries.find(entry => entry.baseUrl === baseUrl);
    if (existing) {
      for (const key of keys) {
        if (!existing.keys.includes(key)) existing.keys.push(key);
      }
      continue;
    }
    entries.push({ name: null, baseUrl, keys, models: [] });
  }
}

function lineStartAt(text: string, index: number): number {
  const lastNewline = text.lastIndexOf('\n', index);
  return lastNewline === -1 ? 0 : lastNewline + 1;
}

function extractKeys(entryText: string): string[] {
  const labeled = [...entryText.matchAll(LABELED_KEY_PATTERN)].map(match => match[1]);
  const found = labeled.length > 0 ? labeled : entryText.match(STRICT_KEY_PATTERN) ?? [];
  return [...new Set(found)];
}

function extractModels(entryText: string): string[] {
  const sectionMatch = MODELS_SECTION_PATTERN.exec(entryText);
  if (!sectionMatch) return [];
  const section = entryText.slice(sectionMatch.index + sectionMatch[0].length);
  const seen = new Set<string>();
  const models: string[] = [];
  for (const raw of section.split(/[\s,;]+/)) {
    const token = raw.replace(/[.…]+$/, '');
    if (!MODEL_TOKEN_PATTERN.test(token)) continue;
    if (MODEL_LABEL_TOKENS.has(token.toLowerCase().replace(/[:：]$/, ''))) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    models.push(token);
  }
  return models;
}

export function parseProviderEntries(text: string): ParsedProviderEntry[] {
  const matches = [...text.matchAll(BASE_URL_PATTERN)];
  const entries: ParsedProviderEntry[] = [];
  for (let i = 0; i < matches.length; i += 1) {
    const baseUrl = matches[i][1];
    if (!/^https?:\/\//i.test(baseUrl)) continue;
    const start = lineStartAt(text, matches[i].index ?? 0);
    const nextIndex = matches[i + 1]?.index;
    const end = nextIndex === undefined ? text.length : lineStartAt(text, nextIndex);
    const entryText = text.slice(start, end);
    const nameMatch = entryText.match(NAME_PATTERN);
    entries.push({
      name: nameMatch ? nameMatch[1].trim() : null,
      baseUrl,
      keys: extractKeys(entryText),
      models: extractModels(entryText),
    });
  }
  appendReportEntries(entries, text);
  return entries;
}
