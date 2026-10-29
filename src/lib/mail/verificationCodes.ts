/**
 * Detects verification codes / OTPs / magic links in email content.
 *
 * Detection strategy: subject first (single source of truth for "your code is X"
 * patterns), then plain text, then sanitized HTML. Each candidate is scored:
 * stronger contextual matches (e.g. "verification code: 123456") win over a
 * naked number sequence.
 */

export type VerificationCodeKind = 'code' | 'link';

export interface VerificationCodeMatch {
  kind: VerificationCodeKind;
  /** The detected code or URL */
  value: string;
  /** Where it was found, useful for highlighting in the viewer. */
  source: 'subject' | 'text' | 'html';
  /** Surrounding text snippet for context ("Your code is **123456**, ..."). */
  snippet: string;
  /** Confidence score (higher = stronger context match). */
  score: number;
}

export interface VerificationExtractionInput {
  subject?: string | null;
  text?: string | null;
  html?: string | null;
}

const CODE_KEYWORDS = [
  'verification code',
  'verification',
  'security code',
  'access code',
  'one-time',
  'one time',
  'one-time password',
  'otp',
  'pin',
  'passcode',
  'confirm code',
  'confirmation code',
  'auth code',
  'authentication code',
  'login code',
  'signin code',
  'sign-in code',
  'код подтверждения',
  'проверочный код',
  'код подтверждения',
  'pin-код',
  'пин-код',
  'код безопасности',
];

const LINK_KEYWORDS = [
  'verify',
  'confirm',
  'activate',
  'reset',
  'sign in',
  'sign-in',
  'signin',
  'login',
  'magic link',
  'click here',
  'подтвердить',
  'активировать',
  'войти',
];

const LINK_HOST_HINTS = ['verify', 'confirm', 'activate', 'login', 'auth', 'signin'];

const DIGIT_CODE = /\b(\d{4,10})\b/g;
const ALNUM_CODE = /\b([A-Z0-9]{6,10})\b/g;
// URLs: simple but practical; anchors at http(s):// up to whitespace/quote.
const URL_REGEX = /https?:\/\/[^\s"'<>()]+/gi;

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSnippet(haystack: string, matchStart: number, matchLen: number, span = 60): string {
  const start = Math.max(0, matchStart - span);
  const end = Math.min(haystack.length, matchStart + matchLen + span);
  let snippet = haystack.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) snippet = `…${snippet}`;
  if (end < haystack.length) snippet = `${snippet}…`;
  return snippet;
}

function looksLikePhoneNumber(value: string): boolean {
  // Reject phone-like sequences to avoid false positives. Phone numbers usually
  // appear inside "tel:", parentheses, dashes, or with country code.
  return /^[+]/.test(value) || /^[\d]{10,}$/.test(value);
}

function looksLikeYear(value: string): boolean {
  const num = Number(value);
  return value.length === 4 && num >= 1970 && num <= 2100;
}

function looksLikeBoringNumber(value: string): boolean {
  // All same digit: 0000, 11111, etc.
  if (/^(\d)\1+$/.test(value)) return true;
  return false;
}

function scoreCodeContext(haystack: string, position: number, matchLen: number): number {
  const before = haystack.slice(Math.max(0, position - 80), position).toLowerCase();
  const after = haystack
    .slice(position + matchLen, Math.min(haystack.length, position + matchLen + 30))
    .toLowerCase();
  const window = `${before} ${after}`;

  let score = 0;

  for (const kw of CODE_KEYWORDS) {
    if (window.includes(kw)) {
      score += 20;
      break;
    }
  }

  // Punctuation right before the digits (": ", "is ", " — ", "**") is a
  // strong signal it is being introduced.
  if (/(?:[:=]|\bis\b|\bequal[s]?\b|—|->)\s*$/.test(before)) {
    score += 12;
  }

  // 6-digit codes are the most common shape.
  if (matchLen === 6) score += 6;
  if (matchLen === 8) score += 3;
  if (matchLen === 4) score += 1;

  return score;
}

