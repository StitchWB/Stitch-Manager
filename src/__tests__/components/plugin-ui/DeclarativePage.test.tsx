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
 *   (t) rowActions render one button set per row (+ trailing header cell).
 *   (u) Row action click sends static params + paramsFromRow values from
 *       the CLICKED row.
 *   (v) paramsFromRow referencing a missing column omits the key and
 *       console.warns once.
 *   (w) danger row actions prompt window.confirm and abort on decline.
 *   (x) danger row actions invoke on acceptance and refetch the source.
 *   (y) card_grid renders cards from source rows (row-key title/subtitle/
 *       body/image resolution + one action button per card).
 *   (z) card_grid template strings absent from the row render literally.
 *   (aa) Card action click sends static params + paramsFromRow values from
 *        the CLICKED card and refetches the source on success.
 *   (ab) danger card actions prompt window.confirm and abort on decline.
 *   (ac) card_grid loading state shows the spinner until the source resolves.
 *   (ad) card_grid null → empty state, malformed object → inline error,
 *        rejection → error message.
 *   (ae) markdown renders headings/bold/lists/links from the default textKey.
 *   (af) markdown is safe: raw HTML (<script>) renders as inert text and
 *        javascript: links get no hyperlink.
 *   (ag) markdown custom textKey + bare-string response both resolve.
 *   (ah) markdown loading state shows the spinner until the source resolves.
 *   (ai) markdown null → empty state, missing textKey → inline error.
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
  GlassCard: ({ children, className }: any) => (
    <div data-testid="ui-glass-card" className={className}>
      {children}
    </div>
  ),
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
      // Row-scoped action — renders a trailing actions column per row.
      rowActions: [
        {
          id: 'delete-user',
          label: 'Delete',
          command: 'delete_user',
          variant: 'danger',
          paramsFromRow: { id: 'id' },
        },
      ],
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

  // ── Row-scoped table actions (rowActions / paramsFromRow) ────────────────

  const rowActionSchema: PluginPageSchema = {
    nodes: [
      {
        kind: 'table',
        id: 'items',
        columns: [{ key: 'name', label: 'Name' }],
        source: { command: 'list_items' },
        rowActions: [
          {
            id: 'delete-item',
            label: 'Delete',
            command: 'delete_item',
            params: { staticKey: 'kept' },
            paramsFromRow: { itemId: 'id' },
          },
        ],
      },
    ],
  };

  const dangerRowSchema: PluginPageSchema = {
    nodes: [
      {
        kind: 'table',
        id: 'danger-items',
        columns: [{ key: 'name', label: 'Name' }],
        source: { command: 'list_danger' },
        rowActions: [
          {
            id: 'delete-danger',
            label: 'Delete',
            command: 'delete_danger',
            variant: 'danger',
            paramsFromRow: { itemId: 'id' },
          },
        ],
      },
    ],
  };

  it('(t) rowActions render one button set per row plus a trailing header cell', async () => {
    (safeInvoke as jest.Mock).mockResolvedValueOnce([
      { id: 'r1', name: 'One' },
      { id: 'r2', name: 'Two' },
    ]);

    const { container } = render(
      <DeclarativePage pluginId="test" schema={rowActionSchema} />,
    );

    await waitFor(() => {
      expect(screen.getByText('One')).toBeTruthy();
    });
    // One action button per row.
    expect(screen.getAllByText('Delete')).toHaveLength(2);
    // One data column + one trailing actions header cell.
    expect(container.querySelectorAll('th')).toHaveLength(2);
  });

  it('(u) clicking a row action sends static params + row-mapped params from the clicked row', async () => {
    (safeInvoke as jest.Mock).mockResolvedValueOnce([
      { id: 'r1', name: 'One' },
      { id: 'r2', name: 'Two' },
    ]);

    render(<DeclarativePage pluginId="test" schema={rowActionSchema} />);

    await waitFor(() => {
      expect(screen.getByText('Two')).toBeTruthy();
    });

    // Click the SECOND row's button — params must come from row r2.
    await act(async () => {
      fireEvent.click(screen.getAllByText('Delete')[1]);
    });

    expect(safeInvoke).toHaveBeenCalledWith('plugin.test.delete_item', {
      staticKey: 'kept',
      itemId: 'r2',
    });
  });

  it('(v) paramsFromRow referencing a missing column omits the key and warns once', async () => {
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      // Persistent (not Once): the post-action refetch must return the
      // same rows so the second click sees the same missing column.
      (safeInvoke as jest.Mock).mockResolvedValue([
        { id: 'r1', name: 'One' },
      ]);

      const missingColumnSchema: PluginPageSchema = {
        nodes: [
          {
            kind: 'table',
            id: 'ghost-table',
            columns: [{ key: 'name', label: 'Name' }],
            source: { command: 'list_ghost' },
            rowActions: [
              {
                id: 'ghost-action',
                label: 'Ghost',
                command: 'ghost_cmd',
                // Static value for the ghost key must be dropped too — a
                // missing column omits the key entirely.
                params: { ghost: 'static-default' },
                paramsFromRow: { ghost: 'nope-col', itemId: 'id' },
              },
            ],
          },
        ],
      };

      render(<DeclarativePage pluginId="test" schema={missingColumnSchema} />);

      await waitFor(() => {
        expect(screen.getByText('Ghost')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Ghost'));
      });

      expect(safeInvoke).toHaveBeenCalledWith('plugin.test.ghost_cmd', {
        itemId: 'r1',
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

  it('(w) danger row action confirms via window.confirm and aborts on decline', async () => {
    (safeInvoke as jest.Mock).mockResolvedValueOnce([
      { id: 'r1', name: 'One' },
    ]);
    const confirmSpy = jest
      .spyOn(window, 'confirm')
      .mockImplementation(() => false);
    try {
      render(<DeclarativePage pluginId="test" schema={dangerRowSchema} />);

      await waitFor(() => {
        expect(screen.getByText('One')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Delete'));
      });

      // Localized via the core confirm key (t = identity in this test).
      expect(confirmSpy).toHaveBeenCalledWith('pluginUi.confirmRowAction');
      // Declined → only the initial source fetch happened; the action
      // command was never invoked.
      expect(safeInvoke).toHaveBeenCalledTimes(1);
      expect(safeInvoke).not.toHaveBeenCalledWith(
        'plugin.test.delete_danger',
        expect.anything(),
      );
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('(x) danger row action invokes on acceptance and refetches the source', async () => {
    (safeInvoke as jest.Mock).mockResolvedValue([
      { id: 'r1', name: 'One' },
    ]);
    const confirmSpy = jest
      .spyOn(window, 'confirm')
      .mockImplementation(() => true);
    try {
      render(<DeclarativePage pluginId="test" schema={dangerRowSchema} />);

      await waitFor(() => {
        expect(screen.getByText('One')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Delete'));
      });

      expect(safeInvoke).toHaveBeenCalledWith('plugin.test.delete_danger', {
        itemId: 'r1',
      });
      // Successful action refetches the source command (initial + refetch).
      await waitFor(() => {
        const sourceCalls = (safeInvoke as jest.Mock).mock.calls.filter(
          ([cmd]) => cmd === 'plugin.test.list_danger',
        );
        expect(sourceCalls).toHaveLength(2);
      });
    } finally {
      confirmSpy.mockRestore();
    }
  });

  // ── Card grid node (card_grid) ───────────────────────────────────────────

  const cardGridSchema: PluginPageSchema = {
    nodes: [
      {
        kind: 'card_grid',
        id: 'services',
        source: { command: 'list_services' },
        card: {
          // Row column keys — resolved from each row object.
          title: 'name',
          subtitle: 'region',
          body: 'description',
          image: 'icon_url',
          action: {
            label: 'Refresh',
            command: 'refresh_service',
            params: { staticKey: 'kept' },
            paramsFromRow: { serviceId: 'id' },
          },
        },
      },
    ],
  };

  const dangerCardSchema: PluginPageSchema = {
    nodes: [
      {
        kind: 'card_grid',
        id: 'danger-cards',
        source: { command: 'list_danger_cards' },
        card: {
          title: 'name',
          action: {
            label: 'Delete',
            command: 'delete_card',
            variant: 'danger',
            paramsFromRow: { itemId: 'id' },
          },
        },
      },
    ],
  };

  it('(y) card_grid renders cards from source rows with row-key fields and an action per card', async () => {
    (safeInvoke as jest.Mock).mockResolvedValueOnce([
      {
        id: 's1',
        name: 'Alpha',
        region: 'eu-west',
        description: 'First service',
        icon_url: 'https://img/a.png',
      },
      {
        id: 's2',
        name: 'Beta',
        region: 'us-east',
        description: 'Second service',
        icon_url: 'https://img/b.png',
      },
    ]);

    const { container } = render(
      <DeclarativePage pluginId="test" schema={cardGridSchema} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeTruthy();
    });
    // Title/subtitle/body resolved from row keys on both cards.
    expect(screen.getByText('Beta')).toBeTruthy();
    expect(screen.getByText('eu-west')).toBeTruthy();
    expect(screen.getByText('Second service')).toBeTruthy();
    // Image resolved from the row key → real <img> with the row's URL.
    const images = container.querySelectorAll('img');
    expect(images).toHaveLength(2);
    expect(images[0].getAttribute('src')).toBe('https://img/a.png');
    expect(images[1].getAttribute('src')).toBe('https://img/b.png');
    // One action button per card.
    expect(screen.getAllByText('Refresh')).toHaveLength(2);
  });

  it('(z) card_grid template strings absent from the row render literally', async () => {
    (safeInvoke as jest.Mock).mockResolvedValueOnce([{ name: 'Gamma' }]);

    const literalCardSchema: PluginPageSchema = {
      nodes: [
        {
          kind: 'card_grid',
          id: 'literal',
          source: { command: 'list_literal' },
          card: {
            title: 'name',
            // Not a key of the row → literal fallback.
            subtitle: 'Static subtitle',
          },
        },
      ],
    };

    render(<DeclarativePage pluginId="test" schema={literalCardSchema} />);

    await waitFor(() => {
      expect(screen.getByText('Gamma')).toBeTruthy();
    });
    expect(screen.getByText('Static subtitle')).toBeTruthy();
  });

  it('(aa) clicking a card action sends static params + row-mapped params from the clicked card and refetches', async () => {
    // Persistent (not Once): the post-action refetch must return the
    // same rows.
    (safeInvoke as jest.Mock).mockResolvedValue([
      { id: 's1', name: 'Alpha' },
      { id: 's2', name: 'Beta' },
    ]);

    render(<DeclarativePage pluginId="test" schema={cardGridSchema} />);

    await waitFor(() => {
      expect(screen.getByText('Beta')).toBeTruthy();
    });

    // Click the SECOND card's button — params must come from row s2.
    await act(async () => {
      fireEvent.click(screen.getAllByText('Refresh')[1]);
    });

    expect(safeInvoke).toHaveBeenCalledWith('plugin.test.refresh_service', {
      staticKey: 'kept',
      serviceId: 's2',
    });
    // Successful action refetches the source command (initial + refetch).
    await waitFor(() => {
      const sourceCalls = (safeInvoke as jest.Mock).mock.calls.filter(
        ([cmd]) => cmd === 'plugin.test.list_services',
      );
      expect(sourceCalls).toHaveLength(2);
    });
  });

  it('(ab) danger card action confirms via window.confirm and aborts on decline', async () => {
    (safeInvoke as jest.Mock).mockResolvedValueOnce([
      { id: 'c1', name: 'One' },
    ]);
    const confirmSpy = jest
      .spyOn(window, 'confirm')
      .mockImplementation(() => false);
    try {
      render(<DeclarativePage pluginId="test" schema={dangerCardSchema} />);

      await waitFor(() => {
        expect(screen.getByText('One')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Delete'));
      });

      // Same core confirm key as table row actions (t = identity here).
      expect(confirmSpy).toHaveBeenCalledWith('pluginUi.confirmRowAction');
      // Declined → only the initial source fetch happened; the action
      // command was never invoked.
      expect(safeInvoke).toHaveBeenCalledTimes(1);
      expect(safeInvoke).not.toHaveBeenCalledWith(
        'plugin.test.delete_card',
        expect.anything(),
      );
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('(ac) card_grid shows the loading spinner until the source resolves', async () => {
    let resolveSource: (value: unknown) => void = () => undefined;
    (safeInvoke as jest.Mock).mockReturnValueOnce(
      new Promise(resolve => {
        resolveSource = resolve;
      }),
    );

    render(<DeclarativePage pluginId="test" schema={cardGridSchema} />);

    expect(screen.getByTestId('ui-loading-spinner')).toBeTruthy();

    await act(async () => {
      resolveSource([{ id: 's1', name: 'Alpha' }]);
    });

    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeTruthy();
    });
    expect(screen.queryByTestId('ui-loading-spinner')).toBeNull();
  });

  it('(ad) card_grid null → empty state, malformed object → inline error, rejection → error message', async () => {
    // null → empty state (em-dash), NOT an error.
    (safeInvoke as jest.Mock).mockResolvedValueOnce(null);
    const first = render(
      <DeclarativePage pluginId="test" schema={cardGridSchema} />,
    );
    await waitFor(() => {
      expect(screen.getByText('—')).toBeTruthy();
    });
    first.unmount();

    // Object without a "rows" array → inline error.
    (safeInvoke as jest.Mock).mockResolvedValueOnce({ unrelated: true });
    const second = render(
      <DeclarativePage pluginId="test" schema={cardGridSchema} />,
    );
    await waitFor(() => {
      expect(screen.getByText('Card grid response missing "rows"')).toBeTruthy();
    });
    second.unmount();

    // Rejection → inline error with the error message.
    (safeInvoke as jest.Mock).mockRejectedValueOnce(new Error('grid down'));
    render(<DeclarativePage pluginId="test" schema={cardGridSchema} />);
    await waitFor(() => {
      expect(screen.getByText('grid down')).toBeTruthy();
    });
  });

  // ── Markdown node (markdown) ─────────────────────────────────────────────

  const markdownSchema: PluginPageSchema = {
    nodes: [
      { kind: 'markdown', id: 'readme', source: { command: 'get_readme' } },
    ],
  };

  it('(ae) markdown renders headings, bold, lists and links from the default textKey', async () => {
    (safeInvoke as jest.Mock).mockResolvedValueOnce({
      text: '# Title\n\nSome **bold** text with a [docs](https://example.com) link.\n\n- one\n- two',
    });

    const { container } = render(
      <DeclarativePage pluginId="test" schema={markdownSchema} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Title')).toBeTruthy();
    });
    // Bold span rendered inside <strong>.
    const bold = screen.getByText('bold');
    expect(bold.tagName).toBe('STRONG');
    // Safe https link becomes a real hyperlink.
    const link = container.querySelector('a[href="https://example.com"]');
    expect(link).toBeTruthy();
    // List items rendered.
    expect(screen.getByText('one')).toBeTruthy();
    expect(screen.getByText('two')).toBeTruthy();
  });

  it('(af) markdown is safe: raw HTML renders as inert text and javascript: links get no hyperlink', async () => {
    (safeInvoke as jest.Mock).mockResolvedValueOnce({
      text: 'Safe text\n\n<script>alert(1)</script>\n\n[click](javascript:alert(1))',
    });

    const { container } = render(
      <DeclarativePage pluginId="test" schema={markdownSchema} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Safe text')).toBeTruthy();
    });
    // No script element (or any injected HTML) enters the DOM.
    expect(container.querySelectorAll('script')).toHaveLength(0);
    // The raw HTML is visible as escaped, inert text.
    expect(container.textContent).toContain('<script>alert(1)</script>');
    // javascript: scheme is not turned into a hyperlink.
    expect(container.querySelectorAll('a[href^="javascript"]')).toHaveLength(0);
    // The link text still renders as plain (possibly split) text nodes.
    expect(container.textContent).toContain('click');
  });

  it('(ag) markdown resolves a custom textKey and accepts a bare-string response', async () => {
    // Custom textKey.
    (safeInvoke as jest.Mock).mockResolvedValueOnce({
      content: 'Custom **key** content',
    });
    const customKeySchema: PluginPageSchema = {
      nodes: [
        {
          kind: 'markdown',
          id: 'custom',
          source: { command: 'get_custom' },
          textKey: 'content',
        },
      ],
    };
    const first = render(
      <DeclarativePage pluginId="test" schema={customKeySchema} />,
    );
    await waitFor(() => {
      expect(screen.getByText('key')).toBeTruthy();
    });
    first.unmount();

    // Bare string response is accepted as the markdown text directly.
    (safeInvoke as jest.Mock).mockResolvedValueOnce('Bare *string* response');
    render(<DeclarativePage pluginId="test" schema={markdownSchema} />);
    await waitFor(() => {
      expect(screen.getByText('string')).toBeTruthy();
    });
  });

  it('(ah) markdown shows the loading spinner until the source resolves', async () => {
    let resolveSource: (value: unknown) => void = () => undefined;
    (safeInvoke as jest.Mock).mockReturnValueOnce(
      new Promise(resolve => {
        resolveSource = resolve;
      }),
    );

    render(<DeclarativePage pluginId="test" schema={markdownSchema} />);

    expect(screen.getByTestId('ui-loading-spinner')).toBeTruthy();

    await act(async () => {
      resolveSource({ text: 'Loaded text' });
    });

    await waitFor(() => {
      expect(screen.getByText('Loaded text')).toBeTruthy();
    });
    expect(screen.queryByTestId('ui-loading-spinner')).toBeNull();
  });

  it('(ai) markdown null → empty state, missing textKey → inline error', async () => {
    // null → empty state (em-dash), NOT an error.
    (safeInvoke as jest.Mock).mockResolvedValueOnce(null);
    const first = render(
      <DeclarativePage pluginId="test" schema={markdownSchema} />,
    );
    await waitFor(() => {
      expect(screen.getByText('—')).toBeTruthy();
    });
    first.unmount();

    // Object without the textKey field → inline error.
    (safeInvoke as jest.Mock).mockResolvedValueOnce({ unrelated: true });
    render(<DeclarativePage pluginId="test" schema={markdownSchema} />);
    await waitFor(() => {
      expect(
        screen.getByText('Markdown response missing textKey "text"'),
      ).toBeTruthy();
    });
  });
});
