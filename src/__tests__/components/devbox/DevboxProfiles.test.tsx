/**
 * Devbox profiles table + editor drawer — profile_get/profile_put binding,
 * invalid JSON gates Save, server R-errors render under the editor.
 *
 * Mocks: safeInvoke (routed by command name), sonner. i18n runs REAL.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

jest.mock('@/lib/backend/core/invoke', () => ({
  safeInvoke: jest.fn(),
  safeInvokeWithRetry: jest.fn(),
  batchInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));

import { safeInvoke } from '@/lib/backend/core/invoke';
import { DevboxProfiles } from '@/components/devbox/DevboxProfiles';
import {
  devboxRouter,
  devboxCalls,
  devboxCallArgs,
  profilesFixture,
  pageRoutes,
} from './devboxTestKit';

const invokeMock = safeInvoke as jest.Mock;

function renderProfiles(onChanged = jest.fn(() => undefined)) {
  render(
    <DevboxProfiles
      profiles={profilesFixture}
      error={null}
      busy={false}
      onRetry={jest.fn(() => undefined)}
      onChanged={onChanged}
    />,
  );
  return onChanged;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Devbox profile editor', () => {
  it('loads profile_get on open and renders server errors with Save disabled', async () => {
    invokeMock.mockImplementation(
      devboxRouter(
        pageRoutes({
          profile_get: { json: '{', valid: false, errors: ['R1: project_dir missing'] },
        }),
      ),
    );
    renderProfiles();

    fireEvent.click(screen.getByTestId('devbox-profile-edit-example-simple'));

    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'profile_get')).toEqual([{ name: 'example-simple' }]);
    });
    expect(await screen.findByText('R1: project_dir missing')).toBeTruthy();
    expect(screen.getByTestId('devbox-profile-save')).toBeDisabled();
  });

  it('blocks Save on invalid JSON and shows the parse error', async () => {
    invokeMock.mockImplementation(
      devboxRouter(
        pageRoutes({
          profile_get: { json: '{"mode": "standard"}', valid: true, errors: [] },
        }),
      ),
    );
    renderProfiles();

    fireEvent.click(screen.getByTestId('devbox-profile-edit-midsai'));
    const editor = (await screen.findByTestId(
      'devbox-profile-editor',
    )) as HTMLTextAreaElement;
    expect(screen.getByTestId('devbox-profile-save')).not.toBeDisabled();

    fireEvent.change(editor, { target: { value: '{"mode": broken' } });

    expect(await screen.findByText('Invalid JSON')).toBeTruthy();
    expect(screen.getByTestId('devbox-profile-save')).toBeDisabled();
    expect(devboxCalls(invokeMock, 'profile_put')).toHaveLength(0);
  });

  it('saves valid JSON via profile_put and closes on success', async () => {
    const onChanged = renderProfilesOnPut({ valid: true, errors: [] });
    const editor = (await screen.findByTestId(
      'devbox-profile-editor',
    )) as HTMLTextAreaElement;

    fireEvent.change(editor, { target: { value: '{"mode": "full"}' } });
    fireEvent.click(screen.getByTestId('devbox-profile-save'));

    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'profile_put')).toEqual([
        { name: 'midsai', json: '{"mode": "full"}' },
      ]);
    });
    await waitFor(() => {
      expect(screen.queryByTestId('devbox-profile-editor')).toBeNull();
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it('renders put validation errors under the editor and keeps it open', async () => {
    renderProfilesOnPut({ valid: false, errors: ['R7: allowed_ports out of range'] });
    const editor = (await screen.findByTestId(
      'devbox-profile-editor',
    )) as HTMLTextAreaElement;

    fireEvent.change(editor, { target: { value: '{"mode": "full"}' } });
    fireEvent.click(screen.getByTestId('devbox-profile-save'));

    expect(await screen.findByText('R7: allowed_ports out of range')).toBeTruthy();
    expect(screen.getByTestId('devbox-profile-editor')).toBeTruthy();
    expect(screen.getByTestId('devbox-profile-save')).toBeDisabled();
  });

  it('structured form edits serialize into the profile_put payload', async () => {
    invokeMock.mockImplementation(
      devboxRouter(
        pageRoutes({
          profile_get: {
            json: JSON.stringify({ project_dir: 'd:/work/x', mode: 'standard', toolchain: 'java21' }),
            valid: true,
            errors: [],
          },
          profile_put: { valid: true, errors: [] },
        }),
      ),
    );
    renderProfiles();

    fireEvent.click(screen.getByTestId('devbox-profile-edit-midsai'));
    const modeField = await screen.findByTestId('devbox-profile-field-mode');
    fireEvent.change(modeField, { target: { value: 'full' } });
    fireEvent.change(screen.getByTestId('devbox-profile-field-project_dir'), {
      target: { value: 'd:/work/y' },
    });
    fireEvent.click(screen.getByTestId('devbox-profile-save'));

    await waitFor(() => {
      const args = devboxCallArgs(invokeMock, 'profile_put');
      expect(args).toHaveLength(1);
      expect(JSON.parse(args[0].json)).toEqual({
        project_dir: 'd:/work/y',
        mode: 'full',
        toolchain: 'java21',
      });
    });
  });

  it('hides the structured form while JSON is unparseable', async () => {
    invokeMock.mockImplementation(
      devboxRouter(
        pageRoutes({
          profile_get: { json: '{"mode": "standard"}', valid: true, errors: [] },
        }),
      ),
    );
    renderProfiles();

    fireEvent.click(screen.getByTestId('devbox-profile-edit-midsai'));
    expect(await screen.findByTestId('devbox-profile-form')).toBeTruthy();

    const editor = (await screen.findByTestId(
      'devbox-profile-editor',
    )) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '{"mode": broken' } });

    expect(screen.queryByTestId('devbox-profile-form')).toBeNull();
  });

  it('shows the empty state when no profiles exist', () => {
    invokeMock.mockImplementation(devboxRouter(pageRoutes()));
    render(
      <DevboxProfiles
        profiles={[]}
        error={null}
        busy={false}
        onRetry={jest.fn(() => undefined)}
        onChanged={jest.fn(() => undefined)}
      />,
    );
    expect(screen.getByText('No profiles found')).toBeTruthy();
  });
});

function renderProfilesOnPut(putResult: { valid: boolean; errors: string[] }) {
  invokeMock.mockImplementation(
    devboxRouter(
      pageRoutes({
        profile_get: { json: '{"mode": "standard"}', valid: true, errors: [] },
        profile_put: putResult,
      }),
    ),
  );
  const onChanged = jest.fn(() => undefined);
  render(
    <DevboxProfiles
      profiles={profilesFixture}
      error={null}
      busy={false}
      onRetry={jest.fn(() => undefined)}
      onChanged={onChanged}
    />,
  );
  fireEvent.click(screen.getByTestId('devbox-profile-edit-midsai'));
  return onChanged;
}
