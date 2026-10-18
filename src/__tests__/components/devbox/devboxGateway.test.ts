import { describe, it, expect } from '@jest/globals';
import {
  devboxNormalizeGateway,
  type DevboxOverviewGateway,
  type DevboxPermissionRow,
} from '@/lib/backend/modules/devbox';
import { gatewayFixture, overviewFixture } from './devboxTestKit';

describe('devboxNormalizeGateway', () => {
  it('returns null when the gateway block is absent', () => {
    expect(devboxNormalizeGateway(undefined)).toBeNull();
    expect(devboxNormalizeGateway(null)).toBeNull();
    expect(devboxNormalizeGateway('garbage')).toBeNull();
    expect(devboxNormalizeGateway({ cards: [] })).toBeNull();
  });

  it('normalizes the overview payload gateway block into the typed shape', () => {
    const normalized = devboxNormalizeGateway(overviewFixture);
    expect(normalized).toEqual(gatewayFixture);
    const expected: DevboxOverviewGateway = gatewayFixture;
    expect(normalized).toEqual(expected);
  });

  it('returns null for a malformed gateway block', () => {
    expect(devboxNormalizeGateway({ gateway: 'up' })).toBeNull();
    expect(devboxNormalizeGateway({ gateway: { enabled: true } })).toBeNull();
    expect(
      devboxNormalizeGateway({
        gateway: { enabled: true, up: true, port: 1, exposed_mcps: 'nope' },
      }),
    ).toBeNull();
  });

  it('tolerates junk entries and unknown modes inside exposed_mcps', () => {
    const normalized = devboxNormalizeGateway({
      gateway: {
        enabled: false,
        up: false,
        port: 'not-a-number',
        exposed_mcps: [
          null,
          { mode: 'full', tools: ['x'] },
          { name: 'stitch-cards', mode: 'weird', tools: ['list_cards', 42] },
        ],
      },
    });
    expect(normalized).toEqual({
      enabled: false,
      up: false,
      port: null,
      exposed_mcps: [{ name: 'stitch-cards', mode: 'readonly', tools: ['list_cards'] }],
    });
  });
});

describe('DevboxPermissionRow source', () => {
  it('is optional and defaults to undefined for bridge rows', () => {
    const row: DevboxPermissionRow = {
      id: 'p1',
      tool: 'shell',
      summary: 'rm -rf build/',
      startedAt: 1791536987.76,
    };
    expect(row.source).toBeUndefined();
  });

  it('accepts a gateway source', () => {
    const row: DevboxPermissionRow = {
      id: 'p2',
      tool: 'mcp',
      summary: 'totp_get',
      startedAt: 1791536987.76,
      source: 'gateway',
    };
    expect(row.source).toBe('gateway');
  });
});
