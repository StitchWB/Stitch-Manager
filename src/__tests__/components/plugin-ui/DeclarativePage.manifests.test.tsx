/**
 * Declarative manifest contract tests.
 *
 * Loads the REAL migrated manifests of the three declarative service
 * plugins (stitch-notebooklm, stitch-totp, stitch-sheets) from
 * plugins-src/ and renders their `contributions.ui.page` through the REAL
 * DeclarativePage renderer — no renderer mock, no i18n mock. Only the
 * backend invoke bridge and toast are mocked.
 *
 * Verifies:
 *   (1) Every manifest ships the nodes vocabulary (no legacy `sections`,
 *       no inline {ru,en} label objects — labels are i18n key strings).
 *   (2) Each page renders: section titles, table headers, table rows
 *       (via mocked command responses), field labels and buttons.
 *   (3) Labels resolve through the real t() + registered plugin bundles
 *       in both en and ru locales.
 */

import { readFileSync } from 'node:fs';
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

describe('declarative plugin manifests render through DeclarativePage', () => {
  const savedLocale = getLocale();

  beforeEach(() => {
    jest.clearAllMocks();
    setLocale('en');
  });

  afterEach(() => {
    for (const id of ['stitch-notebooklm', 'stitch-totp', 'stitch-sheets']) {
      unregisterPluginBundles(id);
    }
    setLocale(savedLocale);
  });

  it('all three manifests use the nodes vocabulary with string i18n-key labels', () => {
    for (const dir of ['stitch-notebooklm', 'stitch-totp', 'stitch-sheets']) {
      assertStringLabels(loadManifest(dir));
    }
  });

  it('stitch-notebooklm page renders title, table rows, fields and buttons (en)', async () => {
    const manifest = loadManifest('stitch-notebooklm');
    install(manifest);
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
    expect(screen.getByText('Create Notebook')).toBeTruthy();
    expect(screen.getByText('Ask')).toBeTruthy();
  });

  it('stitch-totp page renders keys table, add/remove form and switches to ru', async () => {
    const manifest = loadManifest('stitch-totp');
    install(manifest);

    // The Add Key button binds its params to the page fields via paramsFrom;
    // the form fields carry i18n-key placeholders.
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
    // remove_key stays row-scoped static params — row-scoped table actions
    // are deliberately out of the declarative vocabulary for now.
    const removeButton = pageNodes.find(
      (n): n is Extract<UiNode, { kind: 'button' }> =>
        n.kind === 'button' && n.id === 'remove-key',
    );
    expect(removeButton?.paramsFrom).toBeUndefined();
    const labelField = pageNodes.find(
      (n): n is Extract<UiNode, { kind: 'field' }> =>
        n.kind === 'field' && n.id === 'label-field',
    );
    const secretField = pageNodes.find(
      (n): n is Extract<UiNode, { kind: 'field' }> =>
        n.kind === 'field' && n.id === 'secret-field',
    );
    expect(labelField?.placeholder).toBe('totp.labelPlaceholder');
    expect(secretField?.placeholder).toBe('totp.secretPlaceholder');

    (safeInvoke as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd === 'plugin.stitch-totp.list_keys') {
        return Promise.resolve([
          { label: 'Kiro', issuer: 'AWS', secret: 'JBSWY3DPEHPK3PXP', enabled: true },
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
    // Row data from the bare-array list_keys response.
    await waitFor(() => {
      expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeTruthy();
    });
    expect(screen.getByText('Kiro')).toBeTruthy();
    // Buttons resolved from bundle keys.
    expect(screen.getByText('Add Key')).toBeTruthy();
    expect(screen.getByText('Remove Key')).toBeTruthy();
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
    expect(screen.getByText('Удалить ключ')).toBeTruthy();
    expect(screen.getByPlaceholderText('например, Kiro')).toBeTruthy();
  });

  it('stitch-sheets page renders both tables via rowsKey and the oauth button', async () => {
    const manifest = loadManifest('stitch-sheets');
    install(manifest);
    const dataset = {
      identities: [
        { identity_id: 'i-1', display_name: 'Alice', email: 'alice@x.io', status: 'active' },
      ],
      links: [
        {
          link_id: 'l-1',
          identity_id: 'i-1',
          provider: 'tiktok',
          account_id: 'acc-9',
          role: 'owner',
          status: 'active',
        },
      ],
    };
    (safeInvoke as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd === 'plugin.stitch-sheets.fetch_dataset') {
        return Promise.resolve(dataset);
      }
      return Promise.resolve({});
    });

    render(
      <DeclarativePage
        pluginId={manifest.id}
        schema={manifest.contributions.ui.page as PluginPageSchema}
      />,
    );

    expect(screen.getByText('Identity Graph')).toBeTruthy();
    expect(screen.getByText('Identities')).toBeTruthy();
    expect(screen.getByText('Links')).toBeTruthy();

    // rowsKey "identities" feeds the first table, "links" the second.
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeTruthy();
    });
    expect(screen.getByText('alice@x.io')).toBeTruthy();
    expect(screen.getByText('tiktok')).toBeTruthy();
    expect(screen.getByText('acc-9')).toBeTruthy();

    expect(screen.getByText('Connect Google')).toBeTruthy();
  });
});
