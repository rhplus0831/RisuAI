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
- Current visible model UI still edits legacy flat compatibility fields.
- `modelProfileUiState` currently drives global provider panel visibility; this
  is not the future profile-first UI behavior.
- `resolveModelProfile()` currently tolerates broken durable selections by
  falling back to legacy; the new design intentionally changes that for explicit
  profile bindings.
- Runtime Defaults storage exists, but resolver/default precedence behavior is a
  Phase 1 concern.

## Recommended Next Slice

Continue with Phase 1. It should make provider-first resolution,
`modelRuntimeDefaults` precedence, explicit broken-binding errors, and profile
status helpers real before the Svelte editor starts depending on them.
