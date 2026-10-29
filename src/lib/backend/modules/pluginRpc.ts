import { safeInvoke } from '../core';

export async function cancelPluginAuthFlow(pluginId: string, sessionId: string): Promise<unknown> {
  return safeInvoke(`plugin.${pluginId}.auth_flow_cancel`, { sessionId });
}
