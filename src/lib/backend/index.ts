/**
 * Backend API - Modular Structure
 *
 * This is the main entry point for all Python backend communication.
 * Functions are organized into focused modules for better maintainability.
 *
 * Module Structure:
 * - core/        - Error handling, validation, safe invoke wrappers
 * - modules/     - Feature-specific API modules
 *   - accounts   - Account CRUD, tokens, quotas, active accounts
 *   - registration - All registration flows (Cognito, Device Flow, Python automation)
 *   - patcher    - IDE detection, patching, backups, Trae-specific patches
 *   - settings   - App settings, Addy.io, IMAP, email counters
 *   - logs       - Log queries, management, statistics
 *   - aiProxy    - AI Proxy server and account management
 *   - kiro-patch - Kiro Patch V3, machine IDs, prompts
 *   - utils      - Clipboard, metadata, dashboard, WebSocket helpers
 *   - googleSheets - Google Sheets dataset ingestion
 */

// ============================================
// Core Utilities (Re-export for backward compatibility)
// ============================================

export {
  BackendError,
  SUPPORTED_PROVIDERS,
  type SupportedProvider,
  isValidProvider,
  validateProvider,
  safeInvoke,
  safeInvokeWithRetry,
  batchInvoke,
  isValidEmail,
  validateEmail,
  validateAccountId,
  validateRequiredString,
  validatePort,
  isValidUrl,
  validateUrl,
} from './core';

// ============================================
// Account Management
// ============================================

export {
  listAccounts,
  getAccounts,
  addAccount,
  deleteAccount,
  archiveAccount,
  bulkDeleteAccounts,
  bulkExportAccounts,
  importAccountsPayload,
  refreshAccountToken,
  refreshAccountQuota,
  refreshAccounts,
  validateAccount,
  checkAccountStatus,
  updateAccountNotesTags,
  setActiveAccount,
  getActiveAccounts,
  openAccountBrowser,
  openAccountProfileSession,
  confirmAccountProfileSession,
  clearAccountProfileSession,
  setAccountProxy,
  claimAccount,
  type ListAccountsParams,
  type GetAccountsParams,
  type AddAccountParams,
  type DeleteAccountParams,
  type RefreshAccountParams,
  type RefreshAccountsResult,
  type RefreshAccountResultItem,
  type GetQuotaParams,
  type SetActiveAccountParams,
  type TokenWriteResult,
} from './modules/accounts';

// ============================================
// NotebookLM (own surface)
// ============================================

export {
  notebooklmListNotebooks,
  notebooklmCreateNotebook,
  notebooklmAsk,
  notebooklmGenerateAudio,
  type NotebookLMNotebook,
} from './modules/notebooklm';

// ============================================
// Fingerprint Profiles
// ============================================

export {
  getOrCreateFingerprintProfile,
  loadFingerprintProfile,
  saveFingerprintProfile,
  deleteFingerprintProfile,
  exportFingerprintProfileBundle,
  importFingerprintProfileBundle,
  renameFingerprintProfileAlias,
  listFingerprintProfiles,
  openStandaloneFingerprintProfile,
  openStandaloneFingerprintProfileAndRememberUrl,
  getProfileSettings,
  saveProfileSettings,
  createDefaultProfileSettings,
  type BrowserFingerprintProfile,
  type ProfileSettingsRecord,
  type ProfileSettingsV1,
} from './modules/profiles';

// ============================================
// Registration
// ============================================

export {
  checkPythonAutoreg,
  getProviders,
  startWindsurfAutoregJob,
  startTraeAutoregJob,
  startGithubAutoregJob,
  startOpenAIAutoregJob,
  startFireworksAutoregJob,
  startQoderAutoregJob,
  startV0AppAutoregJob,
  getReferralDonors,
  type ReferralDonor,
  type ProviderInfo,
  startBitbucketAutoregJob,
  startKiroV2AutoregJob,
  authorizeKiroAccount,
  stopRegistration,
  getRegistrationJobs,
  getRegistrationJob,
  clearRegistrationJobs,
  getRegistrationStatus,
  registrationControl,
  type PipelineControlAction,
  startPythonAutoregJob,
  testInboxConnection,
  type ExtendedPythonAutoregConfig,
  type InboxPreflightParams,
  startRegistrationV2,
  type AutoRegParams,
  type ConfirmRegistrationParams,
  type StopRegistrationParams,
  type StartRegistrationV2Params,
  type RegistrationV2Result,
} from './modules/registration';

