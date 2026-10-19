import { jest } from '@jest/globals';
import type {
  DevboxActionStatus,
  DevboxAgentPrompt,
  DevboxJobRow,
  DevboxOverviewGateway,
  DevboxPermissionRow,
  DevboxProfileRow,
  DevboxVitalCard,
} from '@/lib/backend/modules/devbox';

export const DEVBOX_NS = 'plugin.stitch-devbox.';

export type DevboxRouteHandler =
  | unknown
  | ((params: Record<string, unknown>) => unknown);

export type DevboxRoutes = Record<string, DevboxRouteHandler>;

export function devboxRouter(routes: DevboxRoutes) {
  return async (command: unknown, args?: Record<string, unknown>): Promise<unknown> => {
    if (typeof command === 'string' && command.startsWith(DEVBOX_NS)) {
      const handler = routes[command.slice(DEVBOX_NS.length)];
      if (typeof handler === 'function') {
        return (handler as (p: Record<string, unknown>) => unknown)(args ?? {});
      }
      if (handler !== undefined) return handler;
    }
    return {};
  };
}

export function devboxCalls(invoke: jest.Mock, cmd: string): unknown[][] {
  return invoke.mock.calls.filter(([command]) => command === `${DEVBOX_NS}${cmd}`);
}

export function devboxCallArgs(invoke: jest.Mock, cmd: string): Record<string, unknown>[] {
  return devboxCalls(invoke, cmd).map(([, args]) => (args ?? {}) as Record<string, unknown>);
}

export function gatewayVitalCard(tone: 'ok' | 'down' = 'ok'): DevboxVitalCard {
  return {
    id: 'gateway',
    title: 'Gateway',
    value: tone === 'ok' ? 'up' : 'down',
    tone,
    updatedAt: 1791536987.76,
  };
}

export const gatewayFixture: DevboxOverviewGateway = {
  enabled: true,
  up: true,
  port: 8765,
  calls: 12,
  errors: 1,
  exposed_mcps: [
    { name: 'stitch-totp', mode: 'readonly', tools: ['totp_get', 'totp_list'] },
    { name: 'stitch-mail', mode: 'full', tools: ['wait_for_email', 'send_email'] },
  ],
};

export const overviewFixture: {
  cards: DevboxVitalCard[];
  gateway: DevboxOverviewGateway;
} = {
  cards: [
    { id: 'profile', title: 'Profile', value: 'midsai', tone: 'ok', updatedAt: 1791536987.76 },
    {
      id: 'ingress',
      title: 'Ingress',
      value: 'up',
      tone: 'ok',
      hint: 'tunnel live',
      updatedAt: 1791536987.76,
    },
    { id: 'watchdog', title: 'Watchdog', value: 'on', tone: 'ok', updatedAt: 1791536987.76 },
    { id: 'runner', title: 'Runner', value: 'down', tone: 'down', updatedAt: 1791536987.76 },
    gatewayVitalCard('ok'),
  ],
  gateway: gatewayFixture,
};

export const profilesFixture: DevboxProfileRow[] = [
  { name: 'midsai', mode: 'standard', project_dir: 'd:/work/midsai', active: true },
  { name: 'example-simple', mode: 'readonly', project_dir: 'd:/work/example', active: false },
];

export const idleActionStatus: DevboxActionStatus = { busy: false, current: null, recent: [] };

export function runningJobFixture(startedAtEpochSec: number, id = 'j1'): DevboxJobRow {
  return { id, tool: 'bash', status: 'running', startedAt: startedAtEpochSec, sessionId: 'ses_1' };
}

export function pendingPermissionFixture(id = 'p1'): DevboxPermissionRow {
  return { id, tool: 'shell', summary: 'rm -rf build/', startedAt: 1791536987.76 };
}

const readyAll = { profile: true, bridge: true, ingress: true, runner: true };

export const maskedAgentPromptFixture: DevboxAgentPrompt = {
  prompt: 'CONNECT to devbox\nINGRESS=https://x.trycloudflare.com\nMCP_TOKEN=••••••',
  masked: true,
  ready: readyAll,
};

export const revealedAgentPromptFixture: DevboxAgentPrompt = {
  prompt: 'CONNECT to devbox\nINGRESS=https://x.trycloudflare.com\nMCP_TOKEN=abc123',
  masked: false,
  ready: readyAll,
};

export const agentPromptNoReadyFixture = {
  prompt: 'CONNECT to devbox\nMCP_TOKEN=••••••',
  masked: true,
};

export function promptWithClient(fixture: DevboxAgentPrompt, client = 'universal'): string {
  return `${fixture.prompt}\nCLIENT=${client}`;
}

export function agentPromptRoute(
  revealed: DevboxAgentPrompt = revealedAgentPromptFixture,
  masked: DevboxAgentPrompt = maskedAgentPromptFixture,
): DevboxRouteHandler {
  return (p: Record<string, unknown>) => {
    const base = p.reveal === true ? revealed : masked;
    const client = typeof p.client === 'string' && p.client !== '' ? p.client : 'universal';
    return { ...base, prompt: promptWithClient(base, client) };
  };
}

export function rotatedTokensStatus(finishedAtEpochSec: number): DevboxActionStatus {
  return {
    busy: false,
    current: null,
    recent: [
      {
        id: 'act-tokens-1',
        cmd: 'issue_tokens',
        status: 'succeeded',
        startedAt: finishedAtEpochSec - 5,
        finishedAt: finishedAtEpochSec,
        exit: 0,
        payload: null,
      },
    ],
  };
}

export interface DevboxPollBundleOverrides {
  overview?: unknown;
  action_status?: unknown;
  jobs?: unknown;
  permissions?: unknown;
  events?: unknown;
}

export function devboxPollBundle(overrides: DevboxPollBundleOverrides = {}) {
  return {
    overview: overviewFixture,
    action_status: idleActionStatus,
    jobs: [],
    permissions: [],
    events: [],
    ...overrides,
  };
}

export function pageRoutes(overrides: DevboxRoutes = {}): DevboxRoutes {
  return {
    poll: devboxPollBundle(),
    profiles_list: profilesFixture,
    logs: { sources: [] },
    agent_prompt: agentPromptRoute(),
    ...overrides,
  };
}
