# Contributing to Stitch Manager

Stitch Manager is an open-core universal account manager for AI-powered IDEs.
This repository is the **public source of truth for the client**. Registration
methods are NOT here — they are distributed as signed plugins through a gated
channel.

## Zone discipline (IMPORTANT)

This repo must stay free of registration-method code. When opening a PR:

- **Do NOT** add imports of `autoreg.providers` or `autoreg.captcha`.
- **Do NOT** add captcha-solver code, bypass code, or provider registration flows.
- CI runs a **zone-boundary leak guard** (`python/scripts/check_zone_boundary.py`)
  that fails the PR if any method code leaks in.

If you need provider-specific behavior, it belongs in a **plugin**, not in the
client. See `docs/plugin-authoring.md` and the plugin template repo
(`StitchWB/stitch-plugin-template`).

## Development setup

```bash
# Frontend
npm install
npm run dev

# Python backend (from python/)
pip install -e ".[dev]"
```

## Running checks locally

```bash
# Frontend
npx tsc --noEmit
npx jest --no-coverage --passWithNoTests
npm run lint --if-present

# Python (from python/)
python scripts/check_zone_boundary.py   # zone-boundary leak guard
ruff check .
mypy stitch_backend
```

## PR checklist

Before opening a PR, confirm:

- [ ] No registration-method code (no `autoreg.providers` / `autoreg.captcha` imports).
- [ ] `check_zone_boundary.py` passes.
- [ ] `ruff` and `mypy` pass.
- [ ] Frontend `tsc`, `jest`, and build pass.
