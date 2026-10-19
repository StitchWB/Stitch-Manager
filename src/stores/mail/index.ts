import { create } from 'zustand';
import type { MailState } from './types';
import { createConnectionSlice } from './connection.slice';
import { createSessionSlice } from './session.slice';
import { createMessagesSlice } from './messages.slice';
import { createProfilesSlice } from './profiles.slice';

export const useMailStore = create<MailState>()((...a) => ({
  ...createConnectionSlice(...a),
  ...createSessionSlice(...a),
  ...createMessagesSlice(...a),
  ...createProfilesSlice(...a),
}));

export { _resetErrorDedupeForTests } from './helpers';
export type {
  MailImapCredentials,
  MailProfileSyncState,
  MailQueryFilters,
  MailSyncControls,
  MailTmCredentials,
} from './types';
