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
 *
 * REVISION RULE:
 *   The vocabulary is the frozen v2 contract — node kinds and their
 *   fields only change by a schema revision. Revisions are ADDITIVE:
 *   existing kinds keep their fields, new kinds/fields are optional, and
 *   the renderer tolerates unknown kinds. Applied so far: `rowActions`
 *   on the table node (row-scoped actions, see `RowAction`).
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
 * Row-scoped table action — a button rendered for EVERY row of a table
 * node in an extra trailing actions column (additive v2 revision).
 *
 * On click the final params are `{...params}` with every `paramsFromRow`
 * entry overridden by the clicked row's value for the referenced column
 * key. A column key missing from the row omits that param entirely (the
 * renderer warns once). The command runs through the same
 * `plugin.{pluginId}.{command}` invoke path as button nodes; a
 * successful invocation refetches the table's source command.
 * Destructive actions use `variant: 'danger'`, which prompts a confirm
 * dialog before invoking.
 */
export interface RowAction {
  id: string;
  /** Button label — resolved like node labels (i18n key or plain string). */
  label: string;
  /** Plugin command invoked as `plugin.{pluginId}.{command}`. */
  command: string;
  variant?: ButtonVariant;
  /** Static params merged into every invocation. */
  params?: Record<string, unknown>;
  /**
   * Row→param binding: maps a param key to a COLUMN KEY of the table's
   * rows (the row objects returned by the source command — they may
   * carry more keys than the table displays). The row analogue of the
   * button node's `paramsFrom`.
   */
  paramsFromRow?: Record<string, string>;
}

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
      /**
       * Optional placeholder hint shown while the field is empty (text and
       * select). Resolved like `label`: a string containing a dot is
       * treated as an i18n key (`plugin.{id}.{key}`), anything else
       * renders as-is.
       */
      placeholder?: string;
    }
  | {
      kind: 'table';
      id: string;
      columns: TableColumn[];
      source: TableSource;
      rowsKey?: string;
      /**
       * Optional row-scoped actions (additive v2 revision). Each action
       * renders as a button in an extra trailing column on every row;
       * see `RowAction`. Destructive actions use `variant: 'danger'`.
       */
      rowActions?: RowAction[];
    }
  | {
      kind: 'button';
      id: string;
      label: string;
      command: string;
      params?: Record<string, unknown>;
      variant?: ButtonVariant;
      /**
       * Field→param binding: maps a param key to the `id` of a field node
       * on the same page (fields nested in sections participate too — the
       * field state map is page-scoped). On click the final params are
       * `{...params}` with every key listed here overridden by the current
       * value of the referenced field. A referenced field id that does not
       * exist on the page omits that key from the params entirely (the
       * renderer warns once). Buttons WITHOUT `paramsFrom` send `params`
       * unchanged.
       *
       * The row analogue — params bound to a table ROW, e.g. a per-row
       * delete button like totp's `remove_key` — lives on the table
       * node: see `rowActions` / `RowAction.paramsFromRow`.
       */
      paramsFrom?: Record<string, string>;
    };

/** Top-level schema for a declarative plugin page. */
export interface PluginPageSchema {
  title?: string;
  nodes: UiNode[];
}
