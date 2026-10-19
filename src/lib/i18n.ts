/**
 * Internationalization (i18n) module for the Stitch Manager application.
 * Provides type-safe localization with English translations.
 */

import type { Translations } from './i18n/types';
import { ru } from './locales/ru';
import { en } from './locales/en';
import { lookupPluginBundle } from './i18nPluginBundles';

export type { Translations } from './i18n/types';

// ============================================
// Translations Registry
// ============================================

export const translations: Record<string, Translations> = {
  en,
  ru,
};

// ============================================
// State Management
// ============================================

let currentLocale = 'en';

/**
 * Get the current locale
 */
export function getLocale(): string {
  return currentLocale;
}

/**
 * Set the current locale
 * @param locale - The locale code (e.g., 'en', 'ru', 'zh')
 */
export function setLocale(locale: string): void {
  if (translations[locale]) {
    currentLocale = locale;
  } else {
    console.warn(`Locale "${locale}" not found, falling back to "en"`);
    currentLocale = 'en';
  }
}

// ============================================
// Translation Helper Function
// ============================================

/**
 * Get a translation by dot-notation key path
 * @param key - Dot-notation path to the translation (e.g., 'accounts.title')
 * @param params - Optional parameters for interpolation (e.g., { count: 5 })
 * @returns The translated string or the key if not found
 *
 * @example
 * t('common.save') // Returns 'Save'
 * t('accounts.deleteConfirm', { count: 5 }) // Returns 'Delete 5 accounts?'
 * t('time.minutesAgo', { count: 10 }) // Returns '10m ago'
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const keys = key.split('.');
  let value: unknown = translations[currentLocale];

  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      // Plugin i18n bundle fallback: keys shaped plugin.{id}.{key} resolve
      // from bundles registered at runtime (see i18nPluginBundles.ts).
      // Consulted only AFTER core locale lookup fails and BEFORE returning
      // the raw key, so existing core keys are unaffected.
      if (key.startsWith('plugin.')) {
        const pluginValue = lookupPluginBundle(key, currentLocale);
        if (typeof pluginValue === 'string') {
          value = pluginValue;
          break;
        }
      }
      console.warn(`Translation key "${key}" not found for locale "${currentLocale}"`);
      return key;
    }
  }

  if (typeof value !== 'string') {
    console.warn(`Translation key "${key}" does not resolve to a string`);
    return key;
  }

  // Handle parameter interpolation
  if (params) {
    return value.replace(/\{(\w+)\}/g, (_, paramKey) => {
      return params[paramKey]?.toString() ?? `{${paramKey}}`;
    });
  }

  return value;
}

// ============================================
// Type-safe Translation Keys Helper
// ============================================

type PathsToStringProps<T> = T extends string
  ? []
  : {
    [K in Extract<keyof T, string>]: [K, ...PathsToStringProps<T[K]>];
  }[Extract<keyof T, string>];

type Join<T extends string[], D extends string> = T extends []
  ? never
  : T extends [infer F]
  ? F
  : T extends [infer F, ...infer R]
  ? F extends string
  ? `${F}${D}${Join<Extract<R, string[]>, D>}`
  : never
  : string;

export type TranslationKey = Join<PathsToStringProps<Translations>, '.'>;

/**
 * Type-safe translation function
 * Use this when you want TypeScript to validate your translation keys
 */
export function tt(key: TranslationKey, params?: Record<string, string | number>): string {
  return t(key, params);
}

// ============================================
// Exports
// ============================================

export default { translations, t, tt, getLocale, setLocale };
