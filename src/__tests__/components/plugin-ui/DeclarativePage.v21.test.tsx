/**
 * DeclarativePage v2.1 renderer-feedback tests (F04).
 *
 * Verifies:
 *   (a) Successful command → pluginUi.actionSucceeded toast.
 *   (b) Business error {success:false,error} → error toast with the error text.
 *   (c) Business error {accepted:false,reason} → error toast with the reason.
 *   (d) Business error without text falls back to pluginUi.actionFailed.
 *   (e) Success payload string fields render in a copyable result dialog
 *       (envelope keys excluded); copy button writes to the clipboard.
 *   (f) button.confirm prompts window.confirm with the resolved i18n string;
 *       decline aborts, accept invokes.
 *   (g) variant:'danger' page button without confirm falls back to the
 *       pluginUi.confirmRowAction prompt.
 *   (h) button.refreshOnSuccess bumps the named nodes' sources (unknown ids
 *       ignored).
 *   (i) source.refreshMs refetches on an interval; cleanup on unmount.
 *   (j) refreshMs below the 2000ms floor is capped.
 *   (k) table/card_grid/markdown render the resolved `empty` key instead of
 *       the bare em-dash.
 *   (l) card.tone renders a colored dot + border; card.hint renders a line.
 *   (m) toggle field with a source binding renders a switch bound to the
 *       fetched source value.
 *
 * Mocks: same as DeclarativePage.test.tsx (invoke, i18n identity, toast,
 * ui primitives) plus Modal/Textarea stubs for the result dialog.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import DeclarativePage from '@/components/plugin-ui/DeclarativePage';
import type { PluginPageSchema } from '@/components/plugin-ui/schema';
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

function buttonSchema(
  button: Partial<Extract<PluginPageSchema['nodes'][number], { kind: 'button' }>> & {
    id: string;
    label: string;
    command: string;
  },
): PluginPageSchema {
  return { nodes: [{ kind: 'button', ...button }] };
}

function countCalls(cmd: string): number {
  return (safeInvoke as jest.Mock).mock.calls.filter(([c]) => c === cmd).length;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('DeclarativePage v2.1 renderer feedback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (safeInvoke as jest.Mock).mockResolvedValue(null);
  });

  it('(a) successful command surfaces the pluginUi.actionSucceeded toast', async () => {
    (safeInvoke as jest.Mock).mockResolvedValue({ accepted: true, actionId: 'a1' });
    render(
      <DeclarativePage
        pluginId="test"
        schema={buttonSchema({ id: 'go', label: 'Go', command: 'go' })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Go'));
    });

    expect(safeInvoke).toHaveBeenCalledWith('plugin.test.go', undefined);
    await waitFor(() => {
      expect(appToast.success).toHaveBeenCalledWith('pluginUi.actionSucceeded');
    });
    expect(appToast.error).not.toHaveBeenCalled();
  });

  it('(b) business error {success:false,error} surfaces the error text', async () => {
    (safeInvoke as jest.Mock).mockResolvedValue({ success: false, error: 'boom' });
    render(
      <DeclarativePage
        pluginId="test"
        schema={buttonSchema({ id: 'go', label: 'Go', command: 'go' })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Go'));
    });

    await waitFor(() => {
      expect(appToast.error).toHaveBeenCalledWith('boom');
    });
    expect(appToast.success).not.toHaveBeenCalled();
  });

  it('(c) business error {accepted:false,reason} surfaces the reason text', async () => {
    (safeInvoke as jest.Mock).mockResolvedValue({ accepted: false, reason: 'queue full' });
    render(
      <DeclarativePage
        pluginId="test"
        schema={buttonSchema({ id: 'go', label: 'Go', command: 'go' })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Go'));
    });

    await waitFor(() => {
      expect(appToast.error).toHaveBeenCalledWith('queue full');
    });
    expect(appToast.success).not.toHaveBeenCalled();
  });

  it('(d) business error without text falls back to pluginUi.actionFailed', async () => {
    (safeInvoke as jest.Mock).mockResolvedValue({ success: false });
    render(
      <DeclarativePage
        pluginId="test"
        schema={buttonSchema({ id: 'go', label: 'Go', command: 'go' })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Go'));
    });

    await waitFor(() => {
      expect(appToast.error).toHaveBeenCalledWith('pluginUi.actionFailed');
    });
  });

  it('(e) success payload string fields render in a copyable dialog', async () => {
    const writeText = jest.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    (safeInvoke as jest.Mock).mockResolvedValue({
      accepted: true,
      actionId: 'a1',
      chatBlock: 'tok_abc123',
    });
    render(
      <DeclarativePage
        pluginId="test"
        schema={buttonSchema({ id: 'issue', label: 'Issue', command: 'issue_tokens' })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Issue'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('ui-modal')).toBeTruthy();
    });
    // Only the content field renders — envelope keys stay out of the dialog.
    const fields = screen.getAllByTestId(/^command-result-/);
    expect(fields).toHaveLength(1);
    expect(screen.getByTestId('command-result-chatBlock')).toBeTruthy();
    expect((screen.getByTestId('command-result-chatBlock') as HTMLTextAreaElement).value).toBe(
      'tok_abc123',
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('copy-chatBlock'));
    });
    expect(writeText).toHaveBeenCalledWith('tok_abc123');

    // The dialog closes.
    fireEvent.click(screen.getByTestId('ui-modal-close'));
    expect(screen.queryByTestId('ui-modal')).toBeNull();
  });

  it('(n) a legit "reason" data field survives next to a success envelope', async () => {
    (safeInvoke as jest.Mock).mockResolvedValue({
      success: true,
      reason: 'quota_exceeded',
      chatBlock: 'tok_abc123',
    });
    render(
      <DeclarativePage
        pluginId="test"
        schema={buttonSchema({ id: 'issue', label: 'Issue', command: 'issue_tokens' })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Issue'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('command-result-reason')).toBeTruthy();
    });
    expect(
      (screen.getByTestId('command-result-reason') as HTMLTextAreaElement).value,
    ).toBe('quota_exceeded');
    expect(screen.getByTestId('command-result-chatBlock')).toBeTruthy();
    expect(screen.queryByTestId('command-result-success')).toBeNull();
  });

  it('(o) the deferred-action envelope still strips accepted/actionId/reason', async () => {
    (safeInvoke as jest.Mock).mockResolvedValue({
      accepted: true,
      actionId: 'a1',
      reason: 'queued',
      chatBlock: 'tok_abc123',
    });
    render(
      <DeclarativePage
        pluginId="test"
        schema={buttonSchema({ id: 'issue', label: 'Issue', command: 'issue_tokens' })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Issue'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('command-result-chatBlock')).toBeTruthy();
    });
    expect(screen.queryByTestId('command-result-reason')).toBeNull();
    expect(screen.queryByTestId('command-result-accepted')).toBeNull();
    expect(screen.queryByTestId('command-result-actionId')).toBeNull();
  });

  it('(f) button.confirm prompts with the resolved string; decline aborts, accept invokes', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockImplementation(() => false);
    try {
      render(
        <DeclarativePage
          pluginId="test"
          schema={buttonSchema({
            id: 'restart',
            label: 'Restart',
            command: 'restart',
            confirm: 'test.confirm.restart',
          })}
        />,
      );

      await act(async () => {
        fireEvent.click(screen.getByText('Restart'));
      });

      expect(confirmSpy).toHaveBeenCalledWith('Restart');
      expect(safeInvoke).not.toHaveBeenCalled();

      confirmSpy.mockImplementation(() => true);
      await act(async () => {
        fireEvent.click(screen.getByText('Restart'));
      });
      expect(safeInvoke).toHaveBeenCalledWith('plugin.test.restart', undefined);
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('(g) danger page button without confirm falls back to the confirmRowAction prompt', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockImplementation(() => false);
    try {
      render(
        <DeclarativePage
          pluginId="test"
          schema={buttonSchema({
            id: 'wipe',
            label: 'Wipe',
            command: 'wipe',
            variant: 'danger',
          })}
        />,
      );

      await act(async () => {
        fireEvent.click(screen.getByText('Wipe'));
      });

      expect(confirmSpy).toHaveBeenCalledWith('pluginUi.confirmRowAction');
      expect(safeInvoke).not.toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('(h) refreshOnSuccess bumps the named nodes and ignores unknown ids', async () => {
    (safeInvoke as jest.Mock).mockImplementation((cmd: unknown) => {
      if (cmd === 'plugin.test.list_tbl') {
        return Promise.resolve([{ name: 'row' }]);
      }
      return Promise.resolve({ accepted: true });
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
          kind: 'button',
          id: 'act',
          label: 'Act',
          command: 'act',
          refreshOnSuccess: ['tbl', 'nope'],
        },
      ],
    };

    render(<DeclarativePage pluginId="test" schema={schema} />);

    await waitFor(() => {
      expect(screen.getByText('row')).toBeTruthy();
    });
    expect(countCalls('plugin.test.list_tbl')).toBe(1);

    await act(async () => {
      fireEvent.click(screen.getByText('Act'));
    });

    await waitFor(() => {
      expect(countCalls('plugin.test.list_tbl')).toBe(2);
    });
  });

  describe('source.refreshMs polling', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      (safeInvoke as jest.Mock).mockResolvedValue([{ name: 'row' }]);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    const pollSchema = (refreshMs: number): PluginPageSchema => ({
      nodes: [
        {
          kind: 'table',
          id: 'poll',
          columns: [{ key: 'name', label: 'Name' }],
          source: { command: 'list_poll', refreshMs },
        },
      ],
    });

    it('(i) refetches on the interval and stops after unmount', async () => {
      const view = render(<DeclarativePage pluginId="test" schema={pollSchema(5000)} />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(countCalls('plugin.test.list_poll')).toBe(1);

      await act(async () => {
        jest.advanceTimersByTime(5000);
        await Promise.resolve();
      });
      expect(countCalls('plugin.test.list_poll')).toBe(2);

      await act(async () => {
        jest.advanceTimersByTime(5000);
        await Promise.resolve();
      });
      expect(countCalls('plugin.test.list_poll')).toBe(3);

      view.unmount();
      await act(async () => {
        jest.advanceTimersByTime(15000);
        await Promise.resolve();
      });
      expect(countCalls('plugin.test.list_poll')).toBe(3);
    });

    it('(j) intervals below the 2000ms floor are capped', async () => {
      render(<DeclarativePage pluginId="test" schema={pollSchema(100)} />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(countCalls('plugin.test.list_poll')).toBe(1);

      await act(async () => {
        jest.advanceTimersByTime(1900);
        await Promise.resolve();
      });
      expect(countCalls('plugin.test.list_poll')).toBe(1);

      await act(async () => {
        jest.advanceTimersByTime(100);
        await Promise.resolve();
      });
      expect(countCalls('plugin.test.list_poll')).toBe(2);
    });
  });

  it('(k) empty tables/grids/markdown render the resolved empty key', async () => {
    (safeInvoke as jest.Mock).mockResolvedValue([]);
    const tableSchema: PluginPageSchema = {
      nodes: [
        {
          kind: 'table',
          id: 'tbl',
          columns: [{ key: 'name', label: 'Name' }],
          source: { command: 'list_tbl' },
          empty: 'test.no.rows',
        },
      ],
    };
    const first = render(<DeclarativePage pluginId="test" schema={tableSchema} />);
    await waitFor(() => {
      expect(screen.getByText('Rows')).toBeTruthy();
    });
    expect(screen.queryByText('—')).toBeNull();
    first.unmount();

    (safeInvoke as jest.Mock).mockResolvedValue(null);
    const gridSchema: PluginPageSchema = {
      nodes: [
        {
          kind: 'card_grid',
          id: 'grid',
          source: { command: 'list_grid' },
          card: { title: 'name' },
          empty: 'test.no.cards',
        },
      ],
    };
    const second = render(<DeclarativePage pluginId="test" schema={gridSchema} />);
    await waitFor(() => {
      expect(screen.getByText('Cards')).toBeTruthy();
    });
    second.unmount();

    const mdSchema: PluginPageSchema = {
      nodes: [
        {
          kind: 'markdown',
          id: 'md',
          source: { command: 'get_md' },
          empty: 'test.no.text',
        },
      ],
    };
    render(<DeclarativePage pluginId="test" schema={mdSchema} />);
    await waitFor(() => {
      expect(screen.getByText('Text')).toBeTruthy();
    });
  });

  it('(l) card tone renders a colored dot and border; hint renders a line', async () => {
    (safeInvoke as jest.Mock).mockResolvedValue([
      { name: 'Alpha', status: 'ok' },
      { name: 'Beta', status: 'down' },
      { name: 'Gamma', status: 'weird' },
    ]);
    const schema: PluginPageSchema = {
      nodes: [
        {
          kind: 'card_grid',
          id: 'vitals',
          source: { command: 'overview' },
          card: { title: 'name', tone: 'status', hint: 'test.hint.key' },
        },
      ],
    };

    const { container } = render(<DeclarativePage pluginId="test" schema={schema} />);

    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeTruthy();
    });

    const okDot = container.querySelector('[data-tone="ok"]');
    expect(okDot).toBeTruthy();
    expect(okDot?.className).toContain('bg-emerald-400');
    const downDot = container.querySelector('[data-tone="down"]');
    expect(downDot).toBeTruthy();
    expect(downDot?.className).toContain('bg-red-400');
    // Unknown tone values render no dot (neutral default).
    expect(container.querySelector('[data-tone="weird"]')).toBeNull();

    // Tone border applied to the ok/down cards, not the neutral one.
    const cards = screen.getAllByTestId('ui-glass-card');
    expect(cards[0].className).toContain('border-emerald-500/40');
    expect(cards[1].className).toContain('border-red-500/40');
    expect(cards[2].className).not.toContain('border-emerald-500/40');

    // Hint resolves through the label machinery on every card.
    expect(screen.getAllByText('Key')).toHaveLength(3);
  });

  it('(m) toggle field with a source binding renders a switch bound to the source value', async () => {
    (safeInvoke as jest.Mock).mockResolvedValue({ up: true });
    const schema: PluginPageSchema = {
      nodes: [
        {
          kind: 'field',
          field: 'toggle',
          id: 'ingress',
          label: 'Ingress',
          source: { command: 'ingress_status' },
          valueKey: 'up',
        },
      ],
    };

    render(<DeclarativePage pluginId="test" schema={schema} />);

    await waitFor(() => {
      expect(safeInvoke).toHaveBeenCalledWith('plugin.test.ingress_status', undefined);
    });
    await waitFor(() => {
      expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    });
  });
});
