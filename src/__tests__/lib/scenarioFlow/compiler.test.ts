import { compileComposedFlow } from '../../../lib/scenarioFlow/compiler';
import type { ComposedFlow } from '../../../lib/scenarioFlow/types';

describe('compileComposedFlow', () => {
  it('builds segments and resolves bindings/context overrides', () => {
    const flow: ComposedFlow = {
      id: 'flow-1',
      alias: 'alias-a',
      name: 'Smoke composed flow',
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      defaults: {
        alias: 'alias-a',
        proxy: 'proxy-1',
        configJson: '{"timezone_id":"Auto"}',
        credentials: {
          login: 'user-a@example.com',
          password: 'pass-a',
        },
      },
      inputDefaults: {
        groupName: 'QA Group',
      },
      dataLists: [
        {
          id: 'emails_pool',
          strategy: 'next',
          values: ['first@example.com', 'second@example.com'],
        },
      ],
      nodes: [
        {
          id: 'n1',
          type: 'runScenario',
          name: 'Login',
          scenarioPath: 'C:/tmp/login.json',
          bindings: {
            login: { kind: 'context', path: 'credentials.login' },
            password: { kind: 'context', path: 'credentials.password' },
          },
          continueOnError: false,
          startUrl: 'https://example.com/login',
        },
        {
          id: 'n2',
          type: 'switchContext',
          name: 'Switch account',
          context: {
            alias: 'alias-b',
            proxy: 'proxy-2',
            credentials: {
              login: 'user-b@example.com',
              password: 'pass-b',
            },
          },
        },
        {
          id: 'n3',
          type: 'runScenario',
          name: 'Add member',
          scenarioPath: 'C:/tmp/add_member.json',
          bindings: {
            group: { kind: 'input', key: 'groupName' },
            memberEmail: { kind: 'list', sourceId: 'emails_pool', strategy: 'next' },
            actor: { kind: 'context', path: 'alias' },
          },
          continueOnError: true,
          startUrl: null,
        },
      ],
    };

    const compiled = compileComposedFlow(flow, {
      inputValues: { groupName: 'Ops Group' },
    });

    expect(compiled.flowId).toBe('flow-1');
    expect(compiled.segments).toHaveLength(2);
    expect(compiled.diagnostics).toHaveLength(0);

    expect(compiled.segments[0]).toMatchObject({
      nodeId: 'n1',
      index: 1,
      total: 2,
      alias: 'alias-a',
      proxy: 'proxy-1',
      scenarioPath: 'C:/tmp/login.json',
      continueOnError: false,
      resolvedVariables: {
        login: 'user-a@example.com',
        password: 'pass-a',
      },
    });

    expect(compiled.segments[1]).toMatchObject({
      nodeId: 'n3',
      index: 2,
      total: 2,
      alias: 'alias-b',
      proxy: 'proxy-2',
      scenarioPath: 'C:/tmp/add_member.json',
      continueOnError: true,
      resolvedVariables: {
        group: 'Ops Group',
        memberEmail: 'first@example.com',
        actor: 'alias-b',
      },
    });
  });

  it('collects diagnostics for invalid nodes', () => {
    const flow: ComposedFlow = {
      id: 'flow-2',
      alias: 'alias-z',
      name: 'Invalid flow',
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      defaults: {
        alias: '',
      },
      inputDefaults: {},
      dataLists: [],
      nodes: [
        {
          id: 'bad-node',
          type: 'runScenario',
          name: 'Broken',
          scenarioPath: '',
          bindings: {},
        },
      ],
    };

    const compiled = compileComposedFlow(flow);
    expect(compiled.segments).toHaveLength(0);
    expect(compiled.diagnostics).toEqual(
      expect.arrayContaining(['Node Broken: missing alias', 'Node Broken: missing scenarioPath'])
    );
  });

  it('follows explicit nextNodeId graph order when links are configured', () => {
    const flow: ComposedFlow = {
      id: 'flow-graph',
      alias: 'alias-graph',
      name: 'Graph flow',
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      defaults: {
        alias: 'alias-graph',
      },
      inputDefaults: {},
      dataLists: [],
      nodes: [
        {
          id: 'a',
          type: 'runScenario',
          name: 'A',
          scenarioPath: 'C:/tmp/a.json',
          nextNodeId: 'c',
          bindings: {},
        },
        {
          id: 'b',
          type: 'runScenario',
          name: 'B',
          scenarioPath: 'C:/tmp/b.json',
          bindings: {},
        },
        {
          id: 'c',
          type: 'runScenario',
          name: 'C',
          scenarioPath: 'C:/tmp/c.json',
          nextNodeId: 'b',
          bindings: {},
        },
      ],
    };

    const compiled = compileComposedFlow(flow);
    expect(compiled.entryNodeId).toBe('a');
    expect(compiled.segments.map(s => s.nodeId)).toEqual(['a', 'c', 'b']);
    expect(compiled.diagnostics).toHaveLength(0);
  });
});
