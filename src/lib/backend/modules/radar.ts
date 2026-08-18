/**
 * Radar & Friends Module
 *
 * Typed wrappers for the community feed backend commands:
 * - get_friends      → friend/partner cards
 * - get_radar_offers → paginated AI free-tier / credit offer feed
 * - get_radar_stats  → aggregate feed statistics
 *
 * The backend commands are already implemented and verified; these wrappers
 * only add end-to-end typing and degrade gracefully (callers surface errors
 * via the store's error state when the backend is unreachable).
 */

import { safeInvoke } from '../core';

// ============================================
// Friends
// ============================================

export type FriendType = 'telegram' | 'discord' | 'github' | 'other';
export type FriendBadge = 'official' | 'partner' | 'friend' | null;

export interface FriendItem {
  id: string;
  type: FriendType;
  title: string;
  url: string;
  description?: string | null;
  badge?: FriendBadge;
}

export interface FriendsResponse {
  items: FriendItem[];
}

// ============================================
// Radar Offers
// ============================================

export type RadarEffort = 'easy' | 'medium' | 'hard';

export interface RadarOffer {
  id: number;
  service_id: number;
  domain: string;
  name: string;
  type: string;
  amount: number | null;
  currency: string | null;
  models: string[];
  claim_steps: string | null;
  requirements: string | null;
  referral_required: boolean;
  effort: RadarEffort | null;
  unit: string | null;
  description: string | null;
  url: string | null;
  score: number;
  status: string;
  reliability: number | null;
  engine: string | null;
  first_seen_at: string;
  source: string | null;
  source_url: string | null;
  topic: string | null;
}

export interface RadarOffersResponse {
  count: number;
  items: RadarOffer[];
}

export interface GetRadarOffersParams {
  limit?: number;
  offset?: number;
  sort?: 'new' | 'amount';
  type?: string;
  effort?: RadarEffort;
  status?: string;
  q?: string;
  since_hours?: number;
}

// ============================================
// Radar Stats
// ============================================

export interface RadarStats {
  services: number;
  offers: number;
  active: number;
  dead: number;
  by_type: Record<string, number>;
  /** Not always present in the upstream /api/stats payload. */
  by_effort?: Record<string, number>;
}

// ============================================
// Commands
// ============================================

/**
 * Fetch the friends/partners list.
 */
export async function getFriends(): Promise<FriendsResponse> {
  return safeInvoke<FriendsResponse>('get_friends');
}

/**
 * Fetch a paginated batch of radar offers.
 */
export async function getRadarOffers(params?: GetRadarOffersParams): Promise<RadarOffersResponse> {
  return safeInvoke<RadarOffersResponse>('get_radar_offers', {
    limit: params?.limit,
    offset: params?.offset,
    sort: params?.sort,
    type: params?.type,
    effort: params?.effort,
    status: params?.status,
    q: params?.q,
    since_hours: params?.since_hours,
  });
}

/**
 * Fetch aggregate radar feed statistics.
 */
export async function getRadarStats(): Promise<RadarStats> {
  return safeInvoke<RadarStats>('get_radar_stats');
}
