# Solve Note

This file is for future implementation agents working on the model profile
authoring UI plan.

## Manager Instructions

1. Read `README.md`, `status.md`, `plan.md`, and `phases/README.md` before
   choosing a phase.
2. Re-check source symbols before editing. Paths in the plan are anchors, not a
   substitute for reading current code.
3. Keep phase changes narrow. Do not jump straight into the UI before schema,
   resolver, and command contracts can support it.
4. Prefer row-oriented profile commands for UI changes. Whole-array settings
   patches remain compatibility paths.
5. Preserve legacy flat fields as compatibility data unless a phase explicitly
   retires one.
6. Do not claim the full editor exists until Roles/Profiles tabs, profile
   provider panels, runtime defaults, fallbacks, conversion, and generation
   guardrails are all implemented and verified.

## Important Current Facts

- The previous `.archived-docs/model-config-profiles/` workstream is closed.
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
- Runtime Defaults storage and resolver precedence exist, but visible editing
  does not exist yet.
- Full provider editor panels, runtime defaults editing, fallback editing, and
  generation guardrails do not exist yet.

## Recommended Next Slice

Continue with Phase 4. It should replace the profile action shells with the full
profile editor for first-class providers, runtime defaults, and fallbacks
without implementing generation guardrails yet.
