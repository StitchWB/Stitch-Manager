// Registration defaults
export const DEFAULT_IMAP_PORT = 993;
export const RANDOM_NAMES = ['alex', 'john', 'emma', 'mike', 'sarah', 'david'];

// Shortcodes for email pattern
export const EMAIL_SHORTCODES = [
  { id: 'counter', label: '+ Counter', code: '{counter}' },
  { id: 'rnd', label: '+ Random', code: '{rnd}' },
  { id: 'time', label: '+ Time', code: '{time}' },
  { id: 'name', label: '+ Name', code: '{name}' },
] as const;
