# Solve Note

This file is a historical closeout note for future agents reading the model
profile authoring UI plan. The workstream is closed; use the structure docs and
live source as the current behavior reference.

## Manager Instructions

1. Read `README.md`, `status.md`, `plan.md`, and `phases/README.md` before
   choosing a phase.
2. Re-check source symbols before editing. Paths in the plan are anchors, not a
   substitute for reading current code.
3. For new follow-up work, keep changes narrow and re-check the existing schema,
   resolver, command, UI, and generation contracts before editing.
4. Prefer row-oriented profile commands for UI changes. Whole-array settings
   patches remain compatibility paths.
5. Preserve legacy flat fields as compatibility data unless a phase explicitly
   retires one.
6. The full editor now exists. Do not regress Roles/Profiles tabs, profile
   provider panels, runtime defaults, fallbacks, conversion, or generation
   guardrails without updating tests and docs.

## Important Current Facts

- The previous `.archived-docs/generation-and-models/model-config-profiles/` workstream is closed.
- Durable profile records and role bindings already exist.
- Phase 0 is complete: records now support optional `providerId`, expanded
  provider options, raw model fallback rows, `modelRuntimeDefaults`, and
  Vertex private key masking.
- Phase 1 is complete: resolved profiles now expose ready/incomplete/
  compatibility/unsupported status, explicit broken durable bindings stay
  incomplete, and profile-bound runtime precedence uses `modelRuntimeDefaults`
  before profile overrides.
- Phase 2 is complete: atomic profile row commands, role binding updates,
  runtime defaults updates, create-and-bind, delete reassignment, duplication,
  legacy conversion, client wrappers, and `modelProfile` targeted projection now
  exist.
- Phase 3 is complete: Settings -> Model now uses a profile-first shell with
  Roles and Profiles tabs, command-backed role binding drafts, profile list
  action shells, runtime defaults summary, a legacy conversion prompt, and
  Advanced Legacy Settings for old role controls.
- Phase 4 is complete: Settings -> Model Profiles now has a full
  command-backed editor drawer for first-class providers, runtime defaults,
  profile runtime overrides, fallbacks, and profile-local secret placeholder
  behavior.
- Custom API profile dispatch supports optional API keys for local
  unauthenticated OpenAI-compatible endpoints.
- Phase 5 is complete: active incomplete/unsupported durable profiles now fail
  early in browser and server generation paths, and server chat assembly applies
  profile-bound model/runtime fields from the effective generation config.
- Phase 6 is complete: closeout docs were refreshed, compatibility caveats were
  recorded, the full requested validation matrix passed, browser smoke passed,
  and `pnpm dev:agent` was stopped after smoke.

## Recommended Next Slice

No slice remains in this workstream. Open a new plan for future provider panels,
profile import/export UI, legacy field retirement, or automated smoke expansion.
