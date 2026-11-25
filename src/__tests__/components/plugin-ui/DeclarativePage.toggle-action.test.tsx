/**
 * DeclarativePage interactive toggle-action tests (v2.2).
 *
 * Verifies:
 *   (a) a source toggle WITHOUT action stays disabled (readonly status);
 *   (b) a toggle with action invokes plugin.<id>.<command> with
 *       {enabled: nextBool} (plus static params / custom valueParam);
 *   (c) the mutation response is authoritative — a stale in-flight source
 *       response that started before the mutation does not revert state;
 *   (d) rollback + error toast on a business error;
 *   (e) readonly: true disables interaction even with an action;
 *   (f) rapid clicks do not fire parallel mutations;
 *   (g) refreshOnSuccess targets are refreshed after a successful flip.
 *
 * Mocks mirror DeclarativePage.v21.test.tsx.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import DeclarativePage from '@/components/plugin-ui/DeclarativePage';
import type { PluginPageSchema } from '@/components/plugin-ui/schema';
import { safeInvoke } from '@/lib/backend/core/invoke';
import { appToast } from '@/lib/observability/toast';

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

jest.mock('@/components/ui', () => ({
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button
      data-testid={rest['data-testid'] ?? 'ui-button'}
      onClick={onClick}
      disabled={disabled}
    >
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
  Select: ({ label, value, options, disabled, onChange }: any) => (
    <div data-testid="ui-select">
      {label && <label>{label}</label>}
      <select value={value ?? ''} disabled={disabled} onChange={onChange}>
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
  Textarea: ({ value, readOnly, ...rest }: any) => (
    <textarea
      data-testid={rest['data-testid']}
      value={value ?? ''}
      readOnly={readOnly}
      onChange={() => undefined}
    />
  ),
  Modal: ({ isOpen, title, children, onClose }: any) =>
    isOpen ? (
      <div data-testid="ui-modal">
        <span>{title}</span>
        <button data-testid="ui-modal-close" onClick={onClose}>close</button>
        {children}
      </div>
    ) : null,
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

// ── Helpers ─────────────────────────────────────────────────────────────────

type ToggleNode = Extract<PluginPageSchema['nodes'][number], { kind: 'field' }>;

function toggleSchema(toggle: Partial<ToggleNode> & { id: string; label: string }): PluginPageSchema {
  return { nodes: [{ kind: 'field', field: 'toggle', ...toggle } as ToggleNode] };
}

function countCalls(cmd: string): number {
  return (safeInvoke as jest.Mock).mock.calls.filter(([c]) => c === cmd).length;
}

function getCheckbox(): HTMLInputElement {
  return screen.getByTestId('ui-toggle').querySelector('input') as HTMLInputElement;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const baseToggle = {
  kind: 'field',
  field: 'toggle',
  id: 'bridge',
  label: 'Bridge',
  source: { command: 'bridge_status' },
  valueKey: 'enabled',
} as const;

// ── Tests ───────────────────────────────────────────────────────────────────

describe('DeclarativePage toggle actions (v2.2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (safeInvoke as jest.Mock).mockResolvedValue(null);
  });

  it('(a) a source toggle without action stays disabled', async () => {
    (safeInvoke as jest.Mock).mockResolvedValue({ enabled: true });
    render(
      <DeclarativePage
        pluginId="test"
        schema={toggleSchema({ ...baseToggle })}
      />,
    );

    await waitFor(() => {
      expect(getCheckbox().checked).toBe(true);
    });
    expect(getCheckbox().disabled).toBe(true);

    await act(async () => {
      fireEvent.click(getCheckbox());
    });
    // No mutation command exists — only the status fetch happened.
    expect(countCalls('plugin.test.bridge_status')).toBe(1);
    expect((safeInvoke as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('(b) a toggle with action invokes the command with {enabled: nextBool}', async () => {
    (safeInvoke as jest.Mock).mockImplementation((cmd: unknown) => {
      if (cmd === 'plugin.test.bridge_status') return Promise.resolve({ enabled: false });
      if (cmd === 'plugin.test.set_bridge') return Promise.resolve({ enabled: true });
      return Promise.resolve(null);
    });
    render(
      <DeclarativePage
        pluginId="test"
        schema={toggleSchema({
          ...baseToggle,
          action: { command: 'set_bridge', params: { scope: 'hub' } },
        })}
      />,
    );

    await waitFor(() => {
      expect(getCheckbox().checked).toBe(false);
    });
    expect(getCheckbox().disabled).toBe(false);

    await act(async () => {
      fireEvent.click(getCheckbox());
    });

    expect(safeInvoke).toHaveBeenCalledWith('plugin.test.set_bridge', {
      scope: 'hub',
      enabled: true,
    });
    // The authoritative mutation response keeps the switch on.
    await waitFor(() => {
      expect(getCheckbox().checked).toBe(true);
    });

    // Flipping back off sends enabled: false; a custom valueParam renames the key.
    (safeInvoke as jest.Mock).mockImplementation((cmd: unknown) => {
      if (cmd === 'plugin.test.bridge_status') return Promise.resolve({ enabled: true });
      if (cmd === 'plugin.test.set_bridge') return Promise.resolve({ enabled: false });
      return Promise.resolve(null);
    });
    await act(async () => {
      fireEvent.click(getCheckbox());
    });
    expect(safeInvoke).toHaveBeenLastCalledWith('plugin.test.set_bridge', {
      scope: 'hub',
      enabled: false,
    });
  });

  it('(b2) a custom valueParam renames the boolean param key', async () => {
    (safeInvoke as jest.Mock).mockImplementation((cmd: unknown) => {
      if (cmd === 'plugin.test.bridge_status') return Promise.resolve({ enabled: false });
      return Promise.resolve({ up: true });
    });
    render(
      <DeclarativePage
        pluginId="test"
        schema={toggleSchema({
          ...baseToggle,
          action: { command: 'set_bridge', valueParam: 'up' },
        })}
      />,
    );

    await waitFor(() => {
      expect(getCheckbox().disabled).toBe(false);
    });
    await act(async () => {
      fireEvent.click(getCheckbox());
    });
    expect(safeInvoke).toHaveBeenCalledWith('plugin.test.set_bridge', { up: true });
  });

  it('(c) the mutation response is authoritative over a stale in-flight source response', async () => {
    const staleStatus = deferred<unknown>();
    (safeInvoke as jest.Mock).mockImplementation((cmd: unknown) => {
      if (cmd === 'plugin.test.bridge_status') return staleStatus.promise;
      if (cmd === 'plugin.test.set_bridge') return Promise.resolve({ enabled: true });
      return Promise.resolve(null);
    });
    render(
      <DeclarativePage
        pluginId="test"
        schema={toggleSchema({
          ...baseToggle,
          action: { command: 'set_bridge' },
        })}
      />,
    );

    // The initial status fetch is still in flight when the user flips.
    await waitFor(() => {
      expect(countCalls('plugin.test.bridge_status')).toBe(1);
    });
    await act(async () => {
      fireEvent.click(getCheckbox());
    });
    // Mutation resolved with enabled:true — the switch adopts it.
    await waitFor(() => {
      expect(getCheckbox().checked).toBe(true);
    });

    // Now the stale pre-mutation status response arrives with the OLD state.
    await act(async () => {
      staleStatus.resolve({ enabled: false });
      await Promise.resolve();
    });

    // The post-mutation state survives.
    expect(getCheckbox().checked).toBe(true);
  });

  it('(c2) a mutation response without the state key falls back to refetching the source', async () => {
    (safeInvoke as jest.Mock).mockImplementation((cmd: unknown) => {
      if (cmd === 'plugin.test.bridge_status') return Promise.resolve({ enabled: false });
      if (cmd === 'plugin.test.set_bridge') return Promise.resolve({ accepted: true, actionId: 'a1' });
      return Promise.resolve(null);
    });
    render(
      <DeclarativePage
        pluginId="test"
        schema={toggleSchema({
          ...baseToggle,
          action: { command: 'set_bridge' },
        })}
      />,
    );

    await waitFor(() => {
      expect(getCheckbox().disabled).toBe(false);
    });
    const before = countCalls('plugin.test.bridge_status');
    await act(async () => {
      fireEvent.click(getCheckbox());
    });
    await waitFor(() => {
      expect(countCalls('plugin.test.bridge_status')).toBeGreaterThan(before);
    });
  });

  it('(d) a business error rolls back the flip and surfaces an error toast', async () => {
    (safeInvoke as jest.Mock).mockImplementation((cmd: unknown) => {
      if (cmd === 'plugin.test.bridge_status') return Promise.resolve({ enabled: false });
      if (cmd === 'plugin.test.set_bridge') {
        return Promise.resolve({ success: false, error: 'bridge busy' });
      }
      return Promise.resolve(null);
    });
    render(
      <DeclarativePage
        pluginId="test"
        schema={toggleSchema({
          ...baseToggle,
          action: { command: 'set_bridge' },
        })}
      />,
    );

    await waitFor(() => {
      expect(getCheckbox().checked).toBe(false);
    });
    await act(async () => {
      fireEvent.click(getCheckbox());
    });

    await waitFor(() => {
      expect(appToast.error).toHaveBeenCalledWith('bridge busy');
    });
    // Rolled back to the pre-flip state.
    expect(getCheckbox().checked).toBe(false);
  });

  it('(d2) an exception rolls back and surfaces the toggleActionFailed toast', async () => {
    (safeInvoke as jest.Mock).mockImplementation((cmd: unknown) => {
      if (cmd === 'plugin.test.bridge_status') return Promise.resolve({ enabled: true });
      if (cmd === 'plugin.test.set_bridge') return Promise.reject(new Error('net down'));
      return Promise.resolve(null);
    });
    render(
      <DeclarativePage
        pluginId="test"
        schema={toggleSchema({
          ...baseToggle,
          action: { command: 'set_bridge' },
        })}
      />,
    );

    await waitFor(() => {
      expect(getCheckbox().checked).toBe(true);
    });
    await act(async () => {
      fireEvent.click(getCheckbox());
    });

    await waitFor(() => {
      expect(appToast.error).toHaveBeenCalledWith('pluginUi.toggleActionFailed');
    });
    expect(getCheckbox().checked).toBe(true);
  });

  it('(e) readonly: true disables interaction even with an action', async () => {
    (safeInvoke as jest.Mock).mockImplementation((cmd: unknown) => {
      if (cmd === 'plugin.test.bridge_status') return Promise.resolve({ enabled: true });
      return Promise.resolve(null);
    });
    render(
      <DeclarativePage
        pluginId="test"
        schema={toggleSchema({
          ...baseToggle,
          readonly: true,
          action: { command: 'set_bridge' },
        })}
      />,
    );

    await waitFor(() => {
      expect(getCheckbox().checked).toBe(true);
    });
    expect(getCheckbox().disabled).toBe(true);
    await act(async () => {
      fireEvent.click(getCheckbox());
    });
    expect(countCalls('plugin.test.set_bridge')).toBe(0);
  });

  it('(f) rapid clicks do not fire parallel mutations', async () => {
    const pendingMutation = deferred<unknown>();
    (safeInvoke as jest.Mock).mockImplementation((cmd: unknown) => {
      if (cmd === 'plugin.test.bridge_status') return Promise.resolve({ enabled: false });
      if (cmd === 'plugin.test.set_bridge') return pendingMutation.promise;
      return Promise.resolve(null);
    });
    render(
      <DeclarativePage
        pluginId="test"
        schema={toggleSchema({
          ...baseToggle,
          action: { command: 'set_bridge' },
        })}
      />,
    );

    await waitFor(() => {
      expect(getCheckbox().disabled).toBe(false);
    });
    // First click starts the mutation (still pending).
    await act(async () => {
      fireEvent.click(getCheckbox());
      await Promise.resolve();
    });
    // The switch is busy now — further clicks must not start parallel mutations.
    await act(async () => {
      fireEvent.click(getCheckbox());
      fireEvent.click(getCheckbox());
      await Promise.resolve();
    });
    expect(countCalls('plugin.test.set_bridge')).toBe(1);

    await act(async () => {
      pendingMutation.resolve({ enabled: true });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(getCheckbox().checked).toBe(true);
    });
    expect(countCalls('plugin.test.set_bridge')).toBe(1);
  });

  it('(g) refreshOnSuccess targets are refreshed after a successful flip', async () => {
    (safeInvoke as jest.Mock).mockImplementation((cmd: unknown) => {
      if (cmd === 'plugin.test.bridge_status') return Promise.resolve({ enabled: false });
      if (cmd === 'plugin.test.set_bridge') return Promise.resolve({ enabled: true });
      if (cmd === 'plugin.test.list_tbl') return Promise.resolve([{ name: 'row' }]);
      return Promise.resolve(null);
    });
    const schema: PluginPageSchema = {
      nodes: [
        {
          kind: 'table',
          id: 'tbl',
          columns: [{ key: 'name', label: 'Name' }],
          source: { command: 'list_tbl' },
        },
        {
          ...baseToggle,
          action: { command: 'set_bridge', refreshOnSuccess: ['tbl', 'nope'] },
        } as ToggleNode,
      ],
    };

    render(<DeclarativePage pluginId="test" schema={schema} />);

    await waitFor(() => {
      expect(screen.getByText('row')).toBeTruthy();
    });
    expect(countCalls('plugin.test.list_tbl')).toBe(1);

    await act(async () => {
      fireEvent.click(getCheckbox());
    });

    await waitFor(() => {
      expect(countCalls('plugin.test.list_tbl')).toBe(2);
    });
  });

  it('prompts window.confirm when action.confirm is set; decline aborts', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockImplementation(() => false);
    try {
      (safeInvoke as jest.Mock).mockImplementation((cmd: unknown) => {
        if (cmd === 'plugin.test.bridge_status') return Promise.resolve({ enabled: false });
        return Promise.resolve({ enabled: true });
      });
      render(
        <DeclarativePage
          pluginId="test"
          schema={toggleSchema({
            ...baseToggle,
            action: { command: 'set_bridge', confirm: 'confirm-flip' },
          })}
        />,
      );

      await waitFor(() => {
        expect(getCheckbox().disabled).toBe(false);
      });
      await act(async () => {
        fireEvent.click(getCheckbox());
      });
      expect(confirmSpy).toHaveBeenCalled();
      expect(countCalls('plugin.test.set_bridge')).toBe(0);

      confirmSpy.mockImplementation(() => true);
      await act(async () => {
        fireEvent.click(getCheckbox());
      });
      expect(countCalls('plugin.test.set_bridge')).toBe(1);
    } finally {
      confirmSpy.mockRestore();
    }
  });
});
