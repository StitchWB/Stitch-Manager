/**
 * Status Color Constants
 * 
 * Centralized color definitions for consistent status indicators across the app.
 * Use these constants instead of hardcoding Tailwind classes.
 */

export const STATUS_COLORS = {
  // Success / Active states
  success: {
    bg: 'bg-emerald-500',
    text: 'text-emerald-400',
    border: 'border-emerald-500',
    bgOpacity: 'bg-emerald-500/10',
    borderOpacity: 'border-emerald-500/20',
    hex: '#10b981', // emerald-500
  },
  
  // Error / Danger states
  error: {
    bg: 'bg-red-500',
    text: 'text-red-400',
    border: 'border-red-500',
    bgOpacity: 'bg-red-500/10',
    borderOpacity: 'border-red-500/20',
    hex: '#ef4444', // red-500
  },
  
  // Warning states
  warning: {
    bg: 'bg-amber-500',
    text: 'text-amber-400',
    border: 'border-amber-500',
    bgOpacity: 'bg-amber-500/10',
    borderOpacity: 'border-amber-500/20',
    hex: '#f59e0b', // amber-500
  },
  
  // Info / Neutral states
  info: {
    bg: 'bg-blue-500',
    text: 'text-blue-400',
    border: 'border-blue-500',
    bgOpacity: 'bg-blue-500/10',
    borderOpacity: 'border-blue-500/20',
    hex: '#3b82f6', // blue-500
  },
  
  // Inactive / Disabled states
  inactive: {
    bg: 'bg-slate-500',
    text: 'text-slate-400',
    border: 'border-slate-500',
    bgOpacity: 'bg-slate-500/10',
    borderOpacity: 'border-slate-500/20',
    hex: '#64748b', // slate-500
  },
} as const;

/**
 * Get status color by status type
 */
export function getStatusColor(status: 'success' | 'error' | 'warning' | 'info' | 'inactive') {
  return STATUS_COLORS[status];
}

/**
 * Account status colors
 */
export const ACCOUNT_STATUS_COLORS = {
  active: STATUS_COLORS.success,
  banned: STATUS_COLORS.error,
  expired: STATUS_COLORS.warning,
  limit_hit: STATUS_COLORS.warning,
  inactive: STATUS_COLORS.inactive,
} as const;

export type StatusType = keyof typeof STATUS_COLORS;
export type AccountStatusType = keyof typeof ACCOUNT_STATUS_COLORS;
