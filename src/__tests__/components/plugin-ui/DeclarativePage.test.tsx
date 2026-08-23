/**
 * DeclarativePage component tests.
 *
 * Verifies:
 *   (a) Snapshot render of a fixture schema with all node kinds.
 *   (b) Clicking a button node calls safeInvoke('plugin.test.ping').
 *   (c) Unknown node kind renders without crash (tolerant reader).
 *   (d) safeInvoke rejection triggers appToast.error('pluginUi.actionFailed').
 *   (e) Missing/non-array schema.nodes renders without crash (hardened guard).
 *   (f) Table node accepts a bare-array command response (unwrapped rows).
 *
 * Mocks: invoke module (safeInvoke), i18n (t = identity), toast, and
 * @/components/ui primitives (stubbed to simple HTML like Plugins.test.tsx
 * mocks Header/sonner to keep tests focused on the component body).
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import DeclarativePage from '@/components/plugin-ui/DeclarativePage';
import type { PluginPageSchema, UiNode } from '@/components/plugin-ui/schema';
import { safeInvoke } from '@/lib/backend/core/invoke';
import { appToast } from '@/lib/observability/toast';

// ── Module mocks ────────────────────────────────────────────────────────────

jest.mock('@/lib/backend/core/invoke', () => ({
  setAuthExpiredHandler: jest.fn(),
  safeInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

jest.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('@/lib/observability/toast', () => ({
  appToast: {
    error: jest.fn(),
    success: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
  },
}));

// Stub @/components/ui primitives so the test asserts on DeclarativePage's
// node dispatch, not on the real Input/Select/Toggle/Table internals.
jest.mock('@/components/ui', () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button data-testid="ui-button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Input: ({ label, value, readOnly }: any) => (
    <div data-testid="ui-input">
      {label && <label>{label}</label>}
      <input value={value ?? ''} readOnly={readOnly} />
    </div>
  ),
  Select: ({ label, value, options, disabled }: any) => (
    <div data-testid="ui-select">
      {label && <label>{label}</label>}
      <select value={value ?? ''} disabled={disabled}>
        {(options ?? []).map((o: { value: string; label: string }) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  ),
  Toggle: ({ label, checked, onChange, disabled }: any) => (
    <label data-testid="ui-toggle">
      <input
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(e) => onChange?.(e.target.checked)}
        disabled={disabled}
      />
      {label}
    </label>
  ),
  LoadingSpinner: () => <div data-testid="ui-loading-spinner">Loading...</div>,
  EmptyState: ({ title, description }: any) => (
    <div data-testid="ui-empty-state">
      <span>{title}</span>
      {description && <span>{description}</span>}
    </div>
  ),
  Table: ({ children }: any) => <table data-testid="ui-table">{children}</table>,
  TableHeader: ({ children }: any) => <thead>{children}</thead>,
  TableBody: ({ children }: any) => <tbody>{children}</tbody>,
  TableRow: ({ children }: any) => <tr>{children}</tr>,
  TableHead: ({ children }: any) => <th>{children}</th>,
  TableCell: ({ children }: any) => <td>{children}</td>,
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const fixtureSchema: PluginPageSchema = {
  // Relative i18n key — resolved by the renderer as `plugin.test.page.title`.
  title: 'page.title',
  nodes: [
    { kind: 'heading', text: 'Overview', level: 1 },
    {
      kind: 'section',
      title: 'Settings',
      nodes: [
        { kind: 'field', field: 'text', id: 'name', label: 'Name', value: 'Alice' },
        {
          kind: 'field',
          field: 'select',
          id: 'role',
          label: 'Role',
          value: 'admin',
          options: [
            { value: 'admin', label: 'Admin' },
            { value: 'user', label: 'User' },
          ],
        },
        { kind: 'field', field: 'toggle', id: 'active', label: 'Active', value: true },
      ],
    },
    {
      kind: 'table',
      id: 'users',
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'email', label: 'Email' },
      ],
      source: { command: 'list_users' },
      rowsKey: 'rows',
    },
    { kind: 'button', id: 'ping', label: 'Ping', command: 'ping', variant: 'primary' },
  ],
};

const buttonOnlySchema: PluginPageSchema = {
  nodes: [
    { kind: 'button', id: 'ping', label: 'Ping', command: 'ping' },
  ],
};

const unknownNodeSchema: PluginPageSchema = {
  nodes: [
    { kind: 'heading', text: 'Before' },
    // Cast: simulates a future node kind the renderer doesn't know yet.
    { kind: 'future_widget', label: 'X' } as unknown as UiNode,
    { kind: 'heading', text: 'After' },
  ],
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe('DeclarativePage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (safeInvoke as jest.Mock).mockResolvedValue({
      rows: [{ name: 'Alice', email: 'a@b.c' }],
    });
  });

  it('(a) renders a fixture schema snapshot', async () => {
    const { container } = render(
      <DeclarativePage pluginId="test" schema={fixtureSchema} />,
    );

    // Wait for the table async load to settle.
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeTruthy();
    });

    expect(container).toMatchSnapshot();
  });

  it('(b) clicking a button calls safeInvoke with plugin.test.ping', async () => {
    render(<DeclarativePage pluginId="test" schema={buttonOnlySchema} />);

    await act(async () => {
      fireEvent.click(screen.getByText('Ping'));
    });

    expect(safeInvoke).toHaveBeenCalledWith('plugin.test.ping', undefined);
  });

  it('(c) unknown node kind renders without crash', async () => {
    const { container } = render(
      <DeclarativePage pluginId="test" schema={unknownNodeSchema} />,
    );

    // Known nodes before and after the unknown one still render.
    expect(screen.getByText('Before')).toBeTruthy();
    expect(screen.getByText('After')).toBeTruthy();
    // No throw — container is non-empty.
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });

  it('(d) safeInvoke rejection triggers appToast.error with pluginUi.actionFailed', async () => {
    (safeInvoke as jest.Mock).mockRejectedValueOnce(new Error('backend down'));

    render(<DeclarativePage pluginId="test" schema={buttonOnlySchema} />);

    await act(async () => {
      fireEvent.click(screen.getByText('Ping'));
    });

    await waitFor(() => {
      expect(appToast.error).toHaveBeenCalledWith('pluginUi.actionFailed');
    });
  });

  it('(e) missing schema.nodes renders without crash', () => {
    // Cast: simulates a malformed manifest missing the nodes array entirely.
    const { container } = render(
      <DeclarativePage pluginId="test" schema={{ title: 'only.title' } as PluginPageSchema} />,
    );
    // Title still renders; no nodes, no throw.
    expect(screen.getByText('plugin.test.only.title')).toBeTruthy();
    expect(container.querySelectorAll('[data-testid="ui-button"]')).toHaveLength(0);
  });

  it('(f) table node accepts a bare-array command response', async () => {
    (safeInvoke as jest.Mock).mockResolvedValueOnce([
      { name: 'Bob', email: 'bob@b.c' },
    ]);

    const bareArrayTableSchema: PluginPageSchema = {
      nodes: [
        {
          kind: 'table',
          id: 'users',
          columns: [
            { key: 'name', label: 'Name' },
            { key: 'email', label: 'Email' },
          ],
          source: { command: 'list_users' },
        },
      ],
    };

    render(<DeclarativePage pluginId="test" schema={bareArrayTableSchema} />);

    await waitFor(() => {
      expect(screen.getByText('Bob')).toBeTruthy();
    });
    expect(screen.getByText('bob@b.c')).toBeTruthy();
  });
});
