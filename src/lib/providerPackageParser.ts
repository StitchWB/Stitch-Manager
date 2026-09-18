export type PackageAdapterType = 'openai_compatible' | 'anthropic';

export interface ParsedPackageBase {
  url: string;
  adapterType: PackageAdapterType;
}

export interface ParsedProviderPackage {
  apiKey: string | null;
  bases: ParsedPackageBase[];
  models: string[];
  suggestedName: string | null;
}

const URL_RE = /https?:\/\/[^\s<>"']+/gi;
const SK_KEY_RE = /\bsk-[A-Za-z0-9_-]{8,}/i;
const LABELED_KEY_RE = /(?:api[-\s]?key|ключ|key|token|secret|секрет)\s*[:=]\s*([A-Za-z0-9_-]{16,})/i;
const LONG_TOKEN_RE = /[A-Za-z0-9_-]{24,}/g;
const MODELS_LABEL_RE = /^[ \t]*(?:модели|models?)[ \t]*[:\-–—]?[ \t]*(.*)$/gim;
const MODEL_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const TRAILING_PUNCT_RE = /^[.,;:!?)\]}]+|[.,;:!?)\]}]+$/g;

function cleanToken(token: string): string {
  return token.replace(TRAILING_PUNCT_RE, '');
}

function hasModelShape(token: string, strict: boolean): boolean {
  if (token.length < (strict ? 3 : 2) || !MODEL_TOKEN_RE.test(token)) return false;
  if (/^\d+$/.test(token)) return false;
  const hasDigit = /\d/.test(token);
  const hasSeparator = token.includes('-') || token.includes('.');
  return strict ? hasDigit && hasSeparator : hasDigit || hasSeparator;
}

function extractApiKey(text: string): string | null {
  const skMatch = text.match(SK_KEY_RE);
  if (skMatch) return cleanToken(skMatch[0]);

  const labeled = text.match(LABELED_KEY_RE);
  if (labeled) return cleanToken(labeled[1]);

  const withoutUrls = text.replace(URL_RE, ' ');
  const candidates = withoutUrls.match(LONG_TOKEN_RE) || [];
  for (const candidate of candidates) {
    const token = cleanToken(candidate);
    if (token.length >= 24 && /\d/.test(token) && /[A-Za-z]/.test(token)) {
      return token;
    }
  }
  return null;
}

function extractBases(text: string): ParsedPackageBase[] {
  const bases: ParsedPackageBase[] = [];
  const seen = new Set<string>();

  for (const line of text.split(/\r?\n/)) {
    const matches = line.match(URL_RE) || [];
    for (const match of matches) {
      const url = cleanToken(match);
      if (!url || seen.has(url)) continue;

      let hasV1 = false;
      try {
        hasV1 = /(^|\/)v\d+(\/|$)/.test(new URL(url).pathname);
      } catch {
        hasV1 = /\/v\d+(\/|$)/.test(url);
      }

      const hint = line.toLowerCase();
      const adapterType: PackageAdapterType = hasV1
        ? 'openai_compatible'
        : /claude|anthropic/.test(hint)
          ? 'anthropic'
          : 'openai_compatible';

      seen.add(url);
      bases.push({ url, adapterType });
    }
  }
  return bases;
}

function splitModelTokens(content: string, strict: boolean): string[] {
  const tokens = content.split(/[,;\s]+/).map(cleanToken).filter(Boolean);
  const models: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (!hasModelShape(token, strict) || seen.has(token)) continue;
    seen.add(token);
    models.push(token);
  }
  return models;
}

function extractModels(text: string, apiKey: string | null): string[] {
  const lines = text.split(/\r?\n/);
  MODELS_LABEL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MODELS_LABEL_RE.exec(text)) !== null) {
    const models = splitModelTokens(match[1], false);
    if (models.length > 0) return withoutKey(models, apiKey);

    const labelLineIndex = text.slice(0, match.index).split(/\r?\n/).length - 1;
    const collected: string[] = [];
    for (let i = labelLineIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) break;
      collected.push(...splitModelTokens(line, false));
    }
    if (collected.length > 0) return withoutKey(collected, apiKey);
  }

  const withoutUrls = text.replace(URL_RE, ' ');
  return withoutKey(splitModelTokens(withoutUrls, true), apiKey);
}

function withoutKey(models: string[], apiKey: string | null): string[] {
  if (!apiKey) return models;
  return models.filter(m => m !== apiKey);
}

function extractSuggestedName(bases: ParsedPackageBase[]): string | null {
  if (bases.length === 0) return null;
  try {
    const host = new URL(bases[0].url).hostname;
    return host.replace(/^(api|www)\./, '') || null;
  } catch {
    return null;
  }
}

export function parseProviderPackage(text: string): ParsedProviderPackage {
  const safe = typeof text === 'string' ? text : '';
  const apiKey = extractApiKey(safe);
  const bases = extractBases(safe);
  const models = extractModels(safe, apiKey);
  return {
    apiKey,
    bases,
    models,
    suggestedName: extractSuggestedName(bases),
  };
}

export function isPackageEmpty(parsed: ParsedProviderPackage): boolean {
  return !parsed.apiKey && parsed.bases.length === 0 && parsed.models.length === 0;
}
