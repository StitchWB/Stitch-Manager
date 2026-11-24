# Devbox Design Contract

## Product intent

Devbox is an operator console, not a marketing page. Within five seconds the
Overview must answer three questions: is the code bridge usable, how does the
agent reach this machine, and is an agent session active. Everything else is
progressively disclosed.

The supplied HTML prototype is the visual and state reference, not source code
to copy. Build the surface with Stitch Manager primitives, real RPC data and
the existing application shell. Do not add demo controls or a second app rail.

## Foundations

### Color

Use semantic UI-kit variables where they exist. These prototype values are the
visual target when a Devbox-specific semantic token is required.

| Role | Value | Usage |
| --- | --- | --- |
| Canvas | `#0a0a0e` | Page background |
| Raised canvas | `#0e0e13` | Secondary page regions |
| Panel | `#131318` | Cards and populated rows |
| Panel raised | `#17171e` | Inputs, selected and nested surfaces |
| Panel highlight | `#1c1c25` | Hover and modal surfaces |
| Border | `#272731` | Default control boundaries |
| Border subtle | `#202029` | Card and row separators |
| Text | `#ededf3` | Primary content |
| Text muted | `#9898a8` | Supporting content |
| Text faint | `#6f6f80` | Metadata; never essential instructions |
| Accent | `#9b7bff` | Selected, focused and primary actions |
| Accent bright | `#c4b1ff` | Accent text on dark surfaces |
| Success | `#44d6a1` | Healthy and completed |
| Warning | `#f5bd6a` | Degraded, stale and awaiting input |
| Danger | `#ff7676` | Failed and destructive |
| Info | `#7aa8ff` | Running and informational |

Tinted status backgrounds use the corresponding color at approximately 12%
opacity. Never communicate state by color alone: pair it with text and, where
useful, an icon or status dot. Keep decorative gradients limited to the
Overview hero and selected cards; operational panels stay quiet.

### Typography

- Font: Inter with the existing system sans-serif fallback.
- Base: 13px at 1.45 line height; metadata may use 10–12px only when secondary.
- Page title: 23px, weight 650, tight letter spacing; 20px on narrow screens.
- Panel and section titles: 13–15px, weight 650.
- Labels: 10–11px, weight 700, modest uppercase tracking.
- Commands, URLs, ports, logs and tokens: the existing monospace stack,
  normally 11–13px. Long values wrap or truncate with an accessible full-value
  copy action; never overflow the viewport.

### Shape, spacing and icons

- Control radius: 8–9px; cards: 11–14px; hero: 16px.
- Use the existing 4px-based spacing rhythm. Typical card padding is 14–18px,
  hero padding 22px, and grid gaps 10–16px.
- Devbox content maximum width is 1720px, with 22px 28px 60px desktop padding.
- Use the repository icon set at 16px by default, 14px for compact controls and
  20px for hero/status marks. No emoji or prototype SVG sprite.

## Shell and navigation

Keep the existing AI Hub route, project selector, page header and scroll owner.
The Devbox content owns only its internal layout and scrolling.

Six tabs in fixed order:

1. Overview
2. Connect
3. Agent
4. Services
5. Projects
6. Logs

Tabs use the existing tab primitive, remain horizontally scrollable on narrow
screens, and expose counts only when they aid triage (for example pending
permissions). A tab change must not reset polling, form drafts or server state.

## View composition

### Overview

Desktop hero grid: primary bridge card and a narrower next-steps column.
Primary content order: health headline, canonical code endpoint, compact
pipeline, then actions. The endpoint remains copyable even when health is
degraded. Next steps contain at most three short actions; supporting metrics
sit beside or below them. Stack details, recent activity and quick links are
secondary content below the hero.

### Connect

Desktop grid: settings on the left, contextual handoff on the right. The
handoff may be sticky on wide screens and becomes static below 1250px.

Settings order:

1. Detection/recommendation feedback.
2. Agent location: exactly two choices, external sandbox or chat MCP.
3. Machine reachability: AUTO, CLOUDFLARE, RELAY and MANUAL cards, each with
   concise what/when/need help and a Now/Need/Chain explanation.
4. Agent access mode.
5. Three reliability cards: timeout, egress and watchdog.
6. Advanced settings inside a collapsed disclosure.

