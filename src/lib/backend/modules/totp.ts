import { safeInvoke } from '../core/invoke';

export interface TotpKey {
  id: string;
  label: string;
  secret: string;
  issuer: string | null;
  accountId: string | null;
  digits: number;
  period: number;
  algorithm: string;
  enabled: boolean;
  createdAt: string | null;
}

export interface AddTotpKeyParams {
  label: string;
  secret: string;
  issuer?: string | null;
  accountId?: string | null;
  digits?: number;
  period?: number;
  algorithm?: string;
}

export interface UpdateTotpKeyParams {
  id: string;
  label?: string;
  issuer?: string | null;
  accountId?: string | null;
  enabled?: boolean;
}

export interface LinkTotpKeyParams {
  id: string;
  accountId: string | null;
}

export async function listTotpKeys(): Promise<TotpKey[]> {
  return safeInvoke<TotpKey[]>('list_totp_keys');
}

export async function addTotpKey(params: AddTotpKeyParams): Promise<TotpKey> {
  return safeInvoke<TotpKey>('add_totp_key', params as unknown as Record<string, unknown>);
}

export async function updateTotpKey(params: UpdateTotpKeyParams): Promise<TotpKey> {
  return safeInvoke<TotpKey>('update_totp_key', params as unknown as Record<string, unknown>);
}

export async function removeTotpKey(id: string): Promise<{ success: boolean; id: string }> {
  return safeInvoke('remove_totp_key', { id });
}

export async function linkTotpKey(params: LinkTotpKeyParams): Promise<TotpKey> {
  return safeInvoke<TotpKey>('link_totp_key', params as unknown as Record<string, unknown>);
}
