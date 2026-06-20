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
- Current visible model UI still edits legacy flat compatibility fields.
- `modelProfileUiState` currently drives global provider panel visibility; this
  is not the future profile-first UI behavior.
- Runtime Defaults storage and resolver precedence exist, but visible editing
  does not exist yet.

## Recommended Next Slice

Continue with Phase 3. It should build the Settings -> Model Roles/Profiles
shell, conversion prompt/compatibility panel, and command-backed role/profile
surfaces without implementing the full provider editor panels yet.
