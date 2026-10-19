import type { ComposedFlow } from './types';

export const createEmptyComposedFlow = (alias: string): ComposedFlow => {
  const now = new Date().toISOString();
  const flowId =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `flow_${Date.now()}`;
  return {
    id: flowId,
    alias,
    name: 'New flow',
    version: 1,
    createdAt: now,
    updatedAt: now,
    defaults: {
      alias,
      proxy: null,
      configJson: null,
      credentials: {
        login: null,
        password: null,
      },
    },
    inputDefaults: {},
    dataLists: [
      {
        id: 'emails_pool',
        values: [],
        strategy: 'next',
      },
    ],
    nodes: [],
  };
};
