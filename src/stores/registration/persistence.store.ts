/**
 * Persistence store - manages settings loading/saving
 * Handles database synchronization and save status
 */

import { create } from 'zustand';
import { getSettings, updateSettings } from '../../lib/tauri';
import type { SettingsData } from '../../types/generated';
import type { ProviderName } from '../../types/ui';

type ExtendedSettingsData = SettingsData & {
  captchaSoundFile?: string;
};
import type { LogVerbosity } from '../../constants/logging';
import type {
  RegistrationConfig,
  IMAPConfig,
  ProviderEmailStrategies,
  EmailPattern,
  NamePattern,
  SaveStatus,
  MailStrategy,
} from './types';
import {
  loadProviderStrategies,
  saveProviderStrategies,
  loadEmailGenerationDomain,
  saveEmailGenerationDomain,
} from './utils/migration';
import { validateIMAPConfig } from './utils/validation';

interface PersistenceState {
  settingsLoaded: boolean;
  saveStatus: SaveStatus;
  imapPasswordSet: boolean;
  gmailAppPasswordSet: boolean;

  // Actions
  loadSettings: () => Promise<RegistrationConfig | null>;
  saveSettings: (config: RegistrationConfig, logVerbosity: LogVerbosity) => Promise<void>;
  setSaveStatus: (status: SaveStatus) => void;
  setSettingsLoaded: (loaded: boolean) => void;
}

