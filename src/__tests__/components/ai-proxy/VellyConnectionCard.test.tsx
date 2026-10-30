import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { VellyConnectionCard } from '../../../components/ai-proxy/VellyConnectionCard';
import { getAvailableModelsSafe, getLocalChatToken } from '../../../lib/backend/modules/aiProxy';

jest.mock('../../../lib/backend/modules/aiProxy', () => ({
  getAvailableModelsSafe: jest.fn(),
  getLocalChatToken: jest.fn(),
}));

const models = getAvailableModelsSafe as jest.MockedFunction<typeof getAvailableModelsSafe>;
const token = getLocalChatToken as jest.MockedFunction<typeof getLocalChatToken>;

describe('Velly Gateway connection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    models.mockResolvedValue([
      { id: 'velly/anthropic/sonnet', provider: 'velly', ownedBy: 'velly', source: 'aiProxy' },
    ]);
    token.mockResolvedValue('local-install-test-secret');
  });

  it('shows the backend endpoint without the legacy proxy and copies its real credential on request', async () => {
    const writeText = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<MemoryRouter><VellyConnectionCard /></MemoryRouter>);
    expect(await screen.findByDisplayValue(`${window.location.origin}/v1`)).toBeTruthy();
    expect(token).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Copy Gateway key' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('local-install-test-secret'));
    expect(screen.queryByText('local-install-test-secret')).toBeNull();
    expect(screen.queryByDisplayValue('local-install-test-secret')).toBeNull();
  });

  it('does not advertise a Velly connection when no models have been registered', async () => {
    models.mockResolvedValue([]);
    const { container } = render(<MemoryRouter><VellyConnectionCard /></MemoryRouter>);
    await waitFor(() => expect(models).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    expect(token).not.toHaveBeenCalled();
  });
});
