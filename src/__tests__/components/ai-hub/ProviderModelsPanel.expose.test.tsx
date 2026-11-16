import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('@/lib/i18n', () => ({
  t: (key: string, params?: any) => {
    if (params && typeof params === 'object') {
      return `${key}:${JSON.stringify(params)}`;
    }
    return key;
  },
}));

const mockCreatePublicModel = jest.fn();
const mockCreateRouteTarget = jest.fn();
const mockUpdateUpstreamModel = jest.fn();
const mockProbeEndpointModels = jest.fn();

jest.mock('@/stores/aiGateway', () => ({
  useAiGatewayStore: (selector: (state: any) => any) =>
    selector({
      createPublicModel: mockCreatePublicModel,
      createRouteTarget: mockCreateRouteTarget,
      updateUpstreamModel: mockUpdateUpstreamModel,
    }),
}));

jest.mock('@/lib/backend/modules/aiGateway', () => {
  const actual = jest.requireActual('@/lib/backend/modules/aiGateway') as any;
  return {
    ...actual,
    probeEndpointModels: (...args: any[]) => mockProbeEndpointModels(...args),
  };
});

jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@/components/ui', () => ({
  Badge: ({ children, title }: any) => <span title={title}>{children}</span>,
  Button: ({ children, onClick, disabled, leftIcon, rightIcon, ...rest }: any) => (
    <button type="button" onClick={onClick} disabled={disabled} {...rest}>{children}</button>
  ),
  ButtonBase: ({ children, onClick, ...rest }: any) => (
    <button type="button" onClick={onClick} {...rest}>{children}</button>
  ),
  Checkbox: ({ checked, onChange, disabled, 'aria-label': ariaLabel }: any) => (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      checked={!!checked}
      disabled={disabled}
      onChange={onChange}
    />
  ),
  EmptyState: ({ title }: any) => <div>{title}</div>,
  Input: ({ value, onChange, placeholder, 'aria-label': ariaLabel }: any) => (
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      aria-label={ariaLabel}
    />
  ),
  SkeletonLoader: () => <div />,
  Table: ({ children }: any) => <table><tbody>{children}</tbody></table>,
  TableBody: ({ children }: any) => <>{children}</>,
  TableCell: ({ children }: any) => <td>{children}</td>,
  TableHead: ({ children }: any) => <th>{children}</th>,
  TableHeader: ({ children }: any) => <>{children}</>,
  TableRow: ({ children }: any) => <tr>{children}</tr>,
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
  upstreamModelId: 'claude-3-5-sonnet',
  displayName: 'Claude 3.5 Sonnet',
  enabled: true,
  discoverySource: 'manual',
  lastDiscoveredAt: null,
  capabilities: null,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: null,
};

describe('ProviderModelsPanel expose action', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls onExposeModel with the row model when "make public" is clicked', () => {
    const onExposeModel = jest.fn();
    render(
      <ProviderModelsPanel
        models={[model]}
        loading={false}
        busy={false}
        discovering={false}
        onDiscover={jest.fn()}
        onExposeModel={onExposeModel}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'aiHub.providersPage.exposeModel' }));

    expect(onExposeModel).toHaveBeenCalledWith(model);
  });

  it('shows the public name badge instead of the expose button when already published', () => {
    const onExposeModel = jest.fn();
    render(
      <ProviderModelsPanel
        models={[model]}
        loading={false}
        busy={false}
        discovering={false}
        onDiscover={jest.fn()}
        onExposeModel={onExposeModel}
        published={{ 'up-1': 'my-model' }}
      />,
    );

    expect(screen.queryByRole('button', { name: 'aiHub.providersPage.exposeModel' })).toBeNull();
    expect(screen.getByText('my-model')).toBeTruthy();
  });

  it('renders no expose action without the callback', () => {
    render(
      <ProviderModelsPanel
        models={[model]}
        loading={false}
        busy={false}
        discovering={false}
        onDiscover={jest.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'aiHub.providersPage.exposeModel' })).toBeNull();
  });
});

