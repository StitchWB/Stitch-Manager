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
 *   (g) Field→param binding: typing into a text field and clicking a button
 *       with paramsFrom sends the merged params (static keys preserved).
 *   (h) Toggle + select fields bind through paramsFrom.
 *   (i) Field placeholder resolves via the label machinery and renders.
 *   (j) Buttons without paramsFrom send static params unchanged.
 *   (k) paramsFrom referencing a missing field id omits the key and
 *       console.warns once.
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
  Input: ({ label, value, readOnly, onChange, placeholder }: any) => (
    <div data-testid="ui-input">
      {label && <label>{label}</label>}
      <input
        value={value ?? ''}
        readOnly={readOnly}
        onChange={onChange}
        placeholder={placeholder}
      />
    </div>
  ),
  Select: ({ label, value, options, disabled, onChange, placeholder }: any) => (
    <div data-testid="ui-select">
      {label && <label>{label}</label>}
      <select
        value={value ?? ''}
        disabled={disabled}
        onChange={onChange}
        data-placeholder={placeholder}
      >
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
  // Relative i18n key — resolved by the renderer as `plugin.test.test.page.title`.
  // Labels must start with `<pluginId>.` to be treated as i18n keys.
  title: 'test.page.title',
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

// Fields live inside a section node on purpose: the field state map is
// page-scoped, so section-nested fields must bind exactly like top-level ones.
const formSchema: PluginPageSchema = {
  nodes: [
    {
      kind: 'section',
      title: 'Form',
      nodes: [
        {
          kind: 'field',
          field: 'text',
          id: 'name-field',
          label: 'Name',
          value: 'Alice',
          placeholder: 'test.name.ph',
        },
        {
          kind: 'field',
          field: 'select',
          id: 'mode-field',
          label: 'Mode',
          value: 'fast',
          options: [
            { value: 'fast', label: 'Fast' },
            { value: 'slow', label: 'Slow' },
          ],
        },
        { kind: 'field', field: 'toggle', id: 'flag-field', label: 'Flag' },
      ],
    },
    {
      kind: 'button',
      id: 'save',
      label: 'Save',
      command: 'save',
      params: { staticKey: 'kept', name: '' },
      paramsFrom: {
        name: 'name-field',
        mode: 'mode-field',
        flag: 'flag-field',
      },
    },
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
      <DeclarativePage pluginId="test" schema={{ title: 'test.only.title' } as PluginPageSchema} />,
    );
    // Title still renders; no nodes, no throw.
    expect(screen.getByText('plugin.test.test.only.title')).toBeTruthy();
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

  it('(g) typing into a text field + clicking a paramsFrom button sends merged params', async () => {
    render(<DeclarativePage pluginId="test" schema={formSchema} />);

    // Section-nested text field starts with its manifest value.
    const textInput = screen.getByDisplayValue('Alice');
    fireEvent.change(textInput, { target: { value: 'Bob' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });

    // Typed value overrides the paramsFrom key; static keys not listed in
    // paramsFrom are preserved.
    expect(safeInvoke).toHaveBeenCalledWith('plugin.test.save', {
      staticKey: 'kept',
      name: 'Bob',
      mode: 'fast',
      flag: false,
    });
  });

  it('(h) toggle and select fields bind through paramsFrom', async () => {
    render(<DeclarativePage pluginId="test" schema={formSchema} />);

    // Select: change fast → slow. (getByDisplayValue matches the selected
    // option's TEXT — "Fast" — for <select> elements.)
    fireEvent.change(screen.getByDisplayValue('Fast'), {
      target: { value: 'slow' },
    });
    // Toggle: check the checkbox (initial value undefined → false).
    fireEvent.click(screen.getByRole('checkbox'));

    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });

    expect(safeInvoke).toHaveBeenCalledWith('plugin.test.save', {
      staticKey: 'kept',
      name: 'Alice',
      mode: 'slow',
      flag: true,
    });
  });

  it('(i) field placeholder resolves via the label machinery and renders', () => {
    const placeholderSchema: PluginPageSchema = {
      nodes: [
        {
          kind: 'field',
          field: 'text',
          id: 'a',
          label: 'A',
          placeholder: 'test.hint.key',
        },
        {
          kind: 'field',
          field: 'text',
          id: 'b',
          label: 'B',
          placeholder: 'Plain hint',
        },
      ],
    };

    render(<DeclarativePage pluginId="test" schema={placeholderSchema} />);

    const inputs = screen.getAllByRole('textbox');
    // Dotted placeholder starting with pluginId is treated as an i18n key
    // (t = identity in this test).
    expect(inputs[0].getAttribute('placeholder')).toBe('plugin.test.test.hint.key');
    // Plain placeholder renders as-is.
    expect(inputs[1].getAttribute('placeholder')).toBe('Plain hint');
  });

  it('(j) button without paramsFrom sends its static params unchanged', async () => {
    const staticParamsSchema: PluginPageSchema = {
      nodes: [
        { kind: 'field', field: 'text', id: 'unused-field', label: 'Unused' },
        {
          kind: 'button',
          id: 'plain',
          label: 'Plain',
          command: 'ping',
          params: { a: 1, b: 'two' },
        },
      ],
    };

    render(<DeclarativePage pluginId="test" schema={staticParamsSchema} />);

    await act(async () => {
      fireEvent.click(screen.getByText('Plain'));
    });

    expect(safeInvoke).toHaveBeenCalledWith('plugin.test.ping', {
      a: 1,
      b: 'two',
    });
  });

  it('(k) paramsFrom referencing a missing field id omits the key and warns once', async () => {
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      const missingFieldSchema: PluginPageSchema = {
        nodes: [
          { kind: 'field', field: 'text', id: 'real-field', label: 'Real' },
          {
            kind: 'button',
            id: 'ghost-btn',
            label: 'Ghost',
            command: 'save',
            // Static value for the ghost key must be dropped too — a missing
            // field id omits the key entirely.
            params: { ghost: 'static-default' },
            paramsFrom: { ghost: 'nope-field', real: 'real-field' },
          },
        ],
      };

      render(<DeclarativePage pluginId="test" schema={missingFieldSchema} />);

      await act(async () => {
        fireEvent.click(screen.getByText('Ghost'));
      });

      expect(safeInvoke).toHaveBeenCalledWith('plugin.test.save', {
        real: '',
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);

      // Second click: the warning is not repeated.
      await act(async () => {
        fireEvent.click(screen.getByText('Ghost'));
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  // ── Fix 1: resolveLabel dot heuristic ────────────────────────────────────

  it('(l) version-like label "v1.2.3" renders literally (not an i18n key)', () => {
    const versionSchema: PluginPageSchema = {
      nodes: [
        { kind: 'heading', text: 'v1.2.3', level: 2 },
      ],
    };

    render(<DeclarativePage pluginId="test" schema={versionSchema} />);

    // "v1.2.3" does not start with "test." → renders literally, NOT
    // "plugin.test.v1.2.3".
    expect(screen.getByText('v1.2.3')).toBeTruthy();
  });

  it('(m) label starting with pluginId resolves via t()', () => {
    const i18nSchema: PluginPageSchema = {
      nodes: [
        { kind: 'heading', text: 'test.title', level: 2 },
      ],
    };

    render(<DeclarativePage pluginId="test" schema={i18nSchema} />);

    // "test.title" starts with "test." → t('plugin.test.test.title')
    // (t = identity in this test).
    expect(screen.getByText('plugin.test.test.title')).toBeTruthy();
  });

  it('(n) dotted label not starting with pluginId renders literally', () => {
    const dottedSchema: PluginPageSchema = {
      nodes: [
        { kind: 'heading', text: 'other.title', level: 2 },
      ],
    };

    render(<DeclarativePage pluginId="test" schema={dottedSchema} />);

    // "other.title" contains a dot but does not start with "test." → literal.
    expect(screen.getByText('other.title')).toBeTruthy();
  });

  // ── Fix 2: TableNode malformed responses ─────────────────────────────────

  it('(o) table object without rowsKey shows inline error', async () => {
    (safeInvoke as jest.Mock).mockResolvedValueOnce({ unrelated: 'data' });

    const malformedTableSchema: PluginPageSchema = {
      nodes: [
        {
          kind: 'table',
          id: 'bad',
          columns: [{ key: 'name', label: 'Name' }],
          source: { command: 'list_bad' },
        },
      ],
    };

    render(<DeclarativePage pluginId="test" schema={malformedTableSchema} />);

    await waitFor(() => {
      expect(screen.getByText('Table response missing rowsKey "rows"')).toBeTruthy();
    });
  });

  it('(p) table null response renders empty state', async () => {
    (safeInvoke as jest.Mock).mockResolvedValueOnce(null);

    const nullTableSchema: PluginPageSchema = {
      nodes: [
        {
          kind: 'table',
          id: 'empty',
          columns: [{ key: 'name', label: 'Name' }],
          source: { command: 'list_empty' },
        },
      ],
    };

    render(<DeclarativePage pluginId="test" schema={nullTableSchema} />);

    // null → empty state (em-dash), NOT an error.
    await waitFor(() => {
      expect(screen.getByText('—')).toBeTruthy();
    });
  });

  it('(q) table bare-array response still renders rows', async () => {
    (safeInvoke as jest.Mock).mockResolvedValueOnce([
      { name: 'Carol' },
    ]);

    const arrayTableSchema: PluginPageSchema = {
      nodes: [
        {
          kind: 'table',
          id: 'arr',
          columns: [{ key: 'name', label: 'Name' }],
          source: { command: 'list_arr' },
        },
      ],
    };

    render(<DeclarativePage pluginId="test" schema={arrayTableSchema} />);

    await waitFor(() => {
      expect(screen.getByText('Carol')).toBeTruthy();
    });
  });

  it('(r) table rowsKey present still renders rows', async () => {
    (safeInvoke as jest.Mock).mockResolvedValueOnce({
      rows: [{ name: 'Dave' }],
    });

    const rowsKeyTableSchema: PluginPageSchema = {
      nodes: [
        {
          kind: 'table',
          id: 'rk',
          columns: [{ key: 'name', label: 'Name' }],
          source: { command: 'list_rk' },
          rowsKey: 'rows',
        },
      ],
    };

    render(<DeclarativePage pluginId="test" schema={rowsKeyTableSchema} />);

    await waitFor(() => {
      expect(screen.getByText('Dave')).toBeTruthy();
    });
  });

  // ── Fix 3: duplicate field ids ───────────────────────────────────────────

  it('(s) duplicate field ids warn once and last value wins', () => {
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      const duplicateSchema: PluginPageSchema = {
        nodes: [
          { kind: 'field', field: 'text', id: 'dup', label: 'First', value: 'A' },
          { kind: 'field', field: 'text', id: 'dup', label: 'Second', value: 'B' },
        ],
      };

      render(<DeclarativePage pluginId="test" schema={duplicateSchema} />);

      // console.warn called once for the duplicate id.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('duplicate field id "dup"');

      // Last value wins — both inputs read from the same state entry
      // (keyed by id "dup"), so both show "B", not "A".
      expect(screen.queryByDisplayValue('A')).toBeNull();
      expect(screen.getAllByDisplayValue('B')).toHaveLength(2);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
