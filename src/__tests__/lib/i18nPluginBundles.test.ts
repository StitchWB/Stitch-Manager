import {
  registerPluginBundles,
  unregisterPluginBundles,
  lookupPluginBundle,
} from '@/lib/i18nPluginBundles';
import { t, setLocale, getLocale } from '@/lib/i18n';

describe('plugin i18n bundles in t() fallback chain', () => {
  const savedLocale = getLocale();

  afterEach(() => {
    unregisterPluginBundles('echo');
    unregisterPluginBundles('partial');
    unregisterPluginBundles('dup');
    unregisterPluginBundles('nested');
    unregisterPluginBundles('interp');
    unregisterPluginBundles('malformed');
    setLocale(savedLocale);
  });

  // --- Happy path ---

  it('returns the ru string when locale is ru', () => {
    setLocale('ru');
    registerPluginBundles('echo', {
      ru: { hello: 'Привет' },
      en: { hello: 'Hello' },
    });
    expect(t('plugin.echo.hello')).toBe('Привет');
  });

  it('switches to the en string when locale changes to en', () => {
    setLocale('ru');
    registerPluginBundles('echo', {
      ru: { hello: 'Привет' },
      en: { hello: 'Hello' },
    });
    expect(t('plugin.echo.hello')).toBe('Привет');
    setLocale('en');
    expect(t('plugin.echo.hello')).toBe('Hello');
  });

  // --- Unregister / unknown ---

  it('returns the raw key after unregistering the plugin bundle', () => {
    setLocale('ru');
    registerPluginBundles('echo', {
      ru: { hello: 'Привет' },
      en: { hello: 'Hello' },
    });
    expect(t('plugin.echo.hello')).toBe('Привет');
    unregisterPluginBundles('echo');
    expect(t('plugin.echo.hello')).toBe('plugin.echo.hello');
  });

  it('returns the raw key for an unknown key within a registered plugin', () => {
    setLocale('ru');
    registerPluginBundles('echo', {
      ru: { hello: 'Привет' },
      en: { hello: 'Hello' },
    });
    expect(t('plugin.echo.unknown')).toBe('plugin.echo.unknown');
  });

  it('returns the raw key for a plugin that was never registered', () => {
    setLocale('ru');
    expect(t('plugin.ghost.hello')).toBe('plugin.ghost.hello');
  });

  // --- Core keys unaffected ---

  it('does not affect core translation keys', () => {
    setLocale('en');
    registerPluginBundles('echo', {
      ru: { hello: 'Привет' },
      en: { hello: 'Hello' },
    });
    expect(t('common.save')).toBe('Save');
  });

  it('does not consult plugin bundles for non-plugin keys', () => {
    setLocale('en');
    registerPluginBundles('echo', {
      ru: { hello: 'Привет' },
      en: { hello: 'Hello' },
    });
    // A non-existent core key must still return the key, not a plugin value.
    expect(t('nonexistent.deep.key')).toBe('nonexistent.deep.key');
  });

  // --- Adversarial ---

  it('falls back to ru when en bundle is missing and locale is en', () => {
    setLocale('en');
    registerPluginBundles('partial', { ru: { only: 'Только' } });
    expect(t('plugin.partial.only')).toBe('Только');
  });

  it('returns the key when no bundle has the key (missing en)', () => {
    setLocale('en');
    registerPluginBundles('partial', { ru: { only: 'Только' } });
    expect(t('plugin.partial.missing')).toBe('plugin.partial.missing');
  });

  it('falls back to en when ru bundle is missing and locale is ru', () => {
    setLocale('ru');
    registerPluginBundles('partial', { en: { only: 'Only' } });
    expect(t('plugin.partial.only')).toBe('Only');
  });

  it('never throws on a malformed bundle shape', () => {
    setLocale('ru');
    registerPluginBundles('malformed', {
      ru: 'not-an-object' as unknown as Record<string, unknown>,
      en: null as unknown as Record<string, unknown>,
    });
    expect(() => t('plugin.malformed.hello')).not.toThrow();
    expect(t('plugin.malformed.hello')).toBe('plugin.malformed.hello');
  });

  it('last registration wins when the same plugin is registered twice', () => {
    setLocale('ru');
    registerPluginBundles('dup', {
      ru: { hello: 'Первый' },
      en: { hello: 'First' },
    });
    registerPluginBundles('dup', {
      ru: { hello: 'Второй' },
      en: { hello: 'Second' },
    });
    expect(t('plugin.dup.hello')).toBe('Второй');
    setLocale('en');
    expect(t('plugin.dup.hello')).toBe('Second');
  });

  // --- Nested keys + interpolation ---

  it('resolves nested keys inside a plugin bundle', () => {
    setLocale('ru');
    registerPluginBundles('nested', {
      ru: { section: { title: 'Раздел' } },
      en: { section: { title: 'Section' } },
    });
    expect(t('plugin.nested.section.title')).toBe('Раздел');
    setLocale('en');
    expect(t('plugin.nested.section.title')).toBe('Section');
  });

  it('supports parameter interpolation in plugin bundle values', () => {
    setLocale('ru');
    registerPluginBundles('interp', {
      ru: { greeting: 'Привет, {name}!' },
      en: { greeting: 'Hello, {name}!' },
    });
    expect(t('plugin.interp.greeting', { name: 'Мир' })).toBe('Привет, Мир!');
    setLocale('en');
    expect(t('plugin.interp.greeting', { name: 'World' })).toBe('Hello, World!');
  });

  // --- Direct registry API ---

  it('lookupPluginBundle returns undefined for non-plugin keys', () => {
    expect(lookupPluginBundle('common.save', 'en')).toBeUndefined();
  });

  it('lookupPluginBundle returns undefined for plugin. with no id', () => {
    expect(lookupPluginBundle('plugin', 'en')).toBeUndefined();
    expect(lookupPluginBundle('plugin.', 'en')).toBeUndefined();
  });
});
