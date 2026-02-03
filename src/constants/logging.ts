/**
 * Logging configuration and presets
 */

export type LogVerbosity = 'minimal' | 'normal' | 'verbose' | 'debug';

export interface LogPreset {
  description: string;
  showStages: string[] | 'all';
  showProgress: boolean;
  showDebug: boolean;
}

export const LOG_PRESETS: Record<LogVerbosity, LogPreset> = {
  minimal: {
    description: 'Only show final results and errors',
    showStages: ['Email', 'Password', 'Result'],
    showProgress: false,
    showDebug: false,
  },
  normal: {
    description: 'Show important steps',
    showStages: ['Email', 'IMAP', 'Password', 'OAuth', 'Result'],
    showProgress: false,
    showDebug: false,
  },
  verbose: {
    description: 'Show all details including progress',
    showStages: 'all',
    showProgress: true,
    showDebug: false,
  },
  debug: {
    description: 'Show everything for troubleshooting',
    showStages: 'all',
    showProgress: true,
    showDebug: true,
  },
};

export const LOG_VERBOSITY_OPTIONS = [
  { value: 'minimal', label: 'Minimal - Only results' },
  { value: 'normal', label: 'Normal - Important steps' },
  { value: 'verbose', label: 'Verbose - All details' },
  { value: 'debug', label: 'Debug - Everything' },
] as const;
