import { safeInvoke } from '../core/invoke';

export type ChannelType = 'telegram' | 'discord' | 'github' | 'other';
export type ChannelBadge = 'official' | 'partner' | 'friend' | null;

export interface ChannelItem {
  id: string;
  title: string;
  url: string;
  description: string | null;
  logo_url: string | null;
  type: ChannelType;
  badge: ChannelBadge;
  active: boolean;
}

export interface ChannelForm {
  title: string;
  url: string;
  description: string | null;
  logo_url: string | null;
  type: ChannelType;
  badge: ChannelBadge;
  active: boolean;
}

export async function listCommunityChannels(): Promise<ChannelItem[]> {
  const res = await safeInvoke<{ items: ChannelItem[] }>(
    'community_channels_list',
    {},
    { noCache: true },
  );
  return res.items;
}

export async function createCommunityChannel(form: ChannelForm): Promise<ChannelItem> {
  const res = await safeInvoke<{ channel: ChannelItem }>(
    'community_channels_create',
    { ...form },
    { noCache: true },
  );
  return res.channel;
}

export async function updateCommunityChannel(
  id: string,
  form: ChannelForm,
): Promise<ChannelItem> {
  const res = await safeInvoke<{ channel: ChannelItem }>(
    'community_channels_update',
    { id, ...form },
    { noCache: true },
  );
  return res.channel;
}

export async function deleteCommunityChannel(id: string): Promise<void> {
  await safeInvoke('community_channels_delete', { id }, { noCache: true });
}
