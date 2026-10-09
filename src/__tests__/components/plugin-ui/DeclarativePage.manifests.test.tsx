import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import DeclarativePage from '@/components/plugin-ui/DeclarativePage';
import type { PluginPageSchema, UiNode } from '@/components/plugin-ui/schema';
import { safeInvoke } from '@/lib/backend/core/invoke';
import { setLocale, getLocale } from '@/lib/i18n';
import {
  registerPluginBundles,
  unregisterPluginBundles,
} from '@/lib/i18nPluginBundles';

// ── Module mocks (invoke bridge + toast only — renderer and i18n are real) ──

jest.mock('@/lib/backend/core/invoke', () => ({
  setAuthExpiredHandler: jest.fn(),
  safeInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

jest.mock('@/lib/observability/toast', () => ({
  appToast: {
    error: jest.fn(),
    success: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
  },
}));

// ── Manifest loading ─────────────────────────────────────────────────────────

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');

// plugins-src/ (official service plugins) is deliberately NOT part of the
// open-core export — official plugins ship via the gated distribution server.
// When it is absent (public client tree) skip this whole suite instead of
// failing on the missing manifests.
const HAS_PLUGINS_SRC = existsSync(resolve(REPO_ROOT, 'plugins-src'));

interface PluginManifest {
  id: string;
  contributions: {
    ui: { kind: string; page?: PluginPageSchema & { sections?: unknown } };
    i18n: { ru?: Record<string, unknown>; en?: Record<string, unknown> };
  };
}

function loadManifest(dir: string): PluginManifest {
  const raw = readFileSync(
    resolve(REPO_ROOT, 'plugins-src', dir, 'plugin.json'),
    'utf8',
  );
  return JSON.parse(raw) as PluginManifest;
}

/** Recursively collect every node in the tree (depth-first). */
function allNodes(nodes: UiNode[]): UiNode[] {
  const out: UiNode[] = [];
  for (const node of nodes) {
    out.push(node);
    if (node.kind === 'section') out.push(...allNodes(node.nodes ?? []));
  }
  return out;
}

/** Assert a value is a plain string, never an inline {ru,en} object. */
function assertStringLabels(manifest: PluginManifest): void {
  const page = manifest.contributions.ui.page;
  expect(page).toBeDefined();
  // Legacy vocabulary must be gone.
  expect((page as { sections?: unknown }).sections).toBeUndefined();
  expect(Array.isArray(page?.nodes)).toBe(true);

  for (const node of allNodes(page?.nodes ?? [])) {
    switch (node.kind) {
      case 'heading':
        expect(typeof node.text).toBe('string');
        break;
      case 'section':
        if (node.title !== undefined) expect(typeof node.title).toBe('string');
        break;
      case 'field':
        expect(typeof node.label).toBe('string');
        for (const opt of node.options ?? []) {
          expect(typeof opt.label).toBe('string');
        }
        break;
      case 'table':
        for (const col of node.columns) {
          expect(typeof col.label).toBe('string');
        }
        break;
      case 'button':
        expect(typeof node.label).toBe('string');
        break;
      default:
        break;
    }
  }
}

function install(manifest: PluginManifest): void {
  registerPluginBundles(manifest.id, manifest.contributions.i18n);
}

// ── Tests ────────────────────────────────────────────────────────────────────

const describeIfPlugins = HAS_PLUGINS_SRC ? describe : describe.skip;

describeIfPlugins('declarative plugin manifests render through DeclarativePage', () => {
  const savedLocale = getLocale();

  beforeEach(() => {
    jest.clearAllMocks();
    setLocale('en');
  });

  afterEach(() => {
    for (const id of ['stitch-notebooklm', 'stitch-totp']) {
      unregisterPluginBundles(id);
    }
    setLocale(savedLocale);
  });

  it('both manifests use the nodes vocabulary with string i18n-key labels', () => {
    for (const dir of ['stitch-notebooklm', 'stitch-totp']) {
      assertStringLabels(loadManifest(dir));
    }
  });

  it('stitch-notebooklm page renders title, table rows, fields and buttons (en)', async () => {
    const manifest = loadManifest('stitch-notebooklm');
    install(manifest);
    const pageNodes = allNodes(
      (manifest.contributions.ui.page as PluginPageSchema).nodes,
    );
    const notebooksTable = pageNodes.find(
      (n): n is Extract<UiNode, { kind: 'table' }> =>
        n.kind === 'table' && n.id === 'notebooks',
    );
    expect(notebooksTable?.empty).toBe('stitch-notebooklm.empty');
    const createButton = pageNodes.find(
      (n): n is Extract<UiNode, { kind: 'button' }> =>
        n.kind === 'button' && n.id === 'create-notebook',
    );
    expect(createButton?.params).toBeUndefined();
    expect(createButton?.paramsFrom).toEqual({ title: 'title-field' });
    const askButton = pageNodes.find(
      (n): n is Extract<UiNode, { kind: 'button' }> =>
        n.kind === 'button' && n.id === 'ask',
    );
    expect(askButton?.paramsFrom).toEqual({ question: 'ask-field' });
    (safeInvoke as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd === 'plugin.stitch-notebooklm.list_notebooks') {
        return Promise.resolve([{ id: 'nb-1', title: 'My Notebook' }]);
      }
      return Promise.resolve({});
    });

    render(
      <DeclarativePage
        pluginId={manifest.id}
        schema={manifest.contributions.ui.page as PluginPageSchema}
      />,
    );

    // Page title + section title resolved from the plugin bundle.
    expect(screen.getByText('NotebookLM')).toBeTruthy();
    expect(screen.getByText('Notebooks')).toBeTruthy();
    // Table rows arrive from the bare-array command response; headers render
    // with the rows (TableNode shows a spinner until the source resolves).
    await waitFor(() => {
      expect(screen.getByText('My Notebook')).toBeTruthy();
    });
    // Column headers ("ID" plain, "Title" via key).
    expect(screen.getByText('Title')).toBeTruthy();
    // Field label + buttons.
    expect(screen.getByText('Question')).toBeTruthy();
    expect(screen.getByText('Notebook title')).toBeTruthy();
    expect(screen.getByText('Create Notebook')).toBeTruthy();
    expect(screen.getByText('Ask')).toBeTruthy();
  });

  it('stitch-totp page renders keys table without secret column, add-only form and switches to ru', async () => {
    const manifest = loadManifest('stitch-totp');
    install(manifest);

    const pageNodes = allNodes(
      (manifest.contributions.ui.page as PluginPageSchema).nodes,
    );
    const addButton = pageNodes.find(
      (n): n is Extract<UiNode, { kind: 'button' }> =>
        n.kind === 'button' && n.id === 'add-key',
    );
    expect(addButton).toBeDefined();
    expect(addButton?.paramsFrom).toEqual({
      label: 'label-field',
      secret: 'secret-field',
    });
    const pageRemoveButtons = pageNodes.filter(
      (n): n is Extract<UiNode, { kind: 'button' }> =>
        n.kind === 'button' && n.command === 'remove_key',
    );
    expect(pageRemoveButtons).toEqual([]);
    const totpTable = pageNodes.find(
      (n): n is Extract<UiNode, { kind: 'table' }> =>
        n.kind === 'table' && n.id === 'totp-keys',
    );
    expect(totpTable?.columns.map((col) => col.key)).toEqual([
      'label',
      'issuer',
      'enabled',
    ]);
    expect(totpTable?.empty).toBe('stitch-totp.empty');
    expect(totpTable?.rowActions).toEqual([
      {
        id: 'remove-key-row',
        label: 'stitch-totp.removeRow',
        command: 'remove_key',
        variant: 'danger',
        paramsFromRow: { id: 'id' },
      },
    ]);
    const labelField = pageNodes.find(
      (n): n is Extract<UiNode, { kind: 'field' }> =>
        n.kind === 'field' && n.id === 'label-field',
    );
    const secretField = pageNodes.find(
      (n): n is Extract<UiNode, { kind: 'field' }> =>
        n.kind === 'field' && n.id === 'secret-field',
    );
    expect(labelField?.placeholder).toBe('stitch-totp.labelPlaceholder');
    expect(secretField?.placeholder).toBe('stitch-totp.secretPlaceholder');

    (safeInvoke as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd === 'plugin.stitch-totp.list_keys') {
        return Promise.resolve([
          {
            id: 'k-1',
            label: 'Kiro',
            issuer: 'AWS',
            secret: 'JBSWY3DPEHPK3PXP',
            enabled: true,
          },
        ]);
      }
      return Promise.resolve({});
    });

    const { rerender } = render(
      <DeclarativePage
        pluginId={manifest.id}
        schema={manifest.contributions.ui.page as PluginPageSchema}
      />,
    );

    expect(screen.getByText('2FA (TOTP)')).toBeTruthy();
    expect(screen.getByText('TOTP keys')).toBeTruthy();
    // list_keys rows carry the decrypted secret; it must never render as a cell.
    await waitFor(() => {
      expect(screen.getByText('Kiro')).toBeTruthy();
    });
    expect(screen.getByText('AWS')).toBeTruthy();
    expect(screen.queryByText('JBSWY3DPEHPK3PXP')).toBeNull();
    expect(screen.getByText('Add Key')).toBeTruthy();
    expect(screen.queryByText('Remove Key')).toBeNull();
    // Row action button rendered in the trailing actions column (one row
    // → one button), label resolved from the plugin bundle.
    expect(screen.getAllByText('Remove')).toHaveLength(1);
    // Placeholders resolve through the en bundle like labels do.
    expect(screen.getByPlaceholderText('e.g. Kiro')).toBeTruthy();
    expect(
      screen.getByPlaceholderText('Base32 secret, e.g. JBSWY3DPEHPK3PXP'),
    ).toBeTruthy();

    // Locale switch: re-render resolves the same keys through the ru bundle.
    setLocale('ru');
    rerender(
      <DeclarativePage
        pluginId={manifest.id}
        schema={manifest.contributions.ui.page as PluginPageSchema}
      />,
    );
    expect(screen.getByText('TOTP-ключи')).toBeTruthy();
    expect(screen.getByText('Добавить ключ')).toBeTruthy();
    expect(screen.queryByText('Удалить ключ')).toBeNull();
    // Row action label switches locale with the bundle.
    expect(screen.getAllByText('Удалить')).toHaveLength(1);
    expect(screen.getByPlaceholderText('например, Kiro')).toBeTruthy();
  });

});
