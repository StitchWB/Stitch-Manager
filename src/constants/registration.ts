import { PROVIDERS, getEnabledProviders } from './providers';

// Registration defaults
export const DEFAULT_EMAIL_PATTERN = 'kiro_{time}_{rnd}';
export const DEFAULT_IMAP_PORT = 993;
export const RANDOM_NAMES = ['alex', 'john', 'emma', 'mike', 'sarah', 'david'];

// Re-export PROVIDERS for backward compatibility
export { PROVIDERS };

// Providers for registration UI (only enabled ones)
export const REGISTRATION_PROVIDERS = getEnabledProviders();

// Shortcodes for email pattern
export const EMAIL_SHORTCODES = [
  { id: 'counter', label: '+ Counter', code: '{counter}' },
  { id: 'rnd', label: '+ Random', code: '{rnd}' },
  { id: 'time', label: '+ Time', code: '{time}' },
  { id: 'name', label: '+ Name', code: '{name}' },
] as const;
