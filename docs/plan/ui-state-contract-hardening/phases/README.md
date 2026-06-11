# UI State Contract Hardening Phases

Date: 2026-06-11

Concrete phase scope lives in this directory. Use these files as the phase
router for implementation agents. Concrete agent-executable slices live under
[`slices/`](slices/), following the archived v2 layout pattern.

- Phase 0, complete:
  [`phase-0-command-baseline.md`](phase-0-command-baseline.md).
- Phase 1, complete:
  [`phase-1-current-doc-policy.md`](phase-1-current-doc-policy.md).
- Phase 2, complete:
  [`phase-2-selector-hardening.md`](phase-2-selector-hardening.md).
- Phase 3, complete:
  [`phase-3-sidebar-route-refreeze-dom.md`](phase-3-sidebar-route-refreeze-dom.md).
- Phase 4, complete:
  [`phase-4-composed-generation-settings-ui.md`](phase-4-composed-generation-settings-ui.md).
- Phase 5, complete:
  [`phase-5-browser-smoke-and-coverage-map.md`](phase-5-browser-smoke-and-coverage-map.md).
- Phase 6, planned next:
  [`phase-6-verification-closeout.md`](phase-6-verification-closeout.md).

## Slice Rules

- One phase should land as one or more small implementation slices under
  `slices/[phase-slug]/`.
- Each slice needs a visible contract, source anchors, done criteria, and
  validation.
- Prefer adding selectors before tests that depend on them.
- Use Playwright only when the behavior requires real browser plus Fastify
  timing.
- Record phase proof in `../latest-verification.md`.
- Proof-only refresh slices should make no runtime changes; they should update
  `../status.md` and `../latest-verification.md` only after commands actually
  pass or caveats are explicitly recorded.
