import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDateTime(dateStr?: string | null): string {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleString('ru-RU');
}

export function formatUnixTimestamp(timestamp: number | null): string {
  if (!timestamp) return 'Never';
  return new Date(timestamp * 1000).toLocaleDateString();
}
