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

jest.mock('@/components/ui/ConfirmDialogHost', () => ({
  askConfirm: jest.fn(() => Promise.resolve(true)),
}));

import { safeInvoke } from '@/lib/backend/core/invoke';
import { askConfirm } from '@/components/ui/ConfirmDialogHost';
import { DevboxProfiles, type DevboxProfilesProps } from '@/components/devbox/DevboxProfiles';
import type { DevboxProfileRow, DevboxVitalCard } from '@/lib/backend/modules/devbox';
import {
  devboxRouter,
  devboxCalls,
  devboxCallArgs,
  profilesFixture,
  pageRoutes,
  overviewFixture,
} from './devboxTestKit';

const invokeMock = safeInvoke as jest.Mock;
const askConfirmMock = askConfirm as jest.Mock;

function renderProfiles(
  onChanged = jest.fn(() => undefined),
  overviewCards: DevboxVitalCard[] | null = overviewFixture.cards,
  props: Partial<DevboxProfilesProps> = {},
) {
  render(
    <DevboxProfiles
      profiles={profilesFixture}
      overviewCards={overviewCards}
      error={null}
      busy={false}
      onAction={jest.fn()}
      onRetry={jest.fn(() => undefined)}
      onChanged={onChanged}
      {...props}
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
    renderProfiles(undefined, undefined, { editSignal: 1, editName: 'example-simple' });

    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'profile_get')).toEqual([{ name: 'example-simple' }]);
    });
    expect(await screen.findByText('Project folder is required')).toBeTruthy();
    expect(screen.getByTitle('R1: project_dir missing')).toBeTruthy();
    expect(screen.getByTestId('devbox-profile-save')).toBeDisabled();
  });

  it('classifies real R1 errors under the project folder field', async () => {
    invokeMock.mockImplementation(
      devboxRouter(
        pageRoutes({
          profile_get: {
            json: JSON.stringify({ project_dir: '', mode: 'standard' }),
            valid: false,
            errors: ['R1: пусто $ProjectDir'],
          },
        }),
      ),
    );
    renderProfiles(undefined, undefined, { editSignal: 1, editName: 'example-simple' });

    expect(await screen.findByTestId('devbox-profile-error-project_dir')).toBeTruthy();
    expect(screen.queryByTestId('devbox-profile-errors')).toBeNull();
  });

  it('clears the auto-filled toolchain when the next folder has none', async () => {
    invokeMock.mockImplementation(
      devboxRouter(
        pageRoutes({
          profile_detect: (args: Record<string, unknown>) => {
            const path = String(args.path ?? '');
            const base = {
              path,
              exists: true,
              is_git: false,
              name: '',
              stacks: [],
              suggested: null,
              provenance: {},
              warnings: [],
              port_conflicts: [],
              requires_choice: false,
            };
            if (path.endsWith('java')) {
              return {
                ...base,
                name: 'java',
                stacks: [{ id: 'java', markers: ['pom.xml'] }],
                suggested: {
                  project_dir: path,
                  mode: 'standard',
                  toolchain: 'java21',
                  ui_port: 8080,
                  allowed_ports: [8080],
                },
                provenance: { git: 'none' },
              };
            }
            if (path.endsWith('web')) {
              return {
                ...base,
                name: 'web',
                stacks: [{ id: 'vite', markers: ['package.json'] }],
                suggested: {
                  project_dir: path,
                  mode: 'standard',
                  ui_port: 5173,
                  allowed_ports: [5173],
                },
                provenance: { git: 'none' },
              };
            }
            return base;
          },
        }),
      ),
    );
    renderProfiles(undefined, undefined, { addSignal: 1 });
    const folder = (await screen.findByTestId(
      'devbox-profile-field-project_dir',
    )) as HTMLInputElement;

    fireEvent.change(folder, { target: { value: 'd:/work/java' } });
    fireEvent.click(await screen.findByTestId('devbox-profile-advanced-toggle'));
    const toolchain = (await screen.findByTestId(
      'devbox-profile-field-toolchain',
    )) as HTMLInputElement;
    await waitFor(() => expect(toolchain.value).toBe('java21'));

    fireEvent.change(folder, { target: { value: 'd:/work/web' } });
    await waitFor(() => expect(toolchain.value).toBe(''));
  });

  it('maps project_dir put errors under the folder field when the form is visible', async () => {
    invokeMock.mockImplementation(
      devboxRouter(
        pageRoutes({
          profile_put: { valid: false, errors: ['R2: project_dir does not exist'] },
        }),
      ),
    );
    renderProfiles(undefined, undefined, { addSignal: 1 });
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
    renderProfiles(undefined, undefined, { editSignal: 1, editName: 'midsai' });
    fireEvent.click(await screen.findByTestId('devbox-profile-json-toggle'));
    const editor = (await screen.findByTestId(
      'devbox-profile-editor',
    )) as HTMLTextAreaElement;
    expect(screen.getByTestId('devbox-profile-save')).not.toBeDisabled();

    fireEvent.change(editor, { target: { value: '{"mode": broken' } });

    expect(await screen.findByText('Invalid JSON')).toBeTruthy();
    expect(screen.getByTestId('devbox-profile-save')).toBeDisabled();
    expect(devboxCalls(invokeMock, 'profile_put')).toHaveLength(0);
  });

  it('keeps the raw JSON collapsed on plain edit until the toggle opens it', async () => {
    invokeMock.mockImplementation(
      devboxRouter(
        pageRoutes({
          profile_get: { json: '{"mode": "standard"}', valid: true, errors: [] },
        }),
      ),
    );
    renderProfiles(undefined, undefined, { editSignal: 1, editName: 'midsai' });
    expect(await screen.findByTestId('devbox-profile-form')).toBeTruthy();
    expect(screen.queryByTestId('devbox-profile-editor')).toBeNull();

    fireEvent.click(screen.getByTestId('devbox-profile-json-toggle'));
    expect(screen.getByTestId('devbox-profile-editor')).toBeTruthy();
  });

  it('saves valid JSON via profile_put and closes on success', async () => {
    const onChanged = renderProfilesOnPut({ valid: true, errors: [] });
    fireEvent.click(await screen.findByTestId('devbox-profile-json-toggle'));
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

  it('warns on disk drift before profile_put and overwrites on confirm', async () => {
    let gets = 0;
    invokeMock.mockImplementation(
      devboxRouter(
        pageRoutes({
          profile_get: () => {
            gets += 1;
            const json = gets === 1 ? '{"mode": "standard"}' : '{"mode": "full", "deny_mounts": ["x"]}';
            return { json, valid: true, errors: [] };
          },
          profile_put: { valid: true, errors: [] },
        }),
      ),
    );
    render(
      <DevboxProfiles
        profiles={profilesFixture}
        overviewCards={overviewFixture.cards}
        error={null}
        busy={false}
        onAction={jest.fn()}
        onRetry={jest.fn(() => undefined)}
        onChanged={jest.fn()}
        editSignal={1}
        editName="midsai"
      />,
    );

    fireEvent.click(await screen.findByTestId('devbox-profile-save'));

    await waitFor(() => expect(askConfirmMock).toHaveBeenCalled());
    await waitFor(() => expect(devboxCalls(invokeMock, 'profile_put')).toHaveLength(1));
  });

  it('aborts profile_put when drift overwrite is declined', async () => {
    askConfirmMock.mockResolvedValueOnce(false);
    let gets = 0;
    invokeMock.mockImplementation(
      devboxRouter(
        pageRoutes({
          profile_get: () => {
            gets += 1;
            const json = gets === 1 ? '{"mode": "standard"}' : '{"mode": "full"}';
            return { json, valid: true, errors: [] };
          },
          profile_put: { valid: true, errors: [] },
        }),
      ),
    );
    render(
      <DevboxProfiles
        profiles={profilesFixture}
        overviewCards={overviewFixture.cards}
        error={null}
        busy={false}
        onAction={jest.fn()}
        onRetry={jest.fn(() => undefined)}
        onChanged={jest.fn()}
        editSignal={1}
        editName="midsai"
      />,
    );

    fireEvent.click(await screen.findByTestId('devbox-profile-save'));

    await waitFor(() => expect(askConfirmMock).toHaveBeenCalled());
    expect(devboxCalls(invokeMock, 'profile_put')).toHaveLength(0);
  });

  it('renders put validation errors under the editor and keeps it open', async () => {
    renderProfilesOnPut({ valid: false, errors: ['R12: allowed_ports out of range'] });
    fireEvent.click(await screen.findByTestId('devbox-profile-json-toggle'));
    const editor = (await screen.findByTestId(
      'devbox-profile-editor',
    )) as HTMLTextAreaElement;

    fireEvent.change(editor, { target: { value: '{"mode": "full"}' } });
    fireEvent.click(screen.getByTestId('devbox-profile-save'));

    expect(await screen.findByText('Port must be 1-65535')).toBeTruthy();
    expect(screen.getByTitle('R12: allowed_ports out of range')).toBeTruthy();
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
    renderProfiles(undefined, undefined, { editSignal: 1, editName: 'midsai' });
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
    renderProfiles(undefined, undefined, { editSignal: 1, editName: 'midsai' });
    expect(await screen.findByTestId('devbox-profile-form')).toBeTruthy();

    fireEvent.click(screen.getByTestId('devbox-profile-json-toggle'));
    const editor = (await screen.findByTestId(
      'devbox-profile-editor',
    )) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '{"mode": broken' } });

    expect(screen.queryByTestId('devbox-profile-form')).toBeNull();
  });








  it('keeps advanced fields collapsed in create mode until toggled', async () => {
    invokeMock.mockImplementation(devboxRouter(pageRoutes()));
    renderProfiles(undefined, undefined, { addSignal: 1 });
    await screen.findByTestId('devbox-profile-form');
    expect(screen.queryByTestId('devbox-profile-field-toolchain')).toBeNull();
    expect(screen.getByTestId('devbox-profile-defaults-summary')).toBeTruthy();

    fireEvent.click(screen.getByTestId('devbox-profile-advanced-toggle'));
    expect(await screen.findByTestId('devbox-profile-field-toolchain')).toBeTruthy();
    expect(screen.queryByTestId('devbox-profile-defaults-summary')).toBeNull();
  });

  it('autosuggests the project name from the folder and lets the user override it', async () => {
    invokeMock.mockImplementation(devboxRouter(pageRoutes()));
    renderProfiles(undefined, undefined, { addSignal: 1 });
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
    renderProfiles(undefined, undefined, { addSignal: 1 });
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
    renderProfiles(undefined, undefined, { addSignal: 1 });
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
    renderProfiles(undefined, undefined, { addSignal: 1 });
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
    renderProfiles(undefined, undefined, { addSignal: 1 });
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

  it('shows folder detection from profile_detect', async () => {
    invokeMock.mockImplementation(
      devboxRouter(
        pageRoutes({
          profile_detect: {
            path: 'd:/work/repo',
            exists: true,
            is_git: true,
            name: 'repo',
            stacks: [{ id: 'vite', markers: ['package.json'] }],
            suggested: {
              project_dir: 'd:/work/repo',
              mode: 'standard',
              ui_port: 5173,
              allowed_ports: [5173],
            },
            provenance: { git: 'local' },
            warnings: [],
            port_conflicts: [],
            requires_choice: false,
          },
        }),
      ),
    );
    renderProfiles(undefined, undefined, { addSignal: 1 });
    fireEvent.change(await screen.findByTestId('devbox-profile-field-project_dir'), {
      target: { value: 'd:/work/repo' },
    });

    expect(await screen.findByText('Folder exists, git repo')).toBeTruthy();
    expect(await screen.findByText('vite')).toBeTruthy();
    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'profile_detect')).toEqual([{ path: 'd:/work/repo' }]);
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
    renderProfiles(undefined, undefined, { addSignal: 1 });
    expect(
      await screen.findByText(
        'Everything else stays at defaults: base toolchain, ports closed, git — Host User <h@x.dev>',
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
    renderProfiles(undefined, undefined, { duplicateSignal: 1, duplicateName: 'midsai' });
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
    const profileProps = {
      profiles: profilesFixture,
      overviewCards: overviewFixture.cards,
      error: null,
      busy: false,
      onAction: jest.fn(),
      onRetry: jest.fn(() => undefined),
      onChanged: jest.fn(() => undefined),
    };
    const view = render(<DevboxProfiles {...profileProps} addSignal={1} />);
    fireEvent.change(await screen.findByTestId('devbox-profile-field-project_dir'), {
      target: { value: 'd:/work/recent-one' },
    });
    fireEvent.click(screen.getByTestId('devbox-profile-save'));
    await waitFor(() => {
      expect(devboxCalls(invokeMock, 'profile_put')).toHaveLength(1);
    });

    view.rerender(<DevboxProfiles {...profileProps} addSignal={2} />);
    const recents = await screen.findByTestId('devbox-profile-recents');
    expect(recents.textContent).toContain('recent-one');
    localStorage.removeItem('devbox.recentProjectDirs');
  });

  it('renders a mode radio card as selected after clicking it', async () => {
    invokeMock.mockImplementation(devboxRouter(pageRoutes()));
    renderProfiles(undefined, undefined, { addSignal: 1 });
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


  it('seedSignal opens the active profile editor with the skeleton exposed_mcps merged', async () => {
    invokeMock.mockImplementation(
      devboxRouter(
        pageRoutes({
          profile_get: {
            json: '{"project_dir": "d:/work/midsai", "mode": "standard"}',
            valid: true,
            errors: [],
          },
        }),
      ),
    );
    const { rerender } = render(seededProfiles(0));
    expect(screen.queryByTestId('devbox-profile-editor')).toBeNull();

    rerender(seededProfiles(1));

    const editor = (await screen.findByTestId('devbox-profile-editor')) as HTMLTextAreaElement;
    await waitFor(() => {
      expect(JSON.parse(editor.value)).toEqual({
        project_dir: 'd:/work/midsai',
        mode: 'standard',
        exposed_mcps: [{ name: 'context7', mode: 'readonly', tool_allow: [] }],
      });
    });
    expect(devboxCallArgs(invokeMock, 'profile_get')).toEqual([{ name: 'midsai' }]);
  });

  it('seedSignal opens the create template with the skeleton when no profile is active', async () => {
    invokeMock.mockImplementation(devboxRouter(pageRoutes()));
    const { rerender } = render(seededProfiles(0, []));

    rerender(seededProfiles(1, []));

    expect(await screen.findByTestId('devbox-profile-new-name')).toBeTruthy();
    const editor = (await screen.findByTestId('devbox-profile-editor')) as HTMLTextAreaElement;
    await waitFor(() => {
      expect(JSON.parse(editor.value)).toEqual({
        project_dir: '',
        mode: 'standard',
        exposed_mcps: [{ name: 'context7', mode: 'readonly', tool_allow: [] }],
      });
    });
    expect(devboxCalls(invokeMock, 'profile_get')).toHaveLength(0);
  });

});

function seededProfiles(seedSignal: number, profiles: DevboxProfileRow[] | null = profilesFixture) {
  return (
    <DevboxProfiles
      profiles={profiles}
      overviewCards={overviewFixture.cards}
      error={null}
      busy={false}
      onAction={jest.fn()}
      onRetry={jest.fn(() => undefined)}
      onChanged={jest.fn(() => undefined)}
      seedSignal={seedSignal}
    />
  );
}

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
      overviewCards={overviewFixture.cards}
      error={null}
      busy={false}
      onAction={jest.fn()}
      onRetry={jest.fn(() => undefined)}
      onChanged={onChanged}
      editSignal={1}
      editName="midsai"
    />,
  );
  return onChanged;
}

