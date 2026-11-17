import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('@/lib/i18n', () => ({
  t: (key: string, params?: Record<string, string | number>) => {
    if (params && typeof params === 'object') {
      return `${key}:${JSON.stringify(params)}`;
    }
    return key;
  },
}));

const mockCreatePublicModel = jest.fn();
const mockCreateRouteTarget = jest.fn();
const mockUpdateUpstreamModel = jest.fn();
const mockUpdatePublicModel = jest.fn();
const mockDeletePublicModel = jest.fn();
const mockProbeEndpointModels = jest.fn();
const mockListUpstreamModelsPage = jest.fn();
const mockListModelHealth = jest.fn();
const mockAskConfirm = jest.fn();

const storeState = {
  upstreamModels: [],
  createPublicModel: mockCreatePublicModel,
  createRouteTarget: mockCreateRouteTarget,
  updateUpstreamModel: mockUpdateUpstreamModel,
  updatePublicModel: mockUpdatePublicModel,
  deletePublicModel: mockDeletePublicModel,
};

jest.mock('@/stores/aiGateway', () => ({
  useAiGatewayStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}));

jest.mock('@/lib/backend/modules/aiGateway', () => {
  const actual = jest.requireActual('@/lib/backend/modules/aiGateway') as object;
  return {
    ...actual,
    probeEndpointModels: (...args: unknown[]) => mockProbeEndpointModels(...args),
    listUpstreamModelsPage: (...args: unknown[]) => mockListUpstreamModelsPage(...args),
    listModelHealth: (...args: unknown[]) => mockListModelHealth(...args),
  };
});

jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@/components/ui', () => ({
  askConfirm: (...args: unknown[]) => mockAskConfirm(...args),
  Badge: ({ children, title }: { children?: React.ReactNode; title?: string }) => (
    <span title={title}>{children}</span>
  ),
  Button: ({ children, onClick, disabled, leftIcon: _leftIcon, rightIcon: _rightIcon, ...rest }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <button type="button" onClick={onClick as () => void} disabled={disabled as boolean} {...rest}>
      {children}
    </button>
  ),
  ButtonBase: ({ children, onClick, ...rest }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <button type="button" onClick={onClick as () => void} {...rest}>
      {children}
    </button>
  ),
  Checkbox: ({ checked, onChange, disabled, 'aria-label': ariaLabel }: Record<string, unknown>) => (
    <input
      type="checkbox"
      aria-label={ariaLabel as string}
      checked={!!checked}
      disabled={disabled as boolean}
      onChange={onChange as (e: React.ChangeEvent<HTMLInputElement>) => void}
    />
  ),
  EmptyState: ({ title }: { title?: string }) => <div>{title}</div>,
  FilterDropdown: ({ value, onChange, options, placeholder }: Record<string, unknown>) => (
    <select
      aria-label={(placeholder as string) ?? 'filterDropdown'}
      value={value as string}
      onChange={e => (onChange as (v: string) => void)(e.target.value)}
    >
      {(options as Array<{ value: string; label: string }>).map(opt => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  ),
  Input: ({ value, onChange, placeholder, 'aria-label': ariaLabel }: Record<string, unknown>) => (
    <input
      value={value as string}
      onChange={onChange as (e: React.ChangeEvent<HTMLInputElement>) => void}
      placeholder={placeholder as string}
      aria-label={ariaLabel as string}
    />
  ),
  OverflowMenu: ({ items, triggerLabel }: Record<string, unknown>) => (
    <div>
      <button type="button" aria-label={triggerLabel as string}>{triggerLabel as string}</button>
      {(items as Array<{ id: string; label: string; onSelect: () => void }>).map(item => (
        <button key={item.id} type="button" role="menuitem" onClick={item.onSelect}>{item.label}</button>
      ))}
    </div>
  ),
  SegmentedControl: ({ options, value, onChange }: Record<string, unknown>) => (
    <div>
      {(options as Array<{ value: string; label: string }>).map(opt => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={opt.value === value}
          onClick={() => (onChange as (v: string) => void)(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  ),
  SkeletonLoader: () => <div />,
  Table: ({ children }: { children?: React.ReactNode }) => <table><tbody>{children}</tbody></table>,
  TableBody: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  TableCell: ({ children }: { children?: React.ReactNode }) => <td>{children}</td>,
  TableHead: ({ children }: { children?: React.ReactNode }) => <th>{children}</th>,
  TableHeader: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  TableRow: ({ children }: { children?: React.ReactNode }) => <tr>{children}</tr>,
  Toggle: ({ checked, onChange, disabled, ariaLabel, tooltip }: Record<string, unknown>) => (
    <input
      type="checkbox"
      role="switch"
      aria-label={ariaLabel as string}
      title={tooltip as string}
      checked={!!checked}
      disabled={disabled as boolean}
      onChange={e => (onChange as (v: boolean) => void)(e.target.checked)}
    />
  ),
  Tooltip: ({ children, content }: { children?: React.ReactNode; content?: React.ReactNode }) => (
    <span title={typeof content === 'string' ? content : undefined}>{children}</span>
  ),
}));

import { ProviderModelsPanel } from '@/components/ai-hub/providers/ProviderModelsPanel';
import type { UpstreamModel } from '@/lib/backend/modules/aiGateway';

const model: UpstreamModel = {
  id: 'up-1',
  providerEndpointId: 'ep-1',
  upstreamModelId: 'gpt-4o-mini-2024',
  displayName: 'GPT-4o Mini',
  enabled: true,
  discoverySource: 'manual',
  lastDiscoveredAt: null,
  capabilities: null,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: null,
};

const model2: UpstreamModel = {
  id: 'up-2',
  providerEndpointId: 'ep-1',
  upstreamModelId: 'flux-image',
  displayName: 'Flux Image',
  enabled: true,
  discoverySource: 'probe',
  lastDiscoveredAt: null,
  capabilities: { model_class: 'image', vendor: 'black-forest' },
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: null,
};

function mockPage(models: UpstreamModel[]) {
  mockListUpstreamModelsPage.mockResolvedValue({ models, total: models.length });
  mockListModelHealth.mockResolvedValue({ total: 0, count: 0, models: [] });
}

function renderPanel(extra: Record<string, unknown> = {}) {
  return render(
    <ProviderModelsPanel
      endpointId="ep-1"
      busy={false}
      discovering={false}
      onDiscover={jest.fn()}
      {...extra}
    />,
  );
}

describe('ProviderModelsPanel publish state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAskConfirm.mockResolvedValue(true);
    mockPage([model]);
  });

  it('calls onExposeModel with the row model when Publish is clicked', async () => {
    const onExposeModel = jest.fn();
    renderPanel({ onExposeModel });

    fireEvent.click(await screen.findByRole('button', { name: 'aiHub.providersPage.publishModel' }));

    expect(onExposeModel).toHaveBeenCalledWith(model);
  });

  it('shows the public name and an on switch when published, and unpublishes via updatePublicModel', async () => {
    mockUpdatePublicModel.mockResolvedValue({ id: 'my-model', enabled: false });
    const onPublishedChange = jest.fn();
    renderPanel({
      published: { 'up-1': { publicModelId: 'my-model', enabled: true } },
      onPublishedChange,
    });

    expect(await screen.findByText('my-model')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'aiHub.providersPage.publishModel' })).toBeNull();

    const publishSwitch = screen.getByLabelText(/publishToggleAria/);
    expect((publishSwitch as HTMLInputElement).checked).toBe(true);
    fireEvent.click(publishSwitch);

    await waitFor(() => {
      expect(mockUpdatePublicModel).toHaveBeenCalledWith({ id: 'my-model', enabled: false });
      expect(onPublishedChange).toHaveBeenCalled();
    });
  });

  it('removes the alias through the overflow action after confirmation', async () => {
    mockDeletePublicModel.mockResolvedValue({ success: true });
    const onPublishedChange = jest.fn();
    renderPanel({
      published: { 'up-1': { publicModelId: 'my-model', enabled: true } },
      onPublishedChange,
    });

    fireEvent.click(await screen.findByRole('menuitem', { name: 'aiHub.providersPage.removeAlias' }));

    await waitFor(() => {
      expect(mockAskConfirm).toHaveBeenCalled();
      expect(mockDeletePublicModel).toHaveBeenCalledWith('my-model');
      expect(onPublishedChange).toHaveBeenCalled();
    });
  });

  it('renders no publish action without the callback and without a published entry', async () => {
    renderPanel();

    await screen.findByText('GPT-4o Mini');
    expect(screen.queryByRole('button', { name: 'aiHub.providersPage.publishModel' })).toBeNull();
  });
});

