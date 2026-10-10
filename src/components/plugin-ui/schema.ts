/**
 * Declarative plugin UI schema — the fixed node vocabulary service plugins
 * may contribute via `contributions.ui.page`.
 *
 * BOUNDARY RULE (v2 scope):
 *   The declarative renderer supports a FIXED dictionary of node kinds:
 *   heading, section, field (text/select/toggle), table, button,
 *   card_grid, markdown, job.
 *   Pages that require capabilities OUTSIDE this dictionary — polling /
 *   realtime updates, arbitrary HTML rendering (the markdown node renders
 *   a safe subset only — no raw HTML passthrough), drag-and-drop, virtual
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
 *   on the table node (row-scoped actions, see `RowAction`), and the
 *   `card_grid` + `markdown` node kinds (additive revision — existing
 *   manifests render unchanged).
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
  /**
   * Optional polling interval in milliseconds (additive v2.1 revision).
   * When present the renderer refetches the source on this cadence;
   * absent means fetch-once/on-demand only.
   */
  refreshMs?: number;
}

/** Variant for a button node. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/** Status tone values a card can carry (additive v2.1 revision). */
export type CardTone = 'ok' | 'warn' | 'down';

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
 * Per-card action of a card_grid node (additive v2 revision). One button
 * rendered on EVERY card of the grid.
 *
 * Semantics are the card analogue of the table node's `rowActions`: on
 * click the final params are `{...params}` with every `paramsFromRow`
 * entry overridden by the clicked card's row value for the referenced
 * column key. A column key missing from the row omits that param
 * entirely (the renderer warns once). The command runs through the same
 * `plugin.{pluginId}.{command}` invoke path as button nodes; a
 * successful invocation refetches the grid's source command.
 * Destructive actions use `variant: 'danger'`, which prompts a confirm
 * dialog before invoking.
 */
export interface CardAction {
  /** Button label — resolved like node labels (i18n key or plain string). */
  label: string;
  /** Plugin command invoked as `plugin.{pluginId}.{command}`. */
  command: string;
  variant?: ButtonVariant;
  /** Static params merged into every invocation. */
  params?: Record<string, unknown>;
  /**
   * Row→param binding: maps a param key to a COLUMN KEY of the grid's
   * rows (the row objects returned by the source command — they may
   * carry more keys than the card displays). Identical semantics to
   * `RowAction.paramsFromRow`.
   */
  paramsFromRow?: Record<string, string>;
}

/**
 * Card template of a card_grid node (additive v2 revision). Each of
 * `title` / `subtitle` / `body` / `image` is resolved per row: the
 * string is FIRST treated as a COLUMN KEY of the row — if the row has
 * that key, the row's value is rendered (`''` for null/undefined); if
 * the row does NOT have the key, the string renders LITERALLY (so static
 * text like a shared subtitle works). `image` renders an `<img>` with
 * the resolved value as `src`; an empty resolved value renders no image.
 */
export interface CardTemplate {
  /** Card title — row column key first, literal string fallback. */
  title: string;
  /** Card subtitle — row column key first, literal string fallback. */
  subtitle?: string;
  /** Card body text — row column key first, literal string fallback. */
  body?: string;
  /** Card image URL — row column key first, literal URL fallback. */
  image?: string;
  /**
   * Status tone of the card (additive v2.1 revision) — row column key
   * first, literal `CardTone` fallback. Unknown resolved values render
   * as the neutral default.
   */
  tone?: CardTone | (string & {});
  /**
   * Small hint line under the card body (additive v2.1 revision) — row
   * column key first, literal string fallback (i18n keys resolve like
   * node labels).
   */
  hint?: string;
  /** Optional action button rendered on every card; see `CardAction`. */
  action?: CardAction;
}

/** Start invocation of a job node; the command must return `{jobId: string}`. */
export interface JobStart {
  command: string;
  params?: Record<string, unknown>;
  /** Field→param binding — identical semantics to the button node's `paramsFrom`. */
  paramsFrom?: Record<string, string>;
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
      /**
       * Readonly source binding for a toggle field (additive v2.1
       * revision). The toggle reflects state fetched from
       * `source.command` instead of holding user input; the response's
       * boolean lives under `valueKey`.
       */
      source?: TableSource;
      /**
       * Key of the boolean field in the `source.command` response that
       * carries the toggle state (additive v2.1 revision).
       */
      valueKey?: string;
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
      /**
       * i18n key (or literal) shown when the source returns no rows
       * (additive v2.1 revision).
       */
      empty?: string;
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
      /**
       * Confirmation prompt shown before invoking the command (additive
       * v2.1 revision). Resolved like `label` (i18n key or literal);
       * absent means invoke immediately.
       */
      confirm?: string;
      /**
       * Ids of nodes whose sources are refetched after a successful
       * invocation (additive v2.1 revision). Unknown ids are ignored.
       */
      refreshOnSuccess?: string[];
    }
  | {
      /**
       * Responsive grid of cards (additive v2 revision). `source.command`
       * is a readonly plugin command returning an array of row objects
       * (or an object wrapping the array under `"rows"`); each row
       * renders one card through the `card` template — see
       * `CardTemplate` for the row-key-first/literal-fallback field
       * resolution. The optional `card.action` renders one button per
       * card with table-rowActions semantics — see `CardAction`.
       */
      kind: 'card_grid';
      id: string;
      source: TableSource;
      card: CardTemplate;
      /**
       * i18n key (or literal) shown when the source returns no rows
       * (additive v2.1 revision).
       */
      empty?: string;
    }
  | {
      /**
       * Readonly rendered markdown (additive v2 revision).
       * `source.command` is a readonly plugin command returning an
       * object; `textKey` (default `"text"`) names the field holding the
       * markdown string. A bare string response is accepted as the
       * markdown text directly. Rendered through a safe subset renderer
       * (headings, bold, italic, inline/fenced code, links, lists,
       * paragraphs) — NO raw HTML passthrough, NO
       * `dangerouslySetInnerHTML`; links are restricted to
       * http(s)/mailto URLs.
       */
      kind: 'markdown';
      id: string;
      source: TableSource;
      textKey?: string;
      /**
       * i18n key (or literal) shown when the source returns no text
       * (additive v2.1 revision).
       */
      empty?: string;
    }
  | {
      /** Long-running command job: start returns `{jobId}`, then the renderer polls `statusCommand` until a terminal status. */
      kind: 'job';
      id: string;
      /** Node label — resolved like other node labels (i18n key or literal). */
      label?: string;
      start: JobStart;
      /** Status poll command invoked with `{jobId}`; default `"get_job"`. */
      statusCommand?: string;
      /** Cancel command invoked with `{jobId}`; default `"cancel_job"`. */
      cancelCommand?: string;
      /** Poll interval in ms; default 1000, floored at the renderer's MIN_JOB_POLL_MS. */
      pollMs?: number;
      /** Bump the page refresh signal on terminal `done` so source nodes reload; default true. */
      refreshOnSuccess?: boolean;
    };

/** Top-level schema for a declarative plugin page. */
export interface PluginPageSchema {
  title?: string;
  nodes: UiNode[];
}