describe('ProviderModelsPanel batch actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('selects all visible models and performs batch publish', async () => {
    mockCreatePublicModel.mockResolvedValue({ id: 'gpt-4o-mini-2024' });
    mockCreateRouteTarget.mockResolvedValue({ id: 'rt-1' });
    const onPublishedChange = jest.fn();

    render(
      <ProviderModelsPanel
        endpointId="ep-1"
        models={[model, model2]}
        loading={false}
        busy={false}
        discovering={false}
        onDiscover={jest.fn()}
        onPublishedChange={onPublishedChange}
      />,
    );

    expect(screen.queryByTestId('selection-toolbar')).toBeNull();

    const selectAllCheckbox = screen.getByLabelText('aiHub.providersPage.selectAll');
    fireEvent.click(selectAllCheckbox);

    expect(screen.getByTestId('selection-toolbar')).toBeTruthy();

    const publishBtn = screen.getByRole('button', { name: 'aiHub.providersPage.batchPublish' });
    fireEvent.click(publishBtn);

    await waitFor(() => {
      expect(mockCreatePublicModel).toHaveBeenCalledTimes(2);
      expect(mockCreateRouteTarget).toHaveBeenCalledTimes(2);
      expect(onPublishedChange).toHaveBeenCalled();
    });

    expect(screen.queryByTestId('selection-toolbar')).toBeNull();
  });

  it('performs batch disable on selected models', async () => {
    mockUpdateUpstreamModel.mockResolvedValue({ ...model, enabled: false });

    render(
      <ProviderModelsPanel
        endpointId="ep-1"
        models={[model, model2]}
        loading={false}
        busy={false}
        discovering={false}
        onDiscover={jest.fn()}
      />,
    );

    const rowCheckbox = screen.getByLabelText(`Select ${model.upstreamModelId}`);
    fireEvent.click(rowCheckbox);

    expect(screen.getByTestId('selection-toolbar')).toBeTruthy();

    const disableBtn = screen.getByRole('button', { name: 'aiHub.providersPage.batchDisable' });
    fireEvent.click(disableBtn);

    await waitFor(() => {
      expect(mockUpdateUpstreamModel).toHaveBeenCalledWith({
        id: model.id,
        enabled: false,
        selectionSource: 'manual_deny',
      });
    });

    expect(screen.queryByTestId('selection-toolbar')).toBeNull();
  });

  it('performs batch probe and updates status badge for models', async () => {
    mockProbeEndpointModels.mockResolvedValue({
      ok: true,
      models: [
        { model: model.upstreamModelId, ok: true, reason: 'ok', latencyMs: 120 },
      ],
    });

    render(
      <ProviderModelsPanel
        endpointId="ep-1"
        models={[model]}
        loading={false}
        busy={false}
        discovering={false}
        onDiscover={jest.fn()}
      />,
    );

    const rowCheckbox = screen.getByLabelText(`Select ${model.upstreamModelId}`);
    fireEvent.click(rowCheckbox);

    const probeBtn = screen.getByRole('button', { name: 'aiHub.providersPage.batchProbe' });
    fireEvent.click(probeBtn);

    await waitFor(() => {
      expect(mockProbeEndpointModels).toHaveBeenCalledWith(
        expect.objectContaining({
          endpointId: 'ep-1',
          models: [model.upstreamModelId],
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText('120ms')).toBeTruthy();
    });
  });
});


describe('ProviderModelsPanel model search', () => {
  it('filters rows by id and display name', () => {
    render(<ProviderModelsPanel models={[model, model2]} loading={false} busy={false} />);

    const search = screen.getByLabelText('aiHub.providersPage.searchModels');
    fireEvent.change(search, { target: { value: 'claude' } });

    expect(screen.getByText('claude-3-5-sonnet')).toBeTruthy();
    expect(screen.queryByText('gpt-4o-mini-2024')).toBeNull();
  });

  it('shows a no-match empty state', () => {
    render(<ProviderModelsPanel models={[model]} loading={false} busy={false} />);

    fireEvent.change(screen.getByLabelText('aiHub.providersPage.searchModels'), {
      target: { value: 'zzz' },
    });

    expect(screen.getByText(/modelsNoMatch/)).toBeTruthy();
  });
});