describe('ProviderModelsPanel row toggles and batch actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAskConfirm.mockResolvedValue(true);
    mockPage([model, model2]);
  });

  it('toggles a row enabled state through updateUpstreamModel', async () => {
    mockUpdateUpstreamModel.mockResolvedValue({ ...model, enabled: false });
    renderPanel();

    const toggle = await screen.findByLabelText(/enableToggleAria.*gpt-4o-mini-2024/);
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockUpdateUpstreamModel).toHaveBeenCalledWith({
        id: model.id,
        enabled: false,
        selectionSource: 'manual_deny',
      });
    });
  });

  it('selects all rendered rows and performs batch publish', async () => {
    mockCreatePublicModel.mockResolvedValue({ id: 'pub' });
    mockCreateRouteTarget.mockResolvedValue({ id: 'rt-1' });
    const onPublishedChange = jest.fn();
    renderPanel({ onPublishedChange });

    await screen.findByText('GPT-4o Mini');
    expect(screen.queryByTestId('selection-toolbar')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /classImage/ }));
    fireEvent.click(screen.getByLabelText('aiHub.providersPage.selectAllPage'));
    expect(screen.getByTestId('selection-toolbar')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'aiHub.providersPage.batchPublish' }));

    await waitFor(() => {
      expect(mockCreatePublicModel).toHaveBeenCalledTimes(2);
      expect(mockCreateRouteTarget).toHaveBeenCalledTimes(2);
      expect(onPublishedChange).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('selection-toolbar')).toBeNull();
  });

  it('performs batch disable on selected models', async () => {
    mockUpdateUpstreamModel.mockResolvedValue({ ...model, enabled: false });
    renderPanel();

    fireEvent.click(await screen.findByLabelText(new RegExp(`selectModelAria.*${model.upstreamModelId}`)));
    expect(screen.getByTestId('selection-toolbar')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'aiHub.providersPage.batchDisable' }));

    await waitFor(() => {
      expect(mockUpdateUpstreamModel).toHaveBeenCalledWith({
        id: model.id,
        enabled: false,
        selectionSource: 'manual_deny',
      });
    });
    expect(screen.queryByTestId('selection-toolbar')).toBeNull();
  });

  it('probes selected models and refetches the health registry', async () => {
    mockProbeEndpointModels.mockResolvedValue({
      ok: true,
      models: [{ model: model.upstreamModelId, ok: true, reason: 'ok', latencyMs: 120 }],
    });
    renderPanel();

    fireEvent.click(await screen.findByLabelText(new RegExp(`selectModelAria.*${model.upstreamModelId}`)));
    const healthCallsBefore = mockListModelHealth.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'aiHub.providersPage.batchProbe' }));

    await waitFor(() => {
      expect(mockProbeEndpointModels).toHaveBeenCalledWith(
        expect.objectContaining({
          endpointId: 'ep-1',
          models: [model.upstreamModelId],
        }),
      );
    });
    await waitFor(() => {
      expect(mockListModelHealth.mock.calls.length).toBeGreaterThan(healthCallsBefore);
    });
  });
});

describe('ProviderModelsPanel server query and filters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAskConfirm.mockResolvedValue(true);
    mockPage([model, model2]);
  });

  it('sends the debounced search query to the server', async () => {
    renderPanel();
    await screen.findByText('GPT-4o Mini');

    fireEvent.change(screen.getByLabelText('aiHub.providersPage.searchModels'), {
      target: { value: 'claude' },
    });

    await waitFor(
      () => {
        expect(mockListUpstreamModelsPage).toHaveBeenCalledWith(
          'ep-1',
          expect.objectContaining({ q: 'claude' }),
        );
      },
      { timeout: 2000 },
    );
  });

  it('queries the live segment with a 120 minute window by default', async () => {
    renderPanel();

    await waitFor(() => {
      expect(mockListUpstreamModelsPage).toHaveBeenCalledWith(
        'ep-1',
        expect.objectContaining({ aliveWithinMinutes: 120, orderBy: 'last_seen' }),
      );
    });
  });

  it('drops the alive window when switching to All known', async () => {
    renderPanel();
    await screen.findByText('GPT-4o Mini');

    fireEvent.click(screen.getByRole('button', { name: /segmentAll/ }));

    await waitFor(() => {
      expect(mockListUpstreamModelsPage).toHaveBeenCalledWith(
        'ep-1',
        expect.objectContaining({ aliveWithinMinutes: undefined }),
      );
    });
  });

  it('hides non-chat classes until the class chip is enabled', async () => {
    renderPanel();

    await screen.findByText('GPT-4o Mini');
    expect(screen.queryByText('Flux Image')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /classImage/ }));

    expect(await screen.findByText('Flux Image')).toBeTruthy();
  });

  it('shows a no-match empty state when the server returns nothing for the query', async () => {
    mockListUpstreamModelsPage.mockResolvedValue({ models: [], total: 0 });
    renderPanel();

    fireEvent.change(screen.getByLabelText('aiHub.providersPage.searchModels'), {
      target: { value: 'zzz' },
    });

    await waitFor(
      () => {
        expect(screen.getByText(/modelsNoMatch/)).toBeTruthy();
      },
      { timeout: 2000 },
    );
  });
});