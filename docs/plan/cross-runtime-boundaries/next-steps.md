# Cross-Runtime Boundaries Next Steps

Date: 2026-08-30

## Current Best Task

Execute the [internal-reasoning stripping
slice](phases/slices/phase-3-pure-shared-core/internal-reasoning-stripping.md).

1. Move the reasoning-tag matcher and `stripInternalReasoning` into an explicit
   shared-core subpath.
2. Preserve case-insensitive `Thoughts`/`think` matching, attributes and spacing,
   nested depth, unmatched close/open behavior, final trimming, and the
   `preserveUnchanged` identity fast path exactly.
3. Migrate browser translator/pipeline and Fastify generation, translation, and
   agent-preset consumers together.
4. Delete `src/ts/process/internalReasoning.ts` only after differential fixtures
   and closed-world consumer ownership pass.
5. Keep generation, translation, agent-output bounds, prompts, persistence,
   streaming, and UI behavior unchanged.

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

## Not In This Slice

- Do not move generation, translation, prompt, agent-preset, streaming,
  persistence, or UI orchestration into shared core.
- Do not broaden the recognized reasoning-tag vocabulary or change whitespace
  policy in this boundary move.
- Do not accept browser stores, DOM/Svelte, Fastify, filesystem, process-global,
  credential, persistence, or aggregate database dependencies.

## Handoff

After this leaf closes, update [`status.md`](status.md) and
[`latest-verification.md`](latest-verification.md), then continue Phase 3 only
with another independently justified neutral leaf.
