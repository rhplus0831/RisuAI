# Cross-Runtime Boundaries Next Steps

Date: 2026-08-30

## Current Best Task

Execute the [legacy OpenAI model-alias normalization
slice](phases/slices/phase-3-pure-shared-core/legacy-openai-model-alias-normalization.md).

1. Move the exact legacy-to-wire alias table and
   `normalizeLegacyOpenAIModelId` into an explicit shared-core subpath.
2. Preserve every mapped value and return every unknown identifier unchanged;
   do not trim, case-fold, validate, or rewrite stored selections.
3. Migrate the browser OpenAI request path and the Fastify chat-completions,
   legacy-instruct, and Responses API paths together.
4. Delete `src/ts/model/legacyOpenAIModelAliases.ts` only after shared
   differential fixtures and closed-world consumer ownership pass.
5. Keep provider selection, routing, credentials, request parameters, error
   handling, and wire payloads unchanged.

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

## Not In This Slice

- Do not move provider dispatch, endpoint selection, request construction,
  credentials, response parsing, or retry/error policy into shared core.
- Do not expand or modernize the legacy alias table in this boundary move.
- Do not accept browser stores, DOM/Svelte, Fastify, filesystem, process-global,
  credential, persistence, or aggregate database dependencies.

## Handoff

After this leaf closes, update [`status.md`](status.md) and
[`latest-verification.md`](latest-verification.md), then continue Phase 3 only
with another independently justified neutral leaf.
