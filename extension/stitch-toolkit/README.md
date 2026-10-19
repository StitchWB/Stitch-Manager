# Stitch Toolkit (Chrome Extension, MV3)

Unified Stitch browser extension. Merged from the former `stitch-scenario-runner`
(canonical WS bridge + record/replay engine) and the original `stitch-toolkit`
(CloakBrowser tool panel). One extension serves both contexts:

1. **Interactive Chrome** — scenario recording/replay for the Stitch app
   ("Extension runner" mode) via a localhost WebSocket bridge.
2. **CloakBrowser profiles** — floating tool panel used during auto-registration
   (Stripe form filler, recorder, settings). Loaded automatically by
   `python/autoreg/**` via `--load-extension`.

## Install (manual)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this folder (`extension/stitch-toolkit`)

The Stitch app shows the same checklist in **Settings → Extension**.

## Features

| Area | What it does |
| --- | --- |
| Panel (float button) | Stripe card filler (multi-frame, billing address), scenario recorder, settings, themes (auto/dark/light), RU/EN |
| Recorder | Steps captured by the content stack with rich selectors + sensitive-field redaction; live step list; pause/resume; manual steps |
| Replay engine | DOM steps (click/input/change/submit/nav/keydown/scroll), manual steps, iframe targeting, shadow-DOM piercing, locator fallbacks |
| Overlay HUD | In-page Record/Replay status panel with Pause/Resume/Stop/Manual controls (localized) |
| Scenario library | Saved scenarios in `chrome.storage` (keep last 50): replay / export / delete from the panel |
| Bridge status | Settings tab shows live record/replay/health connection state |

## WS bridge protocol

Ports are defined in `shared.js` and must match the Python side:

| Channel | Port | Python side |
| --- | --- | --- |
| record | 18731 | `python/run_extension_record.py` |
| replay | 18732 | `python/run_extension_replay.py` |
| health | 18733 | `python/probe_extension_bridge.py` (ping/pong) |

The extension is a WS **client**; Python jobs host the servers and wait up to
120s for the extension to connect. Connection lifecycle:

- On service-worker start the bridges connect once (guarded to at most once per
  45s across SW restarts), then a 1-minute `chrome.alarms` re-arm retries failed
  channels. This avoids connection spam in CloakBrowser profiles where Stitch
  is not running.
- On connect the extension sends `hello`; Python replies with `start_record` /
  `start_replay`.

Record channel: `start_record`, `stop_record`, `control` (pause/resume) →
extension streams `record_event`, `record_stopped`, `record_error`,
`session_active`.

Replay channel: `start_replay` (with steps), `stop_replay`, `control`
(pause/resume/stop) → extension streams `replay_step_start/done/waiting/fail`,
`replay_finished`, `replay_error`, `session_active`.

Health channel: `ping` → `pong` (nonce echoed).

## Architecture

```
manifest.json            MV3, two content_scripts entries
shared.js                ports, storage keys, version (ESM, background only)
session-manager.js       atomic session state (record/replay) for the SW
background.js            service worker: WS bridge, replay engine, tk:* handlers,
                         Stripe fill/detect injection, alarms re-arm
overlay_runtime.js       overlay shell + styles (all frames, document_start)
content_state.js         per-frame recorder state + cleanup controller
content_redaction.js     sensitive-field value masking
content_selectors.js     stable selector/locator generation
content_overlay.js       overlay render/controls + i18n (ovT helper)
content_recorder.js      click/input/change/submit/keydown/scroll/nav capture
content_runner.js        overlay bootstrap + chrome.runtime message wiring
i18n.js                  EN/RU dictionary (loaded in both content entries)
content.js               panel UI (float button, tabs, drag, themes) + RecorderBridge
panel/panel.css          panel design system (Deep Space, tokens, reduced-motion)
panel/tools/*.js         stripe-filler / recorder-tool / settings-tool
```

Content entries:

- `document_start`, `all_frames: true` — recorder/overlay stack (+ `i18n.js`)
- `document_idle`, top frame only — panel UI + tools

## Tests

```bash
node extension/stitch-toolkit/test-all.cjs
```

- `test.cjs` — syntax, manifest consistency, CSS braces, architecture rules
- `test-integration.cjs` — panel bootstrap in JSDOM (UI, tools, i18n, persistence)
- `test-background.cjs` — service-worker smoke test: WS protocol (hello,
  start/stop record, record_event forwarding, control pause, health ping/pong),
  tk:* handlers
- `e2e_test.mjs` — real Chrome via playwright-core: bridge record flow + overlay
  controls + panel. Requires `npm i -D playwright-core` and system Chrome.

## Known limits (extension mode)

- Cross-origin iframes (e.g. Stripe hosted fields) may not record/replay.
- `proxy.switch` steps are skipped; proxy handling belongs to the native
  (Playwright) runner.
