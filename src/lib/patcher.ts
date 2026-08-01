/**
 * Patcher utility functions
 */

import { Code2, Wind, MousePointer2, Sparkles, Settings as SettingsIcon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Format ISO date string to localized date/time
 */
export function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '—';
  
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '—';
    
    return date.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

/**
 * Format bytes to human-readable size
 */
export function formatSize(bytes?: number | null): string {
  if (bytes == null || bytes === 0) return '0 B';
  
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = bytes / Math.pow(k, i);
  
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Get IDE icon based on type
 */
export function getIDEIcon(ideType: string): LucideIcon {
  switch (ideType) {
    case 'kiro':
      return Code2;
    case 'windsurf':
      return Wind;
    case 'cursor':
      return MousePointer2;
    case 'trae':
      return Sparkles;
    default:
      return SettingsIcon;
  }
}

/**
 * Get IDE gradient colors based on type
 */
export function getIDEGradient(ideType: string): string {
  switch (ideType) {
    case 'kiro':
      return 'from-indigo-500/20 to-purple-500/20';
    case 'windsurf':
      return 'from-blue-500/20 to-cyan-500/20';
    case 'cursor':
      return 'from-emerald-500/20 to-teal-500/20';
    case 'trae':
      return 'from-orange-500/20 to-red-500/20';
    default:
      return 'from-slate-500/20 to-gray-500/20';
  }
}

/**
 * Get IDE display label based on type
 */
export function getIDELabel(ideType: string): string {
  switch (ideType) {
    case 'kiro':
      return 'Kiro IDE';
    case 'windsurf':
      return 'Windsurf';
    case 'cursor':
      return 'Cursor';
    case 'trae':
      return 'Trae';
    default:
      return ideType;
  }
}

/**
 * Truncate string in the middle with ellipsis
 */
export function truncateMiddle(str: string, maxLength: number = 30): string {
  if (!str || str.length <= maxLength) return str;
  
  const start = Math.ceil((maxLength - 3) / 2);
  const end = Math.floor((maxLength - 3) / 2);
  
  return `${str.slice(0, start)}...${str.slice(-end)}`;
}
