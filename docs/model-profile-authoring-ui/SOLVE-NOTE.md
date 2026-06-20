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
- Current visible model UI still edits legacy flat compatibility fields.
- `modelProfileUiState` currently drives global provider panel visibility; this
  is not the future profile-first UI behavior.
- `resolveModelProfile()` currently tolerates broken durable selections by
  falling back to legacy; the new design intentionally changes that for explicit
  profile bindings.
- `providerSecrets.ts` currently masks profile-local `apiKey` only.
- Runtime Defaults do not exist yet.

## Recommended First Slice

Start with Phase 0. It is the contract foundation:

- profile `providerId`
- provider option shape expansion
- raw model fallback rows
- `modelRuntimeDefaults`
- storage/default preservation
- Vertex private key masking

Do not start with the Svelte editor; it will otherwise have to encode legacy
workarounds that the plan is trying to remove.