export const usePersistenceStore = create<PersistenceState>(set => ({
  settingsLoaded: false,
  saveStatus: 'idle',
  imapPasswordSet: false,
  gmailAppPasswordSet: false,

  loadSettings: async () => {
    console.log('[PERSISTENCE_STORE] loadSettings: starting');
    try {
      const settings: ExtendedSettingsData = await getSettings();
      console.log('[PERSISTENCE_STORE] loadSettings: got settings from DB:', settings);

      // Load provider-specific email strategies from localStorage with migration
      const providerEmailStrategies = loadProviderStrategies();

      // captchaSoundFile is stored in localStorage because the Rust DB schema
      // doesn't know this field. It would get dropped on every SETTINGS_UPDATED
      // event otherwise.
      let captchaSoundFile: string | null = null;
      try {
        captchaSoundFile = localStorage.getItem('stitch:captchaSoundFile');
      } catch {
        // ignore localStorage errors
      }

      // Check if passwords are masked (meaning they exist in DB)
      const imapPasswordMasked = settings.imapPassword === '********';
      const gmailAppPasswordMasked = settings.gmailAppPassword === '********';
      const proxyPasswordMasked = settings.proxyPassword === '********';

      // Build global IMAP config (shared across all providers)
      const globalImap: IMAPConfig = {
        strategy: (settings.mailStrategy as MailStrategy) || 'custom',
        server: settings.imapServer || '',
        port: settings.imapPort || 993,
        email: settings.imapEmail || '',
        password: imapPasswordMasked ? '' : settings.imapPassword || '',
        useTLS: true,
        emailCustomPrefix: settings.emailCustomPrefix || '',
        gmailBase: settings.gmailBase || '',
        gmailAlias: settings.gmailAlias || '',
        gmailAppPassword: gmailAppPasswordMasked ? '' : settings.gmailAppPassword || '',
        // Load addy.io settings (global)
        addyioEnabled: settings.addyioEnabled || false,
        addyioApiToken: settings.addyioApiToken || '',
        addyioDomain: settings.addyioDomain || '',
        addyioAliasFormat: settings.addyioAliasFormat || 'uuid',
        addyioAutoDelete: settings.addyioAutoDelete || false,
        addyioDefaultRecipientId: settings.addyioDefaultRecipientId || '',
        addyioDescriptionTemplate: settings.addyioDescriptionTemplate || '',
        addyioFromName: settings.addyioFromName || '',
        // Load 33mail settings (global)
        thirtyThreeMailEnabled: settings.thirtyThreeMailEnabled || false,
        thirtyThreeMailUsername: settings.thirtyThreeMailUsername || '',
        thirtyThreeMailDomain: settings.thirtyThreeMailDomain || '33mail.com',
        thirtyThreeMailTemplate: settings.thirtyThreeMailTemplate || '{rnd12}',
        // Load Mail.tm settings (global)
        mailtmEnabled: settings.mailtmEnabled || false,
        emailGenerationDomain: loadEmailGenerationDomain(),
      };

      const currentProvider = (settings.provider as ProviderName) || 'kiro';

      // Initialize provider strategies with defaults, then override with stored values
      const finalProviderStrategies: ProviderEmailStrategies = {
        ...providerEmailStrategies,
      };

      // Set current provider's strategy from DB
      finalProviderStrategies[currentProvider] = {
        strategy: globalImap.strategy,
        customDomain:
          globalImap.strategy === 'cf-to-imap'
            ? globalImap.emailGenerationDomain || ''
            : globalImap.server
              ? `${globalImap.email.split('@')[1] || ''}`
              : '',
        thirtyThreeMailDomain: globalImap.thirtyThreeMailDomain,
        addyioDomain: globalImap.addyioDomain,
      };

      const config: RegistrationConfig = {
        provider: currentProvider,
        credentials: {
          email: '',
          password: '',
        },
        imap: globalImap,
        providerEmailStrategies: finalProviderStrategies,
        proxy: {
          enabled: settings.proxyEnabled || false,
          url: settings.proxyUrl || '',
          username: settings.proxyUsername || '',
          password: proxyPasswordMasked ? '' : settings.proxyPassword || '',
          type: (settings.proxyType as 'http' | 'socks5') || 'http',
          list: settings.proxyList || '',
          rotationEnabled: settings.proxyRotationEnabled || false,
        },
        patterns: {
          emailPattern: settings.emailCustomPrefix
            ? 'custom_prefix'
            : (settings.emailPattern as EmailPattern) || 'provider_timestamp',
          emailCustomPrefix: settings.emailCustomPrefix || '',
          namePattern: (settings.namePattern as NamePattern) || 'random',
          nameCustomFirst: settings.nameCustomFirst || '',
          nameCustomLast: settings.nameCustomLast || '',
        },
        advanced: {
          headless: settings.headless === true,
          speedMultiplier: settings.speedMultiplier || 1.0,
          delayBetweenAccounts: settings.delayBetweenAccounts || 2,
          verificationCodeTimeout: settings.verificationCodeTimeout || 120,
          oauthCallbackTimeout: settings.oauthCallbackTimeout || 90,
          allowAccessWait: settings.allowAccessWait || 120,
          pageLoadTimeout: settings.pageLoadTimeout || 5,
          elementWaitTimeout: settings.elementWaitTimeout || 2,
          imapPollInterval: settings.imapPollInterval || 1,
          passwordLength: settings.passwordLength || 16,
          realisticTyping: settings.realisticTyping !== false,
          humanDelays: settings.humanDelays !== false,
          screenshotsOnError: settings.screenshotsOnError !== false,
          captchaTimeout: settings.captchaTimeout || 5,
          captchaSoundEnabled: settings.captchaSoundEnabled !== false,
          captchaSoundFile: captchaSoundFile || settings.captchaSoundFile || 'taksi.mp3',
          cardsText: settings.cardsText || '',
        },
        count: settings.count || 1,
        timeout: 60000,
        retryAttempts: 3,
        uiScale: settings.uiScale || 1.0,
      };

      // Google Sheets integration (plaintext; encryption deferred)
      config.advanced.googleSheetsSpreadsheetId = settings.googleSheetsSpreadsheetId || '';
      config.advanced.googleSheetsServiceAccountJson =
        settings.googleSheetsServiceAccountJson === '********'
          ? ''
          : settings.googleSheetsServiceAccountJson || '';

      console.log(
        '[PERSISTENCE_STORE] loadSettings: loaded count from DB:',
        settings.count,
        '→ config.count:',
        config.count
      );

      set({
        settingsLoaded: true,
        imapPasswordSet: imapPasswordMasked || !!settings.imapPassword,
        gmailAppPasswordSet: gmailAppPasswordMasked || !!settings.gmailAppPassword,
      });

      console.log('[PERSISTENCE_STORE] loadSettings: completed successfully');
      return config;
    } catch (error) {
      console.error('[PERSISTENCE_STORE] loadSettings: failed:', error);
      set({ settingsLoaded: true });
      return null;
    }
  },

  saveSettings: async (config: RegistrationConfig, logVerbosity: LogVerbosity) => {
    console.log('[PERSISTENCE_STORE] saveSettings: starting with config:', config);

    // Save provider-specific email strategies to localStorage
    saveProviderStrategies(config.providerEmailStrategies);
    saveEmailGenerationDomain(config.imap.emailGenerationDomain || '');

    // Validate configuration
    const validation = validateIMAPConfig(config.imap, config.imap.strategy);
    if (!validation.valid) {
      console.warn('[PERSISTENCE_STORE] saveSettings: validation failed:', validation.error);
      set({ saveStatus: 'error' });
      setTimeout(() => set({ saveStatus: 'idle' }), 3000);
      return;
    }

    try {
      const updateData: Record<string, unknown> = {
        provider: config.provider,
        mailStrategy: config.imap.strategy,
        imapServer: config.imap.server,
        imapPort: config.imap.port,
        imapEmail: config.imap.email,
        imapUser: config.imap.email,
        gmailBase: config.imap.gmailBase,
        gmailAlias: config.imap.gmailAlias,
        proxyEnabled: config.proxy.enabled,
        proxyUrl: config.proxy.url,
        proxyUsername: config.proxy.username,
        proxyType: config.proxy.type,
        proxyList: config.proxy.list,
        proxyRotationEnabled: config.proxy.rotationEnabled,
        emailPattern: config.patterns.emailPattern,
        emailCustomPrefix: config.imap.emailCustomPrefix || config.patterns.emailCustomPrefix || '',
        namePattern: config.patterns.namePattern,
        nameCustomFirst: config.patterns.nameCustomFirst,
        nameCustomLast: config.patterns.nameCustomLast,
        count: config.count,
        headless: config.advanced.headless,
        uiScale: config.uiScale,
        logVerbosity: logVerbosity,
        
        // Advanced Settings
        speedMultiplier: config.advanced.speedMultiplier,
        delayBetweenAccounts: config.advanced.delayBetweenAccounts,
        verificationCodeTimeout: config.advanced.verificationCodeTimeout,
        oauthCallbackTimeout: config.advanced.oauthCallbackTimeout,
        allowAccessWait: config.advanced.allowAccessWait,
        pageLoadTimeout: config.advanced.pageLoadTimeout,
        elementWaitTimeout: config.advanced.elementWaitTimeout,
        imapPollInterval: config.advanced.imapPollInterval,
        passwordLength: config.advanced.passwordLength,
        realisticTyping: config.advanced.realisticTyping,
        humanDelays: config.advanced.humanDelays,
        screenshotsOnError: config.advanced.screenshotsOnError,
        captchaTimeout: config.advanced.captchaTimeout,
        captchaSoundEnabled: config.advanced.captchaSoundEnabled,
        cardsText: config.advanced.cardsText || '',

        // Save addy.io settings (global)
        addyioEnabled: config.imap.addyioEnabled || false,
        addyioApiToken: config.imap.addyioApiToken || '',
        addyioDomain: config.imap.addyioDomain || '',
        addyioAliasFormat: config.imap.addyioAliasFormat || 'uuid',
        addyioAutoDelete: config.imap.addyioAutoDelete || false,
        addyioDefaultRecipientId: config.imap.addyioDefaultRecipientId || '',
        addyioDescriptionTemplate: config.imap.addyioDescriptionTemplate || '',
        addyioFromName: config.imap.addyioFromName || '',
        // Save 33mail settings (global)
        thirtyThreeMailEnabled: config.imap.thirtyThreeMailEnabled || false,
        thirtyThreeMailUsername: config.imap.thirtyThreeMailUsername || '',
        thirtyThreeMailDomain: config.imap.thirtyThreeMailDomain || '33mail.com',
        thirtyThreeMailTemplate: config.imap.thirtyThreeMailTemplate || '{rnd12}',
        // Save Mail.tm settings (global)
        mailtmEnabled: config.imap.mailtmEnabled || false,

        // Google Sheets integration (plaintext; encryption deferred)
        googleSheetsSpreadsheetId: config.advanced.googleSheetsSpreadsheetId || '',
      };

      // Only include passwords if they have actual values
      if (config.imap.password) {
        updateData.imapPassword = config.imap.password;
      }
      if (config.imap.gmailAppPassword) {
        updateData.gmailAppPassword = config.imap.gmailAppPassword;
      }
      if (config.proxy.password) {
        updateData.proxyPassword = config.proxy.password;
      }

      if (config.advanced.googleSheetsServiceAccountJson) {
        updateData.googleSheetsServiceAccountJson = config.advanced.googleSheetsServiceAccountJson;
      }

      // Persist captchaSoundFile in localStorage because Rust DB doesn't know this field
      try {
        localStorage.setItem(
          'stitch:captchaSoundFile',
          config.advanced.captchaSoundFile || 'taksi.mp3'
        );
      } catch {
        // ignore localStorage errors
      }

      console.log(
        '[PERSISTENCE_STORE] saveSettings: calling updateSettings with data:',
        updateData
      );
      await updateSettings(updateData);
      console.log('[PERSISTENCE_STORE] saveSettings: updateSettings completed successfully');

      set({ saveStatus: 'saved' });
      setTimeout(() => set({ saveStatus: 'idle' }), 2000);
      console.log('[PERSISTENCE_STORE] saveSettings: status set to saved');
    } catch (error) {
      console.error('[PERSISTENCE_STORE] saveSettings: failed:', error);
      set({ saveStatus: 'error' });
      setTimeout(() => set({ saveStatus: 'idle' }), 3000);
    }
  },

  setSaveStatus: (status: SaveStatus) => set({ saveStatus: status }),
  setSettingsLoaded: (loaded: boolean) => set({ settingsLoaded: loaded }),
}));
