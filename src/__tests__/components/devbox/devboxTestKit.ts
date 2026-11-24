import { jest } from '@jest/globals';
import type {
  DevboxActionStatus,
  DevboxAgentPrompt,
  DevboxConnection,
  DevboxConnectionCheckResult,
  DevboxEnvEntry,
  DevboxEventRow,
  DevboxHandoffBlock,
  DevboxJobRow,
  DevboxObserved,
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
{ name: 'midsai', mode: 'standard', project_dir: 'd:/work/midsai', active: true, git_placeholder: false },
    { name: 'example-simple', mode: 'readonly', project_dir: 'd:/work/example', active: false, git_placeholder: false },
];

export const idleActionStatus: DevboxActionStatus = { busy: false, current: null, recent: [] };

export function runningJobFixture(startedAtEpochSec: number, id = 'j1'): DevboxJobRow {
  return { id, tool: 'bash', status: 'running', startedAt: startedAtEpochSec, sessionId: 'ses_1' };
}

export function pendingPermissionFixture(id = 'p1'): DevboxPermissionRow {
  return { id, tool: 'shell', summary: 'rm -rf build/', startedAt: 1791536987.76 };
}

const readyAll = { profile: true, bridge: true, ingress: true, runner: 'up' as const };

const connectionMasked = {
  endpoints: [
    { id: 'bridge', url: 'https://x.trycloudflare.com/p/8787/mcp', token: 'abcd...wxyz', note: 'project tools' },
    { id: 'runner', url: 'https://x.trycloudflare.com/p/8796/mcp', token: 'efgh...stuv', note: 'host commands' },
  ],
  auth: { mode: 'bearer', header: 'Authorization', scheme: 'Bearer', oauth: false },
  ingress_url: 'https://x.trycloudflare.com',
};

const connectionRevealed = {
  endpoints: [
    { id: 'bridge', url: 'https://x.trycloudflare.com/p/8787/mcp', token: 'bridge-secret-1', note: 'project tools' },
    { id: 'runner', url: 'https://x.trycloudflare.com/p/8796/mcp', token: 'runner-secret-2', note: 'host commands' },
  ],
  auth: { mode: 'bearer', header: 'Authorization', scheme: 'Bearer', oauth: false },
  ingress_url: 'https://x.trycloudflare.com',
};

export const maskedAgentPromptFixture: DevboxAgentPrompt = {
  prompt: 'CONNECT to devbox\nINGRESS=https://x.trycloudflare.com\nMCP_TOKEN=••••••',
  masked: true,
  ready: readyAll,
  connection: connectionMasked,
};

