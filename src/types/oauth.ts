/**
 * OAuth Types for Frontend Integration
 * 
 * Comprehensive TypeScript types matching the Rust backend OAuth interface.
 * Provides type safety for OAuth authentication flows, session management,
 * and WebSocket event handling.
 */

// ============================================
// OAuth Provider Types
// ============================================

/**
 * OAuth provider enumeration matching Rust backend
 */
export type OAuthProvider = 'kiro' | 'github' | 'google' | 'windsurf' | 'trae';

/**
 * PKCE method enumeration
 */
export type PkceMethod = 'S256' | 'plain';

// ============================================
// OAuth Configuration Types
// ============================================

/**
 * OAuth provider configuration
 */
export interface OAuthConfig {
  provider: OAuthProvider;
  
  // OAuth settings
  clientIdHash: string;
  scopes: string[];
  authUrl: string;
  tokenUrl: string;
  
  // Callback settings
  callbackPortRange: [number, number]; // [start, end]
  callbackTimeout: number; // seconds
  
  // Browser settings
  headless: boolean;
  browserTimeout: number;
  
  // Retry settings
  maxRetries: number;
  retryDelay: number; // seconds
  
  // Advanced settings
  pkceMethod: PkceMethod;
  stateLength: number;
  codeVerifierLength: number;
}

/**
 * OAuth login configuration for commands
 */
export interface OAuthLoginConfig {
  provider: OAuthProvider;
  callbackPort?: number;
  headless?: boolean;
  timeout?: number;
  customScopes?: string[];
}

// ============================================
// OAuth Session Types
// ============================================

/**
 * OAuth session status enumeration
 */
export type OAuthStatus = 
  | 'pending'
  | 'browser_opened'
  | 'user_authorizing'
  | 'callback_received'
  | 'token_exchanging'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'terminated';

/**
 * OAuth session information
 */
export interface OAuthSessionInfo {
  sessionId: string;
  provider: OAuthProvider;
  status: OAuthStatus;
  createdAt: string;
  completedAt?: string;
  callbackPort?: number;
  authUrl?: string;
  errorMessage?: string;
  progress?: number; // 0.0 to 1.0
}

// ============================================
// OAuth Result Types
// ============================================

/**
 * OAuth user information
 */
export interface OAuthUserInfo {
  id?: string;
  email?: string;
  name?: string;
  username?: string;
  avatarUrl?: string;
  verified?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * OAuth authentication result
 */
export interface OAuthResult {
  success: boolean;
  sessionId: string;
  provider: OAuthProvider;
  
  // Token information (only present on success)
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  expiresIn?: number;
  expiresAt?: string;
  scopes?: string[];
  
  // User information (if available)
  userInfo?: OAuthUserInfo;
  
  // Error information (only present on failure)
  error?: string;
  errorCode?: string;
  
  // Timing information
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
}

// ============================================
// OAuth Process Types
// ============================================

/**
 * OAuth process configuration for Python integration
 */
export interface OAuthProcessConfig {
  sessionId: string;
  provider: OAuthProvider;
  callbackPort: number;
  headless: boolean;
  timeout: number;
  clientIdHash: string;
  customScopes?: string[];
  environment?: Record<string, string>;
}

/**
 * OAuth process status
 */
export type OAuthProcessStatus = 'starting' | 'running' | 'completed' | 'failed' | 'terminated';

/**
 * OAuth process information
 */
export interface OAuthProcessInfo {
  sessionId: string;
  processId: number;
  callbackPort: number;
  status: OAuthProcessStatus;
  startedAt: string;
  lastHeartbeat?: string;
  commandLine?: string;
  workingDirectory?: string;
}

// ============================================
// OAuth Progress Types
// ============================================

/**
 * OAuth flow step enumeration
 */
export type OAuthStep = 
  | 'initializing'
  | 'creating_session'
  | 'generating_pkce'
  | 'building_auth_url'
  | 'starting_callback_server'
  | 'opening_browser'
  | 'waiting_for_user'
  | 'receiving_callback'
  | 'exchanging_code'
  | 'fetching_user_info'
  | 'storing_tokens'
  | 'completed';

/**
 * OAuth progress event
 */
export interface OAuthProgressEvent {
  sessionId: string;
  step: OAuthStep;
  progress: number; // 0.0 to 1.0
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

// ============================================
// OAuth Error Types
// ============================================

/**
 * OAuth error categories for better error handling
 */
export type OAuthErrorCategory = 
  | 'configuration'
  | 'session'
  | 'pkce'
  | 'browser'
  | 'callback'
  | 'token'
  | 'userinfo'
  | 'process'
  | 'network'
  | 'database'
  | 'validation'
  | 'ratelimit'
  | 'recovery'
  | 'generic';

/**
 * OAuth error type enumeration
 */
export type OAuthErrorType = 
  // Configuration errors
  | 'UnsupportedProvider'
  | 'InvalidConfiguration'
  | 'MissingConfiguration'
  
  // Session errors
  | 'SessionNotFound'
  | 'InvalidStatus'
  | 'SessionCompleted'
  | 'SessionExpired'
  
  // PKCE errors
  | 'PkceGenerationFailed'
  | 'InvalidPkceParameters'
  
  // Browser errors
  | 'BrowserOpenFailed'
  | 'BrowserClosed'
  | 'BrowserTimeout'
  
  // Callback server errors
  | 'CallbackServerFailed'
  | 'CallbackTimeout'
  | 'InvalidCallback'
  | 'PortInUse'
  | 'NoAvailablePorts'
  