// ============================================
// Python Job Manager
// ============================================

export {
  startPythonJob,
  startComposedFlowJob,
  cancelPythonJob,
  getPythonJobStatus,
  upsertRecordedScenario,
  upsertComposedFlow,
  listComposedFlows,
  deleteComposedFlow,
  markComposedFlowRan,
  listRecordedScenarios,
  markRecordedScenarioPlayed,
  reindexRecordedScenarios,
  type PythonJobStartRequest,
  type PythonJobStartResponse,
  type PythonJobStatus,
  type PythonJobState,
  type ScenarioRecordItem,
  type ComposedFlowItem,
  type ComposedFlowUpsertRequest,
  type ComposedFlowRunRequest,
} from './modules/pythonJobs';

// ============================================
// MCP Bridge
// ============================================

export {
  type McpToolPayload,
  type McpToolRequest,
  type McpServerInfo,
  type McpAliasSummary,
  type McpScenarioSummary,
  type McpScenarioListRequest,
  type McpScenarioReadRequest,
  type McpScenarioWriteRequest,
  type McpFlowSummary,
  type McpFlowListRequest,
  type McpFlowUpsertRequest,
  type McpFlowRunRequest,
  type McpFlowRunResponse,
  type McpJobState,
  type McpJobCancelRequest,
  type McpJobWaitRequest,
  type McpJobStatusRequest,
  type McpJobStatus,
} from './modules/mcp';

// ============================================
// IDE Patcher
// ============================================

export {
  detectIDEs,
  getPatchStatus,
  patchIDE,
  unpatchIDE,
  listBackups,
  restoreBackup,
  deleteBackup,
  isTraePatched,
  patchTraeFull,
  isTraeExtensionPatched,
  isTraeWorkbenchPatched,
  type PatchIDEParams,
  type UnpatchIDEParams,
  type RestoreBackupParams,
  type UIBackupInfo,
} from './modules/patcher';

// ============================================
// Settings
// ============================================

export {
  getSettings,
  updateSettings,
  testAddyioConnection,
  getAddyioAccount,
  getAddyioDomains,
  getAddyioRecipients,
  getNextCounter,
  getEmailCounter,
  setEmailCounter,
} from './modules/settings';

// ============================================
// Unified Email Inbox
// ============================================

export {
  emailInboxConnect,
  emailInboxDisconnect,
  emailInboxList,
  emailInboxListFolders,
  emailInboxGetById,
  emailInboxWaitForEmail,
  emailInboxMarkAsRead,
  emailInboxDelete,
  emailInboxGetCapabilities,
  emailInboxGetProviderCatalog,
  emailInboxListProfiles,
  emailInboxUpsertProfile,
  emailInboxDeleteProfile,
  emailInboxConnectProfile,
  emailInboxGetSyncState,
  emailInboxUpsertSyncState,
  claimEmailInboxProfile,
  type EmailProviderType,
  type ImapConnectCredentials,
  type MailTmConnectCredentials,
  type EmailConnectCredentials,
  type EmailConnectOptions,
  type EmailConnectInput,
  type ProviderCapabilities,
  type EmailFolderKind,
  type EmailFolder,
  type EmailMailboxSession,
  type EmailAddress,
  type EmailAttachment,
  type EmailMessage,
  type EmailQuery,
  type WaitForEmailOptions,
  type EmailServiceError,
  type EmailProviderCatalogItem,
  type EmailInboxProfile,
  type EmailInboxProfileUpsertInput,
  type EmailInboxSyncStatus,
  type EmailInboxSyncState,
  type EmailInboxSyncStateUpsertInput,
} from './modules/emailInbox';

// ============================================
// Proxy Library
// ============================================

