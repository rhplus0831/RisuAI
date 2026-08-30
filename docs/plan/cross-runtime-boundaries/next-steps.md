# Cross-Runtime Boundaries Next Steps

Date: 2026-08-30

## Current Best Task

Execute the [regex output-size normalization
slice](phases/slices/phase-3-pure-shared-core/regex-output-size-normalization.md).

1. Move the `16` MiB default, `1..64` MiB bounds,
   `normalizeRegexOutputSizeLimitMiB`, and `regexOutputSizeLimitCodeUnits` into
   an explicit shared-core subpath.
2. Preserve numeric-only input, non-finite fallback, truncation toward zero,
   clamping, and the `1024 * 1024` code-unit multiplier exactly.
3. Migrate Fastify defaulting, command validation, bounded-regex/script
   execution, and browser storage/settings/worker consumers together.
4. Delete `src/ts/regexOutputSizeLimit.ts` only after parity and closed-world
   ownership tests pass.
5. Keep the setting key, command range validation, persistence, payloads,
   worker budgets, and browser/server regex behavior unchanged.

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

## Not In This Slice

- Do not move the settings row, command handler, worker orchestration, resource
  owner, payload schema, or persistence behavior into shared core.
- Do not change the regex engine, timeout policy, or output-size units.
- Do not accept browser stores, DOM/Svelte, Fastify, filesystem, process-global,
  credential, persistence, or aggregate database dependencies.

## Handoff

After this leaf closes, update [`status.md`](status.md) and
[`latest-verification.md`](latest-verification.md), then continue Phase 3 only
with another independently justified neutral leaf.
