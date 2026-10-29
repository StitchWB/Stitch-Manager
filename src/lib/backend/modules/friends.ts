/**
 * Friends Module
 *
 * Typed wrapper for the core-only ``get_friends`` command (partner /
 * community channel cards). Radar feed commands live in modules/radar.ts.
 */

import { safeInvoke } from '../core';

export type FriendType = 'telegram' | 'discord' | 'github' | 'other';
export type FriendBadge = 'official' | 'partner' | 'friend' | null;

export interface FriendItem {
  id: string;
  type: FriendType;
  title: string;
  url: string;
  description?: string | null;
  logo_url?: string | null;
  badge?: FriendBadge;
  tg_chat_id?: number | null;
  member_count?: number | null;
}

export interface FriendsResponse {
  items: FriendItem[];
}

/**
 * Fetch the friends/partners list.
 */
export async function getFriends(): Promise<FriendsResponse> {
  return safeInvoke<FriendsResponse>('get_friends');
}