export {
  listProxyLibrary,
  updateProxyLibraryEntry,
  deleteProxyLibraryEntry,
  importProxyLibraryBulk,
  previewProxyLibraryBulk,
  getProxyLibraryRuntimeProxyUrl,
  getProxyLibraryRuntimeProxyMap,
  getProxyLibraryRuntimeProxyCatalog,
  getProxyLibraryUsage,
  createOrGetProxyLibraryEntry,
  parseProxyLibraryInput,
  testProxyLibraryDraft,
  ensureProxySaveUseAllowed,
  claimProxyLibraryEntry,
  ProxyLibraryError,
  type ProxyLibraryEntry,
  type ProxyLibraryDraft,
  type ProxyLibraryImportIssue,
  type ProxyLibraryImportResult,
  type ProxyLibraryBulkRequest,
  type ProxyLibraryUsage,
  type ProxyLibraryMutateOptions,
  type ProxyLibraryMutateResult,
  type ProxyLibraryRuntimeCatalogItem,
  type ProxyLibraryParseInputParams,
  type ProxyLibrarySaveUseGuardRequest,
  type ProxyLibraryDraftTestResult,
  type ProxyLibraryType,
} from './modules/proxyLibrary';

// ============================================
// Logging
// ============================================

export {
  getLogs,
  getLogStats,
  type LogEntry,
  type LogFilter,
  type LogQueryResult,
  type LogStats,
} from './modules/logs';

// ============================================
// Unified Observability
// ============================================

// ============================================
// Kiro Patch V3
// ============================================

export {
  getKiroPatchConfig,
  saveKiroPatchConfig,
  generateNewMachineId,
  bindMachineIdToAccount,
  unbindAccount,
  copyDefaultPrompts,
  getPromptContent,
  savePromptContent,
  getDefaultPromptContent,
  resetPromptToDefault,
  startKiroProxy,
  stopKiroProxy,
  getKiroProxyStatus,
} from './modules/kiro-patch';

// ============================================
// AI Proxy
// ============================================

export {
  startAiProxy,
  stopAiProxy,
  getProxyStatus,
  getProxySettings,
  updateProxySettings,
  getAiProxyAccounts,
  createAiProxyAccount,
  updateAiProxyAccount,
  deleteAiProxyAccount,
  providerAuthFlowStart,
  providerAuthFlowStatus,
  getAvailableModels,
  getProviderCapabilities,
  getProviderModelMappings,
  setProviderModelMappings,
  testProviderConnection,
  detectAiProxyIdes,
  restoreAiProxyIdeConfig,
  debugRunAiProxyMigration,
} from './modules/aiProxy';

// ============================================
// Scheduler
// ============================================

export {
  getScheduledTasks,
  getTaskExecutions,
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
} from './modules/scheduler';

// ============================================
// API Keys Management
// ============================================

export {
  getGeminiApiKeys,
  setGeminiApiKeys,
  getOpenAIApiKeys,
  setOpenAIApiKeys,
  getAntigravityApiKeys,
  setAntigravityApiKeys,
} from './modules/apiKeys';

// ============================================
// Provider Router
// ============================================

export {
  type RouteCacheStats,
} from './modules/router';

// ============================================
// Utilities
// ============================================

export {
  copyToClipboard,
  openInBrowser,
  openInFileManager,
  getDatabasePath,
  getDashboardStats,
} from './modules/utils';

// ============================================
// Google Sheets dataset ingestion
// ============================================

export {
  testGoogleSheetsConnection,
  fetchGoogleSheetsDataset,
  initGoogleSheetsSchema,
  upsertGoogleSheetsLink,
  deleteGoogleSheetsLink,
  upsertGoogleSheetsAccountLink,
  deleteGoogleSheetsAccountLink,
  upsertGoogleSheetsProfileLink,
  deleteGoogleSheetsProfileLink,
  upsertGoogleSheetsAuthMethod,
  deleteGoogleSheetsAuthMethod,
  upsertGoogleSheetsAccountAuthLink,
  deleteGoogleSheetsAccountAuthLink,
  type GoogleSheetsParams,
} from './modules/googleSheets';

// ============================================
// Namespace Exports (for better organization)
// ============================================

/**
 * Namespace exports provide organized access to Backend API modules.
 *
 * Usage patterns:
 *
 * 1. Flat imports (backward compatible):
 *    import { listAccounts, addAccount } from '@/lib/backend';
 *
 * 2. Namespace imports (organized):
 *    import { accounts } from '@/lib/backend';
 *    accounts.listAccounts();
 *    accounts.addAccount(...);
 *
 * 3. Mixed approach:
 *    import { accounts, registration, patcher } from '@/lib/backend';
 *    accounts.listAccounts();
 *    registration.startPythonAutoreg(...);
 *
 * Benefits of namespace imports:
 * - Clear module boundaries and organization
 * - Easier to understand which module a function belongs to
 * - Better IDE autocomplete when exploring available functions
 * - Reduces naming conflicts in consuming code
 */

