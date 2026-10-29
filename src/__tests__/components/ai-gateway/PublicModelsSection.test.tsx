import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

jest.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('@/components/ui', () => ({
  Button: ({ children, onClick, ...rest }: any) => (
    <button type="button" onClick={onClick} {...rest}>{children}</button>
  ),
  ButtonBase: ({ children, onClick, ...rest }: any) => (
    <button type="button" onClick={onClick} {...rest}>{children}</button>
  ),
  EmptyState: ({ title, description, action }: any) => (
    <div>
      <p>{title}</p>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  ),
  askConfirm: jest.fn(async () => true),
}));

jest.mock('@/components/ai-gateway/PublicModelForm', () => ({
  PublicModelForm: ({ open }: any) => (open ? <div data-testid="public-model-form" /> : null),
}));

jest.mock('@/components/ai-gateway/RouteTargetForm', () => ({
  RouteTargetForm: ({ open }: any) => (open ? <div data-testid="route-target-form" /> : null),
}));

const storeState: any = {
  publicModels: [],
  upstreamModels: [],
  endpoints: [],
  loading: { publicModels: false },
  errors: { publicModels: null },
  fetchPublicModels: jest.fn(async () => undefined),
  fetchUpstreamModels: jest.fn(async () => undefined),
  fetchEndpoints: jest.fn(async () => undefined),
  deletePublicModel: jest.fn(async () => undefined),
  deleteRouteTarget: jest.fn(async () => undefined),
};

jest.mock('@/stores/aiGateway', () => ({
  useAiGatewayStore: () => storeState,
}));

jest.mock('@/lib/backend/modules/aiGateway', () => ({
  listRouteTargetsForPublicModel: jest.fn(async () => []),
}));

import { PublicModelsSection } from '@/components/ai-gateway/PublicModelsSection';
import { askConfirm } from '@/components/ui';
import { listRouteTargetsForPublicModel } from '@/lib/backend/modules/aiGateway';
import type { PublicModel, RouteTarget, UpstreamModel, ProviderEndpoint } from '@/lib/backend/modules/aiGateway';

const publicModel: PublicModel = {
  id: 'gpt-4o-mini',
  displayName: 'GPT-4o Mini',
  enabled: true,
  contract: null,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: null,
};

const endpoint: ProviderEndpoint = {
  id: 'ep-1',
  name: 'OpenAI',
  adapterType: 'openai_compatible',
  baseUrl: 'https://api.openai.com/v1',
  enabled: true,
  circuitState: 'closed',
  createdAt: '2024-01-01T00:00:00Z',
};

const upstream: UpstreamModel = {
  id: 'up-1',
  providerEndpointId: 'ep-1',
  upstreamModelId: 'gpt-4o-mini-2024',
  displayName: 'GPT-4o Mini (2024)',
  enabled: true,
  discoverySource: 'manual',
  lastDiscoveredAt: null,
  capabilities: null,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: null,
};

function makeTarget(overrides: Partial<RouteTarget>): RouteTarget {
  return {
    id: overrides.id ?? 1,
    publicModelId: 'gpt-4o-mini',
    upstreamModelId: overrides.upstreamModelId ?? 'up-1',
    enabled: overrides.enabled ?? true,
    priority: overrides.priority ?? 10,
    weight: overrides.weight ?? 1,
    costModifier: overrides.costModifier ?? 1,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: null,
  };
}

const listTargets = listRouteTargetsForPublicModel as jest.MockedFunction<typeof listRouteTargetsForPublicModel>;

describe('PublicModelsSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storeState.publicModels = [];
    storeState.upstreamModels = [];
    storeState.endpoints = [];
    storeState.loading = { publicModels: false };
    storeState.errors = { publicModels: null };
    listTargets.mockResolvedValue([]);
  });

  it('renders a public model row with its route count', async () => {
    storeState.publicModels = [publicModel];
    listTargets.mockResolvedValue([makeTarget({ id: 1 }), makeTarget({ id: 2, priority: 20 })]);

    render(<PublicModelsSection />);

    expect(await screen.findByText('gpt-4o-mini')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('aiGateway.list.routesCount')).toBeTruthy());
  });

  it('shows route rows with provider and upstream names when expanded', async () => {
    storeState.publicModels = [publicModel];
    storeState.upstreamModels = [upstream];
    storeState.endpoints = [endpoint];
    listTargets.mockResolvedValue([makeTarget({ id: 1, priority: 10, weight: 2 })]);

    render(<PublicModelsSection />);

    fireEvent.click(await screen.findByRole('button', { name: /gpt-4o-mini/ }));

    expect(await screen.findByText('OpenAI / gpt-4o-mini-2024 (GPT-4o Mini (2024))')).toBeTruthy();
    expect(screen.getByText('aiGateway.list.priorityWeight')).toBeTruthy();
  });

  it('shows the empty state explaining the concept when there are no public models', async () => {
    render(<PublicModelsSection />);

    expect(await screen.findByText('aiGateway.list.noPublicModels')).toBeTruthy();
    expect(screen.getByText('aiGateway.list.noPublicModelsDesc')).toBeTruthy();
  });

  it('deletes a public model after confirmation', async () => {
    storeState.publicModels = [publicModel];

    render(<PublicModelsSection />);

    fireEvent.click(await screen.findByRole('button', { name: 'common.delete' }));

    await waitFor(() => expect(askConfirm).toHaveBeenCalled());
    await waitFor(() => expect(storeState.deletePublicModel).toHaveBeenCalledWith('gpt-4o-mini'));
  });

  it('deletes a route target after confirmation when expanded', async () => {
    storeState.publicModels = [publicModel];
    storeState.upstreamModels = [upstream];
    storeState.endpoints = [endpoint];
    listTargets.mockResolvedValue([makeTarget({ id: 7 })]);

    render(<PublicModelsSection />);

    fireEvent.click(await screen.findByRole('button', { name: /gpt-4o-mini/ }));
    await screen.findByText('OpenAI / gpt-4o-mini-2024 (GPT-4o Mini (2024))');

    const deleteButtons = screen.getAllByRole('button', { name: 'common.delete' });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);

    await waitFor(() => expect(storeState.deleteRouteTarget).toHaveBeenCalledWith(7));
  });

  it('opens the route target form for the expanded model', async () => {
    storeState.publicModels = [publicModel];

    render(<PublicModelsSection />);

    fireEvent.click(await screen.findByRole('button', { name: /gpt-4o-mini/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'aiGateway.form.addRoute' }));

    expect(await screen.findByTestId('route-target-form')).toBeTruthy();
  });
});
