/**
 * Registration store - main export
 * Re-exports from split stores for backward compatibility
 */

export {
  useRegistrationStore,
  type MailStrategy,
  type EmailStrategy,
  type IMAPConfig,
  type ProviderEmailStrategy,
  type ProviderEmailStrategies,
  type ProxyConfig,
  type AutoRegCredentials,
  type EmailPattern,
  type NamePattern,
  type PatternConfig,
  type AdvancedSettings,
  type RegistrationConfig,
  type SaveStatus,
  type StageProgressData,
  type RegistrationResult,
  type RegistrationHistoryEntry,
} from './registration/index';
