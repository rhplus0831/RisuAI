# Cross-Runtime Boundaries Next Steps

Date: 2026-08-31

## Current Best Task

Execute the [lore hash randomization
slice](phases/slices/phase-3-pure-shared-core/lore-hash-randomization.md).

1. Move `sfc32` and `pickHashRand` into an explicit shared-core subpath.
2. Preserve the `5515` seed, four sequential word hashes, UTF-16 `charCodeAt`
   behavior, signed 32-bit coercion/overflow, `cid % 1000` advancement, and the
   exact unsigned division result.
3. Point the browser utility facade and Fastify lorebook activation at the
   shared subpath, and replace the private Fastify CBS copy only after
   differential vectors prove exact parity.
4. Cover empty/Unicode/long strings and negative, zero, boundary, and large
   identifiers with deterministic and repeated-call fixtures.
5. Keep CBS parsing, lorebook activation policy, chat variables, persistence,
   and UI behavior unchanged.

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

## Not In This Slice

- Do not move CBS/lorebook orchestration, database state, chat-variable policy,
  request routing, provider policy, or UI orchestration into shared core.
- Do not change modulo behavior, normalize negative identifiers, replace the
  PRNG, or broaden this slice into unrelated utility helpers.
- Do not accept browser stores, DOM/Svelte, Fastify, filesystem, process-global,
  credential, persistence, or aggregate database dependencies.

## Handoff

After this leaf closes, update [`status.md`](status.md) and
[`latest-verification.md`](latest-verification.md), then continue Phase 3 only
with another independently justified neutral leaf.
