import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { getLocale } from './i18n';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getDateLocale(): string {
  const locale = getLocale();
  if (locale === 'ru') return 'ru-RU';
  if (locale === 'en') return 'en-US';
  return navigator.language;
}

function toValidDate(value: string | number | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fallbackText(value: string | number | Date): string {
  return typeof value === 'string' ? value : '—';
}

export function formatDate(
  value: string | number | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  if (value === null || value === undefined || value === '') return '—';
  const date = toValidDate(value);
  if (!date) return fallbackText(value);
  return date.toLocaleDateString(getDateLocale(), options);
}

export function formatTime(
  value: string | number | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  if (value === null || value === undefined || value === '') return '—';
  const date = toValidDate(value);
  if (!date) return fallbackText(value);
  return date.toLocaleTimeString(getDateLocale(), options);
}

export function formatDateTime(
  value?: string | number | Date | null,
  options?: Intl.DateTimeFormatOptions
): string {
  if (value === null || value === undefined || value === '') return '—';
  const date = toValidDate(value);
  if (!date) return fallbackText(value);
  return date.toLocaleString(getDateLocale(), options);
}

export function formatUnixTimestamp(timestamp: number | null): string {
  if (!timestamp) return 'Never';
  return formatDate(timestamp * 1000);
}
