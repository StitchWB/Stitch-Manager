import type { ProviderName } from '../types';

// Registration defaults
export const DEFAULT_EMAIL_PATTERN = 'kiro_{time}_{rnd}';
export const DEFAULT_IMAP_PORT = 993;
export const RANDOM_NAMES = ['alex', 'john', 'emma', 'mike', 'sarah', 'david'];

// Providers for registration UI
export const PROVIDERS: { id: ProviderName; name: string; disabled: boolean }[] = [
  { id: 'kiro', name: 'Kiro', disabled: false },
  { id: 'windsurf', name: 'Windsurf', disabled: false },
  { id: 'trae', name: 'Trae', disabled: true },
];

// Shortcodes for email pattern
export const EMAIL_SHORTCODES = [
  { id: 'rnd', label: '+ Random', code: '{rnd}' },
  { id: 'time', label: '+ Time', code: '{time}' },
  { id: 'name', label: '+ Name', code: '{name}' },
] as const;
