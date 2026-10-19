import { safeInvoke } from '../core';

const NS = 'plugin.stitch-freemodel';

export type FreeModelBridgeState = 'running' | 'stopped' | 'error';

export interface FreeModelBridgeStatus {
  status: FreeModelBridgeState;
  port: number | null;
  pid: number | null;
  uptimeSeconds: number | null;
  errorMessage?: string;
}

export function getFreeModelBridgeStatus(): Promise<FreeModelBridgeStatus> {
  return safeInvoke<FreeModelBridgeStatus>(
    `${NS}.get_freemodel_bridge_status`,
    {},
    { noCache: true },
  );
}

export function startFreeModelBridge(): Promise<FreeModelBridgeStatus> {
  return safeInvoke<FreeModelBridgeStatus>(`${NS}.start_freemodel_bridge`, {});
}

export function stopFreeModelBridge(): Promise<FreeModelBridgeStatus> {
  return safeInvoke<FreeModelBridgeStatus>(`${NS}.stop_freemodel_bridge`, {});
}
