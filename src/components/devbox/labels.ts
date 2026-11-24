import { getLocale, t } from '@/lib/i18n';
import { lookupPluginBundle } from '@/lib/i18nPluginBundles';

const PLUGIN_ID = 'stitch-devbox';

export function devboxLabel(text: string): string {
  if (!text.startsWith(`${PLUGIN_ID}.`)) return text;
  return lookupPluginBundle(`plugin.${PLUGIN_ID}.${text}`, getLocale()) ?? text;
}

export function devboxModeLabel(mode: string): string {
  if (mode === 'readonly') return t('devboxPage.modeReadonlyTitle');
  if (mode === 'standard') return t('devboxPage.modeStandardTitle');
  if (mode === 'full') return t('devboxPage.modeFullTitle');
  return mode;
}

export function devboxIngressModeLabel(mode: string): string {
  if (mode === 'cloudflare') return t('devboxPage.connectModeCloudflareTitle');
  if (mode === 'relay') return t('devboxPage.connectModeRelayTitle');
  if (mode === 'manual') return t('devboxPage.connectModeManualTitle');
  return t('devboxPage.connectModeAutoTitle');
}
