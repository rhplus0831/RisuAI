# UI State Contract Hardening Phases

Date: 2026-06-11

Concrete phase scope lives in this directory. Use these files as the handoff
surface for implementation agents.

- Phase 0, complete:
  [`phase-0-command-baseline.md`](phase-0-command-baseline.md).
- Phase 1, planned:
  [`phase-1-current-doc-policy.md`](phase-1-current-doc-policy.md).
- Phase 2, planned:
  [`phase-2-selector-hardening.md`](phase-2-selector-hardening.md).
- Phase 3, planned:
  [`phase-3-sidebar-route-refreeze-dom.md`](phase-3-sidebar-route-refreeze-dom.md).
- Phase 4, planned:
  [`phase-4-composed-generation-settings-ui.md`](phase-4-composed-generation-settings-ui.md).
- Phase 5, planned:
  [`phase-5-browser-smoke-and-coverage-map.md`](phase-5-browser-smoke-and-coverage-map.md).
- Phase 6, planned:
  [`phase-6-verification-closeout.md`](phase-6-verification-closeout.md).

## Slice Rules

- One phase should land as one or more small implementation slices.
- Each slice needs a visible contract, source anchors, done criteria, and
  validation.
- Prefer adding selectors before tests that depend on them.
- Use Playwright only when the behavior requires real browser plus Fastify
  timing.
- Record phase proof in `../latest-verification.md`.