export * as accounts from './modules/accounts';
export * as registration from './modules/registration';
export * as pythonJobs from './modules/pythonJobs';
export * as mcp from './modules/mcp';
export * as patcher from './modules/patcher';
export * as settings from './modules/settings';
export * as emailInbox from './modules/emailInbox';
export * as logs from './modules/logs';
export * as observability from './modules/observability';
export * as kiroPatch from './modules/kiro-patch';
export * as aiProxy from './modules/aiProxy';
export * as scheduler from './modules/scheduler';
export * as backgroundManager from './modules/backgroundManager';
export * as apiKeys from './modules/apiKeys';
export * as router from './modules/router';
export * as utils from './modules/utils';
export * as googleSheets from './modules/googleSheets';

// ============================================
// TOTP / 2FA Authenticator
// ============================================

export {
  listTotpKeys,
  addTotpKey,
  updateTotpKey,
  removeTotpKey,
  linkTotpKey,
  claimTotpKey,
  type TotpKey,
  type AddTotpKeyParams,
  type UpdateTotpKeyParams,
  type LinkTotpKeyParams,
} from './modules/totp';

export * as totp from './modules/totp';

// ============================================
// iCloud Hide My Email Pool
// ============================================

export {
  getICloudPoolStats,
  fillICloudPool,
  authenticateICloud,
  configureICloud,
  type FillICloudPoolParams,
  type FillICloudPoolResult,
  type AuthenticateICloudResult,
} from './modules/icloudPool';

// ============================================
// Telemetry / Failure Reports
// ============================================

export {
  getPendingReports,
  getReportPreview,
  sendReport,
  discardReport,
  type PendingReport,
  type GetPendingReportsResponse,
  type ReportPreview,
  type SendReportResult,
  type DiscardReportResult,
} from './modules/telemetry';

export * as telemetry from './modules/telemetry';

// ============================================
// Community Plugins
// ============================================

export {
  getCommunityCatalog,
  installCommunityPlugin,
  uninstallCommunityPlugin,
  listInstalledCommunity,
  listLocalPackages,
  submitForReview,
  type CommunityCatalogPlugin,
  type GetCommunityCatalogResponse,
  type InstallCommunityPluginParams,
  type InstallCommunityPluginResult,
  type UninstallCommunityPluginParams,
  type UninstallCommunityPluginResult,
  type InstalledCommunityPackage,
  type ListInstalledCommunityResponse,
  type LocalPackage,
  type ListLocalPackagesResponse,
  type SubmitForReviewParams,
  type SubmitForReviewResult,
} from './modules/community';

export * as community from './modules/community';

// ============================================
// Marketplace (official + community plugin feed)
// ============================================

export {
  getMarketplace,
  installMarketplacePlugin,
  uninstallMarketplacePlugin,
  type MarketplaceSource,
  type MarketplaceItem,
  type GetMarketplaceResponse,
  type InstallMarketplacePluginParams,
  type InstallMarketplacePluginResult,
  type UninstallMarketplacePluginParams,
  type UninstallMarketplacePluginResult,
} from './modules/marketplace';

export * as marketplace from './modules/marketplace';

// ============================================
// Local Overrides
// ============================================

export {
  listOverrides,
  createOverride,
  validateOverride,
  clearOverride,
  submitOverride,
  type OverrideEntry,
  type ListOverridesResponse,
  type CreateOverrideParams,
  type CreateOverrideResult,
  type ValidateOverrideParams,
  type ValidateOverrideResult,
  type ClearOverrideParams,
  type ClearOverrideResult,
  type SubmitOverrideParams,
  type SubmitOverrideResult,
} from './modules/overrides';

export * as overrides from './modules/overrides';

// ============================================
// Radar & Friends (community feed)
// ============================================

export {
  getFriends,
  getRadarOffers,
  getRadarStats,
  type FriendType,
  type FriendBadge,
  type FriendItem,
  type FriendsResponse,
  type RadarEffort,
  type RadarOffer,
  type RadarOffersResponse,
  type RadarStats,
  type GetRadarOffersParams,
} from './modules/radar';

export * as radar from './modules/radar';
