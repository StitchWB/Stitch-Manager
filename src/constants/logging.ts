/**
 * Logging configuration and presets
 */

export type LogVerbosity = 'minimal' | 'normal' | 'verbose' | 'debug';

export const LOG_VERBOSITY_OPTIONS = [
  { value: 'minimal', label: 'Минимальный - Только результаты' },
  { value: 'normal', label: 'Обычный - важные шаги' },
  { value: 'verbose', label: 'Подробный - Все детали' },
  { value: 'debug', label: 'Отладка - Всё' },
] as const;
