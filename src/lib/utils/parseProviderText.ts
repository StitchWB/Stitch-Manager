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
  return entries;
}
