# Cross-Runtime Boundaries Next Steps

Date: 2026-08-31

## Current Best Task

Execute the [model-role resolution
slice](phases/slices/phase-3-pure-shared-core/model-role-resolution.md).

1. Move the zero-import model-role constants, types, map normalizers, aliases,
   inheritance metadata, and legacy model resolver into an explicit shared-core
   subpath.
2. Preserve exact `MODEL_ROLES` and legacy-key ordering, `model`/`submodel`
   aliases, whitespace trimming, invalid-input defaults, and nonblank-array
   filtering.
3. Preserve the rule that `chatMain`/`chatAux` ignore role overrides, auxiliary
   overrides win, separate models require the misspelled legacy gate, and
   `scriptAux` falls through `scriptAux -> otherAx -> subModel`.
4. Migrate all browser and eight Fastify production consumers, then delete the
   browser-tree owner only after differential and closed-world ownership proof.
5. Keep durable profile resolution, provider/credential policy, settings UI,
   persistence, import/export, and command orchestration unchanged.

## Foundations Released

- `@risuai/protocol/route-operation` publishes 103 stable route IDs and reviewed
  transport descriptors at `00e49d880`.
- Fastify owns a separate 103-entry auth/writer policy catalog joined by ID.
- `@risuai/protocol/durable-command-operation` publishes 129 stable retained
  command IDs and exact method/path matchers at `3f275e9dc`.
- Durable generation intent kinds point to the shared submit, cancel, and retry
  route IDs without replacing runtime generation UUIDs.
- Browser resource/cache/generation metadata publishes 55 reviewed route
  relations and seven explicit non-overlaps at `6a6d0ac1f`.
- `@risuai/shared-core` and the first duplicated chat-page leaf are released at
  `d798740f7`, with direct historical browser/Fastify oracle proof at
  `d78c67a3a`.
- Chat load-page normalization and all production consumers are released at
  `c12e807a5`.
- Chat display-tail normalization and both production consumers are released at
  `6fc15d7a1`.
- Regex output-size normalization and all eight production consumers are
  released at `83e8aabfa`.
- Legacy OpenAI model-alias normalization and all four production consumers are
  released at `23e5a4b30`.
- Internal-reasoning stripping and all five production consumers are released
  at `251c9d043`.
- Agent-preset output references and all three production consumers are released
  at `12d2840b1`.
- Punctuation trimming and all four direct consumers are released at
  `386bdd750`.
- Inlay-token matching and both production consumers are released at
  `92dde59e1`.
- ChatML row parsing and all five production consumers are released at
  `14f44ed87`.
- History-slot rendering and all four production consumers are released at
  `7e03538ea`.
- Lore hash randomization is released at `1b1152814`; the browser facade and
  both Fastify owners share one implementation.

## Not In This Slice

- Do not move profile resolution, provider/credential policy, database state,
  request routing, settings UI, or command orchestration into shared core.
- Do not correct the persisted `seperate*` spelling, reorder roles or legacy
  keys, or broaden this slice into profile records/resolvers.
- Do not accept browser stores, DOM/Svelte, Fastify, filesystem, process-global,
  credential, persistence, or aggregate database dependencies.

## Handoff

After this leaf closes, update [`status.md`](status.md) and
[`latest-verification.md`](latest-verification.md), then continue Phase 3 only
with another independently justified neutral leaf.
