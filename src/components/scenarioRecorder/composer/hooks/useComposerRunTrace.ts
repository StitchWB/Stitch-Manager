import { useMemo } from 'react';
import type { PythonJobStatus } from '@/lib/tauri/modules/pythonJobs';
import type { FlowRouteHistoryEntry } from '../FlowGraphNode';

export function useComposerRunTrace(lastJobStatus: PythonJobStatus | null) {
  return useMemo(() => {
    const payload = (lastJobStatus?.resultPayload as Record<string, unknown> | null) ?? null;
    const data = (payload?.data as Record<string, unknown> | null) ?? null;

    const logsRaw = (payload?.logs as unknown[] | null) ?? null;
    const logsLimited = Array.isArray(logsRaw) ? logsRaw.slice(-120) : null;
    const protocolEvents = Array.isArray(logsLimited)
      ? (logsLimited
          .map(item => {
            if (!item || typeof item !== 'object') return null;
            const parsed = (item as Record<string, unknown>).parsed;
            if (!parsed || typeof parsed !== 'object') return null;
            const message = (parsed as Record<string, unknown>).message;
            const evtData = (parsed as Record<string, unknown>).data;
            if (message !== 'flow.run.trace.update' || !evtData || typeof evtData !== 'object') {
              return null;
            }
            return evtData as Record<string, unknown>;
          })
          .filter(Boolean) as Array<Record<string, unknown>>)
      : [];

    const routeHistoryRaw = data?.routeHistory;
    const routeHistory: FlowRouteHistoryEntry[] = Array.isArray(routeHistoryRaw)
      ? routeHistoryRaw.flatMap(item => {
          if (!item || typeof item !== 'object') return [];
          const fromNodeId = (item as Record<string, unknown>).fromNodeId;
          const toNodeId = (item as Record<string, unknown>).toNodeId;
          const branch = (item as Record<string, unknown>).branch;
          if (
            typeof fromNodeId !== 'string' ||
            typeof toNodeId !== 'string' ||
            (branch !== 'success' && branch !== 'error')
          ) {
            return [];
          }
          return [{ fromNodeId, toNodeId, branch }];
        })
      : [];

    const completedRaw = data?.completed;
    const completedNodeIds = new Set<string>(
      Array.isArray(completedRaw)
        ? completedRaw.flatMap(item => {
            if (!item || typeof item !== 'object') return [];
            const nodeId = (item as Record<string, unknown>).nodeId;
            return typeof nodeId === 'string' && nodeId ? [nodeId] : [];
          })
        : []
    );

    for (const evt of protocolEvents) {
      const completed = evt.completed;
      if (Array.isArray(completed)) {
        for (const item of completed) {
          if (!item || typeof item !== 'object') continue;
          const nodeId = (item as Record<string, unknown>).nodeId;
          if (typeof nodeId === 'string' && nodeId) {
            completedNodeIds.add(nodeId);
          }
        }
      }
    }

    let currentNodeId: string | null = null;
    for (const evt of protocolEvents) {
      const node = evt.currentNodeId;
      if (typeof node === 'string' && node) {
        currentNodeId = node;
      }
    }

    const activeRouteEdgeId =
      routeHistory.length > 0
        ? `${routeHistory[routeHistory.length - 1]!.fromNodeId}::${routeHistory[routeHistory.length - 1]!.branch}`
        : null;

    const isLive = lastJobStatus?.state === 'running';

    return {
      mode: typeof data?.mode === 'string' ? data.mode : null,
      routeHistory,
      completedNodeIds,
      currentNodeId,
      activeRouteEdgeId,
      isLive,
      durationMs: typeof data?.durationMs === 'number' ? data.durationMs : null,
    };
  }, [lastJobStatus?.resultPayload, lastJobStatus?.state]);
}
