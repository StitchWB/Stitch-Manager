import { getLocale } from '@/lib/i18n';
import { lookupPluginBundle } from '@/lib/i18nPluginBundles';

const PLUGIN_ID = 'stitch-devbox';

export function devboxLabel(text: string): string {
  if (!text.startsWith(`${PLUGIN_ID}.`)) return text;
  return lookupPluginBundle(`plugin.${PLUGIN_ID}.${text}`, getLocale()) ?? text;
}
