import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('@/lib/backend/core/invoke', () => ({
  safeInvoke: jest.fn(),
  safeInvokeWithRetry: jest.fn(),
  batchInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

jest.mock('@/components/ui/ConfirmDialogHost', () => ({
  askConfirm: jest.fn(() => Promise.resolve(true)),
}));


import { safeInvoke } from '@/lib/backend/core/invoke';
import { t } from '@/lib/i18n';
import type { DevboxAccepted, DevboxEnvEntry } from '@/lib/backend/modules/devbox';
import { DevboxProjects, type DevboxProjectsProps } from '@/components/devbox/DevboxProjects';
import type { UseDevboxConnectResult } from '@/components/devbox/useDevboxConnect';
import {
  devboxRouter,
  devboxCallArgs,
  devboxCalls,
  pageRoutes,
  overviewFixture,
  profilesFixture,
} from './devboxTestKit';

const invokeMock = safeInvoke as jest.Mock;

const envEntries: DevboxEnvEntry[] = [
  { key: 'INGRESS_MODE', value: 'relay', secret: false, readonly: false, section: 'ingress' },
  { key: 'JOB_TIMEOUT_SECONDS', value: '1800', secret: false, readonly: false, section: 'runtime' },
  { key: 'EGRESS_CONTAINER', value: 'rdm-egress', secret: false, readonly: false, section: 'runtime' },
  {
    key: 'OPENCODE_MCP_PERMISSIONS',
    value: '{"edit":"ask"}',
    secret: false,
    readonly: true,
    section: 'policy',
  },
];

const profileModels: Record<string, Record<string, unknown>> = {
  midsai: {
    project_dir: 'd:/work/midsai',
    mode: 'standard',
    toolchain: 'JDK 21',
    allowed_ports: [3000, 8787],
    port_ranges: [[8100, 8120]],
    deny_mounts: ['.env'],
    exposed_mcps: [{ name: 'context7', mode: 'readonly', tool_allow: [] }],
    preview_origin: 'http://localhost:3000',
  },
  'example-simple': {
    project_dir: 'd:/work/example',
    mode: 'readonly',
    toolchain: 'Flutter 3.44.9',
    allowed_ports: [3000],
  },
};

function connectFixture(): UseDevboxConnectResult {
  return {
    entries: envEntries,
    reload: jest.fn(),
  } as unknown as UseDevboxConnectResult;
}

function renderProjects(props: Partial<DevboxProjectsProps> = {}) {
  const onCreate = jest.fn();
  const onAction = jest.fn((_action: Promise<DevboxAccepted>) => undefined);
  render(
    <DevboxProjects
      connect={connectFixture()}
      profiles={profilesFixture}
      overviewCards={[]}
      error={null}
      busy={false}
      onAction={onAction as unknown as (action: Promise<DevboxAccepted>) => void}
      onRetry={jest.fn()}
      onChanged={jest.fn()}
      onStarted={jest.fn()}
      onCreate={onCreate}
      addSignal={0}
      seedSignal={0}
      {...props}
    />,
  );
  return { onCreate };
}

beforeEach(() => {
  jest.clearAllMocks();
  invokeMock.mockImplementation(
    devboxRouter({
      profile_get: (params: Record<string, unknown>) => {
        const name = typeof params.name === 'string' ? params.name : '';
        const model = profileModels[name] ?? profileModels.midsai;
        return { json: JSON.stringify(model, null, 2), valid: true, errors: [], git_placeholder: false };
      },
      profile_put: { valid: true, errors: [] },
      profiles_list: profilesFixture,
    }),
  );
});

describe('DevboxProjects cards', () => {
  it('marks the active project card and selects the active detail by default', async () => {
    renderProjects();

    expect(screen.getByTestId('devbox-project-card-midsai').getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('devbox-project-card-example-simple').getAttribute('data-active')).toBe(
      'false',
    );
    expect(screen.getByTestId('devbox-project-active-midsai').textContent).toContain(
      t('devboxPage.activeBadge'),
    );
    expect(await screen.findByTestId('devbox-project-detail')).toBeTruthy();
    expect((await screen.findAllByText('JDK 21')).length).toBeGreaterThan(0);
    expect(screen.getByTestId('devbox-project-detail').textContent).toContain('midsai');
  });

  it('opens a non-active project detail from its card', async () => {
    renderProjects();

    fireEvent.click(screen.getByTestId('devbox-project-card-example-simple'));

    await waitFor(() => {
      expect(screen.getByTestId('devbox-project-card-example-simple').getAttribute('data-selected')).toBe(
        'true',
      );
    });
    const detail = await screen.findByTestId('devbox-project-detail');
    expect(detail.textContent).toContain('example-simple');
    expect(detail.textContent).toContain('Flutter 3.44.9');
    expect(detail.textContent).toContain(t('devboxPage.modeReadonlyTitle'));
  });

  it('renders the read-only profile JSON and environment rows', async () => {
    renderProjects();

    const detail = await screen.findByTestId('devbox-project-detail');
    expect(detail.textContent).toContain('midsai.json');
    expect(detail.textContent).toContain('"project_dir"');
    expect(screen.getByTestId('devbox-project-env-JOB_TIMEOUT_SECONDS').textContent).toContain('1800');
    expect(screen.getByTestId('devbox-project-env-INGRESS_MODE').textContent).toContain('relay');
  });

  it('offers a concrete create action when there are no profiles', () => {
    const { onCreate } = renderProjects({ profiles: [] });

    expect(screen.getByTestId('devbox-projects-empty').textContent).toContain(
      t('devboxPage.profilesEmpty'),
    );
    fireEvent.click(screen.getByTestId('devbox-projects-empty-create'));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('requests a project when the create button is pressed', () => {
    const { onCreate } = renderProjects();

    fireEvent.click(screen.getByTestId('devbox-projects-create'));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});

describe('DevboxProjects editor reuse', () => {
  it('opens the existing profile editor modal from the card edit action', async () => {
    renderProjects();

    fireEvent.click(screen.getByTestId('devbox-project-edit-example-simple'));

    expect(await screen.findByTestId('devbox-profile-form')).toBeTruthy();
    expect(screen.getByTestId('devbox-profile-field-project_dir')).toBeTruthy();
  });
});
describe('DevboxProjects card actions', () => {
  it('card start sends {name, preview} immediately', async () => {
    invokeMock.mockImplementation(devboxRouter(pageRoutes()));
    renderProjects({ overviewCards: overviewFixture.cards });

    fireEvent.click(screen.getByTestId('devbox-profile-start-example-simple'));

    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'stack_start')).toEqual([
        { name: 'example-simple', preview: false },
      ]);
    });
  });

  it('labels the active card Restart while the stack is running', () => {
    renderProjects({ overviewCards: overviewFixture.cards });

    expect(screen.getByTestId('devbox-profile-start-midsai').textContent).toBe('Restart');
    expect(screen.getByTestId('devbox-profile-start-example-simple').textContent).toBe('Start');
  });

  it('labels the active card Start while the stack is down', () => {
    const cards = overviewFixture.cards.map(c => ({
      ...c,
      value: 'down',
      tone: 'down' as const,
    }));
    renderProjects({ overviewCards: cards });

    expect(screen.getByTestId('devbox-profile-start-midsai').textContent).toBe('Start');
  });

  it('labels the active card Start when vitals are unavailable', () => {
    renderProjects({ overviewCards: null });

    expect(screen.getByTestId('devbox-profile-start-midsai').textContent).toBe('Start');
  });

  it('restart on the active card still sends stack_start with the profile name', async () => {
    invokeMock.mockImplementation(devboxRouter(pageRoutes()));
    renderProjects({ overviewCards: overviewFixture.cards });

    fireEvent.click(screen.getByTestId('devbox-profile-start-midsai'));

    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'stack_start')).toEqual([
        { name: 'midsai', preview: false },
      ]);
    });
  });

  it('makes a project active from its card Use action', async () => {
    invokeMock.mockImplementation(devboxRouter(pageRoutes()));
    renderProjects({ overviewCards: overviewFixture.cards });

    fireEvent.click(screen.getByTestId('devbox-profile-use-example-simple'));

    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'profile_use')).toEqual([{ name: 'example-simple' }]);
    });
  });

  it('shows the localized mode badge on project cards', () => {
    renderProjects();

    expect(screen.getByTestId('devbox-project-card-midsai').textContent).toContain('Standard');
    expect(screen.getByTestId('devbox-project-card-example-simple').textContent).toContain(
      'Read-only',
    );
  });

  it('deletes a project from the card action with confirm', async () => {
    invokeMock.mockImplementation(
      devboxRouter(pageRoutes({ profile_delete: { deleted: true } })),
    );
    renderProjects();

    const del = screen.getByTestId('devbox-profile-delete-example-simple');
    fireEvent.click(del);
    expect(devboxCalls(invokeMock, 'profile_delete')).toHaveLength(0);
    fireEvent.click(del);

    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'profile_delete')).toEqual([{ name: 'example-simple' }]);
    });
  });

  it('opens the create editor pre-filled when duplicating a card', async () => {
    renderProjects();

    fireEvent.click(screen.getByTestId('devbox-profile-duplicate-example-simple'));

    const folderInput = (await screen.findByTestId(
      'devbox-profile-field-project_dir',
    )) as HTMLInputElement;
    await waitFor(() => {
      expect(folderInput.value).toBe('d:/work/example');
    });
    expect((screen.getByTestId('devbox-profile-new-name') as HTMLInputElement).value).toBe('');
  });
});