  // Token exchange errors
  | 'TokenExchangeFailed'
  | 'InvalidAuthorizationCode'
  | 'TokenRequestFailed'
  | 'InvalidTokenResponse'
  
  // User info errors
  | 'UserInfoFailed'
  | 'InvalidUserInfo'
  
  // Process management errors
  | 'ProcessSpawnFailed'
  | 'ProcessCommunicationFailed'
  | 'ProcessTerminated'
  | 'ProcessTimeout'
  
  // Network errors
  | 'NetworkError'
  | 'HttpError'
  | 'ConnectionTimeout'
  
  // Database errors
  | 'DatabaseError'
  | 'StorageFailed'
  
  // Validation errors
  | 'InvalidState'
  | 'InvalidRedirectUri'
  | 'InvalidScope'
  
  // Rate limiting errors
  | 'RateLimitExceeded'
  | 'TooManyConcurrentSessions'
  
  // Recovery errors
  | 'RecoveryFailed'
  | 'MaxRecoveryAttemptsExceeded'
  
  // Generic errors
  | 'InternalError'
  | 'Cancelled'
  | 'Unknown';

/**
 * OAuth error information
 */
export interface OAuthError {
  type: OAuthErrorType;
  category: OAuthErrorCategory;
  message: string;
  details?: string;
  isRecoverable: boolean;
  httpStatus: number;
}

// ============================================
// OAuth Statistics Types
// ============================================

/**
 * OAuth error statistics
 */
export interface OAuthErrorStat {
  errorType: string;
  count: number;
  percentage: number;
  lastOccurrence: string;
}

/**
 * Per-provider OAuth statistics
 */
export interface OAuthProviderStats {
  provider: OAuthProvider;
  totalSessions: number;
  successRate: number;
  avgCompletionTimeMs: number;
  errorRate: number;
  lastSuccess?: string;
  lastFailure?: string;
}

/**
 * OAuth usage statistics
 */
export interface OAuthStats {
  totalSessions: number;
  activeSessions: number;
  completedSessions: number;
  failedSessions: number;
  successRate: number; // 0.0 to 1.0
  
  // Per-provider statistics
  providerStats: Record<OAuthProvider, OAuthProviderStats>;
  
  // Time-based statistics
  sessionsLast24h: number;
  sessionsLast7d: number;
  sessionsLast30d: number;
  
  // Performance metrics
  avgCompletionTimeMs: number;
  medianCompletionTimeMs: number;
  p95CompletionTimeMs: number;
  
  // Error statistics
  errorRate: number; // 0.0 to 1.0
  topErrors: OAuthErrorStat[];
  
  // Resource usage
  activeProcesses: number;
  reservedPorts: number;
  memoryUsageMb: number;
}

// ============================================
// OAuth Health Types
// ============================================

/**
 * OAuth health level enumeration
 */
export type OAuthHealthLevel = 'healthy' | 'warning' | 'critical' | 'unknown';

/**
 * Individual health check result
 */
export interface OAuthHealthCheck {
  name: string;
  status: OAuthHealthLevel;
  message: string;
  details?: Record<string, unknown>;
  checkedAt: string;
}

/**
 * OAuth service health status
 */
export interface OAuthHealthStatus {
  status: OAuthHealthLevel;
  message: string;
  checks: OAuthHealthCheck[];
  lastUpdated: string;
}

// ============================================
// Frontend-Specific OAuth Types
// ============================================

/**
 * OAuth UI state for components
 */
export interface OAuthUIState {
  isLoading: boolean;
  currentStep?: OAuthStep;
  progress: number;
  error?: OAuthError;
  showBrowserPrompt: boolean;
  authUrl?: string;
}

/**
 * OAuth provider configuration for UI display
 */
export interface OAuthProviderDisplay {
  provider: OAuthProvider;
  name: string;
  description: string;
  icon: string;
  color: string;
  isEnabled: boolean;
  isConfigured: boolean;
  defaultScopes: string[];
}

/**
 * OAuth session management for frontend
 */
export interface OAuthSessionManager {
  activeSessions: Map<string, OAuthSessionInfo>;
  sessionHistory: OAuthSessionInfo[];
  maxHistorySize: number;
}

// ============================================
// OAuth Command Types for Tauri
// ============================================

/**
 * OAuth command parameters for Tauri backend
 */
export interface OAuthCommandParams {
  provider: OAuthProvider;
  config?: Partial<OAuthLoginConfig>;
}

/**
 * OAuth session query parameters
 */
export interface OAuthSessionQuery {
  sessionId?: string;
  provider?: OAuthProvider;
  status?: OAuthStatus;
  limit?: number;
  offset?: number;
}

/**
 * OAuth statistics query parameters
 */
export interface OAuthStatsQuery {
  provider?: OAuthProvider;
  timeRange?: '24h' | '7d' | '30d' | 'all';
  includeErrors?: boolean;
}

// ============================================
// Utility Types
// ============================================

/**
 * OAuth step utility functions
 */
export interface OAuthStepUtils {
  getProgress(step: OAuthStep): number;
  getDescription(step: OAuthStep): string;
  isTerminal(step: OAuthStep): boolean;
}

/**
 * OAuth status utility functions
 */
export interface OAuthStatusUtils {
  isActive(status: OAuthStatus): boolean;
  isTerminal(status: OAuthStatus): boolean;
  canRetry(status: OAuthStatus): boolean;
}

/**
 * OAuth provider utility functions
 */
export interface OAuthProviderUtils {
  getDefaultConfig(provider: OAuthProvider): OAuthConfig;
  getDisplayInfo(provider: OAuthProvider): OAuthProviderDisplay;
  isSupported(provider: OAuthProvider): boolean;
}