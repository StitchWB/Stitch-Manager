/**
 * Smart parser for provider paste posts.
 * Extracts base URL, API keys, provider name, and models from free-form text.
 */

export interface ParsedProviderData {
  name?: string;
  baseUrl?: string;
  keys: string[];
  models: string[];
}

const URL_PATTERN = /https?:\/\/[^\s<>"'{}|\\^`\[\]]+/gi;
const KEY_PATTERN = /\b([a-zA-Z0-9_-]{20,})\b/g;
const NAME_PATTERN = /^([^\n|]+?)(?:\s*\||\s*$)/m;
const MODELS_SECTION = /(?:лучшие модели|models?|топ модели|available models)[:\s]*\n?([\s\S]*?)(?:\n\n|\nby|@|$)/gi;
const MODEL_ITEM = /[-•*]\s*([a-zA-Z0-9._-]{3,})/g;

export function parseProviderText(text: string): ParsedProviderData {
  const result: ParsedProviderData = { keys: [], models: [] };

  // Extract provider name (first line, before |)
  const nameMatch = text.match(NAME_PATTERN);
  if (nameMatch) {
    result.name = nameMatch[1].trim();
  }

  // Extract base URL - prefer URL after "URL:" label
  const urlLabelMatch = text.match(/URL[:\s]*\s*(https?:\/\/[^\s<>"'{}|\\^`\[\]]+)/i);
  if (urlLabelMatch) {
    result.baseUrl = urlLabelMatch[1].trim();
  } else {
    // Fallback: first URL that looks like an API endpoint
    const urls = text.match(URL_PATTERN) || [];
    const apiUrls = urls.filter(u =>
      /api|v1|v2|compatible|openai|anthropic|dashscope|groq|fireworks|together/i.test(u)
    );
    result.baseUrl = (apiUrls[0] || urls[0] || '').trim();
  }

  // Extract models
  const modelsSectionMatch = text.match(MODELS_SECTION);
  if (modelsSectionMatch) {
    const section = modelsSectionMatch[0];
    const modelMatches = section.match(MODEL_ITEM) || [];
    result.models = modelMatches
      .map(m => m.replace(/^[-•*]\s*/, '').trim())
      .filter(m => m.length >= 3 && !/^https?:/i.test(m));
  }

  // Extract API keys - look for patterns like sk-xxx, key-xxx, or long alphanumeric tokens
  // Primary: sk- prefixed keys
  const skKeys = text.match(/\bsk-[a-zA-Z0-9_-]{16,}\b/g) || [];
  if (skKeys.length > 0) {
    result.keys = [...new Set(skKeys)];
  } else {
    // Fallback: any long alphanumeric token that looks like a key
    const allTokens = text.match(KEY_PATTERN) || [];
    result.keys = [...new Set(
      allTokens.filter(t =>
        t.length >= 20 &&
        !/^https?:/i.test(t) &&
        !/^(com|org|net|io|ru|dev|app|api|base|url|key|token|model|provider|format|working|best|top|all|the|and|for|not|but|with|from|that|this|have|been|will|would|could|should)/i.test(t) &&
        !/^[A-Z][a-z]+$/.test(t) // exclude plain words
      )
    )];
  }

  return result;
}