The right panel switches with agent location rather than duplicating content:
sandbox shows canonical handoff and bootstrap; chat shows MCP configuration,
endpoints, compatibility guidance and discovered tools. Tokens have one home
in Connect, including reveal/copy/rotation feedback and the local-only cockpit
port 8793 hard-deny explanation.

### Agent

Two columns on wide screens: active session and permission queue. Jobs and
recent agent actions follow below. The session area exposes the 10 native + 6
control tool inventory as read-only protocol facts; it must not imply that
individual bridge tools can be toggled unless the backend supports that action.
Empty queues are calm and explicit. Pending permissions keep approve/reject
actions adjacent to the relevant command or diff.

### Services

Three levels, in order:

1. Always-visible focus rows: Code Bridge, Path to Machine, Agent Session.
2. Collapsed additional capabilities: runner commands, owner MCP gateway and
   manifest access.
3. Collapsed infrastructure and policy: service cards, allowed/denied ports,
   lifecycle actions and diagnostics.

Default-deny MCP servers remain visible but locked and labelled. Port 8793 is
never offered as an allowed ingress port. Tokens are linked to Connect, not
repeated here.

### Projects

Reuse the working profile editor and RPC flow. Project cards lead to a detail
region with profile summary, toolchain and environment data. Advanced JSON is
read-only unless the existing editor explicitly supports editing it. Empty and
invalid profiles provide a concrete next action.

### Logs

Preserve the working console behavior: source/severity filters, search,
autoscroll, copy and clear. Keep the log stream dense and monospace, with its
own bounded scroll region rather than growing the entire page indefinitely.

## Primitive and interaction rules

- Compose Button, Badge, GlassCard/panels, TabButton, SegmentedControl, Input,
  Select, Toggle, Modal, Tooltip, disclosures, FormGrid and EmptyState before
  creating local replacements.
- A shared code-display primitive owns monospace presentation, bounded scroll
  and copy feedback. A shared inline notice primitive owns info/success/
  warning/danger anatomy and optional actions. Add minimal reusable kit
  primitives only where the current kit has no equivalent.
- Copy actions use icon-to-check feedback and a tooltip; do not rely on toast
  alone. Only the clicked action enters its busy state.
- Mutations show pending, success and failure feedback. Destructive lifecycle,
  rotation and deletion actions require explicit confirmation.
- Stale data remains visible with a stale label; never replace last known
  health with a misleading green state. Token rotation invalidates prior probe
  results and dependent handoff/session presentation.
- Loading uses existing skeleton/spinner primitives. Empty states explain the
  next action. Errors preserve usable data and expose diagnostic detail without
  dumping secrets.

## Motion and accessibility

- Hover, selection and disclosure transitions: 120–180ms ease. Avoid animating
  layout dimensions when opacity, border or background is sufficient.
- Busy spinners and running-job animation must not shift surrounding layout.
- Toasts may enter with a short 250ms fade/translate. Copy feedback should not
  change the button width.
- Respect `prefers-reduced-motion`: remove translation, spin/flow animation and
  smooth scrolling while preserving immediate state changes.
- All actions are keyboard reachable with visible focus. Icon-only buttons have
  accessible names; tooltip content is available on focus as well as hover.
- Disabled controls explain why when the reason is not obvious. Status text and
  essential metadata meet contrast expectations on tinted surfaces.
- Every user-facing string goes through `t()` with matching Russian and English
  entries. Russian copy follows the supplied prototype; English is equivalent,
  not a literal transliteration.

## Responsive behavior

- Above 1250px: two-column hero, Connect and Agent layouts; three-column
  supporting grids where content fits without truncation.
- 861–1250px: major two-column regions become one column; sticky handoff is
  disabled; service/support grids reduce to two columns.
- 561–860px: content padding reduces to 16px; all major grids are single
  column; mode cards may use two columns; tabs scroll horizontally.
- Up to 560px: primary actions wrap or fill available width, hero text scales
  down, dense metrics use two or three columns only without clipping, and log
  metadata wraps above the message. No horizontal page overflow at 400px.

The existing application shell remains authoritative at every breakpoint.

## Implementation boundary

No prototype CSS/HTML wholesale, raw native controls outside the kit, fake RPC
state, hardcoded demo values or new global navigation. Preserve the real
resolve/probe/desired/token/session model and backend redaction. New visual
work must ship with semantic tests for the specified handoff, tool inventory,
state invalidation and security policy, followed by browser verification at
desktop and narrow widths with reduced-motion and keyboard checks.

<dcp-message-id>m0021</dcp-message-id>