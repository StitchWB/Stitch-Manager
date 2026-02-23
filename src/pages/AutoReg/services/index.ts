/**
 * AutoReg Services
 * Business logic extracted from AutoReg.tsx
 */

export {
  generateEmail,
  validateEmail,
  getEmailDomain,
  getEmailLocalPart,
  type EmailGenerationOptions,
  type EmailGenerationResult,
} from './emailGenerator';

export {
  runRegistration,
  type RegistrationOptions,
  type RegistrationSummary,
  type LogLevel,
  type RegistrationStatus,
} from './registrationRunner';
