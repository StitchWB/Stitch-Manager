/**
 * Declarative plugin UI schema — the fixed node vocabulary service plugins
 * may contribute via `contributions.ui.page`.
 *
 * BOUNDARY RULE (v2 scope):
 *   The declarative renderer supports a FIXED dictionary of node kinds:
 *   heading, section, field (text/select/toggle), table, button.
 *   Pages that require capabilities OUTSIDE this dictionary — polling /
 *   realtime updates, rich-text/HTML rendering, drag-and-drop, virtual
 *   scrolling, or any arbitrary frontend code — MUST use `ui.kind=core_page`
 *   instead: a core React page that binds to the plugin's namespaced
 *   commands. This is decision A7 in the plugin-platform-v2 plan.
 *
 *   No `dangerouslySetInnerHTML`, no `eval`, no external JS loading.
 *   Extension of this dictionary into a UI framework is a v3 concern.
 */

/** A single option in a select field. */
export interface SelectOption {
  value: string;
  label: string;
}

/** A column descriptor in a table node. */
export interface TableColumn {
  key: string;
  label: string;
}

/** Data source for a table node — a readonly plugin command. */
export interface TableSource {
  command: string;
  params?: Record<string, unknown>;
}

/** Variant for a button node. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/**
 * Discriminated union of all renderable UI nodes.
 * The `kind` field is the discriminant; exhaustive switch is required.
 */
export type UiNode =
  | { kind: 'heading'; text: string; level?: number }
  | { kind: 'section'; title?: string; nodes: UiNode[] }
  | {
      kind: 'field';
      field: 'text' | 'select' | 'toggle';
      id: string;
      label: string;
      value?: string | boolean;
      options?: SelectOption[];
      readonly?: boolean;
    }
  | {
      kind: 'table';
      id: string;
      columns: TableColumn[];
      source: TableSource;
      rowsKey?: string;
    }
  | {
      kind: 'button';
      id: string;
      label: string;
      command: string;
      params?: Record<string, unknown>;
      variant?: ButtonVariant;
    };

/** Top-level schema for a declarative plugin page. */
export interface PluginPageSchema {
  title?: string;
  nodes: UiNode[];
}