export const revealedAgentPromptFixture: DevboxAgentPrompt = {
  prompt: 'CONNECT to devbox\nINGRESS=https://x.trycloudflare.com\nMCP_TOKEN=abc123',
  masked: false,
  ready: readyAll,
  connection: connectionRevealed,
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

export const connectPermissionsJson = JSON.stringify({ edit: 'ask', write: 'ask', bash: 'ask' });

export const connectEnvEntries: DevboxEnvEntry[] = [
  { key: 'INGRESS_MODE', value: 'auto', secret: false, readonly: false, section: 'ingress' },
  { key: 'RELAY_SUBDOMAIN', value: 'devbox-abcd1234', secret: false, readonly: false, section: 'ingress' },
  { key: 'RELAY_URL', value: 'https://devbox-abcd1234.loca.lt', secret: false, readonly: true, section: 'ingress' },
  { key: 'PUBLIC_URL', value: 'https://fallback.example.test', secret: false, readonly: false, section: 'ingress' },
  { key: 'TUNNEL_TOKEN', value: 'cf-masked-token', secret: true, readonly: false, section: 'ingress' },
  { key: 'EGRESS_CONTAINER', value: 'rdm-egress', secret: false, readonly: false, section: 'runtime' },
  { key: 'VLESS_SUB_URL', value: 'https://vless.example.test/sub', secret: true, readonly: false, section: 'runtime' },
  { key: 'JOB_TIMEOUT_SECONDS', value: '1800', secret: false, readonly: false, section: 'runtime' },
  { key: 'OPENCODE_MCP_PERMISSIONS', value: connectPermissionsJson, secret: false, readonly: true, section: 'policy' },
  { key: 'MCP_BEARER_TOKEN', value: 'bridge...masked', secret: true, readonly: true, section: 'tokens' },
  { key: 'MCP_PUBLIC_TOKEN', value: 'host...masked', secret: true, readonly: true, section: 'tokens' },
  { key: 'INGRESS_TOKEN', value: 'ingress...masked', secret: true, readonly: true, section: 'tokens' },
  { key: 'GATEWAY_TOKEN', value: 'gateway...masked', secret: true, readonly: true, section: 'tokens' },
];

export function envEntriesWithoutPublic(): DevboxEnvEntry[] {
  return connectEnvEntries.map(entry =>
    entry.key === 'PUBLIC_URL' || entry.key === 'RELAY_URL' ? { ...entry, value: '' } : entry,
  );
}

export const connectProfileModel = {
  project_dir: 'd:/work/midsai',
  mode: 'standard',
  deny_mounts: ['/secret'],
};

export const connectProfileJson = JSON.stringify(connectProfileModel, null, 2);

export const connectionOkFixture: DevboxConnectionCheckResult = {
  ok: true,
  url: 'https://devbox-abcd1234.loca.lt/p/8787/mcp',
  tools: 16,
  server: 'bridge',
  latency_ms: 42,
  mode: 'relay',
};

export const connectionFailFixture: DevboxConnectionCheckResult = {
  ok: false,
  error: 'bridge unreachable',
};

export const connectionManualFixture: DevboxConnectionCheckResult = {
  ok: true,
  url: 'https://fallback.example.test/p/8787/mcp',
  tools: 16,
  server: 'bridge',
  latency_ms: 58,
  mode: 'manual',
};

export const maskedHandoffFixture: DevboxHandoffBlock = {
  block: [
    'HANDOFF v1',
    'BRIDGE_TOKEN=bridge...masked',
    'HOST_TOKEN=host...masked',
    'INGRESS_TOKEN=ingress...masked',
    'GATEWAY_TOKEN=gateway...masked',
  ].join('\n'),
  masked: true,
};

export const revealedHandoffFixture: DevboxHandoffBlock = {
  block: [
    'HANDOFF v1',
    'BRIDGE_TOKEN=bridge-secret-1  # MCP_BEARER_TOKEN',
    'HOST_TOKEN=host-secret-2  # MCP_PUBLIC_TOKEN',
    'INGRESS_TOKEN=ingress-secret-3',
    'GATEWAY_TOKEN=gateway-secret-4',
  ].join('\n'),
  masked: false,
};

export const bootstrapCommands = [
  'curl -fsSL https://devbox-abcd1234.loca.lt/bootstrap.sh | bash',
  './mcp check',
].join('\n');

export const bootstrapSection = [
  '## 1. Bootstrap — выполни до всего остального',
  '',
  '```bash',
  bootstrapCommands,
  '```',
].join('\n');

export const connectConnectionMasked: DevboxConnection = {
  endpoints: [
    {
      id: 'bridge',
      url: 'https://devbox-abcd1234.loca.lt/p/8787/mcp',
      token: 'bridge...masked',
      note: 'project tools',
    },
    {
      id: 'gateway',
      url: 'https://devbox-abcd1234.loca.lt/p/8765/mcp',
      token: 'gateway...masked',
      note: 'my MCP',
    },
  ],
  auth: { mode: 'bearer', header: 'Authorization', scheme: 'Bearer', oauth: false },
  ingress_url: 'https://devbox-abcd1234.loca.lt',
};

export const connectConnectionRevealed: DevboxConnection = {
  endpoints: [
    {
      id: 'bridge',
      url: 'https://devbox-abcd1234.loca.lt/p/8787/mcp',
      token: 'bridge-secret-1',
      note: 'project tools',
    },
    {
      id: 'gateway',
      url: 'https://devbox-abcd1234.loca.lt/p/8765/mcp',
      token: 'gateway-secret-4',
      note: 'my MCP',
    },
  ],
  auth: { mode: 'bearer', header: 'Authorization', scheme: 'Bearer', oauth: false },
  ingress_url: 'https://devbox-abcd1234.loca.lt',
};

export const maskedConnectPromptFixture: DevboxAgentPrompt = {
  prompt: `CONNECT to devbox\n${bootstrapSection}`,
  masked: true,
  ready: readyAll,
  connection: connectConnectionMasked,
};

export const revealedConnectPromptFixture: DevboxAgentPrompt = {
  prompt: `CONNECT to devbox\n${bootstrapSection}`,
  masked: false,
  ready: readyAll,
  connection: connectConnectionRevealed,
};

export const noConnectionPromptFixture: DevboxAgentPrompt = {
  prompt: 'CONNECT to devbox',
  masked: true,
  ready: readyAll,
  connection: null,
};

export const healthyCardsFixture: DevboxVitalCard[] = [
  { id: 'profile', title: 'Profile', value: 'midsai', tone: 'ok', updatedAt: 1791536987.76 },
  { id: 'ingress', title: 'Ingress', value: 'up', tone: 'ok', updatedAt: 1791536987.76 },
  { id: 'bridge', title: 'Bridge', value: 'up', tone: 'ok', updatedAt: 1791536987.76 },
  { id: 'runner', title: 'Runner', value: 'up', tone: 'ok', updatedAt: 1791536987.76 },
  { id: 'watchdog', title: 'Watchdog', value: 'on', tone: 'ok', updatedAt: 1791536987.76 },
  gatewayVitalCard('ok'),
];

export const stoppedCardsFixture: DevboxVitalCard[] = [
  { id: 'profile', title: 'Profile', value: 'midsai', tone: 'ok', updatedAt: 1791536987.76 },
  { id: 'ingress', title: 'Ingress', value: 'down', tone: 'down', updatedAt: 1791536987.76 },
  { id: 'bridge', title: 'Bridge', value: 'down', tone: 'down', updatedAt: 1791536987.76 },
  { id: 'runner', title: 'Runner', value: 'down', tone: 'down', updatedAt: 1791536987.76 },
  { id: 'watchdog', title: 'Watchdog', value: 'off', tone: 'down', updatedAt: 1791536987.76 },
  gatewayVitalCard('down'),
];

export const bridgeDownCardsFixture: DevboxVitalCard[] = [
  { id: 'profile', title: 'Profile', value: 'midsai', tone: 'ok', updatedAt: 1791536987.76 },
  { id: 'ingress', title: 'Ingress', value: 'up', tone: 'ok', updatedAt: 1791536987.76 },
  { id: 'bridge', title: 'Bridge', value: 'down', tone: 'down', updatedAt: 1791536987.76 },
  { id: 'runner', title: 'Runner', value: 'up', tone: 'ok', updatedAt: 1791536987.76 },
  { id: 'watchdog', title: 'Watchdog', value: 'on', tone: 'ok', updatedAt: 1791536987.76 },
  gatewayVitalCard('ok'),
];

export const eventsFixture: DevboxEventRow[] = [
  { ts: 1791536980, kind: 'mcp_request', tool: 'bash', status: 'ok' },
  { ts: 1791536981, kind: 'mcp_response', tool: 'edit', status: 'awaiting_permission', permission: 'edit' },
];

export const observedJobsFixture: DevboxObserved<DevboxJobRow> = {
  rows: [runningJobFixture(1791536987.76)],
  bridge: 'up',
};

export const observedPermissionsFixture: DevboxObserved<DevboxPermissionRow> = {
  rows: [pendingPermissionFixture()],
  bridge: 'up',
};

export function connectRoutes(overrides: DevboxRoutes = {}): DevboxRoutes {
  return pageRoutes({
    env_get: { entries: connectEnvEntries },
    env_set: { valid: true, errors: [], restart: [] },
    connection_check: connectionOkFixture,
    handoff_block: (p: Record<string, unknown>) =>
      p.reveal === true ? revealedHandoffFixture : maskedHandoffFixture,
    agent_prompt: agentPromptRoute(revealedConnectPromptFixture, maskedConnectPromptFixture),
    profile_get: { json: connectProfileJson, valid: true, errors: [] },
    profile_put: { valid: true, errors: [] },
    watchdog_control: { accepted: true, actionId: 'act-watchdog' },
    cockpit_open: { url: 'http://127.0.0.1:8793/?t=test-token' },
    ingress_control: { accepted: true, actionId: 'act-ingress' },
    issue_tokens: { accepted: true, actionId: 'act-tokens' },
    stack_start: { accepted: true, actionId: 'act-stack' },
    stack_down: { accepted: true, actionId: 'act-stop' },
    stack_full_down: { accepted: true, actionId: 'act-stop-all' },
    run_doctor: { accepted: true, actionId: 'act-doctor' },
    profile_use: { accepted: true, actionId: 'act-use' },
    ...overrides,
  });
}
