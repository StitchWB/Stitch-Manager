import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

jest.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('@/components/ui', () => ({
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button type="button" onClick={onClick} disabled={disabled} {...rest}>{children}</button>
  ),
  ButtonBase: ({ children, onClick, ...rest }: any) => (
    <button type="button" onClick={onClick} {...rest}>{children}</button>
  ),
  Input: (props: any) => <input {...props} />,
  Textarea: (props: any) => <textarea {...props} />,
  Select: ({ children, ...props }: any) => <select {...props}>{children}</select>,
  Checkbox: (props: any) => <input type="checkbox" {...props} />,
  Modal: ({ isOpen, title, children, footer }: any) =>
    isOpen ? (
      <div>
        <h2>{title}</h2>
        {children}
        {footer}
      </div>
    ) : null,
}));

const storeState: any = {
  upstreamModels: [],
  endpoints: [],
  fetchUpstreamModels: jest.fn(async () => undefined),
  fetchEndpoints: jest.fn(async () => undefined),
  createPublicModel: jest.fn(async (params: any) => ({
    id: params.id,
    displayName: params.displayName,
    enabled: params.enabled,
    contract: params.contract,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: null,
  })),
  updatePublicModel: jest.fn(async () => null),
  createRouteTarget: jest.fn(async (params: any) => ({ id: 1, ...params })),
};

jest.mock('@/stores/aiGateway', () => ({
  useAiGatewayStore: () => storeState,
}));

import { PublicModelForm } from '@/components/ai-gateway/PublicModelForm';
import type { PublicModel, UpstreamModel, ProviderEndpoint } from '@/lib/backend/modules/aiGateway';

const endpoint: ProviderEndpoint = {
  id: 'ep-1',
  name: 'OpenAI',
  adapterType: 'openai_compatible',
  baseUrl: 'https://api.openai.com/v1',
  enabled: true,
  circuitState: 'closed',
  createdAt: '2024-01-01T00:00:00Z',
};

function makeUpstream(id: string, upstreamModelId: string): UpstreamModel {
  return {
    id,
    providerEndpointId: 'ep-1',
    upstreamModelId,
    displayName: null,
    enabled: true,
    discoverySource: 'manual',
    lastDiscoveredAt: null,
    capabilities: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: null,
  };
}

const existingModel: PublicModel = {
  id: 'gpt-4o-mini',
  displayName: 'GPT-4o Mini',
  enabled: true,
  contract: null,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: null,
};

describe('PublicModelForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storeState.upstreamModels = [makeUpstream('up-1', 'gpt-4o-mini-2024'), makeUpstream('up-2', 'gpt-4o')];
    storeState.endpoints = [endpoint];
  });

  it('creates the public model and one route target per prefilled row', async () => {
    render(<PublicModelForm open onClose={jest.fn()} />);

    fireEvent.change(await screen.findByPlaceholderText('gpt-4o-mini'), {
      target: { value: 'my-model' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'aiGateway.cred.create' }));

    await waitFor(() =>
      expect(storeState.createPublicModel).toHaveBeenCalledWith({
        id: 'my-model',
        displayName: null,
        contract: null,
        enabled: true,
      }),
    );
    await waitFor(() =>
      expect(storeState.createRouteTarget).toHaveBeenCalledWith({
        publicModelId: 'my-model',
        upstreamModelId: 'up-1',
        priority: 100,
        weight: 1,
        costModifier: 1,
        enabled: true,
      }),
    );
  });

  it('prefills name and route from the expose prefill', async () => {
    render(
      <PublicModelForm open onClose={jest.fn()} prefill={{ id: 'gpt-4o', upstreamModelId: 'up-2' }} />,
    );

    const nameInput = await screen.findByPlaceholderText('gpt-4o-mini');
    expect((nameInput as HTMLInputElement).value).toBe('gpt-4o');

    fireEvent.click(screen.getByRole('button', { name: 'aiGateway.cred.create' }));

    await waitFor(() =>
      expect(storeState.createRouteTarget).toHaveBeenCalledWith(
        expect.objectContaining({ publicModelId: 'gpt-4o', upstreamModelId: 'up-2' }),
      ),
    );
  });

  it('updates without creating route targets in edit mode', async () => {
    render(<PublicModelForm model={existingModel} open onClose={jest.fn()} />);

    fireEvent.change(await screen.findByDisplayValue('GPT-4o Mini'), {
      target: { value: 'Renamed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'aiGateway.cred.update' }));

    await waitFor(() =>
      expect(storeState.updatePublicModel).toHaveBeenCalledWith({
        id: 'gpt-4o-mini',
        displayName: 'Renamed',
        contract: null,
        enabled: true,
      }),
    );
    expect(storeState.createRouteTarget).not.toHaveBeenCalled();
  });

  it('keeps the contract JSON hidden behind the advanced toggle', async () => {
    render(<PublicModelForm open onClose={jest.fn()} />);

    await screen.findByPlaceholderText('gpt-4o-mini');
    expect(screen.queryByText('aiGateway.form.contract')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'aiGateway.form.advanced' }));
    expect(await screen.findByText('aiGateway.form.contract')).toBeTruthy();
  });
});
