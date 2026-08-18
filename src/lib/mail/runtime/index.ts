export {
  buildEmailQuery,
  buildImapConnectInput,
  buildMailTmConnectInput,
  buildWaitForEmailOptions,
  markMessageAsReadLocal,
  removeMessageLocal,
  upsertMessageById,
} from './emailInboxShared';

export {
  buildImapAccountIdFromRegistration,
  deriveImapFieldsFromRegistration,
  type DerivedRegistrationImapFields,
} from './registrationImap';

export {
  AUTO_REG_MAILBOX_PROFILE_ID,
  deriveAutoRegProfile,
  upsertAutoRegMailboxProfile,
  type DerivedAutoRegProfile,
} from './autoRegProfile';

export {
  buildAccountInboxQuery,
  resolveMailboxProfileForAccount,
  type MailboxResolution,
  type ResolveReason,
  type AccountInboxQuery,
} from './resolveMailbox';

export {
  ACCOUNT_QUERY_PARAM,
  buildAccountScopeContext,
  type AccountScopeContext,
} from './accountScope';