describe('Devbox profile advanced fields', () => {
  it('commits port_ranges text as parsed ranges on blur', async () => {
    renderProfilesOnPut({ valid: true, errors: [] });
    fireEvent.click(await screen.findByTestId('devbox-profile-advanced-toggle'));
    const field = (await screen.findByTestId(
      'devbox-profile-field-port_ranges',
    )) as HTMLInputElement;

    fireEvent.change(field, { target: { value: '3000-3999, 8000-8699' } });
    fireEvent.blur(field);
    fireEvent.click(screen.getByTestId('devbox-profile-save'));

    await waitFor(() => {
      const put = devboxCallArgs(invokeMock, 'profile_put')[0];
      expect(JSON.parse(put.json).port_ranges).toEqual([
        [3000, 3999],
        [8000, 8699],
      ]);
    });
  });

  it('renders existing port_ranges back as range text', async () => {
    invokeMock.mockImplementation(
      devboxRouter(
        pageRoutes({
          profile_get: {
            json: '{"mode": "standard", "port_ranges": [[3000, 3999]]}',
            valid: true,
            errors: [],
          },
          profile_put: { valid: true, errors: [] },
        }),
      ),
    );
    renderProfiles(undefined, undefined, { editSignal: 1, editName: 'example-simple' });
    fireEvent.click(await screen.findByTestId('devbox-profile-advanced-toggle'));
    const field = (await screen.findByTestId(
      'devbox-profile-field-port_ranges',
    )) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe('3000-3999'));
  });

  it('adds a runner command and seeds runner_port', async () => {
    renderProfilesOnPut({ valid: true, errors: [] });
    fireEvent.click(await screen.findByTestId('devbox-profile-advanced-toggle'));
    fireEvent.click(await screen.findByTestId('devbox-profile-runner-add'));

    fireEvent.change(screen.getByTestId('devbox-profile-runner-0-name'), {
      target: { value: 'test' },
    });
    fireEvent.change(screen.getByTestId('devbox-profile-runner-0-cmd'), {
      target: { value: 'npm test' },
    });
    fireEvent.change(screen.getByTestId('devbox-profile-runner-0-timeout'), {
      target: { value: '300' },
    });
    fireEvent.click(screen.getByTestId('devbox-profile-save'));

    await waitFor(() => {
      const put = devboxCallArgs(invokeMock, 'profile_put')[0];
      const model = JSON.parse(put.json);
      expect(model.runner_commands).toEqual([
        { name: 'test', cmd: ['npm', 'test'], timeout: 300 },
      ]);
      expect(model.runner_port).toBe(8796);
    });
  });

  it('removes a runner command row', async () => {
    invokeMock.mockImplementation(
      devboxRouter(
        pageRoutes({
          profile_get: {
            json: JSON.stringify({
              mode: 'standard',
              runner_port: 8796,
              runner_commands: [{ name: 'lint', cmd: ['npm', 'run', 'lint'] }],
            }),
            valid: true,
            errors: [],
          },
          profile_put: { valid: true, errors: [] },
        }),
      ),
    );
    renderProfiles(undefined, undefined, { editSignal: 1, editName: 'example-simple' });
    fireEvent.click(await screen.findByTestId('devbox-profile-advanced-toggle'));
    fireEvent.click(await screen.findByTestId('devbox-profile-runner-0-remove'));
    fireEvent.click(screen.getByTestId('devbox-profile-save'));

    await waitFor(() => {
      const put = devboxCallArgs(invokeMock, 'profile_put')[0];
      expect(JSON.parse(put.json).runner_commands).toEqual([]);
    });
  });

  it('adds a host service row with auth and cmd', async () => {
    renderProfilesOnPut({ valid: true, errors: [] });
    fireEvent.click(await screen.findByTestId('devbox-profile-advanced-toggle'));
    fireEvent.click(await screen.findByTestId('devbox-profile-service-add'));

    fireEvent.change(screen.getByTestId('devbox-profile-service-0-port'), {
      target: { value: '8790' },
    });
    fireEvent.change(screen.getByTestId('devbox-profile-service-0-cmd'), {
      target: { value: 'python -m http.server 8790' },
    });
    fireEvent.click(screen.getByTestId('devbox-profile-save'));

    await waitFor(() => {
      const put = devboxCallArgs(invokeMock, 'profile_put')[0];
      const model = JSON.parse(put.json);
      expect(model.host_services).toEqual([
        { port: 8790, auth: 'open', cmd: 'python -m http.server 8790' },
      ]);
    });
  });
});
