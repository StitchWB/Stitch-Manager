import { t } from '@/lib/i18n';

/**
 * Backend invite-domain errors are raised in English (``StitchError`` details
 * from ``domains/groups/service.py``). Map the known messages to localized
 * UI strings; anything unknown passes through untouched.
 */
const BACKEND_INVITE_ERRORS: Array<[raw: string, key: string]> = [
  ['Invitation not found', 'ai.groups.invite.notFound'],
  ['Invitation is no longer pending', 'ai.groups.invite.notPending'],
  ['Only the group owner or the inviter can revoke', 'ai.groups.invite.revokeForbidden'],
];

export function inviteErrorMessage(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  const hit = BACKEND_INVITE_ERRORS.find(([raw]) => message.includes(raw));
  return hit ? t(hit[1]) : message;
}
