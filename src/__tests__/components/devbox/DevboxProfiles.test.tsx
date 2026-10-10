// Mocks: safeInvoke (routed by command name), sonner. i18n runs REAL.

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
      onAction={jest.fn()}
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

  it('maps project_dir put errors under the folder field when the form is visible', async () => {
    invokeMock.mockImplementation(
      devboxRouter(
        pageRoutes({
          profile_put: { valid: false, errors: ['R2: project_dir does not exist'] },
        }),
      ),
    );
    renderProfiles();

    fireEvent.click(screen.getByTestId('devbox-profile-add'));
    fireEvent.change(await screen.findByTestId('devbox-profile-field-project_dir'), {
      target: { value: 'd:/work/ghost' },
    });
    fireEvent.click(screen.getByTestId('devbox-profile-save'));

    expect(await screen.findByTestId('devbox-profile-error-project_dir')).toBeTruthy();
    expect(screen.queryByTestId('devbox-profile-errors')).toBeNull();
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
    await screen.findByTestId('devbox-profile-field-mode');
    fireEvent.click(screen.getByTestId('devbox-profile-mode-full'));
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

  it('row start sends {name, preview} immediately', async () => {
    invokeMock.mockImplementation(devboxRouter(pageRoutes()));
    renderProfiles();

    fireEvent.click(screen.getByTestId('devbox-profile-start-example-simple'));

    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'stack_start')).toEqual([
        { name: 'example-simple', preview: false },
      ]);
    });
  });

  it('keeps advanced fields collapsed in create mode until toggled', async () => {
    invokeMock.mockImplementation(devboxRouter(pageRoutes()));
    renderProfiles();

    fireEvent.click(screen.getByTestId('devbox-profile-add'));
    await screen.findByTestId('devbox-profile-form');
    expect(screen.queryByTestId('devbox-profile-field-toolchain')).toBeNull();
    expect(screen.getByTestId('devbox-profile-defaults-summary')).toBeTruthy();

    fireEvent.click(screen.getByTestId('devbox-profile-advanced-toggle'));
    expect(await screen.findByTestId('devbox-profile-field-toolchain')).toBeTruthy();
    expect(screen.queryByTestId('devbox-profile-defaults-summary')).toBeNull();
  });

  it('autosuggests the project name from the folder and lets the user override it', async () => {
    invokeMock.mockImplementation(devboxRouter(pageRoutes()));
    renderProfiles();

    fireEvent.click(screen.getByTestId('devbox-profile-add'));
    const folderInput = await screen.findByTestId('devbox-profile-field-project_dir');
    const nameInput = screen.getByTestId('devbox-profile-new-name') as HTMLInputElement;

    fireEvent.change(folderInput, { target: { value: 'd:/work/midsai-core' } });
    expect(nameInput.value).toBe('midsai-core');

    fireEvent.change(nameInput, { target: { value: 'custom' } });
    fireEvent.change(folderInput, { target: { value: 'd:/work/other' } });
    expect(nameInput.value).toBe('custom');
  });

  it('keeps Add disabled until folder is filled', async () => {
    invokeMock.mockImplementation(devboxRouter(pageRoutes()));
    renderProfiles();

    fireEvent.click(screen.getByTestId('devbox-profile-add'));
    await screen.findByTestId('devbox-profile-form');
    expect(screen.getByTestId('devbox-profile-save')).toBeDisabled();

    fireEvent.change(screen.getByTestId('devbox-profile-field-project_dir'), {
      target: { value: 'd:/work/fresh' },
    });
    expect(screen.getByTestId('devbox-profile-save')).not.toBeDisabled();
  });

  it('creates a project with the autosuggested name via profile_put', async () => {
    invokeMock.mockImplementation(
      devboxRouter(pageRoutes({ profile_put: { valid: true, errors: [] } })),
    );
    renderProfiles();

    fireEvent.click(screen.getByTestId('devbox-profile-add'));
    fireEvent.change(await screen.findByTestId('devbox-profile-field-project_dir'), {
      target: { value: 'd:/work/fresh' },
    });
    fireEvent.click(screen.getByTestId('devbox-profile-save'));

    await waitFor(() => {
      const args = devboxCallArgs(invokeMock, 'profile_put');
      expect(args).toHaveLength(1);
      expect(args[0].name).toBe('fresh');
      expect(JSON.parse(args[0].json)).toEqual({
        project_dir: 'd:/work/fresh',
        mode: 'standard',
      });
    });
    expect(devboxCalls(invokeMock, 'stack_start')).toHaveLength(0);
  });

  it('add-and-start queues stack_start after a successful profile_put', async () => {
    invokeMock.mockImplementation(
      devboxRouter(pageRoutes({ profile_put: { valid: true, errors: [] } })),
    );
    renderProfiles();

    fireEvent.click(screen.getByTestId('devbox-profile-add'));
    fireEvent.change(await screen.findByTestId('devbox-profile-field-project_dir'), {
      target: { value: 'd:/work/fresh' },
    });
    fireEvent.click(screen.getByTestId('devbox-profile-save-start'));

    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'profile_put')).toHaveLength(1);
      expect(devboxCallArgs(invokeMock, 'stack_start')).toEqual([
        { name: 'fresh', preview: false },
      ]);
    });
    expect(screen.queryByTestId('devbox-profile-form')).toBeNull();
  });

  it('folder picker fills project_dir and autosuggests the name from the native dialog', async () => {
    const pick = jest.fn(async () => 'd:/work/picked');
    (window as any).pywebview = { api: { pick_folder: pick } };
    invokeMock.mockImplementation(devboxRouter(pageRoutes()));
    renderProfiles();

    fireEvent.click(screen.getByTestId('devbox-profile-add'));
    fireEvent.click(await screen.findByTestId('devbox-profile-folder-pick'));

    const folderInput = (await screen.findByTestId(
      'devbox-profile-field-project_dir',
    )) as HTMLInputElement;
    await waitFor(() => {
      expect(folderInput.value).toBe('d:/work/picked');
    });
    const nameInput = screen.getByTestId('devbox-profile-new-name') as HTMLInputElement;
    expect(nameInput.value).toBe('picked');
    delete (window as any).pywebview;
  });

  it('shows folder existence status from folder_check', async () => {
    invokeMock.mockImplementation(
      devboxRouter(pageRoutes({ folder_check: { exists: true, is_git: true } })),
    );
    renderProfiles();

    fireEvent.click(screen.getByTestId('devbox-profile-add'));
    fireEvent.change(await screen.findByTestId('devbox-profile-field-project_dir'), {
      target: { value: 'd:/work/repo' },
    });

    expect(await screen.findByText('Folder exists, git repo')).toBeTruthy();
    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'folder_check')).toEqual([{ path: 'd:/work/repo' }]);
    });
  });

  it('shows the host git identity in the defaults summary', async () => {
    invokeMock.mockImplementation(
      devboxRouter(
        pageRoutes({
          profile_defaults: { git_name: 'Host User', git_email: 'h@x.dev' },
        }),
      ),
    );
    renderProfiles();

    fireEvent.click(screen.getByTestId('devbox-profile-add'));
    expect(
      await screen.findByText(
        'Rest stays at defaults: base toolchain, ports closed, git — Host User <h@x.dev>',
      ),
    ).toBeTruthy();
  });

  it('duplicates a project into the create form', async () => {
    invokeMock.mockImplementation(
      devboxRouter(
        pageRoutes({
          profile_get: {
            json: '{"project_dir": "d:/work/dup", "mode": "readonly"}',
            valid: true,
            errors: [],
          },
        }),
      ),
    );
    renderProfiles();

    fireEvent.click(screen.getByTestId('devbox-profile-duplicate-midsai'));
    const folderInput = (await screen.findByTestId(
      'devbox-profile-field-project_dir',
    )) as HTMLInputElement;
    await waitFor(() => {
      expect(folderInput.value).toBe('d:/work/dup');
    });
    expect((screen.getByTestId('devbox-profile-new-name') as HTMLInputElement).value).toBe('');
  });

  it('offers recent folders after a successful create', async () => {
    invokeMock.mockImplementation(
      devboxRouter(pageRoutes({ profile_put: { valid: true, errors: [] } })),
    );
    renderProfiles();

    fireEvent.click(screen.getByTestId('devbox-profile-add'));
    fireEvent.change(await screen.findByTestId('devbox-profile-field-project_dir'), {
      target: { value: 'd:/work/recent-one' },
    });
    fireEvent.click(screen.getByTestId('devbox-profile-save'));
    await waitFor(() => {
      expect(devboxCalls(invokeMock, 'profile_put')).toHaveLength(1);
    });

    fireEvent.click(screen.getByTestId('devbox-profile-add'));
    const recents = await screen.findByTestId('devbox-profile-recents');
    expect(recents.textContent).toContain('recent-one');
    localStorage.removeItem('devbox.recentProjectDirs');
  });

  it('renders a mode radio card as selected after clicking it', async () => {
    invokeMock.mockImplementation(devboxRouter(pageRoutes()));
    renderProfiles();

    fireEvent.click(screen.getByTestId('devbox-profile-add'));
    await screen.findByTestId('devbox-profile-field-mode');
    expect(screen.getByTestId('devbox-profile-mode-standard')).toHaveAttribute(
      'aria-checked',
      'true',
    );

    fireEvent.click(screen.getByTestId('devbox-profile-mode-readonly'));
    expect(screen.getByTestId('devbox-profile-mode-readonly')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByTestId('devbox-profile-mode-standard')).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('deletes a project from the row action with confirm', async () => {
    invokeMock.mockImplementation(
      devboxRouter(pageRoutes({ profile_delete: { deleted: true } })),
    );
    renderProfiles();

    const del = screen.getByTestId('devbox-profile-delete-example-simple');
    fireEvent.click(del);
    expect(devboxCalls(invokeMock, 'profile_delete')).toHaveLength(0);
    fireEvent.click(del);

    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'profile_delete')).toEqual([{ name: 'example-simple' }]);
    });
  });

  it('shows the empty state when no projects exist', () => {
    invokeMock.mockImplementation(devboxRouter(pageRoutes()));
    render(
      <DevboxProfiles
        profiles={[]}
        error={null}
        busy={false}
        onAction={jest.fn()}
        onRetry={jest.fn(() => undefined)}
        onChanged={jest.fn(() => undefined)}
      />,
    );
    expect(screen.getByText('No projects yet')).toBeTruthy();
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
      onAction={jest.fn()}
      onRetry={jest.fn(() => undefined)}
      onChanged={onChanged}
    />,
  );
  fireEvent.click(screen.getByTestId('devbox-profile-edit-midsai'));
  return onChanged;
}
