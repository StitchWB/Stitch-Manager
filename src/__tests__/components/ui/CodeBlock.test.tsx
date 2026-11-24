import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));

import { toast } from 'sonner';
import { CodeBlock } from '../../../components/ui/CodeBlock';

let writeText: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  writeText = jest.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  jest.useRealTimers();
});

async function flushCopy() {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) {
      await Promise.resolve();
    }
  });
}

describe('CodeBlock', () => {
  it('renders the code content', () => {
    render(<CodeBlock code="npm run dev" />);
    expect(screen.getByText('npm run dev')).toBeTruthy();
  });

  it('renders the label when provided', () => {
    render(<CodeBlock code="ls" label="Bootstrap" />);
    expect(screen.getByText('Bootstrap')).toBeTruthy();
  });

  it('copies the code and swaps to width-stable icon-to-check feedback', async () => {
    render(<CodeBlock code="curl https://example.test/install.sh" />);
    const idle = screen.getByRole('button', { name: 'Copy To Clipboard' });
    expect(idle.className).toContain('w-5');
    expect(idle.querySelector('svg')?.getAttribute('class')).toContain('lucide-copy');

    fireEvent.click(idle);

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('curl https://example.test/install.sh'),
    );
    expect(toast.success).toHaveBeenCalled();

    const copied = await screen.findByRole('button', { name: 'Copied' });
    expect(copied.className).toContain('w-5');
    expect(copied.className).toContain('h-5');
    expect(copied.querySelector('svg')?.getAttribute('class')).toContain('lucide-check');
  });

  it('resets the copied feedback after the default duration', async () => {
    jest.useFakeTimers();
    render(<CodeBlock code="echo hi" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy To Clipboard' }));
    await flushCopy();
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('button', { name: 'Copy To Clipboard' })).toBeTruthy();
  });

  it('wraps long commands by default', () => {
    const { container } = render(<CodeBlock code="a-very-long-command" />);
    const pre = container.querySelector('pre');
    expect(pre?.className).toContain('whitespace-pre-wrap');
    expect(pre?.className).toContain('break-all');
  });

  it('keeps commands on one line when wrap is disabled', () => {
    const { container } = render(<CodeBlock code="a-very-long-command" wrap={false} />);
    const pre = container.querySelector('pre');
    expect(pre?.className).toContain('whitespace-pre');
    expect(pre?.className).not.toContain('whitespace-pre-wrap');
  });

  it('bounds the scroll region with a default max height', () => {
    const { container } = render(<CodeBlock code="line" />);
    const pre = container.querySelector('pre');
    expect(pre?.className).toContain('overflow-auto');
    expect(pre?.style.maxHeight).toBe('256px');
  });

  it('honors a custom max height', () => {
    const { container } = render(<CodeBlock code="line" maxHeight={120} />);
    expect(container.querySelector('pre')?.style.maxHeight).toBe('120px');
  });

  it('hides the copy control when copyable is false', () => {
    render(<CodeBlock code="secret" copyable={false} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps the copy control keyboard accessible and the scroll region focusable', () => {
    const { container } = render(<CodeBlock code="ls -la" />);
    expect(screen.getByRole('button', { name: 'Copy To Clipboard' }).tagName).toBe('BUTTON');
    expect(container.querySelector('pre')?.tabIndex).toBe(0);
  });
});
