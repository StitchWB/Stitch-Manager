import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from '@jest/globals';
import type {
  CardTone,
  PluginPageSchema,
  UiNode,
} from '@/components/plugin-ui/schema';
import { pluginUi as enPluginUi } from '@/lib/locales/en/pluginUi';
import { pluginUi as ruPluginUi } from '@/lib/locales/ru/pluginUi';

type ButtonNode = Extract<UiNode, { kind: 'button' }>;
type TableNode = Extract<UiNode, { kind: 'table' }>;
type CardGridNode = Extract<UiNode, { kind: 'card_grid' }>;
type MarkdownNode = Extract<UiNode, { kind: 'markdown' }>;
type FieldNode = Extract<UiNode, { kind: 'field' }>;

function roundTrip(page: PluginPageSchema): PluginPageSchema {
  return JSON.parse(JSON.stringify(page)) as PluginPageSchema;
}

describe('declarative schema v2.1 additive fields', () => {
  it('button node accepts confirm and refreshOnSuccess', () => {
    const page: PluginPageSchema = {
      nodes: [
        {
          kind: 'button',
          id: 'restart',
          label: 'plugin.demo.restart',
          command: 'restart',
          confirm: 'plugin.demo.confirmRestart',
          refreshOnSuccess: ['services', 'readme'],
        },
      ],
    };
    const button = roundTrip(page).nodes[0] as ButtonNode;
    expect(button.confirm).toBe('plugin.demo.confirmRestart');
    expect(button.refreshOnSuccess).toEqual(['services', 'readme']);
  });

  it('table, card_grid and markdown accept source.refreshMs and empty key', () => {
    const page: PluginPageSchema = {
      nodes: [
        {
          kind: 'table',
          id: 'keys',
          columns: [{ key: 'label', label: 'Label' }],
          source: { command: 'list_keys', refreshMs: 15000 },
          empty: 'plugin.demo.noKeys',
        },
        {
          kind: 'card_grid',
          id: 'services',
          source: { command: 'list_services', refreshMs: 30000 },
          empty: 'plugin.demo.noServices',
          card: { title: 'name' },
        },
        {
          kind: 'markdown',
          id: 'readme',
          source: { command: 'get_readme', refreshMs: 60000 },
          empty: 'plugin.demo.noReadme',
        },
      ],
    };
    const nodes = roundTrip(page).nodes;
    const table = nodes[0] as TableNode;
    const grid = nodes[1] as CardGridNode;
    const markdown = nodes[2] as MarkdownNode;
    expect(table.source.refreshMs).toBe(15000);
    expect(table.empty).toBe('plugin.demo.noKeys');
    expect(grid.source.refreshMs).toBe(30000);
    expect(grid.empty).toBe('plugin.demo.noServices');
    expect(markdown.source.refreshMs).toBe(60000);
    expect(markdown.empty).toBe('plugin.demo.noReadme');
  });

  it('card template accepts tone and hint, static and row-bound', () => {
    const staticTone: CardTone = 'warn';
    const page: PluginPageSchema = {
      nodes: [
        {
          kind: 'card_grid',
          id: 'vitals',
          source: { command: 'overview' },
          card: { title: 'name', tone: staticTone, hint: 'plugin.demo.hint' },
        },
        {
          kind: 'card_grid',
          id: 'rowbound',
          source: { command: 'overview' },
          card: { title: 'name', tone: 'status_tone', hint: 'detail' },
        },
      ],
    };
    const nodes = roundTrip(page).nodes;
    expect((nodes[0] as CardGridNode).card.tone).toBe('warn');
    expect((nodes[0] as CardGridNode).card.hint).toBe('plugin.demo.hint');
    expect((nodes[1] as CardGridNode).card.tone).toBe('status_tone');
    expect((nodes[1] as CardGridNode).card.hint).toBe('detail');
  });

  it('toggle field accepts a readonly source binding', () => {
    const page: PluginPageSchema = {
      nodes: [
        {
          kind: 'field',
          field: 'toggle',
          id: 'ingress',
          label: 'plugin.demo.ingress',
          source: { command: 'ingress_status', refreshMs: 10000 },
          valueKey: 'up',
        },
      ],
    };
    const field = roundTrip(page).nodes[0] as FieldNode;
    expect(field.source).toEqual({ command: 'ingress_status', refreshMs: 10000 });
    expect(field.valueKey).toBe('up');
  });

  it('v2 pages without any v2.1 field remain valid', () => {
    const page: PluginPageSchema = {
      title: 'plugin.demo.title',
      nodes: [
        { kind: 'heading', text: 'plugin.demo.heading' },
        {
          kind: 'table',
          id: 'keys',
          columns: [{ key: 'label', label: 'Label' }],
          source: { command: 'list_keys' },
        },
      ],
    };
    const nodes = roundTrip(page).nodes;
    expect((nodes[1] as TableNode).empty).toBeUndefined();
    expect((nodes[1] as TableNode).source.refreshMs).toBeUndefined();
  });

  it('unknown node kinds and unknown fields survive parse per the revision rule', () => {
    const manifest = JSON.stringify({
      title: 'plugin.demo.title',
      nodes: [
        { kind: 'future_kind', id: 'x', anything: true },
        { kind: 'button', id: 'b', label: 'L', command: 'c', futureField: 42 },
      ],
    });
    const page = JSON.parse(manifest) as PluginPageSchema;
    expect(page.nodes).toHaveLength(2);
    expect(page.nodes[0].kind).toBe('future_kind');
    expect((page.nodes[1] as { futureField?: number }).futureField).toBe(42);
  });

  it('pluginUi.actionSucceeded ships in en and ru bundles', () => {
    expect(enPluginUi.pluginUi.actionSucceeded.length).toBeGreaterThan(0);
    expect(ruPluginUi.pluginUi.actionSucceeded.length).toBeGreaterThan(0);
  });
});

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const PLUGINS_SRC = resolve(REPO_ROOT, 'plugins-src');
const describeIfPlugins = existsSync(PLUGINS_SRC) ? describe : describe.skip;

describeIfPlugins('existing plugin manifests', () => {
  it('every declarative plugin.json still parses as PluginPageSchema', () => {
    let checked = 0;
    for (const dir of readdirSync(PLUGINS_SRC)) {
      const manifestPath = resolve(PLUGINS_SRC, dir, 'plugin.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        contributions?: { ui?: { kind?: string; page?: PluginPageSchema } };
      };
      if (manifest.contributions?.ui?.kind !== 'declarative') continue;
      const page = manifest.contributions.ui.page;
      checked += 1;
      expect(page).toBeDefined();
      expect(Array.isArray(page?.nodes)).toBe(true);
    }
    expect(checked).toBeGreaterThan(0);
  });
});