function scoreLinkContext(haystack: string, url: string, position: number): number {
  const before = haystack.slice(Math.max(0, position - 80), position).toLowerCase();
  let score = 0;

  for (const kw of LINK_KEYWORDS) {
    if (before.includes(kw)) {
      score += 15;
      break;
    }
  }

  try {
    const parsed = new URL(url);
    const host = parsed.host.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const search = parsed.search.toLowerCase();
    if (LINK_HOST_HINTS.some(hint => host.includes(hint) || path.includes(hint))) {
      score += 10;
    }
    if (
      search.includes('token') ||
      search.includes('code') ||
      search.includes('verify') ||
      search.includes('confirm')
    ) {
      score += 10;
    }
  } catch {
    // ignore - non-URL match was caught by regex
  }

  return score;
}

function extractCodes(haystack: string, source: VerificationCodeMatch['source']): VerificationCodeMatch[] {
  const out: VerificationCodeMatch[] = [];
  const seen = new Set<string>();

  for (const regex of [DIGIT_CODE, ALNUM_CODE]) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(haystack))) {
      const value = match[1];
      if (seen.has(value)) continue;

      if (looksLikeBoringNumber(value)) continue;
      if (looksLikeYear(value)) continue;
      if (looksLikePhoneNumber(value)) continue;

      // Reject pure-digit matches when they look like timestamps (10-13 digits)
      if (/^\d+$/.test(value) && value.length >= 10) continue;

      const score = scoreCodeContext(haystack, match.index, value.length);
      // Without explicit context cue, naked numbers are not assumed to be codes.
      if (score < 6 && /^\d+$/.test(value)) continue;
      if (score < 5 && /[A-Z]/.test(value)) continue;

      seen.add(value);
      out.push({
        kind: 'code',
        value,
        source,
        snippet: buildSnippet(haystack, match.index, value.length),
        score,
      });
    }
  }

  return out;
}

function extractLinks(haystack: string, source: VerificationCodeMatch['source']): VerificationCodeMatch[] {
  const out: VerificationCodeMatch[] = [];
  const seen = new Set<string>();

  URL_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_REGEX.exec(haystack))) {
    const url = match[0].replace(/[)\].,;]+$/, '');
    if (seen.has(url)) continue;

    const score = scoreLinkContext(haystack, url, match.index);
    if (score < 10) continue;

    seen.add(url);
    out.push({
      kind: 'link',
      value: url,
      source,
      snippet: buildSnippet(haystack, match.index, url.length, 100),
      score,
    });
  }

  return out;
}

/**
 * Extract verification codes / magic links from an email message.
 * Returns matches sorted by score (best first). Empty array if nothing matches.
 */
export function extractVerificationMatches(
  input: VerificationExtractionInput
): VerificationCodeMatch[] {
  const matches: VerificationCodeMatch[] = [];

  const subject = (input.subject ?? '').trim();
  if (subject) {
    matches.push(...extractCodes(subject, 'subject'));
  }

  const text = (input.text ?? '').trim();
  if (text) {
    matches.push(...extractCodes(text, 'text'));
    matches.push(...extractLinks(text, 'text'));
  }

  const html = input.html ?? '';
  if (html) {
    const stripped = stripHtml(html);
    if (stripped) {
      matches.push(...extractCodes(stripped, 'html'));
    }
    // Anchors carry both visible text and href; pull href separately so we get
    // the actual URL even if the visible text is "click here".
    const linkRegex = /<a\b[^>]*?\bhref\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let linkMatch: RegExpExecArray | null;
    while ((linkMatch = linkRegex.exec(html))) {
      const href = linkMatch[1].trim();
      const visible = stripHtml(linkMatch[2]).trim();
      if (!/^https?:/i.test(href)) continue;

      let score = scoreLinkContext(stripped, href, 0);
      if (LINK_KEYWORDS.some(kw => visible.toLowerCase().includes(kw))) {
        score += 18;
      }
      if (score < 10) continue;

      matches.push({
        kind: 'link',
        value: href,
        source: 'html',
        snippet: visible || href,
        score,
      });
    }
  }

  // Deduplicate (value+kind) keeping the highest-scored entry.
  const bestByKey = new Map<string, VerificationCodeMatch>();
  for (const item of matches) {
    const key = `${item.kind}:${item.value}`;
    const existing = bestByKey.get(key);
    if (!existing || existing.score < item.score) {
      bestByKey.set(key, item);
    }
  }

  return Array.from(bestByKey.values()).sort((a, b) => b.score - a.score);
}
