import type { I18nText } from './backend/modules/marketplace';

/**
 * Resolve a plugin-provided localizable value to a display string:
 * object → value[lang] ?? value.ru ?? value.en; string → as-is;
 * null/undefined → ''. Unknown languages (e.g. 'zh') fall back to ru/en.
 */
export function resolveI18n(
  value: string | I18nText | null | undefined,
  lang: string,
): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  const byLang: Partial<Record<string, string>> = value;
  return byLang[lang] ?? value.ru ?? value.en;
}
