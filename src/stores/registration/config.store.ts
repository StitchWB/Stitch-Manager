/**
 * Configuration store - manages registration settings
 * Handles provider selection, IMAP, proxy, patterns, and advanced settings
 */

import { create } from 'zustand';
import type { ProviderName } from '../../types';
import type { LogVerbosity } from '../../constants/logging';
import type {
  RegistrationConfig,
  IMAPConfig,
  ProxyConfig,
  AdvancedSettings,
  EmailPattern,
  ProviderEmailStrategy,
} from './types';
import { DEFAULT_CONFIG } from './types';

interface ConfigState {
  config: RegistrationConfig;
  logVerbosity: LogVerbosity;

  // Actions
  setProvider: (provider: ProviderName) => void;
  setIMAPConfig: (imap: Partial<IMAPConfig>) => void;
  setProxyConfig: (proxy: Partial<ProxyConfig>) => void;
  setAdvancedSettings: (settings: Partial<AdvancedSettings>) => void;
  setCount: (count: number) => void;
  setUIScale: (scale: number) => void;
  setLogVerbosity: (level: LogVerbosity) => void;
  setConfig: (config: RegistrationConfig) => void;
  updateConfig: (updates: Partial<RegistrationConfig>) => void;
}

export const useConfigStore = create<ConfigState>((set) => ({
  config: DEFAULT_CONFIG,
  logVerbosity: 'normal',

  setProvider: (provider: ProviderName) => {
    console.log('[CONFIG_STORE] setProvider called:', provider);
    set(state => {
      // Save current email strategy to current provider's slot
      const currentStrategy: ProviderEmailStrategy = {
        strategy: state.config.imap.strategy,
        customDomain: state.config.imap.server
          ? `${state.config.imap.email.split('@')[1] || ''}`
          : '',
        thirtyThreeMailDomain: state.config.imap.thirtyThreeMailDomain,
        addyioDomain: state.config.imap.addyioDomain,
      };

      const updatedStrategies = {
        ...state.config.providerEmailStrategies,
        [state.config.provider]: currentStrategy,
      };

      // Load email strategy for new provider
      const newStrategy = updatedStrategies[provider] || {
        strategy: 'custom' as const,
        customDomain: '',
        thirtyThreeMailDomain: '33mail.com',
        addyioDomain: '',
      };

      // Update IMAP config with new provider's strategy (but keep IMAP credentials)
      const newImap: IMAPConfig = {
        ...state.config.imap, // Keep all IMAP credentials
        strategy: newStrategy.strategy, // Update strategy
        // Update domain-specific fields based on strategy
        thirtyThreeMailDomain: newStrategy.thirtyThreeMailDomain,
        addyioDomain: newStrategy.addyioDomain,
      };

      return {
        config: {
          ...state.config,
          provider,
          imap: newImap,
          providerEmailStrategies: updatedStrategies,
        },
      };
    });
  },

  setIMAPConfig: (imap: Partial<IMAPConfig>) => {
    console.log('[CONFIG_STORE] setIMAPConfig called with:', imap);
    set(state => {
      const newImap = { ...state.config.imap, ...imap };
      console.log('[CONFIG_STORE] New IMAP config state:', newImap);

      // If strategy changed, update provider-specific strategy
      let updatedStrategies = state.config.providerEmailStrategies;
      if ('strategy' in imap || 'addyioDomain' in imap || 'thirtyThreeMailDomain' in imap) {
        const currentStrategy: ProviderEmailStrategy = {
          strategy: newImap.strategy,
          customDomain: newImap.server ? `${newImap.email.split('@')[1] || ''}` : '',
          thirtyThreeMailDomain: newImap.thirtyThreeMailDomain,
          addyioDomain: newImap.addyioDomain,
        };
        updatedStrategies = {
          ...updatedStrategies,
          [state.config.provider]: currentStrategy,
        };
      }

      const updates: Partial<RegistrationConfig> = {
        imap: newImap,
        providerEmailStrategies: updatedStrategies,
      };

      // If emailPattern is being updated, also update patterns
      if ('emailPattern' in imap) {
        const imapWithPattern = imap as Partial<IMAPConfig> & { emailPattern: EmailPattern };
        updates.patterns = {
          ...state.config.patterns,
          emailPattern: imapWithPattern.emailPattern,
        };
        // Remove emailPattern from imap updates
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { emailPattern, ...imapWithoutPattern } = imapWithPattern;
        updates.imap = { ...state.config.imap, ...imapWithoutPattern };
      }

      console.log('[CONFIG_STORE] setIMAPConfig: new config updates:', updates);
      return { config: { ...state.config, ...updates } };
    });
  },

  setProxyConfig: (proxy: Partial<ProxyConfig>) => {
    console.log('[CONFIG_STORE] setProxyConfig called:', proxy);
    set(state => ({
      config: {
        ...state.config,
        proxy: { ...state.config.proxy, ...proxy },
      },
    }));
  },

  setAdvancedSettings: (settings: Partial<AdvancedSettings>) => {
    console.log('[CONFIG_STORE] setAdvancedSettings called:', settings);
    set(state => ({
      config: {
        ...state.config,
        advanced: { ...state.config.advanced, ...settings },
      },
    }));
  },

  setCount: (count: number) => {
    const clampedCount = Math.max(1, Math.min(100, count));
    console.log('[CONFIG_STORE] setCount called:', count, '→ clamped:', clampedCount);
    set(state => ({
      config: { ...state.config, count: clampedCount },
    }));
  },

  setUIScale: (uiScale: number) => {
    console.log('[CONFIG_STORE] setUIScale called:', uiScale);
    set(state => ({
      config: { ...state.config, uiScale: Math.max(0.5, Math.min(1.5, uiScale)) },
    }));
  },

  setLogVerbosity: (level: LogVerbosity) => {
    console.log('[CONFIG_STORE] setLogVerbosity called:', level);
    set({ logVerbosity: level });
  },

  setConfig: (config: RegistrationConfig) => {
    console.log('[CONFIG_STORE] setConfig called');
    set({ config });
  },

  updateConfig: (updates: Partial<RegistrationConfig>) => {
    console.log('[CONFIG_STORE] updateConfig called with:', updates);
    set(state => ({
      config: { ...state.config, ...updates },
    }));
  },
}));
