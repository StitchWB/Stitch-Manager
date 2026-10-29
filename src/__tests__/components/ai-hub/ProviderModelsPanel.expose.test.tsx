import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('@/components/ui', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
  Button: ({ children, onClick, ...rest }: any) => (
    <button type="button" onClick={onClick} {...rest}>{children}</button>
  ),
  ButtonBase: ({ children, onClick, ...rest }: any) => (
    <button type="button" onClick={onClick} {...rest}>{children}</button>
  ),
  EmptyState: ({ title }: any) => <div>{title}</div>,
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

describe('ProviderModelsPanel expose action', () => {
  beforeEach(() => jest.clearAllMocks());

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
