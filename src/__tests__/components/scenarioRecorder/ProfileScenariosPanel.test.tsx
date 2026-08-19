/**
 * ProfileScenariosPanel lock popover tests.
 *
 * Verifies:
 *   - Locked items render a TierBadge with the required tier.
 *   - The "How to get" button is present on locked items.
 *   - Clicking the button opens a modal with how-to-get instructions.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileScenariosPanel } from '../../../components/scenarioRecorder/ProfileScenariosPanel';
import type { ScenarioRecordItem } from '../../../lib/backend/modules/pythonJobs';

// Mock the app store so language is set and t() resolves.
jest.mock('../../../stores/app', () => ({
  useAppStore: (selector?: (s: { language: string }) => unknown) =>
    selector ? selector({ language: 'en' }) : { language: 'en' },
}));

// Mock sonner.
jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

// Mock the invoke module.
jest.mock('../../../lib/backend/core/invoke', () => ({
  setAuthExpiredHandler: jest.fn(),
  safeInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

// Mock the auth backend module.
jest.mock('../../../lib/backend/modules/auth', () => ({
  getAuthStatus: jest.fn(),
  getCurrentUser: jest.fn(),
  loginUser: jest.fn(),
  loginTelegram: jest.fn(),
  logoutUser: jest.fn(),
  setupUser: jest.fn(),
  setLoginPolicy: jest.fn(),
}));

// Mock the auth store.
jest.mock('../../../stores/auth', () => ({
  useAuthStore: (selector?: (s: { user: { role: string; id: number; username: string } | null }) => unknown) => {
    const state = { user: { role: 'admin', id: 1, username: 'admin' } };
    return selector ? selector(state) : state;
  },
  // Mirror of the real helper: preview_role ?? role (null without a user).
  effectiveRole: (user: { preview_role?: string | null; role: string } | null) =>
    user ? (user.preview_role ?? user.role) : null,
}));

// Mock the UI preferences store.
jest.mock('../../../stores/uiPreferences', () => ({
  useUIPreferencesStore: (selector?: (s: { scenariosPage: { viewMode: string }; setScenariosViewMode: (v: string) => void }) => unknown) => {
    const state = {
      scenariosPage: { viewMode: 'cards' },
      setScenariosViewMode: jest.fn(),
    };
    return selector ? selector(state) : state;
  },
}));

// Mock the backend modules.
jest.mock('../../../lib/backend/modules/pythonJobs', () => ({
  listRecordedScenarios: jest.fn(),
  reindexRecordedScenarios: jest.fn(),
  deleteRecordedScenario: jest.fn(),
  setRecordedScenarioFavorite: jest.fn(),
  setRecordedScenarioTier: jest.fn(),
  updateRecordedScenario: jest.fn(),
  duplicateRecordedScenario: jest.fn(),
  listScenarioRevisions: jest.fn(),
  rollbackRecordedScenario: jest.fn(),
}));

jest.mock('../../../lib/backend/modules/utils', () => ({
  openInFileManager: jest.fn(),
  copyToClipboard: jest.fn(),
}));

function makeLockedItem(): ScenarioRecordItem {
  return {
    id: 'locked-1',
    alias: 'test',
    name: 'Locked Scenario',
    scenarioPath: 'scenario://locked',
    runId: null,
    startedUrl: null,
    stepsCount: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastPlayedAt: null,
    playCount: 0,
    favorite: false,
    healthScore: 80,
    missing: false,
    metadata: null,
    activeVersion: undefined,
    locked: true,
    min_role: 'premium',
  } as ScenarioRecordItem;
}

describe('ProfileScenariosPanel lock popover', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders TierBadge and how-to-get button for locked items', async () => {
    const { listRecordedScenarios } = require('../../../lib/backend/modules/pythonJobs');
    listRecordedScenarios.mockResolvedValue([makeLockedItem()]);

    render(
      <ProfileScenariosPanel
        alias="test"
        isOpen={true}
        onClose={() => {}}
        onRecord={() => {}}
        onReplay={() => {}}
        variant="panel"
      />
    );

    // Wait for items to load.
    await waitFor(() => {
      expect(screen.getByText('Locked Scenario')).toBeTruthy();
    });

    // TierBadge renders the tier name (auth.role.premium = "Premium").
    expect(screen.getByText('Premium')).toBeTruthy();

    // The how-to-get button should be present (aria-label contains "How to get").
    const howToBtn = screen.getByRole('button', { name: /how to get/i });
    expect(howToBtn).toBeTruthy();
  });

  it('opens modal with instructions when how-to-get button is clicked', async () => {
    const user = userEvent.setup();
    const { listRecordedScenarios } = require('../../../lib/backend/modules/pythonJobs');
    listRecordedScenarios.mockResolvedValue([makeLockedItem()]);

    render(
      <ProfileScenariosPanel
        alias="test"
        isOpen={true}
        onClose={() => {}}
        onRecord={() => {}}
        onReplay={() => {}}
        variant="panel"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Locked Scenario')).toBeTruthy();
    });

    // Click the how-to-get button.
    const howToBtn = screen.getByRole('button', { name: /how to get/i });
    await user.click(howToBtn);

    // Modal should show the subscribe instruction.
    await waitFor(() => {
      expect(screen.getByText('Subscribe to channel(s) and log in again')).toBeTruthy();
    });
    // And the ask-admin instruction.
    expect(screen.getByText('Ask an administrator to raise your role')).toBeTruthy();
  });
});
