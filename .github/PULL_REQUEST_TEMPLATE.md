## Summary

<!-- What does this PR change, and why? -->

## Zone-boundary checklist (REQUIRED)

- [ ] This PR contains **no** registration-method code.
- [ ] No imports of `autoreg.providers` or `autoreg.captcha`.
- [ ] No captcha-solver code, bypass code, or provider registration flows.
- [ ] `python scripts/check_zone_boundary.py` passes.

## Checks

- [ ] `ruff check .` passes
- [ ] `mypy stitch_backend` passes
- [ ] Frontend `tsc`, `jest`, and build pass

## Notes

<!-- Anything reviewers should know (provider-specific behavior belongs in a
plugin, not the client — see docs/plugin-authoring.md). -->
