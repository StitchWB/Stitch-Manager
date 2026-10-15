/**
 * PartnerChannels admin page tests (community_channels_* command module).
 *
 * Verifies:
 *   - Renders rows with logo / name / description from listCommunityChannels.
 *   - Delete flow: click delete → askConfirm → deleteCommunityChannel(id)
 *     → list refreshes.
 *   - Create button opens the form modal and the form has the logo field.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('../../lib/backend/modules/communityChannels', () => ({
  listCommunityChannels: jest.fn(),
  createCommunityChannel: jest.fn(),
  updateCommunityChannel: jest.fn(),
  deleteCommunityChannel: jest.fn(),
}));

jest.mock('../../components/layout/Header', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div data-testid="header">{title}</div>,
}));

jest.mock('../../stores/app', () => ({
  useAppStore: (selector?: (s: { language: string }) => unknown) =>
    selector ? selector({ language: 'en' }) : { language: 'en' },
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

jest.mock('../../components/ui/ConfirmDialogHost', () => ({
  ConfirmDialogHost: () => null,
  askConfirm: jest.fn(() => Promise.resolve(true)),
}));

import PartnerChannels from '../../pages/PartnerChannels';
import {
  listCommunityChannels,
  deleteCommunityChannel,
  type ChannelItem,
} from '../../lib/backend/modules/communityChannels';

const mockList = jest.mocked(listCommunityChannels);
const mockDelete = jest.mocked(deleteCommunityChannel);

function mockChannel(): ChannelItem {
  return {
    id: 'ch-1',
    title: 'Test Community Channel',
    url: 'https://t.me/test',
    description: 'A great community channel',
    logo_url: 'https://example.com/logo.png',
    type: 'telegram',
    badge: 'partner',
    active: true,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <PartnerChannels />
    </MemoryRouter>
  );
}

describe('PartnerChannels page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockList.mockResolvedValue([mockChannel()]);
    mockDelete.mockResolvedValue(undefined);
  });

  it('renders rows with logo, name and description', async () => {
    const { container } = renderPage();

    await waitFor(() => {
      expect(screen.getByText('Test Community Channel')).toBeTruthy();
    });

    expect(mockList).toHaveBeenCalled();
    expect(screen.getByText('A great community channel')).toBeTruthy();
    expect(screen.getByText('https://t.me/test')).toBeTruthy();
    expect(screen.getByText('partner')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://example.com/logo.png');
  });

  it('delete flow calls deleteCommunityChannel(id) and refreshes the list', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Test Community Channel')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Delete'));
    });

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('ch-1');
    });
    await waitFor(() => {
      expect(mockList.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('create button opens the form modal with the logo field', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Test Community Channel')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Add channel'));
    });

    await waitFor(() => {
      expect(screen.getByText('New channel')).toBeTruthy();
    });
    expect(screen.getByLabelText('Logo URL')).toBeTruthy();
  });
});
