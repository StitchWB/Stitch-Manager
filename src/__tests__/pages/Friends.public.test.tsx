/**
 * Friends page public-surface test.
 *
 * The partner-channel admin CRUD moved to the admin-only /partners page;
 * /friends stays public and must render ONLY the catalog (+ MyChannelPanel
 * for owners). This test renders Friends with a logged-out session and
 * asserts no admin CRUD surface appears.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Friends from '../../pages/Friends';

jest.mock('../../components/layout/Header', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div data-testid="header">{title}</div>,
}));

jest.mock('../../stores/app', () => ({
  useAppStore: (selector?: (s: { language: string }) => unknown) =>
    selector ? selector({ language: 'en' }) : { language: 'en' },
}));

const fetchFriends = jest.fn(() => Promise.resolve());

jest.mock('../../stores/friends', () => ({
  useFriendsStore: (selector: (s: unknown) => unknown) =>
    selector({
      friends: [],
      friendsLoading: false,
      friendsError: null,
      fetchFriends: () => fetchFriends(),
    }),
}));

jest.mock('../../stores/auth', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: null }),
}));

const getMyPartnerChannel = jest.fn(() => Promise.resolve(null));

jest.mock('../../lib/backend/modules/partners', () => ({
  getMyPartnerChannel: () => getMyPartnerChannel(),
}));

describe('Friends page (public)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the catalog without any partner admin CRUD when logged out', () => {
    render(
      <MemoryRouter>
        <Friends />
      </MemoryRouter>
    );

    expect(screen.getByTestId('header')).toBeTruthy();
    expect(screen.getByText('No friends yet')).toBeTruthy();

    expect(screen.queryByText('Add channel')).toBeNull();
    expect(screen.queryByText('Partner channels')).toBeNull();
    expect(screen.queryByLabelText('Delete')).toBeNull();
    expect(screen.queryByLabelText('Edit')).toBeNull();
    expect(fetchFriends).toHaveBeenCalledTimes(1);
    expect(getMyPartnerChannel).not.toHaveBeenCalled();
  });
});
